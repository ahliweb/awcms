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
  computeRequestHash,
  findIdempotencyRecord,
  saveIdempotencyRecord
} from "../../../../modules/_shared/idempotency";
import { retireActiveTheme } from "../../../../modules/theming/application/theme-service";
import {
  THEMING_MODULE_KEY,
  THEMING_VERSION_ACTIVITY_CODE
} from "../../../../modules/theming/domain/theme-permissions";

/**
 * `POST /api/v1/theming/retire` (Issue #269, ADR-0029 §4/§8) — retire the active
 * theme: clear the active pointer so the site falls back to the default theme.
 * Published versions stay intact (history/rollback). High-risk (changes the live
 * look) → requires an `Idempotency-Key`, ABAC-gated (`theming.version.archive`),
 * tenant-scoped, audited.
 */
const ARCHIVE_GUARD = {
  moduleKey: THEMING_MODULE_KEY,
  activityCode: THEMING_VERSION_ACTIVITY_CODE,
  action: "archive" as const
};

const IDEMPOTENCY_SCOPE = "theming_version_retire";

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

  const requestHash = computeRequestHash({ op: "retire" });
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
      ARCHIVE_GUARD
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

    const result = await retireActiveTheme(
      tx,
      tenantId,
      auth.context.tenantUserId,
      async (auditTx, detail) => {
        await recordAuditEvent(auditTx, {
          tenantId,
          actorTenantUserId: auth.context.tenantUserId,
          moduleKey: THEMING_MODULE_KEY,
          action: detail.action,
          resourceType: detail.resourceType,
          resourceId: detail.resourceId,
          severity: "info",
          message:
            "Active theme retired (site falls back to the default theme).",
          attributes: detail.attributes,
          correlationId
        });
      }
    );

    const response = ok({ previousThemeKey: result.previousThemeKey });
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
