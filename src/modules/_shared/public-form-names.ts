/**
 * Names of the platform's own public forms (Issue #1353). They double as the
 * Turnstile `action` labels (a token is bound to its form), so this table and
 * `turnstile.ts`'s `*_TURNSTILE_ACTION` constants must agree
 * (`tests/public-form-challenge.test.ts` pins it). A module's own form just
 * passes its own `snake_case` name; it need not appear here.
 *
 * Dependency-free on purpose: a module descriptor and `extension-points:check`
 * import this without reaching `src/lib/security/public-form-challenge.ts`,
 * whose import closure holds Turnstile's web-only secret
 * (`tests/jobs-env-scoped-reach.test.ts`). The seam re-exports it.
 */
export const PUBLIC_FORM_NAMES = {
  login: "login",
  setup: "setup",
  passwordReset: "password_reset",
  register: "register",
  invitationAccept: "invitation_accept",
  newsletterSubscribe: "newsletter_subscribe",
  commentSubmit: "comment_submit"
} as const;
