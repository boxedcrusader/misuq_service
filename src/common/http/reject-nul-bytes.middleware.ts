// Postgres `text` can't store U+0000, so a NUL anywhere in a stored string —
// or in a path id handed to Prisma — surfaced as an unhandled 500 (found by
// the 2026-11-03 pentest). Rejected once, up front, for every route, instead
// of per-DTO: a new free-text field can't forget it.
//
// Runs after the JSON body parser (see main.ts), so req.body is parsed.

interface Req {
  originalUrl: string;
  body?: unknown;
}
interface Res {
  status(code: number): { json(body: unknown): void };
}

const MAX_DEPTH = 32;

function containsNul(value: unknown, depth = 0): boolean {
  if (depth > MAX_DEPTH) return false;
  if (typeof value === "string") return value.includes("\u0000");
  if (Array.isArray(value)) return value.some((v) => containsNul(v, depth + 1));
  if (value && typeof value === "object") {
    return Object.entries(value).some(([k, v]) => k.includes("\u0000") || containsNul(v, depth + 1));
  }
  return false;
}

export function rejectNulBytes(req: Req, res: Res, next: () => void): void {
  if (/%00/i.test(req.originalUrl) || containsNul(req.body)) {
    res.status(400).json({ statusCode: 400, error: "Bad Request", message: "Text can't contain NUL (\\u0000) characters" });
    return;
  }
  next();
}
