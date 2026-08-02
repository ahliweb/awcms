/**
 * Parses and validates the query string of `GET /api/v1/blog/posts`.
 *
 * ## Why this is a domain function and not inline in the route
 *
 * Every rule here is a rule about what a caller may ASK for, and each one
 * exists because the wrong answer is silent:
 *
 *   - a cursor over the mutable ordering skips or repeats rows, and the caller
 *     cannot tell (see `blog-post-directory.ts`);
 *   - a malformed cursor treated as "no cursor" restarts the traversal from
 *     page one, so a build quietly re-reads what it already had and never
 *     reaches the end;
 *   - an unknown `view` silently falling back to summaries hands back rows
 *     without `contentJson` to a caller that asked for full posts — the exact
 *     failure this parameter was added to end.
 *
 * None of those can be reached through the route without a database and a
 * session, so inline validation is validation nothing tests. Here it is a pure
 * function over `URLSearchParams`, and `tests/blog-content-posts-list-query.test.ts`
 * covers each refusal.
 */
import { isBlogContentStatus, type BlogContentStatus } from "./post-status";

import {
  decodeKeysetCursor,
  type KeysetCursor
} from "../../_shared/keyset-pagination";

/** `summary` is the admin table's shape; `full` is the build feed's. */
export type BlogPostListView = "summary" | "full";

/**
 * Longest `locale` this filter will accept. There is no shape validation
 * beyond non-empty and this bound, and that is deliberate: `awcms_blog_posts.locale`
 * is plain `text NOT NULL DEFAULT 'id'`, and the WRITE path
 * (`validateLocaleField`) accepts any non-empty string. A read filter stricter
 * than the write path would make a stored locale unreachable — a row that
 * exists, that the admin table shows, and that no query can select. The bound
 * exists only so an absurd value is refused before it reaches the database.
 */
export const MAX_LOCALE_FILTER_LENGTH = 35;

export type BlogPostListQuery = {
  status?: BlogContentStatus;
  /** Exact match on the post's stored `locale`. */
  locale?: string;
  limit?: number;
  /** True only for `order=created_at` — the sole ordering a cursor is sound over. */
  stableOrder: boolean;
  cursor: KeysetCursor | null;
  view: BlogPostListView;
};

export type BlogPostListQueryResult =
  { valid: true; value: BlogPostListQuery } | { valid: false; message: string };

const VIEWS: readonly BlogPostListView[] = ["summary", "full"];

export function parseBlogPostListQuery(
  params: URLSearchParams
): BlogPostListQueryResult {
  const statusParam = params.get("status");
  let status: BlogContentStatus | undefined;

  if (statusParam !== null) {
    if (!isBlogContentStatus(statusParam)) {
      return {
        valid: false,
        message:
          "status must be one of draft, review, scheduled, published, archived."
      };
    }

    status = statusParam;
  }

  // `locale` closes awcms-astro ADR-0021 §2: a build for a single-language site
  // had to pull EVERY locale and discard most of it, because there was no way
  // to ask for one. An empty `?locale=` is refused rather than ignored — a
  // caller that meant to filter and got the unfiltered feed builds a site with
  // every translation of every article in it, and nothing anywhere fails.
  const localeParam = params.get("locale");
  let locale: string | undefined;

  if (localeParam !== null) {
    const trimmed = localeParam.trim();

    if (trimmed.length === 0) {
      return {
        valid: false,
        message: "locale must not be empty when provided."
      };
    }

    if (trimmed.length > MAX_LOCALE_FILTER_LENGTH) {
      return {
        valid: false,
        message: `locale must be at most ${MAX_LOCALE_FILTER_LENGTH} characters.`
      };
    }

    locale = trimmed;
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
    orderParam !== "updated_at"
  ) {
    return {
      valid: false,
      message: "order must be one of created_at, updated_at."
    };
  }

  const stableOrder = orderParam === "created_at";
  const cursorParam = params.get("cursor");

  if (cursorParam !== null && !stableOrder) {
    return {
      valid: false,
      message:
        "cursor requires order=created_at — updated_at changes on every edit, so a cursor over it can skip or repeat posts."
    };
  }

  const cursor = cursorParam ? decodeKeysetCursor(cursorParam) : null;

  if (cursorParam !== null && cursor === null) {
    return { valid: false, message: "cursor is malformed." };
  }

  const viewParam = params.get("view");

  if (viewParam !== null && !VIEWS.includes(viewParam as BlogPostListView)) {
    return { valid: false, message: "view must be one of summary, full." };
  }

  // `view=full` is the build feed, and a build feed is a TRAVERSAL: it only
  // means anything if the caller can walk it to the end. Serving it over the
  // mutable ordering would hand back a first page that cannot be continued —
  // `cursor` is refused there — so the ordering is demanded up front instead of
  // being silently substituted, which is the same stance `cursor` takes.
  if (viewParam === "full" && !stableOrder) {
    return {
      valid: false,
      message:
        "view=full requires order=created_at — a full traversal is only sound over the immutable ordering."
    };
  }

  return {
    valid: true,
    value: {
      status,
      locale,
      limit,
      stableOrder,
      cursor,
      view: (viewParam as BlogPostListView | null) ?? "summary"
    }
  };
}
