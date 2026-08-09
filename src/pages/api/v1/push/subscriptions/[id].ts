import { fail, ok } from "../../../../../modules/_shared/api-response";
import { defineSelfServiceTenantRoute } from "../../../../../modules/_shared/tenant-route";
import { isMachineCredentialToken } from "../../../../../lib/auth/machine-credential-token";
import { resolveTenantPrincipal } from "../../../../../modules/identity-access/application/auth-context";
import { revokeOwnPushSubscription } from "../../../../../modules/push-delivery/application/subscription-directory";
import { isPushRecordId } from "../../../../../modules/push-delivery/domain/push-record-id";

/**
 * `DELETE /api/v1/push/subscriptions/{id}` (Issue #466) — the caller retires
 * one of their OWN devices.
 *
 * Self-service for the same reason registration is (see `./index.ts`): the
 * subject is the caller, and ownership is expressed by matching
 * `tenant_user_id` inside the UPDATE rather than by fetching a row and
 * comparing afterwards. Nothing here reads a subscription it is not allowed to
 * change, so there is no window between the check and the write.
 *
 * ## One 404 for three different things
 *
 * "No such subscription", "belongs to somebody else", and "already revoked" all
 * answer `404 SUBSCRIPTION_NOT_FOUND`. Distinguishing them would turn this
 * endpoint into an existence oracle for other people's device ids, which is the
 * anti-oracle rule `identity_access`'s admin surfaces already follow — and the
 * caller can act on none of the three differently anyway.
 *
 * The revocation itself does more than flip a status: it destroys the stored
 * endpoint. See `revokeOwnPushSubscription`.
 */
const NO_STORE_HEADERS = { "cache-control": "private, no-store" };

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

export const DELETE = defineSelfServiceTenantRoute({
  workClass: "interactive",
  onUnauthenticated: (reason) =>
    reason === "tenant"
      ? fail(
          400,
          "TENANT_REQUIRED",
          "Tenant header `x-awcms-tenant-id` is required.",
          {},
          undefined,
          NO_STORE_HEADERS
        )
      : authRequired(),
  beforeTransaction: ({ token }) =>
    isMachineCredentialToken(token) ? authRequired() : undefined,
  handler: async ({ tx, tenantId, tokenHash, now, params }) => {
    const subscriptionId = params.id;

    if (!isPushRecordId(subscriptionId)) {
      return fail(
        400,
        "VALIDATION_FAILED",
        "Push subscription id must be a uuid."
      );
    }

    const principal = await resolveTenantPrincipal(
      tx,
      tenantId,
      tokenHash,
      now
    );

    if (!principal) return authRequired();

    const result = await revokeOwnPushSubscription(
      tx,
      tenantId,
      principal.context.tenantUserId,
      subscriptionId
    );

    if (!result.revoked) {
      return fail(
        404,
        "SUBSCRIPTION_NOT_FOUND",
        "No active push subscription with that id belongs to you."
      );
    }

    return ok({ revoked: true });
  }
});
