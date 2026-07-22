/**
 * Effective "public route" settings for `blog_content`'s public route
 * family — legacy `/blog/{tenantCode}` (Issue #540) — ported from
 * awcms-mini.
 *
 * PORT-TIME DROP: awcms-mini's equivalent file additionally served the
 * host-resolved `/news` route family (Issue #560/#564) and carried three
 * more settings keys for it (`publicRouteMode`/`publicBasePath`/
 * `publicLabel`). That route family needs `lib/tenant/public-host-tenant-
 * resolver.ts` (custom-domain-based tenant resolution, part of the
 * `tenant_domain` routing module) which is not ported to this base yet — see
 * `blog-content/module.ts`'s own `description` field for the full
 * reasoning. Only `legacyTenantRouteEnabled` (the `/blog/{tenantCode}`
 * on/off switch) is kept here; it needs nothing from `tenant_domain`.
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
