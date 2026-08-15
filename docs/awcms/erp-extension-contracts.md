🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](erp-extension-contracts.id.md)

# ERP Extension Readiness Contracts

> **⚠️ HISTORICAL/DEPRECATED ([ADR-0034](../adr/0034-awcms-family-direct-use-templates-and-derived-pathway-removal.md), reinforced by [ADR-0055](../adr/0055-development-confined-to-awcms-and-awcms-astro.md)).**
> The derived-repository pathway this document assumes has been REMOVED — ERP is
> now built as a **domain module directly in `src/modules/`** of this repo, with
> its own admission ADR. The `_shared` contract files referenced below
> (`business-transaction-contract.ts`, `erp-reference-data-contract.ts`,
> `ports/period-lock-port.ts`) **have been deleted from the repo**. This document
> is kept as a historical record of the contract design, not as a map of the code
> today.

Issue #755, epic #738 (`platform-evolution`), Wave 4 — the LAST issue of this
epic. `docs/adr/0020-erp-extension-readiness-contracts.md` is the binding
architectural decision; this document is the complete technical reference for
every contract that decision defines — ownership, versioning, failure
semantics, privacy classification, and examples, for anyone building an **ERP
extension** (a repository SEPARATE from this base) that needs to interact with
AWCMS's tenant/party/scope/document/event/reporting.

**This base is not an ERP.** There is no chart of accounts, journal, general
ledger, inventory valuation, sales/purchase order, AR/AP, cash-bank, fixed
asset, payroll, or tax computation in this repository — and there never will be
(ADR-0013 §1, this doc §Explicit exclusions). What is provided is only
**neutral contracts**: data shapes, one capability port, and event payload
schemas that an external ERP extension implements/consumes.

## Who this document is for

You are building (or plan to build) a derived ERP/accounting/inventory
application on top of AWCMS, in your own repository (see
`docs/awcms/derived-application-guide.md` for the general derived-application
pattern, and `docs/adr/0013-extension-layers-and-boundary-model.md` §"ERP
Extension" for where its layer sits). This document explains the contracts
available for you to use, WITHOUT requiring you to edit the base module
registry (Issue #740/#741, ADR-0014/0015).

## Summary of the eleven contract families

| #   | Contract                                         | Location (base)                                                     | Kind                                      | Present since            |
| --- | ------------------------------------------------ | ------------------------------------------------------------------- | ----------------------------------------- | ------------------------ |
| 1   | Business transaction reference & lifecycle       | `src/modules/_shared/business-transaction-contract.ts`              | Passive data type                         | Issue #755 (new)         |
| 2   | Document/reference/numbering integration         | `document_infrastructure`'s public API + `DocumentReferenceLink`    | Passive data type + owning module service | Issue #751 (reused)      |
| 3   | Tenant/legal-entity/organization scope reference | `_shared/ports/business-scope-hierarchy-port.ts`                    | Port + data type                          | Issue #746/#749 (reused) |
| 4   | Canonical party + contextual roles               | `_shared/ports/party-directory-port.ts`                             | Port                                      | Issue #748 (reused)      |
| 5   | Posting request/result event envelope            | `_shared/business-transaction-contract.ts`                          | Event payload type                        | Issue #755 (new)         |
| 6   | Period-lock query/check                          | `_shared/ports/period-lock-port.ts`                                 | Behavioural port, fail-closed             | Issue #755 (new)         |
| 7   | Item/service reference                           | `_shared/erp-reference-data-contract.ts`                            | Passive data type                         | Issue #755 (new)         |
| 8   | Currency & unit-of-measure reference             | `_shared/erp-reference-data-contract.ts`                            | Passive data type                         | Issue #755 (new)         |
| 9   | Inventory movement reference                     | `_shared/erp-reference-data-contract.ts`                            | Passive data type                         | Issue #755 (new)         |
| 10  | Reconciliation reference/control totals          | `_shared/erp-reference-data-contract.ts`                            | Passive data type                         | Issue #755 (new)         |
| 11  | Reporting projection contribution                | `reporting`'s `ProjectionDescriptor` (`_shared/module-contract.ts`) | Descriptor                                | Issue #753 (reused)      |

## 1. Business transaction reference & lifecycle

**Owner:** the ERP extension (the base stores no transactions at all).
**Shape:** `BusinessTransactionReference`
(`_shared/business-transaction-contract.ts`) — `tenantId`,
`legalEntityScope` (nullable, see #3), `transactionType` (a namespaced string
`<extension_key>.<domain>.<kind>`), `externalTransactionId` (opaque, owned by
the extension), `status` (`BusinessTransactionLifecycleStatus`:
`draft`/`submitted`/`posted`/`reversed`/`rejected`), `documentReference?`
(see #2).
**Versioning:** being part of the `MODULE_CONTRACT_VERSION` scheme does NOT
apply here (this is not a `ModuleDescriptor`) — changes to the shape of this
file itself are announced through the package release changelog (scheme #1 of
doc `extension-compatibility-policy.md`), same as any other `_shared/*` file
that is not a port/module-contract.
**Failure semantics:** none — this is purely a data type, it does not "fail".
Validating the existence/ownership of `legalEntityScope` is delegated to
contract #3.
**Privacy classification:** no direct PII; `externalTransactionId` is opaque to
the base.
**Binding invariants:** see ADR-0020 §4 (posted is immutable, corrections via
reversal, etc.) — ALL invariant numbers there apply to this contract.

## 2. Document/reference/numbering integration

**Owner:** `document_infrastructure` (Issue #751, an existing base module — not
a new contract from this issue). An ERP extension that wants formatted document
numbers (e.g. an invoice/PO number) calls `document_infrastructure`'s OWN
numbering allocation service (`domain/document-number-sequence.ts`, reached
through that module's public API) — not through some new `_shared/ports/*.ts`.
**Shape of the embedded reference:** `DocumentReferenceLink`
(`_shared/business-transaction-contract.ts`) — `sequenceKey`, `documentNumber`,
`documentId?`. This shape is STRUCTURALLY ALIGNED with
`document_infrastructure`'s real allocation but does NOT import its type (every
`_shared/*-contract.ts` file stays zero-import, per the convention of all other
`_shared` files).
**Failure semantics:** number-allocation failure is
`document_infrastructure`'s own responsibility (see that module for its
concurrency safety) — this contract only defines what gets embedded AFTER
allocation succeeds.
**Privacy classification:** a document number is not sensitive data per se, but
it is subject to `document_infrastructure`'s own `confidentiality_level` when
`documentId` points at a classified document.

## 3. Tenant/legal-entity/organization scope reference

**Owner:** `_shared/ports/business-scope-hierarchy-port.ts` (Issue #746, really
implemented by `organization_structure` — Issue #749 — for `scopeType:
"legal_entity"`/`"organization_unit"`, and by `identity_access`'s default
adapter for `scopeType: "office"`).
**Shape:** `BusinessScopeReference` (`{scopeType, scopeId}`, opaque, NOT a
foreign key) and `BusinessScopeResolution` (`resolved`, `ancestorScopes`,
`descendantScopes`).
**Reused, not duplicated** by this issue's new contracts —
`BusinessTransactionReference.legalEntityScope` and
`ReconciliationReference.legalEntityScope` (§10) are both typed
`BusinessScopeReference | null` directly, without wrapping it again.
**Failure semantics:** `resolved: false` (not an empty array) means the scope is
NOT valid for that tenant — the caller (here, the ERP extension's posting
engine) MUST default-deny, never treating "no hierarchy" as "permitted".
**Privacy classification:** no PII; a scope is an organisational-structure
identifier, not personal data.

## 4. Canonical party + contextual roles

**Owner:** `_shared/ports/party-directory-port.ts` (Issue #748, implemented by
`profile_identity`).
**Pattern for an ERP extension:** your extension's "customer"/"supplier"/
"employee" tables store a REFERENCE (`profileId`) to the canonical party through
this port — NEVER duplicating the party's name/contact/identity data into your
own extension tables. Use `resolveSummary`/`resolvePublicSafeSummary` to display
the name/status without copying it permanently.
**Failure semantics:** `null` means the party does not exist/is soft-deleted/
merged-away for that tenant — the extension MUST treat it as "not found", never
display stale data.
**Privacy classification:** `PartyDirectorySummaryDTO`/
`PartyDirectoryPublicSafeDTO` are an explicit allow-list — any field OUTSIDE
that list (raw email/phone, etc.) is never exposed through this port; an
extension that needs more detailed data calls `profile_identity`'s own
endpoints, which apply masking per the `awcms-sensitive-data` skill.

## 5. Posting request/result event envelope

**Owner:** the ERP extension defines its own event types (e.g.
`"<extension_key>.posting.requested"`/`"...posting.result_recorded"`) whose
payloads take the shape `AccountingPostingRequestPayload`/
`AccountingPostingResultPayload` (`_shared/business-transaction-contract.ts`).
The events themselves ride on top of `domain_event_runtime` (Issue #742) — the
extension registers its own event types/consumers in its own derived build (its
forked version of `domain-event-runtime/infrastructure/consumer-registry.ts`),
NOT in the base.
**Shape:**

- Request: `requestId` (idempotency key), `transaction`
  (`BusinessTransactionReference`), `periodKey`, `currencyCode`,
  `totalDebit`/`totalCredit` (decimal-as-string, opaque to the base),
  `requestedAt`, `reversalOfExternalTransactionId?`.
- Result: `requestId` (MUST equal the request's), `transaction`,
  `status` (`accepted`/`posted`/`rejected`/`reversed`), `postedAt?`,
  `rejectionReason?`, `ledgerReference?` (opaque).
  **Failure semantics:** see invariant #3 (uniqueness of posted-state per
  `(tenantId, transactionType, externalTransactionId)`, independent of
  `requestId`), #4 (idempotent per `requestId`), #5 (`"accepted"` is NOT
  proof the posting succeeded), and #7 (`reversalOfExternalTransactionId`
  resolves an `externalTransactionId` — NEVER a `requestId` — scoped to the
  reversal request's tenant/legal-entity) in ADR-0020 §4.
  **Privacy classification:** `totalDebit`/`totalCredit`/`ledgerReference`
  are sensitive tenant financial data — the event payload MUST pass
  `domain_event_runtime`'s `validateDomainEventPayload` (which rejects
  credential/secret-shaped values and bounds the payload size) before being
  published, just like any module's events.
  **Example:** see `tests/fixtures/derived-application-example/modules/example-erp-extension/posting-engine.ts`
  for the complete reference implementation (idempotent per `requestId`,
  duplicate rejection per business identity, fail-closed period lock,
  tenant/legal-entity-scoped resolution of the reversal target,
  reversal-as-a-new-transaction), verified by
  `tests/unit/erp-extension-contracts.test.ts` — including two adversarial
  tests dedicated to the reversal-target side (a reversal from another tenant
  cannot resolve the correct tenant's transaction; a reversal from the same
  tenant with a different legal-entity scope is still rejected).

## 6. Period-lock query/check

**Owner:** `_shared/ports/period-lock-port.ts` — **the only new BEHAVIOURAL
port** in this issue (the other ten contracts are passive data types or reuse
existing ports). The base does NOT provide a real adapter (not even a "default
adapter" as the other ports have) — the accounting-period concept belongs purely
to the ERP domain.
**Shape:** `checkPeriodLock(tx, tenantId, legalEntityScope, periodKey,
operation)` returns `PeriodLockCheckResult`:
`{checked:true, locked:false}` | `{checked:true, locked:true, reason}` |
`{checked:false, reason}`.
**Failure semantics (MUST fail-closed):** `checked: false` MUST be treated
identically to `locked: true` for the `"post"` operation.
`noPeriodLockAdapterConfigured` (the only "adapter" the base ships) ALWAYS
returns `checked: false` — a composition root that has not composed any ERP
extension gets a port that always refuses posting, not one that silently
permits it.
**Not an identity/RLS boundary** — this port answers the business question "is
this period open or not", it is not a replacement for tenant RLS/ABAC, which
every ERP extension endpoint/job must still check separately.
**Privacy classification:** `periodKey` is opaque, no PII.

## 7. Item/service reference

**Owner:** the ERP extension (the base has no item catalogue). **Shape:**
`ItemReference` (`_shared/erp-reference-data-contract.ts`) —
`itemId` (opaque), `itemKind` (`good`/`service`), `defaultUnit`
(`UnitOfMeasureReference`, §8).
**Legitimate data sources:** your own extension's catalogue tables, OR
(optionally, once Issue #750 `reference_data` actually merges and stabilises —
see ADR-0020 §Status for the current pinning warning)
`reference_data`'s effective-dated value sets. This contract does NOT assume
either one — both are valid as long as the shape matches.
**Failure semantics:** none — passive data type.
**Privacy classification:** no PII.

## 8. Currency & unit-of-measure reference

**Owner:** the ERP extension. **Shape:** `CurrencyReference`
(`currencyCode` ISO 4217, `minorUnitDigits`) and
`UnitOfMeasureReference` (`unitCode`, `description`) — both in
`_shared/erp-reference-data-contract.ts`. The base does not validate the
currency/unit codes against any reference table — they are purely opaque strings
passed through.
**Failure semantics:** none. **Privacy classification:** no PII.

## 9. Inventory movement reference

**Owner:** the ERP extension (the base has no inventory valuation/costing
concept — an explicit ADR-0020 exclusion). **Shape:**
`InventoryMovementReference` — `tenantId`, `movementId` (opaque),
`direction` (`receipt`/`issue`/`transfer`/`adjustment`), `item`
(`ItemReference`), `quantity` (decimal-as-string, opaque),
`businessTransactionReference?` (an optional link to §1).
**Failure semantics:** none — purely a reference; stock validation
(negative-stock, etc.) is entirely the extension's responsibility.
**Privacy classification:** no PII.

## 10. Reconciliation reference/control totals

**Owner:** the ERP extension (or a `reporting` projection the extension
contributes, §11). **Shape:** `ReconciliationReference` —
`tenantId`, `legalEntityScope?`, `periodKey`, `reconciledAt`,
`controlTotals` (an array of `ReconciliationControlTotal`: `label`,
`expectedValue`, `actualValue`, `matched`), `fullyReconciled`.
**Failure semantics:** `matched`/`fullyReconciled` are STRING-EXACT comparisons
prepared by the caller — this contract does NO numeric parsing/normalisation
whatsoever; the extension is responsible for normalising both sides before
comparing.
**Privacy classification:** control totals are aggregate tenant financial data —
as sensitive as §5, subject to the extension's own permissions when exposed
through an API/projection.

## 11. Reporting projection contribution

**Owner:** `reporting`'s `ProjectionDescriptor` (`_shared/module-contract.ts`,
Issue #753 — an existing base module, not a new contract from this issue). An
ERP extension contributes ONE descriptor per read-model it wants maintained
incrementally (e.g. a posting summary per tenant), driven by its own events (§5)
through the `"domain_event"` strategy — the `reporting` engine NEVER reads the
extension's ledger tables directly (ADR-0013 §6).
**Failure semantics:** the descriptor's `requiredPermission` MUST be checked by
the caller — see that this constraint is already enforced by
`reporting/domain/projection-permission-filter.ts` for BASE descriptors; an
extension that registers its own descriptor in its derived build is responsible
for making sure the same enforcement applies to its descriptor (see the Wave 3
note about the "descriptor field documented but not enforced" pattern — do not
repeat that mistake in your extension).
**Machine-verifiable evidence:** the `reportingProjections` entry in
`tests/fixtures/derived-application-example/modules/example-erp-extension/module.ts`
passes `reporting`'s real `validateProjectionRegistry` — see
`tests/unit/erp-extension-contracts.test.ts`.
**Privacy classification:** follows the classification of the data being
aggregated (here, financial data — see §5/§10).

## Explicit exclusions (will never exist in this base)

Chart of accounts & journal tables; a double-entry posting engine; inventory
valuation/costing; sales order, purchase order, AR/AP, cash/bank, payment
allocation; fixed assets, depreciation, payroll, tax computation/reporting;
manufacturing, project costing, budget control, consolidation; any claim that
AWCMS itself is a complete or regulation-compliant ERP. See ADR-0020 §Context
for the full list and the reasoning.

## Compliance mapping (practice, not a certification claim)

The contracts in this document are a STRUCTURAL layer (data shapes, dependency
direction, idempotency/immutability invariants) — substantive accounting/tax
compliance (e.g. PSAK, VAT/income tax, audit standards) remains entirely the
responsibility of the ERP extension's owner, and is neither claimed nor
validated by this base. The technical controls that ARE relevant and are indeed
provided by the base: tenant isolation (RLS, ADR-0003), default-deny ABAC
(ADR-0004), audit logging of high-risk actions (skill `awcms-audit-log`),
sensitive-data masking (skill `awcms-sensitive-data`), and event payloads free
of credentials/secrets (`domain_event_runtime`'s
`validateDomainEventPayload`) — each maps to the common controls of the
Indonesian Personal Data Protection Law/ISO 27001 Annex A/OWASP ASVS already
documented in `docs/awcms/20_threat_model_security_architecture.md`, and not
repeated here.

## Reference fixture & tests

`tests/fixtures/derived-application-example/modules/example-erp-extension/` —
module descriptor + in-memory posting engine + period-lock fixture adapter,
NEVER composed into the real base registry (`src/modules/index.ts` is
unchanged). Verified by `tests/unit/erp-extension-contracts.test.ts`
(idempotency per `requestId`, duplicate-posting rejection per the business
identity `(tenantId, transactionType, externalTransactionId)` even with a new
`requestId`, fail-closed period lock, rejection of cross-tenant/
legal-entity-mismatch on forward requests, TWO adversarial tests dedicated to
the reversal-target side — a reversal authenticated as another tenant cannot
resolve the correct tenant's transaction even knowing its exact
`externalTransactionId`, and a reversal from the same tenant with a different
legal-entity scope is still rejected — reversal-as-a-new-transaction, reporting
projection contribution) and
`tests/unit/module-composition-fixture.test.ts` (DAG/capability/
migration-namespace composition). See both test files for real usage examples of
every contract above.

**Revision note:** an independent security review on this PR found that the
first revision of the fixture indexed the reversal target by `requestId` (the
wrong ID space — see invariant #7 in `business-transaction-contract.ts`) and did
not re-verify the tenant/legal-entity of the resolved original transaction —
both were fixed before this PR merged; see ADR-0020 §5 for the full detail. Do
not cite this fixture as "proven safe" without reading that note.
