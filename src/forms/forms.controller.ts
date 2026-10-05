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
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { Authenticated, CurrentUser } from '../auth/auth.guards';
import { parseFilterBoolean } from '../common/http/laravel-boolean';
import {
  paginationContext,
  paginationEnvelope,
  type Paginated,
} from '../common/http/paginate';
import { asBag } from '../common/http/request-input';
import { Validated } from '../common/validation/validated.decorator';
import { FormCreated } from '../events/form-created.event';
import type { User } from '../users/user.entity';
import { OwnedForm, OwnsForm, WithTrashed } from './form-ownership.guard';
import type { Form } from './form.entity';
import {
  FormCollection,
  formResource,
  FormResponse,
  type FormResource,
} from './form.resource';
import { FormsService } from './forms.service';
import {
  DEFAULT_PER_PAGE,
  fillDefaultHoneypotName,
  formAfterHooks,
  formIndexRules,
  formStoreRules,
  formUpdateRules,
  type FormIndexInput,
  type FormSortColumn,
  type FormStoreInput,
  type FormUpdateInput,
} from './rules/form.rules';

/** `FormController` (ch. 3 §3.4). */
@ApiTags('Forms')
@Controller('forms')
@Authenticated()
export class FormsController {
  constructor(
    private readonly forms: FormsService,
    private readonly events: EventEmitter2,
  ) {}

  /** The current user's forms, with entry counts, oldest first. */
  @Get()
  @ApiOkResponse({ type: FormCollection })
  @ApiUnprocessableEntityResponse()
  async index(
    @CurrentUser() user: User,
    @Validated({ rules: formIndexRules }) input: FormIndexInput,
    @Req() req: Request,
  ): Promise<Paginated<FormResource>> {
    // An empty `validated()` is PHP's `[]`, so read it as a bag.
    const {
      per_page,
      sort = 'created_at',
      filter,
    } = asBag(input) as FormIndexInput;
    const { page, context } = paginationContext(req, true);
    const perPage =
      per_page === undefined ? DEFAULT_PER_PAGE : Number(per_page);
    const active = filter?.active;

    const { items, total } = await this.forms.paginateForUser(user.id, {
      active: active === undefined ? null : parseFilterBoolean(active),
      sort: sort.replace(/^-/, '') as FormSortColumn,
      direction: sort.startsWith('-') ? 'DESC' : 'ASC',
      page,
      perPage,
    });
    return paginationEnvelope(
      items.map(({ form, counts }) => formResource(form, counts)),
      total,
      perPage,
      page,
      context,
    );
  }

  /** Create a form for the current user. It starts inactive. */
  @Post()
  @HttpCode(201)
  @ApiCreatedResponse({ type: FormResponse })
  @ApiUnprocessableEntityResponse()
  async store(
    @CurrentUser() user: User,
    @Validated({
      prepare: fillDefaultHoneypotName,
      rules: formStoreRules,
      after: formAfterHooks,
    })
    input: FormStoreInput,
  ): Promise<FormResponse> {
    const form = await this.forms.create(user.id, input);
    this.events.emit(FormCreated.event, new FormCreated(form));
    return { data: formResource(form) };
  }

  @Get(':form')
  @OwnsForm()
  @ApiOkResponse({ type: FormResponse })
  show(@OwnedForm() form: Form): FormResponse {
    return { data: formResource(form) };
  }

  /** Replace the name and `active` flag; `schema` and `settings` when sent. */
  @Put(':form')
  @OwnsForm()
  @ApiOkResponse({ type: FormResponse })
  @ApiUnprocessableEntityResponse()
  async update(
    @OwnedForm() form: Form,
    @Validated({
      prepare: fillDefaultHoneypotName,
      rules: formUpdateRules,
      after: formAfterHooks,
    })
    input: FormUpdateInput,
  ): Promise<FormResponse> {
    return { data: formResource(await this.forms.update(form, input)) };
  }

  /** Same as PUT: `name` and `active` are required either way. */
  @Patch(':form')
  @OwnsForm()
  @ApiOkResponse({ type: FormResponse })
  @ApiUnprocessableEntityResponse()
  patch(
    @OwnedForm() form: Form,
    @Validated({
      prepare: fillDefaultHoneypotName,
      rules: formUpdateRules,
      after: formAfterHooks,
    })
    input: FormUpdateInput,
  ): Promise<FormResponse> {
    return this.update(form, input);
  }

  /** Soft-delete the form. Its entries, recipients and exports are kept. */
  @Delete(':form')
  @OwnsForm()
  @HttpCode(204)
  @ApiNoContentResponse()
  async destroy(@OwnedForm() form: Form): Promise<void> {
    await this.forms.delete(form);
  }

  /** Undo a delete. A form that isn't deleted is returned unchanged. */
  @Post(':form/restore')
  @OwnsForm()
  @WithTrashed()
  @HttpCode(200)
  @ApiOkResponse({ type: FormResponse })
  async restore(@OwnedForm() form: Form): Promise<FormResponse> {
    return { data: formResource(await this.forms.restore(form)) };
  }

  /** Copy the name, schema and settings into a new, inactive form. */
  @Post(':form/duplicate')
  @OwnsForm()
  @HttpCode(201)
  @ApiCreatedResponse({ type: FormResponse })
  async duplicate(@OwnedForm() form: Form): Promise<FormResponse> {
    const copy = await this.forms.duplicate(form);
    this.events.emit(FormCreated.event, new FormCreated(copy));
    return { data: formResource(copy) };
  }
}
