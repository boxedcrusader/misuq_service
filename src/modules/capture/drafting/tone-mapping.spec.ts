import { Tone } from "@prisma/client";
import { DRAFT_TONES, TONE_DEFINITIONS, parseDraftTone } from "./tone-mapping";

// Gemini now picks the post's angle from a fixed list (schema-constrained);
// this parser is the last line of defense if it ever goes off-schema.
describe("parseDraftTone", () => {
  it("accepts every real angle name, case- and whitespace-tolerant", () => {
    for (const tone of DRAFT_TONES) {
      expect(parseDraftTone(tone)).toBe(tone);
      expect(parseDraftTone(`  ${tone.toLowerCase()} `)).toBe(tone);
    }
  });

  it("never lets OTHER in as a chosen angle — it isn't one", () => {
    expect(DRAFT_TONES).not.toContain(Tone.OTHER);
    expect(parseDraftTone("OTHER")).toBe(Tone.OTHER);
  });

  it.each([
    ["the old free-text voice labels", "understated and practical"],
    ["a near-miss", "celebratory!"],
    ["empty", ""],
    ["a number", 3],
    ["null", null],
    ["undefined", undefined],
  ])("falls back to OTHER (uncategorized, never pooled) for %s", (_label, raw) => {
    expect(parseDraftTone(raw)).toBe(Tone.OTHER);
  });

  it("defines every non-OTHER Tone exactly once, so prompt and schema can't drift from the enum", () => {
    const enumAngles = Object.values(Tone).filter((t) => t !== Tone.OTHER).sort();
    expect([...DRAFT_TONES].sort()).toEqual(enumAngles);
    expect(Object.values(TONE_DEFINITIONS).every((d) => d.trim().length > 0)).toBe(true);
  });
});
