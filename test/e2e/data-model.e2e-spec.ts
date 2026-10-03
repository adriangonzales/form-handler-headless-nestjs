import type { DataSource, Repository } from 'typeorm';
import { isUlid } from '../../src/common/db/ulid';
import { FormEntryExport } from '../../src/entry-exports/form-entry-export.entity';
import { FormEntry } from '../../src/form-entries/form-entry.entity';
import { FormNotification } from '../../src/form-notifications/form-notification.entity';
import { NotificationType } from '../../src/form-notifications/notification-type';
import { Form } from '../../src/forms/form.entity';
import { User } from '../../src/users/user.entity';
import { createApp, type TestApp } from '../support/create-app';

/**
 * ch. 2 Done-when. Runs on SQLite by default and on Postgres in CI
 * (`DB_TYPE=postgres`, migrations applied), where the Postgres-only
 * differences show up.
 */
describe(`data model (${process.env.DB_TYPE ?? 'sqlite'})`, () => {
  let t: TestApp;
  let ds: DataSource;
  let forms: Repository<Form>;
  let entries: Repository<FormEntry>;

  beforeAll(async () => {
    t = await createApp();
    ds = t.dataSource;
    forms = ds.getRepository(Form);
    entries = ds.getRepository(FormEntry);
  });

  afterAll(async () => {
    await t.close();
  });

  /** A column's value as the database stores it, bypassing transformers. */
  async function raw(
    table: string,
    column: string,
    id: string,
  ): Promise<unknown> {
    const rows: Record<string, unknown>[] = await ds.query(
      `SELECT ${column} AS value FROM ${table} WHERE id = ${ds.driver.options.type === 'postgres' ? '$1' : '?'}`,
      [id],
    );
    return rows[0]?.value;
  }

  describe('IDs', () => {
    it('assigns lowercase ULIDs on save()', async () => {
      const user = await t.factories.user();
      const form = await forms.save(
        forms.create({ userId: user.id, name: 'No ID given' }),
      );
      expect(isUlid(form.id)).toBe(true);
      expect(form.id).toBe(form.id.toLowerCase());
    });

    it('matches route IDs exactly, case included', async () => {
      const form = await t.factories.form();
      await expect(forms.findOneBy({ id: form.id })).resolves.not.toBeNull();
      await expect(
        forms.findOneBy({ id: form.id.toUpperCase() }),
      ).resolves.toBeNull();
    });

    it('keeps users on integer IDs', async () => {
      const user = await t.factories.user();
      expect(Number.isInteger(user.id)).toBe(true);
      const loaded = await ds
        .getRepository(User)
        .findOneByOrFail({ id: user.id });
      expect(typeof loaded.id).toBe('number');
    });
  });

  describe('timestamps', () => {
    it('come from the Clock on insert and on update', async () => {
      t.clock.set('2026-03-04T05:06:07Z');
      const form = await t.factories.form();
      expect(form.createdAt.toISOString()).toBe('2026-03-04T05:06:07.000Z');
      expect(form.updatedAt.toISOString()).toBe('2026-03-04T05:06:07.000Z');

      t.clock.travel(60_000);
      form.name = 'Renamed';
      await forms.save(form);
      const loaded = await forms.findOneByOrFail({ id: form.id });
      expect(loaded.createdAt.toISOString()).toBe('2026-03-04T05:06:07.000Z');
      expect(loaded.updatedAt.toISOString()).toBe('2026-03-04T05:07:07.000Z');
    });

    it('leave updated_at alone when nothing changed', async () => {
      t.clock.set('2026-03-04T05:06:07Z');
      const form = await t.factories.form();
      t.clock.travel(60_000);
      await forms.save(await forms.findOneByOrFail({ id: form.id }));
      const loaded = await forms.findOneByOrFail({ id: form.id });
      expect(loaded.updatedAt.toISOString()).toBe('2026-03-04T05:06:07.000Z');
    });

    it('keep an updated_at the caller set explicitly', async () => {
      const form = await t.factories.form();
      form.name = 'Renamed';
      form.updatedAt = new Date('2020-01-01T00:00:00Z');
      await forms.save(form);
      const loaded = await forms.findOneByOrFail({ id: form.id });
      expect(loaded.updatedAt.toISOString()).toBe('2020-01-01T00:00:00.000Z');
    });

    it('round-trip as whole seconds in UTC', async () => {
      const entry = await t.factories.entry({
        readAt: new Date('2026-07-08T09:10:11.987Z'),
      });
      const loaded = await entries.findOneByOrFail({ id: entry.id });
      expect(loaded.readAt?.toISOString()).toBe('2026-07-08T09:10:11.000Z');

      const pg = ds.driver.options.type === 'postgres';
      const stored = await raw(
        'form_entries',
        pg ? 'read_at::text' : 'read_at',
        entry.id,
      );
      expect(stored).toMatch(/^2026-07-08[ T]09:10:11(\.000)?$/);
    });
  });

  describe('soft deletes', () => {
    it('hide trashed rows unless withDeleted is passed', async () => {
      const form = await t.factories.form();
      await forms.update({ id: form.id }, { deletedAt: t.clock.now() });

      await expect(forms.findOneBy({ id: form.id })).resolves.toBeNull();
      const trashed = await forms.findOneOrFail({
        where: { id: form.id },
        withDeleted: true,
      });
      expect(trashed.deletedAt?.toISOString()).toBe(
        t.clock.now().toISOString(),
      );
    });

    it("exclude a trashed form when loading an entry's form relation", async () => {
      const entry = await t.factories.entry();
      await forms.update({ id: entry.formId }, { deletedAt: t.clock.now() });
      const loaded = await entries.findOneOrFail({
        where: { id: entry.id },
        relations: { form: true },
      });
      expect(loaded.form).toBeNull();
    });
  });

  describe('defaults', () => {
    it('notifications are enabled by default, in the entity and the database', async () => {
      const form = await t.factories.form();
      const repo = ds.getRepository(FormNotification);
      expect(repo.create().enabled).toBe(true);

      await repo.insert({
        id: '01k6b6xz0000000000000000aa',
        formId: form.id,
        type: NotificationType.Email,
        value: 'a@example.com',
      });
      const loaded = await repo.findOneByOrFail({
        id: '01k6b6xz0000000000000000aa',
      });
      expect(loaded.enabled).toBe(true);
    });

    it('forms are inactive and entries unstarred, unspammed and scored 0 by default', () => {
      expect(forms.create().active).toBe(false);
      const entry = entries.create();
      expect([entry.starred, entry.spam, entry.spamScore]).toEqual([
        false,
        false,
        0,
      ]);
    });
  });

  describe('spam_score', () => {
    it.each([
      [0.456, 0.46],
      [0.285, 0.29],
    ])(
      'stores %p rounded to %p and reads it back as a number',
      async (input, expected) => {
        const entry = await t.factories.entry({ spamScore: input });
        const loaded = await entries.findOneByOrFail({ id: entry.id });
        expect(loaded.spamScore).toBe(expected);
        expect(Number(await raw('form_entries', 'spam_score', entry.id))).toBe(
          expected,
        );
      },
    );
  });

  describe('JSON columns', () => {
    it('keep object key order (json, not jsonb)', async () => {
      const input = {
        zeta: 'z',
        alpha: 'a',
        mid: { b: 2, a: 1 },
        list: [3, 1, 2],
      };
      const entry = await t.factories.entry({ input });
      const loaded = await entries.findOneByOrFail({ id: entry.id });
      expect(JSON.stringify(loaded.input)).toBe(JSON.stringify(input));
    });

    it('round-trip user_agent_display through its varchar column', async () => {
      const display = {
        platform: 'Macintosh',
        browser: 'Safari',
        browser_version: '18.0',
      };
      const entry = await t.factories.entry({ userAgentDisplay: display });
      const loaded = await entries.findOneByOrFail({ id: entry.id });
      expect(loaded.userAgentDisplay).toEqual(display);
      expect(await raw('form_entries', 'user_agent_display', entry.id)).toBe(
        JSON.stringify(display),
      );
    });

    it('keep the client order of schema fields', async () => {
      const schema = [
        { id: 'B', order: 2 },
        { id: 'A', order: 1 },
      ];
      const form = await t.factories.form({ schema });
      const loaded = await forms.findOneByOrFail({ id: form.id });
      expect(loaded.schema).toEqual(schema);
      expect(loaded.orderedSchema().map((f) => f.id)).toEqual(['A', 'B']);
    });
  });

  it('form-list counts come back as numbers and skip trashed rows', async () => {
    const form = await t.factories.form();
    await t.factories.entry({ formId: form.id });
    await t.factories.entry({ formId: form.id });
    const trashed = await t.factories.entry({ formId: form.id });
    await entries.update({ id: trashed.id }, { deletedAt: t.clock.now() });
    await t.factories.notification({ formId: form.id });

    const loaded = await forms
      .createQueryBuilder('form')
      .loadRelationCountAndMap('form.entriesCount', 'form.entries')
      .loadRelationCountAndMap('form.notificationsCount', 'form.notifications')
      .where('form.id = :id', { id: form.id })
      .getOneOrFail();
    const counts = loaded as Form & {
      entriesCount: unknown;
      notificationsCount: unknown;
    };
    expect(counts.entriesCount).toBe(2);
    expect(counts.notificationsCount).toBe(1);
  });

  it('deleting a form deletes its exports (cascade)', async () => {
    const form = await t.factories.form();
    const entryExport = await t.factories.entryExport({ formId: form.id });
    await forms.delete({ id: form.id });
    await expect(
      ds.getRepository(FormEntryExport).findOneBy({ id: entryExport.id }),
    ).resolves.toBeNull();
  });

  it('rejects a notification type outside the enum', async () => {
    const form = await t.factories.form();
    await expect(
      t.factories.notification({
        formId: form.id,
        type: 'fax' as NotificationType,
        value: 'x',
      }),
    ).rejects.toThrow(/check/i);
  });
});
