import { IsNotEmpty, IsString, MaxLength } from "class-validator";

export class CreateReportDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  sendId!: string;

  // Capped like rawCapture: it goes into the extraction prompt.
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  rawFeedback!: string;
}
