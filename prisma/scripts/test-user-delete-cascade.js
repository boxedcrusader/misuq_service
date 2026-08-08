// Re-runnable test: does account deletion cleanly remove a User and
// everything hanging off it -- Story -> ContentPiece -> Send ->
// FeedbackReport -> SignalRecord, plus Audience and SignalRecord directly
// off User?
//
// README §7 requires a "clear retention/deletion policy for cancelled
// accounts" -- this script is the check that account deletion actually
// works end-to-end rather than throwing a foreign-key error partway through.
//
// A bare prisma.user.delete() does NOT work here -- see the onDelete
// comments on Audience.sends / FeedbackReport.signalRecords in
// schema.prisma and deleteUserCascade.js for why. Set MODE=naive to prove
// that failure mode still reproduces; default MODE exercises the actual
// fix (deleteUserCascade).
//
// Usage:
//   DATABASE_URL="postgresql://user:pass@host:port/db" node prisma/scripts/test-user-delete-cascade.js
//   DATABASE_URL="..." MODE=naive node prisma/scripts/test-user-delete-cascade.js
//
// Only ever point this at a disposable test database -- it truncates the
// tables it touches before seeding, every run.

const { PrismaClient } = require("@prisma/client");
const { deleteUserCascade } = require("./deleteUserCascade");

const prisma = new PrismaClient();
const MODE = process.env.MODE === "naive" ? "naive" : "cascade-helper";

async function truncateAll() {
  // TRUNCATE ... CASCADE is a Postgres admin operation, independent of the
  // FK onDelete actions under test -- safe to use for idempotent re-seeding
  // even when a previous run left the delete half-finished.
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "SignalRecord",
      "FeedbackReport",
      "Send",
      "ContentPiece",
      "Story",
      "Audience",
      "VoiceProfile",
      "User"
    RESTART IDENTITY CASCADE;
  `);
}

async function seed() {
  const user = await prisma.user.create({
    data: {
      email: "cascade-test@misuq.test",
      passwordHash: "not-a-real-hash",
      aggregateLearningConsent: true,
      niche: "DEV_TOOLS",
    },
  });

  const story = await prisma.story.create({
    data: {
      userId: user.id,
      rawCapture: "Shipped the new onboarding flow today.",
      contentType: "FEATURE_ANNOUNCEMENT",
    },
  });

  const contentPiece = await prisma.contentPiece.create({
    data: {
      storyId: story.id,
      channel: "EMAIL",
      stage: "PREVIEW",
      tone: "CONFIDENT",
      body: "Hey folks, just shipped a new onboarding flow...",
    },
  });

  const audience = await prisma.audience.create({
    data: {
      userId: user.id,
      name: "Beta list",
      type: "EMAIL_LIST",
    },
  });

  const send = await prisma.send.create({
    data: {
      contentPieceId: contentPiece.id,
      audienceId: audience.id,
      audienceSizeSnapshot: 42, // frozen, per §5 rule 4
    },
  });

  const feedbackReport = await prisma.feedbackReport.create({
    data: {
      sendId: send.id,
      rawFeedback: "Got 3 replies, one signup, mostly positive.",
    },
  });

  const signalRecord = await prisma.signalRecord.create({
    data: {
      userId: user.id,
      feedbackReportId: feedbackReport.id,
      niche: "DEV_TOOLS",
      channel: "EMAIL",
      contentType: "FEATURE_ANNOUNCEMENT",
      tone: "CONFIDENT",
      audienceSizeSnapshot: 42,
      replyCount: 3,
      signupCount: 1,
      sentiment: "POSITIVE",
    },
  });

  return { user, story, contentPiece, audience, send, feedbackReport, signalRecord };
}

async function main() {
  await truncateAll();
  const seeded = await seed();
  console.log(`Seeded chain for user ${seeded.user.id}`);
  console.log(`Mode: ${MODE}`);

  try {
    if (MODE === "naive") {
      await prisma.user.delete({ where: { id: seeded.user.id } });
    } else {
      await deleteUserCascade(prisma, seeded.user.id);
    }
  } catch (err) {
    console.error(`FAILED: deletion (mode=${MODE}) threw.`);
    console.error(`  code: ${err.code}`);
    console.error(`  meta: ${JSON.stringify(err.meta)}`);
    console.error(`  message: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  const [users, stories, audiences, sends, feedbackReports, signalRecords] = await Promise.all([
    prisma.user.count({ where: { id: seeded.user.id } }),
    prisma.story.count({ where: { userId: seeded.user.id } }),
    prisma.audience.count({ where: { userId: seeded.user.id } }),
    prisma.send.count({ where: { id: seeded.send.id } }),
    prisma.feedbackReport.count({ where: { id: seeded.feedbackReport.id } }),
    prisma.signalRecord.count({ where: { id: seeded.signalRecord.id } }),
  ]);

  const remaining = { users, stories, audiences, sends, feedbackReports, signalRecords };
  const allGone = Object.values(remaining).every((n) => n === 0);

  if (allGone) {
    console.log(`OK: deletion (mode=${MODE}) cleaned up everything, no rows left behind.`);
  } else {
    console.error(`FAILED (mode=${MODE}): delete did not throw, but rows remain:`, remaining);
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error("Unexpected error:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
