import { Channel, Tone } from "@prisma/client";

export interface DraftingProvider {
  generateDraft(input: {
    rawCapture: string;
    title?: string;
    channel: Channel;
  }): Promise<{ body: string; tone: Tone }>;
}

export const DRAFTING_PROVIDER = "DRAFTING_PROVIDER";
