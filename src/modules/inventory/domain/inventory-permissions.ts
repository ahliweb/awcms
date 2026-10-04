/**
 * `inventory` access guard definitions (Issue #887, ADR-0126).
 *
 * Every handler passes one of these to `authorizeInTransaction` (through
 * `defineTenantRoute`'s `authorize`) — the ADR-0063 per-handler chokepoint.
 * They are written as LITERAL objects, not built from constants, because
 * `access:permissions:enforcement:check` recognises a guard by seeing
 * `moduleKey`, `activityCode` and `action` together as string literals in one
 * object; a guard assembled at runtime would be invisible to it and the
 * permission would be reported as seeded-but-unenforced.
 *
 * `adjust` and `transfer` are HIGH-RISK actions (`identity-access/domain/
 * access-control.ts`): they change stock without a business document behind
 * them, or change two balances at once.
 */
export const INVENTORY_MODULE_KEY = "inventory";

export const INVENTORY_GUARDS = {
  locations: {
    read: {
      moduleKey: "inventory",
      activityCode: "locations",
      action: "read" as const
    },
    create: {
      moduleKey: "inventory",
      activityCode: "locations",
      action: "create" as const
    },
    update: {
      moduleKey: "inventory",
      activityCode: "locations",
      action: "update" as const
    }
  },
  policy: {
    read: {
      moduleKey: "inventory",
      activityCode: "policy",
      action: "read" as const
    },
    configure: {
      moduleKey: "inventory",
      activityCode: "policy",
      action: "configure" as const
    }
  },
  balances: {
    read: {
      moduleKey: "inventory",
      activityCode: "balances",
      action: "read" as const
    },
    reconcile: {
      moduleKey: "inventory",
      activityCode: "balances",
      action: "reconcile" as const
    },
    rebuild: {
      moduleKey: "inventory",
      activityCode: "balances",
      action: "rebuild" as const
    }
  },
  movements: {
    read: {
      moduleKey: "inventory",
      activityCode: "movements",
      action: "read" as const
    },
    create: {
      moduleKey: "inventory",
      activityCode: "movements",
      action: "create" as const
    },
    adjust: {
      moduleKey: "inventory",
      activityCode: "movements",
      action: "adjust" as const
    },
    transfer: {
      moduleKey: "inventory",
      activityCode: "movements",
      action: "transfer" as const
    }
  }
} as const;
