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
 * `delete`, `restore`, `assign`, `configure`, `publish`, `cancel` and `approve` are HIGH-RISK actions
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
  shifts: {
    read: {
      moduleKey: "hr_workforce",
      activityCode: "shifts",
      action: "read" as const
    },
    create: {
      moduleKey: "hr_workforce",
      activityCode: "shifts",
      action: "create" as const
    },
    publish: {
      moduleKey: "hr_workforce",
      activityCode: "shifts",
      action: "publish" as const
    },
    cancel: {
      moduleKey: "hr_workforce",
      activityCode: "shifts",
      action: "cancel" as const
    }
  },
  templates: {
    read: {
      moduleKey: "hr_workforce",
      activityCode: "templates",
      action: "read" as const
    },
    create: {
      moduleKey: "hr_workforce",
      activityCode: "templates",
      action: "create" as const
    },
    update: {
      moduleKey: "hr_workforce",
      activityCode: "templates",
      action: "update" as const
    },
    delete: {
      moduleKey: "hr_workforce",
      activityCode: "templates",
      action: "delete" as const
    }
  },
  clock: {
    create: {
      moduleKey: "hr_workforce",
      activityCode: "clock",
      action: "create" as const
    }
  },
  attendance: {
    read: {
      moduleKey: "hr_workforce",
      activityCode: "attendance",
      action: "read" as const
    },
    create: {
      moduleKey: "hr_workforce",
      activityCode: "attendance",
      action: "create" as const
    }
  },
  corrections: {
    read: {
      moduleKey: "hr_workforce",
      activityCode: "corrections",
      action: "read" as const
    },
    create: {
      moduleKey: "hr_workforce",
      activityCode: "corrections",
      action: "create" as const
    },
    cancel: {
      moduleKey: "hr_workforce",
      activityCode: "corrections",
      action: "cancel" as const
    },
    approve: {
      moduleKey: "hr_workforce",
      activityCode: "corrections",
      action: "approve" as const
    }
  },
  workforceMetrics: {
    read: {
      moduleKey: "hr_workforce",
      activityCode: "workforce_metrics",
      action: "read" as const
    },
    analyze: {
      moduleKey: "hr_workforce",
      activityCode: "workforce_metrics",
      action: "analyze" as const
    }
  },
  attendanceEvidence: {
    read: {
      moduleKey: "hr_workforce",
      activityCode: "attendance_evidence",
      action: "read" as const
    }
  },
  geolocationEvidence: {
    configure: {
      moduleKey: "hr_workforce",
      activityCode: "geolocation_evidence",
      action: "configure" as const
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
