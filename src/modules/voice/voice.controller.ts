import { Body, Controller, Get, Put } from "@nestjs/common";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { SetVoiceSampleDto } from "./dto/set-voice-sample.dto";
import { VoiceService } from "./voice.service";

@Controller("voice-profile")
export class VoiceController {
  constructor(private readonly voiceService: VoiceService) {}

  // PUT, not POST: idempotent set/replace, matching the upsert underneath --
  // submitting the same or an edited sample again updates the one row
  // rather than erroring or creating a duplicate.
  @Put()
  setVoiceSample(@CurrentUser() userId: string, @Body() dto: SetVoiceSampleDto) {
    return this.voiceService.setVoiceSample(userId, dto);
  }

  @Get()
  getVoiceSample(@CurrentUser() userId: string) {
    return this.voiceService.getVoiceSample(userId);
  }
}
