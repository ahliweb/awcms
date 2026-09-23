/**
 * OMES Control Center access guard definitions (ADR-0122, Issue ahliweb/omes#196).
 *
 * Defines the typed authorization request descriptors for all omes_control permissions
 * to be consumed by route handlers, admin screens, and worker dispatch chokepoints.
 */
export const OMES_GUARDS = {
  servers: {
    read: {
      moduleKey: "omes_control",
      activityCode: "servers",
      action: "read" as const
    },
    register: {
      moduleKey: "omes_control",
      activityCode: "servers",
      action: "register" as const
    },
    delete: {
      moduleKey: "omes_control",
      activityCode: "servers",
      action: "delete" as const
    }
  },
  deployments: {
    read: {
      moduleKey: "omes_control",
      activityCode: "deployments",
      action: "read" as const
    },
    operate: {
      moduleKey: "omes_control",
      activityCode: "deployments",
      action: "operate" as const
    }
  },
  jobs: {
    read: {
      moduleKey: "omes_control",
      activityCode: "jobs",
      action: "read" as const
    },
    approve: {
      moduleKey: "omes_control",
      activityCode: "jobs",
      action: "approve" as const
    },
    cancel: {
      moduleKey: "omes_control",
      activityCode: "jobs",
      action: "cancel" as const
    }
  },
  backups: {
    read: {
      moduleKey: "omes_control",
      activityCode: "backups",
      action: "read" as const
    },
    restore: {
      moduleKey: "omes_control",
      activityCode: "backups",
      action: "restore" as const
    },
    rollback: {
      moduleKey: "omes_control",
      activityCode: "backups",
      action: "rollback" as const
    }
  },
  audit: {
    read: {
      moduleKey: "omes_control",
      activityCode: "audit",
      action: "read" as const
    }
  },
  enrollments: {
    manage: {
      moduleKey: "omes_control",
      activityCode: "enrollments",
      action: "manage" as const
    }
  }
} as const;
