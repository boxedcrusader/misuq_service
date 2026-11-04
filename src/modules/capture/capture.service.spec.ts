import { NotFoundException } from "@nestjs/common";
import { Channel, Tone } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { CaptureService } from "./capture.service";
import { DraftGenerationFailedException } from "./drafting/draft-generation-failed.exception";
import { DraftingProvider, GenerateDraftInput } from "./drafting/drafting.provider";
import { StubDraftingProvider } from "./drafting/stub-drafting.provider";

// Stands in for GeminiDraftingProvider's real failure path (a rejected API
// call, timeout, or malformed response all surface as this same exception —
// see gemini-drafting.provider.ts). Real network/API mocking for THAT
// mapping lives in gemini-drafting.provider.spec.ts; this fake only needs
// to reject the same way, so draftStory's transaction-ordering guarantee
// can be proven against a real Prisma database without any HTTP layer.
class FailingDraftingProvider implements DraftingProvider {
  async generateDraft(_input: { rawCapture: string; title?: string; channel: Channel }): Promise<{ body: string; tone: Tone }> {
    throw new DraftGenerationFailedException();
  }
}

// Plumbing proof for the Capture module's front two loop steps (README §2:
// Capture -> Draft). Talks directly to CaptureService with a real
// PrismaService against a disposable test database and the deterministic
// StubDraftingProvider -- zero LLM calls, zero HTTP layer, just proving the
// STORED Story.status column flips CAPTURED -> DRAFTED and that a
// ContentPiece lands with the stub body. All status assertions below read
// the column straight off the row returned by Prisma -- there is no
// derivation logic left to accidentally be testing instead.
describe("CaptureService: capture -> draft happy path", () => {
  let prisma: PrismaService;
  let service: CaptureService;
  let userId: string;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();

    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
        "SignalRecord", "FeedbackReport", "Send", "ContentPiece", "Story",
        "Audience", "VoiceProfile", "User"
      RESTART IDENTITY CASCADE;
    `);

    const user = await prisma.user.create({
      data: { email: "capture-test@misuq.test", passwordHash: "not-a-real-hash" },
    });
    userId = user.id;

    service = new CaptureService(prisma, new StubDraftingProvider());
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("captures a story as CAPTURED, then drafts it to DRAFTED with a stub ContentPiece", async () => {
    const captured = await service.captureStory({ rawCapture: "Shipped dark mode today." }, userId);
    expect(captured.status).toBe("CAPTURED");
    expect(captured.contentType).toBe("OTHER");

    const beforeDraft = await service.findOne(captured.id, userId);
    expect(beforeDraft.status).toBe("CAPTURED");
    expect(beforeDraft.contentPieces).toHaveLength(0);

    const contentPiece = await service.draftStory(captured.id, userId);
    expect(contentPiece.channel).toBe("EMAIL");
    expect(contentPiece.stage).toBe("PREVIEW");
    expect(contentPiece.tone).toBe("OTHER");
    expect(contentPiece.status).toBe("DRAFTED");
    expect(contentPiece.body).toBe(
      "[STUB DRAFT — EMAIL]\n\nShipped dark mode today.\n\nShipped dark mode today.",
    );

    const afterDraft = await service.findOne(captured.id, userId);
    expect(afterDraft.status).toBe("DRAFTED");
    expect(afterDraft.contentPieces).toHaveLength(1);
  });

  it("keeps status DRAFTED (does not regress) on a re-draft of an already-drafted story", async () => {
    const captured = await service.captureStory({ rawCapture: "Second launch update." }, userId);
    await service.draftStory(captured.id, userId);

    const secondContentPiece = await service.draftStory(captured.id, userId);
    expect(secondContentPiece.status).toBe("DRAFTED");

    const afterRedraft = await service.findOne(captured.id, userId);
    expect(afterRedraft.status).toBe("DRAFTED");
    expect(afterRedraft.contentPieces).toHaveLength(2);
  });

  it("scopes stories to the owning user and 404s otherwise", async () => {
    const owner = await prisma.user.create({
      data: { email: "owner@misuq.test", passwordHash: "not-a-real-hash" },
    });
    const intruder = await prisma.user.create({
      data: { email: "intruder@misuq.test", passwordHash: "not-a-real-hash" },
    });

    const story = await service.captureStory({ rawCapture: "Only the owner should see this." }, owner.id);

    await expect(service.findOne(story.id, intruder.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.draftStory(story.id, intruder.id)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("passes the founder's name to the drafting provider for the sign-off (null when unset)", async () => {
    const seen: GenerateDraftInput[] = [];
    const recording: DraftingProvider = {
      generateDraft: async (input) => {
        seen.push(input);
        return { body: "draft", tone: Tone.CASUAL };
      },
    };
    const named = await prisma.user.create({
      data: { email: "named-founder@misuq.test", passwordHash: "not-a-real-hash", name: "Ada" },
    });
    const recordingService = new CaptureService(prisma, recording);

    const namedStory = await recordingService.captureStory({ rawCapture: "Shipped it." }, named.id);
    await recordingService.draftStory(namedStory.id, named.id);
    const unnamedStory = await recordingService.captureStory({ rawCapture: "Shipped it." }, userId);
    await recordingService.draftStory(unnamedStory.id, userId);

    expect(seen.map((i) => i.founderName)).toEqual(["Ada", null]);
  });

  it("refuses a draft past the per-account daily cap with a 429, before calling the provider", async () => {
    const previous = process.env.DAILY_DRAFT_LIMIT;
    process.env.DAILY_DRAFT_LIMIT = "1";
    try {
      const capped = await prisma.user.create({ data: { email: "capped-drafts@misuq.test", passwordHash: "x" } });
      let calls = 0;
      const counting: DraftingProvider = {
        generateDraft: async () => {
          calls++;
          return { body: "draft", tone: Tone.CASUAL };
        },
      };
      const cappedService = new CaptureService(prisma, counting);
      const story = await cappedService.captureStory({ rawCapture: "Shipped it." }, capped.id);
      await cappedService.draftStory(story.id, capped.id);

      await expect(cappedService.draftStory(story.id, capped.id)).rejects.toMatchObject({ status: 429 });
      expect(calls).toBe(1);
    } finally {
      if (previous === undefined) delete process.env.DAILY_DRAFT_LIMIT;
      else process.env.DAILY_DRAFT_LIMIT = previous;
    }
  });

  it("drafts in the chosen format, and a later format never moves the story backwards", async () => {
    const story = await service.captureStory({ rawCapture: "Shipped CSV export." }, userId);
    const xPiece = await service.draftStory(story.id, userId, Channel.X);
    expect(xPiece).toMatchObject({ channel: Channel.X, stage: "PREVIEW" });

    await prisma.story.update({ where: { id: story.id }, data: { status: "STAGED" } });
    await service.draftStory(story.id, userId, Channel.LINKEDIN);
    expect((await service.findOne(story.id, userId)).status).toBe("STAGED");

    await prisma.story.update({ where: { id: story.id }, data: { status: "GRADUATED", graduatedAt: new Date() } });
    const widePiece = await service.draftStory(story.id, userId, Channel.LINKEDIN);
    expect(widePiece).toMatchObject({ channel: Channel.LINKEDIN, stage: "WIDE" });
    expect((await service.findOne(story.id, userId)).status).toBe("GRADUATED");
  });

  it("refuses to draft an archived story (409), before any AI call", async () => {
    const story = await service.captureStory({ rawCapture: "Old news." }, userId);
    await prisma.story.update({ where: { id: story.id }, data: { status: "ARCHIVED" } });
    await expect(service.draftStory(story.id, userId)).rejects.toMatchObject({ status: 409 });
  });

  it("writes NOTHING when draft generation fails -- no ContentPiece, status stays CAPTURED", async () => {
    // Proves the generate-before-transact ordering in draftStory (the
    // generation call happens BEFORE the $transaction opens): a failure
    // must leave the Story exactly as it was, never a stale status flip or
    // a half-written ContentPiece. Uses a real Prisma database (like every
    // other test in this file) with only the drafting provider swapped for
    // one that always rejects -- this is the transaction-integrity
    // guarantee that protects the DB regardless of WHY generation failed.
    const failingService = new CaptureService(prisma, new FailingDraftingProvider());
    const captured = await failingService.captureStory({ rawCapture: "Will fail to draft." }, userId);

    await expect(failingService.draftStory(captured.id, userId)).rejects.toBeInstanceOf(
      DraftGenerationFailedException,
    );

    const afterFailedDraft = await failingService.findOne(captured.id, userId);
    expect(afterFailedDraft.status).toBe("CAPTURED");
    expect(afterFailedDraft.contentPieces).toHaveLength(0);
  });
});
