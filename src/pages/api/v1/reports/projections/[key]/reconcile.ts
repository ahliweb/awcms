import type { APIRoute } from "astro";
import { fail, ok } from "../../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../../lib/database/client";
import { withTenant } from "../../../../../../lib/database/tenant-context";
import { hashSessionToken } from "../../../../../../lib/auth/session-token";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../../../modules/identity-access/application/access-guard";
import { findProjectionDescriptor } from "../../../../../../modules/reporting/application/projection-directory";
import { isProjectionPermitted } from "../../../../../../modules/reporting/domain/projection-permission-filter";
import { reconcileProjection } from "../../../../../../modules/reporting/application/projection-reconciliation";

/**
 * `POST /api/v1/reports/projections/{key}/reconcile` (Issue #753) —
 * on-demand comparison of a projection's current metric values against a
 * freshly computed control total from its own source table(s). No
 * `Idempotency-Key` required — this endpoint mutates no business state
 * (it only APPENDS a reconciliation snapshot row; re-running is always
 * safe and simply produces a fresh comparison), same "zero mutation, safe
 * to retry" posture `data_lifecycle`'s `POST /dry-run` endpoint already
 * documents.
 */
export const POST: APIRoute = async ({ request, cookies, locals, params }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);
  const key = params.key;

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }
  if (!token) {
    return fail(401, "AUTH_REQUIRED", "Authentication required.");
  }
  if (!key) {
    return fail(400, "VALIDATION_ERROR", "Projection key is required.");
  }

  const descriptor = findProjectionDescriptor(key);
  if (!descriptor || descriptor.scope !== "tenant") {
    return fail(
      404,
      "NOT_FOUND",
      `No registered projection with key "${key}".`
    );
  }

  const sql = getDatabaseClient();
  const tokenHash = hashSessionToken(token);
  const now = new Date();
  const correlationId = locals.correlationId;

  return withTenant(sql, tenantId, async (tx) => {
    const auth = await authorizeInTransaction(tx, tenantId, tokenHash, now, {
      moduleKey: "reporting",
      activityCode: "projections",
      action: "analyze"
    });

    if (!auth.allowed) {
      return auth.denied;
    }

    // `ProjectionDescriptor.requiredPermission` gates reading this
    // projection's snapshot/freshness/RECONCILIATION (see that field's
    // own doc comment, `_shared/module-contract.ts`) — the coarse
    // `reporting.projections.analyze` check above is necessary but not
    // sufficient; a caller must ALSO hold this specific descriptor's own
    // permission (reviewer finding, PR #781 — same fix as the two GET
    // routes).
    if (!isProjectionPermitted(descriptor, auth.grantedPermissionKeys)) {
      return fail(
        403,
        "ACCESS_DENIED",
        `Missing the required permission to reconcile projection "${key}".`
      );
    }

    const result = await reconcileProjection(
      tx,
      tenantId,
      descriptor,
      auth.context.tenantUserId,
      correlationId
    );

    return ok({ reconciliation: result });
  });
};
