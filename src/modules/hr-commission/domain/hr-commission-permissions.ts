/**
 * `hr_commission` access guard definitions (Issue #950, ADR-0132).
 *
 * Every handler passes one of these to `authorizeInTransaction` (through
 * `defineTenantRoute`'s `authorize`) — the ADR-0063 per-handler chokepoint.
 * Written as LITERAL objects, not built from constants, because
 * `access:permissions:enforcement:check` recognises a guard by seeing
 * `moduleKey`, `activityCode` and `action` together as string literals in one
 * object.
 *
 * `publish`, `retire`, and (accruals) `approve`, `release`, `cancel`, `pay` are
 * HIGH-RISK actions (`identity-access/domain/access-control.ts`).
 */
export const HR_COMMISSION_MODULE_KEY = "hr_commission";

export const HR_COMMISSION_GUARDS = {
  rules: {
    read: {
      moduleKey: "hr_commission",
      activityCode: "rules",
      action: "read" as const
    },
    create: {
      moduleKey: "hr_commission",
      activityCode: "rules",
      action: "create" as const
    },
    update: {
      moduleKey: "hr_commission",
      activityCode: "rules",
      action: "update" as const
    },
    publish: {
      moduleKey: "hr_commission",
      activityCode: "rules",
      action: "publish" as const
    },
    retire: {
      moduleKey: "hr_commission",
      activityCode: "rules",
      action: "retire" as const
    }
  },
  accruals: {
    read: {
      moduleKey: "hr_commission",
      activityCode: "accruals",
      action: "read" as const
    },
    accrue: {
      moduleKey: "hr_commission",
      activityCode: "accruals",
      action: "accrue" as const
    },
    approve: {
      moduleKey: "hr_commission",
      activityCode: "accruals",
      action: "approve" as const
    },
    release: {
      moduleKey: "hr_commission",
      activityCode: "accruals",
      action: "release" as const
    },
    cancel: {
      moduleKey: "hr_commission",
      activityCode: "accruals",
      action: "cancel" as const
    },
    pay: {
      moduleKey: "hr_commission",
      activityCode: "accruals",
      action: "pay" as const
    }
  },
  myAccruals: {
    read: {
      moduleKey: "hr_commission",
      activityCode: "my_accruals",
      action: "read" as const
    }
  }
} as const;
