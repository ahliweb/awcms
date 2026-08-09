/**
 * The rate limit for public auth endpoints — issue #447.
 *
 * ## The hole this closes
 *
 * Six unauthenticated routes keyed their bucket on `${clientIp}:${tenantId}`,
 * where `tenantId` is the raw `x-awcms-tenant-id` header. Nothing validated it
 * and nothing looked it up: the first check happens inside `withTenant`, long
 * after the limiter has already decided. So the bucket key was ATTACKER-CHOSEN.
 * A different random UUID per request bought a fresh bucket every time, and the
 * limiter did not bind at all — not "bound N times looser", as issue #430
 * described, but not bound.
 *
 * What made that expensive rather than merely untidy: `verifyPasswordOrDummy`
 * runs argon2id `m=64MB` even when the identifier resolves to nothing (Issue
 * #147, and correctly so — it is what stops the endpoint being an enumeration
 * oracle). Every bypassed request cost 64 MiB and the CPU to go with it. The
 * limiter's own header names that scenario as the thing it exists to prevent.
 *
 * ## Why validating the header would not have fixed it
 *
 * A random UUID is a VALID UUID, so shape validation buys nothing. And checking
 * that the tenant EXISTS before the password work would install a tenant
 * enumeration oracle: a real tenant would cost an argon2id verify and a bogus
 * one would not, which is precisely the timing difference the dummy-hash design
 * removes for identities.
 *
 * The fix is therefore not a better check on the header. It is a ceiling whose
 * key the caller cannot choose: one bucket per SOURCE, checked alongside the
 * per-tenant bucket that already existed.
 *
 * ## Why both live in one function
 *
 * Six call sites, one pairing. If the source ceiling were a second call each
 * route had to remember, the seventh route would forget it — that is the same
 * failure mode `defineTenantRoute` exists for, one layer down. A route asks
 * this module for "the auth rate limit" and cannot obtain only half of it.
 *
 * ## Why it is inert on a single-tenant deployment
 *
 * `config:validate` refuses `AUTH_SOURCE_RATE_LIMIT_MAX` below
 * `AUTH_LOGIN_RATE_LIMIT_MAX`. With one tenant every request from a source
 * shares one per-tenant bucket, so that bucket fills first and the source
 * ceiling is unreachable — the behaviour is byte-identical to before. It only
 * begins to bind when one source spans several tenants, which is exactly the
 * shape of the abuse and an unusual shape for a legitimate client.
 *
 * The failure mode is also the mild one: `429` with `Retry-After`, not a
 * lockout. Nothing here writes to the database or locks an account.
 */
import { checkSharedRateLimit, type RateLimitResult } from "./rate-limit";

export const DEFAULT_SOURCE_RATE_LIMIT_MAX = 60;
export const DEFAULT_SOURCE_RATE_LIMIT_WINDOW_SEC = 60;

/**
 * Shared by every auth route, deliberately. A per-route source bucket would
 * restore the multiplication one level up: six routes × the ceiling, from one
 * source, against one deployment.
 */
const SOURCE_BUCKET_PREFIX = "auth-source";

/**
 * Takes the VALUE, never the variable name.
 *
 * `config:env:coverage:check` finds env reads with `/process\.env\.([A-Z…]+)/`,
 * so a helper that reads `process.env[name]` is invisible to it — the variable
 * would exist, be undocumented, and the gate that exists to catch exactly that
 * would stay green. The two reads below are therefore written out in full.
 */
function parseCeiling(raw: string | undefined, fallback: number): number {
  const trimmed = raw?.trim();

  if (!trimmed) return fallback;

  const parsed = Number.parseInt(trimmed, 10);

  return Number.isInteger(parsed) && parsed >= 1 ? parsed : fallback;
}

export type AuthRateLimitConfig = {
  /** The per-tenant ceiling the route already had. Unchanged by this module. */
  maxAttempts: number;
  windowMs: number;
};

export type AuthRateLimitInput = {
  clientIp: string;
  /** The raw header. Untrusted by construction — that is the whole point. */
  tenantId: string;
  /** Distinguishes the per-tenant buckets of routes sharing a tenant. */
  scope: string;
  config: AuthRateLimitConfig;
};

/**
 * `allowed: false` from EITHER ceiling, with the source ceiling checked first.
 *
 * First matters: the source bucket is the one an attacker cannot escape, so
 * consuming a per-tenant slot for a request that the source ceiling is about to
 * refuse would let attacker traffic fill a real tenant's bucket — turning a
 * bypass into a denial of service against that tenant's users.
 */
export async function checkAuthRateLimit(
  input: AuthRateLimitInput
): Promise<RateLimitResult> {
  const source = await checkSharedRateLimit(
    `${SOURCE_BUCKET_PREFIX}:${input.clientIp}`,
    {
      maxAttempts: parseCeiling(
        process.env.AUTH_SOURCE_RATE_LIMIT_MAX,
        DEFAULT_SOURCE_RATE_LIMIT_MAX
      ),
      windowMs:
        parseCeiling(
          process.env.AUTH_SOURCE_RATE_LIMIT_WINDOW_SEC,
          DEFAULT_SOURCE_RATE_LIMIT_WINDOW_SEC
        ) * 1000
    }
  );

  if (!source.allowed) {
    return source;
  }

  return checkSharedRateLimit(
    `${input.clientIp}:${input.tenantId}:${input.scope}`,
    input.config
  );
}
