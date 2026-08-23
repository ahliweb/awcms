/**
 * What a subject-access or erasure request would touch — ADR-0094, Issue #542.
 *
 * Pure: descriptors in, a plan out. No database, no SQL, no I/O. The executor
 * that will eventually run this plan is a separate PR, and it is separate on
 * purpose — the interesting part is not "does it read the table" but WHICH
 * tables the plan contains and how each one binds to the person, and that is
 * where an omission becomes a report that is signed and wrong.
 *
 * ## Three ids, and none of them is the global principal
 *
 * ADR-0094 Decision 1: the subject is a TENANT USER, answered per tenant. A row
 * reaches that person one of three ways — `tenant_user_id`, `identity_id` for
 * the login surface, or `profile_id` for the person record — and the descriptor
 * says which. A planner that assumed one would bind the wrong value to a third
 * of the schema and return nothing, silently, which is the worst possible
 * failure for this feature.
 *
 * The third was added in wave 2 (Issue #557) and was not optional: nothing on
 * `awcms_profiles` carries either of the first two ids, because the link runs
 * the other way, from `awcms_identities.profile_id`. With two ids the person's
 * own name and contact details were unreachable.
 *
 * `awcms_principals` is deliberately absent from every plan's READS. It is
 * global; the tables here are behind FORCE RLS in one tenant. A plan that
 * queried it would describe a read the database refuses — the trap ADR-0087 and
 * ADR-0088 each fell into once. Wave 2 stopped short of silence, though: it is
 * named in `unansweredEntries`, so the report states the boundary rather than
 * leaving a gap that looks like completeness.
 */
import type {
  SubjectDataColumn,
  SubjectDataDescriptor,
  SubjectDataErasure
} from "../../_shared/module-contract";

export type SubjectIdentifiers = {
  tenantId: string;
  tenantUserId: string;
  /** The identity behind the membership — `awcms_tenant_users.identity_id`. */
  identityId: string;
  /**
   * The person record behind the identity — `awcms_identities.profile_id`.
   *
   * A THIRD id, resolved by following one more hop, because the link runs
   * towards `awcms_profiles` rather than out of it: nothing on that table
   * carries a tenant-user or identity id, so without this the person's own
   * name and contact details are unreachable.
   */
  profileId: string;
};

export type SubjectPlanEntry = {
  key: string;
  tableName: string;
  ownerModuleKey: string;
  tenantColumn: string;
  /** One per subject column, already resolved to the VALUE it must be bound to. */
  matches: readonly {
    column: string;
    value: string;
    match: "equals" | "jsonb_array_contains";
  }[];
  exportable: boolean;
  erasure: SubjectDataErasure;
  /** Never exported. */
  redactedColumns: readonly string[];
  /** Overwritten by an `anonymize` erasure — a DIFFERENT question, see the descriptor. */
  anonymizedColumns: readonly string[];
  rationale: string;
};

export type SubjectPlan = {
  /** Every table that has something to say about this person, sorted by key. */
  entries: readonly SubjectPlanEntry[];
  /** Of those, the ones a portability export carries. */
  exportEntries: readonly SubjectPlanEntry[];
  /** Of those, the ones an erasure would leave ALONE, and why. */
  retainedEntries: readonly SubjectPlanEntry[];
  /**
   * Tables that hold something about this person and are deliberately NOT
   * answered here — either global (`tenantColumn: null`, ADR-0094 Decision 1
   * answers per tenant) or unreachable (no column a subject can be matched on).
   *
   * Carried in the plan rather than dropped on the floor. A per-tenant report
   * that simply omits `awcms_principals` is indistinguishable from one written
   * before that table existed; a report that NAMES it and says why is a report
   * a data-protection officer can actually act on. The two reasons share one
   * list because they answer the same question for the reader — what this
   * report does not cover — and splitting them would let a section go
   * unnoticed.
   */
  unansweredEntries: readonly SubjectUnansweredEntry[];
};

/** A table excluded from the per-tenant answer, kept so the answer can say so. */
export type SubjectUnansweredEntry = {
  key: string;
  tableName: string;
  ownerModuleKey: string;
  reason: "global" | "no_subject_column";
  rationale: string;
};

const TENANT_COLUMN_DEFAULT = "tenant_id";

/** Every `references` value the planner can actually bind — all but `principal`. */
type BindableColumn = SubjectDataColumn & {
  references: Exclude<SubjectDataColumn["references"], "principal">;
};

/**
 * Which of the subject's ids each `references` value binds.
 *
 * A lookup table rather than a chain of ternaries, because a ternary chain has
 * a last `else` and that `else` is a wrong answer waiting for the next member
 * of the union: adding `"profile"` to a two-branch conditional would have bound
 * the tenant-user id to `awcms_profiles.id` — a valid uuid, no error, and every
 * profile query returning nothing. `principal` is filtered out before this map
 * is reached (see below) and deliberately has no entry.
 */
const SUBJECT_ID_OF: Record<
  BindableColumn["references"],
  (subject: SubjectIdentifiers) => string
> = {
  tenant_user: (subject) => subject.tenantUserId,
  identity: (subject) => subject.identityId,
  profile: (subject) => subject.profileId
};

/**
 * A type predicate rather than a plain `!==`, so `SUBJECT_ID_OF` stays a total
 * map over what reaches it. A cast here would compile just as well and would
 * silently keep compiling on the day a fifth `references` member is added with
 * no entry in the map — which is the whole failure this lookup replaced.
 */
function isBindableColumn(column: SubjectDataColumn): column is BindableColumn {
  return column.references !== "principal";
}

export function buildSubjectPlan(
  descriptors: readonly SubjectDataDescriptor[],
  subject: SubjectIdentifiers
): SubjectPlan {
  // `null` is global and stated on purpose; `undefined` is the ordinary
  // tenant-scoped table. Splitting on `=== null` rather than on falsiness is
  // what keeps the two apart — see `SubjectDataDescriptor.tenantColumn`.
  const isGlobal = (descriptor: SubjectDataDescriptor): boolean =>
    descriptor.tenantColumn === null;
  const isUnanswered = (descriptor: SubjectDataDescriptor): boolean =>
    isGlobal(descriptor) || descriptor.unreachableBySubject === true;

  const unansweredEntries = descriptors
    .filter(isUnanswered)
    .map((descriptor): SubjectUnansweredEntry => ({
      key: descriptor.key,
      tableName: descriptor.tableName,
      ownerModuleKey: descriptor.ownerModuleKey,
      // Global wins when a descriptor is somehow both: it is the stronger
      // statement, and the one that explains why no per-tenant read is even
      // attempted.
      reason: isGlobal(descriptor) ? "global" : "no_subject_column",
      rationale: descriptor.rationale
    }))
    .sort((a, b) => a.key.localeCompare(b.key));

  const entries = descriptors
    .filter((descriptor) => !isUnanswered(descriptor))
    .map((descriptor): SubjectPlanEntry => {
      const matches = descriptor.subjectColumns
        // `principal` is global-only (`subject-data:registry:check` enforces
        // it) and there is no principal id in `SubjectIdentifiers` to bind —
        // ADR-0094 Decision 1. Dropped rather than defaulted: falling through
        // to `tenantUserId`, as a two-branch ternary silently would, binds a
        // tenant-user id to a principal column and reads zero rows forever.
        .filter(isBindableColumn)
        .map((subjectColumn) => ({
          column: subjectColumn.column,
          value: SUBJECT_ID_OF[subjectColumn.references](subject),
          match: subjectColumn.match ?? ("equals" as const)
        }));

      return {
        key: descriptor.key,
        tableName: descriptor.tableName,
        ownerModuleKey: descriptor.ownerModuleKey,
        tenantColumn: descriptor.tenantColumn ?? TENANT_COLUMN_DEFAULT,
        matches,
        exportable: descriptor.exportable,
        erasure: descriptor.erasure,
        redactedColumns: descriptor.redactedColumns ?? [],
        anonymizedColumns: descriptor.anonymizedColumns ?? [],
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
    ),
    unansweredEntries
  };
}

/**
 * The tables an erasure actually has to WRITE to.
 *
 * `severed_with_subject_row` is the majority answer in this schema and it means
 * "nothing here" — the stamp stops resolving to a person when
 * `awcms_identities` is anonymised. Filtering it out is therefore not an
 * optimisation: an executor that rewrote those ~90 stamp columns would erase
 * the tenant's own record of who deleted a page in order to remove a link that
 * was already unresolvable.
 *
 * `retain_under_obligation` is excluded for the opposite reason — it is a
 * decision, not an omission, and `SubjectPlan.retainedEntries` is where the
 * report reads it back.
 */
export function erasureTargets(plan: SubjectPlan): readonly SubjectPlanEntry[] {
  return plan.entries.filter(
    (entry) =>
      entry.erasure !== "retain_under_obligation" &&
      entry.erasure !== "severed_with_subject_row"
  );
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
