🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](derived-app-pilot-purchase-requisition-execution.id.md)

# Increment-1 Execution Runbook — Derived Pilot #187 (`awcms-erp-pilot`, Purchase Requisition)

> **⚠️ DEPRECATED ([ADR-0034](../adr/0034-awcms-family-direct-use-templates-and-derived-pathway-removal.md)).** The derived-application-in-a-separate-repo model is REVOKED — the AWCMS family (`awcms-mini`/`awcms`/`awcms-micro`) is now a set of **used-directly** templates, with no derivative repo created (develop modules directly in the template). This document is kept as a historical record.

> **Status: detailed execution plan (not yet executed).** This document does NOT
> write code. It is a step-by-step runbook for work that is **deliberately NOT
> done in the base repo `ahliweb/awcms`** — the pilot domain implementation lives
> in the separate derived repo `ahliweb/awcms-erp-pilot` (hard rule
> #187: the pilot does not add ERP logic to the base repo). It complements (does not
> replace) [`derived-app-pilot-purchase-requisition-plan.md`](derived-app-pilot-purchase-requisition-plan.md)
> (the top-level plan) and [`derived-app-pilot-plan.md`](derived-app-pilot-plan.md)
> (candidate selection) with **base seam signatures verified against the
> code** + corrections to the plan's assumptions + concrete DDL/descriptors.
>
> Every file path & signature below is quoted from this repo's base code
> (`ahliweb/awcms`), which will be **vendored as-is** into the derived repo; line
> numbers may shift between releases — treat them as a map, verify again
> when executing.

## 0. Why this document exists (the "not done in this repo" scope)

Epic #177 (derived ERP foundation) is complete except for #187: building one real
derived pilot application to PROVE the extension model end-to-end. #187 in the
base repo = **an acceptance/evidence tracker only**. The real implementation (domain module +
900+ migrations + routes + tests) must not land in `ahliweb/awcms`. That is why
"Increment-1 work" is not executed in this repo — what lands in this repo
is **the plan + this runbook** as a planning artifact that can be executed
at any time in the derived repo (by a later session or by the derived team).

The base repo deliverable = two documents (`*-plan.md` + this runbook) + a tracker update
on #187 once the derived repo has green-PR evidence.

## 1. Map of the base seams being REUSED — verified signatures

Everything below is **reused as-is** from the vendored base; do NOT
reimplement. The route composition root (the route file) that injects the ports
(ADR-0011) is the only place wiring happens.

### 1.1 Auth & guard (identity-access)

| Seam             | Signature (verified)                                                                                                                                                   | File                                         |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Guard chokepoint | `authorizeInTransaction(tx, tenantId, tokenHash, now, guard, options?)` → `{allowed, context, grantedPermissionKeys}`; `options` carries `hierarchyPort?`, `sodRules?` | identity-access/application/access-guard.ts  |
| ABAC evaluator   | `evaluateAccess(context, request, grantedPermissionKeys, businessScopeFacts?, abac?)` → `AccessDecision`                                                               | identity-access/domain/access-control.ts:253 |
| High-risk check  | `isHighRiskAction(action: AccessAction): boolean`                                                                                                                      | access-control.ts:177                        |

- **`evaluateAccess`'s 4th parameter = `businessScopeFacts`, NOT `sodRules`** (a correction
  to the plan). SoD is not a parameter of this domain function; SoD enforcement is
  additive at the application chokepoint via `options.sodRules` in
  `authorizeInTransaction` (which calls `checkHighRiskSoDConflicts` after the
  RBAC/ABAC decision).
- Internal guard order inside `evaluateAccess`: tenant_isolation → self_approval_deny
  (action `approve`/`force_decide` + `requestedByTenantUserId`) → business_scope
  (opt-in `requiredScopeType`/`requiredScopeId`) → ABAC deny → RBAC default_deny
  (`permissionKey`) → ABAC allow-constraint.
- `AccessRequest` = `{moduleKey, activityCode, action, resourceType?, resourceId?,
resourceAttributes?}`. The `resourceAttributes` the guard recognises: `tenantId`,
  `requestedByTenantUserId`, `requiredScopeType`, `requiredScopeId`,
  `requiredScopeRelations`.

### 1.2 Tenant transaction

`withTenant(sql, tenantId, fn, {workClass})` — sets `app.current_tenant_id`, pool,
circuit-breaker, and is the **central catcher** for `IdempotencyRaceLostError` (→ replay
or 409 IDEMPOTENCY_CONFLICT). Valid `WorkClass` values: `critical_transaction`,
`interactive` (the default, used by high-risk mutation routes), `reporting`,
`background_sync`, `maintenance`. All interactive PR mutations =
`{workClass: "interactive"}`.

### 1.3 Workflow-approval (reused for approval)

| Seam                | Signature                                                                                                                                                                                                                                  | File                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| Start instance      | `startWorkflowInstance(tx, {tenantId, workflowKey, resourceType, resourceId, requestedByTenantUserId, facts?, now?, correlationId?, ...notifDeps})` → `{instanceId, workflowDefinitionId, workflowDefinitionVersion, finished, status}`    | workflow-approval/application/workflow-instance.ts:82 |
| Fetch task+lock     | `fetchTaskWithInstanceForDecision(tx, tenantId, taskId)` → `TaskWithInstanceRow \| undefined` (`FOR UPDATE OF t`)                                                                                                                          | workflow-instance-decision.ts:116                     |
| Eligible assignment | `findEligibleAssignment(tx, tenantId, taskId, decidingTenantUserId, workflowKey, resourceType, now)` → `AssignmentRow \| null` (`null` = not a decider)                                                                                    | workflow-instance-decision.ts:144                     |
| Record decision     | `recordWorkflowTaskDecision(tx, {tenantId, taskId, task, assignment, decidingTenantUserId, decision: "approve"\|"reject", reason?, now, correlationId?, ...notifDeps})` → `{instanceId, taskCompleted, instanceFinished, instanceStatus?}` | workflow-instance-decision.ts:216                     |

- `startWorkflowInstance` pins the active definition version (`lifecycle_status='active'`)
  onto the instance. It throws `WorkflowDefinitionNotActiveError` /
  `InvalidWorkflowFactsError`.
- `recordWorkflowTaskDecision` assumes the caller **has already** checked
  `task.status === 'pending'` + ABAC; it does an append-only INSERT into
  `awcms_workflow_decisions`, computes the quorum `COUNT(DISTINCT tenant_user_id)`, and
  only calls `completeApprovalTaskAndAdvance` once the task is complete.
- **Optional notification port**: `WorkflowNotificationPort.enqueueNotification(tx,
request)`. The `notify` node in the graph engine silently skips when the port is not
  injected (default no-op). For increment-1 (email not ported yet) do NOT
  inject it → approvers work through the task inbox, not email. That is fine within the
  increment-1 boundary.

### 1.4 Domain event, audit, idempotency, response, pagination

| Seam               | Signature                                                                                                                                                                                                                                                             | File / table                                               |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Append event       | `appendDomainEvent(tx, tenantId, {eventType, eventVersion, aggregateType, aggregateId, aggregateVersion?, producerModule, payload, correlationId?, causationId?, actorTenantUserId?, occurredAt?})` → `{eventId, eventSequence, deliveriesCreated, skippedConsumers}` | domain-event-runtime/application/append-domain-event.ts:64 |
| Audit              | `recordAuditEvent(tx, {tenantId, moduleKey, action, resourceType, message, actorTenantUserId?, resourceId?, severity?, attributes?, correlationId?})` → `void` (auto-redacts `attributes`)                                                                            | logging/application/audit-log.ts:36                        |
| Idempotency hash   | `computeRequestHash(payload): string` (SHA-256, keys deep-sorted)                                                                                                                                                                                                     | \_shared/idempotency.ts:37                                 |
| Idempotency lookup | `findIdempotencyRecord(tx, tenantId, requestScope, idempotencyKey)` → `IdempotencyRecord \| null`                                                                                                                                                                     | \_shared/idempotency.ts:92                                 |
| Idempotency save   | `saveIdempotencyRecord(tx, tenantId, requestScope, idempotencyKey, requestHash, responseStatus, responseBody)` → `void` (INSERT ON CONFLICT DO NOTHING; race → `IdempotencyRaceLostError`)                                                                            | table `awcms_idempotency_keys`                             |
| Response           | `ok(data, meta?)` 200 / `created(data, meta?)` 201 / `fail(status, code, message, meta?, details?, headers?)`; `meta = {correlationId?, requestId?}`                                                                                                                  | \_shared/api-response.ts                                   |
| Keyset SQL         | the constant `KEYSET_CURSOR_CREATED_AT_SQL` (SELECT `to_char(... 'US' ...)` aliased `created_at_cursor`)                                                                                                                                                              | \_shared/keyset-pagination.ts:58                           |
| Keyset codec       | `encodeKeysetCursor(createdAtCursor, id)` / `decodeKeysetCursor(cursor)` → `KeysetCursor \| null`                                                                                                                                                                     | keyset-pagination.ts:69/102                                |

- **`eventVersion` is a string** (`"1.0"`); `producerModule` is always explicit.
- Every `(eventType, eventVersion)` MUST be registered in
  `DOMAIN_EVENT_TYPE_REGISTRY` (otherwise `UnregisteredDomainEventTypeError`).
- **Keyset precision (pitfall #158)**: the `createdAt` cursor is **microsecond TEXT**,
  not a JS `Date`. `timestamptz` = microseconds; `Date` is only milliseconds → a cursor
  built from a `Date` skips rows within the same millisecond. The WHERE binds
  `${cursor.createdAt}::timestamptz`. Carry `created_at_cursor` in the SELECT, do not
  reconstruct it from a `Date`.

## 2. Reality-check & corrections to the plan (MUST read before executing)

Findings that change the top-level plan — the result of verifying against the code:

1. **`submit` is NOT a valid `AccessAction`.** The `AccessAction` union
   (access-control.ts:27) does not contain `submit`. A plan that seeds the permission
   `purchase_requisition.requisition.submit` would produce an action that never
   passes the guard (silent default-deny). **Resolution (pick one, record it in
   the derived ADR):**
   - **(Recommended) a generic foundation PR to the base**: add `submit` to the
     `AccessAction` union as a **non-high-risk** action (submit is a generic action of
     every approvable document; this union is meant to grow per feature — workflow,
     reporting, MFA, SoD). #187 allows "a separate generic foundation PR when it is
     demonstrably needed". This is real evidence of a foundation gap surfaced by the pilot.
     Small, reusable, contains no ERP logic.
   - **(Interim, without touching the base)** guard the submit endpoint with a valid
     action on a different permission: activityCode `requisition_submission` + action
     `create` → permission `purchase_requisition.requisition_submission.create`
     (semantics: "creating a submission"; non-high-risk; distinct from
     `requisition.update` for editing a draft).
2. **Workflow domain events are emitted inside the application layer, not in the route.**
   `startWorkflowInstance`/`recordWorkflowTaskDecision` already call `appendDomainEvent`
   for the **workflow** events (`awcms.workflow.instance.*`). The **PR domain** events
   (`created/submitted/approved/rejected`) are SEPARATE events owned by the pilot
   module — appended by the pilot module's own code inside the route transaction,
   with `producerModule: "purchase_requisition"` and its own channel/registry.
   Do not expect the workflow layer to emit them.
3. **`reject` is non-high-risk** (access-control.ts:64). `isHighRiskAction("reject")`
   = false → the **action-time** SoD gate (which only fires on high-risk actions) does NOT
   run on reject. That is deliberate & safe (rejecting = the conflict stays rejected).
   The requester≠approver SoD is still bitten by (a) the **assignment-time** gate
   (you cannot hold create+approve permissions in the same scope) and (b) the
   action-time gate on `approve` (which is high-risk). Reject does not need action-time SoD.
4. **`awcms_app` does NOT need an explicit per-table GRANT.**
   `sql/019_awcms_db_role_separation.sql` already does `GRANT ... ON ALL TABLES` +
   `ALTER DEFAULT PRIVILEGES ... GRANT ... ON TABLES TO awcms_app`. A new-table migration
   only needs an explicit GRANT to `awcms_worker` **if there is a job** (e.g. a
   projector). Increment-1 defers the projector → **no worker GRANT is needed at all**.
5. **`awcms_permissions` is a GLOBAL catalogue** (`sql/005`): no `tenant_id`, no
   RLS, unique on `(module_key, activity_code, action)`. Seeding via migration
   (`ON CONFLICT DO NOTHING`) is MANDATORY — the `module.ts` descriptor is only synced lazily,
   so without the seed migration the bootstrap owner role is default-denied until the next
   sync (the `sql/028` pattern).
6. **`migrationNamespace` is purely declarative.** The composition gate compares the range
   `{rangeStart, rangeEnd}` against the base constant `{1, 899}` — it **does not read
   `sql/*.sql`**. What MUST be correct is the `900–999` declaration in
   `application-registry.ts`; the physical file numbers are only a runner convention.
7. **`ModuleType` has no `"derived"`** (`base|system|domain|integration`).
   The pilot module MUST be `type: "domain"` (otherwise the gate reports `invalid_module_type`).
8. **The `extension.manifest.json` gate (ADR-0015) does not exist yet**; `extension:check`
   only validates the composition seam. Pinning the base version = write `extension.manifest.json`
   as a DOCUMENT + manual review, do not rely on a gate. `production:preflight`
   has no script either — run the underlying ones one by one. `AUTH_JWT_SECRET` is not
   used by the base (mandatory env: `APP_ENV`, `APP_URL`, `DATABASE_URL`).

## 3. Phase A — Scaffold the derived repo (vendor)

1. Create the GitHub repo **`ahliweb/awcms-erp-pilot`** (private) + a local checkout
   (e.g. `/home/data/dev_bun/awcms-erp-pilot`).
2. **Vendor base v5.1.1**: copy a clean snapshot of the base tree (without the base `.git`),
   fresh `git init`, `bun install`. Change `package.json` `name` → `awcms-erp-pilot`,
   `version` `0.1.0`. Keep every gate/skill/CI/Dockerfile.production.
3. **Baseline `bun run check` GREEN** with the registry still `undefined` (pure
   base). This proves the vendoring is clean before touching anything.
4. Write **`extension.manifest.json`** (as a document; `compatibleAwcmsRange` pointing at
   base v5.1.1). Adjust `.github/workflows/*` for the derived repo (image name,
   etc.). Set the mandatory env `APP_ENV`/`APP_URL`/`DATABASE_URL`.

## 4. Phase B — The `purchase_requisition` module

### 4.1 Schema migration (in the **derived repo's** `sql/`, numbered 900+)

File `900_awcms_purchase_requisition_schema.sql` — the runner's name pattern is
`^\d{3}_awcms_[a-z0-9_]+\.sql$` (`scripts/db-migrate.ts`), checksum immutable
once applied. Follow the template `sql/027_awcms_business_scope_assignments_schema.sql`
(the most representative pattern) + `sql/020` (tenant-scoped composite FK).

MANDATORY elements for every tenant-scoped table:

- `tenant_id uuid NOT NULL REFERENCES awcms_tenants (id)`.
- A **composite FK** `(tenant_id, xxx_id)` pointing at the target table's
  `UNIQUE (tenant_id, id)` — NOT a single-column FK (the RI check runs as OWNER and
  **bypasses RLS**, so a single-column FK can point across tenants even under FORCE).
- `ADD CONSTRAINT ..._tenant_id_key UNIQUE (tenant_id, id)` on any table that becomes
  the FK target of another table (e.g. the header pointed at by the lines).
- `ALTER TABLE ... ENABLE ROW LEVEL SECURITY;` **then**
  `ALTER TABLE ... FORCE ROW LEVEL SECURITY;` (ENABLE alone is inert for the owner).
- `CREATE POLICY ..._tenant_isolation ON ... USING (tenant_id =
current_setting('app.current_tenant_id')::uuid);`
- Indexes always start with `tenant_id`: `(tenant_id, status)`, and
  `(tenant_id, created_at, id)` for keyset.
- **No GRANT needed** (the blanket `awcms_app` grant from `sql/019`).

**`awcms_pr_requisitions`** (header): `id uuid PK`, `tenant_id`, `code text`,
`title text`, `requester_tenant_user_id uuid NOT NULL`, business-scope columns
(`scope_type`, `scope_id`), `status text` CHECK
`('draft','submitted','approved','rejected','cancelled')`, `version int NOT NULL
DEFAULT 1`, `workflow_instance_id uuid`, `submitted_at timestamptz`, `created_at`/
`updated_at timestamptz NOT NULL DEFAULT now()`, `deleted_at timestamptz` (draft-
only soft-delete). Composite FK `(tenant_id, requester_tenant_user_id)` →
`awcms_tenant_users (tenant_id, id)`. `UNIQUE (tenant_id, id)` (the lines' target).
`UNIQUE (tenant_id, code)`.

**`awcms_pr_requisition_lines`**: `id uuid PK`, `tenant_id`, `requisition_id uuid
NOT NULL`, composite FK `(tenant_id, requisition_id)` →
`awcms_pr_requisitions (tenant_id, id)`, `item_description text`, `quantity
numeric(18,4)`, `uom text`, `estimated_unit_cost numeric(18,4)`, `line_no int`.
Index `(tenant_id, requisition_id, line_no)`.

**Post-submit immutability**: an application guard (only `status='draft'` is mutable) +
a DB defence (trigger/CHECK rejecting UPDATEs of business columns when `status <> 'draft'`,
except for the official status transitions). Soft-delete only for drafts.

File `901_awcms_seed_purchase_requisition_permissions.sql`: seed the permission
catalogue (the `sql/028` pattern):

```sql
INSERT INTO awcms_permissions (module_key, activity_code, action, description)
VALUES
  ('purchase_requisition', 'requisition', 'read',   '...'),
  ('purchase_requisition', 'requisition', 'create', '...'),
  ('purchase_requisition', 'requisition', 'update', '...'),
  ('purchase_requisition', 'requisition', 'approve','...'),
  ('purchase_requisition', 'requisition', 'reject', '...')
ON CONFLICT (module_key, activity_code, action) DO NOTHING;
```

For submit: add the row matching the §2.1 resolution you picked (if the base `submit`
PR: `('purchase_requisition','requisition','submit',...)`; if interim:
`('purchase_requisition','requisition_submission','create',...)`).

### 4.2 The `src/modules/purchase-requisition/` module

Structure `{domain,application,infrastructure}/` + `module.ts` + `README.md`.
`domain/` = a pure state machine (draft→submitted→approved/rejected/cancelled;
legal transitions + the immutability invariant, no I/O). Descriptor via
`defineModule()` (identity fn, `_shared/module-contract.ts`,
`MODULE_CONTRACT_VERSION 1.3.0`).

MANDATORY `ModuleDescriptor` fields: `key: "purchase_requisition"` (snake_case, must
not collide with the base → `prohibited_base_override`), `name`, `version: "0.1.0"`,
`status: "experimental"`, `description`, `dependencies:
["tenant_admin","identity_access","workflow","domain_event_runtime"]`. Additionally
MANDATORY: **`type: "domain"`**. Optional fields that are used:

- `api: {openApiPath: "openapi/modules/purchase-requisition.openapi.yaml",
basePath: "/api/v1/purchase-requisitions"}`.
- `permissions: [{activityCode, action, description}]` — in sync with the §4.1 seed.
- `events: {asyncApiPath: "asyncapi/awcms-domain-events.asyncapi.yaml", publishes:
["awcms.purchase-requisition.created", ".submitted", ".approved", ".rejected"]}`
  (each string = an AsyncAPI channel name).
- `sodRules: [...]` (see §4.3).
- `navigation` (globally unique path; deferred to the next UI increment if there is
  no screen).

Fill in **`src/modules/application-registry.ts`** (the only base file edited,
guardrail ADR-0013):

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

Then regenerate the inventory: `bun run modules:composition:inventory:generate` → commit
`docs/awcms/module-composition-inventory.json`.

### 4.3 SoD rule (requester ≠ approver)

The pattern comes straight from the example-crm fixture
(`tests/fixtures/derived-application-example/modules/example-crm/module.ts`,
`example_crm.requisition_approval_separation`). `SoDRuleDescriptor`:

```ts
{
  ruleKey: "purchase_requisition.requester_approver_separation",
  ownerModuleKey: "purchase_requisition",
  description: "A PR requester in a scope must not also be able to approve PRs in the SAME scope (requester/approver separation).",
  conflictingPermissionKeys: [
    "purchase_requisition.requisition.create",
    "purchase_requisition.requisition.approve"
  ],
  scopeApplicability: "same_scope_only",
  severity: "high",
  exceptionPolicy: {
    allowed: true,
    requiresApprovalPermission: "identity_access.business_scope_exceptions.approve",
    maxDurationDays: 7
  }
}
```

`sodRules` flow AUTOMATICALLY into enforcement via
`collectSoDRuleDescriptors(listModules())` → `high-risk-sod-guard.ts` (no per-route
wiring needed). The `sod:registry:check` gate validates the whole rule set once
`listModules()` includes the pilot module.

### 4.4 HTTP routes (composition root)

Routes live in **`src/pages/api/v1/purchase-requisitions/*.ts`** (Astro, NOT in the
module folder). The canonical model: `src/pages/api/v1/workflows/tasks/[id]/decisions.ts`
(auth + idempotency + decision + audit + event in a single handler).

**Order of the high-risk mutation chain (verified from decisions.ts):**

1. `resolveAuthInputs` → guard 400/401/`IDEMPOTENCY_REQUIRED`.
2. `readJsonBody` → domain validation.
3. `withTenant(sql, tenantId, async (tx) => { ... }, {workClass: "interactive"})`.
4. Inside the tx, for approve/reject: **`fetchTaskWithInstanceForDecision` as early as
   possible** (it supplies `requestedByTenantUserId` for the self-approval check) →
   `authorizeInTransaction(tx, tenantId, tokenHash, now, guard, {hierarchyPort,
sodRules})`.
5. **Check idempotency replay AFTER the guard** (`findIdempotencyRecord`).
6. `findEligibleAssignment` (for a decision) → the domain work (status transition).
7. `recordWorkflowTaskDecision` (approve/reject) — performs the workflow event +
   the internal task transition.
8. `appendDomainEvent(tx, tenantId, {producerModule: "purchase_requisition", ...})`
   for the **PR domain** events (created/submitted/approved/rejected).
9. `recordAuditEvent(tx, {...})`.
10. Build `ok(data, {correlationId})` **then** `saveIdempotencyRecord` (the body
    is stored from `ok(...).clone().json()`).

Endpoints:

- `POST /purchase-requisitions` — create a draft (guard `requisition.create`).
- `PATCH /purchase-requisitions/{id}` — edit the draft + lines (guard
  `requisition.update`; reject when non-draft — immutability).
- `POST /purchase-requisitions/{id}/submit` — guard per the §2.1 resolution;
  `startWorkflowInstance(tx, {workflowKey, resourceType: "purchase_requisition",
resourceId: id, requestedByTenantUserId, ...})` + the draft→submitted transition +
  the `.submitted` event + audit.
- `POST /purchase-requisitions/{id}/approve` — a **PR-specific endpoint** (NOT the
  generic workflow endpoint), guard `requisition.approve` (high-risk → SoD +
  self-approval + business-scope actually bite). Within a single tx:
  `recordWorkflowTaskDecision(decision:"approve")` + the status transition +
  the `.approved` event + audit, idempotent.
- `POST /purchase-requisitions/{id}/reject` — guard `requisition.reject`
  (non-high-risk), symmetric with approve.
- `GET /purchase-requisitions` — keyset list (`KEYSET_CURSOR_CREATED_AT_SQL` +
  `encode/decodeKeysetCursor`).
- `GET /purchase-requisitions/{id}` — detail + timeline (from
  `awcms_workflow_decisions` + audit/events).

**Inject the ports in the route (composition root, ADR-0011):**
`BusinessScopeHierarchyPort` (#180) — the base default is `resolved:false` → fail-closed
deny; scoped approval MUST inject a real resolver (for example
`identity/business-scope/assignments/index.ts`), otherwise it always denies.
`WorkflowNotificationPort` — do NOT inject it (increment-1 has no email → the `notify` node
is a no-op).

**Key design decision** (why a PR-specific endpoint): the generic workflow endpoint
only guards _workflow_ permissions, so the SoD rule `requisition.create` vs
`requisition.approve` does NOT fire there. A PR-owned approve/reject endpoint +
looking up `requestedByTenantUserId` before the guard is what makes SoD + self-approval real.

### 4.5 OpenAPI fragment + AsyncAPI + domain event registry

- **OpenAPI**: `openapi/modules/purchase-requisition.openapi.yaml` — only
  `paths:` + `components.schemas:` (not a valid standalone OpenAPI document; `$ref`s to the
  base's shared components resolve at bundle time). Pointed at by `ModuleDescriptor.api.openApiPath`,
  merged through the bundler's `extraFragmentFiles` seam (`scripts/openapi-bundle.ts`)
  **without editing any base fragment**. Redefining a base path/schema →
  `BundleConflictError`. `bun run openapi:bundle` then `api:spec:check`
  (the committed bundle must byte-match; route parity).
- **AsyncAPI**: add a channel in `asyncapi/awcms-domain-events.asyncapi.yaml`
  (address = the event name, message `$ref DomainEvent`, + `operations:` `action:
send`) for every PR event, AND an `events.publishes` entry in `module.ts`.
- **Event registry**: register every `(eventType, eventVersion)` in
  `DOMAIN_EVENT_TYPE_REGISTRY` (`domain-event-runtime/domain/event-type-registry.ts`,
  of the shape `{eventType, eventVersion, description}`). The parity test
  (`domain-event-registry-parity.test.ts`) enforces: registry↔AsyncAPI
  in both directions, `events.publishes` contains the module's own entries, no duplicates.
- The `domain_event` consumer strategy requires editing the static consumer registry → for
  the PR projection (a later increment) use **`cursor_table`** so the module stays
  self-contained.

## 5. Phase C — Tests, gates, CI, PR, review, merge

### 5.1 Layered tests

- **Unit** (no DB): the state machine draft→submitted→approved/rejected;
  the post-submit immutability invariant; the self-approval logic (requester =
  approver → reject); validation of illegal transitions.
- **Integration** (a real `postgres:18.4` DB + the **non-superuser** role `awcms_app`
  with LOGIN, two-world harness): draft → submit → approve changes the status; the requester
  CANNOT approve their own (self-approval deny); **RLS FORCE fail-closed across
  tenants** (under a non-superuser role — ENABLE alone is not enough); post-submit
  immutability is enforced; requester/approver SoD is rejected + the exception path;
  idempotent replay (same key → same response; different hash → 409); keyset precision
  (rows within the same microsecond are not skipped).
- **Contract**: `api:spec:check` (fresh bundle + route parity + standard error
  schema).

Harness note: the two DB-gated suites (RLS/role-sep vs ad-hoc) **must not collide within
one `bun test`** — separate steps in CI. Reset the circuit-breaker per `beforeEach`.

### 5.2 Gates & CI

A full `bun run check` GREEN, including the **3 composition gates**: `modules:compose:check`
(duplicate_key / prohibited_base_override / invalid_module_type /
migration_namespace_overlap 1–899 vs 900–999 / navigation_path_conflict /
invalid_job_descriptor / capability), `modules:composition:inventory:check` (regen

- commit `module-composition-inventory.json`), `extension:check` (derived mode:
  non-empty `id` + modules ≥1). Plus `sod:registry:check`, `family:conformance:check`
  (passes as long as the base is unchanged), `logging:lint`, typecheck, test, build.

Derived CI carry-over: `integration-tests` (RLS + role-sep, two separate suites),
`e2e-smoke` (Playwright — the PR-specific one is deferred), `minimum-supported` (Bun 1.3.0),
`hygiene`, `codeql`. `security:readiness` = a go-live command (it needs a
migrated DB), **not** part of `bun run check`.

### 5.3 PR & tracker

1. Changeset. Atomic commit, push, open the PR in **`ahliweb/awcms-erp-pilot`**.
2. Adversarial review: the `awcms-reviewer` + `awcms-security-auditor` subagents;
   address findings; merge.
3. **Update tracker #187 (base repo)** with a link to the derived PR evidence. Do NOT
   close it — increment-1 ≠ all of #187 (UI/deploy/upgrade follow).
4. Update memory (`awcms-derived-pilot-notes.md`) + the skill if needed.

## 6. Increment-1 boundary (DONE vs DEFERRED)

**Increment-1 (THIS):** repo scaffold (vendor) + the `purchase_requisition` module
vertical slice (header+lines, draft CRUD, submit) + the full approval workflow
(submit→instance→task→PR-specific approve/reject endpoint, self-approval + SoD +
business-scope guard) + the created/submitted/approved/rejected domain events + audit

- idempotency + REST + OpenAPI fragment + AsyncAPI channel + layered tests + the 3
  composition gates + `bun run check` + CI + `extension.manifest.json` as a document.
  Migrations numbered 900+ in the derived repo's `sql/`.

**DEFERRED to a later increment:** the SSR admin UI (list/search/create/submit/
task-approval/timeline/reporting), the `cursor_table` reporting projector + refresh
job (needs an `awcms_worker` GRANT), docker-compose LAN/prod + backup/restore +
systemd/nginx + Coolify + create-app-role, the upgrade-path doc, the PR-specific
Playwright e2e-smoke, promotion to `active` maturity.

## 7. Increment-1 verification (Definition of Done)

- A full `bun run check` green in the derived repo (no base file edited other than
  `application-registry.ts`).
- DB-gated integration under a non-superuser role: draft → submit → approve
  changes the status; the requester CANNOT approve their own; RLS FORCE fail-closed
  across tenants; post-submit immutability is enforced; requester/approver SoD is
  rejected + the exception; idempotent replay; keyset precision.
- The 3 composition gates + CI green; evidence of the extension model (a one-file registry seam).
- Tracker #187 updated with an evidence link (not closed).

## 8. List of open decisions (to be decided at execution time)

1. **The `submit` action resolution** (§2.1): a generic foundation PR to the base (adding
   `submit` to `AccessAction`) **vs** the interim `requisition_submission.create`.
   Recommendation: the generic base PR (small, reusable, evidence of a foundation gap
   surfaced by the pilot — exactly the point of #187).
2. **The PR workflow definition**: it needs an `awcms_workflow_definitions` seed
   (the PR `workflowKey`, an approval node + a no-op `notify`, quorum) in a derived migration
   so that `startWorkflowInstance` finds an `active` definition. Decide
   single-approver vs quorum.
3. **The real business-scope resolver** injected in the approve route — reuse the base
   assignment resolver or a pilot-specific resolver.
