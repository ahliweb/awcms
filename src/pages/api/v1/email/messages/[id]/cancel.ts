import type { APIRoute } from "astro";

import { fail, ok } from "../../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../../lib/database/client";
import { withTenant } from "../../../../../../lib/database/tenant-context";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../../../modules/identity-access/application/access-guard";
import { hashSessionToken } from "../../../../../../lib/auth/session-token";
import { log } from "../../../../../../lib/logging/logger";
import { recordAuditEvent } from "../../../../../../modules/logging/application/audit-log";
import { cancelEmailMessage } from "../../../../../../modules/email/application/email-message-directory";

const CANCEL_GUARD = {
  moduleKey: "email",
  activityCode: "message",
  action: "cancel" as const
};

/**
 * `POST /api/v1/email/messages/{id}/cancel` (Issue #499) — the technical
 * mitigation behind doc's "accidental bulk send" incident-response note: an
 * operator can stop a still-queued message (`queued`/`retry_wait`) before
 * the dispatcher claims it. A message already `sending`/`sent`/`failed`/
 * `cancelled`/`suppressed` reports `409 NOT_CANCELLABLE` rather than a
 * silent no-op, so an operator racing the dispatcher gets an honest answer.
 */
export const POST: APIRoute = async ({ request, params, cookies, locals }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);
  const messageId = params.id;

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }

  if (!messageId) {
    return fail(400, "VALIDATION_ERROR", "Message id is required.");
  }

  if (!token) {
    return fail(401, "AUTH_REQUIRED", "Authentication required.");
  }

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
      CANCEL_GUARD
    );

    if (!auth.allowed) {
      return auth.denied;
    }

    const result = await cancelEmailMessage(tx, tenantId, messageId);

    if (result.outcome === "not_found") {
      return fail(404, "RESOURCE_NOT_FOUND", "Email message not found.");
    }

    if (result.outcome === "not_cancellable") {
      return fail(
        409,
        "NOT_CANCELLABLE",
        `Message is "${result.currentStatus}" and can no longer be cancelled.`
      );
    }

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "email",
      action: "message_cancelled",
      resourceType: "email_message",
      resourceId: messageId,
      severity: "warning",
      message: `Email message cancelled: ${result.entry.category}.`,
      attributes: { category: result.entry.category },
      correlationId
    });

    log("info", "email.message.cancelled", {
      correlationId: result.entry.correlationId ?? correlationId,
      tenantId,
      moduleKey: "email",
      category: result.entry.category
    });

    return ok(result.entry);
  });
};
