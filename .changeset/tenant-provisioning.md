---
"awcms": minor
---

Add tenant provisioning: `GET`/`POST /api/v1/tenants` and the `/admin/tenants` screen, both PLATFORM-scoped.

Until this, a second tenant could not be created at all — `POST /api/v1/setup/initialize` claims the `awcms_setup_state` singleton, so it succeeds exactly once and nothing else touches `awcms_tenants`. Every deployment was permanently single-tenant, which also meant ADR-0053's `multi` tenancy mode was unreachable and its platform gate had never met a real second tenant.

`createTenantWithOwner` is extracted from `bootstrapPlatformTenant` and shared by both callers. That is a security control rather than tidiness: the one thing that must never differ between them is `WHERE scope = 'tenant'` on the owner grant, and an independently written provisioning routine would carry a copy of an `INSERT` that, for most of this repo's life, did not have that filter — handing every customer authority over every other customer's served data, in a diff that reviews cleanly. `grantPlatformScope` is a parameter rather than a branch on "is this the first tenant?", so the answer is stated at the call site instead of inferred.

Both permissions are platform-scoped. `create` obviously — adding a tenant adds a party to the deployment. `read` too, and that one is easy to miss: the directory lists EVERY tenant, so a tenant-scoped read would let any customer's owner enumerate the platform's customer list, and no RLS policy would object because `awcms_tenants` is deliberately the RLS-free root table. Because both are platform-scoped, a provisioned tenant never receives them — including the tenant created through this very endpoint.

A duplicate `tenant_code` needs both a pre-check and a savepoint: in PostgreSQL a `23505` aborts the transaction, so catching it and carrying on does not work, and the commit `withTenant` performs on a returned 4xx would fail too. The `SELECT` answers the ordinary case; the savepoint makes the racing case recoverable instead of a 500.

The owner password never enters the idempotency hash — that hash is stored, and a stored hash of a credential is a credential at rest.
