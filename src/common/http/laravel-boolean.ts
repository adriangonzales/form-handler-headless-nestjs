/**
 * Values Laravel's `boolean` rule accepts: `true false 1 0 "1" "0"`.
 * `"true"`/`"false"` are not booleans to it (they pass `accepted`, not `boolean`).
 */
export function isLaravelBoolean(
  value: unknown,
): value is boolean | 0 | 1 | '0' | '1' {
  return (
    value === true ||
    value === false ||
    value === 0 ||
    value === 1 ||
    value === '0' ||
    value === '1'
  );
}

/** The boolean a validated `boolean` value stores as (Eloquent's `boolean` cast). */
export function toLaravelBoolean(value: boolean | 0 | 1 | '0' | '1'): boolean {
  return value === true || value === 1 || value === '1';
}

/** Query filters validated with `in:true,false,1,0` (e.g. `filter[read]`). */
export function parseFilterBoolean(
  value: 'true' | 'false' | '1' | '0',
): boolean {
  return value === 'true' || value === '1';
}
