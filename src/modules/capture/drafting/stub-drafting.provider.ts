import { Injectable } from "@nestjs/common";
import { Channel, Tone } from "@prisma/client";
import { DraftingProvider } from "./drafting.provider";

function firstLine(text: string): string {
  return text.split("\n")[0].trim();
}

// Deterministic, no randomness, no network call — this is the seam a real
// LLM provider (GeminiDraftingProvider, Flash-Lite) slots into later by
// being bound to DRAFTING_PROVIDER in capture.module.ts instead of this
// class. CaptureService only ever depends on the DraftingProvider interface.
@Injectable()
export class StubDraftingProvider implements DraftingProvider {
  async generateDraft(input: {
    rawCapture: string;
    title?: string;
    channel: Channel;
  }): Promise<{ body: string; tone: Tone }> {
    const heading = input.title ?? firstLine(input.rawCapture);
    return {
      body: `[STUB DRAFT — ${input.channel}]\n\n${heading}\n\n${input.rawCapture}`,
      tone: Tone.OTHER,
    };
  }
}
