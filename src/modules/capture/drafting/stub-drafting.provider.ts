import { Injectable } from "@nestjs/common";
import { Tone } from "@prisma/client";
import { DraftingProvider, GenerateDraftInput } from "./drafting.provider";

function firstLine(text: string): string {
  return text.split("\n")[0].trim();
}

// Deterministic, no randomness, no network call — this is the seam a real
// LLM provider (GeminiDraftingProvider, Flash-Lite) slots into later by
// being bound to DRAFTING_PROVIDER in capture.module.ts instead of this
// class. CaptureService only ever depends on the DraftingProvider interface.
// `voice` is accepted (signature parity with the real provider) but
// intentionally ignored — this stub stays deterministic regardless of what
// VoiceProfile data exists.
@Injectable()
export class StubDraftingProvider implements DraftingProvider {
  async generateDraft(input: GenerateDraftInput): Promise<{ body: string; tone: Tone }> {
    const heading = input.title ?? firstLine(input.rawCapture);
    return {
      body: `[STUB DRAFT — ${input.channel}]\n\n${heading}\n\n${input.rawCapture}`,
      tone: Tone.OTHER,
    };
  }
}
