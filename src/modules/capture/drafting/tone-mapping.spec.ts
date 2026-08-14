import { Tone } from "@prisma/client";
import { mapToneToEnum } from "./tone-mapping";

// Pure-function proof for the null-vs-zero-shaped trap this mapping exists
// to avoid (architecture-principles.md / CLAUDE.md): free text from Gemini
// must only become a specific Tone enum value on a CONFIDENT match, and
// must fall back to OTHER for anything unclear rather than guessing.
describe("mapToneToEnum", () => {
  it("maps a confident single-word match to its enum value", () => {
    expect(mapToneToEnum("celebratory")).toBe(Tone.CELEBRATORY);
    expect(mapToneToEnum("Vulnerable")).toBe(Tone.VULNERABLE);
  });

  it("maps a confident match embedded in a longer free-text phrase", () => {
    expect(mapToneToEnum("warm and celebratory")).toBe(Tone.CELEBRATORY);
    expect(mapToneToEnum("excited and proud")).toBe(Tone.CELEBRATORY);
    expect(mapToneToEnum("humble and grateful")).toBe(Tone.HUMBLE);
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(mapToneToEnum("  CONFIDENT  ")).toBe(Tone.CONFIDENT);
  });

  it("falls back to OTHER for an unrecognized free-text tone", () => {
    expect(mapToneToEnum("warm")).toBe(Tone.OTHER);
    expect(mapToneToEnum("upbeat and snappy")).toBe(Tone.OTHER);
  });

  it("falls back to OTHER for null, undefined, or empty input", () => {
    expect(mapToneToEnum(null)).toBe(Tone.OTHER);
    expect(mapToneToEnum(undefined)).toBe(Tone.OTHER);
    expect(mapToneToEnum("")).toBe(Tone.OTHER);
    expect(mapToneToEnum("   ")).toBe(Tone.OTHER);
  });

  it("falls back to OTHER (never guesses) when multiple tones match ambiguously", () => {
    // Contains both "confident" and "humble" keywords -- ambiguous, not a
    // single confident match, so it must not arbitrarily pick one.
    expect(mapToneToEnum("confident but humble")).toBe(Tone.OTHER);
  });
});
