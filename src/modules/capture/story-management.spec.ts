import { ConflictException, NotFoundException } from "@nestjs/common";
import { AudienceType, Channel } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { ContentPiecesService } from "../content-pieces/content-pieces.service";
import { SendService } from "../send/send.service";
import { CaptureService } from "./capture.service";
import { StubDraftingProvider } from "./drafting/stub-drafting.provider";

// Editing, deleting and archiving (2026-11-04), against a real database. The
// line nothing crosses: once any piece is sent, the story can't be edited or
// deleted, only archived. Before that, deletes are real.
describe("Story management: edit, delete, archive", () => {
  let prisma: PrismaService;
  let capture: CaptureService;
  let pieces: ContentPiecesService;
  let send: SendService;
  let userId: string;
  let otherUserId: string;
  let audienceId: string;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
        "SignalRecord", "FeedbackReport", "Send", "ContentPiece", "Story",
        "Audience", "VoiceProfile", "AiRequest", "User"
      RESTART IDENTITY CASCADE;
    `);
    userId = (await prisma.user.create({ data: { email: "manage@misuq.test", passwordHash: "x" } })).id;
    otherUserId = (await prisma.user.create({ data: { email: "other@misuq.test", passwordHash: "x" } })).id;
    audienceId = (
      await prisma.audience.create({ data: { userId, name: "My X followers", type: AudienceType.X_FOLLOWERS, size: 900 } })
    ).id;
    capture = new CaptureService(prisma, new StubDraftingProvider());
    pieces = new ContentPiecesService(prisma);
    send = new SendService(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function draftedStory(text = "Shipped CSV export.") {
    const story = await capture.captureStory({ rawCapture: text }, userId);
    const piece = await capture.draftStory(story.id, userId, Channel.X);
    return { story, piece };
  }

  async function sentStory() {
    const { story, piece } = await draftedStory("Shipped passkeys.");
    await send.stagePiece({ contentPieceId: piece.id, audienceId }, userId);
    return { story, piece };
  }

  describe("editing the captured update", () => {
    it("edits the words, clears an emptied title, and keeps the drafts", async () => {
      const { story } = await draftedStory();
      const updated = await capture.updateStory(story.id, userId, { rawCapture: "  Shipped CSV + Excel export.  ", title: "  " });
      expect(updated.rawCapture).toBe("Shipped CSV + Excel export.");
      expect(updated.title).toBeNull();
      expect(updated.status).toBe("DRAFTED");
      expect((await capture.findOne(story.id, userId)).contentPieces).toHaveLength(1);
    });

    it("refuses blank words", async () => {
      const { story } = await draftedStory();
      await expect(capture.updateStory(story.id, userId, { rawCapture: "   " })).rejects.toThrow("rawCapture should not be empty");
    });

    it("refuses once something was sent: the room saw it", async () => {
      const { story } = await sentStory();
      await expect(capture.updateStory(story.id, userId, { rawCapture: "rewritten" })).rejects.toBeInstanceOf(ConflictException);
      expect((await prisma.story.findUniqueOrThrow({ where: { id: story.id } })).rawCapture).toBe("Shipped passkeys.");
    });

    it("is 404 for someone else's story", async () => {
      const { story } = await draftedStory();
      await expect(capture.updateStory(story.id, otherUserId, { title: "mine now" })).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("deleting", () => {
    it("deletes an unsent story and its drafts for real", async () => {
      const { story, piece } = await draftedStory();
      await capture.deleteStory(story.id, userId);
      expect(await prisma.story.findUnique({ where: { id: story.id } })).toBeNull();
      expect(await prisma.contentPiece.findUnique({ where: { id: piece.id } })).toBeNull();
    });

    it("gives back no daily drafts: the AI attempt is still counted", async () => {
      const before = await prisma.aiRequest.count({ where: { userId } });
      const { story } = await draftedStory();
      await capture.deleteStory(story.id, userId);
      expect(await prisma.aiRequest.count({ where: { userId } })).toBe(before + 1);
    });

    it("refuses a sent story (archive it instead), and keeps everything", async () => {
      const { story, piece } = await sentStory();
      await expect(capture.deleteStory(story.id, userId)).rejects.toThrow("archive it instead");
      expect(await prisma.contentPiece.findUnique({ where: { id: piece.id } })).not.toBeNull();
    });

    it("is 404 for someone else's story, which survives", async () => {
      const { story } = await draftedStory();
      await expect(capture.deleteStory(story.id, otherUserId)).rejects.toBeInstanceOf(NotFoundException);
      expect(await prisma.story.findUnique({ where: { id: story.id } })).not.toBeNull();
    });

    it("deletes one unsent draft and keeps the others", async () => {
      const { story, piece } = await draftedStory();
      const linkedIn = await capture.draftStory(story.id, userId, Channel.LINKEDIN);
      await pieces.deletePiece(linkedIn.id, userId);
      const after = await capture.findOne(story.id, userId);
      expect(after.contentPieces.map((p) => p.id)).toEqual([piece.id]);
      expect(after.status).toBe("DRAFTED");
    });

    it("deleting the last draft puts the story back to CAPTURED", async () => {
      const { story, piece } = await draftedStory();
      await pieces.deletePiece(piece.id, userId);
      expect((await capture.findOne(story.id, userId)).status).toBe("CAPTURED");
    });

    it("never deletes a sent draft", async () => {
      const { piece } = await sentStory();
      await expect(pieces.deletePiece(piece.id, userId)).rejects.toBeInstanceOf(ConflictException);
      expect(await prisma.contentPiece.findUnique({ where: { id: piece.id } })).not.toBeNull();
    });

    it("is 404 for someone else's draft", async () => {
      const { piece } = await draftedStory();
      await expect(pieces.deletePiece(piece.id, otherUserId)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("archiving", () => {
    it("archives a sent story and restores it exactly where it was", async () => {
      const { story } = await sentStory();
      const archived = await capture.archiveStory(story.id, userId);
      expect(archived.status).toBe("ARCHIVED");
      expect(archived.archivedFromStatus).toBe("STAGED");

      const restored = await capture.unarchiveStory(story.id, userId);
      expect(restored.status).toBe("STAGED");
      expect(restored.archivedFromStatus).toBeNull();
    });

    it("is idempotent both ways", async () => {
      const { story } = await draftedStory();
      await capture.archiveStory(story.id, userId);
      expect((await capture.archiveStory(story.id, userId)).archivedFromStatus).toBe("DRAFTED");
      await capture.unarchiveStory(story.id, userId);
      expect((await capture.unarchiveStory(story.id, userId)).status).toBe("DRAFTED");
    });

    it("makes the story read-only: no drafting, editing, or deleting drafts", async () => {
      const { story, piece } = await draftedStory();
      await capture.archiveStory(story.id, userId);
      await expect(capture.draftStory(story.id, userId, Channel.X)).rejects.toBeInstanceOf(ConflictException);
      await expect(capture.updateStory(story.id, userId, { title: "x" })).rejects.toThrow("restore it to edit");
      await expect(pieces.updateBody(piece.id, { body: "edited" }, userId)).rejects.toBeInstanceOf(ConflictException);
      await expect(pieces.deletePiece(piece.id, userId)).rejects.toBeInstanceOf(ConflictException);
    });

    it("is 404 for someone else's story", async () => {
      const { story } = await draftedStory();
      await expect(capture.archiveStory(story.id, otherUserId)).rejects.toBeInstanceOf(NotFoundException);
      await expect(capture.unarchiveStory(story.id, otherUserId)).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
