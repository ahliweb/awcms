import type { APIRoute } from "astro";

import { hashSessionToken } from "../../../../../lib/auth/session-token";
import { getDatabaseClient } from "../../../../../lib/database/client";
import { withTenant } from "../../../../../lib/database/tenant-context";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../../lib/security/request-body-limit";
import {
  fail,
  jsonResponse,
  ok
} from "../../../../../modules/_shared/api-response";
import {
  computeRequestHash,
  findIdempotencyRecord,
  saveIdempotencyRecord
} from "../../../../../modules/_shared/idempotency";
import {
  fetchCommentSettings,
  updateCommentSettings
} from "../../../../../modules/comments/application/comment-settings-directory";
import {
  COMMENTS_MODULE_KEY,
  COMMENTS_SETTINGS_ACTIVITY_CODE
} from "../../../../../modules/comments/domain/comments-permissions";
import { validateCommentSettings } from "../../../../../modules/comments/domain/comment-settings";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../../modules/identity-access/application/access-guard";
import { recordAuditEvent } from "../../../../../modules/logging/application/audit-log";

/**
 * `GET/PUT /api/v1/comments/admin/settings` — read/update this tenant's comment
 * config (ADR-0041, ported from awcms-micro Issue #271). Update is high-risk (it changes the public
 * comment surface): Idempotency-Key required + audited.
 */
const READ_GUARD = {
  moduleKey: COMMENTS_MODULE_KEY,
  activityCode: COMMENTS_SETTINGS_ACTIVITY_CODE,
  action: "read" as const
};
const UPDATE_GUARD = {
  moduleKey: COMMENTS_MODULE_KEY,
  activityCode: COMMENTS_SETTINGS_ACTIVITY_CODE,
  action: "update" as const
};
const IDEMPOTENCY_SCOPE = "comments_settings_update";

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
    return ok(await fetchCommentSettings(tx, tenantId));
  });
};

export const PUT: APIRoute = async ({ request, cookies, locals }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);
  if (!tenantId)
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  if (!token) return fail(401, "AUTH_REQUIRED", "Authentication required.");

  const idempotencyKey = request.headers.get("idempotency-key");

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

    // Allowed — so the caller is entitled to hear what is actually wrong, and
    // the decision log now carries the row saying they were here.
    if (!idempotencyKey) {
      return fail(
        400,
        "IDEMPOTENCY_REQUIRED",
        "Idempotency-Key header is required."
      );
    }

    const current = await fetchCommentSettings(tx, tenantId);
    const validation = validateCommentSettings(bodyRead.value, current);
    if (!validation.ok) {
      return fail(
        400,
        "VALIDATION_ERROR",
        "Comment settings are invalid.",
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

    const saved = await updateCommentSettings(
      tx,
      tenantId,
      auth.context.tenantUserId,
      next,
      async (auditTx, detail) => {
        await recordAuditEvent(auditTx, {
          tenantId,
          actorTenantUserId: auth.context.tenantUserId,
          moduleKey: COMMENTS_MODULE_KEY,
          action: "comments.settings.update",
          resourceType: "comments_settings",
          resourceId: tenantId,
          severity: "info",
          message: "Tenant comment configuration updated.",
          attributes: {
            policyModeChanged:
              detail.previous.defaultPolicyMode !==
              detail.next.defaultPolicyMode,
            moderationChanged:
              detail.previous.requireModeration !==
              detail.next.requireModeration
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
