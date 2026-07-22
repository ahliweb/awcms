/**
 * Per-tenant orchestration for the R2 media lifecycle cleanup &
 * reconciliation job (Issue #690, epic #679 platform-hardening —
 * "runtime/worker hardening" wave, following #691/#689/#694/#695/#687/#697).
 * `scripts/news-media-r2-reconcile.ts` is the thin CLI wrapper (`runJob`
 * integration, tenant loop, telemetry); this file holds the actual logic so
 * `tests/integration/news-media-r2-reconciliation-job.integration.test.ts`
 * can exercise it directly against a real Postgres + fake R2 HTTP server,
 * same convention `runAuditLogPurge` (`scripts/audit-log-purge.ts`)
 * established.
 *
 * ## Ordering discipline — two DIFFERENT orderings, each independently justified
 *
 * (Corrected — reviewer finding on PR #718: this header previously claimed
 * a single "DB claim first" ordering applied to "both cleanup paths." It
 * does not; the two paths are ordered oppositely, for two different
 * reasons, neither of which is an oversight.)
 *
 * **`expiredPending` (`cleanupExpiredPending`): DB claim FIRST, R2 delete
 * SECOND.** `r2-backup-lifecycle.md` §2 asks for "hapus objek R2 dulu, baru
 * hapus baris metadata" for CRASH safety, but this path claims the DB row
 * first instead — deliberately:
 *
 * - The DB claim uses the SAME "guarded UPDATE...WHERE, Postgres serializes
 *   concurrent writers" idiom `finalizeNewsMediaUploadSession` already uses
 *   for its own atomic claim — doing the R2 call FIRST would mean a
 *   concurrently in-flight `finalize()` call could win the race AFTER this
 *   job already deleted the object out from under it. Claiming in the DB
 *   first is what makes "never delete a row that is genuinely still being
 *   finalized" possible at all (this repo's critical acceptance criterion
 *   for this job) — `pending_upload`/`uploaded` rows CAN be raced against a
 *   real, concurrently-running upload/finalize flow.
 * - The failure mode the doc's ordering avoids (a stray R2 object with no
 *   matching DB row) is NOT a dead end here — it is EXACTLY the
 *   `orphanInR2` category `news-media-reconciliation-categorization.ts`
 *   independently detects and eventually cleans up on a LATER run. A crash
 *   between this module's DB claim and its R2 delete therefore self-heals,
 *   just on the next scheduled run instead of instantly.
 *
 * **`staleOrphaned` (`cleanupStaleOrphaned`): R2 delete FIRST, DB soft-
 * delete SECOND** — the doc's original ordering, unmodified. This path has
 * no equivalent race to guard against: no other code path in
 * `news-media-object-directory.ts` ever transitions a row OUT of
 * `status = 'orphaned'` (there is no "un-orphan" operation), so there is no
 * concurrently-running flow that could be racing this cleanup the way
 * `finalize()` races `expiredPending`. R2-delete-first here matches the
 * doc's own crash-safety reasoning: a crash after the R2 delete but before
 * the DB soft-delete just leaves a row pointing at an already-gone object,
 * which the NEXT run's `orphanInDb`/retry naturally reconciles.
 *
 * ## Idempotency across reruns
 *
 * Every mutation below is a guarded UPDATE/DELETE that only succeeds if the
 * row is STILL in the exact state that made it eligible. Once a row is
 * hard-deleted (`expiredPending`) or soft-deleted (`staleOrphaned`), it no
 * longer appears in the NEXT run's `fetchNewsMediaObjectsForReconciliation`
 * snapshot (hard-delete) or no longer satisfies the `deleted_at IS NULL`
 * guard (soft-delete) — so a rerun with nothing new to do performs zero
 * mutations and reports the same `healthy` set, by construction, not by a
 * separate "already processed" bookkeeping mechanism.
 *
 * ## Provider outage handling
 *
 * `r2Client.listObjects`/`deleteObject` never throw (same convention as
 * every other method on `NewsMediaR2Client` — see that file's header) — a
 * provider error is a normal `{ ok: false, error }` return. A `listObjects`
 * failure aborts THIS TENANT's reconciliation only (returns
 * `r2ListFailed: true`, no DB mutation attempted, `orphanInR2` cannot be
 * computed without a listing) and the caller continues to the next tenant —
 * one tenant's R2 outage never blocks another tenant's, and never blocks
 * unrelated DB-only work elsewhere in the process. A `deleteObject` failure
 * for one candidate is deferred (counted, logged, left for the next run) —
 * it never aborts the rest of that tenant's cleanup loop.
 */
import { withTenant } from "../../../lib/database/tenant-context";
import { fetchActiveTenants } from "../../../lib/jobs/batching";
import {
  categorizeNewsMediaReconciliation,
  isOrphanInR2EligibleForDeletion,
  type NewsMediaExpiredPendingEntry,
  type NewsMediaOrphanInDbEntry,
  type NewsMediaOrphanInR2Entry,
  type NewsMediaReconciliationDbRow,
  type NewsMediaStaleOrphanedEntry
} from "../domain/news-media-reconciliation-categorization";
import type { NewsMediaR2Config } from "../domain/news-media-r2-config";
import type { NewsMediaR2Client } from "../infrastructure/news-media-r2-client";
import {
  fetchNewsMediaObjectsForReconciliation,
  markNewsMediaObjectFailed,
  markStaleOrphanedNewsMediaObjectDeleted,
  NEWS_MEDIA_RECONCILIATION_SNAPSHOT_LIMIT,
  objectKeyExistsForTenant,
  purgeExpiredPendingNewsMediaObject
} from "./news-media-object-directory";

/** Safety bound on R2 `list()` pages fetched per tenant per run — mirrors `src/lib/jobs/batching.ts`'s `DEFAULT_MAX_PASSES` reasoning (a single run must never page through an unbounded bucket forever). At the R2 API's own default page size (1000 keys), 50 pages is up to 50,000 objects per tenant per run; a bucket with more is only PARTIALLY reconciled this run (`r2ListTruncated: true`), fully caught up over subsequent runs. */
export const MAX_R2_LIST_PAGES = 50;

const R2_LIST_PAGE_MAX_KEYS = 1000;

export type NewsMediaReconciliationOptions = {
  now?: Date;
  dryRun?: boolean;
  signal?: AbortSignal;
  /** Test-only override for `R2_LIST_PAGE_MAX_KEYS` (defaults to the real R2 page size, 1000) — lets integration tests exercise multi-page pagination deterministically with a handful of fake objects instead of needing thousands. Not a new CLI flag; production always uses the real default. */
  pageSize?: number;
};

export type NewsMediaTenantReconciliationResult = {
  tenantId: string;
  dryRun: boolean;
  /** `true` if `fetchNewsMediaObjectsForReconciliation` returned exactly its `limit` — this tenant's DB snapshot may be incomplete this run. */
  dbSnapshotTruncated: boolean;
  /** `true` if R2 `listObjects` hit `MAX_R2_LIST_PAGES` before `isTruncated` was `false` — this tenant's R2 listing may be incomplete this run. */
  r2ListTruncated: boolean;
  /** `true` if `listObjects` returned a provider error at any page — no categorization/cleanup was attempted for this tenant this run. */
  r2ListFailed: boolean;
  r2ListError?: string;
  healthyCount: number;
  orphanInDb: NewsMediaOrphanInDbEntry[];
  expiredPending: {
    total: number;
    deleted: number;
    racedSkipped: number;
    deferred: number;
  };
  staleOrphaned: {
    total: number;
    deleted: number;
    deferred: number;
  };
  orphanInR2: {
    total: number;
    eligible: number;
    deleted: number;
    raceAverted: number;
    deferred: number;
    /** Eligible-but-not-yet-acted-on entries (dry-run, or not reached due to `signal` abort) — capped for telemetry size. */
    reported: NewsMediaOrphanInR2Entry[];
  };
};

function tenantObjectKeyPrefix(tenantId: string): string {
  return `news-media/${tenantId}/`;
}

/** Paginates `r2Client.listObjects` for one tenant's key prefix until `isTruncated` is `false`, `MAX_R2_LIST_PAGES` is hit, `signal` aborts, or a page returns a provider error. */
async function listAllNewsMediaObjectsForTenant(
  r2Client: NewsMediaR2Client,
  tenantId: string,
  signal?: AbortSignal,
  pageSize: number = R2_LIST_PAGE_MAX_KEYS
): Promise<
  | {
      ok: true;
      objects: { key: string; sizeBytes?: number; lastModified?: string }[];
      truncated: boolean;
    }
  | { ok: false; error: string }
> {
  const prefix = tenantObjectKeyPrefix(tenantId);
  const objects: { key: string; sizeBytes?: number; lastModified?: string }[] =
    [];
  let continuationToken: string | undefined;
  let truncated = false;

  for (let page = 0; page < MAX_R2_LIST_PAGES; page += 1) {
    if (signal?.aborted) {
      truncated = true;
      break;
    }

    const result = await r2Client.listObjects({
      prefix,
      continuationToken,
      maxKeys: pageSize
    });

    if (!result.ok) {
      return { ok: false, error: result.error };
    }

    objects.push(...result.objects);

    if (!result.isTruncated) {
      truncated = false;
      break;
    }

    continuationToken = result.nextContinuationToken;
    if (!continuationToken) {
      // R2 reported more pages but gave no token to continue with —
      // treat as truncated rather than looping forever on an empty token.
      truncated = true;
      break;
    }

    if (page === MAX_R2_LIST_PAGES - 1) {
      truncated = true;
    }
  }

  return { ok: true, objects, truncated };
}

function toReconciliationDbRow(row: {
  id: string;
  objectKey: string;
  status: NewsMediaReconciliationDbRow["status"];
  createdAt: Date;
  orphanedAt: Date | null;
  deletedAt: Date | null;
}): NewsMediaReconciliationDbRow {
  return row;
}

async function cleanupExpiredPending(
  sql: Bun.SQL,
  tenantId: string,
  entries: NewsMediaExpiredPendingEntry[],
  pendingCutoff: Date,
  r2Client: NewsMediaR2Client,
  signal?: AbortSignal
): Promise<{ deleted: number; racedSkipped: number; deferred: number }> {
  let deleted = 0;
  let racedSkipped = 0;
  let deferred = 0;

  for (const entry of entries) {
    if (signal?.aborted) break;

    if (entry.status !== "failed") {
      // Atomic claim — see this file's header. If a concurrent finalize()
      // already moved this row out of pending_upload/uploaded, the guarded
      // UPDATE matches zero rows and we skip it entirely: never touch R2
      // for a row that is genuinely still in flight.
      const claimed = await withTenant(
        sql,
        tenantId,
        (tx) =>
          markNewsMediaObjectFailed(tx, tenantId, entry.id, {
            olderThan: pendingCutoff
          }),
        { workClass: "maintenance" }
      );

      if (!claimed) {
        racedSkipped += 1;
        continue;
      }
    }

    const deleteResult = await r2Client.deleteObject(entry.objectKey);

    if (!deleteResult.ok) {
      deferred += 1;
      continue;
    }

    const purged = await withTenant(
      sql,
      tenantId,
      (tx) =>
        purgeExpiredPendingNewsMediaObject(
          tx,
          tenantId,
          entry.id,
          pendingCutoff
        ),
      { workClass: "maintenance" }
    );

    if (purged) {
      deleted += 1;
    } else {
      // Already gone (a concurrent run/process purged it first) — not an
      // error, just nothing left for this run to do for this row.
      deferred += 0;
    }
  }

  return { deleted, racedSkipped, deferred };
}

async function cleanupStaleOrphaned(
  sql: Bun.SQL,
  tenantId: string,
  entries: NewsMediaStaleOrphanedEntry[],
  orphanCutoff: Date,
  r2Client: NewsMediaR2Client,
  signal?: AbortSignal
): Promise<{ deleted: number; deferred: number }> {
  let deleted = 0;
  let deferred = 0;

  for (const entry of entries) {
    if (signal?.aborted) break;

    const deleteResult = await r2Client.deleteObject(entry.objectKey);

    if (!deleteResult.ok) {
      deferred += 1;
      continue;
    }

    const softDeleted = await withTenant(
      sql,
      tenantId,
      (tx) =>
        markStaleOrphanedNewsMediaObjectDeleted(
          tx,
          tenantId,
          entry.id,
          orphanCutoff
        ),
      { workClass: "maintenance" }
    );

    if (softDeleted) {
      deleted += 1;
    }
  }

  return { deleted, deferred };
}

async function cleanupOrphanInR2(
  sql: Bun.SQL,
  tenantId: string,
  entries: NewsMediaOrphanInR2Entry[],
  orphanGraceDays: number,
  r2Client: NewsMediaR2Client,
  signal?: AbortSignal
): Promise<{ deleted: number; raceAverted: number; deferred: number }> {
  let deleted = 0;
  let raceAverted = 0;
  let deferred = 0;

  for (const entry of entries) {
    if (signal?.aborted) break;
    if (!isOrphanInR2EligibleForDeletion(entry, orphanGraceDays)) continue;

    // Race re-check — see news-media-object-directory.ts's
    // `objectKeyExistsForTenant` header for exactly why this MUST be a
    // fresh, targeted point lookup immediately before deleting, not a reuse
    // of the earlier bulk snapshot.
    const stillOrphan = !(await withTenant(
      sql,
      tenantId,
      (tx) => objectKeyExistsForTenant(tx, tenantId, entry.objectKey),
      { workClass: "maintenance" }
    ));

    if (!stillOrphan) {
      raceAverted += 1;
      continue;
    }

    const deleteResult = await r2Client.deleteObject(entry.objectKey);

    if (deleteResult.ok) {
      deleted += 1;
    } else {
      deferred += 1;
    }
  }

  return { deleted, raceAverted, deferred };
}

const REPORTED_ORPHAN_IN_R2_LIMIT = 100;

/**
 * Reconciles ONE tenant's news media DB metadata against its R2 bucket
 * contents. Read-only (categorization + reporting) when `options.dryRun` is
 * `true`; otherwise performs the bounded cleanup described in this file's
 * header. Never throws for a provider-side failure (see header) — a
 * database-side failure (a real bug, connection loss mid-transaction, etc.)
 * DOES propagate, same as every other `withTenant`-based job in this repo.
 */
export async function reconcileNewsMediaForTenant(
  sql: Bun.SQL,
  tenantId: string,
  config: NewsMediaR2Config,
  r2Client: NewsMediaR2Client,
  options: NewsMediaReconciliationOptions = {}
): Promise<NewsMediaTenantReconciliationResult> {
  const now = options.now ?? new Date();
  const dryRun = options.dryRun ?? false;
  const signal = options.signal;

  const snapshotRows = await withTenant(
    sql,
    tenantId,
    (tx) => fetchNewsMediaObjectsForReconciliation(tx, tenantId),
    { workClass: "maintenance" }
  );
  const dbSnapshotTruncated =
    snapshotRows.length >= NEWS_MEDIA_RECONCILIATION_SNAPSHOT_LIMIT;

  const listResult = await listAllNewsMediaObjectsForTenant(
    r2Client,
    tenantId,
    signal,
    options.pageSize
  );

  if (!listResult.ok) {
    return {
      tenantId,
      dryRun,
      dbSnapshotTruncated,
      r2ListTruncated: false,
      r2ListFailed: true,
      r2ListError: listResult.error,
      healthyCount: 0,
      orphanInDb: [],
      expiredPending: { total: 0, deleted: 0, racedSkipped: 0, deferred: 0 },
      staleOrphaned: { total: 0, deleted: 0, deferred: 0 },
      orphanInR2: {
        total: 0,
        eligible: 0,
        deleted: 0,
        raceAverted: 0,
        deferred: 0,
        reported: []
      }
    };
  }

  const categorized = categorizeNewsMediaReconciliation({
    dbRows: snapshotRows.map(toReconciliationDbRow),
    r2Objects: listResult.objects,
    now,
    pendingTtlMinutes: config.pendingTtlMinutes,
    orphanGraceDays: config.orphanGraceDays
  });

  const pendingCutoff = new Date(
    now.getTime() - config.pendingTtlMinutes * 60_000
  );
  const orphanCutoff = new Date(
    now.getTime() - config.orphanGraceDays * 24 * 60 * 60 * 1000
  );

  if (dryRun) {
    return {
      tenantId,
      dryRun,
      dbSnapshotTruncated,
      r2ListTruncated: listResult.truncated,
      r2ListFailed: false,
      healthyCount: categorized.healthy.length,
      orphanInDb: categorized.orphanInDb,
      expiredPending: {
        total: categorized.expiredPending.length,
        deleted: 0,
        racedSkipped: 0,
        deferred: 0
      },
      staleOrphaned: {
        total: categorized.staleOrphaned.length,
        deleted: 0,
        deferred: 0
      },
      orphanInR2: {
        total: categorized.orphanInR2.length,
        eligible: categorized.orphanInR2.filter((entry) =>
          isOrphanInR2EligibleForDeletion(entry, config.orphanGraceDays)
        ).length,
        deleted: 0,
        raceAverted: 0,
        deferred: 0,
        reported: categorized.orphanInR2.slice(0, REPORTED_ORPHAN_IN_R2_LIMIT)
      }
    };
  }

  const expiredPendingResult = await cleanupExpiredPending(
    sql,
    tenantId,
    categorized.expiredPending,
    pendingCutoff,
    r2Client,
    signal
  );

  const staleOrphanedResult = await cleanupStaleOrphaned(
    sql,
    tenantId,
    categorized.staleOrphaned,
    orphanCutoff,
    r2Client,
    signal
  );

  const orphanInR2Result = await cleanupOrphanInR2(
    sql,
    tenantId,
    categorized.orphanInR2,
    config.orphanGraceDays,
    r2Client,
    signal
  );

  return {
    tenantId,
    dryRun,
    dbSnapshotTruncated,
    r2ListTruncated: listResult.truncated,
    r2ListFailed: false,
    healthyCount: categorized.healthy.length,
    orphanInDb: categorized.orphanInDb,
    expiredPending: {
      total: categorized.expiredPending.length,
      ...expiredPendingResult
    },
    staleOrphaned: {
      total: categorized.staleOrphaned.length,
      ...staleOrphanedResult
    },
    orphanInR2: {
      total: categorized.orphanInR2.length,
      eligible: categorized.orphanInR2.filter((entry) =>
        isOrphanInR2EligibleForDeletion(entry, config.orphanGraceDays)
      ).length,
      ...orphanInR2Result,
      reported: categorized.orphanInR2.slice(0, REPORTED_ORPHAN_IN_R2_LIMIT)
    }
  };
}

export type NewsMediaReconciliationTotals = {
  tenantsChecked: number;
  tenantsWithR2ListFailure: number;
  tenantsWithTruncatedSnapshot: number;
  healthy: number;
  orphanInDb: number;
  expiredPendingTotal: number;
  expiredPendingDeleted: number;
  expiredPendingRacedSkipped: number;
  expiredPendingDeferred: number;
  staleOrphanedTotal: number;
  staleOrphanedDeleted: number;
  staleOrphanedDeferred: number;
  orphanInR2Total: number;
  orphanInR2Eligible: number;
  orphanInR2Deleted: number;
  orphanInR2RaceAverted: number;
  orphanInR2Deferred: number;
};

export type NewsMediaReconciliationSummary = {
  totals: NewsMediaReconciliationTotals;
  tenantResults: NewsMediaTenantReconciliationResult[];
  /** `true` if `signal` aborted before every active tenant was processed — the remaining tenants get a fresh attempt on the NEXT scheduled run, same "cooperative, bounded" cancellation model as `iterateTenantsInBatches`. */
  aborted: boolean;
};

function emptyTotals(): NewsMediaReconciliationTotals {
  return {
    tenantsChecked: 0,
    tenantsWithR2ListFailure: 0,
    tenantsWithTruncatedSnapshot: 0,
    healthy: 0,
    orphanInDb: 0,
    expiredPendingTotal: 0,
    expiredPendingDeleted: 0,
    expiredPendingRacedSkipped: 0,
    expiredPendingDeferred: 0,
    staleOrphanedTotal: 0,
    staleOrphanedDeleted: 0,
    staleOrphanedDeferred: 0,
    orphanInR2Total: 0,
    orphanInR2Eligible: 0,
    orphanInR2Deleted: 0,
    orphanInR2RaceAverted: 0,
    orphanInR2Deferred: 0
  };
}

/**
 * Reconciles EVERY active tenant, one at a time (never more than one
 * tenant's worth of R2 listing/cleanup in flight at once — same "bounded,
 * sequential" shape `iterateTenantsInBatches` uses elsewhere). A single
 * tenant's R2 outage (`r2ListFailed`) is recorded in that tenant's own
 * result and in `totals.tenantsWithR2ListFailure`, but never stops the loop
 * — every other tenant still gets processed this run.
 */
export async function reconcileNewsMediaForAllTenants(
  sql: Bun.SQL,
  config: NewsMediaR2Config,
  r2Client: NewsMediaR2Client,
  options: NewsMediaReconciliationOptions = {}
): Promise<NewsMediaReconciliationSummary> {
  const tenants = await fetchActiveTenants(sql);
  const totals = emptyTotals();
  const tenantResults: NewsMediaTenantReconciliationResult[] = [];
  let aborted = false;

  for (const tenant of tenants) {
    if (options.signal?.aborted) {
      aborted = true;
      break;
    }

    const result = await reconcileNewsMediaForTenant(
      sql,
      tenant.id,
      config,
      r2Client,
      options
    );

    tenantResults.push(result);

    totals.tenantsChecked += 1;
    if (result.r2ListFailed) totals.tenantsWithR2ListFailure += 1;
    if (result.dbSnapshotTruncated) totals.tenantsWithTruncatedSnapshot += 1;
    totals.healthy += result.healthyCount;
    totals.orphanInDb += result.orphanInDb.length;
    totals.expiredPendingTotal += result.expiredPending.total;
    totals.expiredPendingDeleted += result.expiredPending.deleted;
    totals.expiredPendingRacedSkipped += result.expiredPending.racedSkipped;
    totals.expiredPendingDeferred += result.expiredPending.deferred;
    totals.staleOrphanedTotal += result.staleOrphaned.total;
    totals.staleOrphanedDeleted += result.staleOrphaned.deleted;
    totals.staleOrphanedDeferred += result.staleOrphaned.deferred;
    totals.orphanInR2Total += result.orphanInR2.total;
    totals.orphanInR2Eligible += result.orphanInR2.eligible;
    totals.orphanInR2Deleted += result.orphanInR2.deleted;
    totals.orphanInR2RaceAverted += result.orphanInR2.raceAverted;
    totals.orphanInR2Deferred += result.orphanInR2.deferred;
  }

  return { totals, tenantResults, aborted };
}
