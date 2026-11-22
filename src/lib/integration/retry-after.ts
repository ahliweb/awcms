/**
 * `Retry-After` header parsing shared by provider adapters (Issue #1432; the
 * Mailketing v2 adapter used to own the only copy). Pure, no I/O.
 *
 * Accepts delta-seconds or an HTTP-date, and always CLAMPS to `[minMs, maxMs]`
 * so a hostile or buggy provider cannot park a row for days or make the value
 * zero (a zero would turn a throttle into a hot loop). `undefined` when the
 * header is absent or unusable.
 */
export function parseRetryAfterClamped(
  value: string | null | undefined,
  now: Date,
  minMs: number,
  maxMs: number
): number | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  let ms: number;

  if (/^\d{1,9}$/.test(trimmed)) {
    ms = Number(trimmed) * 1000;
  } else {
    // An HTTP-date always names a weekday/month; this keeps "-5" and other
    // numeric junk (which `Date.parse` happily reads as a year) out.
    if (!/[A-Za-z]/.test(trimmed)) {
      return undefined;
    }

    const at = Date.parse(trimmed);

    if (Number.isNaN(at)) {
      return undefined;
    }

    ms = at - now.getTime();
  }

  return Math.min(Math.max(ms, minMs), maxMs);
}
