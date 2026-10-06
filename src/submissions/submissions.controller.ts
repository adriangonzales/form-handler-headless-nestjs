import { Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiProperty,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { requestInput } from '../common/http/request-input';
import { RateLimited } from '../common/rate-limit/rate-limited.decorator';
import { Throttler } from '../common/rate-limit/throttlers';
import { Validated } from '../common/validation/validated.decorator';
import { FormEntrySubmitted } from '../events/form-entry-submitted.event';
import { CreateFormEntry } from '../form-entries/create-form-entry.service';
import { honeypotTripped, withSettingsDefaults } from '../forms/form-settings';
import type { Form } from '../forms/form.entity';
import { buildRules } from '../forms/schema-rules/build-rules';
import {
  SubmissionFormGuard,
  submittedForm,
  SubmittedForm,
} from './submission-form.guard';

class SubmissionResult {
  @ApiProperty({ type: String, nullable: true })
  redirect!: string | null;

  @ApiProperty({ type: String, nullable: true })
  message!: string | null;
}

class SubmissionResponse {
  @ApiProperty({ type: SubmissionResult })
  data!: SubmissionResult;
}

export const HONEYPOT_REASON = 'Honeypot field was filled in.';

/**
 * `FormSubmissionController` (ch. 3 §3.6). The rate limits are class guards,
 * so they run before the form lookup: unknown IDs are counted and 429 comes
 * before 404.
 */
@ApiTags('Submissions')
@Controller('forms')
@RateLimited(Throttler.SubmissionsIp, Throttler.SubmissionsForm)
@ApiTooManyRequestsResponse()
export class SubmissionsController {
  constructor(
    private readonly createFormEntry: CreateFormEntry,
    private readonly events: EventEmitter2,
  ) {}

  /**
   * Accept a public, unauthenticated submission. Body fields are the schema's
   * input names; unknown ones are dropped. The response carries the form's
   * `redirect` and `message` (never a 3XX). A honeypot hit gets the same
   * response but is stored as spam.
   */
  @Post(':form/submissions')
  @UseGuards(SubmissionFormGuard)
  @HttpCode(201)
  @ApiCreatedResponse({ type: SubmissionResponse })
  @ApiNotFoundResponse()
  @ApiForbiddenResponse()
  @ApiUnprocessableEntityResponse()
  async submit(
    @SubmittedForm() form: Form,
    @Validated({ rules: ({ req }) => buildRules(submittedForm(req).schema) })
    input: unknown,
    @Req() req: Request,
  ): Promise<SubmissionResponse> {
    const settings = withSettingsDefaults(form.settings);
    const spamReason = honeypotTripped(settings, requestInput(req).all)
      ? HONEYPOT_REASON
      : null;

    const entry = await this.createFormEntry.execute(form, input, req, {
      spamReason,
      awaitsSpamCheck: spamReason === null,
    });
    this.events.emit(FormEntrySubmitted.event, new FormEntrySubmitted(entry));

    return {
      data: { redirect: settings.redirect, message: settings.message },
    };
  }
}
