/**
 * The tenant's inbox tag catalogue (Issue #1164, ADR-0160): a code and a label,
 * soft-deleted. Deleting a tag unlinks it from every conversation in the same
 * transaction, so no conversation keeps a tag nobody can see in the catalogue.
 */
import { isUniqueViolation } from "./sql-errors";

export type TagView = {
  id: string;
  code: string;
  label: string;
  createdAt: string;
};

type TagRow = { id: string; code: string; label: string; created_at: Date };

const toView = (row: TagRow): TagView => ({
  id: row.id,
  code: row.code,
  label: row.label,
  createdAt: row.created_at.toISOString()
});

/** Bounded: a catalogue is authored by people; 500 is more than any screen shows. */
export async function listTags(
  tx: Bun.SQL,
  tenantId: string
): Promise<TagView[]> {
  const rows = (await tx`
    SELECT id, code, label, created_at FROM awcms_inbox_tags
    WHERE tenant_id = ${tenantId} AND deleted_at IS NULL
    ORDER BY code
    LIMIT 500
  `) as TagRow[];

  return rows.map(toView);
}

export async function createTag(
  tx: Bun.TransactionSQL,
  tenantId: string,
  actorTenantUserId: string,
  input: { code: string; label: string }
): Promise<{ outcome: "created"; tag: TagView } | { outcome: "duplicate" }> {
  try {
    // A savepoint: a duplicate code must not abort the request's transaction.
    const rows = (await tx.savepoint(
      (sp) => sp`
      INSERT INTO awcms_inbox_tags (tenant_id, code, label, created_by)
      VALUES (${tenantId}, ${input.code}, ${input.label}, ${actorTenantUserId})
      RETURNING id, code, label, created_at
    `
    )) as TagRow[];

    return { outcome: "created", tag: toView(rows[0]!) };
  } catch (error) {
    if (isUniqueViolation(error)) return { outcome: "duplicate" };

    throw error;
  }
}

export async function deleteTag(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  id: string
): Promise<
  { outcome: "deleted"; unlinked: number } | { outcome: "not_found" }
> {
  const rows = (await tx`
    UPDATE awcms_inbox_tags
    SET deleted_at = now(), deleted_by = ${actorTenantUserId}, updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${id} AND deleted_at IS NULL
    RETURNING id
  `) as { id: string }[];

  if (rows.length === 0) return { outcome: "not_found" };

  const unlinked = (await tx`
    DELETE FROM awcms_inbox_conversation_tags
    WHERE tenant_id = ${tenantId} AND tag_id = ${id}
    RETURNING conversation_id
  `) as { conversation_id: string }[];

  return { outcome: "deleted", unlinked: unlinked.length };
}
