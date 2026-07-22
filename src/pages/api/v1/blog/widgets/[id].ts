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
import { log } from "../../../../../lib/logging/logger";
import { recordAuditEvent } from "../../../../../modules/logging/application/audit-log";
import {
  fetchWidgetById,
  softDeleteWidget,
  updateWidget
} from "../../../../../modules/blog-content/application/widget-directory";
import { validateDeleteReasonInput } from "../../../../../modules/blog-content/domain/content-validation";
import { validateUpdateWidgetInput } from "../../../../../modules/blog-content/domain/widget-policy";

const CONFIGURE_GUARD = {
  moduleKey: "blog_content",
  activityCode: "widgets",
  action: "configure" as const
};

/** `PATCH /api/v1/blog/widgets/{id}` (Issue #542). */
export const PATCH: APIRoute = async ({ request, params, cookies, locals }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);
  const id = params.id;

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }

  if (!id) {
    return fail(400, "VALIDATION_ERROR", "Widget id is required.");
  }

  if (!token) {
    return fail(401, "AUTH_REQUIRED", "Authentication required.");
  }

  const bodyRead = await readJsonBody(request);

  if (bodyRead.tooLarge) {
    return bodyTooLargeResponse(bodyRead.limitBytes);
  }

  const validation = validateUpdateWidgetInput(bodyRead.value);

  if (!validation.valid) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "Widget update is invalid.",
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
      CONFIGURE_GUARD
    );

    if (!auth.allowed) {
      return auth.denied;
    }

    const updated = await updateWidget(tx, tenantId, id, input);

    if (!updated) {
      return fail(404, "RESOURCE_NOT_FOUND", "Widget not found.");
    }

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "blog_content",
      action: "blog.widget.updated",
      resourceType: "blog_widget",
      resourceId: id,
      severity: "info",
      message: `Blog widget updated: ${updated.title}.`,
      correlationId
    });

    log("info", "blog-content.widget.updated", {
      correlationId,
      tenantId,
      moduleKey: "blog_content",
      widgetId: id,
      position: updated.position
    });

    return ok(updated);
  });
};

/** `DELETE /api/v1/blog/widgets/{id}` (Issue #542) — soft-delete. `reason` required. */
export const DELETE: APIRoute = async ({
  request,
  params,
  cookies,
  locals
}) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);
  const id = params.id;

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }

  if (!id) {
    return fail(400, "VALIDATION_ERROR", "Widget id is required.");
  }

  if (!token) {
    return fail(401, "AUTH_REQUIRED", "Authentication required.");
  }

  const bodyRead = await readJsonBody(request);

  if (bodyRead.tooLarge) {
    return bodyTooLargeResponse(bodyRead.limitBytes);
  }

  const validation = validateDeleteReasonInput(bodyRead.value);

  if (!validation.valid) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "reason is required.",
      {},
      validation.errors
    );
  }

  const { reason } = validation.value;
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
      CONFIGURE_GUARD
    );

    if (!auth.allowed) {
      return auth.denied;
    }

    const existing = await fetchWidgetById(tx, tenantId, id);

    if (!existing) {
      return fail(404, "RESOURCE_NOT_FOUND", "Widget not found.");
    }

    await softDeleteWidget(tx, tenantId, auth.context.tenantUserId, id, reason);

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "blog_content",
      action: "blog.widget.deleted",
      resourceType: "blog_widget",
      resourceId: id,
      severity: "warning",
      message: "Blog widget deleted.",
      attributes: { reason },
      correlationId
    });

    log("info", "blog-content.widget.deleted", {
      correlationId,
      tenantId,
      moduleKey: "blog_content",
      widgetId: id
    });

    return ok({ id, deleted: true });
  });
};
