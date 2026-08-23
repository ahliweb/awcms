---
"awcms": minor
---

fix(data-lifecycle,identity-access,profile-identity,comments,email,visitor-analytics): an executed erasure left the person's name, legal name and login address in the database (ADR-0108)

`SubjectDataDescriptor` had ONE column list — `redactedColumns`, documented as
what a portability export must never carry — and the erasure executor used that
same list as the set of columns to overwrite.

For the nine tables where both answers coincide (`password_hash`, `token_hash`)
it worked perfectly, which is why nothing looked wrong. For the tables holding
the person's own identity the two answers are OPPOSITE, and one list forced
their authors to choose the wrong one:

- `awcms_profiles.display_name`/`legal_name` must be EXPORTED — a
  subject-access request is largely about them — and DESTROYED. Declaring them
  would have withheld the subject's own name from their own export, so the
  descriptor declared nothing, while its comment said these are "COPIES of
  personal detail living here" that severance "leaves standing". The erasure
  left them standing too.
- `awcms_identities.login_identifier` — same trap, only `password_hash` was
  ever written.
- `awcms_registration_requests` named nothing and wrote NOTHING.
- `awcms_invitations`' own comment argues for two columns the code never
  reached; `awcms_comments_comments` kept the author's name under their
  published words; `awcms_visitor_sessions.login_identifier_snapshot` survived
  a rationale that says "erasure has to reach in and clear it".

**Verified against real Postgres: after a completed erasure,
`SELECT login_identifier FROM awcms_identities` still returned
`subject@example.test`.**

Three consequences made this worse than a list of missing columns:

1. ~90 descriptors answer `severed_with_subject_row` on the premise that
   anonymising `awcms_identities` makes their stamps resolve to nobody. A stamp
   pointing at a row that still carries the login address resolves to somebody.
2. A column no sentinel fits was silently skipped into a `skippedColumns` list
   nothing asserts on — `awcms_visitor_sessions.ip_address` (`inet`) and
   `awcms_visit_events.geo` (`jsonb`) survived every erasure that way.
3. An erasure could ABORT. A subject with two rows under a unique index (two
   pending invitations, two identifiers, two suppressed addresses) had both
   rewritten to the same `[erased]` sentinel — a 23505 mid-transaction, with the
   request already claimed.

**The fix:** two questions, two declarations. `redactedColumns` (may the subject
be handed this?) and the new `anonymizedColumns` (must the erasure destroy
this?). Every `anonymize` descriptor was updated, so no table loses behaviour.

**The gate is the point, not the twelve edits.** `subject-data:registry:check`
now refuses an `anonymize` that names no column and has no `jsonb_array_contains`
subject column, refuses a column name the table does not have, and refuses
`severed_with_subject_row` when the severance anchor itself anonymises nothing.

Uniqueness is DERIVED from `pg_index` rather than declared; `jsonb` columns are
emptied; a nullable column of any other type is NULLed; and the integration test
asserts `skippedColumns` comes back EMPTY, so the next unwritable column fails a
test instead of being reported to nobody.

`awcms_tenant_users` changes to `severed_with_subject_row` — what its own
rationale always described.

`MODULE_CONTRACT_VERSION` 4.0.0 -> 4.1.0.

**Operational note:** already-completed erasures are not fixed retroactively. A
deployment that has executed any erasure request holds rows this change would
have cleared; re-running is an operator decision with its own audit trail.
