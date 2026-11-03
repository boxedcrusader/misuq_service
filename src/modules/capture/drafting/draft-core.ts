import { Logger } from "@nestjs/common";
import { Tone } from "@prisma/client";
import { GenerateDraftInput } from "./drafting.provider";
import { DraftGenerationFailedException } from "./draft-generation-failed.exception";
import { findUngroundedNumbers } from "./grounding";
import { DRAFT_TONES, TONE_DEFINITIONS, parseDraftTone } from "./tone-mapping";

// Provider-independent drafting core, shared by every DraftingProvider
// (Gemini, Claude) so the prompt rules and the invented-number backstop can't
// drift between models — the one place to change how drafts are written.
// Providers only translate "send this prompt, get JSON text back" into their
// own SDK call.

export interface DraftResult {
  body: string;
  tone: Tone;
}

// Shared field descriptions for each provider's response schema.
export const DRAFT_BODY_DESCRIPTION = "The full preview email, following the prompt's greeting and SIGN-OFF rules.";
export const DRAFT_TONE_DESCRIPTION = "The post's emotional angle: the single best fit from the defined list.";

// Code-level backstop for the prompt's FACTS rule: a draft containing a
// number the founder never wrote gets ONE corrective retry, and a second
// ungrounded draft fails cleanly ("better no draft than a garbage one").
// Needed even though the prompt alone measured 0/10 invented numbers:
// providers track moving model aliases/versions, so a future model could
// regress silently with no code change here.
export async function generateGroundedDraft(
  input: GenerateDraftInput,
  attempt: (prompt: string) => Promise<DraftResult>,
  logger: Logger,
): Promise<DraftResult> {
  const sources = [input.rawCapture, input.title ?? "", input.founderName ?? ""];
  const basePrompt = buildDraftPrompt(input);

  const first = await attempt(basePrompt);
  const invented = findUngroundedNumbers(first.body, sources);
  if (invented.length === 0) return first;

  // Count only — the numbers themselves come from founder-adjacent text.
  logger.warn(`Draft contained ${invented.length} number(s) not in the founder's update; retrying once`);
  const correction = [
    "",
    `YOUR PREVIOUS DRAFT BROKE THE FACTS RULE: it contained ${invented.map((n) => `"${n}"`).join(", ")}, which`,
    `the founder never wrote. Write it again using only facts from the raw update.`,
  ].join("\n");
  const second = await attempt(basePrompt + correction);
  if (findUngroundedNumbers(second.body, sources).length === 0) return second;

  logger.error("Draft still contained invented numbers after a corrective retry; failing");
  throw new DraftGenerationFailedException();
}

// Malformed / empty response: no usable text, invalid JSON, or a shape that
// doesn't fit { body, tone } — a failure, not a half-written draft. Better no
// draft than a garbage one.
export function parseDraftJson(text: string | undefined, logger: Logger): DraftResult {
  if (!text || text.trim().length === 0) {
    logger.error("Model returned an empty response");
    throw new DraftGenerationFailedException();
  }

  let parsed: { body?: unknown; tone?: unknown };
  try {
    parsed = JSON.parse(text);
  } catch {
    logger.error("Model response was not valid JSON");
    throw new DraftGenerationFailedException();
  }
  if (!parsed || typeof parsed !== "object") {
    logger.error("Model response was not a JSON object");
    throw new DraftGenerationFailedException();
  }

  if (typeof parsed.body !== "string" || parsed.body.trim().length === 0) {
    logger.error("Model response was missing a usable body");
    throw new DraftGenerationFailedException();
  }

  // Off-schema → OTHER ("uncategorized" on content; never pooled as OTHER —
  // see parseDraftTone). Logged, since a schema-constrained model should
  // almost never do it.
  const tone = parseDraftTone(parsed.tone);
  if (tone === Tone.OTHER) logger.warn("Model returned an off-schema tone; stored as OTHER (never pooled)");

  return { body: parsed.body.trim(), tone };
}

// Prompt QUALITY is iterable (CLAUDE.md §4: swap the drafting model if output
// sounds generic); this keeps two things deliberately separate:
//   - VOICE (register: rhythm, vocabulary, formality, personality) comes from
//     the founder's own styleSample, when one exists.
//   - STRUCTURE (hook, narrative shape) is imposed by the rules here and NEVER
//     by the sample — "keep the accent, fix the sentence." A founder's sample
//     with a weak opening must not teach the model to open weakly.
// Frames this as a preview to the founder's OWN small early audience (README
// §2: not a public launch), so the model doesn't default to a big-launch
// press-release voice.
export function buildDraftPrompt(input: GenerateDraftInput): string {
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
    // FACTS comes first and overrides everything after it. The old prompt had
    // none, and its structure rules ("a real number", "a surprising
    // specific", "what was hard") plus a 100-word floor made the model invent
    // details whenever the capture was thin — measured live 2026-11-03: 7/10
    // drafts contained made-up numbers, 4/10 signed off as "Alex".
    `FACTS — the most important rule; it overrides every rule below:`,
    `- Use ONLY what the founder wrote below (the raw update and its working angle). Every number,`,
    `  name, date, time, duration, tool, bug, feature, person, event, quote, and feeling in the post`,
    `  must come from it.`,
    `- Never invent details to make the post vivid, specific, or longer: no made-up numbers, times of`,
    `  day, customer counts, anecdotes, struggles, or reactions.`,
    `- No arithmetic or conclusions the founder didn't state (don't compute a difference, a rate, or a`,
    `  revenue impact).`,
    // Measured live on Claude Sonnet 5.5 (2026-11-03): numbers stayed clean,
    // but it added emotional framing ("it still stings", "I'm still taking
    // it in") and claims about readers ("you've been around for most of
    // it"). Craft, to the model; invented facts, to the founder's audience.
    `- Feelings and readers count too: add no emotion the founder didn't express ("it stings", "I'm`,
    `  still taking it in"), and assume nothing about the readers (how long they've followed, what they`,
    `  did or felt).`,
    `- You MAY rephrase, reorder, connect what's there, and ask readers a question.`,
    `- A short update makes a short post. That is correct, not a failure.`,
    "",
    // Measured live: FACTS alone overcorrected into transcripts — the update
    // restated in ~30 words plus "How has your week been going?". The value is
    // the WRITING; this separates what the drafter may add (craft) from what
    // it may not (facts).
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
