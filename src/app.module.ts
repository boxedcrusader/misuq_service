import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { PrismaModule } from "./prisma/prisma.module";
import { AuthModule } from "./modules/auth/auth.module";
import { AudiencesModule } from "./modules/audiences/audiences.module";
import { HealthModule } from "./modules/health/health.module";
import { CaptureModule } from "./modules/capture/capture.module";
import { ContentPiecesModule } from "./modules/content-pieces/content-pieces.module";
import { GraduateModule } from "./modules/graduate/graduate.module";
import { ReportBackModule } from "./modules/report-back/report-back.module";
import { SendModule } from "./modules/send/send.module";
import { VoiceModule } from "./modules/voice/voice.module";
import { StatsModule } from "./modules/stats/stats.module";

@Module({
  // isGlobal so every module can inject ConfigService without importing
  // ConfigModule individually — first consumer is
  // GeminiDraftingProvider's GEMINI_API_KEY read (capture/drafting).
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Per-IP rate limiting for every route (2026-11-03 pentest: no limit at
    // all on login/signup). This is the default bucket; auth and the
    // Gemini-backed routes set tighter ones with @Throttle. In-memory
    // storage: fine for a single instance, needs a shared store (e.g. Redis)
    // before scaling out.
    ThrottlerModule.forRoot([{ name: "default", ttl: 60_000, limit: 120 }]),
    PrismaModule,
    HealthModule,
    // AuthModule registers JwtAuthGuard as a global APP_GUARD -- every
    // route below is authenticated unless marked @Public().
    AuthModule,
    AudiencesModule,
    CaptureModule,
    ContentPiecesModule,
    SendModule,
    ReportBackModule,
    GraduateModule,
    VoiceModule,
    StatsModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
