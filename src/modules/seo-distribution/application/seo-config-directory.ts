/**
 * Tenant SEO config data access (ADR-0038 §4/§9) over
 * `awcms_seo_tenant_settings` (sql/057). Every query runs inside a
 * caller-provided tenant transaction (`withTenant`, RLS FORCE'd on this table),
 * so tenant isolation holds twice: the explicit `tenant_id` filter here and RLS.
 *
 * `updateSeoTenantSettings` is the ONLY writer and is high-risk (it changes the
 * public metadata/indexability surface — ADR-0038 §9), so it records an audit
 * event on every write via the injected `recordAudit` callback. The audit
 * writer is injected (not imported) so this application service stays testable
 * without wiring the whole logging module, and so the route composition root
 * remains the single place cross-module wiring happens.
 */
import {
  EMPTY_SEO_TENANT_SETTINGS,
  type SeoTenantSettings
} from "../domain/seo-config";

type SeoSettingsRow = {
  site_name: string | null;
  default_meta_description: string | null;
  default_social_media_id: string | null;
  twitter_site_handle: string | null;
  organization_name: string | null;
  organization_logo_media_id: string | null;
  default_robots_noindex: boolean;
  feed_title: string | null;
  feed_description: string | null;
  feed_logo_media_id: string | null;
  feed_item_limit: number;
  included_resource_types: string[] | null;
  sitemap_enabled: boolean;
  feeds_enabled: boolean;
};

function toSettings(row: SeoSettingsRow): SeoTenantSettings {
  return {
    siteName: row.site_name,
    defaultMetaDescription: row.default_meta_description,
    defaultSocialMediaId: row.default_social_media_id,
    twitterSiteHandle: row.twitter_site_handle,
    organizationName: row.organization_name,
    organizationLogoMediaId: row.organization_logo_media_id,
    defaultRobotsNoindex: row.default_robots_noindex,
    feedTitle: row.feed_title,
    feedDescription: row.feed_description,
    feedLogoMediaId: row.feed_logo_media_id,
    feedItemLimit: row.feed_item_limit,
    includedResourceTypes: row.included_resource_types,
    sitemapEnabled: row.sitemap_enabled,
    feedsEnabled: row.feeds_enabled
  };
}

/** Columns selected by every read — kept in one place so a new field is added once. */
const SEO_SETTINGS_COLUMNS =
  "site_name, default_meta_description, default_social_media_id, " +
  "twitter_site_handle, organization_name, organization_logo_media_id, " +
  "default_robots_noindex, feed_title, feed_description, feed_logo_media_id, " +
  "feed_item_limit, included_resource_types, sitemap_enabled, feeds_enabled";

/**
 * Read this tenant's SEO defaults. Returns `EMPTY_SEO_TENANT_SETTINGS` (not
 * `null`) when no row exists yet — the renderer always wants a usable settings
 * object, and "no config" and "default config" render identically, so there is
 * no reason to make every caller handle a null.
 */
export async function fetchSeoTenantSettings(
  tx: Bun.SQL,
  tenantId: string
): Promise<SeoTenantSettings> {
  const rows = (await tx`
    SELECT ${tx.unsafe(SEO_SETTINGS_COLUMNS)}
    FROM awcms_seo_tenant_settings
    WHERE tenant_id = ${tenantId}
  `) as SeoSettingsRow[];

  return rows[0] ? toSettings(rows[0]) : { ...EMPTY_SEO_TENANT_SETTINGS };
}

/**
 * The tenant SEO settings row's `updated_at`, or `null` when no row exists yet
 * (ADR-0038). The discovery routes fold this into the `Last-Modified` validator
 * so a config change (feed title, item limit, noindex, …) advances it even when
 * the underlying content did not change — a robots.txt/feed served purely from
 * config still revalidates after a config edit.
 */
export async function fetchSeoSettingsUpdatedAt(
  tx: Bun.SQL,
  tenantId: string
): Promise<Date | null> {
  const rows = (await tx`
    SELECT updated_at
    FROM awcms_seo_tenant_settings
    WHERE tenant_id = ${tenantId}
  `) as { updated_at: Date }[];

  return rows[0] ? rows[0].updated_at : null;
}

/** Injected audit hook — the route wires `recordAuditEvent` here; tests pass a spy. */
export type SeoConfigAuditHook = (
  tx: Bun.SQL,
  detail: { previous: SeoTenantSettings; next: SeoTenantSettings }
) => Promise<void>;

/**
 * Upsert this tenant's SEO defaults (full replace of the mutable fields — the
 * PUT semantics the admin API exposes), then record an audit event. Idempotent
 * at the DB level: the same body applied twice converges on the same row.
 * `actorTenantUserId` stamps `created_by`/`updated_by`.
 */
export async function updateSeoTenantSettings(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  next: SeoTenantSettings,
  recordAudit: SeoConfigAuditHook
): Promise<SeoTenantSettings> {
  const previous = await fetchSeoTenantSettings(tx, tenantId);

  // Nullable text[] bind: an explicit NULL means "all types"; a non-null value
  // is a typed array so Postgres receives a real text[] not an untyped literal.
  const includedTypesParam =
    next.includedResourceTypes === null
      ? null
      : tx.array(next.includedResourceTypes, "text");

  const rows = (await tx`
    INSERT INTO awcms_seo_tenant_settings
      (tenant_id, site_name, default_meta_description, default_social_media_id,
       twitter_site_handle, organization_name, organization_logo_media_id,
       default_robots_noindex, feed_title, feed_description, feed_logo_media_id,
       feed_item_limit, included_resource_types, sitemap_enabled, feeds_enabled,
       created_by, updated_by)
    VALUES (
      ${tenantId}, ${next.siteName}, ${next.defaultMetaDescription},
      ${next.defaultSocialMediaId}, ${next.twitterSiteHandle},
      ${next.organizationName}, ${next.organizationLogoMediaId},
      ${next.defaultRobotsNoindex}, ${next.feedTitle}, ${next.feedDescription},
      ${next.feedLogoMediaId}, ${next.feedItemLimit}, ${includedTypesParam},
      ${next.sitemapEnabled}, ${next.feedsEnabled},
      ${actorTenantUserId}, ${actorTenantUserId}
    )
    ON CONFLICT (tenant_id) DO UPDATE SET
      site_name = EXCLUDED.site_name,
      default_meta_description = EXCLUDED.default_meta_description,
      default_social_media_id = EXCLUDED.default_social_media_id,
      twitter_site_handle = EXCLUDED.twitter_site_handle,
      organization_name = EXCLUDED.organization_name,
      organization_logo_media_id = EXCLUDED.organization_logo_media_id,
      default_robots_noindex = EXCLUDED.default_robots_noindex,
      feed_title = EXCLUDED.feed_title,
      feed_description = EXCLUDED.feed_description,
      feed_logo_media_id = EXCLUDED.feed_logo_media_id,
      feed_item_limit = EXCLUDED.feed_item_limit,
      included_resource_types = EXCLUDED.included_resource_types,
      sitemap_enabled = EXCLUDED.sitemap_enabled,
      feeds_enabled = EXCLUDED.feeds_enabled,
      updated_by = EXCLUDED.updated_by,
      updated_at = now()
    RETURNING ${tx.unsafe(SEO_SETTINGS_COLUMNS)}
  `) as SeoSettingsRow[];

  const saved = toSettings(rows[0]!);
  await recordAudit(tx, { previous, next: saved });
  return saved;
}
