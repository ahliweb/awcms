import type { APIRoute } from "astro";

import {
  fail,
  jsonResponse,
  ok
} from "../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../lib/database/client";
import { withTenant } from "../../../../lib/database/tenant-context";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../modules/identity-access/application/access-guard";
import { hashSessionToken } from "../../../../lib/auth/session-token";
import { recordAuditEvent } from "../../../../modules/logging/application/audit-log";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../lib/security/request-body-limit";
import {
  computeRequestHash,
  findIdempotencyRecord,
  saveIdempotencyRecord
} from "../../../../modules/_shared/idempotency";
import { rollbackThemeVersion } from "../../../../modules/theming/application/theme-service";
import {
  THEMING_MODULE_KEY,
  THEMING_VERSION_ACTIVITY_CODE
} from "../../../../modules/theming/domain/theme-permissions";

/**
 * `POST /api/v1/theming/rollback` (Issue #269, ADR-0029 §4/§8) — roll the active
 * theme pointer back to an earlier published version (never mutates a version
 * row; published versions are immutable). The target must be one of THIS tenant's
 * own published version ids. High-risk (changes the live look) → requires an
 * `Idempotency-Key`, ABAC-gated (`theming.version.restore`), tenant-scoped,
 * audited.
 */
const RESTORE_GUARD = {
  moduleKey: THEMING_MODULE_KEY,
  activityCode: THEMING_VERSION_ACTIVITY_CODE,
  action: "restore" as const
};

const IDEMPOTENCY_SCOPE = "theming_version_rollback";

export const POST: APIRoute = async ({ request, cookies, locals }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }
  if (!token) {
    return fail(401, "AUTH_REQUIRED", "Authentication required.");
  }

  const idempotencyKey = request.headers.get("idempotency-key");
  if (!idempotencyKey) {
    return fail(
      400,
      "IDEMPOTENCY_REQUIRED",
      "Idempotency-Key header is required."
    );
  }

  const bodyRead = await readJsonBody(request);
  if (bodyRead.tooLarge) {
    return bodyTooLargeResponse(bodyRead.limitBytes);
  }
  const rawBody = bodyRead.value as { versionId?: unknown } | null;
  const versionId =
    typeof rawBody?.versionId === "string" ? rawBody.versionId : null;
  if (!versionId) {
    return fail(400, "VALIDATION_ERROR", "A versionId string is required.");
  }

  const requestHash = computeRequestHash({ op: "rollback", versionId });
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
      RESTORE_GUARD
    );
    if (!auth.allowed) {
      return auth.denied;
    }

    const existing = await findIdempotencyRecord(
      tx,
      tenantId,
      IDEMPOTENCY_SCOPE,
      idempotencyKey
    );
    if (existing) {
      if (existing.requestHash !== requestHash) {
        return fail(
          409,
          "IDEMPOTENCY_CONFLICT",
          "Idempotency-Key was already used with a different request."
        );
      }
      return jsonResponse(existing.responseBody, {
        status: existing.responseStatus
      });
    }

    const result = await rollbackThemeVersion(
      tx,
      tenantId,
      auth.context.tenantUserId,
      versionId,
      async (auditTx, detail) => {
        await recordAuditEvent(auditTx, {
          tenantId,
          actorTenantUserId: auth.context.tenantUserId,
          moduleKey: THEMING_MODULE_KEY,
          action: detail.action,
          resourceType: detail.resourceType,
          resourceId: detail.resourceId,
          severity: "info",
          message: "Theme rolled back to an earlier published version.",
          attributes: detail.attributes,
          correlationId
        });
      }
    );

    if (!result.ok) {
      return fail(404, "INVALID_TARGET", result.message);
    }

    const response = ok({
      versionId: result.version.id,
      themeKey: result.version.themeKey,
      versionNumber: result.version.versionNumber
    });
    const body = await response.clone().json();
    await saveIdempotencyRecord(
      tx,
      tenantId,
      IDEMPOTENCY_SCOPE,
      idempotencyKey,
      requestHash,
      200,
      body
    );
    return response;
  });
};
