🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](derived-app-pilot-purchase-requisition-plan.id.md)

# Derived Pilot Plan #187 — Purchase Requisition (`awcms-erp-pilot`), Increment 1

> **⚠️ DEPRECATED ([ADR-0034](../adr/0034-awcms-family-direct-use-templates-and-derived-pathway-removal.md)).** The derived-application-in-a-separate-repo model is REVOKED — the AWCMS family (`awcms-mini`/`awcms`/`awcms-micro`) is now a set of **used-directly** templates, with no derivative repo being created (develop modules directly in the template). This document is kept as a historical record.

> **Status: plan (not executed).** This document is the Increment-1
> implementation plan for Issue #187 (the derived application pilot). No code is
> written by this document. It complements (does not replace)
> [`derived-app-pilot-plan.md`](derived-app-pilot-plan.md) — which picks the
> pilot candidate — with a concrete technical plan for the
> purchase-requisition domain that #187 selected. For the **step-by-step
> execution runbook** (verified base signature seams + corrections + concrete
> DDL/descriptors), see
> [`derived-app-pilot-purchase-requisition-execution.md`](derived-app-pilot-purchase-requisition-execution.md).

## Context

Epic #177 (the awcms derived ERP foundation) is complete except for **#187**:
building one real pilot derived application to PROVE the AWCMS extension model
end-to-end (composition seam #178, migration ownership, API/event
contribution #182, RLS, authorization #179/#180/#181, workflow approval,
audit, deployment, upgrade path) — not merely a documentation design. #187
deliberately picks a
**neutral & minimal domain: purchase requisition (an internal procurement
request)** — draft → submit → approve/reject via the AWCMS workflow →
status/audit timeline → a simple reporting projection → domain events. WITHOUT
purchase order, receiving, vendor invoice, accounting posting, tax, inventory,
payment.

The hard rule of #187: **the pilot does NOT add ERP logic to `ahliweb/awcms`**.
The domain lives in a separate derived repo; the base repo only gets separate
generic foundation PRs if they prove necessary. #187 in the base repo is the
acceptance/evidence TRACKER.

## Decisions (confirmed)

1. **Repo**: create `ahliweb/awcms-erp-pilot` on GitHub (outward-facing).
2. **Base consumption**: **VENDOR** — copy the base awcms source tree (v5.1.1)
   into the derived repo, fill `src/modules/application-registry.ts` with the
   domain registry, pin the vendored base version in the family-compatibility
   manifest (#183). Upgrade = re-vendor the next base version. Base files are
   NOT edited (except `application-registry.ts` = the only seam).
3. **Increment 1 scope**: the core vertical slice **+ the full approval
   workflow**: scaffold the repo + the `purchase-requisition` module (header +
   lines, draft CRUD, submit) + migrations numbered **900+** in the derived repo
   (RLS FORCE, draft soft-delete, post-submit immutability) + domain RBAC/ABAC +
   REST + an OpenAPI fragment + workflow-approval integration
   (submit→task→approve/reject, self-approval + SoD + business-scope guard) +
   domain events created/submitted/approved/rejected + audit + idempotency +
   layered tests + 3 composition gates passing + CI. Admin UI (SSR), the
   reporting projector, Docker/Coolify/backup, the upgrade-path doc = the NEXT
   increment (not increment-1).

## The derived-app pattern (from the base docs — authoritative)

- `application-registry.ts`: the derived repo REPLACES `undefined` with
  `ApplicationModuleRegistry { id, modules, migrationNamespace }`. The only base
  file that is edited; `src/modules/index.ts` + every base `module.ts` are NOT
  touched (guardrail ADR-0013 §5/§9).
- The derived migration namespace: **rangeStart 900, rangeEnd 999** (the base
  reserves 1–899, ADR-0014). So the purchase-requisition migrations are numbered
  **900+** (files `900_*.sql` onwards in the `sql/` directory of the **derived
  repo**, not this base repo).
- Domain module: `src/modules/purchase-requisition/` with the
  `domain/application/infrastructure/api` structure + `module.ts` + `README.md`.
- Per-module OpenAPI (#182): its own fragment
  `openapi/modules/purchase-requisition.openapi.yaml`, pointed at by
  `ModuleDescriptor.api.openApiPath`; do NOT edit the base fragment or the
  generated bundle.
- 3 gates that MUST pass: `modules:compose:check`,
  `modules:composition:inventory:check`, `extension:check`.
- Reuse (do not reimplement): `evaluateAccess`/`authorizeInTransaction` (ABAC
  default-deny), the workflow-approval engine, `recordAuditEvent`, the
  domain-event outbox, the idempotency helper, `_shared/api-response.ts`,
  keyset-pagination.
- A real example fixture: `tests/fixtures/derived-application-example/`
  (example-crm; example-erp-extension has not been materialised — it is only
  referenced by the docs) — the pattern to replicate.

## Module scaffolding (concrete)

**Registry** (`src/modules/application-registry.ts`, the only base file that is
edited):

```ts
export const applicationModuleRegistry: ApplicationModuleRegistry = {
  id: "awcms-erp-pilot",
  modules: [purchaseRequisitionModule],
  migrationNamespace: {
    label: "awcms-erp-pilot",
    rangeStart: 900,
    rangeEnd: 999
  }
};
```

**Mandatory `ModuleDescriptor` fields (6)**: key (snake_case, must not collide
with the base → `prohibited_base_override`), name, version ("0.1.0"), status
("experimental"), description, dependencies
(`["tenant_admin","identity_access"]`, plus `"workflow"` and
`"domain_event_runtime"`). **`type` MUST be "domain"** (not base/system →
`invalid_module_type`). Optional fields used: `api {openApiPath, basePath}`,
`permissions [{activityCode, action, description}]`,
`events {asyncApiPath, publishes}`, `sodRules`, `navigation` (a globally unique
path), `jobs` (command `^bun run …`).

**SoD rule** (the example-crm fixture already has a `requisition` maker/checker
— a directly applicable pattern):
`ruleKey purchase_requisition.requester_approver_separation`,
`ownerModuleKey` = key, `conflictingPermissionKeys ≥2`
(`…requisition.create` vs `…requisition.approve`),
`scopeApplicability same_scope_only`, `severity high`,
`exceptionPolicy {allowed, requiresApprovalPermission:
identity_access.business_scope_exceptions.approve, maxDurationDays}`.

**Layout**: `src/modules/purchase-requisition/{domain,application,infrastructure}/`
plus `module.ts` and `README.md`. **The HTTP routes live in
`src/pages/api/v1/purchase-requisitions/*.ts`** (Astro, NOT in the module
folder). `defineModule()` = an identity fn for type inference.

**Migrations** (in the `sql/` of the **derived repo**): the file
`900_awcms_purchase_requisition_schema.sql` onwards — name pattern
`^\d{3}_awcms_[a-z0-9_]+\.sql$`, number ≥900. The runner `scripts/db-migrate.ts`
enumerates every `sql/*.sql` (the numbering is convention only); checksums are
immutable. The composition gate ONLY checks the declarative `migrationNamespace`
range against 1–899 (not the filesystem) → the declaration MUST be 900–999.

**OpenAPI**: its own fragment `openapi/modules/purchase-requisition.openapi.yaml`
(only `paths` + `components.schemas`; redefining a base path/schema →
`BundleConflictError`). Bundle with `bun run openapi:bundle` + `api:spec:check`.

**3 gates** (part of `bun run check`, pure, no I/O): `modules:compose:check` (the
rule engine: duplicate_key/prohibited_base_override/invalid_type/capability/
namespace_overlap/nav_conflict/job), `modules:composition:inventory:check`
(regenerate `docs/awcms/module-composition-inventory.json` via
`modules:composition:inventory:generate` then commit), `extension:check` (derived
mode: non-empty id + modules ≥1 + validity).

**Ready-to-use template**: `docs/awcms/examples/minimal-domain-module.md` (layout,
migration+RLS, route, OpenAPI/AsyncAPI snippets, checklist) + the fixture
`tests/fixtures/derived-application-example/`.

## Base seams that are REUSED (not reimplemented)

The canonical reference route: `src/pages/api/v1/workflows/tasks/[id]/decisions.ts`
(auth + idempotency + decision + audit + event in a single handler).

**The high-risk mutation route chain**: `resolveAuthInputs` → guard
400/401/IDEMPOTENCY_REQUIRED → `readJsonBody` → domain validation →
`withTenant(sql, tenantId, fn, {workClass:"interactive"})` →
`authorizeInTransaction(tx, tenantId, tokenHash, now, guard, {hierarchyPort?})` →
idempotency replay check → domain work → `recordAuditEvent` → `appendDomainEvent`
→ `ok(data, {correlationId})` → `saveIdempotencyRecord`.

| Concern                                 | Reuse                                                                                                                                                     | File                                                    |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Auth resolve                            | `resolveAuthInputs`                                                                                                                                       | identity-access/application/access-guard.ts             |
| Guard chokepoint                        | `authorizeInTransaction` → `{allowed,context,grantedPermissionKeys}`                                                                                      | access-guard.ts                                         |
| Tenant tx (RLS+pool+breaker)            | `withTenant(...,{workClass})`                                                                                                                             | lib/database/tenant-context.ts                          |
| ABAC (default-deny, self-approval, SoD) | `evaluateAccess`/`isHighRiskAction`                                                                                                                       | identity-access/domain/access-control.ts                |
| Workflow start (on submit)              | `startWorkflowInstance(tx,{workflowKey,resourceType:"purchase_requisition",resourceId,requestedByTenantUserId,...})`                                      | workflow-approval/application/workflow-instance.ts      |
| Workflow decision                       | `recordWorkflowTaskDecision` / `fetchTaskWithInstanceForDecision` / `findEligibleAssignment`                                                              | workflow-instance-decision.ts                           |
| Audit                                   | `recordAuditEvent(tx,{...})` (auto-redaction)                                                                                                             | logging/application/audit-log.ts                        |
| Domain event outbox                     | `appendDomainEvent(tx,tenantId,{eventType,eventVersion,aggregateType,aggregateId,producerModule,payload})` + registry                                     | domain-event-runtime/application/append-domain-event.ts |
| Idempotency                             | `computeRequestHash`/`findIdempotencyRecord`/`saveIdempotencyRecord` (the shared `awcms_idempotency_keys` table)                                          | \_shared/idempotency.ts                                 |
| Response                                | `ok`/`created`/`fail`                                                                                                                                     | \_shared/api-response.ts                                |
| Keyset pagination                       | `KEYSET_CURSOR_CREATED_AT_SQL`/`encode/decodeKeysetCursor` (NOT from a JS Date)                                                                           | \_shared/keyset-pagination.ts                           |
| Reporting projection                    | `ProjectionDescriptor` in module.ts (strategy **cursor_table** = a background projector WITHOUT network I/O, `runCursorStreamPass` workClass maintenance) | reporting/domain/projection-registry.ts                 |

**Key design decision**: PR approve/reject uses **its own PR-specific endpoint**
(`POST /purchase-requisitions/{id}/approve|reject`, guard
`purchase_requisition.requisition.approve` via `authorizeInTransaction`) which,
inside one transaction, does: `recordWorkflowTaskDecision` + the PR status
transition + audit + event. The reason: the generic workflow endpoint guards the
_workflow_ permission, so the SoD rule `requisition.create` vs
`requisition.approve` will NOT fire there. A PR-owned endpoint makes SoD +
self-approval (via `requestedByTenantUserId` looked up before the guard) actually
bite.

**Port injection (at the composition root = the route file, ADR-0011)**:

- `BusinessScopeHierarchyPort` (#180): the base default is `resolved:false` →
  fail-closed deny. Scoped approval MUST inject a real resolver in the PR route,
  otherwise it always denies. Injection example:
  `identity/business-scope/assignments/index.ts`.
- The PR `sodRules` flow AUTOMATICALLY through
  `collectSoDRuleDescriptors(listModules())` → `high-risk-sod-guard.ts` (no
  per-route wiring needed).
- `WorkflowNotificationPort`: the base wires NONE → the `notify` node is a no-op
  (email has not been ported) — OK for increment-1 (approvers go through the
  inbox task, not email).
- Domain events: register in `DOMAIN_EVENT_TYPE_REGISTRY` + `events.publishes` in
  module.ts + the asyncapi channel + the parity test
  (`domain-event-registry-parity.test.ts`). A `domain_event`-strategy consumer
  requires a static edit to the consumer-registry → so the PR projection uses
  **cursor_table** to keep the module self-contained.

## Deploy / compat / CI / env (important reality-check)

**Reality-checks that change the plan:**

- **The `extension.manifest.json` gate (ADR-0015) is NOT implemented yet** in the
  base. `extension:check` ONLY validates the composition seam. The files
  `_shared/extension-manifest-contract.ts` + `extension-compatibility.ts` DO NOT
  EXIST (only `src/lib/semver/compare.ts` exists). → Pinning the base version =
  writing `extension.manifest.json` (`compatibleAwcmsRange` to base v5.1.1) as a
  DOCUMENT + a manual review; do NOT rely on a gate (there is none until #183
  downstream).
- **`production:preflight` has NO script** (the docs reference it, package.json
  has nothing). Run the underlying commands one by one.
- **`AUTH_JWT_SECRET` is NOT used** by the base (the docs are wrong). The only
  REQUIRED env vars are `APP_ENV`, `APP_URL`, `DATABASE_URL` (validator
  `scripts/validate-env.ts`). The base uses a session cookie +
  `AUTH_IP_HASH_SECRET`.
- **The base's deploy artifacts are minimal**: only `Dockerfile.production` +
  `.dockerignore` + `.env.example` + `deploy/pgbouncer/`.
  docker-compose/systemd/nginx/backup/create-app-role = DO NOT EXIST YET (the
  pilot must write them) → but that is the **NEXT increment**, not increment-1.

**Family-compatibility manifest**: `awcms-family-compatibility.yaml` +
`.schema.json` + `_shared/family-contract.ts` = the BASE→standard manifest (the
base declares conformance to mini), vendored along as-is;
`family:conformance:check` still runs in the derived CI (passing as long as the
base is unchanged). This is DIFFERENT from `extension.manifest.json`
(derived→base, no gate yet).

**Derived CI** = `bun run check` (chain: lint → check:docs → api:spec/docs →
modules:dag → **compose → inventory → extension** → reporting/sod registry →
**family:conformance** → logging:lint → typecheck → test → build) + carry-over
jobs: `integration-tests` (RLS+role-sep on postgres:18.4, TWO separate suites
that must not collide in a single `bun test`), `e2e-smoke` (Playwright),
`minimum-supported` (Bun 1.3.0), `hygiene`, `codeql`. `security:readiness` = a
go-live command (needs a migrated DB), NOT part of `bun run check`.

## Increment-1 boundary (what is DONE vs DEFERRED)

**Increment-1 (THIS):** scaffold the derived repo (vendor the base) + the
`purchase_requisition` module vertical slice (header+lines, draft CRUD, submit) +
**the full approval workflow** (submit→instance→task→approve/reject via the
PR-specific endpoint, self-approval + SoD + business-scope guard) + domain events
created/submitted/approved/rejected + audit + idempotency + REST + an OpenAPI
fragment + an AsyncAPI channel + layered tests + the 3 composition gates + `bun run check`

- CI (`bun run check` + integration-tests + hygiene + codeql).
  `extension.manifest.json` as a document. Migrations numbered 900+ in the `sql/`
  of the derived repo.

**DEFERRED to the next increment:** the SSR admin UI (list/search/create/submit/
task-approval/timeline/reporting), the cursor_table reporting projector + refresh
job, docker-compose LAN/prod + backup/restore + systemd/nginx + a Coolify guide +
create-app-role, the upgrade-path doc, PR-specific e2e-smoke Playwright, `active`
maturity promotion.

## Increment-1 execution plan

### Phase A — Derived repo (vendor)

1. Create the GitHub repo **`ahliweb/awcms-erp-pilot`** (private) + a local
   checkout (e.g. `/home/data/dev_bun/awcms-erp-pilot`).
2. Vendor base awcms v5.1.1: copy the tree (a clean git snapshot, without the
   base `.git`), init a new git, `bun install`. Rename the `package.json` name →
   `awcms-erp-pilot` (version 0.1.0). Keep every gate/skill/CI/docker.
3. Baseline `bun run check` GREEN (the registry is still `undefined` = pure base).
4. Write `extension.manifest.json` (compatibleAwcmsRange base v5.1.1, doc).
   Adjust `.github/workflows/*` for the derived repo (image name, etc.).

### Phase B — The purchase_requisition module

5. Migration (in the `sql/` of the derived repo)
   `900_awcms_purchase_requisition_schema.sql`:
   `awcms_pr_requisitions` (header: id, tenant_id, code, title,
   requester_tenant_user_id, business_scope ref, status enum
   draft/submitted/approved/rejected/cancelled, version int, workflow_instance
   ref, submitted metadata, timestamps, deleted_at draft-only) +
   `awcms_pr_requisition_lines` (id, tenant_id, requisition_id, composite FK
   `(tenant_id, requisition_id)`, item desc, qty, uom, est_unit_cost, line_no).
   RLS ENABLE+FORCE + an `app.current_tenant_id` policy, index `(tenant_id, …)`,
   GRANT `awcms_app`. Post-submit immutability (trigger/CHECK + an application
   guard: only drafts are mutable).
   `901_awcms_seed_purchase_requisition_permissions.sql`: seed
   `purchase_requisition.requisition.{read,create,update,submit,approve,reject}`
   into `awcms_permissions`.
6. `src/modules/purchase-requisition/{domain,application,infrastructure}/` +
   `module.ts` (defineModule: type domain, api, permissions, events.publishes,
   **sodRules requester≠approver**) + README. `domain/` = a pure state machine.
7. Fill `src/modules/application-registry.ts` (id `awcms-erp-pilot`, modules
   `[purchaseRequisitionModule]`, migrationNamespace 900–999). Regenerate with
   `modules:composition:inventory:generate`.
8. Routes `src/pages/api/v1/purchase-requisitions/*.ts` (modelled on
   `workflows/tasks/[id]/decisions.ts`): create draft, PATCH draft (lines),
   submit (→ `startWorkflowInstance`), approve/reject (PR-specific: guard
   `requisition.approve`, look up `requestedByTenantUserId` before the guard,
   `recordWorkflowTaskDecision` + status transition + audit + event, idempotent),
   list (keyset), detail/timeline. Inject `BusinessScopeHierarchyPort` in the
   route.
9. The OpenAPI fragment `openapi/modules/purchase-requisition.openapi.yaml` (+ its
   own public-op allow-list). Domain events: register in
   `DOMAIN_EVENT_TYPE_REGISTRY` + `events.publishes` + the channel in
   `asyncapi/awcms-domain-events.asyncapi.yaml` (parity test). Bundle +
   `api:spec:check`.

### Phase C — Tests + gates + CI + PR + review + merge

10. Unit (the state machine draft→submitted→approved/rejected; immutability;
    self-approval logic). Integration (a real DB + a non-superuser role: draft →
    submit → approve changes the status; the requester CANNOT approve their own;
    RLS FORCE fail-closed across tenants; post-submit immutability; SoD
    requester/approver rejected/exception; idempotent replay; keyset precision).
    Contract `api:spec:check`.
11. The full `bun run check` GREEN + the 3 composition gates + the regenerated
    inventory committed. Derived CI green (integration-tests postgres:18.4 +
    hygiene + codeql).
12. Changeset. Commit, push, PR in `ahliweb/awcms-erp-pilot`. Reviewer +
    security-auditor subagent (adversarial), address the findings, merge.
13. Update tracker #187 (base) with a link to the derived PR evidence; do NOT
    close it (increment-1 ≠ all of #187 — UI/deploy/upgrade follow). Update memory
    (a new `awcms-derived-pilot-notes.md`) + the skill if needed.

## Verification (increment-1)

- The full `bun run check` green in the derived repo.
- DB-gated integration: create a draft → submit → approve changes the status; the
  requester CANNOT approve their own (self-approval rejected); RLS FORCE
  fail-closed across tenants under a non-superuser role; post-submit immutability
  enforced.
- The 3 composition gates + CI green; evidence of the extension model (no base
  registry edited other than `application-registry.ts`).
