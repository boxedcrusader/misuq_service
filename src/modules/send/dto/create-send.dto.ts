import { IsNotEmpty, IsString } from "class-validator";

export class CreateSendDto {
  @IsString()
  @IsNotEmpty()
  contentPieceId!: string;

  @IsString()
  @IsNotEmpty()
  audienceId!: string;
}
