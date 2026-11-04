import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { reserveAiRequest } from "../../common/usage-limits";
import { AiTask, Channel, ContentPieceStatus, ContentType, Stage, StoryStatus } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { CreateStoryDto } from "./dto/create-story.dto";
import { UpdateStoryDto } from "./dto/update-story.dto";
import { DRAFTING_PROVIDER, DraftingProvider } from "./drafting/drafting.provider";

interface PaginationParams {
  page?: number;
  limit?: number;
}

// StoryStatus lifecycle (README §2/§5): CAPTURED -> DRAFTED -> STAGED ->
// REPORTED -> GRADUATED -> ARCHIVED. Stored on the row (schema.prisma),
// written only by the service method that causes each transition, in the
// same transaction as the causing write. Reads use the column only — never
// re-derive it from a relation (that broke the moment this loop grew past
// two states; see draftStory below for the one transition this slice owns).
//
// This module implements only CAPTURED -> DRAFTED. Future transitions
// belong to their owning modules, not here:
//   STAGED    — Send/staging module, when a Send is created for one of this
//               story's contentPieces.
//   REPORTED  — report-back module, when a FeedbackReport arrives for a
//               Send tied to this story.
//   GRADUATED — the founder's explicit graduate decision (§2: human-gated,
//               never automatic). Story.graduatedAt already exists as the
//               timestamp for this same event — whichever module builds
//               graduation MUST set graduatedAt and status = GRADUATED in
//               the same transaction, or it reintroduces a two-sources-of-
//               truth split between them.
//   ARCHIVED  — the founder sets a story aside (archiveStory below,
//               2026-11-04). archivedFromStatus keeps the status it left,
//               so unarchiveStory restores it exactly; an archived story is
//               read-only (no drafting, editing, sending or reporting). Its
//               outcomes stay in the founder's analytics.
//   (back to) CAPTURED — ContentPiecesService.deletePiece, when the founder
//               deletes a DRAFTED story's last unsent draft.
//
// "Sent" is the line nothing crosses: once any piece of a story has a Send,
// a room has seen it, so the story can't be edited or deleted (only
// archived). Each check below is folded into the write's own WHERE clause,
// so a send landing mid-request can't slip past it.
@Injectable()
export class CaptureService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(DRAFTING_PROVIDER) private readonly draftingProvider: DraftingProvider,
  ) {}

  async captureStory(dto: CreateStoryDto, userId: string) {
    // status defaults to CAPTURED at the DB level (schema.prisma) — nothing
    // to set here.
    return this.prisma.story.create({
      data: {
        userId,
        rawCapture: dto.rawCapture,
        title: dto.title,
        contentType: dto.contentType ?? ContentType.OTHER,
      },
    });
  }

  async draftStory(storyId: string, userId: string, channel: Channel = Channel.EMAIL) {
    const story = await this.prisma.story.findUnique({
      where: { id: storyId },
      // The founder's name, so the draft can sign off as them instead of the
      // model inventing one ("Best, Alex" — seen live, 2026-11-03).
      include: { user: { select: { name: true } } },
    });
    if (!story || story.userId !== userId) {
      throw new NotFoundException(`Story ${storyId} not found`);
    }
    if (story.status === StoryStatus.ARCHIVED) {
      throw new ConflictException(`Story ${storyId} is ARCHIVED; it can't be drafted`);
    }

    // Per-account and global daily AI caps (common/usage-limits.ts): the
    // attempt is recorded before the model is called, so a draft that fails
    // still counts. After the ownership check, so a 404 costs nothing.
    await reserveAiRequest(this.prisma, userId, AiTask.DRAFT);

    // VoiceProfile is optional -- most founders won't have one yet (no
    // profile-creation endpoint exists). findUnique returns null in that
    // case rather than throwing, and that null flows straight through as
    // `voice: null`, which GeminiDraftingProvider's buildPrompt treats as a
    // real, expected branch (README §5: VoiceProfile is read only by this
    // founder's own agent, never pooled).
    const voiceProfile = await this.prisma.voiceProfile.findUnique({
      where: { userId },
      select: { styleSample: true },
    });

    const draft = await this.draftingProvider.generateDraft({
      rawCapture: story.rawCapture,
      title: story.title ?? undefined,
      channel,
      voice: voiceProfile,
      founderName: story.user.name,
    });

    // Draft creation and the Story's CAPTURED -> DRAFTED transition are
    // atomic: never a ContentPiece on disk with the parent Story still
    // reading a stale CAPTURED status.
    //
    // Forward-only (2026-11-04): a founder can now draft the same story in
    // another format at any point (e.g. take a graduated X post to
    // LinkedIn), so status only moves CAPTURED -> DRAFTED here and is never
    // pulled back from STAGED/REPORTED/GRADUATED. A draft made after
    // graduation is a WIDE-stage piece: the reformat-for-wider-channels step.
    const nextStatus = story.status === StoryStatus.CAPTURED ? StoryStatus.DRAFTED : story.status;
    const stage = story.status === StoryStatus.GRADUATED ? Stage.WIDE : Stage.PREVIEW;
    const [contentPiece] = await this.prisma.$transaction([
      this.prisma.contentPiece.create({
        data: {
          storyId: story.id,
          channel,
          stage,
          tone: draft.tone,
          body: draft.body,
          // Immutable snapshot, set once, same value as body at this
          // instant only — never written again after this row is created
          // (see content-pieces.service.ts's edit endpoint).
          generatedBody: draft.body,
          status: ContentPieceStatus.DRAFTED,
        },
      }),
      this.prisma.story.update({
        where: { id: story.id },
        data: { status: nextStatus },
      }),
    ]);

    return contentPiece;
  }

  async findAll(userId: string, { page = 1, limit = 20 }: PaginationParams) {
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.prisma.story.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      this.prisma.story.count({ where: { userId } }),
    ]);

    return {
      data,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async updateStory(storyId: string, userId: string, dto: UpdateStoryDto) {
    const story = await this.findOwnedStory(storyId, userId);
    if (story.status === StoryStatus.ARCHIVED) {
      throw new ConflictException(`Story ${storyId} is archived; restore it to edit it`);
    }
    if (dto.rawCapture !== undefined && dto.rawCapture.trim().length === 0) {
      throw new BadRequestException("rawCapture should not be empty");
    }
    const { count } = await this.prisma.story.updateMany({
      where: { id: storyId, status: { not: StoryStatus.ARCHIVED }, contentPieces: { none: { sends: { some: {} } } } },
      data: {
        ...(dto.rawCapture !== undefined && { rawCapture: dto.rawCapture.trim() }),
        // An emptied title clears it rather than storing "".
        ...(dto.title !== undefined && { title: dto.title.trim() || null }),
        ...(dto.contentType !== undefined && { contentType: dto.contentType }),
      },
    });
    if (count === 0) {
      throw new ConflictException(`Story ${storyId} has been sent; what the room saw can't be changed`);
    }
    return this.prisma.story.findUniqueOrThrow({ where: { id: storyId } });
  }

  // A real delete (the founder owns their words), allowed only while nothing
  // was sent: an unsent story has no outcome to keep. Its drafts go with it
  // (ContentPiece -> Story is ON DELETE CASCADE). It gives back no daily
  // drafts: AiRequest rows aren't tied to stories, so draft-then-delete
  // can't get around the cap.
  async deleteStory(storyId: string, userId: string): Promise<void> {
    await this.findOwnedStory(storyId, userId);
    const { count } = await this.prisma.story.deleteMany({
      where: { id: storyId, contentPieces: { none: { sends: { some: {} } } } },
    });
    if (count === 0) {
      throw new ConflictException(`Story ${storyId} has been sent, so it can't be deleted; archive it instead`);
    }
  }

  async archiveStory(storyId: string, userId: string) {
    const story = await this.findOwnedStory(storyId, userId);
    if (story.status === StoryStatus.ARCHIVED) return story;
    // Conditional on the status just read, so a transition landing in
    // between (a send, a report) can't be recorded under a stale status.
    const { count } = await this.prisma.story.updateMany({
      where: { id: storyId, status: story.status },
      data: { status: StoryStatus.ARCHIVED, archivedFromStatus: story.status },
    });
    if (count === 0) {
      throw new ConflictException(`Story ${storyId} changed while it was being archived; try again`);
    }
    return this.prisma.story.findUniqueOrThrow({ where: { id: storyId } });
  }

  async unarchiveStory(storyId: string, userId: string) {
    const story = await this.findOwnedStory(storyId, userId);
    if (story.status !== StoryStatus.ARCHIVED) return story;
    // archiveStory always sets archivedFromStatus; the fallback only covers
    // an ARCHIVED row written some other way.
    const restored = story.archivedFromStatus ?? StoryStatus.CAPTURED;
    await this.prisma.story.updateMany({
      where: { id: storyId, status: StoryStatus.ARCHIVED },
      data: { status: restored, archivedFromStatus: null },
    });
    return this.prisma.story.findUniqueOrThrow({ where: { id: storyId } });
  }

  private async findOwnedStory(storyId: string, userId: string) {
    const story = await this.prisma.story.findUnique({ where: { id: storyId } });
    if (!story || story.userId !== userId) {
      throw new NotFoundException(`Story ${storyId} not found`);
    }
    return story;
  }

  async findOne(id: string, userId: string) {
    const story = await this.prisma.story.findUnique({
      where: { id },
      include: { contentPieces: true },
    });
    if (!story || story.userId !== userId) {
      throw new NotFoundException(`Story ${id} not found`);
    }
    return story;
  }
}
