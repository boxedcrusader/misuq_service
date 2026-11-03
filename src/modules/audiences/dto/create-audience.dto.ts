import { AudienceType } from "@prisma/client";
import { Transform } from "class-transformer";
import { IsEnum, IsInt, IsNotEmpty, IsString, Max, MaxLength, Min } from "class-validator";

// An Audience is the founder's own small room (README §2 step 3, deliberately
// broad: an email list, a Discord, beta users, or "3 founder friends").
export class CreateAudienceDto {
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name!: string;

  @IsEnum(AudienceType)
  type!: AudienceType;

  // The founder's rough headcount. Min 1: a room of zero people isn't an
  // audience — that founder is draft-only, which onboarding records by them
  // finishing with no audiences, not by an empty one. Frozen into
  // Send.audienceSizeSnapshot at send time, so later edits never rewrite
  // past sends.
  @IsInt()
  @Min(1)
  @Max(10_000_000)
  size!: number;
}
