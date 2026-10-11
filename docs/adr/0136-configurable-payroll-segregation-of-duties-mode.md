🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0136-configurable-payroll-segregation-of-duties-mode.id.md)

# ADR-0136 — Payroll segregation of duties is configurable per tenant (strict by default, relaxable to prepare ≠ approve)

- **Status:** Accepted
- **Date:** 2026-10-12
- **Decision maker:** ahliweb
- **Amends:** [ADR-0132](0132-hr-payroll-module-family-admission.md) (the statement that the per-instance database SoD rule "cannot be configured away", and the "proposed, not decided" status of the role matrix) — an amendment, not a supersession; everything in ADR-0132 not named here stands
- **Related:** Issue #954; implementation Issue #957 (nothing is built by this ADR); downstream `ahliweb/awcms-one` DoR owner decision O7, answered 10 Oct 2026 ([`aw-business-platform-dor.md`](https://github.com/ahliweb/awcms-one/blob/main/docs/aw-business-platform-dor.md)); [ADR-0031](0031-segregation-of-duties-conflict-enforcement.md) (SoD rule descriptors, assignment-time and action-time enforcement, exceptions); [ADR-0058](0058-unenforced-permissions-disposition.md) §E (conditional step-up); [`docs/awcms/hr-payroll.md`](../awcms/hr-payroll.md) §7.5 (matrix and test list), §11.1, §12, §16

## Context

ADR-0132 admitted `hr_payroll` as "admitted, not yet buildable" and fixed three things about duty separation: calculate, approve, finalize, pay and reverse are separate permissions; the per-instance rule lives in the database (the approver differs from the calculator, the payer differs from both) and "cannot be configured away"; and the default role-level matrix was **proposed**, with the owner's decision O7 open. The pack's section 7.5 recorded the owner's answer on 10 Oct 2026 but left two things undecided and stated that the stricter ADR text governed until an amendment was accepted.

The owner's answer (**O7, binding**): separation of duties is **configurable per tenant**; the **default is calculate ≠ approve ≠ pay**; a tenant **may relax it to prepare ≠ approve**; **the relaxation is audited**.

That answer conflicts with ADR-0132's "cannot be configured away", and it leaves the sub-question **O7a**: exactly which pairs "prepare ≠ approve" relaxes. It also does not say who may change the setting. The motivation is real: a salon or a clinic with two administrative staff cannot field three distinct people for every run, and a rule that cannot be satisfied is worked around (a shared login), which is worse than a relaxed rule that is explicit and audited.

## Decision

### 1. The mode

A per-tenant setting `payroll_sod_mode` ∈ {`strict` (default), `relaxed`} in the `hr_payroll` module settings. Each run records the mode in force when it was calculated (`sod_mode`), immutable after `calculate`; changing the setting never alters a run in flight.

### 2. O7a: which pairs relax (decided)

In `relaxed` mode the **preparer duties — Calculate (C), Finalize (F), Pay (P) — may be held by one person; the approver (A) must remain a different person from whoever calculated and from whoever pays.** Exactly three pairs relax: C × P, C × F, F × P. The pairs that never relax, in either mode: C × A, A × P, K × A (change compensation and approve a run), U × A (publish rules and approve a run), R × P (reverse and pay), and the configure-permission pair in §3. A × F stays allowed in both modes (F freezes what A approved). Headcount: strict needs three distinct people per run; relaxed needs two.

Options considered:

| Option                                                                                           | Advantages                                                                                                                                                                                                                                 | Disadvantages                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Relax C × P, C × F, F × P; the approver stays distinct from calculator and payer (chosen)** | Literal reading of "prepare ≠ approve"; two people suffice; the approver is a real independent check on both the numbers and the money leaving; two database CHECKs stay unconditional, so the audited setting lifts only what is intended | A preparer who is dishonest or compromised can calculate, finalize and pay alone once the approver is deceived; the approver's check is the only control on the run                                   |
| B. Relax only C × A (the approver may calculate or pay)                                          | Smallest headcount flexibility on paper                                                                                                                                                                                                    | Removes the control on money leaving the business: whoever approves can also pay, the classic approve-and-pay fraud pair; contradicts the owner's "prepare ≠ approve" (approver would be a preparer)  |
| C. Relax only C × P, keep F distinct from C and P                                                | Narrower than A; preparers cannot freeze their own numbers                                                                                                                                                                                 | Same two-person headcount as A (A × F is allowed, so the approver finalizes), so the extra friction buys little; more conditional rules to test and explain                                           |
| D. Relax nothing; require a third person or a time-bound C × P exception (ADR-0132 as written)   | Strongest on paper                                                                                                                                                                                                                         | Contradicts a binding owner answer; the small tenant works around it with shared logins, which destroys attribution; the exception path is dead anyway because the per-instance check would refuse it |

Security: A and B differ decisively on approver independence, and B is rejected on that ground. A keeps two unconditional database CHECKs (`approved_by <> calculated_by`, `approved_by <> paid_by`) that no setting can lift. Small-tenant operability: A and C meet the two-person need, D does not. Auditability: under A the whole difference between modes is one stamped value (`sod_mode`) on each run plus one audited setting change, so a reviewer can tell from the run alone which rules applied. A is chosen: simplest rule that honours the owner's wording.

### 3. The permission held by neither preparer nor approver

Changing the mode is the permission **`hr_payroll.sod_policy.configure`** (resource `sod_policy`, the existing `configure` action, high-risk; `read` is separate). A SoD rule (ADR-0031), `critical`, with no exception, forbids one person from holding it together with any of C, A, F or P. The preparer must not be able to relax the check that binds them, and the approver must not be able to set the scope of the check on their own decisions. It is held by a tenant administrator who performs no payroll duty. A two-person payroll tenant therefore needs a third principal **for configuration only, not per run**; a tenant without one stays strict. Platform support does not hold it on a tenant's behalf.

Changing the mode requires an `Idempotency-Key`, a reason code, a conditional step-up (ADR-0058 §E) when **relaxing** (tightening is audited and idempotent but does not demand step-up), and writes an audit row at `critical` severity with the actor and the before/after mode and no free text. Every audit row of a run calculated in relaxed mode carries `sodMode: "relaxed"`.

### 4. Which rules are database CHECKs and which are role-level rules

Unconditional in both modes, as CHECKs **and** role-level rules: A ≠ C and A ≠ P. Conditional on the run's `sod_mode = 'strict'`: `finalized_by <> calculated_by` and `paid_by` differing from `calculated_by` and `finalized_by`. SoD rule descriptors are static code-only data (ADR-0031) and cannot read a tenant setting, so C × P, C × F and F × P are **enforced per instance only**, not as role-level rules: otherwise relaxed mode could never assign C and P to one person. The cost is stated: in strict mode a person who holds both C and P is refused when the second action is taken, not when the role is assigned. The time-bound C × P exception of ADR-0132's proposed matrix is **withdrawn**: the per-instance CHECK would refuse it, and relaxing the tenant is the sanctioned route.

### 5. Amendment of ADR-0132

The sentence "the per-instance database rule cannot be configured away" becomes: the **A ≠ C and A ≠ P rules cannot be configured away**; the C/F/P-among-themselves rules are lifted only by the audited `relaxed` mode, stamped on each run. The role matrix is no longer "proposed" but is the one in the pack section 7.5. Everything else in ADR-0132 stands.

### 6. Test matrix

The required tests (strict, relaxed, mode switching, permission, idempotency, step-up, isolation, machine credentials) are the 22 rows SOD1–SOD22 in the pack section 7.5, with acceptance scenarios S9 and S9a in section 12. They are a requirement on the implementing issue.

## Consequences

- **Not built.** This ADR creates no migration, OpenAPI path, AsyncAPI channel, permission seed or code. The setting, the `sod_mode` column, the CHECKs, the permission and the SoD rule are implemented in Issue #957; until then `hr_payroll` remains admitted and gated, and the tests SOD1–SOD22 do not yet exist.
- ADR-0132's phase 3 gate loses its "amendment ADR for O7" item; the other gate items (payout-account at-rest encryption, security review, legal review of the engine's rule-version controls, restore rehearsal) are unchanged.
- A small tenant gets a two-person path without shared logins, and the weakening is visible: a critical audit row, a stamped mode on every run, a distinct permission.
- A tenant that wants payroll with fewer than two payroll people plus one administrator cannot use relaxed mode; it stays strict or uses a consumer-built process outside this module. That is intended.
- **Remaining limitation.** The approver is the single independent control in relaxed mode; collusion between preparer and approver is outside what SoD can prevent, and the same is true in strict mode between any two of three. Reconciliation (pack section 14) and the audit trail are the compensating controls.

## Alternatives rejected

- Options B, C and D above.
- **Mode as a per-run choice.** A preparer would pick it. The per-tenant setting, behind its own permission, is the owner's wording and keeps the decision with someone who does no payroll duty.
- **A free-form per-tenant rule editor.** SoD rules are static code-only data (ADR-0031); a tenant-editable expression would put a payroll control in tenant-authored data. Two fixed modes are enough for the owner's answer.
- **Letting the mode setting be held with duties but requiring a second approver for the change.** It would need a general two-person change mechanism for settings that does not exist; a permission held by neither side achieves the owner's intent with an existing mechanism.
