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
  createEmailTemplate,
  listEmailTemplates
} from "../../../../../modules/email/application/email-template-directory";
import { validateCreateEmailTemplateInput } from "../../../../../modules/email/domain/email-template-validation";

const READ_GUARD = {
  moduleKey: "email",
  activityCode: "template",
  action: "read" as const
};

const CREATE_GUARD = {
  moduleKey: "email",
  activityCode: "template",
  action: "create" as const
};

/** `GET /api/v1/email/templates` — list tenant templates (non-deleted, active by default, limit 100, newest first). `?includeInactive=true` also returns inactive templates. */
export const GET: APIRoute = async ({ request, cookies, url }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }

  if (!token) {
    return fail(401, "AUTH_REQUIRED", "Authentication required.");
  }

  const includeInactive = url.searchParams.get("includeInactive") === "true";
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

    const templates = await listEmailTemplates(tx, tenantId, {
      includeInactive
    });

    return ok({ templates });
  });
};

/** `POST /api/v1/email/templates` — create a template. Not idempotent (no `Idempotency-Key`) — a network retry duplicating a template create is caught by the `(tenant_id, template_key)` partial unique index (409-equivalent DB error), not silently duplicated data. */
export const POST: APIRoute = async ({ request, cookies, locals }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }

  if (!token) {
    return fail(401, "AUTH_REQUIRED", "Authentication required.");
  }

  const bodyRead = await readJsonBody(request, "large");

  if (bodyRead.tooLarge) {
    return bodyTooLargeResponse(bodyRead.limitBytes);
  }

  const validation = validateCreateEmailTemplateInput(bodyRead.value);

  if (!validation.valid) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "Email template is invalid.",
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
      CREATE_GUARD
    );

    if (!auth.allowed) {
      return auth.denied;
    }

    let template;

    try {
      template = await createEmailTemplate(
        tx,
        tenantId,
        auth.context.tenantUserId,
        input
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (message.includes("awcms_email_templates_tenant_key_idx")) {
        return fail(
          409,
          "TEMPLATE_KEY_CONFLICT",
          `An active template already exists for templateKey "${input.templateKey}".`
        );
      }

      throw error;
    }

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "email",
      action: "create",
      resourceType: "email_template",
      resourceId: template.id,
      severity: "info",
      message: `Email template created: ${template.templateKey}.`,
      correlationId
    });

    return ok(template);
  });
};
