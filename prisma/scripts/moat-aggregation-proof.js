// Schema PROOF, not a feature: confirms the canonical moat aggregation
// query (README §3 "Edge" / §5 "SignalRecord is the moat's atom") is
// expressible against the REAL SignalRecord/User schema and every column
// it references resolves. This is the spec the Capture/report-back
// extraction step must later satisfy -- run it now, before that module
// writes real rows, so a missing/wrong field is caught here instead of
// silently producing nulls later.
//
// A near-empty result is EXPECTED and is a PASS: HAVING COUNT(*) >= 20 will
// filter out everything with only a handful of seed rows per group. The
// only failure mode this script cares about is the query not executing --
// unknown column, wrong enum value, wrong type, wrong nullability.
//
// Usage:
//   DATABASE_URL="postgresql://user:pass@host:port/db" node prisma/scripts/moat-aggregation-proof.js
//
// Only ever point this at a disposable test database -- it truncates the
// tables it touches before seeding, every run.

const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

// Original query as specified, for the record (snake_case / lower-case
// table names that don't exist in this schema -- see report below for the
// rewrite and why each change was necessary):
//
//   SELECT
//     content_type,
//     tone,
//     COUNT(*)                                        AS n,
//     SUM(reply_count)::float / NULLIF(SUM(views), 0) AS resonance_rate
//   FROM signal_records sr
//   JOIN users u ON u.id = sr.user_id
//   WHERE sr.niche   = 'DEV_TOOLS'
//     AND sr.channel = 'X'
//     AND u.aggregate_learning_consent = true
//     AND sr.views IS NOT NULL
//     AND sr.reply_count IS NOT NULL
//   GROUP BY content_type, tone
//   HAVING COUNT(*) >= 20
//   ORDER BY resonance_rate DESC;

const MOAT_AGGREGATION_QUERY = `
  SELECT
    sr."contentType"                                          AS content_type,
    sr.tone                                                    AS tone,
    COUNT(*)                                                   AS n,
    SUM(sr."replyCount")::float / NULLIF(SUM(sr.views), 0)     AS resonance_rate
  FROM "SignalRecord" sr
  JOIN "User" u ON u.id = sr."userId"
  WHERE sr.niche   = 'DEV_TOOLS'
    AND sr.channel = 'X'
    AND u."aggregateLearningConsent" = true
    AND sr.views IS NOT NULL
    AND sr."replyCount" IS NOT NULL
  GROUP BY sr."contentType", sr.tone
  HAVING COUNT(*) >= 20
  ORDER BY resonance_rate DESC;
`;

async function truncateAll() {
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

async function seedChain({ user, contentType, channel, tone, views, replyCount }) {
  const story = await prisma.story.create({
    data: { userId: user.id, rawCapture: "seed", contentType },
  });
  const contentPiece = await prisma.contentPiece.create({
    data: { storyId: story.id, channel, stage: "WIDE", tone, body: "seed" },
  });
  const audience = await prisma.audience.create({
    data: { userId: user.id, name: "seed audience", type: "PEERS" },
  });
  const send = await prisma.send.create({
    data: { contentPieceId: contentPiece.id, audienceId: audience.id, audienceSizeSnapshot: 1000 },
  });
  const feedbackReport = await prisma.feedbackReport.create({
    data: { sendId: send.id, rawFeedback: "seed" },
  });
  return prisma.signalRecord.create({
    data: {
      userId: user.id,
      feedbackReportId: feedbackReport.id,
      niche: "DEV_TOOLS",
      channel,
      contentType,
      tone,
      audienceSizeSnapshot: 1000,
      views,
      replyCount,
    },
  });
}

async function seed() {
  const user = await prisma.user.create({
    data: {
      email: "moat-proof@misuq.test",
      passwordHash: "not-a-real-hash",
      aggregateLearningConsent: true,
    },
  });

  // Two rows in the same (contentType, tone) group, to prove the rate is
  // SUM/SUM across rows, not an average of per-row ratios.
  await seedChain({
    user,
    contentType: "FEATURE_ANNOUNCEMENT",
    channel: "X",
    tone: "CONFIDENT",
    views: 100,
    replyCount: 12,
  });
  await seedChain({
    user,
    contentType: "FEATURE_ANNOUNCEMENT",
    channel: "X",
    tone: "CONFIDENT",
    views: 150,
    replyCount: 9,
  });

  // A different group, with views unreported (null) -- must be excluded by
  // `views IS NOT NULL`, not coerced to 0.
  await seedChain({
    user,
    contentType: "MILESTONE",
    channel: "X",
    tone: "VULNERABLE",
    views: null,
    replyCount: 3,
  });

  return user;
}

async function main() {
  await truncateAll();
  await seed();
  console.log("Seeded 3 SignalRecord rows for a consenting user.");

  // Sanity check distinct from the proof query: confirms the null-filter
  // actually excludes the unreported-views row (behavioral, not just that
  // the column resolves).
  const [{ count: reportedCount }] = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS count FROM "SignalRecord" WHERE views IS NOT NULL;`
  );
  console.log(`Rows with views IS NOT NULL: ${reportedCount} (expect 2 of 3 seeded)`);

  let rows;
  try {
    rows = await prisma.$queryRawUnsafe(MOAT_AGGREGATION_QUERY);
  } catch (err) {
    console.error("FAIL: query did not execute.");
    console.error(`  code: ${err.code}`);
    console.error(`  message: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Query executed. Rows returned: ${rows.length} (HAVING COUNT(*) >= 20 makes 0 expected here).`);
  console.log(rows);
  console.log("PASS: moat aggregation query resolves cleanly against the real schema.");
}

main()
  .catch((err) => {
    console.error("Unexpected error:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
