import { AiTask, AudienceType, Channel, ContentType, Niche, Stage, StoryStatus, Tone } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { StatsService } from "./stats.service";

// The query side of the profile page against a real database: the founder's
// own records only, joined back to their stories, plus today's AI use. The
// rules themselves are covered by stats-core.spec.ts.
describe("StatsService.forFounder", () => {
  let prisma: PrismaService;
  let service: StatsService;
  let userId: string;

  async function reported(ownerId: string, title: string, views: number, replies: number, extra: Record<string, number> = {}) {
    const audience = await prisma.audience.create({
      data: { userId: ownerId, name: "X", type: AudienceType.X_FOLLOWERS, size: 800 },
    });
    const story = await prisma.story.create({
      data: { userId: ownerId, rawCapture: `${title} body`, title, contentType: ContentType.FEATURE_ANNOUNCEMENT, status: StoryStatus.REPORTED },
    });
    const piece = await prisma.contentPiece.create({
      data: { storyId: story.id, channel: Channel.X, stage: Stage.PREVIEW, tone: Tone.CONFIDENT, generatedBody: "b", body: "b", status: "SENT" },
    });
    const send = await prisma.send.create({ data: { contentPieceId: piece.id, audienceId: audience.id, audienceSizeSnapshot: 800 } });
    const report = await prisma.feedbackReport.create({ data: { sendId: send.id, rawFeedback: "raw" } });
    await prisma.signalRecord.create({
      data: {
        userId: ownerId,
        feedbackReportId: report.id,
        niche: Niche.DEV_TOOLS,
        channel: Channel.X,
        contentType: ContentType.FEATURE_ANNOUNCEMENT,
        tone: Tone.CONFIDENT,
        audienceSizeSnapshot: 800,
        audienceTypeSnapshot: AudienceType.X_FOLLOWERS,
        views,
        replyCount: replies,
        ...extra,
      },
    });
    return story;
  }

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
        "SignalRecord", "FeedbackReport", "Send", "ContentPiece", "Story",
        "Audience", "VoiceProfile", "AiRequest", "User"
      RESTART IDENTITY CASCADE;
    `);
    userId = (await prisma.user.create({ data: { email: "stats@misuq.test", passwordHash: "x" } })).id;
    const otherId = (await prisma.user.create({ data: { email: "stats-other@misuq.test", passwordHash: "x" } })).id;

    await reported(userId, "Passkeys", 1000, 9, { quoteCount: 2, bookmarkCount: 14 });
    await reported(userId, "CSV export", 2000, 4);
    await reported(userId, "Dark mode", 1000, 5);
    await reported(otherId, "Someone else's post", 10, 10);
    await prisma.story.create({ data: { userId, rawCapture: "Just captured", contentType: ContentType.OTHER } });
    await prisma.aiRequest.createMany({
      data: [
        { userId, task: AiTask.DRAFT },
        { userId, task: AiTask.DRAFT },
        { userId, task: AiTask.EXTRACTION },
        { userId: otherId, task: AiTask.DRAFT },
      ],
    });
    service = new StatsService(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("returns only the founder's own numbers, with their stories' labels", async () => {
    const stats = await service.forFounder(userId);
    expect(stats.posts.map((p) => p.label).sort()).toEqual(["CSV export", "Dark mode", "Passkeys"]);
    expect(stats.totals).toMatchObject({ reports: 3, views: 4000, replies: 18, quotes: 2, bookmarks: 14, likes: null });
    expect(stats.pipeline).toMatchObject({ CAPTURED: 1, REPORTED: 3 });
    expect(stats.yourUsual).toEqual({ repliesPer1kViews: 5, basedOn: 3, enoughData: true });
    expect(stats.best?.label).toBe("Passkeys");
    expect(stats.byRoom).toEqual([{ key: "FOLLOWERS", posts: 3, rated: 3, repliesPer1kViews: 5, enoughData: true }]);
  });

  it("counts today's AI use for this founder only", async () => {
    const stats = await service.forFounder(userId);
    expect(stats.aiUsage.drafts.used).toBe(2);
    expect(stats.aiUsage.reportBacks.used).toBe(1);
    expect(stats.aiUsage.drafts.limit).toBeGreaterThan(0);
  });
});
