🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0022-erp-modules-live-in-extension-repos.id.md)

# ADR-0022 — ERP domain modules live in extension repos, not inside the base (amendment to ADR-0001 point 3)

- **Status:** Superseded by [ADR-0034](0034-awcms-family-direct-use-templates-and-derived-pathway-removal.md) (the ban on domain/website modules in the base is revoked — domain modules may and should live directly in `src/modules/`)
- **Date:** 2026-07-16
- **Decision maker:** @ahliweb
- **Related:** ADR-0001 (amended by this ADR on point 3 + one alternative), ADR-0013 (extension layers & boundaries), ADR-0014 (build-time module composition), ADR-0015 (compatibility manifest), ADR-0020 (ERP extension readiness contracts), `docs/awcms/erp-extension-contracts.md`, `docs/awcms/derived-application-guide.md`, `docs/awcms/21_module_admission_governance.md`, epic #738 `platform-evolution`

## Context

ADR-0001 (2026-07-14) decided to rebuild `awcms` "as a modular monolith ERP platform". Its point 3 stated that ERP domain modules (finance, inventory, procurement, manufacturing, hr-payroll) and business integration modules were "developed as modules in `src/modules/`" of this repo; its Alternatives section explicitly **rejected** the option of "developing the ERP in a separate repo/base".

Epic #738 `platform-evolution` (ADR-0013 through ADR-0021, all Accepted, 2026-07-13 onwards) answered the question that was still untouched when ADR-0001 was written: **how many independent derived repos compose this base's capabilities without editing the base registry and without overwriting each other's data.** The answer that epic took moves the position of ERP modules firmly outside the base:

- **ADR-0013 §1** defines six extension layers. The **ERP Extension** layer (as well as SaaS Control Plane and the generic Derived Application) is marked _"Lives in this base repo? **Never**"_. Item/product master, general ledger, AR/AP, inventory valuation, payroll, and tax are listed as the contents of that layer — outside the base.
- **ADR-0020 / `docs/awcms/erp-extension-contracts.md`** says it directly: _"This base is not an ERP. There is no chart of accounts, journal, general ledger, inventory valuation, sales/purchase order, AR/AP, cash-bank, fixed asset, payroll, or tax computation in this repository — and there never will be."_ The base only provides **neutral contracts** (passive data shapes, capability ports, event payload schemas) that ERP extensions in separate repos implement/consume.
- **ADR-0014/0015** give the concrete mechanism for a derived repo to compose its own modules **without** editing the base registry: the derived repo's own `application-registry.ts` + `extension.manifest.json` + `bun run extension:check`.
- **Code evidence at the time this ADR was written:** `src/modules/` contains only reusable foundation modules (`identity-access`, `logging`, `profile-identity`, `tenant-admin`, `_shared`). ADR-0016–0021 admit only _foundation_ modules (organization_structure, document_infrastructure, data_exchange, integration_hub, reference_data) — not ERP business logic. There is not a single finance/inventory/procurement/manufacturing/payroll module in the base.

In other words, this repo's de facto decision already contradicts the letter of ADR-0001 point 3. The rule in `docs/adr/README.md` §2 forbids silently rewriting an Accepted ADR — a change of direction must be recorded via a new ADR that references the old one. This ADR is that record.

## Decision

We decide to **amend ADR-0001**:

1. **ADR-0001 point 3 is replaced** with: ERP domain modules (finance/GL, inventory/warehouse, procurement, manufacturing, hr-payroll) and vertical business integration modules are **not built inside this base's `src/modules/`**. They live in **separate extension/derived repos** on the **ERP Extension** / **Derived Application** layer (ADR-0013 §1), composed via build-time module composition (ADR-0014) and bound by a compatibility manifest (ADR-0015). The base only provides reusable foundation modules + the neutral ERP readiness contracts (ADR-0020).

2. **The "develop the ERP in a separate repo/base" alternative in ADR-0001 — previously rejected — now becomes the adopted direction**, for a reason that was not available when ADR-0001 was written: epic #738 provides the cross-repo mechanism (build-time composition, manifest, versioned port/event contracts) that removes the "synchronisation overhead with no clear benefit" that grounded the original rejection.

3. **The framing "AWCMS is an ERP platform" is replaced by "AWCMS is the base/foundation platform on top of which ERP & business solutions are built."** AWCMS is not an ERP; it is a reusable modular monolith base + ERP extension contracts.

What does **not** change from ADR-0001: the decision not to archive the repo (point 1), all the foundational technical standards (Bun-only, RLS mandatory, ABAC default-deny, offline-first/HMAC outbox, OpenAPI/AsyncAPI contracts, idempotency, audit — points 1 & 2), and the ADR discipline for deviations from the standards (point 4). ADR-0002…0021 remain Accepted as they are.

ADR-0001's status is marked `Accepted (point 3 & one alternative amended by ADR-0022)`.

## Consequences

- **Positive:** the "front door" documents (README, master canvas, ADR index) line up with the decisions that already bind (ADR-0013/0020) and with the real state of the code; contributors/derived applications no longer receive contradictory signals about "where ERP modules live"; the base vs extension boundary becomes single and consistent.
- **Trade-off:** a cross-repo ERP carries the overhead of versioned contracts (ports, events, manifest) and base↔extension release coordination — a cost now judged worth it because the mechanism already exists (ADR-0014/0015), unlike when ADR-0001 rejected it.
- **Neutral:** ADR-0001 remains as a historical record (not deleted, per `docs/adr/README.md` §2); its points 1/2/4 still apply in full.

## Alternatives considered

- **Leave ADR-0001 as it is and only fix the README/canvas** — rejected: it would leave a founding decision record that explicitly contradicts ADR-0013/0020, exactly the kind of drift the §2 supersede rule was made to prevent.
- **Rewrite the body of ADR-0001 directly** — rejected: it violates `docs/adr/README.md` §2 (an Accepted ADR is not edited silently; changes are recorded via a new ADR).
- **Mark ADR-0001 `Superseded` in its entirety** — rejected: the majority of ADR-0001 (not-archived, foundational technical standards, ADR discipline) still applies; only point 3 + one alternative changed, so "amended" is more accurate than "superseded".
