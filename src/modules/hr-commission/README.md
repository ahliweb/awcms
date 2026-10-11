🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](README.id.md)

# `hr_commission`

**Versioned commission rules** (Issue #950,
[ADR-0132](../../../docs/adr/0132-hr-payroll-module-family-admission.md), phase 2
of the `hr_*` family). The design pack is
[`docs/awcms/hr-payroll.md`](../../../docs/awcms/hr-payroll.md) sections 2.2 and 6;
this file is the map of the code.

## What is here, and what is not

This is the **rule foundation**: `awcms_hr_commission_rules`, the draft / publish /
retire API, and a **pure evaluation function**. **Not here yet:** the accrual
ledger, its approval lifecycle (approve, release, pay, void), reversals, the
source-event port and the `awcms.hr.commission.*` events (later issues of the same
ADR). It is **not affiliate commission** (hr-payroll.md 6.4) and carries **no
country's or jurisdiction's rules**: a tenant authors its own.

Status is `experimental`: the flag is off, no admin screen exists, and the module
declares no `navigation`. It flips to `active` with its first screen.

## The rules that make it safe

- **A rule is configuration.** It references no employment, no profile and no
  person; the only person-shaped columns are the four actor stamps. A test asserts
  no personal, photo, biometric or device column appears.
- **A published version is immutable, by trigger** (`sql/182`), not by handler
  code: a draft is editable and may become `published` (or `retired`, abandoning
  it); a published row's only permitted change is the move to `retired`, with every
  other column byte-identical; a retired row never changes. Identity
  (`rule_key`, `version_no`) never changes in any state, and no row is ever deleted
  (`awcms_app` holds no DELETE and a trigger refuses it for everyone).
- **A row is born a draft** (`BEFORE INSERT` trigger): a published version can only
  come from a draft that passed the overlap check on its way. A draft may move
  straight to `retired`; that is intentional ("abandon this draft"), so a retired
  row does not imply it was ever published (`published_at` says).
- **Publish is bound to what the reviewer saw, and to a second person.** Every
  rule carries a `contentDigest` (SHA-256 over its key, version and editable
  terms). `PUT` and `publish` must name the digest they were based on
  (`expectedContentDigest`); if the terms moved since, it is `409 RULE_CHANGED`
  and nothing is written, so a draft edited between "looked at it" and "published
  it" can never be published unseen and two editors cannot overwrite each other.
  The digest of what was published goes into the audit row (no rate or amount).
  **Maker / checker:** whoever created or last edited a draft cannot publish it
  (`403 PUBLISH_BY_AUTHOR_FORBIDDEN`) — the control the payroll design asks of
  payroll rules (hr-payroll.md PS-07), here for commission rules. A single-person
  tenant therefore needs a second login to publish.
- **Effective dating.** A window is half-open, `[effective_from, effective_to)`,
  `NULL` = open-ended. No two **published** versions of one rule overlap; a
  trigger takes a per-(tenant, rule) advisory lock before it looks, so two
  concurrent publishes serialise and the second is refused (an exclusion
  constraint would need `btree_gist`, which no migration here asks for). A retired
  version no longer counts. The handler takes the same lock and pre-checks, so the
  refusal is a clean `409 RULE_WINDOW_OVERLAP` naming the conflicting version; the
  trigger is the backstop.
- **Succession.** A published version is never edited to make room, so a
  successor needs the predecessor's window to END where it starts: set
  `effectiveTo` when authoring the predecessor, or retire it.
- **The rule in force** for an event is the published version whose window contains
  the event's own date (`selectEffectiveRule`), never `now()`.
- **Money is exact.** `numeric` columns, each with an explicit `<> 'NaN'` CHECK
  (a `numeric` accepts NaN and NaN passes `>= 0`); the API carries every rate and amount as a
  decimal STRING (a JSON number is a 400 — it has already been through a float);
  evaluation is `bigint` arithmetic and rounds once, at the rule's mode and scale
  (`half_up`, `half_down`, `half_even`, `up`, `down`, `ceiling`, `floor`; scale 0
  to 6), then clamps to the optional floor and ceiling (which the database
  guarantees carry no more decimals than the scale).
- **Bounded results.** A product of two in-range inputs is not in range
  (`999999999999.999999` x 1,000,000 units is 10^18), so `evaluateCommission`
  refuses a rounded result of 10^12 or more (the integer capacity of
  `numeric(18, 6)`) instead of truncating it; tested at the boundary
  (`999999.999999` x 1,000,000 passes, `1000000` x 1,000,000 is refused).
- **Bounded evaluation.** A rule is a closed record, `percent` (a percentage of a
  base amount, 0 to 100) or `fixed` (an amount per whole unit, at most 1,000,000
  units): no expression, script, callback or tier list exists to be unbounded.
- **Publish and retire are high-risk**, separately grantable, require an
  `Idempotency-Key` (replay returns the stored response; a different request under
  the same key is 409) and are audited at `warning`. No audit row carries a rate,
  an amount or a rule name — only the key, the version and the window.
- **Every handler authorizes through `authorizeInTransaction`** (via
  `defineTenantRoute`), and the five permissions are seeded by `sql/183`; a test
  proves each guard bites (holding every other permission is refused, holding only
  it succeeds).

## Map

| File                                          | Holds                                                                     |
| --------------------------------------------- | ------------------------------------------------------------------------- |
| `module.ts`                                   | Descriptor, permissions, `dataLifecycle` and `subjectData`                |
| `domain/hr-commission-decimal.ts`             | Exact `bigint` decimal parsing, rounding, formatting                      |
| `domain/hr-commission-evaluation.ts`          | PURE `evaluateCommission` and `selectEffectiveRule`                       |
| `domain/hr-commission-validation.ts`          | Strict request validators (money as strings)                              |
| `domain/hr-commission-permissions.ts`         | The guards, as literal objects                                            |
| `application/hr-commission-rule-directory.ts` | List, get, create, edit draft, publish, retire (outcomes, audit)          |
| `application/hr-commission-route-support.ts`  | Idempotency, body parsing and id helpers shared by the routes             |
| `src/pages/api/v1/hr-commission/rules/**`     | 4 thin route files (`/rules`, `/rules/{id}`, `.../publish`, `.../retire`) |

## Open items and recorded postures

- **Evaluation has no HTTP endpoint.** It is consumed by the accrual issue that
  follows; a dry-run endpoint is not exposed.
- **The decimal helper is a small copy** of the idea in `tax/domain/decimal.ts`,
  because this module declares no dependency on `tax`. Lifting both into `_shared`
  is a follow-up.
- **`occurredOn` is a date.** Windows are dates, not instants; the caller derives
  the event's date (in whatever civil time its tenant uses) before selecting a rule.
  No timezone is assumed here.
- **Retained indefinitely, no period asserted.** There is deliberately no
  `dataLifecycle` descriptor (it would have to assert a retention period): the
  table is answered by a `BOUNDED_BY_DESIGN` entry in
  `scripts/data-lifecycle-table-coverage-check.ts`. The period for commercial terms
  that later accruals cite is the tenant's counsel's and nobody here owns it;
  archive-then-purge for HR rows is a follow-up (hr-payroll.md section 15).
- **Publishing a back-dated window is NOT specially gated.** Out of scope for this
  phase and deferred to the accrual issue: no ledger consumes a rule yet, so a
  past `effectiveFrom` changes nothing that exists. When accruals land, a publish
  whose window starts in the past needs an explicit flag and a reason (high-risk,
  audited), because it can silently change which rule applies to events that
  already happened.
- **The subject descriptor is actor-stamps only** and `exportable: false`: a rule
  names no data subject.

## Limitations

- No admin screen; `experimental`.
- Existing tenants need `bun run identity-access:permissions:backfill` to receive
  the seeded permissions (the limitation every permission seed carries).
- A draft can only be changed by replacing every editable field (`PUT`); there is
  no partial edit and no "copy from the previous version" helper.
- `btree_gist` is not used: overlap is a trigger, not an exclusion constraint.
