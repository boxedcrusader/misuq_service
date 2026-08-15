import { IsNotEmpty, IsString, MaxLength } from "class-validator";

export class UpdateContentPieceDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(20000) // generous cap for a long-form blog draft; guards against abuse, not real content
  body!: string;
}
