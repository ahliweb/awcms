/**
 * `hr_commission` — versioned commission rules (Issue #950) and the accrual
 * ledger (Issue #951), ADR-0132, phase 2 of the `hr_workforce` /
 * `hr_commission` / `hr_payroll` family; `docs/awcms/hr-payroll.md` section 6.
 *
 * ## Issue #951 (the ledger) in one paragraph
 *
 * `awcms_hr_commission_accruals` holds immutable monetary facts per
 * (source, employment) with an advancing status (pending -> approved -> payable
 * -> paid, or voided from pending/approved); `awcms_hr_commission_transitions`
 * is the append-only log, written only by the accrual's own triggers. A
 * downstream adapter reports a sale through `_shared/ports/commission-accrual-
 * port.ts` (this module imports nothing from commerce); a double delivery is one
 * accrual (a database unique key, race-safe); the amount comes from the
 * published rule in force on the event date, never from the caller. Affiliate
 * commission is NOT here. Issue #1109 adds `CommissionAccrualPort.void` (reverse
 * an accrual by source identity; a `pending`/`approved` accrual only, `payable`
 * and `paid` are refused as `period_closed`) and the first
 * `awcms.hr.commission.*` event, `voided`; the other events are later phases. The rest of this header describes the rule foundation (#950).
 *
 * ## What the rule foundation (#950) is and is not
 *
 * IS: the descriptor (`experimental`, i.e. the flag is OFF — there is no admin
 * screen yet, ADR-0021 criterion 1), `awcms_hr_commission_rules` (jurisdiction-
 * neutral, effective-dated, versioned: draft-only edits, immutable once
 * published, no overlapping published windows per rule — all enforced by the
 * database), the draft / publish / retire lifecycle API, and a PURE evaluation
 * function (`domain/hr-commission-evaluation.ts`) with exact `bigint` decimal
 * arithmetic and no expression language.
 *
 * IS NOT (of #950): the accrual ledger — see #951 above; not affiliate commission
 * (hr-payroll.md 6.4); and **no** country's or jurisdiction's rules — a tenant
 * authors its own.
 *
 * ## Dependencies
 *
 * `hr_workforce` (the employment the later accrual ledger references) and
 * `tenant_admin`. Audit rows go through `logging`, the cross-cutting foundation
 * every module may call. `identity_access` is NOT a declared dependency: the
 * chokepoint is reached through the shared route factory (`defineTenantRoute`).
 */
import { defineModule } from "../_shared/module-contract";
import { HR_COMMISSION_EVENT_TYPES } from "./domain/hr-commission-events";
import { HR_COMMISSION_MODULE_KEY } from "./domain/hr-commission-permissions";

export const hrCommissionModule = defineModule({
  key: HR_COMMISSION_MODULE_KEY,
  name: "HR Commission",
  version: "0.5.0",
  // Commission accruals are monetary pay facts: payroll data by any reading
  // (ADR-0132). Declared so that no channel that must keep payroll off it (the
  // Telegram registry and its CI gate, ADR-0140) has to guess from a name.
  handlesPayrollData: true,
  // `active` since Issue #952: the module was `experimental` while it had no
  // admin screen (ADR-0021 criterion 1: every ACTIVE module declares one), and
  // it now declares the employee's own-commission screen.
  status: "active",
  description:
    "Versioned commission rules (Issue #950, ADR-0132): jurisdiction-neutral, tenant-authored terms saying how a share of a source amount becomes a commission — a percent of a base amount or a fixed amount per unit, in one currency, rounded under one explicit mode and scale, with an optional floor and ceiling. A rule changes only by a new version; the database enforces that a draft may be edited, a published or retired version is immutable (a published one may only become retired), no two published versions of one rule overlap (race-safe, advisory-locked), and no row is ever deleted. The version in force for an event is the one whose half-open window contains the event's own date, never now(). Evaluation is a pure function over bigint decimal strings: no float, no expression or script, no tiers, bounded by construction. Publish and retire are high-risk, separately grantable, idempotency-keyed and audited without any rate or amount; publish is bound to the content digest the reviewer saw and refuses the draft's creator and last editor (maker / checker), and a row is born a draft. A rule references no person or employment and carries no personal data. Issue #951 adds the accrual LEDGER: a commission earned by an employment from a source event is one row whose monetary facts (rule version, inputs, rate snapshot, amount, currency, instants) are immutable by trigger and whose status advances pending -> approved -> payable -> paid, or to voided from pending or approved (a voided accrual can never be paid); the transition log is append-only and written only by the accrual's own triggers, so status and log cannot diverge and a reconciliation proves it. The same source for the same employment is accrued exactly once (a database unique key, race-safe), a downstream adapter reports a sale through a neutral port (this module imports nothing from commerce) and a redelivery returns the original; the amount is computed from the published rule in force on the event's own date and can never be asserted by the caller; the employment and rule are validated under FOR SHARE by trigger; the beneficiary cannot approve their own accrual. Approve, release, void and pay are high-risk, separately grantable, idempotency-keyed and audited without any amount. A back-dated publish of a rule now needs a stated reason. Employee commission only (not affiliate); reversal and events are later phases. Self-service (Issue #952): an employee reads their OWN accruals, read-only, at /admin/hr/my-commission through GET /api/v1/hr-commission/my-accruals, which joins the live employment linked to their login in the query itself (another person's accrual is a 404, never a 403, and there is no filter to widen it); the view carries no approver, payer or payment reference. No screen exports anyone's data. Intake (Issue #1189, ADR-0147): an event-driven consumer that runs as the worker role, and so may touch no accrual, submits a commission or a void through the `commission_intake` port (one INSERT into awcms_hr_commission_intents, default-deny per tenant behind `hr_commission.intake.configure`), and the job `hr-commission:intents:post`, which runs as awcms_app, posts it through the one posting core; refused and failed requests are listed for a human (an outcome code and masked ids, never an amount).",
  dependencies: ["tenant_admin", "hr_workforce", "domain_event_runtime"],
  /**
   * #1109: the accrual port (`_shared/ports/commission-accrual-port.ts`; adapter
   * `application/hr-commission-accrual-port-adapter.ts`). A downstream adapter
   * (the commerce sale-attribution adapter in a derived repository) binds to it
   * at its composition root; nothing in this repository consumes it.
   *
   * #1189 (ADR-0147): `commission_intake` (`_shared/ports/commission-intake-port.ts`;
   * adapter `application/hr-commission-intake-port-adapter.ts`) is the port an
   * EVENT-DRIVEN consumer, one running as `awcms_worker`, submits through: the
   * worker may not touch the accrual ledger, so it INSERTs an intake record and
   * the job `hr-commission:intents:post` (as `awcms_app`) posts it through the one
   * posting core. `commission_accrual` is unchanged.
   */
  capabilities: {
    provides: ["commission_accrual", "commission_intake"]
  },
  events: {
    asyncApiPath: "asyncapi/awcms-domain-events.asyncapi.yaml",
    publishes: [...HR_COMMISSION_EVENT_TYPES]
  },
  type: "domain",
  api: {
    openApiPath: "openapi/modules/hr-commission.openapi.yaml",
    basePath: "/api/v1/hr-commission"
  },
  navigation: [
    {
      labelKey: "admin.layout.nav_hr_my_commission",
      path: "/admin/hr/my-commission",
      order: 49,
      requiredPermission: "hr_commission.my_accruals.read"
    }
  ],
  permissions: [
    {
      activityCode: "rules",
      action: "read",
      description:
        "Read commission rule versions (calculation, rate or fixed amount, currency, rounding, effective window)"
    },
    {
      activityCode: "rules",
      action: "create",
      description: "Create a draft commission rule version"
    },
    {
      activityCode: "rules",
      action: "update",
      description:
        "Edit a DRAFT commission rule version; a published version is immutable"
    },
    {
      activityCode: "rules",
      action: "publish",
      description:
        "Publish a draft commission rule version, making it immutable and eligible to apply — audited, high-risk"
    },
    {
      activityCode: "rules",
      action: "retire",
      description:
        "Retire a draft or published commission rule version so it no longer applies — audited, high-risk"
    },
    {
      activityCode: "accruals",
      action: "read",
      description:
        "Read commission accruals and their transition history (amounts are earnings)"
    },
    {
      activityCode: "accruals",
      action: "accrue",
      description:
        "Post a commission accrual for an employment from a source event (idempotent by source) — audited, high-risk"
    },
    {
      activityCode: "accruals",
      action: "approve",
      description:
        "Approve a pending commission accrual; the beneficiary cannot approve their own — audited, high-risk"
    },
    {
      activityCode: "accruals",
      action: "release",
      description:
        "Release an approved commission accrual as payable to payroll — audited, high-risk"
    },
    {
      activityCode: "accruals",
      action: "cancel",
      description:
        "Void a pending or approved commission accrual (no money has moved) — audited, high-risk"
    },
    {
      activityCode: "my_accruals",
      action: "read",
      description:
        "Read your own commission accruals (the earning, how it was computed and its status); another person's are never returned"
    },
    {
      activityCode: "accruals",
      action: "pay",
      description:
        "Record that a payable commission accrual has been paid — audited, high-risk"
    },
    {
      activityCode: "intake",
      action: "read",
      description:
        "Read the commission intake exceptions (refused and failed requests: an outcome code and masked ids, never an amount) and the poster job counts"
    },
    {
      activityCode: "intake",
      action: "configure",
      description:
        "Switch the tenant's commission intake on or off (lets a registered system consumer queue commission requests that a job posts) — audited at warning, high-risk"
    }
  ],
  jobs: [
    {
      command: "bun run hr-commission:intents:post",
      schedule: {
        mode: "cron",
        expression: "* * * * *",
        backlog: "bounded"
      },
      purpose:
        "Drains the commission intake queue (Issue #1189, ADR-0147) into the accrual ledger: claims due intake rows per tenant (FOR UPDATE SKIP LOCKED, with a lease), posts each through the one existing posting core (accrueCommission / voidCommissionBySource) in its own tenant transaction with the stored actor, and settles the row as posted, refused (a business refusal: terminal, never retried) or, after a bounded number of transient errors, failed. A void that arrives before the accrual it reverses waits for it. Also purges settled rows past retention (posted 30 days, refused and failed 90). Audit rows, domain events and the transition log are the synchronous path's own; no amount reaches a log or an audit row.",
      recommendedSchedule: "Every minute via cron/systemd timer.",
      environmentNotes:
        "Database-only operation, no external network dependency. Runs as `awcms_app` (DATABASE_URL), NOT the worker: it posts accruals, and the payroll boundary lets only the request role touch them. The event consumer that feeds the queue is `awcms_worker` and holds INSERT on the intake table and nothing else. A tenant whose hr_commission module or `commission_intake_enabled` switch is off is not touched (its rows wait); retention housekeeping still runs. Bounded per-tenant passes in the maintenance work class; safe alongside request traffic and alongside a second instance (SKIP LOCKED plus a lease). `--dry-run` counts the due rows and the terminal rows past retention.",
      safeInOfflineLan: true
    }
  ],
  // No `dataLifecycle` descriptor for the rules, the accruals or the transitions,
  // deliberately: a descriptor must assert a retention period and an execution
  // mode, and nothing here purges them (no job, no function) and nobody in this
  // repository owns the period for records of earnings. The honest answer is the
  // `BOUNDED_BY_DESIGN` entries in scripts/data-lifecycle-table-coverage-check.ts:
  // retained for the life of the tenant, no period asserted. Asserting 2555-3650
  // days with a purge mode would be a claim about behaviour that does not exist.
  //
  // The INTAKE queue (#1189, ADR-0147) is different: it is transient, it has a
  // purge (the poster job), and its period is the ADR's (default 30 days, floor 7,
  // ceiling 90, to be confirmed by the owner).
  dataLifecycle: [
    {
      key: "hr_commission.intents",
      tableName: "awcms_hr_commission_intents",
      ownerModuleKey: HR_COMMISSION_MODULE_KEY,
      scope: "tenant",
      // `updated_at`, not `created_at`: the moment the row stopped moving.
      cursorColumn: "updated_at",
      retentionClass: "operational_queue",
      retentionMinDays: 7,
      retentionMaxDays: 90,
      defaultRetentionDays: 30,
      partition: {
        eligible: false,
        rationale:
          "A transient queue drained every minute, one row per submitted sale line, with terminal rows deleted after a short window: the live set stays small and no long history is kept to range-scan."
      },
      archive: {
        archivable: false,
        rationale:
          "The row is a derived copy of a sale's base amount and an employment id, awaiting posting. The BUSINESS record is the accrual in the ledger, retained for the life of the tenant; archiving the queue would copy earnings data into a second, longer-lived artifact for no purpose."
      },
      deletion: {
        mode: "hard_delete",
        rationale:
          "Only settled rows (`posted`, `refused`, `failed`) are deleted, by the poster job's own statement that names those statuses; a `pending` or `posting` row is work and the database refuses to delete it. The generic engine, which deletes purely by age, would drop unposted work, which is why this descriptor is delegated."
      },
      legalHold: { applicable: false, precedence: "not_applicable" },
      requiredIndexes: [
        {
          columns: ["tenant_id", "updated_at"],
          purpose:
            "awcms_hr_commission_intents_retention_idx (sql/316) — partial over the settled statuses, the purge's own path and the backlog count's."
        }
      ],
      batchLimit: 1000,
      backupRestoreNotes:
        "Included in ordinary full-database backup/restore; no standalone archive artifact exists. Restoring an old backup revives rows that were `pending` or `posting` at backup time: they are claimed again, and the ledger's unique key answers a request already posted as `replayed`, so nothing is accrued twice.",
      executionMode: "delegated",
      existingAdopter: {
        jobCommand: "bun run hr-commission:intents:post",
        purgeFunctionRef:
          "src/modules/hr-commission/application/hr-commission-intake-poster.ts#purgeTerminalIntents",
        description:
          "Deletes settled intake rows older than the retention window in bounded batches, after each posting pass. The worker cannot read the table, so the lifecycle engine's dry-run backlog snapshot goes through awcms_hr_commission_lifecycle_eligible_count (sql/316)."
      }
    },
    {
      key: "hr_commission.intake_settings",
      tableName: "awcms_hr_commission_intake_settings",
      ownerModuleKey: HR_COMMISSION_MODULE_KEY,
      scope: "tenant",
      cursorColumn: "created_at",
      retentionClass: "system_event",
      retentionMinDays: 365,
      retentionMaxDays: 3650,
      defaultRetentionDays: 1095,
      partition: {
        eligible: false,
        rationale:
          "One row per tenant, by primary key, upserted by an administrator and never appended by traffic: its ceiling is the number of tenants."
      },
      archive: {
        archivable: false,
        rationale:
          "No archive step exists or is warranted: the table is live configuration, one boolean."
      },
      deletion: {
        mode: "hard_delete",
        rationale:
          "Not performed by any job: a live configuration row, not a record. An age-based purge would silently switch off a tenant that enabled intake long ago, which is the healthy case, so no purge is declared."
      },
      legalHold: { applicable: false, precedence: "not_applicable" },
      requiredIndexes: [
        {
          columns: ["tenant_id"],
          purpose:
            "Primary key (tenant_id), sql/316; nothing scans this table by age."
        }
      ],
      batchLimit: 5000,
      backupRestoreNotes:
        "Included in ordinary full-database backup/restore. A restored row restores the switch as it was at backup time.",
      executionMode: "delegated",
      existingAdopter: {
        purgeFunctionRef:
          "none -- retained for the life of the tenant; see ADR-0147",
        description:
          "There is deliberately no purge mechanism; this descriptor exists so the table answers the retention question on the record rather than by silence. The worker holds only a column-level SELECT on it, so the dry-run snapshot goes through awcms_hr_commission_lifecycle_eligible_count (sql/316)."
      }
    }
  ],
  subjectData: [
    {
      key: "hr_commission.intents",
      tableName: "awcms_hr_commission_intents",
      ownerModuleKey: HR_COMMISSION_MODULE_KEY,
      // ADR-0142: the beneficiary is reached through the employment, never
      // through the actor stamp (the person who voided a sale).
      subjectColumns: [],
      subjectVia: {
        column: "employment_id",
        parentKey: "hr_workforce.employments",
        parentColumns: ["profile_id"]
      },
      exportable: false,
      erasure: "retain_under_obligation",
      rationale:
        "A TRANSIENT queue (#1189, ADR-0147): a sale's base amount and an employment id waiting to be posted, purged shortly after it settles (30 days by default). It reaches the beneficiary through `employment_id` -> `awcms_hr_employments` (`profile_id` only). It is NOT exported: it is a derived, short-lived copy of earnings data, and the person's earnings are answered by the settled accrual (`hr_commission.accruals`, exported behind the payroll boundary's own gate); handing a second copy out through a table that is outside the payroll family would bypass that gate. Not erased on request: a pending request is a payable claim the employer still owes, and an anonymised profile leaves the row resolving to no recognisable person. The `claimed_by_tenant_user_id` stamp (who the worker CLAIMED voided the sale; an attribute, never authoritative) resolves to nobody once the identity is anonymised. No name, identifier, contact or free text is stored (`reason` is a code)."
    },
    {
      key: "hr_commission.intake_settings",
      tableName: "awcms_hr_commission_intake_settings",
      ownerModuleKey: HR_COMMISSION_MODULE_KEY,
      subjectColumns: [
        { column: "updated_by", references: "tenant_user" },
        { column: "intake_actor_tenant_user_id", references: "tenant_user" }
      ],
      exportable: false,
      erasure: "severed_with_subject_row",
      rationale:
        "One row per tenant holding a boolean switch (`commission_intake_enabled`). It says nothing about a person; the only links are the stamp of whoever last changed it and the tenant user designated as the intake system actor, both of which resolve to nobody once the identity is anonymised."
    },
    {
      key: "hr_commission.rules",
      tableName: "awcms_hr_commission_rules",
      ownerModuleKey: HR_COMMISSION_MODULE_KEY,
      subjectColumns: [
        { column: "created_by", references: "tenant_user" },
        { column: "updated_by", references: "tenant_user" },
        { column: "published_by", references: "tenant_user" },
        { column: "retired_by", references: "tenant_user" }
      ],
      exportable: false,
      erasure: "retain_under_obligation",
      rationale:
        "The tenant's commercial terms; it names no customer, employee or other data subject. A person is linked only as an actor stamp (who drafted, edited, published or retired a version), which resolves to nobody once the identity is anonymised. A published or retired version is immutable by trigger and later accruals cite it, so the stamp is not rewritten and the row is retained with the records that depend on it."
    },
    {
      key: "hr_commission.accruals",
      tableName: "awcms_hr_commission_accruals",
      ownerModuleKey: HR_COMMISSION_MODULE_KEY,
      // ADR-0142 / Issue #1018: the beneficiary is reached through the
      // employment, never through the actor stamps (`created_by`,
      // `approved_by`, `released_by`, `paid_by`, `voided_by`), which name the
      // people who moved the accrual and would put every accrual a manager
      // approved into the manager's own export.
      subjectColumns: [],
      subjectVia: {
        column: "employment_id",
        parentKey: "hr_workforce.employments",
        parentColumns: ["profile_id"]
      },
      exportable: true,
      // The login stamped at birth for segregation of duties (sql/236). An
      // internal snapshot, not information for the subject, and after a corrected
      // mislink it can be somebody ELSE'S login: never handed out.
      redactedColumns: ["beneficiary_tenant_user_id"],
      erasure: "retain_under_obligation",
      rationale:
        "A person's commission EARNINGS. The row reaches the beneficiary through `employment_id` -> `awcms_hr_employments` (`profile_id` ONLY, Issue #1018: the login columns would also match a login mislinked to somebody else's employment), the indirect path ADR-0142 added to the subject-data model, so a person's own accrual history is part of their subject-access export and another person's is not. This table sits INSIDE the payroll data boundary, so the export route does not hand it out on `data_lifecycle.subject_request.export` alone: it requires the caller to ALSO hold `hr_commission.accruals.read`, withholds the table (and says so in the response) otherwise, and records the read as a sensitive read in the audit trail (Issue #1018). The actor stamps are deliberately not subject columns: they name the approver and the payer. No name, identifier, contact or free text is stored (`void_reason_code` is a code). The monetary facts are immutable by trigger and the row is undeletable, retained under the employer's labour, tax and social-security obligations (ADR-0132 section 13.2; the periods are the employer's counsel's, not asserted here), so an erasure could not rewrite them and does NOT follow the join; anonymising the profile leaves the row resolving to no recognisable person."
    },
    {
      key: "hr_commission.transitions",
      tableName: "awcms_hr_commission_transitions",
      ownerModuleKey: HR_COMMISSION_MODULE_KEY,
      subjectColumns: [
        { column: "actor_tenant_user_id", references: "tenant_user" }
      ],
      exportable: false,
      erasure: "retain_under_obligation",
      rationale:
        "The append-only log of who moved an accrual when: a status, a coded reason and the acting login. No amount and no beneficiary column (the accrual it belongs to carries those). NOT exported (Issue #1018): the row reaches the beneficiary only through its accrual, a SECOND hop that ADR-0142 deliberately does not provide, and it would add nothing about the beneficiary that the exported accrual does not already carry (the status, the timestamps and the void reason code are on the accrual itself); what it adds is who acted, and that is the actor's data. Append-only by trigger and privileges and retained with the ledger, so the stamp is not rewritten; the actor resolves to nobody once the identity is anonymised."
    }
  ]
});
