import { PrismaService } from "../../prisma/prisma.service";
import { VoiceService } from "./voice.service";

// Plumbing proof for the onboarding write path this task adds: nothing
// previously wrote VoiceProfile.styleSample, so the drafting voice-branch
// (gemini-drafting.provider.ts) had no real data to read. Real PrismaService
// against a disposable test database, zero HTTP layer -- matches
// capture/send/report-back's spec conventions.
describe("VoiceService: set/get styleSample (VoiceProfile upsert)", () => {
  let prisma: PrismaService;
  let service: VoiceService;
  let userId: string;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    service = new VoiceService(prisma);
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
        "SignalRecord", "FeedbackReport", "Send", "ContentPiece", "Story",
        "Audience", "VoiceProfile", "User"
      RESTART IDENTITY CASCADE;
    `);

    const user = await prisma.user.create({
      data: { email: "voice-test@misuq.test", passwordHash: "not-a-real-hash" },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("returns null styleSample for a founder who never submitted one (skippable onboarding)", async () => {
    const result = await service.getVoiceSample(userId);
    expect(result?.styleSample ?? null).toBeNull();
  });

  it("creates a VoiceProfile row on first submission", async () => {
    const sample = "a".repeat(50);
    await service.setVoiceSample(userId, { styleSample: sample });

    const stored = await prisma.voiceProfile.findUnique({ where: { userId } });
    expect(stored?.styleSample).toBe(sample);

    const read = await service.getVoiceSample(userId);
    expect(read?.styleSample).toBe(sample);
  });

  it("updates the SAME row on resubmission -- no duplicate, no error", async () => {
    await service.setVoiceSample(userId, { styleSample: "a".repeat(50) });
    const secondSample = "b".repeat(80);
    await service.setVoiceSample(userId, { styleSample: secondSample });

    const rows = await prisma.voiceProfile.findMany({ where: { userId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].styleSample).toBe(secondSample);
  });

  it("stores the sample verbatim -- no parsing, splitting, or trimming of internal content", async () => {
    const raw = "First post.\n\nSecond post, different mood!\n\nThird one -- lowercase, rambly, whatever.";
    await service.setVoiceSample(userId, { styleSample: raw });

    const stored = await prisma.voiceProfile.findUnique({ where: { userId } });
    expect(stored?.styleSample).toBe(raw);
  });

  it("scopes reads/writes to the owning founder", async () => {
    const other = await prisma.user.create({
      data: { email: "voice-other@misuq.test", passwordHash: "not-a-real-hash" },
    });

    await service.setVoiceSample(userId, { styleSample: "a".repeat(50) });

    const otherRead = await service.getVoiceSample(other.id);
    expect(otherRead?.styleSample ?? null).toBeNull();
  });
});
