import { AiTask, Channel, Niche, Stage, Tone } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { CaptureService } from "../modules/capture/capture.service";
import { DraftGenerationFailedException } from "../modules/capture/drafting/draft-generation-failed.exception";
import { DraftingProvider } from "../modules/capture/drafting/drafting.provider";
import { ReportBackService } from "../modules/report-back/report-back.service";
import { ExtractedSignal, ExtractionProvider } from "../modules/report-back/extraction/extraction.provider";
import { SignalExtractionFailedException } from "../modules/report-back/extraction/signal-extraction-failed.exception";
import { reserveAiRequest } from "./usage-limits";

// The AI spend caps against a real database: these are the 2026-11-04
// pentest findings, each pinned as a test. Every check here would have
// passed the old count-the-successes cap's happy path and failed this.

class CountingFailingDrafter implements DraftingProvider {
  calls = 0;
  async generateDraft(): Promise<{ body: string; tone: Tone }> {
    this.calls++;
    throw new DraftGenerationFailedException();
  }
}

class CountingFailingExtractor implements ExtractionProvider {
  calls = 0;
  async extract(): Promise<ExtractedSignal> {
    this.calls++;
    throw new SignalExtractionFailedException();
  }
}

function withEnv(vars: Record<string, string>, run: () => Promise<void>): () => Promise<void> {
  return async () => {
    const previous = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
    Object.assign(process.env, vars);
    try {
      await run();
    } finally {
      for (const [k, v] of Object.entries(previous)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  };
}

describe("AI spend caps (reserveAiRequest)", () => {
  let prisma: PrismaService;
  let n = 0;
  const newUser = (niche: Niche | null = Niche.DEV_TOOLS) =>
    prisma.user.create({ data: { email: `caps-${Date.now()}-${n++}@misuq.test`, passwordHash: "x", niche } });

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
        "AiRequest", "SignalRecord", "FeedbackReport", "Send", "ContentPiece", "Story",
        "Audience", "VoiceProfile", "User"
      RESTART IDENTITY CASCADE;
    `);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it(
    "counts failed drafts: the call after the cap gets a 429 and never reaches the model",
    withEnv({ DAILY_DRAFT_LIMIT: "2" }, async () => {
      const user = await newUser();
      const drafter = new CountingFailingDrafter();
      const service = new CaptureService(prisma, drafter);
      const story = await service.captureStory({ rawCapture: "Shipped it." }, user.id);

      await expect(service.draftStory(story.id, user.id)).rejects.toBeInstanceOf(DraftGenerationFailedException);
      await expect(service.draftStory(story.id, user.id)).rejects.toBeInstanceOf(DraftGenerationFailedException);
      await expect(service.draftStory(story.id, user.id)).rejects.toMatchObject({ status: 429 });
      expect(drafter.calls).toBe(2);
    }),
  );

  it("doesn't spend the allowance on a request that 404s (another founder's story)", async () => {
    const owner = await newUser();
    const intruder = await newUser();
    const service = new CaptureService(prisma, new CountingFailingDrafter());
    const story = await service.captureStory({ rawCapture: "Mine." }, owner.id);

    await expect(service.draftStory(story.id, intruder.id)).rejects.toMatchObject({ status: 404 });
    expect(await prisma.aiRequest.count()).toBe(0);
  });

  it(
    "holds a global daily cap across accounts",
    withEnv({ GLOBAL_DAILY_AI_LIMIT: "2" }, async () => {
      const [a, b, c] = [await newUser(), await newUser(), await newUser()];
      await reserveAiRequest(prisma, a.id, AiTask.DRAFT);
      await reserveAiRequest(prisma, b.id, AiTask.EXTRACTION);
      await expect(reserveAiRequest(prisma, c.id, AiTask.DRAFT)).rejects.toMatchObject({
        status: 429,
        message: expect.stringContaining("AI capacity for all accounts"),
      });
    }),
  );

  it(
    "doesn't let 10 parallel requests overshoot a cap of 3",
    withEnv({ DAILY_DRAFT_LIMIT: "3" }, async () => {
      const user = await newUser();
      const outcomes = await Promise.allSettled(
        Array.from({ length: 10 }, () => reserveAiRequest(prisma, user.id, AiTask.DRAFT)),
      );
      expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(3);
      expect(outcomes.every((o) => o.status === "fulfilled" || (o.reason as { status?: number }).status === 429)).toBe(true);
      expect(await prisma.aiRequest.count({ where: { userId: user.id } })).toBe(3);
    }),
  );

  it("keeps drafts and extractions on separate allowances", withEnv({ DAILY_DRAFT_LIMIT: "1", DAILY_REPORT_LIMIT: "1" }, async () => {
    const user = await newUser();
    await reserveAiRequest(prisma, user.id, AiTask.DRAFT);
    await expect(reserveAiRequest(prisma, user.id, AiTask.EXTRACTION)).resolves.toBeUndefined();
    await expect(reserveAiRequest(prisma, user.id, AiTask.DRAFT)).rejects.toMatchObject({ status: 429 });
  }));

  it(
    "caps re-extraction: retries of a failing report spend the report allowance",
    withEnv({ DAILY_REPORT_LIMIT: "2" }, async () => {
      const user = await newUser();
      const story = await prisma.story.create({
        data: { userId: user.id, rawCapture: "Shipped it.", contentType: "OTHER", status: "STAGED" },
      });
      const piece = await prisma.contentPiece.create({
        data: { storyId: story.id, channel: Channel.EMAIL, stage: Stage.PREVIEW, tone: Tone.CASUAL, generatedBody: "x", body: "x", status: "SENT" },
      });
      const audience = await prisma.audience.create({ data: { userId: user.id, name: "Peers", type: "PEERS", size: 3 } });
      const send = await prisma.send.create({ data: { contentPieceId: piece.id, audienceId: audience.id, audienceSizeSnapshot: 3 } });

      const extractor = new CountingFailingExtractor();
      const service = new ReportBackService(prisma, extractor);
      const report = await service.reportBack({ sendId: send.id, rawFeedback: "About 20 opened it." }, user.id);
      expect(report.signalRecord).toBeNull();
      const callsAfterReport = extractor.calls;

      await expect(service.retryExtraction(report.id, user.id)).rejects.toMatchObject({ status: 502 });
      await expect(service.retryExtraction(report.id, user.id)).rejects.toMatchObject({ status: 429 });
      // The third request (second retry) never reached the model.
      expect(extractor.calls).toBe(callsAfterReport * 2);
    }),
  );
});
