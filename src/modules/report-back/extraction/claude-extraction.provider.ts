import Anthropic from "@anthropic-ai/sdk";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Channel } from "@prisma/client";
import { ExtractedSignal, ExtractionProvider } from "./extraction.provider";
import {
  EVIDENCE_DESCRIPTION,
  EXTRACTION_FIELDS,
  FieldKind,
  POST_FORMAT_VALUES,
  SENTIMENT_VALUES,
  buildExtractionPrompt,
  parseExtractedSignal,
} from "./extraction-core";
import { SignalExtractionFailedException } from "./signal-extraction-failed.exception";

// Claude Haiku 5.5 for extraction (decision 2026-11-03): reading "about 30
// opened, 4 replied" into numbers is a simple task, at a fraction of a cent.
// Low effort (Haiku 5.5's default is medium). No `fallbacks`: Haiku 5.5 has
// no server-side fallback, so a decline is handled below.
const MODEL = "claude-haiku-5-5";
const EFFORT = "low" as const;
// Ceilings sized from measurement (2026-11-03 live runs: ~130 output tokens
// per call including thinking, 2-4s latency), not defaults. MAX_TOKENS is a
// cost cap: a prompt-injected "write 3000 words" stops at ~15x the normal
// size and fails cleanly (stop_reason max_tokens). One SDK retry: with the
// app's own retry on top, a failure costs at most 4 calls, not 6.
const TIMEOUT_MS = 30_000;
const MAX_RETRIES = 1;
const MAX_TOKENS = 2_048;

// Structured outputs reject numeric constraints (minimum/maximum) in a raw
// schema, so counts are plain integers here; non-negativity and the upper
// bound are enforced by extraction-core.ts's validators instead.
const VALUE_SCHEMA: Record<FieldKind, Record<string, unknown>> = {
  count: { type: "integer" },
  boolean: { type: "boolean" },
  sentiment: { type: "string", enum: SENTIMENT_VALUES },
  postFormat: { type: "string", enum: POST_FORMAT_VALUES },
};

// Each field is { value, evidence } or null (anyOf with null — 9 unions, under
// the structured-outputs limit of 16). Every property is required, so the
// model must answer each one explicitly, null included.
// additionalProperties: false on every object, as structured outputs require.
const RESPONSE_SCHEMA = {
  type: "object",
  properties: Object.fromEntries(
    EXTRACTION_FIELDS.map(({ key, kind, description }) => [
      key,
      {
        description,
        anyOf: [
          {
            type: "object",
            properties: { value: VALUE_SCHEMA[kind], evidence: { type: "string", description: EVIDENCE_DESCRIPTION } },
            required: ["value", "evidence"],
            additionalProperties: false,
          },
          { type: "null" },
        ],
      },
    ]),
  ),
  required: EXTRACTION_FIELDS.map((f) => f.key),
  additionalProperties: false,
};

// ClaudeExtractionProvider — selected by EXTRACTION_LLM=claude in
// report-back.module.ts. ONE attempt per call; ReportBackService owns retry.
// The prompt and all validation (including the founder-quote check) are
// shared with GeminiExtractionProvider (extraction-core.ts).
@Injectable()
export class ClaudeExtractionProvider implements ExtractionProvider {
  private readonly logger = new Logger(ClaudeExtractionProvider.name);
  private readonly client: Anthropic;

  constructor(configService: ConfigService) {
    const apiKey = configService.getOrThrow<string>("ANTHROPIC_API_KEY");
    this.client = new Anthropic({ apiKey, timeout: TIMEOUT_MS, maxRetries: MAX_RETRIES });
  }

  async extract(input: { rawFeedback: string; channel: Channel }): Promise<ExtractedSignal> {
    let response: Anthropic.Message;
    try {
      response = await this.client.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        // No temperature: Haiku 5.5 rejects non-default sampling parameters.
        output_config: { effort: EFFORT, format: { type: "json_schema", schema: RESPONSE_SCHEMA } },
        messages: [{ role: "user", content: buildExtractionPrompt(input) }],
      });
    } catch (error) {
      const status = (error as { status?: number }).status;
      this.logger.error(`Claude request failed${status ? ` (${status})` : ""}: ${error instanceof Error ? error.message : String(error)}`);
      throw new SignalExtractionFailedException();
    }

    if (response.stop_reason === "refusal") {
      this.logger.error(`Claude declined the extraction request (category: ${response.stop_details?.category ?? "unknown"})`);
      throw new SignalExtractionFailedException();
    }
    if (response.stop_reason === "max_tokens") {
      this.logger.error("Claude extraction hit max_tokens before finishing");
      throw new SignalExtractionFailedException();
    }

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");
    return parseExtractedSignal(text, input.rawFeedback, this.logger);
  }
}
