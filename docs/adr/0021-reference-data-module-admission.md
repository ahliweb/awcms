🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0021-reference-data-module-admission.id.md)

# ADR-0021 — Admission of `reference_data` as an Official Optional Business Foundation module

- **Status:** Accepted (not yet implemented)
- **Status note (2026-08-05):** This admission decision still stands, but its artifact (`src/modules/reference-data/`) does not exist in this repo, and since ADR-0055 its implementation awaits an admission ADR in this repo.
- **Date:** 2026-07-14
- **Decision maker:** @ahliweb
- **Related:** Issue #750 (epic #738 `platform-evolution`, Wave 3), Issue #739 / ADR-0013 (extension layers, data-ownership matrix), ADR-0016 (`organization_structure` admission — same template pattern), Issue #742 / `domain_event_runtime` (outbox event runtime used by this module as a REAL producer), `docs/awcms/21_module_admission_governance.md`, `docs/awcms/templates/module-proposal-template.md`

> **NOT YET IMPLEMENTED IN THIS REPO.** The `Accepted` status above is an
> **admission** decision, not a statement that the module exists. As of today
> there is no `src/modules/reference_data/`, no migration, no permissions, and
> `listModules()` does not return it — calling it will fail. The plan for
> delivering it: Wave A of
> [`docs/awcms/absorb-awcms-mini-backbone-roadmap.md`](../awcms/absorb-awcms-mini-backbone-roadmap.md).
> Delete this block in the PR that actually lands the module —
> `tests/adr-admission-implementation-status.test.ts` demands it be removed as
> soon as the module enters the registry.

## Context

ADR-0013 §1 already pre-classified `reference_data` as an **Official Optional Business Foundation** candidate (layer 3) for Wave 3 of epic #738, and the closing note of §1 explicitly warns the implementer of this issue that `idn_admin_regions` (a registered module with `type: "base"`, `status: "experimental"`, without schema/API/UI) is already conceptually "half-building the same primitive" — this ADR confirms how the two modules stay separate without duplicating data (§4 below). Issue #750 explicitly requires as its first acceptance criterion: "Admission decision/ADR confirms module category, ownership, dependencies, and offline behavior" — this ADR satisfies that by filling in `docs/awcms/templates/module-proposal-template.md` inline, following the ADR-0016 format (the nearest Wave 2 precedent, which also wrote its own admission ADR rather than relying solely on the ADR-0013 pre-classification).

## Decision

We decide to admit `reference_data` as a new module in this base registry with the following parameters (filling in the `module-proposal-template.md` format inline):

### 1. Module name & key

- Name: **Reference Data**
- `key`: `reference_data`
- Category: **Official Optional Module** (= the ADR-0013 "Official Optional Business Foundation" layer)

### 2. Problem/need

Every derived application needs controlled reference codes — currencies, units of measure (UoM), fiscal calendars, document classifications, or value sets belonging to its own module — without (a) inventing hardcoded enums per module, (b) importing another module's tables directly (violating ADR-0013 §6 no-shared-table-write), or (c) destructively deleting/replacing codes already used by real data. `reference_data` answers this as a provider-neutral foundation: value sets + effective-dated codes, localized, with provenance, deprecation/supersession, deterministic global-baseline vs tenant-override precedence, and a validated import path. Generic for **all** derived applications (retail needs currencies/UoM, public services need document classifications, schools need academic years/fiscal calendars) — not specific to one business domain.

### 3. Why this is not a Derived Application module

It passes the doc 21 §3 decision tree, node Q3 ("generic for ALL derived applications"): value sets/codes/localization/effective dates/deprecation are generic data primitives with the same shape in retail, public services, education, healthcare, and so on — not the business rules of one vertical (there is no chart of accounts, tax rule, or product/item catalogue here, see §Out of scope in issue #750). The same precedent as `organization_structure` (ADR-0016) — this module is a "generic cross-vertical reference-data foundation", not a specific ERP/master-data implementation.

### 4. Relationship with `idn_admin_regions` — no duplication, no data migration

`idn_admin_regions` (registry `type: "base"`, `status: "experimental"`, migration 054/dataset specific to Indonesian administrative regions from `cahyadsn/wilayah`) **stays module-owned and is NOT reclassified by this ADR** (category reclassification requires a separate admission decision, doc 21 §9 — outside the scope of issue #750, which explicitly names "Existing `idn_admin_regions` ownership remains clear and no duplicate region dataset is introduced" as an acceptance criterion, not "merge it into `reference_data`"). The concrete decisions:

- `reference_data` does **not** import/copy `awcms_idn_admin_regions`/`awcms_idn_region_datasets` rows into its own generic tables.
- `idn_admin_regions` **may**, in its own future issue (outside the scope of #750), choose to register itself as a _module-contributed value set_ through this module's generic contribution mechanism (`ModuleDescriptor.referenceData.contributesValueSets`, §5 below) — an optional choice, not a requirement, and not a mandatory data migration. Until that decision is taken explicitly, the two modules run independently: `idn_admin_regions` keeps its own schema/API/data owner specific to the administrative region hierarchy (province/regency/district/village nested four levels deep, a structural need that does not map cleanly onto this module's generic flat value-set/code model), while `reference_data` serves **flat** value sets (currencies, UoM, fiscal calendars, and other value sets that do not need multi-level hierarchy).
- There is no dependency (lifecycle or capability) between `reference_data` and `idn_admin_regions` in either direction in this PR.

### 5. Dependencies

- **Lifecycle dependency** (`ModuleDescriptor.dependencies`, must be active first): `["tenant_admin", "identity_access", "domain_event_runtime"]`. `tenant_admin` for `awcms_tenants` (the tenant boundary, referenced by the tenant-override table), `identity_access` for actor/permission context (every endpoint is still authenticated through a tenant user + permission, including endpoints that write to GLOBAL tables — see §8), `domain_event_runtime` because this module is a REAL producer (`appendDomainEvent`, event types registered in `domain-event-runtime/domain/event-type-registry.ts`) — the same pattern established by `organization_structure` (ADR-0016) and `workflow_approval` (#747).
- **Capability dependency** (`ModuleDescriptor.capabilities`, ADR-0011): `reference_data` **PROVIDES** `reference_data_resolution` — the real implementation of `ReferenceDataPort` (`_shared/ports/reference-data-port.ts`) for code resolution (baseline + tenant override, as-of, deprecation-aware) and value set snapshots. **No other module in this PR registers `capabilities.consumes` against this port** — just like `organization_structure`'s `BusinessScopeHierarchyPort` when first introduced (ADR-0016 §4), this port is an _extension seam_ for future consumers (including `idn_admin_regions`, §4 above), not an existing direct integration in this PR (keeping the blast radius atomic, AGENTS.md rule #1). In addition, this module defines a new **module contribution descriptor** (`ModuleDescriptor.referenceData?.contributesValueSets`, an additive optional field in `_shared/module-contract.ts`) — a declarative mechanism (not a capability port) that lets OTHER modules statically register their own value sets/codes without importing tables directly; validated by `domain/contribution-registry.ts` (a pattern identical to `data_lifecycle`'s `HighVolumeTableDescriptor`/SoD's `SoDRuleDescriptor`, Issues #745/#746) and synced into this module's global tables via `application/contribution-sync.ts`, invoked explicitly (`bun run reference-data:contributions:sync`), not automatically from any other module.

### 6. Offline/LAN vs full-online-only compatibility

- Compatibility class: **offline-lan-safe**. No external provider is involved at all — the whole of CRUD/resolution/import is pure database operation; import validates a payload sent by the operator (it does not call an external data source in real time — explicitly out of scope for issue #750: "Real-time external provider calls during reference resolution").
- This module works 100% in the `offline-lan` profile with no internet connectivity whatsoever.

### 7. External providers

None. There is no External Integration category inside this module.

### 8. Security & data governance

- Data touched: value set/code metadata (stable keys, localized labels, size-bounded jsonb metadata, effective dates) — no PII, no secrets, no executable expressions/SQL/templates inside `metadata` (enforced by domain validation, per issue #750's acceptance criterion "Reference data contains no executable expressions, SQL, templates, secrets, or unbounded arbitrary metadata").
- **The global baseline (value set/code/translation/import batch) deliberately has NO RLS** — the same as `awcms_permissions`/`awcms_modules`/`awcms_idn_admin_regions` (doc 04 §RLS standard, doc 21 §8): the data is identical for every tenant by design, it is not tenant data. These tables are registered explicitly in `RLS_FREE_TABLES` AND `ALLOWED_GLOBAL_TABLE_GRANTS` in `scripts/security-readiness.ts` (reviewed RLS-exempt, not an unnoticed hole) — satisfying the acceptance criterion "reviewed global baseline tables are explicitly documented if RLS-exempt". Mutations against these global tables must still go through a tenant-authenticated endpoint + the `reference_data.*` permission (there is no separate "platform superadmin" concept in this codebase, the same as the design of `idn_admin_regions`'s planned `dataset.import`/`.activate`/`.rollback` — see the module README for the explicit operational note: this permission must be granted narrowly to trusted operators because its actions affect the shared baseline of ALL tenants, not just the calling tenant).
- **Tenant override/extension (`awcms_reference_tenant_codes` + translations) has RLS `ENABLE`+`FORCE`**, the predicate always and only `tenant_id` (ADR-0013 §2/§9) — a tenant override never writes to the global baseline table and never reads another tenant's overrides; the resolution precedence (baseline vs override) is a pure READ operation that combines the results of two separate queries (tenant-scoped RLS for the override, a plain global SELECT for the baseline), not a cross-isolation JOIN that could leak another tenant's rows.
- ABAC: default-deny, new permission keys per resource (`reference_data.value_sets.*`, `.codes.*`, `.imports.*`, `.tenant_codes.*`) — see the permission seed migration. The `AccessAction` union gains two new values (`commit`, `rollback`, both classified `HIGH_RISK_ACTIONS`) — additive only, existing literal values are unchanged.
- High-risk actions that must carry an `Idempotency-Key` + audit log: create/update/deprecate/restore on value sets, codes, and tenant codes, plus import dry-run/commit/rollback — the ENTIRE mutation surface of this module (not a subset), including every admin UI submit button that calls those endpoints. Deprecating a value set/code already referenced by a tenant override, and import commit/rollback, are the highest-risk candidates (issue #750 acceptance criterion: "A code already referenced by business data is never silently deleted or repurposed in place") — import commit re-validates the checksum + the destructive-replace check INSIDE the same transaction as the write, not merely as a separate pre-check.

### 9. Ownership

`@ahliweb` (following `.github/CODEOWNERS`, the same as every other module — `ModuleDescriptor.maintainers` has not been filled in by any module per doc 21 §8 R3, and is not changed here).

### 10. Deprecation plan

Not applicable — a new module, it does not replace any existing module/feature. The currency/UoM/fiscal-calendar data shipped as fixtures are **neutral examples**, not an authoritative regulatory source — documented explicitly in the module README (issue #750 acceptance criterion: "without claiming comprehensive regulatory authority").

### 11. Alternatives considered

- **Merging `idn_admin_regions` into `reference_data` in this PR** — rejected: explicitly outside the scope of issue #750 ("no duplicate region dataset is introduced", not "merge it now"), and `idn_admin_regions`'s 4-level administrative region hierarchy does not map cleanly onto this module's flat value-set/code model without a migration design of its own (§4 above documents an optional compatible path for the future, not a decision for now).
- **Making the baseline value set/code tables tenant-scoped (with a nullable `tenant_id` for global rows)** — rejected: it violates this repo's RLS convention (a nullable `tenant_id` on an RLS-FORCE table creates an ambiguous class of rows that is hard to audit); following the `awcms_idn_admin_regions`/`awcms_permissions` precedent that firmly separates GLOBAL tables (no `tenant_id`, documented RLS-exempt) from tenant-scoped tables (`tenant_id` mandatory, RLS FORCE) is far more consistent with doc 04 §RLS standard.
- **Allowing tenant overrides to overwrite baseline rows in place (a direct UPDATE to `awcms_reference_codes` with a tenant filter)** — rejected explicitly: it directly violates issue #750's acceptance criterion "Tenant override cannot mutate global/module baseline rows or affect another tenant"; instead a tenant override ONLY ever writes to a separate tenant-scoped table (`awcms_reference_tenant_codes`), and the baseline is never touched by any tenant mutation.
- **Committing an import directly with no separate dry-run stage** — rejected: issue #750's acceptance criterion explicitly requires "Import dry-run/diff is non-mutating; commit is idempotent, audited, and recoverable" — two stages (a dry-run producing a validated batch + checksum, and a commit that references that batch and re-validates it inside the same transaction) are the only way to prove "non-mutating dry-run" and "idempotent commit" structurally rather than merely narratively.

## Consequences

- **Positive:** Derived applications get a reusable reference-code foundation (currencies, UoM, fiscal calendars, value sets owned by their own module) without inventing hardcoded enums or importing another module's tables directly, and `idn_admin_regions` gets an optional compatible path (module-contributed value set) for the future without a mandatory data migration now.
- **Positive:** Deterministic and tested global-baseline vs tenant-override precedence (unit tests for cross-tenant isolation + as-of resolution) gives the first concrete reference model for the "global baseline data, tenants may extend/override without affecting other tenants" pattern — a pattern other Optional modules can use in the future.
- **Negative/trade-off:** A new module in the registry adds surface that must pass `modules:dag:check`/`modules:compose:check` every time the registry changes, and adds two new values (`commit`, `rollback`) to the shared `AccessAction` union — mitigation: dependencies are declared minimally (`tenant_admin`, `identity_access`, `domain_event_runtime`), there is no `consumes` capability that could create a cycle, and both new action values follow the existing self-documenting naming pattern (`verify`/`set_primary`/`release`/`revoke`, etc.).
- **Negative/trade-off:** Mutations against the global baseline are still gated by ordinary tenant-scoped permissions (there is no separate "platform superadmin" mechanism in this codebase) — documented explicitly as an operational limitation (§8), not claimed as perfect isolation; operators must grant `reference_data.value_sets.*`/`.codes.*`/`.imports.*` narrowly.
- **Neutral:** `docs/awcms/21_module_admission_governance.md` §8 is updated with an 18th row (see this PR).
