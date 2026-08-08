/**
 * Effective "public route" settings for `blog_content`'s public route family
 * `/blog/{tenantCode}` (Issue #540, ADR-0009).
 *
 * There used to be two families. The host-resolved `/news/**` family (ADR-0059)
 * and its `publicRouteMode` switch were removed by
 * [ADR-0071](../../../../docs/adr/0071-kosakata-url-publik-dibelah-blog-di-sini-news-di-awcms-astro.md)
 * §4, which split the family's URL vocabulary: `/blog/**` is this repo's
 * permanent vocabulary and `/news/**` belongs to `ahliweb/awcms-astro`. A
 * retirement 301 for the old family lives in `seo_distribution`
 * (`domain/retired-news-redirect.ts`), and it reads
 * `legacyTenantRouteEnabled` below for the one condition that survived: a
 * tenant with no `/blog/**` must not be redirected to it.
 *
 * `publicBasePath`/`publicLabel` — the two further keys the archived
 * awcms-micro carries — were NOT adopted (ADR-0059 §4), and that reasoning
 * outlives the family it was written for: they change only the
 * self-referential links a page emits and cannot move the file-based route that
 * actually serves, so setting either to anything but the physical path
 * manufactures per-tenant URLs that 404.
 *
 * Deliberately reads from TWO existing, already-authoritative stores
 * instead of inventing a third:
 *
 * 1. `blog_content`'s module descriptor `settings.defaults` (`module.ts`) +
 *    the tenant's `awcms_module_settings` override, via Module Management's
 *    generic tenant-settings framework (`fetchModuleSettingsView`). Owns
 *    `legacyTenantRouteEnabled`.
 * 2. `awcms_blog_settings` (migration 035, wired up by
 *    `blog-settings-directory.ts`'s `fetchBlogSettings`). Owns
 *    `rssEnabled`/`sitemapEnabled` — NOT duplicated into store (1): two
 *    independent, writable stores for the identical concept would be a real
 *    single-source-of-truth bug — an admin could flip "RSS enabled" off in
 *    the generic `/admin/modules/blog_content` settings panel while
 *    `/blog/{tenantCode}/feed.xml.ts` keeps reading the OLD
 *    `awcms_blog_settings` value and stays enabled.
 *
 * `fetchEffectivePublicRouteSettings` merges READ access to both into one
 * DTO so `/blog/{tenantCode}` route handlers don't need to call two
 * functions and remember which field lives where — it does not create a
 * third writable store. Every field's write path is still whichever of the
 * two stores above already owns it: `PATCH /api/v1/tenant/modules/blog_content/settings`
 * for the first, `PATCH /api/v1/blog/settings` for the last two.
 */
import { fetchBlogSettings } from "./blog-settings-directory";
import { fetchModuleSettingsView } from "../../module-management/application/module-settings";

const BLOG_CONTENT_MODULE_KEY = "blog_content";

export type EffectivePublicRouteSettings = {
  legacyTenantRouteEnabled: boolean;
  rssEnabled: boolean;
  sitemapEnabled: boolean;
};

const DEFAULT_LEGACY_TENANT_ROUTE_ENABLED = true;

/**
 * Reads both stores and returns one merged, defensively-normalized view.
 * `legacyTenantRouteEnabled` falls back to its safe default rather than
 * throwing when a tenant override holds a garbage-shaped value (e.g. a
 * non-boolean) — the generic settings framework validates only "is this a
 * plain object with no secret-shaped key" (`validateModuleSettingsPatch`),
 * never per-field types, so this read path is where fail-safe normalization
 * actually happens.
 */
export async function fetchEffectivePublicRouteSettings(
  tx: Bun.SQL,
  tenantId: string
): Promise<EffectivePublicRouteSettings> {
  const moduleSettingsView = await fetchModuleSettingsView(
    tx,
    tenantId,
    BLOG_CONTENT_MODULE_KEY
  );
  const blogSettings = await fetchBlogSettings(tx, tenantId);

  const effective = moduleSettingsView?.effective ?? {};

  return {
    legacyTenantRouteEnabled:
      typeof effective.legacyTenantRouteEnabled === "boolean"
        ? effective.legacyTenantRouteEnabled
        : DEFAULT_LEGACY_TENANT_ROUTE_ENABLED,
    rssEnabled: blogSettings.rssEnabled,
    sitemapEnabled: blogSettings.sitemapEnabled
  };
}

/**
 * The canonical/`<loc>`/feed base path for a tenant — the one rule that keeps
 * `seo_distribution` from advertising a URL nothing serves.
 *
 * ADR-0059 §C gave this three rows, because there were two families to choose
 * between. ADR-0071 §4 removed one of them, so it is down to two: the tenant
 * either serves `/blog/{tenantCode}` or it serves no public content at all.
 * `null` is that second case, and it is the row that carries the rule — the
 * correct sitemap for a tenant with its public surface off is an EMPTY one, not
 * one full of links that are certain to 404. That invariant is restated in
 * ADR-0071 §3 precisely so it did not lapse when ADR-0059 was superseded.
 *
 * Pure (no DB) so the rule itself is directly testable; the caller supplies the
 * tenant code.
 */
export function resolvePublicContentBasePath(
  settings: Pick<EffectivePublicRouteSettings, "legacyTenantRouteEnabled">,
  tenantCode: string
): string | null {
  return settings.legacyTenantRouteEnabled ? `/blog/${tenantCode}` : null;
}

/**
 * Convenience wrapper for the 7 legacy `/blog/{tenantCode}/*` route files so
 * each one makes a single call instead of re-deriving the field name. Legacy
 * routes have no timing-parity treatment applied — the tenant code is
 * already caller-supplied and visible in the URL path itself, so there is no
 * "does this identifier map to a real tenant" existence question left to
 * protect by response latency.
 */
export async function isLegacyTenantRouteEnabled(
  tx: Bun.SQL,
  tenantId: string
): Promise<boolean> {
  const settings = await fetchEffectivePublicRouteSettings(tx, tenantId);

  return settings.legacyTenantRouteEnabled;
}
