import {
  createParamDecorator,
  ExecutionContext,
  Injectable,
  type ArgumentMetadata,
  type PipeTransform,
  type Type,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { Request } from 'express';
import { ValidationException } from '../http/laravel-exceptions';
import { requestInput } from '../http/request-input';
import { validate, type AfterHook, type RuleSet } from './validator';

/** What a rule factory can use: the request, its prepared input, and services. */
export interface ValidationRequestContext {
  req: Request;
  /** `$request->all()` after input preparation. */
  input: Record<string, unknown>;
  resolve<T>(token: Type<T> | string | symbol): T;
}

/**
 * A Laravel Form Request's validation: `rules()`, an optional
 * `prepareForValidation()` (use `mergeInput()`), and `after()` hooks.
 */
export interface ValidationSpec {
  rules:
    RuleSet | ((ctx: ValidationRequestContext) => RuleSet | Promise<RuleSet>);
  prepare?: (ctx: ValidationRequestContext) => void | Promise<void>;
  after?: (ctx: ValidationRequestContext) => AfterHook[];
}

@Injectable()
export class ValidatedPipe implements PipeTransform<Request, Promise<unknown>> {
  constructor(private readonly moduleRef: ModuleRef) {}

  async transform(req: Request, metadata: ArgumentMetadata): Promise<unknown> {
    const spec = metadata.data as unknown as ValidationSpec;
    const context = (): ValidationRequestContext => ({
      req,
      input: requestInput(req).all,
      resolve: <T>(token: Type<T> | string | symbol) =>
        this.moduleRef.get<T>(token, { strict: false }),
    });

    await spec.prepare?.(context());
    const ctx = context();
    const rules =
      typeof spec.rules === 'function' ? await spec.rules(ctx) : spec.rules;
    const result = await validate(rules, ctx.input, spec.after?.(ctx) ?? []);
    if (!result.passes)
      throw new ValidationException(result.message ?? '', result.errors);
    return result.validated;
  }
}

const RequestParam = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) =>
    ctx.switchToHttp().getRequest<Request>(),
);

/**
 * Validates the prepared request input (`$request->all()`) and injects
 * Laravel's `validated()` output; failures throw a 422 `ValidationException`.
 * Runs after guards, so the check order is 401 → 404 → 403 → 422 (ch. 3 §3.2).
 *
 *   store(@Validated({ rules: formStoreRules }) input: FormStoreInput)
 */
export function Validated(spec: ValidationSpec): ParameterDecorator {
  return RequestParam(spec, ValidatedPipe);
}
