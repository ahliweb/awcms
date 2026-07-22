/**
 * Pure categorization logic for the R2 media lifecycle cleanup &
 * reconciliation job (Issue #690, epic #679 platform-hardening — "runtime/
 * worker hardening" wave, following #691/#689/#694/#695/#687/#697). No I/O
 * at all (no DB, no R2, no `process.env`) — `scripts/news-media-r2-
 * reconcile.ts`'s application-layer orchestration
 * (`news-media-reconciliation.ts`) is what gathers the inputs below (a
 * DB row snapshot via `news-media-object-directory.ts`'s fetch helpers, and
 * an R2 bucket listing via `news-media-r2-client.ts`'s paginated
 * `listObjects`) and calls this module to decide what belongs in which
 * category. Kept pure specifically so every category boundary (the exact
 * question this job's acceptance criteria/tests care about) can be tested
 * deterministically against synthetic inputs, without a real Postgres/R2
 * fake server — same "decision logic separated from I/O" convention as
 * `news-media-finalize-decision.ts`.
 *
 * ## The five categories
 *
 * - **healthy** — an `uploaded`/`verified`/`attached` row whose object key
 *   IS present in the R2 listing. No action.
 * - **orphanInDb** — an `uploaded`/`verified`/`attached` row whose object
 *   key is MISSING from the R2 listing (the DB thinks the object should
 *   exist; R2 disagrees). REPORT-ONLY, forever — this job never mutates
 *   these rows. In particular an `attached` row may be actively referenced
 *   by published content; auto-transitioning it (e.g. to `failed`) without
 *   a human decision is exactly the kind of silent, surprising mutation
 *   this job must never perform. Remediation (re-upload, unlink, manual
 *   investigation) is an operator decision — see
 *   `docs/awcms-mini/news-portal/r2-backup-lifecycle.md`'s operator SOP
 *   section.
 * - **expiredPending** — a `pending_upload`/`uploaded`/`failed` row, not yet
 *   soft-deleted, older than `pendingTtlMinutes`
 *   (`NEWS_MEDIA_R2_PENDING_TTL_MINUTES`). Eligible for R2-object-delete +
 *   DB hard-delete (`r2-backup-lifecycle.md` §2: a row that never became a
 *   real resource). `failed` rows are included alongside
 *   `pending_upload`/`uploaded` so a previous run's R2-delete failure
 *   (provider outage) is retried on the next run — see this module's own
 *   idempotency note below.
 * - **staleOrphaned** — a `status = 'orphaned'` row, not yet soft-deleted,
 *   whose `orphanedAt` is older than `orphanGraceDays`
 *   (`NEWS_MEDIA_R2_ORPHAN_GRACE_DAYS`). Eligible for R2-object-delete +
 *   DB soft-delete (`r2-backup-lifecycle.md` §3's retention table).
 * - **orphanInR2** — an R2 object whose key has NO matching DB row AT ALL
 *   (any status, any `deletedAt`) for this tenant. Eligible for physical R2
 *   deletion once its OWN age (R2's reported `lastModified`, the only
 *   timestamp available — there is no DB row) exceeds `orphanGraceDays`.
 *   This category only exists because `purgeNewsMediaObject` (hard delete)
 *   does not itself delete the R2 object — a known, accepted gap this job
 *   closes asynchronously rather than by changing that endpoint's
 *   transaction semantics (ADR-0006: R2 calls never happen inside a DB
 *   transaction, and purge's own request/response cycle is not the place
 *   to add a synchronous cross-provider call). An object without a
 *   `lastModified` (should not happen in practice) is conservatively never
 *   included — this job would rather leave a truly-ancient untracked object
 *   alone than mis-delete based on missing metadata.
 *
 * ## Idempotency
 *
 * Categorizing the SAME snapshot twice always produces the SAME five lists
 * — this function has no side effects and no hidden state. Real-world
 * idempotency across ACTUAL job runs (`bun run news-media:reconcile` twice
 * in a row doing nothing the second time) additionally depends on the
 * application layer's mutations actually converging (deleting a row/object
 * removes it from the NEXT run's candidate snapshot) — see
 * `news-media-reconciliation.ts`'s own header for that half of the
 * guarantee.
 *
 * ## The race-condition guarantee (critical acceptance criterion)
 *
 * This module's OWN output is never itself unsafe to act on for
 * `orphanInR2` MERELY because it's a point-in-time snapshot — the
 * application layer (not this file) is responsible for re-verifying each
 * `orphanInR2` candidate immediately before deleting it
 * (`objectKeyExistsForTenant`, a targeted point lookup, NOT this bulk
 * categorization) to close the window between "when this snapshot was
 * taken" and "when the delete actually happens". This module cannot, by
 * itself, guarantee that — it only guarantees that a snapshot which
 * genuinely had no matching DB row at scan time is correctly categorized as
 * `orphanInR2`, nothing about what happens microseconds later.
 */

export type NewsMediaReconciliationDbRow = {
  id: string;
  objectKey: string;
  status:
    | "pending_upload"
    | "uploaded"
    | "verified"
    | "attached"
    | "orphaned"
    | "deleted"
    | "failed";
  createdAt: Date;
  orphanedAt: Date | null;
  deletedAt: Date | null;
};

export type NewsMediaReconciliationR2Object = {
  key: string;
  sizeBytes?: number;
  /** ISO 8601 string, as reported by R2's own `LastModified` field. */
  lastModified?: string;
};

export type NewsMediaReconciliationInput = {
  /** Every non-purged DB row for one tenant (any status, including already-soft-deleted — needed so `orphanInR2` can tell "genuinely no row" apart from "there IS a row, just not one of the expected-present statuses"). */
  dbRows: NewsMediaReconciliationDbRow[];
  /** The full, already-paginated-and-merged R2 listing for this tenant's own key prefix. */
  r2Objects: NewsMediaReconciliationR2Object[];
  now: Date;
  pendingTtlMinutes: number;
  orphanGraceDays: number;
};

export type NewsMediaHealthyEntry = { id: string; objectKey: string };

export type NewsMediaOrphanInDbEntry = {
  id: string;
  objectKey: string;
  status: NewsMediaReconciliationDbRow["status"];
  ageDays: number;
};

export type NewsMediaExpiredPendingEntry = {
  id: string;
  objectKey: string;
  status: NewsMediaReconciliationDbRow["status"];
  ageMinutes: number;
};

export type NewsMediaStaleOrphanedEntry = {
  id: string;
  objectKey: string;
  ageDays: number;
};

export type NewsMediaOrphanInR2Entry = {
  objectKey: string;
  sizeBytes?: number;
  /** `null` when the object has no usable age signal (missing/unparseable `lastModified`) — never eligible for deletion regardless of `orphanGraceDays`. */
  ageDays: number | null;
};

export type NewsMediaReconciliationResult = {
  healthy: NewsMediaHealthyEntry[];
  orphanInDb: NewsMediaOrphanInDbEntry[];
  expiredPending: NewsMediaExpiredPendingEntry[];
  staleOrphaned: NewsMediaStaleOrphanedEntry[];
  orphanInR2: NewsMediaOrphanInR2Entry[];
};

const EXPECTED_PRESENT_STATUSES = new Set<
  NewsMediaReconciliationDbRow["status"]
>(["uploaded", "verified", "attached"]);

const EXPIRED_PENDING_STATUSES = new Set<
  NewsMediaReconciliationDbRow["status"]
>(["pending_upload", "uploaded", "failed"]);

function ageInDays(from: Date, now: Date): number {
  return Math.max(0, (now.getTime() - from.getTime()) / (24 * 60 * 60 * 1000));
}

function ageInMinutes(from: Date, now: Date): number {
  return Math.max(0, (now.getTime() - from.getTime()) / (60 * 1000));
}

/** `null` for missing/unparseable `lastModified` — never a NaN that would silently satisfy a numeric comparison. */
function r2ObjectAgeInDays(
  lastModified: string | undefined,
  now: Date
): number | null {
  if (!lastModified) return null;

  const parsed = new Date(lastModified);
  if (Number.isNaN(parsed.getTime())) return null;

  return ageInDays(parsed, now);
}

/**
 * Categorizes one tenant's DB rows + R2 listing snapshot into the five
 * lifecycle categories described in this module's header. Deterministic and
 * side-effect-free.
 */
export function categorizeNewsMediaReconciliation(
  input: NewsMediaReconciliationInput
): NewsMediaReconciliationResult {
  const { dbRows, r2Objects, now, pendingTtlMinutes, orphanGraceDays } = input;

  const r2KeySet = new Set(r2Objects.map((object) => object.key));
  const dbKeySet = new Set(dbRows.map((row) => row.objectKey));

  const pendingCutoff = new Date(now.getTime() - pendingTtlMinutes * 60_000);
  const orphanCutoff = new Date(
    now.getTime() - orphanGraceDays * 24 * 60 * 60 * 1000
  );

  const healthy: NewsMediaHealthyEntry[] = [];
  const orphanInDb: NewsMediaOrphanInDbEntry[] = [];
  const expiredPending: NewsMediaExpiredPendingEntry[] = [];
  const staleOrphaned: NewsMediaStaleOrphanedEntry[] = [];

  for (const row of dbRows) {
    // Security-auditor Medium finding on PR #718: `"uploaded"` is a member
    // of BOTH `EXPECTED_PRESENT_STATUSES` (healthy/orphanInDb) and
    // `EXPIRED_PENDING_STATUSES` (expiredPending) — without this guard, a
    // single `status='uploaded'` row past `pendingTtlMinutes` was counted
    // in BOTH lists at once: reported as "healthy: no action" (or
    // "orphanInDb: never mutated") in the same run this job actually
    // claims it into `expiredPending` and deletes it, contradicting this
    // module's own documented invariant for those two categories. Compute
    // the expiredPending membership once and gate the first block on NOT
    // being expiredPending, so every row lands in exactly one category.
    const isExpiredPending =
      row.deletedAt === null &&
      EXPIRED_PENDING_STATUSES.has(row.status) &&
      row.createdAt < pendingCutoff;

    if (
      row.deletedAt === null &&
      !isExpiredPending &&
      EXPECTED_PRESENT_STATUSES.has(row.status)
    ) {
      if (r2KeySet.has(row.objectKey)) {
        healthy.push({ id: row.id, objectKey: row.objectKey });
      } else {
        orphanInDb.push({
          id: row.id,
          objectKey: row.objectKey,
          status: row.status,
          ageDays: ageInDays(row.createdAt, now)
        });
      }
    }

    if (isExpiredPending) {
      expiredPending.push({
        id: row.id,
        objectKey: row.objectKey,
        status: row.status,
        ageMinutes: ageInMinutes(row.createdAt, now)
      });
    }

    if (
      row.deletedAt === null &&
      row.status === "orphaned" &&
      row.orphanedAt !== null &&
      row.orphanedAt < orphanCutoff
    ) {
      staleOrphaned.push({
        id: row.id,
        objectKey: row.objectKey,
        ageDays: ageInDays(row.orphanedAt, now)
      });
    }
  }

  const orphanInR2: NewsMediaOrphanInR2Entry[] = r2Objects
    .filter((object) => !dbKeySet.has(object.key))
    .map((object) => ({
      objectKey: object.key,
      sizeBytes: object.sizeBytes,
      ageDays: r2ObjectAgeInDays(object.lastModified, now)
    }));

  return { healthy, orphanInDb, expiredPending, staleOrphaned, orphanInR2 };
}

/** `true` iff `entry.ageDays` is known AND at least `orphanGraceDays` — the deletion-eligibility gate for `orphanInR2` entries (application layer still re-verifies via `objectKeyExistsForTenant` immediately before acting). */
export function isOrphanInR2EligibleForDeletion(
  entry: NewsMediaOrphanInR2Entry,
  orphanGraceDays: number
): boolean {
  return entry.ageDays !== null && entry.ageDays >= orphanGraceDays;
}
