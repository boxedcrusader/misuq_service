import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { AUTH_CONFIG, AuthConfig } from "../../modules/auth/auth.config";
import { PrismaService } from "../../prisma/prisma.service";
import { AuthRequest, TokenPayload } from "../auth/auth.types";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";

// Registered globally (APP_GUARD in AuthModule) -- every route requires a
// valid ACCESS token unless marked @Public().
//
// Verified with @nestjs/jwt directly rather than passport-jwt: same result,
// two fewer dependencies, and the whole check fits in one readable file.
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthRequest>();
    const token = extractBearerToken(request.headers.authorization);
    if (!token) throw new UnauthorizedException("Missing bearer token");

    let payload: TokenPayload;
    try {
      payload = await this.jwt.verifyAsync<TokenPayload>(token, {
        secret: this.config.accessSecret,
        // Pinned explicitly so a token can't pick its own algorithm.
        algorithms: ["HS256"],
      });
    } catch {
      throw new UnauthorizedException("Invalid or expired access token");
    }
    // Defense in depth on top of the separate secrets: only an access token
    // authenticates a request, never a refresh token.
    if (payload.typ !== "access" || typeof payload.sub !== "string") {
      throw new UnauthorizedException("Invalid or expired access token");
    }

    // One PK lookup per request so a deleted user's still-unexpired token
    // gets a clean 401 instead of an FK-violation 500 deep in a service
    // (the dev DB is truncated by every test run, so this is not
    // hypothetical).
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, plan: true },
    });
    if (!user) throw new UnauthorizedException("Account no longer exists");

    request.user = user;
    return true;
  }
}

function extractBearerToken(header: string | string[] | undefined): string | undefined {
  if (typeof header !== "string") return undefined;
  const [scheme, token] = header.split(" ");
  return scheme?.toLowerCase() === "bearer" && token ? token : undefined;
}
