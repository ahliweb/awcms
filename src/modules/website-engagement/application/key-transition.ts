/**
 * Observability of the Issue #1262 key-ring transition (ADR-0137 section 2:
 * a key is dropped only when a read-only query over the stored key ids shows no
 * row left on it). Counts and key ids only; a key id is a short label, never key
 * material, and no value, hash or ciphertext leaves the database.
 *
 * Read by `security:readiness`, per tenant, inside that tenant's RLS context.
 */
import { withTenantOrThrow } from "../../../lib/database/tenant-context";

/**
 * Live source tokens per hash key id. A revoked or deleted source can never be
 * accepted again, so its stored hash keeps no key alive and is not counted.
 */
export async function countSourceTokensByKeyId(
  sql: Bun.SQL,
  tenantId: string
): Promise<Record<string, number>> {
  return withTenantOrThrow(
    sql,
    tenantId,
    async (tx) => {
      const rows = (await tx`
        SELECT CASE WHEN token_hash ~ '^[a-z0-9]{1,8}:' THEN split_part(token_hash, ':', 1) ELSE '?' END AS key_id,
               count(*)::int AS rows
        FROM awcms_engagement_sources
        WHERE tenant_id = ${tenantId}
          AND status <> 'revoked'
          AND deleted_at IS NULL
        GROUP BY 1
      `) as { key_id: string; rows: number }[];

      return Object.fromEntries(rows.map((row) => [row.key_id, row.rows]));
    },
    { workClass: "maintenance" }
  );
}

/** Stored contact ciphertexts per encryption key id (a withdrawn row has none). */
export async function countSubmissionContactsByKeyId(
  sql: Bun.SQL,
  tenantId: string
): Promise<Record<string, number>> {
  return withTenantOrThrow(
    sql,
    tenantId,
    async (tx) => {
      const rows = (await tx`
        SELECT CASE WHEN contact_encrypted ~ '^v2:[a-z0-9]{1,8}:' THEN split_part(contact_encrypted, ':', 2) ELSE '?' END AS key_id,
               count(*)::int AS rows
        FROM awcms_engagement_submissions
        WHERE tenant_id = ${tenantId}
          AND contact_encrypted IS NOT NULL
        GROUP BY 1
      `) as { key_id: string; rows: number }[];

      return Object.fromEntries(rows.map((row) => [row.key_id, row.rows]));
    },
    { workClass: "maintenance" }
  );
}
