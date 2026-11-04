import * as fs from "node:fs";
import * as path from "node:path";

// The harness never touches a database (no Prisma, no Nest app). It still
// refuses to run where DATABASE_URL looks like production, using the same
// guard the Jest suite uses (test/guard-database.js), so a production .env
// is never "fine for now".
// eslint-disable-next-line @typescript-eslint/no-require-imports
const guard = require("../../test/guard-database.js") as {
  resolveDatabaseUrl: () => string | undefined;
  productionReasons: (url: string | undefined) => string[];
};

export function assertNotProduction(): void {
  const reasons = guard.productionReasons(guard.resolveDatabaseUrl());
  if (reasons.length > 0) {
    throw new Error(`Refusing to run the eval harness: ${reasons.join("; ")}. Point DATABASE_URL at a local or dev database.`);
  }
}

// One value from the environment, else from service/.env. Never logged.
export function readEnvValue(name: string): string | undefined {
  if (process.env[name]) return process.env[name];
  const envFile = path.join(__dirname, "..", "..", ".env");
  if (!fs.existsSync(envFile)) return undefined;
  for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
    const match = line.match(new RegExp(`^\\s*${name}\\s*=\\s*"?([^"\\s]+)"?`));
    if (match) return match[1];
  }
  return undefined;
}
