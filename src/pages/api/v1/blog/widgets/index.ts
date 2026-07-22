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
  createWidget,
  listWidgets
} from "../../../../../modules/blog-content/application/widget-directory";
import { validateCreateWidgetInput } from "../../../../../modules/blog-content/domain/widget-policy";
import { isWidgetPosition } from "../../../../../modules/blog-content/domain/widget-policy";

const READ_GUARD = {
  moduleKey: "blog_content",
  activityCode: "widgets",
  action: "read" as const
};

const CONFIGURE_GUARD = {
  moduleKey: "blog_content",
  activityCode: "widgets",
  action: "configure" as const
};

/** `GET /api/v1/blog/widgets` (Issue #542) — list this tenant's non-deleted widgets, `?position=` optional filter. */
export const GET: APIRoute = async ({ request, cookies, url }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }

  if (!token) {
    return fail(401, "AUTH_REQUIRED", "Authentication required.");
  }

  const positionParam = url.searchParams.get("position");

  if (positionParam !== null && !isWidgetPosition(positionParam)) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "position must be one of header, sidebar, footer, content_before, content_after."
    );
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

    const widgets = await listWidgets(tx, tenantId, {
      position: positionParam ?? undefined
    });

    return ok({ widgets });
  });
};

/** `POST /api/v1/blog/widgets` (Issue #542) — create a widget. Not idempotent. */
export const POST: APIRoute = async ({ request, cookies, locals }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }

  if (!token) {
    return fail(401, "AUTH_REQUIRED", "Authentication required.");
  }

  const bodyRead = await readJsonBody(request);

  if (bodyRead.tooLarge) {
    return bodyTooLargeResponse(bodyRead.limitBytes);
  }

  const validation = validateCreateWidgetInput(bodyRead.value);

  if (!validation.valid) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "Widget is invalid.",
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

    const widget = await createWidget(tx, tenantId, input);

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "blog_content",
      action: "blog.widget.created",
      resourceType: "blog_widget",
      resourceId: widget.id,
      severity: "info",
      message: `Blog widget created: ${widget.title}.`,
      correlationId
    });

    log("info", "blog-content.widget.created", {
      correlationId,
      tenantId,
      moduleKey: "blog_content",
      widgetId: widget.id,
      position: widget.position
    });

    return ok(widget);
  });
};
