import { describe, expect, test } from "bun:test";

import {
  categorizeNewsMediaReconciliation,
  isOrphanInR2EligibleForDeletion,
  type NewsMediaReconciliationDbRow,
  type NewsMediaReconciliationR2Object
} from "../src/modules/news-portal/domain/news-media-reconciliation-categorization";

const NOW = new Date("2026-07-12T00:00:00.000Z");
const PENDING_TTL_MINUTES = 60;
const ORPHAN_GRACE_DAYS = 30;

function row(
  overrides: Partial<NewsMediaReconciliationDbRow> & { objectKey: string }
): NewsMediaReconciliationDbRow {
  return {
    id: overrides.objectKey,
    status: "verified",
    createdAt: NOW,
    orphanedAt: null,
    deletedAt: null,
    ...overrides
  };
}

function categorize(
  dbRows: NewsMediaReconciliationDbRow[],
  r2Objects: NewsMediaReconciliationR2Object[]
) {
  return categorizeNewsMediaReconciliation({
    dbRows,
    r2Objects,
    now: NOW,
    pendingTtlMinutes: PENDING_TTL_MINUTES,
    orphanGraceDays: ORPHAN_GRACE_DAYS
  });
}

describe("categorizeNewsMediaReconciliation (Issue #690)", () => {
  test("healthy: an attached row whose object exists in R2", () => {
    const result = categorize(
      [row({ objectKey: "k1", status: "attached" })],
      [{ key: "k1" }]
    );

    expect(result.healthy).toEqual([{ id: "k1", objectKey: "k1" }]);
    expect(result.orphanInDb).toHaveLength(0);
    expect(result.orphanInR2).toHaveLength(0);
  });

  test("orphan-in-db: an attached row whose object is missing from R2 — report only", () => {
    const createdAt = new Date(NOW.getTime() - 5 * 24 * 60 * 60 * 1000);
    const result = categorize(
      [row({ objectKey: "k1", status: "attached", createdAt })],
      []
    );

    expect(result.orphanInDb).toEqual([
      { id: "k1", objectKey: "k1", status: "attached", ageDays: 5 }
    ]);
    expect(result.healthy).toHaveLength(0);
  });

  test("orphan-in-db never includes a pending_upload/failed/orphaned/deleted row (only uploaded/verified/attached)", () => {
    const result = categorize(
      [
        row({ objectKey: "pending", status: "pending_upload" }),
        row({ objectKey: "failed", status: "failed" }),
        row({
          objectKey: "orphaned",
          status: "orphaned",
          orphanedAt: NOW
        }),
        row({
          objectKey: "deleted",
          status: "attached",
          deletedAt: NOW
        })
      ],
      []
    );

    expect(result.orphanInDb).toHaveLength(0);
  });

  test("expired-pending: a pending_upload row past the TTL is included, a fresh one is not", () => {
    const staleCreatedAt = new Date(
      NOW.getTime() - (PENDING_TTL_MINUTES + 1) * 60_000
    );
    const freshCreatedAt = new Date(
      NOW.getTime() - (PENDING_TTL_MINUTES - 1) * 60_000
    );

    const result = categorize(
      [
        row({
          objectKey: "stale",
          status: "pending_upload",
          createdAt: staleCreatedAt
        }),
        row({
          objectKey: "fresh",
          status: "pending_upload",
          createdAt: freshCreatedAt
        })
      ],
      []
    );

    expect(result.expiredPending.map((entry) => entry.objectKey)).toEqual([
      "stale"
    ]);
  });

  test("expired-pending: includes 'uploaded' and already-'failed' rows past the TTL (retry-on-rerun)", () => {
    const staleCreatedAt = new Date(
      NOW.getTime() - (PENDING_TTL_MINUTES + 1) * 60_000
    );

    const result = categorize(
      [
        row({
          objectKey: "uploaded-stale",
          status: "uploaded",
          createdAt: staleCreatedAt
        }),
        row({
          objectKey: "failed-stale",
          status: "failed",
          createdAt: staleCreatedAt
        })
      ],
      []
    );

    expect(
      result.expiredPending.map((entry) => entry.objectKey).sort()
    ).toEqual(["failed-stale", "uploaded-stale"]);
  });

  test("mutual exclusivity (security-auditor Medium finding on PR #718): a stale 'uploaded' row past the TTL is expiredPending ONLY — never simultaneously counted as healthy or orphan-in-db, even when its R2 object exists or is missing", () => {
    const staleCreatedAt = new Date(
      NOW.getTime() - (PENDING_TTL_MINUTES + 1) * 60_000
    );

    // Case A: R2 object present — would satisfy "healthy" if not excluded.
    const withObject = categorize(
      [
        row({
          objectKey: "uploaded-stale-with-object",
          status: "uploaded",
          createdAt: staleCreatedAt
        })
      ],
      [{ key: "uploaded-stale-with-object" }]
    );
    expect(withObject.expiredPending.map((e) => e.objectKey)).toEqual([
      "uploaded-stale-with-object"
    ]);
    expect(withObject.healthy).toHaveLength(0);
    expect(withObject.orphanInDb).toHaveLength(0);

    // Case B: R2 object missing — would satisfy "orphan-in-db" if not excluded.
    const withoutObject = categorize(
      [
        row({
          objectKey: "uploaded-stale-without-object",
          status: "uploaded",
          createdAt: staleCreatedAt
        })
      ],
      []
    );
    expect(withoutObject.expiredPending.map((e) => e.objectKey)).toEqual([
      "uploaded-stale-without-object"
    ]);
    expect(withoutObject.healthy).toHaveLength(0);
    expect(withoutObject.orphanInDb).toHaveLength(0);
  });

  test("expired-pending never includes an already soft-deleted row", () => {
    const staleCreatedAt = new Date(
      NOW.getTime() - (PENDING_TTL_MINUTES + 1) * 60_000
    );

    const result = categorize(
      [
        row({
          objectKey: "deleted-stale",
          status: "pending_upload",
          createdAt: staleCreatedAt,
          deletedAt: NOW
        })
      ],
      []
    );

    expect(result.expiredPending).toHaveLength(0);
  });

  test("stale-orphaned: an orphaned row past the grace period is included, a fresh one is not", () => {
    const staleOrphanedAt = new Date(
      NOW.getTime() - (ORPHAN_GRACE_DAYS + 1) * 24 * 60 * 60 * 1000
    );
    const freshOrphanedAt = new Date(
      NOW.getTime() - (ORPHAN_GRACE_DAYS - 1) * 24 * 60 * 60 * 1000
    );

    const result = categorize(
      [
        row({
          objectKey: "stale-orphan",
          status: "orphaned",
          orphanedAt: staleOrphanedAt
        }),
        row({
          objectKey: "fresh-orphan",
          status: "orphaned",
          orphanedAt: freshOrphanedAt
        })
      ],
      []
    );

    expect(result.staleOrphaned.map((entry) => entry.objectKey)).toEqual([
      "stale-orphan"
    ]);
  });

  test("orphan-in-r2: an R2 object with no matching DB row at all (any status) is flagged", () => {
    const result = categorize(
      [row({ objectKey: "tracked", status: "attached" })],
      [{ key: "tracked" }, { key: "untracked", sizeBytes: 42 }]
    );

    expect(result.orphanInR2).toEqual([
      { objectKey: "untracked", sizeBytes: 42, ageDays: null }
    ]);
  });

  test("orphan-in-r2: a row in ANY status (even deleted/failed/orphaned) counts as tracked, not orphan-in-r2", () => {
    const result = categorize(
      [
        row({ objectKey: "soft-deleted", status: "attached", deletedAt: NOW }),
        row({ objectKey: "failed-row", status: "failed" }),
        row({ objectKey: "orphaned-row", status: "orphaned", orphanedAt: NOW })
      ],
      [{ key: "soft-deleted" }, { key: "failed-row" }, { key: "orphaned-row" }]
    );

    expect(result.orphanInR2).toHaveLength(0);
  });

  test("orphan-in-r2: ageDays is computed from R2's own lastModified, not from any DB timestamp", () => {
    const lastModified = new Date(
      NOW.getTime() - 40 * 24 * 60 * 60 * 1000
    ).toISOString();

    const result = categorize([], [{ key: "untracked", lastModified }]);

    expect(result.orphanInR2[0]?.ageDays).toBeCloseTo(40, 0);
  });

  test("orphan-in-r2: a missing/unparseable lastModified yields ageDays: null, never eligible for deletion", () => {
    const result = categorize([], [{ key: "no-timestamp" }]);

    expect(result.orphanInR2[0]?.ageDays).toBeNull();
    expect(
      isOrphanInR2EligibleForDeletion(result.orphanInR2[0]!, ORPHAN_GRACE_DAYS)
    ).toBe(false);
  });

  test("isOrphanInR2EligibleForDeletion: true only once age reaches orphanGraceDays", () => {
    const almostEligible = {
      objectKey: "k",
      ageDays: ORPHAN_GRACE_DAYS - 0.01
    };
    const eligible = { objectKey: "k", ageDays: ORPHAN_GRACE_DAYS };

    expect(
      isOrphanInR2EligibleForDeletion(almostEligible, ORPHAN_GRACE_DAYS)
    ).toBe(false);
    expect(isOrphanInR2EligibleForDeletion(eligible, ORPHAN_GRACE_DAYS)).toBe(
      true
    );
  });

  test("race condition: a row created moments before reconciliation runs is never miscategorized as orphan-in-r2", () => {
    // Simulates: client calls createPendingNewsMediaObject() (INSERT) and
    // completes the R2 PUT a moment before this run's DB snapshot + R2
    // listing were taken — both now see the row/object as present.
    const justCreated = new Date(NOW.getTime() - 1000);

    const result = categorize(
      [
        row({
          objectKey: "brand-new",
          status: "uploaded",
          createdAt: justCreated
        })
      ],
      [{ key: "brand-new", lastModified: justCreated.toISOString() }]
    );

    expect(result.orphanInR2).toHaveLength(0);
    expect(result.healthy).toEqual([
      { id: "brand-new", objectKey: "brand-new" }
    ]);
    expect(result.expiredPending).toHaveLength(0);
  });

  test("idempotent: categorizing the same snapshot twice yields identical results", () => {
    const dbRows = [
      row({ objectKey: "a", status: "attached" }),
      row({
        objectKey: "b",
        status: "pending_upload",
        createdAt: new Date(NOW.getTime() - 10 * 60 * 60 * 1000)
      })
    ];
    const r2Objects = [{ key: "a" }, { key: "c" }];

    const first = categorize(dbRows, r2Objects);
    const second = categorize(dbRows, r2Objects);

    expect(second).toEqual(first);
  });
});
