import { HttpException, HttpStatus } from "@nestjs/common";
import { AiTask, Prisma, PrismaClient } from "@prisma/client";

// Spend limits for every AI-backed action (drafting, report-back extraction,
// re-extraction). Per-IP burst limits live in the throttler (app.module.ts);
// these are the slower ceilings:
//   - per account, per task, rolling 24h (DAILY_DRAFT_LIMIT /
//     DAILY_REPORT_LIMIT, default 30 each): signup is open, so one account
//     can't run up the bill;
//   - all accounts together, rolling 24h (GLOBAL_DAILY_AI_LIMIT, default
//     300): many accounts from many IPs can't either. At the measured ~0.5¢
//     per Claude draft that's ~$1.50/day at the cap.
//
// Counted from AiRequest rows written BEFORE the model is called (see
// reserveAiRequest), not from the drafts/reports that succeeded: the
// 2026-11-04 pentest showed 5 failing drafts all reaching the model under a
// cap of 3, and 10 parallel drafts all passing a count-then-insert check.

export type UsageKind = "draft" | "report";

const DEFAULTS: Record<UsageKind, number> = { draft: 30, report: 30 };
const ENV: Record<UsageKind, string> = { draft: "DAILY_DRAFT_LIMIT", report: "DAILY_REPORT_LIMIT" };
const NOUN: Record<UsageKind, string> = { draft: "drafts", report: "report-backs" };
const KIND_OF_TASK: Record<AiTask, UsageKind> = { DRAFT: "draft", EXTRACTION: "report" };
const GLOBAL_DEFAULT = 300;

export const USAGE_WINDOW_MS = 24 * 60 * 60 * 1000;

function positiveIntFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function dailyLimit(kind: UsageKind): number {
  return positiveIntFromEnv(ENV[kind], DEFAULTS[kind]);
}

export function globalDailyLimit(): number {
  return positiveIntFromEnv("GLOBAL_DAILY_AI_LIMIT", GLOBAL_DEFAULT);
}

export function usageWindowStart(now = Date.now()): Date {
  return new Date(now - USAGE_WINDOW_MS);
}

export function assertUnderDailyLimit(kind: UsageKind, usedInWindow: number): void {
  const limit = dailyLimit(kind);
  if (usedInWindow >= limit) {
    throw new HttpException(
      `Daily limit reached: ${limit} ${NOUN[kind]} per 24 hours. Try again later.`,
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

export function assertUnderGlobalLimit(usedInWindow: number): void {
  if (usedInWindow >= globalDailyLimit()) {
    throw new HttpException(
      "Misuq has reached today's AI capacity for all accounts. Your work is saved — try again tomorrow.",
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

// Postgres serialization failure (SQLSTATE 40001), surfaced by Prisma as
// P2034 "Transaction failed due to a write conflict or a deadlock".
function isSerializationFailure(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
}

const MAX_RESERVE_ATTEMPTS = 5;

// Checks both caps and records the request, in one SERIALIZABLE transaction,
// before the caller spends anything on the model. Serializable is what makes
// concurrent requests safe: two transactions that both counted N and both
// insert conflict, one is aborted with 40001 and retried, and its retry sees
// N+1 — so parallel requests can't slip past the cap together.
//
// Call it AFTER the request's own validation (404/409/400), so a request
// that would never reach the model doesn't use up the founder's allowance.
export async function reserveAiRequest(prisma: PrismaClient, userId: string, task: AiTask): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await prisma.$transaction(
        async (tx) => {
          const since = usageWindowStart();
          const mine = await tx.aiRequest.count({ where: { userId, task, createdAt: { gte: since } } });
          assertUnderDailyLimit(KIND_OF_TASK[task], mine);
          const everyone = await tx.aiRequest.count({ where: { createdAt: { gte: since } } });
          assertUnderGlobalLimit(everyone);
          await tx.aiRequest.create({ data: { userId, task } });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      return;
    } catch (error) {
      if (!isSerializationFailure(error)) throw error;
      if (attempt >= MAX_RESERVE_ATTEMPTS) {
        throw new HttpException("Too many requests at once. Wait a moment and try again.", HttpStatus.TOO_MANY_REQUESTS);
      }
      // Small jittered backoff so the retries don't collide again in lockstep.
      await new Promise((resolve) => setTimeout(resolve, 10 + Math.random() * 40 * attempt));
    }
  }
}
