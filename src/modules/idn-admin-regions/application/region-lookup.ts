/**
 * Read-only region lookup (ADR-0046) — the queries behind
 * `GET /api/v1/idn-regions/*` and the admin browser.
 *
 * ## Dataset resolution is explicit, never implicit
 *
 * Every query is scoped to exactly one dataset. The default is the ACTIVE one;
 * a caller may name a specific `datasetCode` to query a superseded version
 * (comparing an old import against the current one is the whole point of keeping
 * them). "No active dataset" is a real state — a fresh install that has imported
 * nothing — and it returns an empty result with a reason, not an exception.
 *
 * ## Every filter is a bound parameter
 *
 * Search text goes into `LIKE` as a parameter with its wildcards escaped, so a
 * `%`-laden query is a literal search for `%`, not a full-table scan dressed as
 * a search. Result sets are always bounded.
 */
import type { RegionType } from "../domain/region-normalization";
import { normalizeRegionName } from "../domain/region-normalization";

/** Hard ceiling for any single page, whatever the caller asks for. */
export const REGION_PAGE_LIMIT_MAX = 200;
export const REGION_PAGE_LIMIT_DEFAULT = 50;

export type RegionRecord = {
  code: string;
  codeCompact: string;
  parentCode: string | null;
  level: number;
  regionType: RegionType;
  localTerm: string | null;
  name: string;
  shortName: string | null;
  fullPathName: string | null;
};

export type RegionQuery = {
  /** Dataset code to query; omitted means "the active dataset". */
  datasetCode?: string | null;
  level?: number | null;
  parentCode?: string | null;
  search?: string | null;
  limit?: number | null;
  /** Keyset cursor — the last `code` of the previous page. */
  afterCode?: string | null;
};

export type RegionQueryResult = {
  datasetCode: string | null;
  items: RegionRecord[];
  nextCursor: string | null;
  /** Set when no dataset could be resolved, so a caller can tell "empty" from "not ready". */
  reason?: "no_active_dataset" | "dataset_not_found";
};

type RegionRow = {
  code: string;
  code_compact: string;
  parent_code: string | null;
  level: number;
  region_type: RegionType;
  local_term: string | null;
  official_name: string;
  full_path_name: string | null;
  metadata: { shortName?: string } | null;
};

function toRecord(row: RegionRow): RegionRecord {
  return {
    code: row.code,
    codeCompact: row.code_compact,
    parentCode: row.parent_code,
    level: Number(row.level),
    regionType: row.region_type,
    localTerm: row.local_term,
    name: row.official_name,
    shortName: row.metadata?.shortName ?? null,
    fullPathName: row.full_path_name
  };
}

/** Escapes LIKE wildcards so user text is matched literally. */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

export function clampLimit(requested: number | null | undefined): number {
  if (!requested || !Number.isFinite(requested) || requested <= 0) {
    return REGION_PAGE_LIMIT_DEFAULT;
  }
  return Math.min(Math.trunc(requested), REGION_PAGE_LIMIT_MAX);
}

/** Resolves the dataset a query runs against: the named one, else the active one. */
async function resolveDatasetId(
  sql: Bun.SQL | Bun.TransactionSQL,
  datasetCode: string | null | undefined
): Promise<
  | { id: string; code: string }
  | { id: null; reason: RegionQueryResult["reason"] }
> {
  if (datasetCode) {
    const rows = (await sql`
      SELECT id, dataset_code FROM awcms_idn_region_datasets
      WHERE dataset_code = ${datasetCode}
      LIMIT 1
    `) as { id: string; dataset_code: string }[];

    const row = rows[0];
    return row
      ? { id: row.id, code: row.dataset_code }
      : { id: null, reason: "dataset_not_found" };
  }

  const rows = (await sql`
    SELECT id, dataset_code FROM awcms_idn_region_datasets
    WHERE status = 'active'
    LIMIT 1
  `) as { id: string; dataset_code: string }[];

  const row = rows[0];
  return row
    ? { id: row.id, code: row.dataset_code }
    : { id: null, reason: "no_active_dataset" };
}

/**
 * Lists regions of one dataset, filtered by tier, parent, and/or name.
 *
 * Pagination is keyset on `code` (which is unique per dataset and sorts in
 * hierarchy order), not `OFFSET`: at 83,762 villages an offset scan re-reads
 * everything it skips, and a row inserted mid-scroll shifts every later page.
 */
export async function queryRegions(
  sql: Bun.SQL | Bun.TransactionSQL,
  query: RegionQuery
): Promise<RegionQueryResult> {
  const dataset = await resolveDatasetId(sql, query.datasetCode);

  if (dataset.id === null) {
    return {
      datasetCode: null,
      items: [],
      nextCursor: null,
      reason: dataset.reason
    };
  }

  const limit = clampLimit(query.limit);
  const searchTerm = query.search ? normalizeRegionName(query.search) : null;
  const searchPattern =
    searchTerm && searchTerm.length > 0
      ? `%${escapeLikePattern(searchTerm)}%`
      : null;

  const rows = (await sql`
    SELECT code, code_compact, parent_code, level, region_type, local_term,
           official_name, full_path_name, metadata
    FROM awcms_idn_admin_regions
    WHERE dataset_id = ${dataset.id}
      AND (${query.level ?? null}::smallint IS NULL OR level = ${query.level ?? null}::smallint)
      AND (${query.parentCode ?? null}::text IS NULL OR parent_code = ${query.parentCode ?? null}::text)
      AND (${searchPattern}::text IS NULL OR normalized_name LIKE ${searchPattern}::text ESCAPE '\\')
      AND (${query.afterCode ?? null}::text IS NULL OR code > ${query.afterCode ?? null}::text)
    ORDER BY code ASC
    LIMIT ${limit + 1}
  `) as RegionRow[];

  const page = rows.slice(0, limit);

  return {
    datasetCode: dataset.code,
    items: page.map(toRecord),
    nextCursor: rows.length > limit ? (page.at(-1)?.code ?? null) : null
  };
}

/** One region by its dotted code, from the named or active dataset. */
export async function getRegionByCode(
  sql: Bun.SQL | Bun.TransactionSQL,
  code: string,
  options: { datasetCode?: string | null } = {}
): Promise<{
  dataset: string | null;
  region: RegionRecord | null;
  reason?: RegionQueryResult["reason"];
}> {
  const dataset = await resolveDatasetId(sql, options.datasetCode);

  if (dataset.id === null) {
    return { dataset: null, region: null, reason: dataset.reason };
  }

  const rows = (await sql`
    SELECT code, code_compact, parent_code, level, region_type, local_term,
           official_name, full_path_name, metadata
    FROM awcms_idn_admin_regions
    WHERE dataset_id = ${dataset.id} AND code = ${code}
    LIMIT 1
  `) as RegionRow[];

  const row = rows[0];

  return {
    dataset: dataset.code,
    region: row ? toRecord(row) : null
  };
}
