import type { NestExpressApplication } from '@nestjs/platform-express';
import express, { NextFunction, Request, Response } from 'express';
import type { IncomingMessage } from 'node:http';
import multer from 'multer';
import { PostTooLargeException } from './json-error';

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
  app.use(multipartFields());
  // Express 5 leaves `req.body` undefined when nothing parsed a body.
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.body ??= {};
    next();
  });
}

/** Laravel's `ValidatePostSize`: compares `Content-Length` before parsing. */
function rejectOversizedBody(limit: number) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const length = Number(req.headers['content-length'] ?? 0);
    next(length > limit ? new PostTooLargeException() : undefined);
  };
}

/** Laravel's `Request::isJson()`: the content type contains `/json` or `+json`. */
function isJsonRequest(req: IncomingMessage): boolean {
  const type = req.headers['content-type'] ?? '';
  return type.includes('/json') || type.includes('+json');
}

/**
 * JSON bodies. A body that fails to parse becomes `{}`, as Laravel's
 * `$request->json()` decodes it to `null` and carries on (422, not 400).
 * Non-object values are cast the way PHP's `(array)` cast does.
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
      if (isJsonRequest(req)) req.body = toArrayCast(req.body);
      next();
    });
  };
}

function urlencoded(limit: number) {
  // Production's `max_input_vars` is 1000. PHP drops extra variables;
  // body-parser answers 413 instead, which is accepted (ch. 1 §1.4).
  const parse = express.urlencoded({
    extended: true,
    limit,
    parameterLimit: 1000,
  });
  return (req: Request, res: Response, next: NextFunction) => {
    parse(req, res, (err?: unknown) => {
      if (
        isBodyParserError(err, 'entity.too.large') ||
        isBodyParserError(err, 'parameters.too.many')
      ) {
        return next(new PostTooLargeException());
      }
      if (err !== undefined) req.body = {};
      next();
    });
  };
}

/** Multipart text fields. File parts are drained and ignored. */
function multipartFields() {
  const parse = multer({ storage: discardFiles }).any();
  return (req: Request, res: Response, next: NextFunction) => {
    parse(req, res, (err?: unknown) => {
      // PHP silently ends up with no input for a malformed multipart body.
      if (err !== undefined) req.body = {};
      delete req.files;
      next();
    });
  };
}

const discardFiles: multer.StorageEngine = {
  _handleFile(_req, file, callback) {
    file.stream.on('end', () => callback(null, {}));
    file.stream.on('error', (error: Error) => callback(error));
    file.stream.resume();
  },
  _removeFile(_req, _file, callback) {
    callback(null);
  },
};

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
