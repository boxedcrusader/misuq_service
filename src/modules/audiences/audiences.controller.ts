import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { parsePagination } from "../../common/http/pagination";
import { AudiencesService } from "./audiences.service";
import { CreateAudienceDto } from "./dto/create-audience.dto";
import { UpdateAudienceDto } from "./dto/update-audience.dto";

@Controller("audiences")
export class AudiencesController {
  constructor(private readonly audiencesService: AudiencesService) {}

  @Post()
  create(@CurrentUser() userId: string, @Body() dto: CreateAudienceDto) {
    return this.audiencesService.create(userId, dto);
  }

  @Get()
  findAll(@CurrentUser() userId: string, @Query("page") page?: string, @Query("limit") limit?: string) {
    return this.audiencesService.findAll(userId, parsePagination(page, limit, 50));
  }

  @Get(":id")
  findOne(@Param("id") id: string, @CurrentUser() userId: string) {
    return this.audiencesService.findOne(id, userId);
  }

  @Patch(":id")
  update(@Param("id") id: string, @CurrentUser() userId: string, @Body() dto: UpdateAudienceDto) {
    return this.audiencesService.update(id, userId, dto);
  }
}
