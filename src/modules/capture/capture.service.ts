import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Channel, ContentPieceStatus, ContentType, Stage, StoryStatus } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { CreateStoryDto } from "./dto/create-story.dto";
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
//   ARCHIVED  — not yet designed.
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

  async draftStory(storyId: string, userId: string) {
    const story = await this.prisma.story.findUnique({ where: { id: storyId } });
    if (!story || story.userId !== userId) {
      throw new NotFoundException(`Story ${storyId} not found`);
    }

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
      channel: Channel.EMAIL,
      voice: voiceProfile,
    });

    // Draft creation and the Story's CAPTURED -> DRAFTED transition are
    // atomic: never a ContentPiece on disk with the parent Story still
    // reading a stale CAPTURED status. Unconditionally setting DRAFTED here
    // is safe without a forward-only ordering guard because this slice only
    // ever reaches CAPTURED or DRAFTED — re-drafting an already-DRAFTED
    // story just re-sets the same value, which is a no-op, not a
    // regression. A real ordering guard becomes necessary once STAGED+
    // exist and draftStory could otherwise be called on a story that has
    // already moved past DRAFTED.
    const [contentPiece] = await this.prisma.$transaction([
      this.prisma.contentPiece.create({
        data: {
          storyId: story.id,
          channel: Channel.EMAIL,
          stage: Stage.PREVIEW,
          tone: draft.tone,
          body: draft.body,
          status: ContentPieceStatus.DRAFTED,
        },
      }),
      this.prisma.story.update({
        where: { id: story.id },
        data: { status: StoryStatus.DRAFTED },
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
