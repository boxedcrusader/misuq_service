import { Plan } from "@prisma/client";

export type TokenType = "access" | "refresh";

export interface TokenPayload {
  sub: string;
  typ: TokenType;
}

// What JwtAuthGuard attaches to the request. `plan` is loaded alongside the
// id so a future plan guard (README §6, "Guard API routes by user.plan") can
// read it without a second query.
export interface AuthenticatedUser {
  id: string;
  plan: Plan;
}

// Minimal request shape the guard/decorator touch -- avoids pulling in
// @types/express just for these two fields.
export interface AuthRequest {
  headers: Record<string, string | string[] | undefined>;
  user?: AuthenticatedUser;
}
