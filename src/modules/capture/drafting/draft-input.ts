import { Channel } from "@prisma/client";
import { GenerateDraftInput } from "./drafting.provider";

// The one place a story, the founder's voice profile and their name become
// the drafting input. Pure (no database, no Nest DI), so CaptureService and
// the M1 eval harness (eval/generate.ts) build exactly the same input: the
// harness's "misuq" arm must draft what production drafts, not a copy of it.
export function toDraftInput(args: {
  rawCapture: string;
  title: string | null;
  channel: Channel;
  // null = the founder has no VoiceProfile row: the prompt's no-voice branch.
  voiceProfile: { styleSample: string | null } | null;
  // For the sign-off only; null means "sign off without a name".
  founderName: string | null;
}): GenerateDraftInput {
  return {
    rawCapture: args.rawCapture,
    title: args.title ?? undefined,
    channel: args.channel,
    voice: args.voiceProfile,
    founderName: args.founderName,
  };
}
