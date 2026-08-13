/**
 * What a subject-access or erasure request would touch — ADR-0094, Issue #542.
 *
 * Pure: descriptors in, a plan out. No database, no SQL, no I/O. The executor
 * that will eventually run this plan is a separate PR, and it is separate on
 * purpose — the interesting part is not "does it read the table" but WHICH
 * tables the plan contains and how each one binds to the person, and that is
 * where an omission becomes a report that is signed and wrong.
 *
 * ## Two ids, and neither is the global principal
 *
 * ADR-0094 Decision 1: the subject is a TENANT USER, answered per tenant. A row
 * reaches that person one of two ways — `tenant_user_id` or, for the login
 * surface, `identity_id` — and the descriptor says which. A planner that
 * assumed one would bind the wrong value to half the schema and return nothing,
 * silently, which is the worst possible failure for this feature.
 *
 * `awcms_principals` is deliberately absent from every plan. It is global; the
 * tables here are behind FORCE RLS in one tenant. A plan that named it would
 * describe a read the database refuses — the trap ADR-0087 and ADR-0088 each
 * fell into once.
 */
import type {
  SubjectDataDescriptor,
  SubjectDataErasure
} from "../../_shared/module-contract";

export type SubjectIdentifiers = {
  tenantId: string;
  tenantUserId: string;
  /** The identity behind the membership — `awcms_tenant_users.identity_id`. */
  identityId: string;
};

export type SubjectPlanEntry = {
  key: string;
  tableName: string;
  ownerModuleKey: string;
  tenantColumn: string;
  /** One per subject column, already resolved to the VALUE it must be bound to. */
  matches: readonly { column: string; value: string }[];
  exportable: boolean;
  erasure: SubjectDataErasure;
  redactedColumns: readonly string[];
  rationale: string;
};

export type SubjectPlan = {
  /** Every table that has something to say about this person, sorted by key. */
  entries: readonly SubjectPlanEntry[];
  /** Of those, the ones a portability export carries. */
  exportEntries: readonly SubjectPlanEntry[];
  /** Of those, the ones an erasure would leave ALONE, and why. */
  retainedEntries: readonly SubjectPlanEntry[];
};

/**
 * `tenant_id` unless the descriptor names another column. A descriptor with no
 * tenant column at all is a GLOBAL table, and a global table has no place in a
 * per-tenant plan — it is dropped, and the caller finds out by comparing
 * counts rather than by a row appearing in the wrong tenant's report.
 */
function tenantColumnOf(descriptor: SubjectDataDescriptor): string {
  return descriptor.tenantColumn ?? "tenant_id";
}

export function buildSubjectPlan(
  descriptors: readonly SubjectDataDescriptor[],
  subject: SubjectIdentifiers
): SubjectPlan {
  const entries = descriptors
    .map((descriptor): SubjectPlanEntry => {
      const matches = descriptor.subjectColumns.map((subjectColumn) => ({
        column: subjectColumn.column,
        value:
          subjectColumn.references === "identity"
            ? subject.identityId
            : subject.tenantUserId
      }));

      return {
        key: descriptor.key,
        tableName: descriptor.tableName,
        ownerModuleKey: descriptor.ownerModuleKey,
        tenantColumn: tenantColumnOf(descriptor),
        matches,
        exportable: descriptor.exportable,
        erasure: descriptor.erasure,
        redactedColumns: descriptor.redactedColumns ?? [],
        rationale: descriptor.rationale
      };
    })
    // A descriptor with no subject column joins to nobody, so it would produce
    // a table in the report with every row of the tenant in it. Dropped rather
    // than trusted — the registry gate is what should have caught it, and this
    // is the second line.
    .filter((entry) => entry.matches.length > 0)
    .sort((a, b) => a.key.localeCompare(b.key));

  return {
    entries,
    exportEntries: entries.filter((entry) => entry.exportable),
    retainedEntries: entries.filter(
      (entry) => entry.erasure === "retain_under_obligation"
    )
  };
}

/**
 * Every column a report must never carry, across the whole plan.
 *
 * Assembled here rather than left to each caller because "redact the token
 * hash" is the kind of rule that is applied on the first pass and forgotten on
 * the CSV exporter added six months later.
 */
export function redactedColumnsByTable(
  plan: SubjectPlan
): ReadonlyMap<string, readonly string[]> {
  return new Map(
    plan.entries
      .filter((entry) => entry.redactedColumns.length > 0)
      .map((entry) => [entry.tableName, entry.redactedColumns])
  );
}
