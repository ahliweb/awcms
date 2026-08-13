/**
 * Authentication-time lookup for machine credentials (ADR-0049).
 *
 * Deliberately mirrors `session-lookup.ts`: one query on
 * `(tenant_id, token_hash)`, every liveness rule evaluated in JS against the
 * row, and `null` for EVERY failure mode. A caller cannot tell "no such
 * credential" from "revoked" from "expired" — the same anti-oracle posture the
 * session path already has.
 */
export type ActiveMachineCredential = {
  id: string;
  tenantId: string;
  tenantUserId: string;
  allowedPermissionKeys: readonly string[];
  /**
   * ADR-0092 — the WRITE class narrowing list. Empty for every credential
   * issued before the class existed, which is the safe reading: empty means
   * read-only.
   */
  allowedWriteActions: readonly string[];
  /** ADR-0092 — required (by `sql/121`) whenever the list above is non-empty. */
  allowedIpCidrs: readonly string[];
};

/**
 * How stale `last_used_at` may get before the next authenticated request
 * refreshes it. Usage visibility is worth one conditional UPDATE per hour per
 * credential; it is NOT worth a write on every read request (ADR-0049 §5).
 */
const LAST_USED_REFRESH_MS = 60 * 60 * 1000;

export async function resolveActiveMachineCredential(
  tx: Bun.SQL,
  tenantId: string,
  tokenHash: string,
  now: Date
): Promise<ActiveMachineCredential | null> {
  const rows = (await tx`
    SELECT id, tenant_id, tenant_user_id, allowed_permission_keys,
           allowed_write_actions, allowed_ip_cidrs,
           expires_at, revoked_at, last_used_at
    FROM awcms_machine_credentials
    WHERE tenant_id = ${tenantId} AND token_hash = ${tokenHash}
  `) as {
    id: string;
    tenant_id: string;
    tenant_user_id: string;
    allowed_permission_keys: string[];
    allowed_write_actions: string[];
    allowed_ip_cidrs: string[];
    expires_at: Date;
    revoked_at: Date | null;
    last_used_at: Date | null;
  }[];

  const credential = rows[0];

  if (!credential) return null;
  if (credential.revoked_at) return null;
  if (new Date(credential.expires_at).getTime() <= now.getTime()) return null;

  const lastUsed = credential.last_used_at
    ? new Date(credential.last_used_at).getTime()
    : null;

  if (lastUsed === null || now.getTime() - lastUsed >= LAST_USED_REFRESH_MS) {
    // Conditional in SQL as well as in JS: two concurrent requests on the same
    // credential must not both write, and the row must not be updated by a
    // request whose `now` is older than one already recorded.
    await tx`
      UPDATE awcms_machine_credentials
      SET last_used_at = ${now}, updated_at = now()
      WHERE tenant_id = ${tenantId}
        AND id = ${credential.id}
        AND (last_used_at IS NULL OR last_used_at < ${new Date(now.getTime() - LAST_USED_REFRESH_MS)})
    `;
  }

  return {
    id: credential.id,
    tenantId: credential.tenant_id,
    tenantUserId: credential.tenant_user_id,
    allowedPermissionKeys: credential.allowed_permission_keys,
    allowedWriteActions: credential.allowed_write_actions,
    allowedIpCidrs: credential.allowed_ip_cidrs
  };
}
