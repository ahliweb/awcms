/**
 * Cloudflare Turnstile bot-protection adapter (Issue #186, epic ERP-readiness
 * enterprise auth #177). Ported and HARDENED from awcms-mini
 * `src/lib/security/turnstile.ts` (Issue #588).
 *
 * Active ONLY when the full-online deployment-profile gate
 * (`../auth/online-security-config`'s `isFullOnlineSecurityActive`) is on AND
 * `TURNSTILE_ENABLED=true` — `isTurnstileRequired` below is the ONE function
 * every gated surface (the login route, the setup route, the login-page widget,
 * and the CSP builder) checks. Local/offline/LAN deployments (the default, both
 * env vars unset) NEVER call Cloudflare, NEVER require these env vars, NEVER add
 * a CSP origin, and NEVER change behavior.
 *
 * Verifies a client-submitted Turnstile response token against Cloudflare's
 * siteverify endpoint SERVER-SIDE (the client widget alone is not security).
 *
 * HARDENING vs mini (this base validates strictly, per Issue #186):
 *  - mini checked only `success`; this also validates `action`, `hostname`, and
 *    challenge-timestamp freshness — closing the token-replay-across-action and
 *    hostname-confusion threats named in the issue's threat model.
 *  - mini used `withTimeout(fetch())` then read the body OUTSIDE the timer (a
 *    slow-drip body could beat the deadline); this base spans a single
 *    `AbortController` across the fetch AND the bounded body read, and caps the
 *    response size — the exact F3 gap the OIDC SSRF port already fixed.
 *
 * The token is NEVER logged or audited; the secret is redacted out of any error
 * text before it can be returned or logged. This file has ZERO database access
 * and never participates in a transaction — callers run it BEFORE entering
 * `withTenant`, ahead of password verification (issue: "di luar transaksi
 * database", "sebelum password verification mahal").
 */
import { getProviderCircuitBreaker } from "../database/circuit-breaker";
import { log } from "../logging/logger";
import { isFullOnlineSecurityActive } from "../auth/online-security-config";

const PROVIDER_KEY = "turnstile";
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_RESPONSE_BYTES = 16 * 1024;
const DEFAULT_MAX_TOKEN_AGE_SEC = 300;
const MAX_ERROR_MESSAGE_LENGTH = 300;
const MAX_CLOCK_SKEW_SEC = 60;
const DEFAULT_SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * The single Cloudflare origin the widget script (`api.js`) and its challenge
 * iframe load from. Consumed by `src/lib/security/security-headers.ts` to open
 * `script-src`/`frame-src` NARROWLY and ONLY when Turnstile is required — never
 * hardcoded a second time there.
 */
export const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";

/**
 * The per-endpoint Turnstile `action` labels. A token is bound to the action
 * the widget was solved for, and `verifyTurnstileToken` rejects a token whose
 * echoed `action` does not match — so a token minted for the login form can
 * never be replayed against the setup bootstrap, and vice versa (issue: "satu
 * token tidak boleh dikaitkan lintas action"). Shared by the widget markup,
 * the route enforcement, and the tests, so the three can never drift.
 */
export const LOGIN_TURNSTILE_ACTION = "login";
export const SETUP_TURNSTILE_ACTION = "setup";

/**
 * Env vars required only when `TURNSTILE_ENABLED=true` (validated by
 * `scripts/validate-env.ts` and `scripts/security-readiness.ts`).
 * `TURNSTILE_SITE_KEY` is NOT a secret (Cloudflare's own docs: it is embedded
 * in the public HTML widget) but the feature cannot work without it, so it is
 * still required-when-enabled. `TURNSTILE_EXPECTED_HOSTNAME` is required so the
 * hostname check can fail closed at runtime rather than being silently skipped
 * (hostname-confusion defense). Only `TURNSTILE_SECRET_KEY` carries the
 * redaction discipline `verifyTurnstileToken` applies.
 */
export const TURNSTILE_REQUIRED_WHEN_ENABLED = [
  "TURNSTILE_SITE_KEY",
  "TURNSTILE_SECRET_KEY",
  "TURNSTILE_EXPECTED_HOSTNAME"
] as const;

export type TurnstileConfig = {
  secretKey: string;
  /** Override for tests only — a local fake HTTP server standing in for Cloudflare's siteverify endpoint. Always from configuration, never request input (SSRF-safe). */
  verifyUrl?: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
};

export type TurnstileExpectations = {
  /** The action this token must have been solved for (per endpoint). Always required — a token with a missing/other action is rejected. */
  action: string;
  /** The hostname the challenge must have been solved on. When set, a mismatch is rejected. */
  hostname?: string;
  /** Reject a token whose `challenge_ts` is older than this many seconds (freshness). Undefined disables the check. */
  maxTokenAgeSec?: number;
  /** Injectable clock for deterministic freshness/breaker tests. */
  now?: Date;
};

export type TurnstileVerifyReason =
  | "provider_unavailable"
  | "provider_error"
  | "rejected"
  | "hostname_mismatch"
  | "action_mismatch"
  | "stale";

export type TurnstileVerifyResult =
  | { ok: true }
  | {
      ok: false;
      reason: TurnstileVerifyReason;
      detail: string;
      retryable: boolean;
    };

type SiteverifyResponse = {
  success?: boolean;
  "error-codes"?: string[];
  challenge_ts?: string;
  hostname?: string;
  action?: string;
  cdata?: string;
};

function truncate(message: string): string {
  return message.length > MAX_ERROR_MESSAGE_LENGTH
    ? `${message.slice(0, MAX_ERROR_MESSAGE_LENGTH)}…`
    : message;
}

/**
 * Strips the configured secret out of `message` before it is ever returned to
 * a caller or logged — defense in depth against a thrown error accidentally
 * echoing part of the request body.
 */
function redact(message: string, secrets: readonly string[]): string {
  let sanitized = message;

  for (const secret of secrets) {
    if (secret) {
      sanitized = sanitized.split(secret).join("[redacted]");
    }
  }

  return sanitized;
}

function redactTruncate(message: string, secrets: readonly string[]): string {
  return truncate(redact(message, secrets));
}

/**
 * Reads at most `maxBytes` of the response body, aborting (via the caller's
 * shared `AbortController`, threaded through `response.body`) once the cap is
 * exceeded. Returns `null` on overflow so the caller treats an oversized body
 * as a provider error rather than parsing an unbounded string.
 */
async function readCappedText(
  response: Response,
  maxBytes: number
): Promise<string | null> {
  const body = response.body;

  if (!body) {
    const text = await response.text();
    return text.length > maxBytes ? null : text;
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    if (value) {
      total += value.byteLength;

      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return null;
      }

      chunks.push(value);
    }
  }

  const merged = new Uint8Array(total);
  let offset = 0;

  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(merged);
}

/**
 * True when `challengeTs` (an ISO-8601 timestamp Cloudflare returns for when
 * the challenge was solved) is within `maxAgeSec` of `now` and not implausibly
 * in the future. A missing or unparseable timestamp fails closed (returns
 * false) — the freshness guarantee cannot be verified, so the token is treated
 * as stale rather than trusted.
 */
function isFreshChallenge(
  challengeTs: string | undefined,
  now: Date,
  maxAgeSec: number
): boolean {
  if (!challengeTs) {
    return false;
  }

  const parsed = Date.parse(challengeTs);

  if (Number.isNaN(parsed)) {
    return false;
  }

  const ageSec = (now.getTime() - parsed) / 1000;

  if (ageSec > maxAgeSec) {
    return false;
  }

  // A timestamp more than a minute in the future is a clock problem or a forged
  // value — reject rather than accept an "age" that is negative by design.
  return ageSec >= -MAX_CLOCK_SKEW_SEC;
}

/**
 * Verifies `token` (the client-submitted Turnstile response, e.g. from the
 * widget's auto-injected `cf-turnstile-response` form field) against
 * Cloudflare's siteverify endpoint. `remoteIp`, if provided, is forwarded per
 * Cloudflare's own API (optional, improves their fraud scoring — never
 * required). Never throws: every failure mode is a structured
 * `{ ok: false, reason, ... }` the enforcement layer collapses to one generic
 * client-facing error.
 */
export async function verifyTurnstileToken(
  token: string,
  config: TurnstileConfig,
  expectations: TurnstileExpectations,
  remoteIp?: string
): Promise<TurnstileVerifyResult> {
  const verifyUrl = config.verifyUrl ?? DEFAULT_SITEVERIFY_URL;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = config.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const now = expectations.now ?? new Date();
  const breaker = getProviderCircuitBreaker(PROVIDER_KEY);
  // Redaction set: the configured secret AND the client-submitted token
  // (Issue #186 F4, defense-in-depth). The token is never intentionally placed
  // in any returned error or log line, but if some future thrown error ever
  // echoed part of the request, both must be scrubbed to `[redacted]` before it
  // can surface. `redact` no-ops on empty strings, so a zero-length value is
  // harmless.
  const secrets = [config.secretKey, token];

  if (!breaker.canAttempt(now)) {
    // While the shared breaker is open, `enforceTurnstileIfRequired` fails
    // closed and blocks every gated request for every tenant. Logged at
    // `warning` so a sustained open breaker (a real Cloudflare outage) is
    // distinguishable from normal traffic. The token is never in this line.
    log("warning", "turnstile.circuit_breaker_open");

    return {
      ok: false,
      reason: "provider_unavailable",
      detail: "Turnstile circuit breaker is open; skipping attempt.",
      retryable: true
    };
  }

  const formData = new URLSearchParams();
  formData.set("secret", config.secretKey);
  formData.set("response", token);

  if (remoteIp) {
    formData.set("remoteip", remoteIp);
  }

  // ONE controller + timer spans the fetch AND the bounded body read: a slow
  // body streamed under the size cap cannot beat the deadline (the F3 lesson).
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(verifyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formData.toString(),
      signal: controller.signal
    });

    const rawBody = await readCappedText(response, maxBytes);
    let body: SiteverifyResponse | undefined;

    if (rawBody != null) {
      try {
        body = JSON.parse(rawBody) as SiteverifyResponse;
      } catch {
        body = undefined;
      }
    }

    // Only a transport-level problem with Cloudflare itself (non-2xx status, or
    // a 2xx we could not parse / that overflowed the size cap) counts as a
    // PROVIDER failure for the shared circuit breaker. A well-formed 2xx with
    // `success: false` is Cloudflare correctly telling us the token was bad —
    // the normal, attacker-repeatable outcome for a garbage/expired/reused
    // token. Feeding THAT into `recordFailure` would let anyone trip this
    // shared, cross-tenant breaker (and, since enforcement fails closed while
    // it is open, lock out login/setup for every tenant) with a handful of junk
    // tokens (mini PR #596 security review). The same reasoning applies to the
    // hostname/action/freshness rejections below.
    if (response.status < 200 || response.status >= 300 || !body) {
      breaker.recordFailure(now);
      log("warning", "turnstile.provider_call_failed", {
        httpStatus: response.status
      });

      return {
        ok: false,
        reason: "provider_error",
        detail: redactTruncate(
          `Turnstile provider call failed (HTTP ${response.status}).`,
          secrets
        ),
        retryable: response.status >= 500 || response.status === 0
      };
    }

    if (body.success !== true) {
      breaker.recordSuccess(now);

      return {
        ok: false,
        reason: "rejected",
        detail: redactTruncate(
          `Turnstile token rejected (error codes: ${
            (body["error-codes"] ?? []).join(", ") || "none"
          }).`,
          secrets
        ),
        retryable: false
      };
    }

    // Cloudflare says the token is valid — now enforce OUR expectations. A
    // token that is technically valid but solved for a different hostname or
    // action, or too old, is a client/attacker problem (not a provider
    // outage), so the breaker records a success. Each rejection logs only its
    // structured reason — never the token, hostname, or action values.
    if (expectations.hostname && body.hostname !== expectations.hostname) {
      breaker.recordSuccess(now);
      log("warning", "turnstile.verification_rejected", {
        reason: "hostname_mismatch"
      });

      return {
        ok: false,
        reason: "hostname_mismatch",
        detail: "Turnstile hostname did not match the expected hostname.",
        retryable: false
      };
    }

    if (body.action !== expectations.action) {
      breaker.recordSuccess(now);
      log("warning", "turnstile.verification_rejected", {
        reason: "action_mismatch"
      });

      return {
        ok: false,
        reason: "action_mismatch",
        detail: "Turnstile action did not match the expected action.",
        retryable: false
      };
    }

    if (
      expectations.maxTokenAgeSec !== undefined &&
      !isFreshChallenge(body.challenge_ts, now, expectations.maxTokenAgeSec)
    ) {
      breaker.recordSuccess(now);
      log("warning", "turnstile.verification_rejected", { reason: "stale" });

      return {
        ok: false,
        reason: "stale",
        detail: "Turnstile challenge timestamp is missing or too old.",
        retryable: false
      };
    }

    breaker.recordSuccess(now);
    return { ok: true };
  } catch (error) {
    breaker.recordFailure(now);
    const message = error instanceof Error ? error.message : String(error);
    log("warning", "turnstile.provider_call_errored", {
      error: redactTruncate(message, secrets)
    });

    return {
      ok: false,
      reason: "provider_unavailable",
      detail: redactTruncate(message, secrets),
      retryable: true
    };
  } finally {
    clearTimeout(timer);
  }
}

export function isTurnstileEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env.TURNSTILE_ENABLED === "true";
}

/**
 * The single boolean every gated surface checks — true ONLY when BOTH the
 * full-online deployment-profile gate is active AND this feature's own flag is
 * set. On a LAN/offline profile (or with the flag off) it is false, and no
 * widget renders, no CSP origin opens, and no outbound verification call is
 * made. This is what makes "TURNSTILE_ENABLED=true but LAN profile" resolve to
 * fully OFF, exactly as the issue requires.
 */
export function isTurnstileRequired(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return isFullOnlineSecurityActive(env) && isTurnstileEnabled(env);
}

function resolvePositiveIntEnv(
  raw: string | undefined,
  fallback: number
): number {
  const value = Number(raw);

  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function resolveTurnstileTimeoutMs(
  env: NodeJS.ProcessEnv = process.env
): number {
  return resolvePositiveIntEnv(
    env.TURNSTILE_VERIFY_TIMEOUT_MS,
    DEFAULT_TIMEOUT_MS
  );
}

export function resolveTurnstileMaxTokenAgeSec(
  env: NodeJS.ProcessEnv = process.env
): number {
  return resolvePositiveIntEnv(
    env.TURNSTILE_MAX_TOKEN_AGE_SEC,
    DEFAULT_MAX_TOKEN_AGE_SEC
  );
}

export function resolveTurnstileMaxResponseBytes(
  env: NodeJS.ProcessEnv = process.env
): number {
  return resolvePositiveIntEnv(
    env.TURNSTILE_MAX_RESPONSE_BYTES,
    DEFAULT_MAX_RESPONSE_BYTES
  );
}

/**
 * The public site key for the widget, or `null` when unset. Read by
 * `login.astro`'s frontmatter ONLY when `isTurnstileRequired()` is already
 * true, so a disabled/LAN deployment never renders a `data-sitekey`.
 */
export function resolveTurnstileSiteKey(
  env: NodeJS.ProcessEnv = process.env
): string | null {
  const siteKey = env.TURNSTILE_SITE_KEY?.trim();

  return siteKey ? siteKey : null;
}

/**
 * Builds the fetch-bound `TurnstileConfig` from env. Returns `null` if the
 * secret key is missing — callers MUST treat `null` as "cannot verify" and fail
 * closed (reject), never as "skip verification", since `isTurnstileRequired`
 * already said this deployment wants Turnstile enforced.
 */
export function resolveTurnstileConfig(
  env: NodeJS.ProcessEnv = process.env
): TurnstileConfig | null {
  const secretKey = env.TURNSTILE_SECRET_KEY?.trim();

  if (!secretKey) {
    return null;
  }

  return {
    secretKey,
    timeoutMs: resolveTurnstileTimeoutMs(env),
    maxResponseBytes: resolveTurnstileMaxResponseBytes(env)
  };
}

export type TurnstileEnforcementResult =
  | { ok: true }
  | { ok: false; code: "TURNSTILE_REQUIRED" | "TURNSTILE_INVALID" };

export type EnforceTurnstileOptions = {
  /** The per-endpoint action the token must match (see `LOGIN_TURNSTILE_ACTION`/`SETUP_TURNSTILE_ACTION`). */
  action: string;
  env?: NodeJS.ProcessEnv;
  now?: Date;
};

/**
 * The one function every gated endpoint calls — consolidates the "skip if not
 * required / reject if missing / reject if misconfigured / verify and reject if
 * invalid" branching so it isn't duplicated per route. `turnstileToken` is
 * deliberately typed `unknown`: it comes straight from an untrusted parsed JSON
 * request body.
 *
 * Fail-closed contract (issue's non-negotiable): on the full-online profile
 * that requires Turnstile, a missing token, a misconfigured deployment, a
 * provider outage/timeout, a malformed response, or a hostname/action/freshness
 * mismatch ALL deny. Every verification failure collapses to the single generic
 * `TURNSTILE_INVALID` code so an unauthenticated caller can never distinguish
 * "server misconfigured" from "token bad" from "hostname wrong" — no oracle.
 */
export async function enforceTurnstileIfRequired(
  turnstileToken: unknown,
  remoteIp: string | undefined,
  options: EnforceTurnstileOptions
): Promise<TurnstileEnforcementResult> {
  const env = options.env ?? process.env;

  if (!isTurnstileRequired(env)) {
    return { ok: true };
  }

  if (typeof turnstileToken !== "string" || turnstileToken.length === 0) {
    return { ok: false, code: "TURNSTILE_REQUIRED" };
  }

  const config = resolveTurnstileConfig(env);
  const expectedHostname = env.TURNSTILE_EXPECTED_HOSTNAME?.trim();

  // Misconfigured (enabled but no secret / no expected hostname): fail closed
  // rather than silently skipping verification or skipping the hostname check.
  // Reusing TURNSTILE_INVALID (not a distinct code) avoids telling an
  // unauthenticated caller that the server is misconfigured.
  if (!config || !expectedHostname) {
    log("warning", "turnstile.misconfigured");
    return { ok: false, code: "TURNSTILE_INVALID" };
  }

  const result = await verifyTurnstileToken(
    turnstileToken,
    config,
    {
      action: options.action,
      hostname: expectedHostname,
      maxTokenAgeSec: resolveTurnstileMaxTokenAgeSec(env),
      now: options.now
    },
    remoteIp
  );

  if (!result.ok) {
    return { ok: false, code: "TURNSTILE_INVALID" };
  }

  return { ok: true };
}
