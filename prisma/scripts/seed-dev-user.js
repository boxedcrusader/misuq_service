// Fixed dev user for local frontend integration: an already-onboarded founder
// (niche, two audiences, onboardedAt set) with a real login, so the full loop
// is walkable without clicking through /onboarding first. A freshly
// registered account goes through /onboarding instead (niche → audiences →
// voice), which is the path to test for new founders.
//
// Login: dev-founder@misuq.local / DEV_USER_PASSWORD (default below).
// Re-running resets the password to that value -- dev-only by design.
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

// Hash with the app's OWN password module (via ts-node) instead of a JS
// copy of it, so the seed can never drift from the format login verifies.
require("ts-node").register({ transpileOnly: true });
const { hashPassword } = require("../../src/modules/auth/password");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const DEV_USER_EMAIL = "dev-founder@misuq.local";
// Local-only account on a .local address -- a known default keeps the
// seed zero-config; override with DEV_USER_PASSWORD if you prefer.
const DEV_USER_PASSWORD = process.env.DEV_USER_PASSWORD || "misuq-dev-password";

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
  const passwordHash = await hashPassword(DEV_USER_PASSWORD);
  const user = await prisma.user.upsert({
    where: { email: DEV_USER_EMAIL },
    // passwordHash IS updated on an existing row: older seeds stored the
    // "not-a-real-hash" placeholder, which can never log in. The id is
    // still never touched.
    update: { passwordHash },
    create: {
      email: DEV_USER_EMAIL,
      passwordHash,
      name: "Dev Founder",
      niche: "DEV_TOOLS",
      // true, not the schema default false: this dev user is meant to
      // exercise the full loop (including the moat-facing report-back step)
      // as development continues, not just capture/draft.
      aggregateLearningConsent: true,
    },
  });

  // The dev founder has a niche and audiences, so it counts as onboarded —
  // logging in goes straight to the product, not /onboarding. First-write-
  // wins, same rule as AuthService.completeOnboarding.
  if (!user.onboardedAt) {
    await prisma.user.update({ where: { id: user.id }, data: { onboardedAt: new Date() } });
  }

  console.log(`Dev user ready: ${user.id} (${user.email}, niche=${user.niche}, consent=${user.aggregateLearningConsent})`);
  console.log(`Dev login: ${DEV_USER_EMAIL} / ${process.env.DEV_USER_PASSWORD ? "<DEV_USER_PASSWORD>" : DEV_USER_PASSWORD}`);

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
