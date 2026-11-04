// Jest globalSetup: refuse to run the suite against production.
//
// Every spec TRUNCATEs every table. On 2026-11-04 the local .env pointed at
// the production Neon branch and two suite runs wiped it (restored from
// Neon's history; see CLAUDE.md §8). This check runs once, before any test,
// so a pasted production URL fails loudly instead of silently deleting data.
const fs = require("node:fs");
const path = require("node:path");

// Production endpoints (hostnames aren't secrets). Add any new production
// endpoint here when one is created.
const PRODUCTION_HOST_MARKERS = ["ep-winter-sun-banl5i50"];

// Prisma reads DATABASE_URL from the environment first, then from .env:
// resolve it the same way so the guard sees what the tests will use.
function resolveDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envFile = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envFile)) return undefined;
  for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
    const match = line.match(/^\s*DATABASE_URL\s*=\s*"?([^"\s]+)"?/);
    if (match) return match[1];
  }
  return undefined;
}

// Why this environment looks like production; empty = safe. Shared with
// the eval harness (eval/lib/env.ts), which refuses to run on production
// even though it never touches the database.
function productionReasons(url) {
  const reasons = [];
  const host = url ? new URL(url).hostname : null;
  if (host && PRODUCTION_HOST_MARKERS.some((marker) => host.includes(marker))) reasons.push(`DATABASE_URL is the production database (${host})`);
  if (process.env.NODE_ENV === "production") reasons.push("NODE_ENV is production");
  if (process.env.RENDER) reasons.push("running on Render");
  return reasons;
}

module.exports = async () => {
  const url = resolveDatabaseUrl();
  if (!url) throw new Error("DATABASE_URL is not set: point it at a local or dev database before running tests.");
  const host = new URL(url).hostname;
  const reasons = productionReasons(url);
  if (reasons.length > 0) {
    throw new Error(
      `Refusing to run the test suite: ${reasons.join("; ")}. The tests TRUNCATE every table. Point DATABASE_URL at a local or dev database.`,
    );
  }
  console.log(`\n[guard-database] tests will run against ${host}\n`);
};

module.exports.resolveDatabaseUrl = resolveDatabaseUrl;
module.exports.productionReasons = productionReasons;
