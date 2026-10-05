import { ApiProperty } from '@nestjs/swagger';

/** The login, refresh and password-change response. */
export class TokenResponse {
  @ApiProperty({ type: String })
  access_token!: string;

  @ApiProperty({ type: String, example: 'bearer' })
  token_type!: 'bearer';

  /** The token lifetime in seconds. */
  @ApiProperty({ type: Number, example: 3600 })
  expires_in!: number;
}

export function tokenResponse(
  token: string,
  ttlSeconds: number,
): TokenResponse {
  return { access_token: token, token_type: 'bearer', expires_in: ttlSeconds };
}
