🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](derived-application-guide.id.md)

# Derived Application Implementation Guide

> **⚠️ DEPRECATED ([ADR-0034](../adr/0034-awcms-family-direct-use-templates-and-derived-pathway-removal.md)).** The derived-application-in-a-separate-repo model is REVOKED — the AWCMS family (`awcms-mini`/`awcms`/`awcms-micro`) is now a set of **used-directly** templates, with no derivative repo (develop modules directly in the template). This document is kept as a historical record.

> **A base document (not a domain example).** This document explains how to build a derived application **on top of** AWCMS once the generic base is finished (v0.23.5, all 18 doc06 backlog issues + the post-backlog M9 improvements complete — see [`README.md`](README.md) §Next steps and [`AGENTS.md`](../../AGENTS.md) §Start here). The five example applications in §Derived application examples are **illustrations**, not modules added to this base.
>
> **Extension layers (epic #738).** Every derived application in this document lives in the **Derived Application** layer — one of the three "outside the base" layers (generic Derived Application, SaaS Control Plane, ERP Extension) defined by `docs/adr/0013-extension-layers-and-boundary-model.md`. That ADR also defines the tenant vs legal entity vs organization unit boundaries, and the "no shared-table write" rule for cross-repo collaboration — read it before your derived application needs to share data with another derived repo (e.g. a SaaS billing control-plane that bills the same tenants).
>
> **Build-time module composition (Issue #178, ADR-0025 — implementing ADR-0014).** Since Issue #178, a derived application **no longer needs to edit `src/modules/index.ts`** to register its domain modules. Replace the `undefined` value in your derived repo's `src/modules/application-registry.ts` with your own `ApplicationModuleRegistry` (`{ id, modules, migrationNamespace? }`, the type lives in `_shared/module-contract.ts`) — the only file you need to edit; the base `src/modules/index.ts` is never touched. `composeModuleRegistry()` (`module-management/domain/module-composition.ts`) merges the base registry + yours and validates duplicate keys/base-key overrides/the dependency DAG/capability bindings/migration namespaces/deployment profiles/navigation/jobs before a build is considered legitimate. Three gates enforce it in `bun run check` and CI: `bun run modules:compose:check` (composition validation), `bun run modules:composition:inventory:check` (a deterministic `docs/awcms/module-composition-inventory.json` inventory, regenerate via `bun run modules:composition:inventory:generate`), and `bun run extension:check` (extension seam health). See `docs/adr/0025-implement-deterministic-build-time-module-composition.md` (implementing `docs/adr/0014-deterministic-build-time-module-composition.md`) for the full decision, and `tests/fixtures/derived-application-example/` for a real example you can run immediately (`bun test tests/module-composition-fixture.test.ts`).
>
> **Compatibility manifest (Issue #183, ADR-0015 — PLANNED, not yet implemented).** Module composition (above) proves your registry is VALID today — not that it STAYS compatible once this base ships a new version. For that, an `extension.manifest.json` is planned (the compatible base SemVer range, module-contract/capability versions, historical migration namespaces+checksums, deployment profiles, and OpenAPI/AsyncAPI contract versions) validated by the `extension:check` gate — designed in `docs/adr/0015-derived-application-compatibility-manifest.md` and scheduled as **Issue #183** (epic #177 Wave 1); it does not exist in this repo yet. **Current status (Issue #178):** `bun run extension:check` (`scripts/extension-check.ts`) validates the **extension seam** only — that the effective registry (base + `application-registry.ts`) composes validly and, in base mode, is identical to the base registry. When #183 lands, the same gate/command is extended with manifest validation without changing the seam #178 established.

## Reusable base vs domain-specific extension

Before writing any code, understand the boundary: the base provides infrastructure and contracts that are **reused unchanged**; a derived application only adds **new domain modules** on top of it.

| Reusable (base — do not change)                                                                                              | Domain-specific (derived application — you add it)                                               |
| ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Modular monolith + module contract (`src/modules/_shared/module-contract.ts`, doc 10/11)                                     | New domain modules in `src/modules/<domain>/`                                                    |
| RBAC + ABAC default-deny + RLS (ADR-0003/0004, `src/modules/identity-access/`)                                               | Domain-specific permissions/roles/policies (doc 17 gives the pattern, not the content)           |
| Checksum-based migration runner, the `NNN_awcms_<area>_<desc>.sql` convention                                                | Domain table schemas (skill `awcms-new-migration`)                                               |
| Mandatory OpenAPI/AsyncAPI contracts + `api:spec:check` (ADR-0007/0008)                                                      | Domain endpoints/events (skill `awcms-new-endpoint`/`awcms-new-event`)                           |
| Soft delete + posted immutability (ADR-0005)                                                                                 | The policy for which domain resources may be restored/purged                                     |
| Generic audit trail (`awcms_audit_events`) + retention/purge + correlation ID (Issue 10.1/#447, skill `awcms-observability`) | Domain-specific high-risk actions that must be audited (skill `awcms-audit-log`)                 |
| Generic idempotency ledger (`awcms_idempotency_keys`)                                                                        | Which domain high-risk mutations must carry an `Idempotency-Key`                                 |
| Generic server-side form draft persistence (`awcms_form_drafts`, `/api/v1/form-drafts`, Issue #484)                          | What the draft `payload` contains and the domain-specific `moduleKey`/`wizardKey`/`resourceType` |
| Structured logger + extension points (`setLogSink`/`setAuditExportHook`)                                                     | The real log/audit consumer (SIEM, alerting) — the base only provides the mounting point         |
| Design system, tokens, state pattern, i18n (doc 14, skill `awcms-i18n`)                                                      | Domain admin/operator/portal screens (skill `awcms-ui-screen`)                                   |
| Offline-first sync (outbox/inbox, HMAC, conflict tracking, object queue dispatcher — Issue 6.1-6.3/#436)                     | Domain event payloads synchronised through the same outbox                                       |
| Connection pooling + work-class backpressure + circuit breaker (Issue 10.2, per-provider since #436)                         | Domain external providers (WA/email/AI/tax) behind a flag + outbox                               |
| Production readiness tooling (`db:pool:health`, `security:readiness`, `production:preflight`)                                | Additional domain checklist items (e.g. tax data masking for a tax application)                  |
| The project skills in `.claude/skills/`                                                                                      | —                                                                                                |

The principle: **keep** the left column as it is; **add** the right column following the patterns already established. Do not rewrite your own RLS/ABAC/audit/idempotency — the base already provides them, just use them.

## The flow for building a derived application (9 steps)

Each step maps to a real skill (`.claude/skills/`) — call that skill, do not guess the pattern yourself.

1. **Define the domain PRD/SRS** — the doc 02/03 pattern (their generic content is already the base; the retail/POS entities inside them are AWPOS examples, replace them with your domain). Decide the entities, actors, and core business flows.
2. **Scaffold the domain module** — `src/modules/<domain-key>/` with the `domain/application/infrastructure/api` structure + `module.ts` + `README.md`. Skill: `awcms-new-module`. A new module starts at `version: "0.1.0"`, `status: "experimental"` (ADR-0008) — it moves to `active`/`1.0.0` once mature (see §Definition of "mature" below). **Register the module in your own derived repo's `src/modules/application-registry.ts`** (Issue #740, ADR-0014) — not the base `src/modules/index.ts`, which a derived repo still never edits.
3. **PostgreSQL migration + RLS** — a tenant-scoped table **must** have `tenant_id`, `ENABLE`+`FORCE ROW LEVEL SECURITY`, an `app.current_tenant_id` policy, and indexes prefixed with `(tenant_id, …)`. Skill: `awcms-new-migration`.
4. **Seed the domain RBAC/ABAC** — new permissions/roles/policies follow the doc 17 pattern (not a copy of its illustrative content); the existing ABAC evaluator (`evaluateAccess`, default-deny) is reused, not rewritten. Skill: `awcms-abac-guard`.
5. **REST endpoints + OpenAPI, domain events + AsyncAPI** — thin routes (auth → tenant context → ABAC guard → validation → idempotency when high-risk → service+transaction → the standard response helper). Skill: `awcms-new-endpoint` (REST), `awcms-new-event` (domain events). High-risk mutations must take an `Idempotency-Key` — skill `awcms-idempotency`. **The OpenAPI contract is split per module** (Issue #182, ADR-0026): your domain module OWNS its own fragment `openapi/modules/<domain>.openapi.yaml` and points at it via `ModuleDescriptor.api.openApiPath` — do not add paths/schemas to a base module's fragment, and do not edit `openapi/awcms-public-api.openapi.yaml` (GENERATED). Derived fragments are merged through the `buildBundledDocument({ extraFragmentFiles })` seam and are rejected if they overwrite a base path/schema. Full guide: [`api-contribution-guide.md`](api-contribution-guide.md).
6. **UI/admin screens** — design tokens, the 4-state pattern (loading/empty/error/ready), WCAG 2.1 AA a11y, strings from the `.po` catalogue (not hardcoded). Skill: `awcms-ui-screen` (new screens), `awcms-i18n` (translation catalogue), `awcms-ux-review` (auditing a finished screen). For long/staged input (identity → detail → attachments → review) — skill `awcms-wizard-form` (the reusable wizard pattern, Issue #479).
7. **Audit & observability** — domain high-risk actions (approve, price change, transaction posted/cancel, etc.) must call `recordAuditEvent`. Skill: `awcms-audit-log` (what is audited), `awcms-observability` (automatic correlation ID, retention/purge, extension points when a derived application needs to forward to an external SIEM).
8. **Layered tests + security review** — unit (pure domain logic), integration (endpoints against a real Postgres), contract (`api:spec:check`), security (ABAC default-deny, RLS FORCE, redaction). Skill: `awcms-testing`, `awcms-security-review` (the per-module DoD checklist), `awcms-security-hardening` (an OWASP/ASVS/ISO audit ahead of an external audit/major go-live).
9. **Deployment & go-live** — `bun run production:preflight` (orchestrating migrate → api:spec:check → modules:compose:check → extension:check → test → build → db:pool:health → security:readiness; `extension:check` validates your extension seam/composition, Issue #178/ADR-0025; full compatibility manifest validation is planned as Issue #183/ADR-0015). Skill: `awcms-production-preflight`. Choose & run a deployment profile (doc `deployment-profiles.md`): LAN-first (`docker-compose.yml`) or registry-based (`Dockerfile.production`, Issue #454; the Coolify guide is in [`deploy-coolify.md`](deploy-coolify.md), Issue #462) — skill `awcms-deploy`.

Orchestrating one full unit of work (read docs → implement → migration/OpenAPI/AsyncAPI/tests/docs → report): skill `awcms-implement-issue`.

### When a module counts as "mature" (`active`, ADR-0008)

A module moves from `experimental` to `active` when: its endpoints/domain logic are genuinely used (not an empty scaffold), RLS+ABAC are in place and tested, the layered tests pass, and it has been through `awcms-security-review`. Do not mark it `active` before that — this status is descriptive metadata that other contributors read to judge a module's maturity, not a runtime gate.

## Derived application examples (illustrative — not part of the base)

The five examples below show how the same base serves very different domains. **Not one** of the modules/entities below exists in this base's `src/modules/` — they are purely illustrative, to help you map your own domain onto the patterns above.

| Application                                   | Domain                                                  | Illustrative domain modules (not part of the base)      | Example tenant-scoped entities                            |
| --------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------- |
| **AWPOS** (retail/POS)                        | Retail sales, warehousing, tax, CRM                     | `sales`, `inventory`, `tax-coretax`, `crm`              | Products, transactions, stock, customers                  |
| **Satu Sehat Kobar** (internal health)        | Internal health data integration per facility           | `health-records`, `satu-sehat-sync`                     | Visit records, health facilities, staff                   |
| **Health Facility Quality Management System** | Quality audits, incidents, accreditation                | `quality-audit`, `incident-report`, `accreditation`     | Audit findings, safety incidents, accreditation documents |
| **Smart School Portal**                       | Academics, attendance, grades, parent communication     | `academic`, `attendance`, `grading`, `parent-portal`    | Students, classes, timetables, grades                     |
| **Public Complaints System**                  | Citizen complaints, disposition, cross-agency follow-up | `complaint-intake`, `disposition`, `follow-up-tracking` | Complaints, receiving units, follow-up status             |

Every application above **still** uses the same base identity/login, RBAC/ABAC, RLS, audit trail, i18n, and admin shell — the domain modules above only add the entities + endpoints + screens specific to their domain, following the 9 steps above.

## ERP extension (a separate layer from an ordinary Derived Application — Issue #755, ADR-0020)

If your derived application is/uses an ERP (accounting, inventory,
sales/purchase orders, payroll, tax) — not just an "ordinary domain
application" like the five examples above — first read
[`erp-extension-contracts.md`](erp-extension-contracts.md) and
`docs/adr/0020-erp-extension-readiness-contracts.md` before writing
any code. This base **never** provides a chart of accounts/
journals/ledgers/inventory valuation/AR-AP/payroll/tax — the base only
provides **neutral contracts** (business transaction references, the
posting request/result envelope, period locks, item/currency/UoM,
inventory movement, reconciliation) that your ERP extension implements/
consumes in YOUR own repository, following the same build-time
composition pattern (§Flow above): the base registry is still not
edited, your ERP extension only fills in its own
`src/modules/application-registry.ts`.

`tests/fixtures/derived-application-example/modules/
example-erp-extension/` is a real example you can run
(`bun test tests/unit/erp-extension-contracts.test.ts`) — a module
descriptor that optionally consumes the `party_directory`/
`organization_hierarchy_resolution` capabilities, an
idempotent+fail-closed-period-lock posting engine, and one `reporting`
projection contribution — all without a single line of real accounting logic.

## Providing a business-scope hierarchy resolver (Issue #180, ADR-0030)

The base provides a **generic business-scope** authorization layer (`identity_access`) but does **not** own a real organizational hierarchy. `scope_type`/`scope_id` are generic references; their validity and ancestry are resolved through the `BusinessScopeHierarchyPort` capability port (`src/modules/_shared/ports/business-scope-hierarchy-port.ts`). The base ships a **no-op** resolver that returns `resolved: false` for every scope type — so **until your derived application provides a resolver, business-scope assignment is always rejected with `scope_unresolved` and scope-gated high-risk actions are always denied** (fail-closed by design).

A derived application that has a real organizational hierarchy (legal entity, branch, cost center, project, etc.) provides it like this:

1. **Declare the capability** in your organization module's descriptor: `capabilities: { provides: ["business_scope_hierarchy"] }`. `identity_access` already consumes it (`optional: true`) — build-time composition (`bun run modules:compose:check`) validates it without you editing the base registry.
2. **Implement `BusinessScopeHierarchyPort`** — an adapter that, inside an already tenant-scoped `tx` (`withTenant`), reads your module's hierarchy table and returns `{ resolved, ancestorScopes, descendantScopes }`. The contract's hard obligations:
   - **Tenant isolation** — a scope belonging to another tenant MUST be `resolved: false` (never leak cross-tenant ancestry).
   - **Node/depth bounds + cycle detection** — the resolver MUST be bounded; a cyclic/very deep graph returns a bounded result, it does not hang. See the dummy resolver `tests/fixtures/derived-application-example/modules/example-crm/business-scope-hierarchy-adapter.ts` for the `visited`-set + `DUMMY_HIERARCHY_MAX_DEPTH` pattern.
   - **`resolved: false` ≠ "no ancestors"** — return `resolved: false` for an unknown scope type / missing id / cross-tenant scope; do not conflate it with a valid scope that simply has no ancestors.
   - **Heterogeneous ancestry** — ancestor/descendant entries are `{ scopeType, scopeId }`, and may cross types (e.g. `unit(branch) → unit(region) → legal_entity`).
3. **Inject at the composition root** — only route handlers / job scripts (the composition root, ADR-0011) import your adapter; never import it from `identity_access`'s `application`/`domain`. The base route builds the default no-op port; a derived application injects its own adapter (e.g. by forking the business-scope route, or by calling `createBusinessScopeAssignment(tx, …, { hierarchyPort })` from its own domain route).

The coverage relations `evaluateAccess` enforces: **exact** (the subject holds exactly that scope), **descendant** (the subject holds its ancestor), **ancestor** (the subject holds its descendant), **tenant-wide** (`scopeType === "tenant"`). High-risk actions on a `resolved: false` scope are always denied. See `tests/fixtures/derived-application-example/` for a runnable example.

## Practical security & compliance checklist

A new domain module must satisfy these before it counts as production-ready (derived from doc 10/12/13, skill `awcms-security-review`):

- [ ] **Tenant context** — every tenant-scoped query goes through `withTenant()`/`SET LOCAL app.current_tenant_id`; no hand-written `WHERE tenant_id` taken from input.
- [ ] **ABAC default-deny** — non-public endpoints are checked with `evaluateAccess()`; new permissions are seeded explicitly, with no implicit grants.
- [ ] **RLS** — new tenant-scoped tables have `ENABLE`+`FORCE ROW LEVEL SECURITY` + an isolation policy; indexes prefixed with `(tenant_id, …)`.
- [ ] **Audit** — domain high-risk actions (soft delete/restore/purge, approval, price/critical status changes, etc.) produce an `awcms_audit_events` row via `recordAuditEvent`.
- [ ] **Idempotency** — domain high-risk mutations accept an `Idempotency-Key` and are safe to retry.
- [ ] **Redaction/masking** — sensitive domain identifiers (NIK, medical record number, etc. — the same pattern as NPWP/NIK/email in the base) are hashed+masked before being stored/displayed/logged.
- [ ] **Contracts in sync** — `bun run api:spec:check` green for every new domain endpoint/event.
- [ ] **Layered tests** — unit (domain logic), integration (a real Postgres), security (RLS/ABAC forced to fail to prove the gate really blocks, not just silently "passes").
- [ ] **`bun run production:preflight`** green before go-live.

### Derived application CI responsibilities (composition & API contracts)

Composition and API contracts are validated at **build/CI** time, not at runtime — a derived application must run them itself:

- [ ] **`bun run modules:compose:check` (and the full `bun run check`)** green in the derived CI. `listModules()` is deliberately pure data (it does not validate at load time, same as the base); skipping this gate can let the app boot with a duplicate-key registry that poisons permission/navigation seeding. Do not rely on the base to catch this.
- [ ] **Declare `migrationNamespace`** on your `ApplicationModuleRegistry` (start at ≥ 900, no overlap with the base's `1..899`). If it is omitted, the `migration_namespace_overlap` check is **skipped** and the derived migration numbering can collide with the base without warning.
- [ ] **The public-operation policy for derived fragments** (`security: []`) is enforced by **the derived repo's own `api:spec:check` with its own allow-list** — the base bundles without derived fragments, so it cannot see them. Every new public operation must go into a reviewed derived allow-list.

## References

- [`examples/minimal-domain-module.md`](examples/minimal-domain-module.md)
  — a concrete example of one minimal domain module (folder structure, descriptor,
  migration+RLS, permission seed, endpoint, OpenAPI/AsyncAPI snippet, and
  the test/security checklist) — Issue #463.
- [`derived-app-pilot-plan.md`](derived-app-pilot-plan.md) — the plan for the
  first derived application pilot (candidate matrix, the AWPOS recommendation,
  module boundaries, initial issue breakdown) — Issue #465.
- [`AGENTS.md`](../../AGENTS.md) §Start here — the contributor entry point.
- [`README.md`](README.md) §Next steps — a summary of the same flow, short version.
- [`docs/adr/0013-extension-layers-and-boundary-model.md`](../adr/0013-extension-layers-and-boundary-model.md)
  — the extension layers (Derived Application/SaaS Control Plane/ERP
  Extension), the tenant vs legal entity vs organization unit boundaries,
  the data-ownership matrix, and the evidence-based criteria for service
  extraction that apply to every derived application.
- [`docs/adr/0014-deterministic-build-time-module-composition.md`](../adr/0014-deterministic-build-time-module-composition.md)
  and [`docs/adr/0025-implement-deterministic-build-time-module-composition.md`](../adr/0025-implement-deterministic-build-time-module-composition.md)
  — how a derived application registers its modules through
  `src/modules/application-registry.ts` without editing the base `src/modules/
index.ts`, the taxonomy of composition failures, and the migration namespace
  convention. ADR-0014 is the design (referencing awcms-mini #740); ADR-0025
  is the addendum for the real implementation in awcms (Issue #178) — the placement engine
  in `module-management/domain/` and the status of the extension seam.
- [`docs/adr/0015-derived-application-compatibility-manifest.md`](../adr/0015-derived-application-compatibility-manifest.md)
  — the `extension.manifest.json` schema, the versioning policy for module-contract/
  capability/manifest-schema, the immutability of historical migration checksums,
  and where `bun run extension:check` actually blocks CI/preflight.
  **PLANNED — Issue #183** (not yet implemented; `extension:check` in
  Issue #178 only validates the extension seam/composition).
- [`erp-extension-contracts.md`](erp-extension-contracts.md) and
  [`docs/adr/0020-erp-extension-readiness-contracts.md`](../adr/0020-erp-extension-readiness-contracts.md)
  — the business transaction/posting/period-lock/item/currency/UoM/
  inventory-movement/reconciliation/report-projection contracts for ERP extensions
  (Issue #755).
- [`extension-compatibility-policy.md`](extension-compatibility-policy.md)
  — the complete compatibility/deprecation/support-window policy for
  all six independent versioning schemes (package, REST, event, module
  contract, capability, manifest schema), including how a breaking capability
  change is communicated and guidance for choosing `compatibleAwcmsRange`.
- [`21_module_admission_governance.md`](21_module_admission_governance.md)
  — the admission decision tree that determines the category of a new
  capability (Core/System/Official Optional Module/Derived Application/External
  Integration) before any code is written.
- [`docs/adr/`](../adr/README.md) — the base architectural decisions (ADR-0001 through 0008).
- `docs/awcms/01` through `20` — the master document set (§Document map in this README).
- [`deployment-profiles.md`](deployment-profiles.md) — the deployment profiles (development/production/offline-LAN — three since `staging` was removed, ADR-0083; LAN-first compose vs registry image).
- `.claude/skills/README.md` — the full skill catalogue + usage map.
