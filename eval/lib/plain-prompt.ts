import { createHash } from "node:crypto";
import { InputFormat } from "./arms";

// The "plain" arm's prompt: the SAME model with a bare request, the
// baseline Misuq's voice/structure layer has to beat. Pre-registered and
// FIXED: never tune it to make either arm look better. Changing it starts a
// new experiment, so bump PLAIN_PROMPT_VERSION and say why in eval/README.md.
export const PLAIN_PROMPT_TEMPLATE = "Write a {format} about this update:\n\n{raw}";
export const PLAIN_PROMPT_VERSION = "plain-v1";

// What {format} becomes. Bare, as a founder would type it ("Write a X post"
// is kept as-is rather than fixed to "an", per the no-tuning rule).
export const PLAIN_FORMAT_WORDS: Record<InputFormat, string> = { x: "X post", linkedin: "LinkedIn post", email: "email" };

export function plainPrompt(format: InputFormat, raw: string): string {
  return PLAIN_PROMPT_TEMPLATE.replace("{format}", PLAIN_FORMAT_WORDS[format]).replace("{raw}", raw);
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
