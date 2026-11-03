import { Module } from "@nestjs/common";
import { EXTRACTION_PROVIDER } from "./extraction/extraction.provider";
import { GeminiExtractionProvider } from "./extraction/gemini-extraction.provider";
import { ReportBackController } from "./report-back.controller";
import { ReportBackService } from "./report-back.service";

// Real extraction since 2026-11-03. StubExtractionProvider stays in the repo
// for tests only — it ignores the founder's words and returns fixed values,
// so it must never be bound here again: every report would write a
// fabricated, permanent SignalRecord. ReportBackService depends on the
// ExtractionProvider interface, never on a concrete class.
@Module({
  controllers: [ReportBackController],
  providers: [ReportBackService, { provide: EXTRACTION_PROVIDER, useClass: GeminiExtractionProvider }],
})
export class ReportBackModule {}
