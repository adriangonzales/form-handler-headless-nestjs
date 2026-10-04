import type { ConfigType } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cors from 'cors';
import type { Request } from 'express';
import { registerBodyParsers } from './common/http/body-parsers';
import { parsePhpQuery } from './common/http/php-input';
import { asBag } from './common/http/request-input';
import { LaravelExceptionFilter } from './common/http/laravel-exception.filter';
import {
  TRUSTED_PROXIES_SETTING,
  trustProxySetting,
} from './common/http/trust-proxy';
import { httpConfig } from './config';

/**
 * Express and Nest setup shared by `main.ts` and the e2e tests (ch. 1 §1.4).
 * The app must be created with `{ bodyParser: false }`.
 */
export function setupApp(app: NestExpressApplication): void {
  const config = app.get<ConfigType<typeof httpConfig>>(httpConfig.KEY);

  // PHP's parse_str() rules (Express 5's default 'simple' parser would turn
  // filter[read]=1 into a literal key).
  app.set('query parser', (query: string | null) =>
    asBag(parsePhpQuery(query ?? '')),
  );
  app.set('trust proxy', trustProxySetting(config.trustedProxies));
  app.set(TRUSTED_PROXIES_SETTING, config.trustedProxies);
  app.disable('x-powered-by');

  // Laravel's default CORS config on `/api/*` only: any origin, the requested
  // method echoed back, max age 0, preflight answered with 204 (ch. 3 §3.1).
  app.use(
    '/api',
    cors((req: Request, callback) =>
      callback(null, {
        origin: '*',
        maxAge: 0,
        methods: req.header('access-control-request-method')?.toUpperCase(),
      }),
    ),
  );

  registerBodyParsers(app, config.bodyLimit);
  app.useGlobalFilters(new LaravelExceptionFilter());
  setupSwagger(app);
  app.enableShutdownHooks();
}

function setupSwagger(app: NestExpressApplication): void {
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Headless Form Handler')
      .setVersion('0.0.1')
      .addServer('/api/v1')
      .addBearerAuth()
      .build(),
  );
  SwaggerModule.setup('docs/api', app, document, {
    jsonDocumentUrl: 'docs/api.json',
    // Only the JSON document: the Laravel app serves no YAML route.
    raw: ['json'],
  });
}
