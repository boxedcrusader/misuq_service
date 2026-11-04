import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { parsePagination } from "../../common/http/pagination";
import { CaptureService } from "./capture.service";
import { CreateStoryDto } from "./dto/create-story.dto";
import { DraftStoryDto } from "./dto/draft-story.dto";
import { UpdateStoryDto } from "./dto/update-story.dto";

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
  draftStory(@Param("id") id: string, @Body() dto: DraftStoryDto, @CurrentUser() userId: string) {
    return this.captureService.draftStory(id, userId, dto.channel);
  }

  @Get()
  findAll(@CurrentUser() userId: string, @Query("page") page?: string, @Query("limit") limit?: string) {
    return this.captureService.findAll(userId, parsePagination(page, limit));
  }

  @Get(":id")
  findOne(@Param("id") id: string, @CurrentUser() userId: string) {
    return this.captureService.findOne(id, userId);
  }

  // Edit the captured update itself; only until something is sent.
  @Patch(":id")
  updateStory(@Param("id") id: string, @Body() dto: UpdateStoryDto, @CurrentUser() userId: string) {
    return this.captureService.updateStory(id, userId, dto);
  }

  // Only while nothing is sent; a sent story is archived instead.
  @Delete(":id")
  @HttpCode(204)
  deleteStory(@Param("id") id: string, @CurrentUser() userId: string) {
    return this.captureService.deleteStory(id, userId);
  }

  @Post(":id/archive")
  @HttpCode(200)
  archiveStory(@Param("id") id: string, @CurrentUser() userId: string) {
    return this.captureService.archiveStory(id, userId);
  }

  @Post(":id/unarchive")
  @HttpCode(200)
  unarchiveStory(@Param("id") id: string, @CurrentUser() userId: string) {
    return this.captureService.unarchiveStory(id, userId);
  }
}
