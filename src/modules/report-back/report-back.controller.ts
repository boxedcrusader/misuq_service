import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { CreateReportDto } from "./dto/create-report.dto";
import { ReportBackService } from "./report-back.service";

@Controller("reports")
export class ReportBackController {
  constructor(private readonly reportBackService: ReportBackService) {}

  @Post()
  reportBack(@Body() dto: CreateReportDto, @CurrentUser() userId: string) {
    return this.reportBackService.reportBack(dto, userId);
  }

  @Get()
  findAll(@CurrentUser() userId: string, @Query("page") page?: string, @Query("limit") limit?: string) {
    return this.reportBackService.findAll(userId, {
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get(":id")
  findOne(@Param("id") id: string, @CurrentUser() userId: string) {
    return this.reportBackService.findOne(id, userId);
  }
}
