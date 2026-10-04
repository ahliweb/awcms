🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0127-generic-jurisdiction-neutral-tax-calculation-module.id.md)

# ADR-0127 — a generic, jurisdiction-neutral tax calculation module (`tax`)

- **Status:** Accepted
- **Date:** 2026-10-04
- **Decision maker:** ahliweb
- **Supersedes:** nothing.
- **Related:** [Issue #889](https://github.com/ahliweb/awcms/issues/889) (downstream: `ahliweb/awcms-one#293`); [ADR-0034](0034-awcms-family-direct-use-templates-and-derived-pathway-removal.md) (ERP modules live in `src/modules/` of this template); [ADR-0055](0055-development-confined-to-awcms-and-awcms-astro.md) (a capability is built here, with its own admission); [ADR-0063](0063-ownership-grants-run-through-the-authorization-chokepoint.md) (the per-handler authorization chokepoint); [ADR-0006](0006-offline-first-sync-outbox.md) (outbox); [ADR-0026](0026-modular-openapi-ownership-and-composition.md); `src/modules/tax/`; `sql/171`–`sql/173`; `docs/awcms/tax-calculation.md`; `docs/awcms/21_module_admission_governance.md`

## Context

Consumers of this template carry a **single store-level tax percentage**: one
number in a settings table, multiplied into a cart total by whichever caller
happens to render it. That is correct until the first of these happens, and each
of them is ordinary rather than exotic:

- the rate changes, and every document issued before the change must keep the
  tax it was issued with — a settings number that is simply overwritten cannot
  say which rate a March receipt used;
- one price list holds a taxable item, an exempt item and a zero-rated item;
- a jurisdiction charges two levies, one of them computed on a price that already
  includes the other;
- a storefront shows tax-inclusive prices, a back-office shows tax-exclusive ones,
  and a POS rounds per line while the invoice rounds per document — three callers,
  three subtly different totals for the same basket;
- a customer returns one item of three, months later, after the rate moved.

`docs/awcms/21_module_admission_governance.md` §4.3 names tax among the ERP domain
modules that are generic across tenants and may be built directly in
`src/modules/`; `AGENTS.md` lists tax/Coretax export in the ERP map. What does not
exist is the generic core underneath any of it: a calculator that is
**auditable, deterministic, server-authoritative and ignorant of any one
country's law**.

## Decision

Admit **one new domain module, `tax`** (`type: "domain"`, category: ERP domain
module — generic across tenants, disableable per tenant), API-first.

### 1. Two tables, not six

A profile is a **code** shared by the versions that replace one another; it has
no row of its own. A version's categories, rules and components live in its
`definition` jsonb, validated strictly by the application before insert and
immutable once published. A snapshot's lines live in its own row. So the whole
module is `awcms_tax_rule_versions` and `awcms_tax_snapshots`.

This is not minimalism for its own sake. Every table must answer the retention
question (`data-lifecycle:table-coverage:check`), and the exemption ledger
(`BOUNDED_BY_DESIGN`) is capped with the bar "a net shrink, not an argument". A
six-table design (jurisdictions, categories, profiles, versions, rules,
components) would have needed five new entries for rows that are authored, never
accumulated, and that the age-based generic purge would delete **while in
force**. The two-table design needs one entry (the cap moves 14 → 15, with the
reasoning in the test), and the table that genuinely grows with traffic carries a
real `dataLifecycle` descriptor.

The cost is real and accepted: a category or a component cannot be foreign-keyed
or queried relationally from SQL. Both are immutable once published, which is
what makes the denormalisation safe — they cannot drift — and the reconciliation
report unnests them in SQL where it must.

### 2. Money is exact: `bigint` rationals, decimal strings on the wire

No floating point touches an amount. Every quantity, price, discount and rate is
a **decimal string** in the API (a JSON `number` is refused, not converted — it
has already been through an IEEE double) and a `bigint` numerator over a `bigint`
denominator in the calculator (`domain/decimal.ts`). A rational rather than a
scaled integer because tax-inclusive pricing needs a _division_ (`gross / (1 +
rate)`), whose result is not a decimal; the rational keeps it exact and defers
rounding to the one place the rounding rule says to round. `numeric(24,6)` in the
database; rounding scale is 0–6.

### 3. One pure calculator, rounding stated rather than implied

`calculateTax(version, lines)` is a pure function: no clock, no database, no
locale. The same input and rule version give byte-identical output — the property
that lets a stored snapshot be recomputed years later, and an offline client embed
the same file.

A rule version states, explicitly: **pricing mode** (`exclusive` / `inclusive`),
**rounding mode** (`half_up`, `half_down`, `half_even`, `up`, `down`, `ceiling`,
`floor`), **scale**, and **level**:

- `line` — each line's tax is rounded on its own and the document is their sum;
- `document` — the exact tax of every line is summed per component, rounded
  **once**, and apportioned back to the lines by largest remainder (ties go to the
  lower index, so the result never depends on iteration order).

Either way a line's `net + tax = gross` and the document equals the sum of its
lines to the last unit. Inclusive pricing **preserves the gross**: what was priced
is what is charged, and tax is what is left after the net is rounded.

**Components** are ordered; a `cumulative` component is charged on net plus every
earlier component's tax — the stacked / compound case — and a `net` one on net.
**Exempt** and **zero-rated** are distinct treatments recorded per line (they are
different lines on a return), and neither carries components. A line the rules
do not cover is **refused** (`422 TAX_RULE_NOT_FOUND`), never silently untaxed;
the one way to cover "everything else" is an explicit fallback rule.

**The pricing mode belongs to the version, not to the request.** An earlier
draft let a caller override `exclusive`/`inclusive` per request. It is removed: a
caller holding only `tax.calculations.analyze` or `tax.snapshots.create` could
re-price the same basket under the other mode and have the server record the
result as authoritative, which is a rule-authoring power (`tax.rules.publish`)
reached through a document-posting permission. An override gated behind a flag on
the version was considered and rejected as well — no consumer needs one (a shop
is either tax-inclusive or not, and says so in its version), and a flag nobody
sets is surface that exists only to be misconfigured. `pricingMode` in a request
body is now an unrecognised field.

### 4. Versions are immutable and never overlap — enforced in the database

A published version cannot be edited, re-opened or deleted by any writer
(`awcms_tax_rule_versions_guard`), with exactly one exception: an open-ended
window may be **closed once**, forward, when its successor is published.
Windows are half-open (`effective_from` inclusive, `effective_to` exclusive), so
the boundary day belongs to exactly one version and there is no gap. A new
version must take effect **strictly after** the latest published one — there is no
publishing into the past, because back-dating a rule re-taxes days that already
have documents. A correction to history is a reversal.

That ordering rule alone left two ways to back-date, so a publish is also refused
(`409 TAX_VERSION_BACKDATED`, distinct from `TAX_VERSION_OUT_OF_ORDER`) when its
`effective_from` is **before the server's current date** — `now()` from the
database, in UTC, never JavaScript time — or **on or before the latest `tax_date`
of any snapshot under that profile in the tenant**. The first stops a rule from
re-taxing days that are over; the second stops it from claiming days that already
carry documents computed under the previous version (a document may legitimately
carry tomorrow's date, so "after today" is not enough). Consequently a first
version cannot start in the past either: history before cutover keeps the amounts
it was issued with (`docs/awcms/tax-calculation.md` §Migration adapter contract).
Both checks run under the profile advisory lock, and finalising takes the **shared**
form of that lock before it resolves its rule version, so a publish waits for
in-flight finalises to commit and sees their tax dates, and no document can slip
in between the check and the commit. The checks are in the application, not in a
trigger: the trigger's job is the invariant that must hold against every writer
(immutability, non-overlap); "not before today" is a policy about the clock.

Non-overlap is a trigger that takes a transaction-scoped **advisory lock** on the
profile before it looks, rather than an exclusion constraint, because an
exclusion over `(tenant, profile, daterange)` needs the `btree_gist` extension: a
privileged `CREATE EXTENSION` that no migration in this repo asks for and that a
managed-database operator may not grant the migration role. The application takes
the same lock first, so two concurrent publishes serialise instead of racing (one
wins; the other gets `409 TAX_VERSION_OUT_OF_ORDER`), and the trigger is the
backstop for every writer that is not this module.

### 5. A snapshot is the document's tax, forever

Finalising writes an **append-only** row (`awcms_tax_snapshots_immutable` refuses
every update and every delete younger than 1826 days) that carries the computed
lines **and a copy of the rule definition it was computed under**. Updating a rule
therefore cannot change a historical document by construction: the version it
cites is immutable, and the row does not even need to read it.

Finalising is idempotent twice over — the `Idempotency-Key`, and the natural key
`(tenant, kind, documentType, documentId)` with a stored request hash — so an
offline POS replaying its queue under rotated keys still produces one snapshot.

**A refund is computed from the original snapshot alone.** `computeReversal` takes
the snapshot's recorded quantities and amounts and has no parameter that could
carry a rate: it cannot consult today's rule. Partial reversals take `q/Q` of the
line, cap at what has not yet been reversed, and the reversal that completes a
line takes the exact **remainder**, so refunding in any number of steps returns
precisely what was charged. Concurrent reversals of one sale serialise on a row
lock; a trigger repeats the arithmetic and refuses one that would refund more than
was charged. `original_snapshot_id` is deliberately not a foreign key — retention
may remove an aged original while a younger reversal survives, and the reversal
row is self-contained.

Retention: `retentionClass: financial_tax`, floor 1826 days (five years and a leap
day), enforced by the trigger as well as the descriptor so the database stays the
last word. The floor is a **platform minimum, not a statement of any
jurisdiction's statutory period**; an operator whose obligation is longer sets a
longer policy or a legal hold.

### 6. Server-authoritative, with a distinct refusal

No endpoint accepts a tax amount. Every request object is closed (an unknown key
is an error), and a key that looks like a computed money field — `taxAmount`,
`vat`, `total`, `net`, `gross`, `rate` — is refused with its **own** code,
`400 TAX_AMOUNT_NOT_ACCEPTED`, rather than ignored: silently dropping it would let
a caller believe its figure was honoured and let a future refactor start reading
it. Every storefront, POS and quote path reaches **one** calculator, so a cart, a
receipt and a refund cannot disagree.

**The tax date is bounded against the server's date.** The caller states a
document's tax date (a late-synced offline POS sale legitimately carries
yesterday's), but a caller who may state _any_ date can post into a closed period
or into one whose rule has not started. So `POST /snapshots` — and a _stated_
`taxDate` on a reversal — must fall within a window around the server's UTC date
(`now()` from the database): **7 days back, 1 day forward** by default, set by
`TAX_TAXDATE_PAST_DAYS` / `TAX_TAXDATE_FORWARD_DAYS` (a malformed value falls back
to the default rather than widening the window). Outside it the caller must also
hold **`tax.snapshots.backdate`**, a separate high-risk permission seeded in
`sql/173` and checked through the chokepoint (so the decision log records it);
without it the answer is `403 TAX_BACKDATE_PERMISSION_REQUIRED`, never silent
acceptance, and the audit row records `backdated: true` when the permission was
used. A reversal with no `taxDate` is dated the **server's** date, not the
original's: a refund reports in the period it happened. Of the options
considered — an env-set window, a per-tenant settings row, an unconditional
permission — the env window was chosen as the simplest that never accepts
silently; a per-tenant setting is a follow-up if tenants need different skews.
`/quote` is not windowed: it records nothing.

### 7. Authorization, idempotency, audit, events

Every handler authorizes through `authorizeInTransaction` (ADR-0063), default-deny.
Nine permissions: `tax.rules.{read,configure,publish}`,
`tax.calculations.analyze`, `tax.snapshots.{read,create,reverse,backdate}`,
`tax.reports.read`. Authoring a draft is not publishing it (`configure` vs
`publish`, the natural second key of a maker/checker split a tenant can author as
a SoD rule); finalising is not refunding. Two new actions, **`reverse`** and **`backdate`**, are added
to `AccessAction` and classified **high-risk** — a reversal posts a negative tax
document.

Draft creation, publication, finalise and reverse require an `Idempotency-Key`;
publication and reversal are audited at `critical`. The stateless quote needs
neither. Three events go through the outbox (ADR-0006, same transaction, no
provider call) and are registered in the runtime registry and the AsyncAPI
contract: `awcms.tax.rule_version.published`, `awcms.tax.snapshot.finalised`,
`awcms.tax.snapshot.reversed`. A replay publishes nothing. Audit attributes and
event payloads carry identifiers, codes and totals — the module stores **no
customer data**, a document is an opaque reference.

### 7a. Hardening from the security audit of the first cut

- **Amounts are capped.** Every line figure and document total must fit
  `numeric(24,6)` (under 10^18); otherwise `422 TAX_INPUT_INVALID`, from `/quote`
  and `/snapshots` alike, rather than a database error after the work is done.
- **The profile lock key is canonical.** The application's advisory lock casts the
  tenant id through `::uuid` before building the key, so an upper-case header
  produces the same key as the trigger's `tenant_id::text`.
- **Lists are summaries.** Listing snapshots omits `lines`, listing rule versions
  omits `definition`; the bodies come from the detail endpoints.
- **A snapshot read does not leak rules.** The detail returns the version id and
  number, not the embedded rule definition: rates and categories are
  `tax.rules.read`, a different power from reading a document.
- **Malformed `{id}`** on all four `[id]` routes answers 404, not 500.
- **Document/line references are opaque handles**: `[A-Za-z0-9][A-Za-z0-9._:/-]*`,
  length-bounded, never trimmed. `reason` stays out of event payloads (the audit
  row keeps it; audit is redacted by key).

### 8. Reporting

Two halves, because the engine has one limit. A `cursor_table` projection on the
existing `reporting` engine (`tax.snapshot_activity`) counts documents finalised
and reversals recorded — freshness-tracked, rebuildable, reconciled against a fresh
`COUNT` by the engine; `awcms_tax_snapshots` is append-only, the one source for
which an increment-only cursor is exactly correct. The engine's metric rules can
only count, so the money lives in `GET /api/v1/tax/reports/reconciliation`: sales
net of reversals per currency, by rule version, component and treatment, plus an
**integrity block** checking every snapshot in the period against its own lines. It
is the projection's drill-down, aggregated in SQL and span-capped.

### 9. API-first: no screens, no navigation entry

This change ships the API. A `navigation` entry without a real page is a permanent
404 in the sidebar (`AGENTS.md`), so the descriptor declares none. The rule-authoring
screens are the first follow-up (below).

## Regulatory applicability

**The core ships no country's law, and this ADR states none.** In particular it
does **not** ship an Indonesian profile, and does not record any statute, rate,
tax base, threshold, or exemption list for Indonesia or anywhere else. The issue
requires a _verified regulatory mapping_ before a country profile exists, and that
is a different kind of work from engineering: it needs the regulator's **current**
text, reviewed by someone qualified, on a date, and law changes — which is
precisely why the module is versioned by effective date.

What a country profile is, once it exists: **configuration** — a rule version
authored through `POST /api/v1/tax/rule-versions` — never code in `domain/`. The
mapping that must be verified before such a version is published for production
use covers at least:

1. the components, their rates, and whether each applies to net or cumulatively;
2. the definition of the **taxable base** (what is included before the rate
   applies, and what discounts reduce it);
3. the rounding rule, its scale, and whether it applies per line or per document;
4. whether prices must be displayed inclusive or exclusive, and where back-
   calculation is mandated;
5. which supplies are **exempt** and which are **zero-rated**, with effective
   dates — the module keeps them distinct because returns do;
6. the effective dates of every change, including transitional rules;
7. everything that is **not** a tax calculation and stays out of this module:
   invoice numbering, e-invoice/e-filing formats, and submission to a tax
   authority (the Coretax export is an external-integration module of its own,
   behind the outbox).

A tenant may use the module today with any rule set it is entitled to author; the
module is a calculator, not a compliance opinion, and says so in its API
description. Nothing here or in the module should be read as stating what any
jurisdiction requires.

## Alternatives considered

- **Keep a flat percentage and add effective dating to the setting.** Solves the
  rate-change case only, leaves every other bullet in the Context, and still
  leaves each caller computing the tax itself.
- **A relational rule model (profiles, categories, rules, components as tables).**
  The textbook shape, rejected on the retention-ledger cost in §1. Revisit if a
  consumer needs SQL joins over components; the immutable `definition` could be
  projected into tables without changing the API.
- **`numeric` arithmetic in SQL.** Exact too, but the calculator would then live
  in the database, cannot be shared with an offline client, and cannot be unit
  tested without one. Rejected: determinism and portability are the point.
- **JavaScript `number` with integer minor units.** Exact for exclusive pricing,
  unsafe past 2^53 and unable to represent inclusive back-calculation. Rejected.
- **An exclusion constraint for non-overlap.** Cleaner, needs `btree_gist` (§4).
- **Child tables for snapshot lines and components.** More queryable, three
  append-only guarantees instead of one and three retention answers instead of one.
  The reconciliation report unnests the jsonb; revisit on a measured need.

## Consequences

- Tax becomes one calculator behind one API; a cart, a receipt and a refund agree
  by construction.
- Historical documents are immune to rule changes — a property of the schema, not
  of code review.
- Rule authors can **not** back-date, edit or delete a published version, and a
  version cannot take effect before the server's date at all — including the first
  one for a profile. A mistake in a published version is corrected by publishing a successor, and a
  wrong document by reversing it. Operators used to editing a setting must be told.
- Consumers that back-date or late-sync documents beyond the window need
  `tax.snapshots.backdate`.
- There is no draft deletion in this change; an abandoned draft stays (it is never
  resolved). Bounded by human authoring, listed as a follow-up.
- `AccessAction` gains `reverse` (high-risk); `BOUNDED_BY_DESIGN` grows by one and
  its cap by one; `awcms_worker` gains `SELECT, DELETE` on `awcms_tax_snapshots`.
- Existing tenants do not get the new permissions until the owner-permission
  backfill job runs (`sql/173` extends the catalog only).

## Follow-ups (not in this change)

1. **Admin screens** for rule authoring, publication and the reconciliation view
   (`/admin/tax`), with the `navigation` entry in the same change as the page.
2. **Country profiles** as configuration, one per verified regulatory mapping.
3. **Consumer adapters** — `awcms-one#293` and `awcms-astro` replacing the flat
   percentage (`docs/awcms/tax-calculation.md` §Migration adapter contract).
4. **Draft deletion**, and a tenant-facing category/jurisdiction registry if a
   consumer needs one.
5. **Offline POS**: an embeddable build of the pure calculator plus a documented
   rule-version cache protocol (the rule version document is already everything it
   needs); the server snapshot stays authoritative on sync.
6. **A Coretax / e-invoice export** as an external-integration module behind the
   outbox, after follow-up 2.
7. **A SoD rule** over `tax.rules.configure` + `tax.rules.publish` for tenants that
   want maker/checker (the base ships none, by policy).
