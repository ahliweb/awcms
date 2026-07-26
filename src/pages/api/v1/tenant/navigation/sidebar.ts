import { fail, ok } from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../../lib/security/request-body-limit";
import {
  buildSidebarEditorModel,
  fetchSidebarArrangement,
  resetSidebarArrangement,
  saveSidebarArrangement
} from "../../../../../modules/module-management/application/sidebar-menu-config";
import {
  validateSidebarArrangement,
  type SidebarArrangement
} from "../../../../../modules/module-management/domain/sidebar-menu";
import { recordAuditEvent } from "../../../../../modules/logging/application/audit-log";

/**
 * `/api/v1/tenant/navigation/sidebar` — read, replace or reset this tenant's
 * admin sidebar arrangement (Issue #260).
 *
 * The item SET is never in the request. A save carries only overrides keyed by
 * `entryKey`, and `applySidebarOverrides` resolves every one of them against
 * the code-derived default, ignoring anything that does not match. There is no
 * path from a request body to a new menu link.
 *
 * GET reuses the pre-existing `navigation.read`; the mutations need
 * `navigation.configure`, seeded by `sql/072`.
 */

/** Narrow an untrusted body into the arrangement shape, dropping anything unrecognised. */
function parseArrangement(value: unknown): SidebarArrangement | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const raw = value as { types?: unknown; items?: unknown };

  if (!Array.isArray(raw.types) || !Array.isArray(raw.items)) {
    return null;
  }

  const types = raw.types.map((entry) => {
    const row = (entry ?? {}) as Record<string, unknown>;

    return {
      typeKey: String(row.typeKey ?? ""),
      labelOverride:
        typeof row.labelOverride === "string" ? row.labelOverride : null,
      position: Number.isFinite(row.position) ? Number(row.position) : 0,
      hidden: row.hidden === true
    };
  });

  const items = raw.items.map((entry) => {
    const row = (entry ?? {}) as Record<string, unknown>;

    return {
      entryKey: String(row.entryKey ?? ""),
      typeKey: typeof row.typeKey === "string" ? row.typeKey : null,
      position: Number.isFinite(row.position) ? Number(row.position) : 0,
      labelOverride:
        typeof row.labelOverride === "string" ? row.labelOverride : null,
      hidden: row.hidden === true
    };
  });

  return { types, items };
}

export const GET = defineTenantRoute({
  workClass: "interactive",
  authorize: {
    moduleKey: "module_management",
    activityCode: "navigation",
    action: "read"
  },
  handler: async ({ tx, tenantId }) =>
    ok(buildSidebarEditorModel(await fetchSidebarArrangement(tx, tenantId)))
});

export const PUT = defineTenantRoute<
  { arrangement: SidebarArrangement } | Response
>({
  workClass: "interactive",
  // Body parsing and validation happen BEFORE a connection is taken, so a
  // malformed payload costs no pool slot.
  prepare: async ({ request }) => {
    const bodyRead = await readJsonBody(request);

    if (bodyRead.tooLarge) {
      return bodyTooLargeResponse(bodyRead.limitBytes);
    }

    const arrangement = parseArrangement(bodyRead.value);

    if (!arrangement) {
      return fail(
        400,
        "VALIDATION_ERROR",
        "Body must be an object with `types` and `items` arrays."
      );
    }

    const issues = validateSidebarArrangement(arrangement);

    if (issues.length > 0) {
      return fail(
        400,
        "VALIDATION_ERROR",
        "Sidebar arrangement is invalid.",
        {},
        issues
      );
    }

    return { arrangement };
  },
  authorize: {
    moduleKey: "module_management",
    activityCode: "navigation",
    action: "configure"
  },
  handler: async ({ tx, tenantId, auth, locals, prepared }) => {
    const { arrangement } = prepared as { arrangement: SidebarArrangement };

    await saveSidebarArrangement(tx, tenantId, arrangement);
    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "module_management",
      action: "sidebar_arrangement_saved",
      resourceType: "sidebar_menu",
      resourceId: "sidebar",
      correlationId: locals.correlationId,
      message: `Saved sidebar arrangement (${arrangement.types.length} type override(s), ${arrangement.items.length} item override(s)).`,
      attributes: {
        typeCount: arrangement.types.length,
        itemCount: arrangement.items.length,
        hiddenItems: arrangement.items.filter((item) => item.hidden).length
      }
    });

    return ok(buildSidebarEditorModel(arrangement));
  }
});

export const DELETE = defineTenantRoute({
  workClass: "interactive",
  authorize: {
    moduleKey: "module_management",
    activityCode: "navigation",
    action: "configure"
  },
  handler: async ({ tx, tenantId, auth, locals }) => {
    await resetSidebarArrangement(tx, tenantId);
    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "module_management",
      action: "sidebar_arrangement_reset",
      resourceType: "sidebar_menu",
      resourceId: "sidebar",
      correlationId: locals.correlationId,
      message: "Reset sidebar arrangement to the code default."
    });

    return ok(buildSidebarEditorModel({ types: [], items: [] }));
  }
});
