import { IsNotEmpty, IsString, MaxLength } from "class-validator";

export class CreateSendDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  contentPieceId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  audienceId!: string;
}
