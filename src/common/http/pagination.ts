import { BadRequestException } from "@nestjs/common";

export const MAX_PAGE_SIZE = 100;

// Strict parsing for ?page= / ?limit= (found by the 2026-11-03 pentest:
// `?page=abc|0|-1` and `?limit=abc` reached Prisma as NaN/negative and 500'd,
// and `?limit=1000000` was honored). Anything that isn't a plain positive
// integer is a 400; limit is capped at MAX_PAGE_SIZE.
export function parsePagination(
  page: string | undefined,
  limit: string | undefined,
  defaultLimit = 20,
): { page: number; limit: number } {
  return {
    page: parsePositiveInt("page", page, 1, Number.MAX_SAFE_INTEGER),
    limit: parsePositiveInt("limit", limit, defaultLimit, MAX_PAGE_SIZE),
  };
}

function parsePositiveInt(name: string, raw: string | undefined, fallback: number, max: number): number {
  if (raw === undefined || raw === "") return fallback;
  if (!/^\d+$/.test(raw)) throw new BadRequestException(`${name} must be a positive integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) throw new BadRequestException(`${name} must be a positive integer`);
  if (value > max) throw new BadRequestException(`${name} must be at most ${max}`);
  return value;
}
