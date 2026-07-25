import type { APIRoute } from "astro";

import { hashSessionToken } from "../../../../lib/auth/session-token";
import { getDatabaseClient } from "../../../../lib/database/client";
import { withTenant } from "../../../../lib/database/tenant-context";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../lib/security/request-body-limit";
import {
  fail,
  jsonResponse,
  ok
} from "../../../../modules/_shared/api-response";
import {
  computeRequestHash,
  findIdempotencyRecord,
  saveIdempotencyRecord
} from "../../../../modules/_shared/idempotency";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../modules/identity-access/application/access-guard";
import { recordAuditEvent } from "../../../../modules/logging/application/audit-log";
import {
  fetchSiteSearchSettings,
  updateSiteSearchSettings
} from "../../../../modules/site-search/application/search-settings-directory";
import { validateSiteSearchSettings } from "../../../../modules/site-search/domain/search-settings";
import {
  SITE_SEARCH_MODULE_KEY,
  SITE_SEARCH_SETTINGS_ACTIVITY_CODE
} from "../../../../modules/site-search/domain/site-search-permissions";

const READ_GUARD = {
  moduleKey: SITE_SEARCH_MODULE_KEY,
  activityCode: SITE_SEARCH_SETTINGS_ACTIVITY_CODE,
  action: "read" as const
};
const UPDATE_GUARD = {
  moduleKey: SITE_SEARCH_MODULE_KEY,
  activityCode: SITE_SEARCH_SETTINGS_ACTIVITY_CODE,
  action: "update" as const
};
const IDEMPOTENCY_SCOPE = "site_search_settings_update";

/** `GET /api/v1/site-search/settings` — read this tenant's search config. */
export const GET: APIRoute = async ({ request, cookies }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);
  if (!tenantId)
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  if (!token) return fail(401, "AUTH_REQUIRED", "Authentication required.");

  const sql = getDatabaseClient();
  const tokenHash = hashSessionToken(token);
  const now = new Date();

  return withTenant(sql, tenantId, async (tx) => {
    const auth = await authorizeInTransaction(
      tx,
      tenantId,
      tokenHash,
      now,
      READ_GUARD
    );
    if (!auth.allowed) return auth.denied;
    const settings = await fetchSiteSearchSettings(tx, tenantId);
    return ok(settings);
  });
};

/** `PUT /api/v1/site-search/settings` — update this tenant's search config (idempotency-keyed, audited). */
export const PUT: APIRoute = async ({ request, cookies, locals }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);
  if (!tenantId)
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  if (!token) return fail(401, "AUTH_REQUIRED", "Authentication required.");

  const idempotencyKey = request.headers.get("idempotency-key");
  if (!idempotencyKey)
    return fail(
      400,
      "IDEMPOTENCY_REQUIRED",
      "Idempotency-Key header is required."
    );

  const bodyRead = await readJsonBody(request);
  if (bodyRead.tooLarge) return bodyTooLargeResponse(bodyRead.limitBytes);

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
    if (!auth.allowed) return auth.denied;

    const current = await fetchSiteSearchSettings(tx, tenantId);
    const validation = validateSiteSearchSettings(bodyRead.value, current);
    if (!validation.ok) {
      return fail(
        400,
        "VALIDATION_ERROR",
        "Search settings are invalid.",
        {},
        validation.errors
      );
    }
    const next = validation.value;
    const requestHash = computeRequestHash(next);

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

    const saved = await updateSiteSearchSettings(
      tx,
      tenantId,
      auth.context.tenantUserId,
      next,
      async (auditTx, detail) => {
        await recordAuditEvent(auditTx, {
          tenantId,
          actorTenantUserId: auth.context.tenantUserId,
          moduleKey: SITE_SEARCH_MODULE_KEY,
          action: "site_search.settings.update",
          resourceType: "site_search_settings",
          resourceId: tenantId,
          severity: "info",
          message: "Tenant search configuration updated.",
          attributes: {
            enabledChanged: detail.previous.enabled !== detail.next.enabled,
            analyticsChanged:
              detail.previous.analyticsEnabled !== detail.next.analyticsEnabled
          },
          correlationId
        });
      }
    );

    const successResponse = ok(saved);
    const successBody = await successResponse.clone().json();
    await saveIdempotencyRecord(
      tx,
      tenantId,
      IDEMPOTENCY_SCOPE,
      idempotencyKey,
      requestHash,
      200,
      successBody
    );
    return successResponse;
  });
};
