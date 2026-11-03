import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post } from "@nestjs/common";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Public } from "../../common/decorators/public.decorator";
import { AuthService } from "./auth.service";
import { LoginDto } from "./dto/login.dto";
import { RefreshDto } from "./dto/refresh.dto";
import { RegisterDto } from "./dto/register.dto";
import { UpdateMeDto } from "./dto/update-me.dto";

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post("register")
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  // 200, not Nest's POST default 201: login creates no addressable resource.
  @Public()
  @Post("login")
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  // Public because the caller's ACCESS token is typically already expired
  // here -- the refresh token in the body is the credential.
  @Public()
  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @Post("logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(@CurrentUser() userId: string) {
    return this.authService.logout(userId);
  }

  @Get("me")
  me(@CurrentUser() userId: string) {
    return this.authService.me(userId);
  }

  @Patch("me")
  updateMe(@CurrentUser() userId: string, @Body() dto: UpdateMeDto) {
    return this.authService.updateMe(userId, dto);
  }

  // 200, not 201: records an event on the existing account, creates no
  // resource. Idempotent — see AuthService.completeOnboarding.
  @Post("me/onboarding")
  @HttpCode(HttpStatus.OK)
  completeOnboarding(@CurrentUser() userId: string) {
    return this.authService.completeOnboarding(userId);
  }
}
