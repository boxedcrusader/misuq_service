import { HttpException, HttpStatus } from "@nestjs/common";

// Per-account caps on the Gemini-backed actions (2026-11-03 pentest: signup is
// open, so without a cap one account — or a script making many — could run up
// the Gemini bill). Rolling 24h windows, counted from rows that already exist
// (ContentPiece / FeedbackReport createdAt) — no usage table, per "don't store
// what's derivable". Per-IP burst limits live in the throttler (app.module.ts);
// this is the slower, per-account ceiling.
//
// Generous for a real founder (a handful of updates a day), tight for abuse.
// Override with DAILY_DRAFT_LIMIT / DAILY_REPORT_LIMIT.

export type UsageKind = "draft" | "report";

const DEFAULTS: Record<UsageKind, number> = { draft: 30, report: 30 };
const ENV: Record<UsageKind, string> = { draft: "DAILY_DRAFT_LIMIT", report: "DAILY_REPORT_LIMIT" };
const NOUN: Record<UsageKind, string> = { draft: "drafts", report: "report-backs" };

export const USAGE_WINDOW_MS = 24 * 60 * 60 * 1000;

export function dailyLimit(kind: UsageKind): number {
  const raw = process.env[ENV[kind]];
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : DEFAULTS[kind];
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
