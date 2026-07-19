/**
 * Deployment-profile gate for full-online-only auth hardening (Issue #186,
 * epic ERP-readiness enterprise auth #177). Ported/adapted from awcms-mini
 * `src/lib/auth/online-security-config.ts` (Issue #587).
 *
 * WHY THIS EXISTS IN awcms (unlike MFA #184 / OIDC #185, which dropped it)
 * ----------------------------------------------------------------------
 * MFA and OIDC in this base gate purely on their own feature flag
 * (`AUTH_MFA_ENABLED` / `AUTH_SSO_ENABLED`) — they carry no deployment-profile
 * concept, because those controls are equally desirable on a LAN/offline
 * deployment. Cloudflare Turnstile is the exact opposite: it is a bot-mitigation
 * control that reaches out to Cloudflare, so it MUST be fully inert on any
 * LAN/offline install (no widget, no CSP origin, no outbound call) and active
 * ONLY on a deployment that has deliberately declared itself full-online. That
 * "which deployment profile am I?" decision is what this module models, and it
 * is exactly what Issue #186 asks for ("deployment profile applicability",
 * "fully OFF on LAN/offline").
 *
 * Pure — no `process.env` reads baked in; `scripts/validate-env.ts` and
 * `scripts/security-readiness.ts` both pass in whatever `env` they were given,
 * the same split `mfa-config.ts` / `sso-config.ts` already use for their own
 * conditional config. Local/offline/LAN deployments (the default — this pair of
 * env vars is entirely unset) always get `false` from `isFullOnlineSecurityActive`
 * and never depend on this gate for anything.
 *
 * Deliberately an auth-specific gate, NOT a reuse of `APP_ENV=production`: an
 * offline/LAN deployment can be production-grade operationally without ever
 * wanting an online-only bot challenge (see doc 18 deployment profiles).
 */

export const KNOWN_ONLINE_SECURITY_PROFILES = [
  "disabled",
  "full_online"
] as const;

export type OnlineSecurityProfile =
  (typeof KNOWN_ONLINE_SECURITY_PROFILES)[number];

export function isKnownOnlineSecurityProfile(
  value: string | undefined
): value is OnlineSecurityProfile {
  return (KNOWN_ONLINE_SECURITY_PROFILES as readonly string[]).includes(
    value ?? ""
  );
}

export function isOnlineSecurityEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env.AUTH_ONLINE_SECURITY_ENABLED === "true";
}

/** Falls back to `"disabled"` for an unset or unrecognized value — never throws. */
export function resolveOnlineSecurityProfile(
  env: NodeJS.ProcessEnv = process.env
): OnlineSecurityProfile {
  const raw = env.AUTH_ONLINE_SECURITY_PROFILE;

  return isKnownOnlineSecurityProfile(raw) ? raw : "disabled";
}

/**
 * The single boolean every full-online-only feature (today: Turnstile #186)
 * gates on. True only when BOTH the enable flag is `"true"` AND the profile is
 * exactly `"full_online"` — mirroring `validateEnv`'s own cross-rule that
 * `AUTH_ONLINE_SECURITY_ENABLED=true` requires
 * `AUTH_ONLINE_SECURITY_PROFILE=full_online`, so any deployment that has passed
 * `bun run config:validate` will always have this agree with
 * `isOnlineSecurityEnabled` alone. Checking BOTH here (rather than trusting
 * that validation already ran — `bun run dev`/`start` never runs it) keeps this
 * gate fail-closed even if a deployment somehow skipped that step: a truthy
 * flag with a missing/`"disabled"` profile stays OFF, never accidentally on.
 */
export function isFullOnlineSecurityActive(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return (
    isOnlineSecurityEnabled(env) &&
    resolveOnlineSecurityProfile(env) === "full_online"
  );
}
