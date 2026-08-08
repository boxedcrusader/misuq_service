import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { ContentType, StoryStatus } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { GraduateService } from "./graduate.service";

// Plumbing proof for the graduate module's REPORTED -> GRADUATED transition
// (README §2 step 5 — the human-gated decision) and the "state + timestamp
// are two questions, not two truths" invariant (architecture-principles.md
// Part 2): a Story must never exist as GRADUATED with a null graduatedAt, or
// with graduatedAt set but a non-GRADUATED status. Real PrismaService
// against a disposable test database, zero HTTP layer — matches the other
// modules' spec conventions.
describe("GraduateService: graduate (REPORTED -> GRADUATED) and its guards", () => {
  let prisma: PrismaService;
  let service: GraduateService;
  let userId: string;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    service = new GraduateService(prisma);
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
        "SignalRecord", "FeedbackReport", "Send", "ContentPiece", "Story",
        "Audience", "VoiceProfile", "User"
      RESTART IDENTITY CASCADE;
    `);

    const user = await prisma.user.create({
      data: { email: "graduate-test@misuq.test", passwordHash: "not-a-real-hash" },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // Graduate only ever reads/writes Story.status and Story.graduatedAt
  // (scope is status-only — no reformat, no Send/SignalRecord involved), so
  // a bare Story row in the target status is sufficient to exercise every
  // guard, same pattern as report-back.service.spec.ts's DRAFTED-precondition
  // test isolating that guard from Send's own invariants.
  async function createStory(status: StoryStatus, ownerId = userId) {
    return prisma.story.create({
      data: { userId: ownerId, rawCapture: "seed", contentType: ContentType.OTHER, status },
    });
  }

  it("graduates a REPORTED story: status GRADUATED and graduatedAt set, both in one commit", async () => {
    const story = await createStory(StoryStatus.REPORTED);

    const result = await service.graduateStory(story.id, userId);
    expect(result.status).toBe(StoryStatus.GRADUATED);
    expect(result.graduatedAt).not.toBeNull();
    expect(result.graduatedAt).toBeInstanceOf(Date);

    const reloaded = await prisma.story.findUniqueOrThrow({ where: { id: story.id } });
    expect(reloaded.status).toBe(StoryStatus.GRADUATED);
    expect(reloaded.graduatedAt).not.toBeNull();
  });

  it("never leaves a half-state: GRADUATED always has a non-null graduatedAt, and vice versa", async () => {
    const story = await createStory(StoryStatus.REPORTED);
    await service.graduateStory(story.id, userId);

    const reloaded = await prisma.story.findUniqueOrThrow({ where: { id: story.id } });
    const isHalfState =
      (reloaded.status === StoryStatus.GRADUATED) !== (reloaded.graduatedAt !== null);
    expect(isHalfState).toBe(false);
    expect(reloaded.status).toBe(StoryStatus.GRADUATED);
    expect(reloaded.graduatedAt).not.toBeNull();
  });

  it.each([StoryStatus.CAPTURED, StoryStatus.DRAFTED, StoryStatus.STAGED])(
    "rejects graduating a %s story: throws, status unchanged, graduatedAt stays null",
    async (status) => {
      const story = await createStory(status);

      await expect(service.graduateStory(story.id, userId)).rejects.toBeInstanceOf(BadRequestException);

      const reloaded = await prisma.story.findUniqueOrThrow({ where: { id: story.id } });
      expect(reloaded.status).toBe(status);
      expect(reloaded.graduatedAt).toBeNull();
    },
  );

  it("rejects re-graduation: second call throws ConflictException and does NOT overwrite the original graduatedAt", async () => {
    const story = await createStory(StoryStatus.REPORTED);

    const first = await service.graduateStory(story.id, userId);
    const originalGraduatedAt = first.graduatedAt;

    await expect(service.graduateStory(story.id, userId)).rejects.toBeInstanceOf(ConflictException);

    const reloaded = await prisma.story.findUniqueOrThrow({ where: { id: story.id } });
    expect(reloaded.status).toBe(StoryStatus.GRADUATED);
    expect(reloaded.graduatedAt).toEqual(originalGraduatedAt);
  });

  it("scopes graduation to the owning user: another user's story 404s", async () => {
    const owner = await prisma.user.create({
      data: { email: "graduate-owner@misuq.test", passwordHash: "not-a-real-hash" },
    });
    const intruder = await prisma.user.create({
      data: { email: "graduate-intruder@misuq.test", passwordHash: "not-a-real-hash" },
    });
    const story = await createStory(StoryStatus.REPORTED, owner.id);

    await expect(service.graduateStory(story.id, intruder.id)).rejects.toBeInstanceOf(NotFoundException);

    const reloaded = await prisma.story.findUniqueOrThrow({ where: { id: story.id } });
    expect(reloaded.status).toBe(StoryStatus.REPORTED);
    expect(reloaded.graduatedAt).toBeNull();
  });
});
