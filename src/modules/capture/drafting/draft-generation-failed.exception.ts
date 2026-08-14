import { BadGatewayException } from "@nestjs/common";

// One clean domain exception for every way GeminiDraftingProvider can fail
// (network error, non-2xx from Gemini, timeout, malformed/empty response) —
// draftStory's caller (the controller, eventually the frontend) only ever
// needs to know "generation failed, try again," never which of those it
// was. The raw Gemini error (which could include request/response detail)
// is logged server-side by the caller, never passed into this message —
// callers must not do `new DraftGenerationFailedException(String(err))`.
export class DraftGenerationFailedException extends BadGatewayException {
  constructor() {
    super("Draft generation failed — try again.");
  }
}
