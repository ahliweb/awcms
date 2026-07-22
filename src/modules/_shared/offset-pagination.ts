/**
 * Shared bounds for `?page=`/`OFFSET` (page-number) pagination (Issue #819).
 *
 * Keyset pagination (`keyset-pagination.ts`) is the preferred shape for list
 * endpoints, but a few surfaces genuinely need a page *number* (public blog
 * archives with `?page=2` links that must stay stable/bookmarkable, admin
 * lists with a total count). Those compute `OFFSET (page - 1) * pageSize`,
 * which makes an unbounded `page` two distinct hazards:
 *
 *   - `?page=1e8` → `OFFSET 1e9`. Postgres still scans and discards a
 *     billion rows, holding a pool connection for the duration. On a route
 *     that is public and unauthenticated, one GET per connection exhausts
 *     the pool.
 *   - `?page=abc` → `Number("abc")` → `NaN` → `OFFSET NaN` → 500.
 *
 * So every page number crossing into a query must go through
 * `boundedPageNumber`, which clamps *both* ends and rejects non-finite and
 * fractional input. Junk is normalised to page 1 rather than surfaced as an
 * error: these are HTML archive routes where a bad `?page=` should render
 * the first page, not a 500 (and not a 400 that crawlers would index).
 */

/**
 * Upper bound on `?page=`. Deep offsets past this are not meaningful for the
 * surfaces here (a public blog archive at page 10,000 with the default page
 * size is already 100,000 posts deep), and allowing them only buys an
 * attacker a longer scan.
 */
export const MAX_PAGE_NUMBER = 10_000;

/**
 * Clamp a client-supplied page number into `[1, maxPage]`.
 *
 * Returns 1 for `undefined`, `NaN`, and `±Infinity` — `Math.max(NaN, 1)` is
 * `NaN`, so a bare `Math.max` guard passes junk straight through to `OFFSET`.
 * Fractional input is truncated (`OFFSET 1.5` is a Postgres error).
 */
export function boundedPageNumber(
  page: number | undefined,
  maxPage: number = MAX_PAGE_NUMBER
): number {
  if (page === undefined || !Number.isFinite(page)) {
    return 1;
  }

  return Math.min(Math.max(Math.trunc(page), 1), maxPage);
}

/**
 * Clamp a client-supplied page size into `[1, maxPageSize]`, falling back to
 * `defaultPageSize` for absent or non-finite input. Same `NaN` reasoning as
 * `boundedPageNumber`.
 */
export function boundedPageSize(
  pageSize: number | undefined,
  defaultPageSize: number,
  maxPageSize: number
): number {
  if (pageSize === undefined || !Number.isFinite(pageSize)) {
    return defaultPageSize;
  }

  return Math.min(Math.max(Math.trunc(pageSize), 1), maxPageSize);
}

/**
 * Parse a raw `?page=` query-string value into a bounded page number.
 *
 * Routes should use this rather than `Number(param)` directly: the parsed
 * value is typically reused for rendering (pagination nav links, "page N of"
 * labels), so it must be the *same* clamped number the query used — otherwise
 * `?page=abc` renders `NaN` into next/prev links even once the query itself
 * is safe.
 */
export function parsePageParam(
  rawPage: string | null | undefined,
  maxPage: number = MAX_PAGE_NUMBER
): number {
  if (rawPage === null || rawPage === undefined || rawPage.trim() === "") {
    return 1;
  }

  return boundedPageNumber(Number(rawPage), maxPage);
}
