/**
 * Generic in-process fixed-window rate limiter — a source-scoped backstop on
 * top of `identity-access`'s own per-identity lockout (`login-policy.ts`),
 * which does nothing against an attacker rotating `loginIdentifier` values.
 *
 * Known limitation: the counter is an in-process `Map`, so it is
 * per-instance — acceptable for this base's default single-instance
 * topology; a multi-instance deployment wanting a shared limit should front
 * the app with an edge/proxy rate limiter instead.
 */
export type RateLimitConfig = {
  maxAttempts: number;
  windowMs: number;
};

export type RateLimitResult =
  { allowed: true } | { allowed: false; retryAfterSec: number };

type Bucket = { count: number; windowStart: number };

const buckets = new Map<string, Bucket>();

export function checkRateLimit(
  key: string,
  config: RateLimitConfig,
  now: number = Date.now()
): RateLimitResult {
  const existing = buckets.get(key);

  if (!existing || now - existing.windowStart >= config.windowMs) {
    buckets.set(key, { count: 1, windowStart: now });
    return { allowed: true };
  }

  existing.count += 1;

  if (existing.count > config.maxAttempts) {
    const remainingMs = config.windowMs - (now - existing.windowStart);
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil(remainingMs / 1000))
    };
  }

  return { allowed: true };
}

export function resolveClientIp(
  request: Request,
  clientAddress: string | undefined
): string {
  const forwardedFor = request.headers.get("x-forwarded-for");

  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();

    if (first) return first;
  }

  return clientAddress ?? "unknown";
}
