/**
 * Archive manifest store (ported from awcms-micro Issue #745, ADR-0037) —
 * `awcms_data_lifecycle_archive_manifests`. One row per archive artifact
 * written by `infrastructure/local-archive-adapter.ts` (or a future external
 * object-storage adapter): location, row count, cursor range, checksum, schema
 * version, and a restore-procedure reference — the acceptance criterion
 * "Archive artifacts have deterministic manifests and verified checksums;
 * reconciliation/restore is documented and tested" is this table plus the
 * archive port's `verify`.
 */
export type ArchiveManifestRow = {
  id: string;
  descriptorKey: string;
  archivePort: "local_offline" | "external_object_storage";
  artifactLocation: string;
  rowCount: number;
  cursorRangeStart: Date | null;
  cursorRangeEnd: Date | null;
  checksumAlgorithm: "sha256";
  checksumHex: string;
  schemaVersion: string;
  format: "jsonl" | "csv";
  status: "written" | "verified" | "restored" | "deleted";
  restoreProcedureRef: string;
  jobRunId: string | null;
  correlationId: string | null;
  createdAt: Date;
  createdBy: string | null;
  verifiedAt: Date | null;
};

type ManifestDbRow = {
  id: string;
  descriptor_key: string;
  archive_port: "local_offline" | "external_object_storage";
  artifact_location: string;
  row_count: number;
  cursor_range_start: Date | null;
  cursor_range_end: Date | null;
  checksum_algorithm: "sha256";
  checksum_hex: string;
  schema_version: string;
  format: "jsonl" | "csv";
  status: "written" | "verified" | "restored" | "deleted";
  restore_procedure_ref: string;
  job_run_id: string | null;
  correlation_id: string | null;
  created_at: Date;
  created_by: string | null;
  verified_at: Date | null;
};

function toRow(row: ManifestDbRow): ArchiveManifestRow {
  return {
    id: row.id,
    descriptorKey: row.descriptor_key,
    archivePort: row.archive_port,
    artifactLocation: row.artifact_location,
    rowCount: row.row_count,
    cursorRangeStart: row.cursor_range_start,
    cursorRangeEnd: row.cursor_range_end,
    checksumAlgorithm: row.checksum_algorithm,
    checksumHex: row.checksum_hex,
    schemaVersion: row.schema_version,
    format: row.format,
    status: row.status,
    restoreProcedureRef: row.restore_procedure_ref,
    jobRunId: row.job_run_id,
    correlationId: row.correlation_id,
    createdAt: row.created_at,
    createdBy: row.created_by,
    verifiedAt: row.verified_at
  };
}

export type InsertArchiveManifestInput = {
  descriptorKey: string;
  archivePort: "local_offline" | "external_object_storage";
  artifactLocation: string;
  rowCount: number;
  cursorRangeStart: Date | null;
  cursorRangeEnd: Date | null;
  checksumHex: string;
  schemaVersion: string;
  format: "jsonl" | "csv";
  restoreProcedureRef: string;
  jobRunId?: string | null;
  correlationId?: string | null;
  createdBy?: string | null;
};

export async function insertArchiveManifest(
  tx: Bun.SQL,
  tenantId: string,
  input: InsertArchiveManifestInput
): Promise<ArchiveManifestRow> {
  const rows = (await tx`
    INSERT INTO awcms_data_lifecycle_archive_manifests
      (tenant_id, descriptor_key, archive_port, artifact_location, row_count,
       cursor_range_start, cursor_range_end, checksum_algorithm, checksum_hex,
       schema_version, format, status, restore_procedure_ref, job_run_id,
       correlation_id, created_by)
    VALUES (
      ${tenantId}, ${input.descriptorKey}, ${input.archivePort}, ${input.artifactLocation},
      ${input.rowCount}, ${input.cursorRangeStart}, ${input.cursorRangeEnd}, 'sha256',
      ${input.checksumHex}, ${input.schemaVersion}, ${input.format}, 'written',
      ${input.restoreProcedureRef}, ${input.jobRunId ?? null}, ${input.correlationId ?? null},
      ${input.createdBy ?? null}
    )
    RETURNING id, descriptor_key, archive_port, artifact_location, row_count,
      cursor_range_start, cursor_range_end, checksum_algorithm, checksum_hex,
      schema_version, format, status, restore_procedure_ref, job_run_id,
      correlation_id, created_at, created_by, verified_at
  `) as ManifestDbRow[];

  return toRow(rows[0]!);
}

export async function getArchiveManifest(
  tx: Bun.SQL,
  tenantId: string,
  manifestId: string
): Promise<ArchiveManifestRow | null> {
  const rows = (await tx`
    SELECT id, descriptor_key, archive_port, artifact_location, row_count,
      cursor_range_start, cursor_range_end, checksum_algorithm, checksum_hex,
      schema_version, format, status, restore_procedure_ref, job_run_id,
      correlation_id, created_at, created_by, verified_at
    FROM awcms_data_lifecycle_archive_manifests
    WHERE tenant_id = ${tenantId} AND id = ${manifestId}
  `) as ManifestDbRow[];

  return rows[0] ? toRow(rows[0]) : null;
}

export async function markArchiveManifestStatus(
  tx: Bun.SQL,
  tenantId: string,
  manifestId: string,
  status: "verified" | "restored" | "deleted"
): Promise<void> {
  await tx`
    UPDATE awcms_data_lifecycle_archive_manifests
    SET status = ${status},
        verified_at = CASE WHEN ${status} = 'verified' THEN now() ELSE verified_at END
    WHERE tenant_id = ${tenantId} AND id = ${manifestId}
  `;
}

/** The dry-run planner's "already archived through cursor X?" lookup — the highest `cursor_range_end` among this descriptor's non-deleted manifests. `null` means nothing has ever been archived for this (tenant, descriptor) yet. */
export async function findArchivedThroughCursor(
  tx: Bun.SQL,
  tenantId: string,
  descriptorKey: string
): Promise<Date | null> {
  const rows = (await tx`
    SELECT max(cursor_range_end) AS archived_through
    FROM awcms_data_lifecycle_archive_manifests
    WHERE tenant_id = ${tenantId} AND descriptor_key = ${descriptorKey} AND status <> 'deleted'
  `) as { archived_through: Date | null }[];

  return rows[0]?.archived_through ?? null;
}

export async function listArchiveManifests(
  tx: Bun.SQL,
  tenantId: string,
  descriptorKey?: string
): Promise<ArchiveManifestRow[]> {
  const rows = (await tx`
    SELECT id, descriptor_key, archive_port, artifact_location, row_count,
      cursor_range_start, cursor_range_end, checksum_algorithm, checksum_hex,
      schema_version, format, status, restore_procedure_ref, job_run_id,
      correlation_id, created_at, created_by, verified_at
    FROM awcms_data_lifecycle_archive_manifests
    WHERE tenant_id = ${tenantId}
      AND (${descriptorKey ?? null}::text IS NULL OR descriptor_key = ${descriptorKey ?? null})
    ORDER BY created_at DESC
    LIMIT 200
  `) as ManifestDbRow[];

  return rows.map(toRow);
}
