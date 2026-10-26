/**
 * Admin data-page pattern — the pure half (Issue #1196, ADR-0149).
 *
 * Everything the four primitives in `src/components/admin/` need that is NOT
 * markup: reading `?q=&status=&sort=&dir=&cursor=&limit=` from a URL, building
 * the link for "the same page, one thing different", the removable-chip list,
 * and (for lists that are already fully loaded and bounded) a keyset slice
 * with an opaque cursor.
 *
 * ## Why this is a module and not inline in each page
 *
 * A data page is URL state. Every control on it — a sort header, a chip's
 * remove link, the page-size links, Previous/Next — is an `<a href>` that must
 * reproduce the CURRENT state with exactly one thing changed, and the rule
 * about what else changes is easy to get subtly different in a fifth copy:
 *
 *  - changing the query, a filter, the sort or the page size DROPS the cursor
 *    (a cursor is a position in one specific ordering of one specific result
 *    set; carrying it across a change lands the reader mid-list of a different
 *    list, or past its end);
 *  - defaults are OMITTED from the URL, so the unfiltered page has the plain
 *    path as its canonical address and a shared link carries only intent.
 *
 * Pure on purpose: no `Astro`, no `Request`, no I/O, so `tests/` can pin the
 * rules without rendering a page.
 *
 * ## The cursor is a position, never an authorization
 *
 * It encodes `(sort value, id)` and nothing else. Whoever holds it can ask for
 * "the rows after this one" — and the server still authorizes the request,
 * runs it inside `withTenant`, and RLS FORCE decides which rows exist. Forging
 * or replaying a cursor can move you within data you were already allowed to
 * read; it cannot widen what you may read. An unreadable cursor is treated as
 * ABSENT (first page) rather than as an error: an SSR page that answers a
 * bookmarked link with a 400 is worse than one that shows the top of the list.
 * (The JSON API in `_shared/keyset-pagination.ts` keeps its stricter 400 —
 * a machine client wants to be told.)
 */

/** Page sizes the pager offers. Fixed so a URL cannot ask for a million rows. */
export const DATA_PAGE_SIZES = [10, 25, 50] as const;
export type DataPageSize = (typeof DATA_PAGE_SIZES)[number];
export const DEFAULT_DATA_PAGE_SIZE: DataPageSize = 25;

/** Longest search text honoured. Longer input is truncated, not rejected. */
export const MAX_QUERY_LENGTH = 100;
/** Longest filter value honoured. */
const MAX_FILTER_VALUE_LENGTH = 100;

export type SortDirection = "asc" | "desc";

/** What a page declares about itself; everything else is derived from this. */
export type DataPageSpec = {
  /** Query-string names of the filters this page understands (e.g. `status`). */
  readonly filterKeys: readonly string[];
  /** Sort keys this page offers. The first is not implied to be the default. */
  readonly sortKeys: readonly string[];
  readonly defaultSort: string;
  readonly defaultDir: SortDirection;
};

export type DataPageQuery = {
  /** Trimmed, length-bounded search text; `""` when none. */
  q: string;
  /** Only keys in `spec.filterKeys`; only non-empty values. */
  filters: Readonly<Record<string, string>>;
  sort: string;
  dir: SortDirection;
  /** Opaque cursor, or `null` for the first page. */
  cursor: string | null;
  limit: DataPageSize;
};

type ParamSource = URLSearchParams | { get(name: string): string | null };

function readLimit(raw: string | null): DataPageSize {
  const parsed = Number.parseInt(raw ?? "", 10);
  return (DATA_PAGE_SIZES as readonly number[]).includes(parsed)
    ? (parsed as DataPageSize)
    : DEFAULT_DATA_PAGE_SIZE;
}

/**
 * Reads a data-page query out of URL parameters, discarding anything the page
 * did not declare. Never throws: every malformed value degrades to its default,
 * because the input is a URL anyone can edit.
 */
export function parseDataPageQuery(
  params: ParamSource,
  spec: DataPageSpec
): DataPageQuery {
  const q = (params.get("q") ?? "").trim().slice(0, MAX_QUERY_LENGTH);

  const filters: Record<string, string> = {};
  for (const key of spec.filterKeys) {
    const value = (params.get(key) ?? "")
      .trim()
      .slice(0, MAX_FILTER_VALUE_LENGTH);
    if (value !== "") filters[key] = value;
  }

  const requestedSort = params.get("sort") ?? "";
  const sort = spec.sortKeys.includes(requestedSort)
    ? requestedSort
    : spec.defaultSort;
  const requestedDir = params.get("dir");
  // A `dir` with no recognised `sort` is meaningless, so it too falls back.
  const dir: SortDirection =
    spec.sortKeys.includes(requestedSort) &&
    (requestedDir === "asc" || requestedDir === "desc")
      ? requestedDir
      : spec.defaultDir;

  const cursor = (params.get("cursor") ?? "").trim();

  return {
    q,
    filters,
    sort,
    dir,
    cursor: cursor === "" ? null : cursor,
    limit: readLimit(params.get("limit"))
  };
}

/** Changes to apply to a query. `cursor` is intentionally absent: see below. */
export type DataPageChange = {
  q?: string;
  /** Per-key: a string sets it, `null` removes it. Keys not listed are kept. */
  filters?: Readonly<Record<string, string | null>>;
  sort?: string;
  dir?: SortDirection;
  limit?: DataPageSize;
  /** The only change that KEEPS a cursor: paging itself. */
  cursor?: string | null;
};

/**
 * The URL of "this page, with `change` applied".
 *
 * Any change other than `cursor` drops the cursor. Defaults are left out so the
 * default state is the bare path.
 */
export function buildDataPageHref(
  basePath: string,
  spec: DataPageSpec,
  current: DataPageQuery,
  change: DataPageChange = {}
): string {
  const q = change.q ?? current.q;

  const filters: Record<string, string> = { ...current.filters };
  for (const [key, value] of Object.entries(change.filters ?? {})) {
    if (value === null || value === "") delete filters[key];
    else filters[key] = value;
  }

  const sort = change.sort ?? current.sort;
  const dir = change.dir ?? current.dir;
  const limit = change.limit ?? current.limit;
  // Only an explicit `cursor` change survives; everything else resets paging.
  const cursor = "cursor" in change ? (change.cursor ?? null) : null;

  const out = new URLSearchParams();
  if (q !== "") out.set("q", q);
  for (const key of spec.filterKeys) {
    const value = filters[key];
    if (value !== undefined && value !== "") out.set(key, value);
  }
  if (sort !== spec.defaultSort || dir !== spec.defaultDir) {
    out.set("sort", sort);
    out.set("dir", dir);
  }
  if (limit !== DEFAULT_DATA_PAGE_SIZE) out.set("limit", String(limit));
  if (cursor !== null) out.set("cursor", cursor);

  const qs = out.toString();
  return qs === "" ? basePath : `${basePath}?${qs}`;
}

/** One removable chip. `label` is the already-translated text. */
export type ActiveFilterChip = {
  /** Stable id for tests/hooks: `q` or the filter key. */
  id: string;
  label: string;
  /** Where the chip's remove control goes: the same page without this filter. */
  removeHref: string;
};

/**
 * The active-filter chips for a query, in a stable order (search text first,
 * then filters in `spec.filterKeys` order).
 *
 * `describe` turns a filter into its display label, e.g.
 * `("status", "active") -> "Status: Active"`. It is passed in rather than
 * built here because the words are the page's i18n, not this module's.
 */
export function buildActiveFilterChips(
  basePath: string,
  spec: DataPageSpec,
  query: DataPageQuery,
  describe: (key: "q" | string, value: string) => string
): ActiveFilterChip[] {
  const chips: ActiveFilterChip[] = [];

  if (query.q !== "") {
    chips.push({
      id: "q",
      label: describe("q", query.q),
      removeHref: buildDataPageHref(basePath, spec, query, { q: "" })
    });
  }
  for (const key of spec.filterKeys) {
    const value = query.filters[key];
    if (value === undefined) continue;
    chips.push({
      id: key,
      label: describe(key, value),
      removeHref: buildDataPageHref(basePath, spec, query, {
        filters: { [key]: null }
      })
    });
  }

  return chips;
}

/** `true` when anything narrows the list (what the empty state keys off). */
export function hasActiveFilters(query: DataPageQuery): boolean {
  return query.q !== "" || Object.keys(query.filters).length > 0;
}

/** The URL with every filter and the search text cleared; sort and size kept. */
export function buildClearFiltersHref(
  basePath: string,
  spec: DataPageSpec,
  query: DataPageQuery
): string {
  const filters: Record<string, null> = {};
  for (const key of spec.filterKeys) filters[key] = null;
  return buildDataPageHref(basePath, spec, query, { q: "", filters });
}

export type SortHeaderState = {
  /** Where activating the header goes (the next state in the cycle). */
  href: string;
  /** `null` when this column is not the sorted one. */
  direction: SortDirection | null;
};

/**
 * Sorting a column: first activation sorts ascending, activating the sorted
 * column flips it. (There is deliberately no third "unsorted" state — the page
 * always has a defined order, and a keyset cursor needs one.)
 */
export function buildSortHeaderState(
  basePath: string,
  spec: DataPageSpec,
  query: DataPageQuery,
  sortKey: string
): SortHeaderState {
  const isSorted = query.sort === sortKey;
  const nextDir: SortDirection =
    isSorted && query.dir === "asc" ? "desc" : "asc";
  return {
    href: buildDataPageHref(basePath, spec, query, {
      sort: sortKey,
      dir: nextDir
    }),
    direction: isSorted ? query.dir : null
  };
}

// ---------------------------------------------------------------------------
// Keyset slice over an ALREADY-LOADED, bounded list
// ---------------------------------------------------------------------------

/**
 * Cursor payload. `d` is the direction of travel from the anchor row:
 * `"a"` = rows AFTER it (Next), `"b"` = rows BEFORE it (Previous).
 * `k` is the anchor's sort value and `i` its id (the tiebreak that keeps the
 * order total, so rows are neither repeated nor skipped between pages).
 */
type CursorPayload = { d: "a" | "b"; k: string; i: string };

export function encodeSliceCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf-8").toString("base64url");
}

/** `null` for anything that is not a well-formed cursor of ours. */
export function decodeSliceCursor(raw: string | null): CursorPayload | null {
  if (raw === null || raw === "" || raw.length > 400) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(raw, "base64url").toString("utf-8")
    ) as Partial<CursorPayload> | null;
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      (parsed.d === "a" || parsed.d === "b") &&
      typeof parsed.k === "string" &&
      typeof parsed.i === "string"
    ) {
      return { d: parsed.d, k: parsed.k, i: parsed.i };
    }
    return null;
  } catch {
    return null;
  }
}

export type KeysetSlice<T> = {
  items: T[];
  /** Cursor for the next page, or `null` when this is the last. */
  nextCursor: string | null;
  /** Cursor for the previous page, or `null` when this is the first. */
  prevCursor: string | null;
  /** 1-based position of the first row shown within the full ordered list. */
  from: number;
  /** 1-based position of the last row shown; `0` when the list is empty. */
  to: number;
  /** Rows in the whole ordered list (exact — the list is already in memory). */
  total: number;
};

function compareText(a: string, b: string): number {
  // Code-unit order on purpose: deterministic across runtimes and locales, and
  // the same order a cursor comparison must use.
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Orders `rows` by `(sortValue, id)` in `dir` and returns the keyset page that
 * `cursor` selects.
 *
 * This is for lists that a screen has ALREADY loaded in full and that are
 * bounded by their loader (a `LIMIT`ed config list). It gives such a screen the
 * same URL contract and the same cursor shape a SQL-backed list will use, so
 * moving the query into SQL later changes the data source and nothing a reader
 * or a bookmark can see. It is NOT a licence to load an unbounded table and
 * page it here.
 */
export function sliceKeyset<T>(
  rows: readonly T[],
  options: {
    sortValue: (row: T) => string;
    id: (row: T) => string;
    dir: SortDirection;
    limit: number;
    cursor: string | null;
  }
): KeysetSlice<T> {
  const sign = options.dir === "asc" ? 1 : -1;
  const ordered = [...rows].sort(
    (a, b) =>
      sign * compareText(options.sortValue(a), options.sortValue(b)) ||
      sign * compareText(options.id(a), options.id(b))
  );
  const total = ordered.length;
  const limit = Math.max(1, options.limit);
  const anchor = decodeSliceCursor(options.cursor);

  // Index range [start, end) of the page within `ordered`.
  let start = 0;
  let end = Math.min(limit, total);

  if (anchor !== null) {
    const firstAfter = firstIndexAfter(ordered, anchor, options, sign);
    if (anchor.d === "a") {
      start = firstAfter;
      end = Math.min(start + limit, total);
    } else {
      // Rows strictly before the anchor end where the anchor (or, if it has
      // since left the list, the first row after it) begins.
      const beforeEnd = firstIndexAtOrAfter(ordered, anchor, options, sign);
      end = beforeEnd;
      start = Math.max(0, end - limit);
    }
  }

  const items = ordered.slice(start, end);
  const first = items[0];
  const last = items[items.length - 1];

  return {
    items,
    nextCursor:
      last !== undefined && end < total
        ? encodeSliceCursor({
            d: "a",
            k: options.sortValue(last),
            i: options.id(last)
          })
        : null,
    prevCursor:
      first !== undefined && start > 0
        ? encodeSliceCursor({
            d: "b",
            k: options.sortValue(first),
            i: options.id(first)
          })
        : null,
    from: items.length === 0 ? 0 : start + 1,
    to: start + items.length,
    total
  };
}

type SliceOptions<T> = {
  sortValue: (row: T) => string;
  id: (row: T) => string;
};

/** Index of the first row whose position is strictly after the anchor. */
function firstIndexAfter<T>(
  ordered: readonly T[],
  anchor: CursorPayload,
  options: SliceOptions<T>,
  sign: 1 | -1
): number {
  const index = ordered.findIndex(
    (row) => comparePosition(row, anchor, options, sign) > 0
  );
  return index === -1 ? ordered.length : index;
}

/** Index of the first row at or after the anchor (the anchor itself, if kept). */
function firstIndexAtOrAfter<T>(
  ordered: readonly T[],
  anchor: CursorPayload,
  options: SliceOptions<T>,
  sign: 1 | -1
): number {
  const index = ordered.findIndex(
    (row) => comparePosition(row, anchor, options, sign) >= 0
  );
  return index === -1 ? ordered.length : index;
}

/** Negative: row sorts before the anchor; zero: it is the anchor; positive: after. */
function comparePosition<T>(
  row: T,
  anchor: CursorPayload,
  options: SliceOptions<T>,
  sign: 1 | -1
): number {
  return (
    sign * compareText(options.sortValue(row), anchor.k) ||
    sign * compareText(options.id(row), anchor.i)
  );
}
