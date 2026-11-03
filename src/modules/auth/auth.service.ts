import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Prisma } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { TokenPayload, TokenType } from "../../common/auth/auth.types";
import { PrismaService } from "../../prisma/prisma.service";
import { AUTH_CONFIG, AuthConfig } from "./auth.config";
import { LoginDto } from "./dto/login.dto";
import { RegisterDto } from "./dto/register.dto";
import { UpdateMeDto } from "./dto/update-me.dto";
import { normalizeEmail } from "./normalize-email";
import { getDummyHash, hashPassword, verifyPassword } from "./password";

// Every user-shaped response goes through this select -- passwordHash and
// hashedRefreshToken must never leave the service.
const PUBLIC_USER_SELECT = {
  id: true,
  email: true,
  name: true,
  plan: true,
  niche: true,
  aggregateLearningConsent: true,
  onboardedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

export type PublicUser = Prisma.UserGetPayload<{ select: typeof PUBLIC_USER_SELECT }>;

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface AuthResult extends TokenPair {
  user: PublicUser;
}

// One generic message for unknown-email AND wrong-password, so the login
// endpoint can't be used to probe which emails have accounts.
const INVALID_CREDENTIALS = "Invalid email or password";
const REFRESH_REJECTED = "Refresh token is no longer valid -- please log in again";

// Refresh tokens are stored as SHA-256, not bcrypt/scrypt: they're
// high-entropy random JWTs, so a slow hash adds nothing, and bcrypt in
// particular would silently compare only the first 72 bytes -- which for a
// JWT is the header + start of the payload, identical across a user's
// tokens.
function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// V1 session model: ONE refresh token per user (User.hashedRefreshToken,
// "minimal JWT refresh-token storage" in the schema). Logging in elsewhere
// replaces it, so the older session can't refresh past its current access
// token's expiry. Multi-device sessions need a Session table -- deferred
// until mobile actually has screens a founder would stay logged into.
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResult> {
    const passwordHash = await hashPassword(dto.password);
    let user: PublicUser;
    try {
      user = await this.prisma.user.create({
        data: { email: normalizeEmail(dto.email), passwordHash, name: dto.name },
        select: PUBLIC_USER_SELECT,
      });
    } catch (err) {
      // Catch the unique violation rather than pre-checking with
      // findUnique: a check-then-insert has a race window, the constraint
      // doesn't.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new ConflictException("An account with this email already exists");
      }
      throw err;
    }
    const tokens = await this.startSession(user.id);
    return { ...tokens, user };
  }

  async login(dto: LoginDto): Promise<AuthResult> {
    const record = await this.prisma.user.findUnique({
      where: { email: normalizeEmail(dto.email) },
      select: { ...PUBLIC_USER_SELECT, passwordHash: true },
    });

    // Always pay the full scrypt cost, even for an unknown email, so timing
    // doesn't leak account existence either.
    const valid = await verifyPassword(dto.password, record?.passwordHash ?? (await getDummyHash()));
    if (!record || !valid) throw new UnauthorizedException(INVALID_CREDENTIALS);

    const { passwordHash: _omit, ...user } = record;
    const tokens = await this.startSession(user.id);
    return { ...tokens, user };
  }

  // Rotating refresh: every successful call invalidates the token it was
  // given. The swap is a single conditional UPDATE (compare-and-swap on the
  // stored hash), so two concurrent refreshes with the same token can't
  // both succeed -- exactly one matches, the other gets count === 0.
  async refresh(refreshToken: string): Promise<TokenPair> {
    const payload = await this.verify(refreshToken, "refresh");
    const tokens = await this.signTokens(payload.sub);

    const { count } = await this.prisma.user.updateMany({
      where: { id: payload.sub, hashedRefreshToken: hashRefreshToken(refreshToken) },
      data: { hashedRefreshToken: hashRefreshToken(tokens.refreshToken) },
    });
    if (count === 0) throw new UnauthorizedException(REFRESH_REJECTED);

    return tokens;
  }

  // Server-side revocation of the refresh token. The current access token
  // stays valid until it expires (stateless JWT) -- that window is what the
  // short access TTL is for.
  async logout(userId: string): Promise<void> {
    await this.prisma.user.updateMany({ where: { id: userId }, data: { hashedRefreshToken: null } });
  }

  async me(userId: string): Promise<PublicUser> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: PUBLIC_USER_SELECT });
    if (!user) throw new NotFoundException(`User ${userId} not found`);
    return user;
  }

  // Profile fields only — never email/password/plan/consent, which each
  // have their own (future) flows.
  async updateMe(userId: string, dto: UpdateMeDto): Promise<PublicUser> {
    await this.me(userId); // 404 if the account is gone
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name === "" ? null : dto.name } : {}),
        ...(dto.niche !== undefined ? { niche: dto.niche } : {}),
      },
      select: PUBLIC_USER_SELECT,
    });
  }

  // Records that onboarding finished. Gated on niche — the one onboarding
  // answer the loop can't run without (report-back fail-closes on null) —
  // so "onboarded" always implies "can report back". Audiences are NOT
  // required: finishing with zero is the honest draft-only answer, and
  // exactly what the onboardedAt + audience count measurement needs to see.
  //
  // Idempotent and first-write-wins: re-completing (e.g. revisiting
  // onboarding to add an audience) never moves the original timestamp —
  // it's a historical event, not a "last touched" field.
  async completeOnboarding(userId: string): Promise<PublicUser> {
    const user = await this.me(userId);
    if (!user.niche) {
      throw new BadRequestException("Pick what you're building (your niche) before finishing onboarding.");
    }
    if (user.onboardedAt) return user;

    // Conditional on onboardedAt still being null, so two concurrent
    // completions can't both stamp it.
    await this.prisma.user.updateMany({
      where: { id: userId, onboardedAt: null },
      data: { onboardedAt: new Date() },
    });
    return this.me(userId);
  }

  private async startSession(userId: string): Promise<TokenPair> {
    const tokens = await this.signTokens(userId);
    await this.prisma.user.update({
      where: { id: userId },
      data: { hashedRefreshToken: hashRefreshToken(tokens.refreshToken) },
    });
    return tokens;
  }

  private async signTokens(userId: string): Promise<TokenPair> {
    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync({ sub: userId, typ: "access" } satisfies TokenPayload, {
        secret: this.config.accessSecret,
        expiresIn: this.config.accessTtlSeconds,
        algorithm: "HS256",
      }),
      this.jwt.signAsync({ sub: userId, typ: "refresh" } satisfies TokenPayload, {
        secret: this.config.refreshSecret,
        expiresIn: this.config.refreshTtlSeconds,
        algorithm: "HS256",
        // jti makes every refresh token unique. Without it, two tokens
        // minted for the same user in the same second are byte-identical
        // (iat has 1s resolution), and a rotation would "replace" a token
        // with itself -- leaving the supposedly-spent token still valid.
        jwtid: randomUUID(),
      }),
    ]);
    return { accessToken, refreshToken };
  }

  private async verify(token: string, expected: TokenType): Promise<TokenPayload> {
    const secret = expected === "access" ? this.config.accessSecret : this.config.refreshSecret;
    let payload: TokenPayload;
    try {
      payload = await this.jwt.verifyAsync<TokenPayload>(token, { secret, algorithms: ["HS256"] });
    } catch {
      throw new UnauthorizedException(REFRESH_REJECTED);
    }
    if (payload.typ !== expected || typeof payload.sub !== "string") {
      throw new UnauthorizedException(REFRESH_REJECTED);
    }
    return payload;
  }
}
