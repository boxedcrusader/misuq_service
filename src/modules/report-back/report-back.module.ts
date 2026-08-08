import { Module } from "@nestjs/common";
import { EXTRACTION_PROVIDER } from "./extraction/extraction.provider";
import { StubExtractionProvider } from "./extraction/stub-extraction.provider";
import { ReportBackController } from "./report-back.controller";
import { ReportBackService } from "./report-back.service";

// GeminiExtractionProvider slots in later by changing only the `useClass`
// (or `useFactory`, if it needs config/API keys) below — ReportBackService
// depends on the ExtractionProvider interface, never on
// StubExtractionProvider directly.
@Module({
  controllers: [ReportBackController],
  providers: [ReportBackService, { provide: EXTRACTION_PROVIDER, useClass: StubExtractionProvider }],
})
export class ReportBackModule {}
