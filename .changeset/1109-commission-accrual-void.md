---
"awcms": minor
---

`CommissionAccrualPort.void` for `hr_commission` (Issue #1109, follow-up to #951).

- New port method `void(tx, tenantId, actorTenantUserId, { source, employmentId, reason, correlationId? })`, keyed by the same source identity as `accrue`, so a consumer that voids, refunds or cancels a sale reverses its commission without storing internal ids. Outcomes: `voided`, `already_voided` (a replay writes, audits and publishes nothing), `not_found`, `period_closed`, plus `actor_required` and `input_invalid`.
- The accrual is never edited or deleted: a `pending` or `approved` accrual moves to `voided` through the one transition core (immutable monetary facts, append-only transition log, FOR UPDATE serialisation), so the ledger reconciles. No migration.
- Closed-period policy: a `payable` or `paid` accrual is refused as `period_closed` and nothing is written (no reversal-into-the-current-period mechanism exists yet; the negative reversal row stays the recorded follow-up). Documented in the `hr_commission` README and `hr-payroll.md` section 6.3, with Indonesian mirrors.
- New domain event `awcms.hr.commission.voided` (ids, source type, rule key and version, prior status, reason code; no amount or source reference), published in the voiding transaction by both the HTTP void route and the port; registered in the event registry, AsyncAPI and `events.publishes`. `hr_commission` now depends on `domain_event_runtime` and declares `provides: ["commission_accrual"]`.
- Capability contract `commission_accrual` declared at `1.1.0` (the accrue-only port was never listed; `void` is the MINOR addition) in `capability-contract-versions.ts` and `awcms-family-compatibility.yaml`.
