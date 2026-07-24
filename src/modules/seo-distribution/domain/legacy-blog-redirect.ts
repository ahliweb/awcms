/**
 * Legacy `/blog/{tenantCode}` → canonical `/news` path mapping (ADR-0039; adapted
 * from awcms-micro ADR-0028 / ADR-0010 deferral). This module computes only the
 * target PATH; the resolution service resolves the tenant by code, derives the
 * primary host server-side, builds the absolute URL, and validates it through the
 * frozen open-redirect guard.
 *
 * ## INERT in awcms (ADR-0039)
 *
 * awcms ships NO `/news` route family, so even though this mapping and the
 * `legacy_blog_redirect_enabled` policy column (DEFAULT false) are ported for
 * schema/behavioral parity with awcms-micro, the legacy-blog auto-redirect NEVER
 * fires in this base: the policy is off by default, and were an operator to enable
 * it, the computed `/news...` destination has no content route to serve. It is kept
 * so a future `/news` port (or a derived app that ships `/news`) inherits a
 * ready, already-guarded mechanism rather than re-deriving it. Not a tenant-authored
 * rule and not a pattern engine — one fixed, bounded structural rewrite.
 */

/** A tenant-code is a bounded slug (mirrors `resolvePublicTenantByCode`'s own input expectations). */
const TENANT_CODE_MAX_LENGTH = 128;

export type LegacyBlogPath = {
  tenantCode: string;
  /** Path after `/blog/{tenantCode}` — `""` for the index, else a leading-`/` remainder. */
  rest: string;
};

/**
 * Parse a `/blog/{tenantCode}` request path into its tenant code + remainder, or
 * `null` when the path is not under a concrete `/blog/{tenantCode}` (e.g. `/blog`,
 * `/blog/`, or anything else). No regex backtracking — plain segment splitting.
 */
export function parseLegacyBlogPath(pathname: string): LegacyBlogPath | null {
  if (typeof pathname !== "string" || !pathname.startsWith("/blog/")) {
    return null;
  }

  const afterPrefix = pathname.slice("/blog/".length); // "{tenantCode}[/rest]"
  if (afterPrefix.length === 0) return null;

  const slashIndex = afterPrefix.indexOf("/");
  const tenantCode =
    slashIndex === -1 ? afterPrefix : afterPrefix.slice(0, slashIndex);
  const rest = slashIndex === -1 ? "" : afterPrefix.slice(slashIndex);

  if (tenantCode.length === 0 || tenantCode.length > TENANT_CODE_MAX_LENGTH) {
    return null;
  }

  return { tenantCode, rest };
}

/**
 * Build the canonical `/news...` PATH equivalent of a parsed legacy blog path.
 * `/blog/{tenantCode}` → `/news`; `/blog/{tenantCode}/foo` → `/news/foo`.
 */
export function buildCanonicalNewsPath(rest: string): string {
  return rest.length === 0 ? "/news" : `/news${rest}`;
}
