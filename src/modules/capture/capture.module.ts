import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { selectLlm } from "../../common/llm-selection";
import { CaptureController } from "./capture.controller";
import { CaptureService } from "./capture.service";
import { ClaudeDraftingProvider } from "./drafting/claude-drafting.provider";
import { DRAFTING_PROVIDER } from "./drafting/drafting.provider";
import { GeminiDraftingProvider } from "./drafting/gemini-drafting.provider";

// Runtime wiring only — DRAFTING_LLM picks the DraftingProvider (claude in
// production, gemini by default; see common/llm-selection.ts). Only the
// selected provider is constructed, so only its API key is required.
// CaptureService depends on the interface,
// never on this class directly (architecture-principles.md "Dependency
// inversion"). StubDraftingProvider is NOT deleted: it still lives in
// ./drafting/stub-drafting.provider.ts and is exactly what every existing
// test constructs directly (capture.service.spec.ts, test/moat-e2e.spec.ts)
// — those tests bypass this module's DI entirely, so they never touch
// Gemini regardless of what's bound here. If a future test DOES need to
// boot CaptureModule through Nest's TestingModule, override this token
// there with StubDraftingProvider rather than hitting the real API.
@Module({
  controllers: [CaptureController],
  providers: [
    CaptureService,
    {
      provide: DRAFTING_PROVIDER,
      useFactory: (config: ConfigService) =>
        selectLlm(config, "DRAFTING_LLM") === "claude" ? new ClaudeDraftingProvider(config) : new GeminiDraftingProvider(config),
      inject: [ConfigService],
    },
  ],
})
export class CaptureModule {}
