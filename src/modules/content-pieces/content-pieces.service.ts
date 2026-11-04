import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { ContentPieceStatus, StoryStatus } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { UpdateContentPieceDto } from "./dto/update-content-piece.dto";

// Statuses a ContentPiece may be edited from. SENT is written by
// SendService.stagePiece the moment a Send is created (README §2 step 3) —
// once that's happened the piece has already gone out to an audience, so an
// edit here would silently rewrite what the audience actually saw. Editing
// must happen strictly before send.
const EDITABLE_STATUSES: ContentPieceStatus[] = [ContentPieceStatus.DRAFTED, ContentPieceStatus.EDITED];

@Injectable()
export class ContentPiecesService {
  constructor(private readonly prisma: PrismaService) {}

  async updateBody(contentPieceId: string, dto: UpdateContentPieceDto, userId: string) {
    const contentPiece = await this.prisma.contentPiece.findUnique({
      where: { id: contentPieceId },
      include: { story: true },
    });
    if (!contentPiece || contentPiece.story.userId !== userId) {
      throw new NotFoundException(`ContentPiece ${contentPieceId} not found`);
    }

    if (contentPiece.story.status === StoryStatus.ARCHIVED) {
      throw new ConflictException(`ContentPiece ${contentPieceId} belongs to an archived story; restore it to edit`);
    }
    if (!EDITABLE_STATUSES.includes(contentPiece.status)) {
      throw new ConflictException(
        `ContentPiece ${contentPieceId} is ${contentPiece.status}; it has already been sent and can no longer be edited`,
      );
    }

    // generatedBody is never touched here (schema.prisma: set once at draft
    // generation, immutable) — only `body` moves. status flips to EDITED as
    // the record of "an edit happened"; send-as-is itself stays derived from
    // body === generatedBody (README task brief), not from this status.
    return this.prisma.contentPiece.update({
      where: { id: contentPieceId },
      data: { body: dto.body, status: ContentPieceStatus.EDITED },
    });
  }

  // Delete one unsent draft, e.g. the LinkedIn version, keeping the X one.
  // A sent piece is never deleted: a room saw it, and its report-back hangs
  // off its Send. The "not sent" check is in the DELETE's own WHERE, so a
  // send landing mid-request can't be deleted out from under it.
  async deletePiece(contentPieceId: string, userId: string): Promise<void> {
    const contentPiece = await this.prisma.contentPiece.findUnique({
      where: { id: contentPieceId },
      include: { story: true },
    });
    if (!contentPiece || contentPiece.story.userId !== userId) {
      throw new NotFoundException(`ContentPiece ${contentPieceId} not found`);
    }
    if (contentPiece.story.status === StoryStatus.ARCHIVED) {
      throw new ConflictException(`ContentPiece ${contentPieceId} belongs to an archived story; restore it first`);
    }

    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.contentPiece.deleteMany({
        where: { id: contentPieceId, status: { not: ContentPieceStatus.SENT }, sends: { none: {} } },
      });
      if (count === 0) {
        throw new ConflictException(`ContentPiece ${contentPieceId} has been sent; it can't be deleted`);
      }
      // The story's last draft gone: back to CAPTURED, so home offers
      // "Draft it" instead of a drafted story with no draft. Only from
      // DRAFTED; a sent story always keeps its sent piece.
      const remaining = await tx.contentPiece.count({ where: { storyId: contentPiece.storyId } });
      if (remaining === 0) {
        await tx.story.updateMany({
          where: { id: contentPiece.storyId, status: StoryStatus.DRAFTED },
          data: { status: StoryStatus.CAPTURED },
        });
      }
    });
  }
}
