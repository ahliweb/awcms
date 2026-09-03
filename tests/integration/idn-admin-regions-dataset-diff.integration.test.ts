/**
 * Dataset version comparison (Issue #766) against a real PostgreSQL —
 * `src/modules/idn-admin-regions/application/dataset-diff.ts`, `sql/150`.
 *
 * The activation confirm dialog on `/admin/idn-regions` used to offer nothing
 * but a version code, a row count, an import timestamp, and a source commit —
 * no way to tell whether a regency was split, a village renamed, or 400 codes
 * vanished because an upstream dump was truncated. This proves the read that
 * answers "what actually changes if I activate this?":
 *
 *   1. Per-tier counts on both sides are correct and independent of the
 *      OTHER side's row count.
 *   2. Codes added, codes removed, and codes whose name changed are each
 *      correct against a deliberately crafted before/after pair — not just
 *      "returns something", but the EXACT set.
 *   3. Every result is bounded: a page never exceeds its limit, and paging via
 *      the keyset cursor visits the whole set without repeating or dropping a
 *      row, against a fixture LARGER than the page limit — the same
 *      non-negotiable this repo's other pagination tests hold to (a bound
 *      proven against a one-row fixture proves nothing).
 *   4. Both read shapes are CONSTANT-QUERY regardless of how many rows the two
 *      datasets hold (`countQueries`), and `sql/150`'s two indexes genuinely
 *      COVER both query shapes.
 *
 *      That last one is deliberately not "the plan contains no Seq Scan". CI
 *      disproved that assertion: with two datasets in the table, one dataset is
 *      half the rows, and at that selectivity a sequential scan is correctly
 *      the cheaper plan. Asserting otherwise measures the planner's crossover
 *      threshold on CI hardware, which moves. What `sql/150` permanently owes
 *      us is an index PATH for each shape, so the planner is constrained with
 *      `enable_seqscan = off` and the plan must name an index that migration
 *      created.
 *
 *      The tier aggregate names its index exactly. The diff join accepts
 *      either, because CI settled that the planner prefers the NARROWER
 *      `(dataset_id, level)` index for a first page that reads the whole
 *      dataset — see that test for why, and for where the covering index does
 *      pay off.
 *
 * Skipped unless a real database is configured (see tests/integration/harness.ts).
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test
} from "bun:test";

import {
  getAdminSql,
  integrationEnabled,
  setupIntegrationDatabase,
  teardownIntegrationDatabase
} from "./harness";
import { countQueries } from "./query-budget";
import {
  commitDatasetImport,
  deriveDatasetCode,
  type DatasetImportPlan
} from "../../src/modules/idn-admin-regions/application/dataset-import";
import {
  diffDatasetsPage,
  getDatasetTierCounts,
  buildTierComparison,
  DATASET_DIFF_PAGE_LIMIT_DEFAULT,
  type DatasetDiffItem
} from "../../src/modules/idn-admin-regions/application/dataset-diff";
import { normalizeRegionRows } from "../../src/modules/idn-admin-regions/domain/region-normalization";

const suite = integrationEnabled ? describe : describe.skip;

/**
 * Runs a service function against the pooled admin connection — same
 * reasoning as `idn-admin-regions.integration.test.ts`'s `asTx`: nothing here
 * needs the caller to hold an explicit transaction, and `sql.begin(...)`
 * starved that suite's 4-connection pool.
 */
function asTx<T>(
  sql: Bun.SQL,
  fn: (tx: Bun.TransactionSQL) => Promise<T>
): Promise<T> {
  return fn(sql as unknown as Bun.TransactionSQL);
}

function planFor(
  suffix: string,
  rows: { code: string; name: string; lineNumber: number }[]
): DatasetImportPlan {
  const { regions } = normalizeRegionRows(rows);
  const countsByType: Record<string, number> = {};
  for (const region of regions) {
    countsByType[region.regionType] =
      (countsByType[region.regionType] ?? 0) + 1;
  }

  return {
    datasetCode: deriveDatasetCode(`commit${suffix}`, `sha256${suffix}`),
    sourceFile:
      "data/idn-admin-regions/upstream/cahyadsn-wilayah/db/wilayah.sql",
    sourceFileSha256: `sha256${suffix}`,
    sourceCommitSha: `commit${suffix}`,
    decreeReference: "Kepmendagri No 300.2.2-2138 Tahun 2025",
    rowCount: regions.length,
    countsByType,
    errors: [],
    regions
  };
}

/**
 * The "before" hierarchy — all four tiers, same shape as the sibling suite's
 * `SAMPLE_ROWS`, deliberately reused so a reader who knows that fixture
 * recognises this one.
 */
const FROM_ROWS = [
  { code: "11", name: "Aceh", lineNumber: 1 },
  { code: "11.01", name: "Kabupaten Aceh Selatan", lineNumber: 2 },
  { code: "11.01.01", name: "Bakongan", lineNumber: 3 },
  { code: "11.01.01.2001", name: "Keude Bakongan", lineNumber: 4 },
  { code: "11.01.01.2002", name: "Ujong Mangki", lineNumber: 5 },
  { code: "31", name: "Daerah Khusus Ibukota Jakarta", lineNumber: 6 },
  { code: "31.71", name: "Kota Administrasi Jakarta Pusat", lineNumber: 7 },
  { code: "31.71.01", name: "Gambir", lineNumber: 8 },
  { code: "31.71.01.1001", name: "Gambir", lineNumber: 9 }
];

/**
 * The "after" hierarchy — deliberately crafted so the diff is exact and
 * small enough to assert by hand:
 *
 *   - REMOVED: `11.01.01.2001` (Keude Bakongan), `11.01.01.2002` (Ujong Mangki)
 *   - ADDED:   `31.71.01.1002` (Kebon Kelapa)
 *   - RENAMED: `31.71.01.1001` (Gambir -> Gambir Baru)
 *   - unchanged: `11`, `11.01`, `11.01.01`, `31`, `31.71`, `31.71.01`
 *
 * Tier counts: province 2->2, regency 2->2, district 2->2, village 3->2 — a
 * real, nonzero delta on exactly one tier, which is the shape the activation
 * dialog this issue replaces could never show.
 */
const TO_ROWS = [
  { code: "11", name: "Aceh", lineNumber: 1 },
  { code: "11.01", name: "Kabupaten Aceh Selatan", lineNumber: 2 },
  { code: "11.01.01", name: "Bakongan", lineNumber: 3 },
  { code: "31", name: "Daerah Khusus Ibukota Jakarta", lineNumber: 4 },
  { code: "31.71", name: "Kota Administrasi Jakarta Pusat", lineNumber: 5 },
  { code: "31.71.01", name: "Gambir", lineNumber: 6 },
  { code: "31.71.01.1001", name: "Gambir Baru", lineNumber: 7 },
  { code: "31.71.01.1002", name: "Kebon Kelapa", lineNumber: 8 }
];

function codesOf(items: DatasetDiffItem[]): string[] {
  return items.map((item) => item.code).sort();
}

suite("idn_admin_regions dataset diff (real PostgreSQL, Issue #766)", () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  });

  afterAll(async () => {
    await teardownIntegrationDatabase();
  });

  beforeEach(async () => {
    const sql = getAdminSql();
    await sql.unsafe("DELETE FROM awcms_idn_admin_regions");
    await sql.unsafe("DELETE FROM awcms_idn_region_datasets");
  });

  describe("correctness against a crafted before/after pair", () => {
    test("per-tier counts are correct on both sides, independently", async () => {
      const sql = getAdminSql();

      const from = await asTx(sql, (tx) =>
        commitDatasetImport(tx, planFor("from", FROM_ROWS))
      );
      const to = await asTx(sql, (tx) =>
        commitDatasetImport(tx, planFor("to", TO_ROWS))
      );

      const fromCounts = await getDatasetTierCounts(sql, from.datasetId);
      const toCounts = await getDatasetTierCounts(sql, to.datasetId);

      expect(fromCounts).toEqual({ 1: 2, 2: 2, 3: 2, 4: 3 });
      expect(toCounts).toEqual({ 1: 2, 2: 2, 3: 2, 4: 2 });

      const tierRows = buildTierComparison(fromCounts, toCounts);
      const village = tierRows.find((row) => row.level === 4)!;
      expect(village.fromCount).toBe(3);
      expect(village.toCount).toBe(2);
      expect(village.delta).toBe(-1);
      // The other three tiers churned zero net rows.
      expect(
        tierRows
          .filter((row) => row.level !== 4)
          .every((row) => row.delta === 0)
      ).toBe(true);
    });

    test("added/removed/renamed are exactly the crafted set, nothing else", async () => {
      const sql = getAdminSql();

      const from = await asTx(sql, (tx) =>
        commitDatasetImport(tx, planFor("from2", FROM_ROWS))
      );
      const to = await asTx(sql, (tx) =>
        commitDatasetImport(tx, planFor("to2", TO_ROWS))
      );

      const added = await diffDatasetsPage(sql, {
        fromDatasetId: from.datasetId,
        toDatasetId: to.datasetId,
        kind: "added"
      });
      const removed = await diffDatasetsPage(sql, {
        fromDatasetId: from.datasetId,
        toDatasetId: to.datasetId,
        kind: "removed"
      });
      const renamed = await diffDatasetsPage(sql, {
        fromDatasetId: from.datasetId,
        toDatasetId: to.datasetId,
        kind: "renamed"
      });

      expect(codesOf(added.items)).toEqual(["31.71.01.1002"]);
      expect(added.items[0]!.oldName).toBeNull();
      expect(added.items[0]!.newName).toBe("Kebon Kelapa");
      expect(added.nextCursor).toBeNull();

      expect(codesOf(removed.items)).toEqual([
        "11.01.01.2001",
        "11.01.01.2002"
      ]);
      expect(removed.items.every((item) => item.newName === null)).toBe(true);
      expect(removed.nextCursor).toBeNull();

      expect(codesOf(renamed.items)).toEqual(["31.71.01.1001"]);
      expect(renamed.items[0]!.oldName).toBe("Gambir");
      expect(renamed.items[0]!.newName).toBe("Gambir Baru");
      expect(renamed.nextCursor).toBeNull();
    });

    test("comparing a dataset with itself: unchanged codes are neither added, removed, nor renamed", async () => {
      const sql = getAdminSql();

      const only = await asTx(sql, (tx) =>
        commitDatasetImport(tx, planFor("self", FROM_ROWS))
      );

      const added = await diffDatasetsPage(sql, {
        fromDatasetId: only.datasetId,
        toDatasetId: only.datasetId,
        kind: "added"
      });
      const removed = await diffDatasetsPage(sql, {
        fromDatasetId: only.datasetId,
        toDatasetId: only.datasetId,
        kind: "removed"
      });
      const renamed = await diffDatasetsPage(sql, {
        fromDatasetId: only.datasetId,
        toDatasetId: only.datasetId,
        kind: "renamed"
      });

      expect(added.items).toEqual([]);
      expect(removed.items).toEqual([]);
      expect(renamed.items).toEqual([]);
    });

    test("comparing two datasets with nothing in common: every FROM code is removed, every TO code added", async () => {
      const sql = getAdminSql();

      // Two disjoint code spaces (Aceh-only vs. Jakarta-only), each built from
      // the shared fixture's own rows so tier assignment stays realistic.
      const from = await asTx(sql, (tx) =>
        commitDatasetImport(tx, planFor("DF", FROM_ROWS.slice(0, 5)))
      );
      const to = await asTx(sql, (tx) =>
        commitDatasetImport(tx, planFor("DT", FROM_ROWS.slice(5)))
      );

      const added = await diffDatasetsPage(sql, {
        fromDatasetId: from.datasetId,
        toDatasetId: to.datasetId,
        kind: "added"
      });
      const removed = await diffDatasetsPage(sql, {
        fromDatasetId: from.datasetId,
        toDatasetId: to.datasetId,
        kind: "removed"
      });
      const renamed = await diffDatasetsPage(sql, {
        fromDatasetId: from.datasetId,
        toDatasetId: to.datasetId,
        kind: "renamed"
      });

      expect(codesOf(added.items)).toEqual(
        FROM_ROWS.slice(5)
          .map((row) => row.code)
          .sort()
      );
      expect(codesOf(removed.items)).toEqual(
        FROM_ROWS.slice(0, 5)
          .map((row) => row.code)
          .sort()
      );
      expect(renamed.items).toEqual([]);
    });
  });

  /**
   * Bounded reads, at a scale a hand-written fixture cannot fake: every
   * fixture here seeds MORE rows than the page limit or than a coincidental
   * small-table plan could explain — the same non-negotiable
   * `query-budget.integration.test.ts`'s header documents for exactly this
   * reason (a bound proven against a tiny fixture is satisfied by both a
   * correct implementation and a broken one).
   */
  describe("bounded at scale: page limits, keyset pagination, query count, and the query plan", () => {
    // This table is GLOBAL (ADR-0046 §3) — no tenant seeding needed, unlike
    // every other integration suite's fixtures.

    /** Comfortably more than DATASET_DIFF_PAGE_LIMIT_DEFAULT (50) and MAX (200). */
    const LARGE_ROW_COUNT = 3000;

    /**
     * Seeds two dataset rows directly (bypassing the importer, which is
     * already proven correct above) with `LARGE_ROW_COUNT` village-tier rows
     * each, sharing a common prefix of `SHARED_COUNT` identical codes/names
     * and diverging on the rest — cheap to construct with `generate_series`,
     * and large enough that the planner cannot get away with a coincidental
     * plan the way it could on a 9-row table.
     */
    const SHARED_COUNT = 1000;

    async function seedLargePair(): Promise<{
      fromId: string;
      toId: string;
    }> {
      const admin = getAdminSql();

      const datasets = (await admin`
        INSERT INTO awcms_idn_region_datasets
          (dataset_code, source_repository, source_path, source_commit_sha,
           source_file_sha256, row_count, status)
        VALUES
          ('diff-budget-from', 'cahyadsn/wilayah', 'db/wilayah.sql', 'x', 'x',
           ${LARGE_ROW_COUNT}, 'validated'),
          ('diff-budget-to', 'cahyadsn/wilayah', 'db/wilayah.sql', 'x', 'x',
           ${LARGE_ROW_COUNT}, 'validated')
        RETURNING id, dataset_code
      `) as { id: string; dataset_code: string }[];

      const fromId = datasets.find(
        (row) => row.dataset_code === "diff-budget-from"
      )!.id;
      const toId = datasets.find(
        (row) => row.dataset_code === "diff-budget-to"
      )!.id;

      // Shared prefix: identical code AND name on both sides (neither added,
      // removed, nor renamed).
      await admin`
        INSERT INTO awcms_idn_admin_regions
          (dataset_id, code, code_compact, level, region_type, official_name,
           normalized_name, source_row_hash)
        SELECT ${fromId}, 'shared.' || n, 'shared' || n, 4, 'village',
               'Shared Village ' || n, 'shared village ' || n, 'h' || n
        FROM generate_series(1, ${SHARED_COUNT}) AS n
      `;
      await admin`
        INSERT INTO awcms_idn_admin_regions
          (dataset_id, code, code_compact, level, region_type, official_name,
           normalized_name, source_row_hash)
        SELECT ${toId}, 'shared.' || n, 'shared' || n, 4, 'village',
               'Shared Village ' || n, 'shared village ' || n, 'h' || n
        FROM generate_series(1, ${SHARED_COUNT}) AS n
      `;

      // FROM-only tail: every one of these is `removed`.
      await admin`
        INSERT INTO awcms_idn_admin_regions
          (dataset_id, code, code_compact, level, region_type, official_name,
           normalized_name, source_row_hash)
        SELECT ${fromId}, 'gone.' || n, 'gone' || n, 4, 'village',
               'Gone Village ' || n, 'gone village ' || n, 'g' || n
        FROM generate_series(1, ${LARGE_ROW_COUNT - SHARED_COUNT}) AS n
      `;

      // TO-only tail: every one of these is `added`.
      await admin`
        INSERT INTO awcms_idn_admin_regions
          (dataset_id, code, code_compact, level, region_type, official_name,
           normalized_name, source_row_hash)
        SELECT ${toId}, 'new.' || n, 'new' || n, 4, 'village',
               'New Village ' || n, 'new village ' || n, 'w' || n
        FROM generate_series(1, ${LARGE_ROW_COUNT - SHARED_COUNT}) AS n
      `;

      await admin.unsafe("ANALYZE awcms_idn_admin_regions");

      return { fromId, toId };
    }

    test("getDatasetTierCounts is one query regardless of row count", async () => {
      const { fromId } = await seedLargePair();
      const sql = getAdminSql();

      const { result, queries } = await countQueries(
        sql as unknown as Bun.TransactionSQL,
        (counting) => getDatasetTierCounts(counting, fromId)
      );

      expect(result[4]).toBe(LARGE_ROW_COUNT);
      expect(queries).toBe(1);
    });

    test("diffDatasetsPage is one query per kind, and every page is bounded by the limit", async () => {
      const { fromId, toId } = await seedLargePair();
      const sql = getAdminSql();

      const { result: added, queries: addedQueries } = await countQueries(
        sql as unknown as Bun.TransactionSQL,
        (counting) =>
          diffDatasetsPage(counting, {
            fromDatasetId: fromId,
            toDatasetId: toId,
            kind: "added"
          })
      );

      expect(addedQueries).toBe(1);
      // The default page (50) is far smaller than the 2,000 added rows seeded
      // — a naive "fetch everything and diff in memory" implementation would
      // return everything, not a page.
      expect(added.items.length).toBe(DATASET_DIFF_PAGE_LIMIT_DEFAULT);
      expect(added.nextCursor).not.toBeNull();

      const { result: removed, queries: removedQueries } = await countQueries(
        sql as unknown as Bun.TransactionSQL,
        (counting) =>
          diffDatasetsPage(counting, {
            fromDatasetId: fromId,
            toDatasetId: toId,
            kind: "removed"
          })
      );

      expect(removedQueries).toBe(1);
      expect(removed.items.length).toBe(DATASET_DIFF_PAGE_LIMIT_DEFAULT);
      expect(removed.nextCursor).not.toBeNull();
    });

    test("keyset pagination over `added` walks the whole set without repeating or dropping a row", async () => {
      const { fromId, toId } = await seedLargePair();
      const sql = getAdminSql();

      const seen: string[] = [];
      let cursor: string | null = null;
      const expectedTotal = LARGE_ROW_COUNT - SHARED_COUNT;

      for (let page = 0; page < 100; page += 1) {
        const result = await diffDatasetsPage(sql, {
          fromDatasetId: fromId,
          toDatasetId: toId,
          kind: "added",
          afterCode: cursor
        });
        seen.push(...result.items.map((item) => item.code));
        cursor = result.nextCursor;
        if (!cursor) break;
      }

      expect(seen).toHaveLength(expectedTotal);
      expect(new Set(seen).size).toBe(expectedTotal);
    });

    /**
     * The exact class of mistake `docs/PROJECT_STATE.md`'s 17 August 2026 round
     * measured: a query that LOOKS bounded can still scan every row of a large
     * table if the planner falls back to a Seq Scan. Proven here, not asserted
     * from source — `EXPLAIN` states the plan directly, the same idiom
     * `blog-list-ordering-plan.integration.test.ts` uses for the identical
     * reason (a timing assertion on shared CI hardware is a coin flip; a plan
     * is not).
     */
    /**
     * What this asserts, and why it is not "the plan contains no Seq Scan".
     *
     * The first version of this test asserted exactly that, and CI proved it
     * wrong: with two datasets of `LARGE_ROW_COUNT` rows each, ONE dataset is
     * half the table, and at 50% selectivity a sequential scan genuinely IS
     * the cheaper plan. Postgres was declining the index correctly; the
     * assertion was false precision on a fixture too small for an index scan
     * to ever win — the same shape as the 48,832-buffers-vs-27 measurement
     * error recorded in PROJECT_STATE, arrived at from the other direction.
     *
     * Seeding enough noise datasets to make the planner prefer the index would
     * make the assertion true, but it would be measuring the PLANNER's
     * threshold on CI hardware, which moves. The property `sql/150` actually
     * owes us is narrower and permanent: that an index EXISTS which covers
     * this query shape. So the planner's hand is forced and the plan is
     * required to name that index. Deterministic at any fixture size.
     */
    test("sql/150's index covers the tier-count aggregate", async () => {
      const { fromId } = await seedLargePair();
      const admin = getAdminSql();

      // A REAL transaction, not this file's `asTx` (which only casts the
      // pooled connection): `SET LOCAL` outside a transaction is a no-op that
      // merely warns, so the planner would never actually be constrained and
      // this test would prove nothing.
      const text = await admin.begin(async (tx: Bun.TransactionSQL) => {
        await tx.unsafe("SET LOCAL enable_seqscan = off");
        const rows = (await tx.unsafe(
          `EXPLAIN (ANALYZE, FORMAT TEXT)
           SELECT level, COUNT(*)::int AS region_count
           FROM awcms_idn_admin_regions
           WHERE dataset_id = $1
           GROUP BY level`,
          [fromId]
        )) as Record<string, string>[];
        return rows.map((row) => Object.values(row)[0]).join("\n");
      });

      expect(text).toContain("awcms_idn_admin_regions_dataset_level_idx");
    });

    /**
     * Same reasoning as the tier-count test above. The index this names is the
     * COVERING one — `(dataset_id, code) INCLUDE (official_name)` — so the
     * assertion also proves the `INCLUDE` is pulling its weight: a plain
     * `(dataset_id, code)` index would still be named here, but the rename
     * comparison would have to visit the heap for `official_name`, which is
     * the whole reason `sql/150` carries the payload column.
     */
    test("sql/150 gives the added/removed/renamed join an index path", async () => {
      const { fromId, toId } = await seedLargePair();
      const admin = getAdminSql();

      // A REAL transaction, not this file's `asTx` (which only casts the
      // pooled connection): `SET LOCAL` outside a transaction is a no-op that
      // merely warns, so the planner would never actually be constrained and
      // this test would prove nothing.
      const text = await admin.begin(async (tx: Bun.TransactionSQL) => {
        await tx.unsafe("SET LOCAL enable_seqscan = off");
        const rows = (await tx.unsafe(
          `EXPLAIN (ANALYZE, FORMAT TEXT)
           SELECT code, a.official_name AS old_name, b.official_name AS new_name
           FROM (
             SELECT code, official_name FROM awcms_idn_admin_regions
             WHERE dataset_id = $1
           ) a
           FULL OUTER JOIN (
             SELECT code, official_name FROM awcms_idn_admin_regions
             WHERE dataset_id = $2
           ) b USING (code)
           WHERE a.code IS NOT NULL AND b.code IS NOT NULL
             AND a.official_name IS DISTINCT FROM b.official_name
           ORDER BY code ASC
           LIMIT 51`,
          [fromId, toId]
        )) as Record<string, string>[];
        return rows.map((row) => Object.values(row)[0]).join("\n");
      });

      // EITHER of sql/150's indexes satisfies this: both lead with
      // `dataset_id`, which is the only predicate on the FIRST page of a diff.
      //
      // CI settled which one the planner actually picks, and the answer is
      // worth recording rather than asserting away. It takes the NARROWER
      // `(dataset_id, level)` index by bitmap scan and then visits the heap for
      // `code`/`official_name`. That is the right call: this page reads every
      // row of the dataset, so a wider covering index would mean reading more
      // index pages to avoid a heap visit it cannot avoid anyway.
      //
      // The covering `(dataset_id, code) INCLUDE (official_name)` index earns
      // its place on the pages AFTER the first, which carry a `code > cursor`
      // predicate and an ORDER BY code the leading columns can satisfy in
      // order. Asserting it here would have been asserting it in the one place
      // it is NOT the better plan.
      //
      // Note `not.toContain("Seq Scan")` is deliberately absent: with
      // `enable_seqscan = off` that assertion is vacuous, and a test that
      // cannot fail is not a test.
      expect(text).toMatch(
        /awcms_idn_admin_regions_dataset_(level|code_name)_idx/
      );
    });
  });
});
