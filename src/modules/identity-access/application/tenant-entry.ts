/**
 * Entering a tenant as an already-authenticated HUMAN — ADR-0088, Gelombang 7
 * PR 7.4 of Issue #423.
 *
 * Two new surfaces mint a session for somebody whose password was proven
 * somewhere else: `POST /auth/session/tenant` (redeeming a selection token) and
 * `POST /auth/session/switch` (moving a live session to another tenant). Both
 * are a login that is HALF FINISHED, not a key handover, and this module is the
 * other half.
 *
 * ## Why it is shared code rather than a second copy
 *
 * The checks below are the ones `/auth/login` already runs once the tenant is
 * known: tenant serviceability, identity status, the tenant's auth policy, and
 * the tenant's MFA policy. A second implementation of them would be a second
 * chance to omit one — and the omission that matters is invisible from the
 * outside, because a session issued without the MFA gate looks exactly like a
 * session issued with it.
 *
 * The stakes are asymmetric in a way worth stating: tenant B may REQUIRE MFA
 * while tenant A does not. If entering B skipped B's policy because the human
 * proved a password in A, then tenant switching would be an MFA bypass, and it
 * would hurt precisely the tenants with the strictest posture. Since ADR-0087
 * the factor belongs to the human, so B's requirement is satisfied by the
 * authenticator they already carry — the gate costs an honest user nothing.
 *
 * ## What it deliberately does NOT do
 *
 * It does not verify a credential — the caller already did, and the whole point
 * of both surfaces is that the credential is global while the membership is
 * not. It does not mint the session either: the two routes differ in
 * `origin_auth`, cookies, and audit wording, and a helper that owned those
 * would have to grow a flag per caller.
 */
import { fetchGrantedPermissionKeys } from "./auth-context";
import {
  createEnrollmentGrant,
  createMfaChallenge,
  findActiveMfaFactor
} from "./mfa";
import { getTenantMfaPolicy } from "./tenant-mfa-policy";
import { isPasswordLoginDisabledForIdentity } from "./tenant-auth-policy";
import { isSsoEnabled } from "../../../lib/auth/sso-config";
import {
  isPrivilegedFromPermissionKeys,
  resolveMfaRequirement
} from "../domain/mfa-policy";
import {
  isMfaFeatureEnabled,
  resolveChallengeTtlSec
} from "../../../lib/auth/mfa-config";

export type TenantEntryOutcome =
  /** Cleared. The caller mints the session and decides its `origin_auth`. */
  | { ok: true; identityId: string; tenantUserId: string | null }
  /**
   * Refused, and every reason collapses to ONE response at the route.
   *
   * `no_membership` covers "this human has no identity in that tenant", "the
   * identity is not active", and "the tenant user is not active" — kept
   * indistinguishable on purpose. The caller supplies the tenant id, so a
   * response that told them apart would answer "does this person belong to that
   * tenant" for any tenant id an attacker cares to name, from a session they
   * legitimately hold elsewhere. That is the cross-tenant membership oracle
   * ADR-0087 refused to build, arriving through a different door.
   */
  | { ok: false; kind: "no_membership" }
  /** ADR-0073 — a suspended or inactive tenant stops being served. */
  | { ok: false; kind: "tenant_unavailable" }
  /**
   * The target tenant has turned password login off for this identity. Entering
   * it with a password-rooted credential would route around that decision.
   */
  | { ok: false; kind: "password_login_disabled" }
  /** The human holds a factor; the target tenant gets a challenge, not a session. */
  | { ok: false; kind: "mfa_challenge"; token: string; expiresAt: Date }
  /** The target tenant requires MFA and the human has no factor yet. */
  | { ok: false; kind: "mfa_enrollment"; token: string; expiresAt: Date };

/**
 * Runs every gate the target tenant is entitled to apply, in the same order
 * `/auth/login` applies them.
 *
 * MUST be called inside a transaction whose tenant context is the TARGET
 * tenant: every read below is tenant-scoped and RLS is what makes them mean
 * what they say.
 */
export async function evaluateTenantEntry(
  tx: Bun.SQL,
  input: { tenantId: string; principalId: string; now: Date }
): Promise<TenantEntryOutcome> {
  const tenantRows = (await tx`
    SELECT status FROM awcms_tenants WHERE id = ${input.tenantId}
  `) as { status: string }[];

  const tenantStatus = tenantRows[0]?.status ?? null;

  if (tenantStatus !== "active") {
    return { ok: false, kind: "tenant_unavailable" };
  }

  // The membership itself. Keyed on `(tenant_id, principal_id)` — one row by
  // construction, because two identities in ONE tenant normalizing to the same
  // address is exactly the collision `sql/112` refuses to migrate over.
  const identityRows = (await tx`
    SELECT id, status FROM awcms_identities
    WHERE tenant_id = ${input.tenantId} AND principal_id = ${input.principalId}
  `) as { id: string; status: "active" | "inactive" | "locked" }[];

  const identity = identityRows[0];

  if (!identity || identity.status !== "active") {
    return { ok: false, kind: "no_membership" };
  }

  const tenantUserRows = (await tx`
    SELECT id, status FROM awcms_tenant_users
    WHERE tenant_id = ${input.tenantId} AND identity_id = ${identity.id}
  `) as { id: string; status: "active" | "inactive" }[];

  const tenantUser = tenantUserRows[0];

  if (!tenantUser || tenantUser.status !== "active") {
    return { ok: false, kind: "no_membership" };
  }

  // Gated on `isSsoEnabled()` exactly as `/auth/login` gates it: with the
  // feature off the policy table cannot deny anyone, so the query would be a
  // round trip that can only answer "no" — and a deployment that never enables
  // SSO must behave precisely as it did before this ADR.
  if (
    isSsoEnabled() &&
    (await isPasswordLoginDisabledForIdentity(tx, input.tenantId, identity.id))
  ) {
    return { ok: false, kind: "password_login_disabled" };
  }

  // An active factor means a challenge, never a session — the same rule login
  // applies, and since ADR-0087 the factor is the human's own, so entering a
  // second tenant does not mean enrolling a second time.
  const activeFactor = await findActiveMfaFactor(
    tx,
    input.tenantId,
    identity.id
  );

  if (activeFactor) {
    const challenge = await createMfaChallenge(
      tx,
      input.tenantId,
      identity.id,
      resolveChallengeTtlSec(),
      input.now
    );

    return {
      ok: false,
      kind: "mfa_challenge",
      token: challenge.token,
      expiresAt: challenge.expiresAt
    };
  }

  // Target tenant REQUIRES MFA of somebody who has none. Gated on
  // `isMfaFeatureEnabled()` for login's reason: with enrolment disabled the
  // requirement would be unrecoverable rather than fail-closed.
  if (isMfaFeatureEnabled()) {
    const mfaPolicy = await getTenantMfaPolicy(tx, input.tenantId);

    if (mfaPolicy.enforcementLevel !== "optional") {
      const isPrivileged =
        mfaPolicy.enforcementLevel === "required_for_all"
          ? true
          : isPrivilegedFromPermissionKeys(
              await fetchGrantedPermissionKeys(
                tx,
                input.tenantId,
                tenantUser.id
              )
            );

      if (
        resolveMfaRequirement({
          level: mfaPolicy.enforcementLevel,
          isPrivileged
        })
      ) {
        const grant = await createEnrollmentGrant(
          tx,
          input.tenantId,
          identity.id,
          resolveChallengeTtlSec(),
          input.now
        );

        return {
          ok: false,
          kind: "mfa_enrollment",
          token: grant.token,
          expiresAt: grant.expiresAt
        };
      }
    }
  }

  return { ok: true, identityId: identity.id, tenantUserId: tenantUser.id };
}
