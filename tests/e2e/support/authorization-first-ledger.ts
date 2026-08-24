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
 * It started at **121**. It is now **11**, and every one of those eleven is a
 * NAMED CLASS with a reason, not a leftover — the sections below say which.
 *
 * The rest answer `403 ACCESS_DENIED`, which is correct.
 *
 * ## The 110 that left, and the one sentence that retired them
 *
 * **Move the ANSWER, not the work.** Every one of them decided something before
 * `withTenant` opened — a missing `Idempotency-Key` (a header check, needing no
 * database and unable to fail), then a body that did not validate — and RETURNED
 * from there, so it never reached `authorizeInTransaction` and left no row.
 *
 * The work still happens outside the transaction, because it must: reading a
 * body waits on the CLIENT, and doing that inside `withTenant` holds a reserved
 * connection and its work-class slot for as long as a caller chooses to take.
 * Only the refusal was held, and returned after authorization had spoken. The
 * caller who is allowed still gets their validation errors, unchanged.
 *
 * Two things deliberately did NOT move, and both are the same rule:
 *
 * - **The body-size ceiling.** A PROTOCOL limit tells the caller nothing they
 *   did not already send.
 * - **Request-SHAPE guards** — a missing tenant header, a missing token, a
 *   missing path parameter. They are about whether this is a well-formed request
 *   for this route at all, not about the resource behind it, and a caller who
 *   omitted their own path segment learns nothing from being told so.
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
 * - **`POST /api/v1/blog/posts/:id/submit-review`** reads the post before
 *   authorizing for the same ownership-grant-basis reason as the two `PATCH`
 *   routes above, and additionally answers `MODULE_DISABLED` first. That one is
 *   a disclosure of a different kind — whether a MODULE is enabled for this
 *   tenant — and it is small, but it is still an answer given to somebody with
 *   no grant. Deferring it means deciding whether a disabled module should
 *   answer `403` or `409` to a caller who would not have been allowed either
 *   way, which is a product decision about which of two true things to say.
 * - **`POST /api/v1/access/evaluate`**, **`POST /api/v1/auth/mfa/step-up`** and
 *   **`POST /api/v1/auth/delegated-access/redeem`** never call
 *   `authorizeInTransaction` at all, so there is no chokepoint here to move a
 *   refusal behind. They are authentication-flow routes whose subject is the
 *   caller's own session; `evaluate` is a policy simulator. Whether they should
 *   record anything, and to which log, is a question about the decision log's
 *   scope rather than about statement order — the one shape in this file that
 *   the pattern above genuinely cannot express.
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
    endpoint: "PATCH /api/v1/blog/pages/:id",
    answers: "404 RESOURCE_NOT_FOUND"
  },
  {
    endpoint: "PATCH /api/v1/blog/posts/:id",
    answers: "404 RESOURCE_NOT_FOUND"
  },
  {
    endpoint: "PATCH /api/v1/partners/:partnerTenantId/status",
    answers: "422 VALIDATION_FAILED"
  },
  { endpoint: "POST /api/v1/access/evaluate", answers: "400 VALIDATION_ERROR" },
  {
    endpoint: "POST /api/v1/access/machine-credentials",
    answers: "422 VALIDATION_FAILED"
  },
  {
    endpoint: "POST /api/v1/auth/delegated-access/redeem",
    answers: "400 VALIDATION_ERROR"
  },
  {
    endpoint: "POST /api/v1/auth/mfa/step-up",
    answers: "400 VALIDATION_ERROR"
  },
  {
    endpoint: "POST /api/v1/blog/posts/:id/submit-review",
    answers: "401 AUTH_REQUIRED"
  },
  {
    endpoint: "POST /api/v1/comments/admin/:id/moderate",
    answers: "400 IDEMPOTENCY_REQUIRED"
  },
  {
    endpoint: "POST /api/v1/comments/admin/bulk-moderate",
    answers: "400 IDEMPOTENCY_REQUIRED"
  },
  {
    endpoint: "POST /api/v1/seo/redirects/:id/lifecycle",
    answers: "400 IDEMPOTENCY_REQUIRED"
  }
];

export function isKnownAuthorizationFirstDebt(endpoint: string): boolean {
  return AUTHORIZATION_FIRST_DEBT.some((debt) => debt.endpoint === endpoint);
}
