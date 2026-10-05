import { Global, Module } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { mailConfig } from '../config';
import { createMailer, Mailer } from './mailer';

@Global()
@Module({
  providers: [
    {
      provide: Mailer,
      inject: [mailConfig.KEY],
      useFactory: (config: ConfigType<typeof mailConfig>) =>
        createMailer(config),
    },
  ],
  exports: [Mailer],
})
export class MailModule {}
