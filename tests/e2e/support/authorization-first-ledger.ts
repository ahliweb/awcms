/**
 * Endpoints that answer an authenticated caller BEFORE the authorization
 * chokepoint has — a debt ledger that may only shrink.
 *
 * ## The property being tracked
 *
 * ADR-0063 made `authorizeInTransaction` the one place an access decision is
 * taken, and it is also the one place a decision is RECORDED. A route that
 * refuses a caller before reaching it therefore refuses without a trace: no
 * `awcms_access_decision_log` row, nothing for an audit to read, nothing to
 * alert on. A tenant user probing endpoints they have no grant for is invisible.
 *
 * Measured against a running server with a session holding ZERO permissions.
 * It started at **121**. It is now **70**:
 *
 * - **61** `400 VALIDATION_ERROR` — the endpoint's field names, enum values and
 *   length limits, handed to someone with no grant for it.
 * - **3** `400 IDEMPOTENCY_REQUIRED` — down from 54. The remaining three are
 *   STRUCTURAL, not leftovers; see the section below.
 * - **3** `404` — an existence lookup ran first.
 * - **2** `422 VALIDATION_FAILED`, **1** `401`.
 *
 * The rest answer `403 ACCESS_DENIED`, which is correct.
 *
 * ## The 51 that left, and what made them one job rather than 51
 *
 * Every one of them refused a MISSING `Idempotency-Key` — a header check, which
 * needs no database and cannot fail — and then, in most cases, a body that did
 * not validate. Both were decided before `withTenant` opened and returned from
 * there, so neither reached `authorizeInTransaction` and neither left a row.
 *
 * The work still happens before the transaction: reading a body waits on the
 * CLIENT, and doing that inside `withTenant` holds a reserved connection and its
 * work-class slot for as long as a caller chooses to take. What moved is the
 * ANSWER, not the work. The body-size ceiling deliberately did NOT move — a
 * PROTOCOL limit tells the caller nothing they did not already send.
 *
 * This is not an approval. It is the shape this repo already uses for
 * `api:tenant-route:check`: a ledger that may only shrink, so the number is
 * visible and a new entry has to be argued for rather than absorbed.
 *
 * ## Both directions are enforced
 *
 * `tests/e2e/api-authorization-first.e2e.ts` fails when an endpoint NOT listed
 * here answers anything but `403` — that is the debt growing. It ALSO fails when
 * an endpoint listed here answers `403` — that is an entry that was fixed and
 * must now be deleted. Without the second direction the list would fill with
 * stale rows and stop meaning anything, which is how a ledger becomes wallpaper.
 *
 * ## How an entry is retired
 *
 * `src/pages/api/v1/media/news-images/upload-sessions/index.ts` is the worked
 * example, and it is deliberately not abstracted into a helper — each of these
 * routes reaches its refusal differently. The pattern:
 *
 * 1. Read and validate the body OUTSIDE the transaction, exactly as now.
 *    `await request.json()` waits on the CLIENT, and doing that inside
 *    `withTenant` holds a reserved connection and its work-class slot for as
 *    long as a caller chooses to take. This must not move.
 * 2. HOLD the refusal in a discriminated union rather than returning it.
 * 3. Inside the transaction, authorize first. Return the denial if refused.
 * 4. Only then return the held refusal.
 *
 * The caller who is allowed still gets their validation errors; the caller who
 * is not gets `403` and leaves a row.
 *
 * ## Entries with a STRUCTURAL reason, which may never leave
 *
 * Some of these are not sloppiness, and retiring them needs a design decision
 * rather than the pattern above. They are listed rather than exempted, because
 * "there is a reason for it" and "it is fine" are different claims and only the
 * first is true:
 *
 * - **`PATCH /api/v1/blog/posts/:id`, `PATCH /api/v1/blog/pages/:id`** answer
 *   `404` because they read the row before authorizing — the ownership GRANT
 *   BASIS (ADR-0063) is computed from `authorTenantUserId` and `status`, so the
 *   read is an INPUT to the decision, not a decision taken instead of it. The
 *   `404` is still an existence oracle for anyone with a session.
 * - **`PATCH /api/v1/partners/:partnerTenantId/status`** and
 *   **`POST /api/v1/access/machine-credentials`** compute a stricter permission
 *   FROM the submitted body, so with no valid input there is no guard to
 *   evaluate. Same two routes `defineTenantRoute` names as unable to defer.
 * - **`POST /api/v1/comments/admin/:id/moderate`**,
 *   **`POST /api/v1/comments/admin/bulk-moderate`** and
 *   **`POST /api/v1/seo/redirects/:id/lifecycle`** are the same class, found by
 *   the pass that retired the other 51: their guard's ACTION is read off the
 *   body (`decision === "approve" ? "approve" : "reject"`;
 *   `lifecycleAction === "purge" ? "delete" : "update"`). Moving their refusals
 *   after authorization would mean authorizing against a GUESSED action —
 *   whatever the ternary falls back to when the body is invalid — so a
 *   moderator holding only `approve` who sent a typo would be told `403` for a
 *   permission the request never needed. That is a worse answer than the one
 *   being fixed, not a smaller one. Retiring them means splitting the route per
 *   action or checking the union of both permissions first; both are product
 *   decisions, so they wait for one.
 *
 * ## What is genuinely NOT here
 *
 * Self-service routes (`defineSelfServiceTenantRoute`). The subject IS the
 * caller, so there is no permission to check and nothing to record:
 * `POST /api/v1/auth/preferences` answering `200` to a zero-permission user is
 * the product working. `push/subscriptions` is self-service too, and its `404`
 * is a documented anti-oracle — "no such subscription", "belongs to someone
 * else" and "already revoked" deliberately share one answer. The sweep excludes
 * them by the helper their source calls, so the exemption cannot outlive its
 * reason.
 */

/** `METHOD /path`, with `:param` for a dynamic segment. */
export type AuthorizationFirstDebt = {
  endpoint: string;
  /** What it answers today instead of `403`. */
  answers: string;
};

/**
 * Endpoints that answer a zero-permission session with something other than
 * `403`, and record nothing when they do.
 *
 * MAY ONLY SHRINK. Adding a row means a new endpoint refuses without recording;
 * that is a decision to argue for in review, not a way to make a gate pass.
 */
export const AUTHORIZATION_FIRST_DEBT: readonly AuthorizationFirstDebt[] = [
  {
    endpoint: "DELETE /api/v1/access/assignments",
    answers: "400 VALIDATION_ERROR"
  },
  {
    endpoint: "DELETE /api/v1/auth/sso-providers/:id",
    answers: "400 VALIDATION_ERROR"
  },
  { endpoint: "DELETE /api/v1/blog/ads/:id", answers: "400 VALIDATION_ERROR" },
  {
    endpoint: "DELETE /api/v1/blog/menus/:id",
    answers: "400 VALIDATION_ERROR"
  },
  {
    endpoint: "DELETE /api/v1/blog/pages/:id",
    answers: "400 VALIDATION_ERROR"
  },
  {
    endpoint: "DELETE /api/v1/blog/posts/:id",
    answers: "400 VALIDATION_ERROR"
  },
  {
    endpoint: "DELETE /api/v1/blog/templates/:id",
    answers: "400 VALIDATION_ERROR"
  },
  {
    endpoint: "DELETE /api/v1/blog/terms/:id",
    answers: "400 VALIDATION_ERROR"
  },
  {
    endpoint: "DELETE /api/v1/blog/widgets/:id",
    answers: "400 VALIDATION_ERROR"
  },
  {
    endpoint: "DELETE /api/v1/email/templates/:id",
    answers: "400 VALIDATION_ERROR"
  },
  {
    endpoint: "DELETE /api/v1/news-portal/ad-placements/:id",
    answers: "400 VALIDATION_ERROR"
  },
  {
    endpoint: "DELETE /api/v1/news-portal/homepage-sections/:id",
    answers: "400 VALIDATION_ERROR"
  },
  { endpoint: "DELETE /api/v1/profiles/:id", answers: "400 VALIDATION_ERROR" },
  {
    endpoint: "DELETE /api/v1/roles/:id/permissions",
    answers: "400 VALIDATION_ERROR"
  },
  {
    endpoint: "DELETE /api/v1/seo/redirects/:id",
    answers: "400 VALIDATION_ERROR"
  },
  {
    endpoint: "DELETE /api/v1/tenant/domains/:id",
    answers: "400 VALIDATION_ERROR"
  },
  {
    endpoint: "PATCH /api/v1/abac/policies/:id",
    answers: "400 VALIDATION_ERROR"
  },
  {
    endpoint: "PATCH /api/v1/blog/pages/:id",
    answers: "404 RESOURCE_NOT_FOUND"
  },
  {
    endpoint: "PATCH /api/v1/blog/posts/:id",
    answers: "404 RESOURCE_NOT_FOUND"
  },
  { endpoint: "PATCH /api/v1/blog/theme", answers: "400 VALIDATION_ERROR" },
  {
    endpoint: "PATCH /api/v1/email/templates/:id",
    answers: "400 VALIDATION_ERROR"
  },
  {
    endpoint: "PATCH /api/v1/form-drafts/:id",
    answers: "400 VALIDATION_ERROR"
  },
  { endpoint: "PATCH /api/v1/offices/:id", answers: "400 VALIDATION_ERROR" },
  {
    endpoint: "PATCH /api/v1/partners/:partnerTenantId/status",
    answers: "422 VALIDATION_FAILED"
  },
  { endpoint: "PATCH /api/v1/profiles/:id", answers: "400 VALIDATION_ERROR" },
  { endpoint: "PATCH /api/v1/roles/:id", answers: "400 VALIDATION_ERROR" },
  { endpoint: "PATCH /api/v1/settings", answers: "400 VALIDATION_ERROR" },
  { endpoint: "PATCH /api/v1/sync/nodes/:id", answers: "400 VALIDATION_ERROR" },
  {
    endpoint: "PATCH /api/v1/tenant/domains/:id",
    answers: "400 VALIDATION_ERROR"
  },
  { endpoint: "PATCH /api/v1/users/:id", answers: "400 VALIDATION_ERROR" },
  { endpoint: "POST /api/v1/abac/policies", answers: "400 VALIDATION_ERROR" },
  {
    endpoint: "POST /api/v1/access/assignments",
    answers: "400 VALIDATION_ERROR"
  },
  { endpoint: "POST /api/v1/access/evaluate", answers: "400 VALIDATION_ERROR" },
  {
    endpoint: "POST /api/v1/access/machine-credentials",
    answers: "422 VALIDATION_FAILED"
  },
  { endpoint: "POST /api/v1/access/policies", answers: "400 VALIDATION_ERROR" },
  {
    endpoint: "POST /api/v1/access/policies/simulate",
    answers: "400 VALIDATION_ERROR"
  },
  {
    endpoint: "POST /api/v1/auth/delegated-access/redeem",
    answers: "400 VALIDATION_ERROR"
  },
  {
    endpoint: "POST /api/v1/auth/mfa/admin/reset",
    answers: "400 VALIDATION_ERROR"
  },
  {
    endpoint: "POST /api/v1/auth/mfa/step-up",
    answers: "400 VALIDATION_ERROR"
  },
  {
    endpoint: "POST /api/v1/auth/sso-providers",
    answers: "400 VALIDATION_ERROR"
  },
  { endpoint: "POST /api/v1/blog/menus", answers: "400 VALIDATION_ERROR" },
  { endpoint: "POST /api/v1/blog/pages", answers: "400 VALIDATION_ERROR" },
  { endpoint: "POST /api/v1/blog/posts", answers: "400 VALIDATION_ERROR" },
  {
    endpoint: "POST /api/v1/blog/posts/:id/submit-review",
    answers: "401 AUTH_REQUIRED"
  },
  { endpoint: "POST /api/v1/blog/templates", answers: "400 VALIDATION_ERROR" },
  { endpoint: "POST /api/v1/blog/terms", answers: "400 VALIDATION_ERROR" },
  { endpoint: "POST /api/v1/blog/widgets", answers: "400 VALIDATION_ERROR" },
  {
    endpoint: "POST /api/v1/comments/admin/:id/moderate",
    answers: "400 IDEMPOTENCY_REQUIRED"
  },
  {
    endpoint: "POST /api/v1/comments/admin/bulk-moderate",
    answers: "400 IDEMPOTENCY_REQUIRED"
  },
  {
    endpoint: "POST /api/v1/data-lifecycle/dry-run",
    answers: "400 VALIDATION_ERROR"
  },
  {
    endpoint: "POST /api/v1/domain-events/consumers/:name/pause",
    answers: "400 VALIDATION_ERROR"
  },
  {
    endpoint: "POST /api/v1/email/announcements/preview",
    answers: "400 VALIDATION_ERROR"
  },
  {
    endpoint: "POST /api/v1/email/suppressions",
    answers: "400 VALIDATION_ERROR"
  },
  { endpoint: "POST /api/v1/email/templates", answers: "400 VALIDATION_ERROR" },
  { endpoint: "POST /api/v1/form-drafts", answers: "400 VALIDATION_ERROR" },
  {
    endpoint: "POST /api/v1/news-portal/ad-placements",
    answers: "400 VALIDATION_ERROR"
  },
  {
    endpoint: "POST /api/v1/news-portal/homepage-sections",
    answers: "400 VALIDATION_ERROR"
  },
  { endpoint: "POST /api/v1/offices", answers: "400 VALIDATION_ERROR" },
  { endpoint: "POST /api/v1/profiles", answers: "400 VALIDATION_ERROR" },
  {
    endpoint: "POST /api/v1/profiles/:id/identifiers",
    answers: "400 VALIDATION_ERROR"
  },
  {
    endpoint: "POST /api/v1/reports/projections/:key/reconcile",
    answers: "404 NOT_FOUND"
  },
  { endpoint: "POST /api/v1/roles", answers: "400 VALIDATION_ERROR" },
  {
    endpoint: "POST /api/v1/roles/:id/permissions",
    answers: "400 VALIDATION_ERROR"
  },
  {
    endpoint: "POST /api/v1/seo/redirects/:id/lifecycle",
    answers: "400 IDEMPOTENCY_REQUIRED"
  },
  {
    endpoint: "POST /api/v1/sync/conflicts/:id/resolve",
    answers: "400 VALIDATION_ERROR"
  },
  { endpoint: "POST /api/v1/tenant/domains", answers: "400 VALIDATION_ERROR" },
  {
    endpoint: "POST /api/v1/tenant/modules/:moduleKey/disable",
    answers: "400 VALIDATION_ERROR"
  },
  {
    endpoint: "POST /api/v1/theming/validate",
    answers: "400 VALIDATION_ERROR"
  },
  {
    endpoint: "POST /api/v1/workflows/definitions",
    answers: "400 VALIDATION_ERROR"
  },
  {
    endpoint: "PUT /api/v1/access/policies/:id",
    answers: "400 VALIDATION_ERROR"
  }
];

export function isKnownAuthorizationFirstDebt(endpoint: string): boolean {
  return AUTHORIZATION_FIRST_DEBT.some((debt) => debt.endpoint === endpoint);
}
