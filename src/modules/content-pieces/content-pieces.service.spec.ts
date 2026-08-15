import { ConflictException, NotFoundException } from "@nestjs/common";
import { Channel, ContentPieceStatus, ContentType, Stage, StoryStatus, Tone } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { ContentPiecesService } from "./content-pieces.service";

// Plumbing proof for the edit-capture slice (README task brief: "the diff
// between the draft Misuq generated and the version the founder actually
// ships"). Real PrismaService against a disposable test database, zero HTTP
// layer -- same convention as send.service.spec.ts / graduate.service.spec.ts.
describe("ContentPiecesService: updateBody (edit a DRAFTED/EDITED piece) and its guards", () => {
  let prisma: PrismaService;
  let service: ContentPiecesService;
  let userId: string;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    service = new ContentPiecesService(prisma);
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
        "SignalRecord", "FeedbackReport", "Send", "ContentPiece", "Story",
        "Audience", "VoiceProfile", "User"
      RESTART IDENTITY CASCADE;
    `);

    const user = await prisma.user.create({
      data: { email: "content-pieces-test@misuq.test", passwordHash: "not-a-real-hash" },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function createPiece(status: ContentPieceStatus, ownerId = userId, generatedBody = "generated draft text") {
    const story = await prisma.story.create({
      data: { userId: ownerId, rawCapture: "Shipped a thing.", contentType: ContentType.OTHER, status: StoryStatus.DRAFTED },
    });
    return prisma.contentPiece.create({
      data: {
        storyId: story.id,
        channel: Channel.EMAIL,
        stage: Stage.PREVIEW,
        tone: Tone.OTHER,
        body: generatedBody,
        generatedBody,
        status,
      },
    });
  }

  it("edits a DRAFTED piece: body updates, generatedBody stays untouched, status flips to EDITED", async () => {
    const piece = await createPiece(ContentPieceStatus.DRAFTED);

    const updated = await service.updateBody(piece.id, { body: "founder's edited version" }, userId);

    expect(updated.body).toBe("founder's edited version");
    expect(updated.generatedBody).toBe("generated draft text");
    expect(updated.status).toBe(ContentPieceStatus.EDITED);

    const reloaded = await prisma.contentPiece.findUniqueOrThrow({ where: { id: piece.id } });
    expect(reloaded.body).toBe("founder's edited version");
    expect(reloaded.generatedBody).toBe("generated draft text");
    expect(reloaded.status).toBe(ContentPieceStatus.EDITED);
  });

  it("allows editing an already-EDITED piece again (second edit before send)", async () => {
    const piece = await createPiece(ContentPieceStatus.EDITED);

    const updated = await service.updateBody(piece.id, { body: "second pass" }, userId);

    expect(updated.body).toBe("second pass");
    expect(updated.status).toBe(ContentPieceStatus.EDITED);
  });

  it("rejects editing a SENT piece: throws ConflictException, body and status unchanged", async () => {
    const piece = await createPiece(ContentPieceStatus.SENT);

    await expect(service.updateBody(piece.id, { body: "too late" }, userId)).rejects.toBeInstanceOf(
      ConflictException,
    );

    const reloaded = await prisma.contentPiece.findUniqueOrThrow({ where: { id: piece.id } });
    expect(reloaded.body).toBe("generated draft text");
    expect(reloaded.status).toBe(ContentPieceStatus.SENT);
  });

  it("scopes edits to the owning user: another user's piece 404s", async () => {
    const owner = await prisma.user.create({
      data: { email: "content-pieces-owner@misuq.test", passwordHash: "not-a-real-hash" },
    });
    const intruder = await prisma.user.create({
      data: { email: "content-pieces-intruder@misuq.test", passwordHash: "not-a-real-hash" },
    });
    const piece = await createPiece(ContentPieceStatus.DRAFTED, owner.id);

    await expect(service.updateBody(piece.id, { body: "intrusion" }, intruder.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );

    const reloaded = await prisma.contentPiece.findUniqueOrThrow({ where: { id: piece.id } });
    expect(reloaded.body).toBe("generated draft text");
  });

  it("404s on a nonexistent ContentPiece id", async () => {
    await expect(service.updateBody("does-not-exist", { body: "x" }, userId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
