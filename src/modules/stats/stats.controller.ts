import { Controller, Get } from "@nestjs/common";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { StatsService } from "./stats.service";

// The signed-in founder's own numbers (profile page). Never another
// founder's: everything is scoped by the JWT's user id.
@Controller("stats")
export class StatsController {
  constructor(private readonly statsService: StatsService) {}

  @Get()
  forMe(@CurrentUser() userId: string) {
    return this.statsService.forFounder(userId);
  }
}
