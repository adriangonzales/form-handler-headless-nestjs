import type { ModuleMetadata } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { App } from 'supertest/types';
import { DataSource, type DataSourceOptions } from 'typeorm';
import { AppModule } from '../../src/app.module';
import {
  InMemoryLoginLimiterStore,
  LoginLimiterStore,
} from '../../src/auth/login-limiter.service';
import { TokenService } from '../../src/auth/token.service';
import { Clock } from '../../src/common/clock/clock';
import { FakeClock } from '../../src/common/clock/fake-clock';
import {
  DiskStorage,
  InMemoryDisk,
  Storage,
} from '../../src/common/storage/storage';
import { databaseConfig } from '../../src/config';
import { dataSourceOptions } from '../../src/database/data-source-options';
import { Factories } from '../../src/database/factories/factories';
import { Mailer } from '../../src/mail/mailer';
import { setupApp } from '../../src/setup-app';
import type { User } from '../../src/users/user.entity';
import { FakeMailer } from './fake-mailer';

/** `@nestjs/typeorm`'s options token (not exported from the package root). */
const TYPEORM_MODULE_OPTIONS = 'TypeOrmModuleOptions';

export interface TestApp {
  app: NestExpressApplication;
  /** Pass to Supertest's `request()`. */
  http: App;
  clock: FakeClock;
  dataSource: DataSource;
  factories: Factories;
  /** Every mail sent (`Mail::fake()`). */
  mail: FakeMailer;
  /** The `local` disk (`Storage::fake('local')`). */
  disk: InMemoryDisk;
  /** The login limiter's store; `flush()` is `Cache::flush()`. */
  loginLimiter: InMemoryLoginLimiterStore;
  /** Pest's `apiToken($user)`: a real token, as a login would issue. */
  apiToken(user: User): Promise<string>;
  close(): Promise<void>;
}

export interface CreateAppOptions {
  /** Environment overrides, applied while the app boots. */
  env?: Record<string, string>;
  /** Extra modules, e.g. test-only controllers. */
  imports?: ModuleMetadata['imports'];
  clock?: FakeClock;
}

/**
 * Boots the real `AppModule` in-process, set up as `main.ts` does (ch. 7
 * §7.1), with a fresh database and a `FakeClock`:
 * - SQLite (the default): `:memory:` with `synchronize`.
 * - Postgres (`DB_TYPE=postgres`, CI): drops the schema and applies the
 *   migrations. Run those suites with `--runInBand`; they share one database.
 *
 * Mail, the `local` disk and the login limiter's store are in-memory fakes
 * (Laravel's `MAIL_MAILER=array`, `Storage::fake()`, `CACHE_STORE=array`).
 * Fakes for the Jev client and the job dispatcher are added as their phases
 * land.
 */
export async function createApp(
  options: CreateAppOptions = {},
): Promise<TestApp> {
  const clock = options.clock ?? new FakeClock();
  const mail = new FakeMailer();
  const disk = new InMemoryDisk();
  const loginLimiter = new InMemoryLoginLimiterStore(clock);
  const previous = Object.fromEntries(
    Object.keys(options.env ?? {}).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, options.env);

  try {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule, ...(options.imports ?? [])],
    })
      .overrideProvider(Clock)
      .useValue(clock)
      .overrideProvider(Mailer)
      .useValue(mail)
      .overrideProvider(Storage)
      .useValue(new DiskStorage({ local: disk }))
      .overrideProvider(LoginLimiterStore)
      .useValue(loginLimiter)
      .overrideProvider(TYPEORM_MODULE_OPTIONS)
      .useFactory({
        inject: [databaseConfig.KEY],
        factory: (config: ConfigType<typeof databaseConfig>) =>
          testDataSourceOptions(config),
      })
      .compile();

    const app = moduleRef.createNestApplication<NestExpressApplication>({
      bodyParser: false,
      logger: false,
    });
    setupApp(app);
    await app.init();

    const dataSource = app.get(DataSource);
    const tokens = app.get(TokenService);
    return {
      app,
      http: app.getHttpServer() as App,
      clock,
      dataSource,
      factories: new Factories(dataSource, clock),
      mail,
      disk,
      loginLimiter,
      apiToken: async (user) =>
        (await tokens.issue(user, 'http://localhost')).token,
      close: () => app.close(),
    };
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function testDataSourceOptions(
  config: ConfigType<typeof databaseConfig>,
): DataSourceOptions {
  const options = dataSourceOptions(config);
  if (options.type === 'postgres') {
    return { ...options, dropSchema: true, migrationsRun: true };
  }
  if (options.type === 'better-sqlite3') {
    return { ...options, database: ':memory:', synchronize: true };
  }
  throw new Error(`Unsupported test database: ${options.type}`);
}
