import type { DeepPartial } from 'typeorm';
import { FormEntry } from '../../src/form-entries/form-entry.entity';
import { Form } from '../../src/forms/form.entity';
import type { User } from '../../src/users/user.entity';
import { createApp, type TestApp } from '../support/create-app';
import {
  body,
  json,
  validationErrorKeys,
  type ErrorBody,
} from '../support/json-request';

interface EntryData {
  id: string;
  input: unknown;
  spam_score: unknown;
  read_at: string | null;
  updated_at: string;
  deleted_at: string | null;
}

/** Entries behaviour the Pest suite doesn't cover (ch. 3 §3.5, ch. 7 §7.3). */
describe('Entries (port-specific)', () => {
  let t: TestApp;
  let user: User;
  let form: Form;
  let token: string;

  beforeEach(async () => {
    t = await createApp();
    user = await t.factories.user();
    form = await t.factories.form({ userId: user.id, active: true });
    token = await t.apiToken(user);
  });

  afterEach(async () => {
    await t.close();
  });

  const repo = () => t.dataSource.getRepository(FormEntry);
  const entry = (overrides: DeepPartial<FormEntry> = {}) =>
    t.factories.entry({ formId: form.id, ...overrides });
  const fresh = (id: string) =>
    repo().findOneOrFail({ where: { id }, withDeleted: true });
  const call = (
    method: 'get' | 'post' | 'put' | 'patch' | 'delete',
    url: string,
    data?: object,
  ) => json(t.http, method, url, data, token);
  const softDelete = (target: { id: string }, of: 'entry' | 'form' = 'entry') =>
    t.dataSource
      .getRepository(of === 'entry' ? FormEntry : Form)
      .update({ id: target.id }, { deletedAt: t.clock.now() });

  describe('create (owner)', () => {
    it('stores input: [] when nothing validates, and keeps submitted key order', async () => {
      const empty = await call('post', `/api/v1/forms/${form.id}/entries`, {
        x: 1,
      });
      expect(body<{ data: EntryData }>(empty).data.input).toEqual([]);

      await t.dataSource.getRepository(Form).update(
        { id: form.id },
        {
          schema: [
            { id: '01K6E2E0000000000000000002', order: 1, name: 'zeta' },
            { id: '01K6E2E0000000000000000001', order: 2, name: 'alpha' },
          ],
        },
      );
      const res = await call('post', `/api/v1/forms/${form.id}/entries`, {
        alpha: 'a',
        zeta: 'z',
      });

      // Rule order (the stored schema's), as Laravel's validated() builds it.
      expect(
        Object.keys(body<{ data: EntryData }>(res).data.input as object),
      ).toEqual(['zeta', 'alpha']);
      const stored = await fresh(body<{ data: EntryData }>(res).data.id);
      expect(Object.keys(stored.input as object)).toEqual(['zeta', 'alpha']);
    });

    it('gives "(and 2 more errors)" for an empty body on a basic schema', async () => {
      await t.dataSource.getRepository(Form).update(
        { id: form.id },
        {
          schema: [
            { id: 'A1', order: 1, name: 'name', rules: ['required'] },
            { id: 'B1', order: 2, name: 'email', rules: ['required', 'email'] },
            { id: 'C1', order: 3, name: 'message', rules: ['required'] },
          ],
        },
      );

      const res = await call('post', `/api/v1/forms/${form.id}/entries`, {});

      expect(res.status).toBe(422);
      expect(body<ErrorBody>(res).message).toBe(
        'The name field is required. (and 2 more errors)',
      );
    });

    it('gives 404 for an unknown form before anything else', async () => {
      const res = await call(
        'post',
        '/api/v1/forms/01k6b6xz0000000000000000zz/entries',
        {},
      );
      expect(res.status).toBe(404);
    });
  });

  describe('update', () => {
    it('updates a single field with PATCH and leaves the rest', async () => {
      const target = await entry({
        starred: false,
        spam: true,
        spamScore: 0.3,
      });

      const res = await call('patch', `/api/v1/entries/${target.id}`, {
        starred: '1',
      });

      expect(res.status).toBe(200);
      const stored = await fresh(target.id);
      expect(stored).toMatchObject({
        starred: true,
        spam: true,
        spamScore: 0.3,
      });
    });

    it('stores spam null and a string spam_score, rounded', async () => {
      const target = await entry();

      const res = await call('patch', `/api/v1/entries/${target.id}`, {
        spam: null,
        spam_score: '0.285',
      });

      expect(body<{ data: EntryData }>(res).data).toMatchObject({
        spam_score: 0.29,
      });
      expect(await fresh(target.id)).toMatchObject({
        spam: null,
        spamScore: 0.29,
      });
    });

    it('stores read_at as its wall-clock time, ignoring an offset (Eloquent)', async () => {
      const target = await entry();

      const res = await call('patch', `/api/v1/entries/${target.id}`, {
        read_at: '2026-01-02T03:04:05+02:00',
      });

      expect(body<{ data: EntryData }>(res).data.read_at).toBe(
        '2026-01-02T03:04:05.000000Z',
      );
    });

    it('lists every read-only field it rejects, even as null', async () => {
      const target = await entry();

      const res = await call('put', `/api/v1/entries/${target.id}`, {
        input: null,
        ip: null,
        spam_checked_at: null,
      });

      expect(res.status).toBe(422);
      expect(body<ErrorBody>(res).errors).toEqual({
        input: ['The input field must be missing.'],
        ip: ['The ip field must be missing.'],
        spam_checked_at: ['The spam checked at field must be missing.'],
      });
    });

    it('leaves updated_at alone when nothing changed', async () => {
      const target = await entry({ starred: true });
      t.clock.travel(60_000);

      const res = await call('patch', `/api/v1/entries/${target.id}`, {
        starred: true,
      });

      expect(body<{ data: EntryData }>(res).data.updated_at).toBe(
        '2026-01-01T00:00:00.000000Z',
      );
    });

    it('accepts an empty body', async () => {
      const target = await entry();

      const res = await call('patch', `/api/v1/entries/${target.id}`, {});

      expect(res.status).toBe(200);
    });
  });

  describe('delete, restore and force delete', () => {
    it('hides a deleted entry from show and update, but not from restore', async () => {
      const target = await entry();
      await call('delete', `/api/v1/entries/${target.id}`).expect(204);

      for (const method of ['get', 'put', 'delete'] as const) {
        const res = await call(method, `/api/v1/entries/${target.id}`, {});
        expect(res.status).toBe(404);
        expect(res.body).toEqual({
          message: `No query results for model [App\\Models\\FormEntry] ${target.id}`,
        });
      }

      await call('post', `/api/v1/entries/${target.id}/restore`).expect(200);
    });

    it('sets updated_at on delete and restore; restoring a live entry changes nothing', async () => {
      const target = await entry();
      t.clock.travel(60_000);

      const live = await call('post', `/api/v1/entries/${target.id}/restore`);
      expect(body<{ data: EntryData }>(live).data.updated_at).toBe(
        '2026-01-01T00:00:00.000000Z',
      );

      await call('delete', `/api/v1/entries/${target.id}`).expect(204);
      expect((await fresh(target.id)).updatedAt.toISOString()).toBe(
        '2026-01-01T00:01:00.000Z',
      );

      t.clock.travel(60_000);
      const res = await call('post', `/api/v1/entries/${target.id}/restore`);
      expect(body<{ data: EntryData }>(res).data).toMatchObject({
        deleted_at: null,
        updated_at: '2026-01-01T00:02:00.000000Z',
      });
    });

    it('gives 403 on every shallow route for an entry of a deleted form', async () => {
      const live = await entry();
      const trashed = await entry();
      await softDelete(trashed);
      await softDelete(form, 'form');

      for (const [method, target, suffix] of [
        ['get', live, ''],
        ['patch', live, ''],
        ['delete', live, ''],
        ['post', trashed, '/restore'],
        ['delete', trashed, '/force'],
      ] as const) {
        const res = await call(
          method,
          `/api/v1/entries/${target.id}${suffix}`,
          {},
        );
        expect(res.status).toBe(403);
        expect(res.body).toEqual({ message: 'You do not own this form.' });
      }
    });

    it('checks ownership before the 409', async () => {
      const theirs = await t.factories.entry();

      const res = await call('delete', `/api/v1/entries/${theirs.id}/force`);

      expect(res.status).toBe(403);
    });
  });

  describe('list', () => {
    it('lists entries oldest first, ties in creation order', async () => {
      const created = [await entry(), await entry(), await entry()];

      const res = await call('get', `/api/v1/forms/${form.id}/entries`);

      expect(body<{ data: EntryData[] }>(res).data.map((e) => e.id)).toEqual(
        created.map((e) => e.id),
      );
    });

    it('accepts created_to without created_from', async () => {
      t.clock.set('2026-02-01T00:00:00Z');
      const early = await entry();
      t.clock.set('2026-03-01T00:00:00Z');
      await entry();
      token = await t.apiToken(user);

      const res = await call(
        'get',
        `/api/v1/forms/${form.id}/entries?filter[created_to]=2026-02-01`,
      );

      expect(body<{ data: EntryData[] }>(res).data.map((e) => e.id)).toEqual([
        early.id,
      ]);
    });

    it('answers PUT on the entry list with 405 and Allow', async () => {
      const res = await call('put', `/api/v1/forms/${form.id}/entries`, {});

      expect(res.status).toBe(405);
      expect(res.headers.allow).toBe('GET, HEAD, POST');
    });
  });

  describe('bulk', () => {
    it('sets updated_at from the clock on changed rows only', async () => {
      const unread = await entry({ readAt: null });
      const read = await entry({ readAt: new Date('2025-01-01T00:00:00Z') });
      t.clock.travel(60_000);

      await call('post', `/api/v1/forms/${form.id}/entries/bulk`, {
        action: 'mark_read',
        ids: [unread.id, read.id],
      }).expect(200);

      expect((await fresh(unread.id)).updatedAt.toISOString()).toBe(
        '2026-01-01T00:01:00.000Z',
      );
      expect((await fresh(read.id)).updatedAt.toISOString()).toBe(
        '2026-01-01T00:00:00.000Z',
      );
    });

    it('changes nothing when any ID is invalid', async () => {
      const ok = await entry({ starred: false });

      const res = await call('post', `/api/v1/forms/${form.id}/entries/bulk`, {
        action: 'star',
        ids: [ok.id, ok.id, 'nope'],
      });

      expect(res.status).toBe(422);
      expect(body<ErrorBody>(res).errors).toEqual({
        'ids.0': ['The ids.0 field has a duplicate value.'],
        'ids.1': ['The ids.1 field has a duplicate value.'],
        'ids.2': ['The selected ids.2 is invalid.'],
      });
      expect((await fresh(ok.id)).starred).toBe(false);
    });

    it('rejects a missing action and non-array ids', async () => {
      const res = await call('post', `/api/v1/forms/${form.id}/entries/bulk`, {
        ids: 'x',
      });

      expect(validationErrorKeys(res.body)).toEqual(['action', 'ids']);
    });
  });
});
