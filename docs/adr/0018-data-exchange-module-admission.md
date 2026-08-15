🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0018-data-exchange-module-admission.id.md)

# ADR-0018 — Admission of `data_exchange` as an Official Optional Business Foundation module

- **Status:** Accepted (not yet implemented)
- **Status note (2026-08-05):** This admission decision still stands, but its artifact (`src/modules/data-exchange/`) does not exist in this repo, and since ADR-0055 its implementation awaits an admission ADR in this repo.
- **Date:** 2026-07-14
- **Decision maker:** @ahliweb
- **Related:** Issue #752 (epic #738 `platform-evolution`, Wave 3), Issue #739 / ADR-0013 §3 (data_exchange was already pre-classified as an Official Optional Business Foundation candidate), Issue #742 / domain_event_runtime (the generic outbox/dispatcher this module consumes as an event producer), `docs/awcms/21_module_admission_governance.md`, `docs/awcms/templates/module-proposal-template.md`

> **NOT YET IMPLEMENTED IN THIS REPO.** The `Accepted` status above is an
> **admission** decision, not a statement that the module exists. As of today
> there is no `src/modules/data_exchange/`, no migration, no permissions, and
> `listModules()` does not return it — calling it will fail. The plan for
> delivering it: Wave A of
> [`docs/awcms/absorb-awcms-mini-backbone-roadmap.md`](../awcms/absorb-awcms-mini-backbone-roadmap.md).
> Delete this block in the PR that actually lands the module —
> `tests/adr-admission-implementation-status.test.ts` demands it be removed as
> soon as the module enters the registry.

## Context

ADR-0013 §3 (the extension-layer table) already pre-classified `data_exchange` as an **Official Optional Business Foundation** candidate (layer 3, the "Official Optional Business Foundation" row) for Wave 2/3 of epic #738 — alongside `organization_structure` (already admitted via ADR-0016), `reference_data`, generic documents/managed-files, and `case_management`. Issue #752 itself explicitly requires as its first acceptance criterion: "Admission decision and ADR confirms module category, ownership, dependencies, and offline support before implementation" — this ADR satisfies that following the ADR-0016 precedent (filling in `module-proposal-template.md` inline) before the module's first line of code is written, following the admission decision tree in `docs/awcms/21_module_admission_governance.md` §3.

Unlike `organization_structure` (ADR-0016), this module has no standalone domain business data of its own — it is a **generic mechanism** (staging/validation/preview/idempotent asynchronous commit/export/reconciliation) to which other OWNER modules contribute their own schema/validation/mapping/commit adapters. That makes it shaped like `workflow`/`email`/`form_drafts` (System modules providing a generic mechanism consumed by other modules) — yet ADR-0013 §3 already explicitly places `data_exchange` on the **Official Optional Business Foundation** row, not System Foundation, because its admin UI (upload/preview/commit/download/history) is a product capability used directly by business users (not pure background infrastructure like `logging`/`sync_storage`), and this module is **opt-in per tenant** (`awcms_tenant_modules`) — a tenant that does not need bulk import/export need not enable it, unlike `workflow`/`email` which tend to be always relevant once some derived feature uses them. This decision takes the ADR-0013 §3 classification as it stands, it does not revisit it.

## Decision

We decide to admit `data_exchange` as a new module in this base registry with the following parameters (filling in the `module-proposal-template.md` format inline):

### 1. Module name & key

- Name: **Data Exchange**
- `key`: `data_exchange`
- Category: **Official Optional Module** (= the ADR-0013 "Official Optional Business Foundation" layer)

### 2. Problem/need

Every derived application repeatedly needs safe CSV/JSON import/export (staging, schema validation, preview/diff before commit, idempotent asynchronous commit, resumable partial-failure handling, export manifest/checksum, and reconciliation) — implementing this separately in each module risks long-running HTTP requests, partial writes, tenant mixing, formula injection (CSV injection), unbounded file parsing, inconsistent validation, and exports that cannot be reconciled. The base provides the generic staging/validation/commit engine; each OWNER module provides its own schema/validation/mapping/commit adapter through a capability port (ADR-0011), not through direct table access.

### 3. Why this is not a Derived Application module

It passes the doc 21 §3 decision tree, node Q3 ("generic for ALL derived applications"): CSV/JSON staging/validation/preview/commit/export/reconciliation is a structural need that is identical for retail (product catalogue import), public services (citizen data import), education (student data import), healthcare, and so on — not the logic of one vertical. This module does NOT implement any domain schema of its own (there is no "product import", "student import" here) — only the generic engine + the port contract; the real schema is always defined by the owner module. The same precedent as `organization_structure` (ADR-0016) and `blog_content`/`news_portal` — a generic cross-vertical primitive, not an ERP.

### 4. Dependencies

- **Lifecycle dependency** (`ModuleDescriptor.dependencies`, must be active first): `["tenant_admin", "identity_access", "logging", "domain_event_runtime"]`. `tenant_admin`/`identity_access` for the tenant boundary and `awcms_tenant_users` (the `createdBy`/audit actor), `logging` for `recordAuditEvent`, `domain_event_runtime` because this module is a REAL producer (`appendDomainEvent`, importing event type constants from `domain-event-runtime/domain/event-type-registry.ts`) — exactly the same pattern as `workflow_approval` (#747) and `organization_structure` (#749). Optional (`data_exchange`) depending on System (`domain_event_runtime`) is an allowed DAG direction (ADR-0013 §1: Opt → Sys).
- **Capability dependency** (`ModuleDescriptor.capabilities`, ADR-0011): `data_exchange` **PROVIDES** `data_exchange_staging` — a new capability port, `DataExchangeAdapterPort` (`_shared/ports/data-exchange-adapter-port.ts`), which future OWNER modules (e.g. the prospective `reference_data`, `case_management`, or a derived application's domain module) implement themselves (`<module>/application/*-data-exchange-adapter.ts`) to supply their schema's validation/mapping/commit. `data_exchange` does **NOT** register any `capabilities.consumes` from any owner module — the adapter→descriptor wiring happens through a static, reviewed-source-code registry owned by `data_exchange` itself (`infrastructure/exchange-adapter-registry.ts`, a pattern identical to `domain-event-runtime/infrastructure/consumer-registry.ts`), not through a direct import of an owner module into `data_exchange`'s domain/application.
- The exchange descriptor itself (`ExchangeDescriptor`, a new `ModuleDescriptor.dataExchange` field in `_shared/module-contract.ts`, pure static metadata — no function references/imports) is the declarative mechanism by which an owner module contributes its schema/limits/permissions, following the `HighVolumeTableDescriptor`/`dataLifecycle` (#745) and `SoDRuleDescriptor`/`sodRules` (#746) patterns exactly.

### 5. Offline/LAN vs full-online-only compatibility

- Compatibility class: **offline-lan-safe**. No external provider is involved at all — staging/parse/validate/preview/commit/export are entirely pure database + CPU operations (a hand-written CSV/JSON parser, no external library, no network calls). Staged file content is stored inline in a database column (not external object storage), so this module works 100% in the `offline-lan` profile with no internet connectivity whatsoever.
- Asynchronous commit runs through a scheduled worker (`bun run data-exchange:worker`, built on `src/lib/jobs/job-runner.ts`) — the same operational pattern as `data-lifecycle:archive-purge`/`domain-events:dispatch`, not a long-running synchronous HTTP call.

### 6. External providers

None within the scope of Issue #752. Its own `ArchivePortKind`/`ExportStoragePort` (local/offline only for v1) is declared forward-compatible with a future external object-storage adapter (following the `data_lifecycle` `ArchivePort` precedent — "local now, external later if a real need appears"), but is not implemented here.

### 7. Security & data governance

- Data touched: raw staged file content (which may contain any owner module's business fields — this module itself does not know the field semantics, it only stores/passes them through), values of rows that failed validation (the preview error artifact, requiring a separate permission for raw unmasked values), export manifest/checksum.
- ABAC: default-deny, new permission keys per resource (`data_exchange.descriptors.read`, `.imports.*`, `.preview_errors.read`, `.exports.*`, `.export_downloads.read`, `.reconciliation.read`) — see the permission seed migration.
- High-risk actions that must be audited + carry an `Idempotency-Key`: stage-upload (`imports.create`), commit (`imports.post`, the riskiest action — it triggers real data writes into the owner module's tables), export trigger (`exports.create`).
- **Formula injection (CSV injection)**: every field value beginning with `=`, `+`, `-`, `@`, TAB, or CR is neutralised (prefixed with `'`) at parse-intake BEFORE being stored into `awcms_data_exchange_staged_rows`, and neutralised AGAIN (defense-in-depth, idempotent) at export serialisation — ensuring that no CSV output from this module ever becomes a formula execution vector in the receiving spreadsheet application.
- **Unbounded file parsing**: body size is capped at the HTTP layer (the `large` tier, 5 MiB, before any parsing — `readFormBody`/`readTextBody`), AND the hand-written CSV/JSON parser caps the number of rows/fields per descriptor (`maxRowCount`/`maxFieldsPerRow`) with an early abort DURING parsing (not parse-then-check).
- **Cross-tenant**: every new table of this module (`import_batches`, `staged_rows`, `export_jobs`, `reconciliation_reports`, `reference_items`) has an RLS predicate that is ALWAYS and ONLY `tenant_id`, with `ENABLE`+`FORCE ROW LEVEL SECURITY`. The owner module's adapter receives ONLY the rows of the tenant currently being processed (never cross-tenant) — guaranteed because the whole commit pipeline runs inside `withTenant`.
- Commit is the ONLY point of real mutation; preview/validation NEVER mutates the owner module's tables.

### 8. Ownership

`@ahliweb` (following `.github/CODEOWNERS`, the same as every other module — `ModuleDescriptor.maintainers` has not been filled in by any module per doc 21 §8 R3, and is not changed here).

### 9. Deprecation plan

Not applicable — a new module, it does not replace any existing module/feature.

### 10. Alternatives considered

- **Making `data_exchange` a System module rather than an Official Optional Module** — considered (it is shaped like `workflow`/`email`: a generic mechanism consumed by other modules), but rejected: ADR-0013 §3 already explicitly pre-classifies this module as "Official Optional Business Foundation" in its table, and its admin UI (upload/preview/commit/download/history) is a product capability used directly by business users and opt-in per tenant — the same criteria that place `organization_structure` in this category (ADR-0016 §10).
- **Having a real owner module (e.g. `organization_structure`) implement the adapter port in this PR** — rejected for this issue's scope: touching another module being worked on in parallel by another Wave 3 agent would violate the atomic principle (AGENTS.md rule #1) and risks a direct collision. Instead, this PR ships THREE reference scenarios (create/update/conflict; partial-failure/resume; export/reconciliation) on top of `data_exchange`'s OWN reference table (`awcms_data_exchange_reference_items`) — following the already-accepted "foundation issue ships zero real business integrations" precedent (#642's domain_event_runtime, Issue #742). Wiring a real owner module's adapter is a separate follow-up issue.
- **Storing staged file content in external object storage (R2)** — rejected for v1: it violates the offline-lan-safe requirement (ADR-0006) as a default, and `data_exchange` must not force an external provider as a hard dependency. Content is stored inline in a `text` database column (size-capped the same as its HTTP body), and an external object-storage adapter is declared forward-compatible but not implemented.

## Consequences

- **Positive:** Derived applications get a reusable CSV/JSON staging/validation/preview/idempotent-async-commit/export/reconciliation engine without each rebuilding formula-injection/unbounded-parsing/partial-failure-resume handling of its own.
- **Positive:** The port contract (`DataExchangeAdapterPort`) and the static descriptor (`ExchangeDescriptor`) give future owner modules a clear admission path without `data_exchange` ever writing directly into another module's tables (ADR-0013 §6).
- **Negative/trade-off:** A new module in the registry adds surface that must pass `modules:dag:check`/`modules:compose:check`; mitigation: dependencies are declared minimally, and there is no `consumes` capability that could create a cycle.
- **Neutral:** `docs/awcms/21_module_admission_governance.md` §8 is updated with an 18th registered-module row.
