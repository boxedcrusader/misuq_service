import { AnswerKey, Letter } from "./arms";
import { JudgeResults, scoreRun, validateResults } from "./scoring";

// A fixed key: A=misuq, B=plain, C=founder for every update, so each test
// reads plainly. (Real runs shuffle; scoring only goes through the key.)
const IDS = ["u1", "u2", "u3", "u4", "u5"];
const KEY: AnswerKey = Object.fromEntries(IDS.map((id) => [id, { A: "misuq", B: "plain", C: "founder" }]));

type Pick = { fav: Letter; asIs?: [boolean, boolean, boolean] };
function results(picks: Pick[]): JudgeResults {
  return {
    sheet: "s1",
    answers: picks.map((p, i) => ({
      id: IDS[i],
      favorite: p.fav,
      postAsIs: { A: p.asIs?.[0] ?? true, B: p.asIs?.[1] ?? true, C: p.asIs?.[2] ?? true },
    })),
  };
}

describe("scoreRun: the pre-registered bar", () => {
  it("passes when misuq is the favorite on 4 of 5 and at least as good as the founder on half", () => {
    const score = scoreRun(KEY, results([{ fav: "A" }, { fav: "A" }, { fav: "A" }, { fav: "A" }, { fav: "B" }]));
    expect(score.misuqBeatsPlain).toBe(4);
    expect(score.beatsPlainPass).toBe(true);
    expect(score.pass).toBe(true);
  });

  it("fails on 3 of 5 against plain", () => {
    const score = scoreRun(KEY, results([{ fav: "A" }, { fav: "A" }, { fav: "A" }, { fav: "B" }, { fav: "B" }]));
    expect(score.misuqBeatsPlain).toBe(3);
    expect(score.pass).toBe(false);
  });

  it("counts a tie with plain as not a win, so ties fail the bar", () => {
    // u4, u5: the founder's version is the favorite and misuq and plain got
    // the same "post as-is" answer: a tie each time.
    const score = scoreRun(
      KEY,
      results([{ fav: "A" }, { fav: "A" }, { fav: "A" }, { fav: "C", asIs: [true, true, true] }, { fav: "C", asIs: [false, false, true] }]),
    );
    expect(score.ties).toBe(2);
    expect(score.misuqBeatsPlain).toBe(3);
    expect(score.updates[3]).toMatchObject({ misuqVsPlain: "tie", decidedBy: "tie" });
    expect(score.beatsPlainPass).toBe(false);
    expect(score.pass).toBe(false);
  });

  it("falls back to 'post as-is' when the founder's version is the favorite", () => {
    const score = scoreRun(KEY, results([{ fav: "C", asIs: [true, false, true] }, { fav: "C", asIs: [false, true, true] }, { fav: "A" }, { fav: "A" }, { fav: "A" }]));
    expect(score.updates[0]).toMatchObject({ misuqVsPlain: "win", decidedBy: "post as-is" });
    expect(score.updates[1]).toMatchObject({ misuqVsPlain: "loss", decidedBy: "post as-is" });
  });

  it("all ties with plain is a FAIL even though plain never won", () => {
    const score = scoreRun(KEY, results(IDS.map(() => ({ fav: "C" as Letter, asIs: [true, true, true] as [boolean, boolean, boolean] }))));
    expect(score.plainBeatsMisuq).toBe(0);
    expect(score.ties).toBe(5);
    expect(score.pass).toBe(false);
  });

  it("judges misuq against the founder: picked, or 'post as-is' at least the founder's", () => {
    const score = scoreRun(
      KEY,
      results([
        { fav: "A", asIs: [false, false, true] }, // picked: counts
        { fav: "C", asIs: [true, false, true] }, // both postable: counts
        { fav: "C", asIs: [false, false, true] }, // founder postable, misuq not: doesn't
        { fav: "B", asIs: [false, true, false] }, // neither postable: equal, counts
        { fav: "C", asIs: [false, true, true] }, // doesn't
      ]),
    );
    expect(score.updates.map((u) => u.misuqAtLeastFounder)).toEqual([true, true, false, true, false]);
    expect(score.misuqAtLeastFounder).toBe(3);
    expect(score.atLeastFounderPass).toBe(true);
  });

  it("fails the founder test below half, even when misuq never loses to plain", () => {
    const score = scoreRun(
      KEY,
      results([
        { fav: "C", asIs: [false, false, true] }, // founder postable, misuq not
        { fav: "C", asIs: [false, false, true] },
        { fav: "C", asIs: [false, false, true] },
        { fav: "A" },
        { fav: "A" },
      ]),
    );
    expect(score.plainBeatsMisuq).toBe(0);
    expect(score.misuqAtLeastFounder).toBe(2);
    expect(score.atLeastFounderPass).toBe(false);
    expect(score.pass).toBe(false);
  });

  it("reports the send-as-is rate per arm, through the shuffled key", () => {
    const shuffledKey: AnswerKey = { ...KEY, u1: { A: "founder", B: "misuq", C: "plain" } };
    const score = scoreRun(shuffledKey, results([{ fav: "B", asIs: [true, false, false] }, { fav: "A" }, { fav: "A" }, { fav: "A" }, { fav: "A" }]));
    // u1: A (founder) yes, B (misuq) no, C (plain) no; the rest all yes.
    expect(score.sendAsIs.founder.yes).toBe(5);
    expect(score.sendAsIs.misuq.yes).toBe(4);
    expect(score.sendAsIs.plain.yes).toBe(4);
    expect(score.sendAsIs.misuq.rate).toBeCloseTo(0.8);
    expect(score.updates[0].favorite).toBe("misuq");
  });

  it("scales the bar: 8 of 10 passes, 7 of 10 fails", () => {
    const ids = Array.from({ length: 10 }, (_, i) => `v${i}`);
    const key: AnswerKey = Object.fromEntries(ids.map((id) => [id, { A: "misuq", B: "plain", C: "founder" }]));
    const run = (wins: number) =>
      scoreRun(key, {
        sheet: "s",
        answers: ids.map((id, i) => ({ id, favorite: (i < wins ? "A" : "B") as Letter, postAsIs: { A: true, B: true, C: true } })),
      });
    expect(run(8).beatsPlainPass).toBe(true);
    expect(run(7).beatsPlainPass).toBe(false);
  });
});

describe("validateResults", () => {
  it("accepts complete results for this sheet", () => {
    expect(validateResults(results(IDS.map(() => ({ fav: "A" as Letter }))), "s1", KEY).ok).toBe(true);
  });

  it("rejects results from another sheet, missing or partial answers, and unknown updates", () => {
    const bad = {
      sheet: "other",
      answers: [
        { id: "u1", favorite: "D", postAsIs: { A: true, B: true, C: true } },
        { id: "u2", favorite: "A", postAsIs: { A: true, B: null, C: true } },
        { id: "zz", favorite: "A", postAsIs: { A: true, B: true, C: true } },
      ],
    };
    const v = validateResults(bad, "s1", KEY);
    expect(v.ok).toBe(false);
    if (v.ok) return;
    const all = v.errors.join("\n");
    expect(all).toMatch(/not this run's sheet/);
    expect(all).toMatch(/u1.*favorite must be A, B or C/);
    expect(all).toMatch(/u2.*"post as-is" for B/);
    expect(all).toMatch(/"zz" isn't in this run/);
    expect(all).toMatch(/"u3" has no answer/);
  });
});
