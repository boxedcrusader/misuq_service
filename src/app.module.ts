import { Module } from "@nestjs/common";
import { PrismaModule } from "./prisma/prisma.module";
import { CaptureModule } from "./modules/capture/capture.module";
import { ReportBackModule } from "./modules/report-back/report-back.module";
import { SendModule } from "./modules/send/send.module";

@Module({
  imports: [PrismaModule, CaptureModule, SendModule, ReportBackModule],
})
export class AppModule {}
