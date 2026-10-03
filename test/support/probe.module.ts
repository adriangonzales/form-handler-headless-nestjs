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
import type { Request } from 'express';
import { getClientIps } from '../../src/common/http/trust-proxy';

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

/** Mounts the probe at `/api/v1/probe`. */
export const probeImports = [
  ProbeModule,
  RouterModule.register([{ path: 'api/v1', module: ProbeModule }]),
];
