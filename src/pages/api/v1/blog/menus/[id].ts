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
  fetchMenuById,
  fetchMenuItems,
  softDeleteMenu,
  syncMenuItems,
  updateMenu
} from "../../../../../modules/blog-content/application/menu-directory";
import { validateDeleteReasonInput } from "../../../../../modules/blog-content/domain/content-validation";
import {
  validateMenuItemsInput,
  type MenuItemInput
} from "../../../../../modules/blog-content/domain/menu-policy";

const CONFIGURE_GUARD = {
  moduleKey: "blog_content",
  activityCode: "menus",
  action: "configure" as const
};

/** `PATCH /api/v1/blog/menus/{id}` (Issue #542). `name` and/or `items` (full replace) may be sent independently. */
export const PATCH: APIRoute = async ({ request, params, cookies, locals }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);
  const id = params.id;

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }

  if (!id) {
    return fail(400, "VALIDATION_ERROR", "Menu id is required.");
  }

  if (!token) {
    return fail(401, "AUTH_REQUIRED", "Authentication required.");
  }

  const bodyRead = await readJsonBody<Record<string, unknown>>(request);

  if (bodyRead.tooLarge) {
    return bodyTooLargeResponse(bodyRead.limitBytes);
  }

  const body = bodyRead.value;
  const record = body ?? {};

  if (
    record.name !== undefined &&
    (typeof record.name !== "string" || record.name.trim().length === 0)
  ) {
    return fail(400, "VALIDATION_ERROR", "name must be a non-empty string.");
  }

  let items: MenuItemInput[] | undefined;

  if (record.items !== undefined) {
    const itemsResult = validateMenuItemsInput(record.items);

    if (!itemsResult.valid) {
      return fail(
        400,
        "VALIDATION_ERROR",
        "Menu items are invalid.",
        {},
        itemsResult.errors
      );
    }

    items = itemsResult.value;
  }

  const name = typeof record.name === "string" ? record.name.trim() : undefined;
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

    const updated = await updateMenu(tx, tenantId, id, name);

    if (!updated) {
      return fail(404, "RESOURCE_NOT_FOUND", "Menu not found.");
    }

    const currentItems = items
      ? await syncMenuItems(tx, tenantId, id, items)
      : await fetchMenuItems(tx, tenantId, id);

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "blog_content",
      action: "blog.menu.updated",
      resourceType: "blog_menu",
      resourceId: id,
      severity: "info",
      message: `Blog menu updated: ${updated.key}.`,
      correlationId
    });

    log("info", "blog-content.menu.updated", {
      correlationId,
      tenantId,
      moduleKey: "blog_content",
      menuId: id,
      key: updated.key
    });

    return ok({ ...updated, items: currentItems });
  });
};

/** `DELETE /api/v1/blog/menus/{id}` (Issue #542) — soft-delete. `reason` required, same convention as posts/pages/terms/templates. Menu items stay in place (no FK to worry about — RLS scopes them, and a soft-deleted menu's items are simply unreachable through the menu list). */
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
    return fail(400, "VALIDATION_ERROR", "Menu id is required.");
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

    const existing = await fetchMenuById(tx, tenantId, id);

    if (!existing) {
      return fail(404, "RESOURCE_NOT_FOUND", "Menu not found.");
    }

    await softDeleteMenu(tx, tenantId, auth.context.tenantUserId, id, reason);

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "blog_content",
      action: "blog.menu.deleted",
      resourceType: "blog_menu",
      resourceId: id,
      severity: "warning",
      message: "Blog menu deleted.",
      attributes: { reason },
      correlationId
    });

    log("info", "blog-content.menu.deleted", {
      correlationId,
      tenantId,
      moduleKey: "blog_content",
      menuId: id
    });

    return ok({ id, deleted: true });
  });
};
