import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { StoryStatus } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";

@Injectable()
export class GraduateService {
  constructor(private readonly prisma: PrismaService) {}

  async graduateStory(storyId: string, userId: string) {
    const story = await this.prisma.story.findUnique({ where: { id: storyId } });
    if (!story || story.userId !== userId) {
      throw new NotFoundException(`Story ${storyId} not found`);
    }

    // Re-graduation is rejected, not a no-op (architecture-principles.md Part
    // 2, "State + timestamp are two questions"): graduatedAt is the moment
    // the human decided. Re-stamping it on a second call would overwrite
    // that historical fact with a later time, corrupting "how long did
    // validation take?" — refuse instead of silently rewriting history.
    if (story.status === StoryStatus.GRADUATED) {
      throw new ConflictException(`Story ${storyId} is already GRADUATED; graduatedAt is not re-stamped`);
    }

    // Human-gated rule (README §2): graduation requires the story was
    // actually sent AND reported on. Everything that isn't REPORTED here is
    // either not yet validated (CAPTURED/DRAFTED/STAGED) or already past the
    // lifecycle (ARCHIVED) — neither has anything to graduate.
    if (story.status !== StoryStatus.REPORTED) {
      throw new BadRequestException(
        `Story ${storyId} is ${story.status}; only a REPORTED story can be graduated`,
      );
    }

    // Atomic + single-writer (architecture-principles.md Part 2): status and
    // graduatedAt are two questions ("what state?" / "since when?"), not two
    // competing truths — the single update in this one transaction is what
    // keeps a row from ever existing as GRADUATED-with-null-graduatedAt or
    // graduatedAt-set-with-non-GRADUATED-status. Array form is fine here
    // (one row, no cross-step dependency), but both fields are written in
    // the SAME update call, never split across two.
    const [graduated] = await this.prisma.$transaction([
      this.prisma.story.update({
        where: { id: storyId },
        data: { status: StoryStatus.GRADUATED, graduatedAt: new Date() },
      }),
    ]);

    return graduated;
  }
}
