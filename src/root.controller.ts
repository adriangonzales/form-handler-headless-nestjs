import { All, Controller, Get, Header, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { CsrfTokenMismatchException } from './common/http/json-error';

/** Routes outside `/api/v1` (ch. 1 §1.4). */
@ApiExcludeController()
@Controller()
export class RootController {
  /** Laravel's health route. */
  @Get('up')
  @Header('Content-Type', 'text/html; charset=utf-8')
  up(): string {
    return '<!DOCTYPE html><html lang="en"><head><title>Headless Form Handler</title></head><body>Application up</body></html>';
  }

  /**
   * `Route::any('/')` redirects to the docs. It sits in Laravel's `web` group,
   * so any method but GET, HEAD and OPTIONS fails the CSRF check with 419.
   */
  @All()
  root(@Req() req: Request, @Res() res: Response): void {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      throw new CsrfTokenMismatchException();
    }
    res.redirect(302, `${req.protocol}://${req.get('host')}/docs/api`);
  }
}
