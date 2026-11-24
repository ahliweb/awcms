/**
 * Public-form CHALLENGE (captcha) provider contract (Issue #1353, ADR-0164's
 * descriptor-declared model).
 *
 * Pure types, deliberately in `_shared`: a module declares a provider in its
 * OWN `module.ts` (`ModuleDescriptor.publicFormChallengeProviders`); the seam
 * (`src/lib/security/public-form-challenge.ts`) reads the composed module list
 * through the extension-point source a composition root installed. The
 * platform ships no widget and no arithmetic puzzle of its own; the only
 * provider in the repository is the existing Cloudflare Turnstile adapter
 * (`identity-access`).
 *
 * TRUSTED CODE-ONLY METADATA, like every descriptor type: declared by reviewed
 * source, never tenant/request-controlled, never database-driven.
 */

/** The wire field contract every provider shares. All optional strings: which ones a provider reads is its own business. */
export type PublicFormChallengeFields = {
  challengeId?: string;
  challengeAnswer?: string;
  challengeToken?: string;
};

/** What `issue` returns to the client. Opaque to the seam beyond being JSON-serialisable. */
export type PublicFormChallenge = {
  challengeId?: string;
  /** Provider-defined, e.g. the arithmetic prompt or a site key. NEVER the answer. */
  prompt?: string;
  expiresAt?: string;
};

export type PublicFormChallengeVerifyInput = PublicFormChallengeFields & {
  /** The token the client presented: `challengeToken`, or the provider's declared legacy alias. May be empty (a provider can verify by `challengeId` + `challengeAnswer`). */
  token: string;
  /** The form the token must have been issued for. A provider MUST refuse a token issued for another form. */
  formName: string;
  /** The tenant the token must have been issued for, or `null` for a form with no tenant (platform setup, tenant-less login). A provider MUST refuse a token issued for another tenant. */
  tenantId: string | null;
  remoteIp?: string;
  /**
   * The hostname the token must have been solved on, when the FORM (not the
   * deployment) decides it: a per-source public intake verifies against the
   * verified Origin host of THAT request (Issue #1477). Absent: the provider's
   * own deployment-wide value applies. A provider that ignores it must still
   * fail closed.
   */
  expectedHostname?: string;
  env: NodeJS.ProcessEnv;
};

export type PublicFormChallengeVerifyResult =
  { ok: true } | { ok: false; reason: string };

export type PublicFormChallengeRefusalText = {
  requiredCode?: string;
  invalidCode?: string;
  requiredMessage?: string;
  invalidMessage?: string;
};

export type ModulePublicFormChallengeProvider = {
  /** Globally unique `snake_case` key. Durable: a log field, never shown to a caller. */
  key: string;
  description: string;
  /**
   * Whether this provider is switched ON in `env`. OFF by default: a provider
   * that is declared but not enabled is invisible, so a deployment that sets
   * nothing behaves exactly as before. More than ONE enabled provider is a
   * configuration error and the seam refuses (fail-closed), never "picks one".
   */
  isEnabled(env: NodeJS.ProcessEnv): boolean;
  /** `issue(formName, tenant) -> challenge`. Reached through `issuePublicFormChallenge`, never by `enforcePublicFormCaptcha`. */
  issue(
    formName: string,
    tenantId: string | null
  ): Promise<PublicFormChallenge>;
  /**
   * `verify(token, formName, tenant) -> ok | refused(reason)`.
   *
   * CONTRACT: bound to `formName` AND `tenantId`, SINGLE-USE at the source of
   * truth (the seam also burns a presented token per process as defence in
   * depth, which cannot span processes), and it must REFUSE rather than throw
   * where it can; if it throws or times out the seam refuses anyway.
   */
  verify(
    input: PublicFormChallengeVerifyInput
  ): Promise<PublicFormChallengeVerifyResult>;
  /** Wire name of an older single-token field the provider's shipped clients still send (Turnstile: `turnstileToken`). Read only when `challengeToken` is absent. */
  legacyTokenField?: string;
  /** Per-provider refusal code/message, for a provider whose codes are an already-published contract (Turnstile: ADR-0029). Defaults: `CHALLENGE_REQUIRED` / `CHALLENGE_INVALID`. */
  refusal?: PublicFormChallengeRefusalText;
};
