🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0020-erp-extension-readiness-contracts.id.md)

# ADR-0020 — ERP extension readiness contracts (business transaction, posting, period-lock, item, report-projection)

- **Status:** Accepted (not yet implemented)
- **Status note (2026-08-05):** The decisions in this contract still hold, but their artifacts (`_shared/business-transaction-contract.ts`, `_shared/erp-reference-data-contract.ts`, `_shared/ports/period-lock-port.ts`) no longer exist in this repo — they were deleted along with the derived-application pathway (ADR-0034) — and since ADR-0055 bringing them back is once again waiting on an admission ADR in this repo.
- **Date:** 2026-07-15
- **Decision-maker:** @ahliweb
- **Related:** Issue #755 (epic #738 `platform-evolution`, Wave 4), ADR-0013 (extension layers & boundary model), ADR-0011 (capability ports), ADR-0014 (deterministic build-time module composition), ADR-0015 (derived-application compatibility manifest), Issue #746 (business-scope assignments), Issue #748 (canonical party/`party_directory`), Issue #749 (organization-structure/`organization_hierarchy_resolution`), Issue #742 (domain-event-runtime outbox), Issue #751 (document-infrastructure numbering), Issue #753 (reporting projections), Issue #750 (`reference_data` — **not merged yet**, see §Status below), `docs/awcms/erp-extension-contracts.md`, `docs/awcms/21_module_admission_governance.md`, `docs/awcms/derived-application-guide.md`

## Context

Epic #738 `platform-evolution` turns AWCMS into a **technical application kernel** reusable by many independent derived repositories — including the possibility of an ERP-based derived application (accounting, inventory, sales/purchasing, payroll, tax). ADR-0013 §1 already established that a vertical module like that **never** enters this base repository. Issue #755 (Wave 4, the last issue of this epic) asks for the next step: not building an ERP, but **defining neutral contracts** — reference data, capability ports, and versioned events — that let an ERP extension (built in a SEPARATE REPOSITORY, not here) interact with an AWCMS-based derived application without this base ever:

- storing a chart of accounts/journals/general ledger;
- storing inventory valuation/costing;
- storing sales orders/purchase orders/AR-AP/cash-bank/payment allocation;
- storing fixed assets/depreciation/payroll/tax computation-reporting;
- storing manufacturing/project costing/budget control/consolidation;
- OR claiming to be a complete/regulation-compliant ERP itself.

The base MUST keep explicitly separating: tenant vs legal entity/organization scope (already exists, Issue #749); SaaS catalogue/subscription vs ERP item/accounting catalogue; operational/payment allocation ledger vs double-entry general ledger; canonical profile/party vs the contextual customer/supplier/employee roles owned by ERP modules (already exists, Issue #748).

**Status as of 2026-07-15 (recorded explicitly as history):** Issue #755 formally depends on #739/#742/#746/#749/#750/#751/#753. All seven dependencies have merged, including **Issue #750 (`reference_data`)**, which was OPEN for a while with two Critical findings (precedence enforcement on `tenant_override`/`tenant_extend`, and secret-shaped values slipping through undetected) — both fixed in **`awcms-mini`** (PR #783 in that repo). **CORRECTION:** this sentence previously read "`reference_data` is now `status: "active"` in the registry" without naming which repo — true for `awcms-mini`, where this text came from, and **false for this repo**: `reference_data` has no code here yet (see ADR-0021 and Wave A of `docs/awcms/absorb-awcms-mini-backbone-roadmap.md`). The contracts in this ADR still take **no hard dependency** on real `reference_data` code: `ItemReference`/`CurrencyReference`/`UnitOfMeasureReference` (`_shared/erp-reference-data-contract.ts`) are pure data shapes independent of their data source — now that `reference_data` is stable, it MAY (not MUST) be one legitimate source for these shapes, with no contract change.

## Decision

### 1. AWCMS is a technical kernel, not a functional ERP

This base provides contracts (types, ports, event schemas) that AN external ERP extension implements/consumes. The base never implements any accounting/tax/payroll logic. No new module is registered in `src/modules/index.ts` by this issue — the entire deliverable is contracts (`src/modules/_shared/*`), documentation, and one illustrative fixture (`tests/fixtures/derived-application-example/modules/example-erp-extension/`) that is NEVER composed into the real registry.

### 2. Ownership & dependency direction

- **The base defines the contracts** (passive TypeScript types + one behavioural capability port). **The ERP extension implements/consumes those contracts**, in its own repository.
- **Core/System NEVER depends on an ERP implementation** — no file under `src/modules/**` (base) imports anything from an ERP extension. Verified automatically by `tests/unit/erp-extension-contracts.test.ts`'s source-text scan (the same pattern `tests/unit/module-boundary.test.ts` already uses for `blog_content`↔`news_portal`).
- **A source module (base/System/Optional Business Foundation) never writes ERP tables directly** (ADR-0013 §6 no-shared-table-write) — the only path is the event/port contract below, or the owning module's public API (e.g. `document_infrastructure`'s numbering).

### 3. Contract families (see `docs/awcms/erp-extension-contracts.md` for the full ownership/version/failure-semantics/privacy/example table)

| #   | Contract                                         | Location                                                                                | Shape                                                              |
| --- | ------------------------------------------------ | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 1   | Business transaction reference & lifecycle       | `_shared/business-transaction-contract.ts`                                              | Passive data types                                                 |
| 2   | Document/reference/numbering integration         | `document_infrastructure` (Issue #751, already exists) + `DocumentReferenceLink`        | Passive data types + owning module's API                           |
| 3   | Tenant/legal-entity/organization scope reference | `_shared/ports/business-scope-hierarchy-port.ts` (Issue #746/#749, already exists)      | Port + data types (reused, not duplicated)                         |
| 4   | Canonical party + contextual roles               | `_shared/ports/party-directory-port.ts` (Issue #748, already exists)                    | Port (reused, not duplicated)                                      |
| 5   | Posting request/result event envelope            | `_shared/business-transaction-contract.ts` (`AccountingPostingRequestPayload`/`Result`) | Event payload types (riding on `domain_event_runtime`, Issue #742) |
| 6   | Period-lock query/check                          | `_shared/ports/period-lock-port.ts`                                                     | Behavioural port, fail-closed                                      |
| 7   | Item/service reference                           | `_shared/erp-reference-data-contract.ts` (`ItemReference`)                              | Passive data types                                                 |
| 8   | Currency & unit-of-measure reference             | `_shared/erp-reference-data-contract.ts`                                                | Passive data types                                                 |
| 9   | Inventory movement reference                     | `_shared/erp-reference-data-contract.ts` (`InventoryMovementReference`)                 | Passive data types                                                 |
| 10  | Reconciliation reference/control totals          | `_shared/erp-reference-data-contract.ts` (`ReconciliationReference`)                    | Passive data types                                                 |
| 11  | Reporting projection contribution                | `reporting`'s `ProjectionDescriptor` (Issue #753, already exists)                       | Descriptor (reused, not duplicated)                                |

Four of the eleven families (#2/#3/#4/#11) **reuse mechanisms that ALREADY EXIST** from Wave 2/3 (`BusinessScopeHierarchyPort`, `PartyDirectoryPort`, `document_infrastructure`'s numbering, `ProjectionDescriptor`) — this issue does not duplicate contracts that already have a clear owning module, it only documents how an ERP extension uses them. The rest (#1/#5/#6/#7/#8/#9/#10) are NEW pure-data contracts (except #6, the only new behavioural port) because the base previously had no concept of business transaction/posting/period/item/inventory/reconciliation at all.

### 4. Binding invariants (every ERP extension implementing these contracts must obey them)

1. **A posted transaction is immutable.**
2. **Corrections use reversal/compensation, not mutation** — a reversal is a NEW transaction pointing back at the original through `reversalOfExternalTransactionId`, not an overwrite of the original transaction row.
3. **Posted-state uniqueness is based on business identity, not `requestId`** — the implementation MUST enforce uniqueness of `"posted"`/`"reversed"` status per `(tenantId, transactionType, externalTransactionId)`, independent of `requestId` — `requestId` idempotency (point 4) ON ITS OWN IS NOT ENOUGH: a caller that mints a new `requestId` for the SAME business transaction (deliberately or not) must still be rejected as a duplicate, never accepted as an independent second posting.
4. **Posting is idempotent and externally correlated** — the same `requestId`, resent, returns an identical result, never a double posting. It complements, it does not replace, the business-identity uniqueness of point 3.
5. **Accepting a request does not mean the posting succeeded** — `status: "accepted"`/`"submitted"` differs from `status: "posted"`/`"reversed"`; a caller must not treat acceptance as proof of posting.
6. **A source module never writes ERP tables directly** — see §2 above.
7. **Reversal target resolution is tenant/legal-entity scoped, in the right ID space** — `reversalOfExternalTransactionId` resolves the ORIGINAL transaction through its own `externalTransactionId` (NEVER `requestId` — a different ID space), scoped to the AUTHENTICATED tenant of the reversal request. An original transaction that resolves but whose `tenantId`/`legalEntityScope` does not match the reversal request MUST be rejected — a reversal can never "find" and reference a transaction belonging to another tenant (or another legal entity).

### 5. Machine-verifiable evidence

`tests/fixtures/derived-application-example/modules/example-erp-extension/` (module descriptor + `posting-engine.ts` + `period-lock-adapter.ts`, purely in-memory, no database) demonstrates all seven invariants above end-to-end, verified by `tests/unit/erp-extension-contracts.test.ts` — idempotency per `requestId`, duplicate-posting rejection per business identity (point 3, a new `requestId` does not slip through), fail-closed period lock (both "no adapter" and "period locked"), cross-tenant/legal-entity-mismatch rejection on the forward request, AND two separate adversarial tests for the REVERSAL TARGET side specifically (point 7) — a reversal authenticated as another tenant cannot resolve the right tenant's transaction even knowing its `externalTransactionId` exactly, and a reversal that resolves a transaction of the same tenant but a different legal-entity scope is still rejected. This fixture also consumes `party_directory`/`organization_hierarchy_resolution` as optional capabilities and contributes one `reportingProjections` descriptor that passes `reporting`'s real `validateProjectionRegistry` — WITHOUT EVER being composed into the actual base registry (`src/modules/index.ts` stays unchanged, just like the earlier Wave 1 fixtures).

**Revision note (security-auditor, after the initial PR):** the first revision of this fixture indexed the reversal target by `requestId` (the WRONG ID space — `reversalOfExternalTransactionId` references `externalTransactionId`, never `requestId`) and did no tenant/legal-entity re-verification at all against the resolved original transaction — that defect was fixed in the same commit before the PR merged, before the "proven end-to-end" claim above became true. Recorded explicitly here (not just silently fixed in the code) because it is this document that previously made the false claim — the same pattern as several of this epic's "false claim of compliance" findings in Wave 3 (see the related session memory for #780/#782/#783): a security claim in an ADR/document is not evidence the claim is true, only walking the real path proves it.

## Consequences

- **Positive:** a future ERP extension (e.g. an ERP branch of AWPOS) has a clear, validated contract shape that is already proven implementable (the fixture) — without adding a single line of accounting logic to the base.
- **Positive:** four contracts (#2/#3/#4/#11) reuse Wave 2/3 mechanisms that have already been security-audited, reducing the new surface that needs review.
- **Negative/trade-off:** the item/currency/UoM contracts (#7/#8) are DELIBERATELY not bound to `reference_data` (#750) because that module had not merged and still had open Critical findings — a future decision-maker who BINDS these contracts to `reference_data` must do it in a separate change, after #750 is genuinely stable, not by assuming compatibility today.
- **Neutral:** `PeriodLockPort` has no real behavioural default adapter in the base (only `noPeriodLockAdapterConfigured`, which ALWAYS fails closed) — this is deliberate; the concept of an "accounting period" belongs purely to the ERP domain, and the base must not pretend to have a domain-neutral definition of a period.

## Alternatives considered

- **Deferring the whole issue until #750 merges** — rejected: contracts #7/#8/#9/#10 do not need `reference_data` to be defined as a SHAPE; they only need `reference_data` as one optional future SOURCE. Deferring pure-data contracts behind a PR that is being security-fixed is disproportionate for this separate issue.
- **Implementing a real minimal posting/ledger engine in the base "as a reference"** — rejected explicitly by issue #755 itself ("Explicitly out of scope for the base") and by ADR-0013 §1; the fixture in `tests/fixtures/` is enough to prove the contracts can be implemented without creating a "shadow ERP" inside the base.
- **Making `PeriodLockPort`/`business-transaction-contract.ts` a registered module (`src/modules/index.ts`) instead of a `_shared/` contract** — rejected: the base owns no real table/endpoint/lifecycle for this concept, so it fails §3 of doc 21 ("a module must own its own state/lifecycle") — pure contracts stay in `_shared/`, consistent with `module-contract.ts`/`business-scope-hierarchy-port.ts` which are also not modules.
