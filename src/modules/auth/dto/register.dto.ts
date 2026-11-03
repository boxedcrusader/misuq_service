import { Transform } from "class-transformer";
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from "class-validator";
import { normalizeEmail } from "../normalize-email";

export class RegisterDto {
  @Transform(({ value }) => (typeof value === "string" ? normalizeEmail(value) : value))
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(8)
  // Bounds the scrypt input; long passphrases still fit comfortably.
  @MaxLength(128)
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;
}
