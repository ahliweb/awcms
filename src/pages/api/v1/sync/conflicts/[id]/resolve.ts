import type { APIRoute } from "astro";
import { fail, ok } from "../../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../../lib/database/client";
import { withTenant } from "../../../../../../lib/database/tenant-context";
import { hashSessionToken } from "../../../../../../lib/auth/session-token";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../../../lib/security/request-body-limit";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../../../modules/identity-access/application/access-guard";
import { recordAuditEvent } from "../../../../../../modules/logging/application/audit-log";
import { validateConflictResolutionRequestBody } from "../../../../../../modules/sync-storage/domain/sync-validation";

const GUARD_REQUEST = {
  moduleKey: "sync_storage",
  activityCode: "conflict_resolution",
  action: "approve" as const
};

export const POST: APIRoute = async ({ request, cookies, params }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);
  const conflictId = params.id;

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }

  if (!conflictId) {
    return fail(400, "VALIDATION_ERROR", "Conflict id is required.");
  }

  if (!token) {
    return fail(401, "AUTH_REQUIRED", "Authentication required.");
  }

  const bodyRead = await readJsonBody(request);

  if (bodyRead.tooLarge) {
    return bodyTooLargeResponse(bodyRead.limitBytes);
  }

  const validation = validateConflictResolutionRequestBody(bodyRead.value);

  if (!validation.valid) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "Conflict resolution input is invalid.",
      {},
      validation.errors
    );
  }

  const { resolution, note } = validation.value;
  const sql = getDatabaseClient();
  const tokenHash = hashSessionToken(token);
  const now = new Date();

  return withTenant(
    sql,
    tenantId,
    async (tx) => {
      const auth = await authorizeInTransaction(
        tx,
        tenantId,
        tokenHash,
        now,
        GUARD_REQUEST
      );

      if (!auth.allowed) {
        return auth.denied;
      }

      const conflictRows = await tx`
      SELECT id, status FROM awcms_sync_conflicts
      WHERE tenant_id = ${tenantId} AND id = ${conflictId}
    `;
      const conflict = conflictRows[0] as
        { id: string; status: string } | undefined;

      if (!conflict) {
        return fail(404, "RESOURCE_NOT_FOUND", "Conflict not found.");
      }

      if (conflict.status === "resolved") {
        return fail(
          409,
          "IDEMPOTENCY_CONFLICT",
          "Conflict is already resolved."
        );
      }

      await tx`
      UPDATE awcms_sync_conflicts
      SET status = 'resolved', resolution = ${resolution}, resolution_note = ${note ?? null},
          resolved_by = ${auth.context.tenantUserId}, resolved_at = ${now}
      WHERE id = ${conflictId}
    `;

      await recordAuditEvent(tx, {
        tenantId,
        actorTenantUserId: auth.context.tenantUserId,
        moduleKey: "sync_storage",
        action: "approve",
        resourceType: "sync_conflict",
        resourceId: conflictId,
        severity: "warning",
        message: "Sync conflict resolved.",
        attributes: { resolution, note }
      });

      return ok({ id: conflictId, status: "resolved", resolution });
    },
    { workClass: "background_sync" }
  );
};
