import type { NestExpressApplication } from '@nestjs/platform-express';
import busboy from 'busboy';
import express, { NextFunction, Request, Response } from 'express';
import type { IncomingMessage } from 'node:http';
import { toPhpShape } from '../validation/php';
import { MethodOverrideException, PostTooLargeException } from './json-error';
import { countPhpVariables, parsePhpQuery, PhpVariables } from './php-input';
import { isJsonRequest } from './request-input';

/** PHP's `max_input_vars` in production (ch. 1 §1.4). */
const MAX_INPUT_VARS = 1000;

/** Methods PHP/Symfony parse form bodies for (`$_POST`, `request_parse_body()`). */
const FORM_BODY_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

/**
 * Laravel-compatible body parsing (ch. 3 §3.2, _Request input_, step 1).
 * Nest's built-in parser must be off (`bodyParser: false`).
 */
export function registerBodyParsers(
  app: NestExpressApplication,
  limit: number,
): void {
  app.use(rejectOversizedBody(limit));
  app.use(lenientJson(limit));
  app.use(urlencoded(limit));
  app.use(multipartFields(limit));
  // Express 5 leaves `req.body` undefined when nothing parsed a body.
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.body ??= {};
    next();
  });
  app.use(methodOverride);
}

/** Oversized bodies up to this size are read and discarded before the 413 (see below). */
const MAX_DRAIN_BYTES = 16 * 1024 * 1024;

/**
 * Laravel's `ValidatePostSize`: compares `Content-Length` before parsing.
 * The body is drained before answering, as PHP's server does, because Node
 * closes the socket on an unread body and the client then fails with EPIPE
 * mid-upload instead of reading the 413. Bodies beyond `MAX_DRAIN_BYTES`
 * get the 413 with `Connection: close` straight away.
 */
function rejectOversizedBody(limit: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const length = Number(req.headers['content-length'] ?? 0);
    if (length <= limit) return next();
    if (length > MAX_DRAIN_BYTES) {
      res.setHeader('Connection', 'close');
      return next(new PostTooLargeException());
    }
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      next(new PostTooLargeException());
    };
    req.on('end', finish);
    req.on('error', finish);
    req.resume();
  };
}

function isType(req: IncomingMessage, type: string): boolean {
  return (req.headers['content-type'] ?? '').toLowerCase().startsWith(type);
}

/**
 * JSON bodies, for any method. A body that fails to parse becomes `{}`, as
 * Laravel's `$request->json()` decodes it to `null` and carries on (422, not
 * 400). Values take the shape `json_decode($json, true)` gives.
 */
function lenientJson(limit: number) {
  const parse = express.json({ limit, strict: false, type: isJsonRequest });
  return (req: Request, res: Response, next: NextFunction) => {
    parse(req, res, (err?: unknown) => {
      if (isBodyParserError(err, 'entity.too.large')) {
        return next(new PostTooLargeException());
      }
      if (err !== undefined) {
        req.body = {};
        return next();
      }
      if (isJsonRequest(req)) req.body = toArrayCast(toPhpShape(req.body));
      next();
    });
  };
}

/** `application/x-www-form-urlencoded`, parsed like PHP's `parse_str()`. */
function urlencoded(limit: number) {
  const read = express.text({
    limit,
    type: (req) => isType(req, 'application/x-www-form-urlencoded'),
  });
  return (req: Request, res: Response, next: NextFunction) => {
    if (!FORM_BODY_METHODS.includes(req.method)) return next();
    read(req, res, (err?: unknown) => {
      if (isBodyParserError(err, 'entity.too.large'))
        return next(new PostTooLargeException());
      if (err !== undefined) {
        req.body = {};
        return next();
      }
      if (typeof req.body !== 'string') return next();
      // PHP drops variables past max_input_vars; body-parser-style 413 is the
      // accepted difference (ch. 1 §1.4).
      if (countPhpVariables(req.body) > MAX_INPUT_VARS)
        return next(new PostTooLargeException());
      req.body = parsePhpQuery(req.body);
      next();
    });
  };
}

/** `multipart/form-data` text fields, registered like PHP does. Files are drained and ignored. */
function multipartFields(limit: number) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (
      !FORM_BODY_METHODS.includes(req.method) ||
      !isType(req, 'multipart/form-data')
    ) {
      return next();
    }
    let parser: busboy.Busboy;
    try {
      parser = busboy({
        headers: req.headers,
        limits: { fields: MAX_INPUT_VARS, fieldSize: limit },
      });
    } catch {
      // A malformed multipart header: PHP ends up with no input.
      req.body = {};
      return next();
    }
    const vars = new PhpVariables();
    let done = false;
    const finish = (body: unknown) => {
      if (done) return;
      done = true;
      req.body = body;
      next();
    };
    parser.on('field', (name, value) => vars.register(name, value));
    parser.on('file', (_name, stream) => stream.resume());
    parser.on('close', () => finish(vars.toValue()));
    parser.on('error', () => finish({}));
    req.pipe(parser);
  };
}

/**
 * Symfony's `Request::getMethod()` with Laravel's method override enabled: a
 * POST may become PUT/PATCH/DELETE/… through `X-HTTP-Method-Override`, or a
 * `_method` input (body first, then query). GET, HEAD, CONNECT and TRACE are
 * ignored; anything not A–Z is rejected as Laravel does.
 */
function methodOverride(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  if (req.method !== 'POST') return next();
  const header = req.headers['x-http-method-override'];
  const body = req.body as Record<string, unknown>;
  const query = req.query as Record<string, unknown>;
  const candidate =
    (typeof header === 'string' && header !== '' ? header : undefined) ??
    ('_method' in body
      ? body._method
      : '_method' in query
        ? query._method
        : 'POST');
  if (typeof candidate !== 'string') return next();
  const method = candidate.toUpperCase();
  if (['GET', 'HEAD', 'CONNECT', 'TRACE'].includes(method)) return next();
  if (!/^[A-Z]+$/.test(method)) return next(new MethodOverrideException());
  req.method = method;
  next();
}

function toArrayCast(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) return {};
  if (Array.isArray(value)) return { ...value };
  if (typeof value === 'object') return value as Record<string, unknown>;
  return { 0: value };
}

function isBodyParserError(err: unknown, type: string): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { type?: unknown }).type === type
  );
}
