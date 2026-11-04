import { ARMS } from "./arms";
import { buildAnswerKey, letterOf, mulberry32, shuffled } from "./shuffle";

const IDS = ["u1", "u2", "u3", "u4", "u5", "u6", "u7", "u8"];

describe("shuffle", () => {
  it("gives the same key for the same seed and updates", () => {
    expect(buildAnswerKey(12345, IDS)).toEqual(buildAnswerKey(12345, IDS));
  });

  it("gives a different key for a different seed", () => {
    expect(buildAnswerKey(12345, IDS)).not.toEqual(buildAnswerKey(54321, IDS));
  });

  it("maps A, B and C to all three arms, once each, for every update", () => {
    for (const mapping of Object.values(buildAnswerKey(7, IDS))) {
      expect(Object.keys(mapping).sort()).toEqual(["A", "B", "C"]);
      expect(Object.values(mapping).sort()).toEqual([...ARMS].sort());
    }
  });

  it("doesn't park an arm on one letter: over many updates each arm lands on every letter", () => {
    const ids = Array.from({ length: 60 }, (_, i) => `u${i}`);
    const key = buildAnswerKey(99, ids);
    for (const arm of ARMS) {
      const letters = new Set(ids.map((id) => letterOf(key[id], arm)));
      expect([...letters].sort()).toEqual(["A", "B", "C"]);
    }
  });

  it("is a pure function of its random source", () => {
    expect(shuffled([1, 2, 3, 4, 5], mulberry32(1))).toEqual(shuffled([1, 2, 3, 4, 5], mulberry32(1)));
    expect(shuffled([1, 2, 3, 4, 5], mulberry32(1)).sort()).toEqual([1, 2, 3, 4, 5]);
  });
});
