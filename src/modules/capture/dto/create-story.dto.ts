import { ContentType } from "@prisma/client";
import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from "class-validator";

export class CreateStoryDto {
  // Capped (2026-11-03 pentest: a 90 KB capture was accepted, and it goes
  // straight into a paid Gemini prompt, twice on a retry). Updates are short.
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  rawCapture!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  // No default here — the service defaults a missing value to
  // ContentType.OTHER (§4: DTOs validate shape, services own defaults).
  @IsOptional()
  @IsEnum(ContentType)
  contentType?: ContentType;
}
