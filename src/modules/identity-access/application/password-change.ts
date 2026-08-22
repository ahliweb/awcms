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
 * unconditionally would have been the ADR-0058 §E trap wearing different
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
 * ## Order inside the function
 *
 * Step-up is evaluated BEFORE the argon2id verification. It is far cheaper, and
 * it keeps a stale-step-up refusal from also being an answer about whether the
 * submitted `currentPassword` was right.
 */
import { setPrincipalCredential } from "./principal-store";
import { hashPassword, verifyPassword } from "../../../lib/auth/password";
import { getMfaStatus } from "./mfa";
import { requireStepUp } from "./mfa-session-assurance";
import { revokeOtherOwnSessions } from "./session-directory";
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
  /** `currentPassword` did not match. */
  | { outcome: "invalid_credentials" };

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

  const identityRows = (await tx`
    SELECT password_hash, principal_id FROM awcms_identities
    WHERE tenant_id = ${tenantId} AND id = ${identityId} AND status = 'active'
  `) as { password_hash: string; principal_id: string | null }[];
  const passwordHash = identityRows[0]?.password_hash;
  const principalId = identityRows[0]?.principal_id ?? null;

  // A live session whose identity is gone or deactivated: reported as
  // unauthenticated, not as a bad password. The session is what stopped being
  // valid.
  if (!passwordHash) return { outcome: "unauthenticated" };

  if (!(await verifyPassword(input.currentPassword, passwordHash))) {
    return { outcome: "invalid_credentials" };
  }

  const newPasswordHash = await hashPassword(input.newPassword);

  await tx`
    UPDATE awcms_identities
    SET password_hash = ${newPasswordHash},
        failed_login_count = 0,
        locked_until = NULL,
        updated_at = ${now}
    WHERE tenant_id = ${tenantId} AND id = ${identityId}
  `;

  // ADR-0086 — same obligation as the reset path: the live credential and the
  // live lockout are on the principal, and changing one without the other
  // produces an account whose new password does not work.
  //
  // `principal_id` rides along on the SELECT that already ran rather than
  // costing a second round trip. That is not only cheaper: a fresh query here
  // was the first shape written, and it moved a test's revoked-session count
  // from 2 to 0 — the extra statement shifted what the surrounding code saw.
  // Reading the column that is already being fetched cannot do that.
  if (principalId) {
    await setPrincipalCredential(tx, principalId, newPasswordHash);
  }

  const revocation = await revokeOtherOwnSessions(tx, tenantId, tokenHash, now);

  return {
    outcome: "changed",
    identityId,
    revokedSessionCount:
      revocation.outcome === "revoked" ? revocation.revokedCount : 0
  };
}
