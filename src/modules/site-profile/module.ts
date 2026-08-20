/**
 * `site_profile` — a tenant states who it is (Issue #596, ADR-0102).
 *
 * Owns SITE CHROME: the masthead tagline, the footer copyright line, the logo
 * and favicon, the editorial address, contact email/phone/WhatsApp, and social
 * profile links. Everything a human reads about the publisher, as opposed to
 * what a crawler is told.
 *
 * ## Why this is a module and not more columns on `awcms_seo_tenant_settings`
 *
 * ADR-0102 records the decision. `theming` was rejected outright — its charter
 * is presentation and its token values are validated against a strict CSS
 * grammar, so an editorial address there would abuse the module whose entire
 * value is that strictness. `seo_tenant_settings` was the real candidate, and
 * the boundary drawn instead is: it keeps what CRAWLERS see (`og:site_name`,
 * the JSON-LD `Organization` node, the default `og:image`), this owns what
 * PEOPLE read.
 *
 * The cost that boundary could have had — "two places answer 'who is this
 * site'" — is paid on the READ side rather than pushed onto consumers:
 * `GET /api/v1/site-profile/public` composes both halves, so a build client
 * asks one endpoint and never learns the split exists.
 *
 * ## Dependencies
 *
 * `tenant_admin`/`identity_access` for the tenant row and the guard chain.
 * `media_library` because the logo and favicon are media object ids resolved
 * through its port — never raw URLs, so managed-media enforcement keeps
 * working. `seo_distribution` because the public read composes its settings;
 * that is a one-way read and introduces no cycle, since `seo_distribution`
 * does not reference this module.
 */
import { defineModule } from "../_shared/module-contract";
import {
  SITE_PROFILE_ACTIVITY_CODE,
  SITE_PROFILE_MODULE_KEY
} from "./domain/site-profile-permissions";

export const siteProfileModule = defineModule({
  key: SITE_PROFILE_MODULE_KEY,
  name: "Site profile",
  version: "0.1.0",
  status: "active",
  description:
    "Per-tenant SITE CHROME (Issue #596, ADR-0102, PRD §25/§26.2, FR-TEN-004): masthead tagline, footer copyright line, logo and favicon (media object ids resolved through media_library's port, never raw URLs), editorial address, contact email/phone/WhatsApp, and up to 20 social profile links. Before it, a footer, masthead, contact page and Organization JSON-LD node all had to hard-code the publisher's identity in frontend source, which violates PRD §25 and makes a second tenant impossible without a fork. The boundary against seo_distribution is deliberate and not arbitrary: awcms_seo_tenant_settings keeps what CRAWLERS see (og:site_name, the JSON-LD Organization node, the default og:image) because each of those is an SEO output consumed by a meta-tag renderer, while this module owns what PEOPLE read in a masthead, footer or contact block. Nothing is duplicated across the two, so no value can drift. Consumers are never asked to know that split: GET /api/v1/site-profile/public composes both halves into one answer for build clients (awcms-astro reads it at build time). Social link URLs are REFUSED rather than sanitized unless they are absolute http(s) — they are rendered as <a href> on every public page, so a javascript:/data: value there would be stored XSS with a very long reach. read and update are separately grantable, on sql/058's reasoning: changing what every public page's contact block says is a different power from reading it.",
  dependencies: [
    "tenant_admin",
    "identity_access",
    "media_library",
    "seo_distribution"
  ],
  type: "domain",
  api: {
    openApiPath: "openapi/modules/site-profile.openapi.yaml",
    basePath: "/api/v1/site-profile"
  },
  navigation: [
    {
      labelKey: "admin.layout.nav_site_profile",
      path: "/admin/site-profile",
      order: 70,
      requiredPermission: "site_profile.profile.read"
    }
  ],
  permissions: [
    {
      activityCode: SITE_PROFILE_ACTIVITY_CODE,
      action: "read",
      description:
        "Read this tenant's site identity — masthead, footer, editorial address and contact details"
    },
    {
      activityCode: SITE_PROFILE_ACTIVITY_CODE,
      action: "update",
      description:
        "Change this tenant's site identity, including the contact details and social links every public page renders"
    }
  ]
});
