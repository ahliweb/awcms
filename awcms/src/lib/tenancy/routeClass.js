/**
 * routeClass.js
 * Deployment Cell — Runtime Resolution Layer
 *
 * Defines the RouteClass enum and the mapping from domain_kind
 * (stored in tenant_domains) to a runtime route classification.
 *
 * Spec reference: §10.4 Route class mapping
 */

/**
 * Canonical route class constants.
 * Controls how the application and edge layer handle a request.
 * @enum {string}
 */
export const RouteClass = Object.freeze({
  /** Public-facing site: SEO pages, marketing, portal. */
  PUBLIC: 'public',
  /** Admin dashboard: protected origin, staff-only. */
  ADMIN: 'admin',
  /** API / integration endpoint. */
  API: 'api',
  /** Media/CDN delivery endpoint. */
  CDN: 'cdn',
  /** Preview/staging hostname for draft content. */
  PREVIEW: 'preview',
});

/**
 * Maps the `domain_kind` value from `tenant_domains` to a RouteClass.
 *
 * @param {string} domainKind - Value from `tenant_domains.domain_kind`
 * @returns {string} A RouteClass value
 * @throws {Error} If domainKind is unrecognized
 *
 * @example
 * deriveRouteClass('custom_domain');    // => 'public'
 * deriveRouteClass('admin_domain');     // => 'admin'
 * deriveRouteClass('cdn_domain');       // => 'cdn'
 */
export function deriveRouteClass(domainKind) {
  const map = {
    platform_subdomain: RouteClass.PUBLIC,
    custom_domain: RouteClass.PUBLIC,
    admin_domain: RouteClass.ADMIN,
    api_domain: RouteClass.API,
    cdn_domain: RouteClass.CDN,
    preview_domain: RouteClass.PREVIEW,
  };

  const routeClass = map[domainKind];
  if (!routeClass) {
    throw new Error(
      `[routeClass] Unknown domain_kind: "${domainKind}". ` +
      `Must be one of: ${Object.keys(map).join(', ')}`
    );
  }
  return routeClass;
}
