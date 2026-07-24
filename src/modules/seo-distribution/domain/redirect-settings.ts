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
   * When true AND the tenant has a verified primary host, `/blog/{tenantCode}...`
   * 301-redirects to the canonical `/news...` equivalent. **INERT in awcms**: this
   * base ships no `/news` route family (ADR-0039), so even when enabled the legacy
   * rewrite has no destination content — the flag is retained for schema/behavioral
   * parity with awcms-micro and a future `/news` port, but never fires today.
   * Default false = today's behavior unchanged.
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
