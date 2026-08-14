import { Module } from "@nestjs/common";
import { CaptureController } from "./capture.controller";
import { CaptureService } from "./capture.service";
import { DRAFTING_PROVIDER } from "./drafting/drafting.provider";
import { GeminiDraftingProvider } from "./drafting/gemini-drafting.provider";

// Runtime wiring only — GeminiDraftingProvider is the one and only
// DraftingProvider bound here; CaptureService depends on the interface,
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
  providers: [CaptureService, { provide: DRAFTING_PROVIDER, useClass: GeminiDraftingProvider }],
})
export class CaptureModule {}
