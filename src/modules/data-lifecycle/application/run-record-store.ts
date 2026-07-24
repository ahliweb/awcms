/**
 * Lifecycle run history store (ported from awcms-micro Issue #745, ADR-0037) —
 * `awcms_data_lifecycle_runs`. Every dry-run/archive/purge execution (scheduled
 * job or on-demand API) writes exactly one row here with categorized AGGREGATE
 * counts only — never row contents, never anything beyond opaque UUIDs already
 * tenant-scoped by RLS ("dry-run and result artifacts minimize or aggregate
 * PII").
 */
export type LifecycleRunType = "dry_run" | "archive" | "purge";
export type LifecycleRunStatus = "completed" | "partial" | "failed";

export type LifecycleRunCounts = {
  eligibleCount: number;
  heldCount: number;
  archivedCount: number;
  purgeableCount: number;
  purgedCount: number;
  blockedCount: number;
  errorCount: number;
};

export type LifecycleRunRow = LifecycleRunCounts & {
  id: string;
  descriptorKey: string;
  runType: LifecycleRunType;
  status: LifecycleRunStatus;
  cutoffAt: Date | null;
  jobRunId: string | null;
  correlationId: string | null;
  startedAt: Date;
  finishedAt: Date;
  triggeredBy: string | null;
  createdAt: Date;
};

type RunDbRow = {
  id: string;
  descriptor_key: string;
  run_type: LifecycleRunType;
  status: LifecycleRunStatus;
  eligible_count: number;
  held_count: number;
  archived_count: number;
  purgeable_count: number;
  purged_count: number;
  blocked_count: number;
  error_count: number;
  cutoff_at: Date | null;
  job_run_id: string | null;
  correlation_id: string | null;
  started_at: Date;
  finished_at: Date;
  triggered_by: string | null;
  created_at: Date;
};

function toRow(row: RunDbRow): LifecycleRunRow {
  return {
    id: row.id,
    descriptorKey: row.descriptor_key,
    runType: row.run_type,
    status: row.status,
    eligibleCount: row.eligible_count,
    heldCount: row.held_count,
    archivedCount: row.archived_count,
    purgeableCount: row.purgeable_count,
    purgedCount: row.purged_count,
    blockedCount: row.blocked_count,
    errorCount: row.error_count,
    cutoffAt: row.cutoff_at,
    jobRunId: row.job_run_id,
    correlationId: row.correlation_id,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    triggeredBy: row.triggered_by,
    createdAt: row.created_at
  };
}

export type RecordLifecycleRunInput = LifecycleRunCounts & {
  descriptorKey: string;
  runType: LifecycleRunType;
  status: LifecycleRunStatus;
  cutoffAt: Date | null;
  jobRunId?: string | null;
  correlationId?: string | null;
  startedAt: Date;
  finishedAt: Date;
  /** `null`/omitted = a scheduled/system job run, not an on-demand API call. */
  triggeredBy?: string | null;
};

export async function recordLifecycleRun(
  tx: Bun.SQL,
  tenantId: string,
  input: RecordLifecycleRunInput
): Promise<LifecycleRunRow> {
  const rows = (await tx`
    INSERT INTO awcms_data_lifecycle_runs
      (tenant_id, descriptor_key, run_type, status, eligible_count, held_count,
       archived_count, purgeable_count, purged_count, blocked_count, error_count,
       cutoff_at, job_run_id, correlation_id, started_at, finished_at, triggered_by)
    VALUES (
      ${tenantId}, ${input.descriptorKey}, ${input.runType}, ${input.status},
      ${input.eligibleCount}, ${input.heldCount}, ${input.archivedCount},
      ${input.purgeableCount}, ${input.purgedCount}, ${input.blockedCount},
      ${input.errorCount}, ${input.cutoffAt}, ${input.jobRunId ?? null},
      ${input.correlationId ?? null}, ${input.startedAt}, ${input.finishedAt},
      ${input.triggeredBy ?? null}
    )
    RETURNING id, descriptor_key, run_type, status, eligible_count, held_count,
      archived_count, purgeable_count, purged_count, blocked_count, error_count,
      cutoff_at, job_run_id, correlation_id, started_at, finished_at, triggered_by,
      created_at
  `) as RunDbRow[];

  return toRow(rows[0]!);
}

export type ListLifecycleRunsFilter = {
  descriptorKey?: string;
  runType?: LifecycleRunType;
};

/** `LIMIT 100`, newest first — operator/compliance history browsing, not a paginated feed. */
export async function listLifecycleRuns(
  tx: Bun.SQL,
  tenantId: string,
  filter: ListLifecycleRunsFilter = {}
): Promise<LifecycleRunRow[]> {
  const rows = (await tx`
    SELECT id, descriptor_key, run_type, status, eligible_count, held_count,
      archived_count, purgeable_count, purged_count, blocked_count, error_count,
      cutoff_at, job_run_id, correlation_id, started_at, finished_at, triggered_by,
      created_at
    FROM awcms_data_lifecycle_runs
    WHERE tenant_id = ${tenantId}
      AND (${filter.descriptorKey ?? null}::text IS NULL OR descriptor_key = ${filter.descriptorKey ?? null})
      AND (${filter.runType ?? null}::text IS NULL OR run_type = ${filter.runType ?? null})
    ORDER BY created_at DESC
    LIMIT 100
  `) as RunDbRow[];

  return rows.map(toRow);
}
