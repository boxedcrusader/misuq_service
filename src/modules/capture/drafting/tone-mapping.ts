import { Tone } from "@prisma/client";

// Gemini is prompted for a short free-text tone description ("warm",
// "excited and proud", "matter-of-fact"), not a Tone enum value directly —
// deliberately NOT constrained via the response schema's `enum` field,
// because forcing the model to pick from the enum would just move the same
// guessing problem onto Gemini instead of solving it, and there would be
// nothing left here to test. This is the null-vs-zero-shaped trap from
// CLAUDE.md/architecture-principles.md applied to content tone (not a moat
// dimension — Tone.OTHER here is an honest "uncategorized", legitimate to
// fall back to, unlike SignalRecord's moat dimensions where a fallback
// would pool a guess incorrectly forever).
//
// Matching is keyword-based and CONFIDENT-only: a normalized tone string
// maps to an enum value only if it contains one of that enum's known
// synonyms. Multiple enums matching, or none matching, both fall back to
// OTHER rather than guessing which one "wins" — a wrong enum value is worse
// than an honest "uncategorized" one.
const TONE_KEYWORDS: Record<Exclude<Tone, "OTHER">, string[]> = {
  VULNERABLE: ["vulnerable", "honest", "raw", "personal", "candid"],
  CONFIDENT: ["confident", "assured", "bold", "assertive"],
  EDUCATIONAL: ["educational", "informative", "instructive", "teaching", "explanatory"],
  CASUAL: ["casual", "relaxed", "informal", "conversational", "chatty"],
  PROFESSIONAL: ["professional", "formal", "business-like", "polished"],
  HUMBLE: ["humble", "modest", "grateful", "thankful", "appreciative"],
  CELEBRATORY: ["celebratory", "celebrating", "excited", "joyful", "proud", "triumphant"],
  REFLECTIVE: ["reflective", "thoughtful", "introspective", "contemplative", "reflection"],
};

export function mapToneToEnum(rawTone: string | null | undefined): Tone {
  if (!rawTone || typeof rawTone !== "string") {
    return Tone.OTHER;
  }
  const normalized = rawTone.trim().toLowerCase();
  if (normalized.length === 0) {
    return Tone.OTHER;
  }

  const matches = (Object.keys(TONE_KEYWORDS) as Exclude<Tone, "OTHER">[]).filter((tone) =>
    TONE_KEYWORDS[tone].some((keyword) => normalized.includes(keyword)),
  );

  // Exactly one confident match wins; zero or multiple (ambiguous) fall
  // back to OTHER rather than picking arbitrarily.
  return matches.length === 1 ? matches[0] : Tone.OTHER;
}
