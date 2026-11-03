import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { parsePagination } from "../../common/http/pagination";
import { CaptureService } from "./capture.service";
import { CreateStoryDto } from "./dto/create-story.dto";

@Controller("stories")
export class CaptureController {
  constructor(private readonly captureService: CaptureService) {}

  @Post()
  captureStory(@Body() dto: CreateStoryDto, @CurrentUser() userId: string) {
    return this.captureService.captureStory(dto, userId);
  }

  // Calls Gemini (paid): a per-IP burst limit on top of the per-account
  // daily cap in the service (common/usage-limits.ts).
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post(":id/draft")
  draftStory(@Param("id") id: string, @CurrentUser() userId: string) {
    return this.captureService.draftStory(id, userId);
  }

  @Get()
  findAll(@CurrentUser() userId: string, @Query("page") page?: string, @Query("limit") limit?: string) {
    return this.captureService.findAll(userId, parsePagination(page, limit));
  }

  @Get(":id")
  findOne(@Param("id") id: string, @CurrentUser() userId: string) {
    return this.captureService.findOne(id, userId);
  }
}
