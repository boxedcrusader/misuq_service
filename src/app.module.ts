import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { PrismaModule } from "./prisma/prisma.module";
import { CaptureModule } from "./modules/capture/capture.module";
import { GraduateModule } from "./modules/graduate/graduate.module";
import { ReportBackModule } from "./modules/report-back/report-back.module";
import { SendModule } from "./modules/send/send.module";

@Module({
  // isGlobal so every module can inject ConfigService without importing
  // ConfigModule individually — first consumer is
  // GeminiDraftingProvider's GEMINI_API_KEY read (capture/drafting).
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    CaptureModule,
    SendModule,
    ReportBackModule,
    GraduateModule,
  ],
})
export class AppModule {}
