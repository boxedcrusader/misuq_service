import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { PrismaModule } from "./prisma/prisma.module";
import { AuthModule } from "./modules/auth/auth.module";
import { CaptureModule } from "./modules/capture/capture.module";
import { ContentPiecesModule } from "./modules/content-pieces/content-pieces.module";
import { GraduateModule } from "./modules/graduate/graduate.module";
import { ReportBackModule } from "./modules/report-back/report-back.module";
import { SendModule } from "./modules/send/send.module";
import { VoiceModule } from "./modules/voice/voice.module";

@Module({
  // isGlobal so every module can inject ConfigService without importing
  // ConfigModule individually — first consumer is
  // GeminiDraftingProvider's GEMINI_API_KEY read (capture/drafting).
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    // AuthModule registers JwtAuthGuard as a global APP_GUARD -- every
    // route below is authenticated unless marked @Public().
    AuthModule,
    CaptureModule,
    ContentPiecesModule,
    SendModule,
    ReportBackModule,
    GraduateModule,
    VoiceModule,
  ],
})
export class AppModule {}
