/**
 * Theme preview session data access (Issue #269, ADR-0029 §6) over
 * `awcms_theming_preview_sessions` (RLS FORCE'd). Stores only the SHA-256
 * HASH of the raw preview token; the raw token lives only in the URL handed to
 * the authorized operator. Every query is tenant-scoped (`withTenant` + RLS),
 * so a preview session created for tenant A is unreachable on tenant B.
 */

export type PreviewSessionRecord = {
  id: string;
  versionId: string;
  expiresAt: Date;
};

/** Create a short-lived preview session for a draft version. Returns the row (the raw token stays with the caller). */
export async function createPreviewSession(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  versionId: string,
  tokenHash: string,
  expiresAt: Date
): Promise<PreviewSessionRecord> {
  const rows = (await tx`
    INSERT INTO awcms_theming_preview_sessions
      (tenant_id, token_hash, version_id, created_by, expires_at)
    VALUES (${tenantId}, ${tokenHash}, ${versionId}, ${actorTenantUserId}, ${expiresAt})
    RETURNING id, version_id, expires_at
  `) as { id: string; version_id: string; expires_at: Date }[];
  const row = rows[0]!;
  return { id: row.id, versionId: row.version_id, expiresAt: row.expires_at };
}

/**
 * Look up a preview session by its token hash within a tenant transaction. The
 * caller has already opened `withTenant(tenantId)` from the tenant id embedded in
 * the URL token, so RLS guarantees a hash that belongs to a different tenant
 * returns nothing here — the hash is not enough on its own to cross tenants.
 * Returns the session only if it has NOT expired.
 */
export async function findActivePreviewSession(
  tx: Bun.SQL,
  tokenHash: string,
  now: Date
): Promise<PreviewSessionRecord | null> {
  const rows = (await tx`
    SELECT id, version_id, expires_at
    FROM awcms_theming_preview_sessions
    WHERE token_hash = ${tokenHash} AND expires_at >= ${now}
  `) as { id: string; version_id: string; expires_at: Date }[];
  const row = rows[0];
  if (!row) return null;
  return { id: row.id, versionId: row.version_id, expiresAt: row.expires_at };
}
