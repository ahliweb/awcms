/**
 * Public search + suggestion queries for `site_search` (ADR-0040 §5, ported from
 * awcms-micro Issue #270). Every query is tenant + locale scoped (RLS FORCE plus
 * explicit predicates), so tenant A / locale A can never return tenant B /
 * another locale. The query text is ALWAYS a bound parameter into
 * `websearch_to_tsquery('simple', $1)` (SQL injection is impossible); snippets
 * are built with `ts_headline` sentinels and escaped in `renderSafeSnippet` (XSS
 * impossible). The index is a PROJECTION of public content only — it is never an
 * authorization source.
 */
import {
  renderSafeSnippet,
  SNIPPET_HEADLINE_OPTIONS
} from "../domain/search-snippet";

export type SearchResultItem = {
  resourceType: string;
  resourceId: string;
  url: string;
  title: string;
  snippet: string;
  locale: string;
  rank: number;
};

export type SearchResult = {
  items: SearchResultItem[];
  nextCursor: string | null;
};

export type SearchCursor = { rank: number; id: string };

export type SearchQueryOptions = {
  query: string;
  locale: string;
  /** Explicit type filter from the request (must also be in `enabledResourceTypes`). */
  resourceType?: string | null;
  /** The tenant's admitted-type allow-list (`null` = all). */
  enabledResourceTypes?: string[] | null;
  limit: number;
  cursor?: SearchCursor | null;
};

export function encodeSearchCursor(cursor: SearchCursor): string {
  return Buffer.from(`${cursor.rank}|${cursor.id}`, "utf8").toString(
    "base64url"
  );
}

export function decodeSearchCursor(raw: unknown): SearchCursor | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 512)
    return null;
  try {
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    const sep = decoded.indexOf("|");
    if (sep < 0) return null;
    const rank = Number(decoded.slice(0, sep));
    const id = decoded.slice(sep + 1);
    if (!Number.isFinite(rank) || id.length === 0) return null;
    return { rank, id };
  } catch {
    return null;
  }
}

type SearchRow = {
  resource_type: string;
  resource_id: string;
  url: string;
  title: string;
  locale: string;
  id_text: string;
  rank: number;
  snippet: string;
};

/**
 * Full-text search over the tenant's public index. Keyset-paginated on
 * `(rank DESC, id ASC)`. The inner query's `search_vector @@ websearch_to_tsquery`
 * predicate is GIN-index-backed; the outer keyset filter walks the bounded ranked
 * page.
 */
export async function searchSiteContent(
  tx: Bun.SQL,
  tenantId: string,
  options: SearchQueryOptions
): Promise<SearchResult> {
  const limit = Math.min(Math.max(1, Math.trunc(options.limit)), 100);
  const typeFilter = options.resourceType ?? null;
  const allowedTypes = options.enabledResourceTypes ?? null;
  const allowedTypesParam =
    allowedTypes === null ? null : tx.array(allowedTypes, "text");
  const cursorRank = options.cursor?.rank ?? null;
  const cursorId = options.cursor?.id ?? null;

  const rows = (await tx`
    SELECT ranked.resource_type, ranked.resource_id, ranked.url, ranked.title,
           ranked.locale, ranked.id_text, ranked.rank, ranked.snippet
    FROM (
      SELECT d.resource_type, d.resource_id, d.url, d.title, d.locale,
             d.id::text AS id_text,
             ts_rank(d.search_vector, websearch_to_tsquery('simple', ${options.query}))
               * d.weight AS rank,
             ts_headline(
               'simple',
               coalesce(nullif(d.body_text, ''), d.summary, d.title),
               websearch_to_tsquery('simple', ${options.query}),
               ${SNIPPET_HEADLINE_OPTIONS}
             ) AS snippet
      FROM awcms_site_search_documents d
      WHERE d.tenant_id = ${tenantId}
        AND d.locale = ${options.locale}
        AND d.search_vector @@ websearch_to_tsquery('simple', ${options.query})
        AND (${typeFilter}::text IS NULL OR d.resource_type = ${typeFilter})
        AND (${allowedTypesParam}::text[] IS NULL OR d.resource_type = ANY(${allowedTypesParam}::text[]))
    ) ranked
    WHERE (
      ${cursorRank}::float8 IS NULL
      OR ranked.rank < ${cursorRank}
      OR (ranked.rank = ${cursorRank} AND ranked.id_text > ${cursorId})
    )
    ORDER BY ranked.rank DESC, ranked.id_text ASC
    LIMIT ${limit + 1}
  `) as SearchRow[];

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const last = pageRows[pageRows.length - 1];

  return {
    items: pageRows.map((row) => ({
      resourceType: row.resource_type,
      resourceId: row.resource_id,
      url: row.url,
      title: row.title,
      snippet: renderSafeSnippet(row.snippet ?? ""),
      locale: row.locale,
      rank: row.rank
    })),
    nextCursor:
      hasMore && last
        ? encodeSearchCursor({ rank: last.rank, id: last.id_text })
        : null
  };
}

export type SuggestionItem = {
  resourceType: string;
  resourceId: string;
  url: string;
  title: string;
  locale: string;
};

/** Escape LIKE metacharacters so a suggestion term can never inject wildcards. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Bounded trigram typeahead over titles, tenant + locale scoped. Uses the
 * `gin_trgm_ops` index on `title` via `ILIKE`, ordered by trigram similarity.
 */
export async function suggestSiteContent(
  tx: Bun.SQL,
  tenantId: string,
  options: {
    query: string;
    locale: string;
    enabledResourceTypes?: string[] | null;
    limit: number;
  }
): Promise<SuggestionItem[]> {
  const limit = Math.min(Math.max(1, Math.trunc(options.limit)), 20);
  const allowedTypes = options.enabledResourceTypes ?? null;
  const allowedTypesParam =
    allowedTypes === null ? null : tx.array(allowedTypes, "text");
  const pattern = `%${escapeLike(options.query)}%`;

  const rows = (await tx`
    SELECT resource_type, resource_id, url, title, locale
    FROM awcms_site_search_documents
    WHERE tenant_id = ${tenantId}
      AND locale = ${options.locale}
      AND title ILIKE ${pattern}
      AND (${allowedTypesParam}::text[] IS NULL OR resource_type = ANY(${allowedTypesParam}::text[]))
    ORDER BY similarity(title, ${options.query}) DESC, title ASC
    LIMIT ${limit}
  `) as {
    resource_type: string;
    resource_id: string;
    url: string;
    title: string;
    locale: string;
  }[];

  return rows.map((row) => ({
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    url: row.url,
    title: row.title,
    locale: row.locale
  }));
}
