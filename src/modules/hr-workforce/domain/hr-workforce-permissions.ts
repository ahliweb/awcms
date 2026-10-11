/**
 * `hr_workforce` access guard definitions (Issue #945, ADR-0132).
 *
 * Every handler passes one of these to `authorizeInTransaction` (through
 * `defineTenantRoute`'s `authorize`) — the ADR-0063 per-handler chokepoint.
 * Written as LITERAL objects, not built from constants, because
 * `access:permissions:enforcement:check` recognises a guard by seeing
 * `moduleKey`, `activityCode` and `action` together as string literals in one
 * object.
 *
 * `delete`, `restore`, `assign` and `configure` are HIGH-RISK actions
 * (`identity-access/domain/access-control.ts`).
 */
export const HR_WORKFORCE_MODULE_KEY = "hr_workforce";

export const HR_WORKFORCE_GUARDS = {
  employments: {
    read: {
      moduleKey: "hr_workforce",
      activityCode: "employments",
      action: "read" as const
    },
    create: {
      moduleKey: "hr_workforce",
      activityCode: "employments",
      action: "create" as const
    },
    update: {
      moduleKey: "hr_workforce",
      activityCode: "employments",
      action: "update" as const
    },
    delete: {
      moduleKey: "hr_workforce",
      activityCode: "employments",
      action: "delete" as const
    },
    restore: {
      moduleKey: "hr_workforce",
      activityCode: "employments",
      action: "restore" as const
    },
    assign: {
      moduleKey: "hr_workforce",
      activityCode: "employments",
      action: "assign" as const
    }
  },
  settings: {
    read: {
      moduleKey: "hr_workforce",
      activityCode: "settings",
      action: "read" as const
    },
    configure: {
      moduleKey: "hr_workforce",
      activityCode: "settings",
      action: "configure" as const
    }
  }
} as const;
