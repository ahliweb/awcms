/**
 * The tenant switch and the merge-undo window (Issue #1166, ADR-0153 section 1
 * and O4). A tenant that never wrote a row is OFF.
 */
type Sql = Bun.SQL;

export type CrmLeadsSettings = {
  enabled: boolean;
  mergeUndoHours: number;
  updatedAt: string | null;
};

const DEFAULT_SETTINGS: CrmLeadsSettings = {
  enabled: false,
  mergeUndoHours: 168,
  updatedAt: null
};

export async function fetchSettings(
  tx: Sql,
  tenantId: string
): Promise<CrmLeadsSettings> {
  const rows = (await tx`
    SELECT enabled, merge_undo_hours, updated_at
    FROM awcms_crm_leads_settings
    WHERE tenant_id = ${tenantId}
  `) as { enabled: boolean; merge_undo_hours: number; updated_at: Date }[];
  const row = rows[0];

  return row
    ? {
        enabled: row.enabled,
        mergeUndoHours: Number(row.merge_undo_hours),
        updatedAt: row.updated_at.toISOString()
      }
    : DEFAULT_SETTINGS;
}

export async function updateSettings(
  tx: Sql,
  tenantId: string,
  actor: string,
  patch: { enabled?: boolean; mergeUndoHours?: number }
): Promise<{ previous: CrmLeadsSettings; current: CrmLeadsSettings }> {
  const previous = await fetchSettings(tx, tenantId);
  const enabled = patch.enabled ?? previous.enabled;
  const mergeUndoHours = patch.mergeUndoHours ?? previous.mergeUndoHours;

  await tx`
    INSERT INTO awcms_crm_leads_settings
      (tenant_id, enabled, merge_undo_hours, updated_at, updated_by)
    VALUES (${tenantId}, ${enabled}, ${mergeUndoHours}, now(), ${actor})
    ON CONFLICT (tenant_id) DO UPDATE
      SET enabled = EXCLUDED.enabled,
          merge_undo_hours = EXCLUDED.merge_undo_hours,
          updated_at = now(),
          updated_by = EXCLUDED.updated_by
  `;

  return { previous, current: await fetchSettings(tx, tenantId) };
}
