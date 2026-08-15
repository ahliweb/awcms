🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0081-a-user-group-is-a-subject-that-grants-roles.id.md)

# ADR-0081 — A user group is a SUBJECT, and it grants ROLES

- **Status:** Accepted (2026-08-10).
- **Context:** Issue #423 Wave 3 PR 3.5 (the wave's closer). Migrations
  `sql/104` (schema) and `sql/105` (permissions).
- **Builds on:** [ADR-0078](0078-a-grant-carries-its-own-scope.md)
  (`subject_type` deliberately accepts a single value so that this addition is not
  a backfill), [ADR-0079](0079-the-legacy-grant-table-becomes-read-only-history.md)
  (one grant source — without it, this PR would have to touch seven readers), and
  [ADR-0080](0080-a-scoped-grant-covers-only-what-its-role-confers.md).

## Decision

`awcms_user_groups` + `awcms_user_group_members`, and
`awcms_access_policies.subject_type` now accepts `'user_group'` with XOR'd subject
columns. A group holds a grant exactly the way a person holds one.

Membership reaches every reader through ONE additional branch in
`activeRoleGrants`.

## The silent failure mode this design rejects

A group could just as well have been built to grant **permission keys** directly.
From the outside it would look identical, and its wrongness would be visible to
nobody:

The subject would hold the keys while `subject.roles` stayed EMPTY. So a tenant
policy `subject.roles in ["editor"]` silently stops matching. An **allow** policy
that stops matching is a narrowing — safe, and somebody notices. A **deny** policy
that stops matching is **INERT**, that is a widening, and nobody observes it. SoD
goes blind the same way: its facts are keyed on role grants, so a group-derived
grant would not carry a conflict — exactly for the grants the group feature exists
to create.

Because the grant lands in `awcms_access_policies`, none of that can happen:
`subject.roles`, `fetchGrantedPermissionKeys`, both SoD resolvers, the admin
lists, and the last-administrator guard all get it at once.

## The planned gate was not built, and that is not a shortcut

The programme plan called for a new gate `access:sod-fact-parity:check` requiring
both resolvers to reference one shared `grantSourceTables()` constant.

It was not built because **ADR-0079 already closed the gap more tightly**. The
readers no longer name the grant tables at all — they inline `activeRoleGrants`,
and `access:grant-readers:check` rejects any file that assembles its own join. A
gate requiring two resolvers to reference the same constant would be a weaker
check than the one already in force: "references the same constant" can be true
while the two queries differ, whereas "uses the same fragment" cannot.

What replaces it already exists and is extended in this PR:
`tests/grant-source-parity.test.ts` (static: every reader inlines the fragment)
and `tests/integration/user-groups.integration.test.ts` (behavioural: a
group-derived role reaches EVERY reader, `subject.roles` and SoD included).

## `external_id`, not `group_code`, as the sync key

A rename in the IdP must not orphan a group. `group_code` is a human label and
humans rename things; `external_id` is the group's name according to the
directory, and it survives a rename.

**SCIM was not built.** What was built is the shape that will not need migrating
when it is built, plus its REFUSAL: a group with `source = 'scim'` rejects renames
and membership mutations with `409 GROUP_EXTERNALLY_MANAGED`. A local edit that is
silently undone by the next sync is worse than an edit that was never accepted —
an admin who cannot see it happen will do it again.

`source` is also not accepted from the request. A caller who can declare a group
`scim` is declaring it un-editable through the only surface that exists, with no
directory behind it to edit it.

## Why granting a group a ROLE uses `access_control.assign`

Two different authorities, and merging them is the mistake.

`user_groups.assign` puts people INTO a group. `access_control.assign` — which
already exists and already means "hand out a role" — is what grants a group its
role, through the same endpoint that grants a person theirs.

Inverting it is an escalation path with no clear name: a group administrator who
can also grant roles to their own group can grant `owner` to a group they belong
to. That is also why `assignRoleToGroup` rejects `is_system` roles, just like the
per-person path — and here that refusal matters more, because a grant to a group
also reaches everyone added LATER.

## No `delete`

Retiring a group is not one decision but three: what happens to the grants it
holds, to its memberships, and to the `external_id` the directory will present
again tomorrow. Shipping `delete` before all three are answered would either
orphan the grants (a role nobody holds according to a row still claiming
otherwise) or destroy the only record of who held what.

Soft-delete ALREADY has the right meaning — `deleted_at IS NULL` is in the group
branch of `activeRoleGrants`, so a group marked deleted grants ZERO — but the
surface that sets it waits on that decision.

## Dropping NOT NULL from a live authorization table

The words sound exactly like the change ADR-0078 REJECTED against
`awcms_access_assignments`, so the difference is worth writing down: there what was
dropped was a **unique index**, which is wrong in the **PERMITTING** direction (two
rows where one used to be allowed) with not one gate going red.

Here `NOT NULL` is REPLACED by a stricter CHECK in the same statement block: a row
with no subject, with two subjects, or with a subject that does not match its own
discriminator is now REJECTED, where previously it merely could not be
represented.

One consequence that is easy to miss: the partial unique index over active grants
must get a sibling. `NULL` does not equal `NULL` in a unique index, so the old
index stops constraining anything the moment `tenant_user_id` may be NULL — a group
would be able to hold the same role in the same scope any number of times.

## What was REJECTED

1. **Groups granting permissions directly** — the silent failure mode above.
2. **A separate `user_groups.grant` permission** — the escalation path above.
3. **`delete` for groups** — three unanswered decisions.
4. **The `access:sod-fact-parity:check` gate** — replaced by a stronger mechanism,
   not skipped.
5. **`UNION` instead of `UNION ALL`** in the group branch — a subject can hold the
   same role directly AND through a group, and every consumer already dedupes what
   it needs to (`SELECT DISTINCT`, `EXISTS`). Paying for a sort on the
   authorization path to save them nothing is paying in the most expensive place.
6. **Accepting `source` from the request** — see above.
7. **Auditing a group's members when a role grant is made** — that list is correct
   when written and stops being correct the moment somebody joins. What is audited
   is the GROUP; who is reached is a membership question, and membership has its
   own audit trail.

## Consequences

- `activeRoleGrants` is now a `UNION ALL` of two branches. It remains ONE query,
  and the index `awcms_user_group_members_subject_idx` exists specifically for that
  join.
- The reader gate's `GRANT_TABLES` gains two names: changing who is in a group is
  changing authorization, so a file that does it must be on the record.
- Two new entries in `BOUNDED_BY_DESIGN` raise its ceiling from 3 to 5. That
  ceiling exists to force a conversation, and the conversation happened: all four
  entries are ONE argument in two halves — the table whose rows are
  administrator-made grants, plus the table bounded by it. The next raise must be
  harder than this one.
- Wave 3 is done.
