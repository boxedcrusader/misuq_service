import { BadRequestException, ConflictException, ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { Niche } from "@prisma/client";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { createHash } from "node:crypto";
import { AuthRequest } from "../../common/auth/auth.types";
import { IS_PUBLIC_KEY } from "../../common/decorators/public.decorator";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { PrismaService } from "../../prisma/prisma.service";
import { AuthConfig } from "./auth.config";
import { AuthService } from "./auth.service";

// Real PrismaService against the disposable test database, zero HTTP layer
// -- same convention as every other *.service.spec.ts here. The guard is
// exercised directly with a hand-built ExecutionContext, since there's no
// supertest/HTTP harness in this repo.
const CONFIG: AuthConfig = {
  accessSecret: "test-access-secret-".padEnd(40, "a"),
  refreshSecret: "test-refresh-secret-".padEnd(40, "b"),
  accessTtlSeconds: 900,
  refreshTtlSeconds: 3600,
};

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

function contextFor(request: AuthRequest, isPublic = false): { ctx: ExecutionContext; reflector: Reflector } {
  const handler = () => undefined;
  class FakeController {}
  const reflector = new Reflector();
  if (isPublic) Reflect.defineMetadata(IS_PUBLIC_KEY, true, handler);
  const ctx = {
    getHandler: () => handler,
    getClass: () => FakeController,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { ctx, reflector };
}

describe("AuthService + JwtAuthGuard", () => {
  let prisma: PrismaService;
  let jwt: JwtService;
  let service: AuthService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    jwt = new JwtService({});
    service = new AuthService(prisma, jwt, CONFIG);
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
        "SignalRecord", "FeedbackReport", "Send", "ContentPiece", "Story",
        "Audience", "VoiceProfile", "User"
      RESTART IDENTITY CASCADE;
    `);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  function guard(reflector = new Reflector()) {
    return new JwtAuthGuard(reflector, jwt, prisma, CONFIG);
  }

  describe("register", () => {
    it("creates the user with a hashed password and returns tokens + a safe user shape", async () => {
      const result = await service.register({ email: "Founder@Example.com ", password: "hunter2-but-longer", name: "F" });

      expect(result.accessToken).toBeTruthy();
      expect(result.refreshToken).toBeTruthy();
      expect(result.user.email).toBe("founder@example.com");
      expect(result.user).not.toHaveProperty("passwordHash");
      expect(result.user).not.toHaveProperty("hashedRefreshToken");

      const row = await prisma.user.findUniqueOrThrow({ where: { id: result.user.id } });
      expect(row.passwordHash).not.toContain("hunter2");
      expect(row.passwordHash.startsWith("scrypt$")).toBe(true);
      // The raw refresh token is never stored -- only its hash.
      expect(row.hashedRefreshToken).toBe(sha256(result.refreshToken));
    });

    it("409s on a duplicate email, case-insensitively", async () => {
      await service.register({ email: "dup@example.com", password: "password-one" });
      await expect(service.register({ email: "DUP@example.com", password: "password-two" })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it("leaves niche null -- not asked yet is not a value (README §5)", async () => {
      const { user } = await service.register({ email: "n@example.com", password: "password-one" });
      expect(user.niche).toBeNull();
    });
  });

  describe("login", () => {
    beforeEach(async () => {
      await service.register({ email: "login@example.com", password: "right-password" });
    });

    it("returns tokens for the right password", async () => {
      const result = await service.login({ email: "LOGIN@example.com", password: "right-password" });
      expect(result.user.email).toBe("login@example.com");
      expect(result.user).not.toHaveProperty("passwordHash");
    });

    it("gives the SAME 401 for a wrong password and an unknown email", async () => {
      const wrong = service.login({ email: "login@example.com", password: "wrong-password" });
      const unknown = service.login({ email: "nobody@example.com", password: "right-password" });
      await expect(wrong).rejects.toThrow(new UnauthorizedException("Invalid email or password"));
      await expect(unknown).rejects.toThrow(new UnauthorizedException("Invalid email or password"));
    });

    it("401s (not 500s) for a pre-auth row carrying the placeholder hash", async () => {
      await prisma.user.create({ data: { email: "legacy@example.com", passwordHash: "not-a-real-hash" } });
      await expect(service.login({ email: "legacy@example.com", password: "anything" })).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });

  describe("refresh (rotating)", () => {
    it("issues a new pair and spends the old refresh token", async () => {
      const { refreshToken: first } = await service.register({ email: "r@example.com", password: "password-one" });

      const second = await service.refresh(first);
      expect(second.refreshToken).not.toBe(first);

      // Old token is spent...
      await expect(service.refresh(first)).rejects.toBeInstanceOf(UnauthorizedException);
      // ...the new one works.
      await expect(service.refresh(second.refreshToken)).resolves.toHaveProperty("accessToken");
    });

    it("lets exactly ONE of two concurrent refreshes with the same token win", async () => {
      const { refreshToken } = await service.register({ email: "race@example.com", password: "password-one" });
      const results = await Promise.allSettled([service.refresh(refreshToken), service.refresh(refreshToken)]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    });

    it("rejects an access token presented as a refresh token", async () => {
      const { accessToken } = await service.register({ email: "swap@example.com", password: "password-one" });
      await expect(service.refresh(accessToken)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it("invalidates the older session when the user logs in again (V1: one session per user)", async () => {
      const { refreshToken: firstSession } = await service.register({
        email: "two@example.com",
        password: "password-one",
      });
      await service.login({ email: "two@example.com", password: "password-one" });
      await expect(service.refresh(firstSession)).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe("logout", () => {
    it("revokes the refresh token server-side", async () => {
      const { user, refreshToken } = await service.register({ email: "out@example.com", password: "password-one" });
      await service.logout(user.id);

      const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(row.hashedRefreshToken).toBeNull();
      await expect(service.refresh(refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe("profile + onboarding", () => {
    it("a new account starts with no niche and not onboarded", async () => {
      const { user } = await service.register({ email: "fresh@example.com", password: "password-one" });
      expect(user.niche).toBeNull();
      expect(user.onboardedAt).toBeNull();
    });

    it("updateMe sets niche and name; an empty name clears it; an empty body is a no-op", async () => {
      const { user } = await service.register({ email: "me@example.com", password: "password-one", name: "Old" });

      const updated = await service.updateMe(user.id, { niche: Niche.DEV_TOOLS, name: "Ada" });
      expect(updated).toMatchObject({ niche: Niche.DEV_TOOLS, name: "Ada" });
      expect(updated).not.toHaveProperty("passwordHash");

      expect((await service.updateMe(user.id, { name: "" })).name).toBeNull();
      expect(await service.updateMe(user.id, {})).toMatchObject({ niche: Niche.DEV_TOOLS, name: null });
    });

    it("refuses to complete onboarding without a niche (report-back needs one)", async () => {
      const { user } = await service.register({ email: "noniche@example.com", password: "password-one" });
      await expect(service.completeOnboarding(user.id)).rejects.toBeInstanceOf(BadRequestException);
      expect((await service.me(user.id)).onboardedAt).toBeNull();
    });

    it("completes onboarding with ZERO audiences — the honest draft-only answer", async () => {
      const { user } = await service.register({ email: "zero@example.com", password: "password-one" });
      await service.updateMe(user.id, { niche: Niche.AI_TOOLS });

      const done = await service.completeOnboarding(user.id);
      expect(done.onboardedAt).toBeInstanceOf(Date);
      expect(await prisma.audience.count({ where: { userId: user.id } })).toBe(0);
    });

    it("is first-write-wins: re-completing never moves the original timestamp", async () => {
      const { user } = await service.register({ email: "twice@example.com", password: "password-one" });
      await service.updateMe(user.id, { niche: Niche.FINTECH });
      const first = (await service.completeOnboarding(user.id)).onboardedAt!;

      const again = await service.completeOnboarding(user.id);
      expect(again.onboardedAt!.getTime()).toBe(first.getTime());
    });

    it("stamps once under concurrent completion", async () => {
      const { user } = await service.register({ email: "race2@example.com", password: "password-one" });
      await service.updateMe(user.id, { niche: Niche.OTHER });
      const [a, b] = await Promise.all([service.completeOnboarding(user.id), service.completeOnboarding(user.id)]);
      expect(a.onboardedAt!.getTime()).toBe(b.onboardedAt!.getTime());
    });
  });

  describe("JwtAuthGuard", () => {
    it("attaches the user for a valid access token", async () => {
      const { accessToken, user } = await service.register({ email: "g@example.com", password: "password-one" });
      const request: AuthRequest = { headers: { authorization: `Bearer ${accessToken}` } };
      const { ctx } = contextFor(request);

      await expect(guard().canActivate(ctx)).resolves.toBe(true);
      expect(request.user).toEqual({ id: user.id, plan: "DRAFT_ONLY" });
    });

    it("401s with no Authorization header", async () => {
      const { ctx } = contextFor({ headers: {} });
      await expect(guard().canActivate(ctx)).rejects.toThrow(new UnauthorizedException("Missing bearer token"));
    });

    it("ignores the retired x-user-id header entirely", async () => {
      const { user } = await service.register({ email: "x@example.com", password: "password-one" });
      const { ctx } = contextFor({ headers: { "x-user-id": user.id } });
      await expect(guard().canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it("401s for a refresh token used as a bearer token", async () => {
      const { refreshToken } = await service.register({ email: "rb@example.com", password: "password-one" });
      const { ctx } = contextFor({ headers: { authorization: `Bearer ${refreshToken}` } });
      await expect(guard().canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it("401s for a token signed with the wrong secret", async () => {
      const forged = await jwt.signAsync({ sub: "anyone", typ: "access" }, { secret: "x".repeat(40) });
      const { ctx } = contextFor({ headers: { authorization: `Bearer ${forged}` } });
      await expect(guard().canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it("401s for an expired access token", async () => {
      const { user } = await service.register({ email: "exp@example.com", password: "password-one" });
      const expired = await jwt.signAsync(
        { sub: user.id, typ: "access", exp: Math.floor(Date.now() / 1000) - 10 },
        { secret: CONFIG.accessSecret },
      );
      const { ctx } = contextFor({ headers: { authorization: `Bearer ${expired}` } });
      await expect(guard().canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it("401s (not 500s downstream) when the token's user has been deleted", async () => {
      const { accessToken, user } = await service.register({ email: "gone@example.com", password: "password-one" });
      await prisma.user.delete({ where: { id: user.id } });
      const { ctx } = contextFor({ headers: { authorization: `Bearer ${accessToken}` } });
      await expect(guard().canActivate(ctx)).rejects.toThrow(new UnauthorizedException("Account no longer exists"));
    });

    it("lets @Public() routes through with no token", async () => {
      const { ctx, reflector } = contextFor({ headers: {} }, true);
      await expect(guard(reflector).canActivate(ctx)).resolves.toBe(true);
    });
  });
});
