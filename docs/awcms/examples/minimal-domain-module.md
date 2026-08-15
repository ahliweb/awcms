🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](minimal-domain-module.id.md)

# Minimal Domain Module Example

> **Status (2026-07-14):** The `awcms` repo is only at the re-foundation stage
> (see [ADR-0001](../../adr/0001-rebuild-on-awcms-foundation-erp-scope.md)) —
> **no ERP module has been implemented yet** and `src/` does not exist.
> Every path/command in this document (`src/modules/...`, `bun run ...`,
> skills, etc.) is a **target pattern** that will apply once implementation of
> the foundation begins — adapted from the base
> [awcms-mini](https://github.com/ahliweb/awcms-mini), which is already fully
> implemented and whose example module has been genuinely tested there. Use
> this document as a reference for the mechanism (folder structure,
> migration+RLS, ABAC, endpoint, API/event contract, tests), not as evidence
> that this code already runs in the `awcms` repo.

A concrete example of one minimal ERP domain module — from folder structure to
test checklist — as a practical reference for the first ERP domain module that
will be built in this repo (finance, inventory, procurement, manufacturing,
HR/payroll, and so on).

> **This is a template, not a module that already exists.** The example domain
> here (`expense-category` — simple expense category recording for the finance
> module) was deliberately chosen as the most minimal ERP domain that still
> makes sense (one master-data entity, without a transaction/tiered-approval
> flow) — not a full finance/inventory module. Copy the pattern, **change the
> domain name, entities, permissions, and fields** to match the real ERP module
> you are building — do not copy `expense-category` as-is into production.
> Not one line of code in this document exists in this repo's `src/modules/`;
> this repo does not have a `src/` folder at all at this re-foundation stage.

## Folder structure

Planned to follow the pattern of the base's active modules (`domain/` for pure
logic without I/O, `application/` for transaction/DB orchestration, `api/` for
endpoint-specific request/response types when needed, Astro routes stay in
`src/pages/api/v1/...` — not inside the module folder):

```
src/modules/expense-category/
├── module.ts
├── README.md
├── domain/
│   └── expense-category-validation.ts   # pure validation, no DB
└── application/
    └── expense-category-directory.ts    # functions that take `tx` and run queries
```

The endpoint route still lives at `src/pages/api/v1/finance/expense-categories/index.ts`
(or the path matching your domain) — consistent with every active module in the
base, none of which put Astro routes inside the module folder.

## `module.ts` — initial descriptor

A new module is planned to **always** start at `version: "0.1.0"`,
`status: "experimental"` — moving up to `active`/`1.0.0` after meeting the
"mature" criteria (integration tests + a complete security checklist, see
§Security checklist below):

```typescript
import { defineModule } from "../_shared/module-contract";

export const expenseCategoryModule = defineModule({
  key: "expense_category",
  name: "Expense Category",
  version: "0.1.0",
  status: "experimental",
  description:
    "Tenant-scoped expense categories for the finance module — a minimal ERP domain module example.",
  dependencies: ["identity_access"],
  api: {
    // A fragment OWNED BY this module, not a generated bundle — the fragment
    // ownership gate in `api:spec:check` rejects the latter, and demands that
    // this file genuinely exists.
    openApiPath: "openapi/modules/expense-category.openapi.yaml",
    basePath: "/api/v1/finance/expense-categories"
  },
  events: {
    asyncApiPath: "asyncapi/awcms-domain-events.asyncapi.yaml",
    publishes: ["awcms.expense-category.expense-category.registered"]
  }
});
```

`dependencies: ["identity_access"]` because this module uses
`evaluateAccess`/`resolveTenantContext` owned by `identity-access` — the same
pattern as the other active modules, rather than rewriting its own RBAC/ABAC.

## PostgreSQL migration + RLS

**Mandatory**: `tenant_id`, `ENABLE`+`FORCE ROW LEVEL SECURITY` in the same
migration, indexes prefixed with `(tenant_id, …)`. Every new domain table
**must** carry its own `FORCE` in the migration that creates it:

```sql
-- NNN_awcms_expense_category_schema.sql — minimal ERP domain module example.

CREATE TABLE IF NOT EXISTS awcms_expense_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  category_code text NOT NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text,
  CONSTRAINT awcms_expense_categories_status_check
    CHECK (status IN ('active', 'retired'))
);

CREATE UNIQUE INDEX IF NOT EXISTS awcms_expense_categories_code_dedup
  ON awcms_expense_categories (tenant_id, category_code)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS awcms_expense_categories_tenant_idx
  ON awcms_expense_categories (tenant_id);

-- ENABLE and FORCE must be in the SAME migration — do not split them into a
-- separate migration, and do not forget FORCE (RLS without FORCE does not
-- apply to the owner/migration role).
ALTER TABLE awcms_expense_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_expense_categories FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_expense_categories_tenant_isolation
  ON awcms_expense_categories
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- Grant DML to the application's least-privilege role (the initial
-- role-separation migration creates this role; a new table still needs its
-- own explicit grant).
GRANT SELECT, INSERT, UPDATE, DELETE ON awcms_expense_categories TO awcms_app;
```

The migration numbering convention and the runner checksum follow the
`NNN_awcms_<area>_<desc>.sql` pattern — do not write a migration outside this
pattern.

## Permission/role/policy seed

A new domain adds its own permissions, following the
`<module>.<resource>.<action>` naming pattern already used by the other active
modules (do not copy the illustrative contents, only the pattern):

```sql
INSERT INTO awcms_permissions (key, module_key, description) VALUES
  ('expense_category.expense_category.read', 'expense_category', 'View the tenant expense category list'),
  ('expense_category.expense_category.write', 'expense_category', 'Create/change tenant expense categories')
ON CONFLICT (key) DO NOTHING;
```

Assign permissions to roles through `awcms_role_permissions` like the other
modules do — **there is no implicit grant**: without a row in this table, ABAC
default-deny rejects all access to the new permission.

## Service/application function

`application/expense-category-directory.ts` — takes the transaction (`tx`) from
`withTenant`, it does not open a connection of its own:

```typescript
export type RegisterExpenseCategoryInput = {
  tenantId: string;
  categoryCode: string;
  name: string;
};

export async function registerExpenseCategory(
  tx: Bun.TransactionSQL,
  input: RegisterExpenseCategoryInput
) {
  const rows = await tx`
    INSERT INTO awcms_expense_categories (tenant_id, category_code, name)
    VALUES (${input.tenantId}, ${input.categoryCode}, ${input.name})
    RETURNING id, category_code, name, status, created_at
  `;

  return rows[0];
}
```

Pure validation (`categoryCode` format, `name` length, and so on) stays in
`domain/expense-category-validation.ts` without any DB import — called from the
route before `application/` runs, consistent with the domain/application split
of the other active modules.

## REST endpoint — thin route

The standard pattern (auth → tenant context → ABAC guard → validation →
idempotency when high-risk → service+transaction → response helper):

```typescript
// src/pages/api/v1/finance/expense-categories/index.ts
import type { APIRoute } from "astro";
import { fail, ok } from "../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../lib/database/client";
import { withTenant } from "../../../../../lib/database/tenant-context";
import { hashSessionToken } from "../../../../../lib/auth/session-token";
import { extractBearerToken } from "../../../../../modules/identity-access/application/session-lookup";
import {
  fetchGrantedPermissionKeys,
  resolveTenantContext
} from "../../../../../modules/identity-access/application/auth-context";
import { recordDecisionLog } from "../../../../../modules/identity-access/application/decision-log";
import { evaluateAccess } from "../../../../../modules/identity-access/domain/access-control";
import { recordAuditEvent } from "../../../../../modules/logging/application/audit-log";
import { registerExpenseCategory } from "../../../../../modules/expense-category/application/expense-category-directory";
import { validateExpenseCategoryInput } from "../../../../../modules/expense-category/domain/expense-category-validation";

const GUARD_REQUEST = {
  moduleKey: "expense_category",
  activityCode: "expense_category",
  action: "write" as const
};

export const POST: APIRoute = async ({ request }) => {
  const tenantId = request.headers.get("x-awcms-tenant-id");
  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }

  const token = extractBearerToken(request.headers.get("authorization"));
  if (!token) {
    return fail(401, "AUTH_REQUIRED", "Authentication required.");
  }

  const body = await request.json();
  const validation = validateExpenseCategoryInput(body);
  if (!validation.valid) {
    return fail(400, "VALIDATION_ERROR", validation.message);
  }

  const sql = getDatabaseClient();
  const tokenHash = hashSessionToken(token);
  const now = new Date();

  return withTenant(
    sql,
    tenantId,
    async (tx) => {
      const context = await resolveTenantContext(tx, tenantId, tokenHash, now);
      if (!context) {
        return fail(401, "AUTH_REQUIRED", "Session is invalid or expired.");
      }

      const grantedPermissionKeys = await fetchGrantedPermissionKeys(
        tx,
        tenantId,
        context.tenantUserId
      );
      const decision = evaluateAccess(
        context,
        GUARD_REQUEST,
        grantedPermissionKeys
      );
      await recordDecisionLog(
        tx,
        tenantId,
        context.tenantUserId,
        GUARD_REQUEST,
        decision
      );

      if (!decision.allowed) {
        return fail(403, "ACCESS_DENIED", decision.reason);
      }

      const expenseCategory = await registerExpenseCategory(tx, {
        tenantId,
        categoryCode: body.categoryCode,
        name: body.name
      });

      // High-risk domain action (it affects finance expense classification) ->
      // audit trail.
      await recordAuditEvent(tx, {
        tenantId,
        actorTenantUserId: context.tenantUserId,
        moduleKey: "expense_category",
        action: "expense_category.registered",
        resourceType: "expense_category",
        resourceId: expenseCategory.id,
        message: `Expense category ${expenseCategory.category_code} registered.`
      });

      return ok(expenseCategory);
    },
    { workClass: "interactive" }
  );
};
```

If this endpoint is considered a high-risk mutation that must be safe to repeat
(client retry), add an `Idempotency-Key` parameter and wrap it with
`findIdempotencyRecord`/`saveIdempotencyRecord` (`src/modules/_shared/idempotency.ts`)
— the same idempotency pattern used by the workflow approval decision endpoints
(e.g. expense approval).

## OpenAPI snippet

The API contract is planned as a GENERATED artifact — do not edit it directly.
Add the new path to this module's source fragment,
`openapi/modules/<module-key>.openapi.yaml` (create a new one if this module
does not have one yet — one file per module/tag, do not mix it with another
module), then run `bun run openapi:bundle` to regenerate the published bundle
file. The PUBLISHED contract remains a single file — only the source
representation is split per module:

```yaml
/api/v1/finance/expense-categories:
  post:
    tags:
      - Expense Category
    summary: Register a new expense category for the caller's tenant
    operationId: expenseCategoriesRegisterExpenseCategory
    security:
      - bearerAuth: []
        tenantHeader: []
    parameters:
      - $ref: "#/components/parameters/CorrelationId"
      - $ref: "#/components/parameters/RequestId"
    requestBody:
      required: true
      content:
        application/json:
          schema:
            $ref: "#/components/schemas/ExpenseCategoryRegisterRequest"
    responses:
      "200":
        description: Expense category registered.
        content:
          application/json:
            schema:
              allOf:
                - $ref: "#/components/schemas/ApiSuccess"
                - type: object
                  required: [data]
                  properties:
                    data:
                      $ref: "#/components/schemas/ExpenseCategoryResponse"
      "400":
        $ref: "#/components/responses/BadRequest"
      "401":
        $ref: "#/components/responses/Unauthorized"
      "403":
        $ref: "#/components/responses/Forbidden"
      "500":
        $ref: "#/components/responses/InternalError"
```

`ExpenseCategoryRegisterRequest`/`ExpenseCategoryResponse` are defined once in
the `components.schemas` of this module's fragment (or in a shared source file
if they are genuinely used by 2+ modules), just like the schemas of the other
active modules. Run `bun run openapi:bundle` and then `bun run api:spec:check`
after adding a path — this check fails when `info.version` is not SemVer, when
paths/schemas are inconsistent, when the bundle is stale relative to the source
fragments, when an `operationId` is duplicated, when a path parameter does not
match, when an error response is not `ApiError`, or when security metadata is
not explicit.

## AsyncAPI snippet (when the mutation produces a domain event)

Add a new channel to `asyncapi/awcms-domain-events.asyncapi.yaml` only when this
mutation needs to be synchronised across nodes (outbox) or consumed
asynchronously by another system — it is not mandatory for every endpoint:

```yaml
channels:
  awcms.expense-category.expense-category.registered:
    address: awcms.expense-category.expense-category.registered
    messages:
      DomainEvent:
        $ref: "#/components/messages/DomainEvent"
    description: Emitted when a new expense category is registered for a tenant.
operations:
  publishExpenseCategoryRegistered:
    action: send
    channel:
      $ref: "#/channels/awcms.expense-category.expense-category.registered"
    messages:
      - $ref: "#/channels/awcms.expense-category.expense-category.registered/messages/DomainEvent"
```

Consistent with the base pattern: this contract documentation does not require
a concrete pub/sub dispatcher — the same event payload can be shipped through
the sync outbox (`awcms_sync_outbox`) when the deployment needs offline-first
synchronisation (e.g. a warehouse/branch that goes offline occasionally).

## UI/admin screen checklist

- [ ] Base design tokens are used (not hardcoded colours/spacing).
- [ ] 4-state pattern: loading, empty, error, ready.
- [ ] WCAG 2.1 AA accessibility (labels, focus, contrast).
- [ ] All strings go through the `.po` catalogue, not hardcoded
      Indonesian/English directly in the component.
- [ ] High-risk actions (e.g. retiring an expense category still used by active
      transactions) show an explicit confirmation before submit.

## Test checklist

- [ ] **Unit** — `domain/expense-category-validation.ts` tested without a DB
      (valid/invalid cases, `categoryCode` format boundaries).
- [ ] **Integration** — the `POST /api/v1/finance/expense-categories` endpoint
      tested against a real PostgreSQL (not a mock): tenant isolation, ABAC
      allow/deny, response shape.
- [ ] **Security** — test that RLS genuinely is `FORCE` (a cross-tenant query
      must return 0 rows, not merely "look right" on the happy path); test ABAC
      default-deny (permission not seeded yet → access denied).
- [ ] **Contract** — `bun run api:spec:check` green after the new path/schema
      has been added.

## Security checklist before it counts as production-ready

Applied to this example domain, and at the same time a baseline for the first
real ERP module:

- [ ] Tenant context via `withTenant()`/`resolveTenantContext` — no manual
      `WHERE tenant_id` from client input.
- [ ] ABAC default-deny — the
      `expense_category.expense_category.write`/`.read` permissions are seeded
      explicitly, there is no implicit grant.
- [ ] RLS `ENABLE`+`FORCE` in the same migration, a tenant isolation policy,
      indexes prefixed with `(tenant_id, …)`.
- [ ] Audit — `expense_category.registered` (and other high-risk domain
      actions, e.g. retire) produce an `awcms_audit_events` row via
      `recordAuditEvent`.
- [ ] Idempotency — if the endpoint is considered high-risk/retry-sensitive,
      accept an `Idempotency-Key`.
- [ ] Redaction — if your domain entity has sensitive identifiers (NIK, NPWP,
      account numbers, and so on — common in finance/HR-payroll modules), apply
      the same redaction/masking as the NPWP/NIK/email pattern in the base
      before storing/displaying/logging it.
- [ ] `bun run api:spec:check` green.
- [ ] `bun run production:preflight` green before go-live.

## See also

- [`../18_configuration_env_reference.md`](../18_configuration_env_reference.md)
  — foundation environment variable reference.
- [`../templates/module-proposal-template.md`](../templates/module-proposal-template.md),
  [`../templates/module-admission-decision-checklist.md`](../templates/module-admission-decision-checklist.md)
  — the new-module admission process.
- `AGENTS.md` (repo root) — the mandatory workflow for every task, including
  ADR discipline.
