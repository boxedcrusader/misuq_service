import { AnswerKey, Arm, ARMS, LETTERS } from "./arms";

// Seeded, so a run's A/B/C order can be re-derived from drafts.json's seed
// (and checked), but can't be guessed from judge.html, which never has it.

// mulberry32: tiny, well-distributed 32-bit PRNG. Not cryptographic, and
// doesn't need to be: the judge never sees the seed.
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Fisher-Yates with the given random source.
export function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// One stream for the whole run, consumed in input order: same seed + same
// update ids in the same order = the same key.
export function buildAnswerKey(seed: number, updateIds: readonly string[]): AnswerKey {
  const random = mulberry32(seed);
  const key: AnswerKey = {};
  for (const id of updateIds) {
    const order = shuffled<Arm>(ARMS, random);
    key[id] = { A: order[0], B: order[1], C: order[2] };
  }
  return key;
}

export function letterOf(mapping: AnswerKey[string], arm: Arm): (typeof LETTERS)[number] {
  const letter = LETTERS.find((l) => mapping[l] === arm);
  if (!letter) throw new Error(`arm ${arm} missing from mapping`);
  return letter;
}
