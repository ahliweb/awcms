🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0060-business-scope-hierarchy-provided-by-tenant-admin.id.md)

# ADR-0060 — The business scope hierarchy is provided by `tenant_admin` (office), not by a derived application

- **Status:** Accepted
- **Date:** 2026-08-03
- **Decision maker:** @ahliweb
- **Related:** [ADR-0011](0011-capability-ports-for-cross-module-collaboration.md) (capability port), [ADR-0016](0016-organization-structure-module-admission.md) (`organization_structure` — `Accepted` without a single line of its code ever existing), [ADR-0034](0034-awcms-family-direct-use-templates-and-derived-pathway-removal.md) (the derived-application pathway is REMOVED), [ADR-0045](0045-jualanku-porting-awcms-system-of-record-astro-bff.md) (a Jualanku merchant = a business scope), [ADR-0055](0055-development-confined-to-awcms-and-awcms-astro.md) (capabilities are built here)

## Context

### 1. A guarded, audited, RLS-backed endpoint whose SUCCESS path is unreachable

`POST /api/v1/identity/business-scope/assignments` (#180) writes to
`awcms_business_scope_assignments` (`sql/027`, FORCE RLS), is permission-gated,
SoD-evaluated (#181), audited, and carries an `Idempotency-Key`. Before this ADR,
**there was no input at all that could make it succeed**, in any deployment
whatsoever.

The chain, verified against the code:

1. `createBusinessScopeAssignment` verifies `(scopeType, scopeId)` through
   `BusinessScopeHierarchyPort` before writing; `resolved: false` → `scope_unresolved`.
2. The only composition root that exists, `src/pages/api/v1/identity/business-scope/assignments/index.ts`,
   injects `defaultBusinessScopeHierarchyPortAdapter` — a NO-OP adapter that
   returns `resolved: false` for **every** scope type.
3. The reserved `tenant` scope type is no way out:
   `validateCreateBusinessScopeAssignmentInput` rejects it as
   **not-assignable** (#180 review F2) — it is a coverage sentinel, not a
   resource.

So every request ends in one of two rejections. The rest of the subsystem dies
with it: `resolveBusinessScopeFacts` never has a row to read,
`businessScopeFacts` on `evaluateAccess` is never populated, the
`business-scope:expiry` job never has anything to expire, and the SoD
`same_scope_only` never has a scope to match against.

### 2. What it was waiting for is NOT coming — ADR-0034 already removed it

That NO-OP was **correct when it was written**. ADR-0011/0014 designed the base
as a foundation vendored by derived applications; it was the derived application
that would bring its own legal-entity/organization-unit tables and inject a
resolver in its own composition root. `identity_access` even wrote down its
canonical provider: `providedBy: "organization_structure"`.

Two things then happened and nobody closed the loop:

- **`organization_structure` never existed here.** ADR-0016 marked the module
  `Accepted`; zero lines of code were ever written (the same audit finding is
  already recorded in `PROJECT_STATE.md` §4 for five ADRs at once).
- **[ADR-0034](0034-awcms-family-direct-use-templates-and-derived-pathway-removal.md)
  removed the derived pathway**, and [ADR-0055](0055-development-confined-to-awcms-and-awcms-astro.md)
  locked development to this repo. There will be no derived application
  injecting a resolver, because that pathway no longer exists.

From that moment the NO-OP stopped being a "safe default while waiting for a
provider" and became a **permanent rejection** — the same class of defect as the
page that could never be published ([ADR-0057](0057-blog-page-lifecycle.md)) and
the Restore button rendered on exactly the rows that are guaranteed to 404
(#351): a surface that reports success while not working.

### 3. The base ALREADY has a real hierarchy, and it is already hardened

`awcms_offices` (`sql/002`) belongs to `tenant_admin`: `parent_office_id`,
`status` (`active`/`inactive`), soft delete, `FORCE ROW LEVEL SECURITY` since
`sql/017`, and — most relevant of all — a **tenant-scoped composite FK** since
`sql/020`, so an office cannot point at a parent owned by another tenant. CRUD,
soft-delete/restore, and the `/admin/offices` screen all already exist.

What is missing is not the hierarchy. What is missing is a provider.

## Decision

### A. `tenant_admin` provides `business_scope_hierarchy`; its scope type is `office`

`tenant-admin/application/office-scope-hierarchy-port-adapter.ts` resolves
`("office", <uuid>)` against `awcms_offices`. The `tenant_admin` descriptor
declares `capabilities.provides: ["business_scope_hierarchy"]`,
`identity_access` changes `providedBy` from `organization_structure` (a ghost) to
`tenant_admin`, and `CAPABILITY_CONTRACT_VERSIONS` carries that capability for
the first time (`1.0.0`).

`optional: true` **stays**. A tenant with no offices at all must still work, and
its degradation is exactly as fail-closed as before. The relationship stays
SOURCE-level: the adapter arrives as an injected parameter at the composition
root, never as an import from `identity_access` — so no
Core-depends-on-Optional edge is born.

Other scope types stay `resolved: false`. That is the port contract, not an
oversight: a scope type nobody owns must not become an authorization scope.

### B. Only LIVE rows resolve, and that is an authorization decision

Soft-deleted → does not resolve. `status = 'inactive'` → does not resolve.
Owned by another tenant → does not resolve. Coverage that outlives the resource
it names is exactly the "stale hierarchy" case the port contract tells you to
reject; and a tenant that deactivates a branch has declared "this is not
operating" — leaving its assignments in force makes deactivation a cosmetic act.

Dead rows are skipped **anywhere in the chain**: a live office under a
deactivated parent gets a shorter ancestor chain, not borrowed coverage through
a resource its tenant has already switched off.

### C. Every limit REJECTS, never truncates

Cycles, a chain past the depth limit, and results past the count limit: all
three are `resolved: false`. Truncating is worse than rejecting here, because a
truncated list **still** claims `resolved: true` — the caller receives a coverage
answer computed from part of the graph with no signal at all that the rest
exists. Both traversals are a single recursive CTE carrying its own `path`
array; `updateOffice` cannot reparent an office, so a cycle can only arrive
through a direct write to the database — precisely the case where guessing is
most dangerous.

### D. The tenant-wide sentinel is trusted only when it names THIS TENANT

`resolveBusinessScopeFacts` emits a "covers everything" fact for
`scope_type = 'tenant'` without looking at `scope_id`. No supported path can
write such a row (the validator rejects the reserved scope type) — and that is
exactly why the check is added here: a row carrying it did not arrive through
the service, so it has not passed any validation at all. That fact is now only
born when `scope_id` = the tenant's own id; otherwise `resolved: false`
(fail-closed).

### E. The NO-OP adapter is deleted, not kept "just in case"

Once the composition root injects the office adapter, the NO-OP has no caller in
`src/`. This repo has already recorded the zero-caller function lesson twice
(ADR-0056 §A). Its behaviour is not lost: the office adapter returns
`resolved: false` for every scope type that is not `office`, so the
"fail-closed default" is still there — now as a branch inside the only adapter,
not as a file somebody has to choose.

### F. Zero migrations, zero new permissions

The table, columns, indexes, FKs, RLS, permission catalogue, and the route have
all existed since `sql/002`/`sql/017`/`sql/020`/`sql/027`. The only thing that
changes is who answers the resolution question.

## Consequences

- `POST /api/v1/identity/business-scope/assignments` has a success path for the
  first time. Office-scoped assignments can now be created, expire, be revoked,
  and **affect authorization** through `businessScopeFacts`.
- This widens a surface that was previously inert: an assignment can now grant
  coverage. Its guards are unchanged and still layered — the permission gate,
  self-grant rejection, assignment-time SoD evaluation, audit, effective dating
  - expiry, and `resolved: false` still denying high-risk actions.
- A route that wants scoped authorization must still **opt into it deliberately**
  (`resourceAttributes.requiredScopeType`/`.requiredScopeId` + passing
  `hierarchyPort`). No route does that today, so the behaviour of every existing
  endpoint is unchanged by this ADR.
- Jualanku's `merchant` ([ADR-0045](0045-jualanku-porting-awcms-system-of-record-astro-bff.md))
  finally has a foundation to stand on: it is modelled as a business scope, and
  the base resolver no longer rejects everything. The shape of the merchant
  scope itself still needs its own admission ADR.
- A richer hierarchy (legal entity, cost center) will later extend this adapter
  or replace its binding at the composition root — not revive the derived
  pathway ADR-0034 removed.

## Rejected alternatives

1. **Leave the NO-OP, write `organization_structure` first.** A new module with
   its own new hierarchy table, while `awcms_offices` already exists, already
   has FORCE RLS, already has an anti-cross-tenant composite FK, and already has
   an admin screen. That builds a SECOND hierarchy to justify one `providedBy`
   line.
2. **Revoke the entire business scope subsystem.** Symmetric with the revocation
   in ADR-0058 §C/§D — and wrong here: the machinery is complete (assignment,
   effective dating, expiry job, scope-aware SoD, decision log), the only thing
   missing is a provider; and ADR-0045 already depends on it.
3. **Resolve offices WITHOUT checking `status`/`deleted_at`.** Simpler, and it
   makes office soft-delete and deactivation have no effect on authorization —
   coverage that outlives its resource.
4. **Truncate results at the limit instead of rejecting.** An answer that is
   silently partly wrong, with a `resolved: true` covering it up (§C).
5. **Making `business_scope_hierarchy` a REQUIRED consumption.** It would force
   every deployment to have a provider and turn a resolution failure from a
   defined deny into a composition failure.
