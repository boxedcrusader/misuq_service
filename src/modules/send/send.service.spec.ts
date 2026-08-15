import { ConflictException } from "@nestjs/common";
import { AudienceType, Channel, ContentType, Stage, StoryStatus, Tone } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { SendService } from "./send.service";

// Plumbing proof for the Send module's DRAFTED -> STAGED transition (README
// §2 step 3 / architecture-principles Part 2). Talks directly to SendService
// with a real PrismaService against a disposable test database — zero HTTP
// layer. All status/snapshot assertions below read columns straight off the
// row returned by Prisma, matching capture.service.spec.ts's convention.
describe("SendService: stage (DRAFTED -> STAGED) happy path and guards", () => {
  let prisma: PrismaService;
  let service: SendService;
  let userId: string;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    service = new SendService(prisma);
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
        "SignalRecord", "FeedbackReport", "Send", "ContentPiece", "Story",
        "Audience", "VoiceProfile", "User"
      RESTART IDENTITY CASCADE;
    `);

    const user = await prisma.user.create({
      data: { email: "send-test@misuq.test", passwordHash: "not-a-real-hash" },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function createDraftedPiece() {
    const story = await prisma.story.create({
      data: { userId, rawCapture: "Shipped a thing.", contentType: ContentType.OTHER, status: StoryStatus.DRAFTED },
    });
    const contentPiece = await prisma.contentPiece.create({
      data: {
        storyId: story.id,
        channel: Channel.EMAIL,
        stage: Stage.PREVIEW,
        tone: Tone.OTHER,
        body: "stub body",
        generatedBody: "stub body",
      },
    });
    return { story, contentPiece };
  }

  async function createAudience(size: number, name = "Beta list") {
    return prisma.audience.create({ data: { userId, name, type: AudienceType.EMAIL_LIST, size } });
  }

  it("stages a DRAFTED piece: freezes audienceSizeSnapshot, flips Story to STAGED and ContentPiece to SENT", async () => {
    const { story, contentPiece } = await createDraftedPiece();
    const audience = await createAudience(42);

    const send = await service.stagePiece({ contentPieceId: contentPiece.id, audienceId: audience.id }, userId);
    expect(send.audienceSizeSnapshot).toBe(42);

    const reloadedStory = await prisma.story.findUniqueOrThrow({ where: { id: story.id } });
    expect(reloadedStory.status).toBe(StoryStatus.STAGED);

    const reloadedPiece = await prisma.contentPiece.findUniqueOrThrow({ where: { id: contentPiece.id } });
    expect(reloadedPiece.status).toBe("SENT");
  });

  it("freezes audienceSizeSnapshot: growing the Audience afterward does not change the Send", async () => {
    const { contentPiece } = await createDraftedPiece();
    const audience = await createAudience(42);

    const send = await service.stagePiece({ contentPieceId: contentPiece.id, audienceId: audience.id }, userId);

    await prisma.audience.update({ where: { id: audience.id }, data: { size: 9000 } });

    const reloadedSend = await prisma.send.findUniqueOrThrow({ where: { id: send.id } });
    expect(reloadedSend.audienceSizeSnapshot).toBe(42);
  });

  it("rejects staging the same piece to the same audience twice", async () => {
    const { contentPiece } = await createDraftedPiece();
    const audience = await createAudience(42);

    await service.stagePiece({ contentPieceId: contentPiece.id, audienceId: audience.id }, userId);
    await expect(
      service.stagePiece({ contentPieceId: contentPiece.id, audienceId: audience.id }, userId),
    ).rejects.toBeInstanceOf(ConflictException);

    const sends = await prisma.send.findMany({ where: { contentPieceId: contentPiece.id } });
    expect(sends).toHaveLength(1);
  });

  it("allows staging the same piece to a different audience", async () => {
    const { contentPiece } = await createDraftedPiece();
    const firstAudience = await createAudience(42, "Email list");
    const secondAudience = await createAudience(7, "Discord");

    await service.stagePiece({ contentPieceId: contentPiece.id, audienceId: firstAudience.id }, userId);
    await service.stagePiece({ contentPieceId: contentPiece.id, audienceId: secondAudience.id }, userId);

    const sends = await prisma.send.findMany({ where: { contentPieceId: contentPiece.id } });
    expect(sends).toHaveLength(2);
  });

  it("rejects staging a story that has already moved past STAGED", async () => {
    const { story, contentPiece } = await createDraftedPiece();
    await prisma.story.update({ where: { id: story.id }, data: { status: StoryStatus.GRADUATED } });
    const audience = await createAudience(42);

    await expect(
      service.stagePiece({ contentPieceId: contentPiece.id, audienceId: audience.id }, userId),
    ).rejects.toBeInstanceOf(ConflictException);

    const reloadedStory = await prisma.story.findUniqueOrThrow({ where: { id: story.id } });
    expect(reloadedStory.status).toBe(StoryStatus.GRADUATED);

    const sends = await prisma.send.findMany({ where: { contentPieceId: contentPiece.id } });
    expect(sends).toHaveLength(0);
  });
});
