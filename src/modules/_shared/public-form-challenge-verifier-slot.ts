/**
 * Late-bound verifier slot for public-form challenge providers (Issue #1353).
 *
 * WHY it exists. A provider is declared in a module DESCRIPTOR, and
 * `listModules()` is imported by dozens of jobs. A provider whose verifier reads
 * a web-only secret (Turnstile's `TURNSTILE_SECRET_KEY`) must not put the file
 * that reads it into those jobs' import closure: `tests/jobs-env-scoped-reach.test.ts`
 * (part c) fails, and the secret would have to be copied into every job
 * container. So such a provider's descriptor is LIGHT (key, `isEnabled`, refusal
 * text) and its `verify`/`issue` look their implementation up here by provider
 * key; the web-only file that holds the implementation installs it on import
 * (`src/lib/security/public-form-challenge-bindings.ts`, imported by the seam,
 * so every process that can enforce a challenge has it).
 *
 * Fail-closed: a provider asked to verify with nothing bound throws, and the
 * seam turns a throw into a refusal. A provider with no web-only secret needs
 * none of this and just implements `verify` in its descriptor.
 */
import type {
  PublicFormChallenge,
  PublicFormChallengeVerifyInput,
  PublicFormChallengeVerifyResult
} from "./public-form-challenge-contract";

export type PublicFormChallengeVerifierBinding = {
  verify(
    input: PublicFormChallengeVerifyInput
  ): Promise<PublicFormChallengeVerifyResult>;
  issue(
    formName: string,
    tenantId: string | null
  ): Promise<PublicFormChallenge>;
};

const bindings = new Map<string, PublicFormChallengeVerifierBinding>();

export function bindPublicFormChallengeVerifier(
  providerKey: string,
  binding: PublicFormChallengeVerifierBinding
): void {
  bindings.set(providerKey, binding);
}

/** Throws when nothing is bound: the caller (a provider's `verify`) is inside the seam's try/catch, which refuses. */
export function requirePublicFormChallengeVerifier(
  providerKey: string
): PublicFormChallengeVerifierBinding {
  const binding = bindings.get(providerKey);

  if (!binding) {
    throw new Error(
      `No verifier is bound for public-form challenge provider "${providerKey}".`
    );
  }

  return binding;
}

/** Test seam only. */
export function unbindPublicFormChallengeVerifierForTests(
  providerKey: string
): void {
  bindings.delete(providerKey);
}
