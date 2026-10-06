import { ApiProperty } from '@nestjs/swagger';
import { PaginatedResponse } from '../common/http/paginated.swagger';
import { toLaravelIso } from '../common/http/timestamps';
import type { FormEntry } from './form-entry.entity';

export class UserAgentDisplayResource {
  @ApiProperty({ type: String, nullable: true })
  platform!: string | null;

  @ApiProperty({ type: String, nullable: true })
  browser!: string | null;

  @ApiProperty({ type: String, nullable: true })
  browser_version!: string | null;
}

/** `FormEntryResource` (ch. 3 §3.5). */
export class FormEntryResource {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  form_id!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    description: 'Validated submission values; `[]` when none.',
  })
  input!: Record<string, unknown> | unknown[] | null;

  @ApiProperty({ type: String, nullable: true })
  ip!: string | null;

  @ApiProperty({ type: String, nullable: true })
  ip_location_display!: string | null;

  @ApiProperty({ type: String, nullable: true })
  referer!: string | null;

  @ApiProperty({ type: String, nullable: true })
  user_agent!: string | null;

  @ApiProperty({ type: UserAgentDisplayResource, nullable: true })
  user_agent_display!: UserAgentDisplayResource | null;

  @ApiProperty({ type: Boolean, nullable: true })
  spam!: boolean | null;

  @ApiProperty({
    type: Number,
    description:
      'Spam likelihood from 0 (not spam) to 1 (spam), to two decimal places.',
  })
  spam_score!: number;

  @ApiProperty({ type: String, nullable: true })
  spam_reason!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  spam_checked_at!: string | null;

  @ApiProperty()
  starred!: boolean;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  read_at!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  created_at!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  updated_at!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  deleted_at!: string | null;
}

export class FormEntryResponse {
  @ApiProperty({ type: FormEntryResource })
  data!: FormEntryResource;
}

export const FormEntryCollection = PaginatedResponse(
  FormEntryResource,
  'FormEntryCollection',
);

export function formEntryResource(entry: FormEntry): FormEntryResource {
  return {
    id: entry.id,
    form_id: entry.formId,
    input: entry.input,
    ip: entry.ip,
    ip_location_display: entry.ipLocationDisplay,
    referer: entry.referer,
    user_agent: entry.userAgent,
    user_agent_display: entry.userAgentDisplay,
    spam: entry.spam,
    spam_score: Number(entry.spamScore),
    spam_reason: entry.spamReason,
    spam_checked_at: toLaravelIso(entry.spamCheckedAt),
    starred: entry.starred,
    read_at: toLaravelIso(entry.readAt),
    created_at: toLaravelIso(entry.createdAt),
    updated_at: toLaravelIso(entry.updatedAt),
    deleted_at: toLaravelIso(entry.deletedAt),
  };
}
