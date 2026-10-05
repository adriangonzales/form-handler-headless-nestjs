import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginatedResponse } from '../common/http/paginated.swagger';
import { toLaravelIso } from '../common/http/timestamps';
import { orderedSchema } from './form-field';
import { withSettingsDefaults } from './form-settings';
import type { Form } from './form.entity';

export class FormFieldResource {
  @ApiProperty()
  id!: string;

  @ApiProperty({ type: 'integer' })
  order!: number;

  @ApiPropertyOptional({ type: String, nullable: true })
  label?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  name?: string | null;

  @ApiPropertyOptional({
    oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }],
    nullable: true,
  })
  rules?: string[] | string | null;
}

export class FormSettingsResource {
  @ApiProperty({ type: String, nullable: true })
  redirect!: string | null;

  @ApiProperty({ type: String, nullable: true })
  timezone!: string | null;

  @ApiProperty({ type: [String], nullable: true })
  domains!: string[] | null;

  @ApiProperty({ type: String, nullable: true })
  message!: string | null;

  @ApiProperty()
  honeypot_enabled!: boolean;

  @ApiProperty({ type: String, nullable: true })
  honeypot_name!: string | null;
}

/** `FormResource` (ch. 3 §3.4). */
export class FormResource {
  @ApiProperty()
  id!: string;

  @ApiProperty({ type: 'integer' })
  user_id!: number;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  active!: boolean;

  @ApiProperty({
    type: [FormFieldResource],
    nullable: true,
    description: 'Fields sorted by `order`.',
  })
  schema!: FormFieldResource[] | null;

  @ApiProperty({ type: FormSettingsResource, nullable: true })
  settings!: FormSettingsResource | null;

  @ApiPropertyOptional({
    type: 'integer',
    description:
      'Entries on the form, excluding spam and deleted ones. Included in the form list only.',
  })
  entries_count?: number;

  @ApiPropertyOptional({
    type: 'integer',
    description:
      'Entries on the form not yet marked read, excluding spam and deleted ones. Included in the form list only.',
  })
  unread_entries_count?: number;

  @ApiPropertyOptional({
    type: 'integer',
    description:
      'Entries on the form marked as spam, excluding deleted ones. Included in the form list only.',
  })
  spam_entries_count?: number;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  created_at!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  updated_at!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  deleted_at!: string | null;
}

export class FormResponse {
  @ApiProperty({ type: FormResource })
  data!: FormResource;
}

export const FormCollection = PaginatedResponse(FormResource, 'FormCollection');

/** The list's `withCount()` columns. */
export interface FormEntryCounts {
  entries_count: number;
  unread_entries_count: number;
  spam_entries_count: number;
}

/**
 * `FormResource::toArray()`: `schema` sorted by `order`, `settings` with all
 * six keys, and the entry counts (list only) after `settings`.
 */
export function formResource(
  form: Form,
  counts?: FormEntryCounts,
): FormResource {
  return {
    id: form.id,
    user_id: form.userId,
    name: form.name,
    active: form.active,
    schema: form.schema === null ? null : orderedSchema(form.schema),
    settings:
      form.settings === null ? null : withSettingsDefaults(form.settings),
    ...counts,
    created_at: toLaravelIso(form.createdAt),
    updated_at: toLaravelIso(form.updatedAt),
    deleted_at: toLaravelIso(form.deletedAt),
  };
}
