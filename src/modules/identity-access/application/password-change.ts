/**
 * A person changing their OWN password while signed in (Gelombang 2 PR 2.4 of
 * #423).
 *
 * The reset flow (`password-reset.ts`) exists for someone who cannot sign in and
 * proves control of the mailbox instead. This one is the opposite situation:
 * they are signed in and prove control of the CREDENTIAL. Both end with the
 * password replaced and stray sessions gone; what differs is what was proven and
 * therefore what may be believed afterwards.
 *
 * ## Step-up is required only when the person HAS a second factor
 *
 * The program plan said "step-up aal2 + old password". Shipping the aal2 half
 * unconditionally would have been the ADR-0141 §4 trap wearing different
 * clothes: `requireStepUp` denies any session that is not currently `aal2`, and
 * a person with no enrolled factor can never reach `aal2` — so every user
 * without MFA would be permanently unable to change their password, and the
 * ones most likely to need to are the ones who just learned it leaked.
 *
 * So the rule is conditional and each half carries its own weight: the current
 * password is the re-authentication for everyone, and a fresh second factor is
 * additionally required from anyone who has one. Nobody is ever asked for less
 * than they can supply, and nobody is asked for something they cannot.
 *
 * ## The current password is checked by THE shared verifier (#1035)
 *
 * Since ADR-0086 the live credential belongs to the PRINCIPAL (the person); an
 * identity's own `password_hash` is a per-tenant copy that goes stale as soon as
 * the password is changed from another tenant. This function used to verify
 * against that copy, so after Alice changed her password in tenant A, anyone
 * holding a tenant-B session and her OLD password could "change" it in B and
 * take the account in every tenant. It now calls `verifyCurrentPassword`
 * (`current-password.ts`), which applies the login rule - the principal's
 * credential once promoted, the identity's hash only until then - checks the
 * principal lockout first, and counts a wrong password toward it.
 *
 * ## What a change WRITES, and who survives it
 *
 * One source of truth: the principal credential, via `setPrincipalCredential`
 * (which also clears the lockout and bumps `credential_epoch`, ending every
 * session of the person in EVERY tenant). The current tenant's identity copy is
 * still written so the legacy fallback is never left holding the old,
 * possibly-leaked hash; other tenants' copies cannot be reached from here (FORCE
 * RLS) and do not need to be, because once a principal holds a credential no
 * reader consults an identity copy (see ADR-0141 section 8).
 *
 * Sessions: the other sessions in this tenant are revoked FIRST (while the
 * caller is still recognisable, so the count is real), then the epoch bump ends
 * the person's sessions everywhere else, then the caller's own session is
 * re-stamped with the new epoch so the person who proved the old password is
 * not signed out of the tab they changed it in.
 *
 * ## Order inside the function
 *
 * Step-up is evaluated BEFORE the argon2id verification. It is far cheaper, and
 * it keeps a stale-step-up refusal from also being an answer about whether the
 * submitted `currentPassword` was right.
 */
import { setPrincipalCredential } from "./principal-store";
import { hashPassword } from "../../../lib/auth/password";
import { verifyCurrentPassword } from "./current-password";
import { getMfaStatus } from "./mfa";
import { requireStepUp } from "./mfa-session-assurance";
import {
  restampOwnSessionAfterCredentialChange,
  revokeOtherOwnSessions
} from "./session-directory";
import { sessionCredentialCurrent } from "./session-credential-epoch";
import { isPasswordLoginDisabledForIdentity } from "./tenant-auth-policy";

export type ChangeOwnPasswordResult =
  | { outcome: "changed"; identityId: string; revokedSessionCount: number }
  /** The bearer names no live session. */
  | { outcome: "unauthenticated" }
  /** MFA is enrolled and this session is not currently stepped up. */
  | { outcome: "step_up_required" }
  /** The tenant policy says this identity signs in by SSO; there is no password to change. */
  | { outcome: "password_login_disabled" }
  /** `currentPassword` did not match (counted toward the principal lockout). */
  | { outcome: "invalid_credentials"; identityId: string }
  /** The person is locked out by failed password attempts; nothing was verified. */
  | { outcome: "locked"; identityId: string };

/**
 * Replaces the caller's password.
 *
 * On success it also clears `failed_login_count` / `locked_until`, exactly as
 * the reset path does and for the same reason: whoever submitted the current
 * password proved control of the credential, which is a stronger signal than the
 * failed-attempt counter that locked it. An attacker who could reach this branch
 * already knows the password, so the lockout was protecting nothing from them.
 *
 * Other sessions are revoked; the CALLING one survives. A password change that
 * signs you out of the tab you changed it in reads as a failure, and the
 * security property is unaffected — a thief's session is among the ones that
 * die.
 */
export async function changeOwnPassword(
  tx: Bun.SQL,
  tenantId: string,
  tokenHash: string,
  input: { currentPassword: string; newPassword: string },
  now: Date
): Promise<ChangeOwnPasswordResult> {
  const sessionRows = (await tx`
    SELECT s.identity_id FROM awcms_sessions s
    WHERE s.tenant_id = ${tenantId}
      AND s.token_hash = ${tokenHash}
      AND s.revoked_at IS NULL
      AND s.expires_at > ${now}
      AND ${sessionCredentialCurrent(tx)}
  `) as { identity_id: string }[];
  const identityId = sessionRows[0]?.identity_id;

  if (!identityId) return { outcome: "unauthenticated" };

  const mfa = await getMfaStatus(tx, tenantId, identityId);

  if (mfa.enabled) {
    // The `denied` Response it builds is discarded on purpose: the wire shape of
    // a refusal belongs to the route, and returning one from here would put a
    // second response-builder inside the application layer.
    const stepUp = await requireStepUp(tx, tenantId, tokenHash, now);

    if (!stepUp.ok) return { outcome: "step_up_required" };
  }

  // Re-checked here rather than trusted from login time: the tenant may have
  // switched to SSO-only since this session was issued, and the whole point of
  // that policy is that a password cannot be used to get in. Writing a new one
  // would be writing a credential the policy says must not work.
  if (await isPasswordLoginDisabledForIdentity(tx, tenantId, identityId)) {
    return { outcome: "password_login_disabled" };
  }

  const verified = await verifyCurrentPassword(tx, {
    tenantId,
    identityId,
    password: input.currentPassword,
    now
  });

  // A live session whose identity is gone or deactivated, or that has nothing to
  // verify against: reported as unauthenticated, not as a bad password. The
  // session is what stopped being valid.
  if (verified.outcome === "no_credential")
    return { outcome: "unauthenticated" };
  if (verified.outcome === "locked") return { outcome: "locked", identityId };
  if (verified.outcome === "invalid") {
    return { outcome: "invalid_credentials", identityId };
  }

  const principalId = verified.principalId;
  const newPasswordHash = await hashPassword(input.newPassword);

  await tx`
    UPDATE awcms_identities
    SET password_hash = ${newPasswordHash},
        failed_login_count = 0,
        locked_until = NULL,
        updated_at = ${now}
    WHERE tenant_id = ${tenantId} AND id = ${identityId}
  `;

  // Others in THIS tenant first, while the caller is still a live session; the
  // epoch bump below then ends the person's sessions in every other tenant.
  const revocation = await revokeOtherOwnSessions(tx, tenantId, tokenHash, now);

  // ADR-0086 - the live credential and the live lockout are on the principal.
  if (principalId) {
    await setPrincipalCredential(tx, principalId, newPasswordHash);

    // The bump just made the caller's own session stale; it proved the old
    // password a moment ago, so it keeps working.
    await restampOwnSessionAfterCredentialChange(
      tx,
      tenantId,
      identityId,
      tokenHash
    );
  }

  return {
    outcome: "changed",
    identityId,
    revokedSessionCount:
      revocation.outcome === "revoked" ? revocation.revokedCount : 0
  };
}
