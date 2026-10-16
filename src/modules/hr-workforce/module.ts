/**
 * `hr_workforce` — the employment context (Issue #945, ADR-0132, phase 1 of the
 * `hr_workforce` / `hr_commission` / `hr_payroll` family;
 * `docs/awcms/hr-payroll.md`).
 *
 * A generic answer to "who works here, where, under whom, and since when" that a
 * booking or POS module can later ask without learning anything about pay, and
 * without a private `employees` table copying names and national ids.
 *
 * ## What this PR is (the foundation) and is not
 *
 * IS: the descriptor (`experimental`, i.e. the flag is OFF — there is no admin
 * screen yet, ADR-0021 criterion 1), `awcms_hr_employments` (a header that
 * REFERENCES a `profile_identity` party by composite FK),
 * `awcms_hr_employment_terms` (effective-dated, append-only office / manager /
 * title / type / status) and `awcms_hr_workforce_settings`; one active
 * employment per profile and per login, enforced by the database; employee-sees-
 * own through an `ownershipGrant`; permissions seeded by `sql/177`;
 * `data_lifecycle` and `subjectData` coverage.
 *
 * Issue #946 adds shift templates, shift assignments and the generic
 * `StaffAvailabilityPort` adapter (`sql/184`-`sql/185`).
 *
 * Issue #947 adds attendance events and corrections with approval
 * (`sql/198`-`sql/199`).
 *
 * IS NOT: commission or payroll (later issues of the same ADR), and **never** a photo,
 * biometric or device-fingerprint field (owner decision O6).
 *
 * ## Dependencies
 *
 * `tenant_admin` (offices, tenants), `profile_identity` (the person) and
 * `domain_event_runtime` (the consumer that settles a correction, #998). Audit
 * rows go through `logging`, the cross-cutting foundation every module may call.
 * `identity_access` is NOT a declared dependency: the chokepoint is reached
 * through the shared route factory (`defineTenantRoute`), not imported here.
 * `workflow_approval` is NOT a dependency either: a correction's approval is a
 * soft, fail-closed integration (tests/module-boundary.test.ts), so a tenant
 * without it can still record attendance and is simply refused a correction.
 */
import {
  defineModule,
  type HighVolumeTableDescriptor
} from "../_shared/module-contract";
import { HR_WORKFORCE_MODULE_KEY } from "./domain/hr-workforce-permissions";
import { HR_WORKFORCE_REPORTING_PROJECTIONS } from "./domain/hr-workforce-reporting";

/**
 * A `delegated` descriptor for a table nothing purges: the table answers the
 * retention question on the record instead of by silence. An age-based purge
 * would be wrong for every table here — employment history is the record the
 * employer must keep for its own legal periods (ADR-0132 section 13.2), and the
 * settings row is live state.
 */
function retained(input: {
  key: string;
  tableName: string;
  why: string;
  deletionWhy: string;
  indexColumns?: string[];
  indexPurpose?: string;
  /** The column a future bounded scan would order by. Defaults to `created_at`. */
  cursorColumn?: string;
  personal: boolean;
  /** The employer's own record (`financial_tax`: labour, tax, social security) vs. live configuration. */
  retentionClass: "financial_tax" | "system_event";
  deletionMode: "status_transition_then_purge" | "hard_delete";
}): HighVolumeTableDescriptor {
  return {
    key: input.key,
    tableName: input.tableName,
    ownerModuleKey: HR_WORKFORCE_MODULE_KEY,
    scope: "tenant",
    cursorColumn: input.cursorColumn ?? "created_at",
    retentionClass: input.retentionClass,
    retentionMinDays: 2555,
    retentionMaxDays: 3650,
    defaultRetentionDays: 3650,
    partition: { eligible: false, rationale: input.why },
    archive: {
      archivable: false,
      rationale:
        "No archive step exists or is warranted: the table is the employer's employment record, or live state. Archive-then-purge for HR rows is a recorded follow-up (docs/awcms/hr-payroll.md section 15)."
    },
    deletion: { mode: input.deletionMode, rationale: input.deletionWhy },
    legalHold: {
      applicable: input.personal,
      precedence: input.personal ? "overrides_retention" : "not_applicable"
    },
    requiredIndexes: [
      {
        columns: input.indexColumns ?? ["tenant_id"],
        purpose:
          input.indexPurpose ??
          "Leading column of the table's primary key / unique keys (sql/176); nothing scans this table by age."
      }
    ],
    batchLimit: 5000,
    backupRestoreNotes:
      "Included in ordinary full-database backup/restore. HR history, attendance and payroll must come back from the same point in time (docs/awcms/hr-payroll.md section 14).",
    executionMode: "delegated",
    existingAdopter: {
      purgeFunctionRef:
        "none — retained for the life of the tenant; see ADR-0132 section 13.2",
      description:
        "There is deliberately no purge mechanism; this descriptor exists so the table answers the retention question on the record rather than by silence."
    }
  };
}

export const hrWorkforceModule = defineModule({
  key: HR_WORKFORCE_MODULE_KEY,
  name: "HR Workforce",
  version: "0.2.0",
  // `active` since Issue #952: the module was `experimental` while it had no
  // admin screen (ADR-0021 criterion 1: every ACTIVE module declares one), and
  // it now declares four (the employee's, the supervisor's and HR's).
  status: "active",
  description:
    "The employment context (Issue #945, ADR-0132): who works here, where, under whom and since when, for any module that schedules or books people. An employment REFERENCES a profile_identity party by composite foreign key and never copies its name, contact, birth date or national id, and no photo, biometric or device-fingerprint column exists anywhere (owner decision O6). Terms (office, manager, job title, employment type, status) are effective-dated and append-only: a change closes the open row and inserts the next, terms never overlap, the manager chain is acyclic and at most ten edges deep (counting the reports below an employee, not only the managers above), manager-edge writes are serialised per tenant, and a terminated term is terminal. The database enforces one active employment per profile and per login, and refuses a profile merge between two actively employed profiles. An employee reads their own employment through an ownership grant on the persisted login link (the link itself is a high-risk, audited assign); everyone else needs employments.read. Of the actions, assign, delete, restore and configure are high-risk (the platform classification); create and the terms change are not, yet they are idempotent too, and every write is audited without any name, title, number or reason (the assign row carries only the login's UUID). Shifts (Issue #946): shift templates are patterns (local start, elapsed duration, one optional break, IANA zone) and a shift assignment is one UTC half-open interval per employment, work or time off (a coarse category, never a reason; no free-text field exists), draft then published then cancelled, never deleted. The database refuses two overlapping non-cancelled assignments of one employment, across kinds, even for two concurrent writers (a per-employment advisory lock inside the trigger), and a published or cancelled row is immutable. Publish and cancel are high-risk, idempotent and audited with ids only; an employee reads their own published schedule through an ownership grant. The module's StaffAvailabilityPort adapter exposes working intervals per opaque staff reference (published work, minus breaks and time off, while the terms are active) and nothing else, read-only in the caller's tenant transaction. Attendance (Issue #947): an append-only event table (no UPDATE or DELETE for the runtime role, plus triggers) whose recorded time is the database clock, whose claimed time is bounded by the tenant's clock-skew setting (self and supervisor events cannot be back-dated; kiosk and import replays are accepted up to seven days and flagged late), replay-safe by a client event key, with no location, photo, device or network column (owner decision O6; location evidence is a separate table, Issue #970). A correction never edits an event: it proposes an add or a replace with a mandatory reason, starts a workflow_approval instance (fail-closed when none is published), and on approval appends a new event that supersedes the old one; the correction row only changes status, follows the workflow verdict (enforced by the database), and the requester can never be the approver (CHECK, trigger over the workflow decision rows including delegation, and the chokepoint). An employee reads their own events and a supervisor their reports' (the manager chain, ten levels, a deleted employment breaks it) through ownership grants; the correction reason is sensitive and never reaches an audit row, event, log or the workflow store. Workforce metrics (Issue #953): transparent attendance, hours, shift-coverage and productivity facts (no composite score; no photo, biometric, device, location or payroll data) read by the employee (own), the supervisor (direct reports) and HR through default-deny permissions and ownership grants, with per-office aggregates withheld below five contributing employees and one registered reporting projection (event volume). Commission and payroll are later phases of the same ADR. Self-service and supervisor screens (Issue #952): /admin/hr/my-work (own shifts, attendance and correction requests), /admin/hr/my-metrics (own workforce facts, the employee-facing transparency and challenge screen of workforce-metrics.md section 7), /admin/hr/team (the direct reports' facts and the reports' attendance) and /admin/hr/workforce (the HR view). The first three are opened by the new self_service.read permission, a screen and GET /api/v1/hr-workforce/me gate only: the DATA stays bound to the persisted login link and the manager chain through the ownership grants of the existing routes, so the permission widens nothing. No screen exports anyone's data.",
  dependencies: ["tenant_admin", "profile_identity", "domain_event_runtime"],
  /**
   * #1044: the settler tells a correction's requester the outcome by e-mail.
   * Optional and NOT a `dependencies` edge: with `email` off, or the tenant's
   * `hr.attendance_correction_*` templates absent, the port is a silent no-op
   * and the settlement is unaffected.
   */
  capabilities: {
    // #949: the shift roster, as working intervals per opaque staff reference
    // (`_shared/ports/staff-availability-port.ts`; adapter
    // `application/staff-availability-adapter.ts`), consumed by `booking`.
    provides: ["staff_availability"],
    consumes: [
      {
        capability: "workflow_notification",
        providedBy: "email",
        optional: true
      }
    ]
  },
  type: "domain",
  api: {
    openApiPath: "openapi/modules/hr-workforce.openapi.yaml",
    basePath: "/api/v1/hr-workforce"
  },
  /**
   * #998: applies a finished approval's verdict to an attendance correction as
   * soon as the workflow publishes it, so an approved correction no longer waits
   * for somebody to call `settle`. `workflow_approval` stays a SOFT integration:
   * the consumer reads only this module's own table by workflow instance id, and
   * an event of any other module's instance matches nothing. See
   * `application/hr-attendance-settlement.ts`.
   */
  domainEventConsumers: [
    {
      name: "hr_workforce.attendance_correction_settler",
      description:
        "hr_workforce consumer — applies the verdict of a finished approval workflow instance to the attendance correction it belongs to (approved: the status moves and the superseding event is appended; rejected: rejected; cancelled: withdrawn). A refusal leaves the correction pending for a person and is audited; the manual settle route remains.",
      eventTypes: [
        "awcms.workflow.instance.approved",
        "awcms.workflow.instance.rejected",
        "awcms.workflow.instance.cancelled"
      ],
      eventVersions: ["1.0"],
      handle: async (tx, event, ctx) => {
        // The aggregate id is only an instance id for a workflow-instance event;
        // anything else is skipped quietly.
        if (event.aggregateType !== "workflow_instance") {
          return;
        }

        const { settleCorrectionForInstance } =
          await import("./application/hr-attendance-settlement");
        // #1044: the `workflow_notification` capability (e-mail outbox). The
        // adapter is imported here, at the composition point, never from
        // `application/**` (ADR-0011).
        const { createEmailWorkflowNotificationAdapter } =
          await import("../email/application/workflow-notification-port-adapter");
        await settleCorrectionForInstance(
          tx as Bun.TransactionSQL,
          ctx.tenantId,
          event.aggregateId,
          ctx.correlationId,
          new Date(),
          createEmailWorkflowNotificationAdapter()
        );
      }
    }
  ],
  navigation: [
    {
      labelKey: "admin.layout.nav_hr_my_work",
      path: "/admin/hr/my-work",
      order: 45,
      requiredPermission: "hr_workforce.self_service.read"
    },
    {
      labelKey: "admin.layout.nav_hr_my_metrics",
      path: "/admin/hr/my-metrics",
      order: 46,
      requiredPermission: "hr_workforce.self_service.read"
    },
    {
      labelKey: "admin.layout.nav_hr_team",
      path: "/admin/hr/team",
      order: 47,
      requiredPermission: "hr_workforce.self_service.read"
    },
    {
      labelKey: "admin.layout.nav_hr_workforce",
      path: "/admin/hr/workforce",
      order: 48,
      requiredPermission: "hr_workforce.employments.read"
    }
  ],
  permissions: [
    {
      activityCode: "employments",
      action: "read",
      description:
        "Read employments (person reference, employee number, hire date, current terms); an employee reads their own without this"
    },
    {
      activityCode: "employments",
      action: "create",
      description: "Create an employment for an existing profile_identity party"
    },
    {
      activityCode: "employments",
      action: "update",
      description:
        "Append the next effective-dated terms of an employment (office, manager, title, type, status), including terminating it"
    },
    {
      activityCode: "employments",
      action: "delete",
      description: "Soft-delete an employment entered by mistake — high-risk"
    },
    {
      activityCode: "employments",
      action: "restore",
      description: "Restore a soft-deleted employment — high-risk"
    },
    {
      activityCode: "employments",
      action: "assign",
      description:
        "Link or unlink the login that is the employee (the basis of self-service ownership) — audited, high-risk"
    },
    {
      activityCode: "shifts",
      action: "read",
      description:
        "Read shift assignments, drafts included; an employee reads their own published schedule without this"
    },
    {
      activityCode: "shifts",
      action: "create",
      description:
        "Create a draft shift or time-off assignment for an employment"
    },
    {
      activityCode: "shifts",
      action: "publish",
      description:
        "Publish a draft shift assignment so scheduling consumers can see it — high-risk"
    },
    {
      activityCode: "shifts",
      action: "cancel",
      description: "Cancel a draft or published shift assignment — high-risk"
    },
    {
      activityCode: "templates",
      action: "read",
      description: "Read shift templates"
    },
    {
      activityCode: "templates",
      action: "create",
      description: "Create a shift template"
    },
    {
      activityCode: "templates",
      action: "update",
      description: "Edit a shift template; existing assignments are not moved"
    },
    {
      activityCode: "templates",
      action: "delete",
      description: "Soft-delete a shift template — high-risk"
    },
    {
      activityCode: "clock",
      action: "create",
      description:
        "Record your own clock-in, clock-out and break events; the employment must be linked to your login"
    },
    {
      activityCode: "attendance",
      action: "create",
      description:
        "Record an attendance event for another employment (supervisor, kiosk or import source)"
    },
    {
      activityCode: "attendance",
      action: "read",
      description:
        "Read attendance events of any employment; an employee reads their own and a supervisor their reports without this"
    },
    {
      activityCode: "corrections",
      action: "create",
      description:
        "Request a correction to attendance (add or replace an event), starting an approval workflow instance"
    },
    {
      activityCode: "corrections",
      action: "read",
      description:
        "Read attendance corrections and their reasons; the requester and the workflow assignees read theirs without this"
    },
    {
      activityCode: "corrections",
      action: "cancel",
      description: "Withdraw your own pending attendance correction — high-risk"
    },
    {
      activityCode: "corrections",
      action: "approve",
      description:
        "Apply the approval workflow's verdict on an attendance correction, appending the superseding event — high-risk; the requester is refused"
    },
    {
      activityCode: "workforce_metrics",
      action: "read",
      description:
        "Read the attendance, hours, shift-coverage and productivity facts of any employee, and the workforce event-volume projection; an employee reads their own and a supervisor their direct reports' without this"
    },
    {
      activityCode: "workforce_metrics",
      action: "analyze",
      description:
        "Read per-office workforce aggregates; a group with fewer than five contributing employees is withheld entirely"
    },
    {
      activityCode: "attendance_evidence",
      action: "read",
      description:
        "Read the location-evidence verdicts of any employment; an employee reads their own without this"
    },
    {
      activityCode: "geolocation_evidence",
      action: "configure",
      description:
        "Switch geolocation attendance evidence on or off and manage its geofences, notice version and accuracy ceiling — high-risk; not granted by default"
    },
    {
      activityCode: "self_service",
      action: "read",
      description:
        "Open the employee self-service and supervisor screens and read your own employment summary; the data itself stays bound to your linked employment and your reports, not to this permission"
    },
    {
      activityCode: "settings",
      action: "read",
      description:
        "Read the workforce settings (clock-skew bound, correction workflow key)"
    },
    {
      activityCode: "settings",
      action: "configure",
      description: "Change the workforce settings — high-risk"
    }
  ],
  /**
   * Issue #953: the tenant-wide event-volume counters. The behavioural facts
   * (late, missed, worked time, coverage) are NOT projections -- see
   * `domain/hr-workforce-reporting.ts` for why.
   */
  reportingProjections: HR_WORKFORCE_REPORTING_PROJECTIONS,
  dataLifecycle: [
    retained({
      key: "hr_workforce.employments",
      tableName: "awcms_hr_employments",
      personal: true,
      retentionClass: "financial_tax",
      deletionMode: "status_transition_then_purge",
      why: "One row per employment, authored by an administrator, so its ceiling is the number of people a tenant has employed. It is the employer's record of a relationship and a trigger refuses DELETE.",
      deletionWhy:
        "The lifecycle is soft delete (a mistaken entry) and, eventually, a purge once the employer's retention period has run; NO purge exists yet (recorded follow-up), so nothing is removed today. awcms_app is denied DELETE and a trigger rejects it, so a future purge must be a reviewed, privileged job. An employment ends by a terminated term, not by deletion.",
      indexColumns: ["tenant_id", "created_at"],
      indexPurpose:
        "awcms_hr_employments_list_idx (sql/176) — the newest-first listing and any future bounded archive scan."
    }),
    retained({
      key: "hr_workforce.employment_terms",
      tableName: "awcms_hr_employment_terms",
      personal: true,
      retentionClass: "financial_tax",
      deletionMode: "status_transition_then_purge",
      why: "One row per change of terms, authored by an administrator, so its ceiling is employments times changes. Append-only: the only UPDATE closes the open row.",
      deletionWhy:
        "Removed only together with its employment, by the same future purge (none exists yet; recorded follow-up). Until then nothing is removed: history is append-only, awcms_app is denied DELETE and a trigger rejects it.",
      indexColumns: ["tenant_id", "employment_id", "effective_from"],
      indexPurpose:
        "awcms_hr_employment_terms_employment_idx (sql/176) — the per-employment history read."
    }),
    retained({
      key: "hr_workforce.shift_templates",
      tableName: "awcms_hr_shift_templates",
      personal: false,
      retentionClass: "system_event",
      deletionMode: "status_transition_then_purge",
      why: "One row per shift pattern, authored by an administrator, so its ceiling is the number of patterns a tenant defines. A pattern holds no person.",
      deletionWhy:
        "The lifecycle is soft delete (the code is freed for reuse). NO purge exists yet, so nothing is removed today; assignments keep their own resolved instants, so a purge of a template could never change a schedule. awcms_app is denied DELETE and a trigger rejects it, so a future purge must be a reviewed, privileged job.",
      indexColumns: ["tenant_id", "created_at"],
      indexPurpose:
        "awcms_hr_shift_templates_list_idx (sql/184) — the newest-first listing and any future bounded scan."
    }),
    retained({
      key: "hr_workforce.shift_assignments",
      tableName: "awcms_hr_shift_assignments",
      personal: true,
      retentionClass: "financial_tax",
      deletionMode: "status_transition_then_purge",
      cursorColumn: "starts_at",
      why: "One row per scheduled shift or time-off interval, so its ceiling is employments times days worked. Rosters can support the employer's pay and working-hours records, so they follow the same retention class as the employment history; the actual period is the employer's counsel's, not asserted here.",
      deletionWhy:
        "The lifecycle is draft, published, then cancelled (terminal); a row is never deleted. NO purge exists yet (recorded follow-up, with the other HR rows), so nothing is removed today. awcms_app is denied DELETE and a trigger rejects it, so a future purge must be a reviewed, privileged job.",
      indexColumns: ["tenant_id", "starts_at"],
      indexPurpose:
        "awcms_hr_shift_assignments_list_idx (sql/184) — the time-ordered listing and any future bounded scan."
    }),
    retained({
      key: "hr_workforce.attendance_events",
      tableName: "awcms_hr_attendance_events",
      personal: true,
      retentionClass: "financial_tax",
      deletionMode: "status_transition_then_purge",
      cursorColumn: "occurred_at",
      why: "One row per clock-in, clock-out or break event, so its ceiling is employments times events per day times days worked: the busiest HR table. Attendance can support the employer's pay and working-hours records, so it follows the same retention class as the employment history; the actual period is the employer's counsel's, not asserted here.",
      deletionWhy:
        "Append-only: awcms_app holds no UPDATE or DELETE and a trigger refuses both. NO purge exists yet (recorded follow-up with the other HR rows; the keyset list is bounded by LIMIT and a cursor in the meantime), so nothing is removed today. A future purge must be a reviewed, privileged job.",
      indexColumns: ["tenant_id", "occurred_at"],
      indexPurpose:
        "awcms_hr_attendance_events_list_idx (sql/198) — the newest-first listing and any future bounded scan."
    }),
    retained({
      key: "hr_workforce.attendance_corrections",
      tableName: "awcms_hr_attendance_corrections",
      personal: true,
      retentionClass: "financial_tax",
      deletionMode: "status_transition_then_purge",
      why: "One row per requested correction, so its ceiling is the number of corrections people ask for. The row is the justification for a superseding event that pay may rely on, so it is retained with the events; the reason text is sensitive and has no shorter lifetime of its own yet.",
      deletionWhy:
        "A status-only table: pending moves to approved, rejected or withdrawn and stays; a trigger refuses DELETE and awcms_app holds none. NO purge exists yet (recorded follow-up), so nothing is removed today.",
      indexColumns: ["tenant_id", "created_at"],
      indexPurpose:
        "awcms_hr_attendance_corrections_list_idx (sql/198) — the newest-first listing and any future bounded scan."
    }),
    // Issue #970 / ADR-0138 section 7: the location-evidence VERDICT rows are the
    // one table in this module the retention engine really purges. 30 / 90 / 180
    // days, hard delete, no archive (an archive would keep personal data past its
    // purpose), legal hold overrides retention. A verdict row has no residual
    // value once aged, and the event it describes is untouched.
    {
      key: "hr_workforce.attendance_location_evidence",
      tableName: "awcms_hr_attendance_location_evidence",
      ownerModuleKey: HR_WORKFORCE_MODULE_KEY,
      scope: "tenant",
      cursorColumn: "evaluated_at",
      // No `personal_data` class exists in the registry vocabulary; a verdict is
      // the system's own record of an attendance check, so `system_event`.
      retentionClass: "system_event",
      retentionMinDays: 30,
      retentionMaxDays: 180,
      defaultRetentionDays: 90,
      partition: {
        eligible: false,
        rationale:
          "One verdict row per self clock-in/out of a tenant that switched the feature on (off by default), aged out within 180 days: a bounded, small table that a partition scheme would not repay."
      },
      archive: {
        archivable: false,
        rationale:
          "Archiving would keep a person's presence at a site past the purpose it was collected for (verifying a check-in during the correction and dispute window). ADR-0138 section 7: no archive."
      },
      deletion: {
        mode: "hard_delete",
        rationale:
          "A verdict row (inside / outside / not_provided, two coarse bands) has no residual value once the correction window has passed, and holds no coordinate to anonymise. The attendance event it describes is separate and is not touched."
      },
      legalHold: { applicable: true, precedence: "overrides_retention" },
      requiredIndexes: [
        {
          columns: ["tenant_id", "evaluated_at"],
          purpose:
            "awcms_hr_attendance_location_evidence_retention_idx (sql/306) — the (tenant, cursor) composite the generic purge engine filters and orders by."
        }
      ],
      batchLimit: 1000,
      backupRestoreNotes:
        "Included in ordinary full-database backup/restore. A restore brings back verdicts that already aged out of the live table; the next purge run removes them again. No coordinate is in any backup, by construction (ADR-0138 section 1).",
      executionMode: "generic"
    },
    retained({
      key: "hr_workforce.geofences",
      tableName: "awcms_hr_geofences",
      personal: false,
      retentionClass: "system_event",
      deletionMode: "status_transition_then_purge",
      why: "One row per authorised work site, authored by an administrator, so its ceiling is the number of sites a tenant defines. A geofence describes a place of business, not a person.",
      deletionWhy:
        "Soft delete (deleted_at) and restore; a row an evidence verdict references is never removed. NO purge exists, so nothing is removed today. awcms_app is denied DELETE and a trigger rejects it.",
      indexColumns: ["tenant_id", "created_at"],
      indexPurpose:
        "awcms_hr_geofences_list_idx (sql/306) — the newest-first listing and any future bounded scan."
    }),
    retained({
      key: "hr_workforce.geolocation_notices",
      tableName: "awcms_hr_geolocation_notices",
      personal: false,
      retentionClass: "system_event",
      deletionMode: "status_transition_then_purge",
      why: "One row per published notice version, authored by an administrator, so its ceiling is the number of times a tenant rewrites its notice. Tenant-authored text, no person.",
      deletionWhy:
        "Append-only: awcms_app holds no UPDATE or DELETE and triggers refuse both. A notice version is the record of what employees were told, so it is kept; NO purge exists today.",
      indexColumns: ["tenant_id", "created_at"],
      indexPurpose:
        "awcms_hr_geolocation_notices_list_idx (sql/306) — the newest-first listing."
    }),
    retained({
      key: "hr_workforce.geolocation_notice_acknowledgements",
      tableName: "awcms_hr_geolocation_notice_acknowledgements",
      personal: true,
      retentionClass: "financial_tax",
      deletionMode: "status_transition_then_purge",
      cursorColumn: "acknowledged_at",
      why: "One row per (employment, notice version), so its ceiling is employments times notice versions. It is evidence that the employer gave the notice, kept with the employment record; the actual period is the employer's counsel's, not asserted here.",
      deletionWhy:
        "Append-only: awcms_app holds no UPDATE or DELETE and triggers refuse both. NO purge exists yet (recorded follow-up with the other HR rows), so nothing is removed today.",
      indexColumns: ["tenant_id", "acknowledged_at"],
      indexPurpose:
        "awcms_hr_geolocation_acks_list_idx (sql/306) — the time-ordered scan."
    }),
    retained({
      key: "hr_workforce.geolocation_settings",
      tableName: "awcms_hr_geolocation_settings",
      personal: false,
      retentionClass: "system_event",
      deletionMode: "hard_delete",
      why: "One row per tenant, upserted. An age-based purge would silently switch a tenant's configuration back to its defaults for being old.",
      deletionWhy:
        "Not performed by any job: a live configuration row, not a record. Deleting it would reset the switch to OFF, which is the safe direction, but silently losing the recorded DPIA reference is not wanted, so no purge is declared."
    }),
    retained({
      key: "hr_workforce.settings",
      tableName: "awcms_hr_workforce_settings",
      personal: false,
      retentionClass: "system_event",
      deletionMode: "hard_delete",
      why: "One row per tenant, upserted. An age-based purge would silently reset the tenant's configuration for being old.",
      deletionWhy:
        "Not performed by any job: a live configuration row, not a record. Deleting it would silently restore the defaults, so no purge is declared."
    })
  ],
  subjectData: [
    {
      key: "hr_workforce.attendance_events",
      tableName: "awcms_hr_attendance_events",
      ownerModuleKey: HR_WORKFORCE_MODULE_KEY,
      // ADR-0142 / Issue #1018: the person is reached through the employment,
      // never through `recorded_by`, which names whoever RECORDED the event (a
      // supervisor, a kiosk operator, an importer) and would pull every event
      // that person entered for somebody else into their own export.
      subjectColumns: [],
      subjectVia: {
        column: "employment_id",
        parentKey: "hr_workforce.employments",
        parentColumns: ["profile_id"]
      },
      exportable: true,
      erasure: "retain_under_obligation",
      rationale:
        "When a person clocked in and out (behavioural data). The row reaches the person through `employment_id` -> `awcms_hr_employments` (`profile_id` ONLY, Issue #1018: the login columns would also match a login mislinked to somebody else's employment), the indirect path ADR-0142 added to the subject-data model, so the employee's own events are part of their export and another person's are not. `recorded_by` (who entered the event) is deliberately not a subject column: it names the recorder. Erasure does NOT follow the join: the table is append-only by privilege and trigger and retained under the employer's working-hours and pay obligations (ADR-0132 section 13.2); the anonymised profile makes the record resolve to nobody. It holds no free text, location, photo, device or network value (owner decision O6, ADR-0138), so every column is exported."
    },
    {
      key: "hr_workforce.attendance_corrections",
      tableName: "awcms_hr_attendance_corrections",
      ownerModuleKey: HR_WORKFORCE_MODULE_KEY,
      subjectColumns: [],
      subjectVia: {
        column: "employment_id",
        parentKey: "hr_workforce.employments",
        parentColumns: ["profile_id"]
      },
      exportable: true,
      // Issue #1018: the free-text `reason` is withheld from the operator-run
      // export. It is typed by the requester (who may be a supervisor, not the
      // employee), can describe health or family circumstances including a
      // THIRD party's, and is sensitive everywhere else in this module (never
      // in an audit row, an event, a log or the workflow store). The subject
      // still reads their own corrections, reason included, through the
      // ownership-granted GET /api/v1/hr-workforce/attendance-corrections/{id}.
      // Releasing it through the export is a recorded product/legal question,
      // answered by removing this one line.
      redactedColumns: ["reason"],
      erasure: "retain_under_obligation",
      rationale:
        "A request to change when a person is recorded as having worked: kind, the proposed event, status, who decided and when. The row reaches the employee it is about through `employment_id` -> `awcms_hr_employments` (ADR-0142), so the employee's own corrections are part of their export and another person's are not. `requested_by` and `decided_by` (the requester and the approver) are deliberately not subject columns: they name other people. The free-text `reason` (SENSITIVE: may describe health or family circumstances, a third party's included; never in an audit row, an event or the workflow store) is a redacted column: the export says it was withheld, and the subject reads it through the ownership-granted GET /api/v1/hr-workforce/attendance-corrections/{id}. Whether the export itself may release it is an open product/legal decision (Issue #1018). Status-only and never deleted; retained with the events it justifies under the employer's obligations (ADR-0132 section 13.2); erasure does NOT follow the join."
    },
    {
      key: "hr_workforce.attendance_location_evidence",
      tableName: "awcms_hr_attendance_location_evidence",
      ownerModuleKey: HR_WORKFORCE_MODULE_KEY,
      // ADR-0138 section 7 / ADR-0142: the person is reached through the
      // employment (`profile_id` ONLY, like the events the verdict describes).
      subjectColumns: [],
      subjectVia: {
        column: "employment_id",
        parentKey: "hr_workforce.employments",
        parentColumns: ["profile_id"]
      },
      exportable: true,
      erasure: "retain_under_obligation",
      rationale:
        "Whether a person's own clock-in or clock-out was at an authorised site: a verdict (inside / outside / not_provided), two coarse bands, the geofence and the rule version. The row reaches the person through `employment_id` -> `awcms_hr_employments` (`profile_id` ONLY, ADR-0142), so the employee's own verdicts are part of their export and another person's are not; every column is exported because the row holds NO coordinate, raw accuracy, address, device or network value (ADR-0138 section 1). The registry's value `retain_under_obligation` is a REGISTRY LABEL here, not a claim that any law obliges the employer to keep these rows: nothing does, and they are kept only for the purpose they were collected for (checking a check-in during the correction and dispute window) and for the bounded retention below. Erasure does NOT follow the join: the registry gate allows only that value for an indirect path, and the table is append-only for the application role, so the subject-request executor cannot delete them. The rows leave through the retention engine at most 180 days after the check (30 / 90 / 180, hard delete, no archive; a tenant may only shorten the default), a legal hold overrides retention, and the anonymised profile makes a row resolve to nobody meanwhile. An operator-run immediate erasure exists but is not wired to the executor (awcms_hr_erase_location_evidence, sql/306). WHICH of the two an erasure request gets is PENDING counsel's decision and enabling the feature in any tenant is blocked until counsel signs off (ADR-0138, Deviations)."
    },
    {
      key: "hr_workforce.geolocation_notice_acknowledgements",
      tableName: "awcms_hr_geolocation_notice_acknowledgements",
      ownerModuleKey: HR_WORKFORCE_MODULE_KEY,
      // `acknowledged_by` names the employee's own login, but the person is
      // reached through the employment like every other table of the module.
      subjectColumns: [],
      subjectVia: {
        column: "employment_id",
        parentKey: "hr_workforce.employments",
        parentColumns: ["profile_id"]
      },
      exportable: true,
      erasure: "retain_under_obligation",
      rationale:
        "That an employee was shown a notice version and when: evidence of NOTICE (not of consent as the lawful basis, ADR-0138 section 4). The row reaches the person through `employment_id` -> `awcms_hr_employments` (`profile_id` ONLY, ADR-0142), so the employee's own acknowledgements are part of their export. `acknowledged_by` is the employee's own login and adds nothing the employment does not. Erasure does NOT follow the join: the row is append-only (privilege and trigger) and is the employer's proof that the notice was given, kept with the employment record (ADR-0132 section 13.2); the anonymised profile makes it resolve to nobody."
    },
    {
      key: "hr_workforce.shift_assignments",
      tableName: "awcms_hr_shift_assignments",
      ownerModuleKey: HR_WORKFORCE_MODULE_KEY,
      // ADR-0142: the person is reached through the employment, never through
      // the actor stamps (`created_by`, `published_by`, `cancelled_by`), which
      // name the SCHEDULER and would pull every shift a manager planned for
      // somebody else into the manager's own export.
      subjectColumns: [],
      subjectVia: {
        column: "employment_id",
        parentKey: "hr_workforce.employments",
        parentColumns: ["profile_id"]
      },
      exportable: true,
      erasure: "retain_under_obligation",
      rationale:
        "When a person was scheduled to work and when they were away (a coarse category, never a reason). The row reaches the person through `employment_id` -> `awcms_hr_employments` (`profile_id` ONLY, Issue #1018: the login columns would also match a login mislinked to somebody else's employment), the indirect path ADR-0142 added to the subject-data model, so the employee's own schedule, drafts included, is part of their export and another person's is not. The actor stamps (`created_by`, `published_by`, `cancelled_by`) are deliberately not subject columns: they name the scheduler. Erasure does NOT follow the join: rows are never deleted, a published one is immutable, and they are retained under the employer's working-hours and pay obligations (ADR-0132 section 13.2); the anonymised profile makes the schedule resolve to nobody."
    },
    {
      key: "hr_workforce.employments",
      tableName: "awcms_hr_employments",
      ownerModuleKey: HR_WORKFORCE_MODULE_KEY,
      // Issue #1018: only the columns that say the row IS ABOUT the person. The
      // actor stamps (`created_by`, `updated_by`, `deleted_by`, `restored_by`)
      // name the HR user who entered the header; matching on them put every
      // employment an HR user had created for somebody else into THEIR export.
      subjectColumns: [
        { column: "profile_id", references: "profile" },
        { column: "tenant_user_id", references: "tenant_user" },
        { column: "last_tenant_user_id", references: "tenant_user" }
      ],
      exportable: true,
      erasure: "retain_under_obligation",
      rationale:
        "The employer's record that a person was employed: employee number, hire and end dates, and the login that is the employee. It REFERENCES the party (`profile_id`) and copies none of its identity, which `profile_identity` owns, exports and anonymises. It is exported (the employee number and dates are the subject's own data) and retained under the employer's labour, tax and social-security obligations (ADR-0132 section 13.2; the periods are the employer's counsel's, not asserted here). The actor stamps (`created_by`, `updated_by`, `deleted_by`, `restored_by`) are deliberately not subject columns (Issue #1018): they name the HR user who entered the row, and matching them would hand that user another person's employment header; they resolve to nobody once the identity is anonymised. KNOWN LIMIT (follow-up of Issue #1018): `tenant_user_id` and `last_tenant_user_id` still match, so a login mislinked to somebody else's employment (later corrected, the replaced login is kept in `last_tenant_user_id`) sees that HEADER (employee number, dates) in its export; the child tables use `profile_id` only and are unaffected. The registry has no conditional match (only when the login's profile equals the row's), and a descriptor change alone cannot express it. Nothing in this module nulls `profile_id` on anonymisation: the link REMAINS but points at a profile whose name `profile_identity` has overwritten, so the row resolves to no recognisable person. The employee number is an HR identifier, not a national id, and stays."
    },
    {
      key: "hr_workforce.employment_terms",
      tableName: "awcms_hr_employment_terms",
      ownerModuleKey: HR_WORKFORCE_MODULE_KEY,
      // ADR-0142: reached through the employment; `created_by` names the HR
      // user who recorded the term and is not a subject column.
      subjectColumns: [],
      subjectVia: {
        column: "employment_id",
        parentKey: "hr_workforce.employments",
        parentColumns: ["profile_id"]
      },
      exportable: true,
      erasure: "retain_under_obligation",
      rationale:
        "The effective-dated history of where an employee worked, under whom and in what status. The row reaches the person through `employment_id` -> `awcms_hr_employments` (`profile_id` ONLY, Issue #1018: the login columns would also match a login mislinked to somebody else's employment), the indirect path ADR-0142 added to the subject-data model, so the employee's own whole history is part of their export and another person's is not. `created_by` (the HR user who recorded the term) is deliberately not a subject column. Erasure does NOT follow the join: the table is append-only by trigger and retained under the employer's legal obligations (ADR-0132 section 13.2); the anonymised profile makes the history resolve to nobody."
    }
  ]
});
