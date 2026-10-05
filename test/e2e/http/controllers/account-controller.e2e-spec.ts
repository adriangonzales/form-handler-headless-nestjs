import { compareSync } from 'bcrypt';
import type { ObjectLiteral, EntityTarget } from 'typeorm';
import { FormEntryExport } from '../../../../src/entry-exports/form-entry-export.entity';
import { FormEntry } from '../../../../src/form-entries/form-entry.entity';
import { FormNotification } from '../../../../src/form-notifications/form-notification.entity';
import { Form } from '../../../../src/forms/form.entity';
import { User } from '../../../../src/users/user.entity';
import { createApp, type TestApp } from '../../../support/create-app';
import {
  json,
  validationErrorKeys,
  body,
  type TokenBody,
  type UserBody,
} from '../../../support/json-request';

/** Port of `tests/Feature/Http/Controllers/AccountControllerTest.php` (11). */
describe('AccountControllerTest', () => {
  let t: TestApp;
  let user: User;
  let token: string;

  beforeEach(async () => {
    t = await createApp();
    user = await t.factories.user({
      email: 'owner@example.com',
      password: 'correct-horse-battery-staple',
    });
    token = await t.apiToken(user);
  });

  afterEach(async () => {
    await t.close();
  });

  const fresh = () =>
    t.dataSource.getRepository(User).findOneByOrFail({ id: user.id });
  const passwordMatches = async (plain: string) =>
    compareSync(plain, (await fresh()).password);
  const updateProfile = (body: object) =>
    json(t.http, 'patch', '/api/v1/auth/me', body, token);
  const updatePassword = (body: object, as = token) =>
    json(t.http, 'put', '/api/v1/auth/password', body, as);
  const me = (as: string) =>
    json(t.http, 'get', '/api/v1/auth/me', undefined, as);

  /** `assertModelMissing()` / `assertModelExists()`. */
  const exists = (target: EntityTarget<ObjectLiteral>, id: string | number) =>
    t.dataSource
      .getRepository(target)
      .exists({ where: { id }, withDeleted: true });

  it('updates the profile name', async () => {
    const res = await updateProfile({ name: 'Ada Lovelace' });

    expect(res.status).toBe(200);
    expect(body<UserBody>(res).data.name).toBe('Ada Lovelace');
    expect(body<UserBody>(res).data.email).toBe('owner@example.com');

    expect((await fresh()).emailVerifiedAt).not.toBeNull();
  });

  it('lowercases a changed email and clears its verification', async () => {
    const res = await updateProfile({ email: 'Ada@Example.com' });

    expect(res.status).toBe(200);
    expect(body<UserBody>(res).data.email).toBe('ada@example.com');
    expect(body<UserBody>(res).data.email_verified_at).toBeNull();
  });

  it('keeps the verification when the same email is resubmitted', async () => {
    await updateProfile({ email: 'Owner@Example.com' }).expect(200);

    expect((await fresh()).emailVerifiedAt).not.toBeNull();
  });

  it('rejects an email used by another account', async () => {
    await t.factories.user({ email: 'taken@example.com' });

    const res = await updateProfile({ email: 'Taken@example.com' });

    expect(res.status).toBe(422);
    expect(validationErrorKeys(res.body)).toContain('email');
  });

  it('changes the password, revokes existing tokens and issues a new one', async () => {
    const otherDeviceToken = await t.apiToken(user);

    const res = await updatePassword({
      current_password: 'correct-horse-battery-staple',
      password: 'a-brand-new-passphrase',
      password_confirmation: 'a-brand-new-passphrase',
    });

    expect(res.status).toBe(200);
    expect(Object.keys(body<TokenBody>(res))).toEqual(
      expect.arrayContaining(['access_token', 'token_type', 'expires_in']),
    );
    expect(await passwordMatches('a-brand-new-passphrase')).toBe(true);
    const newToken = (res.body as { access_token: string }).access_token;

    for (const revoked of [token, otherDeviceToken]) {
      await me(revoked).expect(401);
    }

    await me(newToken).expect(200);
  });

  it('does not let a revoked token be refreshed', async () => {
    const otherDeviceToken = await t.apiToken(user);

    await updatePassword({
      current_password: 'correct-horse-battery-staple',
      password: 'a-brand-new-passphrase',
      password_confirmation: 'a-brand-new-passphrase',
    }).expect(200);

    await json(
      t.http,
      'post',
      '/api/v1/auth/refresh',
      undefined,
      otherDeviceToken,
    ).expect(401);
  });

  it('keeps a token valid across refreshes when nothing was revoked', async () => {
    const res = await json(
      t.http,
      'post',
      '/api/v1/auth/refresh',
      undefined,
      token,
    ).expect(200);

    await me((res.body as { access_token: string }).access_token).expect(200);
  });

  it.each([
    [
      'wrong current password',
      {
        current_password: 'wrong',
        password: 'a-brand-new-passphrase',
        password_confirmation: 'a-brand-new-passphrase',
      },
      'current_password',
    ],
    [
      'unconfirmed',
      {
        current_password: 'correct-horse-battery-staple',
        password: 'a-brand-new-passphrase',
        password_confirmation: 'different',
      },
      'password',
    ],
    [
      'unchanged',
      {
        current_password: 'correct-horse-battery-staple',
        password: 'correct-horse-battery-staple',
        password_confirmation: 'correct-horse-battery-staple',
      },
      'password',
    ],
  ])('rejects an invalid password change (%s)', async (_name, payload, key) => {
    const res = await updatePassword(payload);

    expect(res.status).toBe(422);
    expect(validationErrorKeys(res.body)).toContain(key);

    expect(await passwordMatches('correct-horse-battery-staple')).toBe(true);
  });

  it('deletes the account and everything it owns', async () => {
    const { factories } = t;
    const form = await factories.form({ userId: user.id });
    const deletedForm = await factories.form({
      userId: user.id,
      deletedAt: t.clock.now(),
    });

    const entry = await factories.entry({ formId: form.id });
    const deletedEntry = await factories.entry({
      formId: deletedForm.id,
      deletedAt: t.clock.now(),
    });

    const notification = await factories.notification({ formId: form.id });
    const entryExport = await factories.entryExport({
      formId: form.id,
      ...factories.completedExport(),
    });
    await t.disk.put(String(entryExport.path), 'id');

    const otherForm = await factories.form();
    const otherEntry = await factories.entry({ formId: otherForm.id });

    const res = await json(
      t.http,
      'delete',
      '/api/v1/auth/me',
      { password: 'correct-horse-battery-staple' },
      token,
    );

    expect(res.status).toBe(204);
    for (const [target, id] of [
      [User, user.id],
      [Form, form.id],
      [Form, deletedForm.id],
      [FormEntry, entry.id],
      [FormEntry, deletedEntry.id],
      [FormNotification, notification.id],
      [FormEntryExport, entryExport.id],
    ] as const) {
      expect(await exists(target, id)).toBe(false);
    }
    expect(await t.disk.exists(String(entryExport.path))).toBe(false);
    expect(await exists(Form, otherForm.id)).toBe(true);
    expect(await exists(FormEntry, otherEntry.id)).toBe(true);

    await me(token).expect(401);
  });

  it('requires the current password to delete the account', async () => {
    const res = await json(
      t.http,
      'delete',
      '/api/v1/auth/me',
      { password: 'wrong' },
      token,
    );

    expect(res.status).toBe(422);
    expect(validationErrorKeys(res.body)).toContain('password');
    expect(await exists(User, user.id)).toBe(true);
  });

  it.each([
    ['update profile', 'patch', '/api/v1/auth/me'],
    ['change password', 'put', '/api/v1/auth/password'],
    ['delete account', 'delete', '/api/v1/auth/me'],
  ] as const)(
    'requires authentication for account management (%s)',
    async (_name, method, url) => {
      await json(t.http, method, url).expect(401);
    },
  );
});
