/**
 * `seo_distribution` permission constants (ADR-0038 §9, adapted from awcms-micro
 * ADR-0028). Mirrors the seeded rows in `sql/058` exactly — the module's
 * `permissions` descriptor and every route guard reference these constants rather
 * than re-typing the literal strings, so a rename can never drift one copy from
 * another (same convention `media-permissions` uses).
 *
 * `config.{read,update}` land with the discovery scope (ADR-0038 §A, sql/058).
 * `redirect.*` / `not_found.*` land with the redirect-governance scope (ADR-0039,
 * sql/061) — the redirect rules + per-tenant policy and the privacy-minimized 404
 * governance dashboard respectively.
 */
export const SEO_MODULE_KEY = "seo_distribution";

export const SEO_CONFIG_ACTIVITY_CODE = "config";

export type SeoConfigAction = "read" | "update";

/**
 * Redirect-governance permissions (ADR-0039). Mirrors the seeded rows in `sql/061`
 * exactly. `redirect` gates the rules + per-tenant redirect policy; `not_found`
 * gates the privacy-minimized 404 governance dashboard.
 */
export const SEO_REDIRECT_ACTIVITY_CODE = "redirect";
export type SeoRedirectAction = "read" | "create" | "update" | "delete";

export const SEO_NOT_FOUND_ACTIVITY_CODE = "not_found";
export type SeoNotFoundAction = "read" | "update";
