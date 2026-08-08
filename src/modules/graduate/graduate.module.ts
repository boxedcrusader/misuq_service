import { Module } from "@nestjs/common";
import { GraduateController } from "./graduate.controller";
import { GraduateService } from "./graduate.service";

@Module({
  controllers: [GraduateController],
  providers: [GraduateService],
})
export class GraduateModule {}
