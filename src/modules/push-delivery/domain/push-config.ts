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
 * `"fcm"` and `"web_push"` are the real adapters and land in Issue #466.
 * Naming them here now would let `PUSH_PROVIDER=fcm` pass validation and then
 * fail at resolve time, so they are deliberately absent until they exist.
 */
export const KNOWN_PUSH_PROVIDERS = ["log"] as const;

export type PushProviderKind = (typeof KNOWN_PUSH_PROVIDERS)[number];

export function isKnownPushProvider(
  value: string | undefined
): value is PushProviderKind {
  return (KNOWN_PUSH_PROVIDERS as readonly string[]).includes(value ?? "");
}

export const DEFAULT_PUSH_SEND_MAX_RETRIES = 3;

/**
 * There is deliberately no `PUSH_SEND_TIMEOUT_MS` resolver yet. A send timeout
 * is meaningful only to an adapter that makes a network call, and the only
 * adapter today is `log`. Shipping the knob now would put a variable in
 * `.env.example` that an operator can set and that changes nothing — the kind
 * of configuration that teaches people their settings are decorative. It lands
 * with the first real adapter (#466).
 */
export function isPushEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PUSH_ENABLED === "true";
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
