import type { APIRoute } from "astro";

import { fail, ok } from "../../../../../modules/_shared/api-response";
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
  fetchActiveEmailTemplate,
  softDeleteEmailTemplate,
  updateEmailTemplate
} from "../../../../../modules/email/application/email-template-directory";
import { validateUpdateEmailTemplateInput } from "../../../../../modules/email/domain/email-template-validation";

const READ_GUARD = {
  moduleKey: "email",
  activityCode: "template",
  action: "read" as const
};

const UPDATE_GUARD = {
  moduleKey: "email",
  activityCode: "template",
  action: "update" as const
};

const DELETE_GUARD = {
  moduleKey: "email",
  activityCode: "template",
  action: "delete" as const
};

/** `GET /api/v1/email/templates/{id}` — read one template (full locale map, for admin editing). */
export const GET: APIRoute = async ({ request, params, cookies }) => {
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

  return withTenant(sql, tenantId, async (tx) => {
    const auth = await authorizeInTransaction(
      tx,
      tenantId,
      tokenHash,
      now,
      READ_GUARD
    );

    if (!auth.allowed) {
      return auth.denied;
    }

    const template = await fetchActiveEmailTemplate(tx, tenantId, templateId);

    if (!template) {
      return fail(404, "RESOURCE_NOT_FOUND", "Email template not found.");
    }

    return ok(template);
  });
};

/** `PATCH /api/v1/email/templates/{id}` — partial update. Idempotent by construction (same body → same end state), no `Idempotency-Key` needed. */
export const PATCH: APIRoute = async ({ request, params, cookies, locals }) => {
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

  const bodyRead = await readJsonBody(request, "large");

  if (bodyRead.tooLarge) {
    return bodyTooLargeResponse(bodyRead.limitBytes);
  }

  const validation = validateUpdateEmailTemplateInput(bodyRead.value);

  if (!validation.valid) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "Email template update is invalid.",
      {},
      validation.errors
    );
  }

  const input = validation.value;
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

    const template = await updateEmailTemplate(
      tx,
      tenantId,
      auth.context.tenantUserId,
      templateId,
      input
    );

    if (!template) {
      return fail(404, "RESOURCE_NOT_FOUND", "Email template not found.");
    }

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "email",
      action: "update",
      resourceType: "email_template",
      resourceId: templateId,
      severity: "info",
      message: `Email template updated: ${template.templateKey}.`,
      correlationId
    });

    return ok(template);
  });
};

/** `DELETE /api/v1/email/templates/{id}` — soft-delete. `reason` required (master/config data, same precedent as `DELETE /api/v1/profiles/{id}` — not scratch state like form-drafts). */
export const DELETE: APIRoute = async ({
  request,
  params,
  cookies,
  locals
}) => {
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

  const bodyRead = await readJsonBody(request);

  if (bodyRead.tooLarge) {
    return bodyTooLargeResponse(bodyRead.limitBytes);
  }

  const body = bodyRead.value;
  const reasonRaw = (body as { reason?: unknown } | null)?.reason;

  if (typeof reasonRaw !== "string" || reasonRaw.trim().length === 0) {
    return fail(400, "VALIDATION_ERROR", "reason is required.");
  }

  const reason = reasonRaw.trim();
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
      DELETE_GUARD
    );

    if (!auth.allowed) {
      return auth.denied;
    }

    const deleted = await softDeleteEmailTemplate(
      tx,
      tenantId,
      auth.context.tenantUserId,
      templateId,
      reason
    );

    if (!deleted) {
      return fail(404, "RESOURCE_NOT_FOUND", "Email template not found.");
    }

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "email",
      action: "delete",
      resourceType: "email_template",
      resourceId: templateId,
      severity: "warning",
      message: "Email template deleted.",
      attributes: { reason },
      correlationId
    });

    return ok({ id: templateId, deleted: true });
  });
};
