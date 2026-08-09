// Fixed dev user for local frontend integration (no user-creation endpoint
// exists yet -- auth is deferred, see current-user.decorator.ts). This is
// the ONE User the frontend's x-user-id stand-in points at while wiring up
// real screens against the real backend.
//
// Re-runnable / idempotent: upserts on the fixed email below, so re-running
// after a `prisma db push` or a test suite's TRUNCATE (which wipes this row
// too, since it shares the disposable dev DB) recreates the same row with a
// STABLE id -- Prisma only assigns a new cuid() on first insert; the
// upsert's `update: {}` never touches an existing row's id.
//
// niche + aggregateLearningConsent are set for real (not left null/default)
// on purpose: report-back fail-closes on a null niche (README §5 "NEVER
// synthesize a value for a poolable-layer dimension"), so a niche-less dev
// user would work for capture/draft today and then silently break the
// report-back screen later. Setting both now means this SAME seeded user
// carries through the whole loop as it gets built out, not just this slice.
//
// Usage:
//   DATABASE_URL="postgresql://..." node prisma/scripts/seed-dev-user.js

const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const DEV_USER_EMAIL = "dev-founder@misuq.local";

// No audience-creation endpoint exists (deferred, same as user-creation) --
// this is the ONLY way the dev user gets an Audience to stage a Send
// against. Two, not one: the Send screen shows a real choice, and the
// duplicate-guard case needs a second, unaffected audience to contrast
// against (same piece staged to Beta list AND Discord must both succeed --
// the guard is per-audience, not per-piece).
const DEV_AUDIENCES = [
  { name: "Beta list", type: "EMAIL_LIST", size: 42 },
  { name: "Discord", type: "DISCORD", size: 18 },
];

// Audience has no unique constraint on (userId, name) -- prisma.upsert needs
// one, so this is a manual find-or-create instead. Same idempotency goal as
// the user upsert below: re-running never duplicates rows, and an existing
// row's id is never touched (Prisma only assigns cuid() on first insert).
async function findOrCreateAudience(userId, data) {
  const existing = await prisma.audience.findFirst({ where: { userId, name: data.name } });
  if (existing) return existing;
  return prisma.audience.create({ data: { userId, ...data } });
}

async function main() {
  const user = await prisma.user.upsert({
    where: { email: DEV_USER_EMAIL },
    update: {},
    create: {
      email: DEV_USER_EMAIL,
      passwordHash: "not-a-real-hash",
      name: "Dev Founder",
      niche: "DEV_TOOLS",
      // true, not the schema default false: this dev user is meant to
      // exercise the full loop (including the moat-facing report-back step)
      // as development continues, not just capture/draft.
      aggregateLearningConsent: true,
    },
  });

  console.log(`Dev user ready: ${user.id} (${user.email}, niche=${user.niche}, consent=${user.aggregateLearningConsent})`);

  for (const audienceData of DEV_AUDIENCES) {
    const audience = await findOrCreateAudience(user.id, audienceData);
    console.log(`Dev audience ready: ${audience.id} (${audience.name}, type=${audience.type}, size=${audience.size})`);
  }
}

main()
  .catch((err) => {
    console.error("Failed to seed dev user:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
