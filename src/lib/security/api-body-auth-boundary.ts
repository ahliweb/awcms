/**
 * No API request body is parsed before the caller's credential has been
 * checked — and the endpoints exempt from that are DECLARED, not discovered.
 *
 * ## The defect this closes
 *
 * `defineTenantRoute` checked only that a token was PRESENT, then ran the
 * route's `prepare` hook, which parses and validates the body. So a request
 * carrying any string at all as a bearer token — `Bearer nonsense` — reached
 * validation and came back with the endpoint's full schema:
 *
 *     POST /api/v1/blog/institutions   Authorization: Bearer nonsense
 *     → 400 {"code":"VALIDATION_ERROR","details":[
 *          {"field":"branch","message":"branch must be one of legislative, executive."},
 *          {"field":"name",  "message":"name is required and must be at most 150 characters."},
 *          {"field":"slug",  "message":"slug is required."}]}
 *
 * Measured against a running server: **77 session-gated endpoints** answered
 * that way. Three consequences, in ascending order of seriousness:
 *
 * 1. Field names, enum values and length limits are disclosed to an anonymous
 *    caller.
 * 2. JSON parsing and validation run for anyone, which is work an unauthenticated
 *    request should never cause (bounded by the body ceiling, so a nuisance
 *    rather than an amplifier).
 * 3. **Nothing is recorded.** `authorizeInTransaction` is what writes the
 *    decision log; a request that short-circuits before it leaves no trace. An
 *    attacker enumerating endpoints was invisible.
 *
 * ## Why a boundary in middleware rather than 77 route edits
 *
 * The per-route fix is real but has no mechanism behind it: nothing stops the
 * 78th route from reintroducing the same ordering, and 63 of the 77 are
 * hand-written handlers with no shared shape to fix. One boundary, crossed by
 * every API request, is a thing that can be reasoned about — and it turns
 * "which endpoints are reachable without a session", today implicit and
 * knowable only by reading 246 handlers, into the list below.
 *
 * The boundary does **authentication only**. Authorization stays with
 * `authorizeInTransaction` (ADR-0063) and is not duplicated here — a second
 * place deciding what a caller may DO is exactly the drift this repo has been
 * bitten by. This decides only whether the caller is anyone at all.
 *
 * ## Scope: bodies, not every request
 *
 * The rule is "authenticate before parsing a body", so it applies to methods
 * that carry one. A GET's query string is something the caller already knows,
 * and exempting reads keeps the cost — one session lookup — off the path an
 * admin UI takes most often.
 */

/** A method+path an unauthenticated caller may legitimately POST a body to. */
export type SessionFreeBodyEndpoint = {
  method: "POST" | "PUT" | "PATCH" | "DELETE";
  /** `:name` matches exactly one path segment. */
  pattern: string;
  /** Why no session exists yet, or why one is not the credential. */
  reason: string;
};

/**
 * Every body-accepting API endpoint that does NOT require a session.
 *
 * Each entry is a decision. Adding one means asserting that an anonymous caller
 * may reach that handler's body parsing, so the reason is part of the entry and
 * `tests/api-body-auth-boundary.test.ts` refuses a blank one.
 *
 * Deliberately NOT here, though both were observed answering before checking a
 * session: `POST /api/v1/auth/sso/:providerKey/{link,unlink}`. They require a
 * token anyway — they answered `403 SSO_DISABLED` from a feature flag placed
 * above the auth check — so the boundary now refuses an anonymous caller first,
 * which discloses less rather than more.
 */
export const SESSION_FREE_BODY_ENDPOINTS: readonly SessionFreeBodyEndpoint[] = [
  {
    method: "POST",
    pattern: "/api/v1/setup/initialize",
    reason:
      "The bootstrap that creates the first tenant and its owner. It runs before any identity exists, and is a singleton refused once the platform is initialised."
  },

  // ---- Authentication itself: the session does not exist yet ----
  {
    method: "POST",
    pattern: "/api/v1/auth/login",
    reason: "Mints the session. Requiring one would be circular."
  },
  {
    method: "POST",
    pattern: "/api/v1/auth/session/tenant",
    reason:
      "The principal-selection step (ADR-0087): credentials are already accepted, and this exchanges the selection token for a tenant session."
  },
  {
    method: "POST",
    pattern: "/api/v1/auth/mfa/totp/verify",
    reason:
      "The second factor, presented mid-login. No session exists until it passes."
  },
  {
    method: "POST",
    pattern: "/api/v1/auth/mfa/totp/enroll/start",
    reason:
      "Accepts an enrollment token INSTEAD of a session, for enrollment forced during login. A session is one of two accepted credentials, not a requirement."
  },
  {
    method: "POST",
    pattern: "/api/v1/auth/mfa/totp/enroll/verify",
    reason: "The other half of the enrollment above, same credential rule."
  },
  {
    method: "POST",
    pattern: "/api/v1/auth/password/forgot",
    reason:
      "Someone who cannot sign in is the only caller. Answers uniformly whether or not the address is known."
  },
  {
    method: "POST",
    pattern: "/api/v1/auth/password/reset",
    reason: "Carries its own single-use token; a session is what it restores."
  },
  {
    method: "POST",
    pattern: "/api/v1/auth/register",
    reason:
      "Self-registration, gated by a deployment flag that answers 404 when off."
  },
  {
    method: "POST",
    pattern: "/api/v1/auth/invitations/:id/accept",
    reason:
      "The invitee has no account yet. The invitation token is the credential."
  },
  {
    method: "POST",
    pattern: "/api/v1/auth/session-handoff/redeem",
    reason:
      "Authenticated by a MACHINE CREDENTIAL rather than a session (ADR-0049 §4) — see `defineClientCredentialTenantRoute`."
  },
  {
    method: "POST",
    pattern: "/api/v1/auth/preferences/locale",
    reason:
      "Its entire effect is a cookie (ADR-0095). It exists precisely for the screens where no session exists to hang a preference on."
  },

  // ---- Reader-facing surfaces: the public is the caller ----
  {
    method: "POST",
    pattern: "/api/v1/analytics/collect",
    reason:
      "The reader beacon. Rate-limited per IP in the handler; a session would defeat its purpose."
  },
  {
    method: "POST",
    pattern: "/api/v1/comments",
    reason: "A reader posts a comment. Idempotency key required."
  },
  {
    method: "PATCH",
    pattern: "/api/v1/comments/:id",
    reason: "A reader edits their own comment, holding its author token."
  },
  {
    method: "POST",
    pattern: "/api/v1/comments/:id/replies",
    reason: "A reader replies. Answers uniformly so it cannot be probed."
  },
  {
    method: "POST",
    pattern: "/api/v1/comments/:id/report",
    reason: "A reader reports a comment. Uniform answer, same reason."
  },
  {
    method: "POST",
    pattern: "/api/v1/comments/:id/delete-request",
    reason: "A reader asks for their own comment to be removed."
  },
  {
    method: "POST",
    pattern: "/api/v1/newsletter/subscribe",
    reason: "A reader subscribes; confirmation is by email."
  },
  {
    method: "POST",
    pattern: "/api/v1/newsletter/confirm",
    reason: "Carries the confirmation token from that email."
  },
  {
    method: "POST",
    pattern: "/api/v1/newsletter/unsubscribe",
    reason:
      "Must work from an email link, for someone who may never have had an account."
  },

  // ---- Node-to-node: signed, not sessioned ----
  {
    method: "POST",
    pattern: "/api/v1/sync/push",
    reason:
      "Authenticated by an HMAC signature bound to tenant and node, not by a session."
  },
  {
    method: "POST",
    pattern: "/api/v1/sync/pull",
    reason: "Same HMAC credential as `/sync/push`."
  },
  {
    method: "POST",
    pattern: "/api/v1/sync/objects",
    reason: "Same HMAC credential as `/sync/push`."
  },

  // ---- Retired: answers 410 without reading anything ----
  {
    method: "POST",
    pattern: "/api/v1/blog/ads",
    reason:
      "Retired (410). Kept exempt so the gone-ness is what a caller learns, rather than an auth error implying it still exists."
  },
  {
    method: "PATCH",
    pattern: "/api/v1/blog/ads/:id",
    reason: "Retired (410), same reason."
  }
];

const BODY_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Does `pathname` match `pattern`, where `:name` is one segment? */
export function matchesEndpointPattern(
  pattern: string,
  pathname: string
): boolean {
  const patternParts = pattern.split("/");
  const pathParts = pathname.split("/");

  if (patternParts.length !== pathParts.length) return false;

  return patternParts.every((part, index) => {
    const actual = pathParts[index];
    if (actual === undefined) return false;
    if (part.startsWith(":")) return actual.length > 0;
    return part === actual;
  });
}

/** Is this method+path declared reachable without a session? */
export function isSessionFreeBodyEndpoint(
  method: string,
  pathname: string
): boolean {
  return SESSION_FREE_BODY_ENDPOINTS.some(
    (endpoint) =>
      endpoint.method === method.toUpperCase() &&
      matchesEndpointPattern(endpoint.pattern, pathname)
  );
}

/**
 * Must the middleware resolve a credential before this request reaches its
 * route?
 *
 * A trailing slash is normalised away first: `/api/v1/auth/login/` and
 * `/api/v1/auth/login` are one endpoint, and treating them as two would leave
 * the second one exempt by accident — which is precisely how an allow-list
 * becomes a bypass.
 */
export function requiresAuthenticatedCallerBeforeBody(
  method: string,
  pathname: string
): boolean {
  if (!BODY_METHODS.has(method.toUpperCase())) return false;

  const normalised =
    pathname.length > 1 && pathname.endsWith("/")
      ? pathname.replace(/\/+$/, "")
      : pathname;

  if (!normalised.startsWith("/api/")) return false;

  return !isSessionFreeBodyEndpoint(method, normalised);
}
