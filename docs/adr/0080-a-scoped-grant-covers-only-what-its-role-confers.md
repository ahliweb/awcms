🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0080-a-scoped-grant-covers-only-what-its-role-confers.id.md)

# ADR-0080 — A scoped grant covers only what its role confers

- **Status:** Accepted (2026-08-10).
- **Context:** Issue #423 Wave 3 PR 3.4. No migration.
- **Builds on:** [ADR-0078](0078-a-grant-carries-its-own-scope.md) (a grant
  carries its own scope) and [ADR-0079](0079-the-legacy-grant-table-becomes-read-only-history.md)
  (one source of grants). Widens the business-scope layer of
  [ADR-0060](0060-business-scope-hierarchy-provided-by-tenant-admin.md) without
  changing the #180 contract.

## Decision

`BusinessScopeFact` gains one optional field, `permissionKeys`, and the coverage
predicate in `evaluateAccess` gains one clause:

```ts
if (!scopeFactQualifies(fact, requiredKey)) return false;
```

A row in `awcms_access_policies` whose `scope_type` is NOT tenant-wide now
produces a scoped fact, carrying exactly the permission keys its role confers. A
fact originating from `awcms_business_scope_assignments` carries
`permissionKeys: undefined` and behaves exactly as before.

## The whole security argument fits in four lines

`scopeFactQualifies` has no branch that produces coverage. The only value it can
contribute is `false`. Therefore **no input, in any order, can turn a deny into
an allow through this field** — and that can be checked by reading, not by
trusting.

The rest is proved as a property, not by example: `tests/scope-narrowing.test.ts`
runs a corpus (6 fact shapes × 5 relation sets × 2 actions × 4 key sets) and
asserts that the qualified answer is never `true` where the unqualified answer is
`false` — plus one assertion that the corpus is **not vacuous**, because a clause
that does nothing satisfies the first property perfectly.

## The clause comes FIRST, before `tenantWide`

A tenant-wide fact covers every requested scope. If the clause were placed after
it, a tenant-wide fact carrying keys would cover permissions its role does not
confer — merely because it covers all scopes. It is ordering, not filtering, that
makes this correct, so it is asserted rather than left to the reader.

## A tenant-wide grant does NOT produce a fact

This is the direction that becomes a blanket widening if it is wrong. A
tenant-wide grant is the **absence** of a scope confinement, not a confinement to
a scope named "tenant". Producing a `tenantWide` fact from it would hand the #180
gate's answer to everyone holding any role at all.

What a tenant-wide grant does to a required-scope check stays what it is today:
nothing. `tests/integration/scope-qualification` asserts that as its first test.

## A build-time kill switch, not an env var

Two instances of one deployment reading the same env var can still disagree —
rolling restarts, a stale container, a forgotten `--env-file` — and an
authorization rule that is on in one pod and off in another is a rule whose
answer depends on which socket received the request. The policy cache is already
per-process for exactly this reason.

`SCOPE_NARROWING_ENABLED` is therefore a build-time constant. Flipping it means a
code change and a redeploy — which is the point: it is not an operational knob,
it is a rollback that leaves a commit behind.

Both of its states are TESTED (`scopeFactQualifies` takes the flag as a
parameter), so the off state is not a state that has never been run.

## The limit that MUST be read before its writer surface is built

Scope qualification is only as strong as the routes that **declare** a required
scope.

`fetchGrantedPermissionKeys` returns keys from ALL grants, including scoped ones,
and it has to: the RBAC gate runs first, so a key that is not there makes the
scoped path unreachable. The consequence is that on a route that declares no
scope, a scoped grant confers that permission across the whole tenant.

Today that is inert — nothing writes scoped grants. But the PR that builds the
admin surface to write them **must not land without answering** that question,
because an admin creating a "one-office editor" will believe they have confined
that person, and on every route that declares no scope they have not. That is why
the programme plan puts the resolver BEFORE the writers, and why that ordering is
kept here.

## What was REJECTED

1. **Changing the return type of `fetchGrantedPermissionKeys` to
   `{ keys, scopes }`** as the programme plan had it. That map would duplicate
   what `resolveBusinessScopeFacts` already answers from the same source, and two
   derivations of one value are how the two start to disagree (exactly the
   ADR-0079 lesson). It would also churn eleven call sites for a field only one
   of them reads.
2. **Filtering scoped grants out of `fetchGrantedPermissionKeys`** so that they
   "only apply within their scope". The RBAC gate runs first, so this makes the
   scoped path impossible to reach — a scoped grant would deny everything,
   including within its own scope.
3. **Letting a scoped fact and an assignment fact overwrite each other** on the
   same scope. Both are produced; `evaluateAccess` uses `.some()`, so the broader
   answer wins — and that broader answer is **today's answer**, so adding a grant
   takes nothing away from anyone.
4. **An env var for the kill switch** — see above.
5. **Deferring the clause until there is a writer of scoped grants.** A mechanism
   that lands together with its first producer is a mechanism that has never been
   run on its own; separating them turns "inert today" into something that can be
   ASSERTED against the database, rather than something argued.

## Consequences

- One extra query in `resolveBusinessScopeFacts`, and only on routes that declare
  a required scope (the new guard calls the resolver when a route opts in). Zero
  queries when the kill switch is off — the flag is read before the query.
- The query count stays bounded: one, however many scopes or permissions the
  subject holds.
- `activeRoleGrants` now projects `scope_type`/`scope_id`. Other readers ignore
  them, and that is precisely why the columns are there and not in a second
  near-identical fragment that could disagree about what "currently in force"
  means.
