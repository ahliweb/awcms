/**
 * `hr_commission` — versioned commission rules (Issue #950, ADR-0132, phase 2 of
 * the `hr_workforce` / `hr_commission` / `hr_payroll` family;
 * `docs/awcms/hr-payroll.md` section 6).
 *
 * ## What this PR is (the foundation) and is not
 *
 * IS: the descriptor (`experimental`, i.e. the flag is OFF — there is no admin
 * screen yet, ADR-0021 criterion 1), `awcms_hr_commission_rules` (jurisdiction-
 * neutral, effective-dated, versioned: draft-only edits, immutable once
 * published, no overlapping published windows per rule — all enforced by the
 * database), the draft / publish / retire lifecycle API, and a PURE evaluation
 * function (`domain/hr-commission-evaluation.ts`) with exact `bigint` decimal
 * arithmetic and no expression language.
 *
 * IS NOT: the accrual ledger, its lifecycle (approve / release / pay), reversals,
 * the accrual port or any event (later issues of the same ADR); not affiliate
 * commission (hr-payroll.md 6.4); and **no** country's or jurisdiction's rules —
 * a tenant authors its own.
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
  version: "0.1.0",
  // `experimental` = the flag is OFF: no admin screen exists yet (ADR-0021
  // criterion 1 requires every ACTIVE module to declare one). The family's
  // rollout rule (docs/awcms/hr-payroll.md section 14) is "experimental until
  // its admin screens land".
  status: "experimental",
  description:
    "Versioned commission rules (Issue #950, ADR-0132): jurisdiction-neutral, tenant-authored terms saying how a share of a source amount becomes a commission — a percent of a base amount or a fixed amount per unit, in one currency, rounded under one explicit mode and scale, with an optional floor and ceiling. A rule changes only by a new version; the database enforces that a draft may be edited, a published or retired version is immutable (a published one may only become retired), no two published versions of one rule overlap (race-safe, advisory-locked), and no row is ever deleted. The version in force for an event is the one whose half-open window contains the event's own date, never now(). Evaluation is a pure function over bigint decimal strings: no float, no expression or script, no tiers, bounded by construction. Publish and retire are high-risk, separately grantable, idempotency-keyed and audited without any rate or amount; publish is bound to the content digest the reviewer saw and refuses the draft's creator and last editor (maker / checker), and a row is born a draft. A rule references no person or employment and carries no personal data. The accrual ledger, its approval lifecycle and the source-event port are later phases of the same ADR. No admin screen yet: the module stays experimental until one lands.",
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
    }
  ],
  // No `dataLifecycle` descriptor, deliberately: the table is not
  // high-volume (nothing traffic-generated lands in it) and a descriptor would
  // have to assert a retention period, which is the tenant's counsel's to set and
  // which nobody here owns. The honest answer is the `BOUNDED_BY_DESIGN` entry in
  // scripts/data-lifecycle-table-coverage-check.ts: retained indefinitely, never
  // purged, no period asserted.
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
    }
  ]
});
