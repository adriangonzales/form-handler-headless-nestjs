/**
 * Laravel's `Timebox`: the callback takes at least `microseconds`, so its
 * duration doesn't reveal which branch ran (e.g. whether an email exists).
 * `returnEarly()` skips the wait. Real time on purpose, not the `Clock`.
 */
export async function timebox<T>(
  microseconds: number,
  callback: (box: { returnEarly(): void }) => Promise<T>,
): Promise<T> {
  const start = process.hrtime.bigint();
  let early = false;
  try {
    return await callback({ returnEarly: () => (early = true) });
  } finally {
    const elapsedUs = Number((process.hrtime.bigint() - start) / 1000n);
    const remaining = microseconds - elapsedUs;
    if (!early && remaining > 0)
      await new Promise((resolve) => setTimeout(resolve, remaining / 1000));
  }
}
