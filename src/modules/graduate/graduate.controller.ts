import { Controller, Param, Post } from "@nestjs/common";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { GraduateService } from "./graduate.service";

@Controller("stories")
export class GraduateController {
  constructor(private readonly graduateService: GraduateService) {}

  @Post(":id/graduate")
  graduateStory(@Param("id") id: string, @CurrentUser() userId: string) {
    return this.graduateService.graduateStory(id, userId);
  }
}
