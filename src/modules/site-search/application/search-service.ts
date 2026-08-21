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
  /**
   * Term filters from the request (Issue #633), `{ channel: "politik" }`.
   *
   * ANDed with each other and with everything else: picking a channel and a
   * topic means "both", which is what a reader narrowing a list expects.
   * Matching is on the facet VALUE (the slug/code), never the label — a label
   * is display text that an editor may rewrite, and a filter that broke when
   * somebody fixed a capital letter would be a filter nobody trusts.
   */
  termFilters?: Readonly<Record<string, string>> | null;
  limit: number;
  cursor?: SearchCursor | null;
};

/**
 * Builds the jsonb containment operand for a set of term filters (Issue #633).
 *
 * `term_facets @> '[{"facet":"channel","value":"politik"},{"facet":"topic",...}]'`
 * is a single GIN-index-backed predicate that means "carries ALL of these",
 * which is precisely the AND semantics above — no per-filter subquery, no join,
 * and one bound parameter no matter how many filters there are.
 *
 * Returns `null` when there is nothing to filter by, so every caller can pass
 * the result straight into the same `IS NULL OR` shape the other optional
 * predicates use.
 */
export function buildTermFilterOperand(
  termFilters: Readonly<Record<string, string>> | null | undefined,
  exclude?: string
): string | null {
  const entries = Object.entries(termFilters ?? {}).filter(
    ([facet, value]) =>
      facet !== exclude && typeof value === "string" && value.length > 0
  );

  if (entries.length === 0) {
    return null;
  }

  return JSON.stringify(entries.map(([facet, value]) => ({ facet, value })));
}

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
  const termFilter = buildTermFilterOperand(options.termFilters);

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
        AND (${termFilter}::jsonb IS NULL OR d.term_facets @> ${termFilter}::jsonb)
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

export type SearchFacetValue = {
  /** The `resource_type` as stored — `blog_post`, `blog_page`, and whatever a future module contributes. */
  value: string;
  count: number;
};

type TermFacetRow = {
  facet: string;
  value: string;
  label: string | null;
  count: number;
};

/**
 * What a facet count needs to know. `resourceType` and `termFilters` ARE part
 * of it — a facet applies every filter except its own, so the function has to
 * be told about the ones it is going to leave out. The previous signature
 * omitted `resourceType` entirely, which encoded "never apply it" in the type;
 * that was right while there was one facet and wrong as soon as there were two.
 */
export type FacetCountOptions = Omit<SearchQueryOptions, "limit" | "cursor">;

export type SearchTermFacetValue = SearchFacetValue & {
  /** Display text for `value`, as stored on the documents that carry it. */
  label: string;
};

export type SearchFacets = {
  resourceTypes: SearchFacetValue[];
  /**
   * Term facets (Issue #633), keyed by facet name — `channel`, `topic`,
   * `institution`, `region`, and whatever a future module's descriptor
   * contributes. A facet with no matching documents is absent rather than
   * present-and-empty: the reader is being told what else is there, and an
   * empty list is not something else.
   */
  terms: Record<string, SearchTermFacetValue[]>;
};

/**
 * How many facet VALUES may be returned. A facet list is a public, anonymous
 * response body; without a ceiling its size is decided by however many resource
 * types the registry grows to.
 */
const MAX_FACET_VALUES = 20;

/**
 * Counts one term facet's values over the current result set (Issue #633).
 *
 * `exclude` is the facet being counted: its own filter is left out while every
 * OTHER filter — type, and the remaining term filters — is applied. Pass `null`
 * to apply all of them, which is the correct predicate for every facet the
 * reader has not filtered on.
 */
async function countTermFacetRows(
  tx: Bun.SQL,
  tenantId: string,
  options: FacetCountOptions,
  allowedTypesParam: unknown,
  exclude: string | null
): Promise<TermFacetRow[]> {
  const typeFilter = options.resourceType ?? null;
  const termFilter = buildTermFilterOperand(
    options.termFilters,
    exclude ?? undefined
  );

  return (await tx`
    SELECT f.value ->> 'facet' AS facet,
           f.value ->> 'value' AS value,
           max(f.value ->> 'label') AS label,
           count(DISTINCT d.id)::int AS count
    FROM awcms_site_search_documents d
    CROSS JOIN LATERAL jsonb_array_elements(d.term_facets) AS f(value)
    WHERE d.tenant_id = ${tenantId}
      AND d.locale = ${options.locale}
      AND d.search_vector @@ websearch_to_tsquery('simple', ${options.query})
      AND (${allowedTypesParam}::text[] IS NULL OR d.resource_type = ANY(${allowedTypesParam}::text[]))
      AND (${typeFilter}::text IS NULL OR d.resource_type = ${typeFilter})
      AND (${termFilter}::jsonb IS NULL OR d.term_facets @> ${termFilter}::jsonb)
      AND f.value ->> 'facet' IS NOT NULL
      AND f.value ->> 'value' IS NOT NULL
    GROUP BY 1, 2
    ORDER BY 1 ASC, count DESC, 2 ASC
  `) as TermFacetRow[];
}

/**
 * Counts the facets for one query (Issue #607 for content type, #633 for terms).
 *
 * ## A facet's own filter is never applied to its own count
 *
 * A facet count answers "what ELSE is there", so it must be computed over the
 * result set BEFORE that facet narrows it. Applying `resourceType` to the type
 * counts would make every other count zero the moment a reader picks one — and a
 * reader looking at a list of zeroes has no way back to the results they can
 * still see, because the interface has stopped telling them those results exist.
 *
 * The rule generalizes once there is more than one facet, and generalizing it is
 * what makes this function longer than a single query:
 *
 *   - the TYPE counts apply every term filter but not `resourceType`;
 *   - a term facet the reader has NOT filtered on applies everything, so all
 *     such facets share one query;
 *   - a term facet the reader HAS filtered on needs its own pass with only its
 *     own filter removed — which is why there is one extra query per active term
 *     filter, and no way to fold them into the first.
 *
 * Every other predicate is shared with `searchSiteContent`, character for
 * character: same tenant, same locale, same `websearch_to_tsquery`, same
 * admitted-type allow-list. A facet count derived from a wider predicate than
 * the results would advertise documents the reader cannot reach.
 *
 * ## Why this cannot become a cross-tenant oracle
 *
 * The explicit `tenant_id` predicate and RLS FORCE both bind it, the same
 * defence in depth every query in this repo carries. That matters more here than
 * for a result list: a COUNT leaks the existence of content without displaying
 * it, so a facet that escaped its tenant would be a disclosure with nothing on
 * screen to notice it by. `tests/integration/site-search.integration.test.ts`
 * asserts it negatively against a real database, for term facets as well as
 * type — the term facets get their OWN negative test rather than inheriting the
 * type facet's assumption.
 */
export async function countSearchFacets(
  tx: Bun.SQL,
  tenantId: string,
  options: FacetCountOptions
): Promise<SearchFacets> {
  const allowedTypes = options.enabledResourceTypes ?? null;
  const allowedTypesParam =
    allowedTypes === null ? null : tx.array(allowedTypes, "text");
  const typeFacetTermFilter = buildTermFilterOperand(options.termFilters);

  const rows = (await tx`
    SELECT d.resource_type AS value, count(*)::int AS count
    FROM awcms_site_search_documents d
    WHERE d.tenant_id = ${tenantId}
      AND d.locale = ${options.locale}
      AND d.search_vector @@ websearch_to_tsquery('simple', ${options.query})
      AND (${allowedTypesParam}::text[] IS NULL OR d.resource_type = ANY(${allowedTypesParam}::text[]))
      AND (${typeFacetTermFilter}::jsonb IS NULL OR d.term_facets @> ${typeFacetTermFilter}::jsonb)
    GROUP BY d.resource_type
    ORDER BY count DESC, value ASC
    LIMIT ${MAX_FACET_VALUES}
  `) as { value: string; count: number }[];

  const terms: Record<string, SearchTermFacetValue[]> = {};

  const collect = (termRows: TermFacetRow[], only: string | null): void => {
    for (const row of termRows) {
      if (only !== null && row.facet !== only) {
        continue;
      }
      const bucket = (terms[row.facet] ??= []);
      // The cap is per FACET, not per response: twenty channels and twenty
      // topics are two bounded lists, and truncating them jointly would
      // silently drop a whole dimension because another one was long.
      if (bucket.length >= MAX_FACET_VALUES) {
        continue;
      }
      bucket.push({
        value: row.value,
        label: row.label ?? row.value,
        count: Number(row.count)
      });
    }
  };

  const activeTermFacets = Object.keys(options.termFilters ?? {});

  // One pass with every filter applied. Correct for every facet the reader is
  // NOT filtering on; the facets they ARE filtering on are dropped from it
  // below and recomputed, each without its own filter.
  const baseRows = await countTermFacetRows(
    tx,
    tenantId,
    options,
    allowedTypesParam,
    null
  );
  collect(
    baseRows.filter((row) => !activeTermFacets.includes(row.facet)),
    null
  );

  for (const facet of activeTermFacets) {
    collect(
      await countTermFacetRows(tx, tenantId, options, allowedTypesParam, facet),
      facet
    );
  }

  return {
    resourceTypes: rows.map((row) => ({
      value: row.value,
      count: Number(row.count)
    })),
    terms
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
