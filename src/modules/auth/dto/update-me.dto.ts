import { Niche } from "@prisma/client";
import { Transform } from "class-transformer";
import { IsEnum, IsOptional, IsString, MaxLength } from "class-validator";

// PATCH /auth/me — the founder's own profile fields. Both optional; an empty
// body is a no-op.
export class UpdateMeDto {
  // Trimmed; an empty string clears the name (stored as null), since
  // User.name is optional and drafting then signs off with no name.
  @IsOptional()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MaxLength(100)
  name?: string;

  // A moat grouping key (README §5). Only ever a value the founder actively
  // picked — OTHER included, which is a genuine answer here ("something
  // else"), not a stand-in. There is deliberately no way to set it back to
  // null: report-back fail-closes on a null niche.
  @IsOptional()
  @IsEnum(Niche)
  niche?: Niche;
}
