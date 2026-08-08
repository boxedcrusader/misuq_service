import { ContentType } from "@prisma/client";
import { IsEnum, IsNotEmpty, IsOptional, IsString } from "class-validator";

export class CreateStoryDto {
  @IsString()
  @IsNotEmpty()
  rawCapture!: string;

  @IsOptional()
  @IsString()
  title?: string;

  // No default here — the service defaults a missing value to
  // ContentType.OTHER (§4: DTOs validate shape, services own defaults).
  @IsOptional()
  @IsEnum(ContentType)
  contentType?: ContentType;
}
