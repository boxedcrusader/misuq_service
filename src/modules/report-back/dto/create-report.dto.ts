import { IsNotEmpty, IsString } from "class-validator";

export class CreateReportDto {
  @IsString()
  @IsNotEmpty()
  sendId!: string;

  @IsString()
  @IsNotEmpty()
  rawFeedback!: string;
}
