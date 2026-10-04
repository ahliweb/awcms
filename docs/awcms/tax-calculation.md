🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](tax-calculation.id.md)

# Tax calculation — algorithm specification, data dictionary and adapter contract

> **Status.** Specification for the `tax` module admitted by
> [ADR-0127](../adr/0127-generic-jurisdiction-neutral-tax-calculation-module.md)
> (Issue #889). The code is `src/modules/tax/`, the schema is `sql/171`–`sql/173`,
> the HTTP contract is `openapi/modules/tax.openapi.yaml`, the events are in
> `asyncapi/awcms-domain-events.asyncapi.yaml`. Every worked example below is also
> an assertion in `tests/tax-calculator.test.ts`.
>
> **This is a calculator, not a compliance opinion.** It ships no country's law
> and states none. See ADR-0127 §Regulatory applicability.

## 1. Model in one page

```
rule version (profile_code + version_no, effective window, pricing, rounding,
              definition = { categories[], rules[ { category, treatment, components[] } ] })
      │  published ⇒ immutable (except: close an open window once)
      ▼
quote       POST /api/v1/tax/quote        stateless, records nothing
snapshot    POST /api/v1/tax/snapshots    append-only; carries a COPY of the definition
reversal    POST /api/v1/tax/snapshots/{id}/reverse
                                          computed from the ORIGINAL snapshot alone
```

- A **profile** is a code (`retail`, `export`, …) shared by the versions that
  replace one another. There is no profile row.
- A **version** is in force from `effectiveFrom` (inclusive) until `effectiveTo`
  (exclusive; `null` = open-ended). At most one published version covers any
  calendar day of a profile.
- The **tax date** is a calendar date the _caller_ states ("the day the supply
  happened"). It is never the server's clock, which is what makes a back-dated or
  late-synced document resolve to the rule that was in force on its own date.

## 2. Vocabulary

| Term            | Values                                                          | Meaning                                                                                                                 |
| --------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `pricingMode`   | `exclusive` · `inclusive`                                       | `unitPrice` is net (tax added on top) / gross (tax is inside it)                                                        |
| `treatment`     | `taxable` · `exempt` · `zero_rated`                             | `taxable` has ≥ 1 component; the other two have none and are kept distinct because they are different lines on a return |
| `basis`         | `net` · `cumulative`                                            | a component's rate applies to net / to net **plus every earlier component's tax** in declaration order                  |
| `roundingMode`  | `half_up` `half_down` `half_even` `up` `down` `ceiling` `floor` | see §4                                                                                                                  |
| `roundingScale` | 0 – 6                                                           | decimal places amounts are rounded to                                                                                   |
| `roundingLevel` | `line` · `document`                                             | each line rounded alone / exact tax summed per component, rounded **once**, apportioned back                            |

Amounts, quantities and rates are **decimal strings**. A JSON number is refused.
Quantity and price have at most six fractional digits; a rate is a percent with at
most six, between 0 and 1000.

## 3. The algorithm

Input: a rule version `V`, lines `L₁…Lₙ` (`quantity`, `unitPrice`, optional
`discount`, optional `categoryCode`). The pricing mode is the version's, never the
caller's. Output:
per-line and per-document net, tax and gross, with per-component detail.

**Step 1 — line amount.** `A = quantity × unitPrice − discount`, computed exactly
(rational), refused if negative, then rounded **once** to `V.roundingScale` with
`V.roundingMode`. `A` is the line's **net** under exclusive pricing and its
**gross** under inclusive pricing. Expressed in integer _units_ of 10⁻ˢᶜᵃˡᵉ below.

**Step 2 — the rule.** The rule for the line's category; else the **fallback** rule
(`categoryCode: null`); else the calculation is refused with `TAX_RULE_NOT_FOUND`.
A line is never silently treated as untaxed.

**Step 3 — factors.** For components `c₁…c_m` in order, with `rᵢ = rate/100`:

```
kᵢ = rᵢ                       if basis = net
kᵢ = rᵢ × (1 + k₁ + … + kᵢ₋₁)  if basis = cumulative
K  = 1 + k₁ + … + k_m
```

**Step 4 — exact tax (rational, nothing rounded yet).**

```
exclusive:  net = A                     taxᵢ = net × kᵢ
inclusive:  net = A / K                 taxᵢ = net × kᵢ
```

**Step 5 — rounding, once, at the stated level.**

| Level      | Exclusive                                                                                        | Inclusive                                                                                                                                               |
| ---------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `line`     | `taxᵢ ← round(taxᵢ)` per line, per component                                                     | `net ← round(A/K)`; `T = A − net`; `T` is split across components in proportion to `kᵢ` by largest remainder                                            |
| `document` | per component `c`: `T_c = round(Σ_lines tax_c)`; apportion `T_c` to lines by their exact `tax_c` | `N = round(Σ_lines A/K)`; `T = Σ A − N`; apportion `T` to components by `Σ_lines tax_c`; then each component to lines by exact `tax_c`; `net = A − tax` |

**Largest-remainder apportionment** splits an integer `T` across non-negative
weights so the parts sum to exactly `T`: take each `floor(T × wᵢ / Σw)`, then give
one unit each to the largest fractional remainders, **ties to the lower index**.
It is a function of its inputs alone — never of sort stability.

**Invariants** (asserted over 1,008 seeded random documents in every rounding mode,
level and pricing mode): per line `net + tax = gross`; per line the components sum
to the line tax; the lines sum to the document; the component totals sum to the
tax total; the treatment totals sum to the gross total; and under inclusive pricing
**each line's gross is exactly the amount that was priced**.

**One refusal worth knowing.** Under document-level rounding an amount of a few
smallest units meeting several components can make the apportioned tax exceed the
line's gross. That would be a negative net on a sale, so the calculation is
refused (`TAX_INPUT_INVALID`, "too small to carry its tax") rather than emitted.

## 4. Rounding modes

To a whole unit, on an exact half and on its negative (negatives matter only for
`ceiling`/`floor`; the calculator rounds non-negative amounts, and the table is
the contract of the primitive):

| Mode        | 2.5 | 3.5 | −2.5 | −3.5 | Rule                                    |
| ----------- | --- | --- | ---- | ---- | --------------------------------------- |
| `half_up`   | 3   | 4   | −3   | −4   | halves away from zero (symmetric)       |
| `half_down` | 2   | 3   | −2   | −3   | halves toward zero                      |
| `half_even` | 2   | 4   | −2   | −4   | halves to the even neighbour (banker's) |
| `up`        | 3   | 4   | −3   | −4   | any remainder away from zero            |
| `down`      | 2   | 3   | −2   | −3   | truncate toward zero                    |
| `ceiling`   | 3   | 4   | −2   | −3   | toward +∞                               |
| `floor`     | 2   | 3   | −3   | −4   | toward −∞                               |

Tax on net `0.25` and `0.35` at 10 %, scale 2 (`0.025` and `0.035` — exact halves):

| Mode                           | tax on 0.25 | tax on 0.35 |
| ------------------------------ | ----------- | ----------- |
| `half_up` / `up` / `ceiling`   | 0.03        | 0.04        |
| `half_down` / `down` / `floor` | 0.02        | 0.03        |
| `half_even`                    | 0.02        | 0.04        |

## 5. Worked examples

All use `roundingMode: half_up`, `roundingScale: 2`, `roundingLevel: line`,
exclusive pricing, a single fallback rule `vat 10 net`, unless stated.

**5.1 Exclusive.** `3 × 19.99` → net `59.97`; tax `5.997` → **`6.00`**; gross
`65.97`.

**5.2 Discount.** `2 × 10.00`, discount `5.00` → net `15.00`; tax `1.50`; gross
`16.50`. The discount comes off before tax.

**5.3 A float would get this wrong.** An exempt line of `1 × 1.005`: net is
`1.005 → 1.01` under half-up. A float stores `1.00499999999999989…` and rounds to
`1.00`.

**5.4 Inclusive, 11 %.** Gross `111.00` → net `100.00`, tax `11.00`. Gross
`100.00` → `100 / 1.11 = 90.0900…` → net **`90.09`**, tax **`9.91`**, gross
`100.00` preserved.

**5.5 Two components on net** (`vat 10`, `levy 5`) on `100.00` → `10.00` + `5.00`,
tax `15.00`.

**5.6 Compound.** `levy 5 cumulative` on `100.00`: `vat 10.00` on `100.00`; levy
`5 % × 110.00 = 5.50`; tax `15.50`; the levy's `taxableBase` is `110.00`.

**5.7 Inclusive compound.** `K = 1 + 0.10 + 0.05 × 1.10 = 1.155`. Gross `115.50` →
net `100.00`; `vat 10.00`; `levy 5.50`.

**5.8 Line vs document level.** Three lines of `1 × 0.05`, `0.005` of tax each:

| Level      | Line taxes       | Total  | Why                                                  |
| ---------- | ---------------- | ------ | ---------------------------------------------------- |
| `line`     | `0.01 0.01 0.01` | `0.03` | three roundings of `0.005`                           |
| `document` | `0.01 0.01 0.00` | `0.02` | `Σ = 0.015 → 0.02`, apportioned, ties to lower index |

**5.9 Treatments.** Categories `books` (exempt) and `food` (zero-rated); lines
`100.00` standard, `50.00` books, `20.00` food:

| Treatment    | Net      | Tax     | Gross    |
| ------------ | -------- | ------- | -------- |
| `taxable`    | `100.00` | `10.00` | `110.00` |
| `exempt`     | `50.00`  | `0.00`  | `50.00`  |
| `zero_rated` | `20.00`  | `0.00`  | `20.00`  |

**5.10 Zero-decimal currency** (`roundingScale: 0`): `105` at `8 %` = `8.4` → `8`;
printed `8`, not `8.00`.

**5.11 Reversal from the original snapshot.** Sale: line `a` = `3 × 3.33` (net
`9.99`, tax `0.999 → 1.00`), line `b` = `1 × 20.00` (net `20.00`, tax `2.00`),
document tax `3.00`.

- Return 1 of 3 of `a`: ratio `1/3` → net `3.33`, tax `0.3333 → 0.33`.
- Return 1 of 3 again: net `3.33`, tax `0.33`.
- Return the last one: it takes the **remainder**, not a third — net `3.33`, tax
  `1.00 − 0.33 − 0.33 = 0.34`.
- The three returns sum to exactly the line's `1.00`. A fourth is refused.
- If the rate has since become 20 %, none of this changes: the reversal never reads
  a rate.

## 6. Reversal rules

`computeReversal` receives the snapshot's recorded lines, the rounding mode and
scale, and what earlier reversals of the same original already took. It has **no
rule input**. For each requested line (or every line with quantity left, if
`lines` is omitted):

1. `remaining = original quantity − already reversed`. The request must satisfy
   `0 < q ≤ remaining`.
2. If `q = remaining`, the amounts are the exact **remainder** of the original's
   net and of each component's tax.
3. Otherwise each amount is `round(original × q / Q)` using the snapshot's own mode
   and scale, **capped** at what has not been reversed.
4. Amounts are negative; the quantity stays positive; `originalLineRef` names the
   line reversed.

Rounding reversals per line, even under `document`-level rounding, is deliberate: a
refund targets lines. The cap and the remainder rule are what guarantee that the
sum of all reversals can never exceed — and, when everything is returned, always
equals — the original.

## 7. Data dictionary

### `awcms_tax_rule_versions` (`sql/171`)

| Column                                           | Type               | Notes                                                                         |
| ------------------------------------------------ | ------------------ | ----------------------------------------------------------------------------- |
| `id`                                             | uuid PK            |                                                                               |
| `tenant_id`                                      | uuid               | RLS `ENABLE` + `FORCE`; `UNIQUE (tenant_id, id)`                              |
| `profile_code`                                   | text               | `^[a-z0-9][a-z0-9_.-]{0,62}$`; `UNIQUE (tenant_id, profile_code, version_no)` |
| `version_no`                                     | integer            | assigned by the server under the profile lock                                 |
| `status`                                         | text               | `draft` · `published`                                                         |
| `name`                                           | text               |                                                                               |
| `jurisdiction_code`                              | text               | opaque, tenant-defined; no country list ships                                 |
| `country_code`                                   | char(2)            | optional                                                                      |
| `region_code`                                    | text               | optional                                                                      |
| `currency_code`                                  | char(3)            |                                                                               |
| `pricing_mode`                                   | text               | CHECK                                                                         |
| `rounding_mode`                                  | text               | CHECK, seven values                                                           |
| `rounding_scale`                                 | smallint           | CHECK 0–6                                                                     |
| `rounding_level`                                 | text               | CHECK `line` · `document`                                                     |
| `effective_from`                                 | date               | inclusive                                                                     |
| `effective_to`                                   | date               | exclusive; null = open; CHECK `> effective_from`                              |
| `definition`                                     | jsonb              | `{categories, rules}`; CHECK object, ≤ 256 KiB                                |
| `notes`                                          | text               |                                                                               |
| `created_at/by`, `updated_at`, `published_at/by` | timestamptz / uuid | `published_at` required when published                                        |

Triggers: `awcms_tax_rule_versions_guard` (published rows immutable; the one
permitted change is closing an open window forward, once) and
`awcms_tax_rule_versions_no_overlap` (advisory lock on `(tenant, profile)`, then
refuse an overlapping published window).

`definition` shape:

```jsonc
{
  "categories": [
    { "code": "books", "name": "Books", "description": "optional" }
  ],
  "rules": [
    {
      "categoryCode": null,
      "treatment": "taxable",
      "components": [
        { "code": "vat", "name": "VAT", "rate": "11", "basis": "net" }
      ]
    },
    { "categoryCode": "books", "treatment": "exempt", "components": [] }
  ]
}
```

At most 200 categories, 201 rules (one per category plus one fallback), 8 components
per rule. Every rule's category must be declared; a category has one rule; there is
at most one fallback; component codes are unique within a rule.

### `awcms_tax_snapshots` (`sql/172`)

| Column                                                                                                                         | Type              | Notes                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------ | ----------------- | --------------------------------------------------------------------------------------- |
| `id`                                                                                                                           | uuid PK           |                                                                                         |
| `tenant_id`                                                                                                                    | uuid              | RLS `ENABLE` + `FORCE`                                                                  |
| `kind`                                                                                                                         | text              | `sale` · `reversal`                                                                     |
| `document_type`, `document_id`                                                                                                 | text              | the consumer's opaque reference; `UNIQUE (tenant_id, kind, document_type, document_id)` |
| `original_snapshot_id`                                                                                                         | uuid              | reversals only; **not** an FK (retention may remove an aged original)                   |
| `rule_version_id`                                                                                                              | uuid              | composite FK `(tenant_id, rule_version_id)` → versions                                  |
| `profile_code`, `version_no`, `tax_date`, `currency_code`, `pricing_mode`, `rounding_mode`, `rounding_scale`, `rounding_level` |                   | copied from the version at write time                                                   |
| `rule_definition`                                                                                                              | jsonb             | **copy** of the version's definition — the row stands alone                             |
| `lines`                                                                                                                        | jsonb             | per-line results with components (shape: `TaxLineResult`)                               |
| `component_totals`, `treatment_totals`                                                                                         | jsonb             |                                                                                         |
| `net_total`, `tax_total`, `gross_total`                                                                                        | numeric(24,6)     | signed: ≥ 0 for a sale, ≤ 0 for a reversal; CHECK `gross = net + tax`                   |
| `input_hash`                                                                                                                   | text              | sha256 of the normalised request                                                        |
| `reason`                                                                                                                       | text              | reversals                                                                               |
| `created_at`, `created_by`                                                                                                     | timestamptz, uuid |                                                                                         |

Triggers: `awcms_tax_snapshots_immutable` (no update; no delete younger than 1826
days), `awcms_tax_snapshots_guard` (a reversal must name a real sale in this
tenant, with its document type and rule version, and may not take the running
reversed net or tax below zero; it locks the original).

## 8. Permissions and RLS matrix

All routes use `defineTenantRoute` → `authorizeInTransaction` (default-deny, ABAC,
module-enabled, decision log). Every table is `FORCE ROW LEVEL SECURITY` on
`tenant_id = current_setting('app.current_tenant_id')`.

| Operation                                                              | Permission                        | High-risk        | `Idempotency-Key`      | Audit                              | Event                              |
| ---------------------------------------------------------------------- | --------------------------------- | ---------------- | ---------------------- | ---------------------------------- | ---------------------------------- |
| `GET  /tax/rule-versions`, `GET …/{id}`                                | `tax.rules.read`                  | no               | —                      | decision log                       | —                                  |
| `POST /tax/rule-versions` (draft)                                      | `tax.rules.configure`             | yes              | required               | `info`                             | —                                  |
| `POST /tax/rule-versions/{id}/publish`                                 | `tax.rules.publish`               | yes              | required               | `critical`                         | `awcms.tax.rule_version.published` |
| `POST /tax/quote`                                                      | `tax.calculations.analyze`        | no               | — (no effect)          | decision log                       | —                                  |
| `POST /tax/snapshots` (finalise)                                       | `tax.snapshots.create`            | no               | required + natural key | `info`                             | `awcms.tax.snapshot.finalised`     |
| `GET  /tax/snapshots`, `GET …/{id}`                                    | `tax.snapshots.read`              | no               | —                      | decision log                       | —                                  |
| `POST /tax/snapshots/{id}/reverse`                                     | `tax.snapshots.reverse`           | yes (`reverse`)  | required + natural key | `critical`                         | `awcms.tax.snapshot.reversed`      |
| a `taxDate` outside the server-date window, on either of the two above | **also** `tax.snapshots.backdate` | yes (`backdate`) | as above               | `backdated: true` in the audit row | —                                  |
| `GET  /tax/reports/reconciliation`                                     | `tax.reports.read`                | no               | —                      | decision log                       | —                                  |

Replays (same key, or the same document and request) write no audit row and publish
no event. The permissions are seeded by `sql/173` into the catalogue only; an
existing tenant's `owner` role receives them from the owner-permission backfill job.

## 9. API summary and error codes

| Status | Code                               | When                                                                                          |
| ------ | ---------------------------------- | --------------------------------------------------------------------------------------------- |
| 400    | `VALIDATION_ERROR`                 | malformed body, unknown key, number where a string is required                                |
| 400    | `TAX_AMOUNT_NOT_ACCEPTED`          | a key that names a computed money field (`taxAmount`, `vat`, `total`…)                        |
| 400    | `IDEMPOTENCY_REQUIRED`             | a mutating call without the header                                                            |
| 403    | `ACCESS_DENIED`                    | default-deny                                                                                  |
| 404    | `RESOURCE_NOT_FOUND`               | unknown (or other tenant's) version, snapshot or original                                     |
| 409    | `IDEMPOTENCY_CONFLICT`             | key reused with a different request                                                           |
| 409    | `TAX_VERSION_OUT_OF_ORDER`         | publish at or before the latest published `effectiveFrom`                                     |
| 409    | `TAX_VERSION_BACKDATED`            | publish before the server's date, or on/before a tax date already finalised under the profile |
| 403    | `TAX_BACKDATE_PERMISSION_REQUIRED` | `taxDate` outside the server-date window without `tax.snapshots.backdate`                     |
| 409    | `TAX_VERSION_ALREADY_PUBLISHED`    |                                                                                               |
| 409    | `TAX_DOCUMENT_ALREADY_FINALISED`   | same document, different request (also a reused reversal document id)                         |
| 422    | `TAX_RULE_VERSION_NOT_FOUND`       | no published version covers `taxDate`                                                         |
| 422    | `TAX_RULE_NOT_FOUND`               | category has no rule and there is no fallback                                                 |
| 422    | `TAX_INPUT_INVALID`                | bad amount, discount > line, zero quantity, too-small amount                                  |
| 422    | `TAX_REVERSAL_INVALID`             | unknown line, over-return, nothing left to reverse                                            |

## 10. Reconciliation and reporting

- **Projection** `tax.snapshot_activity` on the `reporting` engine: counts
  `snapshots_total`, `sales_finalised`, `reversals_recorded`. Freshness 5 min /
  stale 30 min. `cursor_table` over the append-only `awcms_tax_snapshots`. The
  engine's metric rules can only count.
- **Report** `GET /api/v1/tax/reports/reconciliation?from=&to=[&profileCode=]`: by
  version, by component, by treatment (each split sale / reversal), netted per
  currency, and `integrity` — `documentsChecked`, `lineSumMismatches`,
  `componentSumMismatches`. The calculator cannot produce a non-zero mismatch, so a
  non-zero count means a row was written some other way. Span ≤ 366 days; amounts
  are `numeric` sums rendered as exact decimals with trailing zeros trimmed.

## 11. Migration adapter contract — leaving a flat store-level percentage

For a consumer (`awcms-one#293`, `awcms-astro`, any storefront or POS) that today
holds `storeTaxPercent` and computes `tax = subtotal × percent`.

**A. One-time setup (per tenant).** Create one profile and publish one version:

| Field                    | From the consumer's current behaviour                                                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `profileCode`            | `store-default`                                                                                                                                              |
| `definition.rules`       | one fallback rule: `taxable`, one component `{code: "tax", rate: storeTaxPercent, basis: "net"}`                                                             |
| `pricingMode`            | `inclusive` if the shop's prices already include tax, else `exclusive`                                                                                       |
| `roundingMode` / `Level` | what the consumer does today: usually `half_up`; `line` if it rounds per line, `document` if once on the total                                               |
| `roundingScale`          | the currency's minor-unit digits                                                                                                                             |
| `effectiveFrom`          | today or later — a version cannot take effect before the server's date, so the cutover date is the earliest `taxDate` you can ask about **through this API** |

**B. Runtime.** Replace the percentage multiplication with calls, nothing more:
cart edit → `POST /tax/quote`; place order → `POST /tax/snapshots` with
`documentType = "order"`, `documentId = <order id>`; store the returned snapshot
`id` on the order; return/refund → `POST /tax/snapshots/{id}/reverse` with the
refund's own id. **Never send a tax amount** — it is refused. Never recompute tax
from the order's lines locally: the snapshot is the figure.

**C. Categories.** Map each product/service tax class to a category `code`; leave
`categoryCode` null for "standard". Add an exempt or zero-rated rule per category
that needs one. A product with a category the version has no rule for fails with
`TAX_RULE_NOT_FOUND` unless a fallback exists — which `store-default` has.

**D. The setting becomes an event.** Changing the percentage is no longer an edit:
author a new draft with the new rate and an `effectiveFrom` in the future (or the
change date), publish it (a separately granted permission), and the predecessor's
window closes automatically. Old documents are untouched by construction.

**E. History is not recomputed.** Documents issued before cutover keep the amounts
they were issued with. This API computes; it never imports an amount, so there is
no backfill endpoint and one is not planned. A consumer that needs a snapshot for a
historical order finalises it with the order's original `taxDate` — which requires
a version covering that date, and therefore an `effectiveFrom` early enough.

**F. Rollout and parity.** Run the new path in shadow first: for a sample of real
carts compare `quote.taxTotal` with the legacy figure. With the same percentage,
pricing mode, rounding mode, scale and level the difference is exactly zero; any
difference is a configuration mismatch in step A, not a rounding tolerance.
Cut over per tenant behind a consumer-side flag; rollback is the flag.

**G. Offline POS.** The POS must keep selling with no network. Two supported shapes,
neither shipped here: (1) queue the sale locally and call `POST /tax/snapshots` on
sync (the document id makes the replay idempotent under any key); (2) embed the
pure calculator and cache `GET /tax/rule-versions/{id}`, which is everything it
needs. Under (2) the local figure is a **display** figure — the server snapshot is
authoritative, and the receipt must not claim otherwise until it exists.

## 12. Limits and known gaps

- Operator surface: `/admin/tax` (Issue #894, ADR-0127 follow-up 1) — rule profiles and versions (draft, publish with confirmation), snapshot list and detail, and the reconciliation report. Rule definitions are authored in a structured row editor (Issue #901: categories, rules, stacked components, rates as exact decimal strings) that serialises into the JSON textarea the form submits — the textarea stays as the advanced/no-script fallback and the server stays authoritative. Quote, finalise, reverse and backdate stay consumer actions with no screen.
- No country profile (follow-up 2). No Coretax/e-invoice export (follow-up 6).
- No draft deletion; abandoned drafts remain (never resolved).
- Versions append in time order; there is no publishing into the past.
- 500 lines per document; 200 categories and 8 components per rule; 256 KiB per
  definition.
- `PATCH`-style edits of a draft are not offered: create a new draft.
- A reversal with no `taxDate` is dated the **server's** date (not the original's); a stated
  one is bounded by the same window as a finalise. A version cannot be published before
  the server's date, nor on or before a tax date already finalised under its profile.
- `/quote` is not windowed (it records nothing); `/snapshots` and a stated reversal date are.
- Lists return summaries (no `lines`, no `definition`); the snapshot detail names its rule
  version but does not embed the definition (`tax.rules.read`).
- Every amount must be under 10^18 (it must fit `numeric(24,6)`): `TAX_INPUT_INVALID`.

## 13. Rollout

1. **Apply the migrations** (`sql/171`–`sql/173`). `sql/173` extends the permission
   catalogue only.
2. **Existing tenants must be backfilled.** A tenant created before `sql/173` ran has
   an `owner` role without the nine `tax.*` permissions, so every tax route answers
   `403 ACCESS_DENIED` for it — silently, with the code looking correct. Run, once per
   deployment after migrating:

   ```bash
   bun run identity-access:permissions:backfill            # dry run: reports what it would grant
   bun run identity-access:permissions:backfill --commit   # grants permissions newer than each owner role
   ```

   It grants only permissions whose catalogue row is newer than the role (it will not
   resurrect a grant an administrator deliberately removed). Tenants created after the
   migration need nothing.

3. **Settings** (optional): `TAX_TAXDATE_PAST_DAYS` (default 7) and
   `TAX_TAXDATE_FORWARD_DAYS` (default 1) bound the tax-date window; see `.env.example`.
   Grant `tax.snapshots.backdate` only to roles that genuinely post into closed periods.
4. **Author and publish the first rule version** (`effectiveFrom` today or later) before
   any consumer calls `/quote` or `/snapshots`; until then both answer
   `422 TAX_RULE_VERSION_NOT_FOUND`.
