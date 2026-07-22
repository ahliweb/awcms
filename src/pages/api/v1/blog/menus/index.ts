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
  createMenu,
  fetchMenuItems,
  listMenus,
  syncMenuItems
} from "../../../../../modules/blog-content/application/menu-directory";
import { validateMenuItemsInput } from "../../../../../modules/blog-content/domain/menu-policy";
import { isValidSlug } from "../../../../../modules/blog-content/domain/slug-policy";

const READ_GUARD = {
  moduleKey: "blog_content",
  activityCode: "menus",
  action: "read" as const
};

const CONFIGURE_GUARD = {
  moduleKey: "blog_content",
  activityCode: "menus",
  action: "configure" as const
};

/** `GET /api/v1/blog/menus` (Issue #542) — list this tenant's non-deleted menus (without items; fetch `GET .../menus/{id}` equivalent via items endpoint is folded into list for now, see doc below). */
export const GET: APIRoute = async ({ request, cookies }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
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

    const menus = await listMenus(tx, tenantId);

    // Sequential loop, NOT `Promise.all(menus.map(async …))` — every iteration
    // issues a query on the SAME transaction/connection (`tx`), and one Postgres
    // connection serves one query at a time; running them concurrently produced
    // a real hang in this repo (see
    // `reporting/application/projection-reconciliation.ts:89-94`). This fan-out
    // was also UNBOUNDED — one concurrent query per menu the tenant has.
    const withItems: Array<
      (typeof menus)[number] & {
        items: Awaited<ReturnType<typeof fetchMenuItems>>;
      }
    > = [];

    for (const menu of menus) {
      withItems.push({
        ...menu,
        items: await fetchMenuItems(tx, tenantId, menu.id)
      });
    }

    return ok({ menus: withItems });
  });
};

/** `POST /api/v1/blog/menus` (Issue #542) — create a menu, optionally with its initial `items` tree. Not idempotent — a retry duplicating a create is caught by the `(tenant_id, key)` partial unique index. */
export const POST: APIRoute = async ({ request, cookies, locals }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
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
    typeof record.key !== "string" ||
    !isValidSlug(record.key.trim()) ||
    typeof record.name !== "string" ||
    record.name.trim().length === 0
  ) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "key (slug format) and name are required."
    );
  }

  const itemsInput = record.items ?? [];
  const itemsResult = validateMenuItemsInput(itemsInput);

  if (!itemsResult.valid) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "Menu items are invalid.",
      {},
      itemsResult.errors
    );
  }

  const key = record.key.trim();
  const name = record.name.trim();
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

    let menu;

    try {
      menu = await createMenu(tx, tenantId, key, name);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (message.includes("awcms_blog_menus_key_dedup")) {
        return fail(
          409,
          "KEY_CONFLICT",
          `A menu already exists for key "${key}".`
        );
      }

      throw error;
    }

    const items = await syncMenuItems(tx, tenantId, menu.id, itemsResult.value);

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "blog_content",
      action: "blog.menu.created",
      resourceType: "blog_menu",
      resourceId: menu.id,
      severity: "info",
      message: `Blog menu created: ${menu.key}.`,
      correlationId
    });

    log("info", "blog-content.menu.created", {
      correlationId,
      tenantId,
      moduleKey: "blog_content",
      menuId: menu.id,
      key: menu.key
    });

    return ok({ ...menu, items });
  });
};
