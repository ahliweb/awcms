---
"awcms": minor
---

Give `business_scope_hierarchy` a real provider: `tenant_admin` resolves `office` scopes against `awcms_offices` (ADR-0060).

`POST /api/v1/identity/business-scope/assignments` is permission-gated, SoD-evaluated, audited, idempotency-keyed and RLS-protected — and until now it refused **every input in every deployment**. Its only composition root injected a NO-OP adapter that resolved every scope to `resolved: false`, and the reserved `tenant` scope type is rejected by the validator as unassignable (#180 review F2), so both roads led to a denial. Everything downstream was dead with it: no assignment rows to read, so `businessScopeFacts` was never populated, the expiry job never had anything to expire, and SoD's `same_scope_only` matching never had a scope to match.

The NO-OP was correct when written — ADR-0011/0014 expected a DERIVED application to inject its own hierarchy resolver — and then ADR-0034 deleted that pathway and ADR-0055 confined development to this repo. Its `providedBy` named `organization_structure`, a module ADR-0016 accepted and nobody ever wrote here. What was missing was never the hierarchy: `awcms_offices` has had `parent_office_id` since `sql/002`, FORCE RLS since `sql/017`, and a composite cross-tenant-proof parent FK since `sql/020`.

The new adapter resolves the `office` scope type and nothing else. Only LIVE rows resolve — not soft-deleted, not `inactive`, same tenant only — and dead rows are skipped anywhere in a chain, so a live office under a deactivated parent gets a shorter ancestor chain rather than borrowing coverage through a resource its tenant switched off. Every bound REFUSES rather than truncates (cycle, depth, result count): a truncated list still claims `resolved: true`, which would answer a coverage question from part of the graph with no signal the rest existed.

One read-path hardening ships with it: `resolveBusinessScopeFacts` minted a covers-everything fact from `scope_type = 'tenant'` alone. It now requires that row to name this tenant. No supported path can write such a row, which is exactly why the check belongs there — a row carrying it came from outside the service and passed no validation at all.

The NO-OP adapter is deleted (zero callers once the root is rewired); `optional: true` stays on the consumption, so a tenant with no offices still works and still fails closed. Zero migrations, zero new permissions, no change to any existing endpoint's behaviour — a route must still opt into scope-gated authorization explicitly, and none does today.
