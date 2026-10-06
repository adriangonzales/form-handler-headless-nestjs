import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import type { Request } from 'express';
import { Repository } from 'typeorm';
import { Clock } from '../common/clock/clock';
import { newUlid } from '../common/db/ulid';
import { getClientIps } from '../common/http/trust-proxy';
import { FormEntryCreated } from '../events/form-entry-created.event';
import type { Form } from '../forms/form.entity';
import { FormEntry } from './form-entry.entity';

/** The width of the `varchar(255)` columns, in characters. */
const COLUMN_WIDTH = 255;

/** `Str::substr($value, 0, 255)`: code points, as `mb_substr` counts them. */
export function limitColumn(value: string): string {
  const chars = [...value];
  return chars.length > COLUMN_WIDTH
    ? chars.slice(0, COLUMN_WIDTH).join('')
    : value;
}

export interface CreateFormEntryOptions {
  /** Flags the entry as spam, which stops alerts being sent for it. */
  spamReason?: string | null;
  /** Clean public submissions wait for the spam check (ch. 6). */
  awaitsSpamCheck?: boolean;
}

/**
 * `CreateFormEntry` (ch. 3 §3.5): stores the validated input with the
 * request's metadata and emits `form-entry.created`. Shared by both
 * submission endpoints.
 */
@Injectable()
export class CreateFormEntry {
  constructor(
    @InjectRepository(FormEntry)
    private readonly entries: Repository<FormEntry>,
    private readonly clock: Clock,
    private readonly events: EventEmitter2,
  ) {}

  async execute(
    form: Form,
    input: unknown,
    req: Request,
    { spamReason = null, awaitsSpamCheck = false }: CreateFormEntryOptions = {},
  ): Promise<FormEntry> {
    const referer = limitColumn(req.headers.referer ?? '');
    const userAgent = req.headers['user-agent'];
    const entry = await this.entries.save(
      this.entries.create({
        id: newUlid(),
        formId: form.id,
        input: input as FormEntry['input'],
        // Laravel doesn't limit these; SQLite stores any length, Postgres
        // would reject them, so they're cut to the column width.
        ip: limitColumn(getClientIps(req).join(',')),
        ipLocationDisplay: null,
        // `?: null`: PHP treats "" and "0" as empty.
        referer: referer === '' || referer === '0' ? null : referer,
        userAgent: userAgent === undefined ? null : limitColumn(userAgent),
        userAgentDisplay: null,
        spam: spamReason !== null,
        spamScore: 0,
        spamReason,
        spamCheckedAt: awaitsSpamCheck ? null : this.clock.now(),
        starred: false,
        readAt: null,
      }),
    );
    this.events.emit(FormEntryCreated.event, new FormEntryCreated(entry));
    return entry;
  }
}
