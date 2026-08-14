/**
 * `GET|PATCH /api/v1/auth/profile` — the caller's OWN display name (ADR-0096).
 *
 * ## Why this is not `PATCH /api/v1/profiles/{id}`
 *
 * That endpoint exists and is permissioned (`profile_identity.parties.update`),
 * because it can be pointed at ANY profile in the tenant. This one accepts no id
 * at all: the profile it writes is the one behind the calling session, resolved
 * server-side from `awcms_identities.profile_id`. The subject is the caller, so
 * there is nothing to authorize beyond "is this a live session".
 *
 * That distinction is the whole reason for a second route rather than a relaxed
 * guard on the first. Making the permissioned endpoint fall back to "…or it's
 * your own profile" would put an ownership branch inside an administrative
 * surface, which is precisely the shape ADR-0063 replaced with per-handler gates
 * and an explicit `ownershipGrant`.
 *
 * Unpermissioned for the reason the sibling self-service routes state
 * (`GET /api/v1/auth/sessions`, `POST /api/v1/auth/preferences`): inventing
 * `identity_access.own_profile.update` would install the latent-authz trap of
 * ADR-0058 §E — an action nothing seeds denies everyone, tenant owner included,
 * while the route reads as correctly guarded.
 *
 * ## What it deliberately cannot change
 *
 * Only `display_name`. NOT `legal_name` (a verification-relevant field —
 * `awcms_profiles.verification_status` exists precisely because a legal name is
 * asserted and then checked, so letting the subject rewrite it silently would
 * make the verification meaningless), NOT `status`, NOT `verification_status`,
 * NOT `risk_level`, and NOT the identifiers. Those are administrative fields that
 * happen to live on the same row; a self-service endpoint that wrote them would
 * be a privilege escalation wearing a profile editor's clothes.
 */
import { fail, jsonResponse } from "../../../../modules/_shared/api-response";
import { defineSelfServiceTenantRoute } from "../../../../modules/_shared/tenant-route";
import {
  checkSharedRateLimit,
  resolveClientIp
} from "../../../../lib/security/rate-limit";
import { resolveActiveSession } from "../../../../modules/identity-access/application/session-lookup";
import { updateOwnDisplayName } from "../../../../modules/profile-identity/application/person-profile";

const NO_STORE_HEADERS = { "cache-control": "private, no-store" };

const RATE_LIMIT = { maxAttempts: 30, windowMs: 60_000 };

/**
 * Same ceiling as `profile_identity`'s `MAX_DISPLAY_NAME_LENGTH`, and the same
 * emptiness rule. Restated rather than imported because that constant is not
 * exported and this route validates a single scalar — but the NUMBER must not
 * drift, so `tests/admin-account-page-contract.test.ts` asserts a name of
 * exactly 200 characters is accepted and 201 refused, which is the property
 * either side would break.
 */
const MAX_DISPLAY_NAME_LENGTH = 200;

function authRequired(): Response {
  return fail(
    401,
    "AUTH_REQUIRED",
    "Authentication required.",
    {},
    undefined,
    NO_STORE_HEADERS
  );
}

function tenantRequired(): Response {
  return fail(
    400,
    "TENANT_REQUIRED",
    "Tenant context is required.",
    {},
    undefined,
    NO_STORE_HEADERS
  );
}

export const GET = defineSelfServiceTenantRoute({
  workClass: "interactive",
  onUnauthenticated: (reason) =>
    reason === "tenant" ? tenantRequired() : authRequired(),
  handler: async ({ tx, tenantId, tokenHash, now }) => {
    const session = await resolveActiveSession(tx, tenantId, tokenHash, now);

    if (!session) return authRequired();

    const rows = (await tx`
      SELECT p.id, p.display_name, i.login_identifier
      FROM awcms_identities i
      JOIN awcms_profiles p
        ON p.tenant_id = i.tenant_id AND p.id = i.profile_id
      WHERE i.tenant_id = ${tenantId} AND i.id = ${session.identity_id}
    `) as Array<{
      id: string;
      display_name: string;
      login_identifier: string;
    }>;

    const profile = rows[0];

    // An identity with no readable profile is an invariant violation, not a
    // user-facing state — but it must not 500 the account screen either.
    if (!profile) return authRequired();

    return jsonResponse(
      {
        success: true,
        data: {
          profileId: profile.id,
          displayName: profile.display_name,
          // The login identifier is the caller's OWN, so returning it discloses
          // nothing they do not already type to sign in. It is not masked for
          // that reason: masking your own address on your own account page
          // helps nobody and makes "is this the right account" unanswerable.
          loginIdentifier: profile.login_identifier
        },
        meta: {}
      },
      { status: 200, headers: NO_STORE_HEADERS }
    );
  }
});

export const PATCH = defineSelfServiceTenantRoute<{ displayName: string }>({
  workClass: "interactive",
  onUnauthenticated: (reason) =>
    reason === "tenant" ? tenantRequired() : authRequired(),
  beforeTransaction: async ({ request, clientAddress }) => {
    const limit = await checkSharedRateLimit(
      `auth-profile:${resolveClientIp(request, clientAddress)}`,
      RATE_LIMIT
    );

    return limit.allowed
      ? undefined
      : fail(
          429,
          "RATE_LIMITED",
          "Too many profile updates. Try again shortly.",
          {},
          undefined,
          NO_STORE_HEADERS
        );
  },
  // Body read BEFORE the transaction: `request.json()` waits on the CLIENT, and
  // doing it inside `withTenant` would hold a pool connection and its work-class
  // slot for as long as the caller takes to send.
  prepare: async ({ request }) => {
    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return fail(
        400,
        "INVALID_BODY",
        "Request body could not be read.",
        {},
        undefined,
        NO_STORE_HEADERS
      );
    }

    const raw =
      body && typeof body === "object" && "displayName" in body
        ? (body as { displayName: unknown }).displayName
        : undefined;

    if (typeof raw !== "string") {
      return fail(
        400,
        "VALIDATION_ERROR",
        "displayName is required.",
        {},
        [{ field: "displayName", message: "displayName must be a string." }],
        NO_STORE_HEADERS
      );
    }

    const displayName = raw.trim();

    if (
      displayName.length === 0 ||
      displayName.length > MAX_DISPLAY_NAME_LENGTH
    ) {
      return fail(
        400,
        "VALIDATION_ERROR",
        "displayName is invalid.",
        {},
        [
          {
            field: "displayName",
            message: `displayName must be a non-empty string of at most ${MAX_DISPLAY_NAME_LENGTH} characters.`
          }
        ],
        NO_STORE_HEADERS
      );
    }

    return { displayName };
  },
  handler: async ({ tx, tenantId, tokenHash, now, prepared }) => {
    const session = await resolveActiveSession(tx, tenantId, tokenHash, now);

    if (!session) return authRequired();

    // The write goes through `profile_identity`, which OWNS `awcms_profiles`
    // (ADR-0013 §6, "no shared-table write"). The first draft did the UPDATE
    // inline here and `modules:table-writes:check` reported it — rightly: this
    // module owning the `/api/v1/auth/*` surface does not make it a co-owner of
    // another module's table, and two writers is how two account-creation paths
    // silently diverged on `verification_status`.
    //
    // The service takes an IDENTITY id, never a profile id, which is what keeps
    // this self-service rather than administrative: there is nothing for the
    // caller to point elsewhere.
    const profile = await updateOwnDisplayName(
      tx,
      tenantId,
      session.identity_id,
      prepared.displayName
    );

    if (!profile) return authRequired();

    return jsonResponse(
      {
        success: true,
        data: { profileId: profile.id, displayName: profile.displayName },
        meta: {}
      },
      { status: 200, headers: NO_STORE_HEADERS }
    );
  }
});
