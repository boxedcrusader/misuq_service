import { ConfigService } from "@nestjs/config";

// Which model provider backs each LLM step — swappable per step, as README §4
// requires. Read at boot by capture.module.ts (DRAFTING_LLM) and
// report-back.module.ts (EXTRACTION_LLM).
//
// Defaults to gemini so local dev keeps working on the free-tier Gemini key
// with no Anthropic key; production sets claude explicitly (render.yaml). An
// unknown value fails at boot rather than silently picking one.
export type LlmProvider = "claude" | "gemini";

export function selectLlm(config: ConfigService, key: "DRAFTING_LLM" | "EXTRACTION_LLM"): LlmProvider {
  const raw = (config.get<string>(key) ?? "gemini").trim().toLowerCase();
  if (raw === "claude" || raw === "gemini") return raw;
  throw new Error(`${key} must be "claude" or "gemini", got ${JSON.stringify(raw)}`);
}
