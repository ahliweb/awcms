/**
 * Export run manifest store (Issue #753) —
 * `awcms_reporting_export_runs`. One row per executed export (manual
 * trigger or scheduled dispatch), carrying the manifest/checksum/expiry
 * evidence the acceptance criteria require ("Scheduled export uses
 * manifest/checksum/expiry and secure tenant-scoped download").
 */
export type ExportRunStatus = "completed" | "failed";
export type ExportRunFormat = "csv" | "json";

export type ExportRunRow = {
  id: string;
  scheduledExportId: string | null;
  projectionKey: string;
  format: ExportRunFormat;
  status: ExportRunStatus;
  rowCount: number;
  checksumSha256: string | null;
  storagePath: string | null;
  errorMessage: string | null;
  expiresAt: Date | null;
  requestedBy: string | null;
  correlationId: string | null;
  createdAt: Date;
  completedAt: Date | null;
};

type ExportRunDbRow = {
  id: string;
  scheduled_export_id: string | null;
  projection_key: string;
  format: ExportRunFormat;
  status: ExportRunStatus;
  row_count: number;
  checksum_sha256: string | null;
  storage_path: string | null;
  error_message: string | null;
  expires_at: Date | null;
  requested_by: string | null;
  correlation_id: string | null;
  created_at: Date;
  completed_at: Date | null;
};

function toRow(row: ExportRunDbRow): ExportRunRow {
  return {
    id: row.id,
    scheduledExportId: row.scheduled_export_id,
    projectionKey: row.projection_key,
    format: row.format,
    status: row.status,
    rowCount: row.row_count,
    checksumSha256: row.checksum_sha256,
    storagePath: row.storage_path,
    errorMessage: row.error_message,
    expiresAt: row.expires_at,
    requestedBy: row.requested_by,
    correlationId: row.correlation_id,
    createdAt: row.created_at,
    completedAt: row.completed_at
  };
}

export async function recordExportRun(
  tx: Bun.SQL,
  tenantId: string,
  input: {
    scheduledExportId: string | null;
    projectionKey: string;
    format: ExportRunFormat;
    status: ExportRunStatus;
    rowCount: number;
    checksumSha256: string | null;
    storagePath: string | null;
    errorMessage: string | null;
    expiresAt: Date | null;
    requestedBy: string | null;
    correlationId?: string | null;
  }
): Promise<ExportRunRow> {
  const rows = (await tx`
    INSERT INTO awcms_reporting_export_runs
      (tenant_id, scheduled_export_id, projection_key, format, status, row_count,
       checksum_sha256, storage_path, error_message, expires_at, requested_by, correlation_id, completed_at)
    VALUES (
      ${tenantId}, ${input.scheduledExportId}, ${input.projectionKey}, ${input.format},
      ${input.status}, ${input.rowCount}, ${input.checksumSha256}, ${input.storagePath},
      ${input.errorMessage}, ${input.expiresAt}, ${input.requestedBy}, ${input.correlationId ?? null}, now()
    )
    RETURNING id, scheduled_export_id, projection_key, format, status, row_count,
      checksum_sha256, storage_path, error_message, expires_at, requested_by, correlation_id,
      created_at, completed_at
  `) as ExportRunDbRow[];

  return toRow(rows[0]!);
}

export async function getExportRun(
  tx: Bun.SQL,
  tenantId: string,
  id: string
): Promise<ExportRunRow | null> {
  const rows = (await tx`
    SELECT id, scheduled_export_id, projection_key, format, status, row_count,
      checksum_sha256, storage_path, error_message, expires_at, requested_by, correlation_id,
      created_at, completed_at
    FROM awcms_reporting_export_runs
    WHERE tenant_id = ${tenantId} AND id = ${id}
  `) as ExportRunDbRow[];

  return rows[0] ? toRow(rows[0]) : null;
}

export async function listExportRuns(
  tx: Bun.SQL,
  tenantId: string,
  projectionKey?: string
): Promise<ExportRunRow[]> {
  const rows = (await tx`
    SELECT id, scheduled_export_id, projection_key, format, status, row_count,
      checksum_sha256, storage_path, error_message, expires_at, requested_by, correlation_id,
      created_at, completed_at
    FROM awcms_reporting_export_runs
    WHERE tenant_id = ${tenantId}
      AND (${projectionKey ?? null}::text IS NULL OR projection_key = ${projectionKey ?? null})
    ORDER BY created_at DESC
    LIMIT 100
  `) as ExportRunDbRow[];

  return rows.map(toRow);
}
