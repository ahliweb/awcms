import type { APIRoute } from "astro";

import { fail, ok } from "../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../lib/database/client";
import { withTenant } from "../../../../../lib/database/tenant-context";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../../modules/identity-access/application/access-guard";
import { hashSessionToken } from "../../../../../lib/auth/session-token";
import { recordAuditEvent } from "../../../../../modules/logging/application/audit-log";
import { deleteSuppression } from "../../../../../modules/email/application/suppression-directory";

const DELETE_GUARD = {
  moduleKey: "email",
  activityCode: "suppression",
  action: "delete" as const
};

/** `DELETE /api/v1/email/suppressions/{id}` (Issue #499) — a hard delete, unlike template soft-delete: a suppression entry is a live operational flag (bounce/complaint/manual/unsubscribe), not master/config data with a restore workflow. */
export const DELETE: APIRoute = async ({
  request,
  params,
  cookies,
  locals
}) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);
  const suppressionId = params.id;

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }

  if (!suppressionId) {
    return fail(400, "VALIDATION_ERROR", "Suppression id is required.");
  }

  if (!token) {
    return fail(401, "AUTH_REQUIRED", "Authentication required.");
  }

  const sql = getDatabaseClient();
  const tokenHash = hashSessionToken(token);
  const now = new Date();
  const correlationId = locals.correlationId;

  return withTenant(sql, tenantId, async (tx) => {
    const auth = await authorizeInTransaction(
      tx,
      tenantId,
      tokenHash,
      now,
      DELETE_GUARD
    );

    if (!auth.allowed) {
      return auth.denied;
    }

    const deleted = await deleteSuppression(tx, tenantId, suppressionId);

    if (!deleted) {
      return fail(404, "RESOURCE_NOT_FOUND", "Suppression entry not found.");
    }

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "email",
      action: "suppression_deleted",
      resourceType: "email_suppression",
      resourceId: suppressionId,
      severity: "warning",
      message: `Suppression entry removed: reason=${deleted.reason}.`,
      attributes: { reason: deleted.reason },
      correlationId
    });

    return ok({ id: suppressionId, deleted: true });
  });
};
