/**
 * Surrogate-key vocabulary and BAN-expression construction — ADR-0042 §4.
 *
 * Varnish Cache (open source) has no native `Surrogate-Key` support the way a
 * commercial CDN does, so this codebase implements tagged invalidation the
 * standard way: the origin attaches a space-separated `Surrogate-Key` header,
 * the bundled VCL keeps that header on the cached object, and invalidation is a
 * `ban` on a regular expression over `obj.http.Surrogate-Key`.
 *
 * That mechanism is the reason this module is paranoid about characters.
 *
 * ## Two hazards, both handled here
 *
 * 1. **Regex injection widening a ban.** The ban expression is a regex. A key
 *    containing `.` or `|` or `.*` — say a resource id copied from user input —
 *    would silently turn a one-object invalidation into "ban everything",
 *    dumping the whole cache onto the origin. Every key is therefore restricted
 *    to `[A-Za-z0-9:._-]` at construction time (`sanitizeKeySegment`) AND every
 *    literal is escaped again at ban-expression time (`escapeForBanRegex`).
 *    Belt and braces, because these two steps can be reached independently.
 * 2. **Prefix collisions widening a ban.** A naive ban on `t:abc` also matches
 *    the key `t:abcdef` — a different tenant. Keys are matched with explicit
 *    space-or-anchor boundaries (`(^| )key( |$)`) so one tenant can never flush
 *    another's cache by having an id that happens to be a prefix.
 *
 * Both hazards are cross-tenant, which is why the sanitizer REJECTS rather than
 * silently rewriting: a key that cannot be represented safely must not become a
 * different, still-valid key pointing at someone else's content.
 */

/** The kinds of thing a cached response can be tagged with. */
export type SurrogateKeyScope =
  | { kind: "tenant"; tenantId: string }
  | { kind: "module"; tenantId: string; moduleKey: string }
  | { kind: "surface"; tenantId: string; surface: string }
  | {
      kind: "resource";
      tenantId: string;
      resourceType: string;
      resourceId: string;
    };

export class UnsafeSurrogateKeyError extends Error {
  constructor(readonly segment: string) {
    super(
      "Surrogate-key segment contains characters that are unsafe in a Varnish ban expression."
    );
    this.name = "UnsafeSurrogateKeyError";
  }
}

/**
 * Only these characters may appear in a key segment. `:` is the segment
 * separator and is permitted inside the assembled key but not inside a single
 * segment — otherwise a resource id of `x:y` could forge a differently-scoped
 * key.
 */
const SAFE_SEGMENT = /^[A-Za-z0-9._-]{1,128}$/;

/** Space separates keys inside the header, so it can never appear in one. */
const KEY_SEPARATOR = " ";

function sanitizeKeySegment(segment: string): string {
  if (!SAFE_SEGMENT.test(segment)) {
    throw new UnsafeSurrogateKeyError(segment);
  }

  return segment;
}

/** Build the single canonical key string for a scope. */
export function buildSurrogateKey(scope: SurrogateKeyScope): string {
  const tenant = sanitizeKeySegment(scope.tenantId);

  switch (scope.kind) {
    case "tenant":
      return `t:${tenant}`;
    case "module":
      return `t:${tenant}:m:${sanitizeKeySegment(scope.moduleKey)}`;
    case "surface":
      return `t:${tenant}:s:${sanitizeKeySegment(scope.surface)}`;
    case "resource":
      return `t:${tenant}:r:${sanitizeKeySegment(
        scope.resourceType
      )}:${sanitizeKeySegment(scope.resourceId)}`;
  }
}

/**
 * Assemble the `Surrogate-Key` header value from a set of scopes.
 *
 * Duplicates are collapsed and order is stabilized so the header is
 * deterministic — a header that reshuffles between two otherwise identical
 * responses would make cached objects gratuitously distinct under any future
 * key-aware tooling, and makes tests flaky for no reason.
 */
export function buildSurrogateKeyHeader(
  scopes: readonly SurrogateKeyScope[]
): string {
  const unique = new Set(scopes.map((scope) => buildSurrogateKey(scope)));

  return [...unique].sort().join(KEY_SEPARATOR);
}

/** Escape a literal so it matches only itself inside a Varnish (PCRE) ban regex. */
export function escapeForBanRegex(literal: string): string {
  return literal.replace(/[\\^$.|?*+()[\]{}]/g, "\\$&");
}

/**
 * Build the ban expression for one key.
 *
 * The `(^| )` / `( |$)` boundaries are load-bearing (see the prefix-collision
 * hazard above) — do not "simplify" them away.
 */
export function buildBanExpression(key: string): string {
  const escaped = escapeForBanRegex(key);

  return `obj.http.Surrogate-Key ~ "(^| )${escaped}( |$)"`;
}

/**
 * Parse a header value back into its keys. Used by the purge worker's tests and
 * by diagnostics; tolerant of repeated/odd whitespace because a header that has
 * round-tripped through a proxy may have been re-spaced.
 */
export function parseSurrogateKeyHeader(value: string): string[] {
  return value
    .split(/\s+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}
