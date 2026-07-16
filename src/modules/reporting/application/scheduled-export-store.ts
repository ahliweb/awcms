/**
 * Scheduled export config store (Issue #753) —
 * `awcms_reporting_scheduled_exports`. A tenant-scoped, soft-deletable
 * config resource (AGENTS.md rule 13) — no hard delete; `disableScheduled
 * Export` both flips `enabled = false` AND soft-deletes (a disabled
 * schedule is retired, not paused, in this issue's minimal scope — see
 * `reporting/README.md` §Scheduled exports for why re-enabling requires
 * creating a new config rather than an `enable` endpoint).
 */
export type ScheduledExportFormat = "csv" | "json";

export type ScheduledExportRow = {
  id: string;
  projectionKey: string;
  format: ScheduledExportFormat;
  scheduleIntervalMinutes: number;
  enabled: boolean;
  filter: Record<string, unknown>;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type ScheduledExportDbRow = {
  id: string;
  projection_key: string;
  format: ScheduledExportFormat;
  schedule_interval_minutes: number;
  enabled: boolean;
  filter: Record<string, unknown>;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
};

function toRow(row: ScheduledExportDbRow): ScheduledExportRow {
  return {
    id: row.id,
    projectionKey: row.projection_key,
    format: row.format,
    scheduleIntervalMinutes: row.schedule_interval_minutes,
    enabled: row.enabled,
    filter: row.filter,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function createScheduledExport(
  tx: Bun.SQL,
  tenantId: string,
  input: {
    projectionKey: string;
    format: ScheduledExportFormat;
    scheduleIntervalMinutes: number;
    filter: Record<string, unknown>;
    createdBy: string | null;
  }
): Promise<ScheduledExportRow> {
  const rows = (await tx`
    INSERT INTO awcms_reporting_scheduled_exports
      (tenant_id, projection_key, format, schedule_interval_minutes, filter, created_by)
    VALUES (
      ${tenantId}, ${input.projectionKey}, ${input.format},
      ${input.scheduleIntervalMinutes}, ${input.filter}::jsonb, ${input.createdBy}
    )
    RETURNING id, projection_key, format, schedule_interval_minutes, enabled, filter, created_by, created_at, updated_at
  `) as ScheduledExportDbRow[];

  return toRow(rows[0]!);
}

export async function listScheduledExports(
  tx: Bun.SQL,
  tenantId: string,
  projectionKey?: string
): Promise<ScheduledExportRow[]> {
  const rows = (await tx`
    SELECT id, projection_key, format, schedule_interval_minutes, enabled, filter, created_by, created_at, updated_at
    FROM awcms_reporting_scheduled_exports
    WHERE tenant_id = ${tenantId} AND deleted_at IS NULL
      AND (${projectionKey ?? null}::text IS NULL OR projection_key = ${projectionKey ?? null})
    ORDER BY created_at DESC
    LIMIT 200
  `) as ScheduledExportDbRow[];

  return rows.map(toRow);
}

export async function getScheduledExport(
  tx: Bun.SQL,
  tenantId: string,
  id: string
): Promise<ScheduledExportRow | null> {
  const rows = (await tx`
    SELECT id, projection_key, format, schedule_interval_minutes, enabled, filter, created_by, created_at, updated_at
    FROM awcms_reporting_scheduled_exports
    WHERE tenant_id = ${tenantId} AND id = ${id} AND deleted_at IS NULL
  `) as ScheduledExportDbRow[];

  return rows[0] ? toRow(rows[0]) : null;
}

/** Every ENABLED, non-soft-deleted config across every tenant, for the scheduled dispatch job — the caller iterates tenants and calls this per-tenant (via `withTenant`), same convention every other scheduled job in this repo already uses. */
export async function listDueScheduledExports(
  tx: Bun.SQL,
  tenantId: string,
  now: Date
): Promise<ScheduledExportRow[]> {
  const rows = (await tx`
    SELECT se.id, se.projection_key, se.format, se.schedule_interval_minutes, se.enabled,
      se.filter, se.created_by, se.created_at, se.updated_at
    FROM awcms_reporting_scheduled_exports se
    WHERE se.tenant_id = ${tenantId} AND se.enabled = true AND se.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM awcms_reporting_export_runs er
        WHERE er.tenant_id = se.tenant_id AND er.scheduled_export_id = se.id
          AND er.created_at > ${now} - make_interval(mins => se.schedule_interval_minutes)
      )
  `) as ScheduledExportDbRow[];

  return rows.map(toRow);
}

export async function disableScheduledExport(
  tx: Bun.SQL,
  tenantId: string,
  id: string,
  actorTenantUserId: string,
  reason: string
): Promise<boolean> {
  const rows = (await tx`
    UPDATE awcms_reporting_scheduled_exports
    SET enabled = false, deleted_at = now(), deleted_by = ${actorTenantUserId}, delete_reason = ${reason}, updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${id} AND deleted_at IS NULL
    RETURNING id
  `) as { id: string }[];

  return rows.length > 0;
}
