/**
 * Web-only verifier bindings of the public-form challenge seam (Issue #1353).
 *
 * Imported (for its side effect) by `public-form-challenge.ts`, so every process
 * that can enforce a challenge has these bound, and no job's import closure does:
 * a job reaches `listModules()` and the light provider descriptors, never this
 * file, so a web-only secret read here (`TURNSTILE_SECRET_KEY`, via
 * `turnstile.ts`) stays out of job containers. See
 * `_shared/public-form-challenge-verifier-slot.ts`.
 *
 * A provider with NO web-only secret does not belong here: it implements `verify`
 * in its own descriptor.
 */
import { bindPublicFormChallengeVerifier } from "../../modules/_shared/public-form-challenge-verifier-slot";
import { TURNSTILE_CHALLENGE_PROVIDER_KEY } from "../../modules/identity-access/infrastructure/turnstile-challenge-provider";
import {
  enforceTurnstileIfRequired,
  resolveTurnstileSiteKey
} from "./turnstile";

bindPublicFormChallengeVerifier(TURNSTILE_CHALLENGE_PROVIDER_KEY, {
  async issue() {
    // Turnstile's widget is rendered by Cloudflare's script from the public
    // site key; there is no server-issued challenge to hand out.
    const siteKey = resolveTurnstileSiteKey();

    return siteKey ? { prompt: siteKey } : {};
  },
  async verify(input) {
    const result = await enforceTurnstileIfRequired(
      input.token,
      input.remoteIp,
      { action: input.formName, env: input.env }
    );

    return result.ok ? { ok: true } : { ok: false, reason: "rejected" };
  }
});
