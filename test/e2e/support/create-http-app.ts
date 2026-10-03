import {
  Body,
  Controller,
  Get,
  Module,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { RouterModule } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { Request } from 'express';
import { AppModule } from '../../../src/app.module';
import { getClientIps } from '../../../src/common/http/trust-proxy';
import { setupApp } from '../../../src/setup-app';

/** Echoes what a handler under `/api/v1` receives. Test-only. */
@Controller('probe')
class ProbeController {
  @Get()
  get(@Query() query: unknown, @Req() req: Request) {
    return { query, ips: getClientIps(req), expressIp: req.ip };
  }

  @Post()
  post(@Body() body: unknown) {
    return { body };
  }
}

@Module({ controllers: [ProbeController] })
class ProbeModule {}

/**
 * Boots the real app in-process, as `main.ts` does, with a probe controller
 * mounted under `/api/v1`. Environment overrides apply to this app only.
 */
export async function createHttpApp(
  env: Record<string, string> = {},
): Promise<NestExpressApplication> {
  const previous = Object.fromEntries(
    Object.keys(env).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, env);
  try {
    const moduleRef = await Test.createTestingModule({
      imports: [
        AppModule,
        ProbeModule,
        RouterModule.register([{ path: 'api/v1', module: ProbeModule }]),
      ],
    }).compile();
    const app = moduleRef.createNestApplication<NestExpressApplication>({
      bodyParser: false,
      logger: false,
    });
    setupApp(app);
    await app.init();
    return app;
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}
