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
  fetchMenuItemsForMenus,
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

    // TWO queries for the whole page, whatever the menu count (Issue #721).
    //
    // This was a per-menu `await fetchMenuItems(tx, …)` in a loop — sequential
    // by necessity, since one Postgres connection serves one query at a time
    // and `Promise.all` over a shared `tx` hangs rather than parallelises. So
    // the cost was up to 100 SERIAL round trips, each holding the pooled
    // connection and the work-class slot. Concurrency was never the fix; the
    // fix is one `menu_id = ANY(…)` read grouped in memory.
    //
    // A menu absent from the map has no items — `[]`, never `undefined`: "this
    // menu has no navigation" and "this payload does not carry navigation" are
    // different facts, and a consumer cannot act on the second if it is
    // rendered as the first.
    const itemsByMenu = await fetchMenuItemsForMenus(
      tx,
      tenantId,
      menus.map((menu) => menu.id)
    );

    const withItems = menus.map((menu) => {
      const page = itemsByMenu.get(menu.id);

      return {
        ...menu,
        items: page?.items ?? [],
        // Surfaced rather than swallowed: `PATCH .../menus/{id}` REPLACES the
        // whole item set, so a client that saved back a truncated list would
        // delete what it was never shown.
        itemsTruncated: page?.truncated ?? false
      };
    });

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

    // Always `false` here: what came back is what this request just wrote, and
    // `validateMenuItemsInput` refused anything above `MAX_MENU_ITEMS`. Stated
    // rather than omitted so the field means the same thing on every menu
    // response a client can receive.
    return ok({ ...menu, items, itemsTruncated: false });
  });
};
