/**
 * The pure heart of `site_search`'s generic extraction engine (ADR-0040 §3/§4,
 * ported from awcms-micro Issue #270). Builds the PARAMETERIZED SQL that reads a
 * content module's source table through its declarative `SearchSourceDescriptor`,
 * and maps each source row to a neutral `SearchDocumentInput` ready to upsert
 * into `awcms_site_search_documents`.
 *
 * SQL-injection posture: literal filter VALUES and the tenant id are ALWAYS bound
 * parameters (`$1`, `$2`, ...); only descriptor-declared IDENTIFIERS (table/column
 * names) are interpolated, and every one passes `assertSafeIdentifier` /
 * `assertSafeTableName` immediately before interpolation — the exact discipline
 * `data_lifecycle`'s generic executionMode uses.
 */
import type {
  SearchSourceDescriptor,
  SearchSourceTermFacet
} from "../../_shared/module-contract";
import { stripControlCharacters } from "./search-query";
import {
  assertSafeIdentifier,
  assertSafeTableName
} from "./search-source-registry";

/** Max stored lengths (mirror the sql/064 CHECK constraints, kept just under). */
export const MAX_TITLE_LENGTH = 500;
export const MAX_SUMMARY_LENGTH = 2000;
export const MAX_BODY_LENGTH = 16000;

/**
 * Bounds on the term facets one document may carry (Issue #633).
 *
 * A facet list is read back into a PUBLIC, anonymous response, and its size is
 * decided by the source data rather than by anything this module controls — a
 * post filed under two hundred topics would otherwise put two hundred entries
 * into every document row and every facet count. The cap is per document, so
 * one over-tagged article is bounded without capping the vocabulary itself.
 */
export const MAX_TERM_FACETS_PER_DOCUMENT = 50;
/** Per-entry bound, applied to the value and the label independently. */
export const MAX_TERM_FACET_TEXT_LENGTH = 200;

/**
 * One facetable term a document carries: `channel` = `politik` labelled
 * "Politik". `value` is what a filter matches and what a URL carries; `label`
 * is what a reader sees. See `SearchSourceTermFacet` for why they are not one
 * field.
 */
export type SearchDocumentTermFacet = {
  facet: string;
  value: string;
  label: string;
};

export type SearchDocumentInput = {
  sourceKey: string;
  resourceType: string;
  resourceId: string;
  locale: string;
  url: string;
  title: string;
  summary: string | null;
  bodyText: string | null;
  tags: string[];
  tagsText: string | null;
  /** Facetable terms (Issue #633) — deliberately NOT folded into `tags`, which feeds the weighted `search_vector`. */
  termFacets: SearchDocumentTermFacet[];
  weight: number;
  sourceUpdatedAt: Date;
  sourceChecksum: string;
};

export type ExtractionRow = {
  id: unknown;
  locale: unknown;
  updated_at: unknown;
  title: unknown;
  summary: unknown;
  body: unknown;
  tags: unknown;
  slug: unknown;
  term_facets?: unknown;
};

export type BuiltQuery = { text: string; values: unknown[] };

export type ExtractionOptions =
  | { mode: "single"; resourceId: string }
  | { mode: "batch"; cursorId: string | null; batchSize: number };

/**
 * Build the parameterized extraction SELECT for one source. `mode: "single"`
 * fetches exactly one resource by id (the reindex primitive); `mode: "batch"`
 * walks the published set in stable id order via a keyset cursor (the reconcile
 * sweep). The publication predicate is enforced HERE (source→index boundary) so
 * a non-public row is never even read into the index.
 */
/**
 * Builds the jsonb expression that yields ONE document's term facets (Issue
 * #633), as a `[{facet,value,label}, ...]` array.
 *
 * ## Why a correlated subquery and not a LEFT JOIN
 *
 * A join against a many-to-many link table multiplies the source rows, and the
 * extraction query is keyset-paginated on the source id — a duplicated id would
 * make the cursor skip or repeat. An aggregate subquery per facet keeps the
 * outer query exactly one row per source row, which is the property the whole
 * batch walk rests on.
 *
 * ## The tenant is bound TWICE on purpose
 *
 * `$1` is applied to the link table AND the value table, on top of RLS. A join
 * is the one place where a row from another tenant could be reached without the
 * outer predicate noticing, and "RLS would have caught it" is not a reason to
 * leave the predicate out — the facet surface is public and anonymous, and a
 * count that escaped its tenant discloses content without showing it.
 *
 * Only identifiers are interpolated, each through `assertSafeIdentifier` /
 * `assertSafeTableName`; `facetKey` and every `valueEquals` value are bound.
 */
function buildTermFacetExpression(
  facet: SearchSourceTermFacet,
  outerTable: string,
  outerIdCol: string,
  values: unknown[],
  param: { next: number }
): string {
  const bind = (value: unknown): string => {
    values.push(value);
    const placeholder = `$${param.next}`;
    param.next += 1;
    return placeholder;
  };

  const facetKeyParam = bind(facet.facetKey);

  if (facet.kind === "column") {
    const valueCol = assertSafeIdentifier(
      facet.valueColumn,
      "termFacets.valueColumn"
    );
    const labelCol = facet.labelColumn
      ? assertSafeIdentifier(facet.labelColumn, "termFacets.labelColumn")
      : valueCol;

    // An empty string is as absent as NULL for a facet: it would produce a
    // clickable filter that matches nothing and a blank entry in the list.
    return `CASE
        WHEN ${outerTable}.${valueCol} IS NULL
          OR btrim(${outerTable}.${valueCol}::text) = '' THEN '[]'::jsonb
        ELSE jsonb_build_array(jsonb_build_object(
          'facet', ${facetKeyParam}::text,
          'value', ${outerTable}.${valueCol}::text,
          'label', ${outerTable}.${labelCol}::text))
      END`;
  }

  const linkTable = assertSafeTableName(facet.linkTable);
  const valueTable = assertSafeTableName(facet.valueTable);
  const linkSourceCol = assertSafeIdentifier(
    facet.linkSourceColumn,
    "termFacets.linkSourceColumn"
  );
  const linkValueCol = assertSafeIdentifier(
    facet.linkValueColumn,
    "termFacets.linkValueColumn"
  );
  const valueIdCol = assertSafeIdentifier(
    facet.valueIdColumn,
    "termFacets.valueIdColumn"
  );
  const valueCol = assertSafeIdentifier(
    facet.valueColumn,
    "termFacets.valueColumn"
  );
  const labelCol = assertSafeIdentifier(
    facet.labelColumn,
    "termFacets.labelColumn"
  );
  const tenantCol = assertSafeIdentifier(
    facet.tenantColumn ?? "tenant_id",
    "termFacets.tenantColumn"
  );

  const predicates: string[] = [];

  for (const [col, value] of Object.entries(facet.valueEquals ?? {})) {
    predicates.push(
      `v.${assertSafeIdentifier(col, "termFacets.valueEquals")} = ${bind(value)}`
    );
  }

  for (const col of facet.valueNullColumns ?? []) {
    predicates.push(
      `v.${assertSafeIdentifier(col, "termFacets.valueNullColumns")} IS NULL`
    );
  }

  return `COALESCE((
        SELECT jsonb_agg(DISTINCT jsonb_build_object(
                 'facet', ${facetKeyParam}::text,
                 'value', v.${valueCol}::text,
                 'label', v.${labelCol}::text))
        FROM ${linkTable} l
        JOIN ${valueTable} v
          ON v.${valueIdCol} = l.${linkValueCol}
         AND v.${tenantCol} = $1
        WHERE l.${tenantCol} = $1
          AND l.${linkSourceCol} = ${outerTable}.${outerIdCol}
          AND v.${valueCol} IS NOT NULL
          AND btrim(v.${valueCol}::text) <> ''
          ${predicates.map((c) => `AND ${c}`).join("\n          ")}
      ), '[]'::jsonb)`;
}

export function buildExtractionQuery(
  tenantId: string,
  descriptor: SearchSourceDescriptor,
  options: ExtractionOptions
): BuiltQuery {
  const table = assertSafeTableName(descriptor.tableName);
  const tenantCol = assertSafeIdentifier(
    descriptor.tenantColumn ?? "tenant_id",
    "tenantColumn"
  );
  const idCol = assertSafeIdentifier(descriptor.idColumn ?? "id", "idColumn");
  const localeCol = assertSafeIdentifier(
    descriptor.localeColumn,
    "localeColumn"
  );
  const updatedCol = assertSafeIdentifier(
    descriptor.updatedAtColumn,
    "updatedAtColumn"
  );
  const titleCol = assertSafeIdentifier(descriptor.titleColumn, "titleColumn");
  const summaryExpr = descriptor.summaryColumn
    ? assertSafeIdentifier(descriptor.summaryColumn, "summaryColumn")
    : "NULL::text";
  const bodyExpr =
    "left(concat_ws(' ', " +
    descriptor.bodyColumns
      .map((c, i) => assertSafeIdentifier(c, `bodyColumns[${i}]`))
      .join(", ") +
    `), ${MAX_BODY_LENGTH})`;
  const tagsExpr = descriptor.tagsColumn
    ? assertSafeIdentifier(descriptor.tagsColumn, "tagsColumn")
    : "NULL::text[]";
  const slugExpr = descriptor.slugColumn
    ? assertSafeIdentifier(descriptor.slugColumn, "slugColumn")
    : "NULL::text";

  const values: unknown[] = [tenantId];
  const predicates: string[] = [];
  let p = 2;

  const filter = descriptor.publicationFilter;
  for (const [col, value] of Object.entries(filter.equals ?? {})) {
    predicates.push(`${assertSafeIdentifier(col, "equals")} = $${p}`);
    values.push(value);
    p += 1;
  }
  for (const col of filter.notNullColumns ?? []) {
    predicates.push(`${assertSafeIdentifier(col, "notNull")} IS NOT NULL`);
  }
  for (const col of filter.nullColumns ?? []) {
    predicates.push(`${assertSafeIdentifier(col, "null")} IS NULL`);
  }
  for (const col of filter.timeReachedColumns ?? []) {
    predicates.push(`${assertSafeIdentifier(col, "timeReached")} <= now()`);
  }

  // Facet expressions are built here — after the publication predicates and
  // before the scope/cursor params — so every `$n` they bind lines up with the
  // order this function pushes into `values`.
  const facetParam = { next: p };
  const facetExpressions = (descriptor.termFacets ?? []).map((facet) =>
    buildTermFacetExpression(facet, table, idCol, values, facetParam)
  );
  p = facetParam.next;
  // `||` concatenates jsonb arrays, so a source with no facets yields `[]` and
  // the column is never NULL — one shape for the mapper to read.
  const termFacetsExpr =
    facetExpressions.length === 0
      ? "'[]'::jsonb"
      : facetExpressions.join("\n           || ");

  let scope = "";
  let tail = "";
  if (options.mode === "single") {
    scope = `AND ${idCol}::text = $${p}`;
    values.push(options.resourceId);
    p += 1;
    tail = "LIMIT 1";
  } else {
    if (options.cursorId !== null) {
      scope = `AND ${idCol}::text > $${p}`;
      values.push(options.cursorId);
      p += 1;
    }
    tail = `ORDER BY ${idCol}::text ASC LIMIT $${p}`;
    values.push(Math.max(1, Math.trunc(options.batchSize)));
  }

  const text = `
    SELECT ${idCol}::text AS id,
           ${localeCol} AS locale,
           ${updatedCol} AS updated_at,
           ${titleCol} AS title,
           ${summaryExpr} AS summary,
           ${bodyExpr} AS body,
           ${tagsExpr} AS tags,
           ${slugExpr} AS slug,
           ${termFacetsExpr} AS term_facets
    FROM ${table}
    WHERE ${tenantCol} = $1
      ${predicates.map((c) => `AND ${c}`).join("\n      ")}
      ${scope}
    ${tail}
  `;

  return { text, values };
}

/**
 * Build the bounded COUNT of a source's currently-public rows — the
 * reconciliation "matches source counts" signal (ADR-0040 §4). Same predicate as
 * the extraction query so the count exactly describes the extracted set.
 */
export function buildSourceCountQuery(
  tenantId: string,
  descriptor: SearchSourceDescriptor
): BuiltQuery {
  const table = assertSafeTableName(descriptor.tableName);
  const tenantCol = assertSafeIdentifier(
    descriptor.tenantColumn ?? "tenant_id",
    "tenantColumn"
  );
  const values: unknown[] = [tenantId];
  const predicates: string[] = [];
  let p = 2;
  const filter = descriptor.publicationFilter;
  for (const [col, value] of Object.entries(filter.equals ?? {})) {
    predicates.push(`${assertSafeIdentifier(col, "equals")} = $${p}`);
    values.push(value);
    p += 1;
  }
  for (const col of filter.notNullColumns ?? []) {
    predicates.push(`${assertSafeIdentifier(col, "notNull")} IS NOT NULL`);
  }
  for (const col of filter.nullColumns ?? []) {
    predicates.push(`${assertSafeIdentifier(col, "null")} IS NULL`);
  }
  for (const col of filter.timeReachedColumns ?? []) {
    predicates.push(`${assertSafeIdentifier(col, "timeReached")} <= now()`);
  }
  const text = `
    SELECT count(*)::int AS count
    FROM ${table}
    WHERE ${tenantCol} = $1
      ${predicates.map((c) => `AND ${c}`).join("\n      ")}
  `;
  return { text, values };
}

/**
 * Build the stale-removal DELETE for one source — the "archive/delete/unpublish
 * removes content from public results with NO stale leakage" mechanism (ADR-0040
 * §4). Deletes every index document whose source row is gone OR no longer
 * satisfies the publication predicate. A single anti-join, so reconcile never has
 * to hold the whole published set in memory to find what became stale.
 */
export function buildStaleRemovalQuery(
  tenantId: string,
  descriptor: SearchSourceDescriptor
): BuiltQuery {
  const table = assertSafeTableName(descriptor.tableName);
  const tenantCol = assertSafeIdentifier(
    descriptor.tenantColumn ?? "tenant_id",
    "tenantColumn"
  );
  const idCol = assertSafeIdentifier(descriptor.idColumn ?? "id", "idColumn");
  const localeCol = assertSafeIdentifier(
    descriptor.localeColumn,
    "localeColumn"
  );

  const values: unknown[] = [tenantId, descriptor.key];
  const predicates: string[] = [];
  let p = 3;
  const filter = descriptor.publicationFilter;
  for (const [col, value] of Object.entries(filter.equals ?? {})) {
    predicates.push(`s.${assertSafeIdentifier(col, "equals")} = $${p}`);
    values.push(value);
    p += 1;
  }
  for (const col of filter.notNullColumns ?? []) {
    predicates.push(`s.${assertSafeIdentifier(col, "notNull")} IS NOT NULL`);
  }
  for (const col of filter.nullColumns ?? []) {
    predicates.push(`s.${assertSafeIdentifier(col, "null")} IS NULL`);
  }
  for (const col of filter.timeReachedColumns ?? []) {
    predicates.push(`s.${assertSafeIdentifier(col, "timeReached")} <= now()`);
  }

  const text = `
    DELETE FROM awcms_site_search_documents d
    WHERE d.tenant_id = $1 AND d.source_key = $2
      AND NOT EXISTS (
        SELECT 1 FROM ${table} s
        WHERE s.${tenantCol} = $1
          AND s.${idCol}::text = d.resource_id
          AND s.${localeCol} = d.locale
          ${predicates.map((c) => `AND ${c}`).join("\n          ")}
      )
  `;
  return { text, values };
}

/** Truncate + strip control characters (clean text for the index/snippet). */
function cleanText(value: unknown, maxLength: number): string {
  const text = stripControlCharacters(String(value ?? "")).trim();
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

export type DocumentUrlParts = {
  slug: string | null;
  id: string;
  /**
   * The indexed tenant's `awcms_tenants.tenant_code`. Required whenever the
   * descriptor's `urlTemplate` contains `:tenantCode` — this base's public
   * content routes are path-tenant-scoped (`/blog/{tenantCode}/{slug}`,
   * ADR-0009), unlike awcms-micro's host-resolved `/news/:slug`.
   */
  tenantCode?: string | null;
};

/**
 * Resolve the descriptor's `urlTemplate` for one row. `:slug` / `:id` /
 * `:tenantCode` placeholders are replaced with `encodeURIComponent`'d values — a
 * slug or tenant code can therefore never inject a new path segment, `..`, or a
 * scheme (path-safety / open-redirect-adjacent defense). The result is always an
 * absolute path.
 *
 * A template that needs `:tenantCode` but is handed none THROWS rather than
 * emitting a literal `:tenantCode` segment: a silently malformed public URL in
 * the index would be a defect served to every visitor, and the indexer's
 * per-item failure isolation records it as an `extract_error` instead.
 */
export function buildDocumentUrl(
  descriptor: SearchSourceDescriptor,
  parts: DocumentUrlParts
): string {
  let url = descriptor.urlTemplate;
  if (url.includes(":tenantCode")) {
    const code = parts.tenantCode;
    if (typeof code !== "string" || code.length === 0) {
      throw new Error(
        `site_search: urlTemplate ${JSON.stringify(descriptor.urlTemplate)} for source ${JSON.stringify(descriptor.key)} requires a tenantCode, but none was supplied.`
      );
    }
    url = url.split(":tenantCode").join(encodeURIComponent(code));
  }
  if (url.includes(":slug")) {
    const slug = parts.slug ?? parts.id;
    url = url.split(":slug").join(encodeURIComponent(slug));
  }
  if (url.includes(":id")) {
    url = url.split(":id").join(encodeURIComponent(parts.id));
  }
  return url;
}

/** sha256 over the extracted searchable fields — the reconcile "unchanged?" / checksum signal. Deliberately excludes `sourceUpdatedAt` so a no-op re-save (same content) is detected as unchanged. */
export function computeDocumentChecksum(fields: {
  resourceType: string;
  resourceId: string;
  locale: string;
  url: string;
  title: string;
  summary: string | null;
  bodyText: string | null;
  tags: string[];
  /**
   * Optional so every existing caller compiles unchanged — and appended LAST in
   * the canonical array so a document with no facets hashes exactly as it did
   * before Issue #633. Without that, the first reconcile after deploying this
   * would rewrite every document in every tenant to store an identical row.
   */
  termFacets?: readonly SearchDocumentTermFacet[];
  weight: number;
}): string {
  const facets = fields.termFacets ?? [];
  const canonical = JSON.stringify([
    fields.resourceType,
    fields.resourceId,
    fields.locale,
    fields.url,
    fields.title,
    fields.summary,
    fields.bodyText,
    fields.tags,
    fields.weight,
    ...(facets.length > 0
      ? [facets.map((f) => [f.facet, f.value, f.label])]
      : [])
  ]);
  return new Bun.CryptoHasher("sha256").update(canonical).digest("hex");
}

/** Map a raw extraction row to the neutral `SearchDocumentInput`. */
/**
 * Normalizes whatever the `term_facets` jsonb column produced into the bounded,
 * clean shape stored on the document (Issue #633).
 *
 * Every entry is re-validated here rather than trusted from the query, because
 * the values come from a content module's own tables — an editor typed them —
 * and the array is read back into a public response body. Bounds are applied per
 * entry AND to the list, control characters are stripped as everywhere else in
 * this file, and duplicates are collapsed: two source rows can legitimately
 * carry the same term, and a facet list that repeats a value would produce two
 * identical filter chips.
 */
function normalizeTermFacets(value: unknown): SearchDocumentTermFacet[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const facets: SearchDocumentTermFacet[] = [];

  for (const entry of value) {
    if (facets.length >= MAX_TERM_FACETS_PER_DOCUMENT) {
      break;
    }
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const record = entry as Record<string, unknown>;
    const facet = cleanText(record.facet, MAX_TERM_FACET_TEXT_LENGTH);
    const facetValue = cleanText(record.value, MAX_TERM_FACET_TEXT_LENGTH);

    if (facet.length === 0 || facetValue.length === 0) {
      continue;
    }

    const dedupeKey = `${facet}\u0000${facetValue}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);

    // A missing label is not an error — a `kind: "column"` facet may have no
    // separate label column, and the value is then the honest display text.
    const label =
      cleanText(record.label, MAX_TERM_FACET_TEXT_LENGTH) || facetValue;

    facets.push({ facet, value: facetValue, label });
  }

  // Stable order so the checksum below does not change just because Postgres
  // aggregated the same set differently between two runs.
  return facets.sort((a, b) =>
    a.facet === b.facet
      ? a.value.localeCompare(b.value)
      : a.facet.localeCompare(b.facet)
  );
}

export function mapRowToDocument(
  descriptor: SearchSourceDescriptor,
  row: ExtractionRow,
  context: { tenantCode?: string | null } = {}
): SearchDocumentInput {
  const resourceId = String(row.id);
  const locale = String(row.locale ?? "");
  const title = cleanText(row.title, MAX_TITLE_LENGTH);
  const summary =
    row.summary === null || row.summary === undefined
      ? null
      : cleanText(row.summary, MAX_SUMMARY_LENGTH) || null;
  const bodyText =
    row.body === null || row.body === undefined
      ? null
      : cleanText(row.body, MAX_BODY_LENGTH) || null;
  const tags = Array.isArray(row.tags)
    ? row.tags
        .map((t) => stripControlCharacters(String(t)).trim())
        .filter((t) => t.length > 0)
    : [];
  const tagsText = tags.length > 0 ? tags.join(" ") : null;
  const termFacets = normalizeTermFacets(row.term_facets);
  const slug =
    row.slug === null || row.slug === undefined ? null : String(row.slug);
  const url = buildDocumentUrl(descriptor, {
    slug,
    id: resourceId,
    tenantCode: context.tenantCode ?? null
  });
  const sourceUpdatedAt =
    row.updated_at instanceof Date
      ? row.updated_at
      : new Date(String(row.updated_at));
  const sourceChecksum = computeDocumentChecksum({
    resourceType: descriptor.resourceType,
    resourceId,
    locale,
    url,
    title,
    summary,
    bodyText,
    tags,
    // In the checksum, because the checksum is the ONLY thing that decides
    // whether an upsert rewrites a row. A post moved from one channel to
    // another changes nothing else about its document — without this, the
    // reconcile sweep would report "unchanged" and the facet would keep
    // counting it under the old channel forever.
    termFacets,
    weight: descriptor.weight
  });

  return {
    sourceKey: descriptor.key,
    resourceType: descriptor.resourceType,
    resourceId,
    locale,
    url,
    title: title || "(untitled)",
    summary,
    bodyText,
    tags,
    tagsText,
    termFacets,
    weight: descriptor.weight,
    sourceUpdatedAt,
    sourceChecksum
  };
}
