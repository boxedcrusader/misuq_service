import { AnswerKey, Arm, ARMS, Letter, LETTERS } from "./arms";

// The pre-registered M1 pass bar. Written down before any result is seen;
// changing it after a run would make the run meaningless.
//
//   PASS = misuq beats plain on >= 80% of updates (4 of 5)
//      AND misuq is at least as good as the founder on >= 50% of updates.
//
// Per update, "misuq beats plain" is decided like this:
//   1. by the favorite: misuq picked = win, plain picked = loss;
//   2. if the founder's version was the favorite, by "post as-is":
//      misuq yes and plain no = win; plain yes and misuq no = loss;
//   3. anything else is a TIE, and a tie is not a win: it counts against
//      the bar ("a tie with plain counts as FAIL").
//
// "misuq at least as good as the founder" per update: misuq was the
// favorite, OR misuq's "post as-is" is at least the founder's (yes when the
// founder's was yes; anything when the founder's was no).
export const BEATS_PLAIN_SHARE = 0.8;
export const AT_LEAST_FOUNDER_SHARE = 0.5;

export interface JudgeAnswer {
  id: string;
  favorite: Letter;
  postAsIs: Record<Letter, boolean>;
  comment?: string;
}

export interface JudgeResults {
  sheet: string;
  judge?: string;
  answers: JudgeAnswer[];
}

export type HeadToHead = "win" | "loss" | "tie";

export interface UpdateScore {
  id: string;
  favorite: Arm;
  postAsIs: Record<Arm, boolean>;
  misuqVsPlain: HeadToHead;
  decidedBy: "favorite" | "post as-is" | "tie";
  misuqAtLeastFounder: boolean;
  comment: string;
}

export interface Score {
  updates: UpdateScore[];
  total: number;
  misuqBeatsPlain: number;
  plainBeatsMisuq: number;
  ties: number;
  misuqAtLeastFounder: number;
  sendAsIs: Record<Arm, { yes: number; rate: number }>;
  favorites: Record<Arm, number>;
  beatsPlainPass: boolean;
  atLeastFounderPass: boolean;
  pass: boolean;
}

// Every problem at once. Results must come from this run's sheet and answer
// every update completely.
export function validateResults(data: unknown, sheetId: string, key: AnswerKey): { ok: true; results: JudgeResults } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!data || typeof data !== "object" || Array.isArray(data)) return { ok: false, errors: ["results must be a JSON object"] };
  const obj = data as Record<string, unknown>;
  if (obj.sheet !== sheetId) errors.push(`these results are for sheet "${String(obj.sheet)}", not this run's sheet "${sheetId}"`);
  if (!Array.isArray(obj.answers)) return { ok: false, errors: [...errors, `"answers" must be an array`] };

  const byId = new Map<string, unknown>();
  for (const a of obj.answers) {
    const id = a && typeof a === "object" ? (a as Record<string, unknown>).id : undefined;
    if (typeof id !== "string") {
      errors.push("an answer has no id");
      continue;
    }
    if (byId.has(id)) errors.push(`update "${id}" is answered twice`);
    byId.set(id, a);
  }
  for (const id of byId.keys()) if (!key[id]) errors.push(`update "${id}" isn't in this run`);

  for (const id of Object.keys(key)) {
    const a = byId.get(id) as Record<string, unknown> | undefined;
    if (!a) {
      errors.push(`update "${id}" has no answer`);
      continue;
    }
    if (!(LETTERS as readonly unknown[]).includes(a.favorite)) errors.push(`update "${id}": favorite must be A, B or C`);
    const asIs = a.postAsIs as Record<string, unknown> | undefined;
    for (const l of LETTERS) {
      if (!asIs || typeof asIs[l] !== "boolean") errors.push(`update "${id}": "post as-is" for ${l} must be true or false`);
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, results: obj as unknown as JudgeResults };
}

export function scoreRun(key: AnswerKey, results: JudgeResults): Score {
  const answers = new Map(results.answers.map((a) => [a.id, a]));
  const updates: UpdateScore[] = Object.keys(key).map((id) => {
    const mapping = key[id];
    const answer = answers.get(id);
    if (!answer) throw new Error(`no answer for update ${id}`);
    const favorite = mapping[answer.favorite];
    const postAsIs = Object.fromEntries(LETTERS.map((l) => [mapping[l], answer.postAsIs[l]])) as Record<Arm, boolean>;

    let misuqVsPlain: HeadToHead;
    let decidedBy: UpdateScore["decidedBy"];
    if (favorite === "misuq" || favorite === "plain") {
      misuqVsPlain = favorite === "misuq" ? "win" : "loss";
      decidedBy = "favorite";
    } else if (postAsIs.misuq !== postAsIs.plain) {
      misuqVsPlain = postAsIs.misuq ? "win" : "loss";
      decidedBy = "post as-is";
    } else {
      misuqVsPlain = "tie";
      decidedBy = "tie";
    }

    const misuqAtLeastFounder = favorite === "misuq" || postAsIs.misuq || !postAsIs.founder;
    return { id, favorite, postAsIs, misuqVsPlain, decidedBy, misuqAtLeastFounder, comment: answer.comment ?? "" };
  });

  const total = updates.length;
  const count = (pred: (u: UpdateScore) => boolean) => updates.filter(pred).length;
  const misuqBeatsPlain = count((u) => u.misuqVsPlain === "win");
  const misuqAtLeastFounder = count((u) => u.misuqAtLeastFounder);
  const sendAsIs = Object.fromEntries(
    ARMS.map((arm) => {
      const yes = count((u) => u.postAsIs[arm]);
      return [arm, { yes, rate: total === 0 ? 0 : yes / total }];
    }),
  ) as Score["sendAsIs"];
  const favorites = Object.fromEntries(ARMS.map((arm) => [arm, count((u) => u.favorite === arm)])) as Score["favorites"];

  // Compared as counts against the share of total, so 4/5 = 0.8 passes
  // without floating-point doubt.
  const beatsPlainPass = total > 0 && misuqBeatsPlain >= Math.ceil(BEATS_PLAIN_SHARE * total - 1e-9);
  const atLeastFounderPass = total > 0 && misuqAtLeastFounder >= Math.ceil(AT_LEAST_FOUNDER_SHARE * total - 1e-9);

  return {
    updates,
    total,
    misuqBeatsPlain,
    plainBeatsMisuq: count((u) => u.misuqVsPlain === "loss"),
    ties: count((u) => u.misuqVsPlain === "tie"),
    misuqAtLeastFounder,
    sendAsIs,
    favorites,
    beatsPlainPass,
    atLeastFounderPass,
    pass: beatsPlainPass && atLeastFounderPass,
  };
}

function pct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

export function renderScoreMd(score: Score, meta: { runDir: string; judge: string; model: string }): string {
  const need = (share: number) => Math.ceil(share * score.total - 1e-9);
  const lines = [
    `# M1 taste test: ${score.pass ? "PASS" : "FAIL"}`,
    "",
    `Run \`${meta.runDir}\` · judge ${meta.judge} · ${score.total} updates · model ${meta.model}`,
    "",
    "## Against the pre-registered bar",
    "",
    `| Test | Result | Needed | |`,
    `|---|---|---|---|`,
    `| misuq beats plain | ${score.misuqBeatsPlain} of ${score.total} (${score.plainBeatsMisuq} losses, ${score.ties} ties) | ${need(BEATS_PLAIN_SHARE)} (≥${pct(BEATS_PLAIN_SHARE)}) | ${score.beatsPlainPass ? "pass" : "FAIL"} |`,
    `| misuq at least as good as the founder | ${score.misuqAtLeastFounder} of ${score.total} | ${need(AT_LEAST_FOUNDER_SHARE)} (≥${pct(AT_LEAST_FOUNDER_SHARE)}) | ${score.atLeastFounderPass ? "pass" : "FAIL"} |`,
    "",
    "Ties with plain count as not beating it.",
    "",
    "## Send-as-is rate per arm",
    "",
    `| Arm | Would post as-is | Picked as favorite |`,
    `|---|---|---|`,
    ...ARMS.map((arm) => `| ${arm} | ${score.sendAsIs[arm].yes} of ${score.total} (${pct(score.sendAsIs[arm].rate)}) | ${score.favorites[arm]} |`),
    "",
    "## Per update",
    "",
    `| Update | Favorite | As-is: misuq / plain / founder | misuq vs plain | Decided by | misuq ≥ founder | Comment |`,
    `|---|---|---|---|---|---|---|`,
    ...score.updates.map(
      (u) =>
        `| ${u.id} | ${u.favorite} | ${[u.postAsIs.misuq, u.postAsIs.plain, u.postAsIs.founder].map((b) => (b ? "yes" : "no")).join(" / ")} | ${u.misuqVsPlain} | ${u.decidedBy} | ${u.misuqAtLeastFounder ? "yes" : "no"} | ${u.comment.replace(/\|/g, "\\|").replace(/\n/g, " ")} |`,
    ),
    "",
  ];
  return lines.join("\n");
}
