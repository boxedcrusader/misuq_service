import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { SetVoiceSampleDto } from "./dto/set-voice-sample.dto";

// VoiceProfile is 1:1 per founder (schema.prisma: userId @unique) and this
// endpoint is the ONLY writer of styleSample -- onboarding may run once or
// be re-edited later, so this is an upsert, not a create-only call. Stored
// raw, verbatim: no parsing/splitting/"analysis" (README §5 -- VoiceProfile
// is a loose bag read only by this founder's own agent, never pooled).
@Injectable()
export class VoiceService {
  constructor(private readonly prisma: PrismaService) {}

  async setVoiceSample(userId: string, dto: SetVoiceSampleDto) {
    return this.prisma.voiceProfile.upsert({
      where: { userId },
      update: { styleSample: dto.styleSample },
      // `data` has no default -- VoiceProfile.data is a required Json column
      // for other, unrelated voice-memory use, untouched by this slice. An
      // empty object is an honest "nothing there yet", not a guess at real
      // content (contrast with README's ban on synthesizing MOAT dimensions
      // -- this is the private layer, and {} is a legitimate empty bag).
      create: { userId, styleSample: dto.styleSample, data: {} },
    });
  }

  async getVoiceSample(userId: string) {
    return this.prisma.voiceProfile.findUnique({
      where: { userId },
      select: { styleSample: true },
    });
  }
}
