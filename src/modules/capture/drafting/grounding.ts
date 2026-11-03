// Finds numbers in a draft that don't appear in the founder's own words.
//
// Why numbers: they're the fabrication that does the most damage (a founder
// skimming before send won't notice "three people hit the same bug" was
// invented, but their audience might) and the only kind a deterministic check
// can catch reliably. Invented names/events are handled by the prompt's FACTS
// rule, not here.
//
// Deliberately simple, tuned to under-flag rather than over-flag: "one" is
// never checked ("no one", "the one thing" are everywhere), and digits are
// compared as normalized strings, so "14" in the capture grounds "fourteen"
// in the draft and "100" grounds "100th".

const WORD_VALUES: Record<string, number> = {
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40,
  fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100,
  thousand: 1000, million: 1_000_000, dozen: 12,
};

const TENS = new Set([20, 30, 40, 50, 60, 70, 80, 90]);

interface NumberMention {
  text: string; // as written, for reporting
  value: string; // normalized, for comparison
}

function mentions(text: string): NumberMention[] {
  const found: NumberMention[] = [];
  const lower = text.toLowerCase();

  // Digits, incl. 1,200 / 4.5 / 4:00 / 70% / 100th / 4k.
  for (const m of lower.matchAll(/\d+(?:[.,:]\d+)*(k\b)?/g)) {
    let value = m[0].replace(/k$/, "").replace(/,/g, "");
    if (m[1] && /^\d+(\.\d+)?$/.test(value)) value = String(Math.round(parseFloat(value) * 1000));
    found.push({ text: m[0], value });
  }

  // Number words, incl. hyphenated tens-ones ("twenty-five") and a trailing
  // multiplier ("twelve hundred" = 1200, "two thousand" = 2000), so a draft
  // spelling out the capture's "1,200" isn't flagged as two invented numbers.
  const words = [...lower.matchAll(/\b[a-z]+(?:-[a-z]+)?\b/g)].map((m) => m[0]);
  for (let i = 0; i < words.length; i++) {
    const [head, tail] = words[i].split("-");
    const first = WORD_VALUES[head];
    if (first === undefined) continue;
    const second = tail !== undefined ? WORD_VALUES[tail] : undefined;
    let value = TENS.has(first) && second !== undefined && second < 10 ? first + second : first;
    let text = words[i];
    const multiplier = MULTIPLIERS[words[i + 1]];
    if (multiplier !== undefined && value < multiplier) {
      value *= multiplier;
      text = `${text} ${words[i + 1]}`;
      i++; // the multiplier word is consumed, not a separate mention
    }
    found.push({ text, value: String(value) });
  }
  return found;
}

const MULTIPLIERS: Record<string, number> = { hundred: 100, thousand: 1000, million: 1_000_000 };

export function findUngroundedNumbers(draft: string, sources: string[]): string[] {
  const grounded = new Set(sources.flatMap((s) => mentions(s).map((m) => m.value)));
  const ungrounded = mentions(draft)
    .filter((m) => !grounded.has(m.value))
    .map((m) => m.text);
  return [...new Set(ungrounded)];
}
