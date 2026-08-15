🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](module-proposal-template.id.md)

# Module proposal template

> **Status (2026-07-14):** The `awcms` repo is only at the re-foundation stage (see
> [ADR-0001](../../adr/0001-rebuild-on-awcms-foundation-erp-scope.md)) — no ERP
> module has been implemented yet. This template is the module admission
> process that applies the moment a module starts being proposed/scaffolded,
> adapted from the [awcms-mini](https://github.com/ahliweb/awcms-mini) base.

Lightweight — not a long RFC. Fill it in the body of a GitHub issue before a new
**System** or **Official Optional Module** starts being scaffolded in this
repo. First read the module admission governance document (planned:
`docs/awcms/21_module_admission_governance.md` — categories, decision tree
§3, admission criteria §4) before filling it in.

For a need specific to a single business vertical (e.g. tax rules for one
industry, a particular marketplace integration) — first consider whether it is
genuinely generic across the ERP modules (finance/inventory/procurement/
manufacturing/HR) or specific to one domain; if specific, it still lands
as an ERP domain module in `src/modules/` (not a "derived application" as in
the awcms-mini model — this repo is a single ERP platform, not a base for
many derived applications), but describe its scope in §3 below.

---

## 1. Proposed module name & key

- Name:
- `key` (`snake_case`):
- Proposed category (**System** / **Official Optional Module** /
  **ERP domain module** / **External Integration** — if unsure, write
  "Not sure" and explain in §2 below):

## 2. Problem / need

What cannot be done today without this module? For whom (all
ERP modules, or a particular module/business process — e.g. only the procurement flow,
only finance reconciliation)?

## 3. Scope & generality

If this module is proposed as a **System**/**Official Optional Module**
(used across many ERP domain modules): prove that this module is generic across
business domains, not specific to one vertical. If this module is an **ERP
domain module** (e.g. finance, inventory): describe its responsibility boundary
against the other ERP domain modules that exist or will exist, so they do not overlap.

## 4. Dependencies

- Lifecycle dependencies (`ModuleDescriptor.dependencies`, must be modules
  that MUST be active first):
- Capability dependencies (`ModuleDescriptor.capabilities.consumes`, mark
  `required` or `optional` per entry):

## 5. offline/LAN vs full-online-only compatibility

- Proposed compatibility class (`offline-lan-safe` /
  `full-online-only`):
- If `full-online-only`: how does the `offline-lan` profile stay 100%
  functional while this feature is off? (e.g. finance/inventory transactions can still be
  recorded locally, syncing to the provider/central deferred until online)

## 6. External providers (if any)

If this module wraps an external provider (payment gateway, marketplace,
tax/Coretax system, logistics, or another External Integration category),
see and attach the result of
[`module-admission-decision-checklist.md`](module-admission-decision-checklist.md)
§External providers / data governance.

## 7. Security & data governance

In short: which data is touched (including PII, sensitive financial data,
HR/payroll documents), who may access it (the initial ABAC), and which
high-risk actions need an audit log (e.g. transaction approval, cost price
changes, payment disbursement).

### Financial impact & data sensitivity (ERP modules only)

- Does this module touch financial data (journals, balances, cost prices,
  payroll)? If yes, what mechanism prevents changes without an audit trail
  (append-only ledger, tiered approval)?
- Can this module trigger a tax/reporting obligation (e.g. tax invoices,
  Coretax)? Who is responsible for validating compliance before
  go-live?
- Data sensitivity classification (public/internal/confidential/highly confidential) and
  who is authorised to change this classification post-merge.

## 8. Ownership

Who will maintain this module post-merge (filling in
`ModuleDescriptor.maintainers` when the team has more than one maintainer;
defaulting to `.github/CODEOWNERS` when it does not)?

## 9. Deprecation plan (if relevant)

Does this module replace another existing module/feature? If yes, see
the module admission governance document §4.4/§8 for the deprecation notice pattern.

## 10. Alternatives considered

Why not do it as part of an existing module?

---

Once this issue has been discussed and approved by the maintainers, continue to
[`module-admission-decision-checklist.md`](module-admission-decision-checklist.md)
as the PR review checklist, and write a separate ADR when the decision is
binding across documents (see `AGENTS.md` §Standards changes).
