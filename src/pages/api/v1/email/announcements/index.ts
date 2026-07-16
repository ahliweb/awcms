import type { APIRoute } from "astro";

import {
  fail,
  jsonResponse,
  ok
} from "../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../lib/database/client";
import { withTenant } from "../../../../../lib/database/tenant-context";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../../modules/identity-access/application/access-guard";
import { hashSessionToken } from "../../../../../lib/auth/session-token";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../../lib/security/request-body-limit";
import { recordAuditEvent } from "../../../../../modules/logging/application/audit-log";
import {
  computeRequestHash,
  findIdempotencyRecord,
  saveIdempotencyRecord
} from "../../../../../modules/_shared/idempotency";
import { enqueueAnnouncement } from "../../../../../modules/email/application/announcement-directory";
import { validateAnnouncementInput } from "../../../../../modules/email/domain/announcement-validation";

const NOTIFICATION_GUARD = {
  moduleKey: "email",
  activityCode: "notification",
  action: "create" as const
};

const ANNOUNCEMENT_GUARD = {
  moduleKey: "email",
  activityCode: "announcement",
  action: "create" as const
};

const IDEMPOTENCY_SCOPE = "email_announcement_create";

/**
 * `POST /api/v1/email/announcements` — enqueue a notification/announcement
 * to an explicit user list, a role, or the whole tenant. High-risk
 * (bulk-capable) mutation: always requires `Idempotency-Key` (doc 10
 * §Idempotency wrapper rules), same replay/conflict shape as
 * `workflows/tasks/{id}/decisions.ts`.
 *
 * Two-tier ABAC (Issue #497 §Access control — "Bulk announcement should
 * require stronger permission than ordinary notification enqueue"):
 * `email.notification.create` is required for every request;
 * `email.announcement.create` is ADDITIONALLY required when
 * `target.type` is `"role"` or `"tenant"` (unbounded) — a role granted
 * only the base permission can message specific users it already knows
 * about, but cannot blast an entire role/tenant.
 */
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

  const bodyRead = await readJsonBody(request, "large");

  if (bodyRead.tooLarge) {
    return bodyTooLargeResponse(bodyRead.limitBytes);
  }

  const validation = validateAnnouncementInput(bodyRead.value);

  if (!validation.valid) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "Announcement request is invalid.",
      {},
      validation.errors
    );
  }

  const input = validation.value;
  const isBulk = input.target.type === "role" || input.target.type === "tenant";
  const requestHash = computeRequestHash(input);
  const sql = getDatabaseClient();
  const tokenHash = hashSessionToken(token);
  const now = new Date();
  const correlationId = locals.correlationId ?? crypto.randomUUID();

  return withTenant(sql, tenantId, async (tx) => {
    const auth = await authorizeInTransaction(
      tx,
      tenantId,
      tokenHash,
      now,
      NOTIFICATION_GUARD
    );

    if (!auth.allowed) {
      return auth.denied;
    }

    if (isBulk) {
      const bulkAuth = await authorizeInTransaction(
        tx,
        tenantId,
        tokenHash,
        now,
        ANNOUNCEMENT_GUARD
      );

      if (!bulkAuth.allowed) {
        return bulkAuth.denied;
      }
    }

    const existingIdempotency = await findIdempotencyRecord(
      tx,
      tenantId,
      IDEMPOTENCY_SCOPE,
      idempotencyKey
    );

    if (existingIdempotency) {
      if (existingIdempotency.requestHash !== requestHash) {
        return fail(
          409,
          "IDEMPOTENCY_CONFLICT",
          "Idempotency-Key was already used with a different request."
        );
      }

      return jsonResponse(existingIdempotency.responseBody, {
        status: existingIdempotency.responseStatus
      });
    }

    const result = await enqueueAnnouncement(
      tx,
      tenantId,
      input.templateKey,
      input.variables,
      input.target,
      correlationId,
      input.locale
    );

    if (!result) {
      return fail(
        404,
        "TEMPLATE_NOT_FOUND",
        `No active template found for templateKey "${input.templateKey}".`
      );
    }

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "email",
      action: "announcement_sent",
      resourceType: "email_announcement",
      severity: isBulk ? "warning" : "info",
      message: `Announcement enqueued: ${input.templateKey} to ${result.recipientCount} recipient(s).`,
      attributes: {
        targetType: input.target.type,
        templateKey: input.templateKey,
        recipientCount: result.recipientCount,
        correlationId: result.correlationId,
        dispatchStatus: "queued"
      },
      correlationId
    });

    const responseBody = ok({
      recipientCount: result.recipientCount,
      correlationId: result.correlationId
    });
    const responseJson = await responseBody.clone().json();

    await saveIdempotencyRecord(
      tx,
      tenantId,
      IDEMPOTENCY_SCOPE,
      idempotencyKey,
      requestHash,
      200,
      responseJson
    );

    return responseBody;
  });
};
