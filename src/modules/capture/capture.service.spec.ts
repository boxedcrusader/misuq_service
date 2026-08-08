import { NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { CaptureService } from "./capture.service";
import { StubDraftingProvider } from "./drafting/stub-drafting.provider";

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
});
