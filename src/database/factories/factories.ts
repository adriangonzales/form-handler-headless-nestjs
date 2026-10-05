import { faker } from '@faker-js/faker';
import { hashSync } from 'bcrypt';
import { randomUUID } from 'node:crypto';
import { ulid } from 'ulid';
import type {
  DataSource,
  DeepPartial,
  EntityTarget,
  ObjectLiteral,
} from 'typeorm';
import { Clock } from '../../common/clock/clock';
import { newUlid } from '../../common/db/ulid';
import {
  EXPORT_RETENTION_HOURS,
  ExportStatus,
} from '../../entry-exports/export-status';
import { FormEntryExport } from '../../entry-exports/form-entry-export.entity';
import { FormEntry } from '../../form-entries/form-entry.entity';
import { FormNotification } from '../../form-notifications/form-notification.entity';
import { NotificationType } from '../../form-notifications/notification-type';
import type { FormField } from '../../forms/form-field';
import { Form } from '../../forms/form.entity';
import { isBcryptHash } from '../../users/password-hasher';
import { User } from '../../users/user.entity';
import { FORM_NAMES } from './form-names';

/**
 * Ports of `database/factories` (ch. 2 §2.5). Each call persists one row
 * through its repository, creating missing parents the way Laravel's nested
 * `Model::factory()` attributes do. IDs are set here, not by `@BeforeInsert`.
 */
export class Factories {
  /** Laravel caches one hash per process (`static::$password`). */
  private static passwordHash: string | undefined;
  private readonly emails = new Set<string>();

  constructor(
    private readonly dataSource: DataSource,
    private readonly clock: Clock,
  ) {}

  /** A plain `password` override is hashed, as the model's `hashed` cast does. */
  async user(overrides: DeepPartial<User> = {}): Promise<User> {
    const { password } = overrides;
    return this.save(User, {
      name: faker.person.fullName(),
      email: this.uniqueSafeEmail(),
      emailVerifiedAt: this.clock.now(),
      rememberToken: faker.string.alphanumeric(10),
      ...overrides,
      password:
        password === undefined
          ? Factories.password()
          : isBcryptHash(password)
            ? password
            : hashSync(password, Factories.rounds()),
    });
  }

  async form(overrides: DeepPartial<Form> = {}): Promise<Form> {
    const userId =
      overrides.userId ?? overrides.user?.id ?? (await this.user()).id;
    return this.save(Form, {
      id: newUlid(),
      userId,
      name: faker.helpers.arrayElement(FORM_NAMES),
      active: faker.datatype.boolean(),
      schema: [],
      settings: {},
      ...withoutRelation(overrides, 'user'),
    });
  }

  async entry(overrides: DeepPartial<FormEntry> = {}): Promise<FormEntry> {
    const formId =
      overrides.formId ?? overrides.form?.id ?? (await this.form()).id;
    return this.save(FormEntry, {
      id: newUlid(),
      formId,
      input: [],
      ip: faker.lorem.word(),
      ipLocationDisplay: faker.lorem.word(),
      referer: faker.lorem.word(),
      userAgent: faker.lorem.word(),
      userAgentDisplay: {
        platform: faker.helpers.arrayElement([
          'Windows',
          'Macintosh',
          'Linux',
          'iPhone',
          'Android',
        ]),
        browser: faker.helpers.arrayElement([
          'Chrome',
          'Firefox',
          'Safari',
          'Edge',
        ]),
        browser_version: `${faker.string.numeric(3)}.0`,
      },
      spam: faker.datatype.boolean(),
      spamScore: faker.number.float({ min: 0, max: 1, fractionDigits: 2 }),
      spamReason: faker.lorem.word(),
      spamCheckedAt: this.pastDateTime(),
      starred: faker.datatype.boolean(),
      readAt: this.pastDateTime(),
      ...withoutRelation(overrides, 'form'),
    });
  }

  async notification(
    overrides: DeepPartial<FormNotification> = {},
  ): Promise<FormNotification> {
    const formId =
      overrides.formId ?? overrides.form?.id ?? (await this.form()).id;
    const type =
      overrides.type ??
      faker.helpers.arrayElement([
        NotificationType.Email,
        NotificationType.Sms,
      ]);
    return this.save(FormNotification, {
      id: newUlid(),
      formId,
      type,
      value:
        type === NotificationType.Email
          ? this.safeEmail()
          : faker.phone.number({ style: 'international' }),
      enabled: faker.datatype.boolean(),
      error: null,
      ...withoutRelation(overrides, 'form'),
    });
  }

  async entryExport(
    overrides: DeepPartial<FormEntryExport> = {},
  ): Promise<FormEntryExport> {
    const formId =
      overrides.formId ?? overrides.form?.id ?? (await this.form()).id;
    const now = this.clock.now();
    return this.save(FormEntryExport, {
      id: newUlid(),
      formId,
      status: ExportStatus.Pending,
      parameters: {},
      disk: 'local',
      path: null,
      filename: `${faker.lorem.slug()}-entries-${now.toISOString().slice(0, 10)}.csv`,
      rowCount: null,
      error: null,
      completedAt: null,
      expiresAt: new Date(now.getTime() + EXPORT_RETENTION_HOURS * 3_600_000),
      ...withoutRelation(overrides, 'form'),
    });
  }

  /** `FormEntryExportFactory::completed()`. */
  completedExport(): DeepPartial<FormEntryExport> {
    return {
      status: ExportStatus.Completed,
      path: `entry-exports/${randomUUID()}.csv`,
      rowCount: 0,
      completedAt: this.clock.now(),
    };
  }

  /** `FormEntryExportFactory::expired()`. */
  expiredExport(): DeepPartial<FormEntryExport> {
    return { expiresAt: new Date(this.clock.now().getTime() - 60_000) };
  }

  private async save<T extends ObjectLiteral>(
    target: EntityTarget<T>,
    attributes: DeepPartial<NoInfer<T>>,
  ): Promise<T> {
    const repository = this.dataSource.getRepository(target);
    const entity: T = repository.create(attributes);
    return repository.save(entity);
  }

  /** Faker's `dateTime()`: any time between the epoch and now. */
  private pastDateTime(): Date {
    return faker.date.between({ from: 0, to: this.clock.now() });
  }

  private safeEmail(): string {
    return faker.internet.exampleEmail().toLowerCase();
  }

  private uniqueSafeEmail(): string {
    for (;;) {
      const email = this.safeEmail();
      if (!this.emails.has(email)) {
        this.emails.add(email);
        return email;
      }
    }
  }

  /** `Hash::make('password')`. */
  private static password(): string {
    return (Factories.passwordHash ??= hashSync(
      'password',
      Factories.rounds(),
    ));
  }

  /** `BCRYPT_ROUNDS`: tests use 4, as Laravel's phpunit.xml does. */
  private static rounds(): number {
    return Number(process.env.BCRYPT_ROUNDS ?? 12);
  }
}

/** `FormFactory::active()` / `inactive()`. */
export const formStates = {
  active: { active: true },
  inactive: { active: false },
} as const satisfies Record<string, DeepPartial<Form>>;

/** `FormFactory::withBasicSchema()`. Schema field IDs are uppercase, as `Str::ulid()` makes them. */
export function withBasicSchema(): FormField[] {
  return [
    { id: ulid(), order: 1, label: 'Name', rules: ['required'] },
    { id: ulid(), order: 2, label: 'Email', rules: ['required', 'email'] },
    { id: ulid(), order: 3, label: 'Message', rules: ['required'] },
  ];
}

function withoutRelation<T extends object, K extends keyof T>(
  overrides: T,
  relation: K,
): Omit<T, K> {
  const rest = { ...overrides };
  delete rest[relation];
  return rest;
}
