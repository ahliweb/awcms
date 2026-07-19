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

/**
 * Clear all in-process rate-limit buckets. Test-only: the integration harness
 * calls this per test (alongside the DB circuit-breaker reset) so that a suite
 * which drives a rate-limited endpoint many times from the same client IP —
 * e.g. the harness bootstrapping a fresh tenant via `POST /setup/initialize`
 * for every test — does not carry a tripped counter across tests and start
 * returning 429. Never call this from production code.
 */
export function resetRateLimitForTests(): void {
  buckets.clear();
}

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

/**
 * Issue #147 §3 — `X-Forwarded-For` is only honored when the deployment
 * declares that a trusted proxy sets it.
 *
 * The header is a plain request header: when the app is exposed directly (the
 * single-instance LAN topology this base documents as its default), it is
 * fully attacker-controlled. Trusting it unconditionally let an attacker send
 * a random `X-Forwarded-For` per request, land in a fresh bucket every time,
 * and never trip the limit above — reopening cross-identity enumeration and
 * volumetric attack against a public endpoint that runs argon2id m=64MB, i.e.
 * exactly the gap this limiter exists to close (see the module doc comment).
 *
 * Default is off, so the safe topology is the one that needs no configuration
 * and the unsafe one must be opted into explicitly. Behind a reverse proxy
 * `clientAddress` is the proxy's own address, which would collapse every
 * client into one bucket — so a deployment that genuinely terminates traffic
 * at a proxy sets `TRUSTED_PROXY_ENABLED=true`, which is only sound if that
 * proxy *overwrites* (not appends to) the client-supplied header.
 */
function isTrustedProxyEnabled(): boolean {
  return process.env.TRUSTED_PROXY_ENABLED === "true";
}

export function resolveClientIp(
  request: Request,
  clientAddress: string | undefined
): string {
  if (isTrustedProxyEnabled()) {
    const forwardedFor = request.headers.get("x-forwarded-for");

    if (forwardedFor) {
      // First entry is the original client when a trusted proxy appends its
      // own hops to the right.
      const first = forwardedFor.split(",")[0]?.trim();

      if (first) return first;
    }
  }

  return clientAddress ?? "unknown";
}
