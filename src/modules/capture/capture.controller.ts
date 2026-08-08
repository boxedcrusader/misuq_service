import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { CaptureService } from "./capture.service";
import { CreateStoryDto } from "./dto/create-story.dto";

@Controller("stories")
export class CaptureController {
  constructor(private readonly captureService: CaptureService) {}

  @Post()
  captureStory(@Body() dto: CreateStoryDto, @CurrentUser() userId: string) {
    return this.captureService.captureStory(dto, userId);
  }

  @Post(":id/draft")
  draftStory(@Param("id") id: string, @CurrentUser() userId: string) {
    return this.captureService.draftStory(id, userId);
  }

  @Get()
  findAll(@CurrentUser() userId: string, @Query("page") page?: string, @Query("limit") limit?: string) {
    return this.captureService.findAll(userId, {
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get(":id")
  findOne(@Param("id") id: string, @CurrentUser() userId: string) {
    return this.captureService.findOne(id, userId);
  }
}
