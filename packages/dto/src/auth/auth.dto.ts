import { IsNotEmpty, IsString } from "class-validator";

/** Body of POST /auth/login — the shared access code. */
export class AuthLoginDto {
  @IsString()
  @IsNotEmpty()
  code!: string;
}

/** Response of POST /auth/login. */
export interface AuthTokenDto {
  token: string;
}
