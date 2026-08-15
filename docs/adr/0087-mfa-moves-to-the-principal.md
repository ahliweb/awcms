🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0087-mfa-moves-to-the-principal.id.md)

# ADR-0087 — MFA moves to the principal, and one tenant admin now reaches outside

- **Status:** Accepted (2026-08-12).
- **Context:** Issue #423 Wave 7 PR 7.3. Migration `sql/114`. New preflight
  command `bun run identity:mfa-collisions:preflight`.
- **Builds on:**
  [ADR-0085](0085-one-human-one-credential-many-tenants.md) (`awcms_principals`,
  and the four controls that replace RLS — this ADR uses all four again, not a
  looser version of them),
  [ADR-0086](0086-the-lockout-counter-is-global.md) (a counter that is moved
  must bring every one of its recovery levers with it), and
  [ADR-0027](0027-mfa-totp-session-assurance-step-up.md) (MFA TOTP + step-up,
  whose schema and encryption do NOT change here).

## Decision

MFA factors and recovery codes stop belonging to a per-tenant identity and
start belonging to the **human**: `awcms_principal_mfa_factors` and
`awcms_principal_mfa_recovery_codes`, both GLOBAL and without RLS, keyed by
`principal_id`.

Secret encryption **does not change** — the construction, the keys, and the
`sql/024` ciphertext format are used as-is. This ADR moves OWNERSHIP, not
cryptography.

### What does NOT move, and why

`awcms_mfa_challenges` and `awcms_tenant_mfa_policies` stay tenant-scoped under
FORCE RLS.

A challenge is **one login attempt in one tenant** — it is born from a
`POST /auth/login` carrying `x-awcms-tenant-id` and dies when the session in
that tenant is issued. Making it global would let a challenge issued by tenant
A be exchanged for a session in tenant B, which is exactly the attack shape PR
7.4 will forbid for principal tokens.

A policy is **a tenant's product decision**. The factor is global, but the
OBLIGATION is local: tenant B may demand MFA even if tenant A does not, and the
same person uses one authenticator to satisfy both. Making the policy global
would give one tenant the power to force another tenant's security policy.

> The factor belongs to the human; the obligation belongs to the tenant.

## A consequence that must be stated: an admin reset now reaches outside the tenant

An administrative MFA reset by an admin of tenant A is now **global** — it
disables the very same authenticator that person uses in tenant B.

This is **the only place in the entire repo where a tenant admin action reaches
outside its tenant**, and it is therefore treated as a deliberate exception,
not as a side effect:

1. **Permissioned** — still `identity_access.mfa_admin.reset`, default-deny,
   plus step-up (ADR-0027 F3). No new permission.
2. **Recorded as reach, not as a list.** The `mfa_admin_reset` audit row in the
   acting tenant (severity `critical`, `reason` mandatory) carries
   `crossTenantReach: true` when a factor is genuinely revoked. It states that
   the action left the tenant, without saying where it went.
3. **The trace sticks to its own row, not to another tenant's log.**
   `awcms_principal_mfa_factors.disabled_by_tenant_id` records the tenant that
   ordered the reset (NULL when nobody ordered it: a self-service `disable`, or
   a factor stood down by the `sql/114` backfill). That row is GLOBAL, so it
   survives on the side of the human who lost their factor — the one place that
   can answer "why did my MFA disappear" without one tenant writing into
   another tenant's log.

### The plan asked for an audit row in EVERY tenant. That cannot be built, and the refusal is a finding

The Wave 7 plan wrote "audited in both tenants' logs". The first edition of this
ADR copied that, with the confident sentence that a cross-tenant write "does not
violate RLS because it goes through the audit port, one call per tenant". **The
database contradicts it**, and that was caught by inspecting the policy instead
of trusting the plan:

- `awcms_identities` is FORCE RLS with
  `USING (tenant_id = current_setting('app.current_tenant_id')::uuid)`, so
  `WHERE principal_id = … AND tenant_id <> …` returns **zero rows forever**.
  Code that enumerates reachable tenants would be green in every gate and
  silently never find anything.
- `awcms_audit_events` is FORCE RLS with the same policy and without a separate
  `WITH CHECK` — so an `INSERT` carrying a different `tenant_id` is rejected by
  the policy, not accepted.

So that obligation could only be met by revoking the property that makes this
repo trustworthy: cross-tenant `SECURITY DEFINER` (which ADR-0086 already
rejected for a relative of this problem) or a per-request `NO FORCE` toggle.

**And even if it could be done, it should not be.** Enumerating the other
tenants where an address has an identity is a **cross-tenant membership
oracle**: an admin of tenant A holding `mfa_admin.reset` would learn where else
a human works, from an endpoint whose job is to restore that person. The
obligation to "record the reach" is therefore met by stating THAT it reached
outside, plus the trace on the global row — not by a list nobody should hold.

## Per-factor lockout becomes global too, together with its recovery levers

`failed_verify_count`/`locked_until` stick to the factor, so moving the factor
moves the lockout — the same consequence ADR-0086 took for passwords, taken
knowingly here as well: an attacker who knows someone's password can lock that
person's authenticator in **all** tenants at once.

The ADR-0086 rule applies in full: **that trade-off may only be taken together
with its recovery levers, in the same PR.** There are three levers and all three
are now global as well: recovery codes, self-service `disable` + re-enroll, and
the administrative reset. Before this ADR, a factor lockout in tenant A could
not be cleared by an admin of tenant B; afterwards, any of those three paths
restores the person fully. Recovery is better than before, not worse.

## Backfill: keep the authenticator that is actually in the person's hands

`awcms_identity_mfa_factors` is unique on `(tenant_id, identity_id, factor_type)`
while status ≠ `disabled`, so one human enrolled in N tenants owns N DIFFERENT
secrets. Once factors are keyed by principal, only one may stay active.

The row that is kept is picked by
`ORDER BY last_used_step DESC, activated_at DESC` — **not** the most recently
created one. `last_used_step` is a TOTP step number and is therefore comparable
across factors: the highest one is the authenticator most recently actually
used, i.e. the one on the phone that person still holds. Picking the highest
`activated_at` would pick the newest enrolment — which may well have been done
on a phone that has since been lost, and that locks the person out. The rest
become `disabled` with a `disabled_at`, not deleted.

This is an application of the same ADR-0086 rule: **a migration must not weaken
the control it is moving**, and there the answer was `MAX()` because `0` would
release a lockout that was in force. Here the answer is "last used" because
"most recently created" would separate a person from their authenticator.

**The migration does NOT refuse to proceed on a collision.** It differs from
`sql/112`, which does `RAISE EXCEPTION` on colliding emails, and the difference
is principled: two addresses that differ only in letter case are **possibly two
people**, and merging them cannot be undone. Two TOTP factors in two tenants
are **one person in a legitimate state**, created by this product itself —
blocking a deploy for a normal state is the wrong gate. What is used instead:
`bun run identity:mfa-collisions:preflight` reports every principal with more
than one factor **before** the deploy window, so the "who loses what" decision
can be seen rather than discovered.

The old table is kept populated as history (precedent
[ADR-0079](0079-the-legacy-grant-table-becomes-read-only-history.md)), and
`RETIRED_TENANT_TABLE_PRIVILEGES` reduces its rights to `SELECT` only.

## The four controls that replace RLS, reused whole

Both new tables inherit the ADR-0085 contract without loosening:

| #   | Control                                                                | Enforced by                                                      |
| --- | ---------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 1   | Narrowed rights — `SELECT, INSERT, UPDATE, DELETE`, without `TRUNCATE` | `sql/114` + `GLOBAL_TABLE_FORBIDDEN_PRIVILEGES` + DB-gated suite |
| 2   | Read-shape invariant, per call site                                    | `bun run identity:principal-access:check` (now multi-table)      |
| 3   | `secret_ciphertext` never leaves the store module                      | the `PrincipalFactor` type + tests                               |
| 4   | The authorization boundary does not move                               | a test rejecting every authorization table name inside the store |

One deliberate difference from `awcms_principals`: **`DELETE` is allowed
here.** ADR-0085's reason for withholding it is that a principal is a human's
login anchor and recovering from a wrongly deleted row means a restore. Recovery
codes are the opposite — deleting them is a normal operation already performed
by `disable`, `regenerate`, and the admin reset since ADR-0027, and a missing
row means "that code is not valid", not "this person cannot log in".

Control 2 is widened from one table to three. The gate used to use a single
`TABLE` constant; it now iterates over the list of principal tables, each with
its own file allow-list — so that `principal-mfa-store.ts` is not granted
permission to touch credentials, and `principal-store.ts` is not granted
permission to touch factors.

## REJECTED

- **Allowing MANY active factors per principal** (dropping the single-factor
  constraint so that nobody loses anything during the backfill). It weakens the
  very control being moved: one code guess would be tested against N secrets at
  once, so the chance of a match rises ~N-fold, and `failed_verify_count` would
  be spread across N rows so per-factor lockout stops binding.
- **A migration that does `RAISE EXCEPTION` on a collision.** See above:
  blocking a deploy for a legitimate state.
- **Moving `awcms_mfa_challenges` to the principal.** A global challenge could
  be exchanged for a session in a tenant that did not issue it.
- **Moving `awcms_tenant_mfa_policies` to the principal.** Giving one tenant
  power over another tenant's security posture.
- **An audit row in every reachable tenant** (what the plan asked for).
  Impossible under FORCE RLS without `SECURITY DEFINER` or a per-request
  `NO FORCE` toggle, and the tenant list itself is a cross-tenant membership
  oracle. See the section above.
- **Silently disabling the losing factor during the backfill without a
  preflight.** Losing an authenticator in a way nobody can see before it happens
  is a support incident, not a migration.
