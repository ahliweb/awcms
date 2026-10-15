/**
 * The ONE implementation of "does this string match the password this person
 * signs in with right now" for a caller who already holds a session (#1004,
 * finding H1; reused by `password-change` in #1035).
 *
 * ## Why a shared function
 *
 * Since ADR-0086 the live credential and the lockout belong to the PRINCIPAL (the
 * person, global), and `awcms_identities.password_hash` is only a per-tenant
 * copy that is stale as soon as the password is changed from another tenant.
 * Login handles that with a rule (`login.ts`): verify against the principal's
 * credential once one has been promoted, and against the identity's own hash
 * only until then. A re-authentication that read the identity hash directly
 * would accept a password the person has already replaced, and refuse the one
 * they now use - the exact "writer moved, readers did not" defect this
 * repository has paid for before. So the rule lives here once.
 *
 * ## Lockout
 *
 * A wrong password is a failed credential guess exactly like a failed login, so
 * it counts toward the same GLOBAL lockout (`recordPrincipalLoginFailure`), and
 * a locked principal is refused before any hash is verified. A caller that must
 * not count (a pure check) passes `countFailure: false`.
 *
 * Success deliberately does NOT clear the counter: proving a password through a
 * session says nothing about the guesses that came before it from elsewhere;
 * only a real sign-in or a reset does (`clearPrincipalLockout`).
 */
import { verifyPassword } from "../../../lib/auth/password";
import { resolveLoginPolicyConfig } from "./login-policy";
import {
  findPrincipalByEmail,
  findPrincipalById,
  loadPrincipalSecret,
  recordPrincipalLoginFailure
} from "./principal-store";

export type CurrentPasswordResult =
  /** The password matches the credential the person signs in with. */
  | { outcome: "ok"; principalId: string | null }
  /** It does not (and, if requested, the failure was counted). */
  | { outcome: "invalid"; principalId: string | null }
  /** The principal is locked out; nothing was verified. */
  | { outcome: "locked"; principalId: string }
  /** No credential exists to verify against, or the identity is gone/inactive. */
  | { outcome: "no_credential" };

export async function verifyCurrentPassword(
  tx: Bun.SQL,
  input: {
    tenantId: string;
    identityId: string;
    password: string;
    now: Date;
    /** Count a wrong password toward the principal lockout. Default true. */
    countFailure?: boolean;
  }
): Promise<CurrentPasswordResult> {
  const rows = (await tx`
    SELECT password_hash, principal_id, login_identifier FROM awcms_identities
    WHERE tenant_id = ${input.tenantId} AND id = ${input.identityId}
      AND status = 'active'
  `) as {
    password_hash: string;
    principal_id: string | null;
    login_identifier: string;
  }[];
  const identity = rows[0];

  if (!identity) return { outcome: "no_credential" };

  // Exactly how `login.ts` finds the person: by ADDRESS, not by the identity's
  // link. An identity that was never linked (ADR-0085's missed-writer case) must
  // still be verified against the credential the person signs in with, or this
  // check and the login would disagree for it (#1004 re-audit L2).
  const principal = identity.principal_id
    ? await findPrincipalById(tx, identity.principal_id)
    : await findPrincipalByEmail(tx, identity.login_identifier);

  if (
    principal?.lockedUntil &&
    new Date(principal.lockedUntil).getTime() > input.now.getTime()
  ) {
    return { outcome: "locked", principalId: principal.id };
  }

  // The login rule: the principal's credential once promoted, else the
  // identity's own hash.
  const credentialHash = principal?.hasCredential
    ? ((await loadPrincipalSecret(tx, principal.id))?.passwordHash ?? undefined)
    : identity.password_hash;

  if (!credentialHash) return { outcome: "no_credential" };

  if (await verifyPassword(input.password, credentialHash)) {
    return { outcome: "ok", principalId: principal?.id ?? null };
  }

  if (principal && input.countFailure !== false) {
    const policy = resolveLoginPolicyConfig();

    await recordPrincipalLoginFailure(
      tx,
      principal.id,
      policy.maxFailedAttempts,
      new Date(input.now.getTime() + policy.lockoutMinutes * 60_000)
    );
  }

  return { outcome: "invalid", principalId: principal?.id ?? null };
}
