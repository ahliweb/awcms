/**
 * `booking` -- resources, capacity units, schedules and reservations (Issue #937,
 * ADR-0131 as amended by ADR-0135; docs/awcms/booking.md).
 *
 * A generic module for ANYTHING that rents out time, space or capacity: a room,
 * a treatment chair, a court, a loan car, a nightly stay. It is a claim on a
 * limited resource for an interval that two customers cannot both win, with the
 * double-booking guarantee held by the DATABASE (two partial GiST exclusion
 * constraints on `awcms_booking_resource_allocations`, `sql/180`), a reservation
 * state machine enforced by trigger, and an append-only transition history.
 *
 * ## This is the FOUNDATION slice only
 *
 * What exists: the descriptor, the schema (`sql/180`), the permission catalogue
 * (`sql/181`), the PURE reservation state machine
 * (`domain/booking-reservation-state.ts`), the guard literals and the audit
 * event names. What does NOT exist yet, deliberately: the allocator, availability
 * search, any HTTP route, OpenAPI path, AsyncAPI channel, admin screen or
 * reporting projection (Issues #938 to #941). The module therefore ships
 * `experimental`, declares no `navigation`, and no route reaches its tables: it
 * is the "feature flag off" the issue asks for -- a status ADR-0021 allows
 * without an admin screen, and the one a later PR flips to `active` together
 * with its first screen.
 *
 * ## No money, no product, no customer name
 *
 * No table of this module stores a price, deposit, balance, payment state,
 * product id or customer name (booking.md section 10.2). The customer is the
 * opaque `external_customer_ref` -- commerce is the authority -- and an adapter
 * records its own order in the opaque `external_ref_type` / `external_ref` pair.
 *
 * ## Dependencies
 *
 * `tenant_admin` (the tenant and its users, composite-FK targets),
 * `identity_access` (default-deny authorization) and `logging` (audit). It does
 * NOT depend on `commerce` or any ERP module: a commerce adapter calls the
 * booking port, never the reverse (`bun run modules:dag:check`).
 */
import {
  defineModule,
  type HighVolumeTableDescriptor,
  type SubjectDataDescriptor
} from "../_shared/module-contract";
import { BOOKING_MODULE_KEY } from "./domain/booking-permissions";

/**
 * A `delegated` descriptor for a table nothing purges, so each table answers the
 * retention question on the record instead of by silence (the shape `inventory`
 * and `procurement` set). An age-based purge would be wrong for every table
 * here: reservations, items, allocations and events are the operational record
 * of what capacity was claimed, and the rest is live configuration.
 */
function retained(input: {
  key: string;
  tableName: string;
  retentionClass: "system_event" | "financial_tax";
  why: string;
  deletionWhy: string;
  indexColumns: string[];
  indexPurpose: string;
}): HighVolumeTableDescriptor {
  return {
    key: input.key,
    tableName: input.tableName,
    ownerModuleKey: BOOKING_MODULE_KEY,
    scope: "tenant",
    cursorColumn: "created_at",
    retentionClass: input.retentionClass,
    retentionMinDays: 365,
    retentionMaxDays: 3650,
    defaultRetentionDays: 1095,
    partition: { eligible: false, rationale: input.why },
    archive: {
      archivable: false,
      rationale:
        "No archive step exists or is warranted: the table is the operational record of a capacity claim, or live configuration."
    },
    // `status_transition_then_purge`, not `hard_delete`: the database REFUSES
    // DELETE on these tables (trigger and revoked privilege), so a descriptor
    // claiming a hard delete would be false. The lifecycle is a status (cancel,
    // release, soft-delete, deactivate); NO purge exists yet, so nothing is
    // removed today, and a future purge must be a reviewed privileged job.
    deletion: {
      mode: "status_transition_then_purge",
      rationale: input.deletionWhy
    },
    legalHold: { applicable: false, precedence: "not_applicable" },
    requiredIndexes: [
      { columns: input.indexColumns, purpose: input.indexPurpose }
    ],
    batchLimit: 5000,
    backupRestoreNotes:
      "Included in ordinary full-database backup/restore. After a restore, nothing needs rebuilding: allocations are facts, and the exclusion constraints re-validate on load.",
    executionMode: "delegated",
    existingAdopter: {
      purgeFunctionRef:
        "none -- retained for the life of the tenant; see ADR-0131",
      description:
        "There is deliberately no purge mechanism (none exists yet; the retention days are the intended ceiling, not an executed schedule); this descriptor exists so the table answers the retention question on the record rather than by silence."
    }
  };
}

/**
 * Tenant-user stamps only (`created_by`, `updated_by`, ...): the table says
 * nothing ABOUT a person, so anonymising the identity makes every stamp resolve
 * to nobody (`severed_with_subject_row`, ADR-0094).
 */
function stamps(input: {
  key: string;
  tableName: string;
  columns: string[];
  rationale: string;
}): SubjectDataDescriptor {
  return {
    key: `booking.${input.key}`,
    tableName: input.tableName,
    ownerModuleKey: BOOKING_MODULE_KEY,
    subjectColumns: input.columns.map((column) => ({
      column,
      references: "tenant_user" as const
    })),
    exportable: false,
    erasure: "severed_with_subject_row",
    rationale: input.rationale
  };
}

export const bookingModule = defineModule({
  key: BOOKING_MODULE_KEY,
  name: "Booking",
  version: "0.1.0",
  // `experimental` is the feature flag: the module has no admin screen until
  // Issues #939 to #941 (Issue #938 added the availability read and the schedule
  // routes), and ADR-0021's "every ACTIVE module declares a screen" would be
  // false the other way round.
  status: "experimental",
  description:
    "Generic resources, capacity units, schedules and reservations (Issue #937, ADR-0131, ADR-0135) for anything that rents out time, space or capacity, including nightly stays. Foundation slice: the schema with RLS FORCE and composite tenant foreign keys, two exclusion constraints that make double-booking unrepresentable, a reservation state machine enforced by trigger, an append-only transition history, the permission catalogue and the pure state-machine function. Availability slice (Issue #938): schedules, closures and exceptions, pure slot and stay availability with explicit timezone and interval semantics, blocked nights, and the tenant-scoped availability read. No allocator yet. Holds no price, payment state, product id or customer name.",
  dependencies: ["tenant_admin", "identity_access", "logging"],
  api: {
    openApiPath: "openapi/modules/booking.openapi.yaml",
    basePath: "/api/v1/booking"
  },
  permissions: [
    {
      activityCode: "resources",
      action: "read",
      description: "Read resources, their capacity units and resource pools"
    },
    {
      activityCode: "resources",
      action: "create",
      description:
        "Create a resource (and its capacity units) or a resource pool"
    },
    {
      activityCode: "resources",
      action: "update",
      description: "Edit a resource, its units or a resource pool"
    },
    {
      activityCode: "resources",
      action: "delete",
      description:
        "Soft-delete a resource or a resource pool (reservations keep referencing it)"
    },
    {
      activityCode: "resources",
      action: "restore",
      description: "Restore a soft-deleted resource or resource pool"
    },
    {
      activityCode: "offerings",
      action: "read",
      description: "Read service offerings"
    },
    {
      activityCode: "offerings",
      action: "create",
      description: "Create a service offering"
    },
    {
      activityCode: "offerings",
      action: "update",
      description: "Edit a service offering"
    },
    {
      activityCode: "offerings",
      action: "delete",
      description:
        "Soft-delete a service offering (reservations keep their snapshot)"
    },
    {
      activityCode: "offerings",
      action: "restore",
      description: "Restore a soft-deleted service offering"
    },
    {
      activityCode: "schedules",
      action: "read",
      description: "Read schedules and schedule exceptions"
    },
    {
      activityCode: "schedules",
      action: "create",
      description: "Create a schedule or a schedule exception"
    },
    {
      activityCode: "schedules",
      action: "update",
      description: "Edit a schedule or a schedule exception"
    },
    {
      activityCode: "schedules",
      action: "delete",
      description: "Delete a schedule exception or deactivate a schedule"
    },
    {
      activityCode: "blocks",
      action: "read",
      description: "Read blocked nights of stay resources"
    },
    {
      activityCode: "blocks",
      action: "create",
      description: "Block nights of a stay resource; removes sellable inventory"
    },
    {
      activityCode: "blocks",
      action: "release",
      description: "Release a block and return its nights to sale"
    },
    {
      activityCode: "availability",
      action: "read",
      description:
        "Search availability and quote a slot or stay; persists nothing"
    },
    {
      activityCode: "reservations",
      action: "read",
      description:
        "Read reservations, items, allocations and the transition history (the customer note excluded)"
    },
    {
      activityCode: "reservation_notes",
      action: "read",
      description: "Read the redacted customer note of a reservation; audited"
    },
    {
      activityCode: "reservations",
      action: "create",
      description: "Place a hold or create a reservation"
    },
    {
      activityCode: "reservations",
      action: "confirm",
      description: "Confirm a held reservation"
    },
    {
      activityCode: "reservations",
      action: "cancel",
      description:
        "Cancel a held or confirmed reservation and release its allocations"
    },
    {
      activityCode: "reservations",
      action: "reschedule",
      description:
        "Reschedule a confirmed reservation into a new one, preserving the lineage"
    },
    {
      activityCode: "reservations",
      action: "check_in",
      description: "Mark a confirmed reservation as checked in"
    },
    {
      activityCode: "reservations",
      action: "complete",
      description: "Mark a checked-in reservation as completed"
    },
    {
      activityCode: "reservations",
      action: "no_show",
      description:
        "Mark a confirmed reservation as a no-show after its start plus the grace period"
    },
    {
      activityCode: "reservations",
      action: "override",
      description:
        "Book or reschedule outside schedule hours or lead time; never overrides an allocation conflict; high-risk"
    },
    {
      activityCode: "reservations",
      action: "reconcile",
      description:
        "Run the read-only reconciliation of reservations against their allocations"
    },
    {
      activityCode: "policy",
      action: "read",
      description: "Read the hold, lead-time, horizon and no-show-grace policy"
    },
    {
      activityCode: "policy",
      action: "configure",
      description:
        "Change the hold, lead-time, horizon and no-show-grace policy"
    },
    {
      activityCode: "reports",
      action: "read",
      description: "Read occupancy, utilization and reservation aggregates"
    }
  ],
  dataLifecycle: [
    retained({
      key: "booking.settings",
      tableName: "awcms_booking_settings",
      retentionClass: "system_event",
      why: "One row per tenant, upserted; an age-based purge would silently reset the tenant's hold, lead-time and horizon policy.",
      deletionWhy:
        "Not performed. The row is the tenant's policy; deleting it would silently restore the module defaults.",
      indexColumns: ["tenant_id"],
      indexPurpose: "Primary key (tenant_id), sql/180."
    }),
    retained({
      key: "booking.resource_pools",
      tableName: "awcms_booking_resource_pools",
      retentionClass: "system_event",
      why: "Authored by an administrator; the ceiling is the number of pools a tenant defines.",
      deletionWhy:
        "Not performed. Resources reference a pool by composite FK; a pool is soft-deleted, never removed.",
      indexColumns: ["tenant_id", "created_by"],
      indexPurpose:
        "awcms_booking_resource_pools_created_by_idx (sql/180) leads with tenant_id; nothing scans this table by age."
    }),
    retained({
      key: "booking.resources",
      tableName: "awcms_booking_resources",
      retentionClass: "system_event",
      why: "Authored by an administrator; the ceiling is the number of rooms, chairs or courts a tenant rents out.",
      deletionWhy:
        "Not performed. Reservations and allocations reference a resource by composite FK; it is soft-deleted, never removed, and awcms_app is denied DELETE.",
      indexColumns: ["tenant_id", "sort_order", "id"],
      indexPurpose:
        "awcms_booking_resources_list_idx (sql/180) -- the ordered listing."
    }),
    retained({
      key: "booking.resource_units",
      tableName: "awcms_booking_resource_units",
      retentionClass: "system_event",
      why: "Exactly `capacity` rows per resource (at most 500), created with the resource. A unit is the anchor of the exclusion constraints.",
      deletionWhy:
        "Not performed. A unit is deactivated, never removed: live allocations reference it, and awcms_app is denied DELETE.",
      indexColumns: ["tenant_id", "resource_id", "id"],
      indexPurpose: "awcms_booking_resource_units_resource_id_key (sql/180)."
    }),
    retained({
      key: "booking.service_offerings",
      tableName: "awcms_booking_service_offerings",
      retentionClass: "system_event",
      why: "Authored by an administrator; the ceiling is the number of services a tenant sells.",
      deletionWhy:
        "Not performed. Reservation items keep their own snapshot, but an offering is soft-deleted, never removed.",
      indexColumns: ["tenant_id", "created_by"],
      indexPurpose:
        "awcms_booking_service_offerings_created_by_idx (sql/180) leads with tenant_id; nothing scans this table by age."
    }),
    retained({
      key: "booking.schedules",
      tableName: "awcms_booking_schedules",
      retentionClass: "system_event",
      why: "Authored by an administrator; a new effective window supersedes rather than edits, so the ceiling is windows per resource over time.",
      deletionWhy:
        "Not performed. A schedule is deactivated, never removed; confirmed reservations are facts that do not depend on it.",
      indexColumns: ["tenant_id", "resource_id", "effective_from"],
      indexPurpose: "awcms_booking_schedules_resource_idx (sql/180)."
    }),
    retained({
      key: "booking.schedule_exceptions",
      tableName: "awcms_booking_schedule_exceptions",
      retentionClass: "system_event",
      why: "Authored by an administrator: closed days and override hours, bounded by the calendar a tenant maintains.",
      deletionWhy:
        "Not performed by a purge; an exception is deleted deliberately and audited (configuration with no history value).",
      indexColumns: ["tenant_id", "created_by"],
      indexPurpose:
        "awcms_booking_schedule_exceptions_created_by_idx (sql/180) leads with tenant_id; nothing scans this table by age."
    }),
    retained({
      key: "booking.resource_blocks",
      tableName: "awcms_booking_resource_blocks",
      retentionClass: "system_event",
      why: "Authored by an administrator; the ceiling is the number of maintenance or owner-use ranges a tenant blocks out, not traffic.",
      deletionWhy:
        "Not performed. A block is released (status), never removed: awcms_app is denied DELETE and a trigger rejects it.",
      indexColumns: ["tenant_id", "resource_id", "block_from"],
      indexPurpose: "awcms_booking_resource_blocks_resource_idx (sql/186)."
    }),
    retained({
      key: "booking.reservations",
      tableName: "awcms_booking_reservations",
      retentionClass: "system_event",
      why: "One row per reservation, authored by people or an adapter, never by traffic; the ceiling is the number of bookings a tenant takes. Rows are the operational record of what was claimed.",
      deletionWhy:
        "Not performed and not permitted: awcms_app is denied DELETE and a trigger rejects it. A reservation is cancelled or completed, never removed.",
      indexColumns: ["tenant_id", "created_at"],
      indexPurpose:
        "awcms_booking_reservations_list_idx (sql/180) -- the newest-first listing and any future bounded archive scan."
    }),
    retained({
      key: "booking.reservation_items",
      tableName: "awcms_booking_reservation_items",
      retentionClass: "system_event",
      why: "Immutable item snapshots, bounded by reservations (a handful per booking).",
      deletionWhy:
        "NOT performed by anything: append-only by trigger and by privileges; the snapshot is what a historical booking meant.",
      indexColumns: ["tenant_id", "reservation_id", "line_no"],
      indexPurpose: "awcms_booking_reservation_items_line_key (sql/180)."
    }),
    retained({
      key: "booking.resource_allocations",
      tableName: "awcms_booking_resource_allocations",
      retentionClass: "system_event",
      why: "One row per claimed unit and per reservation item; released rows are kept as the record that a slot was held. Bounded by reservations times units.",
      deletionWhy:
        "Not performed. A released allocation is retained as history; awcms_app is denied DELETE and a trigger rejects it.",
      indexColumns: ["tenant_id", "item_id"],
      indexPurpose: "awcms_booking_resource_allocations_item_idx (sql/180)."
    }),
    retained({
      key: "booking.reservation_events",
      tableName: "awcms_booking_reservation_events",
      retentionClass: "system_event",
      why: "At most nine rows per reservation (each kind happens once, a unique key), so volume is bounded by reservations, not by traffic.",
      deletionWhy:
        "NOT performed by anything: append-only by trigger and privileges, and it is the rebuild source of the future booking reporting projections.",
      indexColumns: ["tenant_id", "created_at"],
      indexPurpose:
        "awcms_booking_reservation_events_cursor_idx (sql/180) -- the projection cursor scan."
    })
  ],
  subjectData: [
    stamps({
      key: "settings",
      tableName: "awcms_booking_settings",
      columns: ["updated_by"],
      rationale:
        "One row per tenant of policy numbers (hold seconds, lead time, horizon); the only person-shaped column is the `updated_by` stamp on a configuration row."
    }),
    stamps({
      key: "resource_pools",
      tableName: "awcms_booking_resource_pools",
      columns: ["created_by", "updated_by", "deleted_by", "restored_by"],
      rationale:
        "A named set of interchangeable resources; a person appears only as the tenant user who created, edited or soft-deleted it."
    }),
    stamps({
      key: "resources",
      tableName: "awcms_booking_resources",
      columns: ["created_by", "updated_by", "deleted_by", "restored_by"],
      rationale:
        "A room, chair or court: a thing the tenant rents out, not a fact about a person. A person appears only as the tenant user who created, edited or soft-deleted it."
    }),
    stamps({
      key: "service_offerings",
      tableName: "awcms_booking_service_offerings",
      columns: ["created_by", "updated_by", "deleted_by", "restored_by"],
      rationale:
        "A service the tenant sells (name, duration, buffers); no price and nothing about a person beyond the tenant user who authored it."
    }),
    stamps({
      key: "schedules",
      tableName: "awcms_booking_schedules",
      columns: ["created_by", "updated_by"],
      rationale:
        "Opening windows of a resource; a person appears only as the tenant user who authored them."
    }),
    stamps({
      key: "schedule_exceptions",
      tableName: "awcms_booking_schedule_exceptions",
      columns: ["created_by"],
      rationale:
        "Closed days and override hours with a short reason code, never free text; a person appears only as the tenant user who authored it."
    }),
    stamps({
      key: "resource_blocks",
      tableName: "awcms_booking_resource_blocks",
      columns: ["created_by", "released_by"],
      rationale:
        "Blocked nights of a stay resource with a closed reason code, never free text; a person appears only as the tenant user who placed or released it."
    }),
    {
      key: "booking.reservations",
      tableName: "awcms_booking_reservations",
      ownerModuleKey: BOOKING_MODULE_KEY,
      subjectColumns: [
        { column: "status_changed_by", references: "tenant_user" },
        { column: "created_by", references: "tenant_user" }
      ],
      exportable: false,
      erasure: "retain_under_obligation",
      // Personal data that must never ride out in an export of this table:
      // the opaque customer reference and the free-text note.
      redactedColumns: ["external_customer_ref", "customer_note"],
      rationale:
        "The operational record of a capacity claim: which unit, which interval, which status. The customer is the OPAQUE `external_customer_ref` (commerce is the authority, ADR-0131) and `customer_note` may hold free text; neither is a tenant-user id, so neither can be matched here. Severing both when the customer is erased at the authority is the job of the erasure integration that arrives with the reservation API (Issue #940), and the non-personal facts (resource, interval, status) are kept as the tenant's operational record. Until that slice the table is retained rather than claimed erased."
    },
    stamps({
      key: "reservation_events",
      tableName: "awcms_booking_reservation_events",
      columns: ["actor_user_id"],
      rationale:
        "An append-only transition log whose `detail` carries closed keys (ids, instants, counts) and no free text or personal data by construction; a person appears only as the tenant user who actioned it. The table rejects UPDATE by trigger, so anonymising the identity makes the stamp resolve to nobody."
    })
  ]
});
