/**
 * `seo_distribution` permission constants (ADR-0038 §9, adapted from awcms-micro
 * ADR-0028). Mirrors the seeded rows in `sql/058` exactly — the module's
 * `permissions` descriptor and every route guard reference these constants rather
 * than re-typing the literal strings, so a rename can never drift one copy from
 * another (same convention `media-permissions` uses).
 *
 * Only `config.{read,update}` exist in the discovery scope (ADR-0038 §A). The
 * redirect/404-governance permissions (awcms-micro's `redirect.*` / `not_found.*`)
 * are DEFERRED to the redirect-governance follow-up PR — not seeded ahead of a
 * route/table that can exercise them.
 */
export const SEO_MODULE_KEY = "seo_distribution";

export const SEO_CONFIG_ACTIVITY_CODE = "config";

export type SeoConfigAction = "read" | "update";
