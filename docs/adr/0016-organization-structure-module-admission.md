🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0016-organization-structure-module-admission.id.md)

# ADR-0016 — Admission of `organization_structure` as an Official Optional Business Foundation module

- **Status:** Accepted (not yet implemented)
- **Status note (2026-08-05):** This admission decision still stands, but its artefacts (`src/modules/organization-structure/`) do not exist in this repo, and since ADR-0055 its implementation awaits an admission ADR in this repo.
- **Date:** 2026-07-14
- **Decision maker:** @ahliweb
- **Related:** Issue #749 (epic #738 `platform-evolution`, Wave 2), Issue #739 / ADR-0013 (extension layers, tenant vs legal entity vs organization unit vocabulary), Issue #746 (business-scope assignments + `BusinessScopeHierarchyPort`, PR #776), `docs/awcms/21_module_admission_governance.md`, `docs/awcms/templates/module-proposal-template.md`

> **NOT YET IMPLEMENTED IN THIS REPO.** The `Accepted` status above is an
> **admission** decision, not a statement that the module exists. As of today
> there is no `src/modules/organization_structure/`, no migration, no permission, and
> `listModules()` does not return it — calling it will fail. The plan for
> providing it: Wave A of
> [`docs/awcms/absorb-awcms-mini-backbone-roadmap.md`](../awcms/absorb-awcms-mini-backbone-roadmap.md).
> Delete this block in the PR that actually lands the module —
> `tests/adr-admission-implementation-status.test.ts` demands its removal as soon
> as the module enters the registry.

## Context

ADR-0013 §1 already pre-classified `organization_structure` as an **Official Optional Business Foundation** candidate (layer 3) for Wave 2 of epic #738, and §2 already defined the tenant vs legal entity vs organization unit conceptual boundary bindingly. Issue #749 itself explicitly requires as its first acceptance criterion: "Admission decision and ADR classify the module and dependencies before implementation" — this ADR satisfies that requirement by filling in `docs/awcms/templates/module-proposal-template.md` inline and confirming category/dependency/lifecycle/offline-compatibility/owner before the module's first line of code is written, following the admission decision tree in `docs/awcms/21_module_admission_governance.md` §3.

Unlike #742 (`domain_event_runtime`) and #743 (`data_lifecycle`), which both did **not** write a separate ADR/doc 21 §8 update (relying on the ADR-0013 pre-classification as sufficient) — issue #749 explicitly asks for its own admission decision/ADR as an acceptance criterion, so that precedent is deliberately **not** followed here.

## Decision

We decide to admit `organization_structure` as a new module in this base registry with the following parameters (filling in the `module-proposal-template.md` format inline):

### 1. Module name & key

- Name: **Organization Structure**
- `key`: `organization_structure`
- Category: **Official Optional Module** (= the ADR-0013 "Official Optional Business Foundation" layer)

### 2. Problem/need

Many derived applications (multi-branch retail, multi-unit public services, education portals with faculty/department structures) need generic organizational primitives — legal entity, department/branch/cost-center/warehouse/program unit, effective-dated hierarchy, operational locations, and party/user assignment to units — without rebuilding these in every derived repo, and without weakening the tenant isolation boundary (ADR-0013 §2). This is for **most** derived applications that have an internal organizational structure (not just one vertical), but still **opt-in per tenant** (not every tenant needs a legal entity/hierarchy — many small tenants operate flat).

### 3. Why this is not a Derived Application module

It passes the doc 21 §3 decision tree, node Q3 ("generic for ALL derived applications"): legal entity/organization unit/hierarchy/operational location/assignment are structural primitives that apply the same way to retail, public services, education, healthcare, etc. — not logic specific to one vertical (there is no chart of accounts, inventory valuation, payroll, or specific government rule here, see §Out of scope). The same precedent as `blog_content`/`news_portal`/`social_publishing` (generic editorial content across verticals) — this module is "generic organizational structure across verticals", not ERP.

### 4. Dependencies

- **Lifecycle dependency** (`ModuleDescriptor.dependencies`, must be active first): `["tenant_admin", "identity_access", "domain_event_runtime"]`. `tenant_admin` for `awcms_tenants` (the tenant boundary), `identity_access` for `awcms_tenant_users` (the assignment subject is referenced through an ordinary FK to this table, similar to the pattern of `business-scope-assignment-service.ts`'s `tenantUserId` check), `domain_event_runtime` because this module is a REAL producer (`appendDomainEvent`, importing event type constants from `domain-event-runtime/domain/event-type-registry.ts`) — exactly the `workflow_approval` pattern (Issue #747), not the `profile_identity` pattern (Issue #748, Core, deliberately NOT importing cross-module constants because Core must not depend on System). An Optional (`organization_structure`) depending on a System (`domain_event_runtime`) is a permitted DAG direction (ADR-0013 §1: Opt → Sys).
- **Capability dependency** (`ModuleDescriptor.capabilities`, ADR-0011): `organization_structure` **PROVIDES** `organization_hierarchy_resolution` — a real implementation of `BusinessScopeHierarchyPort` (`_shared/ports/business-scope-hierarchy-port.ts`) for `scopeType` "legal_entity"/"organization_unit". This module registers **NO** `capabilities.consumes` from `identity_access`, and more importantly — `identity_access` does **NOT** register `organization_structure` as any lifecycle or capability dependency in the opposite direction (Core never depends on Optional, ADR-0013 §1). Adapter selection (identity-access's flat `defaultBusinessScopeHierarchyPortAdapter` vs the real `organizationStructureHierarchyPortAdapter`) is done by the **composition root** (the route handler / job script that needs scope resolution) at runtime — exactly the pattern documented in the headers of `business-scope-hierarchy-port.ts` and `business-scope-hierarchy-port-adapter.ts` themselves for the "office" case today.

### 5. Offline/LAN vs full-online-only compatibility

- Compatibility class: **offline-lan-safe**. No external provider is involved at all — all CRUD/hierarchy/location/assignment operations are pure database operations, lat/lng coordinates are validated locally (not sent to a geocoding provider), and the seed import hook (through the future data-exchange contract, #750/#752) is optional, not a hard runtime dependency.
- This module works 100% in the `offline-lan` profile with no internet connectivity at all.

### 6. External providers

None. There is no External Integration category inside this module.

### 7. Security & data governance

- Data touched: legal entity name/identifier (a generic identifier, NOT a government-specific field such as NPWP/SIUP — see §Out of scope), organization unit names, operational location address/coordinates (low PII — office/branch addresses, not individual personal data), `tenant_user_id` references for assignments (not new profile data — referencing `identity_access`'s existing table).
- ABAC: default-deny, new permission keys per resource (`organization_structure.legal_entities.*`, `.unit_types.*`, `.units.*`, `.hierarchy.*`, `.locations.*`, `.location_unit_relationships.*`, `.assignments.*`) — see the permission seed migration.
- High-risk actions that must be audit-logged: hierarchy reparent (+ `Idempotency-Key`), legal entity deactivation, ending an assignment, deleting (soft-deleting) a unit/location.
- Tenant and legal entity/organization unit remain distinct concepts (ADR-0013 §2) — the RLS predicate of EVERY new table in this module is always and only `tenant_id`, never `legal_entity_id`/`organization_unit_id` as a second predicate.

### 8. Ownership

`@ahliweb` (following `.github/CODEOWNERS`, the same as every other module — `ModuleDescriptor.maintainers` is not filled in by any module per doc 21 §8 R3, and is not changed here).

### 9. Deprecation plan

Not applicable — a new module, it does not replace any existing module/feature.

### 10. Alternatives considered

- **Adding `legal_entity_id`/`organization_unit_id` directly to `awcms_offices`/`tenant_admin`** — rejected: it violates ADR-0013 §2 directly (legal entity/organization unit are NOT Core concepts, and `tenant_admin` must not have a dependency on any Optional module, ADR-0012 §4.1). Instead, `organization_structure` may (optionally) reference `awcms_offices` through an `office_id` ordinary FK in the future (not implemented in this issue — out of scope), not the other way round.
- **Making `organization_structure` a System module rather than an Official Optional Module** — rejected: this is a product feature with direct business value (opt-in per tenant, disable-able without breaking any Core/System), not pure reusable infrastructure like `logging`/`sync_storage` (doc 21 §2's System vs Official Optional Module definition) — exactly the same criteria that place `blog_content`/`news_portal`/`social_publishing` in this category.
- **`organization_structure` declaring `identity_access` as a capability consumer of the port this module itself provides** — irrelevant/nonsensical: the `BusinessScopeHierarchyPort` port is defined in `_shared` and this module merely PROVIDES an additional implementation of it; there is no capability dependency direction from `organization_structure` to `identity_access` for this.
- **Making "location" a `scopeType` exposed through `BusinessScopeHierarchyPort`** — rejected for this version: this port is about business authorization/hierarchy (legal entity/organization unit), not physical location lookup; `location` stays purely internal to `organization_structure` (accessed through this module's own endpoints, not through this port) until there is a concrete need for location-based authorization.

## Consequences

- **Positive:** Derived applications (multi-branch AWPOS, a Smart School Portal with faculty structures, etc.) get reusable organizational primitives without rebuilding legal entity/hierarchy/location/assignment each on their own, and `identity_access` gets a real hierarchy implementation (not just the flat "office") for `BusinessScopeHierarchyPort` without Core ever depending on this Optional module.
- **Positive:** The ADR-0013 §2 tenant vs legal entity/organization unit boundary now has its first concrete implementation proving that rule can be enforced (RLS stays `tenant_id` only, `legal_entity_id`/`organization_unit_id` are always ordinary FKs revalidated in the application layer).
- **Negative/trade-off:** The 17th module in the registry adds surface that must pass `modules:dag:check`/`modules:compose:check` every time the registry changes — mitigation: dependencies are declared minimally (`tenant_admin`, `identity_access` only), with no capability `consumes` that could create a cycle.
- **Neutral:** `docs/awcms/21_module_admission_governance.md` §8 is updated to add a 17th row (see this PR) — from "3 Core + 9 System + 3 Official Optional Module = 15 of 16 modules" to "3 Core + 9 System + 4 Official Optional Module = 16 of 17 registered modules".

## Alternatives considered

See §10 above (merged into the inline proposal template format, not repeated here).
