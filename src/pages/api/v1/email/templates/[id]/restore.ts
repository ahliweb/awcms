import type { APIRoute } from "astro";

import { fail, ok } from "../../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../../lib/database/client";
import { withTenant } from "../../../../../../lib/database/tenant-context";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../../../modules/identity-access/application/access-guard";
import { hashSessionToken } from "../../../../../../lib/auth/session-token";
import { recordAuditEvent } from "../../../../../../modules/logging/application/audit-log";
import { restoreEmailTemplate } from "../../../../../../modules/email/application/email-template-directory";

const RESTORE_GUARD = {
  moduleKey: "email",
  activityCode: "template",
  action: "restore" as const
};

/** `POST /api/v1/email/templates/{id}/restore` — dedicated `restore` action (Issue #498, same precedent as `POST /profiles/{id}/restore`, Issue 10.1). 404 if the template is not currently soft-deleted. Idempotent-safe: retrying after a successful restore is a 404, not a duplicate restore. */
export const POST: APIRoute = async ({ request, params, cookies, locals }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);
  const templateId = params.id;

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }

  if (!templateId) {
    return fail(400, "VALIDATION_ERROR", "Template id is required.");
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
      RESTORE_GUARD
    );

    if (!auth.allowed) {
      return auth.denied;
    }

    const template = await restoreEmailTemplate(
      tx,
      tenantId,
      auth.context.tenantUserId,
      templateId
    );

    if (!template) {
      return fail(
        404,
        "RESOURCE_NOT_FOUND",
        "Email template not found or not currently soft-deleted."
      );
    }

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "email",
      action: "restore",
      resourceType: "email_template",
      resourceId: templateId,
      severity: "warning",
      message: `Email template restored: ${template.templateKey}.`,
      correlationId
    });

    return ok(template);
  });
};
