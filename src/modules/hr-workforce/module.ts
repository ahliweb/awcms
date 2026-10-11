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
 * own through an `ownershipGrant`; permissions seeded by `sql/181`;
 * `data_lifecycle` and `subjectData` coverage.
 *
 * IS NOT: attendance, corrections, shifts, the staff-availability port,
 * commission or payroll (later issues of the same ADR), and **never** a photo,
 * biometric or device-fingerprint field (owner decision O6).
 *
 * ## Dependencies
 *
 * `tenant_admin` (offices, tenants) and `profile_identity` (the person). Audit
 * rows go through `logging`, the cross-cutting foundation every module may call.
 * `identity_access` is NOT a declared dependency: the chokepoint is reached
 * through the shared route factory (`defineTenantRoute`), not imported here.
 */
import {
  defineModule,
  type HighVolumeTableDescriptor
} from "../_shared/module-contract";
import { HR_WORKFORCE_MODULE_KEY } from "./domain/hr-workforce-permissions";

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
  personal: boolean;
}): HighVolumeTableDescriptor {
  return {
    key: input.key,
    tableName: input.tableName,
    ownerModuleKey: HR_WORKFORCE_MODULE_KEY,
    scope: "tenant",
    cursorColumn: "created_at",
    retentionClass: "system_event",
    retentionMinDays: 2555,
    retentionMaxDays: 3650,
    defaultRetentionDays: 3650,
    partition: { eligible: false, rationale: input.why },
    archive: {
      archivable: false,
      rationale:
        "No archive step exists or is warranted: the table is the employer's employment record, or live state. Archive-then-purge for HR rows is a recorded follow-up (docs/awcms/hr-payroll.md section 15)."
    },
    deletion: { mode: "hard_delete", rationale: input.deletionWhy },
    legalHold: {
      applicable: input.personal,
      precedence: input.personal ? "overrides_retention" : "not_applicable"
    },
    requiredIndexes: [
      {
        columns: input.indexColumns ?? ["tenant_id"],
        purpose:
          input.indexPurpose ??
          "Leading column of the table's primary key / unique keys (sql/180); nothing scans this table by age."
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
  version: "0.1.0",
  // `experimental` = the flag is OFF: no admin screen exists yet (ADR-0021
  // criterion 1 requires every ACTIVE module to declare one), and the module is
  // not enabled for a tenant until it is. The family's rollout rule
  // (docs/awcms/hr-payroll.md section 14) is "experimental until its admin
  // screens land".
  status: "experimental",
  description:
    "The employment context (Issue #945, ADR-0132): who works here, where, under whom and since when, for any module that schedules or books people. An employment REFERENCES a profile_identity party by composite foreign key and never copies its name, contact, birth date or national id, and no photo, biometric or device-fingerprint column exists anywhere (owner decision O6). Terms (office, manager, job title, employment type, status) are effective-dated and append-only: a change closes the open row and inserts the next, terms never overlap, the manager chain is acyclic and at most ten deep, and a terminated term is terminal. The database enforces one active employment per profile and per login, and refuses a profile merge between two actively employed profiles. An employee reads their own employment through an ownership grant on the persisted login link (the link itself is a high-risk, audited assign); everyone else needs employments.read. High-risk actions (create, terms change, assign, delete, restore, configure) are idempotent and audited without any name, title, number or account id. Attendance, shifts, the staff-availability port, commission and payroll are later phases of the same ADR. No admin screen yet: the module stays experimental until one lands.",
  dependencies: ["tenant_admin", "profile_identity"],
  type: "domain",
  api: {
    openApiPath: "openapi/modules/hr-workforce.openapi.yaml",
    basePath: "/api/v1/hr-workforce"
  },
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
  dataLifecycle: [
    retained({
      key: "hr_workforce.employments",
      tableName: "awcms_hr_employments",
      personal: true,
      why: "One row per employment, authored by an administrator, so its ceiling is the number of people a tenant has employed. It is the employer's record of a relationship and a trigger refuses DELETE.",
      deletionWhy:
        "Not performed and not permitted: awcms_app is denied DELETE and a trigger rejects it. An employment ends by a terminated term, or is soft-deleted when entered by mistake.",
      indexColumns: ["tenant_id", "created_at"],
      indexPurpose:
        "awcms_hr_employments_list_idx (sql/180) — the newest-first listing and any future bounded archive scan."
    }),
    retained({
      key: "hr_workforce.employment_terms",
      tableName: "awcms_hr_employment_terms",
      personal: true,
      why: "One row per change of terms, authored by an administrator, so its ceiling is employments times changes. Append-only: the only UPDATE closes the open row.",
      deletionWhy:
        "Not performed and not permitted: history is append-only, awcms_app is denied DELETE and a trigger rejects it.",
      indexColumns: ["tenant_id", "employment_id", "effective_from"],
      indexPurpose:
        "awcms_hr_employment_terms_employment_idx (sql/180) — the per-employment history read."
    }),
    retained({
      key: "hr_workforce.settings",
      tableName: "awcms_hr_workforce_settings",
      personal: false,
      why: "One row per tenant, upserted. An age-based purge would silently reset the tenant's configuration for being old.",
      deletionWhy:
        "Not performed. The row is the tenant's own configuration; deleting it would silently restore the defaults."
    })
  ],
  subjectData: [
    {
      key: "hr_workforce.employments",
      tableName: "awcms_hr_employments",
      ownerModuleKey: HR_WORKFORCE_MODULE_KEY,
      subjectColumns: [
        { column: "profile_id", references: "profile" },
        { column: "tenant_user_id", references: "tenant_user" },
        { column: "created_by", references: "tenant_user" },
        { column: "updated_by", references: "tenant_user" },
        { column: "deleted_by", references: "tenant_user" },
        { column: "restored_by", references: "tenant_user" }
      ],
      exportable: true,
      erasure: "retain_under_obligation",
      rationale:
        "The employer's record that a person was employed: employee number, hire and end dates, and the login that is the employee. It REFERENCES the party (`profile_id`) and copies none of its identity, which `profile_identity` owns, exports and anonymises. It is exported (the employee number and dates are the subject's own data) and retained under the employer's labour, tax and social-security obligations (ADR-0132 section 13.2; the periods are the employer's counsel's, not asserted here). Nothing in this module nulls `profile_id` on anonymisation: the link REMAINS but points at a profile whose name `profile_identity` has overwritten, so the row resolves to no recognisable person. The employee number is an HR identifier, not a national id, and stays."
    },
    {
      key: "hr_workforce.employment_terms",
      tableName: "awcms_hr_employment_terms",
      ownerModuleKey: HR_WORKFORCE_MODULE_KEY,
      subjectColumns: [{ column: "created_by", references: "tenant_user" }],
      exportable: false,
      erasure: "retain_under_obligation",
      rationale:
        "The effective-dated history of where an employee worked, under whom and in what status. The row reaches the person only through `employment_id` (an employment), which the registry's direct subject columns cannot express, so the descriptor names only the actor stamp. The subject's own history remains readable through the ownership-granted GET /api/v1/hr-workforce/employments/{id}/terms. Append-only by trigger and retained under the employer's legal obligations (ADR-0132 section 13.2), so an erasure could not rewrite it; the anonymised profile makes the history resolve to nobody. A direct employment-to-subject join in the export is a recorded follow-up."
    }
  ]
});
