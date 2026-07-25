/**
 * Pure query normalization + bounds for `site_search` (ADR-0040 §5, ported from
 * awcms-micro Issue #270). The normalized string is passed to PostgreSQL's
 * `websearch_to_tsquery('simple', $1)` as a BOUND PARAMETER (never interpolated),
 * so `websearch_to_tsquery`'s own parser — not string concatenation — turns it
 * into a `tsquery`. Normalization here is about ABUSE BOUNDS and determinism
 * (length caps, whitespace collapse, control-char stripping, cache-key
 * stability), not about SQL safety (parameter binding already provides that).
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
