import { created, fail, ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../../lib/security/request-body-limit";
import { recordAuditEvent } from "../../../../../modules/logging/application/audit-log";
import {
  approveDelegatedAccess,
  listDelegatedGrants
} from "../../../../../modules/identity-access/application/delegated-access-store";
import { DELEGATED_ACCESS_MAX_TTL_DAYS } from "../../../../../modules/identity-access/domain/delegated-access";

/**
 * `GET`/`POST /api/v1/access/delegated-grants` — ADR-0090, Gelombang 8 PR 8.4
 * of #423.
 *
 * The customer approves a partner's access to their own tenant, at a role they
 * choose, until a date they choose.
 *
 * ## The code is returned ONCE, and only here
 *
 * `POST` is the only response in the repo that carries `accessCode`. It is
 * never stored in plaintext, never listed, and never re-issued: `GET` below
 * does not even SELECT the hash column, so no serialisation mistake can leak
 * it. Losing it means revoking the grant and approving a new one, which is the
 * correct cost — a code that can be re-read is a code that lives in whatever
 * read it.
 *
 * ## Guarded by `assign`, not `create`
 *
 * What this endpoint does is HAND A ROLE to somebody from outside. That
 * authority already has a name here (ADR-0081, repeated by ADR-0082 for
 * invitations), and inventing a second one would let an operator hold "approve
 * partner access" while holding no authority to grant roles at all.
 */
const READ_GUARD = {
  moduleKey: "identity_access",
  activityCode: "partner_access",
  action: "read"
} as const;

const ASSIGN_GUARD = {
  moduleKey: "identity_access",
  activityCode: "partner_access",
  action: "assign"
} as const;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MAX_PURPOSE_LENGTH = 500;

type ApprovePrepared = {
  partnerTenantId: string;
  roleId: string;
  purpose: string;
  expiresAt: Date;
};

export const GET = defineTenantRoute({
  workClass: "interactive",
  authorize: READ_GUARD,
  handler: async ({ tx, tenantId }) =>
    ok({ grants: await listDelegatedGrants(tx, tenantId) })
});

export const POST = defineTenantRoute<ApprovePrepared>({
  workClass: "interactive",
  prepare: async ({ request }): Promise<ApprovePrepared | Response> => {
    const bodyRead = await readJsonBody(request);
    if (bodyRead.tooLarge) return bodyTooLargeResponse(bodyRead.limitBytes);

    const body = bodyRead.value as {
      partnerTenantId?: unknown;
      roleId?: unknown;
      purpose?: unknown;
      expiresAt?: unknown;
    } | null;

    if (
      typeof body?.partnerTenantId !== "string" ||
      !UUID_PATTERN.test(body.partnerTenantId)
    ) {
      return fail(400, "VALIDATION_ERROR", "partnerTenantId must be a UUID.");
    }
    if (typeof body.roleId !== "string" || !UUID_PATTERN.test(body.roleId)) {
      return fail(400, "VALIDATION_ERROR", "roleId must be a UUID.");
    }
    // A purpose is REQUIRED and not defaulted. "Why does this vendor have
    // access" is the first question an audit asks, and a blank answer supplied
    // by the system reads as an answer.
    if (
      typeof body.purpose !== "string" ||
      body.purpose.trim().length === 0 ||
      body.purpose.length > MAX_PURPOSE_LENGTH
    ) {
      return fail(
        400,
        "VALIDATION_ERROR",
        `purpose is required and must be 1-${MAX_PURPOSE_LENGTH} characters.`
      );
    }
    if (typeof body.expiresAt !== "string") {
      return fail(400, "VALIDATION_ERROR", "expiresAt must be an ISO date.");
    }

    const expiresAt = new Date(body.expiresAt);
    if (Number.isNaN(expiresAt.getTime())) {
      return fail(400, "VALIDATION_ERROR", "expiresAt must be an ISO date.");
    }

    return {
      partnerTenantId: body.partnerTenantId,
      roleId: body.roleId,
      purpose: body.purpose.trim(),
      expiresAt
    };
  },
  authorize: ASSIGN_GUARD,
  handler: async ({ tx, tenantId, auth, prepared, now, locals }) => {
    let result;
    try {
      result = await approveDelegatedAccess(tx, tenantId, now, {
        partnerTenantId: prepared.partnerTenantId,
        roleId: prepared.roleId,
        approvedByTenantUserId: auth.context.tenantUserId,
        purpose: prepared.purpose,
        expiresAt: prepared.expiresAt
      });
    } catch {
      // Two FKs do the validation this route deliberately does not duplicate:
      // the engagement must exist, and the role must belong to this tenant.
      // Caught inside the transaction so the 4xx is not returned on an aborted
      // one.
      return fail(
        404,
        "NOT_FOUND",
        "No such partner engagement, or no such role in this tenant."
      );
    }

    if (!result.ok) {
      // No live partnership answers 404, the same shape as a role from another
      // tenant: both mean "there is nothing here to approve against", and
      // separating them would let a caller probe which partnerships exist.
      if (result.code === "NO_ENGAGEMENT") {
        return fail(
          404,
          "NOT_FOUND",
          "No such partner engagement, or no such role in this tenant."
        );
      }

      return fail(
        400,
        "VALIDATION_ERROR",
        result.code === "TTL_IN_THE_PAST"
          ? "expiresAt must be in the future."
          : `Delegated access may last at most ${DELEGATED_ACCESS_MAX_TTL_DAYS} days.`
      );
    }

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "identity_access",
      action: "assign",
      resourceType: "delegated_access_grant",
      resourceId: result.grantId,
      // `critical`: this is the moment someone outside the organisation is
      // given a way in.
      severity: "critical",
      message: "Delegated access approved for a partner.",
      attributes: {
        partnerTenantId: prepared.partnerTenantId,
        roleId: prepared.roleId,
        purpose: prepared.purpose,
        expiresAt: prepared.expiresAt.toISOString()
      },
      correlationId: locals.correlationId
    });

    return created({
      grantId: result.grantId,
      // Once. See the header.
      accessCode: result.accessCode,
      codeExpiresAt: result.codeExpiresAt,
      expiresAt: prepared.expiresAt
    });
  }
});
