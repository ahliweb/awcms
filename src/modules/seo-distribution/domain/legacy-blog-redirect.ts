/**
 * Legacy `/blog/{tenantCode}` → canonical `/news` path mapping (ADR-0039; adapted
 * from awcms-micro ADR-0028 / ADR-0010 deferral). This module computes only the
 * target PATH; the resolution service resolves the tenant by code, derives the
 * primary host server-side, builds the absolute URL, and validates it through the
 * frozen open-redirect guard.
 *
 * ## LIVE since ADR-0059 — it was INERT when ADR-0039 wrote this
 *
 * ADR-0039 kept this mapping for schema/behavioral parity with awcms-micro while
 * awcms shipped NO `/news` route family: the computed destination had nothing to
 * serve, so enabling the policy was a no-op. **That is no longer true.**
 * [ADR-0059](../../../../docs/adr/0059-host-resolved-public-content-routes.md)
 * landed the host-resolved `/news/**` family — `/news`, `/news/{slug}`,
 * `/news/category/{slug}`, `/news/tag/{slug}` — and every path this mapping can
 * produce now resolves to one of them.
 *
 * So the toggle has teeth. `legacy_blog_redirect_enabled` is still `DEFAULT false`
 * and nothing changes for an operator who leaves it alone, but turning it on now
 * **permanently 301s** live `/blog/{tenantCode}...` traffic to the tenant's
 * canonical host. A 301 is cached by browsers and intermediaries; it is not a
 * setting that can be undone by flipping the column back. Treat enabling it as a
 * content-URL migration, not as a preference.
 *
 * What has NOT changed: the destination is still built by the resolution service
 * (which resolves the tenant by code, derives the primary host server-side, and
 * validates the absolute URL through the frozen open-redirect guard), and this is
 * still not a tenant-authored rule and not a pattern engine — one fixed, bounded
 * structural rewrite.
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
