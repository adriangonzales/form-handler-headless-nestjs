import {
  applyDecorators,
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UseGuards,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiForbiddenResponse, ApiNotFoundResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { DataSource, type EntityTarget, type ObjectLiteral } from 'typeorm';
import { authContext } from '../auth/auth.guards';
import { isUlid } from '../common/db/ulid';
import {
  AuthorizationException,
  LaravelHttpException,
} from '../common/http/laravel-exceptions';
import { FormEntryExport } from '../entry-exports/form-entry-export.entity';
import { FormEntry } from '../form-entries/form-entry.entity';
import { FormNotification } from '../form-notifications/form-notification.entity';
import { Form } from './form.entity';

/** Route parameters bound to a model, as Laravel's implicit binding does. */
export type RouteModelName = 'form' | 'entry' | 'notification' | 'export';

const ROUTE_MODELS: Record<
  RouteModelName,
  { entity: EntityTarget<ObjectLiteral>; laravelClass: string }
> = {
  form: { entity: Form, laravelClass: 'App\\Models\\Form' },
  entry: { entity: FormEntry, laravelClass: 'App\\Models\\FormEntry' },
  notification: {
    entity: FormNotification,
    laravelClass: 'App\\Models\\FormNotification',
  },
  export: {
    entity: FormEntryExport,
    laravelClass: 'App\\Models\\FormEntryExport',
  },
};

/** 404 for a missing model (`ModelNotFoundException`, message as Laravel renders it). */
export class ModelNotFoundException extends LaravelHttpException {
  constructor(name: RouteModelName, id: string) {
    super(
      404,
      `No query results for model [${ROUTE_MODELS[name].laravelClass}] ${id}`,
    );
  }
}

/**
 * Implicit route model binding: an ID that isn't a ULID is 404 without a
 * query; otherwise an exact (case-sensitive) match, hiding soft-deleted rows
 * unless the route is `withTrashed()`.
 */
export async function bindRouteModel<T extends ObjectLiteral>(
  dataSource: DataSource,
  name: RouteModelName,
  id: string,
  withTrashed = false,
): Promise<T> {
  const model = isUlid(id)
    ? await dataSource
        .getRepository<T>(ROUTE_MODELS[name].entity as EntityTarget<T>)
        .findOne({ where: { id } as never, withDeleted: withTrashed })
    : null;
  if (model === null) throw new ModelNotFoundException(name, id);
  return model;
}

const WITH_TRASHED = 'routes:withTrashed';

/** Laravel's `->withTrashed()` on a route: the bound model may be soft-deleted. */
export const WithTrashed = (): MethodDecorator & ClassDecorator =>
  SetMetadata(WITH_TRASHED, true);

interface Ownership {
  model: ObjectLiteral;
  form: Form;
}

const ownerships = new WeakMap<Request, Ownership>();

function ownership(req: Request): Ownership {
  const found = ownerships.get(req);
  if (!found) throw new Error('No FormOwnershipGuard on this route');
  return found;
}

/** The owning form resolved by `FormOwnershipGuard`. */
export function ownedForm(req: Request): Form {
  return ownership(req).form;
}

const PARAMS: RouteModelName[] = ['form', 'entry', 'notification', 'export'];

/**
 * `FormPolicy`, `FormEntryPolicy`, `FormNotificationPolicy` and
 * `FormEntryExportPolicy` (ch. 3 §3.3): binds the route's `:form`,
 * `:entry`, `:notification` or `:export` (404), then requires the current
 * user to own the form (403). A child's form must not be soft-deleted, so a
 * child of a deleted form is 403, not 404. Runs after the auth guards.
 */
@Injectable()
export class FormOwnershipGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly dataSource: DataSource,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const name = PARAMS.find((param) => req.params[param] !== undefined);
    if (name === undefined)
      throw new Error('FormOwnershipGuard needs a bound route parameter');

    const withTrashed =
      this.reflector.getAllAndOverride<boolean>(WITH_TRASHED, [
        context.getHandler(),
        context.getClass(),
      ]) ?? false;
    const model = await bindRouteModel(
      this.dataSource,
      name,
      req.params[name] as string,
      withTrashed,
    );
    const form =
      name === 'form'
        ? (model as Form)
        : await this.dataSource
            .getRepository(Form)
            .findOneBy({ id: (model as { formId: string }).formId });

    if (form === null || form.userId !== authContext(req).user.id)
      throw new AuthorizationException('You do not own this form.');

    ownerships.set(req, { model, form });
    return true;
  }
}

/** Ownership check on a `:form` / `:entry` / `:notification` / `:export` route. */
export function OwnsForm(): MethodDecorator & ClassDecorator {
  return applyDecorators(
    UseGuards(FormOwnershipGuard),
    ApiNotFoundResponse({ description: 'Unknown or deleted ID.' }),
    ApiForbiddenResponse({ description: 'You do not own this form.' }),
  );
}

/** The owning form on an `@OwnsForm()` route. */
export const OwnedForm = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Form =>
    ownedForm(ctx.switchToHttp().getRequest<Request>()),
);

/** The bound `:entry` / `:notification` / `:export` on an `@OwnsForm()` route. */
export const RouteModel = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): ObjectLiteral =>
    ownership(ctx.switchToHttp().getRequest<Request>()).model,
);

/** `FormPolicy::submit()`: the form must be active. */
export function assertAcceptsSubmissions(form: Form): void {
  if (!form.active)
    throw new AuthorizationException('This form is not accepting submissions.');
}

/** Runs after `FormOwnershipGuard`: the owned form must be active. */
@Injectable()
export class FormAcceptsSubmissionsGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    assertAcceptsSubmissions(
      ownedForm(context.switchToHttp().getRequest<Request>()),
    );
    return true;
  }
}

/**
 * `FormEntryStoreRequest::authorize()`: the owner (403 "You do not own this
 * form."), then an active form (403 "This form is not accepting submissions.").
 */
export function OwnsActiveForm(): MethodDecorator & ClassDecorator {
  return applyDecorators(
    UseGuards(FormOwnershipGuard, FormAcceptsSubmissionsGuard),
    ApiNotFoundResponse({ description: 'Unknown or deleted ID.' }),
    ApiForbiddenResponse({
      description: 'Not the owner, or the form is inactive.',
    }),
  );
}
