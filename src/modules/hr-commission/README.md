🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](README.id.md)

# `hr_commission`

**Versioned commission rules** (Issue #950) and the **accrual ledger** (Issue
#951), [ADR-0132](../../../docs/adr/0132-hr-payroll-module-family-admission.md),
phase 2 of the `hr_*` family. The design pack is
[`docs/awcms/hr-payroll.md`](../../../docs/awcms/hr-payroll.md) sections 2.2 and 6;
this file is the map of the code.

## What is here, and what is not

This is the **rule foundation** (#950: `awcms_hr_commission_rules`, the draft /
publish / retire API, a **pure evaluation function**) and the **accrual ledger**
(#951: `awcms_hr_commission_accruals`, `awcms_hr_commission_transitions`, the
approve / release / void / pay lifecycle and the sale-attribution port).
**Not here yet:** reversals of a payable or paid accrual (a compensating negative
accrual; `CommissionAccrualPort.void` refuses those as `period_closed`, below), the
other `awcms.hr.commission.*` events (only `voided` exists), and the payroll claim of an accrual
(PS-19, below). It is **not affiliate commission** (hr-payroll.md 6.4: the
beneficiary here is always an employment) and carries **no country's or
jurisdiction's rules**: a tenant authors its own.

Status is `active` since Issue #952: the module declares one admin screen,
`/admin/hr/my-commission`, where an employee reads their OWN accruals (read-only;
`GET /api/v1/hr-commission/my-accruals`, `docs/awcms/workforce-self-service.md`).
The rule and ledger-management screens are still API-only.

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

## The accrual ledger (Issue #951)

- **One accrual per (source, employment), exactly once.** The unique key
  `(tenant, source_type, source_ref, source_line, employment, operation)` is the
  authority (`sql/188`). A redelivery of the same canonical request returns the
  ORIGINAL (`replayed`), whatever has happened to the accrual or the rule since
  (also after a void: a voided accrual is not resurrected); the same identity with
  a different amount, date, rule or currency is `409 SOURCE_CONFLICT`. Two RACING
  deliveries are one row (`ON CONFLICT DO NOTHING`, the loser re-reads the
  winner), proven with ten in parallel and shown to fail without the clause. One
  source line may be split between staff: `employment_id` is in the key.
- **The amount is computed, never accepted.** The published version of the rule
  key whose window contains `occurredOn` (the sale's own civil date, derived by the
  caller) is evaluated with the pure, `bigint`-exact function from #950 and rounded
  once; the body cannot assert an amount, a rule version, a status or a stamp.
  The insert trigger re-checks that the rule is published, in force on that date,
  and equal in key, version, source type, currency, calculation and snapshot terms,
  and that the stored amount EQUALS the rule's evaluation of the stored inputs: the
  database recomputes it (`awcms_hr_commission_expected_amount`, exact `numeric`,
  the SQL twin of the pure evaluation: rounding mode, scale, floor and ceiling) and
  refuses a mismatch, so a bypassing session cannot write a commission the rule
  does not yield. A test drives both implementations over all seven modes and the
  half boundaries and demands they agree.
- **A bounded event age.** An accrual's `occurredAt` may be at most 730 days old
  (and not more than a day ahead), in the port, over HTTP and in the trigger:
  a sale older than two years is not a late delivery, and an unbounded age would
  let a back-dated publish reach arbitrarily far into the past.
- **Posting is its own high-risk action.** `accruals.accrue` (a new action; not
  `create`, which is not high-risk and the classification is per action) is
  high-risk, so the action-time SoD check can be authored over who may post,
  approve and pay. The port itself checks nothing: the composition root does.
- **Back-dated rules (decided here; `sql/187`).** An accrual uses the rule in force
  on the event date, so publishing a version whose window STARTS IN THE PAST
  changes which rule applies to events that already happened but are not accrued
  yet (a late-reported sale). Existing accruals are untouched (they cite their
  rule by foreign key and a published version is immutable), which is exactly why
  the change would otherwise be silent. So: a window starting before TODAY (UTC date
  of the publishing transaction) can be published only with a `backdatedReason`
  (`409 RULE_BACKDATED_REASON_REQUIRED` otherwise); the DATABASE stamps
  `publish_backdated` from the window (a client cannot assert it either way) and
  refuses the publish without a reason even if the application is bypassed; the
  reason stays on the rule row and the audit row carries only `backdated: true`.
  A retired version no longer applies: a sale whose date falls in no published
  window is `no_effective_rule`, and the tenant publishes a successor.
- **The parents are validated under lock.** The rule and the employment are read
  `FOR SHARE` (and again by the insert trigger): a concurrent retire, termination
  or soft delete queues behind the accrual or sees its result, so an accrual can
  never be written against a rule or an employment that was withdrawn a moment
  earlier. The employment must be live and employed on the event date (hire and
  termination days inclusive). Both locks are proven by tests that go red when the
  lock is removed.
- **The machine is the database's.** Exactly five edges exist: `pending -> approved
-> payable -> paid`, and `voided` from `pending` or `approved`. Each stamps its
  own actor and time and touches no other stamp; the monetary facts are compared
  byte for byte by trigger; no row is deleted. A voided accrual can never be paid.
  The pure `canTransition` and the trigger are tested against each other on every
  pair of states. **Segregation of duties**, in the handler and in the trigger
  (pure `sodViolation` is the twin): the beneficiary (the employment's own login)
  can approve, release or pay none of their own accrual; whoever created an
  accrual cannot approve it; whoever approved it cannot pay it (`403
SEGREGATION_OF_DUTIES`, or `APPROVE_OWN_ACCRUAL_FORBIDDEN` for the beneficiary
  approving). **The beneficiary is the login snapshotted when the accrual was
  created (`beneficiary_tenant_user_id`, stamped by trigger, `sql/236`) AND the
  employment's current login** (Issue #1019): unlinking the login and relinking it
  around a self-approval gains nothing. With neither a linked login nor a snapshot,
  approve, release and pay are refused (fail closed, `409
BENEFICIARY_LOGIN_UNRESOLVED`; `sql/237`). Void is not segregated. A test removes the trigger's guard and shows
  the bypass succeeds.
- **The log cannot diverge from the status.** `awcms_hr_commission_transitions` is
  written only by the accrual's own triggers (a direct insert is refused by
  `pg_trigger_depth()`), once at birth and once per status change, so an accrual's
  status is always its latest transition. `reconcileAccruals` proves it (status
  against latest transition, chain continuity, and the per-currency-and-status
  balances derived both ways) and reports exactly which accruals disagree when rows
  were changed outside the application role; a test tampers as superuser and
  watches it fail.
- **Audit and masking.** Approve, release, void and pay are high-risk (`pay` is a
  new access action), separately grantable, idempotency-keyed and audited at
  `warning`; a NEW accrual is audited at `info`, a replay audits nothing. **No audit
  row carries an amount, a base, a rate, a source reference or a payment
  reference** (earnings are financial data about a person; the ledger row holds the
  amount and the correlation id joins it to the audit row). The void reason is a
  short code and the payment reference an opaque token: neither is free text.
- **No personal data.** An accrual references an employment (an opaque id) and four
  actor stamps; the tables hold no name, identifier, contact, account, photo,
  biometric or device column (a test scans them).
- **The port.** `_shared/ports/commission-accrual-port.ts` fixes the shape an
  adapter reports a sale through; this module imports nothing from commerce or
  booking. The adapter, not the ledger, verifies the sale is real, paid and the
  employee's, and decides what is commissionable. Authorization and audit stay with
  the caller's composition root (`POST /api/v1/hr-commission/accruals` is one).
- **Reversing an accrual: `CommissionAccrualPort.void` (Issue #1109, port contract
  `commission_accrual` 1.1.0).** `void(tx, tenantId, actorTenantUserId, { source,
employmentId, reason, correlationId? })` is keyed by the SAME source identity
  `accrue` took, so a consumer (the first is the commerce sale-attribution adapter
  in a derived repository) never stores this module's ids. It locates the accrual by
  the ledger's own unique key, locks it `FOR UPDATE` and answers:
  - `voided` - a `pending` or `approved` accrual was voided. It goes through the one
    transition core the HTTP void route uses, so the audit row
    (`hr_commission.accrual.voided`, no amount, no source reference), the
    `awcms.hr.commission.voided` domain event and the append-only transition-log
    row are all written in the CALLER's transaction and roll back with it.
  - `already_voided` - a replay; nothing is written, audited or published, whatever
    `reason` the replay carries. Racing voids serialise on the row: one `voided`.
  - `not_found` - nothing was accrued for that source and employment (also what
    another tenant's accrual looks like: RLS).
  - `period_closed` - the accrual is `payable` or `paid`; refused, nothing written.
  - `actor_required` (a `null` actor: every edge stamps a person) and
    `input_invalid` (a malformed source, an employment id that is not a UUID, a
    `reason` that is not a code).

  **Compensating entry.** The accrual is never edited or deleted: its monetary facts
  are immutable by trigger and stay as posted. The reversal is the status edge to
  `voided` plus the transition-log row the database appends (the ledger's "append"
  for a reversal while no money has moved), so `reconcileAccruals` shows the amount
  leave the live buckets and sit under `voided`, and a voided accrual can never be
  paid. No migration was needed: a NEGATIVE row (`operation = reversal`) is only
  required once money is committed, which is the next point.

  **Closed-period policy (decided in #1109): refuse, `period_closed`.** This module
  has no commission period of its own; the boundary is the accrual's status.
  `payable` means released to payroll, whose run selects payable accruals
  (`FOR UPDATE SKIP LOCKED`, PS-19), and `paid` means a payout is recorded. There is
  no reversal-into-the-current-period mechanism yet (the negative row of
  hr-payroll.md 6.3, below), and voiding money payroll may already hold would break
  "an accrual is paid by exactly one run". So the port refuses and writes nothing;
  the outcome carries `accrualId` and `status`, and the consumer routes it to a
  human (a clawback / next-run netting), never to a blind retry. When the
  reversal row lands, `period_closed` is the case it replaces with a posted
  reversal; `voided`, `already_voided` and `not_found` keep their meaning.

- **Known gap: a void permanently consumes its source key.** A voided accrual
  keeps its `(source, employment)` identity, so a redelivery of the same source
  returns the voided original (never a new accrual) and the commission cannot be
  re-earned for that source. Until reversal and a re-accrual path exist (#962 and
  the reversal phase), correcting a wrongly voided accrual means a new source
  reference chosen by the adapter. This is deliberate (a void must not be silently
  undone by a redelivery) and recorded as a gap, not a feature.
- **PS-19 (an accrual is paid by exactly one payroll run, including after a
  reversal) is designed for, not built.** `payable -> paid` happens once and `paid`
  is terminal; a partial index serves the run's `FOR UPDATE SKIP LOCKED` selection
  of payable accruals; and a reversal, when it lands, is a NEW row that never
  re-opens its original, so no state exists from which one accrual could be claimed
  twice. The claim record itself (run id; release on a cancelled run) belongs to
  #962 because releasing a claim depends on the recovery decision PS-02 has not
  made.

## Map

| File                                                | Holds                                                                        |
| --------------------------------------------------- | ---------------------------------------------------------------------------- |
| `module.ts`                                         | Descriptor, permissions, `dataLifecycle` and `subjectData`                   |
| `domain/hr-commission-accrual-state.ts`             | Pure accrual machine, back-dated window and employment-date rules            |
| `domain/hr-commission-accrual-validation.ts`        | Accrual request validators, canonical request digest                         |
| `application/hr-commission-accrual-ledger.ts`       | Accrue, list, get, transitions, reconciliation (outcomes, audit)             |
| `application/hr-commission-accrual-port-adapter.ts` | The concrete `CommissionAccrualPort`                                         |
| `src/pages/api/v1/hr-commission/accruals/**`        | 6 thin route files (`/accruals`, `/{id}`, `.../approve\|release\|void\|pay`) |
| `domain/hr-commission-decimal.ts`                   | Exact `bigint` decimal parsing, rounding, formatting                         |
| `domain/hr-commission-evaluation.ts`                | PURE `evaluateCommission` and `selectEffectiveRule`                          |
| `domain/hr-commission-validation.ts`                | Strict request validators (money as strings)                                 |
| `domain/hr-commission-permissions.ts`               | The guards, as literal objects                                               |
| `application/hr-commission-rule-directory.ts`       | List, get, create, edit draft, publish, retire (outcomes, audit)             |
| `application/hr-commission-route-support.ts`        | Idempotency, body parsing and id helpers shared by the routes                |
| `src/pages/api/v1/hr-commission/rules/**`           | 4 thin route files (`/rules`, `/rules/{id}`, `.../publish`, `.../retire`)    |

## Open items and recorded postures

- **Evaluation has no HTTP endpoint of its own.** The accrual endpoint is its
  consumer; a dry-run endpoint is not exposed.
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
- **Reversal is the next step of the ledger.** A reversal of a payable or paid
  accrual is a NEW negative row (`operation = reversal`, `reverses_accrual_id`)
  under its own source identity, once per accrual, never reversible, never
  re-opening its original. The unique key, the `operation` column and the
  transition log already have room for it; a `sql/NNN` that widens the
  `operation` and status CHECKs and the machine will add it.
- **Events: only `voided` exists.** `awcms.hr.commission.voided` (Issue #1109;
  registry, AsyncAPI channel and `events.publishes`) is published in the transaction
  of every void, HTTP or port, with ids, the source TYPE, the rule key and version,
  `fromStatus` and the reason code (never an amount or a source reference).
  `awcms.hr.commission.accrued` and `.approved` (hr-payroll.md section 10) are not
  emitted yet: nothing is published until a consumer needs them.
- **No own-accrual read and no office scope yet.** `accruals.read` is a plain
  permission: the "employee sees their own accruals" path (an ownership grant on
  the employment's login) and the `office` business scope are follow-ups with the
  self-service surface.
- **A person's accrual history is exported to that person** (Issue #1018,
  ADR-0142): `hr_commission.accruals` reaches the beneficiary through
  `employment_id` (`subjectVia`) and is `exportable: true`; the actor stamps are not
  subject columns. Because earnings sit on the payroll boundary, the subject-export
  route does **not** hand them out on `data_lifecycle.subject_request.export`
  alone: the caller must ALSO hold `hr_commission.accruals.read`, otherwise the
  table is withheld and named under `withheld` in the response (default-deny, also
  for a replay of a stored export). Every read that does happen is recorded as a
  sensitive read (ids and a count, never an amount). `hr_commission.transitions`
  stays `exportable: false`: it needs a second hop and adds nothing about the
  beneficiary the accrual does not carry. Whether earnings may be exported to the
  subject at all is a product/legal decision recorded in the ADR-0142 addendum.
  The join uses `profile_id` ONLY (a login mislinked to somebody else's employment
  and later corrected would otherwise put that employment's accruals into the
  login's export). The stored `Idempotency-Key` record keeps these rows as ids only
  and a replay re-reads them under a fresh `accruals.read` check. The
  `beneficiary_tenant_user_id` snapshot (`sql/236`) is a redacted column of the
  export and is in no API response: the header comment of `sql/236` that says it
  "is not exposed by any API" stays true only because of that redaction, and the
  applied migration cannot be edited to say so.
- **Retention: retained for the life of the tenant, no period asserted.** There is
  deliberately NO `dataLifecycle` descriptor for any of the three tables (a
  descriptor must assert a period and a purge mode, and nothing purges): the ledger
  tables are answered by `BOUNDED_BY_DESIGN` entries in
  `scripts/data-lifecycle-table-coverage-check.ts`. The period belongs to the
  employer's counsel; archive-then-purge of PAID and VOIDED accruals is a follow-up
  (hr-payroll.md section 15).
- **The subject descriptor is actor-stamps only** and `exportable: false`: a rule
  names no data subject.

## Limitations

- Only the employee's own-commission screen exists (Issue #952); the rule screens and the accrual screens (list, approve / release / void / pay) are the follow-up.
- Existing tenants need `bun run identity-access:permissions:backfill` to receive
  the seeded permissions (the limitation every permission seed carries).
- A draft can only be changed by replacing every editable field (`PUT`); there is
  no partial edit and no "copy from the previous version" helper.
- `btree_gist` is not used: overlap is a trigger, not an exclusion constraint.
