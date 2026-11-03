import { Channel, Tone } from "@prisma/client";

// Learn VOICE from the founder's own samples (rhythm, vocabulary,
// personality); STRUCTURE (hook, narrative shape) is imposed by the prompt,
// never by the sample. Keep the two separate wherever this type flows —
// see GeminiDraftingProvider.buildPrompt for where that split is enforced.
export interface VoiceContext {
  styleSample?: string | null;
}

export interface GenerateDraftInput {
  rawCapture: string;
  title?: string | null;
  channel: Channel;
  // Optional/nullable: a founder with no VoiceProfile row, or one with a
  // null/empty styleSample, is a real and expected case (not an error) —
  // see the no-voice branch in buildPrompt.
  voice?: VoiceContext | null;
  // For the sign-off only. Null/absent is normal (User.name is optional) and
  // means "sign off without a name" — never "invent one".
  founderName?: string | null;
}

export interface DraftingProvider {
  generateDraft(input: GenerateDraftInput): Promise<{ body: string; tone: Tone }>;
}

export const DRAFTING_PROVIDER = "DRAFTING_PROVIDER";
