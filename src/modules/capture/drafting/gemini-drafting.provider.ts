import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { GoogleGenAI, Type } from "@google/genai";
import { Tone } from "@prisma/client";
import { DraftingProvider, GenerateDraftInput } from "./drafting.provider";
import { DraftGenerationFailedException } from "./draft-generation-failed.exception";
import { findUngroundedNumbers } from "./grounding";
import { DRAFT_TONES, TONE_DEFINITIONS, parseDraftTone } from "./tone-mapping";

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
      description: "The full preview email, following the prompt's greeting and SIGN-OFF rules.",
    },
    // Constrained to the real Tone angles (never OTHER) — see
    // tone-mapping.ts for why the old free-text "voice" label failed.
    tone: {
      type: Type.STRING,
      enum: DRAFT_TONES,
      description: "The post's emotional angle: the single best fit from the defined list.",
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

  // Code-level backstop for the prompt's FACTS rule: a draft containing a
  // number the founder never wrote gets ONE corrective retry, and a second
  // ungrounded draft fails cleanly ("better no draft than a garbage one").
  // Needed even though the prompt alone measured 0/10 invented numbers:
  // MODEL is a moving alias, so a future model version could regress
  // silently with no code change here.
  async generateDraft(input: GenerateDraftInput): Promise<{ body: string; tone: Tone }> {
    const sources = [input.rawCapture, input.title ?? "", input.founderName ?? ""];
    const basePrompt = this.buildPrompt(input);

    const first = await this.attempt(basePrompt);
    const invented = findUngroundedNumbers(first.body, sources);
    if (invented.length === 0) return first;

    // Count only — the numbers themselves come from founder-adjacent text.
    this.logger.warn(`Draft contained ${invented.length} number(s) not in the founder's update; retrying once`);
    const correction = [
      "",
      `YOUR PREVIOUS DRAFT BROKE THE FACTS RULE: it contained ${invented.map((n) => `"${n}"`).join(", ")}, which`,
      `the founder never wrote. Write it again using only facts from the raw update.`,
    ].join("\n");
    const second = await this.attempt(basePrompt + correction);
    if (findUngroundedNumbers(second.body, sources).length === 0) return second;

    this.logger.error("Draft still contained invented numbers after a corrective retry; failing");
    throw new DraftGenerationFailedException();
  }

  private async attempt(prompt: string): Promise<{ body: string; tone: Tone }> {
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
      // Off-schema → OTHER ("uncategorized" on content; never pooled as
      // OTHER — see parseDraftTone). Logged, since it should be rare now.
      tone: this.readTone(parsed.tone),
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
    const { rawCapture, title, channel, voice, founderName } = input;

    const styleSample = voice?.styleSample?.trim();
    const voiceBlock = styleSample
      ? [
          `VOICE REFERENCE — how THIS founder actually writes:`,
          `"""`,
          styleSample,
          `"""`,
          `Match their register: sentence rhythm, vocabulary, formality, and personality.`,
          `Borrow ONLY their voice — not their topics, NOT their post structure or openings, and NEVER their`,
          `facts (numbers, events, products): those describe other posts, not this one.`,
          `If these samples open weakly or ramble, do NOT imitate that; the STRUCTURE rules below win.`,
        ].join("\n")
      : [
          `No voice samples for this founder yet. Write in a natural, understated builder's voice —`,
          `first-person, plain. Avoid corporate tone and anything that reads as AI-written`,
          `(no "Excited to announce", no "thrilled", no "game-changer", no hashtag stuffing).`,
        ].join("\n");

    const titleLine = title?.trim() ? `Working angle: ${title.trim()}\n` : "";

    // Newlines/quotes stripped: the name is interpolated inside quotes below.
    const name = founderName?.replace(/["\r\n]/g, " ").trim();
    const signOff = name
      ? `SIGN-OFF: end with a sign-off as "${name}".`
      : `SIGN-OFF: no sign-off line at all — you don't know the founder's name, and must never invent one.`;

    return [
      `You are drafting a PREVIEW post for a founder building in public.`,
      `It goes to their OWN small, warm audience — beta testers, a Discord, close peers —`,
      `NOT a public launch feed, formatted for ${channel}. No press-release hype, no announcement`,
      `voice. Talk to people who already know them.`,
      "",
      // FACTS comes first and overrides everything after it. The old prompt
      // had none, and its structure rules ("a real number", "a surprising
      // specific", "what was hard") plus a 100-word floor made Gemini invent
      // details whenever the capture was thin — measured live 2026-11-03:
      // 7/10 drafts contained made-up numbers, 4/10 signed off as "Alex".
      `FACTS — the most important rule; it overrides every rule below:`,
      `- Use ONLY what the founder wrote below (the raw update and its working angle). Every number,`,
      `  name, date, time, duration, tool, bug, feature, person, event, quote, and feeling in the post`,
      `  must come from it.`,
      `- Never invent details to make the post vivid, specific, or longer: no made-up numbers, times of`,
      `  day, customer counts, anecdotes, struggles, or reactions.`,
      `- No arithmetic or conclusions the founder didn't state (don't compute a difference, a rate, or a`,
      `  revenue impact).`,
      `- You MAY rephrase, reorder, connect what's there, and ask readers a question.`,
      `- A short update makes a short post. That is correct, not a failure.`,
      "",
      // Measured live: FACTS alone overcorrected into transcripts — the update
      // restated in ~30 words plus "How has your week been going?". The value
      // is the WRITING; this separates what the drafter may add (craft) from
      // what it may not (facts).
      `CRAFT — your job is the writing, not the facts:`,
      `- Shape the update; don't restate it line by line. Pick its sharpest fact for the first line,`,
      `  order the rest for momentum, and cut filler.`,
      `- Say plainly what the update already implies (e.g. "two of you asked for it" → it shipped because`,
      `  they asked) — but nothing it doesn't.`,
      `- Close with a question or small ask specific to THIS update — something only these readers could`,
      `  answer about this. Never a generic closer ("How's your week?", "Any thoughts?").`,
      "",
      voiceBlock,
      "",
      `STRUCTURE — this comes from you, NOT from the voice samples. Apply it to the facts above; never`,
      `add a fact to satisfy it:`,
      `- Open with a hook that earns the first line, built from the most concrete detail IN the update.`,
      `  A greeting, if any, is 1-3 words on the same line ("Hey all —"); the hook is what follows. Never`,
      `  open with a throat-clear ("So,", "Excited to", "Quick update").`,
      `- One idea per post: what happened → why it matters or what was hard (only if the update says) →`,
      `  what's next (only if the update says).`,
      `- Name the specific things the update names; never swap in specifics it doesn't contain.`,
      `- End on something a reader can actually react to (a question, a small ask, an open thread), not`,
      `  a CTA.`,
      "",
      `LENGTH: usually 40-100 words, never more than 150. Never pad to reach it — a thin update stays`,
      `short.`,
      signOff,
      `CONSTRAINTS: Plain sentences. No hashtags. No emoji unless the voice reference clearly uses them.`,
      "",
      `${titleLine}RAW UPDATE FROM THE FOUNDER:`,
      `"""`,
      rawCapture,
      `"""`,
      "",
      `ANGLE — after writing, label the post's emotional angle: the stance it takes toward its story.`,
      `This is about what the post DOES, not how it sounds — every post is written in the founder's voice,`,
      `so "understated" or "plain" are never answers. Pick the single best fit:`,
      ...DRAFT_TONES.map((tone) => `- ${tone}: ${TONE_DEFINITIONS[tone]}`),
      "",
      `Return JSON only: { "body": string, "tone": string }.`,
      `"body" is the finished post. "tone" is exactly one of the angle names above.`,
    ].join("\n");
  }

  private readTone(raw: unknown): Tone {
    const tone = parseDraftTone(raw);
    if (tone === Tone.OTHER) this.logger.warn("Gemini returned an off-schema tone; stored as OTHER (never pooled)");
    return tone;
  }
}
