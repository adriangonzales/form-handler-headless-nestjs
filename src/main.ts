import './config/load-env';
import { NestFactory } from '@nestjs/core';
import type { ConfigType } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { httpConfig } from './config';
import { setupApp } from './setup-app';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  setupApp(app);
  await app.listen(app.get<ConfigType<typeof httpConfig>>(httpConfig.KEY).port);
}

void bootstrap();
