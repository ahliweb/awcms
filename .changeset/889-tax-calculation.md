---
"awcms": minor
---

feat(tax): a generic, jurisdiction-neutral tax calculation module (#889, ADR-0127)

Consumers of this template carry one flat store-level tax percentage. That is
fine until a rate changes (and every document issued before must keep the tax it
was issued with), a price list mixes taxable, exempt and zero-rated items, a
jurisdiction stacks two levies, or one customer returns one item of three months
later — and it is wrong by construction when a storefront, a POS and an invoice
each compute the tax their own way. This adds the generic core underneath all of
that: one calculator, one rule model, one immutable snapshot, behind an API.

API-first. No admin screen and no `navigation` entry ship here (an entry without a
page is a permanent 404); rule-authoring screens are a recorded follow-up.

### What it does

- `POST /api/v1/tax/quote` — stateless calculation. `POST /api/v1/tax/snapshots` —
  finalise a document's tax, idempotently. `POST /api/v1/tax/snapshots/{id}/reverse`
  — refund or return all or part of it. Plus rule-version authoring and
  publication, snapshot reads, and a reconciliation report.
- **Rule versions** carry an effective window (half-open, non-overlapping per
  profile), a pricing mode (exclusive/inclusive), a rounding mode (seven), scale
  and level (per line, or round-the-sum-once and apportion), any number of
  components including stacked/compound ones, and exempt vs zero-rated treatments
  kept distinct. Country profiles are configuration, authored after a verified
  regulatory mapping; **none ships**.
- **Exact money.** Every amount is a decimal string (a JSON number is refused) and
  every computation is `bigint` rational arithmetic. No floating point touches an
  amount. The calculator is pure and deterministic.
- **Server-authoritative.** No endpoint accepts a tax amount; a payload that names
  one is refused with `400 TAX_AMOUNT_NOT_ACCEPTED`, not ignored.
- **Historical documents cannot change.** A published version is immutable and
  published windows cannot overlap (both enforced by database triggers, the second
  under an advisory lock); a snapshot is append-only and carries a copy of the rule
  it was computed under; a refund is computed from the original snapshot alone —
  it has no parameter that could carry a current rate.

### Contract and operations

- Migrations `sql/171` (rule versions), `sql/172` (snapshots), `sql/173`
  (permissions). Two tables, both tenant-scoped with `ENABLE` + `FORCE` RLS.
- New permissions `tax.rules.{read,configure,publish}`,
  `tax.calculations.analyze`, `tax.snapshots.{read,create,reverse,backdate}`,
  `tax.reports.read`. New high-risk access actions `reverse` and `backdate`. Existing tenants'
  `owner` roles receive them from the owner-permission backfill job.
- Domain events through the outbox, registered in the runtime registry and
  AsyncAPI: `awcms.tax.rule_version.published`, `awcms.tax.snapshot.finalised`,
  `awcms.tax.snapshot.reversed`.
- Reporting: a counting projection (`tax.snapshot_activity`) on the `reporting`
  engine, and a live monetary reconciliation report with an integrity block.
- `awcms_tax_snapshots` has a `data_lifecycle` descriptor (`financial_tax`, floor
  1826 days, also enforced by the database trigger) and `awcms_worker` gains
  `SELECT, DELETE` on it. `BOUNDED_BY_DESIGN` grows by one entry (and its cap by
  one).
- OpenAPI: new `Tax` tag and `openapi/modules/tax.openapi.yaml`.

### Hardening from the security audit

- A rule version cannot be published before the server's date or on/before a tax
  date already finalised under its profile (`409 TAX_VERSION_BACKDATED`); the
  per-request `pricingMode` override is removed (the version decides); a document's
  tax date is bounded against the server date (default 7 days back, 1 forward,
  `TAX_TAXDATE_PAST_DAYS` / `TAX_TAXDATE_FORWARD_DAYS`) and outside that needs the
  new high-risk permission `tax.snapshots.backdate`; amounts that cannot fit
  `numeric(24,6)` are `422 TAX_INPUT_INVALID`; lists return summaries; the snapshot
  detail no longer embeds the rule definition; malformed ids are 404; document ids
  are opaque handles.

### Operators

**Existing tenants need the permission backfill.** `sql/173` extends the catalogue
only, so a tenant created before it has an `owner` role without the nine `tax.*`
permissions and every tax route answers `403`. After migrating, run
`bun run identity-access:permissions:backfill --commit` (without `--commit` first
for a dry run). Tenants created afterwards need nothing.


A published rule version cannot be edited, back-dated or deleted. Correct a wrong
rate by publishing a successor with a later effective date, and a wrong document by
reversing it. Spec, worked examples, data dictionary and the migration adapter
contract for consumers leaving a flat percentage:
`docs/awcms/tax-calculation.md`.
