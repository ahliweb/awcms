/**
 * Scheduled/manual export generation (Issue #753). Reads a projection's
 * CURRENT metric snapshot (a small, bounded row set — one row per declared
 * metric, never the underlying source table's rows), writes it to a
 * filesystem artifact OUTSIDE any DB transaction (the write itself is a
 * provider boundary, ADR-0006, same posture `data_lifecycle`'s archive
 * pass already established even for its own local-filesystem-only
 * adapter), then records the manifest (checksum, row count, expiry) in
 * ITS OWN transaction. A failure during the write is caught and recorded
 * as a `status: "failed"` run — export failure must never look like
 * silence (same "freshness must reflect reality" principle this issue
 * applies to projections applies here too).
 */
import { withTenantOrThrow } from "../../../lib/database/tenant-context";
import type { ProjectionDescriptor } from "../../_shared/module-contract";
import {
  findPayrollTables,
  isPayrollOwnerModule,
  payrollBoundaryMessage,
  payrollOwnerMessage
} from "../../_shared/payroll-data-boundary";
import { getProjectionMetrics } from "./projection-metric-store";
import { recordExportRun, type ExportRunRow } from "./export-run-store";
import {
  writeLocalExportArtifact,
  type ExportRow
} from "../infrastructure/local-export-adapter";

const DEFAULT_EXPORT_RETENTION_DAYS = 7;

function resolveExportRootPath(env: NodeJS.ProcessEnv): string {
  return env.REPORTING_EXPORT_ROOT_PATH ?? "./var/reporting-exports";
}

function resolveRetentionDays(env: NodeJS.ProcessEnv): number {
  const raw = env.REPORTING_EXPORT_RETENTION_DAYS;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_EXPORT_RETENTION_DAYS;
}

export type GenerateExportInput = {
  tenantId: string;
  descriptor: ProjectionDescriptor;
  format: "csv" | "json";
  scheduledExportId: string | null;
  requestedBy: string | null;
  correlationId?: string | null;
};

/**
 * Issue #978 (PS-18). An export is a file that outlives the request, sits
 * outside the per-route step-up and is opened in a spreadsheet, so it is the
 * widest copy of a projection there is. The registry gate already refuses a
 * projection that names a payroll table; this refuses again at write time so a
 * descriptor that bypassed validation still cannot produce the file.
 *
 * Thrown BEFORE any read or write and NOT recorded as a failed run: a refusal
 * is a programming error to fix, not an operational failure to retry.
 */
export function assertProjectionExportable(
  descriptor: ProjectionDescriptor
): void {
  if (isPayrollOwnerModule(descriptor.ownerModuleKey)) {
    throw new Error(
      `reporting export: ${payrollOwnerMessage("report export", descriptor.ownerModuleKey)}`
    );
  }

  const streams = [
    ...(descriptor.source.strategy === "cursor_table"
      ? descriptor.source.streams
      : []),
    ...descriptor.rebuildSource.streams
  ];
  const [table] = findPayrollTables(streams.map((stream) => stream.tableName));

  if (table) {
    throw new Error(
      `reporting export: ${payrollBoundaryMessage("report export", table, `projection ${descriptor.key}`)}`
    );
  }
}

export async function generateProjectionExport(
  sql: Bun.SQL,
  input: GenerateExportInput,
  env: NodeJS.ProcessEnv = process.env
): Promise<ExportRunRow> {
  assertProjectionExportable(input.descriptor);

  const metrics = await withTenantOrThrow(sql, input.tenantId, (tx) =>
    getProjectionMetrics(tx, input.tenantId, input.descriptor.key)
  );

  const rows: ExportRow[] = Object.entries(input.descriptor.metricLabels).map(
    ([metricKey, label]) => ({
      metricKey,
      label,
      value: metrics[metricKey] ?? 0
    })
  );

  const rootPath = resolveExportRootPath(env);
  const retentionDays = resolveRetentionDays(env);

  try {
    const written = await writeLocalExportArtifact(
      rootPath,
      input.tenantId,
      input.descriptor.key,
      input.format,
      rows
    );

    const expiresAt = new Date(
      Date.now() + retentionDays * 24 * 60 * 60 * 1000
    );

    return withTenantOrThrow(sql, input.tenantId, (tx) =>
      recordExportRun(tx, input.tenantId, {
        scheduledExportId: input.scheduledExportId,
        projectionKey: input.descriptor.key,
        format: input.format,
        status: "completed",
        rowCount: written.rowCount,
        checksumSha256: written.checksumSha256,
        storagePath: written.storagePath,
        errorMessage: null,
        expiresAt,
        requestedBy: input.requestedBy,
        correlationId: input.correlationId
      })
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return withTenantOrThrow(sql, input.tenantId, (tx) =>
      recordExportRun(tx, input.tenantId, {
        scheduledExportId: input.scheduledExportId,
        projectionKey: input.descriptor.key,
        format: input.format,
        status: "failed",
        rowCount: 0,
        checksumSha256: null,
        storagePath: null,
        errorMessage: message,
        expiresAt: null,
        requestedBy: input.requestedBy,
        correlationId: input.correlationId
      })
    );
  }
}
