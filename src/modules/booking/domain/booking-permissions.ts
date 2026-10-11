/**
 * `booking` access guard definitions (Issue #937, ADR-0131).
 *
 * Every handler (added from Issue #938) passes one of these to
 * `authorizeInTransaction` (through `defineTenantRoute`'s `authorize`) -- the
 * ADR-0063 per-handler chokepoint. Written as LITERAL objects, not built from
 * constants, because `access:permissions:enforcement:check` recognises a guard
 * by seeing `moduleKey`, `activityCode` and `action` together as string literals
 * in one object.
 *
 * `override` is the HIGH-RISK action (it lifts a business rule); the transition
 * verbs `confirm`, `reschedule`, `check_in`, `complete` and `no_show` are not:
 * each is reversible by cancel or compensated by an event.
 */
export const BOOKING_MODULE_KEY = "booking";

export const BOOKING_GUARDS = {
  resources: {
    read: {
      moduleKey: "booking",
      activityCode: "resources",
      action: "read" as const
    },
    create: {
      moduleKey: "booking",
      activityCode: "resources",
      action: "create" as const
    },
    update: {
      moduleKey: "booking",
      activityCode: "resources",
      action: "update" as const
    },
    delete: {
      moduleKey: "booking",
      activityCode: "resources",
      action: "delete" as const
    },
    restore: {
      moduleKey: "booking",
      activityCode: "resources",
      action: "restore" as const
    }
  },
  offerings: {
    read: {
      moduleKey: "booking",
      activityCode: "offerings",
      action: "read" as const
    },
    create: {
      moduleKey: "booking",
      activityCode: "offerings",
      action: "create" as const
    },
    update: {
      moduleKey: "booking",
      activityCode: "offerings",
      action: "update" as const
    },
    delete: {
      moduleKey: "booking",
      activityCode: "offerings",
      action: "delete" as const
    },
    restore: {
      moduleKey: "booking",
      activityCode: "offerings",
      action: "restore" as const
    }
  },
  schedules: {
    read: {
      moduleKey: "booking",
      activityCode: "schedules",
      action: "read" as const
    },
    create: {
      moduleKey: "booking",
      activityCode: "schedules",
      action: "create" as const
    },
    update: {
      moduleKey: "booking",
      activityCode: "schedules",
      action: "update" as const
    },
    delete: {
      moduleKey: "booking",
      activityCode: "schedules",
      action: "delete" as const
    }
  },
  blocks: {
    read: {
      moduleKey: "booking",
      activityCode: "blocks",
      action: "read" as const
    },
    create: {
      moduleKey: "booking",
      activityCode: "blocks",
      action: "create" as const
    },
    release: {
      moduleKey: "booking",
      activityCode: "blocks",
      action: "release" as const
    }
  },
  availability: {
    read: {
      moduleKey: "booking",
      activityCode: "availability",
      action: "read" as const
    }
  },
  reservations: {
    read: {
      moduleKey: "booking",
      activityCode: "reservations",
      action: "read" as const
    },
    create: {
      moduleKey: "booking",
      activityCode: "reservations",
      action: "create" as const
    },
    confirm: {
      moduleKey: "booking",
      activityCode: "reservations",
      action: "confirm" as const
    },
    cancel: {
      moduleKey: "booking",
      activityCode: "reservations",
      action: "cancel" as const
    },
    reschedule: {
      moduleKey: "booking",
      activityCode: "reservations",
      action: "reschedule" as const
    },
    checkIn: {
      moduleKey: "booking",
      activityCode: "reservations",
      action: "check_in" as const
    },
    complete: {
      moduleKey: "booking",
      activityCode: "reservations",
      action: "complete" as const
    },
    noShow: {
      moduleKey: "booking",
      activityCode: "reservations",
      action: "no_show" as const
    },
    override: {
      moduleKey: "booking",
      activityCode: "reservations",
      action: "override" as const
    },
    reconcile: {
      moduleKey: "booking",
      activityCode: "reservations",
      action: "reconcile" as const
    }
  },
  reservationNotes: {
    read: {
      moduleKey: "booking",
      activityCode: "reservation_notes",
      action: "read" as const
    }
  },
  policy: {
    read: {
      moduleKey: "booking",
      activityCode: "policy",
      action: "read" as const
    },
    configure: {
      moduleKey: "booking",
      activityCode: "policy",
      action: "configure" as const
    }
  },
  reports: {
    read: {
      moduleKey: "booking",
      activityCode: "reports",
      action: "read" as const
    }
  }
} as const;
