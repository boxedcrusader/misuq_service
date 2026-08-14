import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { GoogleGenAI, Type } from "@google/genai";
import { Tone } from "@prisma/client";
import { DraftingProvider, GenerateDraftInput } from "./drafting.provider";
import { DraftGenerationFailedException } from "./draft-generation-failed.exception";
import { mapToneToEnum } from "./tone-mapping";

// Model alias, not a dated snapshot (e.g. "gemini-2.5-flash-lite") —
// resolves to whatever Google currently serves as its default Flash-Lite
// model (confirmed live against the real API on 2026-08-10: resolved to
// "gemini-3.5-flash-lite"). CLAUDE.md specs "Gemini Flash-Lite" generically
// (cheap, swappable), not a pinned version, so tracking the alias keeps
// this provider correct as Google rolls the default forward without a code
// change here.
const MODEL = "gemini-flash-lite-latest";

// The stub was instant; Gemini isn't. An explicit timeout (enforced by the
// SDK via AbortController per attempt — see @google/genai's httpOptions.timeout)
// turns "hung request" into "clean failure" instead of tying up the request
// indefinitely.
const TIMEOUT_MS = 15_000;

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    body: {
      type: Type.STRING,
      description: "The full preview email body, including a greeting and sign-off.",
    },
    // Deliberately free text, NOT constrained to the Tone enum's values —
    // see tone-mapping.ts for why forcing the model onto the enum here
    // would just relocate the guessing problem instead of solving it.
    tone: {
      type: Type.STRING,
      description: "One or two words describing the emotional tone of the draft (e.g. 'warm', 'confident and proud').",
    },
  },
  required: ["body", "tone"],
};

interface GeminiDraftJson {
  body?: unknown;
  tone?: unknown;
}

// GeminiDraftingProvider — the real implementation behind DraftingProvider
// (architecture-principles.md "Dependency inversion"). CaptureService and
// everything downstream (the transaction, the controller, the frontend)
// depend only on the interface; this class is the seam's payload, swapped
// in for StubDraftingProvider by capture.module.ts alone.
@Injectable()
export class GeminiDraftingProvider implements DraftingProvider {
  private readonly logger = new Logger(GeminiDraftingProvider.name);
  private readonly client: GoogleGenAI;

  constructor(configService: ConfigService) {
    // getOrThrow, not a fallback: an unconfigured key must fail fast at
    // construction (app boot), not silently drift into "every draft call
    // fails" at request time. No test constructs this class today (they
    // all pass StubDraftingProvider directly, bypassing Nest DI entirely —
    // see capture.service.spec.ts / moat-e2e.spec.ts) so this can never
    // break the suite.
    const apiKey = configService.getOrThrow<string>("GEMINI_API_KEY");
    this.client = new GoogleGenAI({ apiKey });
  }

  async generateDraft(input: GenerateDraftInput): Promise<{ body: string; tone: Tone }> {
    let text: string | undefined;
    try {
      const response = await this.client.models.generateContent({
        model: MODEL,
        contents: this.buildPrompt(input),
        config: {
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
          httpOptions: { timeout: TIMEOUT_MS },
        },
      });
      text = response.text;
    } catch (error) {
      // Covers network failure, non-2xx from Gemini (auth/rate-limit/5xx),
      // and timeout (the SDK aborts and throws once TIMEOUT_MS elapses).
      // Log server-side for debugging; the client only ever sees the clean
      // domain exception below — never this error's message (which could
      // echo request detail) and never the API key (never present in the
      // error body to begin with, but this boundary is the enforcement
      // point regardless).
      this.logger.error(`Gemini generateContent failed: ${error instanceof Error ? error.message : String(error)}`);
      throw new DraftGenerationFailedException();
    }

    // Malformed / empty response: no usable text, invalid JSON, or a shape
    // that doesn't fit { body, tone } — treated as a failure, not a
    // half-written draft. Better no draft than a garbage one.
    if (!text || text.trim().length === 0) {
      this.logger.error("Gemini returned an empty response");
      throw new DraftGenerationFailedException();
    }

    let parsed: GeminiDraftJson;
    try {
      parsed = JSON.parse(text);
    } catch {
      this.logger.error("Gemini response was not valid JSON");
      throw new DraftGenerationFailedException();
    }

    if (typeof parsed.body !== "string" || parsed.body.trim().length === 0) {
      this.logger.error("Gemini response was missing a usable body");
      throw new DraftGenerationFailedException();
    }

    return {
      body: parsed.body.trim(),
      tone: mapToneToEnum(typeof parsed.tone === "string" ? parsed.tone : undefined),
    };
  }

  // Prompt QUALITY is iterable later (CLAUDE.md §4: swap drafting model if
  // output sounds generic); this is the plumbing for two things kept
  // deliberately separate in the text below:
  //   - VOICE (register: rhythm, vocabulary, formality, personality) comes
  //     from the founder's own styleSample, when one exists.
  //   - STRUCTURE (hook, narrative shape) is imposed by the rules here and
  //     NEVER by the sample — "keep the accent, fix the sentence." A
  //     founder's sample with a weak opening must not teach the model to
  //     open weakly.
  // Frames this as a preview to the founder's OWN small early audience
  // (README §2: not a public launch), so Gemini doesn't default to a
  // big-launch press-release voice.
  private buildPrompt(input: GenerateDraftInput): string {
    const { rawCapture, title, channel, voice } = input;

    const styleSample = voice?.styleSample?.trim();
    const voiceBlock = styleSample
      ? [
          `VOICE REFERENCE — how THIS founder actually writes:`,
          `"""`,
          styleSample,
          `"""`,
          `Match their register: sentence rhythm, vocabulary, formality, and personality.`,
          `Borrow ONLY their voice — not their topics, and NOT their post structure or openings.`,
          `If these samples open weakly or ramble, do NOT imitate that; the STRUCTURE rules below win.`,
        ].join("\n")
      : [
          `No voice samples for this founder yet. Write in a natural, understated builder's voice —`,
          `first-person, plain, specific. Avoid corporate tone and anything that reads as AI-written`,
          `(no "Excited to announce", no "thrilled", no "game-changer", no hashtag stuffing).`,
        ].join("\n");

    const titleLine = title?.trim() ? `Working angle: ${title.trim()}\n` : "";

    return [
      `You are drafting a PREVIEW post for a founder building in public.`,
      `It goes to their OWN small, warm audience — beta testers, a Discord, close peers —`,
      `NOT a public launch feed, formatted for ${channel}. No press-release hype, no announcement`,
      `voice. Talk to people who already know them.`,
      "",
      voiceBlock,
      "",
      `STRUCTURE — this comes from you, NOT from the voice samples:`,
      `- Open with a hook that earns the first line: a concrete detail, a small tension, a surprising`,
      `  specific, or a real number. Never open with a throat-clear ("So,", "Excited to", "Quick update").`,
      `- One idea per post. Build it: what happened → why it mattered / what was hard → what it means or`,
      `  what's next.`,
      `- Concrete over abstract — name the specific thing, not the category.`,
      `- End on something a reader can actually react to (a question, a small ask, an open thread), not`,
      `  a CTA.`,
      "",
      `CONSTRAINTS: 100-200 words. Plain sentences. No hashtags. No emoji unless the voice reference`,
      `clearly uses them.`,
      "",
      `${titleLine}RAW UPDATE FROM THE FOUNDER:`,
      `"""`,
      rawCapture,
      `"""`,
      "",
      `Return JSON only: { "body": string, "tone": string }.`,
      `"body" is the finished post. "tone" is a short free-text label for the voice you wrote in.`,
    ].join("\n");
  }
}
