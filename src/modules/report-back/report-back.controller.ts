import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { parsePagination } from "../../common/http/pagination";
import { CreateReportDto } from "./dto/create-report.dto";
import { ReportBackService } from "./report-back.service";

@Controller("reports")
export class ReportBackController {
  constructor(private readonly reportBackService: ReportBackService) {}

  // Calls Gemini (paid): a per-IP burst limit on top of the per-account
  // daily cap in the service (common/usage-limits.ts).
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post()
  reportBack(@Body() dto: CreateReportDto, @CurrentUser() userId: string) {
    return this.reportBackService.reportBack(dto, userId);
  }

  // Retries extraction for a saved report whose signal failed to extract
  // (POST /reports returned signalRecord: null). 409 if it already has one,
  // 502 if extraction fails again -- the report itself is never at risk.
  // Calls Gemini (paid): a per-IP burst limit on top of the per-account
  // daily cap in the service (common/usage-limits.ts).
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post(":id/extract")
  retryExtraction(@Param("id") id: string, @CurrentUser() userId: string) {
    return this.reportBackService.retryExtraction(id, userId);
  }

  @Get()
  findAll(@CurrentUser() userId: string, @Query("page") page?: string, @Query("limit") limit?: string) {
    return this.reportBackService.findAll(userId, parsePagination(page, limit));
  }

  @Get(":id")
  findOne(@Param("id") id: string, @CurrentUser() userId: string) {
    return this.reportBackService.findOne(id, userId);
  }
}
