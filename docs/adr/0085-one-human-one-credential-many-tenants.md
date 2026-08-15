🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0085-one-human-one-credential-many-tenants.id.md)

# ADR-0085 — One human, one credential, many tenants

- **Status:** Accepted (2026-08-12).
- **Context:** Issue #423 Wave 7 PR 7.1, and a prerequisite for closing
  [#430](https://github.com/ahliweb/awcms/issues/430). Migration `sql/112`. New
  gate `identity:principal-access:check` (chain 40 → 41).
- **Builds on:**
  [ADR-0003](0003-postgresql-rls-multi-tenant.md) (tenant isolation via RLS — and
  its limits, which this ADR deliberately stands outside of),
  [ADR-0049](0049-machine-credentials-and-session-introspection.md) (the bearer
  kind is carried by its hash namespace), and
  [ADR-0053](0053-platform-scoped-permissions.md) (two independent mechanisms, so
  that one leaked row is not enough).

## Decision

`awcms_principals` — GLOBAL, no RLS, one row per human, keyed by the normalised
email address. `awcms_identities` keeps every row, every `id`, and all eight
incoming foreign keys **exactly where they are**; it only gains a single nullable
`principal_id` column.

This is a **derivation of meaning, not a data move.** Not a single foreign key
moves, and neither `resolveTenantContext` nor `authorizeInTransaction` ever knows
principals exist.

This wave raises authority **one PR at a time**: PR 7.1 creates the rows, PR 7.2
moves login (and **closes #430**), PR 7.3 moves MFA, PR 7.4 adds tenant selection
and switching.

## The sentence that makes the absence of RLS defensible

> **A principal is an AUTHENTICATION fact, never an AUTHORIZATION fact.**

That sentence must appear verbatim here because it is what distinguishes this
table from every other table whose RLS is not optional. Holding a principal
**grants nothing**: every permission is still resolved through
`awcms_tenant_users` under FORCE RLS, through the same chokepoint as yesterday.

`awcms_permissions` is the precedent for a global table — but it is a catalogue
that grants nothing merely by existing. A credential table is not that. Which is
why **four controls replace RLS**, and all four are enforced, not promised:

| #   | Control                                                                                      | Enforced by                                                         |
| --- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 1   | Database privileges narrowed — `REVOKE ALL`, then `SELECT, INSERT, UPDATE`, **never DELETE** | `sql/112` + `GLOBAL_TABLE_FORBIDDEN_PRIVILEGES` + DB-gated suite    |
| 2   | Read-shape invariants                                                                        | `bun run identity:principal-access:check`                           |
| 3   | `password_hash` never leaves the store module                                                | the `PrincipalIdentity` type + `tests/principal-store.test.ts`      |
| 4   | The authorization boundary does not change                                                   | a test that rejects every authorization table name inside the store |

### Why DELETE is permanently withheld

Not tidiness. A principal is the object a human's login leans on **across every
tenant at once**. The runtime has no operation that should delete one, and
recovery from a wrongly deleted row is a **restore**, not an INSERT — every
`awcms_identities.principal_id` pointing at it would have to be re-derived.
UPDATE is kept because PR 7.2 promotes credentials into it.

### Control 2 constrains the CALL SITE, not the ROW

This is the formulation to hold on to: **RLS constrains which ROWS a query is
allowed to see; this gate constrains which CALL SITES are allowed to issue the
query at all.** Only files on the allow-list may name it, and every query there
must be keyed on `id =` or `email_normalized =` — never an unbounded scan, never
`LIKE`, never `LIMIT`/`OFFSET`. A credential table that can be scanned is an
enumeration endpoint one refactor away, and there is no RLS policy there to trim
the result.

## Why the backfill is safe: it moves not one secret

`password_hash` is left **NULL** on every principal. The credential is
**PROMOTED** on the first successful login (PR 7.2): the password is verified
against the IDENTITY hash exactly as it is today, and only then written to the
principal.

Until that happens, a principal is an empty shell that authenticates nothing — so
a wrong backfill **cannot lock anyone out**, because the identity row is still
the only credential in force. That is what separates this migration from every
credential migration that has ever been frightening.

## This migration REFUSES to run on a colliding database

`awcms_identities` is UNIQUE on `(tenant_id, login_identifier)`, so `A@x.com` and
`a@x.com` are two legitimate rows today and one principal afterwards. Merging
them is never a patch — it is a conversation with the customer about which row is
the person and which is a duplicate.

`sql/112` therefore does `RAISE EXCEPTION` instead of guessing.
`bun run identity:principals:preflight` (#440) answers the same question
read-only and months earlier — that is the entire reason it was built before this
file. **Hitting that exception in the deploy window means the census was never
run.**

One ordering detail inside it is worth recording because its failure is silent:
the `NO FORCE` toggle must precede the collision check. `awcms_identities` is
FORCE RLS and its policy reads `current_setting('app.current_tenant_id')`; a
cross-tenant count issued before the toggle would see **zero rows** and always
pass. A check that can only see zero is a check that always passes.

## What was REJECTED

1. **Moving `password_hash` into the principal inside the migration.** A backfill
   that moves a secret is a backfill whose failure mode is "the credential exists
   in two places". Promotion on first use erases that entire class.
2. **`principal_id` NOT NULL.** An identity created by a writer who has not yet
   been taught about principals must be **visibly unlinked**, not a 500. A later
   pass can find and fix it; a 500 can only be reported by a user.
3. **Smarter normalisation** — dot stripping, `+tag` removal, Unicode folding.
   Each of those merges addresses that on some providers are different people,
   and a merge cannot be undone the way a collision report can.
4. **DELETE for `awcms_app`** — §"Why DELETE is permanently withheld".
5. **Any privilege for `awcms_worker`.** No scheduled job reads or writes
   credentials.
6. **Putting a principal read outside the store module "because it's
   convenient".** That is exactly what control 2 forbids, and the gate refuses
   before review gets a chance.

## Consequences

- The `bun run check` chain becomes **41 segments**.
- `awcms_principals` must be present TWICE — in
  `GLOBAL_TABLE_FORBIDDEN_PRIVILEGES` and in the privilege map of
  `security-readiness.ts` — or `tests/repo-inventory.test.ts` goes red from both
  sides.
- `BOUNDED_BY_DESIGN` goes 10 → 11, with an argument of a **different kind** from
  the previous ten: not "written by a human" but **derived** — its population is
  a projection of `awcms_identities`, so it cannot grow faster than a table that
  is already in the legacy ledger, and is always smaller.
- **#430 is not closed by this PR.** The lockout counter is still per-`(tenant,
email)`; PR 7.2 is the one that moves it, with a regression test that rotates the
  tenant header and demands the counter is NOT reset.
