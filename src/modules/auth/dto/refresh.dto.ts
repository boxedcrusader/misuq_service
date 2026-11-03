import { IsJWT } from "class-validator";

// Refresh token travels in the JSON body (not an httpOnly cookie) so the
// same contract serves both client/web and client/mobile -- React Native
// has no cookie jar to lean on.
export class RefreshDto {
  @IsJWT()
  refreshToken!: string;
}
