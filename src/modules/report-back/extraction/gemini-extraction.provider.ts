import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { GoogleGenAI, Type, type Schema } from "@google/genai";
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

// Same model alias + timeout reasoning as GeminiDraftingProvider (cheap,
// swappable per step — README §4).
const MODEL = "gemini-flash-lite-latest";
const TIMEOUT_MS = 15_000;

const VALUE_SCHEMA: Record<FieldKind, Schema> = {
  count: { type: Type.INTEGER, minimum: 0 },
  boolean: { type: Type.BOOLEAN },
  sentiment: { type: Type.STRING, enum: SENTIMENT_VALUES },
  postFormat: { type: Type.STRING, enum: POST_FORMAT_VALUES },
};

// { value, evidence } or null, per field — the shape extraction-core.ts
// validates (including that the evidence really appears in the message).
const RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: Object.fromEntries(
    EXTRACTION_FIELDS.map(({ key, kind, description }) => [
      key,
      {
        type: Type.OBJECT,
        nullable: true,
        description,
        properties: { value: VALUE_SCHEMA[kind], evidence: { type: Type.STRING, description: EVIDENCE_DESCRIPTION } },
        required: ["value", "evidence"],
      },
    ]),
  ),
  // All required (but each nullable): the model must explicitly answer every
  // field, null included, rather than silently omitting one.
  required: EXTRACTION_FIELDS.map((f) => f.key),
};

// GeminiExtractionProvider — selected by EXTRACTION_LLM=gemini in
// report-back.module.ts. Makes ONE attempt and either returns a fully
// validated ExtractedSignal or throws SignalExtractionFailedException;
// ReportBackService owns retry. Prompt + validation: extraction-core.ts.
@Injectable()
export class GeminiExtractionProvider implements ExtractionProvider {
  private readonly logger = new Logger(GeminiExtractionProvider.name);
  private readonly client: GoogleGenAI;

  constructor(configService: ConfigService) {
    // getOrThrow: same fail-at-boot reasoning as GeminiDraftingProvider.
    const apiKey = configService.getOrThrow<string>("GEMINI_API_KEY");
    this.client = new GoogleGenAI({ apiKey });
  }

  async extract(input: { rawFeedback: string; channel: Channel }): Promise<ExtractedSignal> {
    let text: string | undefined;
    try {
      const response = await this.client.models.generateContent({
        model: MODEL,
        contents: buildExtractionPrompt(input),
        config: {
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
          httpOptions: { timeout: TIMEOUT_MS },
          // Cost cap, same as the Claude providers (~130 tokens is typical).
          maxOutputTokens: 2_048,
          // Reading facts out of text, not writing — no creativity wanted.
          temperature: 0,
        },
      });
      text = response.text;
    } catch (error) {
      this.logger.error(`Gemini generateContent failed: ${error instanceof Error ? error.message : String(error)}`);
      throw new SignalExtractionFailedException();
    }
    return parseExtractedSignal(text, input.rawFeedback, this.logger);
  }
}
