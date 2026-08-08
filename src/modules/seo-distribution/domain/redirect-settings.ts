/**
 * Per-tenant redirect governance policy (ADR-0039) — the shape
 * `awcms_seo_redirect_settings` (sql/060) carries and the validation the admin API
 * applies before writing it. Pure: no I/O.
 */

export type UrlChangeAutoPolicy = "skip" | "propose" | "create";
export const URL_CHANGE_AUTO_POLICIES: readonly UrlChangeAutoPolicy[] = [
  "skip",
  "propose",
  "create"
];

export type RedirectSettings = {
  /**
   * RETIRED — nothing reads this any more, and that is a decision rather than an
   * oversight.
   *
   * It used to mean: 301 `/blog/{tenantCode}...` to the canonical `/news...`
   * equivalent. ADR-0039 shipped it inert (no `/news` family existed), ADR-0059
   * gave it a real destination, and ADR-0071 §4 removed that destination again —
   * `/news/**` is `ahliweb/awcms-astro`'s vocabulary now, so this direction
   * points at a family this repo does not serve. The redirect that survives runs
   * the OTHER way (`application/redirect-resolution-service.ts` strategy 1,
   * `domain/retired-news-redirect.ts`) and is NOT policy-gated.
   *
   * The field stays because its column (`sql/060`) is an applied migration —
   * immutable, checksummed by `scripts/db-migrate.ts` — and because its API
   * surface (`GET`/`PATCH /api/v1/seo/redirects/settings`) has already shipped.
   * Removing either would be a breaking change bought for nothing; a value that
   * is read by no one costs a row and a line of documentation.
   */
  legacyBlogRedirectEnabled: boolean;
  /** Default action when a URL change is captured. Default 'propose' (never auto-activate live traffic silently). */
  urlChangeAutoPolicy: UrlChangeAutoPolicy;
};

export const EMPTY_REDIRECT_SETTINGS: RedirectSettings = {
  legacyBlogRedirectEnabled: false,
  urlChangeAutoPolicy: "propose"
};

export type RedirectSettingsValidationResult =
  | { ok: true; value: RedirectSettings }
  | { ok: false; errors: { field: string; message: string }[] };

/** Validate an untrusted redirect-settings body into a `RedirectSettings`. */
export function validateRedirectSettings(
  body: unknown
): RedirectSettingsValidationResult {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return {
      ok: false,
      errors: [
        { field: "body", message: "Request body must be a JSON object." }
      ]
    };
  }

  const input = body as Record<string, unknown>;
  const errors: { field: string; message: string }[] = [];

  let legacyBlogRedirectEnabled = false;
  if (input.legacyBlogRedirectEnabled !== undefined) {
    if (typeof input.legacyBlogRedirectEnabled !== "boolean") {
      errors.push({
        field: "legacyBlogRedirectEnabled",
        message: "Must be a boolean."
      });
    } else {
      legacyBlogRedirectEnabled = input.legacyBlogRedirectEnabled;
    }
  }

  let urlChangeAutoPolicy: UrlChangeAutoPolicy = "propose";
  if (input.urlChangeAutoPolicy !== undefined) {
    if (
      typeof input.urlChangeAutoPolicy !== "string" ||
      !URL_CHANGE_AUTO_POLICIES.includes(
        input.urlChangeAutoPolicy as UrlChangeAutoPolicy
      )
    ) {
      errors.push({
        field: "urlChangeAutoPolicy",
        message: `Must be one of ${URL_CHANGE_AUTO_POLICIES.join(", ")}.`
      });
    } else {
      urlChangeAutoPolicy = input.urlChangeAutoPolicy as UrlChangeAutoPolicy;
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: { legacyBlogRedirectEnabled, urlChangeAutoPolicy }
  };
}
