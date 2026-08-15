🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0094-a-data-subject-is-answered-per-tenant.id.md)

# ADR-0094 — A data subject is answered PER TENANT, and every table answers for itself

- **Status:** Accepted (2026-08-13).
- **Context:** Issue #542, from
  [`privacy-analysis.md`](../awcms/privacy-analysis.md) §4, which places
  per-subject export and per-subject deletion in the **gap** column, not as a
  reduction of coverage.
- **Builds on:**
  [ADR-0037](0037-data-lifecycle-module-admission.md) (per-table retention
  descriptors, declared by their owner, read by a single engine),
  [ADR-0076](0076-infrastructure-tables-may-hold-lifecycle-descriptors.md)
  (tables owned by `src/lib/` get a SECOND registry),
  [ADR-0087](0087-mfa-moves-to-the-principal.md) (a principal is GLOBAL, and
  reaching outside a tenant is a platform action), and
  [ADR-0003](0003-postgresql-rls-multi-tenant.md) (FORCE RLS).

## Why an ADR, and why not a single endpoint

A data subject spreads across identity, profiles, sessions, audit, the decision
log, comments, form drafts, media, and analytics — nine modules with different
table owners and different retention rules. Writing the table list by hand in
one module will drift **silently** with the next module that lands: exactly the
class of defect that gave birth to the `data-lifecycle:table-coverage:check`
gate (#437).

So the shape is the one already proven: **every table answers its own question,
and a gate makes "not answering" impossible.** The new question is one sentence
— _how does this table answer about a subject_ — and the only answer that is not
accepted is silence.

## Decision 1 — The subject is the TENANT USER, and the request is answered PER TENANT

Not the global `awcms_principals`.

This is the first Definition of Ready question, and this repo has already paid
for it twice: **ADR-0087 and ADR-0088 both planned a cross-tenant read that
FORCE RLS forbids**, and both were only caught at implementation time. An export
for one principal across every tenant is the same plan for the third time.

And RLS here is not merely a technical obstacle to be worked around — it
**models the right thing**. Each tenant is a separate data controller. One
controller must not hand over data held by another controller, and a human being
who is a member of three tenants genuinely has three different relationships.
Answering per tenant is not a compromise; it is the correct answer, which also
happens to be the only one that can be written.

The consequence is stated bluntly: **there is no single button that answers
"forget me everywhere"**, and nothing may pretend there is.

## Decision 2 — Deletion ANONYMISES by default, and a table that declares otherwise must justify it

An audit row referencing an actor is a foreign key, and deleting it deletes the
evidence that something happened — including the evidence that the deletion
itself happened.

The vocabulary already exists in `LifecycleDeletionMode` and is reused, not
reinvented: `hard_delete`, `anonymize`, `status_transition_then_purge`, plus one
specific to this question — `retain_under_obligation`, for rows that genuinely
must not be deleted (a statutory obligation, an active legal hold).
"Delete everything" is not what the law says, and a descriptor that pretends it
is would lie to the operator who trusts it.

The default is `anonymize` because the direction of error is asymmetric:
anonymising a row that could actually have been deleted leaves a row with nobody
in it, while deleting a row that should have been anonymised destroys an audit
trail that cannot be recovered.

## Decision 3 — Export and deletion are TWO authorities, and deletion is maker/checker

Export is disclosure: anyone who can export any subject can exfiltrate the whole
user base one request at a time. It is gated by its own permission, and every
export is **audited as a disclosure**, not as a read.

Deletion cannot be undone. It is high-risk, demands a reason, is audited
`critical`, and becomes a **maker/checker** pair through the existing SoD
registry — the very engine that just got its inbox in #545, so its checker has
somewhere to see what is waiting instead of being told through a channel outside
the system.

## What lands in this PR, and what does NOT

Issue #542 says itself that this is not one PR. What lands is the FOUNDATION —
the shape that makes the rest mechanical, and the gate that makes it impossible
for the next module to forget:

| Lands                                                             | Not yet                      |
| ----------------------------------------------------------------- | ---------------------------- |
| `SubjectDataDescriptor` in the module contract                    | the export endpoint          |
| `subject-data:coverage:check` — every `awcms_*` table must ANSWER | the deletion endpoint        |
| a shrink-only ledger for tables that predate the rule             | the admin screen             |
| the first wave of descriptors                                     | permissions + seed migration |
| a pure planner that assembles a subject's table list              | the executor                 |

The reason for the ordering is not convenience. An endpoint that landed first
would export **the tables its author happened to remember**, and stay silent
about the rest — a complete report that is not complete is a worse failure than
having no report at all, because it is signed. The gate lands first so that
completeness becomes a forced property, not a claimed one.

## Rejected

- **One endpoint that knows everything.** A hand-written table list that drifts
  silently with the next module — the same defect that gave birth to `#437`.
- **Subject = `awcms_principals`, answered across tenants.** FORCE RLS forbids
  it, TWO ADRs have already slipped on exactly that, and it is also
  substantively wrong: one controller handing over another controller's data.
- **`hard_delete` as the default.** Deleting an audit row deletes the evidence
  that the deletion happened.
- **One permission for both export and deletion.** Disclosure and destruction
  are two different things, and neither implies the other.
- **Waiting until everything is ready.** A gate with no endpoint still closes
  the most expensive gap — the next module landing with a personal-data table
  and nobody knowing.
