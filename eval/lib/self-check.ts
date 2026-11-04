import { findUngroundedNumbers } from "../../src/modules/capture/drafting/grounding";
import { X_MAX_CHARS, xLength } from "../../src/modules/capture/drafting/draft-core";
import { Arm, InputFormat, Letter } from "./arms";

// --self-test: flags BREAKAGE only (things that make a draft unpostable or a
// run untrustworthy), never quality. Uses production's own number check
// (grounding.ts) so "invented number" means the same thing here as in the
// product.
export const LINKEDIN_MAX_CHARS = 3000;
const MIN_PLAUSIBLE_CHARS = 20;

export interface DraftToCheck {
  updateId: string;
  arm: Arm;
  letter: Letter;
  format: InputFormat;
  body: string;
  // What the draft may take numbers from: the update (and the sign-off name).
  sources: string[];
  // From the model response, when there was one; "max_tokens" = cut off.
  stopReason?: string | null;
}

export interface Issue {
  updateId: string;
  arm: Arm;
  letter: Letter;
  problem: string;
}

const FORMAT_PATTERNS: Array<{ test: (body: string, format: InputFormat) => boolean; problem: string }> = [
  { test: (b) => /^\s*(here(?:'|’)s|here is|here are|sure[,!.]|certainly|of course)\b/i.test(b), problem: "starts with a preamble (\"Here's…\"), not the post itself" },
  { test: (b) => /\b(option|version|variation)\s*(1|2|one|two)\b/i.test(b), problem: "offers several options instead of one post" },
  { test: (b) => /\[(your|name|link|insert|company|product|url)[^\]]*\]/i.test(b), problem: "has a placeholder to fill in (e.g. [Your Name])" },
  { test: (b) => /\*\*[^*\n]+\*\*|^#{1,6}\s/m.test(b) || /\[[^\]\n]+\]\([^)\s]+\)/.test(b), problem: "has markdown that X, LinkedIn and email show as literal symbols" },
  { test: (b, f) => f === "x" && (/🧵/.test(b) || /^\s*\d+\s*\/\s*\d*\s*$/m.test(b) || /(^|\s)1\/\d*(\s|$)/.test(b)), problem: "looks like a thread, not one X post" },
];

export function checkDraft(d: DraftToCheck): Issue[] {
  const issues: string[] = [];
  const body = d.body ?? "";
  const trimmed = body.trim();
  if (trimmed.length === 0) {
    issues.push("empty");
  } else {
    if (d.stopReason === "max_tokens") issues.push("truncated (the model hit its token limit)");
    else if (trimmed.length < MIN_PLAUSIBLE_CHARS) issues.push(`suspiciously short (${trimmed.length} characters)`);

    // A numbered list's "1." / "**2.**" / "3)" markers are layout, not
    // claims: drop them so only factual numbers are checked.
    // Same for "Option 1" / "Version 2" labels (flagged below as offering
    // several options).
    const withoutLabels = body
      .replace(/^[ \t]*(\*\*|__)?\d{1,2}[.)](\*\*|__)?(?=\s)/gm, "")
      .replace(/\b(option|version|variation|take|draft)s?\s*#?\d{1,2}(\s*(,|or|and|&)\s*#?\d{1,2})*\b/gi, "$1");
    const invented = findUngroundedNumbers(withoutLabels, d.sources);
    if (invented.length > 0) issues.push(`numbers not in the update: ${invented.map((n) => `"${n}"`).join(", ")}`);

    if (d.format === "x" && xLength(body) > X_MAX_CHARS) issues.push(`X post is ${xLength(body)} characters (limit ${X_MAX_CHARS})`);
    if (d.format === "linkedin" && [...body].length > LINKEDIN_MAX_CHARS) {
      issues.push(`LinkedIn post is ${[...body].length} characters (limit ${LINKEDIN_MAX_CHARS})`);
    }
    for (const p of FORMAT_PATTERNS) if (p.test(body, d.format)) issues.push(p.problem);
  }
  return issues.map((problem) => ({ updateId: d.updateId, arm: d.arm, letter: d.letter, problem }));
}

export function renderSelfCheckMd(issues: Issue[], meta: { runDir: string; drafts: number }): string {
  const byArm = (arm: Arm) => issues.filter((i) => i.arm === arm).length;
  const lines = [
    `# Self-check: ${issues.length === 0 ? "no breakage found" : `${issues.length} issue${issues.length === 1 ? "" : "s"}`}`,
    "",
    `Run \`${meta.runDir}\` · ${meta.drafts} drafts checked. Breakage only (empty or cut-off drafts, numbers not in the update, X posts over ${X_MAX_CHARS} characters, format violations); no quality judgments.`,
    "",
    "Un-blinded: don't send this file to the judge.",
    "",
    `| Arm | Issues |`,
    `|---|---|`,
    `| misuq | ${byArm("misuq")} |`,
    `| plain | ${byArm("plain")} |`,
    `| founder | ${byArm("founder")} |`,
    "",
  ];
  if (issues.length > 0) {
    lines.push(`| Update | Letter | Arm | Problem |`, `|---|---|---|---|`);
    for (const i of issues) lines.push(`| ${i.updateId} | ${i.letter} | ${i.arm} | ${i.problem.replace(/\|/g, "\\|")} |`);
    lines.push("");
    lines.push("A founder's version can legitimately add numbers the update doesn't have; those flags are for information.");
    lines.push("");
  }
  return lines.join("\n");
}
