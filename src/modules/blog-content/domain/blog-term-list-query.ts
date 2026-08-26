/**
 * Parses and validates the query string of `GET /api/v1/blog/terms`.
 *
 * ## Why this endpoint grew a traversal
 *
 * `listBlogTerms` has always ended in `LIMIT 100`, ordered by name, and its
 * own comment justified that as "terms are low-cardinality config, same
 * bounded-list convention as email templates". For `category` and `channel`
 * that is true — a newsroom has a dozen of each, and always will.
 *
 * For `tag` it is not true and never was. The archive this repo is being made
 * ready for is 23,906 articles (Issue #599), and a tag vocabulary grown over
 * that many articles runs to thousands of entries. The endpoint answered such
 * a tenant with the alphabetically-first hundred, `200 OK`, and no indication
 * that anything had been left out — so a caller building a page per tag builds
 * a hundred pages, and every article filed under a tag later in the alphabet
 * points at a page nobody generated.
 *
 * NOTE ON "23,906": the measured snapshot is 25,029 — see ADR-0114
 * §Consequences, which is the single correction the figure points at. Left
 * standing here because this is an argument about scale, and it does not move.
 *
 * That is the shape of failure this module exists to end, and the fix is the
 * one `GET /api/v1/blog/posts` already established: an explicit
 * `?order=created_at` traversal with an opaque cursor, so a caller that needs
 * EVERY term can walk to the end and know when it has arrived.
 *
 * ## Why the default ordering is still by name, and why a cursor is refused there
 *
 * The admin taxonomy screen wants names in alphabetical order; a build wants
 * completeness. Those are different requests and this endpoint now serves
 * both, but only one of them can carry a cursor: `name` is editable, so a term
 * renamed between two requests moves across the page boundary and is either
 * skipped or returned twice, with nothing able to detect it. `created_at` is
 * immutable, which is what makes it the only sound key — the identical
 * reasoning `blog-post-list-query.ts` records for `updated_at`.
 *
 * Passing `?cursor=` without `?order=created_at` is therefore refused outright
 * rather than quietly honoured. A caller that silently paginates over a
 * mutable ordering does not find out; it just publishes a site that is missing
 * some tags.
 */
import {
  decodeKeysetCursor,
  type KeysetCursor
} from "../../_shared/keyset-pagination";
import {
  isTaxonomyType,
  TAXONOMY_TYPE_LIST,
  type TaxonomyType
} from "./taxonomy-policy";

export type BlogTermListQuery = {
  taxonomyType?: TaxonomyType;
  limit?: number;
  /** True only for `order=created_at` — the sole ordering a cursor is sound over. */
  stableOrder: boolean;
  cursor: KeysetCursor | null;
};

export type BlogTermListQueryResult =
  { valid: true; value: BlogTermListQuery } | { valid: false; message: string };

export function parseBlogTermListQuery(
  params: URLSearchParams
): BlogTermListQueryResult {
  const taxonomyTypeParam = params.get("taxonomyType");
  let taxonomyType: TaxonomyType | undefined;

  if (taxonomyTypeParam !== null) {
    if (!isTaxonomyType(taxonomyTypeParam)) {
      return {
        valid: false,
        message: `taxonomyType must be one of ${TAXONOMY_TYPE_LIST}.`
      };
    }

    taxonomyType = taxonomyTypeParam;
  }

  const limitParam = params.get("limit");
  const limit = limitParam ? Number(limitParam) : undefined;

  if (
    limitParam !== null &&
    (!Number.isFinite(limit) || (limit as number) < 1)
  ) {
    return { valid: false, message: "limit must be a positive number." };
  }

  const orderParam = params.get("order");

  if (
    orderParam !== null &&
    orderParam !== "created_at" &&
    orderParam !== "name"
  ) {
    return { valid: false, message: "order must be one of created_at, name." };
  }

  const stableOrder = orderParam === "created_at";
  const cursorParam = params.get("cursor");

  if (cursorParam !== null && !stableOrder) {
    return {
      valid: false,
      message:
        "cursor requires order=created_at — a term can be renamed, so a cursor over the name ordering can skip or repeat terms."
    };
  }

  const cursor = cursorParam ? decodeKeysetCursor(cursorParam) : null;

  if (cursorParam !== null && cursor === null) {
    return { valid: false, message: "cursor is malformed." };
  }

  return { valid: true, value: { taxonomyType, limit, stableOrder, cursor } };
}
