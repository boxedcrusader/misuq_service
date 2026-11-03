import { NotFoundException } from "@nestjs/common";
import { AudienceType } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { AudiencesService } from "./audiences.service";

// Real PrismaService against the disposable test database, zero HTTP layer
// -- same convention as every other *.service.spec.ts here.
describe("AudiencesService", () => {
  let prisma: PrismaService;
  let service: AudiencesService;
  let ownerId: string;
  let otherId: string;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    service = new AudiencesService(prisma);
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
        "SignalRecord", "FeedbackReport", "Send", "ContentPiece", "Story",
        "Audience", "VoiceProfile", "User"
      RESTART IDENTITY CASCADE;
    `);
    ownerId = (await prisma.user.create({ data: { email: "aud-owner@misuq.test", passwordHash: "x" } })).id;
    otherId = (await prisma.user.create({ data: { email: "aud-other@misuq.test", passwordHash: "x" } })).id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates an audience owned by the founder", async () => {
    const audience = await service.create(ownerId, { name: "Founder friends", type: AudienceType.PEERS, size: 3 });
    expect(audience).toMatchObject({ userId: ownerId, name: "Founder friends", type: AudienceType.PEERS, size: 3 });
  });

  it("lists only the founder's own audiences, oldest first", async () => {
    await service.create(ownerId, { name: "Beta list", type: AudienceType.EMAIL_LIST, size: 42 });
    await service.create(ownerId, { name: "Discord", type: AudienceType.DISCORD, size: 18 });
    await service.create(otherId, { name: "Not yours", type: AudienceType.PEERS, size: 5 });

    const page = await service.findAll(ownerId, {});
    expect(page.data.map((a) => a.name)).toEqual(["Beta list", "Discord"]);
    expect(page.meta.total).toBe(2);
  });

  it("returns an empty list for a draft-only founder", async () => {
    const page = await service.findAll(ownerId, {});
    expect(page.data).toEqual([]);
    expect(page.meta.total).toBe(0);
  });

  it("updates size (lists grow) without touching past sends' frozen snapshots", async () => {
    const audience = await service.create(ownerId, { name: "Beta list", type: AudienceType.EMAIL_LIST, size: 42 });
    const story = await prisma.story.create({ data: { userId: ownerId, rawCapture: "x", contentType: "OTHER", status: "STAGED" } });
    const piece = await prisma.contentPiece.create({
      data: { storyId: story.id, channel: "EMAIL", stage: "PREVIEW", tone: "CASUAL", body: "x", generatedBody: "x" },
    });
    const send = await prisma.send.create({
      data: { contentPieceId: piece.id, audienceId: audience.id, audienceSizeSnapshot: 42 },
    });

    const updated = await service.update(audience.id, ownerId, { size: 60 });
    expect(updated.size).toBe(60);
    expect((await prisma.send.findUniqueOrThrow({ where: { id: send.id } })).audienceSizeSnapshot).toBe(42);
  });

  it("404s on another founder's audience, for read and update", async () => {
    const theirs = await service.create(otherId, { name: "Not yours", type: AudienceType.PEERS, size: 5 });
    await expect(service.findOne(theirs.id, ownerId)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.update(theirs.id, ownerId, { size: 1 })).rejects.toBeInstanceOf(NotFoundException);
    expect((await prisma.audience.findUniqueOrThrow({ where: { id: theirs.id } })).size).toBe(5);
  });
});
