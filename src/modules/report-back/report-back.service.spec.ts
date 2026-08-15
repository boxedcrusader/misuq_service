import { BadRequestException, ConflictException } from "@nestjs/common";
import {
  AudienceType,
  Channel,
  ContentPieceStatus,
  ContentType,
  Niche,
  Sentiment,
  Stage,
  StoryStatus,
  Tone,
} from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { StubExtractionProvider } from "./extraction/stub-extraction.provider";
import { ReportBackService } from "./report-back.service";

// Plumbing proof for the report-back module's STAGED -> REPORTED transition
// (README §2 step 4) and the private-to-poolable-layer crossing (§5): every
// SignalRecord written here must snapshot its dims at THIS moment and must
// never coerce an unreported field to 0/false. Real PrismaService against a
// disposable test database, deterministic StubExtractionProvider, zero HTTP
// layer — matches capture/send's spec conventions.
describe("ReportBackService: report (STAGED -> REPORTED) and the poolable-layer crossing", () => {
  let prisma: PrismaService;
  let service: ReportBackService;
  let userId: string;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    service = new ReportBackService(prisma, new StubExtractionProvider());
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
        "SignalRecord", "FeedbackReport", "Send", "ContentPiece", "Story",
        "Audience", "VoiceProfile", "User"
      RESTART IDENTITY CASCADE;
    `);

    // Seeded WITH a real niche: reportBack now fail-closes on User.niche ===
    // null (README §5 "NEVER synthesize a value for a poolable-layer
    // dimension"), so the default test user needs an honest niche for every
    // test below except the dedicated null-niche guard test.
    const user = await prisma.user.create({
      data: { email: "report-test@misuq.test", passwordHash: "not-a-real-hash", niche: Niche.DEV_TOOLS },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function createStagedSend(
    ownerId: string,
    opts?: { audienceSize?: number; channel?: Channel; tone?: Tone; contentType?: ContentType },
  ) {
    const story = await prisma.story.create({
      data: {
        userId: ownerId,
        rawCapture: "Shipped a thing.",
        contentType: opts?.contentType ?? ContentType.OTHER,
        status: StoryStatus.STAGED,
      },
    });
    const contentPiece = await prisma.contentPiece.create({
      data: {
        storyId: story.id,
        channel: opts?.channel ?? Channel.EMAIL,
        stage: Stage.PREVIEW,
        tone: opts?.tone ?? Tone.OTHER,
        body: "stub body",
        generatedBody: "stub body",
        status: ContentPieceStatus.SENT,
      },
    });
    const audienceSize = opts?.audienceSize ?? 100;
    const audience = await prisma.audience.create({
      data: { userId: ownerId, name: "Beta list", type: AudienceType.EMAIL_LIST, size: audienceSize },
    });
    const send = await prisma.send.create({
      data: { contentPieceId: contentPiece.id, audienceId: audience.id, audienceSizeSnapshot: audienceSize },
    });
    return { story, contentPiece, audience, send };
  }

  it("reports a STAGED Send: creates FeedbackReport + SignalRecord, flips Story to REPORTED, one commit", async () => {
    const { story, send } = await createStagedSend(userId);

    const result = await service.reportBack({ sendId: send.id, rawFeedback: "posted this morning, ~4k views" }, userId);
    expect(result.rawFeedback).toBe("posted this morning, ~4k views");
    expect(result.signalRecord).toBeDefined();
    expect(result.signalRecord.feedbackReportId).toBe(result.id);

    const reloadedStory = await prisma.story.findUniqueOrThrow({ where: { id: story.id } });
    expect(reloadedStory.status).toBe(StoryStatus.REPORTED);

    const reports = await prisma.feedbackReport.findMany({ where: { sendId: send.id } });
    expect(reports).toHaveLength(1);
    const signals = await prisma.signalRecord.findMany({ where: { feedbackReportId: reports[0].id } });
    expect(signals).toHaveLength(1);
  });

  it("preserves null-vs-zero: unreported fields are stored as real DB NULL, not 0/false", async () => {
    const { send } = await createStagedSend(userId);

    const result = await service.reportBack({ sendId: send.id, rawFeedback: "quiet, couple replies" }, userId);
    const signal = result.signalRecord;

    // Extracted fields the stub explicitly reports.
    expect(signal.views).toBe(4000);
    expect(signal.replyCount).toBe(2);
    expect(signal.sentiment).toBe(Sentiment.POSITIVE);

    // Extracted fields the stub explicitly leaves unreported — must be
    // null, never 0/false.
    expect(signal.signupCount).toBeNull();
    expect(signal.hasMedia).toBeNull();
    expect(signal.hasExternalLink).toBeNull();
    expect(signal.postFormat).toBeNull();
    expect(signal.followerCountSnapshot).toBeNull();
    expect(signal.isPremiumAccount).toBeNull();
    expect(signal.postedAt).toBeNull();

    // Prove it's a genuine DB NULL (not a Prisma client-side artifact) by
    // reading the raw column back.
    const rows = await prisma.$queryRawUnsafe<{ signupCount: number | null }[]>(
      `SELECT "signupCount" FROM "SignalRecord" WHERE id = $1`,
      signal.id,
    );
    expect(rows[0].signupCount).toBeNull();
  });

  it("snapshots niche/channel/contentType/tone/audienceSizeSnapshot from the source rows at report time", async () => {
    const user = await prisma.user.create({
      data: {
        email: "snapshot-test@misuq.test",
        passwordHash: "not-a-real-hash",
        niche: Niche.DEV_TOOLS,
      },
    });
    const { send } = await createStagedSend(user.id, {
      audienceSize: 250,
      channel: Channel.X,
      tone: Tone.CONFIDENT,
      contentType: ContentType.MILESTONE,
    });

    const result = await service.reportBack({ sendId: send.id, rawFeedback: "shipped it" }, user.id);
    const signal = result.signalRecord;

    expect(signal.niche).toBe(Niche.DEV_TOOLS);
    expect(signal.channel).toBe(Channel.X);
    expect(signal.contentType).toBe(ContentType.MILESTONE);
    expect(signal.tone).toBe(Tone.CONFIDENT);
    expect(signal.audienceSizeSnapshot).toBe(250);
  });

  it("creates a SignalRecord even when the user has NOT opted into aggregate learning", async () => {
    const optedOutUser = await prisma.user.create({
      data: {
        email: "opted-out@misuq.test",
        passwordHash: "not-a-real-hash",
        aggregateLearningConsent: false,
        niche: Niche.DEV_TOOLS,
      },
    });
    expect(optedOutUser.aggregateLearningConsent).toBe(false);

    const { send } = await createStagedSend(optedOutUser.id);
    const result = await service.reportBack({ sendId: send.id, rawFeedback: "no consent, still my data" }, optedOutUser.id);

    expect(result.signalRecord).toBeDefined();
    const signals = await prisma.signalRecord.findMany({ where: { userId: optedOutUser.id } });
    expect(signals).toHaveLength(1);
  });

  it("rejects reporting on the same Send twice", async () => {
    const { send } = await createStagedSend(userId);

    await service.reportBack({ sendId: send.id, rawFeedback: "first report" }, userId);
    await expect(
      service.reportBack({ sendId: send.id, rawFeedback: "second report attempt" }, userId),
    ).rejects.toBeInstanceOf(ConflictException);

    const reports = await prisma.feedbackReport.findMany({ where: { sendId: send.id } });
    expect(reports).toHaveLength(1);
  });

  it("allows reporting both Sends of a multi-send story: two SignalRecords, story stays REPORTED", async () => {
    const { story, contentPiece } = await createStagedSend(userId);
    const secondAudience = await prisma.audience.create({
      data: { userId, name: "Discord", type: AudienceType.DISCORD, size: 30 },
    });
    const secondSend = await prisma.send.create({
      data: { contentPieceId: contentPiece.id, audienceId: secondAudience.id, audienceSizeSnapshot: 30 },
    });
    const firstSend = await prisma.send.findFirstOrThrow({ where: { contentPieceId: contentPiece.id, audienceId: { not: secondAudience.id } } });

    await service.reportBack({ sendId: firstSend.id, rawFeedback: "report on send one" }, userId);
    const reloadedAfterFirst = await prisma.story.findUniqueOrThrow({ where: { id: story.id } });
    expect(reloadedAfterFirst.status).toBe(StoryStatus.REPORTED);

    await expect(
      service.reportBack({ sendId: secondSend.id, rawFeedback: "report on send two" }, userId),
    ).resolves.toBeDefined();

    const reloadedAfterSecond = await prisma.story.findUniqueOrThrow({ where: { id: story.id } });
    expect(reloadedAfterSecond.status).toBe(StoryStatus.REPORTED);

    const signals = await prisma.signalRecord.findMany({ where: { userId } });
    expect(signals).toHaveLength(2);
  });

  it("rejects reporting on a Send whose story was never staged (still DRAFTED)", async () => {
    const story = await prisma.story.create({
      data: { userId, rawCapture: "Never sent.", contentType: ContentType.OTHER, status: StoryStatus.DRAFTED },
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
    const audience = await prisma.audience.create({
      data: { userId, name: "Beta list", type: AudienceType.EMAIL_LIST, size: 10 },
    });
    // A Send row existing at all implies STAGED in the real flow (send.service.ts
    // sets it atomically); constructed directly here to isolate the precondition
    // guard from Send's own invariants, with Story deliberately left DRAFTED.
    const send = await prisma.send.create({
      data: { contentPieceId: contentPiece.id, audienceId: audience.id, audienceSizeSnapshot: 10 },
    });

    await expect(service.reportBack({ sendId: send.id, rawFeedback: "too early" }, userId)).rejects.toBeInstanceOf(
      ConflictException,
    );

    const reports = await prisma.feedbackReport.findMany({ where: { sendId: send.id } });
    expect(reports).toHaveLength(0);
  });

  it("fail-closes when the reporting user's niche is null: refuses cleanly, writes nothing", async () => {
    const noNicheUser = await prisma.user.create({
      data: { email: "no-niche@misuq.test", passwordHash: "not-a-real-hash" },
    });
    expect(noNicheUser.niche).toBeNull();

    const { send } = await createStagedSend(noNicheUser.id);

    await expect(
      service.reportBack({ sendId: send.id, rawFeedback: "would pool under a guessed niche otherwise" }, noNicheUser.id),
    ).rejects.toBeInstanceOf(BadRequestException);

    const reports = await prisma.feedbackReport.findMany({ where: { sendId: send.id } });
    expect(reports).toHaveLength(0);
    const signals = await prisma.signalRecord.findMany({ where: { userId: noNicheUser.id } });
    expect(signals).toHaveLength(0);
  });
});
