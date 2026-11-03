import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { JwtModule } from "@nestjs/jwt";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { AUTH_CONFIG, loadAuthConfig } from "./auth.config";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";

@Module({
  // No module-level secret: access and refresh tokens use DIFFERENT
  // secrets, so each sign/verify call passes its own from AUTH_CONFIG.
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    // Factory runs at boot, so a missing/weak JWT secret stops the server
    // from starting instead of failing on the first login.
    { provide: AUTH_CONFIG, useFactory: loadAuthConfig, inject: [ConfigService] },
    AuthService,
    // Global: every route in every module is authenticated unless @Public().
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AuthModule {}
