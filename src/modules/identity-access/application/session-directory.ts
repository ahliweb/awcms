/**
 * A person's own sessions — list and revoke (Gelombang 2 of #423).
 *
 * Both functions resolve the caller from the SESSION TOKEN HASH and act only on
 * rows belonging to the identity behind it. No `tenantUserId` is accepted, and
 * no caller can name one: that is what makes these endpoints self-service
 * rather than an unguarded admin surface with a friendly name.
 */

/** What a person may see about their own session. Never a token, never a raw IP or User-Agent. */
export type OwnSessionSummary = {
  id: string;
  issuedAt: string;
  expiresAt: string;
  assuranceLevel: string;
  originAuth: string;
  /** Keyed pseudonym, or `null` when the deployment has no stable key (`sql/100`). */
  clientIpHash: string | null;
  userAgentSummary: string | null;
  /** True for the session this request is authenticated by. */
  current: boolean;
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
 * Resolves the calling session's identity, or `null` when the token names no
 * live session.
 *
 * Returned as `null` rather than thrown so the route answers with the same
 * `401` it uses for a missing bearer — an endpoint that distinguished "expired"
 * from "unknown" would be a probe for session state.
 */
async function resolveCallerIdentity(
  tx: Bun.SQL,
  tenantId: string,
  tokenHash: string,
  now: Date
): Promise<string | null> {
  const rows = (await tx`
    SELECT identity_id FROM awcms_sessions
    WHERE tenant_id = ${tenantId}
      AND token_hash = ${tokenHash}
      AND revoked_at IS NULL
      AND expires_at > ${now}
  `) as { identity_id: string }[];

  return rows[0]?.identity_id ?? null;
}

/** Live sessions for the caller's own identity, newest first. `null` when the caller has none. */
export async function listOwnSessions(
  tx: Bun.SQL,
  tenantId: string,
  tokenHash: string,
  now: Date
): Promise<OwnSessionSummary[] | null> {
  const identityId = await resolveCallerIdentity(tx, tenantId, tokenHash, now);

  if (!identityId) return null;

  const rows = (await tx`
    SELECT id, token_hash, issued_at, expires_at, assurance_level, origin_auth,
           client_ip_hash, user_agent_summary
    FROM awcms_sessions
    WHERE tenant_id = ${tenantId}
      AND identity_id = ${identityId}
      AND revoked_at IS NULL
      AND expires_at > ${now}
    ORDER BY issued_at DESC
  `) as SessionRow[];

  return rows.map((row) => ({
    id: row.id,
    issuedAt: row.issued_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
    assuranceLevel: row.assurance_level,
    originAuth: row.origin_auth,
    clientIpHash: row.client_ip_hash,
    userAgentSummary: row.user_agent_summary,
    // Compared here rather than returned as a hash: the token hash never leaves
    // this function, and a client that received it could replay it.
    current: row.token_hash === tokenHash
  }));
}

export type RevokeOwnSessionOutcome =
  | { outcome: "revoked" }
  /** Unknown id, someone else's session, already revoked, expired — one answer for all four. */
  | { outcome: "not_found" }
  /** Ending the session you are using is `POST /auth/logout`'s job. */
  | { outcome: "is_current" }
  | { outcome: "unauthenticated" };

/**
 * Revokes one of the caller's own sessions.
 *
 * The ownership test lives in the `WHERE` clause, not in a preceding `SELECT`
 * followed by a JS comparison: a check-then-act pair leaves a window, and more
 * importantly it tends to grow a branch that reports WHY it refused. Every
 * refusal here is one `not_found`, so the endpoint cannot be used to discover
 * whether a session id exists in another tenant or belongs to another person.
 *
 * The current session is refused separately and on purpose. Revoking it through
 * this route would leave the caller holding a dead cookie with no logout
 * bookkeeping — `POST /auth/logout` exists and does the rest.
 */
export async function revokeOwnSession(
  tx: Bun.SQL,
  tenantId: string,
  tokenHash: string,
  sessionId: string,
  now: Date
): Promise<RevokeOwnSessionOutcome> {
  const identityId = await resolveCallerIdentity(tx, tenantId, tokenHash, now);

  if (!identityId) return { outcome: "unauthenticated" };

  const current = (await tx`
    SELECT 1 FROM awcms_sessions
    WHERE tenant_id = ${tenantId} AND id = ${sessionId} AND token_hash = ${tokenHash}
  `) as unknown[];

  if (current.length > 0) return { outcome: "is_current" };

  const revoked = (await tx`
    UPDATE awcms_sessions
    SET revoked_at = ${now}
    WHERE tenant_id = ${tenantId}
      AND id = ${sessionId}
      AND identity_id = ${identityId}
      AND revoked_at IS NULL
      AND expires_at > ${now}
    RETURNING id
  `) as { id: string }[];

  return revoked.length > 0 ? { outcome: "revoked" } : { outcome: "not_found" };
}
