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
import { validateThemeConfig } from "../../../../modules/theming/domain/theme-config";
import { getThemeDescriptor } from "../../../../modules/theming/theme-registry";
import { saveThemeDraft } from "../../../../modules/theming/application/theme-service";
import {
  THEMING_CONFIG_ACTIVITY_CODE,
  THEMING_MODULE_KEY
} from "../../../../modules/theming/domain/theme-permissions";

/**
 * `PUT /api/v1/theming/draft` (Issue #269, ADR-0029 §4) — save/replace this
 * tenant's single draft theme config (chosen theme + bounded, validated design
 * tokens, slot variants, media asset ids, section order, nav placement). The
 * config body is validated against the chosen theme descriptor
 * (`validateThemeConfig` — the CSS-injection spine + declared-surface bounding)
 * BEFORE any DB work. High-risk (the draft is what publish promotes) → requires an
 * `Idempotency-Key`, ABAC-gated (`theming.config.update`), tenant-scoped, audited.
 */
const UPDATE_GUARD = {
  moduleKey: THEMING_MODULE_KEY,
  activityCode: THEMING_CONFIG_ACTIVITY_CODE,
  action: "update" as const
};

const IDEMPOTENCY_SCOPE = "theming_draft_update";

export const PUT: APIRoute = async ({ request, cookies, locals }) => {
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

  const rawBody = bodyRead.value as { themeKey?: unknown } | null;
  const themeKey =
    typeof rawBody?.themeKey === "string" ? rawBody.themeKey : null;
  if (!themeKey) {
    return fail(400, "VALIDATION_ERROR", "A themeKey string is required.");
  }
  const descriptor = getThemeDescriptor(themeKey);
  if (!descriptor) {
    return fail(
      400,
      "UNKNOWN_THEME",
      `Theme "${themeKey}" is not a registered theme.`
    );
  }

  const validation = validateThemeConfig(descriptor, bodyRead.value);
  if (!validation.ok) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "Theme config is invalid.",
      {},
      validation.errors
    );
  }

  const config = validation.value;
  const requestHash = computeRequestHash({ themeKey, config });
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
      UPDATE_GUARD
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

    const draft = await saveThemeDraft(
      tx,
      tenantId,
      auth.context.tenantUserId,
      descriptor,
      config,
      async (auditTx, detail) => {
        await recordAuditEvent(auditTx, {
          tenantId,
          actorTenantUserId: auth.context.tenantUserId,
          moduleKey: THEMING_MODULE_KEY,
          action: detail.action,
          resourceType: detail.resourceType,
          resourceId: detail.resourceId,
          severity: "info",
          message: "Theme draft config saved.",
          attributes: detail.attributes,
          correlationId
        });
      }
    );

    const response = ok({
      versionId: draft.id,
      themeKey: draft.themeKey,
      config: draft.config,
      configHash: draft.configHash
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
