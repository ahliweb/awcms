/**
 * The `site_search` index engine (ADR-0040 §4, ported from awcms-micro Issue
 * #270) — the deterministic, idempotent reconcile/rebuild/reindex mechanism that
 * keeps `awcms_site_search_documents` a faithful projection of every content
 * module's currently-public rows.
 *
 * Every function takes an already tenant-scoped transaction `tx` (opened by the
 * caller's `withTenant`, so RLS FORCE is in effect and `app.current_tenant_id` is
 * set). It reads a content module's OWN source table through the module's
 * declarative `SearchSourceDescriptor` (never a cross-module TypeScript import —
 * ADR-0013 §6) and writes ONLY `site_search`'s own tables.
 *
 * Determinism/idempotency: reconcile UPSERTs the current public set (skipping a
 * document whose `source_checksum` already matches — matches source checksums)
 * and DELETEs any index document whose source row is gone or no longer public
 * (no stale leakage). Re-running it while already in sync is a no-op. `rebuild`
 * DELETEs the tenant's documents for the given sources first, so its end state is
 * identical regardless of prior state.
 *
 * Per-item failure isolation: each upsert runs inside a `tx.savepoint`, so one
 * bad row unwinds only to the savepoint and is recorded in
 * `awcms_site_search_index_failures` (failed-item diagnostics) without aborting
 * the whole run.
 *
 * AWCMS adaptation: public content routes here are path-tenant-scoped
 * (`/blog/{tenantCode}/{slug}`, ADR-0009), so the engine resolves the indexed
 * tenant's `tenant_code` ONCE per run and hands it to `mapRowToDocument` for
 * `:tenantCode` substitution. `awcms_tenants` is RLS-free by design (ADR-0003)
 * and readable by both `awcms_app` and `awcms_worker`.
 */
import type { SearchSourceDescriptor } from "../../_shared/module-contract";
import { safeErrorDetail } from "../../../lib/logging/error-sanitizer";
import { log } from "../../../lib/logging/logger";
import { recordCounter } from "../../../lib/observability/metrics-port";
import {
  buildExtractionQuery,
  buildSourceCountQuery,
  buildStaleRemovalQuery,
  mapRowToDocument,
  type ExtractionRow,
  type SearchDocumentInput
} from "../domain/search-document";

const DEFAULT_BATCH_SIZE = 500;
/** Hard ceiling on batches per source per run — runaway guard for a huge source. */
const MAX_BATCHES = 20_000;
const MAX_FAILURE_DETAIL_LENGTH = 1000;

export type RunType = "rebuild" | "reconcile" | "reindex";
export type RunTrigger = "manual" | "scheduled";

export type SourceReconcileResult = {
  sourceKey: string;
  resourceType: string;
  sourceCount: number;
  added: number;
  updated: number;
  unchanged: number;
  removed: number;
  failures: number;
};

export type IndexRunResult = {
  runId: string;
  runType: RunType;
  status: "succeeded" | "failed";
  results: SourceReconcileResult[];
  totalIndexed: number;
  totalRemoved: number;
  failureCount: number;
  lastError: string | null;
};

type UpsertOutcome = "inserted" | "updated" | "unchanged";

/**
 * Resolve the indexed tenant's public `tenant_code` — the `:tenantCode` segment
 * of every path-tenant-scoped public URL this base builds. Returns `null` when
 * the tenant row is absent; `buildDocumentUrl` then throws for any descriptor
 * whose template needs it, and the per-item failure isolation records that as an
 * `extract_error` rather than writing a malformed URL into the index.
 */
async function resolveTenantCode(
  tx: Bun.SQL,
  tenantId: string
): Promise<string | null> {
  const rows = (await tx`
    SELECT tenant_code FROM awcms_tenants WHERE id = ${tenantId}
  `) as { tenant_code: string }[];
  return rows[0]?.tenant_code ?? null;
}

async function upsertDocument(
  tx: Bun.SQL,
  tenantId: string,
  doc: SearchDocumentInput
): Promise<UpsertOutcome> {
  const rows = (await tx`
    INSERT INTO awcms_site_search_documents
      (tenant_id, source_key, resource_type, resource_id, locale, url, title,
       summary, body_text, tags, tags_text, term_facets, privacy_classification,
       weight, source_updated_at, source_checksum, indexed_at, updated_at)
    VALUES (${tenantId}, ${doc.sourceKey}, ${doc.resourceType}, ${doc.resourceId},
       ${doc.locale}, ${doc.url}, ${doc.title}, ${doc.summary}, ${doc.bodyText},
       ${tx.array(doc.tags, "text")}, ${doc.tagsText},
       ${JSON.stringify(doc.termFacets)}::jsonb, 'public', ${doc.weight},
       ${doc.sourceUpdatedAt}, ${doc.sourceChecksum}, now(), now())
    ON CONFLICT (tenant_id, source_key, resource_id, locale)
    DO UPDATE SET
      resource_type = EXCLUDED.resource_type,
      url = EXCLUDED.url,
      title = EXCLUDED.title,
      summary = EXCLUDED.summary,
      body_text = EXCLUDED.body_text,
      tags = EXCLUDED.tags,
      tags_text = EXCLUDED.tags_text,
      term_facets = EXCLUDED.term_facets,
      weight = EXCLUDED.weight,
      source_updated_at = EXCLUDED.source_updated_at,
      source_checksum = EXCLUDED.source_checksum,
      indexed_at = now(),
      updated_at = now()
    WHERE awcms_site_search_documents.source_checksum
          IS DISTINCT FROM EXCLUDED.source_checksum
    RETURNING (xmax = 0) AS inserted
  `) as { inserted: boolean }[];

  if (rows.length === 0) return "unchanged";
  return rows[0]!.inserted ? "inserted" : "updated";
}

async function recordFailure(
  tx: Bun.SQL,
  tenantId: string,
  sourceKey: string,
  resourceId: string,
  locale: string,
  errorClass: string,
  detail: string
): Promise<void> {
  const boundedDetail = detail.slice(0, MAX_FAILURE_DETAIL_LENGTH);
  await tx`
    INSERT INTO awcms_site_search_index_failures
      (tenant_id, source_key, resource_id, locale, error_class, error_detail,
       occurrence_count, first_seen_at, last_seen_at)
    VALUES (${tenantId}, ${sourceKey}, ${resourceId}, ${locale}, ${errorClass},
       ${boundedDetail}, 1, now(), now())
    ON CONFLICT (tenant_id, source_key, resource_id, locale)
    DO UPDATE SET
      occurrence_count = awcms_site_search_index_failures.occurrence_count + 1,
      error_class = EXCLUDED.error_class,
      error_detail = EXCLUDED.error_detail,
      last_seen_at = now(),
      resolved_at = NULL
  `;
}

/** Remove every index document for one resource across all its locales (archive/delete/unpublish). */
export async function removeSearchResource(
  tx: Bun.SQL,
  tenantId: string,
  sourceKey: string,
  resourceId: string
): Promise<number> {
  const rows = (await tx`
    DELETE FROM awcms_site_search_documents
    WHERE tenant_id = ${tenantId}
      AND source_key = ${sourceKey}
      AND resource_id = ${resourceId}
    RETURNING id
  `) as { id: string }[];
  return rows.length;
}

/** Count the current public source rows for reconciliation parity. */
async function countSource(
  tx: Bun.SQL,
  tenantId: string,
  descriptor: SearchSourceDescriptor
): Promise<number> {
  const { text, values } = buildSourceCountQuery(tenantId, descriptor);
  const rows = (await tx.unsafe(text, values)) as { count: number }[];
  return rows[0]?.count ?? 0;
}

/**
 * Reconcile ONE source: upsert its current public rows (batched, checksum-gated
 * skip) then delete stale index documents. Clears the source's prior failure
 * rows first, so failed-item diagnostics reflect the latest run.
 */
export async function reconcileSource(
  tx: Bun.TransactionSQL,
  tenantId: string,
  descriptor: SearchSourceDescriptor,
  options: { batchSize?: number; tenantCode?: string | null } = {}
): Promise<SourceReconcileResult> {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const tenantCode =
    options.tenantCode === undefined
      ? await resolveTenantCode(tx, tenantId)
      : options.tenantCode;

  await tx`
    DELETE FROM awcms_site_search_index_failures
    WHERE tenant_id = ${tenantId} AND source_key = ${descriptor.key}
  `;

  let added = 0;
  let updated = 0;
  let unchanged = 0;
  let failures = 0;
  let cursor: string | null = null;

  for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
    const { text, values } = buildExtractionQuery(tenantId, descriptor, {
      mode: "batch",
      cursorId: cursor,
      batchSize
    });
    const rows = (await tx.unsafe(text, values)) as ExtractionRow[];
    if (rows.length === 0) break;

    for (const row of rows) {
      let doc: SearchDocumentInput;
      try {
        doc = mapRowToDocument(descriptor, row, { tenantCode });
      } catch (error) {
        failures += 1;
        recordCounter("site_search_index_failures_total", {
          errorClass: "extract_error"
        });
        await recordFailure(
          tx,
          tenantId,
          descriptor.key,
          String(row.id ?? "unknown"),
          String(row.locale ?? ""),
          "extract_error",
          safeErrorDetail(error)
        );
        continue;
      }

      try {
        // The savepoint isolates a per-item upsert error to this row (unwinds to
        // the savepoint, leaving the outer tx usable so `recordFailure` below can
        // still write). `sp` is Bun's savepoint SQL handle; it supports the same
        // tagged-template API as `Bun.SQL` but is a distinct nominal type, so the
        // cast is a type-only bridge, not a behavior change.
        const outcome = await tx.savepoint((sp) =>
          upsertDocument(sp as unknown as Bun.SQL, tenantId, doc)
        );
        if (outcome === "inserted") added += 1;
        else if (outcome === "updated") updated += 1;
        else unchanged += 1;
      } catch (error) {
        failures += 1;
        recordCounter("site_search_index_failures_total", {
          errorClass: "upsert_error"
        });
        await recordFailure(
          tx,
          tenantId,
          descriptor.key,
          doc.resourceId,
          doc.locale,
          "upsert_error",
          safeErrorDetail(error)
        );
      }
    }

    cursor = String(rows[rows.length - 1]!.id);
    if (rows.length < batchSize) break;
  }

  const removal = buildStaleRemovalQuery(tenantId, descriptor);
  const removedRows = (await tx.unsafe(
    `${removal.text} RETURNING d.id`,
    removal.values
  )) as { id: string }[];
  const removed = removedRows.length;

  const sourceCount = await countSource(tx, tenantId, descriptor);

  return {
    sourceKey: descriptor.key,
    resourceType: descriptor.resourceType,
    sourceCount,
    added,
    updated,
    unchanged,
    removed,
    failures
  };
}

/**
 * Reindex ONE resource (the event-shaped incremental primitive): re-extract it;
 * if it is still public, upsert it; if it is no longer public (archived/deleted/
 * unpublished) or gone, remove it from the index — no stale leakage.
 */
export async function reindexSearchResource(
  tx: Bun.SQL,
  tenantId: string,
  descriptor: SearchSourceDescriptor,
  resourceId: string
): Promise<"indexed" | "removed"> {
  const { text, values } = buildExtractionQuery(tenantId, descriptor, {
    mode: "single",
    resourceId
  });
  const rows = (await tx.unsafe(text, values)) as ExtractionRow[];

  if (rows.length === 0) {
    await removeSearchResource(tx, tenantId, descriptor.key, resourceId);
    recordCounter("site_search_index_operations_total", {
      runType: "reindex",
      status: "succeeded"
    });
    return "removed";
  }

  const tenantCode = await resolveTenantCode(tx, tenantId);
  const doc = mapRowToDocument(descriptor, rows[0]!, { tenantCode });
  await upsertDocument(tx, tenantId, doc);
  recordCounter("site_search_index_operations_total", {
    runType: "reindex",
    status: "succeeded"
  });
  return "indexed";
}

async function createRun(
  tx: Bun.SQL,
  tenantId: string,
  runType: RunType,
  trigger: RunTrigger,
  triggeredBy: string | null
): Promise<string> {
  const rows = (await tx`
    INSERT INTO awcms_site_search_index_runs
      (tenant_id, run_type, status, triggered_by, trigger)
    VALUES (${tenantId}, ${runType}, 'running', ${triggeredBy}, ${trigger})
    RETURNING id
  `) as { id: string }[];
  return rows[0]!.id;
}

async function finalizeRun(
  tx: Bun.SQL,
  runId: string,
  status: "succeeded" | "failed",
  results: SourceReconcileResult[],
  lastError: string | null
): Promise<void> {
  const indexed = results.reduce((n, r) => n + r.added + r.updated, 0);
  const updatedCount = results.reduce((n, r) => n + r.updated, 0);
  const removed = results.reduce((n, r) => n + r.removed, 0);
  const unchanged = results.reduce((n, r) => n + r.unchanged, 0);
  const failureCount = results.reduce((n, r) => n + r.failures, 0);
  await tx`
    UPDATE awcms_site_search_index_runs
    SET status = ${status},
        documents_indexed = ${indexed},
        documents_updated = ${updatedCount},
        documents_removed = ${removed},
        documents_unchanged = ${unchanged},
        sources_processed = ${results.length},
        failure_count = ${failureCount},
        last_error = ${lastError},
        finished_at = now()
    WHERE id = ${runId}
  `;
}

async function runReconcile(
  tx: Bun.TransactionSQL,
  tenantId: string,
  descriptors: readonly SearchSourceDescriptor[],
  runType: RunType,
  trigger: RunTrigger,
  triggeredBy: string | null,
  batchSize?: number
): Promise<IndexRunResult> {
  const runId = await createRun(tx, tenantId, runType, trigger, triggeredBy);
  // Resolved ONCE per run and threaded into every source pass, rather than
  // re-queried per source.
  const tenantCode = await resolveTenantCode(tx, tenantId);
  const results: SourceReconcileResult[] = [];
  let status: "succeeded" | "failed" = "succeeded";
  let lastError: string | null = null;

  for (const descriptor of descriptors) {
    try {
      results.push(
        await reconcileSource(tx, tenantId, descriptor, {
          batchSize,
          tenantCode
        })
      );
    } catch (error) {
      status = "failed";
      lastError = safeErrorDetail(error).slice(0, MAX_FAILURE_DETAIL_LENGTH);
      break;
    }
  }

  await finalizeRun(tx, runId, status, results, lastError);
  recordCounter("site_search_index_operations_total", { runType, status });

  const totalIndexed = results.reduce((n, r) => n + r.added + r.updated, 0);
  const totalRemoved = results.reduce((n, r) => n + r.removed, 0);
  const failureCount = results.reduce((n, r) => n + r.failures, 0);

  // Documented log-line event (`awcms.site-search.index.*`) — the
  // structured-logger-producer convention (same as blog_content's post events),
  // not published through `domain_event_runtime`.
  log(
    "info",
    `site-search.index.${runType === "rebuild" ? "rebuilt" : "reconciled"}`,
    {
      tenantId,
      runId,
      status,
      documentsIndexed: totalIndexed,
      documentsRemoved: totalRemoved,
      failureCount
    }
  );

  return {
    runId,
    runType,
    status,
    results,
    totalIndexed,
    totalRemoved,
    failureCount,
    lastError
  };
}

/** Deterministic, idempotent reconcile of every given source for one tenant. */
export async function reconcileTenantSearchIndex(
  tx: Bun.TransactionSQL,
  tenantId: string,
  descriptors: readonly SearchSourceDescriptor[],
  options: {
    trigger?: RunTrigger;
    triggeredBy?: string | null;
    batchSize?: number;
  } = {}
): Promise<IndexRunResult> {
  return runReconcile(
    tx,
    tenantId,
    descriptors,
    "reconcile",
    options.trigger ?? "manual",
    options.triggeredBy ?? null,
    options.batchSize
  );
}

/**
 * Idempotent full rebuild: DELETE the tenant's documents for the given sources,
 * then reconcile from scratch. End state is identical regardless of prior state.
 */
export async function rebuildTenantSearchIndex(
  tx: Bun.TransactionSQL,
  tenantId: string,
  descriptors: readonly SearchSourceDescriptor[],
  options: {
    trigger?: RunTrigger;
    triggeredBy?: string | null;
    batchSize?: number;
  } = {}
): Promise<IndexRunResult> {
  const sourceKeys = descriptors.map((d) => d.key);
  await tx`
    DELETE FROM awcms_site_search_documents
    WHERE tenant_id = ${tenantId} AND source_key = ANY(${tx.array(sourceKeys, "text")})
  `;
  return runReconcile(
    tx,
    tenantId,
    descriptors,
    "rebuild",
    options.trigger ?? "manual",
    options.triggeredBy ?? null,
    options.batchSize
  );
}
