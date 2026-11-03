import Anthropic from "@anthropic-ai/sdk";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DraftingProvider, GenerateDraftInput } from "./drafting.provider";
import { DraftGenerationFailedException } from "./draft-generation-failed.exception";
import {
  DRAFT_BODY_DESCRIPTION,
  DRAFT_TONE_DESCRIPTION,
  DraftResult,
  generateGroundedDraft,
  parseDraftJson,
} from "./draft-core";
import { DRAFT_TONES } from "./tone-mapping";

// Claude Sonnet 5.5 for drafting (decision 2026-11-03): README §4 names
// "upgrade drafting to Claude if output sounds generic" as the trigger, and
// Gemini Flash-Lite's drafts were honest but thin and largely ignored the
// founder's voice sample. Low effort: a short post from a short update isn't
// hard reasoning, and thinking tokens bill as output.
const MODEL = "claude-sonnet-5-5";
const EFFORT = "low" as const;
// Per attempt; the SDK retries 408/409/429/5xx and connection errors
// (maxRetries) before this provider ever sees a failure.
const TIMEOUT_MS = 60_000;
const MAX_RETRIES = 2;
// Generous ceiling, not a target: billed on what's actually generated, and
// a low cap risks truncating mid-JSON.
const MAX_TOKENS = 16_000;

// Server-side refusal fallback, on by default for Sonnet 5.5 (Claude API
// guidance). For Sonnet 5.5 it re-runs only "cyber" and "frontier_llm"
// declines (on Claude Sonnet 5), which a marketing post shouldn't trigger — so
// it's insurance, not a behavior change. Any other decline still comes back
// as stop_reason "refusal" and is handled below.
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

// Same contract as the Gemini schema: tone constrained to the real angles
// (never OTHER). additionalProperties: false is required on every object for
// structured outputs.
const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    body: { type: "string", description: DRAFT_BODY_DESCRIPTION },
    tone: { type: "string", enum: DRAFT_TONES, description: DRAFT_TONE_DESCRIPTION },
  },
  required: ["body", "tone"],
  additionalProperties: false,
};

// ClaudeDraftingProvider — selected by DRAFTING_LLM=claude in
// capture.module.ts. The prompt and the invented-number backstop are shared
// with GeminiDraftingProvider (draft-core.ts); this class only makes the call.
@Injectable()
export class ClaudeDraftingProvider implements DraftingProvider {
  private readonly logger = new Logger(ClaudeDraftingProvider.name);
  private readonly client: Anthropic;

  constructor(configService: ConfigService) {
    // getOrThrow: a missing key fails at boot, not on the first draft.
    const apiKey = configService.getOrThrow<string>("ANTHROPIC_API_KEY");
    this.client = new Anthropic({ apiKey, timeout: TIMEOUT_MS, maxRetries: MAX_RETRIES });
  }

  generateDraft(input: GenerateDraftInput): Promise<DraftResult> {
    return generateGroundedDraft(input, (prompt) => this.attempt(prompt), this.logger);
  }

  private async attempt(prompt: string): Promise<DraftResult> {
    let response: Anthropic.Beta.BetaMessage;
    try {
      response = await this.client.beta.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        betas: [FALLBACK_BETA],
        fallbacks: "default",
        // Thinking is omitted on purpose: Sonnet 5.5 runs adaptive thinking by
        // default, and effort is the cost control. No temperature — Sonnet
        // 5.5 rejects non-default sampling parameters.
        output_config: { effort: EFFORT, format: { type: "json_schema", schema: RESPONSE_SCHEMA } },
        messages: [{ role: "user", content: prompt }],
      });
    } catch (error) {
      // Already retried by the SDK where retrying helps. Logged server-side
      // (status + message only — the request carries founder text and the
      // client never sees this message); callers get the clean domain error.
      const status = (error as { status?: number }).status;
      this.logger.error(`Claude request failed${status ? ` (${status})` : ""}: ${error instanceof Error ? error.message : String(error)}`);
      throw new DraftGenerationFailedException();
    }

    // Check why it stopped before reading content: a refusal or a truncated
    // response can carry text that doesn't match the schema.
    if (response.stop_reason === "refusal") {
      this.logger.error(`Claude declined the draft request (category: ${response.stop_details?.category ?? "unknown"})`);
      throw new DraftGenerationFailedException();
    }
    if (response.stop_reason === "max_tokens") {
      this.logger.error("Claude draft hit max_tokens before finishing");
      throw new DraftGenerationFailedException();
    }

    // The JSON is in the text block(s); thinking blocks are skipped.
    const text = response.content
      .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");
    return parseDraftJson(text, this.logger);
  }
}
