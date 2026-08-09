/**
 * Push delivery configuration boundary (Issue #465, epic #463). Pure — no
 * `process.env` reads at module scope; every resolver takes the `env` it is
 * given, the same split `email/domain/email-config.ts` uses.
 *
 * ## Credentials are per-DEPLOYMENT, never per-tenant
 *
 * Both real transports authenticate the SERVER, not the tenant: an FCM service
 * account belongs to one Firebase project, and a VAPID key pair identifies one
 * application server to the push services. Modelling either as tenant
 * configuration would mean tenant A's admin can enter a key that makes this
 * deployment speak as somebody else. There is no per-tenant override and there
 * is not meant to be one.
 *
 * ## Why anything JSON-shaped must arrive base64
 *
 * `scripts/validate-env.ts` parses `.env` LINE BY LINE (its own parser, not a
 * dotenv library), so a multi-line value is silently truncated at the first
 * newline. An FCM service-account JSON is multi-line in its natural form. It
 * therefore arrives base64-encoded — the same shape `isBase32ByteKey` already
 * establishes for binary key material — and the adapter decodes it (Issue
 * #466). Discovering that at deploy time instead of here would cost an outage.
 */

/**
 * `"log"` is the safe local-dev/test adapter: it writes a structured log line
 * and always succeeds. It must still be selected explicitly — it is NOT what
 * happens when `PUSH_ENABLED` is unset. That case never reaches a provider at
 * all, because the dispatcher does not claim a single row (the feature-flag
 * rule `email` already follows: provider off means the provider is never
 * touched).
 *
 * `"fcm"` is the FCM HTTP v1 adapter (Issue #466) — server → Google, for native
 * Android/iOS clients. It costs nothing in the client asset budget and adds no
 * CSP origin, which is why ADR-0074 keeps it while rejecting the FCM Web SDK.
 *
 * `"web_push"` is the VAPID adapter for BROWSERS (Issue #466) — RFC 8030/8291/
 * 8292. It is what ADR-0074 chose instead of the FCM Web SDK: zero client
 * bytes, zero CSP origins, because `PushManager.subscribe()` is a browser API
 * rather than a `fetch` from page script.
 */
export const KNOWN_PUSH_PROVIDERS = ["log", "fcm", "web_push"] as const;

export type PushProviderKind = (typeof KNOWN_PUSH_PROVIDERS)[number];

export function isKnownPushProvider(
  value: string | undefined
): value is PushProviderKind {
  return (KNOWN_PUSH_PROVIDERS as readonly string[]).includes(value ?? "");
}

export const DEFAULT_PUSH_SEND_MAX_RETRIES = 3;

/**
 * The circuit-breaker key BOTH sides must use: the dispatcher, which only
 * READS it (`canAttempt`), and the network adapters, which are the only things
 * that may FEED it (`recordSuccess`/`recordFailure`) — the split
 * `email/infrastructure/mailketing-provider.ts` established.
 *
 * Exported as one constant rather than repeated as a literal in each file,
 * because a mismatch between them is silent in the worst possible way: the
 * dispatcher would consult a breaker nothing ever trips, so it would report
 * `breakerOpen: false` forever and keep hammering a provider that is down.
 * `email` carries the same coupling as two matching literals; they agree today,
 * and nothing would say so if they stopped.
 *
 * There is no recorder yet — the only adapter is `log`, which makes no network
 * call and must NOT record, or a healthy local dev run would be reporting
 * provider health it never observed. The FCM and Web Push adapters (#466) are
 * what make this live, and they import this constant.
 */
export const PUSH_CIRCUIT_BREAKER_KEY = "push-delivery";

export const DEFAULT_PUSH_SEND_TIMEOUT_MS = 10_000;

export function isPushEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PUSH_ENABLED === "true";
}

/**
 * Now that a network adapter exists (#466), this knob does something. It was
 * deliberately absent while `log` was the only adapter — a variable an operator
 * can set that changes nothing teaches people their settings are decorative.
 *
 * The budget is TOTAL wall-clock for the outbound call, including the body
 * read, because that is what `ssrfSafeFetch` enforces. A send can spend it
 * twice in one attempt (token mint, then the FCM call), which is intended: they
 * are two hops that can each hang independently.
 */
export function resolvePushSendTimeoutMs(
  env: NodeJS.ProcessEnv = process.env
): number {
  const configured = env.PUSH_SEND_TIMEOUT_MS?.trim();

  if (!configured) {
    return DEFAULT_PUSH_SEND_TIMEOUT_MS;
  }

  const raw = Number(configured);

  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_PUSH_SEND_TIMEOUT_MS;
}

/**
 * Zero is a legitimate value ("never retry") and must survive, which is why the
 * guard is `>= 0` rather than `> 0`.
 *
 * That makes the empty string dangerous, and it is handled explicitly:
 * `Number("")` is `0`, finite and non-negative, so a bare `PUSH_SEND_MAX_RETRIES=`
 * in a `.env` would read as a deliberate "never retry" instead of as unset.
 * Trimming to empty is treated as absent. This DIVERGES from
 * `resolveEmailSendMaxRetries`, which has the same shape without the guard —
 * copied deliberately except here, rather than inherited by accident.
 */
export function resolvePushSendMaxRetries(
  env: NodeJS.ProcessEnv = process.env
): number {
  const configured = env.PUSH_SEND_MAX_RETRIES?.trim();

  if (!configured) {
    return DEFAULT_PUSH_SEND_MAX_RETRIES;
  }

  const raw = Number(configured);

  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_PUSH_SEND_MAX_RETRIES;
}
