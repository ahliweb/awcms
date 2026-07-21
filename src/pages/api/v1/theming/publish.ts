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
import { publishThemeDraft } from "../../../../modules/theming/application/theme-service";
import {
  THEMING_MODULE_KEY,
  THEMING_VERSION_ACTIVITY_CODE
} from "../../../../modules/theming/domain/theme-permissions";

/**
 * `POST /api/v1/theming/publish` (Issue #269, ADR-0029 §4/§8) — publish this
 * tenant's current draft as a new IMMUTABLE version and make it the live look.
 * INSERT-only (never mutates a published row; the sql/085 trigger backstops it).
 * High-risk (changes the public presentation surface) → requires an
 * `Idempotency-Key`, ABAC-gated (`theming.version.publish`), tenant-scoped,
 * audited.
 */
const PUBLISH_GUARD = {
  moduleKey: THEMING_MODULE_KEY,
  activityCode: THEMING_VERSION_ACTIVITY_CODE,
  action: "publish" as const
};

const IDEMPOTENCY_SCOPE = "theming_version_publish";

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

  const requestHash = computeRequestHash({ op: "publish" });
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
      PUBLISH_GUARD
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

    const result = await publishThemeDraft(
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
          message: "Theme version published.",
          attributes: detail.attributes,
          correlationId
        });
      }
    );

    if (!result.ok) {
      return fail(400, "NO_DRAFT", result.message);
    }

    const response = ok({
      versionId: result.version.id,
      themeKey: result.version.themeKey,
      versionNumber: result.version.versionNumber,
      configHash: result.version.configHash,
      publishedAt: result.version.publishedAt
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
