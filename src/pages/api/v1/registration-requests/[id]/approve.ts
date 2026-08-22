import { fail, ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import { createEmailAuthNotificationAdapter } from "../../../../../modules/email/application/auth-notification-port-adapter";
import { approveRegistrationRequest } from "../../../../../modules/identity-access/application/self-registration";
import { recordAuditEvent } from "../../../../../modules/logging/application/audit-log";
import { resolveDeclaredBaseUrl } from "../../../../../lib/http/site-origin";
import {
  bodyTooLargeResponse,
  readTextBody
} from "../../../../../lib/security/request-body-limit";

const TOKEN_TTL_MIN = Number(
  process.env.AUTH_PASSWORD_RESET_TOKEN_TTL_MIN ?? 30
);

type ApproveBody = {
  roleIds?: unknown;
};

/**
 * `POST /api/v1/registration-requests/{id}/approve` (Wave 2 delta auth).
 *
 * The ONE path that turns an applicant into an account that can sign in, which
 * is why it has its own permission rather than sharing `access_control`: the
 * authority to admit someone to a tenant is not the authority to edit roles.
 *
 * `roleIds` is optional and defaults to none. A self-registered account with no
 * role can sign in and see nothing, which is the correct floor — an approval
 * that silently granted a default role would make "approve" mean more than the
 * reviewer read it as.
 *
 * SYSTEM roles are refused (409 `ROLE_SYSTEM_PROTECTED`). The sentence above
 * about admission not being role-editing is exactly why: `owner` is a system
 * role holding the whole tenant catalogue, so letting this permission hand it
 * out would make `registration_requests.approve` a superset of the permission
 * it was separated from. The refusal lives in the service, before any write —
 * see `application/self-registration.ts`.
 *
 * The applicant receives a password-reset link, not a password: the account is
 * created with an unusable credential (see
 * `application/self-registration.ts`). `delivery` is reported back so the admin
 * screen can say when that link could not be queued, rather than showing a
 * success for an account nobody can get into.
 *
 * No `Idempotency-Key`: the `FOR UPDATE` + `status = 'pending'` predicate in
 * the service already makes a double-click produce exactly one account, and the
 * second call reports `not_found` rather than a second identity.
 */
export const POST = defineTenantRoute({
  workClass: "interactive",
  prepare: async ({ request, params }) => {
    const requestId = params.id;

    if (!requestId) {
      return fail(400, "VALIDATION_ERROR", "Request id is required.");
    }

    let body: ApproveBody = {};

    // A bodyless approve is the common case (no roles), so an absent or
    // unparseable body is not an error — but a PRESENT, malformed one is not
    // silently reinterpreted as "no roles" either.
    const rawRead = await readTextBody(request);

    if (rawRead.tooLarge) {
      return bodyTooLargeResponse(rawRead.limitBytes);
    }

    const raw = rawRead.value;

    if (raw.trim().length > 0) {
      try {
        body = JSON.parse(raw) as ApproveBody;
      } catch {
        return fail(
          400,
          "VALIDATION_ERROR",
          "Request body must be valid JSON."
        );
      }
    }

    const roleIds = Array.isArray(body.roleIds) ? body.roleIds : [];

    if (roleIds.some((entry) => typeof entry !== "string")) {
      return fail(400, "VALIDATION_ERROR", "roleIds must be an array of ids.");
    }

    return { requestId, roleIds: roleIds as string[] };
  },
  authorize: {
    moduleKey: "identity_access",
    activityCode: "registration_requests",
    action: "approve"
  },
  handler: async ({ tx, tenantId, auth, prepared, locals }) => {
    const appUrl = resolveDeclaredBaseUrl();
    const result = await approveRegistrationRequest(
      tx,
      tenantId,
      prepared.requestId,
      auth.context.tenantUserId,
      new Date(),
      {
        roleIds: prepared.roleIds,
        notifications: createEmailAuthNotificationAdapter(),
        resetUrlBase: `${appUrl}/reset-password`,
        tokenTtlMinutes: TOKEN_TTL_MIN,
        correlationId: locals.correlationId
      }
    );

    if (result.outcome !== "approved") {
      // These 4xx returns COMMIT (they are returned from inside the tenant
      // transaction) — deliberate: nothing was mutated on any of these paths,
      // and the service checks each one before it writes anything.
      if (result.outcome === "not_found") {
        return fail(404, "NOT_FOUND", "No pending registration request found.");
      }

      if (result.outcome === "identifier_taken") {
        return fail(
          409,
          "IDENTIFIER_TAKEN",
          "An account with that login identifier already exists."
        );
      }

      if (result.outcome === "system_role") {
        // Same code the ordinary assignment path returns for the same refusal
        // (`POST /api/v1/access/assignments` → 409 ROLE_SYSTEM_PROTECTED), so a
        // reviewer who meets it in either place reads one answer, not two.
        return fail(
          409,
          "ROLE_SYSTEM_PROTECTED",
          "A system role cannot be granted through an approval."
        );
      }

      return fail(400, "UNKNOWN_ROLE", "One or more roles do not exist.");
    }

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "identity_access",
      action: "registration_approved",
      resourceType: "registration_request",
      resourceId: prepared.requestId,
      // `warning`, not `info`: this created a login-capable account.
      severity: "warning",
      message: "Self-registration approved; account created.",
      attributes: {
        identityId: result.identityId,
        tenantUserId: result.tenantUserId,
        roleCount: prepared.roleIds.length,
        // WHICH role, not just how many. An approval that granted a role is a
        // privilege grant, and `roleCount: 1` cannot tell an auditor whether
        // the account got `viewer` or something far larger.
        roleCodes: result.grantedRoleCodes,
        delivery: result.delivery
      },
      correlationId: locals.correlationId
    });

    return ok({
      approved: true,
      identityId: result.identityId,
      tenantUserId: result.tenantUserId,
      delivery: result.delivery
    });
  }
});
