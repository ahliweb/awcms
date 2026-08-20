import { ok } from "../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../modules/_shared/tenant-route";
import { fetchSiteProfile } from "../../../../modules/site-profile/application/site-profile-directory";
import { fetchSeoTenantSettings } from "../../../../modules/seo-distribution/application/seo-config-directory";
import {
  SITE_PROFILE_ACTIVITY_CODE,
  SITE_PROFILE_MODULE_KEY
} from "../../../../modules/site-profile/domain/site-profile-permissions";

/**
 * `GET /api/v1/site-profile/composed` (Issue #596, ADR-0102) — the ONE place a
 * build client asks who this site is.
 *
 * ## Why this endpoint exists at all
 *
 * ADR-0102 splits ownership: `awcms_seo_tenant_settings` keeps what CRAWLERS
 * see (`og:site_name`, the JSON-LD `Organization` node, the default
 * `og:image`), and `awcms_site_profile` owns what PEOPLE read (masthead,
 * footer, editorial address, contact details, social links).
 *
 * That boundary is right for ownership and wrong for consumers. A build client
 * rendering a footer does not care which module owns `siteName`, and making it
 * call two endpoints and merge them would push an internal decision onto every
 * consumer — and guarantee that the two calls drift apart in some template that
 * only fetched one of them.
 *
 * So the composition happens HERE, once, on the read side. The cost the module
 * split could have had is paid in this file instead of in every consumer.
 *
 * ## Guarded, not anonymous
 *
 * "Public read" in Issue #596 means "the public site's builder can read it",
 * not "unauthenticated". This follows `GET /api/v1/media/public-origin`: the
 * build client authenticates, and the guard is this module's own
 * `site_profile.profile.read`. Contact details and an editorial address are
 * published by the site itself, but publishing them is the SITE's decision to
 * make in its templates — not this API's decision to make on its behalf by
 * serving them to anyone who asks.
 *
 * ## Media ids, not URLs
 *
 * `logoMediaId`/`faviconMediaId` are returned as ids. A consumer resolves them
 * through `media_library` exactly as it resolves an article image, which is
 * what keeps managed-media enforcement meaningful — a URL baked in here would
 * be a second path to the bytes that no enforcement switch governs.
 */
export const GET = defineTenantRoute({
  workClass: "interactive",
  authorize: {
    moduleKey: SITE_PROFILE_MODULE_KEY,
    activityCode: SITE_PROFILE_ACTIVITY_CODE,
    action: "read"
  },
  handler: async ({ tx, tenantId }) => {
    // Sequential, never concurrent: two queries in parallel on one transaction
    // connection leak it.
    const profile = await fetchSiteProfile(tx, tenantId);
    const seo = await fetchSeoTenantSettings(tx, tenantId);

    return ok({
      // What people read — owned here.
      tagline: profile.tagline,
      copyrightNotice: profile.copyrightNotice,
      logoMediaId: profile.logoMediaId,
      faviconMediaId: profile.faviconMediaId,
      editorialAddress: profile.editorialAddress,
      contactEmail: profile.contactEmail,
      contactPhone: profile.contactPhone,
      whatsappNumber: profile.whatsappNumber,
      socialLinks: profile.socialLinks,

      // What crawlers see — owned by `seo_distribution`, surfaced here so a
      // consumer needs one call. Named exactly as that module names them, so
      // this is visibly a passthrough rather than a second definition that
      // could drift.
      siteName: seo.siteName,
      organizationName: seo.organizationName,
      organizationLogoMediaId: seo.organizationLogoMediaId,
      defaultSocialMediaId: seo.defaultSocialMediaId
    });
  }
});
