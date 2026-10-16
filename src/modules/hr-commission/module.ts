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
 * commission is NOT here. Reversal and the `awcms.hr.commission.*` events are
 * later phases. The rest of this header describes the rule foundation (#950).
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
import { HR_COMMISSION_MODULE_KEY } from "./domain/hr-commission-permissions";

export const hrCommissionModule = defineModule({
  key: HR_COMMISSION_MODULE_KEY,
  name: "HR Commission",
  version: "0.2.0",
  // Commission accruals are monetary pay facts: payroll data by any reading
  // (ADR-0132). Declared so that no channel that must keep payroll off it (the
  // Telegram registry and its CI gate, ADR-0140) has to guess from a name.
  handlesPayrollData: true,
  // `experimental` = the flag is OFF: no admin screen exists yet (ADR-0021
  // criterion 1 requires every ACTIVE module to declare one). The family's
  // rollout rule (docs/awcms/hr-payroll.md section 14) is "experimental until
  // its admin screens land".
  status: "experimental",
  description:
    "Versioned commission rules (Issue #950, ADR-0132): jurisdiction-neutral, tenant-authored terms saying how a share of a source amount becomes a commission — a percent of a base amount or a fixed amount per unit, in one currency, rounded under one explicit mode and scale, with an optional floor and ceiling. A rule changes only by a new version; the database enforces that a draft may be edited, a published or retired version is immutable (a published one may only become retired), no two published versions of one rule overlap (race-safe, advisory-locked), and no row is ever deleted. The version in force for an event is the one whose half-open window contains the event's own date, never now(). Evaluation is a pure function over bigint decimal strings: no float, no expression or script, no tiers, bounded by construction. Publish and retire are high-risk, separately grantable, idempotency-keyed and audited without any rate or amount; publish is bound to the content digest the reviewer saw and refuses the draft's creator and last editor (maker / checker), and a row is born a draft. A rule references no person or employment and carries no personal data. Issue #951 adds the accrual LEDGER: a commission earned by an employment from a source event is one row whose monetary facts (rule version, inputs, rate snapshot, amount, currency, instants) are immutable by trigger and whose status advances pending -> approved -> payable -> paid, or to voided from pending or approved (a voided accrual can never be paid); the transition log is append-only and written only by the accrual's own triggers, so status and log cannot diverge and a reconciliation proves it. The same source for the same employment is accrued exactly once (a database unique key, race-safe), a downstream adapter reports a sale through a neutral port (this module imports nothing from commerce) and a redelivery returns the original; the amount is computed from the published rule in force on the event's own date and can never be asserted by the caller; the employment and rule are validated under FOR SHARE by trigger; the beneficiary cannot approve their own accrual. Approve, release, void and pay are high-risk, separately grantable, idempotency-keyed and audited without any amount. A back-dated publish of a rule now needs a stated reason. Employee commission only (not affiliate); reversal and events are later phases. No admin screen yet: the module stays experimental until one lands.",
  dependencies: ["tenant_admin", "hr_workforce"],
  type: "domain",
  api: {
    openApiPath: "openapi/modules/hr-commission.openapi.yaml",
    basePath: "/api/v1/hr-commission"
  },
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
      activityCode: "accruals",
      action: "pay",
      description:
        "Record that a payable commission accrual has been paid — audited, high-risk"
    }
  ],
  // No `dataLifecycle` descriptor for ANY of the three tables, deliberately: a
  // descriptor must assert a retention period and an execution mode, and nothing
  // here purges (no job, no function) and nobody in this repository owns the
  // period for records of earnings. The honest answer is the `BOUNDED_BY_DESIGN`
  // entries in scripts/data-lifecycle-table-coverage-check.ts: retained for the
  // life of the tenant, no period asserted. Asserting 2555-3650 days with a purge
  // mode would be a claim about behaviour that does not exist.
  subjectData: [
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
