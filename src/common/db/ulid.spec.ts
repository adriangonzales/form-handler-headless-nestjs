import { isUlid, newUlid } from './ulid';

describe('newUlid', () => {
  it('is a lowercase ULID, as HasUlids generates', () => {
    const id = newUlid();
    expect(id).toMatch(/^[0-9a-hjkmnp-tv-z]{26}$/);
    expect(isUlid(id)).toBe(true);
  });
});

describe('isUlid (Str::isUlid)', () => {
  it.each([
    ['01ARZ3NDEKTSV4RRFFQ69G5FAV', true],
    ['01arz3ndektsv4rrffq69g5fav', true],
    ['7ZZZZZZZZZZZZZZZZZZZZZZZZZ', true],
    ['8ZZZZZZZZZZZZZZZZZZZZZZZZZ', false], // first character above 7
    ['01ARZ3NDEKTSV4RRFFQ69G5FA', false], // 25 characters
    ['01ARZ3NDEKTSV4RRFFQ69G5FAVX', false], // 27 characters
    ['01ARZ3NDEKTSV4RRFFQ69G5FAI', false], // I is not Crockford base32
    ['01ARZ3NDEKTSV4RRFFQ69G5FAU', false], // nor is U
    ['', false],
    [123, false],
  ])('%p → %p', (value, expected) => {
    expect(isUlid(value)).toBe(expected);
  });
});
