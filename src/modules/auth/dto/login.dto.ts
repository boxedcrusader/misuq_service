import { Transform } from "class-transformer";
import { IsEmail, IsNotEmpty, IsString, MaxLength } from "class-validator";
import { normalizeEmail } from "../normalize-email";

export class LoginDto {
  @Transform(({ value }) => (typeof value === "string" ? normalizeEmail(value) : value))
  @IsEmail()
  email!: string;

  // No MinLength here on purpose: login checks a password, it doesn't
  // enforce today's signup policy on accounts created under an older one.
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  password!: string;
}
