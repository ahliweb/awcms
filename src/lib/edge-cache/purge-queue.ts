/**
 * Durable purge-queue operations — ADR-0042 §9.
 *
 * Split from the worker script so the SQL is testable and so content modules can
 * enqueue without importing anything worker-shaped.
 *
 * ## The one rule for callers of `enqueueEdgeCachePurge`
 *
 * Pass the **content transaction**, not a fresh client. The enqueue must commit
 * with the change it invalidates. Enqueue in a separate transaction and you get
 * both failure modes: an invalidation for a publish that rolled back (harmless
 * but confusing) and, far worse, a committed publish whose invalidation was lost
 * — content that stays stale at the edge with nothing left to retry it.
 *
 * This is the same outbox discipline ADR-0006 applies to sync, for the same
 * reason.
 */
import type { LegalHoldGuardPort } from "../../modules/_shared/ports/legal-hold-guard-port";
import {
  EDGE_CACHE_DONE_RETENTION_DAYS,
  EDGE_CACHE_FAILED_RETENTION_DAYS,
  EDGE_CACHE_PURGES_LIFECYCLE_KEY
} from "../../modules/data-lifecycle/domain/infrastructure-lifecycle-registry";

import { buildSurrogateKey, type SurrogateKeyScope } from "./surrogate-keys";

/** Minimal transaction shape — a tagged-template SQL executor. */
export type SqlExecutor = {
  <T = unknown>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T>;
  array?: (values: unknown[], type: string) => unknown;
};

export type EdgeCachePurgeRow = {
  id: string;
  tenant_id: string;
  surrogate_key: string;
  attempts: number;
};

/**
 * How long a worker holds a claimed row before another worker may retry it.
 * Comfortably longer than the HTTP timeout on a BAN so a slow-but-alive send is
 * not duplicated, short enough that a crashed worker's backlog moves within a
 * minute.
 */
export const PURGE_LEASE_SECONDS = 60;

/** Give up after this many attempts; the row parks in `failed` for an operator. */
export const PURGE_MAX_ATTEMPTS = 5;

/**
 * Enqueue invalidations for a set of scopes, in the caller's transaction.
 *
 * Duplicate keys inside one call are collapsed — publishing a post naturally
 * produces the same tenant-scope key several times, and banning it repeatedly
 * costs Varnish real work (every ban is evaluated against every object until it
 * is lurker-collected).
 */
export async function enqueueEdgeCachePurge(
  tx: SqlExecutor,
  tenantId: string,
  scopes: readonly SurrogateKeyScope[],
  reason: string
): Promise<number> {
  const keys = [...new Set(scopes.map((scope) => buildSurrogateKey(scope)))];

  if (keys.length === 0) {
    return 0;
  }

  await tx`
    INSERT INTO awcms_edge_cache_purges (tenant_id, surrogate_key, reason)
    SELECT ${tenantId}, unnest(${keys}::text[]), ${reason}
  `;

  return keys.length;
}

/**
 * Atomically claim a batch of due rows for this worker.
 *
 * The claim is a single `UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED)
 * RETURNING`, which is what makes it safe to run several workers: `SKIP LOCKED`
 * hands each worker a disjoint set instead of making them queue behind each
 * other, and doing the read and the lease-write in one statement leaves no
 * window where a row is selected but not yet claimed.
 *
 * A read-then-update in two statements would let two workers select the same row
 * and both send the same ban — wasteful rather than incorrect, but the atomic
 * form costs nothing extra.
 */
export async function claimEdgeCachePurges(
  tx: SqlExecutor,
  tenantId: string,
  limit: number,
  now: Date
): Promise<EdgeCachePurgeRow[]> {
  const leaseExpiry = new Date(now.getTime() + PURGE_LEASE_SECONDS * 1_000);

  return (await tx`
    UPDATE awcms_edge_cache_purges
    SET status = 'in_progress',
        attempts = attempts + 1,
        lease_expires_at = ${leaseExpiry},
        updated_at = ${now}
    WHERE id IN (
      SELECT id
      FROM awcms_edge_cache_purges
      WHERE tenant_id = ${tenantId}
        AND (
          status = 'pending'
          OR (status = 'in_progress' AND lease_expires_at < ${now})
        )
        AND attempts < ${PURGE_MAX_ATTEMPTS}
      ORDER BY created_at
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, tenant_id, surrogate_key, attempts
  `) as EdgeCachePurgeRow[];
}

export async function markEdgeCachePurgeDone(
  tx: SqlExecutor,
  purgeId: string,
  now: Date
): Promise<void> {
  await tx`
    UPDATE awcms_edge_cache_purges
    SET status = 'done',
        completed_at = ${now},
        updated_at = ${now},
        last_error = NULL,
        lease_expires_at = NULL
    WHERE id = ${purgeId}
  `;
}

/**
 * Record a failed attempt. Rows that have exhausted `PURGE_MAX_ATTEMPTS` move to
 * `failed` and stop being claimed; everything else returns to `pending` for the
 * next pass.
 *
 * `left(…, 500)` bounds the stored error: the message can carry an upstream
 * response body, and an unbounded column here would let a misbehaving edge fill
 * the table.
 */
export async function markEdgeCachePurgeFailed(
  tx: SqlExecutor,
  purgeId: string,
  errorDetail: string,
  now: Date,
  /**
   * True for a failure that cannot succeed on retry — a missing endpoint, a
   * rejected token, an unsafe key. Such a row parks in `failed` immediately
   * instead of burning five attempts, so the operator sees the real cause
   * rather than a generic exhausted-retries row.
   */
  terminal = false
): Promise<void> {
  await tx`
    UPDATE awcms_edge_cache_purges
    SET status = CASE
          WHEN ${terminal} OR attempts >= ${PURGE_MAX_ATTEMPTS} THEN 'failed'
          ELSE 'pending'
        END,
        last_error = left(${errorDetail}, 500),
        updated_at = ${now},
        lease_expires_at = NULL
    WHERE id = ${purgeId}
  `;
}

/**
 * Prune completed rows older than the retention window.
 *
 * `failed` rows are NOT touched here — see `pruneFailedEdgeCachePurges`, which
 * bounds them on a far longer window and for a different reason.
 */
export async function pruneCompletedEdgeCachePurges(
  tx: SqlExecutor,
  tenantId: string,
  olderThan: Date,
  limit: number
): Promise<number> {
  const rows = (await tx`
    DELETE FROM awcms_edge_cache_purges
    WHERE id IN (
      SELECT id
      FROM awcms_edge_cache_purges
      WHERE tenant_id = ${tenantId}
        AND status = 'done'
        AND completed_at < ${olderThan}
      LIMIT ${limit}
    )
    RETURNING id
  `) as { id: string }[];

  return rows.length;
}

/**
 * Prune exhausted rows older than the long window (ADR-0076).
 *
 * ## Why these were kept forever, and why "forever" was still wrong
 *
 * A `failed` row is the only record that an invalidation never landed, and
 * deleting one early hides stale content from the operator who needs to know
 * about it. That reasoning is intact — it is what sets this window six months
 * out rather than seven days. What it does not support is keeping them without
 * end: the content whose invalidation failed has expired from the edge
 * thousands of times over by then, so the row has stopped being a work item and
 * become archaeology, while remaining the one class of row in this table that
 * nothing ever removes.
 *
 * Deliberately a SEPARATE function rather than a status list passed to the one
 * above. Two statuses with two windows and two justifications collapse badly
 * into one parameterised call: the next person to widen the "terminal" list
 * would silently give `failed` rows the seven-day window meant for `done`.
 *
 * Ordered on `created_at` rather than `completed_at` — an exhausted row never
 * completed, so `completed_at` is NULL and would exclude every row it was meant
 * to select.
 */
export async function pruneFailedEdgeCachePurges(
  tx: SqlExecutor,
  tenantId: string,
  olderThan: Date,
  limit: number
): Promise<number> {
  const rows = (await tx`
    DELETE FROM awcms_edge_cache_purges
    WHERE id IN (
      SELECT id
      FROM awcms_edge_cache_purges
      WHERE tenant_id = ${tenantId}
        AND status = 'failed'
        AND created_at < ${olderThan}
      LIMIT ${limit}
    )
    RETURNING id
  `) as { id: string }[];

  return rows.length;
}

export type EdgeCacheRetentionResult = {
  prunedCompleted: number;
  prunedFailed: number;
  heldByLegalHold: boolean;
};

/**
 * The retention entry point — legal hold first, then both terminal statuses
 * (ADR-0076).
 *
 * The guard lives INSIDE this function rather than at the worker script, for
 * the reason every other adopter puts it inside its own purge function: a check
 * a caller has to remember is a check the next caller forgets. `data_lifecycle`
 * never mutates a `delegated` table itself, so this is the only place a hold
 * over `edge_cache.purges` can be honoured — and a descriptor declaring
 * `legalHold.applicable: true` with nothing enforcing it would be precisely the
 * unenforced claim Issue #479 was filed about.
 *
 * A held tenant returns zeros rather than throwing: a hold is a normal state,
 * and the sending half of this job must keep running while it is in place.
 */
export async function pruneTerminalEdgeCachePurges(
  tx: Bun.SQL,
  tenantId: string,
  legalHoldGuard: LegalHoldGuardPort,
  options: { now: Date; limit: number }
): Promise<EdgeCacheRetentionResult> {
  if (
    await legalHoldGuard.isDescriptorHeld(
      tx,
      tenantId,
      EDGE_CACHE_PURGES_LIFECYCLE_KEY
    )
  ) {
    return { prunedCompleted: 0, prunedFailed: 0, heldByLegalHold: true };
  }

  const cutoff = (days: number) =>
    new Date(options.now.getTime() - days * 24 * 60 * 60 * 1_000);

  const prunedCompleted = await pruneCompletedEdgeCachePurges(
    tx,
    tenantId,
    cutoff(EDGE_CACHE_DONE_RETENTION_DAYS),
    options.limit
  );
  const prunedFailed = await pruneFailedEdgeCachePurges(
    tx,
    tenantId,
    cutoff(EDGE_CACHE_FAILED_RETENTION_DAYS),
    options.limit
  );

  return { prunedCompleted, prunedFailed, heldByLegalHold: false };
}
