import { IsNotEmpty, IsString, MaxLength, MinLength } from "class-validator";

export class SetVoiceSampleDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(40) // reject one-word junk -- needs enough text to read a register
  @MaxLength(4000) // this flows straight into the Gemini prompt -- keep token cost bounded
  styleSample!: string;
}
