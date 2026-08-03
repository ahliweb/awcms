/**
 * Effective "public route" settings for `blog_content`'s TWO public route
 * families — host-resolved `/news/**` (ADR-0059) and legacy
 * `/blog/{tenantCode}` (Issue #540, ADR-0009).
 *
 * Each family has its own independent on/off switch, and that separation is
 * deliberate: they resolve their tenant differently (request host vs path
 * segment) and serve different deployments, so one switch governing both would
 * make an offline/LAN operator's choice depend on an online routing concept.
 *
 * `publicBasePath`/`publicLabel` — the two further keys the archived
 * awcms-micro carries — are NOT adopted (ADR-0059 §4): they change only the
 * self-referential links a page emits and cannot move the file-based route that
 * actually serves, so setting either to anything but the physical path
 * manufactures per-tenant URLs that 404. The physical root is a constant,
 * `HOST_RESOLVED_PUBLIC_BASE_PATH`.
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

/**
 * The physical route root of the host-resolved family (ADR-0059 §A). A
 * CONSTANT, not a setting: an Astro file route cannot be repointed per tenant
 * at runtime, so a configurable value here would only change the links a page
 * emits — see this file's header.
 */
export const HOST_RESOLVED_PUBLIC_BASE_PATH = "/news";

/**
 * `domain_default` = the host-resolved `/news/**` family serves per
 * `PUBLIC_TENANT_RESOLUTION_MODE` (ADR-0010). `disabled` collapses every route
 * in that family to the same generic 404 an unresolved host already produces.
 * Scoped to `/news/**` only — `/blog/{tenantCode}` has `legacyTenantRouteEnabled`.
 */
export const PUBLIC_ROUTE_MODES = ["domain_default", "disabled"] as const;
export type PublicRouteMode = (typeof PUBLIC_ROUTE_MODES)[number];

export type EffectivePublicRouteSettings = {
  publicRouteMode: PublicRouteMode;
  legacyTenantRouteEnabled: boolean;
  rssEnabled: boolean;
  sitemapEnabled: boolean;
};

const DEFAULT_PUBLIC_ROUTE_MODE: PublicRouteMode = "domain_default";
const DEFAULT_LEGACY_TENANT_ROUTE_ENABLED = true;

function isPublicRouteMode(value: unknown): value is PublicRouteMode {
  return (
    typeof value === "string" &&
    (PUBLIC_ROUTE_MODES as readonly string[]).includes(value)
  );
}

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
    publicRouteMode: isPublicRouteMode(effective.publicRouteMode)
      ? effective.publicRouteMode
      : DEFAULT_PUBLIC_ROUTE_MODE,
    legacyTenantRouteEnabled:
      typeof effective.legacyTenantRouteEnabled === "boolean"
        ? effective.legacyTenantRouteEnabled
        : DEFAULT_LEGACY_TENANT_ROUTE_ENABLED,
    rssEnabled: blogSettings.rssEnabled,
    sitemapEnabled: blogSettings.sitemapEnabled
  };
}

/**
 * The canonical/`<loc>`/feed base path for a tenant — ADR-0059 §C, and the one
 * rule that keeps `seo_distribution` from advertising a URL nothing serves.
 *
 * `null` means BOTH families are switched off: the tenant has no public content
 * URL at all, so the correct sitemap is an empty one, not one full of links
 * that are certain to 404. Pure (no DB) so the rule itself is directly
 * testable; the caller supplies the tenant code the legacy family needs.
 */
export function resolvePublicContentBasePath(
  settings: Pick<
    EffectivePublicRouteSettings,
    "publicRouteMode" | "legacyTenantRouteEnabled"
  >,
  tenantCode: string
): string | null {
  if (settings.publicRouteMode !== "disabled") {
    return HOST_RESOLVED_PUBLIC_BASE_PATH;
  }

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
