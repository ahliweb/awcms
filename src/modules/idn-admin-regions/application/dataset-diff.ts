/**
 * Dataset version comparison (Issue #766) — the read the activation confirm
 * dialog never offered: "what actually differs between the version being
 * served and the one about to be" — before the switch happens, not after.
 *
 * ## Why this is a QUERY, not a re-parse
 *
 * Both versions live side by side in `awcms_idn_admin_regions`, which is what
 * makes rollback a status flip instead of a re-import (ADR-0046 §4). The same
 * fact makes a diff between two versions a single `FULL OUTER JOIN` on `code`
 * filtered to the two `dataset_id`s — no re-reading the vendored dump, no
 * temporary table, no in-memory hash of 91,599 rows.
 *
 * ## Every result is BOUNDED
 *
 * A diff between two 91,599-row versions is not a page (Issue #766). Counts
 * are one grouped aggregate per version (bounded by the number of TIERS, 4 —
 * never by the number of regions). The added/removed/renamed sets are keyset
 * paginated on `code`, exactly like `region-lookup.ts`'s own listing: a hard
 * ceiling per page, `LIMIT n+1` to detect a next page, never a bare `LIMIT`.
 *
 * ## Binding parameters the way the caller binds them
 *
 * `fromDatasetId`/`toDatasetId`/`afterCode` are bound parameters, not a
 * correlated subquery — the exact distinction this repo has measured the cost
 * of getting wrong (`docs/PROJECT_STATE.md`, 17 August 2026 round: a
 * non-constant-folded subquery fell back to generic selectivity and cost
 * 48,832 buffers where the same query with a bound parameter cost 27). The
 * per-kind predicate (`added`/`removed`/`renamed`) is a fixed, repo-controlled
 * SQL fragment spliced with `sql.unsafe` — never user input, and never a bound
 * parameter either: a `CASE` over a parameter would give Postgres one generic
 * plan for all three kinds, where a literal predicate lets it plan (and use
 * `sql/150`'s covering index for) each kind on its own.
 */
import type { RegionType } from "../domain/region-normalization";

export type DatasetTierLevel = 1 | 2 | 3 | 4;

/** Region counts by tier (1=province .. 4=village), zero-filled for a tier with no rows. */
export type DatasetTierCounts = Readonly<Record<DatasetTierLevel, number>>;

const EMPTY_TIER_COUNTS: DatasetTierCounts = { 1: 0, 2: 0, 3: 0, 4: 0 };

type TierCountRow = { level: number; region_count: number };

/**
 * Per-tier region counts for ONE dataset — one grouped aggregate, bounded by
 * the number of tiers rather than the number of regions.
 *
 * Served by `sql/150`'s `(dataset_id, level)` index: an Index Only Scan
 * feeding a `GroupAggregate`, never a full-table heap scan of the dataset to
 * read a column the unique `(dataset_id, code)` index does not carry.
 */
export async function getDatasetTierCounts(
  sql: Bun.SQL | Bun.TransactionSQL,
  datasetId: string
): Promise<DatasetTierCounts> {
  const rows = (await sql`
    SELECT level, COUNT(*)::int AS region_count
    FROM awcms_idn_admin_regions
    WHERE dataset_id = ${datasetId}
    GROUP BY level
  `) as TierCountRow[];

  const byLevel = new Map(
    rows.map((row) => [Number(row.level), row.region_count])
  );

  return {
    1: byLevel.get(1) ?? 0,
    2: byLevel.get(2) ?? 0,
    3: byLevel.get(3) ?? 0,
    4: byLevel.get(4) ?? 0
  };
}

export type TierComparisonRow = {
  level: DatasetTierLevel;
  regionType: RegionType;
  fromCount: number;
  toCount: number;
  delta: number;
};

const TIER_REGION_TYPES: Readonly<Record<DatasetTierLevel, RegionType>> = {
  1: "province",
  2: "regency",
  3: "district",
  4: "village"
};

/**
 * Pure — combines two already-fetched `DatasetTierCounts` into the four rows
 * the comparison table renders, each with the (to - from) delta. Kept apart
 * from the query above so the arithmetic is testable without a database.
 */
export function buildTierComparison(
  from: DatasetTierCounts = EMPTY_TIER_COUNTS,
  to: DatasetTierCounts = EMPTY_TIER_COUNTS
): TierComparisonRow[] {
  return ([1, 2, 3, 4] as const).map((level) => ({
    level,
    regionType: TIER_REGION_TYPES[level],
    fromCount: from[level],
    toCount: to[level],
    delta: to[level] - from[level]
  }));
}

export type DatasetDiffKind = "added" | "removed" | "renamed";

export type DatasetDiffItem = {
  code: string;
  /** Name on the FROM side. Null for a code that only exists on TO (`added`). */
  oldName: string | null;
  /** Name on the TO side. Null for a code that only exists on FROM (`removed`). */
  newName: string | null;
};

export type DatasetDiffPage = {
  items: DatasetDiffItem[];
  /** Keyset cursor (the last `code` on this page), or null when this was the last page. */
  nextCursor: string | null;
};

/** Hard ceiling for any single page, whatever the caller asks for — same shape as `region-lookup.ts`. */
export const DATASET_DIFF_PAGE_LIMIT_MAX = 200;
export const DATASET_DIFF_PAGE_LIMIT_DEFAULT = 50;

export function clampDatasetDiffLimit(
  requested: number | null | undefined
): number {
  if (!requested || !Number.isFinite(requested) || requested <= 0) {
    return DATASET_DIFF_PAGE_LIMIT_DEFAULT;
  }
  return Math.min(Math.trunc(requested), DATASET_DIFF_PAGE_LIMIT_MAX);
}

/**
 * Fixed, repo-controlled SQL fragments — never interpolated user input. Each
 * is spliced verbatim via `sql.unsafe` (the same idiom
 * `keysetCursorCreatedAtSql`/`PUBLIC_ELIGIBLE_PREDICATE_SQL` use elsewhere in
 * this repo), so Postgres plans the SPECIFIC predicate a call site asked for
 * rather than a generic `CASE` over a bound parameter.
 */
const DIFF_KIND_PREDICATE_SQL: Readonly<Record<DatasetDiffKind, string>> = {
  // Only on the TO side: the FULL OUTER JOIN found no match on FROM.
  added: "a.code IS NULL",
  // Only on the FROM side: the FULL OUTER JOIN found no match on TO.
  removed: "b.code IS NULL",
  // On both sides, same code, different name.
  renamed:
    "a.code IS NOT NULL AND b.code IS NOT NULL AND a.official_name IS DISTINCT FROM b.official_name"
};

type DiffRow = {
  code: string;
  old_name: string | null;
  new_name: string | null;
};

function toDiffItem(row: DiffRow): DatasetDiffItem {
  return { code: row.code, oldName: row.old_name, newName: row.new_name };
}

/**
 * One page of one diff KIND between two dataset versions.
 *
 * The join: `(SELECT code, official_name FROM … WHERE dataset_id = from) a
 * FULL OUTER JOIN (SELECT code, official_name FROM … WHERE dataset_id = to) b
 * ON a.code = b.code`. Both sides are equality-filtered on `dataset_id` and
 * read `code` pre-sorted from `sql/150`'s covering index, so Postgres can
 * stream a Merge Full Join instead of hashing either side into memory.
 *
 * Called once per kind (three calls for a full comparison) rather than once
 * with a kind PARAMETER, precisely so each call gets its own plan — see the
 * module header on binding parameters the way the caller binds them.
 */
export async function diffDatasetsPage(
  sql: Bun.SQL | Bun.TransactionSQL,
  options: {
    fromDatasetId: string;
    toDatasetId: string;
    kind: DatasetDiffKind;
    limit?: number | null;
    afterCode?: string | null;
  }
): Promise<DatasetDiffPage> {
  const limit = clampDatasetDiffLimit(options.limit);
  const predicate = DIFF_KIND_PREDICATE_SQL[options.kind];

  const rows = (await sql`
    SELECT code, a.official_name AS old_name, b.official_name AS new_name
    FROM (
      SELECT code, official_name FROM awcms_idn_admin_regions
      WHERE dataset_id = ${options.fromDatasetId}
    ) a
    FULL OUTER JOIN (
      SELECT code, official_name FROM awcms_idn_admin_regions
      WHERE dataset_id = ${options.toDatasetId}
    ) b USING (code)
    WHERE ${sql.unsafe(predicate)}
      AND (${options.afterCode ?? null}::text IS NULL OR code > ${options.afterCode ?? null}::text)
    ORDER BY code ASC
    LIMIT ${limit + 1}
  `) as DiffRow[];

  const page = rows.slice(0, limit);

  return {
    items: page.map(toDiffItem),
    nextCursor: rows.length > limit ? (page.at(-1)?.code ?? null) : null
  };
}
