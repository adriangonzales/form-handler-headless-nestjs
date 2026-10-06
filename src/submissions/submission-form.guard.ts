import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { DataSource } from 'typeorm';
import { AuthorizationException } from '../common/http/laravel-exceptions';
import {
  assertAcceptsSubmissions,
  bindRouteModel,
} from '../forms/form-ownership.guard';
import { allowsReferer, withSettingsDefaults } from '../forms/form-settings';
import type { Form } from '../forms/form.entity';

const forms = new WeakMap<Request, Form>();

export function submittedForm(req: Request): Form {
  const form = forms.get(req);
  if (!form) throw new Error('No SubmissionFormGuard on this route');
  return form;
}

/**
 * `FormSubmissionRequest::authorize()` (ch. 3 §3.6), after the rate limits:
 * the form must exist and not be deleted (404), be active (403), and, when
 * it lists domains, be submitted from one of them (403). No owner check.
 */
@Injectable()
export class SubmissionFormGuard implements CanActivate {
  constructor(private readonly dataSource: DataSource) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const form = await bindRouteModel<Form>(
      this.dataSource,
      'form',
      req.params.form as string,
    );
    assertAcceptsSubmissions(form);
    if (
      !allowsReferer(withSettingsDefaults(form.settings), req.headers.referer)
    )
      throw new AuthorizationException(
        'Submissions are not accepted from this domain.',
      );
    forms.set(req, form);
    return true;
  }
}

/** The form a public submission is for. */
export const SubmittedForm = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Form =>
    submittedForm(ctx.switchToHttp().getRequest<Request>()),
);
