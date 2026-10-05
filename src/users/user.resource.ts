import { ApiProperty } from '@nestjs/swagger';
import { toLaravelIso } from '../common/http/timestamps';
import type { User } from './user.entity';

/** `UserResource`. */
export class UserResource {
  @ApiProperty()
  id!: number;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  email_verified_at!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  created_at!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  updated_at!: string | null;
}

export class UserResponse {
  @ApiProperty({ type: UserResource })
  data!: UserResource;
}

export function userResource(user: User): UserResponse {
  return {
    data: {
      id: user.id,
      name: user.name,
      email: user.email,
      email_verified_at: toLaravelIso(user.emailVerifiedAt),
      created_at: toLaravelIso(user.createdAt),
      updated_at: toLaravelIso(user.updatedAt),
    },
  };
}
