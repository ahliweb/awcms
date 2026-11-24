/**
 * Cloudflare Turnstile as the FIRST provider behind the public-form challenge
 * seam (Issue #1353; the adapter itself is Issue #186 / ADR-0029).
 *
 * The seam (`src/lib/security/public-form-challenge.ts`) owns presence checks,
 * single-use burning, the deadline and the uniform refusal. This DESCRIPTOR is
 * deliberately LIGHT: it must not import `lib/security/turnstile.ts`, because
 * `listModules()` is imported by dozens of jobs and that file reads
 * `TURNSTILE_SECRET_KEY`, a web-only secret (`tests/jobs-env-scoped-reach.test.ts`
 * part c). `verify`/`issue` therefore resolve their implementation from the
 * verifier slot, which `lib/security/public-form-challenge-bindings.ts` fills in
 * the web process (see `_shared/public-form-challenge-verifier-slot.ts`).
 *
 * It keeps the already published wire contract: the `turnstileToken` field
 * (still accepted next to `challengeToken`) and the `TURNSTILE_REQUIRED` /
 * `TURNSTILE_INVALID` codes.
 *
 * Binding: the form name IS the Turnstile `action` (Cloudflare echoes the action
 * the widget was solved for and the adapter rejects a mismatch), and the
 * hostname is pinned by `TURNSTILE_EXPECTED_HOSTNAME`. Turnstile has no tenant
 * concept, so tenant binding is the deployment's host; the seam still hands the
 * tenant to `verify`.
 */
import { isFullOnlineSecurityActive } from "../../../lib/auth/online-security-config";
import { requirePublicFormChallengeVerifier } from "../../_shared/public-form-challenge-verifier-slot";
import type { ModulePublicFormChallengeProvider } from "../../_shared/public-form-challenge-contract";

export const TURNSTILE_CHALLENGE_PROVIDER_KEY = "cloudflare_turnstile";

/**
 * Restated from `lib/security/turnstile.ts` (`TURNSTILE_ORIGIN`) for the same
 * reason as `isTurnstileChallengeEnabled`: importing that file would drag
 * `TURNSTILE_SECRET_KEY` into every job's import closure.
 * `tests/public-form-challenge.test.ts` pins the two together.
 */
export const TURNSTILE_WIDGET_ORIGIN = "https://challenges.cloudflare.com";
export const TURNSTILE_WIDGET_SCRIPT_SRC = `${TURNSTILE_WIDGET_ORIGIN}/turnstile/v0/api.js`;

/**
 * The same predicate as `isTurnstileRequired` in `lib/security/turnstile.ts`,
 * restated here so this descriptor does not import that file;
 * `tests/public-form-challenge.test.ts` pins the two together over every
 * combination of the two flags.
 */
export function isTurnstileChallengeEnabled(env: NodeJS.ProcessEnv): boolean {
  return isFullOnlineSecurityActive(env) && env.TURNSTILE_ENABLED === "true";
}

export const turnstileChallengeProvider: ModulePublicFormChallengeProvider = {
  key: TURNSTILE_CHALLENGE_PROVIDER_KEY,
  description:
    "Cloudflare Turnstile bot challenge (ADR-0029). On only when the full-online profile gate and TURNSTILE_ENABLED=true are both set.",
  isEnabled: isTurnstileChallengeEnabled,
  issue: (formName, tenantId) =>
    requirePublicFormChallengeVerifier(TURNSTILE_CHALLENGE_PROVIDER_KEY).issue(
      formName,
      tenantId
    ),
  verify: (input) =>
    requirePublicFormChallengeVerifier(TURNSTILE_CHALLENGE_PROVIDER_KEY).verify(
      input
    ),
  // The widget every page renders for this provider. The site key is PUBLIC
  // (`issue` returns it as `prompt`); the form name is the Turnstile `action`.
  widget: {
    scriptSrc: TURNSTILE_WIDGET_SCRIPT_SRC,
    cspOrigins: [TURNSTILE_WIDGET_ORIGIN],
    containerClass: "cf-turnstile",
    attributes: ({ formName, challenge }) =>
      challenge.prompt
        ? { "data-sitekey": challenge.prompt, "data-action": formName }
        : null
  },
  legacyTokenField: "turnstileToken",
  refusal: {
    requiredCode: "TURNSTILE_REQUIRED",
    invalidCode: "TURNSTILE_INVALID",
    requiredMessage: "Turnstile verification token is required.",
    invalidMessage: "Turnstile verification failed."
  }
};
