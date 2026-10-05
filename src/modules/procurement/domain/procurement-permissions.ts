/**
 * `procurement` access guard definitions (Issue #888, ADR-0128).
 *
 * Every handler passes one of these to `authorizeInTransaction` (through
 * `defineTenantRoute`'s `authorize`) — the ADR-0063 per-handler chokepoint.
 * Written as LITERAL objects, not built from constants, because
 * `access:permissions:enforcement:check` recognises a guard by seeing
 * `moduleKey`, `activityCode` and `action` together as string literals in one
 * object.
 *
 * `finalise`, `reverse`, `cancel` and `reveal` are HIGH-RISK actions
 * (`identity-access/domain/access-control.ts`).
 */
export const PROCUREMENT_MODULE_KEY = "procurement";

export const PROCUREMENT_GUARDS = {
  suppliers: {
    read: {
      moduleKey: "procurement",
      activityCode: "suppliers",
      action: "read" as const
    },
    create: {
      moduleKey: "procurement",
      activityCode: "suppliers",
      action: "create" as const
    },
    update: {
      moduleKey: "procurement",
      activityCode: "suppliers",
      action: "update" as const
    },
    delete: {
      moduleKey: "procurement",
      activityCode: "suppliers",
      action: "delete" as const
    },
    restore: {
      moduleKey: "procurement",
      activityCode: "suppliers",
      action: "restore" as const
    },
    reveal: {
      moduleKey: "procurement",
      activityCode: "suppliers",
      action: "reveal" as const
    }
  },
  documents: {
    read: {
      moduleKey: "procurement",
      activityCode: "documents",
      action: "read" as const
    },
    create: {
      moduleKey: "procurement",
      activityCode: "documents",
      action: "create" as const
    },
    update: {
      moduleKey: "procurement",
      activityCode: "documents",
      action: "update" as const
    },
    submit: {
      moduleKey: "procurement",
      activityCode: "documents",
      action: "submit" as const
    },
    finalise: {
      moduleKey: "procurement",
      activityCode: "documents",
      action: "finalise" as const
    },
    cancel: {
      moduleKey: "procurement",
      activityCode: "documents",
      action: "cancel" as const
    },
    reverse: {
      moduleKey: "procurement",
      activityCode: "documents",
      action: "reverse" as const
    },
    reconcile: {
      moduleKey: "procurement",
      activityCode: "documents",
      action: "reconcile" as const
    }
  },
  policy: {
    read: {
      moduleKey: "procurement",
      activityCode: "policy",
      action: "read" as const
    },
    configure: {
      moduleKey: "procurement",
      activityCode: "policy",
      action: "configure" as const
    }
  },
  reports: {
    read: {
      moduleKey: "procurement",
      activityCode: "reports",
      action: "read" as const
    }
  }
} as const;
