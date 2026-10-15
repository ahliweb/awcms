🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0142-subject-data-reaches-a-table-through-its-parent-row.id.md)

# ADR-0142 — A subject-data descriptor may reach the person through ONE parent row

- **Status:** Accepted
- **Date:** 2026-10-15
- **Decision maker:** @ahliweb
- **Related:** Issue #985 (this ADR and its implementation; follow-up of #945 and #946); [ADR-0094](0094-a-data-subject-is-answered-per-tenant.md) (the subject-data model this extends); [ADR-0108](0108-what-an-export-withholds-and-what-an-erasure-destroys-are-different-questions.md) (the erasure semantics this must not weaken); [ADR-0132](0132-hr-payroll-module-family-admission.md) §13.2 (the employer's retention obligations over HR rows)

## Context

A `SubjectDataDescriptor` names the **columns of the table itself** that hold the person's id (`tenant_user`, `identity`, `profile`). Two `hr_workforce` tables do not have any:

- `awcms_hr_employment_terms` (#945) and `awcms_hr_shift_assignments` (#946) carry `employment_id`, and only the employment names the person (`awcms_hr_employments.profile_id` / `tenant_user_id`).

So both descriptors could only name their **actor stamps** (`created_by`, `published_by`, `cancelled_by`) and had to answer `exportable: false`. A subject-access export therefore omitted the employee's own terms history, scheduled shifts and time off. That is the failure ADR-0094 exists to prevent: a report that is complete in shape and silent about a table that holds the person's data.

## Decision

### 1. A descriptor may name ONE parent hop

`SubjectDataDescriptor.subjectVia?: SubjectDataJoin` (`MODULE_CONTRACT_VERSION` **4.6.0**, MINOR: purely additive, and omitting it means what every descriptor already meant):

```ts
subjectVia: {
  column: "employment_id",                       // FK column on THIS table
  parentKey: "hr_workforce.employments",         // another descriptor's key
  parentColumns: ["profile_id", "tenant_user_id"] // which of the PARENT's subject columns say "about the person"
}
```

The planner resolves it to `column IN (SELECT id FROM <parent> WHERE tenant_id = $1 AND (<parent column> = <subject id> OR ...))`. The tenant predicate is written inside the subquery as well as outside (the repo's rule: never lean on RLS alone). Soft-deleted parents are not filtered out: a terminated employment is still the person's history.

It is **one hop** and not a graph: a second hop would be a join planner on the privacy path, and no table in this schema needs it. The gate refuses a parent that itself uses `subjectVia`.

### 2. `parentColumns` is explicit, and the child's own `subjectColumns` must be empty

The parent's subject columns mix identity columns (`profile_id`) with actor stamps (`created_by`). Following all of them, or OR-ing the child's own `created_by` with the join, would put **other people's rows into the export of whoever recorded them**: an HR administrator's request would return the full terms history and rosters of every employee they entered. That is a disclosure bug in the direction that matters most for this feature. So:

- the descriptor names exactly which parent columns mean "this row is about the person";
- `subjectVia` and `subjectColumns` are **mutually exclusive** (gate-enforced). The child's stamps stay described in its `rationale`, and are answered like any other stamp: they resolve to nobody once `awcms_identities` is anonymised.

### 3. Erasure does NOT follow the join

A `subjectVia` descriptor must answer `retain_under_obligation` (gate-enforced), the planner's `erasureTargets` excludes it, and the executor throws if it is ever handed one.

| Option                                                              | Verdict                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Export follows the join; erasure does not (chosen)**           | Disclosure is read-only and the join cannot lose data. Both HR tables are append-only or immutable by trigger and retained under the employer's labour and pay obligations (ADR-0132 §13.2); the anonymised profile already makes the history resolve to nobody.                                   |
| B. Erasure also follows the join (anonymise or delete via the join) | Rejected for now. It is a different and more dangerous operation: an `UPDATE`/`DELETE` selected through another table. Neither HR table has a column to anonymise (no free text), the rows are evidence, and a mistake destroys payroll-relevant history. A table that needs it earns its own ADR. |
| C. Leave both tables non-exportable                                 | Rejected: the employee's own data is the subject of the request, and the gap would block `hr_workforce` leaving `experimental`.                                                                                                                                                                    |

### 4. The gate proves the join is real

`subject-data:registry:check` refuses: a join column the table lacks; one that is not a foreign key to the parent's table (a join over an unrelated uuid reads zero rows or the wrong ones and still "succeeds"); an unknown or global or unreachable or itself-joined parent; `parentColumns` that are empty or that the parent did not declare as subject columns; `subjectVia` together with `subjectColumns`; any erasure other than `retain_under_obligation`.

## Consequences

- **Positive:** the two tables are `exportable: true`; an employee's export carries their own terms history and shifts and nothing of anyone else's (integration test over a real database, RLS in force: own rows, colleague excluded, recorder excluded, other tenant excluded, erasure leaves the rows).
- **Negative:** the model gains a second matching shape for the planner, the executor and the gate to keep consistent, and a table with a `subjectVia` cannot take part in an erasure. Both costs are deliberate and bounded to one hop.
- **Neutral:** `MODULE_CONTRACT_VERSION` 4.5.0 -> 4.6.0 and the family manifest follow it. No migration. The `hr_workforce` attendance tables (`awcms_hr_attendance_events`, `awcms_hr_attendance_corrections`) have the same shape and stay `exportable: false`: a correction carries a sensitive free-text reason, and exposing it is its own decision, now one descriptor edit away.
- **Not changed:** the direct-column behaviour of every existing descriptor, including `awcms_hr_employments`, whose own actor stamps (`created_by` ...) still match the HR user who created an employment. That is existing behaviour of direct stamps in this registry and is recorded as an open question, not altered here.

## Alternatives considered

- **A generic join language (several hops, arbitrary predicates)** - rejected (§1): a query planner on the privacy path.
- **Put `employment_id` into a new `references` member** (`"employment"`) - rejected: it would bake one module's table into the shared contract and the registry's `REFERENCE_TARGET_TABLE`.
- **Copy `profile_id` onto the child tables** - rejected: a migration that denormalises a person link onto append-only evidence, kept consistent by a trigger, to avoid a one-hop subquery.
