import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Request, Response } from 'express';

/** Laravel's `Router::$verbs`, which also orders the `Allow` header. */
const VERBS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];

interface RouterLayer {
  route?: { methods: Record<string, boolean | undefined> };
  match(path: string): boolean;
}

/**
 * Renders every error as Laravel's JSON shape, `{ "message": ... }`, whatever
 * the request's `Accept` header (ch. 1 §1.4, ch. 3 §3.2).
 *
 * Phase 1 covers routing (404, 405), request preparation (413) and the
 * fallback 500. Validation, auth and throttling bodies arrive in phase 3.
 */
@Catch()
export class LaravelExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(LaravelExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    if (res.headersSent) return;

    // Nest's not-found handler runs when no route matched; a NotFoundException
    // from inside a handler has `req.route` set.
    if (exception instanceof NotFoundException && req.route === undefined) {
      return this.renderRoutingMiss(req, res);
    }

    if (exception instanceof HttpException) {
      res.status(exception.getStatus()).json({ message: exception.message });
      return;
    }

    this.logger.error(exception);
    res.status(500).json({ message: 'Server Error' });
  }

  /**
   * Laravel answers 405 with an `Allow` header when the path matches a route
   * under another method, and 404 otherwise (`AbstractRouteCollection`).
   */
  private renderRoutingMiss(req: Request, res: Response): void {
    const path = laravelPath(req);
    const others = allowedMethods(req).filter((verb) => verb !== req.method);

    if (others.length === 0) {
      res
        .status(404)
        .json({ message: `The route ${path} could not be found.` });
      return;
    }

    res.setHeader('Allow', others.join(', '));
    if (req.method === 'OPTIONS') {
      res.status(200).end();
      return;
    }
    res.status(405).json({
      message: `The ${req.method} method is not supported for route ${path}. Supported methods: ${others.join(', ')}.`,
    });
  }
}

/** Laravel's `$request->path()`: no surrounding slashes, `/` for the root. */
function laravelPath(req: Request): string {
  const path = req.path.replace(/^\/+|\/+$/g, '');
  return path === '' ? '/' : path;
}

/** Methods of every registered route whose path matches the request's path. */
function allowedMethods(req: Request): string[] {
  const router = (req.app as unknown as { router?: { stack: RouterLayer[] } })
    .router;
  const found = new Set<string>();
  for (const layer of router?.stack ?? []) {
    if (layer.route === undefined || !layer.match(req.path)) continue;
    for (const [method, enabled] of Object.entries(layer.route.methods)) {
      if (!enabled) continue;
      if (method === '_all') VERBS.forEach((verb) => found.add(verb));
      found.add(method.toUpperCase());
      if (method === 'get') found.add('HEAD');
    }
  }
  return VERBS.filter((verb) => found.has(verb));
}
