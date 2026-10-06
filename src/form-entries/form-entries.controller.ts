import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Patch,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiProperty,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { Authenticated } from '../auth/auth.guards';
import { LaravelHttpException } from '../common/http/laravel-exceptions';
import {
  paginationContext,
  paginationEnvelope,
  type Paginated,
} from '../common/http/paginate';
import { asBag } from '../common/http/request-input';
import { Validated } from '../common/validation/validated.decorator';
import {
  OwnedForm,
  OwnsActiveForm,
  OwnsForm,
  ownedForm,
  RouteModel,
  WithTrashed,
} from '../forms/form-ownership.guard';
import type { Form } from '../forms/form.entity';
import { DEFAULT_PER_PAGE } from '../forms/rules/form.rules';
import { buildRules } from '../forms/schema-rules/build-rules';
import { CreateFormEntry } from './create-form-entry.service';
import { FormEntriesService } from './form-entries.service';
import type { FormEntry } from './form-entry.entity';
import {
  FormEntryCollection,
  formEntryResource,
  FormEntryResponse,
  type FormEntryResource,
} from './form-entry.resource';
import {
  formEntryBulkRules,
  formEntryIndexRules,
  formEntryUpdateRules,
  type BulkAction,
  type FormEntryBulkInput,
  type FormEntryIndexInput,
  type FormEntryUpdateInput,
} from './rules/form-entry.rules';

class BulkResult {
  @ApiProperty()
  action!: BulkAction;

  @ApiProperty({ type: 'integer' })
  affected!: number;
}

class BulkResponse {
  @ApiProperty({ type: BulkResult })
  data!: BulkResult;
}

/**
 * `FormEntryController` (ch. 3 §3.5): list, create and bulk go through the
 * form; the rest use the entry's own ID (shallow nesting).
 */
@ApiTags('Entries')
@Controller()
@Authenticated()
export class FormEntriesController {
  constructor(
    private readonly entries: FormEntriesService,
    private readonly createFormEntry: CreateFormEntry,
    private readonly events: EventEmitter2,
  ) {}

  /** The form's entries, oldest first, with sort and filters. */
  @Get('forms/:form/entries')
  @OwnsForm()
  @ApiOkResponse({ type: FormEntryCollection })
  @ApiUnprocessableEntityResponse()
  async index(
    @OwnedForm() form: Form,
    @Validated({ rules: formEntryIndexRules }) input: FormEntryIndexInput,
    @Req() req: Request,
  ): Promise<Paginated<FormEntryResource>> {
    const { per_page, sort, filter } = asBag(input) as FormEntryIndexInput;
    const { page, context } = paginationContext(req, true);
    const perPage =
      per_page === undefined ? DEFAULT_PER_PAGE : Number(per_page);
    const { items, total } = await this.entries.paginate(
      form,
      { sort, filter },
      page,
      perPage,
    );
    return paginationEnvelope(
      items.map(formEntryResource),
      total,
      perPage,
      page,
      context,
    );
  }

  /**
   * Add an entry as the form's owner. No spam check, alert or user-agent
   * parsing: only public submissions get those.
   */
  @Post('forms/:form/entries')
  @OwnsActiveForm()
  @HttpCode(201)
  @ApiCreatedResponse({ type: FormEntryResponse })
  @ApiUnprocessableEntityResponse()
  async store(
    @OwnedForm() form: Form,
    @Validated({ rules: ({ req }) => buildRules(ownedForm(req).schema) })
    input: unknown,
    @Req() req: Request,
  ): Promise<FormEntryResponse> {
    const entry = await this.createFormEntry.execute(form, input, req);
    return { data: formEntryResource(entry) };
  }

  /** Apply one triage action to up to 100 of the form's entries. */
  @Post('forms/:form/entries/bulk')
  @OwnsForm()
  @HttpCode(200)
  @ApiOkResponse({ type: BulkResponse })
  @ApiUnprocessableEntityResponse()
  async bulk(
    @OwnedForm() form: Form,
    @Validated({ rules: formEntryBulkRules }) input: FormEntryBulkInput,
  ): Promise<BulkResponse> {
    const affected = await this.entries.bulk(form, input.action, input.ids);
    return { data: { action: input.action, affected } };
  }

  @Get('entries/:entry')
  @OwnsForm()
  @ApiOkResponse({ type: FormEntryResponse })
  show(@RouteModel() entry: FormEntry): FormEntryResponse {
    return { data: formEntryResource(entry) };
  }

  /** Change triage fields; each is optional. Submission fields are rejected. */
  @Put('entries/:entry')
  @OwnsForm()
  @ApiOkResponse({ type: FormEntryResponse })
  @ApiUnprocessableEntityResponse()
  async update(
    @RouteModel() entry: FormEntry,
    @Validated({ rules: formEntryUpdateRules }) input: FormEntryUpdateInput,
  ): Promise<FormEntryResponse> {
    const updated = await this.entries.update(entry, asBag(input));
    return { data: formEntryResource(updated) };
  }

  /** Same as PUT. */
  @Patch('entries/:entry')
  @OwnsForm()
  @ApiOkResponse({ type: FormEntryResponse })
  @ApiUnprocessableEntityResponse()
  patch(
    @RouteModel() entry: FormEntry,
    @Validated({ rules: formEntryUpdateRules }) input: FormEntryUpdateInput,
  ): Promise<FormEntryResponse> {
    return this.update(entry, input);
  }

  @Delete('entries/:entry')
  @OwnsForm()
  @HttpCode(204)
  @ApiNoContentResponse()
  async destroy(@RouteModel() entry: FormEntry): Promise<void> {
    await this.entries.delete(entry);
  }

  @Post('entries/:entry/restore')
  @OwnsForm()
  @WithTrashed()
  @HttpCode(200)
  @ApiOkResponse({ type: FormEntryResponse })
  async restore(@RouteModel() entry: FormEntry): Promise<FormEntryResponse> {
    return { data: formEntryResource(await this.entries.restore(entry)) };
  }

  /** Permanently delete an entry that is already deleted. */
  @Delete('entries/:entry/force')
  @OwnsForm()
  @WithTrashed()
  @HttpCode(204)
  @ApiNoContentResponse()
  @ApiConflictResponse({
    description: 'Only deleted entries can be permanently deleted.',
  })
  async forceDestroy(@RouteModel() entry: FormEntry): Promise<void> {
    if (entry.deletedAt === null)
      throw new LaravelHttpException(
        409,
        'Only deleted entries can be permanently deleted.',
      );
    await this.entries.forceDelete(entry);
  }
}
