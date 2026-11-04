import { Channel } from "@prisma/client";

// The three arms of the M1 taste test. These names exist only on the
// un-blinded side (drafts.json, answer-key.json, score.md): never in
// judge.html (see judge-html.ts#findLeaks).
export const ARMS = ["misuq", "plain", "founder"] as const;
export type Arm = (typeof ARMS)[number];

export const LETTERS = ["A", "B", "C"] as const;
export type Letter = (typeof LETTERS)[number];

// update id -> letter -> arm.
export type AnswerKey = Record<string, Record<Letter, Arm>>;

// Input file formats -> the production Channel. Only formats production can
// draft (draft-core.ts DRAFT_CHANNELS) are allowed; input.ts checks that.
export const FORMAT_TO_CHANNEL = { x: Channel.X, linkedin: Channel.LINKEDIN, email: Channel.EMAIL } as const;
export type InputFormat = keyof typeof FORMAT_TO_CHANNEL;

// Words shown to the judge for the target format (neutral, same for every arm).
export const FORMAT_LABEL: Record<InputFormat, string> = { x: "X post", linkedin: "LinkedIn post", email: "Email" };
