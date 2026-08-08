import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { CreateSendDto } from "./dto/create-send.dto";
import { SendService } from "./send.service";

@Controller("sends")
export class SendController {
  constructor(private readonly sendService: SendService) {}

  @Post()
  stagePiece(@Body() dto: CreateSendDto, @CurrentUser() userId: string) {
    return this.sendService.stagePiece(dto, userId);
  }

  @Get()
  findAll(@CurrentUser() userId: string, @Query("page") page?: string, @Query("limit") limit?: string) {
    return this.sendService.findAll(userId, {
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get(":id")
  findOne(@Param("id") id: string, @CurrentUser() userId: string) {
    return this.sendService.findOne(id, userId);
  }
}
