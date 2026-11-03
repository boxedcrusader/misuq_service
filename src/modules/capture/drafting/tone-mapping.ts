import { Tone } from "@prisma/client";

// Tone = the post's emotional ANGLE — the stance it takes toward its story
// (admits a struggle, celebrates a win, teaches something...). It is a moat
// grouping key once snapshotted into SignalRecord (README §3: "vulnerability-
// toned posts beat feature announcements 3:1"), so it must describe what the
// post DOES, not how it sounds.
//
// History (2026-11-03): Gemini used to return a free-text label for "the
// voice you wrote in", keyword-matched onto the enum here. Measured live, 6 of
// 8 real drafts fell to OTHER and the 2 that didn't were wrong: the drafting
// prompt itself demands an "understated builder's voice", so the label was
// nearly always "understated"/"plain" (which matches no keyword), and "honest"
// mapped a 100-customer milestone to VULNERABLE. Voice and angle are
// different axes; asking about one can't answer the other.
//
// Now Gemini picks the angle directly from these definitions, constrained by
// the response schema's enum — a judgment by the post's own author against
// written criteria, not a keyword guess. The definitions are the single
// source for both the prompt and the schema.
export const TONE_DEFINITIONS: Record<Exclude<Tone, "OTHER">, string> = {
  VULNERABLE: "openly admits a struggle, mistake, loss, or doubt",
  CONFIDENT: "states a result or decision with conviction, no hedging",
  EDUCATIONAL: "teaches something others can reuse — a how-to, technique, or numbers",
  CASUAL: "a light, low-stakes, offhand update",
  PROFESSIONAL: "a formal, businesslike announcement",
  HUMBLE: "credits others or expresses gratitude, downplays the founder's own role",
  CELEBRATORY: "marks a win or milestone with visible excitement",
  REFLECTIVE: "steps back to draw a lesson or meaning from what happened",
};

export const DRAFT_TONES = Object.keys(TONE_DEFINITIONS) as Exclude<Tone, "OTHER">[];

// Accepts only an exact angle name (case/whitespace-tolerant). Anything else
// — missing, free text, or OTHER itself — is Tone.OTHER: on a ContentPiece
// that is an honest "uncategorized". It is NEVER pooled as-is:
// report-back.service.ts writes SignalRecord.tone = null for it, because on a
// moat dimension OTHER-as-fallback would group a guess forever (CLAUDE.md §5).
export function parseDraftTone(raw: unknown): Tone {
  if (typeof raw !== "string") return Tone.OTHER;
  const candidate = raw.trim().toUpperCase();
  return (DRAFT_TONES as string[]).includes(candidate) ? (candidate as Tone) : Tone.OTHER;
}
