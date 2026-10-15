/**
 * The `requiresMfaEnrolment` gate at the authorization chokepoint (ADR-0141,
 * finding PS-13). The decision itself is pure and lives in
 * `domain/mfa-required-permissions.ts`; this file fetches the one fact it needs
 * — whether the acting person has an active factor — and only when it needs it.
 *
 * ## Cost
 *
 * A `Set` membership test, and nothing else, for every request whose permission
 * is not flagged. A flagged request costs the two keyed reads `getMfaStatus`
 * already makes (identity → principal, principal → active factor), and
 * deliberately NOT a cached read: enrolment is a property that a self-service
 * disable or an administrative reset changes mid-session, and a memoised "yes"
 * would keep authorising a payroll action for exactly the person who has just
 * lost their factor. `authorization-read-cache.ts` memoises principal-scoped
 * inputs, and this is not one of them.
 *
 * ## Fail-closed
 *
 * A machine credential never reaches the factor read — it is refused on the
 * `viaMachineCredential` fact alone, because a service account can be linked to
 * an identity that happens to have a factor and "enrolled" would then be true
 * of a request in which nobody presented one.
 */
import { isMfaFeatureEnabled } from "../../../lib/auth/mfa-config";
import type { TenantContext } from "../domain/access-control";
import {
  evaluateMfaEnrolmentRequirement,
  isMfaRequiredPermissionKey,
  type MfaEnrolmentVerdict
} from "../domain/mfa-required-permissions";
import { getMfaStatus } from "./mfa";

export type MfaEnrolmentGateOptions = {
  /**
   * Extra flagged keys, UNIONED with the composed registry — never a
   * replacement for it, so it can add enforcement and can never narrow it. A
   * test injects a fixture set so enforcement is exercised without editing a
   * shipped module.
   */
  requiredKeys?: ReadonlySet<string>;
  /** The request is authenticated by a machine credential. */
  viaMachineCredential: boolean;
};

/**
 * Returns the refusal for an ALLOWED decision on `permissionKeyValue`, or `null`
 * when the request may stand. Call it only after the ordinary decision allowed;
 * it can only add a refusal, never remove one.
 */
export async function checkMfaEnrolmentRequirement(
  tx: Bun.SQL,
  tenantId: string,
  context: Pick<TenantContext, "identityId">,
  permissionKeyValue: string,
  options: MfaEnrolmentGateOptions
): Promise<Extract<MfaEnrolmentVerdict, { outcome: "refused" }> | null> {
  // ADDITIVE ONLY: the registry decides, and an injected set can only ADD keys
  // to it. A seam that replaced the registry could be passed `new Set()` by any
  // caller and silently switch the requirement off for everything (audit F-5).
  const required =
    isMfaRequiredPermissionKey(permissionKeyValue) ||
    options.requiredKeys?.has(permissionKeyValue) === true;

  // The short-circuit that keeps the chokepoint free for everything else.
  if (!required) return null;

  // A machine credential is refused on this fact alone; skip the read.
  const enrolled = options.viaMachineCredential
    ? false
    : (await getMfaStatus(tx, tenantId, context.identityId)).enabled;

  const verdict = evaluateMfaEnrolmentRequirement({
    required,
    viaMachineCredential: options.viaMachineCredential,
    enrolled,
    enrolmentAvailable: isMfaFeatureEnabled()
  });

  return verdict.outcome === "refused" ? verdict : null;
}
