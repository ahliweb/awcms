🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0086-the-lockout-counter-is-global.id.md)

# ADR-0086 — The lockout counter becomes GLOBAL

- **Status:** Accepted (2026-08-12).
- **Context:** Issue #423 Wave 7 PR 7.2. **Closes
  [#430](https://github.com/ahliweb/awcms/issues/430).** Migration `sql/113`.
- **Builds on:**
  [ADR-0085](0085-one-human-one-credential-many-tenants.md) (`awcms_principals`,
  without which this finding has nowhere to be fixed),
  [ADR-0066](0066-shared-rate-limiting-and-full-auth-surface-coverage.md) (the
  shared rate limit that is deliberately fail-open — and leans on the
  database-side lockout precisely because that one is NOT fail-open), and
  [ADR-0079](0079-the-legacy-grant-table-becomes-read-only-history.md) (the old
  column becomes history, not deleted).

## Decision

`awcms_identities.failed_login_count`/`locked_until` stop deciding anything. The
counter moves to `awcms_principals`, which has exactly one row per human and
**has no tenant column to rotate**.

## Why this closes #430

`awcms_identities` is UNIQUE on `(tenant_id, login_identifier)`, so one human who
is a member of N tenants has N counters. `POST /api/v1/auth/login` demands
`x-awcms-tenant-id` up front, and its value is not a secret — the `/login` page
publishes a tenant picker.

Rotating that header therefore selects a different identity row, and each row
carries its own counter. After this ADR, the same rotation selects a different
identity but the **SAME principal** — and it is the principal that gets
incremented.

The property that actually closes this finding can be stated in one sentence:
**the row the login path increments must be selected by something an attacker
cannot vary.**

## Why its regression test is SOURCE-based

A behavioural test demands a database, while the default suite runs without one
— so the most important assertion would live only in the DB-gated workflow.
Worse: a behavioural test PASSES FOR THE WRONG REASON as soon as the counter
silently falls back to the identity. Five failures within one tenant still lock;
it is the rotation case that nobody writes.

`tests/global-lockout-regression.test.ts` therefore enforces the structural
shape, and it was proven by **restoring the original #430 defect** — that
mutation turns it red.

## What is easiest to get wrong, and has already bitten this repo

Moving the WRITER without moving its READERS. A GLOBAL lockout with a PER-TENANT
reset is not half a fix — it is **worse than what it replaces**: an attacker who
locks `alice@corp.com` out of every tenant cannot be undone by the reset link
just sent to them.

Four paths must move too, and **two of them were found by grep, not by
reasoning**:

| Path                           | Obligation                                                              |
| ------------------------------ | ----------------------------------------------------------------------- |
| `/auth/login` success          | clear the global counter                                                |
| password reset                 | replace the principal credential + clear                                |
| password change                | same                                                                    |
| **SSO callback**               | clear — proving identity through the IdP is a successful authentication |
| **MFA enrolment verification** | same                                                                    |

The last two previously cleared only the tenant-scoped copy. Without the fix, a
person locked out by password attempts would sign in through the IdP
successfully **and remain locked** on the password path, while the lever that
used to release them no longer decides anything.

## A trade-off taken knowingly: lockout DoS

A global counter means an attacker who knows an address can lock their victim out
of **all** tenants, not one. That widens the blast radius, and the issue demands
this trade-off be taken TOGETHER with its recovery levers — not afterwards.

That is why all five recovery paths in the table above land **in the same PR**.
Password reset by mail still works, and now works **across every tenant at
once**, which is in fact a better recovery than before.

What was REJECTED as an interim mitigation before this wave: a Redis-based global
counter (it fails open exactly when it is needed, and `checkSharedRateLimit`
itself fails open), and a `SECURITY DEFINER` function aggregating across tenants
(it carries the same DoS without a single one of its recovery levers).

## A migration must not weaken the control it is moving

The backfill takes `MAX(failed_login_count)` and `MAX(locked_until)` across the
identities belonging to that principal. Taking `0` — or whichever row's counter
happens to sort first — would **release every lockout in force** at deploy time.
`MAX` is the only aggregate that cannot weaken the control it is migrating.

The identity columns are LEFT in place and remain populated — history, the
ADR-0079 precedent. Dropping them in the same migration that stops reading them
would destroy the only evidence of what the per-tenant counter held.

## Consequences

- **#430 is closed.**
- The increment is still computed IN-DB, not read-modify-write — the Issue #483
  defect is inherited as a fix, not repeated as a new mistake.
- Credentials are promoted to the principal on the first successful login, one
  login at a time, rather than in a single migration window.
- Password reset and change now alter the credential **across all tenants** —
  that is what "one human, one credential" means, and the reset mail needs to say
  so.
- PR 7.3 moves MFA; PR 7.4 adds tenant selection and switching.
