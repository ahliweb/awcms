/**
 * Suppression list read/write (Issue #499, epic #492). The table itself
 * (`awcms_email_suppression_list`) and its `suppression.{read,create,
 * delete}` permissions were seeded back in migration 020 (Issue #494) for
 * `announcement-directory.ts` (#497) and the dispatcher (#495) to *read*
 * from — this is the first code that *writes* to it via an admin surface.
 * Never stores or returns a raw recipient address: only `recipient_hash`
 * (lookup key, `hashIdentifierValue`) and `recipient_masked` (display only,
 * `maskIdentifierValue`) — same pattern the announcement directory's own read
 * path already relies on.
 */
import {
  hashIdentifierValue,
  maskIdentifierValue,
  normalizeIdentifierValue
} from "../../profile-identity/domain/identifier";
import type { SuppressionReason } from "../domain/suppression-validation";

export type SuppressionEntry = {
  id: string;
  recipientMasked: string;
  reason: SuppressionReason;
  createdBy: string | null;
  createdAt: string;
};

type SuppressionRow = {
  id: string;
  recipient_masked: string;
  reason: SuppressionReason;
  created_by: string | null;
  created_at: Date;
};

function toView(row: SuppressionRow): SuppressionEntry {
  return {
    id: row.id,
    recipientMasked: row.recipient_masked,
    reason: row.reason,
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString()
  };
}

/** Used by the dispatcher (`email-dispatch.ts`) to skip a claimed row whose recipient was suppressed after enqueue, and by `announcement-directory.ts` to exclude recipients at enqueue time. */
export async function fetchSuppressedRecipientHashes(
  tx: Bun.SQL,
  tenantId: string
): Promise<Set<string>> {
  const rows = (await tx`
    SELECT recipient_hash FROM awcms_email_suppression_list
    WHERE tenant_id = ${tenantId}
  `) as { recipient_hash: string }[];

  return new Set(rows.map((row) => row.recipient_hash));
}

/** `LIMIT 100`, newest first — same bounded-list convention as `listEmailTemplates` (low-cardinality admin data, no pagination cursor needed). */
export async function listSuppressions(
  tx: Bun.SQL,
  tenantId: string
): Promise<SuppressionEntry[]> {
  const rows = (await tx`
    SELECT id, recipient_masked, reason, created_by, created_at
    FROM awcms_email_suppression_list
    WHERE tenant_id = ${tenantId}
    ORDER BY created_at DESC
    LIMIT 100
  `) as SuppressionRow[];

  return rows.map(toView);
}

export type CreateSuppressionResult =
  | { outcome: "created"; entry: SuppressionEntry }
  | { outcome: "already_suppressed" };

export async function createSuppression(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  recipient: string,
  reason: SuppressionReason
): Promise<CreateSuppressionResult> {
  const normalized = normalizeIdentifierValue("email", recipient);
  const recipientHash = hashIdentifierValue(normalized);
  const recipientMasked = maskIdentifierValue(normalized);

  const rows = (await tx`
    INSERT INTO awcms_email_suppression_list
      (tenant_id, recipient_hash, recipient_masked, reason, created_by)
    VALUES (${tenantId}, ${recipientHash}, ${recipientMasked}, ${reason}, ${actorTenantUserId})
    ON CONFLICT (tenant_id, recipient_hash) DO NOTHING
    RETURNING id, recipient_masked, reason, created_by, created_at
  `) as SuppressionRow[];

  if (rows.length === 0) {
    return { outcome: "already_suppressed" };
  }

  return { outcome: "created", entry: toView(rows[0]!) };
}

export async function deleteSuppression(
  tx: Bun.SQL,
  tenantId: string,
  id: string
): Promise<SuppressionEntry | null> {
  const rows = (await tx`
    DELETE FROM awcms_email_suppression_list
    WHERE tenant_id = ${tenantId} AND id = ${id}
    RETURNING id, recipient_masked, reason, created_by, created_at
  `) as SuppressionRow[];

  return rows[0] ? toView(rows[0]) : null;
}
