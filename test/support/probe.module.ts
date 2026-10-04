import {
  All,
  Body,
  Controller,
  Get,
  HttpCode,
  Module,
  Post,
  NotFoundException,
  Param,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { RouterModule } from '@nestjs/core';
import type { Request } from 'express';
import { requestInput } from '../../src/common/http/request-input';
import { RateLimited } from '../../src/common/rate-limit/rate-limited.decorator';
import { Throttler } from '../../src/common/rate-limit/throttlers';
import { getClientIps } from '../../src/common/http/trust-proxy';
import { Validated } from '../../src/common/validation/validated.decorator';

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

  /** The prepared input (`$request->query()`, the input source, `$request->all()`). */
  @All('input')
  input(@Req() req: Request) {
    return { method: req.method, ...requestInput(req) };
  }

  @Post('validate')
  @HttpCode(200)
  validate(
    @Validated({
      rules: {
        name: ['required', 'string', 'max:10'],
        email: ['required', 'email'],
        age: ['sometimes', 'integer'],
        'tags.*': ['string'],
      },
    })
    input: unknown,
  ) {
    return { input };
  }

  @Put('validate')
  validateWithHooks(
    @Validated({
      prepare: ({ req, input }) => {
        if (typeof input.email === 'string') {
          Object.assign(requestInput(req).all, {
            email: input.email.toLowerCase(),
          });
        }
      },
      rules: () => ({ email: ['required', 'email'] }),
      after: () => [
        (v) => {
          if (v.getValue('email') === 'taken@example.com') {
            v.addError('email', 'The email has already been taken.');
          }
        },
      ],
    })
    input: unknown,
  ) {
    return { input };
  }
}

/** Rate-limited stand-ins for the public submission and password routes. */
@Controller('probe-limits')
class ProbeLimitsController {
  @Post('forms/:form/submissions')
  @HttpCode(201)
  @RateLimited(Throttler.SubmissionsIp, Throttler.SubmissionsForm)
  submit(@Param('form') form: string) {
    // The real handler looks the form up after the guard: 429 comes before 404.
    if (form !== 'known') throw new NotFoundException();
    return { ok: true };
  }

  @Post('forgot-password')
  @HttpCode(200)
  @RateLimited(Throttler.Password)
  forgot() {
    return { ok: true };
  }

  @Post('reset-password')
  @HttpCode(200)
  @RateLimited(Throttler.Password)
  reset() {
    return { ok: true };
  }
}

@Module({ controllers: [ProbeController, ProbeLimitsController] })
class ProbeModule {}

/** Mounts the probe at `/api/v1/probe`. */
export const probeImports = [
  ProbeModule,
  RouterModule.register([{ path: 'api/v1', module: ProbeModule }]),
];
