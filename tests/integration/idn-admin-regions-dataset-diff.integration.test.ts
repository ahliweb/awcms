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
 *      Both the tier aggregate and the diff join accept any index-scan access
 *      NODE naming any index this table actually owns, not one or two
 *      specific index names. This table carries five indexes that all lead
 *      with `dataset_id` (`sql/080`'s `dataset_code_key`/`dataset_parent_idx`/
 *      `dataset_name_idx`/`dataset_level_idx`, plus `sql/150`'s
 *      `dataset_code_name_idx`), so a query that only filters on `dataset_id`
 *      has several genuinely competitive access paths, and an ANALYZE right
 *      before the EXPLAIN (added below) makes the planner's INPUTS
 *      deterministic without making its OUTPUT deterministic when paths are
 *      this close in cost — reproduced locally, `dataset_parent_idx` won 1
 *      run in 15, on both queries, in the same run. Two narrower attempts at
 *      an assertion each flaked on that in turn: naming one or two specific
 *      indexes (CI picked a third), then a `..._idx`-suffixed name PATTERN
 *      (`dataset_code_key`, a real contender for both queries, does not end
 *      in `_idx`). What `sql/150` (and `sql/080` before it) permanently owe
 *      us is that SOME index serves each query — matched by the actual
 *      EXPLAIN text an index-scan node produces (`INDEX_SCAN_ON_THIS_TABLE`,
 *      declared at the top of the "bounded at scale" describe block, read off
 *      real Postgres 18 plans rather than assumed), not by any name of the
 *      index it happens to be. See the failability test at the end of that
 *      block for proof that dropping all five still fails both assertions.
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

    /**
     * Matches an index-scan access NODE naming one of this table's own
     * indexes, in EXPLAIN (FORMAT TEXT) — not a specific index's name. Read
     * off real Postgres 18 plans against this exact fixture (not guessed):
     * Postgres renders a plain or Index Only Scan as
     * `Index [Only ]Scan using <indexname> on <table>`, but a Bitmap Index
     * Scan (the node this table's queries actually got in every combination
     * of its six indexes that was probed — see the two tests below) as
     * `Bitmap Index Scan on <indexname>`, with "on" instead of "using" and no
     * table name at all. A regex built from only the first form — the
     * mistake this file made twice already — silently fails to match the
     * scan this table's queries actually run, without ever naming a Seq Scan.
     * `Seq Scan on <table>` carries neither connector word, so it cannot
     * match either branch.
     */
    const INDEX_SCAN_ON_THIS_TABLE =
      /(?:Index Only Scan|Index Scan) using awcms_idn_admin_regions_\w+|Bitmap Index Scan on awcms_idn_admin_regions_\w+/;

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

      // Explicit, not left to autovacuum: autovacuum's ANALYZE runs
      // asynchronously, so a plan pulled immediately after this insert would
      // otherwise be reading default or stale statistics — a race whose
      // outcome depends on CI scheduling, not on the schema. This makes the
      // planner's inputs deterministic; it does NOT make its choice of index
      // deterministic when two indexes are genuinely cost-competitive (see
      // the "sql/150 gives the added/removed/renamed join an index path"
      // test below for what that means for what gets asserted there).
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
     * this query shape. So the planner's hand is forced with
     * `enable_seqscan = off`.
     *
     * The second version of this test then named that index exactly —
     * `dataset_level_idx`, the obvious pick since it is the only one that
     * puts `level` in the index itself. CI flaked on THAT too: this table's
     * OTHER four `dataset_id`-leading indexes (plus a fifth,
     * `dataset_code_key`, which does not even end in `_idx`) can each serve
     * this query as a Bitmap Index Scan feeding the aggregate from the heap,
     * since `level` is read from every matching row regardless of which index
     * found them. Which one wins the cost comparison depends on ANALYZE's
     * sampling, not on the schema — reproduced locally, `dataset_parent_idx`
     * won 1 run in 15.
     *
     * The third version then tried matching a NAME PATTERN instead of one
     * name — `/awcms_idn_admin_regions_dataset_\w+_idx/` — which is exactly
     * as wrong for a different reason: `dataset_code_key` is a real,
     * genuinely competitive index for this shape and it does not match that
     * pattern, so if it is ever the one chosen, a perfectly index-backed plan
     * would fail the assertion. What this test actually owes is not a name
     * pattern but a NODE: does the plan contain an index-scan access node
     * naming any index on this table (`INDEX_SCAN_ON_THIS_TABLE`, declared at
     * the top of this describe block, matched against real Postgres 18 output
     * for this exact query — see its own comment for the two node shapes that
     * turned out to matter). See the failability test at the end of this
     * describe block for proof it is not vacuous.
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

      expect(text).toMatch(INDEX_SCAN_ON_THIS_TABLE);
    });

    /**
     * Related to the tier-count test above, but NOT the same assertion. When
     * the covering `(dataset_id, code) INCLUDE (official_name)` index wins
     * here, it also proves the `INCLUDE` is pulling its weight — a plain
     * `(dataset_id, code)` index would still serve the join, but the rename
     * comparison would have to visit the heap for `official_name`, which is
     * the whole reason `sql/150` carries the payload column.
     *
     * But the covering index does not always win this one, and this test used
     * to assert that it was ONE OF two specific names — CI proved that
     * unstable too (see the file header): with two access paths this close in
     * cost, gathering fresh statistics before measuring (below) makes the
     * planner's INPUTS deterministic, but not necessarily its output, because
     * a marginal cost tie can still turn on sampling noise in those
     * statistics.
     *
     * The next fix tried a name PATTERN instead of an enumerated list —
     * `/awcms_idn_admin_regions_dataset_\w+_idx/` — and that is also wrong:
     * `dataset_code_key`, the pre-existing `sql/080` unique index this query
     * could equally use, does not end in `_idx`, so a run where the planner
     * picks it would fail an assertion on a plan that is genuinely
     * index-backed. What this test actually owes is a NODE, not a name: does
     * the plan contain an index-scan access node naming any index on this
     * table (`INDEX_SCAN_ON_THIS_TABLE`, declared at the top of this describe
     * block — see its comment for the two node shapes Postgres 18 actually
     * emits here, which is not the shape a first guess would assume). The
     * sibling test right after drops every index this table owns and shows
     * the plan falls back to a Seq Scan — proof this assertion is not free.
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

      // Any index this table owns satisfies this, because `dataset_id` is the
      // only predicate on the FIRST page of a diff and every index here leads
      // with it. Earlier versions of this test named exactly one or two of
      // them, then a `_idx`-suffixed name pattern that still excluded the
      // pre-existing `dataset_code_key` unique index — see this test's
      // docblock above for why each of those broke. This asserts the NODE:
      // does the plan contain an index-scan access node naming any index on
      // `awcms_idn_admin_regions`, regardless of which one. See the next test
      // for proof it can still fail.
      //
      // Note `not.toContain("Seq Scan")` is deliberately absent as the WHOLE
      // assertion: with `enable_seqscan = off` that alone is vacuous, and a
      // test that cannot fail is not a test.
      expect(text).toMatch(INDEX_SCAN_ON_THIS_TABLE);
    });

    /**
     * `INDEX_SCAN_ON_THIS_TABLE` accepts any index-scan node naming any index
     * this table owns — the failure mode that guards against is a completely
     * different one from "which index did the planner pick": a schema change
     * that removes every dataset_id-scoped index on `awcms_idn_admin_regions`
     * without anyone touching this test. Prove it can still fail: drop all
     * five of `sql/080`'s and `sql/150`'s dataset_id-leading indexes and
     * confirm BOTH queries above fall back to a Seq Scan even with
     * `enable_seqscan = off` forcing it away whenever an index exists —
     * `enable_seqscan` biases the cost comparison, it does not forbid the
     * plan when no index remains. `Seq Scan on <table>` carries neither of
     * the connector words (`using`/`on an index`) `INDEX_SCAN_ON_THIS_TABLE`
     * requires, so the negative assertions below are exactly as strict as the
     * positive ones above — not "not literally the string `Seq Scan`", but
     * "not an index-scan node naming an index of this table's".
     *
     * The drop is inside a transaction that is rolled back, so the schema
     * `sql/080`/`sql/150` created is untouched — same technique as
     * `unbounded-reads.integration.test.ts`'s "dropping the index brings the
     * scan back" test.
     */
    test("dropping every dataset-scoped index brings the scan back — the assertions above are not free", async () => {
      const { fromId, toId } = await seedLargePair();
      const admin = getAdminSql();

      let aggregateText = "";
      let joinText = "";

      try {
        await admin.begin(async (tx: Bun.TransactionSQL) => {
          await tx.unsafe(
            "DROP INDEX awcms_idn_admin_regions_dataset_code_key"
          );
          await tx.unsafe(
            "DROP INDEX awcms_idn_admin_regions_dataset_parent_idx"
          );
          await tx.unsafe(
            "DROP INDEX awcms_idn_admin_regions_dataset_name_idx"
          );
          await tx.unsafe(
            "DROP INDEX awcms_idn_admin_regions_dataset_level_idx"
          );
          await tx.unsafe(
            "DROP INDEX awcms_idn_admin_regions_dataset_code_name_idx"
          );
          await tx.unsafe("ANALYZE awcms_idn_admin_regions");
          await tx.unsafe("SET LOCAL enable_seqscan = off");

          const aggregateRows = (await tx.unsafe(
            `EXPLAIN (ANALYZE, FORMAT TEXT)
             SELECT level, COUNT(*)::int AS region_count
             FROM awcms_idn_admin_regions
             WHERE dataset_id = $1
             GROUP BY level`,
            [fromId]
          )) as Record<string, string>[];
          aggregateText = aggregateRows
            .map((row) => Object.values(row)[0])
            .join("\n");

          const joinRows = (await tx.unsafe(
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
          joinText = joinRows.map((row) => Object.values(row)[0]).join("\n");

          // `expect().rejects` hangs on this pool harness (see
          // `unbounded-reads.integration.test.ts`), so the rollback is a
          // thrown sentinel caught outside, exactly like that file's
          // precedent.
          throw new Error("__rollback__");
        });
      } catch (error) {
        if (!(error instanceof Error) || error.message !== "__rollback__") {
          throw error;
        }
      }

      expect(aggregateText).toContain("Seq Scan");
      expect(aggregateText).not.toMatch(INDEX_SCAN_ON_THIS_TABLE);

      expect(joinText).toContain("Seq Scan");
      expect(joinText).not.toMatch(INDEX_SCAN_ON_THIS_TABLE);
    });
  });
});
