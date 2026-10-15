/**
 * Re-authentication required before a SESSION may begin TOTP enrolment
 * (#1004, audit finding F-3 of #977; ADR-0141 addendum).
 *
 * ## The hole this closes
 *
 * `enroll/start` used to need only a live session. A session is a bearer
 * credential that outlives the moment it proved anything, so whoever held one
 * for an account without a second factor could enrol THEIR OWN authenticator and
 * from then on pass every conditional step-up as that account. The gate of
 * ADR-0141 proves a factor EXISTS, not that the account's owner holds it, so
 * enrolment is the one place where "who is acting" has to be re-established
 * rather than inherited from the session.
 *
 * ## What counts as re-authentication
 *
 * - A password session: the CURRENT PASSWORD, presented in the request and
 *   verified by the shared login rule (`current-password.ts`: the principal's
 *   credential once promoted, else the identity hash), so a password changed
 *   from another tenant is the one that counts. A session-only attacker (a
 *   stolen cookie or token) does not have it.
 * - An SSO session whose person works in NO other tenant: there is no password
 *   to present and the identity provider already authenticated this person, so
 *   the proof is FRESHNESS — the session was minted by the IdP within
 *   {@link SSO_REENROLL_FRESHNESS_SEC}.
 * - An SSO session whose person has an identity in another tenant: the factor
 *   is PRINCIPAL-global (ADR-0087) and ADR-0088 rejects one tenant's IdP
 *   vouching for a person across tenants, so freshness is NOT enough; the
 *   principal's password is required like any other session. If password login
 *   is disabled for the identity there is nothing to present and the answer is
 *   `reauthentication_required`, resolved by an administrator (reset MFA flow /
 *   a password sign-in in a tenant that allows it) - never by trusting the IdP.
 * - An identity the tenant has taken off password login, on a stale session:
 *   nothing it could type would be honoured, so it is told to sign in again
 *   through the provider (`reauthentication_required`).
 *
 * ## What it does NOT close (recorded, not hidden)
 *
 * An attacker who KNOWS the password signs in and presents it, exactly like the
 * owner. No amount of password re-verification can tell them apart; that case is
 * answered by the out-of-band notice to the account's own mailbox, the critical
 * audit event, and the operational guidance to enrol holders BEFORE enabling a
 * module with flagged permissions (ADR-0141 §5). The enrolment-grant path of a
 * required-MFA tenant is in the same position, for the same reason.
 *
 * Ordering: this runs BEFORE the "already enrolled" check so that a wrong
 * password never learns whether the account has a factor.
 */
import { verifyCurrentPassword } from "./current-password";
import { resolveSessionAssurance } from "./mfa-session-assurance";
import { principalHasOtherTenantIdentity } from "./principal-tenant-reach";
import { isPasswordLoginDisabledForIdentity } from "./tenant-auth-policy";

/** How recently an SSO session must have been minted to stand in for a password. */
export const SSO_REENROLL_FRESHNESS_SEC = 300;

export type EnrollmentReauthResult =
  /** Re-authentication holds. `identityId` is the session's identity. */
  | { outcome: "ok"; identityId: string; method: "password" | "sso_fresh" }
  /** The bearer names no live session. */
  | { outcome: "unauthenticated" }
  /** A session that did not present `currentPassword` and has no exemption. */
  | { outcome: "password_required"; identityId: string }
  /** `currentPassword` did not match (counted toward the principal lockout). */
  | { outcome: "invalid_credentials"; identityId: string }
  /** The principal is locked out; nothing was verified. */
  | { outcome: "locked"; identityId: string }
  /** No password can be presented and no exemption applies: sign in again / ask an administrator. */
  | { outcome: "reauthentication_required"; identityId: string };

export async function reauthenticateForEnrollment(
  tx: Bun.SQL,
  tenantId: string,
  tokenHash: string,
  currentPassword: string | null,
  now: Date
): Promise<EnrollmentReauthResult> {
  const session = await resolveSessionAssurance(tx, tenantId, tokenHash, now);

  if (!session) return { outcome: "unauthenticated" };

  const identityId = session.identityId;

  if (
    session.originAuth === "sso" &&
    session.lastAuthenticatedAt !== null &&
    now.getTime() - session.lastAuthenticatedAt.getTime() <=
      SSO_REENROLL_FRESHNESS_SEC * 1000 &&
    !(await principalHasOtherTenantIdentity(tx, tenantId, identityId))
  ) {
    return { outcome: "ok", identityId, method: "sso_fresh" };
  }

  return reauthenticateByPassword(
    tx,
    tenantId,
    identityId,
    currentPassword,
    now
  );
}

/**
 * Re-authentication for an enrolment grant that was NOT minted by a login that
 * just verified the password - in practice one minted by a tenant switch
 * (#1004 re-audit H-A). There is no session to inspect and no SSO exemption
 * (a switch is refused for SSO-rooted sessions), so the password rule applies
 * on its own: the CURRENT password, or `reauthentication_required` when none
 * can be presented.
 */
export async function reauthenticateGrantForEnrollment(
  tx: Bun.SQL,
  tenantId: string,
  identityId: string,
  currentPassword: string | null,
  now: Date
): Promise<EnrollmentReauthResult> {
  return reauthenticateByPassword(
    tx,
    tenantId,
    identityId,
    currentPassword,
    now
  );
}

async function reauthenticateByPassword(
  tx: Bun.SQL,
  tenantId: string,
  identityId: string,
  currentPassword: string | null,
  now: Date
): Promise<EnrollmentReauthResult> {
  if (await isPasswordLoginDisabledForIdentity(tx, tenantId, identityId)) {
    return { outcome: "reauthentication_required", identityId };
  }

  if (!currentPassword) {
    return { outcome: "password_required", identityId };
  }

  const verified = await verifyCurrentPassword(tx, {
    tenantId,
    identityId,
    password: currentPassword,
    now
  });

  switch (verified.outcome) {
    case "ok":
      return { outcome: "ok", identityId, method: "password" };
    case "locked":
      return { outcome: "locked", identityId };
    case "no_credential":
      // A live session whose identity is gone or deactivated, or an SSO-only
      // account with no password at all: neither is "a wrong password".
      return { outcome: "reauthentication_required", identityId };
    case "invalid":
      return { outcome: "invalid_credentials", identityId };
  }
}
