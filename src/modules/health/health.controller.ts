import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import { Public } from "../../common/decorators/public.decorator";
import { PrismaService } from "../../prisma/prisma.service";

// For the host's health check (render.yaml healthCheckPath). Public and
// unthrottled, returns nothing sensitive. Pings the database so a deploy
// whose DATABASE_URL is wrong never goes live as "healthy".
@Controller("health")
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @SkipThrottle()
  @Get()
  async check() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException("Database unreachable");
    }
    return { status: "ok" };
  }

  // Liveness only: no database call. For an external keep-alive pinger,
  // which only needs to stop Render's free instance sleeping. Pinging
  // /health instead would also keep Neon awake and burn its free compute.
  @Public()
  @SkipThrottle()
  @Get("live")
  live() {
    return { status: "ok" };
  }
}
