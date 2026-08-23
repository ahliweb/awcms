🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0108-what-an-export-withholds-and-what-an-erasure-destroys-are-different-questions.id.md)

# ADR-0108 — What an export withholds and what an erasure destroys are different questions

- **Status:** Accepted
- **Date:** 2026-08-23
- **Decision maker:** ahliweb
- **Related:** ADR-0094 (subject rights); Issue #557 (the executor); ADR-0013 §6 (a module owns its table's answers); `MODULE_CONTRACT_VERSION` 4.1.0

## Context

`SubjectDataDescriptor` had one column list, `redactedColumns`, documented as _"columns a portability export must NEVER carry — hashes, tokens, secrets"_. The erasure executor used that same list as the set of columns an `anonymize` erasure overwrites.

For the tables where both answers coincide, that works perfectly. `awcms_identities.password_hash` must never be exported and must be destroyed; one list, one declaration, correct behaviour. Nine of the twelve `anonymize` descriptors are shaped that way, which is why nothing looked wrong.

**For the tables that hold the person's own identity, the two answers are opposites**, and the single list forced their authors to choose the wrong one:

- `awcms_profiles` holds `display_name` and `legal_name`. Those must be **exported** — a subject-access request is largely about them — and must be **destroyed** by an erasure. Declaring them would have withheld them from the subject's own export, so the descriptor declared nothing. Its comment says, in the file, that these are _"COPIES of personal detail living here"_ that anonymising the identity _"leaves standing"_. The erasure left them standing too.
- `awcms_identities.login_identifier` — the address the person signs in with. Same trap, same outcome: only `password_hash` was ever written.
- `awcms_registration_requests` holds the name and address the person supplied themselves. Its comment says so. It named no column at all, so its `anonymize` wrote **nothing**.
- `awcms_invitations`: the comment reads _"`login_identifier` and `display_name` are the invitee's own contact details… Severing the identity does NOT reach them, which is exactly why this is the answer"_ — and the code reached only `token_hash`.
- `awcms_comments_comments` kept `author_display_name` and `author_email_masked`; `awcms_visitor_sessions` kept `login_identifier_snapshot`, which its own rationale says _"erasure has to reach in and clear"_.

In every case the descriptor's prose describes the correct behaviour and the mechanism could not express it. Verified against a real database: after a completed erasure, `SELECT login_identifier FROM awcms_identities` still returned `subject@example.test`.

Three consequences make this worse than a list of missing columns:

1. **~90 descriptors answer `severed_with_subject_row`** on the stated premise that anonymising `awcms_identities` makes their stamps resolve to nobody. A stamp pointing at a row that still carries the login address resolves to somebody. The premise the majority answer rests on was false.
2. **A column that no sentinel fits was silently skipped**, reported in a `skippedColumns` list nothing asserts on. `awcms_visitor_sessions.ip_address` (an `inet`) and `awcms_visit_events.geo` (a `jsonb`) survived every erasure that way.
3. **An erasure could abort outright.** `awcms_invitations.token_hash` is globally UNIQUE; a person who sent two invitations would have had both rewritten to the same `[erased]` sentinel — a `23505` in mid-transaction, after the request had already been claimed. `awcms_profile_identifiers.value_hash` and `awcms_email_suppression_list.recipient_hash` are the same shape.

## Decision

**The two questions get two declarations.**

- `redactedColumns` — may the subject be handed this? Unchanged semantics, unchanged values.
- `anonymizedColumns` — must the erasure destroy this? New. A column may be in both, either, or neither, and the three tables above are the proof that all four combinations occur.

The executor writes what `anonymizedColumns` names. Every `anonymize` descriptor was updated in the same change, so no table loses behaviour it had.

### The gate is the point, not the twelve edits

`subject-data:registry:check` now refuses:

- an `anonymize` descriptor that names **no** `anonymizedColumns` and has no `jsonb_array_contains` subject column — that combination is exactly "reports anonymisation, writes nothing";
- an `anonymizedColumns` entry naming a column the table does not have. A misspelled redaction leaks a column into an export somebody can see; a misspelled anonymisation leaves personal data in the database and calls itself done;
- a `severed_with_subject_row` answer when the severance anchor itself anonymises nothing. That third clause is the one that was false for months, and it is what ties the ~90 majority answers to a severance that actually happens.

### Uniqueness is DERIVED, not declared

A column under any unique index gets a per-row-unique sentinel (`[erased]:<uuid>`) instead of the shared one. Which columns those are is read from `pg_index` inside the same transaction, alongside the `information_schema` read the executor already does.

A `unique: true` flag on the descriptor was rejected: it is a second copy of the schema, hand-maintained, in a file whose author has no reason to look at index definitions — and a stale copy fails as a `23505` in the middle of a claimed erasure. Partial indexes count, because `awcms_invitations`'s uniqueness is partial and two pending invitations are precisely the colliding case.

### A type no sentinel fits is not a pass

`jsonb`/`json` columns are set to an empty document — `awcms_email_messages.variables` holds the merge data a message was rendered with, which is where the recipient's own name lives. A column of any other type that is NULLABLE is set to NULL, because "erased" is what NULL says for a column that was allowed to be absent all along. Only a NOT NULL column of an unwritable type is still reported as skipped, and the integration test now asserts that list is EMPTY for the real registry — so the next such column fails a test rather than being reported to nobody.

### `awcms_tenant_users` changes answer

It was `anonymize` and named nothing, and its own rationale explains why: _"It carries no personal detail of its own beyond the link."_ That is the definition of `severed_with_subject_row`. Under the new gate the old answer is a failure; under the new answer the report says what actually happens.

## Consequences

- **Positive:** an executed erasure now destroys the person's name, legal name, login address, the address and name on invitations they sent, the name under their published comments, their masked identifiers, their suppressed addresses, their IP address and their coarse geography. ADR-0094's promise becomes true rather than intended.
- **Positive:** an erasure can no longer abort on a subject who holds two rows in one table.
- **Positive:** the `severed_with_subject_row` majority answer is now anchored to a severance the gate has checked.
- **Negative / trade-off:** twelve descriptors gained a second list, and a future descriptor author must answer both questions. That is the cost of the two questions being genuinely different; the gate refuses silence on the one that matters.
- **Negative / trade-off:** an anonymised `login_identifier` is `[erased]:<uuid>`, which is not a plausible email address. Nothing parses that column as one — it is compared for equality at login and nowhere else — but a report that renders it will show the sentinel.
- **Neutral:** already-completed erasures are not retroactively fixed. A deployment that has executed any erasure request holds rows this change would have cleared, and re-running is an operator decision with its own audit trail, not a migration.

## Alternatives considered

- **Widening `redactedColumns` to mean both.** Rejected: it withholds the subject's own name from their subject-access export, which is the specific thing a portability right exists to deliver. The current descriptors already chose "export correctly, erase nothing" over that, and they were right to.
- **Anonymising every text column of an `anonymize` table.** Rejected. `awcms_tenant_auth_policies.allowed_email_domains` is the tenant's policy, not the subject's data — a blanket rule would destroy a tenant's configuration during a person's erasure. The owning module decides what is personal (ADR-0013 §6); the engine's job is to do what it is told and to refuse being told nothing.
- **Declaring uniqueness on the descriptor.** Rejected — see above. Derived beats declared wherever the database already knows.
- **Deleting the rows instead of anonymising them.** Rejected for the reason the vocabulary already records: these ids are FK targets of audit events, decision logs and the record of the erasure itself.
