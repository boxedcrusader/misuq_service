import * as fs from "node:fs";
import * as path from "node:path";
import { AnswerKey } from "./lib/arms";
import { renderScoreMd, scoreRun, validateResults } from "./lib/scoring";
import { buildAnswerKey } from "./lib/shuffle";

// npm run eval:score -- <runDir> <results.json>
//
// Un-blinds the judge's pasted results with the run's answer key and scores
// them against the pre-registered bar (lib/scoring.ts). Writes score.md into
// the run directory. Offline: no model calls, no database.

const SERVICE_ROOT = path.join(__dirname, "..");

function readJson(file: string, what: string): unknown {
  if (!fs.existsSync(file)) throw new Error(`no ${what} at ${file}`);
  const text = fs.readFileSync(file, "utf8");
  try {
    return JSON.parse(text);
  } catch {
    // The judge pastes from a chat: tolerate text around the JSON blob.
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        /* fall through */
      }
    }
    throw new Error(`${what} at ${file} isn't valid JSON`);
  }
}

function main(): void {
  const [runArg, resultsArg] = process.argv.slice(2);
  if (!runArg || !resultsArg) throw new Error("usage: npm run eval:score -- <runDir> <results.json>");
  const runDir = path.resolve(SERVICE_ROOT, runArg);
  const resultsPath = path.resolve(SERVICE_ROOT, resultsArg);

  const drafts = readJson(path.join(runDir, "drafts.json"), "drafts.json") as {
    sheetId: string;
    seed: number;
    judge: string;
    generation: { settings: { model: string } };
    updates: Array<{ id: string }>;
  };
  const answerKey = readJson(path.join(runDir, "answer-key.json"), "answer-key.json") as { sheetId: string; seed: number; key: AnswerKey };

  // The key must be the one this run's seed produces, for this run's sheet.
  if (answerKey.sheetId !== drafts.sheetId) throw new Error("answer-key.json belongs to a different sheet than drafts.json");
  const rederived = buildAnswerKey(answerKey.seed, drafts.updates.map((u) => u.id));
  if (JSON.stringify(rederived) !== JSON.stringify(answerKey.key)) {
    throw new Error("answer-key.json doesn't match what its seed produces: it was edited or belongs to another run");
  }

  const validation = validateResults(readJson(resultsPath, "results"), drafts.sheetId, answerKey.key);
  if (!validation.ok) throw new Error(`results problems:\n  - ${validation.errors.join("\n  - ")}`);

  const score = scoreRun(answerKey.key, validation.results);
  const md = renderScoreMd(score, { runDir: path.relative(SERVICE_ROOT, runDir), judge: drafts.judge, model: drafts.generation.settings.model });
  fs.writeFileSync(path.join(runDir, "score.md"), md);

  const line = (label: string, value: string) => console.log(`  ${label.padEnd(38)} ${value}`);
  console.log(`\nM1 taste test (${score.total} updates, judge ${drafts.judge})`);
  line("misuq vs plain (wins / losses / ties)", `${score.misuqBeatsPlain} / ${score.plainBeatsMisuq} / ${score.ties}`);
  line("misuq at least as good as founder", `${score.misuqAtLeastFounder} of ${score.total}`);
  for (const arm of ["misuq", "plain", "founder"] as const) {
    line(`send-as-is: ${arm}`, `${score.sendAsIs[arm].yes} of ${score.total} (${Math.round(score.sendAsIs[arm].rate * 100)}%)`);
  }
  console.log(`\n  ${score.pass ? "PASS" : "FAIL"}: beats plain ${score.beatsPlainPass ? "met" : "not met"} (needs ≥80%), at least as good as founder ${score.atLeastFounderPass ? "met" : "not met"} (needs ≥50%).`);
  console.log(`\nWrote ${path.relative(SERVICE_ROOT, path.join(runDir, "score.md"))}`);
}

try {
  main();
} catch (error) {
  console.error(`\neval:score failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
