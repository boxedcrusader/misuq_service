import "reflect-metadata";
import Anthropic from "@anthropic-ai/sdk";
import { ConfigService } from "@nestjs/config";
import { execSync } from "node:child_process";
import { randomBytes, randomInt } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { ClaudeDraftingProvider } from "../src/modules/capture/drafting/claude-drafting.provider";
import { toDraftInput } from "../src/modules/capture/drafting/draft-input";
import { AnswerKey, Arm, ARMS, FORMAT_LABEL, FORMAT_TO_CHANNEL, LETTERS } from "./lib/arms";
import { CallBudget, estimateCalls, MAX_CALLS_PER_UPDATE, MAX_LLM_CALLS_PER_RUN, maxUpdatesPerRun } from "./lib/budget";
import { assertNotProduction, readEnvValue } from "./lib/env";
import { EvalInput, validateInput } from "./lib/input";
import { findLeaks, JudgeSheet, renderJudgeHtml } from "./lib/judge-html";
import { PLAIN_PROMPT_TEMPLATE, PLAIN_PROMPT_VERSION, plainPrompt, sha256 } from "./lib/plain-prompt";
import { checkDraft, Issue, renderSelfCheckMd } from "./lib/self-check";
import { buildAnswerKey } from "./lib/shuffle";

// npm run eval:generate -- [--input eval/updates.json] [--self-test] [--seed N] --yes
//
// Arm 1 "misuq": production's ClaudeDraftingProvider.generateDraft (the real
//   prompt, voice sample, format rules, invented-number check and one
//   corrective retry), fed by production's toDraftInput. Nothing copied.
// Arm 2 "plain": the same provider's own Anthropic client, with the exact
//   generation settings arm 1's request carried (copied from that request,
//   not restated), and only the bare PLAIN_PROMPT_TEMPLATE as the message.
// Arm 3 "founder": the founder's handwritten version from the input file.
//
// No database (no Prisma client, no Nest app), no HTTP API, so no AI caps
// are consumed and nothing is persisted. See eval/README.md.

const SERVICE_ROOT = path.join(__dirname, "..");
const RUNS_DIR = path.join(__dirname, "runs");
// The production files arm 1's prompt and checks come from: hashed into the
// run so a later prompt change is visible when comparing runs.
const MISUQ_SOURCE_FILES = [
  "src/modules/capture/drafting/draft-core.ts",
  "src/modules/capture/drafting/grounding.ts",
  "src/modules/capture/drafting/claude-drafting.provider.ts",
  "src/modules/capture/drafting/draft-input.ts",
];

interface Args {
  input: string;
  selfTest: boolean;
  yes: boolean;
  seed?: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { input: "eval/updates.json", selfTest: false, yes: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--yes") args.yes = true;
    else if (a === "--self-test") args.selfTest = true;
    else if (a === "--input") args.input = argv[++i];
    else if (a === "--seed") {
      const seed = Number(argv[++i]);
      if (!Number.isSafeInteger(seed) || seed < 0) throw new Error("--seed must be a non-negative integer");
      args.seed = seed;
    } else throw new Error(`unknown argument "${a}" (expected --input, --self-test, --seed, --yes)`);
  }
  if (!args.input) throw new Error("--input needs a path");
  return args;
}

// The generation settings that must match across arms 1 and 2. Prompt and
// response format are deliberately NOT here: they're what differs.
type BetaCreateParams = Anthropic.Beta.MessageCreateParamsNonStreaming;
function generationSettings(params: BetaCreateParams) {
  const p = params as unknown as Record<string, unknown>;
  const outputConfig = (p.output_config ?? {}) as Record<string, unknown>;
  return {
    model: p.model,
    max_tokens: p.max_tokens,
    // Sonnet 5.5 rejects sampling parameters, so production sets none: both
    // arms run at the model's default temperature.
    temperature: p.temperature ?? "not set (model default)",
    top_p: p.top_p ?? null,
    top_k: p.top_k ?? null,
    thinking: p.thinking ?? "not set (model default: adaptive)",
    effort: outputConfig.effort ?? null,
    betas: p.betas ?? [],
    fallbacks: p.fallbacks ?? null,
  };
}

interface RecordedRequest {
  updateId: string;
  arm: Arm;
  settings: ReturnType<typeof generationSettings>;
  responseFormat: string;
  prompt: string;
  promptSha256: string;
  stopReason: string | null;
  usage: unknown;
  error?: string;
  ms: number;
}

function gitInfo(): { commit: string | null; dirty: boolean | null } {
  try {
    const commit = execSync("git rev-parse HEAD", { cwd: SERVICE_ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    const dirty = execSync("git status --porcelain", { cwd: SERVICE_ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString().trim().length > 0;
    return { commit, dirty };
  } catch {
    return { commit: null, dirty: null };
  }
}

function textOf(message: Anthropic.Beta.BetaMessage): string {
  return message.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  assertNotProduction();

  const inputPath = path.resolve(SERVICE_ROOT, args.input);
  if (!fs.existsSync(inputPath)) throw new Error(`no input file at ${path.relative(SERVICE_ROOT, inputPath)} (copy eval/updates.example.json to start)`);
  const inputText = fs.readFileSync(inputPath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(inputText);
  } catch (e) {
    throw new Error(`${path.relative(SERVICE_ROOT, inputPath)} isn't valid JSON: ${(e as Error).message}`);
  }
  const validation = validateInput(parsed);
  if (!validation.ok) throw new Error(`input problems:\n  - ${validation.errors.join("\n  - ")}`);
  const input: EvalInput = validation.input;

  const n = input.updates.length;
  const estimate = estimateCalls(n);
  console.log(`\nM1 taste test: ${n} updates from ${path.relative(SERVICE_ROOT, inputPath)}${args.selfTest ? " (self-test)" : ""}`);
  console.log(
    `Estimated LLM calls: up to ${estimate} (${n} × [misuq up to ${MAX_CALLS_PER_UPDATE.misuq} + plain ${MAX_CALLS_PER_UPDATE.plain}]); cap ${MAX_LLM_CALLS_PER_RUN} per run.`,
  );
  console.log("The Anthropic SDK may re-send a failed request once (429/5xx/timeout); those aren't counted above.");
  if (estimate > MAX_LLM_CALLS_PER_RUN) {
    throw new Error(`that's over the cap of ${MAX_LLM_CALLS_PER_RUN}: use at most ${maxUpdatesPerRun()} updates per run`);
  }
  if (!args.yes) {
    console.log("\nNothing sent. Re-run with --yes to make these calls (npm run eval:generate -- --yes).");
    return;
  }

  const apiKey = readEnvValue("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY isn't set (environment or service/.env)");

  // Arm 1's provider, exactly as production builds it (capture.module.ts
  // passes the ConfigService; here it holds only the key).
  const provider = new ClaudeDraftingProvider(new ConfigService({ ANTHROPIC_API_KEY: apiKey }));
  // Its own Anthropic client: both arms use it (same key, timeout, retries),
  // and wrapping its create() is what counts every call against the cap and
  // records each request's settings.
  const client = (provider as unknown as { client?: Anthropic }).client;
  if (!client?.beta?.messages?.create) {
    throw new Error("ClaudeDraftingProvider no longer keeps its Anthropic client in `client`; update eval/generate.ts");
  }
  const budget = new CallBudget();
  const requests: RecordedRequest[] = [];
  let current: { updateId: string; arm: Arm } = { updateId: "", arm: "misuq" };
  // A copy of this update's first arm-1 request, to give arm 2 the very
  // same settings.
  let misuqParams: Record<string, unknown> | null = null;
  const original = client.beta.messages.create.bind(client.beta.messages) as (p: BetaCreateParams) => Promise<Anthropic.Beta.BetaMessage>;
  const counted = async (params: BetaCreateParams): Promise<Anthropic.Beta.BetaMessage> => {
    budget.take();
    if (current.arm === "misuq" && misuqParams === null) misuqParams = JSON.parse(JSON.stringify(params));
    const prompt = String((params.messages[0] as { content: unknown }).content);
    const format = ((params as unknown as { output_config?: { format?: { type?: string } } }).output_config?.format?.type) ?? "text";
    const base = { ...current, settings: generationSettings(params), responseFormat: format, prompt, promptSha256: sha256(prompt) };
    const started = Date.now();
    try {
      const response = await original(params);
      requests.push({ ...base, stopReason: response.stop_reason, usage: response.usage, ms: Date.now() - started });
      return response;
    } catch (error) {
      requests.push({ ...base, stopReason: null, usage: null, error: (error as Error).message, ms: Date.now() - started });
      throw error;
    }
  };
  (client.beta.messages as unknown as { create: typeof counted }).create = counted;

  type ArmDraft = { body: string; tone?: string; stopReason?: string | null; requests: number };
  const results: Array<{ update: EvalInput["updates"][number]; drafts: Record<Arm, ArmDraft> }> = [];

  for (const [i, u] of input.updates.entries()) {
    console.log(`\n[${i + 1}/${n}] ${u.id} (${u.type}, ${u.format})`);

    current = { updateId: u.id, arm: "misuq" };
    misuqParams = null;
    const before = requests.length;
    const draft = await provider.generateDraft(
      toDraftInput({
        rawCapture: u.raw,
        title: null,
        channel: FORMAT_TO_CHANNEL[u.format],
        voiceProfile: { styleSample: input.voiceSample },
        founderName: input.founderName ?? null,
      }),
    );
    const misuqRequests = requests.slice(before);
    const firstMisuq = misuqRequests.find((r) => !r.error);
    if (!firstMisuq) throw new Error(`misuq arm made no successful request for ${u.id}`);
    console.log(`  misuq: ${misuqRequests.length} call(s)`);

    // Arm 2: the first arm-1 request's own settings, the bare prompt, and no
    // response schema (a bare request gets plain text back).
    current = { updateId: u.id, arm: "plain" };
    if (!misuqParams) throw new Error(`no arm-1 request recorded for ${u.id} to copy settings from`);
    const template = misuqParams as Record<string, unknown>;
    const outputConfig = { ...((template.output_config as Record<string, unknown>) ?? {}) };
    delete outputConfig.format;
    const plainParams = {
      ...template,
      output_config: outputConfig,
      messages: [{ role: "user", content: plainPrompt(u.format, u.raw) }],
    } as unknown as BetaCreateParams;
    const plainResponse = await client.beta.messages.create(plainParams);
    if (plainResponse.stop_reason === "refusal") throw new Error(`plain arm was refused for ${u.id}`);
    const plainBody = textOf(plainResponse);
    console.log(`  plain: 1 call (stop: ${plainResponse.stop_reason})`);

    results.push({
      update: u,
      drafts: {
        misuq: { body: draft.body, tone: draft.tone, requests: misuqRequests.length },
        plain: { body: plainBody, stopReason: plainResponse.stop_reason, requests: 1 },
        founder: { body: u.founderVersion, requests: 0 },
      },
    });
  }

  // Arms 1 and 2 must have run with identical generation settings.
  const settingsSeen = [...new Set(requests.filter((r) => !r.error).map((r) => JSON.stringify(r.settings)))];
  if (settingsSeen.length !== 1) {
    throw new Error(`generation settings differed between requests:\n${settingsSeen.join("\n")}`);
  }
  const settings = JSON.parse(settingsSeen[0]);

  // Blind it.
  const seed = args.seed ?? randomInt(0, 2 ** 31);
  const key: AnswerKey = buildAnswerKey(seed, results.map((r) => r.update.id));
  const sheetId = randomBytes(6).toString("hex");
  const sheet: JudgeSheet = {
    sheetId,
    judge: input.judge,
    updates: results.map((r) => ({
      id: r.update.id,
      formatLabel: FORMAT_LABEL[r.update.format],
      isX: r.update.format === "x",
      raw: r.update.raw,
      drafts: Object.fromEntries(LETTERS.map((l) => [l, r.drafts[key[r.update.id][l]].body])) as JudgeSheet["updates"][number]["drafts"],
    })),
  };
  const html = renderJudgeHtml(sheet);
  const leaks = findLeaks(html, {
    content: [input.judge, ...sheet.updates.flatMap((u) => [u.id, u.raw, ...LETTERS.map((l) => u.drafts[l])])],
    forbidden: [
      ...ARMS,
      String(settings.model),
      "claude",
      "sonnet",
      "anthropic",
      "gemini",
      "temperature",
      "max_tokens",
      "effort",
      "fallbacks",
      "betas",
      "prompt",
      "seed",
      String(seed),
      PLAIN_PROMPT_VERSION,
      "Write a",
    ],
  });
  if (leaks.length > 0) throw new Error(`judge.html would leak: ${leaks.join(", ")}. Nothing written.`);

  // Proof of the no-database rule: nothing that talks to Postgres was loaded.
  const dbModules = Object.keys(require.cache).filter((p) => /[\\/]prisma[\\/]prisma\.service|[\\/]@nestjs[\\/]core[\\/]nest-factory/.test(p));
  if (dbModules.length > 0) throw new Error(`the harness loaded database/app modules: ${dbModules.join(", ")}`);

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runDir = path.join(RUNS_DIR, stamp);
  fs.mkdirSync(runDir, { recursive: true });
  const rel = path.relative(SERVICE_ROOT, runDir);

  const drafts = {
    harness: "m1-taste-test",
    createdAt: new Date().toISOString(),
    sheetId,
    seed,
    judge: input.judge,
    input: { path: path.relative(SERVICE_ROOT, inputPath), sha256: sha256(inputText), founderName: input.founderName ?? null },
    git: gitInfo(),
    generation: {
      identicalAcrossMisuqAndPlain: true,
      settings,
      arms: {
        misuq: {
          prompt: "production buildDraftPrompt via ClaudeDraftingProvider.generateDraft (voice sample, format rules, invented-number check, one corrective retry)",
          sourceFiles: MISUQ_SOURCE_FILES,
          sourceSha256: sha256(MISUQ_SOURCE_FILES.map((f) => fs.readFileSync(path.join(SERVICE_ROOT, f), "utf8")).join("\n")),
          responseFormat: "json_schema {body, tone}",
        },
        plain: {
          prompt: PLAIN_PROMPT_TEMPLATE,
          promptVersion: PLAIN_PROMPT_VERSION,
          promptSha256: sha256(PLAIN_PROMPT_TEMPLATE),
          responseFormat: "text",
        },
        founder: { prompt: null, note: "handwritten, from the input file; no generation" },
      },
    },
    llmCalls: { estimatedMax: estimate, made: budget.used, cap: MAX_LLM_CALLS_PER_RUN },
    updates: results.map((r) => ({
      id: r.update.id,
      type: r.update.type,
      format: r.update.format,
      raw: r.update.raw,
      letters: key[r.update.id],
      drafts: r.drafts,
    })),
    requests,
  };
  fs.writeFileSync(path.join(runDir, "drafts.json"), JSON.stringify(drafts, null, 2) + "\n");
  fs.writeFileSync(path.join(runDir, "answer-key.json"), JSON.stringify({ sheetId, seed, key }, null, 2) + "\n");
  fs.writeFileSync(path.join(runDir, "judge.html"), html);

  console.log(`\nWrote ${rel}/: judge.html (send this), drafts.json and answer-key.json (keep private).`);
  console.log(`LLM calls made: ${budget.used} of an estimated ${estimate} (cap ${MAX_LLM_CALLS_PER_RUN}).`);

  if (args.selfTest) {
    const issues: Issue[] = results.flatMap((r) =>
      ARMS.map((arm) => {
        const letter = LETTERS.find((l) => key[r.update.id][l] === arm)!;
        return checkDraft({
          updateId: r.update.id,
          arm,
          letter,
          format: r.update.format,
          body: r.drafts[arm].body,
          sources: [r.update.raw, input.founderName ?? ""],
          stopReason: r.drafts[arm].stopReason ?? null,
        });
      }).flat(),
    );
    fs.writeFileSync(path.join(runDir, "self-check.md"), renderSelfCheckMd(issues, { runDir: rel, drafts: results.length * ARMS.length }));
    console.log(`Self-check: ${issues.length === 0 ? "no breakage found" : `${issues.length} issue(s)`}; see ${rel}/self-check.md.`);
  }
}

main().catch((error) => {
  console.error(`\neval:generate failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
