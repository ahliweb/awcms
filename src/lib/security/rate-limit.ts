import { getRedisClient, withRedisCommandTimeout } from "../redis/client";
import { buildRedisKey } from "../redis/config";

/**
 * Generic in-process fixed-window rate limiter — a source-scoped backstop on
 * top of `identity-access`'s own per-identity lockout (`login-policy.ts`),
 * which does nothing against an attacker rotating `loginIdentifier` values.
 *
 * ## Two backends, and why the in-process one is still here
 *
 * `checkRateLimit` counts in an in-process `Map`. With **N** replicas behind a
 * load balancer the effective limit becomes **N x** the configured one, so the
 * deployments that most need protection — high traffic, therefore many replicas
 * — are the weakest. That is the defect ADR-0066 closes.
 *
 * `checkSharedRateLimit` counts in Redis when Redis is configured, and falls
 * back to the in-process map when it is not. The fallback is not a compromise:
 * a single-instance deployment has nothing to share, and requiring Redis for it
 * would make the limiter a new hard dependency for the smallest topology.
 *
 * ## Fail-OPEN, deliberately, and only here
 *
 * If Redis is configured but unreachable, the shared limiter **allows** the
 * request. That is the opposite of this repo's default posture, so it is stated
 * loudly: a rate limiter is availability tooling on the authentication path, and
 * failing closed would turn a Redis outage into "nobody can log in" — an
 * attacker-triggerable total denial of service on the control plane.
 *
 * What keeps that honest is that it is not the ONLY control:
 * `identity-access`'s per-identity lockout (`login-policy.ts`) is enforced in
 * PostgreSQL, atomically, and is unaffected by a Redis outage. This limiter is
 * the source-scoped backstop on top of it — the thing that catches an attacker
 * rotating `loginIdentifier` values — not the last line.
 *
 * `security:readiness` reports a configured-but-unreachable Redis, so the
 * degraded state is visible rather than silent.
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

/**
 * Shared, cross-instance rate limit backed by Redis — ADR-0066.
 *
 * Fixed window, same semantics as `checkRateLimit`: `INCR` the window's counter
 * and set its TTL on first use, so the key expires by itself and no sweeper is
 * needed.
 *
 * Returns the in-process result when Redis is not configured, and **allows**
 * when Redis is configured but failing — see this file's header for why that
 * direction is correct here specifically.
 */
export async function checkSharedRateLimit(
  key: string,
  config: RateLimitConfig,
  now: number = Date.now(),
  deps: {
    client?: { send(command: string, args: string[]): Promise<unknown> } | null;
    buildKey?: (raw: string) => string;
  } = {}
): Promise<RateLimitResult> {
  const client = deps.client === undefined ? getRedisClient() : deps.client;

  if (!client) {
    // No Redis configured: single-instance topology, nothing to share.
    return checkRateLimit(key, config, now);
  }

  // The window is part of the KEY, not a stored timestamp. Two instances
  // incrementing the same window therefore agree without a read-modify-write,
  // which is the whole reason this is correct where the `Map` is not.
  const window = Math.floor(now / config.windowMs);
  const redisKey = (deps.buildKey ?? defaultRateLimitKey)(`${key}:${window}`);

  try {
    const count = Number(
      await withRedisCommandTimeout(
        client.send("INCR", [redisKey]) as Promise<unknown>,
        RATE_LIMIT_COMMAND_TIMEOUT_MS,
        "rate-limit INCR"
      )
    );

    if (count === 1) {
      // First hit in this window — bound the key's lifetime. A failure here
      // only means the key lingers one extra window; it never over-counts.
      await withRedisCommandTimeout(
        client.send("PEXPIRE", [
          redisKey,
          String(config.windowMs)
        ]) as Promise<unknown>,
        RATE_LIMIT_COMMAND_TIMEOUT_MS,
        "rate-limit PEXPIRE"
      ).catch(() => undefined);
    }

    if (count > config.maxAttempts) {
      const elapsedMs = now - window * config.windowMs;

      return {
        allowed: false,
        retryAfterSec: Math.max(
          1,
          Math.ceil((config.windowMs - elapsedMs) / 1000)
        )
      };
    }

    return { allowed: true };
  } catch {
    // Fail OPEN. See the header: the DB-enforced per-identity lockout is
    // unaffected by a Redis outage, and failing closed here would make an
    // outage an attacker-triggerable lockout of every user.
    return { allowed: true };
  }
}

/**
 * A tight timeout on purpose: this runs on the login path, and a slow Redis must
 * degrade to "allowed" quickly rather than add latency to every attempt.
 */
const RATE_LIMIT_COMMAND_TIMEOUT_MS = 250;

/** Namespaced, prefix-scoped key so rate-limit counters cannot collide with cache entries. */
function defaultRateLimitKey(raw: string): string {
  return buildRedisKey({ namespace: "rate-limit", key: raw });
}
