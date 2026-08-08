import { Module } from "@nestjs/common";
import { CaptureController } from "./capture.controller";
import { CaptureService } from "./capture.service";
import { DRAFTING_PROVIDER } from "./drafting/drafting.provider";
import { StubDraftingProvider } from "./drafting/stub-drafting.provider";

// GeminiDraftingProvider slots in later by changing only the `useClass`
// (or `useFactory`, if it needs config/API keys) below — CaptureService
// depends on the DraftingProvider interface, never on StubDraftingProvider
// directly.
@Module({
  controllers: [CaptureController],
  providers: [CaptureService, { provide: DRAFTING_PROVIDER, useClass: StubDraftingProvider }],
})
export class CaptureModule {}
