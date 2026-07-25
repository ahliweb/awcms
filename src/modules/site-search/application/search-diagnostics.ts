/**
 * Admin index status / freshness / failed-item diagnostics for `site_search`
 * (ADR-0040 §6, ported from awcms-micro Issue #270). Read-only, tenant-scoped
 * (RLS FORCE + explicit `tenant_id`). Bounded (every listing has a hard LIMIT).
 */
export type IndexStatus = {
  documentCount: number;
  byResourceType: { resourceType: string; count: number }[];
  latestIndexedAt: string | null;
  lastRun: IndexRunSummary | null;
  openFailureCount: number;
};

export type IndexRunSummary = {
  id: string;
  runType: string;
  status: string;
  trigger: string;
  documentsIndexed: number;
  documentsUpdated: number;
  documentsRemoved: number;
  documentsUnchanged: number;
  sourcesProcessed: number;
  failureCount: number;
  lastError: string | null;
  startedAt: string;
  finishedAt: string | null;
};

export type IndexFailureItem = {
  sourceKey: string;
  resourceId: string;
  locale: string;
  errorClass: string;
  errorDetail: string | null;
  occurrenceCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
};

const MAX_RUN_LIST = 50;
const MAX_FAILURE_LIST = 200;

/** Count of index documents for the tenant (also the `site_search_index_documents` observability figure). */
export async function countIndexDocuments(
  tx: Bun.SQL,
  tenantId: string
): Promise<number> {
  const rows = (await tx`
    SELECT count(*)::int AS count
    FROM awcms_site_search_documents
    WHERE tenant_id = ${tenantId}
  `) as { count: number }[];
  return rows[0]?.count ?? 0;
}

type RunRow = {
  id: string;
  run_type: string;
  status: string;
  trigger: string;
  documents_indexed: number;
  documents_updated: number;
  documents_removed: number;
  documents_unchanged: number;
  sources_processed: number;
  failure_count: number;
  last_error: string | null;
  started_at: Date;
  finished_at: Date | null;
};

function toRunSummary(row: RunRow): IndexRunSummary {
  return {
    id: row.id,
    runType: row.run_type,
    status: row.status,
    trigger: row.trigger,
    documentsIndexed: row.documents_indexed,
    documentsUpdated: row.documents_updated,
    documentsRemoved: row.documents_removed,
    documentsUnchanged: row.documents_unchanged,
    sourcesProcessed: row.sources_processed,
    failureCount: row.failure_count,
    lastError: row.last_error,
    startedAt: row.started_at.toISOString(),
    finishedAt: row.finished_at ? row.finished_at.toISOString() : null
  };
}

export async function fetchIndexStatus(
  tx: Bun.SQL,
  tenantId: string
): Promise<IndexStatus> {
  // Sequential, not Promise.all: concurrent queries on one tx connection leak it
  // (idle in transaction).
  const totals = (await tx`
      SELECT count(*)::int AS count, max(indexed_at) AS latest_indexed_at
      FROM awcms_site_search_documents
      WHERE tenant_id = ${tenantId}
    `) as { count: number; latest_indexed_at: Date | null }[];
  const byType = (await tx`
      SELECT resource_type, count(*)::int AS count
      FROM awcms_site_search_documents
      WHERE tenant_id = ${tenantId}
      GROUP BY resource_type
      ORDER BY resource_type ASC
    `) as { resource_type: string; count: number }[];
  const lastRunRows = (await tx`
      SELECT id, run_type, status, trigger, documents_indexed, documents_updated,
             documents_removed, documents_unchanged, sources_processed,
             failure_count, last_error, started_at, finished_at
      FROM awcms_site_search_index_runs
      WHERE tenant_id = ${tenantId}
      ORDER BY started_at DESC
      LIMIT 1
    `) as RunRow[];
  const failureRows = (await tx`
      SELECT count(*)::int AS count
      FROM awcms_site_search_index_failures
      WHERE tenant_id = ${tenantId} AND resolved_at IS NULL
    `) as { count: number }[];

  return {
    documentCount: totals[0]?.count ?? 0,
    latestIndexedAt: totals[0]?.latest_indexed_at
      ? totals[0]!.latest_indexed_at!.toISOString()
      : null,
    byResourceType: byType.map((r) => ({
      resourceType: r.resource_type,
      count: r.count
    })),
    lastRun: lastRunRows[0] ? toRunSummary(lastRunRows[0]) : null,
    openFailureCount: failureRows[0]?.count ?? 0
  };
}

export async function fetchRecentRuns(
  tx: Bun.SQL,
  tenantId: string,
  limit = MAX_RUN_LIST
): Promise<IndexRunSummary[]> {
  const bounded = Math.min(Math.max(1, Math.trunc(limit)), MAX_RUN_LIST);
  const rows = (await tx`
    SELECT id, run_type, status, trigger, documents_indexed, documents_updated,
           documents_removed, documents_unchanged, sources_processed,
           failure_count, last_error, started_at, finished_at
    FROM awcms_site_search_index_runs
    WHERE tenant_id = ${tenantId}
    ORDER BY started_at DESC
    LIMIT ${bounded}
  `) as RunRow[];
  return rows.map(toRunSummary);
}

export async function fetchIndexFailures(
  tx: Bun.SQL,
  tenantId: string,
  limit = MAX_FAILURE_LIST
): Promise<IndexFailureItem[]> {
  const bounded = Math.min(Math.max(1, Math.trunc(limit)), MAX_FAILURE_LIST);
  const rows = (await tx`
    SELECT source_key, resource_id, locale, error_class, error_detail,
           occurrence_count, first_seen_at, last_seen_at
    FROM awcms_site_search_index_failures
    WHERE tenant_id = ${tenantId} AND resolved_at IS NULL
    ORDER BY last_seen_at DESC
    LIMIT ${bounded}
  `) as {
    source_key: string;
    resource_id: string;
    locale: string;
    error_class: string;
    error_detail: string | null;
    occurrence_count: number;
    first_seen_at: Date;
    last_seen_at: Date;
  }[];

  return rows.map((row) => ({
    sourceKey: row.source_key,
    resourceId: row.resource_id,
    locale: row.locale,
    errorClass: row.error_class,
    errorDetail: row.error_detail,
    occurrenceCount: row.occurrence_count,
    firstSeenAt: row.first_seen_at.toISOString(),
    lastSeenAt: row.last_seen_at.toISOString()
  }));
}
