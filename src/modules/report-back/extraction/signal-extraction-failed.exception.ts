import { BadGatewayException } from "@nestjs/common";

// One clean domain exception for every way signal extraction can fail
// (network error, non-2xx from Gemini, timeout, malformed/empty response).
// Same contract as DraftGenerationFailedException: the raw upstream error
// is logged server-side, never passed into this message.
//
// Only ever surfaces from POST /reports/:id/extract. POST /reports itself
// never fails on extraction -- the founder's raw report is already saved by
// then, so it returns signalRecord: null instead (report-back.service.ts).
export class SignalExtractionFailedException extends BadGatewayException {
  constructor() {
    super("Couldn't analyze this report yet — it's saved; try again.");
  }
}
