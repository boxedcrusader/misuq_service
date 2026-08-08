import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { ContentPieceStatus, Prisma, StoryStatus } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { CreateSendDto } from "./dto/create-send.dto";

interface PaginationParams {
  page?: number;
  limit?: number;
}

// Statuses a Story may be in when one of its ContentPieces gets staged.
// DRAFTED -> first stage. STAGED -> staging the same (or another) piece to
// another audience; the story simply stays STAGED. Anything past STAGED
// (REPORTED/GRADUATED/ARCHIVED) means the loop has already moved on — a
// re-send there would silently un-graduate the story (README §2: graduation
// is a one-way, human-gated decision), so it's rejected instead of derived.
const STAGEABLE_STORY_STATUSES: StoryStatus[] = [StoryStatus.DRAFTED, StoryStatus.STAGED];

@Injectable()
export class SendService {
  constructor(private readonly prisma: PrismaService) {}

  async stagePiece(dto: CreateSendDto, userId: string) {
    const contentPiece = await this.prisma.contentPiece.findUnique({
      where: { id: dto.contentPieceId },
      include: { story: true },
    });
    if (!contentPiece || contentPiece.story.userId !== userId) {
      throw new NotFoundException(`ContentPiece ${dto.contentPieceId} not found`);
    }

    const audience = await this.prisma.audience.findUnique({ where: { id: dto.audienceId } });
    if (!audience || audience.userId !== userId) {
      throw new NotFoundException(`Audience ${dto.audienceId} not found`);
    }

    // Status regression guard (Part 2's second-writer stress test) — checked
    // before the duplicate guard so a stale/past-STAGED story reports the
    // more specific "you can't stage this anymore" reason.
    if (!STAGEABLE_STORY_STATUSES.includes(contentPiece.story.status)) {
      throw new ConflictException(
        `Story ${contentPiece.story.id} is ${contentPiece.story.status}; only a DRAFTED or already-STAGED story can be staged`,
      );
    }

    // Service-level duplicate pre-check (README's "a double-click isn't a
    // real second event") — the @@unique([contentPieceId, audienceId]) on
    // Send below is the DB-level backstop for a genuine race, not the
    // primary guard.
    const existingSend = await this.prisma.send.findUnique({
      where: { contentPieceId_audienceId: { contentPieceId: dto.contentPieceId, audienceId: dto.audienceId } },
    });
    if (existingSend) {
      throw new ConflictException(
        `ContentPiece ${dto.contentPieceId} has already been staged to Audience ${dto.audienceId}`,
      );
    }

    try {
      const [send] = await this.prisma.$transaction([
        this.prisma.send.create({
          data: {
            contentPieceId: dto.contentPieceId,
            audienceId: dto.audienceId,
            // Frozen at send time (§5 rule 4) — Audience.size is never read
            // live again after this write.
            audienceSizeSnapshot: audience.size,
          },
        }),
        this.prisma.contentPiece.update({
          where: { id: contentPiece.id },
          data: { status: ContentPieceStatus.SENT },
        }),
        this.prisma.story.update({
          where: { id: contentPiece.story.id },
          data: { status: StoryStatus.STAGED },
        }),
      ]);
      return send;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException(
          `ContentPiece ${dto.contentPieceId} has already been staged to Audience ${dto.audienceId}`,
        );
      }
      throw error;
    }
  }

  async findAll(userId: string, { page = 1, limit = 20 }: PaginationParams) {
    const skip = (page - 1) * limit;
    const where: Prisma.SendWhereInput = { contentPiece: { story: { userId } } };

    const [data, total] = await Promise.all([
      this.prisma.send.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      this.prisma.send.count({ where }),
    ]);

    return {
      data,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: string, userId: string) {
    const send = await this.prisma.send.findUnique({
      where: { id },
      include: { contentPiece: { include: { story: true } } },
    });
    if (!send || send.contentPiece.story.userId !== userId) {
      throw new NotFoundException(`Send ${id} not found`);
    }
    return send;
  }
}
