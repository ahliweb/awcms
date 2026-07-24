import type { APIRoute } from "astro";

import {
  fail,
  jsonResponse,
  ok
} from "../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../lib/database/client";
import { withTenant } from "../../../../../lib/database/tenant-context";
import { hashSessionToken } from "../../../../../lib/auth/session-token";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../../lib/security/request-body-limit";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../../modules/identity-access/application/access-guard";
import { recordAuditEvent } from "../../../../../modules/logging/application/audit-log";
import {
  computeRequestHash,
  findIdempotencyRecord,
  saveIdempotencyRecord
} from "../../../../../modules/_shared/idempotency";
import {
  fetchRedirectSettings,
  updateRedirectSettings
} from "../../../../../modules/seo-distribution/application/redirect-settings-directory";
import { validateRedirectSettings } from "../../../../../modules/seo-distribution/domain/redirect-settings";
import {
  SEO_MODULE_KEY,
  SEO_REDIRECT_ACTIVITY_CODE
} from "../../../../../modules/seo-distribution/domain/seo-permissions";

/**
 * `GET`/`PUT /api/v1/seo/redirects/settings` (ADR-0039) — this tenant's redirect
 * governance policy: the legacy-blog auto-redirect toggle (INERT in awcms) and the
 * default URL-change auto-capture policy. `PUT` is high-risk (the legacy-blog toggle
 * changes public routing), so it requires an `Idempotency-Key` and is audited. ABAC:
 * `redirect.read` / `redirect.update`.
 */

const READ_GUARD = {
  moduleKey: SEO_MODULE_KEY,
  activityCode: SEO_REDIRECT_ACTIVITY_CODE,
  action: "read" as const
};
const UPDATE_GUARD = {
  moduleKey: SEO_MODULE_KEY,
  activityCode: SEO_REDIRECT_ACTIVITY_CODE,
  action: "update" as const
};
const IDEMPOTENCY_SCOPE = "seo_distribution_redirect_settings_update";

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

    return ok(await fetchRedirectSettings(tx, tenantId));
  });
};

export const PUT: APIRoute = async ({ request, cookies, locals }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);
  if (!tenantId)
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  if (!token) return fail(401, "AUTH_REQUIRED", "Authentication required.");

  const idempotencyKey = request.headers.get("idempotency-key");
  if (!idempotencyKey) {
    return fail(
      400,
      "IDEMPOTENCY_REQUIRED",
      "Idempotency-Key header is required."
    );
  }

  const bodyRead = await readJsonBody(request);
  if (bodyRead.tooLarge) return bodyTooLargeResponse(bodyRead.limitBytes);

  const validation = validateRedirectSettings(bodyRead.value);
  if (!validation.ok) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "Redirect settings are invalid.",
      {},
      validation.errors
    );
  }

  const next = validation.value;
  const requestHash = computeRequestHash(next);
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

    const saved = await updateRedirectSettings(
      tx,
      tenantId,
      auth.context.tenantUserId,
      next,
      async (auditTx, detail) => {
        await recordAuditEvent(auditTx, {
          tenantId,
          actorTenantUserId: auth.context.tenantUserId,
          moduleKey: SEO_MODULE_KEY,
          action: "seo_distribution.redirect.settings_updated",
          resourceType: "seo_redirect_settings",
          resourceId: tenantId,
          severity: "info",
          message: "Redirect governance policy updated.",
          attributes: {
            legacyBlogRedirectEnabledChanged:
              detail.previous.legacyBlogRedirectEnabled !==
              detail.next.legacyBlogRedirectEnabled,
            legacyBlogRedirectEnabled: detail.next.legacyBlogRedirectEnabled,
            urlChangeAutoPolicy: detail.next.urlChangeAutoPolicy
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
