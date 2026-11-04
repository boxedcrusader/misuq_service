import { AudienceType, Channel, ContentType, Niche, Tone } from "@prisma/client";
import { CaptureService } from "../src/modules/capture/capture.service";
import { DraftingProvider } from "../src/modules/capture/drafting/drafting.provider";
import { ExtractedSignal, ExtractionProvider } from "../src/modules/report-back/extraction/extraction.provider";
import { ReportBackService } from "../src/modules/report-back/report-back.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { SendService } from "../src/modules/send/send.service";

// END-TO-END PROOF, not a feature (README §3/§5): everything in
// capture/send/report-back's own spec files exercises ONE module against a
// real DB with the OTHER modules mocked away. This file is the first place
// the SEAMS between them run for real — captureStory -> draftStory ->
// stagePiece -> reportBack, through the real service classes, then the real
// moat aggregation query against rows the chain itself produced. No new
// product code: the only "test-only" additions below are two provider
// implementations (drafting/extraction) that stand in for
// StubDraftingProvider/StubExtractionProvider so this test can drive VARIED
// tone/views/replyCount through the real pipeline instead of the stubs'
// fixed outputs — production stub files are untouched.

// Deliberately throws on an unconfigured key rather than falling back to a
// default: silently defaulting here would be the exact "synthesize a value"
// antipattern the CLAUDE.md poolable-dimension rule exists to prevent, just
// one layer up (in test scaffolding instead of production code).
class TestDraftingProvider implements DraftingProvider {
  constructor(private readonly toneByRawCapture: Map<string, Tone>) {}

  async generateDraft(input: { rawCapture: string; title?: string; channel: Channel }) {
    const tone = this.toneByRawCapture.get(input.rawCapture);
    if (!tone) {
      throw new Error(`TestDraftingProvider: no tone configured for rawCapture ${JSON.stringify(input.rawCapture)}`);
    }
    return { body: `[E2E DRAFT — ${input.channel}]\n\n${input.rawCapture}`, tone };
  }
}

class TestExtractionProvider implements ExtractionProvider {
  constructor(private readonly signalByRawFeedback: Map<string, ExtractedSignal>) {}

  async extract(input: { rawFeedback: string; channel: Channel }): Promise<ExtractedSignal> {
    const signal = this.signalByRawFeedback.get(input.rawFeedback);
    if (!signal) {
      throw new Error(
        `TestExtractionProvider: no signal configured for rawFeedback ${JSON.stringify(input.rawFeedback)}`,
      );
    }
    return signal;
  }
}

function extracted(partial: Partial<ExtractedSignal>): ExtractedSignal {
  return {
    views: null,
    replyCount: null,
    signupCount: null,
    likeCount: null,
    repostCount: null,
    quoteCount: null,
    bookmarkCount: null,
    shareCount: null,
    newFollowerCount: null,
    sentiment: null,
    hasMedia: null,
    hasExternalLink: null,
    postFormat: null,
    followerCountSnapshot: null,
    isPremiumAccount: null,
    postedAt: null,
    ...partial,
  };
}

interface SeedStorySpec {
  label: string;
  contentType: ContentType;
  tone: Tone;
  views: number | null;
  replyCount: number;
  signupCount: number | null;
}

// 4 distinct (contentType, tone) cells x 2 stories each = 8, for the
// CONSENTING user. n=2 per cell is enough to prove SUM/SUM-across-rows (not
// an average of per-row ratios) without needing the production HAVING
// COUNT(*) >= 20 noise-floor, which this proof deliberately does not apply
// (see the moat query below — stated explicitly, not silently dropped).
const CONSENTING_SEED: SeedStorySpec[] = [
  { label: "feat-vuln-1", contentType: ContentType.FEATURE_ANNOUNCEMENT, tone: Tone.VULNERABLE, views: 200, replyCount: 20, signupCount: null },
  { label: "feat-vuln-2", contentType: ContentType.FEATURE_ANNOUNCEMENT, tone: Tone.VULNERABLE, views: 300, replyCount: 15, signupCount: 0 },
  { label: "feat-conf-1", contentType: ContentType.FEATURE_ANNOUNCEMENT, tone: Tone.CONFIDENT, views: 400, replyCount: 8, signupCount: 3 },
  { label: "feat-conf-2", contentType: ContentType.FEATURE_ANNOUNCEMENT, tone: Tone.CONFIDENT, views: 600, replyCount: 12, signupCount: 5 },
  { label: "lesson-vuln-1", contentType: ContentType.LESSON_LEARNED, tone: Tone.VULNERABLE, views: 150, replyCount: 30, signupCount: 1 },
  { label: "lesson-vuln-2", contentType: ContentType.LESSON_LEARNED, tone: Tone.VULNERABLE, views: 250, replyCount: 25, signupCount: 2 },
  { label: "lesson-edu-1", contentType: ContentType.LESSON_LEARNED, tone: Tone.EDUCATIONAL, views: 500, replyCount: 5, signupCount: 0 },
  { label: "lesson-edu-2", contentType: ContentType.LESSON_LEARNED, tone: Tone.EDUCATIONAL, views: 700, replyCount: 14, signupCount: 4 },
];

// Same cell as feat-vuln-1/2 (FEATURE_ANNOUNCEMENT, VULNERABLE), with
// views/replyCount large enough that if the read-side consent filter ever
// silently dropped, this row would visibly skew that cell's rate.
const OPTED_OUT_SEED: SeedStorySpec = {
  label: "opted-out-feat-vuln",
  contentType: ContentType.FEATURE_ANNOUNCEMENT,
  tone: Tone.VULNERABLE,
  views: 1000,
  replyCount: 100,
  signupCount: null,
};

// Consenting-user-only expected aggregate, hand-computed from CONSENTING_SEED
// above — the real test is whether the query reproduces these exactly.
const EXPECTED_GROUPS = [
  { contentType: ContentType.FEATURE_ANNOUNCEMENT, tone: Tone.VULNERABLE, n: 2, views: 500, replies: 35 },
  { contentType: ContentType.FEATURE_ANNOUNCEMENT, tone: Tone.CONFIDENT, n: 2, views: 1000, replies: 20 },
  { contentType: ContentType.LESSON_LEARNED, tone: Tone.VULNERABLE, n: 2, views: 400, replies: 55 },
  { contentType: ContentType.LESSON_LEARNED, tone: Tone.EDUCATIONAL, n: 2, views: 1200, replies: 19 },
].map((g) => ({ ...g, rate: g.replies / g.views }));

describe("Moat E2E: full capture->draft->stage->report chain feeds the real aggregation query", () => {
  let prisma: PrismaService;
  let captureService: CaptureService;
  let sendService: SendService;
  let reportBackService: ReportBackService;

  // Populated in beforeAll by runFullChain; read by the it()s below.
  const signalRecordsByLabel = new Map<string, { id: string }>();
  let consentingUserId: string;
  let optedOutUserId: string;
  let consentingAudienceSize: number;
  let firstStoryRefs: { storyId: string; contentPieceId: string; sendId: string } | undefined;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();

    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
        "SignalRecord", "FeedbackReport", "Send", "ContentPiece", "Story",
        "Audience", "VoiceProfile", "User"
      RESTART IDENTITY CASCADE;
    `);

    const allSeeds = [...CONSENTING_SEED, OPTED_OUT_SEED];

    const toneMap = new Map(allSeeds.map((s) => [s.label, s.tone]));
    const signalMap = new Map(
      allSeeds.map((s) => [
        s.label,
        extracted({ views: s.views, replyCount: s.replyCount, signupCount: s.signupCount }),
      ]),
    );

    // Real service instances, constructed directly (same pattern as every
    // other *.service.spec.ts in this repo) — no NestJS module bootstrap,
    // but zero mocking of the inter-module calls themselves: captureStory's
    // Story row is read for real by draftStory, draftStory's ContentPiece is
    // read for real by stagePiece, stagePiece's Send is read for real by
    // reportBack.
    captureService = new CaptureService(prisma, new TestDraftingProvider(toneMap));
    sendService = new SendService(prisma);
    reportBackService = new ReportBackService(prisma, new TestExtractionProvider(signalMap));

    const consentingUser = await prisma.user.create({
      data: {
        email: "moat-e2e-consenting@misuq.test",
        passwordHash: "not-a-real-hash",
        niche: Niche.DEV_TOOLS,
        aggregateLearningConsent: true,
      },
    });
    consentingUserId = consentingUser.id;
    consentingAudienceSize = 5000;
    const consentingAudience = await prisma.audience.create({
      data: { userId: consentingUserId, name: "Beta list", type: AudienceType.EMAIL_LIST, size: consentingAudienceSize },
    });

    const optedOutUser = await prisma.user.create({
      data: {
        email: "moat-e2e-opted-out@misuq.test",
        passwordHash: "not-a-real-hash",
        niche: Niche.DEV_TOOLS,
        aggregateLearningConsent: false,
      },
    });
    optedOutUserId = optedOutUser.id;
    const optedOutAudience = await prisma.audience.create({
      data: { userId: optedOutUserId, name: "Peers", type: AudienceType.PEERS, size: 40 },
    });

    async function runFullChain(seed: SeedStorySpec, userId: string, audienceId: string) {
      const story = await captureService.captureStory({ rawCapture: seed.label, contentType: seed.contentType }, userId);
      const contentPiece = await captureService.draftStory(story.id, userId);
      const send = await sendService.stagePiece({ contentPieceId: contentPiece.id, audienceId }, userId);
      const report = await reportBackService.reportBack({ sendId: send.id, rawFeedback: seed.label }, userId);
      return { story, contentPiece, send, report };
    }

    for (const seed of CONSENTING_SEED) {
      const result = await runFullChain(seed, consentingUserId, consentingAudience.id);
      signalRecordsByLabel.set(seed.label, { id: result.report.signalRecord!.id });
      if (!firstStoryRefs) {
        firstStoryRefs = { storyId: result.story.id, contentPieceId: result.contentPiece.id, sendId: result.send.id };
      }
    }

    const optedOutResult = await runFullChain(OPTED_OUT_SEED, optedOutUserId, optedOutAudience.id);
    signalRecordsByLabel.set(OPTED_OUT_SEED.label, { id: optedOutResult.report.signalRecord!.id });
  }, 240_000); // 4 min: the dev DB is a remote Neon branch (~300 ms/query, 2026-11-04). 9 stories x real capture->draft->stage->report chain is 36+ sequential DB
  // round trips; comfortably under 10s alone but was already borderline against
  // Jest's 5000ms default hook timeout in a full `jest` run (later in the run
  // order = system less warm), independent of this task's changes.

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("drove all 9 stories through CAPTURED -> DRAFTED -> STAGED -> REPORTED via the real services", async () => {
    const reportedStories = await prisma.story.count({ where: { status: "REPORTED" } });
    expect(reportedStories).toBe(CONSENTING_SEED.length + 1);

    const signalCount = await prisma.signalRecord.count();
    expect(signalCount).toBe(CONSENTING_SEED.length + 1);
  });

  it("channel produced by the real chain is EMAIL (draftStory hardcodes Channel.EMAIL — not X)", async () => {
    const channels = await prisma.contentPiece.findMany({ select: { channel: true }, distinct: ["channel"] });
    expect(channels).toHaveLength(1);
    expect(channels[0].channel).toBe(Channel.EMAIL);
  });

  it("NULL-vs-ZERO survives the full chain: unreported signupCount is NULL, reported zero is 0", async () => {
    const nullRow = signalRecordsByLabel.get("feat-vuln-1")!;
    const zeroRow = signalRecordsByLabel.get("feat-vuln-2")!;

    const rows = await prisma.$queryRawUnsafe<{ id: string; signupCount: number | null }[]>(
      `SELECT id, "signupCount" FROM "SignalRecord" WHERE id IN ($1, $2)`,
      nullRow.id,
      zeroRow.id,
    );
    const byId = new Map(rows.map((r) => [r.id, r.signupCount]));
    expect(byId.get(nullRow.id)).toBeNull();
    expect(byId.get(zeroRow.id)).toBe(0);
  });

  it("CONSENT-INDEPENDENCE: the opted-out user's SignalRecord exists in the raw table", async () => {
    const row = signalRecordsByLabel.get(OPTED_OUT_SEED.label)!;
    const signal = await prisma.signalRecord.findUnique({ where: { id: row.id } });
    expect(signal).not.toBeNull();
    expect(signal!.userId).toBe(optedOutUserId);
  });

  it("snapshot integrity: SignalRecord fields match what Story/ContentPiece/Send actually held at report time", async () => {
    const refs = firstStoryRefs!;
    const [story, contentPiece, send] = await Promise.all([
      prisma.story.findUniqueOrThrow({ where: { id: refs.storyId } }),
      prisma.contentPiece.findUniqueOrThrow({ where: { id: refs.contentPieceId } }),
      prisma.send.findUniqueOrThrow({ where: { id: refs.sendId } }),
    ]);
    const signalRow = signalRecordsByLabel.get("feat-vuln-1")!;
    const signal = await prisma.signalRecord.findUniqueOrThrow({ where: { id: signalRow.id } });

    expect(signal.contentType).toBe(story.contentType);
    expect(signal.tone).toBe(contentPiece.tone);
    expect(signal.channel).toBe(contentPiece.channel);
    expect(signal.audienceSizeSnapshot).toBe(send.audienceSizeSnapshot);
    expect(signal.audienceSizeSnapshot).toBe(consentingAudienceSize);
    expect(signal.niche).toBe(Niche.DEV_TOOLS);
  });

  it("no stored rate/ratio column exists on SignalRecord — resonance_rate must be derived, never stored (§5 rule 1)", async () => {
    const columns = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'SignalRecord'`,
    );
    const suspicious = columns.map((c) => c.column_name).filter((name) => /rate|ratio/i.test(name));
    expect(suspicious).toEqual([]);
  });

  it("the real moat aggregation query, run against system-produced rows, groups correctly and excludes the opted-out user", async () => {
    // Rewrite of prisma/scripts/moat-aggregation-proof.js's validated query,
    // adjusted to what the real chain actually produces:
    //   - channel = 'EMAIL', not 'X' (draftStory hardcodes EMAIL; see the
    //     dedicated channel test above — this is a real current scope limit
    //     of the Capture module, not a query bug).
    //   - HAVING COUNT(*) >= 20 deliberately OMITTED: this proof seeds 2
    //     rows/cell (enough to prove SUM-across-rows, see the resonance_rate
    //     assertion below), not the production noise-floor of 20. Stated
    //     here explicitly rather than silently dropped.
    const rows = await prisma.$queryRawUnsafe<
      { content_type: ContentType; tone: Tone; n: number; resonance_rate: number }[]
    >(`
      SELECT
        sr."contentType"                                      AS content_type,
        sr.tone                                                AS tone,
        COUNT(*)::int                                          AS n,
        SUM(sr."replyCount")::float / NULLIF(SUM(sr.views), 0) AS resonance_rate
      FROM "SignalRecord" sr
      JOIN "User" u ON u.id = sr."userId"
      WHERE sr.niche = 'DEV_TOOLS'
        AND sr.channel = 'EMAIL'
        AND u."aggregateLearningConsent" = true
        AND sr.views IS NOT NULL
        AND sr."replyCount" IS NOT NULL
      GROUP BY sr."contentType", sr.tone
      ORDER BY resonance_rate DESC;
    `);

    // Exactly the 4 seeded cells for the CONSENTING user — the opted-out
    // user's 5th row (same FEATURE_ANNOUNCEMENT/VULNERABLE cell) must not
    // add a group or change an existing one's n/rate.
    expect(rows).toHaveLength(EXPECTED_GROUPS.length);

    for (const expected of EXPECTED_GROUPS) {
      const actual = rows.find((r) => r.content_type === expected.contentType && r.tone === expected.tone);
      expect(actual).toBeDefined();
      expect(actual!.n).toBe(expected.n);
      // Exact equality, not toBeCloseTo: every seeded value is an integer
      // and floating-point division of small integers here round-trips
      // exactly for these particular numerators/denominators.
      expect(actual!.resonance_rate).toBe(expected.rate);
    }

    // The FEATURE_ANNOUNCEMENT/VULNERABLE group specifically must reflect
    // ONLY the two consenting rows (n=2, rate=35/500=0.07) — if the
    // aggregate READ-side consent filter (u."aggregateLearningConsent" =
    // true) were broken, the opted-out row (views=1000, replyCount=100)
    // would push n to 3 and the rate far below 0.07.
    const pollutedCell = rows.find(
      (r) => r.content_type === ContentType.FEATURE_ANNOUNCEMENT && r.tone === Tone.VULNERABLE,
    )!;
    expect(pollutedCell.n).toBe(2);
    expect(pollutedCell.resonance_rate).toBeCloseTo(0.07, 10);
  });
});
