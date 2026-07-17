import { createHmac, randomBytes } from "node:crypto";

import { log } from "../logging/logger";

/**
 * Issue #145 — audit attributes for authentication events need to answer
 * "which source is this?" (brute-force / credential-stuffing forensics)
 * without persisting a raw client IP.
 *
 * A raw IP cannot go into audit `attributes`: `src/modules/_shared/redaction.ts`
 * deliberately treats `ip`/`ipAddress`/`clientIp`/`remoteAddr`/`x-forwarded-for`
 * as sensitive and would replace the value with `"[REDACTED]"` anyway — an
 * unusable, permanently blank column. Renaming the key to dodge that redaction
 * would be a security regression, not a fix.
 *
 * A *keyed* hash resolves both requirements at once: the stored value is
 * stable, so an operator can group audit rows by source ("40 `login_failed`
 * rows, same `ipHash`, 40 different accounts" — the exact signal the audit
 * exists for), while the address itself is not recoverable from the audit
 * trail.
 *
 * Keyed (HMAC) rather than a plain digest on purpose: the IPv4 space is only
 * 2^32, so an unsalted `sha256(ip)` is exhaustively reversible in seconds and
 * would be pseudonymization in name only.
 */
const IP_HASH_PREFIX = "hmac-sha256:";

/**
 * Ported from awcms-mini with the key source adapted, not copied: mini keys
 * this HMAC with `AUTH_JWT_SECRET`, which is a *required* env var there.
 * This base has no such variable at all (see `.env.example` /
 * `scripts/validate-env.ts` — the only secret it knows is the optional,
 * sync-specific `AWCMS_SYNC_HMAC_SECRET`, which is `change-me` by default and
 * therefore worthless as a key), so the dedicated variable below is used
 * instead.
 */
const IP_HASH_SECRET_ENV = "AUTH_IP_HASH_SECRET";

/**
 * Mirrors `PLACEHOLDER_SECRETS` in `scripts/validate-env.ts`. A key that is
 * still a documented placeholder is public knowledge (this repo is public),
 * and keying a pseudonym with public knowledge makes every persisted `ipHash`
 * reversible — the one property the pseudonym exists to provide. Rejected
 * HERE, not only in `config:validate`: `bun run dev`/`bun run start` invoke
 * the server directly and never run that validator, so a check that only runs
 * when an operator remembers to run it is not a control.
 */
const PLACEHOLDER_SECRETS: ReadonlySet<string> = new Set([
  "change-me",
  "changeme",
  "secret",
  "replace-me"
]);

/**
 * Per-process fallback key, generated once on first use.
 *
 * Mini throws when its key is missing, because there the key is a variable
 * every deployment already had to provision. Throwing here would instead take
 * the login endpoint down on every deployment that predates this variable —
 * turning an audit improvement into an auth outage. Falling back to an
 * *unkeyed* digest is equally unacceptable (2^32 IPv4 addresses: instantly
 * reversible). A random per-process key keeps the non-reversibility property
 * intact and login working; what it costs is cross-restart / cross-instance
 * grouping of `ipHash` values, which is exactly what the warning below tells
 * the operator to fix by setting `AUTH_IP_HASH_SECRET`.
 */
let ephemeralIpHashKey: string | null = null;

function resolveIpHashKey(): string {
  const configured = process.env[IP_HASH_SECRET_ENV]?.trim();

  if (
    configured !== undefined &&
    configured !== "" &&
    !PLACEHOLDER_SECRETS.has(configured.toLowerCase())
  ) {
    return configured;
  }

  if (ephemeralIpHashKey === null) {
    ephemeralIpHashKey = randomBytes(32).toString("hex");

    // Logged once per process, not per request: this runs on a public,
    // unauthenticated endpoint, so a per-request warning would let an attacker
    // amplify log volume for free.
    log("warning", "security.client_fingerprint.ephemeral_ip_hash_key", {
      moduleKey: "identity_access",
      envVar: IP_HASH_SECRET_ENV,
      reason:
        configured === undefined || configured === ""
          ? "not_set"
          : "placeholder_value",
      impact:
        "audit ipHash values are keyed with a per-process random key: still non-reversible, but not comparable across restarts or instances"
    });
  }

  return ephemeralIpHashKey;
}

/** Test-only: forces the next `hashClientIp` to re-resolve the key. */
export function resetClientFingerprintKeyForTests(): void {
  ephemeralIpHashKey = null;
}

/**
 * Stable, non-reversible pseudonym for a client IP, safe to persist in audit
 * `attributes` under the key `ipHash` (which no redaction rule matches — it
 * normalizes to `iphash`, which is neither an entry of the exact-match IP
 * synonym allowlist nor a substring of any redaction key).
 */
export function hashClientIp(ip: string): string {
  return (
    IP_HASH_PREFIX +
    createHmac("sha256", resolveIpHashKey()).update(ip).digest("hex")
  );
}

/**
 * Upper bound on the persisted `User-Agent`. The header is fully
 * attacker-controlled and unbounded in practice, so it is truncated before it
 * ever reaches a `jsonb` column — an audit row must never become an
 * attacker-sized write amplifier on a public, unauthenticated endpoint.
 */
const MAX_USER_AGENT_LENGTH = 256;

/**
 * The request's `User-Agent`, truncated, or `undefined` when absent/blank so
 * the key is simply omitted from audit attributes rather than stored as an
 * empty string.
 */
export function summarizeUserAgent(request: Request): string | undefined {
  const userAgent = request.headers.get("user-agent")?.trim();

  if (!userAgent) {
    return undefined;
  }

  return userAgent.slice(0, MAX_USER_AGENT_LENGTH);
}
