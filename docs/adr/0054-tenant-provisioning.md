🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0054-tenant-provisioning.id.md)

# ADR-0054 — Tenant provisioning: one creation path, platform-gated

- **Status:** Accepted
- **Date:** 2026-08-02
- **Decision maker:** @ahliweb
- **Builds on:** [ADR-0053](0053-platform-scoped-permissions.md) (platform-scoped permissions) — provisioning is that primitive's second consumer, and the first thing that makes `multi` mode actually reachable
- **Related:** [ADR-0051](0051-admin-screens-consolidated-in-awcms.md) §Decision item 3 (navigation gate), [ADR-0046](0046-idn-admin-regions-module-admission.md)

## Context

Until this ADR, **a second tenant could not be created at all.**

`POST /api/v1/setup/initialize` claims the `awcms_setup_state` singleton, so it succeeds **exactly once**. No other path touches `awcms_tenants`. The consequences run deeper than "the feature does not exist yet":

- Every deployment is permanently single-tenant, and the `multi` branch of `resolveTenancyMode` (ADR-0053) is **unreachable**.
- The ADR-0053 platform gate **has never met a real second tenant** — it is correct by construction, but the condition it guards has never existed.
- The "SaaS ready" claim in [ADR-0035](0035-awcms-online-first-erp-saas-superset-repositioning.md) stands on a capability that had not been written.

## Decision

### 1. One tenant creation path, used by both

`createTenantWithOwner` is extracted out of `bootstrapPlatformTenant` and used by **both**. This is not tidiness — it is a security control.

The only thing that must not differ between the setup wizard and provisioning is `WHERE scope = 'tenant'` on the owner grant. A provisioning routine written standalone — the most natural way to build it — would carry a **copy** of the `INSERT` that, for almost the entire life of this repo, **did not have that filter**. The result: every customer holds authority over data served to other customers, and the diff passes review.

`grantPlatformScope` is a **parameter**, not a branch on "is this the first tenant?", so the answer is **stated at the call site** rather than inferred.

### 2. Directory and provisioning are both `scope: "platform"`

`create` is obvious: adding a tenant adds a **party** to the deployment.

`read` is too — and this is the one that is easy to miss. The directory endpoint lists **EVERY** tenant. A tenant-scoped version of it means any customer's owner can enumerate the platform's customer list, and **no RLS policy would object**, because `awcms_tenants` is by design a root table without RLS.

Because both are `platform`, `createTenantWithOwner` will never grant them to a provisioned tenant — **including one created through this very endpoint**. The platform cannot accidentally give birth to a rival to its own authority.

### 3. Duplicate `tenant_code`: pre-check AND savepoint

Both are needed, and the reason is not excessive caution. In PostgreSQL `23505` **aborts the transaction**: catching the error and carrying on does not work, and the commit that `withTenant` performs on a 4xx that is `return`ed fails along with it.

So: the `SELECT` answers the ordinary case without ever provoking an error, and the `SAVEPOINT` makes the **race** case recoverable — two callers with the same code both pass the `SELECT`, one hits the unique index, and `ROLLBACK TO SAVEPOINT` returns the transaction to a usable state instead of turning a user mistake into a 500.

### 4. Tenant context is restored before the audit is written

`createTenantWithOwner` sets `app.current_tenant_id` to the tenant **being created** (its tables are FORCE RLS), then restores it. Without that, the route's audit rows and idempotency records would land in the newborn tenant's partition — visible to the wrong party, invisible to the operator who acted.

### 5. The owner password never enters the idempotency hash

`computeRequestHash`'s output is **stored**. Hashing the password means putting a credential at rest in a table nobody considers credential storage. The hash is built from `tenantCode`/`tenantName`/`officeCode`/`ownerLoginIdentifier` alone — that already identifies the request.

## Consequences

- **Positive:**
  - `multi` mode becomes a real state, not a constant. The ADR-0053 gate now has a condition that can actually occur.
  - The next SaaS prerequisites stand on the right foundation: the provisioning path **inherits** the `scope` filter instead of repeating its defect.
  - The setup wizard and provisioning can no longer diverge on the most dangerous point.
- **Negative / accepted trade-offs:**
  - There is no other tenant lifecycle yet — suspend, rename, delete. Provisioning only. Adding them without deciding what "delete a tenant" means for the stored data would be a button whose consequences nobody can explain.
  - There are no quotas/plans/billing. This is not a SaaS control plane; it is the capability that must exist **before** a control plane can be built.
  - Cross-tenant operator audit remains an open ADR-0052 follow-up: the provisioning audit rows land in the platform tenant's log, which is correct, but the created tenant does not see the record of its own birth.
- **Neutral:**
  - Zero change for deployments that never provision a second tenant.

## Alternatives considered

- **An operator job (CLI) instead of an endpoint** — rejected. The `idn-regions:activate` precedent applies when **there is no subject to evaluate**; here there is one: the platform tenant. Provisioning is also work that is reasonably done through a screen, repeatedly, by people who are not shell operators.
- **Loosening the `awcms_setup_state` singleton** — rejected. The setup wizard is unauthenticated bootstrap; making it callable repeatedly means opening unauthenticated tenant creation. The singleton is precisely what guards it.
- **Copying the creation logic into the provisioning module** — rejected; see §Decision item 1. That is exactly the shape of the regression.
