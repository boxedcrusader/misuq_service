import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { GoogleGenAI, Type } from "@google/genai";
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

// Model alias, not a dated snapshot (e.g. "gemini-2.5-flash-lite") —
// resolves to whatever Google currently serves as its default Flash-Lite
// model (confirmed live against the real API on 2026-08-10: resolved to
// "gemini-3.5-flash-lite"). CLAUDE.md specs "Gemini Flash-Lite" generically
// (cheap, swappable), not a pinned version, so tracking the alias keeps
// this provider correct as Google rolls the default forward without a code
// change here.
const MODEL = "gemini-flash-lite-latest";

// An explicit timeout (enforced by the SDK via AbortController per attempt —
// see @google/genai's httpOptions.timeout) turns "hung request" into "clean
// failure" instead of tying up the request indefinitely.
const TIMEOUT_MS = 15_000;

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    body: { type: Type.STRING, description: DRAFT_BODY_DESCRIPTION },
    // Constrained to the real Tone angles (never OTHER) — see tone-mapping.ts
    // for why the old free-text "voice" label failed.
    tone: { type: Type.STRING, enum: DRAFT_TONES, description: DRAFT_TONE_DESCRIPTION },
  },
  required: ["body", "tone"],
};

// GeminiDraftingProvider — one implementation behind DraftingProvider
// (architecture-principles.md "Dependency inversion"), selected by
// DRAFTING_LLM=gemini in capture.module.ts. The prompt and the
// invented-number backstop live in draft-core.ts, shared with
// ClaudeDraftingProvider; this class only makes the Gemini call.
@Injectable()
export class GeminiDraftingProvider implements DraftingProvider {
  private readonly logger = new Logger(GeminiDraftingProvider.name);
  private readonly client: GoogleGenAI;

  constructor(configService: ConfigService) {
    // getOrThrow, not a fallback: an unconfigured key must fail fast at
    // construction (app boot), not silently drift into "every draft call
    // fails" at request time.
    const apiKey = configService.getOrThrow<string>("GEMINI_API_KEY");
    this.client = new GoogleGenAI({ apiKey });
  }

  generateDraft(input: GenerateDraftInput): Promise<DraftResult> {
    return generateGroundedDraft(input, (prompt) => this.attempt(prompt), this.logger);
  }

  private async attempt(prompt: string): Promise<DraftResult> {
    let text: string | undefined;
    try {
      const response = await this.client.models.generateContent({
        model: MODEL,
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
          httpOptions: { timeout: TIMEOUT_MS },
        },
      });
      text = response.text;
    } catch (error) {
      // Covers network failure, non-2xx from Gemini (auth/rate-limit/5xx),
      // and timeout. Logged server-side; the client only ever sees the clean
      // domain exception — never this error's message (which could echo
      // request detail).
      this.logger.error(`Gemini generateContent failed: ${error instanceof Error ? error.message : String(error)}`);
      throw new DraftGenerationFailedException();
    }
    return parseDraftJson(text, this.logger);
  }
}
