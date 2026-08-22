import { log } from "../logging/logger";
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
 * `identity-access`'s per-identity lockout is enforced in PostgreSQL, in the
 * same statement that increments the counter (`login.ts`'s
 * `failed_login_count = failed_login_count + 1` with a `CASE WHEN … >= max`
 * lock), and is unaffected by a Redis outage. This limiter is the
 * source-scoped backstop on top of it — the thing that catches an attacker
 * rotating `loginIdentifier` values — not the last line.
 *
 * That sentence was true of the design and false of the code until Issue #483:
 * the route read the counter, added one in JS, and wrote the absolute value
 * back, so concurrent failures overwrote each other and K parallel attempts
 * cost one increment. The fail-open posture above rested on it. Naming the
 * statement rather than the file is deliberate — "atomically" was exactly the
 * word that stayed true-looking while the mechanism underneath it was not.
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

/**
 * `windowMs` is stored per bucket, not read from the caller's config, because
 * eviction happens outside any call for that key: the sweep below has to know
 * when an entry it was not asked about stopped counting, and the same map is
 * shared by callers with different windows (login: minutes; site-search:
 * seconds).
 */
type Bucket = { count: number; windowStart: number; windowMs: number };

const buckets = new Map<string, Bucket>();

/**
 * ## Why this map is swept, and why it is also capped
 *
 * An entry is created per distinct key — in practice per client IP — and
 * before this it was never removed. A live entry is only meaningful until its
 * window ends: `checkRateLimit` already treats an elapsed window as a fresh
 * start, so an entry past `windowStart + windowMs` holds no information and
 * only occupies memory. Redis is off by default, so the in-process map is the
 * live path for the default topology, and the leak is one permanent entry per
 * IP that has ever touched a rate-limited endpoint — a slow leak whose end
 * state is an OOM of the process holding every other cache.
 *
 * The sweep alone bounds the map to "distinct clients seen within one window",
 * which is the correct working set. That set is itself attacker-controlled
 * during a distributed flood, so there is also a hard cap. Evicting a LIVE
 * bucket forgets a counter and hands its owner a fresh allowance, so the cap
 * is deliberately high and the victims are chosen as the least harmful ones
 * available: the entries CLOSEST TO EXPIRING, which would have been forgotten
 * within milliseconds anyway. Eviction is in one batch down to
 * `BUCKET_EVICTION_TARGET` rather than one entry per insert, so the sort it
 * needs runs once per 10% growth instead of once per request while the cap is
 * pinned.
 *
 * This is a memory bound, not a second limiter: nothing here can make a
 * request MORE limited than the configured ceiling.
 */
const BUCKET_SWEEP_INTERVAL_MS = 60_000;
const BUCKET_HARD_CAP = 50_000;
const BUCKET_EVICTION_TARGET = Math.floor(BUCKET_HARD_CAP * 0.9);

let lastSweepAt = 0;
let warnedAboutCap = false;

/** Drops every entry whose window has already elapsed. */
function sweepExpiredBuckets(now: number): void {
  for (const [key, bucket] of buckets) {
    if (now - bucket.windowStart >= bucket.windowMs) {
      buckets.delete(key);
    }
  }
}

function boundBuckets(now: number): void {
  if (
    buckets.size < BUCKET_HARD_CAP &&
    now - lastSweepAt < BUCKET_SWEEP_INTERVAL_MS
  ) {
    return;
  }

  lastSweepAt = now;
  sweepExpiredBuckets(now);

  // `<` rather than `<=`: this runs BEFORE the caller's own insert, so leaving
  // the map exactly AT the cap is leaving it one entry over.
  if (buckets.size < BUCKET_HARD_CAP) {
    return;
  }

  // Still over the cap with nothing expired to reclaim: every remaining entry
  // is live. Take the ones with the least window left.
  const byExpiry = [...buckets.entries()].sort(
    (a, b) =>
      a[1].windowStart + a[1].windowMs - (b[1].windowStart + b[1].windowMs)
  );

  const evictCount = buckets.size - BUCKET_EVICTION_TARGET;

  for (let index = 0; index < evictCount; index += 1) {
    buckets.delete(byExpiry[index]![0]);
  }

  if (!warnedAboutCap) {
    warnedAboutCap = true;

    // Once per process: this fires under exactly the traffic that makes a
    // per-event log a free amplifier for whoever caused it.
    log("warning", "security.rate_limit.bucket_cap_reached", {
      cap: BUCKET_HARD_CAP,
      evicted: evictCount,
      reason:
        "in-process rate-limit map hit its size cap — soonest-to-expire counters were dropped; configure Redis (REDIS_URL) for a shared limiter"
    });
  }
}

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
  lastSweepAt = 0;
  warnedAboutCap = false;
}

/** Test-only: the number of live in-process buckets. */
export function rateLimitBucketCountForTests(): number {
  return buckets.size;
}

export function checkRateLimit(
  key: string,
  config: RateLimitConfig,
  now: number = Date.now()
): RateLimitResult {
  boundBuckets(now);

  const existing = buckets.get(key);

  if (!existing || now - existing.windowStart >= config.windowMs) {
    buckets.set(key, {
      count: 1,
      windowStart: now,
      windowMs: config.windowMs
    });
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
 * at a proxy sets `TRUSTED_PROXY_ENABLED=true`.
 *
 * ## Why the entry is counted from the RIGHT (issue #438)
 *
 * This used to take the LEFTMOST entry, with a precondition written in prose:
 * sound "only if that proxy *overwrites* (not appends to) the client-supplied
 * header". A precondition an operator cannot verify from here is not a
 * control, and the failure it permits is total rather than partial: against an
 * APPENDING proxy — the RFC-7239 behaviour, and nginx's own
 * `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for` — an attacker
 * sends `X-Forwarded-For: <random>`, the proxy appends the real peer to the
 * right, the leftmost entry stays whatever the attacker typed, and every
 * request lands in a fresh bucket. That is precisely the bypass
 * `TRUSTED_PROXY_ENABLED` was introduced to close, reopened by the topology it
 * was introduced to serve.
 *
 * The header's trust gradient runs right-to-left: the RIGHTMOST entry was
 * written by your own edge, each one further left by something less trusted,
 * and everything left of your own hops is attacker-controlled by
 * construction. So the client is the entry `TRUSTED_PROXY_HOP_COUNT` positions
 * from the right, and no position an attacker can reach is ever read.
 *
 * Default **1** is the single-proxy topology this base documents, and it is
 * also byte-identical to the old behaviour for the ONE case that was ever
 * sound: an overwriting proxy emits a single value, where leftmost and
 * rightmost are the same entry.
 *
 * A header carrying FEWER entries than the configured hops means the request
 * did not traverse the declared chain. It falls back to `clientAddress`
 * rather than reading a shorter chain's leftmost value — degrading to
 * over-limiting (everyone shares the proxy's bucket) instead of to
 * no-limiting.
 *
 * ## Why this does not simply adopt `resolveAnalyticsClientIp`'s rule
 *
 * `visitor-analytics` refuses a multi-value header outright and returns
 * `null`. That is right THERE: a missing analytics IP costs a row's precision.
 * Here there is no `null` to return — a limiter must name a bucket — and
 * refusing multi-value would collapse every client behind a legitimate 2-hop
 * chain into one bucket, locking out a tenant's whole user base on twenty bad
 * passwords. Same principle (never read an attacker-reachable position),
 * different fallback, because the two failures are not comparable.
 */
function isTrustedProxyEnabled(): boolean {
  return process.env.TRUSTED_PROXY_ENABLED === "true";
}

/** Trusted hops between the client and this process. Validated by `config:validate`. */
export const DEFAULT_TRUSTED_PROXY_HOP_COUNT = 1;

function trustedProxyHopCount(): number {
  const raw = process.env.TRUSTED_PROXY_HOP_COUNT?.trim();

  if (!raw) return DEFAULT_TRUSTED_PROXY_HOP_COUNT;

  const parsed = Number.parseInt(raw, 10);

  // A malformed value falls back to the default rather than to zero: zero
  // would index past the right edge and silently disable header trust on a
  // deployment that believes it configured it.
  return Number.isInteger(parsed) && parsed >= 1
    ? parsed
    : DEFAULT_TRUSTED_PROXY_HOP_COUNT;
}

/**
 * The client entry of an `X-Forwarded-For` header, counted from the right.
 * Exported for tests: the whole point of #438 is that this is arithmetic, and
 * arithmetic can be checked.
 */
export function selectForwardedEntry(
  forwardedFor: string,
  hopCount: number
): string | null {
  const parts = forwardedFor
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  return parts[parts.length - hopCount] ?? null;
}

export function resolveClientIp(
  request: Request,
  clientAddress: string | undefined
): string {
  if (isTrustedProxyEnabled()) {
    const forwardedFor = request.headers.get("x-forwarded-for");

    if (forwardedFor) {
      const client = selectForwardedEntry(forwardedFor, trustedProxyHopCount());

      if (client) return client;
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
