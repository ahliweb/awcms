/**
 * Pure query normalization + bounds for `site_search` (ADR-0040 §5, as amended
 * for prefix matching). The text built by `buildPrefixTsQuery` is passed to
 * PostgreSQL's `to_tsquery('simple', $1)` as a BOUND PARAMETER (never
 * interpolated), so it is never concatenated into SQL text. Normalization here
 * is about ABUSE BOUNDS and determinism (length caps, whitespace collapse,
 * control-char stripping, cache-key stability); tokenization is what keeps
 * tsquery OPERATORS out of the bound text (see `tokenizeSearchQuery`).
 */

/** Absolute floor / ceiling a tenant's `min_query_length` config is clamped to. */
export const MIN_QUERY_LENGTH_FLOOR = 1;
export const MIN_QUERY_LENGTH_CEILING = 20;
export const DEFAULT_MIN_QUERY_LENGTH = 2;

/** Hard upper bound on a query string — anonymous abuse defense (ADR-0040 §5). */
export const MAX_QUERY_LENGTH = 128;

export type QueryRejectionReason = "empty" | "too_short" | "too_long";

export type NormalizedQueryResult =
  { ok: true; value: string } | { ok: false; reason: QueryRejectionReason };

/**
 * Replace every C0 control character (U+0000–U+001F) and DEL (U+007F) with a
 * space so a crafted query can never carry control bytes into the index/log/
 * cache key. Written with `charCodeAt` rather than a control-char regex literal
 * on purpose — a control-character regex written through an editor can land as
 * raw control BYTES in the file (a documented hazard in this repo).
 */
export function stripControlCharacters(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    out += code <= 0x1f || code === 0x7f ? " " : value[i];
  }
  return out;
}

/**
 * Trim, collapse internal whitespace, strip C0/DEL control characters, and
 * enforce min/max length. `minLength` is the tenant's configured minimum
 * (clamped to `[MIN_QUERY_LENGTH_FLOOR, MIN_QUERY_LENGTH_CEILING]`). A non-string
 * or all-whitespace input is `empty`; over `MAX_QUERY_LENGTH` is `too_long`
 * (rejected, not silently truncated, so the bound is observable); under
 * `minLength` is `too_short`.
 */
export function normalizeSearchQuery(
  raw: unknown,
  minLength: number = DEFAULT_MIN_QUERY_LENGTH
): NormalizedQueryResult {
  if (typeof raw !== "string") return { ok: false, reason: "empty" };

  const collapsed = stripControlCharacters(raw).replace(/\s+/g, " ").trim();

  if (collapsed.length === 0) return { ok: false, reason: "empty" };
  if (collapsed.length > MAX_QUERY_LENGTH)
    return { ok: false, reason: "too_long" };

  const effectiveMin = clampMinQueryLength(minLength);
  if (collapsed.length < effectiveMin)
    return { ok: false, reason: "too_short" };

  return { ok: true, value: collapsed };
}

/** Clamp a tenant's configured min query length into the safe range. */
export function clampMinQueryLength(minLength: number): number {
  if (!Number.isFinite(minLength)) return DEFAULT_MIN_QUERY_LENGTH;
  return Math.min(
    Math.max(Math.trunc(minLength), MIN_QUERY_LENGTH_FLOOR),
    MIN_QUERY_LENGTH_CEILING
  );
}

/**
 * Shortest LAST-token length that is prefix-matched. Below this a one- or
 * two-character prefix is closer to noise than to a stem (and matches a large
 * slice of the vocabulary). It is deliberately independent of the tenant's
 * `minQueryLength`, which may be configured down to 1 for unrelated reasons.
 */
export const PREFIX_MIN_TOKEN_LENGTH = 3;

/**
 * `[\p{L}\p{N}]+`: a run of Unicode letters/digits. This is BOTH the tokenizer
 * AND the whole of the sanitization. Every character `to_tsquery`'s text-form
 * parser reads as an operator (`& | ! : * ( ) < - >`), plus quotes, backslashes
 * and whitespace, is punctuation or a symbol, never a letter or digit, so a
 * token cannot carry one structurally; there is no "strip the operators" step to
 * forget.
 */
const WORD_TOKEN_PATTERN = /[\p{L}\p{N}]+/gu;

/**
 * Splits a query into word tokens. The input is NFC-normalized first so a
 * decomposed letter (base + combining mark, which `\p{L}` alone would split in
 * two) stays one token and matches the indexed form.
 */
export function tokenizeSearchQuery(query: string): string[] {
  return query.normalize("NFC").match(WORD_TOKEN_PATTERN) ?? [];
}

/**
 * Builds the `to_tsquery('simple', ...)` TEXT: every token is an exact lexeme,
 * ANDed; the LAST token becomes a prefix match (`lexeme:*`) once it has at
 * least `PREFIX_MIN_TOKEN_LENGTH` characters, so "Kapu" finds "Kapuas" and
 * "Kalimantan Kapu" requires the exact word AND a word starting "Kapu".
 *
 * Returns `null` when the query has no word tokens (pure punctuation, symbols,
 * emoji survive length-only normalization). Callers MUST treat that as "no
 * possible match" and skip the database, rather than binding an empty string:
 * an empty tsquery is a valid value and a match predicate must not depend on
 * how it evaluates.
 *
 * Syntax that `websearch_to_tsquery` used to interpret (quoted phrases, `or`,
 * `-exclusion`) is NOT supported: such characters are dropped as punctuation
 * and the remaining words are ANDed. The ` & ` separators and the `:*` suffix
 * are written by this function alone, never copied from input; the result is
 * bound as one parameter, so SQL injection is excluded by binding regardless.
 */
export function buildPrefixTsQuery(query: string): string | null {
  const tokens = tokenizeSearchQuery(query);
  if (tokens.length === 0) {
    return null;
  }

  const lastIndex = tokens.length - 1;
  return tokens
    .map((token, index) =>
      index === lastIndex && token.length >= PREFIX_MIN_TOKEN_LENGTH
        ? `${token}:*`
        : token
    )
    .join(" & ");
}

/**
 * Normalize a requested locale to a lowercased BCP-47-ish tag, falling back to
 * the tenant default for anything malformed — so a query is always locale-scoped
 * to a known value (cross-locale isolation, ADR-0040 §5). Never trusts a raw
 * `Accept-Language` header shape.
 */
export function normalizeSearchLocale(raw: unknown, fallback: string): string {
  if (typeof raw !== "string") return fallback;
  const tag = raw.trim().toLowerCase();
  return /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/.test(tag) ? tag : fallback;
}

/** sha256 of the normalized query — the ONLY form the opt-in query log stores (no raw query = no PII leakage) and the cache-key query component. */
export function hashSearchQuery(normalizedQuery: string): string {
  return new Bun.CryptoHasher("sha256").update(normalizedQuery).digest("hex");
}

/**
 * Longest term-filter value accepted from a request (Issue #633). Mirrors
 * `MAX_TERM_FACET_TEXT_LENGTH` in `search-document.ts` — a value longer than
 * anything that could have been indexed cannot match, so accepting it only
 * widens what an anonymous caller can push into a query parameter.
 */
export const MAX_TERM_FILTER_LENGTH = 200;

/**
 * Parses term filters (`?channel=politik&topic=pemilu`) from a request against
 * the facet names the search-source registry actually declares (Issue #633).
 *
 * ## The allow-list is the point
 *
 * `allowedFacetKeys` comes from `collectTermFacetKeys(listModules())`, so an
 * unknown parameter is IGNORED rather than passed through. Without that, every
 * query-string key would reach the jsonb containment operand, and an anonymous
 * caller could ask "does any document carry facet X" about facets nobody
 * declared — a probe of the index's shape, answered by the result count.
 *
 * Ignoring beats rejecting: a page's own tracking parameters (`utm_source`,
 * `fbclid`) ride along on every shared link, and a search that 400s because
 * somebody arrived from Facebook is a search that looks broken.
 *
 * Only the FIRST value of a repeated key is used. `?channel=a&channel=b` is
 * ambiguous between "either" and "both", and picking one silently would make
 * the count and the result list disagree with each other on some future day.
 */
export function parseTermFilters(
  params: URLSearchParams,
  allowedFacetKeys: readonly string[]
): Record<string, string> {
  const filters: Record<string, string> = {};

  for (const key of allowedFacetKeys) {
    const raw = params.get(key);

    if (typeof raw !== "string") {
      continue;
    }

    const value = stripControlCharacters(raw).trim();

    if (value.length === 0 || value.length > MAX_TERM_FILTER_LENGTH) {
      continue;
    }

    filters[key] = value;
  }

  return filters;
}
