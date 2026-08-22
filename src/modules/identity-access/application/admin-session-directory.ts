/**
 * Somebody ELSE's sessions — list and revoke (Gelombang 2 PR 2.2 of #423).
 *
 * The self-service pair in `session-directory.ts` resolves its subject from the
 * calling token and can be pointed at nobody else. These two do the opposite:
 * the subject is named in the URL, so they are guarded, audited, and split
 * across two permissions.
 *
 * ## Why `read` and `revoke` are separate permissions
 *
 * The same argument `sql/083` recorded for machine credentials, with the sides
 * swapped — and the swap is the interesting part. There, `create` was the
 * consequential one and `read` the cheap one. Here, **`read` is the sensitive
 * one**: a list of where a colleague is signed in, from which device shape, at
 * what hour, is surveillance material, and it stays surveillance material when
 * the reader is an administrator. `revoke` is the incident control — it destroys
 * access rather than disclosing anything.
 *
 * So the split buys the direction that matters during an incident: a responder
 * can be granted the ability to sign a suspected-compromised account out of
 * everywhere **without** being granted a window into everyone's movements. A
 * single permission covering both would make the safe emergency action cost the
 * unsafe standing one.
 *
 * ## Why a new activity rather than `access_control`
 *
 * `access_control` seeds `read`/`assign`/`configure` — the RBAC catalog. Folding
 * session inspection into it would make every role editor an observer of where
 * their colleagues are signed in, by side effect, with no seed migration saying
 * so. `sql/075` and `sql/083` recorded the same reasoning for
 * `registration_requests` and `machine_credentials`.
 */

/**
 * One live session of a named tenant user. Carries no token, no token hash, no
 * raw IP and no raw `User-Agent` — the same exclusions the self-service view
 * makes, for the same reason: none of them is needed to decide "end that one".
 */
import { sessionCredentialCurrent } from "./session-credential-epoch";

export type TenantUserSessionSummary = {
  id: string;
  issuedAt: string;
  expiresAt: string;
  assuranceLevel: string;
  originAuth: string;
  /** Keyed pseudonym, or `null` when the deployment has no stable key (`sql/100`). */
  clientIpHash: string | null;
  userAgentSummary: string | null;
  /**
   * True only when the row IS the session making this request — which can only
   * happen when an administrator points the endpoint at their own tenant user.
   * For anybody else's sessions it is always false.
   */
  isCallerSession: boolean;
};

type SessionRow = {
  id: string;
  token_hash: string;
  issued_at: Date;
  expires_at: Date;
  assurance_level: string;
  origin_auth: string;
  client_ip_hash: string | null;
  user_agent_summary: string | null;
};

/**
 * Resolves a tenant user id to the identity behind it, or `null` when this
 * tenant has no such user.
 *
 * `awcms_sessions` keys on `identity_id` and the admin surface names a
 * `tenant_user_id`, so the hop is unavoidable. It is also the membership check:
 * an identity that is not a user of this tenant produces no row, so the caller
 * cannot reach a session by naming an identity that merely exists elsewhere.
 * FORCE RLS already confines both tables to the current tenant; the explicit
 * `tenant_id =` predicate is the same belt-and-braces every other query here
 * carries.
 */
async function resolveIdentityForTenantUser(
  tx: Bun.SQL,
  tenantId: string,
  tenantUserId: string
): Promise<string | null> {
  const rows = (await tx`
    SELECT identity_id FROM awcms_tenant_users
    WHERE tenant_id = ${tenantId} AND id = ${tenantUserId}
  `) as { identity_id: string }[];

  return rows[0]?.identity_id ?? null;
}

export type ListTenantUserSessionsResult =
  | { outcome: "not_found" }
  | { outcome: "ok"; sessions: TenantUserSessionSummary[] };

/**
 * Live sessions of one tenant user, newest first.
 *
 * A deactivated tenant user is listed, not hidden. `setTenantUserStatus` already
 * revokes their sessions, so the expected answer is an empty array — and an
 * operator checking that deactivation actually took effect needs to see the
 * empty array rather than a 404 that could equally mean "wrong id".
 */
export async function listSessionsForTenantUser(
  tx: Bun.SQL,
  tenantId: string,
  tenantUserId: string,
  callerTokenHash: string,
  now: Date
): Promise<ListTenantUserSessionsResult> {
  const identityId = await resolveIdentityForTenantUser(
    tx,
    tenantId,
    tenantUserId
  );

  if (!identityId) return { outcome: "not_found" };

  const rows = (await tx`
    SELECT s.id, s.token_hash, s.issued_at, s.expires_at, s.assurance_level,
           s.origin_auth, s.client_ip_hash, s.user_agent_summary
    FROM awcms_sessions s
    WHERE s.tenant_id = ${tenantId}
      AND s.identity_id = ${identityId}
      AND s.revoked_at IS NULL
      AND s.expires_at > ${now}
      AND ${sessionCredentialCurrent(tx)}
    ORDER BY s.issued_at DESC
  `) as SessionRow[];

  return {
    outcome: "ok",
    sessions: rows.map((row) => ({
      id: row.id,
      issuedAt: row.issued_at.toISOString(),
      expiresAt: row.expires_at.toISOString(),
      assuranceLevel: row.assurance_level,
      originAuth: row.origin_auth,
      clientIpHash: row.client_ip_hash,
      userAgentSummary: row.user_agent_summary,
      // Compared here, never returned: the token hash does not leave this
      // function, because a client that received one could replay it.
      isCallerSession: row.token_hash === callerTokenHash
    }))
  };
}

export type RevokeTenantUserSessionsResult =
  | { outcome: "not_found" }
  | {
      outcome: "revoked";
      revokedCount: number;
      /**
       * True when the target was the caller's own tenant user and their current
       * session was therefore left alive. Reported rather than silent: an
       * operator told "revoked 3" who still has a working console needs to know
       * why, or they will conclude the control does not work.
       */
      keptCallerSession: boolean;
    };

/**
 * Ends every live session of one tenant user — except the one making the call.
 *
 * ## Why the caller's own session survives
 *
 * The exclusion is `token_hash <> callerTokenHash`, and for every target other
 * than the caller's own tenant user it matches nothing: the caller's token hash
 * cannot appear among another identity's sessions. So it costs nothing in the
 * normal case and buys one property in the abnormal one — an administrator
 * cleaning up after an incident cannot log themselves out of the console they
 * are cleaning up from, mid-incident, by clicking the row that happens to be
 * their own.
 *
 * It is not a hole: signing yourself out everywhere is
 * `DELETE /api/v1/auth/sessions/{id}` and `POST /api/v1/auth/logout`, neither of
 * which needs a permission. This endpoint declines to be the third way to do a
 * thing two unprivileged endpoints already do, in the one arrangement where
 * doing it is an accident.
 *
 * ## Already-revoked rows keep their first revocation instant
 *
 * `AND revoked_at IS NULL`, exactly as `revokeAllSessionsForIdentity` does:
 * restamping a row that was revoked an hour ago would move the only timestamp an
 * investigation has for when access actually ended.
 */
export async function revokeSessionsForTenantUser(
  tx: Bun.SQL,
  tenantId: string,
  tenantUserId: string,
  callerTokenHash: string,
  now: Date
): Promise<RevokeTenantUserSessionsResult> {
  const identityId = await resolveIdentityForTenantUser(
    tx,
    tenantId,
    tenantUserId
  );

  if (!identityId) return { outcome: "not_found" };

  // Asked BEFORE the update, because after it the row is still live (it is the
  // one row the update excludes) but the question "was it in scope" is easier to
  // answer wrongly by inspecting the result set.
  const callerRows = (await tx`
    SELECT 1 FROM awcms_sessions s
    WHERE s.tenant_id = ${tenantId}
      AND s.identity_id = ${identityId}
      AND s.token_hash = ${callerTokenHash}
      AND s.revoked_at IS NULL
      AND s.expires_at > ${now}
      AND ${sessionCredentialCurrent(tx)}
  `) as unknown[];

  const revoked = (await tx`
    UPDATE awcms_sessions
    SET revoked_at = ${now}
    WHERE tenant_id = ${tenantId}
      AND identity_id = ${identityId}
      AND token_hash <> ${callerTokenHash}
      AND revoked_at IS NULL
      AND expires_at > ${now}
    RETURNING id
  `) as { id: string }[];

  return {
    outcome: "revoked",
    revokedCount: revoked.length,
    keptCallerSession: callerRows.length > 0
  };
}
