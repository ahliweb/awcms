# AWCMS API & Event Reference (generated)

> **GENERATED FILE — do not edit by hand.** Produced by
> `bun run api:docs:generate` (`scripts/api-docs-generate.ts`, Issue #182,
> epic #177) from the bundled contracts below. Edit the OpenAPI fragments
> (`openapi/awcms-public-api.src.yaml` + `openapi/modules/*.openapi.yaml`) or
> the AsyncAPI file, regenerate the OpenAPI bundle (`bun run openapi:bundle`),
> then regenerate this document — never edit it directly. `bun run api:docs:check`
> (part of `bun run check`) fails the build if this file is stale relative to
> the bundled contracts.

- **REST contract**: [`openapi/awcms-public-api.openapi.yaml`](../../openapi/awcms-public-api.openapi.yaml) — `info.version` `0.1.0`.
- **Event contract**: [`asyncapi/awcms-domain-events.asyncapi.yaml`](../../asyncapi/awcms-domain-events.asyncapi.yaml) — `info.version` `0.1.0`.

Contract version is independent SemVer, bumped only when the contract SHAPE
itself changes (ADR-0008 — see
[`docs/adr/0008-independent-contract-and-module-versioning.md`](../adr/0008-independent-contract-and-module-versioning.md)),
not on every package release.

**Version selection.** This document is generated 1:1 from the contract files
committed at the same git commit/tag you're viewing it at — there is no
interactive version switcher (no SaaS, no build-time JS required to read it
offline). To read the reference for a prior release, check out that release's
git tag, or regenerate locally with `bun run api:docs:generate` after checking
it out.

**Offline/LAN use.** This is a plain, self-contained Markdown file with no
external image/script/font references — open it with any text editor, `less`,
or a local Markdown previewer. No server or internet connection is required.

## Contract overview

**AWCMS Public API** — version `0.1.0`.

REST contract for the AWCMS foundation modules (tenant-admin, profile-identity,
identity-access, logging). Every endpoint that accepts a body enforces an
application-level size cap (default 128 KiB) independent of any reverse-proxy
limit; a body over the limit is rejected with `413 Payload Too Large` /
`PAYLOAD_TOO_LARGE`, using the same envelope as every other error response.

## Cross-cutting conventions

### Authentication model

| Scheme         | Kind                                 | Description                                                                                                                         |
| -------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `bearerAuth`   | http (bearer)                        | Opaque session token issued by POST /auth/login.                                                                                    |
| `tenantHeader` | apiKey (header: `X-AWCMS-Tenant-ID`) | Active tenant context for tenant-scoped API.                                                                                        |
| `syncHmac`     | apiKey (header: `X-AWCMS-Signature`) | HMAC-SHA256 signature over "<timestamp>.<body>" for machine-to-machine sync endpoints (with X-AWCMS-Node-ID and X-AWCMS-Timestamp). |

Every operation below states its own security requirement explicitly — either a
real requirement (usually `bearerAuth` + `tenantHeader` together) or
`none (public endpoint)`. There is no implicit "some endpoints just don't need
auth" — `bun run api:spec:check`'s public operation allow-list
(`ALLOWED_PUBLIC_OPERATIONS` in `scripts/api-spec-check.ts`) enforces this
stays reviewed.

### Tenant context

`tenantHeader` (`X-AWCMS-Tenant-ID`) carries the active tenant for every
tenant-scoped request; the server also sets PostgreSQL Row-Level Security
context from the authenticated session, never trusting the header alone as the
sole isolation boundary (defense in depth).

### Pagination

List endpoints use opaque **keyset** pagination via the `cursor` query
parameter — never large offsets. Pass the previous page's `nextCursor` value
back as `cursor`; omit it for the first page.

### Idempotency

High-risk mutations require the `Idempotency-Key` header — a replayed key
returns the original result rather than performing the mutation twice.

### Correlation & request IDs

`X-Correlation-ID` and `X-Request-ID` are optional caller-supplied trace IDs,
echoed back in every response's `meta` object
(`ApiMeta.correlationId`/`requestId`).

### Standard parameters

| Name            | Header/query                 | Required | Type   | Description                                                                          |
| --------------- | ---------------------------- | -------- | ------ | ------------------------------------------------------------------------------------ |
| `CorrelationId` | `X-Correlation-ID` (header)  | no       | string |                                                                                      |
| `SyncNodeId`    | `X-AWCMS-Node-ID` (header)   | yes      | string | Node code identifying the calling sync node (auto-registers on first contact).       |
| `SyncTimestamp` | `X-AWCMS-Timestamp` (header) | yes      | string | ISO-8601 timestamp of the request, validated against the allowed skew (anti-replay). |
| `SyncSignature` | `X-AWCMS-Signature` (header) | yes      | string | HMAC-SHA256 signature over "<timestamp>.<body>".                                     |

### Standard success envelope

Every `2xx` response body is a success-shaped object (`success: true` plus a
`data` payload typed to that operation's specific response schema):

```json
{
  "success": true,
  "data": "(operation-specific payload — see each operation's response)",
  "meta": {
    "correlationId": "00000000-0000-0000-0000-000000000000",
    "requestId": "00000000-0000-0000-0000-000000000000"
  }
}
```

### Standard error envelope

Every non-`2xx`/`3xx` response resolves to the same `ApiError` shape — never
an ad-hoc inline error shape (`bun run api:spec:check`'s standard error schema
check enforces this):

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "string",
    "details": [
      {
        "field": "string",
        "message": "string",
        "code": "string"
      }
    ]
  },
  "meta": {
    "correlationId": "00000000-0000-0000-0000-000000000000",
    "requestId": "00000000-0000-0000-0000-000000000000"
  }
}
```

**Standard error responses**:

| Response       | Schema                                 | Description                 |
| -------------- | -------------------------------------- | --------------------------- |
| `BadRequest`   | [`ApiError`](#standard-error-envelope) | Validation error.           |
| `Unauthorized` | [`ApiError`](#standard-error-envelope) | Missing or invalid session. |
| `Forbidden`    | [`ApiError`](#standard-error-envelope) | Access denied by RBAC/ABAC. |
| `NotFound`     | [`ApiError`](#standard-error-envelope) | Resource not found.         |

### Request body size limits

Every endpoint that accepts a body enforces an application-level size cap
(default 128 KiB) independent of any reverse-proxy limit; a body over the limit
is rejected with `413 Payload Too Large` / `PAYLOAD_TOO_LARGE`, using the same
envelope as every other error response.

## REST operations by module

## Foundation

Foundation and platform endpoints.

### `GET /api/v1/database/pool/health` — Database pool/work-class saturation, circuit-breaker state, and per-process capacity for this instance.

- **operationId**: `getDatabasePoolHealth`
- **Security**: none (public endpoint)

**Responses**

| Status | Description                                                         | Schema |
| ------ | ------------------------------------------------------------------- | ------ |
| 200    | Aggregate pool health (never exposes tenant data or query content). | object |

### `GET /api/v1/health` — Liveness/module-count probe.

- **operationId**: `getHealth`
- **Security**: none (public endpoint)

**Responses**

| Status | Description    | Schema |
| ------ | -------------- | ------ |
| 200    | Service is up. | object |

## Tenant Admin

Tenant, office, tenant settings, and the one-time setup wizard.

### `GET /api/v1/offices` — List offices for the current tenant — keyset-paginated, newest first.

- **operationId**: `listOffices`
- **Security**: bearerAuth + tenantHeader

**Parameters**

| Name     | In    | Required | Type   | Description                                                                                  |
| -------- | ----- | -------- | ------ | -------------------------------------------------------------------------------------------- |
| `cursor` | query | no       | string | Opaque cursor from a previous response's nextCursor. A malformed value is rejected with 400. |

**Responses**

| Status | Description                                                                                                                 | Schema                                 |
| ------ | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 200    | Live offices for the tenant (limit 100), newest first, with an opaque nextCursor for the next page (null on the last page). | object                                 |
| 400    | Validation error.                                                                                                           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                                                                                 | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                                                                                 | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/offices` — Create an office.

- **operationId**: `createOffice`
- **Security**: bearerAuth + tenantHeader

**Request body** (required): object

**Responses**

| Status | Description                                                                               | Schema                                 |
| ------ | ----------------------------------------------------------------------------------------- | -------------------------------------- |
| 201    | Office created.                                                                           | object                                 |
| 400    | Validation error.                                                                         | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                                               | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                                               | [`ApiError`](#standard-error-envelope) |
| 409    | officeCode is already taken by a live office in this tenant (OFFICE_CODE_ALREADY_EXISTS). | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/offices/{id}` — Fetch one office.

- **operationId**: `getOffice`
- **Security**: bearerAuth + tenantHeader

**Parameters**

| Name | In   | Required | Type          | Description |
| ---- | ---- | -------- | ------------- | ----------- |
| `id` | path | yes      | string (uuid) |             |

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Office detail.              | object                                 |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.         | [`ApiError`](#standard-error-envelope) |

### `PATCH /api/v1/offices/{id}` — Update an office.

- **operationId**: `updateOffice`
- **Security**: bearerAuth + tenantHeader

**Parameters**

| Name | In   | Required | Type          | Description |
| ---- | ---- | -------- | ------------- | ----------- |
| `id` | path | yes      | string (uuid) |             |

**Request body** (required): object

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Office updated.             | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.         | [`ApiError`](#standard-error-envelope) |

### `DELETE /api/v1/offices/{id}` — Soft-delete an office (audited, restorable).

- **operationId**: `deleteOffice`
- **Security**: bearerAuth + tenantHeader

Sets deleted_at/deleted_by/delete_reason; the office code is freed for reuse and the row remains restorable via POST /api/v1/offices/{id}/restore. Not a hard delete.

**Parameters**

| Name               | In     | Required | Type          | Description |
| ------------------ | ------ | -------- | ------------- | ----------- |
| `id`               | path   | yes      | string (uuid) |             |
| `X-Correlation-ID` | header | no       | string        |             |

**Request body** (optional): object

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Office soft-deleted.        | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.         | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/offices/{id}/restore` — Restore a soft-deleted office (audited).

- **operationId**: `restoreOffice`
- **Security**: bearerAuth + tenantHeader

Clears the delete stamps and records restored_at/restored_by. 404 when the id is not currently soft-deleted (idempotent-safe). 409 when a live office has since taken the same code.

**Parameters**

| Name               | In     | Required | Type          | Description |
| ------------------ | ------ | -------- | ------------- | ----------- |
| `id`               | path   | yes      | string (uuid) |             |
| `X-Correlation-ID` | header | no       | string        |             |

**Responses**

| Status | Description                                                               | Schema                                 |
| ------ | ------------------------------------------------------------------------- | -------------------------------------- |
| 200    | Office restored.                                                          | object                                 |
| 401    | Missing or invalid session.                                               | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                               | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.                                                       | [`ApiError`](#standard-error-envelope) |
| 409    | A live office already uses this office code (OFFICE_CODE_ALREADY_EXISTS). | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/settings` — Current tenant's settings.

- **operationId**: `getSettings`
- **Security**: bearerAuth + tenantHeader

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Tenant settings.            | object                                 |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |

### `PATCH /api/v1/settings` — Update tenant settings.

- **operationId**: `patchSettings`
- **Security**: bearerAuth + tenantHeader

**Request body** (required): object

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Updated tenant settings.    | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/setup/initialize` — Bootstrap the first tenant, owner, office, role, and access assignment. Rejected once already locked.

- **operationId**: `postSetupInitialize`
- **Security**: none (public endpoint)

**Request body** (required): object

**Responses**

| Status | Description              | Schema                                 |
| ------ | ------------------------ | -------------------------------------- |
| 200    | Tenant bootstrapped.     | object                                 |
| 400    | Validation error.        | [`ApiError`](#standard-error-envelope) |
| 403    | Setup already completed. | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/setup/status` — Whether the one-time setup wizard has already run.

- **operationId**: `getSetupStatus`
- **Security**: none (public endpoint)

**Responses**

| Status | Description       | Schema |
| ------ | ----------------- | ------ |
| 200    | Setup lock state. | object |

### `GET /api/v1/tenants` — List every tenant on the deployment (PLATFORM-scoped).

- **operationId**: `listTenants`
- **Security**: bearerAuth + tenantHeader

Gated by tenant_admin.tenant_provisioning.read, which is scope: platform (ADR-0053) — the chokepoint refuses it unless the acting tenant IS the platform tenant. Deliberately platform-scoped rather than tenant-scoped: this lists EVERY tenant, so a tenant-scoped read would let any customer enumerate the platform's customer list. The projection is narrow on purpose (code, name, status, created_at) — a directory answers who is on the deployment, not what is inside their tenant.

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `X-Correlation-ID` | header | no       | string |             |

**Responses**

| Status | Description                         | Schema                                 |
| ------ | ----------------------------------- | -------------------------------------- |
| 200    | The tenant directory, newest first. | object                                 |
| 401    | Missing or invalid session.         | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.         | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/tenants` — Provision a new tenant with its owner account (PLATFORM-scoped).

- **operationId**: `provisionTenant`
- **Security**: bearerAuth + tenantHeader

Gated by tenant_admin.tenant_provisioning.create, which is scope: platform. Creates the tenant, its head office, the owner profile/identity/tenant-user, the system `owner` role, and that role's grants — the SAME code path the setup wizard uses, so the `WHERE scope = 'tenant'` filter on those grants cannot drift between the two. A provisioned tenant NEVER receives platform-scoped permissions. `Idempotency-Key` required; audited in the platform tenant's log. Returns 409 when the tenant_code is taken.

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `Idempotency-Key`  | header | yes      | string |             |
| `X-Correlation-ID` | header | no       | string |             |

**Request body** (required): object

**Responses**

| Status | Description                                                                    | Schema                                 |
| ------ | ------------------------------------------------------------------------------ | -------------------------------------- |
| 200    | The provisioned tenant.                                                        | object                                 |
| 400    | Validation error.                                                              | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                                    | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                                    | [`ApiError`](#standard-error-envelope) |
| 409    | Idempotency-Key reused with a different request, or tenant_code already taken. | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/tenants/{id}/restore` — Lift a tenant suspension and resume service (PLATFORM-scoped).

- **operationId**: `restoreTenant`
- **Security**: bearerAuth + tenantHeader

ADR-0073. Gated by tenant_admin.tenant_lifecycle.restore — a SEPARATE permission from disable, on purpose: during an incident you want someone who can bring a customer back without being able to cut one off, the same split machine_credentials already draws between create and revoke. Restoring an already-active tenant returns 200 with changed=false.

**Parameters**

| Name               | In     | Required | Type          | Description |
| ------------------ | ------ | -------- | ------------- | ----------- |
| `id`               | path   | yes      | string (uuid) |             |
| `X-Correlation-ID` | header | no       | string        |             |

**Request body** (optional): object

**Responses**

| Status | Description                    | Schema                                 |
| ------ | ------------------------------ | -------------------------------------- |
| 200    | The tenant's resulting status. | object                                 |
| 400    | Validation error.              | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.    | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.    | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.            | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/tenants/{id}/suspend` — Suspend a tenant, stopping service (PLATFORM-scoped).

- **operationId**: `suspendTenant`
- **Security**: bearerAuth + tenantHeader

ADR-0073. Gated by tenant_admin.tenant_lifecycle.disable, which is scope: platform — suspending a tenant changes ANOTHER party's state, so no ordinary tenant may hold it however its roles are arranged. No revocation sweep runs and none is needed: the chokepoint checks the TENANT, not the credential, so every live session and every machine credential (which can live up to a year) is refused from its next request onward. Before this existed, suspending a tenant killed its public site instantly and left its admin sessions and machine credentials fully working. Re-suspending an already-suspended tenant returns 200 with changed=false and writes no transition row. Suspending the PLATFORM tenant returns 409: it would be refused every action including the one that lifts the suspension.

**Parameters**

| Name               | In     | Required | Type          | Description |
| ------------------ | ------ | -------- | ------------- | ----------- |
| `id`               | path   | yes      | string (uuid) |             |
| `X-Correlation-ID` | header | no       | string        |             |

**Request body** (optional): object

**Responses**

| Status | Description                                                                                                                                          | Schema                                 |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 200    | The tenant's resulting status.                                                                                                                       | object                                 |
| 400    | Validation error.                                                                                                                                    | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                                                                                                          | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                                                                                                          | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.                                                                                                                                  | [`ApiError`](#standard-error-envelope) |
| 409    | The PLATFORM tenant cannot be suspended (PLATFORM_TENANT_PROTECTED) — it would be refused every action, including the one that lifts the suspension. | [`ApiError`](#standard-error-envelope) |

## Tenant Domains

Tenant domain/subdomain mapping for host-based public routing (tenant_domain module, ported from awcms-micro) — tenant-scoped, RLS-protected CRUD over hostname mappings plus verification (dns_txt/dns_cname/file/manual) and primary-host selection. A hostname only serves a tenant once it is verified and active; the optional DNS provider adapter is env-gated and never stores a provider credential in the database. verify and set-primary change which host answers for a tenant, so both are ABAC-gated, idempotency-keyed, and audited.

### `GET /api/v1/tenant/domains` — List this tenant's domain/subdomain mappings

- **operationId**: `tenantDomainsList`
- **Security**: bearerAuth + tenantHeader

Gated by tenant_domain.domains.read. Non-deleted mappings only, keyset-paginated newest first (limit 100).

**Parameters**

| Name               | In     | Required | Type   | Description                                               |
| ------------------ | ------ | -------- | ------ | --------------------------------------------------------- |
| `cursor`           | query  | no       | string | Opaque keyset cursor from a previous page's `nextCursor`. |
| `X-Correlation-ID` | header | no       | string |                                                           |

**Responses**

| Status | Description                       | Schema                                 |
| ------ | --------------------------------- | -------------------------------------- |
| 200    | A page of tenant domain mappings. | object                                 |
| 400    | Validation error.                 | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.       | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.       | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/tenant/domains` — Add a tenant domain/subdomain mapping

- **operationId**: `tenantDomainsCreate`
- **Security**: bearerAuth + tenantHeader

Gated by tenant_domain.domains.create. A duplicate normalized hostname always returns a generic 409 (never reveals whether the hostname belongs to another tenant). Audited.

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `X-Correlation-ID` | header | no       | string |             |

**Request body** (required): [`CreateTenantDomainRequest`](#schema-createtenantdomainrequest)

**Responses**

| Status | Description                                                     | Schema                                 |
| ------ | --------------------------------------------------------------- | -------------------------------------- |
| 200    | Mapping created.                                                | object                                 |
| 400    | Validation error.                                               | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                     | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                     | [`ApiError`](#standard-error-envelope) |
| 409    | The hostname is already mapped to a tenant (HOSTNAME_CONFLICT). | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/tenant/domains/{id}` — Read one tenant domain mapping

- **operationId**: `tenantDomainsGet`
- **Security**: bearerAuth + tenantHeader

Gated by tenant_domain.domains.read. Unknown/cross-tenant/soft-deleted id all return a generic 404.

**Parameters**

| Name               | In     | Required | Type          | Description |
| ------------------ | ------ | -------- | ------------- | ----------- |
| `id`               | path   | yes      | string (uuid) |             |
| `X-Correlation-ID` | header | no       | string        |             |

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | The tenant domain mapping.  | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.         | [`ApiError`](#standard-error-envelope) |

### `PATCH /api/v1/tenant/domains/{id}` — Partially update a tenant domain mapping

- **operationId**: `tenantDomainsUpdate`
- **Security**: bearerAuth + tenantHeader

Gated by tenant_domain.domains.update. Idempotent by construction. `hostname`/`is_primary` are immutable here and `status` can never be set to `active` (use POST .../verify). Audited.

**Parameters**

| Name               | In     | Required | Type          | Description |
| ------------------ | ------ | -------- | ------------- | ----------- |
| `id`               | path   | yes      | string (uuid) |             |
| `X-Correlation-ID` | header | no       | string        |             |

**Request body** (required): [`UpdateTenantDomainRequest`](#schema-updatetenantdomainrequest)

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Mapping updated.            | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.         | [`ApiError`](#standard-error-envelope) |

### `DELETE /api/v1/tenant/domains/{id}` — Soft-delete a tenant domain mapping

- **operationId**: `tenantDomainsDelete`
- **Security**: bearerAuth + tenantHeader

Gated by tenant_domain.domains.delete. Reason-required soft delete; never hard-deletes, and frees the normalized hostname for reuse. Audited.

**Parameters**

| Name               | In     | Required | Type          | Description |
| ------------------ | ------ | -------- | ------------- | ----------- |
| `id`               | path   | yes      | string (uuid) |             |
| `X-Correlation-ID` | header | no       | string        |             |

**Request body** (required): [`DeleteTenantDomainRequest`](#schema-deletetenantdomainrequest)

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Mapping soft-deleted.       | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.         | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/tenant/domains/{id}/set-primary` — Set a tenant domain as the active primary

- **operationId**: `tenantDomainsSetPrimary`
- **Security**: bearerAuth + tenantHeader

Gated by tenant_domain.domains.set_primary. Requires Idempotency-Key. Atomically makes the domain this tenant's single primary, unsetting any previous primary. Only an `active` (verified) domain is eligible. Audited.

**Parameters**

| Name               | In     | Required | Type          | Description |
| ------------------ | ------ | -------- | ------------- | ----------- |
| `id`               | path   | yes      | string (uuid) |             |
| `Idempotency-Key`  | header | yes      | string        |             |
| `X-Correlation-ID` | header | no       | string        |             |

**Responses**

| Status | Description                                                                                                                                                                                                  | Schema                                 |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------- |
| 200    | Domain set as primary, or replay of a prior identical request.                                                                                                                                               | object                                 |
| 400    | Validation error.                                                                                                                                                                                            | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                                                                                                                                                                  | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                                                                                                                                                                  | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.                                                                                                                                                                                          | [`ApiError`](#standard-error-envelope) |
| 409    | Domain is not `active` (INVALID_STATUS_TRANSITION), a concurrent request already changed the primary (CONCURRENT_UPDATE), or the Idempotency-Key was reused with a different request (IDEMPOTENCY_CONFLICT). | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/tenant/domains/{id}/verify` — Verify a tenant domain (manual-first)

- **operationId**: `tenantDomainsVerify`
- **Security**: bearerAuth + tenantHeader

Gated by tenant_domain.domains.verify. Requires Idempotency-Key. Manual-first: flips status to `active` based on the row's own `verification_method`/`verification_record_*` — no outbound DNS/HTTP call. Audited.

**Parameters**

| Name               | In     | Required | Type          | Description |
| ------------------ | ------ | -------- | ------------- | ----------- |
| `id`               | path   | yes      | string (uuid) |             |
| `Idempotency-Key`  | header | yes      | string        |             |
| `X-Correlation-ID` | header | no       | string        |             |

**Responses**

| Status | Description                                                                                                                                           | Schema                                 |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 200    | Domain verified (status `active`), or replay of a prior identical request.                                                                            | object                                 |
| 400    | Validation error.                                                                                                                                     | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                                                                                                           | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                                                                                                           | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.                                                                                                                                   | [`ApiError`](#standard-error-envelope) |
| 409    | Cannot verify from the current status (INVALID_STATUS_TRANSITION), or the Idempotency-Key was reused with a different request (IDEMPOTENCY_CONFLICT). | [`ApiError`](#standard-error-envelope) |

## Identity & Access

Login identity, session authentication, and tenant user membership.

### `GET /api/v1/abac/policies` — List the current tenant's ABAC policies (seeded-empty by default; built-in rules apply).

- **operationId**: `listAbacPolicies`
- **Security**: bearerAuth + tenantHeader

**Responses**

| Status | Description                             | Schema                                 |
| ------ | --------------------------------------- | -------------------------------------- |
| 200    | The tenant's ABAC policies (limit 100). | object                                 |
| 400    | Validation error.                       | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.             | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.             | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/abac/policies` — Author a new ABAC policy for the current tenant (high-risk access-control change; audit-logged).

- **operationId**: `createAbacPolicy`
- **Security**: bearerAuth + tenantHeader

**Request body** (required): object

**Responses**

| Status | Description                                                              | Schema                                 |
| ------ | ------------------------------------------------------------------------ | -------------------------------------- |
| 201    | Policy created.                                                          | object                                 |
| 400    | Validation error.                                                        | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                              | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                              | [`ApiError`](#standard-error-envelope) |
| 409    | policyCode is already taken in this tenant (POLICY_CODE_ALREADY_EXISTS). | [`ApiError`](#standard-error-envelope) |

### `PATCH /api/v1/abac/policies/{id}` — Update an ABAC policy's effect/description and/or enable-disable it (high-risk; audit-logged).

- **operationId**: `updateAbacPolicy`
- **Security**: bearerAuth + tenantHeader

**Parameters**

| Name | In   | Required | Type          | Description |
| ---- | ---- | -------- | ------------- | ----------- |
| `id` | path | yes      | string (uuid) |             |

**Request body** (required): object

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Policy updated.             | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.         | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/access/assignments` — Assign a role to a tenant user (high-risk, audited, idempotent).

- **operationId**: `createRoleAssignment`
- **Security**: bearerAuth + tenantHeader

Grants a role to a tenant user. Idempotent at the DB unique index — a repeat assign returns 409. Gated on `identity_access.access_control.assign`.

**Request body** (required): object

**Responses**

| Status | Description                                       | Schema                                 |
| ------ | ------------------------------------------------- | -------------------------------------- |
| 200    | The created assignment.                           | object                                 |
| 400    | Validation error.                                 | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                       | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                       | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.                               | [`ApiError`](#standard-error-envelope) |
| 409    | The role is already assigned to this tenant user. | [`ApiError`](#standard-error-envelope) |

### `DELETE /api/v1/access/assignments` — Revoke a role from a tenant user (high-risk, audited).

- **operationId**: `deleteRoleAssignment`
- **Security**: bearerAuth + tenantHeader

Removes a role assignment. 404 when no such assignment exists. Gated on `identity_access.access_control.assign`.

**Request body** (required): object

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | The assignment was removed. | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.         | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/access/delegated-grants` — List delegated-access grants, live and historical.

- **operationId**: `listDelegatedGrants`
- **Security**: bearerAuth + tenantHeader

ADR-0090. Revoked and expired grants are listed too: "who could see our data last March, and until when" is the question an audit asks, and a list of only live grants answers a different one. The redemption code is never returned — its column is not even selected.

**Responses**

| Status | Description                           | Schema                                 |
| ------ | ------------------------------------- | -------------------------------------- |
| 200    | Every grant this tenant has approved. | object                                 |
| 401    | Missing or invalid session.           | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.           | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/access/delegated-grants` — Approve delegated access for a partner, at a role you choose.

- **operationId**: `approveDelegatedAccess`
- **Security**: bearerAuth + tenantHeader

ADR-0090. Mints a single-use redemption code, returned EXACTLY ONCE in this response and never readable again. The role must already exist in this tenant and may not be a system role, so `owner` cannot be delegated; the grant may last at most 30 days. Guarded by `partner_access.assign`, because what this does is hand a role to somebody outside the organisation.

**Request body** (required): object

**Responses**

| Status | Description                                                 | Schema                                 |
| ------ | ----------------------------------------------------------- | -------------------------------------- |
| 201    | Approved. `accessCode` appears here and nowhere else, ever. | object                                 |
| 400    | Validation error.                                           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                 | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                 | [`ApiError`](#standard-error-envelope) |
| 404    | No such partner engagement, or no such role in this tenant. | [`ApiError`](#standard-error-envelope) |

### `DELETE /api/v1/access/delegated-grants/{id}` — Revoke delegated access immediately.

- **operationId**: `revokeDelegatedAccess`
- **Security**: bearerAuth + tenantHeader

ADR-0090. The grant dies, the membership it printed goes inactive, and every session on it is revoked — one transaction, no ordering that can leave one of the three behind. A grant that was already revoked answers 404, which is all the caller is owed.

**Parameters**

| Name     | In    | Required | Type          | Description |
| -------- | ----- | -------- | ------------- | ----------- |
| `id`     | path  | yes      | string (uuid) |             |
| `reason` | query | no       | string        |             |

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Revoked.                    | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.         | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/access/evaluate` — Reflect the ABAC decision for the caller's own access on a hypothetical request (Issue

- **operationId**: `accessEvaluate`
- **Security**: bearerAuth + tenantHeader

Returns what `evaluateAccess` would decide for the CALLER'S OWN access against the tenant's current active ABAC policies. Requires a valid session but no specific permission. The decision is recorded to the ABAC decision log.

**Request body** (required): [`AccessEvaluateRequest`](#schema-accessevaluaterequest)

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | The evaluated decision.     | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/access/machine-credentials` — List this tenant's machine credentials (never their secrets).

- **operationId**: `accessListMachineCredentials`
- **Security**: bearerAuth + tenantHeader

Gated on `identity_access.machine_credentials.read`. Returns derived `active`/`expired`/`revoked` status plus `lastUsedAt`, so a leak can be traced without any secret material leaving the server.

**Responses**

| Status | Description                                                 | Schema                                 |
| ------ | ----------------------------------------------------------- | -------------------------------------- |
| 200    | The tenant's machine credentials, newest first (limit 200). | object                                 |
| 401    | Missing or invalid session.                                 | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                 | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/access/machine-credentials` — Issue a machine credential (high-risk; audit-logged).

- **operationId**: `accessIssueMachineCredential`
- **Security**: bearerAuth + tenantHeader

Mints a bearer for a non-human caller, bound to an existing tenant user (a service account), and returns the plaintext token EXACTLY ONCE — no endpoint can return it again.

The credential AUTHENTICATES only: every request it makes still passes module-enabled, RBAC, ABAC (default-deny) and SoD. `allowedPermissionKeys` NARROWS — effective permissions are the intersection with what the service account holds, so granting that account another role never widens an already-issued credential.

TWO CLASSES, TWO PERMISSIONS. Omit `allowedWriteActions` and this is the read-only credential of ADR-0049 §3, gated on `identity_access.machine_credentials.create`; requests it makes are refused unless the action is `read`. Name write actions and it is the ADR-0092 write class, gated on `identity_access.machine_credentials_write.create` INSTEAD — a separate key so that opening this class does not hand write-minting authority to every role that already holds `create`.

The write class is narrower in every other direction: only actions in the code ceiling (`create`, `update` — never a high-risk one), at least one `allowedIpCidrs` entry, at most 30 days, and a request whose caller IP is unknown is refused rather than exempted.

Not idempotency-keyed, deliberately: replaying the response would mean persisting the plaintext token.

**Request body** (required): [`IssueMachineCredentialRequest`](#schema-issuemachinecredentialrequest)

**Responses**

| Status | Description                                                                                              | Schema                                 |
| ------ | -------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 201    | The credential, plus its plaintext token (shown once).                                                   | object                                 |
| 401    | Missing or invalid session.                                                                              | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                                                              | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.                                                                                      | [`ApiError`](#standard-error-envelope) |
| 413    | Request body exceeded the endpoint's size ceiling.                                                       | [`ApiError`](#standard-error-envelope) |
| 422    | The issuance request failed validation (VALIDATION_FAILED); `error.details` lists every offending field. | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/access/machine-credentials/{id}/revoke` — Revoke a machine credential (high-risk; audit-logged).

- **operationId**: `accessRevokeMachineCredential`
- **Security**: bearerAuth + tenantHeader

Effective on the credential's very next request, because authentication reads the same row. Gated on `identity_access.machine_credentials.revoke` — separate from `create` so a leak can be stopped by someone who cannot mint one. Re-revoking returns 409 rather than a silent success.

**Responses**

| Status | Description                                          | Schema                                 |
| ------ | ---------------------------------------------------- | -------------------------------------- |
| 200    | The revoked credential.                              | object                                 |
| 401    | Missing or invalid session.                          | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                          | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.                                  | [`ApiError`](#standard-error-envelope) |
| 409    | The credential is already revoked (ALREADY_REVOKED). | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/access/partner-engagements` — List the partners that reach this tenant.

- **operationId**: `listPartnerEngagements`
- **Security**: bearerAuth + tenantHeader

ADR-0089. The customer's authoritative view of every partnership into their own tenant. The partner's mirror of this (`GET /api/v1/partner/tenants`) is a convenience served by a narrow SECURITY DEFINER function; this one is the record.

**Responses**

| Status | Description                            | Schema                                 |
| ------ | -------------------------------------- | -------------------------------------- |
| 200    | The partnerships reaching this tenant. | object                                 |
| 401    | Missing or invalid session.            | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.            | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/access/partner-engagements` — Engage a partner for this tenant.

- **operationId**: `engagePartner`
- **Security**: bearerAuth + tenantHeader

ADR-0089 — the customer initiates, always. There is no partner-facing counterpart: a partner that could insert its own engagement would be handing itself reach. "Not a registered partner" and "no such tenant" answer identically, so the endpoint cannot be swept as a directory of the platform's partners.

**Request body** (required): object

**Responses**

| Status | Description                                                                                                               | Schema                                 |
| ------ | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 201    | The partner now reaches this tenant.                                                                                      | object                                 |
| 400    | Validation error.                                                                                                         | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                                                                               | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                                                                               | [`ApiError`](#standard-error-envelope) |
| 404    | No such partner. Deliberately indistinguishable from "no such tenant" and from "that tenant is not a registered partner". | [`ApiError`](#standard-error-envelope) |
| 409    | That partner is already engaged for this tenant.                                                                          | [`ApiError`](#standard-error-envelope) |

### `DELETE /api/v1/access/partner-engagements/{id}` — Sever a partnership, killing every grant under it.

- **operationId**: `severPartnerEngagement`
- **Security**: bearerAuth + tenantHeader

ADR-0089/ADR-0090. Every live delegated-access grant under the partnership is revoked in the SAME transaction — memberships deactivated, sessions killed. The ordering is enforced by a foreign key rather than by remembering: deleting the engagement while a grant still names it fails.

**Parameters**

| Name | In   | Required | Type          | Description |
| ---- | ---- | -------- | ------------- | ----------- |
| `id` | path | yes      | string (uuid) |             |

**Responses**

| Status | Description                                         | Schema                                 |
| ------ | --------------------------------------------------- | -------------------------------------- |
| 200    | Severed, with the number of grants revoked with it. | object                                 |
| 400    | Validation error.                                   | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                         | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                         | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.                                 | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/access/policies` — List the tenant's dynamic ABAC (DSL) policies (Issue

- **operationId**: `accessListAbacPolicies`
- **Security**: bearerAuth + tenantHeader

Reads every stored DSL policy for the tenant (active and inactive). Gated on `identity_access.abac_policies.read`.

**Responses**

| Status | Description                     | Schema                                 |
| ------ | ------------------------------- | -------------------------------------- |
| 200    | The tenant's DSL ABAC policies. | object                                 |
| 400    | Validation error.               | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.     | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.     | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/access/policies` — Author a new dynamic ABAC (DSL) policy (high-risk; audit-logged; only valid DSL is stored).

- **operationId**: `accessCreateAbacPolicy`
- **Security**: bearerAuth + tenantHeader

Validates the condition DSL fail-closed before any write, so an invalid policy can never be stored or enabled. Created disabled by default unless `isActive:true`. Gated on `identity_access.abac_policies.configure`.

**Request body** (required): [`AbacDslPolicyWriteRequest`](#schema-abacdslpolicywriterequest)

**Responses**

| Status | Description                                                       | Schema                                 |
| ------ | ----------------------------------------------------------------- | -------------------------------------- |
| 200    | The created policy.                                               | object                                 |
| 400    | Validation error.                                                 | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                       | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                       | [`ApiError`](#standard-error-envelope) |
| 409    | A policy with that policyCode already exists (RESOURCE_CONFLICT). | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/access/policies/{id}` — Read one dynamic ABAC (DSL) policy (Issue

- **operationId**: `accessGetAbacPolicy`
- **Security**: bearerAuth + tenantHeader

Gated on `identity_access.abac_policies.read`. 404 when the policy does not exist in this tenant.

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | The policy.                 | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.         | [`ApiError`](#standard-error-envelope) |

### `PUT /api/v1/access/policies/{id}` — Replace a dynamic ABAC (DSL) policy (high-risk; audit-logged; only valid DSL is stored).

- **operationId**: `accessUpdateAbacPolicy`
- **Security**: bearerAuth + tenantHeader

Validates the condition DSL fail-closed before any write. Gated on `identity_access.abac_policies.configure`. 404 when the policy does not exist; 409 on a policyCode collision.

**Request body** (required): [`AbacDslPolicyWriteRequest`](#schema-abacdslpolicywriterequest)

**Responses**

| Status | Description                                                       | Schema                                 |
| ------ | ----------------------------------------------------------------- | -------------------------------------- |
| 200    | The updated policy.                                               | object                                 |
| 400    | Validation error.                                                 | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                       | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                       | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.                                               | [`ApiError`](#standard-error-envelope) |
| 409    | A policy with that policyCode already exists (RESOURCE_CONFLICT). | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/access/policies/{id}/disable` — Disable a dynamic ABAC (DSL) policy (high-risk; audit-logged).

- **operationId**: `accessDisableAbacPolicy`
- **Security**: bearerAuth + tenantHeader

Marks the policy inactive so the evaluator stops applying it (deactivate-not-delete). Gated on `identity_access.abac_policies.configure`. 404 when the policy does not exist.

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | The disabled policy.        | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.         | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/access/policies/{id}/enable` — Enable a dynamic ABAC (DSL) policy (high-risk; audit-logged).

- **operationId**: `accessEnableAbacPolicy`
- **Security**: bearerAuth + tenantHeader

Marks the policy active so the evaluator applies it. Gated on `identity_access.abac_policies.configure`. 404 when the policy does not exist.

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | The enabled policy.         | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.         | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/access/policies/simulate` — Read-only ABAC decision simulation/preview (Issue

- **operationId**: `accessSimulateAbacPolicy`
- **Security**: bearerAuth + tenantHeader

Returns what `evaluateAccess` would decide for a hypothetical subject/request/environment against the tenant's active policies, plus a per-policy structural trace (no attribute VALUES, no PII). Writes no decision log. Gated on `identity_access.abac_policies.analyze`; simulating a DIFFERENT existing tenant user additionally requires `identity_access.access_control.read`.

**Request body** (required): [`AbacSimulationRequest`](#schema-abacsimulationrequest)

**Responses**

| Status | Description                                  | Schema                                 |
| ------ | -------------------------------------------- | -------------------------------------- |
| 200    | The simulated decision and per-policy trace. | object                                 |
| 400    | Validation error.                            | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                  | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                  | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/auth/delegated-access/redeem` — Exchange a delegated-access code for a membership in the customer's tenant.

- **operationId**: `redeemDelegatedAccess`
- **Security**: bearerAuth + tenantHeader

ADR-0090. Requires a LIVE SESSION in the caller's own tenant: the code authenticates nothing, and what proves who is redeeming is the global principal behind that session. It returns a MEMBERSHIP, not a session — ordinary sign-in or `POST /api/v1/auth/session/switch` works afterwards, because afterwards they are a member. Minting a session here would mean a second copy of the target tenant's entry policy, and a second copy is where the MFA gate goes quietly missing. Every refusal answers 404.

**Parameters**

| Name                | In     | Required | Type          | Description                                                 |
| ------------------- | ------ | -------- | ------------- | ----------------------------------------------------------- |
| `X-AWCMS-Tenant-ID` | header | yes      | string (uuid) | The caller's OWN tenant — the one their session belongs to. |

**Request body** (required): object

**Responses**

| Status | Description                                                                                                                                                  | Schema                                 |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------- |
| 200    | The caller is now a delegated member of the target tenant.                                                                                                   | object                                 |
| 400    | Validation error.                                                                                                                                            | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                                                                                                                  | [`ApiError`](#standard-error-envelope) |
| 404    | One shape for every refusal: unknown code, expired grant, revoked grant, wrong tenant, membership refused. A holder must not learn whether the code is real. | [`ApiError`](#standard-error-envelope) |
| 429    | Too many attempts from this source. Carries `retry-after`.                                                                                                   | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/auth/invitations/{token}` — Preview an invitation (public, token-bearing).

- **operationId**: `getAuthInvitationPreview`
- **Security**: none (public endpoint)

Returns the tenant's name, the inviter's name, and the expiry — and **never the invited address**. Whoever legitimately holds this link read that address in their own mailbox; whoever holds a stolen one did not.
Unknown, revoked, already-accepted, expired and belonging-to-another-tenant all answer one identical `404`. **404, not 410**: `410 Gone` would tell a token holder that the token was once valid, which is an oracle worth having if you are working through addresses you scraped. The real reason is written to the tenant's audit trail, never to the response.
Rate-limited through the shared limiter's source ceiling before any database work.

**Parameters**

| Name                | In     | Required | Type          | Description |
| ------------------- | ------ | -------- | ------------- | ----------- |
| `X-Correlation-ID`  | header | no       | string        |             |
| `X-AWCMS-Tenant-ID` | header | yes      | string (uuid) |             |
| `token`             | path   | yes      | string        |             |

**Responses**

| Status | Description                                         | Schema                                 |
| ------ | --------------------------------------------------- | -------------------------------------- |
| 200    | The invitation is live and may be accepted.         | object                                 |
| 400    | Validation error.                                   | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.                                 | [`ApiError`](#standard-error-envelope) |
| 429    | Rate limited (RATE_LIMITED). Carries `retry-after`. | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/auth/invitations/{token}/accept` — Accept an invitation, creating the membership (public, token-bearing).

- **operationId**: `postAuthInvitationAccept`
- **Security**: none (public endpoint)

Creates the profile, identity and tenant user, and materializes the roles the invitation carried. Those roles are read from `awcms_invitation_policies` — **never** from this request body, which declares no privilege field at all. A role that has since become `is_system`, been soft-deleted, or left the catalogue refuses the whole acceptance rather than granting a subset.
**No session is issued.** The invitee signs in at `/login` afterwards, so the tenant's MFA policy, its SSO-only policy, and the login rate limit all still stand between the new account and a signed-in browser.
Every refusal — unknown, revoked, already accepted, expired, wrong tenant, or an address that acquired an account in the meantime — answers the same `404`.
Turnstile-gated with its own action, so a token solved on any other form cannot be spent here.

**Parameters**

| Name                | In     | Required | Type          | Description |
| ------------------- | ------ | -------- | ------------- | ----------- |
| `X-Correlation-ID`  | header | no       | string        |             |
| `X-AWCMS-Tenant-ID` | header | yes      | string (uuid) |             |
| `token`             | path   | yes      | string        |             |

**Request body** (required): object

**Responses**

| Status | Description                                                   | Schema                                 |
| ------ | ------------------------------------------------------------- | -------------------------------------- |
| 200    | The membership exists. Sign in at /login.                     | object                                 |
| 400    | Validation error.                                             | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.                                           | [`ApiError`](#standard-error-envelope) |
| 413    | The request body exceeded the size limit (PAYLOAD_TOO_LARGE). | [`ApiError`](#standard-error-envelope) |
| 429    | Rate limited (RATE_LIMITED). Carries `retry-after`.           | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/auth/login` — Authenticate with a login identifier and password; issues a session token.

- **operationId**: `postAuthLogin`
- **Security**: none (public endpoint)

**Parameters**

| Name                | In     | Required | Type          | Description |
| ------------------- | ------ | -------- | ------------- | ----------- |
| `X-AWCMS-Tenant-ID` | header | yes      | string (uuid) |             |

**Request body** (required): object

**Responses**

| Status | Description                               | Schema                                 |
| ------ | ----------------------------------------- | -------------------------------------- |
| 200    | Session issued.                           | object                                 |
| 400    | Validation error.                         | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.               | [`ApiError`](#standard-error-envelope) |
| 429    | Too many login attempts from this source. | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/auth/logout` — Revoke the current session.

- **operationId**: `postAuthLogout`
- **Security**: bearerAuth + tenantHeader

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Logged out.                 | object                                 |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/auth/me` — Current authenticated identity.

- **operationId**: `getAuthMe`
- **Security**: bearerAuth + tenantHeader

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Current identity.           | object                                 |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/auth/mfa/admin/reset` — Administratively reset another user's MFA factor (requires reason).

- **operationId**: `postAuthMfaAdminReset`
- **Security**: bearerAuth + tenantHeader

**Request body** (required): object

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Target MFA reset.           | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.         | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/auth/mfa/policy` — Read the tenant MFA enforcement policy.

- **operationId**: `getAuthMfaPolicy`
- **Security**: bearerAuth + tenantHeader

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Tenant MFA policy.          | object                                 |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |

### `PUT /api/v1/auth/mfa/policy` — Set the tenant MFA enforcement level.

- **operationId**: `putAuthMfaPolicy`
- **Security**: bearerAuth + tenantHeader

**Request body** (required): object

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Policy updated.             | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/auth/mfa/recovery-codes/regenerate` — Invalidate existing recovery codes and issue a fresh single-use set.

- **operationId**: `postAuthMfaRecoveryRegenerate`
- **Security**: bearerAuth + tenantHeader

**Responses**

| Status | Description                    | Schema                                 |
| ------ | ------------------------------ | -------------------------------------- |
| 200    | New recovery codes shown once. | object                                 |
| 401    | Missing or invalid session.    | [`ApiError`](#standard-error-envelope) |
| 409    | No active MFA.                 | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/auth/mfa/status` — Current identity's MFA enrollment state.

- **operationId**: `getAuthMfaStatus`
- **Security**: bearerAuth + tenantHeader

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | MFA status.                 | object                                 |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/auth/mfa/step-up` — Raise the current session to aal2 for high-risk actions.

- **operationId**: `postAuthMfaStepUp`
- **Security**: bearerAuth + tenantHeader

**Request body** (required): object

**Responses**

| Status | Description                                                 | Schema                                 |
| ------ | ----------------------------------------------------------- | -------------------------------------- |
| 200    | Session stepped up to aal2 (rotated when rising from aal1). | object                                 |
| 400    | Validation error.                                           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                 | [`ApiError`](#standard-error-envelope) |
| 429    | Too many verification attempts from this source.            | [`ApiError`](#standard-error-envelope) |
| 500    | MFA misconfigured.                                          | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/auth/mfa/totp/disable` — Self-service disable of the current identity's MFA factor.

- **operationId**: `postAuthMfaDisable`
- **Security**: bearerAuth + tenantHeader

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | MFA disabled.               | object                                 |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 409    | No active MFA to disable.   | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/auth/mfa/totp/enroll/start` — Begin TOTP enrollment; returns a one-time secret and otpauth URI.

- **operationId**: `postAuthMfaEnrollStart`
- **Security**: bearerAuth + tenantHeader

Authorized by EITHER a live session OR an enrollment grant (X-AWCMS-MFA-Enrollment-Token) issued by POST /auth/login when a tenant policy requires MFA for an identity without a factor.

**Parameters**

| Name                           | In     | Required | Type   | Description                                                                                            |
| ------------------------------ | ------ | -------- | ------ | ------------------------------------------------------------------------------------------------------ |
| `X-AWCMS-MFA-Enrollment-Token` | header | no       | string | Enrollment grant token from a login that returned MFA_ENROLLMENT_REQUIRED; used in place of a session. |

**Responses**

| Status | Description                                            | Schema                                 |
| ------ | ------------------------------------------------------ | -------------------------------------- |
| 200    | Pending factor created; secret shown once.             | object                                 |
| 401    | Missing or invalid session.                            | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                            | [`ApiError`](#standard-error-envelope) |
| 409    | MFA already active for this account.                   | [`ApiError`](#standard-error-envelope) |
| 500    | MFA encryption key is missing/invalid (misconfigured). | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/auth/mfa/totp/enroll/verify` — Confirm a pending TOTP enrollment; activates the factor and returns recovery codes.

- **operationId**: `postAuthMfaEnrollVerify`
- **Security**: bearerAuth + tenantHeader

Authorized by EITHER a live session OR an enrollment grant. When authorized via an enrollment grant (a login that returned MFA_ENROLLMENT_REQUIRED), the grant is consumed and a fresh aal2 session token is returned.

**Parameters**

| Name                           | In     | Required | Type   | Description                                                                             |
| ------------------------------ | ------ | -------- | ------ | --------------------------------------------------------------------------------------- |
| `X-AWCMS-MFA-Enrollment-Token` | header | no       | string | Enrollment grant token; used in place of a session to complete the "must enroll" login. |

**Request body** (required): object

**Responses**

| Status | Description                                                                                                                         | Schema                                 |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 200    | Factor activated; recovery codes shown once. token/expiresAt/assuranceLevel are present only when enrolled via an enrollment grant. | object                                 |
| 400    | Validation error.                                                                                                                   | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                                                                                         | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                                                                                         | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.                                                                                                                 | [`ApiError`](#standard-error-envelope) |
| 500    | MFA misconfigured.                                                                                                                  | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/auth/mfa/totp/verify` — Complete a login paused with MFA_REQUIRED by submitting a TOTP or recovery code.

- **operationId**: `postAuthMfaVerify`
- **Security**: none (public endpoint)

Authenticated by possession of the mfaChallengeToken from POST /auth/login, not by a session. On success issues an aal2 session.

**Parameters**

| Name                | In     | Required | Type          | Description |
| ------------------- | ------ | -------- | ------------- | ----------- |
| `X-AWCMS-Tenant-ID` | header | yes      | string (uuid) |             |

**Request body** (required): object

**Responses**

| Status | Description                                      | Schema                                 |
| ------ | ------------------------------------------------ | -------------------------------------- |
| 200    | MFA verified; aal2 session issued.               | object                                 |
| 400    | Validation error.                                | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                      | [`ApiError`](#standard-error-envelope) |
| 429    | Too many verification attempts from this source. | [`ApiError`](#standard-error-envelope) |
| 500    | MFA misconfigured.                               | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/auth/password/change` — Change your own password while signed in (self-service, no permission).

- **operationId**: `changeOwnAuthPassword`
- **Security**: bearerAuth + tenantHeader

The counterpart to /api/v1/auth/password/reset: that endpoint serves someone who CANNOT sign in and proves control of a mailbox, this one serves someone who is signed in and proves control of the credential. Self-service by construction — the subject is the session bearer and the route accepts no parameter naming anybody else.
A fresh second factor is required ONLY from callers who have one enrolled. Requiring aal2 unconditionally would permanently prevent every user without MFA from changing their password, and the users most likely to need to are the ones who just learned it leaked. The current password is the re-authentication for everyone; the second factor is additional for those who can supply it.
On success the password is replaced, the lockout counters are cleared (whoever supplied the current password proved control of the credential), and every OTHER session of that identity is revoked — the calling one survives, because a password change that signs you out of the tab you changed it in reads as a failure and the security property is unaffected.
Rate limited on the SOURCE despite being authenticated: `currentPassword` is a guessable secret, so this is a credential-guessing surface whenever a session is used by someone who does not know the password behind it. An identifier-keyed bucket would instead let anyone reaching the endpoint hold one person's own password change hostage.
Audited on both the success and the failure, with the device shape and IP pseudonym, and with no password-shaped attribute — not even a length.

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `X-Correlation-ID` | header | no       | string |             |

**Request body** (required): object

**Responses**

| Status | Description                                                                                                     | Schema                                 |
| ------ | --------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 200    | Password changed; the other sessions were revoked.                                                              | object                                 |
| 400    | Validation failed, or currentPassword did not match (INVALID_CREDENTIALS).                                      | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                                                                     | [`ApiError`](#standard-error-envelope) |
| 403    | MFA is enrolled and this session is not currently stepped up (STEP_UP_REQUIRED).                                | [`ApiError`](#standard-error-envelope) |
| 409    | The tenant policy signs this identity in through SSO; there is no password to change (PASSWORD_LOGIN_DISABLED). | [`ApiError`](#standard-error-envelope) |
| 429    | Too many password change attempts from this source.                                                             | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/auth/password/forgot` — Request a password reset link (account-enumeration-safe).

- **operationId**: `postAuthPasswordForgot`
- **Security**: none (public endpoint)

Always returns the same 200 body regardless of whether the identifier matched an eligible account. An unknown identifier, an inactive identity or tenant-user, an identity the tenant has taken off password login, and a successfully queued email are indistinguishable to the caller by response body, status code, or error code. Rate limited per client IP and tenant.

**Parameters**

| Name                | In     | Required | Type          | Description |
| ------------------- | ------ | -------- | ------------- | ----------- |
| `X-AWCMS-Tenant-ID` | header | yes      | string (uuid) |             |

**Request body** (required): object

**Responses**

| Status | Description                                                     | Schema                                 |
| ------ | --------------------------------------------------------------- | -------------------------------------- |
| 200    | Request accepted. Says nothing about whether an account exists. | object                                 |
| 400    | Validation error.                                               | [`ApiError`](#standard-error-envelope) |
| 429    | Too many password reset requests from this source.              | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/auth/password/reset` — Complete a password reset with a single-use token.

- **operationId**: `postAuthPasswordReset`
- **Security**: none (public endpoint)

On success the password is replaced, the lockout counters are cleared, the token is burned, and every session belonging to that identity is revoked. Every rejection — unknown token, expired, already used, the identity deactivated since issue, or password login disabled for it — returns the same `PASSWORD_RESET_INVALID` error, so the endpoint cannot be used to fingerprint the state of a token.

**Parameters**

| Name                | In     | Required | Type          | Description |
| ------------------- | ------ | -------- | ------------- | ----------- |
| `X-AWCMS-Tenant-ID` | header | yes      | string (uuid) |             |

**Request body** (required): object

**Responses**

| Status | Description                                        | Schema                                 |
| ------ | -------------------------------------------------- | -------------------------------------- |
| 200    | Password changed and all sessions revoked.         | object                                 |
| 400    | Validation error.                                  | [`ApiError`](#standard-error-envelope) |
| 429    | Too many password reset attempts from this source. | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/auth/register` — Submit a self-registration request for admin review.

- **operationId**: `postAuthRegister`
- **Security**: none (public endpoint)

Records a request; it NEVER creates an account. Accepts no password and no privilege field — approval creates the account with an unusable credential and emails a password-reset link. Returns `404` when `AUTH_SELF_REGISTRATION_ENABLED` is not `true`, indistinguishable from a route that does not exist. When enabled, an address that already has an account, an address with a request already pending, and a freshly recorded request all return the identical 200.

**Parameters**

| Name                | In     | Required | Type          | Description |
| ------------------- | ------ | -------- | ------------- | ----------- |
| `X-AWCMS-Tenant-ID` | header | yes      | string (uuid) |             |

**Request body** (required): object

**Responses**

| Status | Description                                                                                        | Schema                                 |
| ------ | -------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 200    | Request accepted. Says nothing about whether the address is already registered or already pending. | object                                 |
| 400    | Validation error.                                                                                  | [`ApiError`](#standard-error-envelope) |
| 404    | Self-registration is not enabled for this deployment.                                              | [`ApiError`](#standard-error-envelope) |
| 429    | Too many registration attempts from this source.                                                   | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/auth/session` — Introspect the calling session — safe claims only (for a cross-origin BFF).

- **operationId**: `introspectAuthSession`
- **Security**: bearerAuth + tenantHeader

Cross-origin session introspection (ADR-0045 §3, ADR-0049 §7). Intended for `awcms-astro`'s BFF, which holds the session token server-side; a browser never calls it directly.

Self-service: authorized by holding the session, not by a permission. Returns ONLY claims a portal header needs — never a token, token hash, password state, MFA secret/recovery code, or a raw email/phone identifier.

Anti-oracle: a missing bearer, an unknown/expired/revoked session, a deactivated identity, and a machine credential presented here all produce the SAME 401. Rate-limited per source; `Cache-Control: private, no-store` on every path.

**Responses**

| Status | Description                                                                                        | Schema                                 |
| ------ | -------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 200    | Safe claims for the live session.                                                                  | object                                 |
| 400    | Validation error.                                                                                  | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                                                        | [`ApiError`](#standard-error-envelope) |
| 429    | Too many introspection requests from this source (RATE_LIMITED); `Retry-After` carries the window. | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/auth/session-handoff/issue` — Mint a one-time code letting a registered BFF obtain a session as the caller.

- **operationId**: `issueSessionHandoffCode`
- **Security**: bearerAuth + tenantHeader

ADR-0050. The authenticated human asks for a short-lived (≤60 second), single-use code; a registered BFF then spends it server-to-server at `/api/v1/auth/session-handoff/redeem` and receives a session token for that person.

**Self-service, not permission-gated.** The identity and assurance level come from the presented session, never from the body, so the caller can only ever mint a code for themselves. There is no permission that answers "may I hand my own session to a client I am already logged into", and inventing one would deny everyone including the tenant owner. Same reasoning as `GET /api/v1/auth/session`.

What constrains it is the CLIENT registry: a code is only issued for a registered, enabled client, bound to a `redirectUri` on that client's **exact-match** allow-list. Prefix and origin matches are refused — `https://app.example.com` prefix-matches `https://app.example.com.evil.test`, and an attacker who can choose the path on a permitted origin can forward the code onward.

Every rejection — unknown client, non-allow-listed URI, a URI carrying a query or fragment, a non-https URI — answers the same `400 HANDOFF_NOT_ALLOWED`. Distinguishing them turns this into a probe for which clients are registered and which URIs they accept.

**No `Idempotency-Key`**, deliberately: each call mints a fresh single-use credential, and replaying one would mean two live codes for one request.

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `X-Correlation-ID` | header | no       | string |             |

**Request body** (required): [`IssueSessionHandoffRequest`](#schema-issuesessionhandoffrequest)

**Responses**

| Status | Description                                                                                                     | Schema                                 |
| ------ | --------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 200    | A one-time code, and the redirect_uri it is bound to.                                                           | object                                 |
| 400    | The client and redirect_uri combination cannot be used (`HANDOFF_NOT_ALLOWED`), or the body is missing a field. | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                                                                     | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/auth/session-handoff/redeem` — Spend a one-time handoff code and receive a session token (server-to-server).

- **operationId**: `redeemSessionHandoffCode`
- **Security**: bearerAuth + tenantHeader

ADR-0050. The only endpoint here authenticated by a **client secret** rather than a session: this is the request that obtains a session, so there is none to present yet. Not a machine credential either. ADR-0092 lets one write inside a narrow ceiling (`create`/`update`, never a high-risk action), and minting a human session is precisely the authority that ceiling exists to keep away from a non-human bearer.

Call it from the BFF's SERVER. The token must never reach a browser: the BFF stores it server-side and gives the browser its own portal cookie.

The code is spent exactly once, claimed with a guarded `UPDATE … WHERE redeemed_at IS NULL` so two concurrent redemptions cannot both succeed. The spent row is kept rather than deleted, so a replay is answered from evidence instead of from the absence of it.

**Every failure is one answer.** Unknown code, expired code, already-spent code, wrong client, wrong `redirectUri`, bad secret — all `401 HANDOFF_REJECTED`, including a malformed body. The distinctions are recorded in the audit trail; handing them to the caller tells whoever holds a stolen code whether it was ever valid.

The minted session inherits the assurance level the original login REACHED and never more: an `aal1` login cannot be laundered into an `aal2` session.

**No `Idempotency-Key`**: the code IS the idempotency key, with the opposite contract — the second attempt must fail rather than replay the first response.

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `X-Correlation-ID` | header | no       | string |             |

**Request body** (required): [`RedeemSessionHandoffRequest`](#schema-redeemsessionhandoffrequest)

**Responses**

| Status | Description                                                                                         | Schema                                 |
| ------ | --------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 200    | A session token for the human who authenticated.                                                    | object                                 |
| 401    | The handoff could not be completed (`HANDOFF_REJECTED`) — one answer for every cause, deliberately. | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/auth/session/switch` — Move the current session to another tenant the same human belongs to.

- **operationId**: `postAuthSessionSwitch`
- **Security**: bearerAuth + tenantHeader

ADR-0088. Issues a session in the target tenant and revokes the source session — switching leaves, it does not accumulate. Sessions whose `origin_auth` is `sso` or `handoff` are refused: only a globally verified credential may cross a tenant boundary, otherwise a tenant IdP administrator could assert an address and switch into the tenant where that person really works. Assurance does not travel: the new session starts at `aal1` and the target tenant's MFA policy is applied afresh.

**Parameters**

| Name                | In     | Required | Type          | Description                                                    |
| ------------------- | ------ | -------- | ------------- | -------------------------------------------------------------- |
| `X-AWCMS-Tenant-ID` | header | yes      | string (uuid) | The CURRENT tenant, i.e. the session being switched away from. |

**Request body** (required): object

**Responses**

| Status | Description                                                                                                                                                     | Schema                                 |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 200    | Session issued in the target tenant; the source session is revoked.                                                                                             | object                                 |
| 400    | Validation error.                                                                                                                                               | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                                                                                                                     | [`ApiError`](#standard-error-envelope) |
| 403    | `SESSION_NOT_SWITCHABLE` (the session was not issued by a global credential), `TENANT_UNAVAILABLE`, or `PASSWORD_LOGIN_DISABLED`.                               | [`ApiError`](#standard-error-envelope) |
| 404    | `MEMBERSHIP_NOT_FOUND` — one shape for "you do not belong there", so this endpoint cannot be used to ask whether somebody belongs to a tenant the caller names. | [`ApiError`](#standard-error-envelope) |
| 429    | Too many attempts from this source.                                                                                                                             | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/auth/session/tenant` — Exchange a tenant-selection token for a session in a named tenant.

- **operationId**: `postAuthSessionTenant`
- **Security**: none (public endpoint)

ADR-0088. Spends the single-use selection token returned by a `POST /api/v1/auth/login` that carried NO tenant header, and issues a session in the tenant named in the body. The token lives at most 120 seconds, is spent whether or not the exchange succeeds, and can never authenticate any other endpoint — the authorization chokepoint refuses its hash namespace outright. Every gate login applies once a tenant is known applies here too, including the target tenant's MFA policy.

**Request body** (required): object

**Responses**

| Status | Description                                                                                                                                                                                                | Schema                                 |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 200    | Session issued in the selected tenant.                                                                                                                                                                     | object                                 |
| 400    | Validation error.                                                                                                                                                                                          | [`ApiError`](#standard-error-envelope) |
| 401    | One shape for every refusal an attacker could probe — unknown, expired or already-spent token, no membership, inactive identity — plus the MFA continuations `MFA_REQUIRED` and `MFA_ENROLLMENT_REQUIRED`. | [`ApiError`](#standard-error-envelope) |
| 403    | The tenant is suspended (`TENANT_UNAVAILABLE`) or disables password sign-in for this identity (`PASSWORD_LOGIN_DISABLED`). Reachable only with a genuine token, so it discloses nothing.                   | [`ApiError`](#standard-error-envelope) |
| 429    | Too many attempts from this source.                                                                                                                                                                        | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/auth/sessions` — List the caller's own live sessions (self-service, no permission).

- **operationId**: `listOwnAuthSessions`
- **Security**: bearerAuth + tenantHeader

Where am I signed in? Self-service by construction — the subject is the session bearer and the route accepts no tenantUserId, so there is nobody else it could be pointed at. Deliberately UNPERMISSIONED, like GET /api/v1/auth/session: inventing a permission for "see your own sessions" would wall off the feature and install a latent-authz trap (an action nothing seeds denies everyone, including the tenant owner). Returns no token, no raw IP and no raw User-Agent. clientIpHash is a keyed pseudonym and is null on a deployment without AUTH_IP_HASH_SECRET, because the fallback key is per-process and a stored hash would stop being comparable after a restart.

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `X-Correlation-ID` | header | no       | string |             |

**Responses**

| Status | Description                                 | Schema                                 |
| ------ | ------------------------------------------- | -------------------------------------- |
| 200    | The caller's live sessions, newest first.   | object                                 |
| 400    | Validation error.                           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                 | [`ApiError`](#standard-error-envelope) |
| 429    | Too many session requests from this source. | [`ApiError`](#standard-error-envelope) |

### `DELETE /api/v1/auth/sessions/{id}` — End one of the caller's own sessions (self-service, no permission).

- **operationId**: `revokeOwnAuthSession`
- **Security**: bearerAuth + tenantHeader

Ownership is enforced in the UPDATE's WHERE clause, never by a preceding read. Unknown id, another person's session, another tenant's session and one already revoked or expired all answer 404 — distinguishing them would make this an existence oracle for session ids, and the caller could do nothing differently with the distinction. Revoking the CURRENT session answers 409: that is POST /api/v1/auth/logout's job, which also clears the cookies.

**Parameters**

| Name               | In     | Required | Type          | Description |
| ------------------ | ------ | -------- | ------------- | ----------- |
| `id`               | path   | yes      | string (uuid) |             |
| `X-Correlation-ID` | header | no       | string        |             |

**Responses**

| Status | Description                                                                                       | Schema                                 |
| ------ | ------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 200    | The session was revoked.                                                                          | object                                 |
| 400    | Validation error.                                                                                 | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                                                       | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.                                                                               | [`ApiError`](#standard-error-envelope) |
| 409    | The id names the session making this request (SESSION_IS_CURRENT) — use POST /api/v1/auth/logout. | [`ApiError`](#standard-error-envelope) |
| 429    | Too many revocation requests from this source.                                                    | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/auth/sessions/revoke-all` — Sign the caller out of every OTHER session (self-service, no permission).

- **operationId**: `revokeOtherOwnAuthSessions`
- **Security**: bearerAuth + tenantHeader

Ends every live session of the caller's identity except the one making the request. Self-service by construction — the subject is the session bearer and the route accepts no parameter with which to name anybody else — and unpermissioned for the same reason as the two endpoints beside it: this is what a person reaches for after "I think my password leaked", which is exactly when a permission wall is most expensive.
There is deliberately no `exceptCurrent` flag. The only other value would also end the requesting session, which is `POST /api/v1/auth/logout` — that endpoint additionally clears the cookies this one cannot see, so the flag would ship a second, worse logout whose distinguishing feature is leaving the caller holding a dead cookie.
It changes no credential and clears no lockout counter: ending stray sessions proves nothing new about the password, and folding the two together would make session hygiene a lockout-reset oracle. Not audited — `awcms_audit_events` records what administrators do to OTHER people; the paired admin endpoint under /api/v1/users/{id}/sessions/revoke-all writes that entry.

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `X-Correlation-ID` | header | no       | string |             |

**Responses**

| Status | Description                                                     | Schema                                 |
| ------ | --------------------------------------------------------------- | -------------------------------------- |
| 200    | How many other sessions were ended. Zero means there were none. | object                                 |
| 400    | Validation error.                                               | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                     | [`ApiError`](#standard-error-envelope) |
| 429    | Too many revocation requests from this source.                  | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/auth/sso-policy` — Read the tenant authentication policy (password/SSO/JIT/break-glass).

- **operationId**: `getSsoPolicy`
- **Security**: bearerAuth + tenantHeader

**Responses**

| Status | Description                       | Schema                                 |
| ------ | --------------------------------- | -------------------------------------- |
| 200    | The tenant authentication policy. | object                                 |
| 400    | Validation error.                 | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.       | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.       | [`ApiError`](#standard-error-envelope) |

### `PATCH /api/v1/auth/sso-policy` — Update the tenant authentication policy (partial upsert; high-risk; audit-logged; break-glass enforced server-side).

- **operationId**: `updateSsoPolicy`
- **Security**: bearerAuth + tenantHeader

**Request body** (required): object

**Responses**

| Status | Description                                                                                        | Schema                                 |
| ------ | -------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 200    | The updated policy.                                                                                | object                                 |
| 400    | Validation error.                                                                                  | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                                                        | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                                                        | [`ApiError`](#standard-error-envelope) |
| 409    | sso_required/password_login_disabled without an eligible break-glass owner (BREAK_GLASS_REQUIRED). | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/auth/sso-providers` — List the tenant's configured OIDC SSO providers (client secrets are never returned).

- **operationId**: `listSsoProviders`
- **Security**: bearerAuth + tenantHeader

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | The tenant's SSO providers. | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/auth/sso-providers` — Add a tenant OIDC SSO provider (high-risk; audit-logged). Exactly one of clientSecret / clientSecretEnvVar.

- **operationId**: `createSsoProvider`
- **Security**: bearerAuth + tenantHeader

**Request body** (required): object

**Responses**

| Status | Description                                                                                                          | Schema                                 |
| ------ | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 200    | The created provider.                                                                                                | object                                 |
| 400    | Validation error.                                                                                                    | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                                                                          | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                                                                          | [`ApiError`](#standard-error-envelope) |
| 409    | providerKey conflict or per-tenant provider limit reached (SSO_PROVIDER_KEY_CONFLICT / SSO_PROVIDER_LIMIT_EXCEEDED). | [`ApiError`](#standard-error-envelope) |
| 500    | The credential encryption key is not configured (SSO_MISCONFIGURED).                                                 | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/auth/sso-providers/{id}` — Read one tenant OIDC SSO provider (client secret never returned).

- **operationId**: `getSsoProvider`
- **Security**: bearerAuth + tenantHeader

**Parameters**

| Name | In   | Required | Type          | Description |
| ---- | ---- | -------- | ------------- | ----------- |
| `id` | path | yes      | string (uuid) |             |

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | The provider.               | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.         | [`ApiError`](#standard-error-envelope) |

### `PATCH /api/v1/auth/sso-providers/{id}` — Update a tenant OIDC SSO provider (partial; high-risk; audit-logged).

- **operationId**: `updateSsoProvider`
- **Security**: bearerAuth + tenantHeader

**Parameters**

| Name | In   | Required | Type          | Description |
| ---- | ---- | -------- | ------------- | ----------- |
| `id` | path | yes      | string (uuid) |             |

**Request body** (required): object

**Responses**

| Status | Description                                                          | Schema                                 |
| ------ | -------------------------------------------------------------------- | -------------------------------------- |
| 200    | The updated provider.                                                | object                                 |
| 400    | Validation error.                                                    | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                          | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                          | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.                                                  | [`ApiError`](#standard-error-envelope) |
| 500    | The credential encryption key is not configured (SSO_MISCONFIGURED). | [`ApiError`](#standard-error-envelope) |

### `DELETE /api/v1/auth/sso-providers/{id}` — Soft delete a tenant OIDC SSO provider (reason required; high-risk; audit-logged).

- **operationId**: `deleteSsoProvider`
- **Security**: bearerAuth + tenantHeader

**Parameters**

| Name | In   | Required | Type          | Description |
| ---- | ---- | -------- | ------------- | ----------- |
| `id` | path | yes      | string (uuid) |             |

**Request body** (required): object

**Responses**

| Status | Description                    | Schema                                 |
| ------ | ------------------------------ | -------------------------------------- |
| 200    | The provider was soft-deleted. | object                                 |
| 400    | Validation error.              | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.    | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.    | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.            | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/auth/sso/{providerKey}/callback` — OIDC provider redirect target — validates state/nonce/PKCE/ID-token, then mints an opaque awcms session (or a 401 MFA_REQUIRED).

- **operationId**: `getAuthSsoCallback`
- **Security**: none (public endpoint)

**Parameters**

| Name          | In    | Required | Type   | Description |
| ------------- | ----- | -------- | ------ | ----------- |
| `providerKey` | path  | yes      | string |             |
| `state`       | query | no       | string |             |
| `code`        | query | no       | string |             |
| `error`       | query | no       | string |             |

**Responses**

| Status | Description                                                   | Schema                                 |
| ------ | ------------------------------------------------------------- | -------------------------------------- |
| 302    | Login (or link) succeeded — redirect to the return path.      |                                        |
| 400    | Validation error.                                             | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                   | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                   | [`ApiError`](#standard-error-envelope) |
| 409    | The provider account is already linked (SSO_ALREADY_LINKED).  | [`ApiError`](#standard-error-envelope) |
| 502    | The provider could not be reached (SSO_PROVIDER_UNAVAILABLE). | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/auth/sso/{providerKey}/link` — Explicitly link an OIDC provider account to the caller's identity (authenticated + step-up required; never auto-links by email).

- **operationId**: `postAuthSsoLink`
- **Security**: bearerAuth + tenantHeader

**Parameters**

| Name          | In   | Required | Type   | Description |
| ------------- | ---- | -------- | ------ | ----------- |
| `providerKey` | path | yes      | string |             |

**Responses**

| Status | Description                                                   | Schema                                 |
| ------ | ------------------------------------------------------------- | -------------------------------------- |
| 200    | The provider authorization URL to complete the link.          | object                                 |
| 400    | Validation error.                                             | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                   | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                   | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.                                           | [`ApiError`](#standard-error-envelope) |
| 502    | The provider could not be reached (SSO_PROVIDER_UNAVAILABLE). | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/auth/sso/{providerKey}/start` — Begin an OIDC SSO login — 302-redirects to the tenant provider's authorization endpoint (Auth Code + PKCE + state + nonce).

- **operationId**: `getAuthSsoStart`
- **Security**: none (public endpoint)

**Parameters**

| Name          | In    | Required | Type          | Description                                                                                                    |
| ------------- | ----- | -------- | ------------- | -------------------------------------------------------------------------------------------------------------- |
| `providerKey` | path  | yes      | string        |                                                                                                                |
| `tenantId`    | query | no       | string (uuid) | Tenant id fallback when no tenant header/cookie is present (a fresh browser navigation).                       |
| `returnTo`    | query | no       | string        | Same-origin relative path to return to after login (sanitized server-side; open-redirect targets are ignored). |

**Responses**

| Status | Description                                                   | Schema                                 |
| ------ | ------------------------------------------------------------- | -------------------------------------- |
| 302    | Redirect to the provider's authorization endpoint.            |                                        |
| 400    | Validation error.                                             | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                   | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.                                           | [`ApiError`](#standard-error-envelope) |
| 429    | Too many requests from this source (RATE_LIMITED).            | [`ApiError`](#standard-error-envelope) |
| 502    | The provider could not be reached (SSO_PROVIDER_UNAVAILABLE). | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/auth/sso/{providerKey}/unlink` — Unlink the caller's OIDC provider account (authenticated + step-up required; audit-logged).

- **operationId**: `postAuthSsoUnlink`
- **Security**: bearerAuth + tenantHeader

**Parameters**

| Name          | In   | Required | Type   | Description |
| ------------- | ---- | -------- | ------ | ----------- |
| `providerKey` | path | yes      | string |             |

**Responses**

| Status | Description                                               | Schema                                 |
| ------ | --------------------------------------------------------- | -------------------------------------- |
| 200    | The provider account was unlinked.                        | object                                 |
| 400    | Validation error.                                         | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                               | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                               | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.                                       | [`ApiError`](#standard-error-envelope) |
| 409    | No provider account is currently linked (SSO_NOT_LINKED). | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/identity/business-scope/assignments` — List this tenant's business-scope assignments (Issue

- **operationId**: `listBusinessScopeAssignments`
- **Security**: bearerAuth + tenantHeader

Lists business-scope assignments for the caller's tenant, optionally filtered by status/tenantUserId/scopeType. Gated on `identity_access.business_scope_assignments.read`.

**Parameters**

| Name           | In    | Required | Type                                 | Description |
| -------------- | ----- | -------- | ------------------------------------ | ----------- |
| `status`       | query | no       | enum(`active`, `expired`, `revoked`) |             |
| `tenantUserId` | query | no       | string (uuid)                        |             |
| `scopeType`    | query | no       | string                               |             |

**Responses**

| Status | Description                                                      | Schema                                 |
| ------ | ---------------------------------------------------------------- | -------------------------------------- |
| 200    | The tenant's business-scope assignments (newest first, bounded). | object                                 |
| 400    | Validation error.                                                | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                      | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                      | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/identity/business-scope/assignments` — Create a business-scope assignment (high-risk, audited, idempotent).

- **operationId**: `createBusinessScopeAssignment`
- **Security**: bearerAuth + tenantHeader

Grants a subject a role/permission context restricted to one business scope. The `(scopeType, scopeId)` reference is validated server-side through the `BusinessScopeHierarchyPort` capability (never trusted from the request alone); an unresolved scope is denied `SCOPE_UNRESOLVED`. Self-grant is denied. Gated on `identity_access.business_scope_assignments.create`. Requires `Idempotency-Key`.

**Parameters**

| Name              | In     | Required | Type   | Description |
| ----------------- | ------ | -------- | ------ | ----------- |
| `Idempotency-Key` | header | yes      | string |             |

**Request body** (required): object

**Responses**

| Status | Description                                                    | Schema                                 |
| ------ | -------------------------------------------------------------- | -------------------------------------- |
| 200    | The created business-scope assignment.                         | object                                 |
| 400    | Validation error.                                              | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                    | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                    | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.                                            | [`ApiError`](#standard-error-envelope) |
| 409    | The Idempotency-Key was already used with a different request. | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/identity/business-scope/assignments/{id}/revoke` — Revoke a business-scope assignment (high-risk, audited, idempotent).

- **operationId**: `revokeBusinessScopeAssignment`
- **Security**: bearerAuth + tenantHeader

Revokes an active business-scope assignment (transitions it to `revoked`; append-only lifecycle history is recorded). Revocation takes effect on the next authorization decision immediately. Gated on `identity_access.business_scope_assignments.revoke`. Requires `Idempotency-Key`.

**Parameters**

| Name              | In     | Required | Type          | Description |
| ----------------- | ------ | -------- | ------------- | ----------- |
| `id`              | path   | yes      | string (uuid) |             |
| `Idempotency-Key` | header | yes      | string        |             |

**Request body** (required): object

**Responses**

| Status | Description                                                                               | Schema                                 |
| ------ | ----------------------------------------------------------------------------------------- | -------------------------------------- |
| 200    | The revoked business-scope assignment.                                                    | object                                 |
| 400    | Validation error.                                                                         | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                                               | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                                               | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.                                                                       | [`ApiError`](#standard-error-envelope) |
| 409    | The assignment is not active, or the Idempotency-Key was reused with a different request. | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/identity/business-scope/conflicts` — List the SoD conflict evaluation log (Issue

- **operationId**: `listSoDConflictEvaluations`
- **Security**: bearerAuth + tenantHeader

Keyset-paginated, permission-gated segregation-of-duties conflict evaluation history (the conflict preview / audit view). Recorded for every assignment-create and high-risk-action conflict check, regardless of outcome. Safe projection: rule key, subject id, trigger context, outcome, reason, and timestamp only. Gated on `identity_access.business_scope_conflicts.read`.

**Parameters**

| Name               | In    | Required | Type                  | Description                                               |
| ------------------ | ----- | -------- | --------------------- | --------------------------------------------------------- |
| `cursor`           | query | no       | string                | Opaque keyset cursor from a previous page's `nextCursor`. |
| `limit`            | query | no       | integer               |                                                           |
| `ruleKey`          | query | no       | string                |                                                           |
| `conflictDetected` | query | no       | enum(`true`, `false`) |                                                           |

**Responses**

| Status | Description                                                             | Schema                                 |
| ------ | ----------------------------------------------------------------------- | -------------------------------------- |
| 200    | A page of SoD conflict evaluations (newest first) plus the next cursor. | object                                 |
| 400    | Validation error.                                                       | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                             | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                             | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/identity/business-scope/exceptions` — List this tenant's SoD conflict exceptions (Issue

- **operationId**: `listSoDConflictExceptions`
- **Security**: bearerAuth + tenantHeader

Lists the tenant's segregation-of-duties conflict exceptions, optionally filtered by `status`/`ruleKey`. Gated on `identity_access.business_scope_exceptions.read`.

**Parameters**

| Name      | In    | Required | Type                                                          | Description |
| --------- | ----- | -------- | ------------------------------------------------------------- | ----------- |
| `status`  | query | no       | enum(`pending`, `approved`, `rejected`, `expired`, `revoked`) |             |
| `ruleKey` | query | no       | string                                                        |             |

**Responses**

| Status | Description                                                   | Schema                                 |
| ------ | ------------------------------------------------------------- | -------------------------------------- |
| 200    | The tenant's SoD conflict exceptions (newest first, bounded). | object                                 |
| 400    | Validation error.                                             | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                   | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                   | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/identity/business-scope/exceptions` — Request a SoD conflict exception (high-risk, audited, idempotent).

- **operationId**: `createSoDConflictException`
- **Security**: bearerAuth + tenantHeader

Requests a bounded-lifetime, scope-bound exception to a registered SoD rule (`status: "pending"`, requires separate approval by a different user holding the rule's approval permission). The rule must exist in the code registry and permit exceptions; the exception must have an end date (no indefinite override). Gated on `identity_access.business_scope_exceptions.create`. Requires `Idempotency-Key`.

**Parameters**

| Name              | In     | Required | Type   | Description |
| ----------------- | ------ | -------- | ------ | ----------- |
| `Idempotency-Key` | header | yes      | string |             |

**Request body** (required): object

**Responses**

| Status | Description                                                    | Schema                                 |
| ------ | -------------------------------------------------------------- | -------------------------------------- |
| 200    | The created (pending) SoD conflict exception.                  | object                                 |
| 400    | Validation error.                                              | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                    | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                    | [`ApiError`](#standard-error-envelope) |
| 409    | The Idempotency-Key was already used with a different request. | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/identity/business-scope/exceptions/{id}/approve` — Approve a pending SoD conflict exception (high-risk, audited, idempotent).

- **operationId**: `approveSoDConflictException`
- **Security**: bearerAuth + tenantHeader

Approves a pending exception (the sanctioned administrative override). Self-approval is denied on BOTH independence axes, re-checked from the DB row: the approver may be neither the requester nor the subject.

TWO permissions are checked. Every approval needs the dedicated `identity_access.business_scope_exceptions.approve`. A rule may also name its own checker in `SoDRuleDescriptor.exceptionPolicy.requiresApprovalPermission`, and when that differs from the dedicated key the caller must hold it too (403 `ACCESS_DENIED`). An exception whose rule no installed module declares any more cannot be approved at all (403 `SOD_RULE_UNKNOWN`); rejecting and revoking it stay available.

Requires `Idempotency-Key`; audited at `critical` severity.

**Parameters**

| Name              | In     | Required | Type          | Description |
| ----------------- | ------ | -------- | ------------- | ----------- |
| `id`              | path   | yes      | string (uuid) |             |
| `Idempotency-Key` | header | yes      | string        |             |

**Request body** (optional): object

**Responses**

| Status | Description                                                                               | Schema                                 |
| ------ | ----------------------------------------------------------------------------------------- | -------------------------------------- |
| 200    | The approved SoD conflict exception.                                                      | object                                 |
| 400    | Validation error.                                                                         | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                                               | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                                               | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.                                                                       | [`ApiError`](#standard-error-envelope) |
| 409    | The exception is not pending, or the Idempotency-Key was reused with a different request. | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/identity/business-scope/exceptions/{id}/reject` — Reject a pending SoD conflict exception (audited, idempotent).

- **operationId**: `rejectSoDConflictException`
- **Security**: bearerAuth + tenantHeader

Rejects a pending exception — the safe outcome (the conflict stays denied). Gated on `identity_access.business_scope_exceptions.reject`. Requires `Idempotency-Key`; audited at `warning` severity.

**Parameters**

| Name              | In     | Required | Type          | Description |
| ----------------- | ------ | -------- | ------------- | ----------- |
| `id`              | path   | yes      | string (uuid) |             |
| `Idempotency-Key` | header | yes      | string        |             |

**Request body** (optional): object

**Responses**

| Status | Description                                                                               | Schema                                 |
| ------ | ----------------------------------------------------------------------------------------- | -------------------------------------- |
| 200    | The rejected SoD conflict exception.                                                      | object                                 |
| 400    | Validation error.                                                                         | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                                               | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                                               | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.                                                                       | [`ApiError`](#standard-error-envelope) |
| 409    | The exception is not pending, or the Idempotency-Key was reused with a different request. | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/identity/business-scope/exceptions/{id}/revoke` — Revoke an approved SoD conflict exception (high-risk, audited, idempotent).

- **operationId**: `revokeSoDConflictException`
- **Security**: bearerAuth + tenantHeader

Revokes a previously approved exception, ending the override early (immediately ineffective at the next decision). Reason required. Gated on `identity_access.business_scope_exceptions.revoke`. Requires `Idempotency-Key`; audited at `critical` severity.

**Parameters**

| Name              | In     | Required | Type          | Description |
| ----------------- | ------ | -------- | ------------- | ----------- |
| `id`              | path   | yes      | string (uuid) |             |
| `Idempotency-Key` | header | yes      | string        |             |

**Request body** (required): object

**Responses**

| Status | Description                                                                                | Schema                                 |
| ------ | ------------------------------------------------------------------------------------------ | -------------------------------------- |
| 200    | The revoked SoD conflict exception.                                                        | object                                 |
| 400    | Validation error.                                                                          | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                                                | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                                                | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.                                                                        | [`ApiError`](#standard-error-envelope) |
| 409    | The exception is not approved, or the Idempotency-Key was reused with a different request. | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/invitations` — List this tenant's invitations (identity_access.invitations.read).

- **operationId**: `listInvitations`
- **Security**: bearerAuth + tenantHeader

Keyset-paginated, newest first. The invitee's address is MASKED: these rows are addresses of people who are not users here — often people who never will be — so the unmasked value has no reason to leave the database.
`roleCodes` is what the invitation carries, and it becomes a real grant only on acceptance. Nothing in this list confers access.

**Parameters**

| Name               | In     | Required | Type                                              | Description                                                                                                               |
| ------------------ | ------ | -------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `X-Correlation-ID` | header | no       | string                                            |                                                                                                                           |
| `status`           | query  | no       | enum(`pending`, `accepted`, `revoked`, `expired`) |                                                                                                                           |
| `cursor`           | query  | no       | string                                            | An opaque cursor from a previous response's `nextCursor`. A cursor that does not decode is a 400, never a silent restart. |

**Responses**

| Status | Description                          | Schema                                 |
| ------ | ------------------------------------ | -------------------------------------- |
| 200    | A page of invitations, newest first. | object                                 |
| 400    | Validation error.                    | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.          | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.          | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/invitations` — Invite a person to this tenant (identity_access.invitations.create, audited).

- **operationId**: `createInvitation`
- **Security**: bearerAuth + tenantHeader

Issues an offer of membership and mails its link. No account exists until the link is used.
Inviting and GRANTING A ROLE are two authorities: a body naming `roleIds` additionally requires `identity_access.access_control.assign`, so an administrator holding only `invitations.create` can admit a person and nothing more. A role marked `is_system` is refused (409 ROLE_SYSTEM_PROTECTED), and unknown role ids refuse the whole invitation rather than granting a subset.
`skipEmailConfirmation` requires the PLATFORM-scoped `identity_access.invitations.configure`, unless the address already holds an active identity in this tenant — which is the same proof, already given. It removes the only evidence that the recipient controls that mailbox.

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `X-Correlation-ID` | header | no       | string |             |
| `Idempotency-Key`  | header | yes      | string |             |

**Request body** (required): [`CreateInvitationInput`](#schema-createinvitationinput)

**Responses**

| Status | Description                                                                                                                                                                                                                                                 | Schema                                 |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 201    | The invitation was issued. `delivery` is `unavailable` when the tenant has no active `auth.invitation` template or the address is suppressed — the invitation still exists and can be resent.                                                               | object                                 |
| 400    | Validation error.                                                                                                                                                                                                                                           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                                                                                                                                                                                                                 | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                                                                                                                                                                                                                 | [`ApiError`](#standard-error-envelope) |
| 409    | The address already has an account (IDENTIFIER_TAKEN) or a pending invitation (INVITATION_ALREADY_PENDING); a named role is a system role (ROLE_SYSTEM_PROTECTED); or the Idempotency-Key was already used with a different request (IDEMPOTENCY_CONFLICT). | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/invitations/{id}/resend` — Resend an invitation, rotating its token (identity_access.invitations.create, audited).

- **operationId**: `resendInvitation`
- **Security**: bearerAuth + tenantHeader

Guarded by `create`, not by an action of its own: resend MINTS A NEW TOKEN, which is exactly the authority `create` already names.
The previous link stops working immediately. Without rotation, "resend" would grow N live links from one invitation, and revoking it would mean revoking N secrets nobody counted.
Capped at five resends per invitation by a database CHECK; past that, revoke and issue a new one. No Idempotency-Key — replaying would have to return a token that has already been rotated away, or persist a plaintext token in the idempotency store.

**Parameters**

| Name               | In     | Required | Type          | Description |
| ------------------ | ------ | -------- | ------------- | ----------- |
| `X-Correlation-ID` | header | no       | string        |             |
| `id`               | path   | yes      | string (uuid) |             |

**Responses**

| Status | Description                                                    | Schema                                 |
| ------ | -------------------------------------------------------------- | -------------------------------------- |
| 200    | A fresh link was issued and the previous one is dead.          | object                                 |
| 400    | Validation error.                                              | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                    | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                    | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.                                            | [`ApiError`](#standard-error-envelope) |
| 409    | The resend ceiling has been reached (INVITATION_RESEND_LIMIT). | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/invitations/{id}/revoke` — Revoke a pending invitation (identity_access.invitations.revoke, audited).

- **operationId**: `revokeInvitation`
- **Security**: bearerAuth + tenantHeader

Kills the link; keeps the row. The surviving row is what answers "who offered what, to whom, and what happened" — which is why this activity has no `delete`.
An invitation that is not pending and one that does not exist answer identically, so the response cannot be used to enumerate ids or to learn that a given invitation was already accepted.
No Idempotency-Key: the UPDATE carries `AND status = 'pending'`, so a double submit revokes once and the second call answers 404.

**Parameters**

| Name               | In     | Required | Type          | Description |
| ------------------ | ------ | -------- | ------------- | ----------- |
| `X-Correlation-ID` | header | no       | string        |             |
| `id`               | path   | yes      | string (uuid) |             |

**Request body** (optional): object

**Responses**

| Status | Description                                     | Schema                                 |
| ------ | ----------------------------------------------- | -------------------------------------- |
| 200    | The invitation is revoked and its link is dead. | object                                 |
| 400    | Validation error.                               | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                     | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                     | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.                             | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/partner/tenants` — The partner's own view of which tenants have engaged it.

- **operationId**: `listManagedTenants`
- **Security**: bearerAuth + tenantHeader

ADR-0089. Served by a narrow SECURITY DEFINER function (`sql/119`), because the engagement rows belong to the TARGET tenant and are unreadable from here under FORCE RLS. The partner tenant is taken from the CALLER'S CONTEXT, never from the request, so nobody can ask for somebody else's book. Returns no `engagedBy` — that is a third party's identifier the partner does not need.

**Responses**

| Status | Description                       | Schema                                 |
| ------ | --------------------------------- | -------------------------------------- |
| 200    | The tenants this partner manages. | object                                 |
| 401    | Missing or invalid session.       | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.       | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/partners` — PLATFORM: the partner registry.

- **operationId**: `listRegisteredPartners`
- **Security**: bearerAuth + tenantHeader

ADR-0089. Lists every partner registered on the deployment, and is PLATFORM-scoped for exactly that reason: a tenant-scoped version of this read is the cross-tenant directory the same ADR refused as a table. Reachable only when the acting tenant IS the platform tenant, and every row carries the platform tenant's `tenant_id` so FORCE RLS hides them from any other session even if a grant row existed. Both mechanisms are load-bearing; neither is a backstop for the other.

**Responses**

| Status | Description                             | Schema                                 |
| ------ | --------------------------------------- | -------------------------------------- |
| 200    | The registry, newest first (limit 200). | object                                 |
| 401    | Missing or invalid session.             | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.             | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/partners` — PLATFORM: register an existing tenant as a partner (audit-logged).

- **operationId**: `registerPartner`
- **Security**: bearerAuth + tenantHeader

ADR-0089. Declares who may BE a partner — the platform's half of a split this ADR keeps apart from the customer's `partner_access.configure` ("which partners reach MY tenant"). No single actor holds both.
It creates nothing but a row. A partner is an ordinary tenant: the one named here must already exist, this does not provision it, and the row grants nothing. It is the PRECONDITION a customer's engagement checks through a foreign key, and `activeRoleGrants` never reads it.
`status` is not accepted — `sql/116` pins it to `active` until something reads suspension. There is no DELETE: the row is the target of foreign keys from engagements and from delegated grants that deliberately outlive them, so retirement will be a status change, not a removal.
Not idempotency-keyed: both natural keys are globally unique, so a duplicate submit is a 409 naming which one was taken rather than a second row.

**Request body** (required): [`RegisterPartnerRequest`](#schema-registerpartnerrequest)

**Responses**

| Status | Description                                                                                                | Schema                                 |
| ------ | ---------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 201    | The registered partner.                                                                                    | object                                 |
| 401    | Missing or invalid session.                                                                                | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                                                                | [`ApiError`](#standard-error-envelope) |
| 404    | No such tenant on this deployment (TENANT_NOT_FOUND).                                                      | [`ApiError`](#standard-error-envelope) |
| 409    | The tenant is already a partner, the partnerCode is taken, or the platform tenant named itself (CONFLICT). | [`ApiError`](#standard-error-envelope) |
| 422    | The registration failed validation (VALIDATION_FAILED); `error.details` lists every offending field.       | [`ApiError`](#standard-error-envelope) |

### `PATCH /api/v1/partners/{partnerTenantId}/status` — Suspend or reinstate a registered partner (PLATFORM-scoped, audited).

- **operationId**: `setPartnerRegistryStatus`
- **Security**: bearerAuth + tenantHeader

Writes one column. Suspending stops every delegated actor the partner placed from being served, in every customer tenant, at their next request — enforced at the authorization chokepoint, not by a job, so there is no window.

It revokes NOTHING. No grant row is touched and no engagement is severed: a grant is the record of who could see a customer's data and until when, and that has to stay answerable after a partner is suspended. Effectiveness is computed per request, so reinstating restores every surviving grant's reach without rewriting a row.

Two permissions, both PLATFORM-scoped, because they are two authorities: `identity_access.partner_registry.disable` to suspend and `identity_access.partner_registry.restore` to reinstate. Setting the status it already has succeeds with `changed: false` and writes no audit row.

**Parameters**

| Name              | In   | Required | Type          | Description |
| ----------------- | ---- | -------- | ------------- | ----------- |
| `partnerTenantId` | path | yes      | string (uuid) |             |

**Request body** (required): object

**Responses**

| Status | Description                                                                                       | Schema                                 |
| ------ | ------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 200    | The partner, and whether this request changed anything.                                           | object                                 |
| 401    | Missing or invalid session.                                                                       | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                                                       | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.                                                                               | [`ApiError`](#standard-error-envelope) |
| 422    | `status` was absent or not one of the two values the CHECK constraint allows (VALIDATION_FAILED). | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/registration-requests` — Pending self-registration requests for this tenant.

- **operationId**: `listRegistrationRequests`
- **Security**: bearerAuth + tenantHeader

Oldest first, bounded. Login identifiers are MASKED — a reviewer decides on a name and a domain, and this is the one response that would otherwise expose every applicant address at once.

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | The pending queue.          | object                                 |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/registration-requests/{id}/approve` — Approve a request, creating a real account.

- **operationId**: `approveRegistrationRequest`
- **Security**: bearerAuth + tenantHeader

The only path that materializes profile + identity + tenant_user, hence its own permission (`registration_requests.approve`), separate from `reject`. The account is created with an UNUSABLE password and the applicant is emailed a password-reset link; `delivery` reports whether that link could actually be queued. `roleIds` is optional and defaults to none — an approval never grants a role by default, and a SYSTEM role (`owner`) is refused with 409 `ROLE_SYSTEM_PROTECTED`: admitting a person to a tenant is not the authority to hand out the tenant's whole permission catalogue.

**Parameters**

| Name | In   | Required | Type          | Description |
| ---- | ---- | -------- | ------------- | ----------- |
| `id` | path | yes      | string (uuid) |             |

**Request body** (optional): object

**Responses**

| Status | Description                                                                                                                                                                | Schema                                 |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 200    | Account created.                                                                                                                                                           | object                                 |
| 400    | Validation error.                                                                                                                                                          | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                                                                                                                                | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                                                                                                                                | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.                                                                                                                                                        | [`ApiError`](#standard-error-envelope) |
| 409    | `IDENTIFIER_TAKEN` — an account with that login identifier already exists; or `ROLE_SYSTEM_PROTECTED` — one of `roleIds` names a system role, which no approval may grant. | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/registration-requests/{id}/reject` — Reject a request. Creates nothing and notifies nobody.

- **operationId**: `rejectRegistrationRequest`
- **Security**: bearerAuth + tenantHeader

A rejection email would confirm to an anonymous submitter that this tenant exists and reviewed them — the same disclosure the public submit endpoint refuses to make.

**Parameters**

| Name | In   | Required | Type          | Description |
| ---- | ---- | -------- | ------------- | ----------- |
| `id` | path | yes      | string (uuid) |             |

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Request rejected.           | object                                 |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.         | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/roles` — List the current tenant's (non-deleted) roles with a permission count.

- **operationId**: `listRoles`
- **Security**: bearerAuth + tenantHeader

**Responses**

| Status | Description                                                   | Schema                                 |
| ------ | ------------------------------------------------------------- | -------------------------------------- |
| 200    | The tenant's roles (limit 100), each with a permission count. | object                                 |
| 400    | Validation error.                                             | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                   | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                   | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/roles` — Create a custom role for the current tenant (audited; requires access_control.configure).

- **operationId**: `createRole`
- **Security**: bearerAuth + tenantHeader

**Request body** (required): object

**Responses**

| Status | Description                                                                         | Schema                                 |
| ------ | ----------------------------------------------------------------------------------- | -------------------------------------- |
| 201    | Role created.                                                                       | object                                 |
| 400    | Validation error.                                                                   | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                                         | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                                         | [`ApiError`](#standard-error-envelope) |
| 409    | roleCode is already taken by a live role in this tenant (ROLE_CODE_ALREADY_EXISTS). | [`ApiError`](#standard-error-envelope) |

### `PATCH /api/v1/roles/{id}` — Rename a role (audited; requires access_control.configure).

- **operationId**: `updateRole`
- **Security**: bearerAuth + tenantHeader

**Parameters**

| Name | In   | Required | Type          | Description |
| ---- | ---- | -------- | ------------- | ----------- |
| `id` | path | yes      | string (uuid) |             |

**Request body** (required): object

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Role updated.               | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.         | [`ApiError`](#standard-error-envelope) |

### `DELETE /api/v1/roles/{id}` — Soft-delete a role (audited; requires access_control.configure). System roles are rejected with 409.

- **operationId**: `deleteRole`
- **Security**: bearerAuth + tenantHeader

**Parameters**

| Name | In   | Required | Type          | Description |
| ---- | ---- | -------- | ------------- | ----------- |
| `id` | path | yes      | string (uuid) |             |

**Request body** (optional): object

**Responses**

| Status | Description                                                              | Schema                                 |
| ------ | ------------------------------------------------------------------------ | -------------------------------------- |
| 200    | Role soft-deleted.                                                       | object                                 |
| 400    | Validation error.                                                        | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                              | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                              | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.                                                      | [`ApiError`](#standard-error-envelope) |
| 409    | The role is a system role and cannot be deleted (ROLE_SYSTEM_PROTECTED). | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/roles/{id}/permissions` — Grant a catalogued permission to a role (audited; requires access_control.configure).

- **operationId**: `grantRolePermission`
- **Security**: bearerAuth + tenantHeader

**Parameters**

| Name | In   | Required | Type          | Description |
| ---- | ---- | -------- | ------------- | ----------- |
| `id` | path | yes      | string (uuid) |             |

**Request body** (required): object

**Responses**

| Status | Description                                                                       | Schema                                 |
| ------ | --------------------------------------------------------------------------------- | -------------------------------------- |
| 200    | Permission granted.                                                               | object                                 |
| 400    | Validation error.                                                                 | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                                       | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                                       | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.                                                               | [`ApiError`](#standard-error-envelope) |
| 409    | The permission is already granted to this role (ROLE_PERMISSION_ALREADY_GRANTED). | [`ApiError`](#standard-error-envelope) |

### `DELETE /api/v1/roles/{id}/permissions` — Revoke a permission from a role (audited; requires access_control.configure).

- **operationId**: `revokeRolePermission`
- **Security**: bearerAuth + tenantHeader

**Parameters**

| Name | In   | Required | Type          | Description |
| ---- | ---- | -------- | ------------- | ----------- |
| `id` | path | yes      | string (uuid) |             |

**Request body** (required): object

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Permission revoked.         | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.         | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/roles/{id}/restore` — Restore a soft-deleted role (audited; requires access_control.configure).

- **operationId**: `restoreRole`
- **Security**: bearerAuth + tenantHeader

**Parameters**

| Name | In   | Required | Type          | Description |
| ---- | ---- | -------- | ------------- | ----------- |
| `id` | path | yes      | string (uuid) |             |

**Responses**

| Status | Description                                                                                 | Schema                                 |
| ------ | ------------------------------------------------------------------------------------------- | -------------------------------------- |
| 200    | Role restored.                                                                              | object                                 |
| 400    | Validation error.                                                                           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                                                 | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                                                 | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.                                                                         | [`ApiError`](#standard-error-envelope) |
| 409    | The role's code was re-used by a live role while it was deleted (ROLE_CODE_ALREADY_EXISTS). | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/user-groups` — List the tenant's user groups (identity_access.user_groups.read).

- **operationId**: `listUserGroups`
- **Security**: bearerAuth + tenantHeader

A group is a SUBJECT that can hold role grants, so this list carries a `roleCount` beside `memberCount`: a group holding grants is an authority no amount of looking at PEOPLE would reveal.
`source` is `local` or `scim`. A `scim` group is managed by an external directory and refuses local mutation with 409 GROUP_EXTERNALLY_MANAGED — SCIM itself is not implemented, only the refusal, because a local edit a later sync silently reverts is worse than one that was never accepted.

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `X-Correlation-ID` | header | no       | string |             |

**Responses**

| Status | Description                                     | Schema                                 |
| ------ | ----------------------------------------------- | -------------------------------------- |
| 200    | The tenant's live user groups, ordered by code. | object                                 |
| 400    | Validation error.                               | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                     | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                     | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/user-groups` — Create a local user group (identity_access.user_groups.create, audited).

- **operationId**: `createUserGroup`
- **Security**: bearerAuth + tenantHeader

Creates a group with no members and no grants. `source` is never accepted from the request: a caller who could declare a group `scim` would be declaring it un-editable through the only surface that exists, with no directory behind it to edit it instead.

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `X-Correlation-ID` | header | no       | string |             |

**Request body** (required): object

**Responses**

| Status | Description                                              | Schema                                 |
| ------ | -------------------------------------------------------- | -------------------------------------- |
| 201    | The created group.                                       | object                                 |
| 400    | Validation error.                                        | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                              | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                              | [`ApiError`](#standard-error-envelope) |
| 409    | A live group already holds this code (GROUP_CODE_TAKEN). | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/user-groups/{id}` — List one group's members (identity_access.user_groups.read).

- **operationId**: `listUserGroupMembers`
- **Security**: bearerAuth + tenantHeader

Tenant-user ids only. The login identifier is PII and the caller who may read this already has the user list to resolve them against.
An unknown group and an empty group answer identically — the alternative needs a pre-read that says whether an id exists in this tenant, which is the existence oracle every other read here refuses to be.

**Parameters**

| Name               | In     | Required | Type          | Description |
| ------------------ | ------ | -------- | ------------- | ----------- |
| `id`               | path   | yes      | string (uuid) |             |
| `X-Correlation-ID` | header | no       | string        |             |

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | The group's members.        | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |

### `PATCH /api/v1/user-groups/{id}` — Rename a local user group (identity_access.user_groups.update, audited).

- **operationId**: `updateUserGroup`
- **Security**: bearerAuth + tenantHeader

Changes the DISPLAY name and description. `groupCode` is not editable: it is the tenant-facing identity of the group and the thing a tenant's own runbooks name, so renaming it silently would make those wrong.

**Parameters**

| Name               | In     | Required | Type          | Description |
| ------------------ | ------ | -------- | ------------- | ----------- |
| `id`               | path   | yes      | string (uuid) |             |
| `X-Correlation-ID` | header | no       | string        |             |

**Request body** (required): object

**Responses**

| Status | Description                                                | Schema                                 |
| ------ | ---------------------------------------------------------- | -------------------------------------- |
| 200    | The updated group.                                         | object                                 |
| 400    | Validation error.                                          | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.                                        | [`ApiError`](#standard-error-envelope) |
| 409    | The group is directory-managed (GROUP_EXTERNALLY_MANAGED). | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/user-groups/members` — Add a tenant user to a group (identity_access.user_groups.assign, audited).

- **operationId**: `addUserGroupMember`
- **Security**: bearerAuth + tenantHeader

A grant in everything but name: membership confers every role the group holds, at once and with no further step. `assign` is a HIGH-RISK action, so this additionally passes the segregation-of-duties chokepoint.
Idempotent by intent: re-adding somebody already in the group answers 200 with `added: false`. Adding a person to a group they are already in changes nothing about their access, and a 409 there would be an error message about the state the caller asked for.

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `X-Correlation-ID` | header | no       | string |             |

**Request body** (required): [`UserGroupMembershipInput`](#schema-usergroupmembershipinput)

**Responses**

| Status | Description                                                | Schema                                 |
| ------ | ---------------------------------------------------------- | -------------------------------------- |
| 200    | Membership after the call.                                 | object                                 |
| 400    | Validation error.                                          | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.                                        | [`ApiError`](#standard-error-envelope) |
| 409    | The group is directory-managed (GROUP_EXTERNALLY_MANAGED). | [`ApiError`](#standard-error-envelope) |

### `DELETE /api/v1/user-groups/members` — Remove a tenant user from a group (identity_access.user_groups.assign, audited).

- **operationId**: `removeUserGroupMember`
- **Security**: bearerAuth + tenantHeader

Takes away every role the group confers on that person, effective on their next authorization decision — there is no cache between membership and the grant read.

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `X-Correlation-ID` | header | no       | string |             |

**Request body** (required): [`UserGroupMembershipInput`](#schema-usergroupmembershipinput)

**Responses**

| Status | Description                                                | Schema                                 |
| ------ | ---------------------------------------------------------- | -------------------------------------- |
| 200    | The membership was removed.                                | object                                 |
| 400    | Validation error.                                          | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.                                        | [`ApiError`](#standard-error-envelope) |
| 409    | The group is directory-managed (GROUP_EXTERNALLY_MANAGED). | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/users` — List the current tenant's users with their assigned role codes (login identifiers masked).

- **operationId**: `listTenantUsers`
- **Security**: bearerAuth + tenantHeader

**Responses**

| Status | Description                                                                            | Schema                                 |
| ------ | -------------------------------------------------------------------------------------- | -------------------------------------- |
| 200    | The tenant's users (limit 100), with masked login identifiers and assigned role codes. | object                                 |
| 400    | Validation error.                                                                      | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                                            | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                                            | [`ApiError`](#standard-error-envelope) |

### `PATCH /api/v1/users/{id}` — Activate or deactivate a tenant user (high-risk, audited).

- **operationId**: `setTenantUserStatus`
- **Security**: bearerAuth + tenantHeader

Sets the tenant user's status. `awcms_tenant_users` has no `deleted_at`, so deactivate = status `inactive`, reactivate = status `active`. Gated on `identity_access.access_control.configure`.

**Parameters**

| Name | In   | Required | Type          | Description |
| ---- | ---- | -------- | ------------- | ----------- |
| `id` | path | yes      | string (uuid) |             |

**Request body** (required): object

**Responses**

| Status | Description                   | Schema                                 |
| ------ | ----------------------------- | -------------------------------------- |
| 200    | The tenant user's new status. | object                                 |
| 400    | Validation error.             | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.   | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.   | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.           | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/users/{id}/sessions` — List one tenant user's live sessions (identity_access.user_sessions.read).

- **operationId**: `listTenantUserSessions`
- **Security**: bearerAuth + tenantHeader

Where is this person signed in? Gated on `identity_access.user_sessions.read` — the SENSITIVE half of the pair, because it is a standing window into a colleague's movements. The revoke endpoint beside it destroys access instead of disclosing anything, which is why the two are separate permissions and why an incident responder can hold the second without the first.
Returns no token, no token hash, no raw IP and no raw User-Agent. `isCallerSession` is true only when an administrator points this at their own tenant user. A malformed id, an id from another tenant and an unknown id all answer 404 — distinguishing them would make this a probe for which tenant user ids exist.

**Parameters**

| Name               | In     | Required | Type          | Description |
| ------------------ | ------ | -------- | ------------- | ----------- |
| `id`               | path   | yes      | string (uuid) |             |
| `X-Correlation-ID` | header | no       | string        |             |

**Responses**

| Status | Description                                    | Schema                                 |
| ------ | ---------------------------------------------- | -------------------------------------- |
| 200    | The tenant user's live sessions, newest first. | object                                 |
| 400    | Validation error.                              | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                    | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                    | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.                            | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/users/{id}/sessions/revoke-all` — End every live session of one tenant user (identity_access.user_sessions.revoke, audited).

- **operationId**: `revokeAllTenantUserSessions`
- **Security**: bearerAuth + tenantHeader

The incident control. Effective on the next request of every revoked session, because authentication reads the same row. Grantable WITHOUT `user_sessions.read`: stopping a suspected-compromised account should not cost a standing window into where everyone is signed in.
The CALLER's own session is never revoked — the exclusion matches nothing for any target other than the caller's own tenant user, and stops an administrator from signing themselves out of the console mid-incident by clicking their own row. `keptCallerSession` reports when that happened; signing yourself out everywhere is the unpermissioned self-service surface under `/api/v1/auth/sessions`.
No `Idempotency-Key`: the second call finds nothing live and reports `revokedCount: 0`, so there is no duplicate to suppress. Audited even when it revokes nothing.

**Parameters**

| Name               | In     | Required | Type          | Description |
| ------------------ | ------ | -------- | ------------- | ----------- |
| `id`               | path   | yes      | string (uuid) |             |
| `X-Correlation-ID` | header | no       | string        |             |

**Responses**

| Status | Description                   | Schema                                 |
| ------ | ----------------------------- | -------------------------------------- |
| 200    | How many sessions were ended. | object                                 |
| 400    | Validation error.             | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.   | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.   | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.           | [`ApiError`](#standard-error-envelope) |

## Profile Identity

Canonical person/organization profile lifecycle, identifiers, and entity links.

### `GET /api/v1/profiles` — List/search profiles for the current tenant.

- **operationId**: `listProfiles`
- **Security**: bearerAuth + tenantHeader

**Parameters**

| Name     | In    | Required | Type                           | Description |
| -------- | ----- | -------- | ------------------------------ | ----------- |
| `type`   | query | no       | enum(`person`, `organization`) |             |
| `status` | query | no       | string                         |             |
| `q`      | query | no       | string                         |             |
| `limit`  | query | no       | integer                        |             |

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Profile list.               | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/profiles` — Create a person/organization profile.

- **operationId**: `createProfile`
- **Security**: bearerAuth + tenantHeader

**Request body** (required): object

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Profile created.            | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/profiles/{id}` — Fetch one profile.

- **operationId**: `getProfile`
- **Security**: bearerAuth + tenantHeader

**Parameters**

| Name | In   | Required | Type          | Description |
| ---- | ---- | -------- | ------------- | ----------- |
| `id` | path | yes      | string (uuid) |             |

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Profile detail.             | object                                 |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.         | [`ApiError`](#standard-error-envelope) |

### `PATCH /api/v1/profiles/{id}` — Update a profile.

- **operationId**: `updateProfile`
- **Security**: bearerAuth + tenantHeader

**Parameters**

| Name | In   | Required | Type          | Description |
| ---- | ---- | -------- | ------------- | ----------- |
| `id` | path | yes      | string (uuid) |             |

**Request body** (required): object

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Profile updated.            | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.         | [`ApiError`](#standard-error-envelope) |

### `DELETE /api/v1/profiles/{id}` — Soft delete a profile.

- **operationId**: `deleteProfile`
- **Security**: bearerAuth + tenantHeader

**Parameters**

| Name | In   | Required | Type          | Description |
| ---- | ---- | -------- | ------------- | ----------- |
| `id` | path | yes      | string (uuid) |             |

**Request body** (required): object

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Profile soft-deleted.       | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.         | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/profiles/{id}/identifiers` — Attach a typed identifier (email/phone/national_id/tax_id/...) to a profile.

- **operationId**: `addProfileIdentifier`
- **Security**: bearerAuth + tenantHeader

**Parameters**

| Name | In   | Required | Type          | Description |
| ---- | ---- | -------- | ------------- | ----------- |
| `id` | path | yes      | string (uuid) |             |

**Request body** (required): object

**Responses**

| Status | Description                                                                    | Schema                                 |
| ------ | ------------------------------------------------------------------------------ | -------------------------------------- |
| 200    | Identifier attached (masked value returned).                                   | object                                 |
| 400    | Validation error.                                                              | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                                    | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                                    | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.                                                            | [`ApiError`](#standard-error-envelope) |
| 409    | An identifier of this type with the same value already exists for this tenant. | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/profiles/{id}/links` — List cross-module entity links for a profile (e.g. employee, vendor, customer).

- **operationId**: `listProfileLinks`
- **Security**: bearerAuth + tenantHeader

**Parameters**

| Name | In   | Required | Type          | Description |
| ---- | ---- | -------- | ------------- | ----------- |
| `id` | path | yes      | string (uuid) |             |

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Entity link list.           | object                                 |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.         | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/profiles/{id}/restore` — Restore a soft-deleted profile.

- **operationId**: `restoreProfile`
- **Security**: bearerAuth + tenantHeader

Counterpart of `DELETE /api/v1/profiles/{id}` (ADR-0058 §A). Clears `deleted_at`/`deleted_by` and stamps `restored_at`/`restored_by`; `delete_reason` is kept, since why the profile was deleted stays true after it is restored. A profile that does not exist and a profile that is not soft-deleted both answer 404 — a distinguishable answer would let a caller probe which profile ids exist.

**Parameters**

| Name              | In     | Required | Type          | Description |
| ----------------- | ------ | -------- | ------------- | ----------- |
| `id`              | path   | yes      | string (uuid) |             |
| `Idempotency-Key` | header | yes      | string        |             |

**Responses**

| Status | Description                                                    | Schema                                 |
| ------ | -------------------------------------------------------------- | -------------------------------------- |
| 200    | Profile restored.                                              | object                                 |
| 400    | Validation error.                                              | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                    | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                    | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.                                            | [`ApiError`](#standard-error-envelope) |
| 409    | The Idempotency-Key was already used with a different request. | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/profiles/resolve` — Resolve a profile by a typed identifier (email/phone/national_id/tax_id/...).

- **operationId**: `resolveProfile`
- **Security**: bearerAuth + tenantHeader

**Parameters**

| Name    | In    | Required | Type                                                                                  | Description |
| ------- | ----- | -------- | ------------------------------------------------------------------------------------- | ----------- |
| `type`  | query | yes      | enum(`email`, `phone`, `whatsapp`, `national_id`, `tax_id`, `external_code`, `other`) |             |
| `value` | query | yes      | string                                                                                |             |

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Matching profile, if any.   | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |

## Logging & Audit

Cross-module audit trail (awcms_audit_events) and its read API.

### `GET /api/v1/logs/audit` — List audit trail events for the current tenant.

- **operationId**: `listAuditEvents`
- **Security**: bearerAuth + tenantHeader

**Parameters**

| Name           | In    | Required | Type    | Description |
| -------------- | ----- | -------- | ------- | ----------- |
| `resourceType` | query | no       | string  |             |
| `limit`        | query | no       | integer |             |

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Audit event list.           | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |

## Module Management

Database-backed module registry, tenant module lifecycle, settings, permission sync, jobs, and health.

### `GET /api/v1/access/modules` — The permission catalog grouped by module (read-only).

- **operationId**: `listAccessModules`
- **Security**: bearerAuth + tenantHeader

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Permission catalog.         | object                                 |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/modules` — List the module catalog (code registry merged with DB lifecycle state).

- **operationId**: `listModuleCatalog`
- **Security**: bearerAuth + tenantHeader

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Module catalog.             | object                                 |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/modules/{moduleKey}` — Fetch one module's catalog entry.

- **operationId**: `getModuleCatalogEntry`
- **Security**: bearerAuth + tenantHeader

**Parameters**

| Name        | In   | Required | Type   | Description |
| ----------- | ---- | -------- | ------ | ----------- |
| `moduleKey` | path | yes      | string |             |

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Module detail.              | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.         | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/modules/{moduleKey}/audit` — Recent module-management activity for one module.

- **operationId**: `getModuleAuditSummary`
- **Security**: bearerAuth + tenantHeader

Tenant enable/disable, settings updates, health checks and preset applies recorded against this module key. Guarded by `logging.audit_trail.read`, not a module-management permission: these are audit-log rows, and whoever may not read the audit log must not get a filtered view of it through another door. An unregistered `moduleKey` answers 404, because an empty list would read as "nothing happened".

**Parameters**

| Name        | In    | Required | Type    | Description |
| ----------- | ----- | -------- | ------- | ----------- |
| `moduleKey` | path  | yes      | string  |             |
| `limit`     | query | no       | integer |             |

**Responses**

| Status | Description                    | Schema                                 |
| ------ | ------------------------------ | -------------------------------------- |
| 200    | Recent activity, newest first. | object                                 |
| 401    | Missing or invalid session.    | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.    | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.            | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/modules/{moduleKey}/health` — Passive, bounded module readiness signals (no live provider call).

- **operationId**: `getModuleHealth`
- **Security**: bearerAuth + tenantHeader

**Parameters**

| Name        | In   | Required | Type   | Description |
| ----------- | ---- | -------- | ------ | ----------- |
| `moduleKey` | path | yes      | string |             |

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Module health report.       | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.         | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/modules/{moduleKey}/health/check` — Explicit on-demand health check (records history; may run provider checks).

- **operationId**: `checkModuleHealth`
- **Security**: bearerAuth + tenantHeader

**Parameters**

| Name        | In   | Required | Type   | Description |
| ----------- | ---- | -------- | ------ | ----------- |
| `moduleKey` | path | yes      | string |             |

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Module health report.       | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.         | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/modules/{moduleKey}/jobs` — The module's declared operational commands (documentation only).

- **operationId**: `listModuleJobs`
- **Security**: bearerAuth + tenantHeader

**Parameters**

| Name        | In   | Required | Type   | Description |
| ----------- | ---- | -------- | ------ | ----------- |
| `moduleKey` | path | yes      | string |             |

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Module job list.            | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.         | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/modules/{moduleKey}/permissions` — Permission sync/status report for one module (read-only).

- **operationId**: `getModulePermissionSync`
- **Security**: bearerAuth + tenantHeader

**Parameters**

| Name        | In   | Required | Type   | Description |
| ----------- | ---- | -------- | ------ | ----------- |
| `moduleKey` | path | yes      | string |             |

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Permission sync report.     | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.         | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/modules/sync` — Sync trusted code descriptors into the database registry.

- **operationId**: `syncModuleRegistry`
- **Security**: bearerAuth + tenantHeader

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Sync result.                | object                                 |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |
| 500    | Validation error.           | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/tenant/modules` — Every registered module's enablement state for the current tenant.

- **operationId**: `listTenantModules`
- **Security**: bearerAuth + tenantHeader

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Tenant module list.         | object                                 |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/tenant/modules/{moduleKey}/disable` — Disable a module for the current tenant (reason required).

- **operationId**: `disableTenantModule`
- **Security**: bearerAuth + tenantHeader

**Parameters**

| Name        | In   | Required | Type   | Description |
| ----------- | ---- | -------- | ------ | ----------- |
| `moduleKey` | path | yes      | string |             |

**Request body** (required): object

**Responses**

| Status | Description                                          | Schema                                 |
| ------ | ---------------------------------------------------- | -------------------------------------- |
| 200    | Module disabled.                                     | object                                 |
| 400    | Validation error.                                    | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                          | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                          | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.                                  | [`ApiError`](#standard-error-envelope) |
| 409    | Rejected — core module or active reverse dependency. | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/tenant/modules/{moduleKey}/enable` — Enable a module for the current tenant (dependency-validated).

- **operationId**: `enableTenantModule`
- **Security**: bearerAuth + tenantHeader

**Parameters**

| Name        | In   | Required | Type   | Description |
| ----------- | ---- | -------- | ------ | ----------- |
| `moduleKey` | path | yes      | string |             |

**Responses**

| Status | Description                           | Schema                                 |
| ------ | ------------------------------------- | -------------------------------------- |
| 200    | Module enabled.                       | object                                 |
| 400    | Validation error.                     | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.           | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.           | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.                   | [`ApiError`](#standard-error-envelope) |
| 409    | Rejected — dependency/state conflict. | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/tenant/modules/{moduleKey}/settings` — Effective tenant module settings (defaults + tenant override).

- **operationId**: `getTenantModuleSettings`
- **Security**: bearerAuth + tenantHeader

**Parameters**

| Name        | In   | Required | Type   | Description |
| ----------- | ---- | -------- | ------ | ----------- |
| `moduleKey` | path | yes      | string |             |

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Module settings view.       | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.         | [`ApiError`](#standard-error-envelope) |

### `PATCH /api/v1/tenant/modules/{moduleKey}/settings` — Shallow-merge non-secret settings for a module (rejects secret-shaped keys/values).

- **operationId**: `updateTenantModuleSettings`
- **Security**: bearerAuth + tenantHeader

**Parameters**

| Name        | In   | Required | Type   | Description |
| ----------- | ---- | -------- | ------ | ----------- |
| `moduleKey` | path | yes      | string |             |

**Request body** (required): object

**Responses**

| Status | Description                   | Schema                                 |
| ------ | ----------------------------- | -------------------------------------- |
| 200    | Updated module settings view. | object                                 |
| 400    | Validation error.             | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.   | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.   | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.           | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/tenant/modules/matrix` — Every module by what matters for this tenant, in two queries.

- **operationId**: `getTenantModuleMatrix`
- **Security**: bearerAuth + tenantHeader

Single-tenant scope, never cross-tenant. Adds two lifecycle warnings by re-running the real enable/disable validation for each module's actual current state: `dependencyWarning` only for a DISABLED module ("would enabling succeed now?") and `reverseDependencyWarning` only for an ENABLED one ("would disabling be blocked?"). No health column — this base has no batched health reader, and a per-row one would be an N+1.

**Responses**

| Status | Description                            | Schema                                 |
| ------ | -------------------------------------- | -------------------------------------- |
| 200    | Module matrix for the caller's tenant. | object                                 |
| 401    | Missing or invalid session.            | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.            | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/tenant/modules/presets` — Named module profiles, and optionally a dry-run plan for one.

- **operationId**: `listTenantModulePresets`
- **Security**: bearerAuth + tenantHeader

Applying a preset DISABLES every enabled, unlisted, unprotected module, so `?preset=<name>` returns the plan without writing anything — an operator switching a live tenant's profile sees the disable list before it happens. An unknown name returns the catalog with `plan: null`.

**Parameters**

| Name     | In    | Required | Type   | Description |
| -------- | ----- | -------- | ------ | ----------- |
| `preset` | query | no       | string |             |

**Responses**

| Status | Description                                             | Schema                                 |
| ------ | ------------------------------------------------------- | -------------------------------------- |
| 200    | Preset catalog, plus a plan when `preset` was supplied. | object                                 |
| 400    | Validation error.                                       | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                             | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                             | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/tenant/modules/presets/{presetName}/apply` — Bring the tenant's module state to a named profile.

- **operationId**: `applyTenantModulePreset`
- **Security**: bearerAuth + tenantHeader

Enables every module the preset lists and disables every enabled, unlisted, unprotected module. Each change runs the real lifecycle validation, so a change can be rejected: `complete: false` with per-module reasons is a real outcome, not an error.

**Parameters**

| Name         | In   | Required | Type   | Description |
| ------------ | ---- | -------- | ------ | ----------- |
| `presetName` | path | yes      | string |             |

**Responses**

| Status | Description                              | Schema                                 |
| ------ | ---------------------------------------- | -------------------------------------- |
| 200    | Preset applied, completely or partially. | object                                 |
| 401    | Missing or invalid session.              | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.              | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.                      | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/tenant/navigation/sidebar` — This tenant's admin sidebar arrangement, plus the arrangeable entry set.

- **operationId**: `getTenantSidebarArrangement`
- **Security**: bearerAuth + tenantHeader

The entry set is code-derived (`listModules()` navigation plus the synthetic core items) and is returned for the editor to render; it is never writable. `arrangement` is the tenant's stored delta — a tenant with no rows gets empty arrays, meaning "use the code default". Deliberately unfiltered by permission and by tenant-disabled module: this arranges the menu rather than previewing one operator's view of it.

**Responses**

| Status | Description                                    | Schema                                 |
| ------ | ---------------------------------------------- | -------------------------------------- |
| 200    | Entry set plus the tenant's current overrides. | object                                 |
| 401    | Missing or invalid session.                    | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                    | [`ApiError`](#standard-error-envelope) |

### `PUT /api/v1/tenant/navigation/sidebar` — Replace this tenant's sidebar arrangement.

- **operationId**: `saveTenantSidebarArrangement`
- **Security**: bearerAuth + tenantHeader

A full replace, not a merge: the payload IS the arrangement, so an omitted override disappears. Only overrides are submitted — each is resolved by `entryKey` against the code-derived default and one that matches nothing is ignored, so a request can never introduce a menu link. Requires `module_management.navigation.configure`.

**Request body** (required): object

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Arrangement saved.          | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |
| 413    | Validation error.           | [`ApiError`](#standard-error-envelope) |

### `DELETE /api/v1/tenant/navigation/sidebar` — Drop every override, returning this tenant to the code default.

- **operationId**: `resetTenantSidebarArrangement`
- **Security**: bearerAuth + tenantHeader

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Arrangement reset.          | object                                 |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |

## Sync Storage

Offline-first sync node registration, HMAC-signed push/pull, conflict tracking, and the object sync upload queue. Server-to-node replication is DECLARED EMPTY, not missing (ADR-0077): POST /api/v1/sync/pull reads awcms_domain_events — this repo's one transactional outbox — filtered by an explicit allow-list of replicable event types that currently contains none, so it answers 200 with an empty list. A node polling it is up to date with everything the server has chosen to replicate, which today is nothing. Two things block the first entry, both stated in src/modules/sync-storage/domain/sync-replication.ts: a per-event-type payload projection (a node is HMAC-authenticated, not a session), and commit-visibility safety (event_sequence is assigned at INSERT and visible at COMMIT, so a plain cursor can skip a late-committing event). The push direction (node to server) is fully implemented and unaffected. The operation's own description is unchanged because the pre-migration contract snapshot is frozen, so this notice lives here.

### `GET /api/v1/sync/conflicts` — List sync conflicts for the tenant (bearer session, not HMAC).

- **operationId**: `syncListConflicts`
- **Security**: bearerAuth + tenantHeader

**Parameters**

| Name     | In    | Required | Type                     | Description |
| -------- | ----- | -------- | ------------------------ | ----------- |
| `status` | query | no       | enum(`open`, `resolved`) |             |

**Responses**

| Status | Description                                     | Schema                                 |
| ------ | ----------------------------------------------- | -------------------------------------- |
| 200    | Recent sync conflicts, newest first (limit 50). | object                                 |
| 401    | Missing or invalid session.                     | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                     | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/sync/conflicts/{id}/resolve` — Resolve a sync conflict (bearer session, not HMAC, audited).

- **operationId**: `syncResolveConflict`
- **Security**: bearerAuth + tenantHeader

**Parameters**

| Name | In   | Required | Type          | Description |
| ---- | ---- | -------- | ------------- | ----------- |
| `id` | path | yes      | string (uuid) |             |

**Request body** (required): object

**Responses**

| Status | Description                   | Schema                                 |
| ------ | ----------------------------- | -------------------------------------- |
| 200    | Conflict resolved.            | object                                 |
| 400    | Validation error.             | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.   | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.   | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.           | [`ApiError`](#standard-error-envelope) |
| 409    | Conflict is already resolved. | [`ApiError`](#standard-error-envelope) |
| 413    | Validation error.             | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/sync/nodes` — List sync nodes for the tenant (bearer session or SSR cookie, not HMAC).

- **operationId**: `syncListNodes`
- **Security**: bearerAuth + tenantHeader

Admin-facing view of node registrations — distinct from the machine-to-machine HMAC endpoints (/sync/push, /sync/pull, /sync/status, /sync/objects*).

**Responses**

| Status | Description                               | Schema                                 |
| ------ | ----------------------------------------- | -------------------------------------- |
| 200    | All sync nodes registered for the tenant. | object                                 |
| 401    | Missing or invalid session.               | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.               | [`ApiError`](#standard-error-envelope) |

### `PATCH /api/v1/sync/nodes/{id}` — Activate/deactivate or rename a sync node (audited).

- **operationId**: `syncUpdateNode`
- **Security**: bearerAuth + tenantHeader

Deactivating a node takes effect immediately: every HMAC sync endpoint already rejects a non-active node with 403.

**Parameters**

| Name | In   | Required | Type          | Description |
| ---- | ---- | -------- | ------------- | ----------- |
| `id` | path | yes      | string (uuid) |             |

**Request body** (required): object

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Sync node updated.          | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.         | [`ApiError`](#standard-error-envelope) |
| 413    | Validation error.           | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/sync/object-queue` — List object sync queue entries tenant-wide (bearer session, not HMAC).

- **operationId**: `syncListObjectQueue`
- **Security**: bearerAuth + tenantHeader

Admin-facing, all-nodes view — distinct from the node-scoped HMAC GET /sync/objects/status.

**Parameters**

| Name     | In    | Required | Type                              | Description |
| -------- | ----- | -------- | --------------------------------- | ----------- |
| `status` | query | no       | enum(`pending`, `sent`, `failed`) |             |
| `cursor` | query | no       | string                            |             |

**Responses**

| Status | Description                                                      | Schema                                 |
| ------ | ---------------------------------------------------------------- | -------------------------------------- |
| 200    | Object sync queue entries tenant-wide (limit 200), newest first. | object                                 |
| 400    | Validation error.                                                | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                      | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                      | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/sync/object-queue/{id}/retry` — Manually retry a failed object sync queue entry (audited).

- **operationId**: `syncRetryObjectQueueEntry`
- **Security**: bearerAuth + tenantHeader

Human override of the automatic exponential-backoff schedule. Only `failed` entries are eligible; `pending`/`sent` are rejected with 409.

**Parameters**

| Name | In   | Required | Type          | Description |
| ---- | ---- | -------- | ------------- | ----------- |
| `id` | path | yes      | string (uuid) |             |

**Responses**

| Status | Description                         | Schema                                 |
| ------ | ----------------------------------- | -------------------------------------- |
| 200    | Entry reset to pending.             | object                                 |
| 400    | Validation error.                   | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.         | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.         | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.                 | [`ApiError`](#standard-error-envelope) |
| 409    | Only failed entries can be retried. | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/sync/objects` — Enqueue local objects for object-storage sync (upsert by objectKey, HMAC-authenticated).

- **operationId**: `syncEnqueueObjects`
- **Security**: syncHmac + tenantHeader

**Parameters**

| Name                | In     | Required | Type   | Description                                                                          |
| ------------------- | ------ | -------- | ------ | ------------------------------------------------------------------------------------ |
| `X-AWCMS-Node-ID`   | header | yes      | string | Node code identifying the calling sync node (auto-registers on first contact).       |
| `X-AWCMS-Timestamp` | header | yes      | string | ISO-8601 timestamp of the request, validated against the allowed skew (anti-replay). |
| `X-AWCMS-Signature` | header | yes      | string | HMAC-SHA256 signature over "<timestamp>.<body>".                                     |

**Request body** (required): object

**Responses**

| Status | Description                                                                     | Schema                                 |
| ------ | ------------------------------------------------------------------------------- | -------------------------------------- |
| 200    | Objects queued (re-enqueuing an existing objectKey upserts it back to pending). | object                                 |
| 400    | Validation error.                                                               | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                                     | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                                     | [`ApiError`](#standard-error-envelope) |
| 413    | Validation error.                                                               | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/sync/objects/status` — List this node's pending/failed object sync queue entries (HMAC-authenticated).

- **operationId**: `syncGetObjectsStatus`
- **Security**: syncHmac + tenantHeader

**Parameters**

| Name                | In     | Required | Type   | Description                                                                          |
| ------------------- | ------ | -------- | ------ | ------------------------------------------------------------------------------------ |
| `X-AWCMS-Node-ID`   | header | yes      | string | Node code identifying the calling sync node (auto-registers on first contact).       |
| `X-AWCMS-Timestamp` | header | yes      | string | ISO-8601 timestamp of the request, validated against the allowed skew (anti-replay). |
| `X-AWCMS-Signature` | header | yes      | string | HMAC-SHA256 signature over "<timestamp>.<body>".                                     |

**Responses**

| Status | Description                                                                 | Schema                                 |
| ------ | --------------------------------------------------------------------------- | -------------------------------------- |
| 200    | Non-sent object sync queue entries for this node (limit 100), oldest first. | object                                 |
| 401    | Missing or invalid session.                                                 | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                                 | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/sync/pull` — Pull events newer than the node's stored checkpoint (HMAC-authenticated).

- **operationId**: `syncPull`
- **Security**: syncHmac + tenantHeader

**Parameters**

| Name                | In     | Required | Type   | Description                                                                          |
| ------------------- | ------ | -------- | ------ | ------------------------------------------------------------------------------------ |
| `X-AWCMS-Node-ID`   | header | yes      | string | Node code identifying the calling sync node (auto-registers on first contact).       |
| `X-AWCMS-Timestamp` | header | yes      | string | ISO-8601 timestamp of the request, validated against the allowed skew (anti-replay). |
| `X-AWCMS-Signature` | header | yes      | string | HMAC-SHA256 signature over "<timestamp>.<body>".                                     |

**Request body** (optional): object

**Responses**

| Status | Description                                                      | Schema                                 |
| ------ | ---------------------------------------------------------------- | -------------------------------------- |
| 200    | Events since the node's last checkpoint, and the new checkpoint. | object                                 |
| 400    | Validation error.                                                | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                      | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                      | [`ApiError`](#standard-error-envelope) |
| 413    | Validation error.                                                | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/sync/push` — Push a batch of local events to the server (idempotent per batchId, HMAC-authenticated).

- **operationId**: `syncPush`
- **Security**: syncHmac + tenantHeader

**Parameters**

| Name                | In     | Required | Type   | Description                                                                          |
| ------------------- | ------ | -------- | ------ | ------------------------------------------------------------------------------------ |
| `X-AWCMS-Node-ID`   | header | yes      | string | Node code identifying the calling sync node (auto-registers on first contact).       |
| `X-AWCMS-Timestamp` | header | yes      | string | ISO-8601 timestamp of the request, validated against the allowed skew (anti-replay). |
| `X-AWCMS-Signature` | header | yes      | string | HMAC-SHA256 signature over "<timestamp>.<body>".                                     |

**Request body** (required): object

**Responses**

| Status | Description                                                          | Schema                                 |
| ------ | -------------------------------------------------------------------- | -------------------------------------- |
| 200    | Batch accepted (or already applied, if the batchId was seen before). | object                                 |
| 400    | Validation error.                                                    | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                          | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                          | [`ApiError`](#standard-error-envelope) |
| 413    | Validation error.                                                    | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/sync/status` — Get the calling node's sync status (HMAC-authenticated).

- **operationId**: `syncGetStatus`
- **Security**: syncHmac + tenantHeader

**Parameters**

| Name                | In     | Required | Type   | Description                                                                          |
| ------------------- | ------ | -------- | ------ | ------------------------------------------------------------------------------------ |
| `X-AWCMS-Node-ID`   | header | yes      | string | Node code identifying the calling sync node (auto-registers on first contact).       |
| `X-AWCMS-Timestamp` | header | yes      | string | ISO-8601 timestamp of the request, validated against the allowed skew (anti-replay). |
| `X-AWCMS-Signature` | header | yes      | string | HMAC-SHA256 signature over "<timestamp>.<body>".                                     |

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Sync node status.           | object                                 |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |

## Workflow Approval

Managed, versioned graph-based approval workflows — definition lifecycle, approval inbox/decisions, delegation, escalation, and administrative recovery.

### `GET /api/v1/workflows/definitions` — List workflow definitions (latest version per workflow key).

- **operationId**: `workflowsListDefinitions`
- **Security**: bearerAuth + tenantHeader

One row per distinct workflowKey (latest version, or latest matching the lifecycleStatus filter). See GET /definitions/{id} for full version history.

**Parameters**

| Name               | In     | Required | Type                               | Description |
| ------------------ | ------ | -------- | ---------------------------------- | ----------- |
| `lifecycleStatus`  | query  | no       | enum(`draft`, `active`, `retired`) |             |
| `X-Correlation-ID` | header | no       | string                             |             |

**Responses**

| Status | Description                               | Schema                                 |
| ------ | ----------------------------------------- | -------------------------------------- |
| 200    | Latest version per distinct workflow key. | object                                 |
| 400    | Validation error.                         | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.               | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.               | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/workflows/definitions` — Create a new draft workflow definition.

- **operationId**: `workflowsCreateDefinition`
- **Security**: bearerAuth + tenantHeader

Creates a draft version 1 (or the next draft version if the workflowKey already has history). Guarded by workflow.definition.create.

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `X-Correlation-ID` | header | no       | string |             |

**Request body** (required): object

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Draft definition created.   | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/workflows/definitions/{id}` — Get a workflow definition and its full version history.

- **operationId**: `workflowsGetDefinition`
- **Security**: bearerAuth + tenantHeader

**Parameters**

| Name               | In     | Required | Type          | Description |
| ------------------ | ------ | -------- | ------------- | ----------- |
| `id`               | path   | yes      | string (uuid) |             |
| `X-Correlation-ID` | header | no       | string        |             |

**Responses**

| Status | Description                                                    | Schema                                 |
| ------ | -------------------------------------------------------------- | -------------------------------------- |
| 200    | Definition detail plus every version of the same workflow key. | object                                 |
| 401    | Missing or invalid session.                                    | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                    | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.                                            | [`ApiError`](#standard-error-envelope) |

### `PUT /api/v1/workflows/definitions/{id}` — Update a draft workflow definition in place.

- **operationId**: `workflowsUpdateDefinition`
- **Security**: bearerAuth + tenantHeader

409 if the definition is not a draft (fork a new version via POST /new-version instead).

**Parameters**

| Name               | In     | Required | Type          | Description |
| ------------------ | ------ | -------- | ------------- | ----------- |
| `id`               | path   | yes      | string (uuid) |             |
| `X-Correlation-ID` | header | no       | string        |             |

**Request body** (required): object

**Responses**

| Status | Description                    | Schema                                 |
| ------ | ------------------------------ | -------------------------------------- |
| 200    | Draft definition updated.      | object                                 |
| 400    | Validation error.              | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.    | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.    | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.            | [`ApiError`](#standard-error-envelope) |
| 409    | The definition is not a draft. | [`ApiError`](#standard-error-envelope) |

### `DELETE /api/v1/workflows/definitions/{id}` — Soft-delete a draft workflow definition (idempotent, audited).

- **operationId**: `workflowsDeleteDefinition`
- **Security**: bearerAuth + tenantHeader

High-risk — requires Idempotency-Key. 409 for any non-draft (published/retired version history is permanent).

**Parameters**

| Name               | In     | Required | Type          | Description |
| ------------------ | ------ | -------- | ------------- | ----------- |
| `id`               | path   | yes      | string (uuid) |             |
| `Idempotency-Key`  | header | yes      | string        |             |
| `X-Correlation-ID` | header | no       | string        |             |

**Request body** (optional): object

**Responses**

| Status | Description                                                                        | Schema                                 |
| ------ | ---------------------------------------------------------------------------------- | -------------------------------------- |
| 200    | Draft definition soft-deleted.                                                     | object                                 |
| 401    | Missing or invalid session.                                                        | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                                        | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.                                                                | [`ApiError`](#standard-error-envelope) |
| 409    | Idempotency-Key reused with a different request, or the definition is not a draft. | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/workflows/definitions/{id}/new-version` — Fork a new draft version from an existing definition.

- **operationId**: `workflowsCreateDefinitionNewVersion`
- **Security**: bearerAuth + tenantHeader

**Parameters**

| Name               | In     | Required | Type          | Description |
| ------------------ | ------ | -------- | ------------- | ----------- |
| `id`               | path   | yes      | string (uuid) |             |
| `X-Correlation-ID` | header | no       | string        |             |

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | New draft version created.  | object                                 |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.         | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/workflows/definitions/{id}/publish` — Publish/activate a draft workflow definition version (idempotent, audited).

- **operationId**: `workflowsPublishDefinition`
- **Security**: bearerAuth + tenantHeader

Transitions draft to active, retiring any previously-active version of the same workflow key in the same transaction. High-risk — requires Idempotency-Key.

**Parameters**

| Name               | In     | Required | Type          | Description |
| ------------------ | ------ | -------- | ------------- | ----------- |
| `id`               | path   | yes      | string (uuid) |             |
| `Idempotency-Key`  | header | yes      | string        |             |
| `X-Correlation-ID` | header | no       | string        |             |

**Responses**

| Status | Description                                                                        | Schema                                 |
| ------ | ---------------------------------------------------------------------------------- | -------------------------------------- |
| 200    | Definition published.                                                              | object                                 |
| 400    | Validation error.                                                                  | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                                        | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                                        | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.                                                                | [`ApiError`](#standard-error-envelope) |
| 409    | Idempotency-Key reused with a different request, or the definition is not a draft. | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/workflows/definitions/{id}/retire` — Voluntarily retire an active workflow definition version (idempotent, audited).

- **operationId**: `workflowsRetireDefinition`
- **Security**: bearerAuth + tenantHeader

**Parameters**

| Name               | In     | Required | Type          | Description |
| ------------------ | ------ | -------- | ------------- | ----------- |
| `id`               | path   | yes      | string (uuid) |             |
| `Idempotency-Key`  | header | yes      | string        |             |
| `X-Correlation-ID` | header | no       | string        |             |

**Responses**

| Status | Description                                                                       | Schema                                 |
| ------ | --------------------------------------------------------------------------------- | -------------------------------------- |
| 200    | Definition retired.                                                               | object                                 |
| 401    | Missing or invalid session.                                                       | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                                       | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.                                                               | [`ApiError`](#standard-error-envelope) |
| 409    | Idempotency-Key reused with a different request, or the definition is not active. | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/workflows/definitions/{id}/validate` — Dry-run validate a workflow definition graph (stored, or a candidate in the body).

- **operationId**: `workflowsValidateDefinition`
- **Security**: bearerAuth + tenantHeader

Read-only, non-persisting. Never fails the HTTP call for an invalid graph — returns the validation result in the body.

**Parameters**

| Name               | In     | Required | Type          | Description |
| ------------------ | ------ | -------- | ------------- | ----------- |
| `id`               | path   | yes      | string (uuid) |             |
| `X-Correlation-ID` | header | no       | string        |             |

**Request body** (optional): object

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Validation result.          | object                                 |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.         | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/workflows/delegations` — List workflow delegations.

- **operationId**: `workflowsListDelegations`
- **Security**: bearerAuth + tenantHeader

**Parameters**

| Name                    | In     | Required | Type          | Description |
| ----------------------- | ------ | -------- | ------------- | ----------- |
| `delegatorTenantUserId` | query  | no       | string (uuid) |             |
| `X-Correlation-ID`      | header | no       | string        |             |

**Responses**

| Status | Description                            | Schema                                 |
| ------ | -------------------------------------- | -------------------------------------- |
| 200    | Delegations (limit 100), newest first. | object                                 |
| 401    | Missing or invalid session.            | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.            | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/workflows/delegations` — Create a workflow delegation from the calling tenant user (idempotent, audited).

- **operationId**: `workflowsCreateDelegation`
- **Security**: bearerAuth + tenantHeader

A tenant user can only delegate their OWN standing. High-risk — requires Idempotency-Key.

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `Idempotency-Key`  | header | yes      | string |             |
| `X-Correlation-ID` | header | no       | string |             |

**Request body** (required): object

**Responses**

| Status | Description                                      | Schema                                 |
| ------ | ------------------------------------------------ | -------------------------------------- |
| 200    | Delegation created.                              | object                                 |
| 400    | Validation error.                                | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                      | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                      | [`ApiError`](#standard-error-envelope) |
| 409    | Idempotency-Key reused with a different request. | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/workflows/delegations/{id}/revoke` — Revoke a workflow delegation (delegator only, idempotent, audited).

- **operationId**: `workflowsRevokeDelegation`
- **Security**: bearerAuth + tenantHeader

**Parameters**

| Name               | In     | Required | Type          | Description |
| ------------------ | ------ | -------- | ------------- | ----------- |
| `id`               | path   | yes      | string (uuid) |             |
| `Idempotency-Key`  | header | yes      | string        |             |
| `X-Correlation-ID` | header | no       | string        |             |

**Request body** (optional): object

**Responses**

| Status | Description                                      | Schema                                 |
| ------ | ------------------------------------------------ | -------------------------------------- |
| 200    | Delegation revoked.                              | object                                 |
| 401    | Missing or invalid session.                      | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                      | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.                              | [`ApiError`](#standard-error-envelope) |
| 409    | Idempotency-Key reused with a different request. | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/workflows/instances/{id}` — Get a workflow instance's detail and immutable action history.

- **operationId**: `workflowsGetInstance`
- **Security**: bearerAuth + tenantHeader

**Parameters**

| Name               | In     | Required | Type          | Description |
| ------------------ | ------ | -------- | ------------- | ----------- |
| `id`               | path   | yes      | string (uuid) |             |
| `X-Correlation-ID` | header | no       | string        |             |

**Responses**

| Status | Description                                                | Schema                                 |
| ------ | ---------------------------------------------------------- | -------------------------------------- |
| 200    | Instance detail plus decision/audit history, newest first. | object                                 |
| 401    | Missing or invalid session.                                | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.                                        | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/workflows/instances/{id}/cancel` — Administrative recovery — cancel a running (pending) workflow instance (idempotent, audited).

- **operationId**: `workflowsCancelInstance`
- **Security**: bearerAuth + tenantHeader

**Parameters**

| Name               | In     | Required | Type          | Description |
| ------------------ | ------ | -------- | ------------- | ----------- |
| `id`               | path   | yes      | string (uuid) |             |
| `Idempotency-Key`  | header | yes      | string        |             |
| `X-Correlation-ID` | header | no       | string        |             |

**Request body** (required): object

**Responses**

| Status | Description                                                                      | Schema                                 |
| ------ | -------------------------------------------------------------------------------- | -------------------------------------- |
| 200    | Instance cancelled, along with every one of its pending tasks.                   | object                                 |
| 400    | Validation error.                                                                | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                                      | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                                      | [`ApiError`](#standard-error-envelope) |
| 409    | Idempotency-Key reused with a different request, or the instance is not pending. | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/workflows/tasks` — Consolidated approval inbox — keyset-paginated, filterable task list.

- **operationId**: `workflowsGetPendingTasks`
- **Security**: bearerAuth + tenantHeader

**Parameters**

| Name               | In     | Required | Type                                                 | Description |
| ------------------ | ------ | -------- | ---------------------------------------------------- | ----------- |
| `workflowKey`      | query  | no       | string                                               |             |
| `resourceType`     | query  | no       | string                                               |             |
| `status`           | query  | no       | enum(`pending`, `completed`, `skipped`, `cancelled`) |             |
| `overdue`          | query  | no       | boolean                                              |             |
| `search`           | query  | no       | string                                               |             |
| `cursor`           | query  | no       | string                                               |             |
| `X-Correlation-ID` | header | no       | string                                               |             |

**Responses**

| Status | Description                                                                         | Schema                                 |
| ------ | ----------------------------------------------------------------------------------- | -------------------------------------- |
| 200    | Tasks matching the filters (limit 100) with an opaque nextCursor for the next page. | object                                 |
| 400    | Validation error.                                                                   | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                                         | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                                         | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/workflows/tasks/{id}/decisions` — Record a decision (approve/reject) for a pending workflow task (idempotent, audited).

- **operationId**: `workflowsRecordTaskDecision`
- **Security**: bearerAuth + tenantHeader

The task completes only once its quorum rule is satisfied; the instance advances through the graph only once the task completes. High-risk — requires Idempotency-Key.

**Parameters**

| Name               | In     | Required | Type          | Description |
| ------------------ | ------ | -------- | ------------- | ----------- |
| `id`               | path   | yes      | string (uuid) |             |
| `Idempotency-Key`  | header | yes      | string        |             |
| `X-Correlation-ID` | header | no       | string        |             |

**Request body** (required): object

**Responses**

| Status | Description                                                                                        | Schema                                 |
| ------ | -------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 200    | Decision recorded.                                                                                 | object                                 |
| 400    | Validation error.                                                                                  | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                                                        | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC/self-approval, or the caller is not an eligible decider for this task.  | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.                                                                                | [`ApiError`](#standard-error-envelope) |
| 409    | Idempotency-Key reused with a different request, or the task's decision has already been recorded. | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/workflows/tasks/{id}/force-decision` — Administrative recovery — force-approve/force-reject a pending task, bypassing quorum (idempotent, audited).

- **operationId**: `workflowsForceTaskDecision`
- **Security**: bearerAuth + tenantHeader

**Parameters**

| Name               | In     | Required | Type          | Description |
| ------------------ | ------ | -------- | ------------- | ----------- |
| `id`               | path   | yes      | string (uuid) |             |
| `Idempotency-Key`  | header | yes      | string        |             |
| `X-Correlation-ID` | header | no       | string        |             |

**Request body** (required): object

**Responses**

| Status | Description                                                                  | Schema                                 |
| ------ | ---------------------------------------------------------------------------- | -------------------------------------- |
| 200    | Task force-decided and the instance advanced accordingly.                    | object                                 |
| 400    | Validation error.                                                            | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                                  | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                                  | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.                                                          | [`ApiError`](#standard-error-envelope) |
| 409    | Idempotency-Key reused with a different request, or the task is not pending. | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/workflows/tasks/{id}/reassign` — Administrative recovery — reassign a pending task to another tenant user (idempotent, audited).

- **operationId**: `workflowsReassignTask`
- **Security**: bearerAuth + tenantHeader

**Parameters**

| Name               | In     | Required | Type          | Description |
| ------------------ | ------ | -------- | ------------- | ----------- |
| `id`               | path   | yes      | string (uuid) |             |
| `Idempotency-Key`  | header | yes      | string        |             |
| `X-Correlation-ID` | header | no       | string        |             |

**Request body** (required): object

**Responses**

| Status | Description                                                                                                                                                                                             | Schema                                 |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 200    | Task reassigned.                                                                                                                                                                                        | object                                 |
| 400    | Validation error.                                                                                                                                                                                       | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                                                                                                                                                             | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                                                                                                                                                             | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.                                                                                                                                                                                     | [`ApiError`](#standard-error-envelope) |
| 409    | Idempotency-Key reused with a different request, the task is not pending, or the target has already decided this task (reassigning to them would let one person's authority count twice toward quorum). | [`ApiError`](#standard-error-envelope) |

## Email

Provider-neutral transactional email — template management, bulk announcement/notification enqueue, delivery-queue diagnostics/cancel, and suppression list.

### `POST /api/v1/email/announcements` — Enqueue a notification/announcement (idempotent, two-tier ABAC, audited).

- **operationId**: `emailCreateAnnouncement`
- **Security**: bearerAuth + tenantHeader

Requires Idempotency-Key. email.notification.create for every request; email.announcement.create additionally for role/tenant targets.

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `Idempotency-Key`  | header | yes      | string |             |
| `X-Correlation-ID` | header | no       | string |             |

**Request body** (required): object

**Responses**

| Status | Description                                      | Schema                                 |
| ------ | ------------------------------------------------ | -------------------------------------- |
| 200    | Recipients enqueued.                             | object                                 |
| 400    | Validation error.                                | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                      | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                      | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.                              | [`ApiError`](#standard-error-envelope) |
| 409    | Idempotency-Key reused with a different request. | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/email/announcements/preview` — Dry-run announcement targeting — recipient count + synthetic sample only.

- **operationId**: `emailPreviewAnnouncement`
- **Security**: bearerAuth + tenantHeader

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `X-Correlation-ID` | header | no       | string |             |

**Request body** (required): object

**Responses**

| Status | Description                      | Schema                                 |
| ------ | -------------------------------- | -------------------------------------- |
| 200    | Preview (count + sample render). | object                                 |
| 400    | Validation error.                | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.      | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.      | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.              | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/email/messages` — Email delivery-queue diagnostics (masked recipient only, keyset-paginated).

- **operationId**: `emailListMessages`
- **Security**: bearerAuth + tenantHeader

**Parameters**

| Name               | In     | Required | Type                                                                                 | Description |
| ------------------ | ------ | -------- | ------------------------------------------------------------------------------------ | ----------- |
| `status`           | query  | no       | enum(`queued`, `sending`, `sent`, `failed`, `retry_wait`, `cancelled`, `suppressed`) |             |
| `cursor`           | query  | no       | string                                                                               |             |
| `X-Correlation-ID` | header | no       | string                                                                               |             |

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Queue page.                 | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/email/messages/{id}/cancel` — Cancel a still-queued (queued/retry_wait) email message (audited).

- **operationId**: `emailCancelMessage`
- **Security**: bearerAuth + tenantHeader

**Parameters**

| Name               | In     | Required | Type          | Description |
| ------------------ | ------ | -------- | ------------- | ----------- |
| `id`               | path   | yes      | string (uuid) |             |
| `X-Correlation-ID` | header | no       | string        |             |

**Responses**

| Status | Description                              | Schema                                 |
| ------ | ---------------------------------------- | -------------------------------------- |
| 200    | Message cancelled.                       | object                                 |
| 400    | Validation error.                        | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.              | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.              | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.                      | [`ApiError`](#standard-error-envelope) |
| 409    | The message is past a cancellable state. | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/email/suppressions` — List the email suppression list (masked recipient only).

- **operationId**: `emailListSuppressions`
- **Security**: bearerAuth + tenantHeader

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `X-Correlation-ID` | header | no       | string |             |

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Suppression entries.        | object                                 |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/email/suppressions` — Manually suppress a recipient address (audited).

- **operationId**: `emailCreateSuppression`
- **Security**: bearerAuth + tenantHeader

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `X-Correlation-ID` | header | no       | string |             |

**Request body** (required): object

**Responses**

| Status | Description                                   | Schema                                 |
| ------ | --------------------------------------------- | -------------------------------------- |
| 200    | Recipient suppressed (or already suppressed). | object                                 |
| 400    | Validation error.                             | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                   | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                   | [`ApiError`](#standard-error-envelope) |

### `DELETE /api/v1/email/suppressions/{id}` — Remove a suppression entry (hard delete, audited).

- **operationId**: `emailDeleteSuppression`
- **Security**: bearerAuth + tenantHeader

**Parameters**

| Name               | In     | Required | Type          | Description |
| ------------------ | ------ | -------- | ------------- | ----------- |
| `id`               | path   | yes      | string (uuid) |             |
| `X-Correlation-ID` | header | no       | string        |             |

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Suppression entry removed.  | object                                 |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.         | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/email/templates` — List tenant email templates (active by default, newest first).

- **operationId**: `emailListTemplates`
- **Security**: bearerAuth + tenantHeader

**Parameters**

| Name               | In     | Required | Type    | Description |
| ------------------ | ------ | -------- | ------- | ----------- |
| `includeInactive`  | query  | no       | boolean |             |
| `X-Correlation-ID` | header | no       | string  |             |

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Template list.              | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/email/templates` — Create an email template (audited).

- **operationId**: `emailCreateTemplate`
- **Security**: bearerAuth + tenantHeader

409 if an active template already exists for the templateKey.

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `X-Correlation-ID` | header | no       | string |             |

**Request body** (required): object

**Responses**

| Status | Description                                            | Schema                                 |
| ------ | ------------------------------------------------------ | -------------------------------------- |
| 200    | Template created.                                      | object                                 |
| 400    | Validation error.                                      | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                            | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                            | [`ApiError`](#standard-error-envelope) |
| 409    | An active template already exists for the templateKey. | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/email/templates/{id}` — Get one email template (full locale map).

- **operationId**: `emailGetTemplate`
- **Security**: bearerAuth + tenantHeader

**Parameters**

| Name               | In     | Required | Type          | Description |
| ------------------ | ------ | -------- | ------------- | ----------- |
| `id`               | path   | yes      | string (uuid) |             |
| `X-Correlation-ID` | header | no       | string        |             |

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Template detail.            | object                                 |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.         | [`ApiError`](#standard-error-envelope) |

### `PATCH /api/v1/email/templates/{id}` — Partially update an email template (audited).

- **operationId**: `emailUpdateTemplate`
- **Security**: bearerAuth + tenantHeader

**Parameters**

| Name               | In     | Required | Type          | Description |
| ------------------ | ------ | -------- | ------------- | ----------- |
| `id`               | path   | yes      | string (uuid) |             |
| `X-Correlation-ID` | header | no       | string        |             |

**Request body** (required): object

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Template updated.           | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.         | [`ApiError`](#standard-error-envelope) |

### `DELETE /api/v1/email/templates/{id}` — Soft-delete an email template (reason required, audited).

- **operationId**: `emailDeleteTemplate`
- **Security**: bearerAuth + tenantHeader

**Parameters**

| Name               | In     | Required | Type          | Description |
| ------------------ | ------ | -------- | ------------- | ----------- |
| `id`               | path   | yes      | string (uuid) |             |
| `X-Correlation-ID` | header | no       | string        |             |

**Request body** (required): object

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Template soft-deleted.      | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.         | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/email/templates/{id}/preview` — Render a template with synthetic sample data (never a real recipient).

- **operationId**: `emailPreviewTemplate`
- **Security**: bearerAuth + tenantHeader

**Parameters**

| Name               | In     | Required | Type          | Description |
| ------------------ | ------ | -------- | ------------- | ----------- |
| `id`               | path   | yes      | string (uuid) |             |
| `X-Correlation-ID` | header | no       | string        |             |

**Request body** (optional): object

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Rendered preview.           | object                                 |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.         | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/email/templates/{id}/restore` — Restore a soft-deleted email template (audited).

- **operationId**: `emailRestoreTemplate`
- **Security**: bearerAuth + tenantHeader

**Parameters**

| Name               | In     | Required | Type          | Description |
| ------------------ | ------ | -------- | ------------- | ----------- |
| `id`               | path   | yes      | string (uuid) |             |
| `X-Correlation-ID` | header | no       | string        |             |

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Template restored.          | object                                 |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.         | [`ApiError`](#standard-error-envelope) |

## Management Reporting

Generic management reporting views (tenant activity, access/audit summary, sync health, module usage, email queue health) built as live read-aggregations over the foundation modules' tables.

### `GET /api/v1/reports/access-audit` — Access/audit summary — ABAC allow/deny counts (30-day window + all-time) and audit-event total.

- **operationId**: `reportsGetAccessAudit`
- **Security**: bearerAuth + tenantHeader

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `X-Correlation-ID` | header | no       | string |             |

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Access/audit summary.       | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/reports/email-health` — Email queue health — per-status counts, failed/retry backlog, oldest queued, most recent sent.

- **operationId**: `reportsGetEmailHealth`
- **Security**: bearerAuth + tenantHeader

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `X-Correlation-ID` | header | no       | string |             |

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Email queue health summary. | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/reports/module-usage` — Module usage — one generic "has data" row-count signal per registered module.

- **operationId**: `reportsGetModuleUsage`
- **Security**: bearerAuth + tenantHeader

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `X-Correlation-ID` | header | no       | string |             |

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Module usage summary.       | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/reports/sync-health` — Sync health — node counts, last push/pull, open conflicts, pending/failed objects, derived health flags.

- **operationId**: `reportsGetSyncHealth`
- **Security**: bearerAuth + tenantHeader

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `X-Correlation-ID` | header | no       | string |             |

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Sync health summary.        | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/reports/tenant-activity` — Tenant activity summary — name/status/created, active user & office counts, most recent login.

- **operationId**: `reportsGetTenantActivity`
- **Security**: bearerAuth + tenantHeader

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `X-Correlation-ID` | header | no       | string |             |

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Tenant activity summary.    | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |

## Reporting Projections

Module-contributed read-model projection extension to Management Reporting — list registered projection descriptors with live snapshot/freshness status, trigger/resume/cancel an idempotent full rebuild, trigger an on-demand reconciliation against a source control total, and manage/trigger/download scheduled exports (manifest/checksum/expiry, secure tenant-scoped download). A projection is a DERIVED read model, never an authorization source of truth — every operation independently re-checks RBAC/ABAC.

### `GET /api/v1/reports/exports` — List scheduled export configs for the caller's tenant.

- **operationId**: `reportsListScheduledExports`
- **Security**: bearerAuth + tenantHeader

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `projectionKey`    | query  | no       | string |             |
| `X-Correlation-ID` | header | no       | string |             |

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Scheduled export configs.   | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/reports/exports` — Create a scheduled export config. High-risk — requires Idempotency-Key, audited.

- **operationId**: `reportsCreateScheduledExport`
- **Security**: bearerAuth + tenantHeader

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `Idempotency-Key`  | header | yes      | string |             |
| `X-Correlation-ID` | header | no       | string |             |

**Request body** (required): object

**Responses**

| Status | Description                                      | Schema                                 |
| ------ | ------------------------------------------------ | -------------------------------------- |
| 200    | Scheduled export created.                        | object                                 |
| 400    | Validation error.                                | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                      | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                      | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.                              | [`ApiError`](#standard-error-envelope) |
| 409    | Idempotency-Key reused with a different request. | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/reports/exports/{id}/disable` — Disable (soft-delete) a scheduled export config. High-risk — requires Idempotency-Key, reason-required, audited.

- **operationId**: `reportsDisableScheduledExport`
- **Security**: bearerAuth + tenantHeader

**Parameters**

| Name               | In     | Required | Type          | Description |
| ------------------ | ------ | -------- | ------------- | ----------- |
| `id`               | path   | yes      | string (uuid) |             |
| `Idempotency-Key`  | header | yes      | string        |             |
| `X-Correlation-ID` | header | no       | string        |             |

**Request body** (required): object

**Responses**

| Status | Description                                      | Schema                                 |
| ------ | ------------------------------------------------ | -------------------------------------- |
| 200    | Scheduled export disabled.                       | object                                 |
| 400    | Validation error.                                | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                      | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                      | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.                              | [`ApiError`](#standard-error-envelope) |
| 409    | Idempotency-Key reused with a different request. | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/reports/exports/runs` — Export run history (manifest/checksum/expiry evidence), optionally filtered by projectionKey.

- **operationId**: `reportsListExportRuns`
- **Security**: bearerAuth + tenantHeader

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `projectionKey`    | query  | no       | string |             |
| `X-Correlation-ID` | header | no       | string |             |

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Export run history.         | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/reports/exports/runs/{id}/download` — Secure, tenant-scoped, checksum-verified download of a completed export artifact. Re-checks RBAC/ABAC at download time; refuses an expired artifact with 410 Gone.

- **operationId**: `reportsDownloadExportRun`
- **Security**: bearerAuth + tenantHeader

**Parameters**

| Name               | In     | Required | Type          | Description |
| ------------------ | ------ | -------- | ------------- | ----------- |
| `id`               | path   | yes      | string (uuid) |             |
| `X-Correlation-ID` | header | no       | string        |             |

**Responses**

| Status | Description                                                          | Schema                                 |
| ------ | -------------------------------------------------------------------- | -------------------------------------- |
| 200    | The export artifact (CSV or JSON), with an X-Checksum-Sha256 header. | object                                 |
| 400    | Validation error.                                                    | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                          | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                          | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.                                                  | [`ApiError`](#standard-error-envelope) |
| 410    | The export artifact has expired.                                     | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/reports/exports/trigger` — Manually generate an export of a projection's current snapshot. High-risk — requires Idempotency-Key, audited.

- **operationId**: `reportsTriggerExport`
- **Security**: bearerAuth + tenantHeader

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `Idempotency-Key`  | header | yes      | string |             |
| `X-Correlation-ID` | header | no       | string |             |

**Request body** (required): object

**Responses**

| Status | Description                                      | Schema                                 |
| ------ | ------------------------------------------------ | -------------------------------------- |
| 200    | Export run generated.                            | object                                 |
| 400    | Validation error.                                | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                      | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                      | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.                              | [`ApiError`](#standard-error-envelope) |
| 409    | Idempotency-Key reused with a different request. | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/reports/projections` — List every registered tenant-scoped projection descriptor's live snapshot/freshness.

- **operationId**: `reportsListProjections`
- **Security**: bearerAuth + tenantHeader

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `X-Correlation-ID` | header | no       | string |             |

**Responses**

| Status | Description                                                   | Schema                                 |
| ------ | ------------------------------------------------------------- | -------------------------------------- |
| 200    | Projection summaries (filtered to those the caller may read). | object                                 |
| 400    | Validation error.                                             | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                   | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                   | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/reports/projections/{key}` — A single projection's snapshot/freshness plus recent reconciliation history.

- **operationId**: `reportsGetProjection`
- **Security**: bearerAuth + tenantHeader

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `key`              | path   | yes      | string |             |
| `X-Correlation-ID` | header | no       | string |             |

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Projection detail.          | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.         | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/reports/projections/{key}/rebuild` — Trigger (or resume) a full idempotent projection rebuild. High-risk — requires Idempotency-Key, reason-required, audited.

- **operationId**: `reportsRebuildProjection`
- **Security**: bearerAuth + tenantHeader

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `key`              | path   | yes      | string |             |
| `Idempotency-Key`  | header | yes      | string |             |
| `X-Correlation-ID` | header | no       | string |             |

**Request body** (required): object

**Responses**

| Status | Description                                                  | Schema                                 |
| ------ | ------------------------------------------------------------ | -------------------------------------- |
| 200    | Rebuild run triggered (or the already-running run returned). | object                                 |
| 400    | Validation error.                                            | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                  | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                  | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.                                          | [`ApiError`](#standard-error-envelope) |
| 409    | Idempotency-Key reused with a different request.             | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/reports/projections/{key}/rebuild/cancel` — Request cooperative cancellation of the currently-running rebuild. High-risk — requires Idempotency-Key, audited.

- **operationId**: `reportsCancelProjectionRebuild`
- **Security**: bearerAuth + tenantHeader

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `key`              | path   | yes      | string |             |
| `Idempotency-Key`  | header | yes      | string |             |
| `X-Correlation-ID` | header | no       | string |             |

**Responses**

| Status | Description                                      | Schema                                 |
| ------ | ------------------------------------------------ | -------------------------------------- |
| 200    | Cancellation requested.                          | object                                 |
| 400    | Validation error.                                | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                      | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                      | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.                              | [`ApiError`](#standard-error-envelope) |
| 409    | Idempotency-Key reused with a different request. | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/reports/projections/{key}/reconcile` — On-demand reconciliation of a projection's metrics against a freshly computed source control total. No Idempotency-Key (zero business-state mutation).

- **operationId**: `reportsReconcileProjection`
- **Security**: bearerAuth + tenantHeader

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `key`              | path   | yes      | string |             |
| `X-Correlation-ID` | header | no       | string |             |

**Responses**

| Status | Description                       | Schema                                 |
| ------ | --------------------------------- | -------------------------------------- |
| 200    | Reconciliation snapshot recorded. | object                                 |
| 400    | Validation error.                 | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.       | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.       | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.               | [`ApiError`](#standard-error-envelope) |

## Domain Event Runtime

Transactional, versioned domain-event outbox and dispatcher admin API — read-only inspection of outbox events and per-consumer deliveries (redacted payload projections only), permission-gated/reason-required/idempotent/audited replay of a dead-lettered delivery, and per-tenant pause/resume of a registered consumer.

### `GET /api/v1/domain-events/consumers` — List the static consumer registry with per-tenant pause state and backlog counts.

- **operationId**: `listDomainEventConsumers`
- **Security**: bearerAuth + tenantHeader

**Responses**

| Status | Description                                 | Schema                                 |
| ------ | ------------------------------------------- | -------------------------------------- |
| 200    | Consumer registry with pause/backlog state. | object                                 |
| 401    | Missing or invalid session.                 | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                 | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/domain-events/consumers/{name}/pause` — Pause a domain event consumer for this tenant (reason required, audited).

- **operationId**: `pauseDomainEventConsumer`
- **Security**: bearerAuth + tenantHeader

**Parameters**

| Name   | In   | Required | Type   | Description |
| ------ | ---- | -------- | ------ | ----------- |
| `name` | path | yes      | string |             |

**Request body** (required): object

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Updated consumer state.     | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.         | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/domain-events/consumers/{name}/resume` — Resume a paused domain event consumer for this tenant (audited).

- **operationId**: `resumeDomainEventConsumer`
- **Security**: bearerAuth + tenantHeader

**Parameters**

| Name   | In   | Required | Type   | Description |
| ------ | ---- | -------- | ------ | ----------- |
| `name` | path | yes      | string |             |

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Updated consumer state.     | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.         | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/domain-events/deliveries` — List consumer delivery/attempt status (status=dead_letter is the DLQ view).

- **operationId**: `listDomainEventDeliveries`
- **Security**: bearerAuth + tenantHeader

**Parameters**

| Name           | In    | Required | Type                                                   | Description |
| -------------- | ----- | -------- | ------------------------------------------------------ | ----------- |
| `status`       | query | no       | enum(`pending`, `delivered`, `dead_letter`, `skipped`) |             |
| `consumerName` | query | no       | string                                                 |             |
| `eventType`    | query | no       | string                                                 |             |

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Delivery list.              | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/domain-events/deliveries/{id}` — Fetch one delivery with its joined event (redacted payload projection). DLQ inspection view.

- **operationId**: `getDomainEventDelivery`
- **Security**: bearerAuth + tenantHeader

**Parameters**

| Name | In   | Required | Type          | Description |
| ---- | ---- | -------- | ------------- | ----------- |
| `id` | path | yes      | string (uuid) |             |

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Delivery detail.            | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.         | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/domain-events/deliveries/{id}/replay` — Replay a dead-lettered delivery (permission-gated, reason-required, idempotent, audited).

- **operationId**: `replayDomainEventDelivery`
- **Security**: bearerAuth + tenantHeader

**Parameters**

| Name              | In     | Required | Type          | Description |
| ----------------- | ------ | -------- | ------------- | ----------- |
| `id`              | path   | yes      | string (uuid) |             |
| `Idempotency-Key` | header | yes      | string        |             |

**Request body** (required): object

**Responses**

| Status | Description                                                                  | Schema                                 |
| ------ | ---------------------------------------------------------------------------- | -------------------------------------- |
| 200    | The newly created replay delivery.                                           | object                                 |
| 400    | Validation error.                                                            | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                                  | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                                  | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.                                                          | [`ApiError`](#standard-error-envelope) |
| 409    | Delivery not dead-lettered, or consumer no longer supports the event schema. | [`ApiError`](#standard-error-envelope) |
| 413    | Validation error.                                                            | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/domain-events/events` — List domain event outbox entries (redacted payload projections only, max 200).

- **operationId**: `listDomainEvents`
- **Security**: bearerAuth + tenantHeader

**Parameters**

| Name            | In    | Required | Type          | Description |
| --------------- | ----- | -------- | ------------- | ----------- |
| `eventType`     | query | no       | string        |             |
| `aggregateType` | query | no       | string        |             |
| `aggregateId`   | query | no       | string (uuid) |             |

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Domain event list.          | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/domain-events/events/{id}` — Fetch one domain event outbox entry (redacted payload projection only).

- **operationId**: `getDomainEvent`
- **Security**: bearerAuth + tenantHeader

**Parameters**

| Name | In   | Required | Type          | Description |
| ---- | ---- | -------- | ------------- | ----------- |
| `id` | path | yes      | string (uuid) |             |

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Domain event detail.        | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.         | [`ApiError`](#standard-error-envelope) |

## Theming

Tenant-selectable presentation (ADR-0034 Fase 3 — the first website module in the base). Select a trusted, reviewed, build-time theme and configure it by DATA only (design tokens, slot variants, media asset ids, section order, nav placement) — no uploaded code, no arbitrary templates. Every token value is validated by rejection against strict CSS grammars; published versions are immutable; publish/rollback/retire are ABAC-gated, idempotency-keyed, and audited.

### `GET /api/v1/theming` — Read this tenant's theme selection, available themes, draft, and version history

- **operationId**: `themingRead`
- **Security**: bearerAuth + tenantHeader

Everything the theming admin surface needs: the available (reviewed, build-time) theme descriptors, this tenant's active theme pointer, its current draft config (if any), and its published version history. Gated by `theming.config.read`.

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `X-Correlation-ID` | header | no       | string |             |

**Responses**

| Status | Description                  | Schema                                 |
| ------ | ---------------------------- | -------------------------------------- |
| 200    | This tenant's theming state. | object                                 |
| 400    | Validation error.            | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.  | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.  | [`ApiError`](#standard-error-envelope) |

### `PUT /api/v1/theming/draft` — Save/replace this tenant's draft theme config

- **operationId**: `themingDraftUpdate`
- **Security**: bearerAuth + tenantHeader

Save the single draft config for a chosen theme (bounded, validated design tokens, slot variants, media asset ids, section order, nav placement). The body is validated against the theme descriptor (the CSS-injection spine + declared-surface bounding) before any DB work. High-risk (the draft is what publish promotes): requires an `Idempotency-Key`, audited. Gated by `theming.config.update`.

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `Idempotency-Key`  | header | yes      | string |             |
| `X-Correlation-ID` | header | no       | string |             |

**Request body** (required): [`ThemeConfigRequest`](#schema-themeconfigrequest)

**Responses**

| Status | Description                                                              | Schema                                 |
| ------ | ------------------------------------------------------------------------ | -------------------------------------- |
| 200    | Draft saved (or an idempotent replay).                                   | object                                 |
| 400    | Validation error.                                                        | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                              | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                              | [`ApiError`](#standard-error-envelope) |
| 409    | The `Idempotency-Key` was already used with a different request payload. | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/theming/preview` — Create a short-lived, non-indexable preview session for the draft

- **operationId**: `themingPreviewCreate`
- **Security**: bearerAuth + tenantHeader

Mint an authorized, short-lived, non-indexable preview of the current draft and return its URL (`/theming/preview/{token}`) + expiry. The raw token is returned once; only its hash is stored. Audited. Gated by `theming.preview.create`. Not idempotency-keyed (each preview is a distinct disposable token).

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `X-Correlation-ID` | header | no       | string |             |

**Request body** (optional): object

**Responses**

| Status | Description                       | Schema                                 |
| ------ | --------------------------------- | -------------------------------------- |
| 200    | The preview session URL + expiry. | object                                 |
| 400    | Validation error.                 | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.       | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.       | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/theming/publish` — Publish the draft as an immutable version (and make it live)

- **operationId**: `themingPublish`
- **Security**: bearerAuth + tenantHeader

Publish the current draft as a new IMMUTABLE version and make it the live look (INSERT-only; published versions are immutable). High-risk: requires an `Idempotency-Key`, audited. Gated by `theming.version.publish`.

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `Idempotency-Key`  | header | yes      | string |             |
| `X-Correlation-ID` | header | no       | string |             |

**Responses**

| Status | Description                                                              | Schema                                 |
| ------ | ------------------------------------------------------------------------ | -------------------------------------- |
| 200    | Published (or an idempotent replay).                                     | object                                 |
| 400    | Validation error.                                                        | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                              | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                              | [`ApiError`](#standard-error-envelope) |
| 409    | The `Idempotency-Key` was already used with a different request payload. | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/theming/retire` — Retire the active theme (fall back to the default)

- **operationId**: `themingRetire`
- **Security**: bearerAuth + tenantHeader

Clear the active theme pointer so the site falls back to the default theme; published versions stay intact (history/rollback). High-risk: requires an `Idempotency-Key`, audited. Gated by `theming.version.archive`.

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `Idempotency-Key`  | header | yes      | string |             |
| `X-Correlation-ID` | header | no       | string |             |

**Responses**

| Status | Description                                                              | Schema                                 |
| ------ | ------------------------------------------------------------------------ | -------------------------------------- |
| 200    | Retired (or an idempotent replay).                                       | object                                 |
| 400    | Validation error.                                                        | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                              | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                              | [`ApiError`](#standard-error-envelope) |
| 409    | The `Idempotency-Key` was already used with a different request payload. | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/theming/rollback` — Roll the active theme back to an earlier published version

- **operationId**: `themingRollback`
- **Security**: bearerAuth + tenantHeader

Move the active pointer to an earlier published version of this tenant (never mutates a version row). High-risk: requires an `Idempotency-Key`, audited. Gated by `theming.version.restore`.

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `Idempotency-Key`  | header | yes      | string |             |
| `X-Correlation-ID` | header | no       | string |             |

**Request body** (required): object

**Responses**

| Status | Description                                                              | Schema                                 |
| ------ | ------------------------------------------------------------------------ | -------------------------------------- |
| 200    | Rolled back (or an idempotent replay).                                   | object                                 |
| 400    | Validation error.                                                        | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                              | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                              | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.                                                      | [`ApiError`](#standard-error-envelope) |
| 409    | The `Idempotency-Key` was already used with a different request payload. | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/theming/validate` — Validate a theme config (dry run) + preview its token CSS

- **operationId**: `themingValidate`
- **Security**: bearerAuth + tenantHeader

Read-only: validate a proposed theme config against its theme descriptor and, when valid, return the exact `text/css` custom-property block it would produce — writing nothing. Gated by `theming.config.read`.

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `X-Correlation-ID` | header | no       | string |             |

**Request body** (required): [`ThemeConfigRequest`](#schema-themeconfigrequest)

**Responses**

| Status | Description                                     | Schema                                 |
| ------ | ----------------------------------------------- | -------------------------------------- |
| 200    | The validation result (+ token CSS when valid). | object                                 |
| 400    | Validation error.                               | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                     | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                     | [`ApiError`](#standard-error-envelope) |

## News Media

Direct-to-R2 presigned upload flow for news images (media_library module, ADR-0036 ownership inversion — the registry moved out of the retired news_portal module and the tag/path names were deliberately kept) — create an upload session (server-generated object key + short-lived presigned PUT URL), finalize (real R2 GET + magic-byte MIME sniffing + server-side SHA-256 checksum, never a bare HEAD), and cancel a still-pending_upload session. R2 credentials are never exposed to the browser; only a scoped, expiring presigned URL is returned.

### `GET /api/v1/media/enforcement` — Read whether managed-media enforcement is active for this tenant

- **operationId**: `mediaEnforcementRead`
- **Security**: bearerAuth + tenantHeader

Gated by media_library.enforcement.read. Reports whether this tenant's content media references must resolve to verified registry objects, and — when enforcement cannot be enabled — the deployment-config reasons why (ADR-0036 step 5a). `reasons` name environment variables, never their values, so nothing secret is exposed; the endpoint is still permission-gated rather than public.

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `X-Correlation-ID` | header | no       | string |             |

**Responses**

| Status | Description                                                                       | Schema                                 |
| ------ | --------------------------------------------------------------------------------- | -------------------------------------- |
| 200    | Current enforcement state for this tenant plus this deployment's media readiness. | object                                 |
| 400    | Validation error.                                                                 | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                                       | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                                       | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/media/enforcement` — Turn managed-media enforcement ON for this tenant (one-way)

- **operationId**: `mediaEnforcementEnable`
- **Security**: bearerAuth + tenantHeader

Gated by media_library.enforcement.enable. High-risk, requires Idempotency-Key. Enables managed-media enforcement: from then on, content media references must resolve to verified, same-tenant registry objects rather than raw URLs (ADR-0036 step 5a). This is the switch a brochure-site tenant (`blog_content` + `tenant_domain`, no news portal) previously did not have. This operation is one-way and there is deliberately no counterpart that disables enforcement — a tenant able to switch its own media validation off is a confirmed exploit this design exists to prevent (see migration `sql/043`'s header). A deployment that must roll back does so by changing its `NEWS_MEDIA_R2_*` configuration. Idempotent: re-enabling an already-enforcing tenant succeeds, refreshes the timestamp, and returns `alreadyEnforced: true`; only a successful enable is recorded under the Idempotency-Key, so a rejected (not-ready) attempt may retry the same key after the R2 config is fixed.

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `Idempotency-Key`  | header | yes      | string |             |
| `X-Correlation-ID` | header | no       | string |             |

**Responses**

| Status | Description                                                                                                                                                                                                                                                                                                                                                                                                           | Schema                                 |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 200    | Enforcement is active for this tenant.                                                                                                                                                                                                                                                                                                                                                                                | object                                 |
| 400    | Validation error.                                                                                                                                                                                                                                                                                                                                                                                                     | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                                                                                                                                                                                                                                                                                                                                                                           | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                                                                                                                                                                                                                                                                                                                                                                           | [`ApiError`](#standard-error-envelope) |
| 409    | Either the deployment's media storage is not ready, so enforcement cannot be enabled (`MANAGED_MEDIA_NOT_READY`) — `error.details.reasons` says which check failed; a 409 rather than a 400 on purpose (the request is well-formed and the caller is authorized; it is the deployment, not the request body, that must change) — or the Idempotency-Key was reused with a different request (`IDEMPOTENCY_CONFLICT`). | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/media/news-images/upload-sessions` — Create a direct-to-R2 presigned upload session for a news image

- **operationId**: `newsMediaUploadSessionsCreate`
- **Security**: bearerAuth + tenantHeader

Gated by media_library.media.create. Returns a `pending_upload` metadata row plus a short-lived presigned PUT URL scoped to exactly one server-generated object key. Raw R2 credentials are never exposed to the browser.

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `X-Correlation-ID` | header | no       | string |             |

**Request body** (required): [`CreateNewsMediaUploadSessionRequest`](#schema-createnewsmediauploadsessionrequest)

**Responses**

| Status | Description                                                                                    | Schema                                 |
| ------ | ---------------------------------------------------------------------------------------------- | -------------------------------------- |
| 200    | Upload session created — a `pending_upload` metadata row plus a short-lived presigned PUT URL. | object                                 |
| 400    | Validation error.                                                                              | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                                                    | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                                                    | [`ApiError`](#standard-error-envelope) |
| 502    | News media R2 storage is not configured/enabled for this deployment.                           | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/media/news-images/upload-sessions/{id}/cancel` — Cancel a still-pending-upload session

- **operationId**: `newsMediaUploadSessionsCancel`
- **Security**: bearerAuth + tenantHeader

Gated by media_library.media.cancel. Transitions a `pending_upload` session to `failed`.

**Parameters**

| Name               | In     | Required | Type          | Description |
| ------------------ | ------ | -------- | ------------- | ----------- |
| `id`               | path   | yes      | string (uuid) |             |
| `X-Correlation-ID` | header | no       | string        |             |

**Responses**

| Status | Description                                                                         | Schema                                 |
| ------ | ----------------------------------------------------------------------------------- | -------------------------------------- |
| 200    | Upload session cancelled (status `failed`).                                         | object                                 |
| 400    | Validation error.                                                                   | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                                         | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                                         | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.                                                                 | [`ApiError`](#standard-error-envelope) |
| 409    | Upload session is not `pending_upload` (already uploaded/verified/attached/failed). | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/media/news-images/upload-sessions/{id}/finalize` — Finalize an upload session — real R2 GET + magic-byte MIME sniffing + server-side SHA-256 checksum (never a bare HEAD)

- **operationId**: `newsMediaUploadSessionsFinalize`
- **Security**: bearerAuth + tenantHeader

Gated by media_library.media.verify. High-risk, requires Idempotency-Key. Verifies the object actually uploaded to R2 (HEAD for existence/real size, then a full GET), sniffs the MIME type from the object's real magic bytes, and computes a SHA-256 checksum server-side. A client-claimed `checksumSha256` is only a transport-corruption cross-check, never a substitute for the MIME sniff — HEAD alone can never promote a media object to `verified`.

**Parameters**

| Name               | In     | Required | Type          | Description |
| ------------------ | ------ | -------- | ------------- | ----------- |
| `id`               | path   | yes      | string (uuid) |             |
| `Idempotency-Key`  | header | yes      | string        |             |
| `X-Correlation-ID` | header | no       | string        |             |

**Request body** (optional): [`FinalizeNewsMediaUploadSessionRequest`](#schema-finalizenewsmediauploadsessionrequest)

**Responses**

| Status | Description                                                                                                                                                                                                                        | Schema                                 |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 200    | Object verified — media object status is now `verified` (or an idempotent replay).                                                                                                                                                 | object                                 |
| 400    | Validation error.                                                                                                                                                                                                                  | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                                                                                                                                                                                        | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                                                                                                                                                                                        | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.                                                                                                                                                                                                                | [`ApiError`](#standard-error-envelope) |
| 409    | Upload session is not `pending_upload`, has expired (`UPLOAD_SESSION_EXPIRED`), or the Idempotency-Key was reused with a different request (`IDEMPOTENCY_CONFLICT`).                                                               | [`ApiError`](#standard-error-envelope) |
| 422    | Uploaded object failed content verification (`UPLOAD_VERIFICATION_FAILED`). `error.details.reason` is one of `object_not_found`, `size_exceeded`, `mime_not_recognized`, `mime_not_allowed`, `mime_mismatch`, `checksum_mismatch`. | [`ApiError`](#standard-error-envelope) |
| 502    | Unable to verify the uploaded object right now (R2 provider error/circuit breaker open) — retry shortly.                                                                                                                           | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/media/objects` — Batch-resolve media object ids to their public reference.

- **operationId**: `mediaResolveObjects`
- **Security**: bearerAuth + tenantHeader

Resolves up to 100 media object ids at once to `{publicUrl, altText, mimeType, width, height, sizeBytes}`. Gated on `media_library.media.read`; read-only, so a machine credential (ADR-0049) may hold it.

An object resolves ONLY when it is `verified` or `attached`, belongs to the calling tenant, and is not soft-deleted. Everything else — unknown, cross-tenant, unverified, deleted — is returned in `unresolved` rather than dropped, so a caller can tell "this resource has no image" from "this resource's image reference is broken". A malformed (non-uuid) id is a 400 instead: "you sent junk" and "that object is not referenceable" are different facts.

Batch rather than one-per-id because a build feed resolves every image on a page at once, and the underlying query is already a single `id = ANY(...)`.

**Parameters**

| Name               | In     | Required | Type   | Description                                      |
| ------------------ | ------ | -------- | ------ | ------------------------------------------------ |
| `ids`              | query  | yes      | string | Comma-separated media object uuids, at most 100. |
| `X-Correlation-ID` | header | no       | string |                                                  |

**Responses**

| Status | Description                                             | Schema                                 |
| ------ | ------------------------------------------------------- | -------------------------------------- |
| 200    | Resolved references, plus the ids that did not resolve. | object                                 |
| 400    | Validation error.                                       | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                             | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                             | [`ApiError`](#standard-error-envelope) |

### `DELETE /api/v1/media/objects/{id}` — Soft delete one media object.

- **operationId**: `mediaObjectSoftDelete`
- **Security**: bearerAuth + tenantHeader

Gated on `media_library.media.delete`. High-risk, requires `Idempotency-Key`. Body: `{ "reason": string }` — required, trimmed, at most 500 characters, and recorded on the audit row.

Soft delete only: `deleted_at`/`deleted_by`/`delete_reason` are set and `status` is left alone. The R2 object is untouched.

This BREAKS live references on purpose — `GET /api/v1/media/objects` resolves only non-deleted objects, so a post whose `featured_media_id` points here begins resolving to nothing immediately. That is the intended outcome for the case this endpoint serves (a policy-violating image must stop being served), and it is recoverable through `POST /api/v1/media/objects/{id}/restore`. The endpoint deliberately does not scan for referencing rows first: that would require this module to know its own consumers.

An already-deleted object and an unknown id both answer 404 — a distinct "already deleted" would let a caller without `media.read` probe which ids exist.

**Parameters**

| Name               | In     | Required | Type          | Description |
| ------------------ | ------ | -------- | ------------- | ----------- |
| `id`               | path   | yes      | string (uuid) |             |
| `Idempotency-Key`  | header | yes      | string        |             |
| `X-Correlation-ID` | header | no       | string        |             |

**Request body** (required): [`SoftDeleteMediaObjectRequest`](#schema-softdeletemediaobjectrequest)

**Responses**

| Status | Description                                                                       | Schema                                 |
| ------ | --------------------------------------------------------------------------------- | -------------------------------------- |
| 200    | The media object is soft-deleted.                                                 | object                                 |
| 400    | Validation error.                                                                 | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                                       | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                                       | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.                                                               | [`ApiError`](#standard-error-envelope) |
| 409    | The Idempotency-Key was reused with a different request (`IDEMPOTENCY_CONFLICT`). | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/media/objects/{id}/purge` — Hard-delete the registry row of an already soft-deleted media object.

- **operationId**: `mediaObjectPurge`
- **Security**: bearerAuth + tenantHeader

Gated on `media_library.media.purge`. High-risk, requires `Idempotency-Key`, and cannot be undone. No body.

**Clears the registry row, NOT the R2 bytes.** The `news-media:reconcile` job owns the bucket and has the ordering discipline for deleting from it; a second writer here would mean two processes with different ideas of what is safe to remove. Accepted, stated cost: a window where the R2 object outlives its registry row, closed by the next reconciliation tick, which sees a key with no row and treats it as an orphan-in-R2.

The object must ALREADY be soft-deleted — purging a live object answers 404 rather than destroying it.

**Parameters**

| Name               | In     | Required | Type          | Description |
| ------------------ | ------ | -------- | ------------- | ----------- |
| `id`               | path   | yes      | string (uuid) |             |
| `Idempotency-Key`  | header | yes      | string        |             |
| `X-Correlation-ID` | header | no       | string        |             |

**Responses**

| Status | Description                                                                                                                                                                                              | Schema                                 |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 200    | The registry row is gone. The R2 object is removed later by the reconciliation job.                                                                                                                      | object                                 |
| 400    | Validation error.                                                                                                                                                                                        | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                                                                                                                                                              | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                                                                                                                                                              | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.                                                                                                                                                                                      | [`ApiError`](#standard-error-envelope) |
| 409    | Another resource still holds a foreign key to this object (`MEDIA_OBJECT_REFERENCED` — remove the reference first), or the Idempotency-Key was reused with a different request (`IDEMPOTENCY_CONFLICT`). | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/media/objects/{id}/restore` — Undo a soft delete.

- **operationId**: `mediaObjectRestore`
- **Security**: bearerAuth + tenantHeader

Gated on `media_library.media.restore`. High-risk, requires `Idempotency-Key`. No body.

Clears `deleted_at`/`deleted_by`/`delete_reason` and stamps `restored_at`/`restored_by`. `status` is untouched — soft delete is orthogonal to it — so the object returns to whatever lifecycle state it was in.

Restoring an object that is NOT soft-deleted answers 404 rather than succeeding as a no-op: "there was nothing to undo" and "it worked" must not share a response.

**Parameters**

| Name               | In     | Required | Type          | Description |
| ------------------ | ------ | -------- | ------------- | ----------- |
| `id`               | path   | yes      | string (uuid) |             |
| `Idempotency-Key`  | header | yes      | string        |             |
| `X-Correlation-ID` | header | no       | string        |             |

**Responses**

| Status | Description                                                                       | Schema                                 |
| ------ | --------------------------------------------------------------------------------- | -------------------------------------- |
| 200    | The media object is restored.                                                     | object                                 |
| 400    | Validation error.                                                                 | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                                       | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                                       | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.                                                               | [`ApiError`](#standard-error-envelope) |
| 409    | The Idempotency-Key was reused with a different request (`IDEMPOTENCY_CONFLICT`). | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/media/objects/list` — Browse this tenant's media registry.

- **operationId**: `mediaObjectList`
- **Security**: bearerAuth + tenantHeader

Gated on `media_library.media.read`. Keyset-paginated, newest first, 50 per page. Read-only, so a machine credential (ADR-0049) may hold it.

**A separate path from `GET /api/v1/media/objects`, deliberately.** That endpoint demands `?ids=` — it is a batch RESOLVER built for the `awcms-astro` build to swap ids for public URLs. Teaching it a "no `ids` means list everything" branch would turn a request that is a 400 today into a dump of the whole registry: a contract change wearing the clothes of an addition, and one no existing caller could opt out of.

`list` can never be mistaken for an object id — the object routes require a uuid and answer 400 otherwise — so this static path and `/{id}` do not contend.

**Unlike the resolver, this returns rows in ANY status** (`pending_upload`, `failed`, `orphaned`) and, with `deletion`, soft-deleted ones. That inverts the resolver's public-safety rule on purpose: an administrator opens this list precisely because of the objects that are not healthy, and the lifecycle endpoints need a way to find their targets. Nothing returned here may be used as a public reference — that is what the resolver is for.

The projection omits `bucket_name`/`storage_driver` (deployment facts) and `owner_resource_type`/`owner_resource_id` (vestigial since ADR-0036 moved attachment to the consumer's FK).

`cursor` is opaque: pass back `nextCursor` verbatim. A malformed one is a 400, never silently treated as "no cursor" — that would serve page 1 to a caller who asked for page 4.

**Parameters**

| Name               | In     | Required | Type                                                                                        | Description                                                                                                                                |
| ------------------ | ------ | -------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `status`           | query  | no       | enum(`pending_upload`, `uploaded`, `verified`, `attached`, `orphaned`, `deleted`, `failed`) | Exact media object status. An unrecognised value is a 400, never ignored.                                                                  |
| `mimeType`         | query  | no       | string                                                                                      | Exact mime type. Lowercased before matching, since that is how the registry stores it.                                                     |
| `deletion`         | query  | no       | enum(`live`, `deleted`, `all`)                                                              | Which soft-delete state to list. Defaults to `live`; `deleted` is what a restore/purge workflow needs, and a boolean could not ask for it. |
| `cursor`           | query  | no       | string                                                                                      | Opaque keyset cursor from a previous response's `nextCursor`.                                                                              |
| `X-Correlation-ID` | header | no       | string                                                                                      |                                                                                                                                            |

**Responses**

| Status | Description                              | Schema                                 |
| ------ | ---------------------------------------- | -------------------------------------- |
| 200    | One page of media objects, newest first. | object                                 |
| 400    | Validation error.                        | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.              | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.              | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/media/public-origin` — The origin media public URLs are served from.

- **operationId**: `mediaPublicOrigin`
- **Security**: bearerAuth + tenantHeader

Requires `media_library.media.read`. Deployment config, not tenant data: every tenant on a deployment is served from the same bucket.

Exists for build clients such as `awcms-astro`, whose Content-Security-Policy must name the media host in `img-src` BEFORE it fetches any object — an image resolved correctly still renders as nothing when the policy blocks the host it lives on. The alternative is copying `NEWS_MEDIA_R2_PUBLIC_BASE_URL` into the consumer by hand, which is two copies of one value that agree until one is edited.

`origin` is scheme + host + port, for the host-wide CSP form; `baseUrl` includes the path, for the tighter prefix form. Both are reported because neither choice is this API's to make.

A deployment that serves no public media (LAN/offline profiles) answers `200` with `configured: false` rather than an error, so a build can omit the `img-src` entry instead of failing. A value that is set but unparseable, or on a scheme that cannot serve media, is reported the same way and never echoed back.

**Responses**

| Status | Description                                                   | Schema                                 |
| ------ | ------------------------------------------------------------- | -------------------------------------- |
| 200    | The configured media origin, or an explicit "not configured". | object                                 |
| 401    | Missing or invalid session.                                   | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                   | [`ApiError`](#standard-error-envelope) |

## Blog Content

Tenant-scoped blog/content administration (blog_content module, ported from awcms-mini) — posts and pages with their full lifecycle (draft → review → scheduled/published → archived, soft delete/restore/purge), hierarchical categories/tags, append-only revision history (restore APPENDS a revision, never overwrites), PostgreSQL full-text search, presentation/monetization extensions (templates, hierarchical menus, position-based widgets, advertisements), per-tenant blog settings, internal tag-link policy, and the editorial content-quality checklist. The public, anonymous reader surface (`/blog/{tenantCode}/...` index/detail/archive/search/feed/sitemap, ADR-0009) is served by Astro text/html/xml routes and is deliberately NOT part of this REST contract. Publish/unpublish/purge and settings writes are ABAC-gated, idempotency-keyed, and audited.

### `GET /api/v1/blog/ads` — List this tenant's advertisements

- **operationId**: `blogListAds`
- **Security**: bearerAuth + tenantHeader

Gated by blog_content.ads.read.

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `X-Correlation-ID` | header | no       | string |             |

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Matching ads.               | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/blog/ads` — Create an advertisement (RETIRED — always 410)

- **operationId**: `blogCreateAd`
- **Security**: bearerAuth + tenantHeader

RETIRED by ADR-0044 §4. Always responds 410 ENDPOINT_RETIRED, without auth or any database access. This endpoint stored a free-text imageUrl — any URL an admin typed, rendered straight into a public img src — which is the managed-media bypass ADR-0036 closed. Upload the image through the media library, then use POST /api/v1/news-portal/ad-placements, which requires a verified media object. GET and DELETE on this resource still work, so the ingest job's residue report stays resolvable.

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `X-Correlation-ID` | header | no       | string |             |

**Responses**

| Status | Description                                                    | Schema                                 |
| ------ | -------------------------------------------------------------- | -------------------------------------- |
| 410    | Endpoint retired. The successor is named in the error message. | [`ApiError`](#standard-error-envelope) |

### `PATCH /api/v1/blog/ads/{id}` — Update an advertisement (RETIRED — always 410)

- **operationId**: `blogUpdateAd`
- **Security**: bearerAuth + tenantHeader

RETIRED by ADR-0044 §4. Always responds 410 ENDPOINT_RETIRED, without auth or any database access. Closing POST alone would not have sufficed: this endpoint could rewrite imageUrl on an existing ad, the same free-URL bypass by a quieter route that creates no new row. Use PATCH /api/v1/news-portal/ad-placements/{id}, which requires a verified media object.

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `X-Correlation-ID` | header | no       | string |             |

**Responses**

| Status | Description                                                    | Schema                                 |
| ------ | -------------------------------------------------------------- | -------------------------------------- |
| 410    | Endpoint retired. The successor is named in the error message. | [`ApiError`](#standard-error-envelope) |

### `DELETE /api/v1/blog/ads/{id}` — Soft delete an advertisement

- **operationId**: `blogDeleteAd`
- **Security**: bearerAuth + tenantHeader

Gated by blog_content.ads.configure.

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `X-Correlation-ID` | header | no       | string |             |

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Ad soft-deleted.            | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.         | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/blog/internal-tag-links/settings` — Read this tenant's automatic internal tag linking policy

- **operationId**: `blogGetInternalTagLinkSettings`
- **Security**: bearerAuth + tenantHeader

Gated by blog_content.internal_links.read.

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `X-Correlation-ID` | header | no       | string |             |

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | The policy.                 | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |

### `PATCH /api/v1/blog/internal-tag-links/settings` — Update this tenant's automatic internal tag linking policy

- **operationId**: `blogUpdateInternalTagLinkSettings`
- **Security**: bearerAuth + tenantHeader

Gated by blog_content.internal_links.configure. disabledTagIds are validated against this tenant's own tag catalog.

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `X-Correlation-ID` | header | no       | string |             |

**Request body** (required): object

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Policy updated.             | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/blog/menus` — List this tenant's navigation menus (with items)

- **operationId**: `blogListMenus`
- **Security**: bearerAuth + tenantHeader

Gated by blog_content.menus.read.

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `X-Correlation-ID` | header | no       | string |             |

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Matching menus.             | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/blog/menus` — Create a navigation menu

- **operationId**: `blogCreateMenu`
- **Security**: bearerAuth + tenantHeader

Gated by blog_content.menus.configure. Optionally seeds its initial items tree (one level of nesting; link_type post|page|url gates target_id/url).

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `X-Correlation-ID` | header | no       | string |             |

**Request body** (required): object

**Responses**

| Status | Description                         | Schema                                 |
| ------ | ----------------------------------- | -------------------------------------- |
| 200    | Menu created.                       | object                                 |
| 400    | Validation error.                   | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.         | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.         | [`ApiError`](#standard-error-envelope) |
| 409    | A menu already exists for this key. | [`ApiError`](#standard-error-envelope) |

### `PATCH /api/v1/blog/menus/{id}` — Update a navigation menu (name and/or its items tree)

- **operationId**: `blogUpdateMenu`
- **Security**: bearerAuth + tenantHeader

Gated by blog_content.menus.configure. Providing items replaces the whole tree.

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `X-Correlation-ID` | header | no       | string |             |

**Request body** (required): object

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Menu updated.               | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.         | [`ApiError`](#standard-error-envelope) |

### `DELETE /api/v1/blog/menus/{id}` — Soft delete a navigation menu

- **operationId**: `blogDeleteMenu`
- **Security**: bearerAuth + tenantHeader

Gated by blog_content.menus.configure.

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `X-Correlation-ID` | header | no       | string |             |

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Menu soft-deleted.          | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.         | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/blog/pages` — List this tenant's non-deleted blog pages

- **operationId**: `blogListPages`
- **Security**: bearerAuth + tenantHeader

Gated by blog_content.pages.read. Optional ?status= filter, ?limit= bounded.

**Parameters**

| Name               | In     | Required | Type                                                          | Description |
| ------------------ | ------ | -------- | ------------------------------------------------------------- | ----------- |
| `status`           | query  | no       | enum(`draft`, `review`, `scheduled`, `published`, `archived`) |             |
| `limit`            | query  | no       | integer                                                       |             |
| `X-Correlation-ID` | header | no       | string                                                        |             |

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Matching pages.             | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/blog/pages` — Create a draft blog page

- **operationId**: `blogCreatePage`
- **Security**: bearerAuth + tenantHeader

Gated by blog_content.pages.create. Not idempotency-keyed (caught by the (tenant_id, locale, slug) partial unique index).

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `X-Correlation-ID` | header | no       | string |             |

**Request body** (required): [`BlogPageWriteInput`](#schema-blogpagewriteinput)

**Responses**

| Status | Description                                                                              | Schema                                 |
| ------ | ---------------------------------------------------------------------------------------- | -------------------------------------- |
| 200    | Page created.                                                                            | object                                 |
| 400    | Validation error.                                                                        | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                                              | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                                              | [`ApiError`](#standard-error-envelope) |
| 409    | A page already exists for this slug/locale.                                              | [`ApiError`](#standard-error-envelope) |
| 422    | One or more image references are not valid R2 media objects in full-online R2-only mode. | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/blog/pages/{id}` — Read one blog page

- **operationId**: `blogGetPage`
- **Security**: bearerAuth + tenantHeader

Gated by blog_content.pages.read.

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `X-Correlation-ID` | header | no       | string |             |

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | The page.                   | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.         | [`ApiError`](#standard-error-envelope) |

### `PATCH /api/v1/blog/pages/{id}` — Update a blog page

- **operationId**: `blogUpdatePage`
- **Security**: bearerAuth + tenantHeader

Gated by blog_content.pages.update. Only fields present in the body are changed. A significant change snapshots an append-only revision first.

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `X-Correlation-ID` | header | no       | string |             |

**Request body** (required): [`BlogPageWriteInput`](#schema-blogpagewriteinput)

**Responses**

| Status | Description                                                                              | Schema                                 |
| ------ | ---------------------------------------------------------------------------------------- | -------------------------------------- |
| 200    | Page updated.                                                                            | object                                 |
| 400    | Validation error.                                                                        | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                                              | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                                              | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.                                                                      | [`ApiError`](#standard-error-envelope) |
| 422    | One or more image references are not valid R2 media objects in full-online R2-only mode. | [`ApiError`](#standard-error-envelope) |

### `DELETE /api/v1/blog/pages/{id}` — Soft delete a blog page

- **operationId**: `blogDeletePage`
- **Security**: bearerAuth + tenantHeader

Gated by blog_content.pages.delete.

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `X-Correlation-ID` | header | no       | string |             |

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Page soft-deleted.          | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.         | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/blog/pages/{id}/archive` — Archive a blog page

- **operationId**: `blogArchivePage`
- **Security**: bearerAuth + tenantHeader

Gated by blog_content.pages.archive (ADR-0057). High-risk, requires Idempotency-Key. Removes the page from the public site without destroying it; published_at is retained so a later re-publish keeps the original go-live date.

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `Idempotency-Key`  | header | yes      | string |             |
| `X-Correlation-ID` | header | no       | string |             |

**Responses**

| Status | Description                                                                                  | Schema                                 |
| ------ | -------------------------------------------------------------------------------------------- | -------------------------------------- |
| 200    | Page archived (or an idempotent replay).                                                     | object                                 |
| 400    | Validation error.                                                                            | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                                                  | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                                                  | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.                                                                          | [`ApiError`](#standard-error-envelope) |
| 409    | Invalid status transition, or the Idempotency-Key was already used with a different request. | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/blog/pages/{id}/publish` — Publish a blog page

- **operationId**: `blogPublishPage`
- **Security**: bearerAuth + tenantHeader

Gated by blog_content.pages.publish (ADR-0057). High-risk, requires Idempotency-Key. Blocked (422) if the content quality checklist fails when full-online R2-only mode is active for the tenant. Pages have a narrower lifecycle than posts - no review, no scheduled - so the only sources for this transition are draft and archived. No social-publishing hook is invoked - that port's trigger is post_published and a page is not an article.

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `Idempotency-Key`  | header | yes      | string |             |
| `X-Correlation-ID` | header | no       | string |             |

**Responses**

| Status | Description                                                                                  | Schema                                 |
| ------ | -------------------------------------------------------------------------------------------- | -------------------------------------- |
| 200    | Page published (or an idempotent replay).                                                    | object                                 |
| 400    | Validation error.                                                                            | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                                                  | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                                                  | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.                                                                          | [`ApiError`](#standard-error-envelope) |
| 409    | Invalid status transition, or the Idempotency-Key was already used with a different request. | [`ApiError`](#standard-error-envelope) |
| 422    | Publish is blocked by the content quality checklist.                                         | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/blog/pages/{id}/purge` — Permanently purge an archived or soft-deleted blog page

- **operationId**: `blogPurgePage`
- **Security**: bearerAuth + tenantHeader

Gated by blog_content.pages.purge (ADR-0057). High-risk, irreversible, requires Idempotency-Key. Only an archived or previously soft-deleted page may be purged. Advertisement placements targeting this page neither block the purge nor are deleted with it - they simply go inert, exactly as they already do for a soft-deleted page, because the render query matches target_id against the page being rendered. Their count is returned as adPlacementsNowInert so the change is visible rather than silent.

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `Idempotency-Key`  | header | yes      | string |             |
| `X-Correlation-ID` | header | no       | string |             |

**Responses**

| Status | Description                                                                                                      | Schema                                 |
| ------ | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 200    | Page purged (or an idempotent replay).                                                                           | object                                 |
| 400    | Validation error.                                                                                                | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                                                                      | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                                                                      | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.                                                                                              | [`ApiError`](#standard-error-envelope) |
| 409    | The page is neither archived nor soft-deleted, or the Idempotency-Key was already used with a different request. | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/blog/pages/{id}/quality-checklist` — Preview the content quality checklist for a page

- **operationId**: `blogGetPageQualityChecklist`
- **Security**: bearerAuth + tenantHeader

Read-only preview for the admin editor. Gated by blog_content.pages.read.

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `X-Correlation-ID` | header | no       | string |             |

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | The checklist result.       | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.         | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/blog/pages/{id}/restore` — Restore a soft-deleted blog page

- **operationId**: `blogRestorePage`
- **Security**: bearerAuth + tenantHeader

Gated by blog_content.pages.restore (ADR-0057). High-risk, requires Idempotency-Key. Undoes a soft delete, not an archive - lifecycle status is left untouched, so a page soft-deleted while published comes back published. A page that is not soft-deleted answers 404, the same shape as an unknown id, so restore cannot be used to probe which ids exist.

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `Idempotency-Key`  | header | yes      | string |             |
| `X-Correlation-ID` | header | no       | string |             |

**Responses**

| Status | Description                                                    | Schema                                 |
| ------ | -------------------------------------------------------------- | -------------------------------------- |
| 200    | Page restored (or an idempotent replay).                       | object                                 |
| 400    | Validation error.                                              | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                    | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                    | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.                                            | [`ApiError`](#standard-error-envelope) |
| 409    | The Idempotency-Key was already used with a different request. | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/blog/posts` — List this tenant's non-deleted blog posts

- **operationId**: `blogListPosts`
- **Security**: bearerAuth + tenantHeader

Gated by blog_content.posts.read. Optional ?status= and ?locale= filters, ?limit= bounded (default 20, max 100 — max 50 with `view=full`, whose rows carry `contentJson`).

Ordering defaults to `updated_at DESC` — right for an admin table, and unsound as a keyset key because editing a post moves it, so a row can cross a page boundary between requests and be skipped or repeated. A caller that needs EVERY post (a build feed) passes `?order=created_at`, which is immutable, and follows `nextCursor` until it is null. `?cursor=` without `?order=created_at` is refused with 400 rather than quietly honoured.

**The default response is `BlogPostSummary`, not `BlogPost`.** It carries no `contentJson`, `excerpt`, `metaDescription`, `canonicalUrl`, or `translationGroupId`. This document used to say otherwise, and a client that believed it built an entire static site with every article body empty — nothing failed, because a missing field reads as `undefined`. A caller that needs the body asks for `?view=full` (which requires `order=created_at`) and receives `BlogPost`.

**Parameters**

| Name     | In    | Required | Type                                                          | Description                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------- | ----- | -------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `status` | query | no       | enum(`draft`, `review`, `scheduled`, `published`, `archived`) |                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `locale` | query | no       | string                                                        | Exact match on the post's stored locale. Absent means every locale, which is the right default for an admin table but wasteful for a single-language build feed — that is what this parameter exists for. Not shape-validated beyond non-empty and a 35-character bound, because the write path accepts any non-empty string and a stricter read filter would make a stored locale unreachable. An empty value is a 400, never treated as absent. |
| `limit`  | query | no       | integer                                                       |                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `order`  | query | no       | enum(`created_at`, `updated_at`)                              | Sort key. `created_at` selects the STABLE, cursor-capable traversal; `updated_at` (default) is the admin ordering and rejects `cursor`.                                                                                                                                                                                                                                                                                                           |
| `cursor` | query | no       | string                                                        | Opaque keyset cursor from a previous response's `nextCursor`. Requires `order=created_at`. A malformed value is a 400, never treated as "no cursor".                                                                                                                                                                                                                                                                                              |
| `view`   | query | no       | enum(`summary`, `full`)                                       | Response projection. `summary` (default) returns `BlogPostSummary`; `full` returns `BlogPost` — every column the detail endpoint returns except `termIds`, which would cost one extra query per post.                                                                                                                                                                                                                                             |

`full` requires `order=created_at`: a full traversal is only sound over the immutable ordering, and the ordering is demanded rather than silently substituted. An unrecognised value is a 400, never a silent fallback to `summary`.
|
| `X-Correlation-ID` | header | no | string | |

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Matching posts.             | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/blog/posts` — Create a draft blog post

- **operationId**: `blogCreatePost`
- **Security**: bearerAuth + tenantHeader

Gated by blog_content.posts.create. Not idempotency-keyed (a retry duplicating a create is caught by the (tenant_id, locale, slug) partial unique index).

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `X-Correlation-ID` | header | no       | string |             |

**Request body** (required): [`BlogPostWriteInput`](#schema-blogpostwriteinput)

**Responses**

| Status | Description                                                                                                                              | Schema                                 |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 200    | Post created.                                                                                                                            | object                                 |
| 400    | Validation error.                                                                                                                        | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                                                                                              | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                                                                                              | [`ApiError`](#standard-error-envelope) |
| 409    | A post already exists for this slug/locale, or the referenced media is not R2-verified in full-online R2-only mode (422 for the latter). | [`ApiError`](#standard-error-envelope) |
| 422    | One or more image/video-thumbnail references are not valid R2 media objects in full-online R2-only mode.                                 | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/blog/posts/{id}` — Read one blog post

- **operationId**: `blogGetPost`
- **Security**: bearerAuth + tenantHeader

Gated by blog_content.posts.read.

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `X-Correlation-ID` | header | no       | string |             |

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | The post.                   | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.         | [`ApiError`](#standard-error-envelope) |

### `PATCH /api/v1/blog/posts/{id}` — Update a blog post

- **operationId**: `blogUpdatePost`
- **Security**: bearerAuth + tenantHeader

Gated by blog_content.posts.update (with an ownership carve-out — a draft's own author may update it without the broader permission). Only fields present in the body are changed. A significant title/contentJson/contentText change snapshots an append-only revision first.

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `X-Correlation-ID` | header | no       | string |             |

**Request body** (required): [`BlogPostWriteInput`](#schema-blogpostwriteinput)

**Responses**

| Status | Description                                                                                              | Schema                                 |
| ------ | -------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 200    | Post updated.                                                                                            | object                                 |
| 400    | Validation error.                                                                                        | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                                                              | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                                                              | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.                                                                                      | [`ApiError`](#standard-error-envelope) |
| 422    | One or more image/video-thumbnail references are not valid R2 media objects in full-online R2-only mode. | [`ApiError`](#standard-error-envelope) |

### `DELETE /api/v1/blog/posts/{id}` — Soft delete a blog post

- **operationId**: `blogDeletePost`
- **Security**: bearerAuth + tenantHeader

Gated by blog_content.posts.delete. Soft delete only (deleted_at/deleted_by/delete_reason) — see POST .../purge for the permanent, high-risk purge.

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `X-Correlation-ID` | header | no       | string |             |

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Post soft-deleted.          | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.         | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/blog/posts/{id}/archive` — Archive a blog post

- **operationId**: `blogArchivePost`
- **Security**: bearerAuth + tenantHeader

Gated by blog_content.posts.archive. High-risk, requires Idempotency-Key.

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `Idempotency-Key`  | header | yes      | string |             |
| `X-Correlation-ID` | header | no       | string |             |

**Responses**

| Status | Description                                                                                  | Schema                                 |
| ------ | -------------------------------------------------------------------------------------------- | -------------------------------------- |
| 200    | Post archived (or an idempotent replay).                                                     | object                                 |
| 400    | Validation error.                                                                            | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                                                  | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                                                  | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.                                                                          | [`ApiError`](#standard-error-envelope) |
| 409    | Invalid status transition, or the Idempotency-Key was already used with a different request. | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/blog/posts/{id}/internal-links/preview` — Preview automatic internal tag linking for a post

- **operationId**: `blogPreviewPostInternalLinks`
- **Security**: bearerAuth + tenantHeader

Read-only preview of which tags would be automatically linked in this post's rendered content before publishing. Gated by blog_content.internal_links.preview.

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `X-Correlation-ID` | header | no       | string |             |

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | The preview result.         | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.         | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/blog/posts/{id}/publish` — Publish a blog post

- **operationId**: `blogPublishPost`
- **Security**: bearerAuth + tenantHeader

Gated by blog_content.posts.publish (no ownership carve-out). High-risk, requires Idempotency-Key. Blocked (422) if the content quality checklist fails when full-online R2-only mode is active for the tenant. On success, also invokes the social-publishing outbox hook (a documented no-op in this base — social_publishing is not ported).

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `Idempotency-Key`  | header | yes      | string |             |
| `X-Correlation-ID` | header | no       | string |             |

**Responses**

| Status | Description                                                                                  | Schema                                 |
| ------ | -------------------------------------------------------------------------------------------- | -------------------------------------- |
| 200    | Post published (or an idempotent replay).                                                    | object                                 |
| 400    | Validation error.                                                                            | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                                                  | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                                                  | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.                                                                          | [`ApiError`](#standard-error-envelope) |
| 409    | Invalid status transition, or the Idempotency-Key was already used with a different request. | [`ApiError`](#standard-error-envelope) |
| 422    | Publish is blocked by the content quality checklist.                                         | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/blog/posts/{id}/purge` — Permanently purge a soft-deleted blog post

- **operationId**: `blogPurgePost`
- **Security**: bearerAuth + tenantHeader

Gated by blog_content.posts.purge. High-risk, irreversible, requires Idempotency-Key. Only a previously soft-deleted post may be purged.

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `Idempotency-Key`  | header | yes      | string |             |
| `X-Correlation-ID` | header | no       | string |             |

**Responses**

| Status | Description                                                                                     | Schema                                 |
| ------ | ----------------------------------------------------------------------------------------------- | -------------------------------------- |
| 200    | Post purged (or an idempotent replay).                                                          | object                                 |
| 400    | Validation error.                                                                               | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                                                     | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                                                     | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.                                                                             | [`ApiError`](#standard-error-envelope) |
| 409    | The post is not soft-deleted, or the Idempotency-Key was already used with a different request. | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/blog/posts/{id}/quality-checklist` — Preview the content quality checklist for a post

- **operationId**: `blogGetPostQualityChecklist`
- **Security**: bearerAuth + tenantHeader

Read-only preview for the admin editor — runs the exact same evaluator POST .../publish and .../schedule enforce. Gated by blog_content.posts.read (no separate permission).

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `X-Correlation-ID` | header | no       | string |             |

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | The checklist result.       | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.         | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/blog/posts/{id}/restore` — Restore a soft-deleted blog post

- **operationId**: `blogRestorePost`
- **Security**: bearerAuth + tenantHeader

Gated by blog_content.posts.restore. High-risk, requires Idempotency-Key.

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `Idempotency-Key`  | header | yes      | string |             |
| `X-Correlation-ID` | header | no       | string |             |

**Responses**

| Status | Description                                                    | Schema                                 |
| ------ | -------------------------------------------------------------- | -------------------------------------- |
| 200    | Post restored (or an idempotent replay).                       | object                                 |
| 400    | Validation error.                                              | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                    | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                    | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.                                            | [`ApiError`](#standard-error-envelope) |
| 409    | The Idempotency-Key was already used with a different request. | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/blog/posts/{id}/revisions` — List a post's revision history

- **operationId**: `blogListPostRevisions`
- **Security**: bearerAuth + tenantHeader

Gated by blog_content.revisions.read. Newest first.

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `X-Correlation-ID` | header | no       | string |             |

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | The revision list.          | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.         | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/blog/posts/{id}/revisions/{revisionId}` — Read one revision of a post

- **operationId**: `blogGetPostRevision`
- **Security**: bearerAuth + tenantHeader

Gated by blog_content.revisions.read.

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `X-Correlation-ID` | header | no       | string |             |

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | The revision.               | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.         | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/blog/posts/{id}/revisions/{revisionId}/restore` — Restore a post to an earlier revision

- **operationId**: `blogRestorePostRevision`
- **Security**: bearerAuth + tenantHeader

Gated by blog_content.revisions.restore. High-risk, requires Idempotency-Key. Restoring APPENDS a new revision snapshot of the restored content — it never overwrites or removes the revision being restored from.

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `Idempotency-Key`  | header | yes      | string |             |
| `X-Correlation-ID` | header | no       | string |             |

**Responses**

| Status | Description                                                                                                                      | Schema                                 |
| ------ | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 200    | Post restored to the given revision (or an idempotent replay).                                                                   | object                                 |
| 400    | Validation error.                                                                                                                | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                                                                                      | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                                                                                      | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.                                                                                                              | [`ApiError`](#standard-error-envelope) |
| 409    | The Idempotency-Key was already used with a different request.                                                                   | [`ApiError`](#standard-error-envelope) |
| 422    | One or more image/video-thumbnail references in the restored content are not valid R2 media objects in full-online R2-only mode. | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/blog/posts/{id}/schedule` — Schedule a blog post for future publishing

- **operationId**: `blogSchedulePost`
- **Security**: bearerAuth + tenantHeader

Gated by blog_content.posts.schedule. High-risk, requires Idempotency-Key. Same content quality checklist gate as publish. The blog:publish:scheduled job later performs the actual publish once scheduledAt <= now().

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `Idempotency-Key`  | header | yes      | string |             |
| `X-Correlation-ID` | header | no       | string |             |

**Request body** (required): object

**Responses**

| Status | Description                                                                                  | Schema                                 |
| ------ | -------------------------------------------------------------------------------------------- | -------------------------------------- |
| 200    | Post scheduled (or an idempotent replay).                                                    | object                                 |
| 400    | Validation error.                                                                            | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                                                  | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                                                  | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.                                                                          | [`ApiError`](#standard-error-envelope) |
| 409    | Invalid status transition, or the Idempotency-Key was already used with a different request. | [`ApiError`](#standard-error-envelope) |
| 422    | Scheduling is blocked by the content quality checklist.                                      | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/blog/posts/{id}/submit-review` — Submit a draft post for review

- **operationId**: `blogSubmitPostForReview`
- **Security**: bearerAuth + tenantHeader

Transitions draft -> review. Gated by blog_content.posts.update (same ownership carve-out as PATCH .../{id}). Not idempotency-keyed — the status transition is naturally idempotent.

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `X-Correlation-ID` | header | no       | string |             |

**Responses**

| Status | Description                                            | Schema                                 |
| ------ | ------------------------------------------------------ | -------------------------------------- |
| 200    | Post submitted for review.                             | object                                 |
| 400    | Validation error.                                      | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                            | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                            | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.                                    | [`ApiError`](#standard-error-envelope) |
| 409    | The post's current status cannot transition to review. | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/blog/search` — Full-text search across posts and pages

- **operationId**: `blogSearchContent`
- **Security**: bearerAuth + tenantHeader

Gated by blog_content.search.read. May return content of any status per the caller's granted permission. Keyset-paginated (?cursor=).

**Parameters**

| Name               | In     | Required | Type                                                          | Description |
| ------------------ | ------ | -------- | ------------------------------------------------------------- | ----------- |
| `q`                | query  | yes      | string                                                        |             |
| `resourceType`     | query  | no       | enum(`post`, `page`)                                          |             |
| `status`           | query  | no       | enum(`draft`, `review`, `scheduled`, `published`, `archived`) |             |
| `cursor`           | query  | no       | string                                                        |             |
| `limit`            | query  | no       | integer                                                       |             |
| `X-Correlation-ID` | header | no       | string                                                        |             |

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Matching results.           | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/blog/settings` — Read this tenant's blog settings

- **operationId**: `blogGetSettings`
- **Security**: bearerAuth + tenantHeader

Gated by blog_content.settings.read.

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `X-Correlation-ID` | header | no       | string |             |

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | The tenant's blog settings. | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |

### `PATCH /api/v1/blog/settings` — Update this tenant's blog settings

- **operationId**: `blogUpdateSettings`
- **Security**: bearerAuth + tenantHeader

Gated by blog_content.settings.configure. Only fields present in the body are changed.

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `X-Correlation-ID` | header | no       | string |             |

**Request body** (required): object

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Settings updated.           | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/blog/templates` — List this tenant's presentation templates

- **operationId**: `blogListTemplates`
- **Security**: bearerAuth + tenantHeader

Gated by blog_content.templates.read.

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `X-Correlation-ID` | header | no       | string |             |

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Matching templates.         | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/blog/templates` — Create a presentation template

- **operationId**: `blogCreateTemplate`
- **Security**: bearerAuth + tenantHeader

Gated by blog_content.templates.configure. layoutJson is a whitelisted shape: { columns: 1|2|3, sidebarPosition: left|right|none }.

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `X-Correlation-ID` | header | no       | string |             |

**Request body** (required): object

**Responses**

| Status | Description                             | Schema                                 |
| ------ | --------------------------------------- | -------------------------------------- |
| 200    | Template created.                       | object                                 |
| 400    | Validation error.                       | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.             | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.             | [`ApiError`](#standard-error-envelope) |
| 409    | A template already exists for this key. | [`ApiError`](#standard-error-envelope) |

### `PATCH /api/v1/blog/templates/{id}` — Update a presentation template

- **operationId**: `blogUpdateTemplate`
- **Security**: bearerAuth + tenantHeader

Gated by blog_content.templates.configure.

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `X-Correlation-ID` | header | no       | string |             |

**Request body** (required): object

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Template updated.           | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.         | [`ApiError`](#standard-error-envelope) |

### `DELETE /api/v1/blog/templates/{id}` — Soft delete a presentation template

- **operationId**: `blogDeleteTemplate`
- **Security**: bearerAuth + tenantHeader

Gated by blog_content.templates.configure.

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `X-Correlation-ID` | header | no       | string |             |

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Template soft-deleted.      | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.         | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/blog/terms` — List this tenant's categories/tags

- **operationId**: `blogListTerms`
- **Security**: bearerAuth + tenantHeader

Gated by blog_content.taxonomies.read. Optional ?taxonomyType= filter.

**Parameters**

| Name               | In     | Required | Type                    | Description |
| ------------------ | ------ | -------- | ----------------------- | ----------- |
| `taxonomyType`     | query  | no       | enum(`category`, `tag`) |             |
| `X-Correlation-ID` | header | no       | string                  |             |

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Matching terms.             | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/blog/terms` — Create a category or tag

- **operationId**: `blogCreateTerm`
- **Security**: bearerAuth + tenantHeader

Gated by blog_content.taxonomies.configure. A tag must never carry a parentId.

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `X-Correlation-ID` | header | no       | string |             |

**Request body** (required): [`BlogTermWriteInput`](#schema-blogtermwriteinput)

**Responses**

| Status | Description                                       | Schema                                 |
| ------ | ------------------------------------------------- | -------------------------------------- |
| 200    | Term created.                                     | object                                 |
| 400    | Validation error.                                 | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                       | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                       | [`ApiError`](#standard-error-envelope) |
| 409    | A term already exists for this taxonomyType/slug. | [`ApiError`](#standard-error-envelope) |

### `PATCH /api/v1/blog/terms/{id}` — Update a category or tag

- **operationId**: `blogUpdateTerm`
- **Security**: bearerAuth + tenantHeader

Gated by blog_content.taxonomies.configure.

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `X-Correlation-ID` | header | no       | string |             |

**Request body** (required): [`BlogTermWriteInput`](#schema-blogtermwriteinput)

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Term updated.               | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.         | [`ApiError`](#standard-error-envelope) |

### `DELETE /api/v1/blog/terms/{id}` — Soft delete a category or tag

- **operationId**: `blogDeleteTerm`
- **Security**: bearerAuth + tenantHeader

Gated by blog_content.taxonomies.configure.

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `X-Correlation-ID` | header | no       | string |             |

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Term soft-deleted.          | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.         | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/blog/theme` — Read this tenant's blog theme mode setting

- **operationId**: `blogGetTheme`
- **Security**: bearerAuth + tenantHeader

Gated by blog_content.theme.read. Absence of a row means "inherit the tenant's default_theme".

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `X-Correlation-ID` | header | no       | string |             |

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | The theme setting.          | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |

### `PATCH /api/v1/blog/theme` — Update this tenant's blog theme mode setting

- **operationId**: `blogUpdateTheme`
- **Security**: bearerAuth + tenantHeader

Gated by blog_content.theme.configure.

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `X-Correlation-ID` | header | no       | string |             |

**Request body** (required): object

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Theme setting updated.      | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/blog/widgets` — List this tenant's widgets

- **operationId**: `blogListWidgets`
- **Security**: bearerAuth + tenantHeader

Gated by blog_content.widgets.read.

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `X-Correlation-ID` | header | no       | string |             |

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Matching widgets.           | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/blog/widgets` — Create a widget

- **operationId**: `blogCreateWidget`
- **Security**: bearerAuth + tenantHeader

Gated by blog_content.widgets.configure. bodyText is plain text, escaped at render time (no raw-HTML field).

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `X-Correlation-ID` | header | no       | string |             |

**Request body** (required): object

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Widget created.             | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |

### `PATCH /api/v1/blog/widgets/{id}` — Update a widget

- **operationId**: `blogUpdateWidget`
- **Security**: bearerAuth + tenantHeader

Gated by blog_content.widgets.configure.

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `X-Correlation-ID` | header | no       | string |             |

**Request body** (required): object

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Widget updated.             | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.         | [`ApiError`](#standard-error-envelope) |

### `DELETE /api/v1/blog/widgets/{id}` — Soft delete a widget

- **operationId**: `blogDeleteWidget`
- **Security**: bearerAuth + tenantHeader

Gated by blog_content.widgets.configure.

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `X-Correlation-ID` | header | no       | string |             |

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Widget soft-deleted.        | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.         | [`ApiError`](#standard-error-envelope) |

## News Portal Homepage Sections

Editorial homepage section composer (blog_content module — absorbed from the retired news_portal module by ADR-0044, which moved ownership without renaming the paths or this tag) — tenant-scoped, RLS-protected CRUD for configurable homepage sections (headline, latest_posts, featured_posts, editor_picks, category_grid, gallery_block). config shape is validated per sectionType server-side; every referenced post/category/media object must already exist for the same tenant (and gallery_block media must be a verified R2 media object). sectionType is immutable after creation; reordering is just a patchable sortOrder field.

### `GET /api/v1/news-portal/homepage-sections` — List this tenant's homepage sections (admin view)

- **operationId**: `newsPortalHomepageSectionsList`
- **Security**: bearerAuth + tenantHeader

Gated by news_portal.homepage_sections.read.

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `X-Correlation-ID` | header | no       | string |             |

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Homepage sections.          | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/news-portal/homepage-sections` — Create a homepage section

- **operationId**: `newsPortalHomepageSectionsCreate`
- **Security**: bearerAuth + tenantHeader

Gated by news_portal.homepage_sections.configure. `config` is validated per `sectionType`; every referenced post/category/media object must already exist for this tenant (and gallery_block media must be a verified R2 media object).

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `X-Correlation-ID` | header | no       | string |             |

**Request body** (required): [`HomepageSectionCreateRequest`](#schema-homepagesectioncreaterequest)

**Responses**

| Status | Description                                                                                                                              | Schema                                 |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 200    | Homepage section created.                                                                                                                | object                                 |
| 400    | Validation error.                                                                                                                        | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                                                                                              | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                                                                                              | [`ApiError`](#standard-error-envelope) |
| 409    | sectionKey is already in use for this tenant.                                                                                            | [`ApiError`](#standard-error-envelope) |
| 422    | config references content that does not exist, does not belong to this tenant, or (for gallery_block) is not a verified R2 media object. | [`ApiError`](#standard-error-envelope) |

### `PATCH /api/v1/news-portal/homepage-sections/{id}` — Update a homepage section (title/config/sortOrder/isEnabled/schedule) — sectionType is immutable

- **operationId**: `newsPortalHomepageSectionsUpdate`
- **Security**: bearerAuth + tenantHeader

Gated by news_portal.homepage_sections.configure.

**Parameters**

| Name               | In     | Required | Type          | Description |
| ------------------ | ------ | -------- | ------------- | ----------- |
| `id`               | path   | yes      | string (uuid) |             |
| `X-Correlation-ID` | header | no       | string        |             |

**Request body** (required): [`HomepageSectionUpdateRequest`](#schema-homepagesectionupdaterequest)

**Responses**

| Status | Description                                                                                                                              | Schema                                 |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 200    | Homepage section updated.                                                                                                                | object                                 |
| 400    | Validation error.                                                                                                                        | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                                                                                              | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                                                                                              | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.                                                                                                                      | [`ApiError`](#standard-error-envelope) |
| 422    | config references content that does not exist, does not belong to this tenant, or (for gallery_block) is not a verified R2 media object. | [`ApiError`](#standard-error-envelope) |

### `DELETE /api/v1/news-portal/homepage-sections/{id}` — Soft-delete a homepage section

- **operationId**: `newsPortalHomepageSectionsDelete`
- **Security**: bearerAuth + tenantHeader

Gated by news_portal.homepage_sections.configure.

**Parameters**

| Name               | In     | Required | Type          | Description |
| ------------------ | ------ | -------- | ------------- | ----------- |
| `id`               | path   | yes      | string (uuid) |             |
| `X-Correlation-ID` | header | no       | string        |             |

**Request body** (required): object

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Homepage section deleted.   | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.         | [`ApiError`](#standard-error-envelope) |

## News Portal Ad Placements

R2-only advertisement placement presets for the news portal (blog_content module — absorbed from the retired news_portal module by ADR-0044, which moved ownership without renaming the paths or this tag) — tenant-scoped, RLS-protected CRUD for ads assigned to a fixed set of placement keys. mediaObjectId must reference a verified R2 media object belonging to the same tenant — never a local path or arbitrary external image URL. linkUrl is optional and may be external, but is validated server-side as an absolute http(s) URL only.

### `GET /api/v1/news-portal/ad-placements` — List this tenant's ad placements (admin view)

- **operationId**: `newsPortalAdPlacementsList`
- **Security**: bearerAuth + tenantHeader

Gated by news_portal.ad_placements.read.

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `X-Correlation-ID` | header | no       | string |             |

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Ad placements.              | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/news-portal/ad-placements` — Create an ad placement (R2-only image, verified media object required)

- **operationId**: `newsPortalAdPlacementsCreate`
- **Security**: bearerAuth + tenantHeader

Gated by news_portal.ad_placements.configure. `mediaObjectId` must reference a verified (`verified`/`attached`) R2 media object for this tenant.

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `X-Correlation-ID` | header | no       | string |             |

**Request body** (required): [`AdPlacementCreateRequest`](#schema-adplacementcreaterequest)

**Responses**

| Status | Description                                                                                                                                               | Schema                                 |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 200    | Ad placement created.                                                                                                                                     | object                                 |
| 400    | Validation error.                                                                                                                                         | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                                                                                                               | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                                                                                                               | [`ApiError`](#standard-error-envelope) |
| 422    | mediaObjectId does not exist, does not belong to this tenant, is not a verified R2 media object, or is not an allowed mime type for the target placement. | [`ApiError`](#standard-error-envelope) |

### `PATCH /api/v1/news-portal/ad-placements/{id}` — Update an ad placement (media reference/link/rotation/schedule/active)

- **operationId**: `newsPortalAdPlacementsUpdate`
- **Security**: bearerAuth + tenantHeader

Gated by news_portal.ad_placements.configure.

**Parameters**

| Name               | In     | Required | Type          | Description |
| ------------------ | ------ | -------- | ------------- | ----------- |
| `id`               | path   | yes      | string (uuid) |             |
| `X-Correlation-ID` | header | no       | string        |             |

**Request body** (required): [`AdPlacementUpdateRequest`](#schema-adplacementupdaterequest)

**Responses**

| Status | Description                                                                                                                                               | Schema                                 |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 200    | Ad placement updated.                                                                                                                                     | object                                 |
| 400    | Validation error.                                                                                                                                         | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                                                                                                               | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                                                                                                               | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.                                                                                                                                       | [`ApiError`](#standard-error-envelope) |
| 422    | mediaObjectId does not exist, does not belong to this tenant, is not a verified R2 media object, or is not an allowed mime type for the target placement. | [`ApiError`](#standard-error-envelope) |

### `DELETE /api/v1/news-portal/ad-placements/{id}` — Soft-delete an ad placement

- **operationId**: `newsPortalAdPlacementsDelete`
- **Security**: bearerAuth + tenantHeader

Gated by news_portal.ad_placements.configure.

**Parameters**

| Name               | In     | Required | Type          | Description |
| ------------------ | ------ | -------- | ------------- | ----------- |
| `id`               | path   | yes      | string (uuid) |             |
| `X-Correlation-ID` | header | no       | string        |             |

**Request body** (required): object

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Ad placement deleted.       | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.         | [`ApiError`](#standard-error-envelope) |

## Visitor Analytics

Privacy-first human visitor statistics for admin and public routes (visitor_analytics module, ported from awcms-micro) — the anonymous public visit-ingest beacon plus the authenticated, ABAC-guarded read API (summary/realtime/sessions/events/pages/devices/locations/security), tenant analytics settings, and the high-risk retention purge. Collection is OFF until an operator opts in, and raw IP/user-agent/geolocation are each independently disabled unless explicitly enabled: visitor identifiers are stored as salted HMAC-SHA256 hashes, never raw. The retention purge is idempotency-keyed, critically audited, and refused while a data_lifecycle legal hold is active.

### `POST /api/v1/analytics/collect` — Public visitor page-view beacon (anonymous)

- **operationId**: `analyticsCollect`
- **Security**: none (public endpoint)

PUBLIC, unauthenticated visit-ingest beacon. Resolves the tenant from the request body's `tenantCode` (the RLS-free tenant root), records a privacy-preserving page-view for `public`-area paths only (IP/user-agent stored as salted hashes; anonymous — no identity). Fire-and-forget: always 202 for a well-formed request whether or not anything was recorded (module disabled, unknown tenant, non-public/non-trackable path all still return 202 without leaking tenant existence). Requires no auth.

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `X-Correlation-ID` | header | no       | string |             |

**Request body** (required): [`CollectVisitBeaconRequest`](#schema-collectvisitbeaconrequest)

**Responses**

| Status | Description                                                                | Schema                                 |
| ------ | -------------------------------------------------------------------------- | -------------------------------------- |
| 202    | Beacon accepted (recorded or intentionally ignored — never distinguished). | object                                 |
| 400    | Validation error.                                                          | [`ApiError`](#standard-error-envelope) |
| 413    | Request body exceeds the size limit (BODY_TOO_LARGE).                      | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/analytics/devices` — Browser + device-type breakdown

- **operationId**: `analyticsDevices`
- **Security**: bearerAuth + tenantHeader

Gated by visitor_analytics.dashboard.read.

**Parameters**

| Name               | In     | Required | Type                            | Description                                    |
| ------------------ | ------ | -------- | ------------------------------- | ---------------------------------------------- |
| `range`            | query  | no       | enum(`24h`, `7d`, `30d`, `12m`) | Time window for the aggregate. Defaults to 7d. |
| `X-Correlation-ID` | header | no       | string                          |                                                |

**Responses**

| Status | Description                   | Schema                                 |
| ------ | ----------------------------- | -------------------------------------- |
| 200    | Browser and device breakdown. | object                                 |
| 400    | Validation error.             | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.   | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.   | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/analytics/events` — List visit events (keyset-paginated)

- **operationId**: `analyticsEventsList`
- **Security**: bearerAuth + tenantHeader

Gated by visitor_analytics.events.read. Newest first. Raw detail (ipHash/userAgentHash) is returned only when the caller ALSO holds visitor_analytics.raw_detail.read — otherwise those fields are null.

**Parameters**

| Name               | In     | Required | Type   | Description                                               |
| ------------------ | ------ | -------- | ------ | --------------------------------------------------------- |
| `cursor`           | query  | no       | string | Opaque keyset cursor from a previous page's `nextCursor`. |
| `X-Correlation-ID` | header | no       | string |                                                           |

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | A page of visit events.     | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/analytics/locations` — Country breakdown

- **operationId**: `analyticsLocations`
- **Security**: bearerAuth + tenantHeader

Gated by visitor_analytics.dashboard.read. Empty until geolocation enrichment is enabled (VISITOR_ANALYTICS_GEO_ENABLED + VISITOR_ANALYTICS_TRUST_CLOUDFLARE) — not an error, just no data yet.

**Parameters**

| Name               | In     | Required | Type                            | Description                                    |
| ------------------ | ------ | -------- | ------------------------------- | ---------------------------------------------- |
| `range`            | query  | no       | enum(`24h`, `7d`, `30d`, `12m`) | Time window for the aggregate. Defaults to 7d. |
| `X-Correlation-ID` | header | no       | string                          |                                                |

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Country breakdown.          | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/analytics/pages` — Top pages by human pageviews

- **operationId**: `analyticsPages`
- **Security**: bearerAuth + tenantHeader

Gated by visitor_analytics.dashboard.read.

**Parameters**

| Name               | In     | Required | Type                            | Description                                    |
| ------------------ | ------ | -------- | ------------------------------- | ---------------------------------------------- |
| `range`            | query  | no       | enum(`24h`, `7d`, `30d`, `12m`) | Time window for the aggregate. Defaults to 7d. |
| `X-Correlation-ID` | header | no       | string                          |                                                |

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Top pages.                  | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/analytics/realtime` — Online-now presence counts

- **operationId**: `analyticsRealtime`
- **Security**: bearerAuth + tenantHeader

Gated by visitor_analytics.realtime.read. Sessions active within the online window (VISITOR_ANALYTICS_ONLINE_WINDOW_SECONDS), split by area.

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `X-Correlation-ID` | header | no       | string |             |

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Realtime presence.          | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/analytics/retention/purge` — Purge visitor analytics data past retention

- **operationId**: `analyticsRetentionPurge`
- **Security**: bearerAuth + tenantHeader

Gated by visitor_analytics.retention.purge. Destructive, high-risk: requires Idempotency-Key, audited `critical`. Deletes events past eventRetentionDays, clears session raw detail past rawDetailRetentionDays, deletes orphaned sessions, and deletes rollups past rollupRetentionDays.

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `Idempotency-Key`  | header | yes      | string |             |
| `X-Correlation-ID` | header | no       | string |             |

**Responses**

| Status | Description                                                                     | Schema                                 |
| ------ | ------------------------------------------------------------------------------- | -------------------------------------- |
| 200    | Purge complete (or replay of a prior identical request).                        | object                                 |
| 400    | Validation error.                                                               | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                                     | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                                     | [`ApiError`](#standard-error-envelope) |
| 409    | The Idempotency-Key was reused with a different request (IDEMPOTENCY_CONFLICT). | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/analytics/security` — Bot/crawler traffic breakdown

- **operationId**: `analyticsSecurity`
- **Security**: bearerAuth + tenantHeader

Gated by visitor_analytics.dashboard.read.

**Parameters**

| Name               | In     | Required | Type                            | Description                                    |
| ------------------ | ------ | -------- | ------------------------------- | ---------------------------------------------- |
| `range`            | query  | no       | enum(`24h`, `7d`, `30d`, `12m`) | Time window for the aggregate. Defaults to 7d. |
| `X-Correlation-ID` | header | no       | string                          |                                                |

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Bot traffic breakdown.      | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/analytics/sessions` — List visitor sessions (keyset-paginated)

- **operationId**: `analyticsSessionsList`
- **Security**: bearerAuth + tenantHeader

Gated by visitor_analytics.sessions.read. Newest-active-first. Raw detail (ipAddress/ipHash/userAgentHash/loginIdentifierSnapshot) is returned only when the caller ALSO holds visitor_analytics.raw_detail.read — otherwise those fields are null.

**Parameters**

| Name               | In     | Required | Type   | Description                                               |
| ------------------ | ------ | -------- | ------ | --------------------------------------------------------- |
| `cursor`           | query  | no       | string | Opaque keyset cursor from a previous page's `nextCursor`. |
| `X-Correlation-ID` | header | no       | string |                                                           |

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | A page of visitor sessions. | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/analytics/settings` — Read visitor analytics module settings

- **operationId**: `analyticsSettingsGet`
- **Security**: bearerAuth + tenantHeader

Gated by visitor_analytics.settings.read. Thin wrapper around Module Management's generic per-tenant settings storage under this module's own permission.

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `X-Correlation-ID` | header | no       | string |             |

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Effective module settings.  | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.         | [`ApiError`](#standard-error-envelope) |

### `PATCH /api/v1/analytics/settings` — Update visitor analytics module settings

- **operationId**: `analyticsSettingsUpdate`
- **Security**: bearerAuth + tenantHeader

Gated by visitor_analytics.settings.update. Shallow JSON-merge patch. Secret-shaped keys/values are rejected before storage. Audited (changed key names only, never values).

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `X-Correlation-ID` | header | no       | string |             |

**Request body** (required): object

**Responses**

| Status | Description                                           | Schema                                 |
| ------ | ----------------------------------------------------- | -------------------------------------- |
| 200    | Settings updated.                                     | object                                 |
| 400    | Validation error.                                     | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                           | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                           | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.                                   | [`ApiError`](#standard-error-envelope) |
| 413    | Request body exceeds the size limit (BODY_TOO_LARGE). | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/analytics/summary` — Aggregate visitor summary for a range

- **operationId**: `analyticsSummary`
- **Security**: bearerAuth + tenantHeader

Gated by visitor_analytics.dashboard.read. Human unique visitors, pageviews, bot pageviews, and top paths/browsers/devices/countries over the selected range.

**Parameters**

| Name               | In     | Required | Type                            | Description                                    |
| ------------------ | ------ | -------- | ------------------------------- | ---------------------------------------------- |
| `range`            | query  | no       | enum(`24h`, `7d`, `30d`, `12m`) | Time window for the aggregate. Defaults to 7d. |
| `X-Correlation-ID` | header | no       | string                          |                                                |

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Aggregate summary.          | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |

## Indonesia Regions

Versioned master data for Indonesia's administrative hierarchy — province / regency-city / district / village (idn_admin_regions module, ADR-0046) — for address forms, coverage mapping, and regional reporting. Read-only lookup with tier/parent/name filters and keyset pagination, plus the imported dataset versions and their upstream provenance. The rows are GLOBAL reference data (identical for every tenant, no tenant_id, no RLS), but every endpoint still requires a session, a tenant context, and a permission grant: what is global is the row, not the authorization. Importing is deliberately NOT in this contract — it is a worker job reading a repo-vendored dump; what IS here are the two audited, idempotency-keyed lifecycle actions (activate, rollback) that decide which imported version the platform serves. The data is a third-party community packaging of the Kepmendagri decree, NOT an official Kementerian Dalam Negeri API or export, and that caveat is returned in the dataset response body rather than left to documentation.

### `GET /api/v1/idn-regions/datasets` — List imported region dataset versions with their provenance

- **operationId**: `idnRegionsDatasetList`
- **Security**: bearerAuth + tenantHeader

Gated by idn_admin_regions.dataset.read. Newest import first, with upstream repository, commit SHA, file checksum, decree reference, row count, and lifecycle status. The official-reference caveat travels in the same response body: anyone reading this is deciding whether to trust these rows for something official, and the answer — a community packaging of the decree, not a Kemendagri feed — has to arrive with the data.

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `X-Correlation-ID` | header | no       | string |             |

**Responses**

| Status | Description                                              | Schema                                 |
| ------ | -------------------------------------------------------- | -------------------------------------- |
| 200    | Imported dataset versions plus static source provenance. | object                                 |
| 400    | Validation error.                                        | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                              | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                              | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/idn-regions/datasets/{id}/activate` — Activate one imported dataset version

- **operationId**: `idnRegionsDatasetActivate`
- **Security**: bearerAuth + tenantHeader

Gated by idn_admin_regions.dataset.configure. High-risk, `Idempotency-Key` required, audited with the dataset codes on both sides of the switch: this changes what every address form and regional report in the product returns, for every tenant at once. Activating the already-active dataset is a no-op success (`changed: false`), because a retried request that lands on the state it asked for succeeded. Only one dataset can be active — enforced by a partial unique index, so two concurrent activations end with one committed and one rejected.

**Parameters**

| Name               | In     | Required | Type          | Description   |
| ------------------ | ------ | -------- | ------------- | ------------- |
| `id`               | path   | yes      | string (uuid) | Dataset UUID. |
| `Idempotency-Key`  | header | yes      | string        |               |
| `X-Correlation-ID` | header | no       | string        |               |

**Responses**

| Status | Description                                                                                                                     | Schema                                 |
| ------ | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 200    | The activated dataset.                                                                                                          | object                                 |
| 400    | Validation error.                                                                                                               | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                                                                                     | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                                                                                     | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.                                                                                                             | [`ApiError`](#standard-error-envelope) |
| 409    | Idempotency-Key was already used with a different request, or the dataset cannot be activated/rolled back in its current state. | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/idn-regions/datasets/rollback` — Roll back to the previously active dataset version

- **operationId**: `idnRegionsDatasetRollback`
- **Security**: bearerAuth + tenantHeader

Gated by idn_admin_regions.dataset.restore. High-risk, `Idempotency-Key` required, audited. The target is resolved from `activated_at` history, never supplied by the caller — letting the client name the destination would make this an activation wearing a safer-sounding name. Returns 409 when there is no previously activated version.

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `Idempotency-Key`  | header | yes      | string |             |
| `X-Correlation-ID` | header | no       | string |             |

**Responses**

| Status | Description                                                                                                                     | Schema                                 |
| ------ | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 200    | The dataset that is now active.                                                                                                 | object                                 |
| 400    | Validation error.                                                                                                               | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                                                                                     | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                                                                                     | [`ApiError`](#standard-error-envelope) |
| 409    | Idempotency-Key was already used with a different request, or the dataset cannot be activated/rolled back in its current state. | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/idn-regions/regions` — Look up Indonesia administrative regions

- **operationId**: `idnRegionsList`
- **Security**: bearerAuth + tenantHeader

Gated by idn_admin_regions.region.read. Filter by tier (`level` 1-4), by `parentCode`, and/or by `search` (case-folded substring over the normalized name); keyset-paginated on `code`. Reads the ACTIVE dataset unless `dataset` names another version. When no dataset has been activated the response is an empty page with `reason: no_active_dataset` — a fresh install is a real state, not an error. The rows are global reference data, but the endpoint still requires a session, a tenant context, and the permission grant.

**Parameters**

| Name               | In     | Required | Type    | Description                                                                                               |
| ------------------ | ------ | -------- | ------- | --------------------------------------------------------------------------------------------------------- |
| `dataset`          | query  | no       | string  | Dataset code to query. Defaults to the active dataset.                                                    |
| `level`            | query  | no       | integer | 1 province, 2 regency/city, 3 district, 4 village. An out-of-range value is rejected rather than ignored. |
| `parentCode`       | query  | no       | string  | Dotted code of the parent region, e.g. `11.01` to list its districts.                                     |
| `search`           | query  | no       | string  | Case-folded substring of the region name. LIKE wildcards in the input are matched literally.              |
| `limit`            | query  | no       | integer | Page size, clamped to 200.                                                                                |
| `after`            | query  | no       | string  | Keyset cursor — the `code` of the last item on the previous page.                                         |
| `X-Correlation-ID` | header | no       | string  |                                                                                                           |

**Responses**

| Status | Description                                    | Schema                                 |
| ------ | ---------------------------------------------- | -------------------------------------- |
| 200    | One page of regions from the resolved dataset. | object                                 |
| 400    | Validation error.                              | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                    | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                    | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/idn-regions/regions/{code}` — Read one region by its Kemendagri code

- **operationId**: `idnRegionsGet`
- **Security**: bearerAuth + tenantHeader

Gated by idn_admin_regions.region.read. Returns the region plus its resolved ancestor path, so a caller rendering a full address label needs one request instead of four.

**Parameters**

| Name               | In     | Required | Type   | Description                                                              |
| ------------------ | ------ | -------- | ------ | ------------------------------------------------------------------------ |
| `code`             | path   | yes      | string | Dotted Kemendagri code, e.g. `11`, `11.01`, `11.01.01`, `11.01.01.2001`. |
| `dataset`          | query  | no       | string | Dataset code to query. Defaults to the active dataset.                   |
| `X-Correlation-ID` | header | no       | string |                                                                          |

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | The region.                 | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.         | [`ApiError`](#standard-error-envelope) |

## Data Lifecycle

Module-contributed high-volume table registry and safe lifecycle engine (data_lifecycle module, ADR-0037, ported from awcms-micro) — read the code-declared retention/partition/archive/purge descriptors and past run history, plan a dry run, and manage legal holds. Real archive/purge execution is deliberately NOT exposed over HTTP; it runs only as a bounded worker job. A legal hold overrides ordinary retention and is non-bypassable: it is enforced through a port that logging and visitor_analytics consume at their own purge composition roots, and placing/releasing one is a maker-checker SoD-guarded, audited action. The registry endpoint returns code-declared metadata only, never row contents.

### `POST /api/v1/data-lifecycle/dry-run` — Compute an on-demand, read-only dry-run lifecycle plan

- **operationId**: `dataLifecycleDryRunCreate`
- **Security**: bearerAuth + tenantHeader

Gated by data_lifecycle.plan.analyze. Zero mutation and zero persistence — no Idempotency-Key required. Legal hold is checked first and unconditionally: a held descriptor reports every eligible row as `heldCount`, nothing purgeable.

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `X-Correlation-ID` | header | no       | string |             |

**Request body** (required): [`DataLifecycleDryRunRequest`](#schema-datalifecycledryrunrequest)

**Responses**

| Status | Description                                | Schema                                 |
| ------ | ------------------------------------------ | -------------------------------------- |
| 200    | The dry-run plan for the named descriptor. | object                                 |
| 400    | Validation error.                          | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.                        | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/data-lifecycle/legal-holds` — List legal holds

- **operationId**: `dataLifecycleLegalHoldsList`
- **Security**: bearerAuth + tenantHeader

Gated by data_lifecycle.legal_hold.read. Optionally filtered by status/descriptorKey. Newest first (limit 200).

**Parameters**

| Name               | In     | Required | Type                       | Description |
| ------------------ | ------ | -------- | -------------------------- | ----------- |
| `status`           | query  | no       | enum(`active`, `released`) |             |
| `descriptorKey`    | query  | no       | string                     |             |
| `X-Correlation-ID` | header | no       | string                     |             |

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | A page of legal holds.      | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/data-lifecycle/legal-holds` — Create a legal hold

- **operationId**: `dataLifecycleLegalHoldsCreate`
- **Security**: bearerAuth + tenantHeader

Gated by data_lifecycle.legal_hold.create. High-risk mutation: requires Idempotency-Key, reason-required (min 10 chars), audited critical. Creating a hold does NOT grant the ability to release one (default-deny release).

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `Idempotency-Key`  | header | yes      | string |             |
| `X-Correlation-ID` | header | no       | string |             |

**Request body** (required): [`DataLifecycleCreateLegalHoldRequest`](#schema-datalifecyclecreatelegalholdrequest)

**Responses**

| Status | Description                                                                     | Schema                                 |
| ------ | ------------------------------------------------------------------------------- | -------------------------------------- |
| 200    | Legal hold created, or replay of a prior identical request.                     | object                                 |
| 400    | Validation error.                                                               | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                                     | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                                     | [`ApiError`](#standard-error-envelope) |
| 409    | The Idempotency-Key was reused with a different request (IDEMPOTENCY_CONFLICT). | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/data-lifecycle/legal-holds/{id}/release` — Release (end) an active legal hold

- **operationId**: `dataLifecycleLegalHoldsRelease`
- **Security**: bearerAuth + tenantHeader

Gated by data_lifecycle.legal_hold.release — a DISTINCT permission from create (default-deny release). High-risk mutation: requires Idempotency-Key, releaseReason-required (min 10 chars), audited critical.

**Parameters**

| Name               | In     | Required | Type          | Description |
| ------------------ | ------ | -------- | ------------- | ----------- |
| `id`               | path   | yes      | string (uuid) |             |
| `Idempotency-Key`  | header | yes      | string        |             |
| `X-Correlation-ID` | header | no       | string        |             |

**Request body** (required): [`DataLifecycleReleaseLegalHoldRequest`](#schema-datalifecyclereleaselegalholdrequest)

**Responses**

| Status | Description                                                                                                                         | Schema                                 |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 200    | Legal hold released, or replay of a prior identical request.                                                                        | object                                 |
| 400    | Validation error.                                                                                                                   | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                                                                                         | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                                                                                         | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.                                                                                                                 | [`ApiError`](#standard-error-envelope) |
| 409    | The hold is already released (ALREADY_RELEASED), or the Idempotency-Key was reused with a different request (IDEMPOTENCY_CONFLICT). | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/data-lifecycle/registry` — List the high-volume table lifecycle registry

- **operationId**: `dataLifecycleRegistryList`
- **Security**: bearerAuth + tenantHeader

Gated by data_lifecycle.registry.read. Code-declared descriptor metadata only (table/owner/scope/cursor/retention bounds/execution mode) — never row contents, never a live count. The response body is identical for every tenant; auth/ABAC still applies. Two arrays, because a table's owner is either a module or infrastructure and the two cannot be spelled the same way (ADR-0076).

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `X-Correlation-ID` | header | no       | string |             |

**Responses**

| Status | Description                                   | Schema                                 |
| ------ | --------------------------------------------- | -------------------------------------- |
| 200    | The registered high-volume table descriptors. | object                                 |
| 400    | Validation error.                             | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                   | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                   | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/data-lifecycle/runs` — Read lifecycle run history

- **operationId**: `dataLifecycleRunsList`
- **Security**: bearerAuth + tenantHeader

Gated by data_lifecycle.runs.read. Categorized AGGREGATE counts only — never row contents or PII. Optionally filtered by descriptorKey/runType. Newest first (limit 100).

**Parameters**

| Name               | In     | Required | Type                                | Description |
| ------------------ | ------ | -------- | ----------------------------------- | ----------- |
| `descriptorKey`    | query  | no       | string                              |             |
| `runType`          | query  | no       | enum(`dry_run`, `archive`, `purge`) |             |
| `X-Correlation-ID` | header | no       | string                              |             |

**Responses**

| Status | Description                      | Schema                                 |
| ------ | -------------------------------- | -------------------------------------- |
| 200    | A page of lifecycle run history. | object                                 |
| 400    | Validation error.                | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.      | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.      | [`ApiError`](#standard-error-envelope) |

## SEO & Distribution

Tenant SEO defaults for the central metadata renderer + public discovery/syndication surfaces (seo_distribution module, ADR-0038 discovery scope) — read/update site identity, default social/Organization images, Twitter handle, the tenant-wide noindex switch, and feed/sitemap config. The public robots.txt/sitemap/feed routes themselves are unauthenticated Astro XML/text routes (not part of this OpenAPI contract), host-resolved and cache-validated. config.update is high-risk (rewrites the public metadata/indexability surface), idempotency-keyed, and audited.

### `GET /api/v1/seo/config` — Read this tenant's SEO defaults

- **operationId**: `seoConfigRead`
- **Security**: bearerAuth + tenantHeader

Gated by seo_distribution.config.read. Returns the tenant's SEO defaults (site identity, default social/Organization images, Twitter handle, tenant-wide noindex switch, and feed/sitemap config); a neutral default object when no config row exists yet. Tenant-scoped (withTenant + RLS FORCE).

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `X-Correlation-ID` | header | no       | string |             |

**Responses**

| Status | Description                         | Schema                                 |
| ------ | ----------------------------------- | -------------------------------------- |
| 200    | The tenant's resolved SEO defaults. | object                                 |
| 400    | Validation error.                   | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.         | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.         | [`ApiError`](#standard-error-envelope) |

### `PUT /api/v1/seo/config` — Replace this tenant's SEO defaults

- **operationId**: `seoConfigUpdate`
- **Security**: bearerAuth + tenantHeader

Gated by seo_distribution.config.update. High-risk mutation — rewrites the public metadata/indexability surface (including the tenant-wide noindex switch): requires Idempotency-Key and is audited. Full replace of the mutable fields (PUT semantics); unknown keys are ignored. Tenant-scoped (withTenant + RLS FORCE).

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `Idempotency-Key`  | header | yes      | string |             |
| `X-Correlation-ID` | header | no       | string |             |

**Request body** (required): [`SeoConfigUpdateRequest`](#schema-seoconfigupdaterequest)

**Responses**

| Status | Description                                                                     | Schema                                 |
| ------ | ------------------------------------------------------------------------------- | -------------------------------------- |
| 200    | The saved SEO defaults, or a replay of a prior identical request.               | object                                 |
| 400    | Validation error.                                                               | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                                     | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                                     | [`ApiError`](#standard-error-envelope) |
| 409    | The Idempotency-Key was reused with a different request (IDEMPOTENCY_CONFLICT). | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/seo/not-found` — List the privacy-minimized 404 governance dashboard

- **operationId**: `seoNotFoundList`
- **Security**: bearerAuth + tenantHeader

Top 404 observations by hit count (sanitized path + bare referrer domain only — never full URLs/queries/secrets). unresolvedOnly=true filters to open items. Gated by seo_distribution.not_found.read.

**Parameters**

| Name               | In     | Required | Type    | Description |
| ------------------ | ------ | -------- | ------- | ----------- |
| `unresolvedOnly`   | query  | no       | boolean |             |
| `X-Correlation-ID` | header | no       | string  |             |

**Responses**

| Status | Description                     | Schema                                 |
| ------ | ------------------------------- | -------------------------------------- |
| 200    | This tenant's 404 observations. | object                                 |
| 400    | Validation error.               | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.     | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.     | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/seo/not-found/{id}` — Resolve a 404 observation

- **operationId**: `seoNotFoundResolve`
- **Security**: bearerAuth + tenantHeader

Mark an observation resolved, optionally attaching a same-tenant suggested redirect id (validated to exist). Audited. Gated by seo_distribution.not_found.update.

**Parameters**

| Name               | In     | Required | Type          | Description |
| ------------------ | ------ | -------- | ------------- | ----------- |
| `id`               | path   | yes      | string (uuid) |             |
| `X-Correlation-ID` | header | no       | string        |             |

**Request body** (optional): object

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | The resolved observation.   | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.         | [`ApiError`](#standard-error-envelope) |

### `DELETE /api/v1/seo/not-found/{id}` — Dismiss a 404 observation

- **operationId**: `seoNotFoundDismiss`
- **Security**: bearerAuth + tenantHeader

Hard-delete an observation the operator does not want to track. Audited. Gated by seo_distribution.not_found.update.

**Parameters**

| Name               | In     | Required | Type          | Description |
| ------------------ | ------ | -------- | ------------- | ----------- |
| `id`               | path   | yes      | string (uuid) |             |
| `X-Correlation-ID` | header | no       | string        |             |

**Responses**

| Status | Description                    | Schema                                 |
| ------ | ------------------------------ | -------------------------------------- |
| 200    | The observation was dismissed. | object                                 |
| 400    | Validation error.              | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.    | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.    | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.            | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/seo/redirects` — List/search/filter redirect rules

- **operationId**: `seoRedirectsList`
- **Security**: bearerAuth + tenantHeader

Tenant-scoped exact-path redirect rules, keyset-paginated newest first (limit 100). Filter by state, targetType, or a source-path substring q. Gated by seo_distribution.redirect.read. Tenant-scoped (withTenant + RLS FORCE).

**Parameters**

| Name               | In     | Required | Type                                              | Description                                    |
| ------------------ | ------ | -------- | ------------------------------------------------- | ---------------------------------------------- |
| `X-Correlation-ID` | header | no       | string                                            |                                                |
| `cursor`           | query  | no       | string                                            | Opaque keyset cursor from a previous page.     |
| `state`            | query  | no       | enum(`active`, `inactive`, `archived`)            |                                                |
| `targetType`       | query  | no       | enum(`relative_same_tenant`, `verified_external`) |                                                |
| `q`                | query  | no       | string                                            | Substring match on the normalized source path. |

**Responses**

| Status | Description                   | Schema                                 |
| ------ | ----------------------------- | -------------------------------------- |
| 200    | This tenant's redirect rules. | object                                 |
| 400    | Validation error.             | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.   | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.   | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/seo/redirects` — Create a redirect rule

- **operationId**: `seoRedirectsCreate`
- **Security**: bearerAuth + tenantHeader

High-risk: requires an Idempotency-Key, audited. The target is validated through the frozen open-redirect guard and the rule is rejected if it conflicts with an existing source/scope, self-redirects, or would create a loop / over-long chain. Gated by seo_distribution.redirect.create. Tenant-scoped (withTenant + RLS FORCE).

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `Idempotency-Key`  | header | yes      | string |             |
| `X-Correlation-ID` | header | no       | string |             |

**Request body** (required): [`SeoRedirectCreateRequest`](#schema-seoredirectcreaterequest)

**Responses**

| Status | Description                                                                                               | Schema                                 |
| ------ | --------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 200    | Redirect rule created (or an idempotent replay).                                                          | object                                 |
| 400    | Validation error.                                                                                         | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                                                               | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                                                               | [`ApiError`](#standard-error-envelope) |
| 409    | Source/scope conflict, redirect loop, over-long chain, or idempotency-key reuse with a different payload. | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/seo/redirects/{id}` — Read one redirect rule

- **operationId**: `seoRedirectsGet`
- **Security**: bearerAuth + tenantHeader

**Parameters**

| Name               | In     | Required | Type          | Description |
| ------------------ | ------ | -------- | ------------- | ----------- |
| `id`               | path   | yes      | string (uuid) |             |
| `X-Correlation-ID` | header | no       | string        |             |

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | The redirect rule.          | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.         | [`ApiError`](#standard-error-envelope) |

### `PUT /api/v1/seo/redirects/{id}` — Update a redirect rule

- **operationId**: `seoRedirectsUpdate`
- **Security**: bearerAuth + tenantHeader

Replace the mutable fields (source path is immutable). Re-validates the target through the frozen open-redirect guard + the conflict/loop/chain safety gate. Audited. Gated by seo_distribution.redirect.update.

**Parameters**

| Name               | In     | Required | Type          | Description |
| ------------------ | ------ | -------- | ------------- | ----------- |
| `id`               | path   | yes      | string (uuid) |             |
| `X-Correlation-ID` | header | no       | string        |             |

**Request body** (required): [`SeoRedirectUpdateRequest`](#schema-seoredirectupdaterequest)

**Responses**

| Status | Description                                         | Schema                                 |
| ------ | --------------------------------------------------- | -------------------------------------- |
| 200    | Redirect rule updated.                              | object                                 |
| 400    | Validation error.                                   | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                         | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                         | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.                                 | [`ApiError`](#standard-error-envelope) |
| 409    | Source conflict, redirect loop, or over-long chain. | [`ApiError`](#standard-error-envelope) |

### `DELETE /api/v1/seo/redirects/{id}` — Soft-delete a redirect rule

- **operationId**: `seoRedirectsDelete`
- **Security**: bearerAuth + tenantHeader

Soft delete (a non-empty reason is required). Restore/purge via the lifecycle endpoint. Audited. Gated by seo_distribution.redirect.delete.

**Parameters**

| Name               | In     | Required | Type          | Description |
| ------------------ | ------ | -------- | ------------- | ----------- |
| `id`               | path   | yes      | string (uuid) |             |
| `X-Correlation-ID` | header | no       | string        |             |

**Request body** (required): object

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Redirect rule soft-deleted. | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.         | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/seo/redirects/{id}/lifecycle` — Transition a redirect rule's state / delete lifecycle

- **operationId**: `seoRedirectsLifecycle`
- **Security**: bearerAuth + tenantHeader

activate | deactivate | archive | restore | purge. Idempotency-keyed, audited. purge needs seo_distribution.redirect.delete; every other action needs seo_distribution.redirect.update (dynamic guard).

**Parameters**

| Name               | In     | Required | Type          | Description |
| ------------------ | ------ | -------- | ------------- | ----------- |
| `id`               | path   | yes      | string (uuid) |             |
| `Idempotency-Key`  | header | yes      | string        |             |
| `X-Correlation-ID` | header | no       | string        |             |

**Request body** (required): object

**Responses**

| Status | Description                                     | Schema                                 |
| ------ | ----------------------------------------------- | -------------------------------------- |
| 200    | The lifecycle transition result.                | object                                 |
| 400    | Validation error.                               | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                     | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                     | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.                             | [`ApiError`](#standard-error-envelope) |
| 409    | Idempotency-key reuse with a different payload. | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/seo/redirects/capture-url-change` — Capture a URL change into a redirect proposal/rule

- **operationId**: `seoRedirectsCaptureUrlChange`
- **Security**: bearerAuth + tenantHeader

Turn an old→new public path change into an audited redirect PROPOSAL (inactive) or active rule per the tenant's url_change_auto_policy (overridable). Idempotency-keyed. Gated by seo_distribution.redirect.create.

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `Idempotency-Key`  | header | yes      | string |             |
| `X-Correlation-ID` | header | no       | string |             |

**Request body** (required): object

**Responses**

| Status | Description                                                                       | Schema                                 |
| ------ | --------------------------------------------------------------------------------- | -------------------------------------- |
| 200    | The capture outcome (skipped/proposed/created).                                   | object                                 |
| 400    | Validation error.                                                                 | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                                       | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                                       | [`ApiError`](#standard-error-envelope) |
| 409    | Conflict/loop/chain rejection, or idempotency-key reuse with a different payload. | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/seo/redirects/import` — Bulk-import redirect rules (with dry run)

- **operationId**: `seoRedirectsImport`
- **Security**: bearerAuth + tenantHeader

Validate + safety-check up to 200 rules. dryRun: true returns a per-item report writing nothing; a real import is all-or-nothing (idempotency-keyed, audited). Gated by seo_distribution.redirect.create.

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `Idempotency-Key`  | header | yes      | string |             |
| `X-Correlation-ID` | header | no       | string |             |

**Request body** (required): object

**Responses**

| Status | Description                                     | Schema                                 |
| ------ | ----------------------------------------------- | -------------------------------------- |
| 200    | The import report.                              | object                                 |
| 400    | Validation error.                               | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                     | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                     | [`ApiError`](#standard-error-envelope) |
| 409    | Idempotency-key reuse with a different payload. | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/seo/redirects/settings` — Read this tenant's redirect governance policy

- **operationId**: `seoRedirectSettingsRead`
- **Security**: bearerAuth + tenantHeader

The legacy-blog auto-redirect toggle (INERT in awcms — no /news route family) and the default URL-change auto-capture policy. Gated by seo_distribution.redirect.read.

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `X-Correlation-ID` | header | no       | string |             |

**Responses**

| Status | Description                    | Schema                                 |
| ------ | ------------------------------ | -------------------------------------- |
| 200    | This tenant's redirect policy. | object                                 |
| 400    | Validation error.              | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.    | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.    | [`ApiError`](#standard-error-envelope) |

### `PUT /api/v1/seo/redirects/settings` — Update this tenant's redirect governance policy

- **operationId**: `seoRedirectSettingsUpdate`
- **Security**: bearerAuth + tenantHeader

High-risk (the legacy-blog toggle changes public routing intent): requires an Idempotency-Key, audited. Gated by seo_distribution.redirect.update.

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `Idempotency-Key`  | header | yes      | string |             |
| `X-Correlation-ID` | header | no       | string |             |

**Request body** (required): [`SeoRedirectSettings`](#schema-seoredirectsettings)

**Responses**

| Status | Description                                        | Schema                                 |
| ------ | -------------------------------------------------- | -------------------------------------- |
| 200    | Redirect policy updated (or an idempotent replay). | object                                 |
| 400    | Validation error.                                  | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                        | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                        | [`ApiError`](#standard-error-envelope) |
| 409    | Idempotency-key reuse with a different payload.    | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/seo/redirects/validate` — Validate a redirect rule (dry run) + preview its chain

- **operationId**: `seoRedirectsValidate`
- **Security**: bearerAuth + tenantHeader

Read-only: normalize + validate a proposed rule (frozen open-redirect guard), preview the redirect chain it would produce, and explain any conflict/loop/over-long chain — writing nothing. Gated by seo_distribution.redirect.read.

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `X-Correlation-ID` | header | no       | string |             |

**Request body** (required): [`SeoRedirectCreateRequest`](#schema-seoredirectcreaterequest)

**Responses**

| Status | Description                            | Schema                                 |
| ------ | -------------------------------------- | -------------------------------------- |
| 200    | The validation + chain-preview result. | object                                 |
| 400    | Validation error.                      | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.            | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.            | [`ApiError`](#standard-error-envelope) |

## Form Drafts

Generic, domain-agnostic server-side draft store for multi-step forms (form_drafts module) — tenant-scoped, RLS-protected create/read/update/submit/delete of an opaque JSONB payload plus the wizard coordinates needed to resume it. The payload is size-bounded and rejected outright (never silently redacted) when any key at any nesting depth resembles a secret — password/token/secret/credential/apiKey/privateKey — so a caller can never mistake a stripped field for a saved one. What a payload MEANS is owned by the module that created it (moduleKey/wizardKey), never by this one. submit is high-risk (it hands the payload to a domain action), idempotency-keyed, and audited; create deliberately is not, since a retry costs one deletable scratch row.

### `GET /api/v1/form-drafts` — List this tenant's non-deleted form drafts.

- **operationId**: `listFormDrafts`
- **Security**: bearerAuth + tenantHeader

Bounded to the 100 most recently updated non-deleted drafts, newest first. No pagination cursor: this is scratch state a caller filters by its own moduleKey/wizardKey, not a browsable archive.

**Parameters**

| Name        | In    | Required | Type                                         | Description |
| ----------- | ----- | -------- | -------------------------------------------- | ----------- |
| `moduleKey` | query | no       | string                                       |             |
| `wizardKey` | query | no       | string                                       |             |
| `status`    | query | no       | [`FormDraftStatus`](#schema-formdraftstatus) |             |

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Form draft list.            | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/form-drafts` — Create a form draft.

- **operationId**: `createFormDraft`
- **Security**: bearerAuth + tenantHeader

Deliberately NOT idempotency-keyed: the worst case for a retry is one extra low-value scratch row the caller can delete, not a domain side effect. Submitting is the operation that needs a key.

**Request body** (required): [`FormDraftCreateRequest`](#schema-formdraftcreaterequest)

**Responses**

| Status | Description                                        | Schema                                 |
| ------ | -------------------------------------------------- | -------------------------------------- |
| 200    | Created form draft.                                | object                                 |
| 400    | Validation error.                                  | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                        | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                        | [`ApiError`](#standard-error-envelope) |
| 413    | Request body exceeded the endpoint's size ceiling. | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/form-drafts/{id}` — Read one form draft.

- **operationId**: `getFormDraft`
- **Security**: bearerAuth + tenantHeader

**Parameters**

| Name | In   | Required | Type          | Description |
| ---- | ---- | -------- | ------------- | ----------- |
| `id` | path | yes      | string (uuid) |             |

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Form draft.                 | object                                 |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.         | [`ApiError`](#standard-error-envelope) |

### `PATCH /api/v1/form-drafts/{id}` — Update a draft's step, payload, or expiry.

- **operationId**: `updateFormDraft`
- **Security**: bearerAuth + tenantHeader

Only a draft still in `draft` status can be updated; a submitted, abandoned, or expired draft returns 404 rather than distinguishing "wrong state" from "does not exist".

**Parameters**

| Name | In   | Required | Type          | Description |
| ---- | ---- | -------- | ------------- | ----------- |
| `id` | path | yes      | string (uuid) |             |

**Request body** (required): [`FormDraftUpdateRequest`](#schema-formdraftupdaterequest)

**Responses**

| Status | Description                                        | Schema                                 |
| ------ | -------------------------------------------------- | -------------------------------------- |
| 200    | Updated form draft.                                | object                                 |
| 400    | Validation error.                                  | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                        | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                        | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.                                | [`ApiError`](#standard-error-envelope) |
| 413    | Request body exceeded the endpoint's size ceiling. | [`ApiError`](#standard-error-envelope) |

### `DELETE /api/v1/form-drafts/{id}` — Soft-delete (abandon) a form draft.

- **operationId**: `deleteFormDraft`
- **Security**: bearerAuth + tenantHeader

Idempotent by construction — the `deleted_at IS NULL` guard makes a second call a safe no-op, so no Idempotency-Key is required.

**Parameters**

| Name | In   | Required | Type          | Description |
| ---- | ---- | -------- | ------------- | ----------- |
| `id` | path | yes      | string (uuid) |             |

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Draft abandoned.            | object                                 |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.         | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/form-drafts/{id}/submit` — Mark a draft as submitted.

- **operationId**: `submitFormDraft`
- **Security**: bearerAuth + tenantHeader

High-risk: hands the payload to a domain action, so an Idempotency-Key is required and the same key with a different body is a conflict. Guarded on `form_drafts.draft.update` — there is no separate `submit` permission, because an action nobody seeds into a role denies even the tenant owner while looking correct.

**Parameters**

| Name              | In     | Required | Type          | Description |
| ----------------- | ------ | -------- | ------------- | ----------- |
| `id`              | path   | yes      | string (uuid) |             |
| `Idempotency-Key` | header | yes      | string        |             |

**Responses**

| Status | Description                                                                     | Schema                                 |
| ------ | ------------------------------------------------------------------------------- | -------------------------------------- |
| 200    | Submitted form draft.                                                           | object                                 |
| 400    | Validation error.                                                               | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                                     | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                                     | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.                                                             | [`ApiError`](#standard-error-envelope) |
| 409    | The Idempotency-Key was reused with a different request (IDEMPOTENCY_CONFLICT). | [`ApiError`](#standard-error-envelope) |

## Site Search

Tenant-scoped, cross-content PostgreSQL full-text search over PUBLISHED public website content (site_search module, ADR-0040) — the public, anonymous, host-resolved query/suggest endpoints plus the admin index status/reconcile/rebuild, tenant search configuration, and failed-item diagnostics API. The index is a projection of public content only and is NEVER an authorization source: publication state is enforced at the source-to-index boundary, so a draft/private/deleted/scheduled resource is never even read into it. Query text is always a bound parameter into websearch_to_tsquery (no SQL injection) and snippets are HTML-escaped before the <mark> highlights are inserted (no XSS). index.rebuild is high-risk (delete + re-extract every document); index.reconcile is an idempotent, fully regenerable sync — both are idempotency-keyed and audited, as is settings.update, which changes what the public surface returns.

### `GET /api/v1/site-search/index/failures` — Read the search index failed-item diagnostics

- **operationId**: `siteSearchIndexFailures`
- **Security**: bearerAuth + tenantHeader

Gated by `site_search.diagnostics.read`. Returns up to 100 unresolved failed items (aggregated per source/resource/locale) with a SANITIZED error class and detail — never a raw stack trace. Each reconcile clears its own source's prior failures, so this reflects the latest run.

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `X-Correlation-ID` | header | no       | string |             |

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | Failed-item diagnostics.    | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC. | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/site-search/index/rebuild` — Force a full search index rebuild

- **operationId**: `siteSearchIndexRebuild`
- **Security**: bearerAuth + tenantHeader

Gated by `site_search.index.rebuild` — a HIGH-RISK action: it deletes every one of the tenant's index documents for the registered sources and re-extracts them. Idempotent (the end state is identical regardless of prior state), Idempotency-Key'd, and audited.

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `Idempotency-Key`  | header | yes      | string |             |
| `X-Correlation-ID` | header | no       | string |             |

**Responses**

| Status | Description                                                | Schema                                 |
| ------ | ---------------------------------------------------------- | -------------------------------------- |
| 200    | Rebuild run summary.                                       | object                                 |
| 400    | Validation error.                                          | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                | [`ApiError`](#standard-error-envelope) |
| 409    | Idempotency-Key was already used with a different request. | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/site-search/index/reconcile` — Run an idempotent search index reconciliation

- **operationId**: `siteSearchIndexReconcile`
- **Security**: bearerAuth + tenantHeader

Gated by `site_search.index.reconcile`. Upserts the tenant's currently public documents (skipping any whose checksum already matches) and deletes index documents whose source row is gone or no longer public, so an archive/delete/unpublish never leaves a stale public result. Running it while already in sync is a no-op. Deliberately NOT classified high-risk (a fully regenerable projection sync), but still Idempotency-Key'd and audited.

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `Idempotency-Key`  | header | yes      | string |             |
| `X-Correlation-ID` | header | no       | string |             |

**Responses**

| Status | Description                                                | Schema                                 |
| ------ | ---------------------------------------------------------- | -------------------------------------- |
| 200    | Reconcile run summary.                                     | object                                 |
| 400    | Validation error.                                          | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                | [`ApiError`](#standard-error-envelope) |
| 409    | Idempotency-Key was already used with a different request. | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/site-search/index/status` — Read this tenant's search index status, freshness, and recent runs

- **operationId**: `siteSearchIndexStatus`
- **Security**: bearerAuth + tenantHeader

Gated by `site_search.index.read`. Bounded: document counts by resource type, the most recent index run, the open failed-item count, and the 10 most recent runs.

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `X-Correlation-ID` | header | no       | string |             |

**Responses**

| Status | Description                   | Schema                                 |
| ------ | ----------------------------- | -------------------------------------- |
| 200    | Index status and recent runs. | object                                 |
| 400    | Validation error.             | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.   | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.   | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/site-search/query` — Public full-text search over this site's published content (anonymous)

- **operationId**: `siteSearchQuery`
- **Security**: none (public endpoint)

PUBLIC, unauthenticated cross-content search. The tenant is resolved from the request host (never a session or a tenant header); results come from the tenant's search index, which contains PUBLISHED PUBLIC content only and is never an authorization source. The query text is always a bound parameter into `websearch_to_tsquery`, snippets are HTML-escaped before the `<mark>` highlights are inserted, and the endpoint is per-IP rate-limited, query-length-bounded (max 128 characters) and result-capped. An unresolved host, a disabled module, a search-disabled tenant, and a too-short query all return the SAME neutral empty payload — never a distinguishing error.

**Parameters**

| Name     | In    | Required | Type   | Description                                                                                                                         |
| -------- | ----- | -------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `q`      | query | no       | string | Raw search text. Trimmed, whitespace-collapsed, and bounded before use.                                                             |
| `type`   | query | no       | string | Restrict results to one resource type. Honored only when the tenant's `enabledResourceTypes` admits it; otherwise silently ignored. |
| `locale` | query | no       | string | BCP-47-ish content locale. Malformed values fall back to the tenant default.                                                        |
| `cursor` | query | no       | string | Opaque keyset cursor from a previous response's `nextCursor`.                                                                       |

**Responses**

| Status | Description                                | Schema                                 |
| ------ | ------------------------------------------ | -------------------------------------- |
| 200    | Search results (possibly empty).           | object                                 |
| 429    | Too many search requests from this source. | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/site-search/settings` — Read this tenant's search configuration

- **operationId**: `siteSearchSettingsRead`
- **Security**: bearerAuth + tenantHeader

Gated by `site_search.settings.read`. Returns the module defaults when the tenant has never written a config row. Tenant-scoped (withTenant + RLS FORCE).

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `X-Correlation-ID` | header | no       | string |             |

**Responses**

| Status | Description                  | Schema                                 |
| ------ | ---------------------------- | -------------------------------------- |
| 200    | Tenant search configuration. | object                                 |
| 400    | Validation error.            | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.  | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.  | [`ApiError`](#standard-error-envelope) |

### `PUT /api/v1/site-search/settings` — Replace this tenant's search configuration

- **operationId**: `siteSearchSettingsUpdate`
- **Security**: bearerAuth + tenantHeader

Gated by `site_search.settings.update`. Changes what the PUBLIC search surface returns (including the tenant-wide search on/off switch and the opt-in query-analytics switch), so it requires an Idempotency-Key and is audited. Merge semantics: omitted fields keep their current value; unknown keys are ignored.

**Parameters**

| Name               | In     | Required | Type   | Description |
| ------------------ | ------ | -------- | ------ | ----------- |
| `Idempotency-Key`  | header | yes      | string |             |
| `X-Correlation-ID` | header | no       | string |             |

**Request body** (required): [`SiteSearchSettingsUpdateRequest`](#schema-sitesearchsettingsupdaterequest)

**Responses**

| Status | Description                                                | Schema                                 |
| ------ | ---------------------------------------------------------- | -------------------------------------- |
| 200    | Saved tenant search configuration.                         | object                                 |
| 400    | Validation error.                                          | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                | [`ApiError`](#standard-error-envelope) |
| 409    | Idempotency-Key was already used with a different request. | [`ApiError`](#standard-error-envelope) |
| 413    | Request body exceeded the endpoint's size ceiling.         | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/site-search/suggest` — Public bounded title typeahead (anonymous)

- **operationId**: `siteSearchSuggest`
- **Security**: none (public endpoint)

PUBLIC, unauthenticated trigram typeahead over indexed titles, tenant and locale scoped. Same host-based tenant resolution, per-IP rate limit, query bounds and neutral empty payload as the search endpoint. Returns at most the tenant's configured `suggestionLimit`; returns an empty list when the tenant has suggestions turned off.

**Parameters**

| Name     | In    | Required | Type   | Description |
| -------- | ----- | -------- | ------ | ----------- |
| `q`      | query | no       | string |             |
| `locale` | query | no       | string |             |

**Responses**

| Status | Description                                    | Schema                                 |
| ------ | ---------------------------------------------- | -------------------------------------- |
| 200    | Title suggestions (possibly empty).            | object                                 |
| 429    | Too many suggestion requests from this source. | [`ApiError`](#standard-error-envelope) |

## Comments

Tenant-scoped, moderation-first commenting over PUBLISHED, PUBLIC commentable resources (comments module, ADR-0041) — the public, anonymous, host-resolved submit/list/reply/edit/report/delete-request surface plus the ABAC-guarded admin moderation queue, per-decision transitions, bulk moderation, and tenant comment configuration. A comment is only ever accepted against, or shown on, a resource that satisfies its owning module's declarative publicationFilter, so a draft/private/deleted/scheduled resource never receives or exposes comments, and the comment surface is NEVER an authorization source for the underlying resource. Bodies are stored as raw plain text and HTML-escaped on render (no stored HTML, therefore no stored XSS), permitting only http(s) autolinks with rel=nofollow ugc noopener noreferrer. The public list returns approved rows only and never moderation metadata. Public submit responses are deliberately uniform: an anti-abuse block, an unresolved resource, and an accepted-but-pending comment all return the same neutral body, so the endpoint cannot be used as an oracle for blocked terms or for unpublished content. moderation.approve/restore/delete and settings.update are high-risk, idempotency-keyed, and audited with a reason code.

### `GET /api/v1/comments` — List approved comments for a published commentable resource.

- **operationId**: `listPublicComments`
- **Security**: none (public endpoint)

PUBLIC and anonymous. The tenant is resolved from the request host. Only `approved`, non-deleted comments are returned, and never any moderation metadata (reason codes, actor ids, email/ip hashes). An unresolved host, a disabled module, an unpublished resource, and a resource with no comments all return the SAME empty payload — the endpoint is not an existence oracle for unpublished content.

**Parameters**

| Name           | In    | Required | Type          | Description                                                                                                                                                                                 |
| -------------- | ----- | -------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `resourceType` | query | yes      | string        | The commentable resource type, e.g. `blog_post`.                                                                                                                                            |
| `resourceId`   | query | yes      | string (uuid) |                                                                                                                                                                                             |
| `locale`       | query | no       | string        | Defaults to the resolved tenant's default locale.                                                                                                                                           |
| `cursor`       | query | no       | string        | Full-precision `created_at` from a previous page's `nextCursor`. Must be sent together with `cursorId`; a timestamp alone cannot disambiguate two comments written in the same microsecond. |
| `cursorId`     | query | no       | string (uuid) |                                                                                                                                                                                             |

**Responses**

| Status | Description                      | Schema                                 |
| ------ | -------------------------------- | -------------------------------------- |
| 200    | Approved comments, newest first. | object                                 |
| 429    | Per-IP rate limit exceeded.      | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/comments` — Submit a comment against a published commentable resource.

- **operationId**: `submitPublicComment`
- **Security**: none (public endpoint)

PUBLIC and anonymous, host-resolved, `Idempotency-Key` required. Anti-abuse gated (honeypot field, submit-timing floor, blocked terms, duplicate fingerprint, per-IP rate limit).
RESPONSES ARE DELIBERATELY UNIFORM. An unresolved resource, a disabled module, an anti-abuse block, and an accepted-but-held-for-moderation comment ALL return `{"status":"received"}`. Only a comment that is immediately publicly visible returns its id and status. A caller therefore cannot use this endpoint to enumerate blocked terms, probe the timing floor, or discover unpublished resources.

**Parameters**

| Name              | In     | Required | Type   | Description |
| ----------------- | ------ | -------- | ------ | ----------- |
| `Idempotency-Key` | header | yes      | string |             |

**Request body** (required): [`SubmitCommentRequest`](#schema-submitcommentrequest)

**Responses**

| Status | Description                                                                                                                         | Schema                                 |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 200    | Accepted. Either the neutral `{"status":"received"}` acknowledgement or, when the comment is immediately public, its id and status. | object                                 |
| 400    | Validation error.                                                                                                                   | [`ApiError`](#standard-error-envelope) |
| 409    | The Idempotency-Key was reused with a different request.                                                                            | [`ApiError`](#standard-error-envelope) |
| 413    | Request body exceeded the endpoint's size ceiling.                                                                                  | [`ApiError`](#standard-error-envelope) |
| 429    | Per-IP rate limit exceeded.                                                                                                         | [`ApiError`](#standard-error-envelope) |

### `PATCH /api/v1/comments/{id}` — Edit your own comment within its edit window.

- **operationId**: `editPublicComment`
- **Security**: none (public endpoint)

PUBLIC, author-bound: a registered author is matched by session user id, an anonymous author by the stored IP hash. Editing someone else's comment returns 404, identical to a comment that does not exist.

**Parameters**

| Name | In   | Required | Type          | Description |
| ---- | ---- | -------- | ------------- | ----------- |
| `id` | path | yes      | string (uuid) |             |

**Request body** (required): object

**Responses**

| Status | Description                                                     | Schema                                 |
| ------ | --------------------------------------------------------------- | -------------------------------------- |
| 200    | The re-rendered, escaped comment HTML.                          | object                                 |
| 400    | Validation error.                                               | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.                                             | [`ApiError`](#standard-error-envelope) |
| 409    | The edit window for this comment has passed.                    | [`ApiError`](#standard-error-envelope) |
| 422    | The edited body failed normalization or the link/length bounds. | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/comments/{id}/delete-request` — Ask for your own comment to be removed.

- **operationId**: `requestPublicCommentDeletion`
- **Security**: none (public endpoint)

PUBLIC, author-bound. Within the edit window this soft-deletes the comment immediately. Past the window it files a report for a moderator instead, so thread structure and moderation history stay coherent.

**Parameters**

| Name | In   | Required | Type          | Description |
| ---- | ---- | -------- | ------------- | ----------- |
| `id` | path | yes      | string (uuid) |             |

**Responses**

| Status | Description                                                                                                 | Schema                                 |
| ------ | ----------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 200    | The request was accepted. `softDeleted` distinguishes an immediate removal from a queued moderator request. | object                                 |
| 404    | Resource not found.                                                                                         | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/comments/{id}/replies` — Reply to an existing comment.

- **operationId**: `submitPublicCommentReply`
- **Security**: none (public endpoint)

PUBLIC. Same policy and anti-abuse gates as a top-level submission, with the parent supplied by the path and depth derived from it and capped. The parent's resource is re-confirmed as still published before the reply is accepted. Returns the same neutral acknowledgement shape as submit.

**Parameters**

| Name | In   | Required | Type          | Description |
| ---- | ---- | -------- | ------------- | ----------- |
| `id` | path | yes      | string (uuid) |             |

**Request body** (required): [`SubmitCommentRequest`](#schema-submitcommentrequest)

**Responses**

| Status | Description                                                         | Schema                                 |
| ------ | ------------------------------------------------------------------- | -------------------------------------- |
| 200    | Neutral acknowledgement, or the reply's id when immediately public. | object                                 |
| 400    | Validation error.                                                   | [`ApiError`](#standard-error-envelope) |
| 429    | Per-IP rate limit exceeded.                                         | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/comments/{id}/report` — Report a comment for moderator attention.

- **operationId**: `reportPublicComment`
- **Security**: none (public endpoint)

PUBLIC. De-duplicated per (comment, reporter ip hash, reason) by a database unique index, so repeated reports from one source do not inflate the queue's report count.

**Parameters**

| Name | In   | Required | Type          | Description |
| ---- | ---- | -------- | ------------- | ----------- |
| `id` | path | yes      | string (uuid) |             |

**Request body** (required): object

**Responses**

| Status | Description                                          | Schema                                 |
| ------ | ---------------------------------------------------- | -------------------------------------- |
| 200    | The report was accepted (or silently de-duplicated). | object                                 |
| 400    | Validation error.                                    | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/comments/admin/{id}/archive` — Withdraw an approved comment from public view.

- **operationId**: `archiveComment`
- **Security**: bearerAuth + tenantHeader

Requires `comments.moderation.archive`. Only an APPROVED comment can be archived. The row is retained with a reserved `archived` reason code so the queue distinguishes it from a plain rejection, and `published_at` is preserved. Idempotency-keyed and audited.

**Parameters**

| Name              | In     | Required | Type          | Description |
| ----------------- | ------ | -------- | ------------- | ----------- |
| `id`              | path   | yes      | string (uuid) |             |
| `Idempotency-Key` | header | yes      | string        |             |

**Responses**

| Status | Description                                                                                | Schema                                 |
| ------ | ------------------------------------------------------------------------------------------ | -------------------------------------- |
| 200    | The comment was archived.                                                                  | object                                 |
| 401    | Missing or invalid session.                                                                | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                                                | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.                                                                        | [`ApiError`](#standard-error-envelope) |
| 409    | Idempotency-Key conflict, or the comment is not approved and therefore cannot be archived. | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/comments/admin/{id}/delete` — Soft delete a comment as a moderator.

- **operationId**: `deleteCommentAsModerator`
- **Security**: bearerAuth + tenantHeader

Requires `comments.moderation.delete` (ADR-0058 §B). Legal from every non-terminal status. Non-destructive — the row, its body text and its append-only moderation history are all retained; what is withdrawn is visibility. Open reports on the comment are resolved, since a deleted comment cannot be acted on again.

This is the only moderator transition with no way back through the API: `deleted` is terminal, and recovering a deleted comment is an operator/database action. Use `reject` for a reversible decision, or `archive` to withdraw an approved comment while keeping it restorable. Idempotency-keyed and audited at `warning` severity.

**Parameters**

| Name              | In     | Required | Type          | Description |
| ----------------- | ------ | -------- | ------------- | ----------- |
| `id`              | path   | yes      | string (uuid) |             |
| `Idempotency-Key` | header | yes      | string        |             |

**Responses**

| Status | Description                                                  | Schema                                 |
| ------ | ------------------------------------------------------------ | -------------------------------------- |
| 200    | The comment was soft-deleted.                                | object                                 |
| 401    | Missing or invalid session.                                  | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                  | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.                                          | [`ApiError`](#standard-error-envelope) |
| 409    | Idempotency-Key conflict, or the comment is already deleted. | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/comments/admin/{id}/moderate` — Approve, reject, or mark a comment as spam.

- **operationId**: `moderateComment`
- **Security**: bearerAuth + tenantHeader

`approve` requires `comments.moderation.approve`; `reject` and `spam` both require `comments.moderation.reject` — marking spam is a rejection subtype with the same blast radius, distinguished by its audited reason code rather than by a separate permission. A reason code is mandatory for `reject` and `spam`. Idempotency-keyed and audited.

**Parameters**

| Name              | In     | Required | Type          | Description |
| ----------------- | ------ | -------- | ------------- | ----------- |
| `id`              | path   | yes      | string (uuid) |             |
| `Idempotency-Key` | header | yes      | string        |             |

**Request body** (required): object

**Responses**

| Status | Description                                                                                                                   | Schema                                 |
| ------ | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 200    | The decision was applied.                                                                                                     | object                                 |
| 400    | Validation error.                                                                                                             | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                                                                                   | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                                                                                   | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.                                                                                                           | [`ApiError`](#standard-error-envelope) |
| 409    | Either the Idempotency-Key was reused with a different request, or the action is not legal from the comment's current status. | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/comments/admin/{id}/restore` — Return a rejected, spam, or archived comment to review.

- **operationId**: `restoreComment`
- **Security**: bearerAuth + tenantHeader

Requires `comments.moderation.restore`. Moves the comment back to `pending` for a fresh decision. A soft-deleted comment is terminal and cannot be restored in-band. Idempotency-keyed and audited.

**Parameters**

| Name              | In     | Required | Type          | Description |
| ----------------- | ------ | -------- | ------------- | ----------- |
| `id`              | path   | yes      | string (uuid) |             |
| `Idempotency-Key` | header | yes      | string        |             |

**Responses**

| Status | Description                                                                                  | Schema                                 |
| ------ | -------------------------------------------------------------------------------------------- | -------------------------------------- |
| 200    | The comment was returned to pending.                                                         | object                                 |
| 401    | Missing or invalid session.                                                                  | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                                                  | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.                                                                          | [`ApiError`](#standard-error-envelope) |
| 409    | Idempotency-Key conflict, or the comment's current status cannot transition back to pending. | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/comments/admin/bulk-moderate` — Apply one moderation action to many comments.

- **operationId**: `bulkModerateComments`
- **Security**: bearerAuth + tenantHeader

Guarded by the same permission the single-comment action requires. Each comment is evaluated independently: the response reports which ids were applied and which were skipped, with the reason. A partial result is a 200, not an error — the applied decisions are real and must not be implied to have rolled back.

**Parameters**

| Name              | In     | Required | Type   | Description |
| ----------------- | ------ | -------- | ------ | ----------- |
| `Idempotency-Key` | header | yes      | string |             |

**Request body** (required): object

**Responses**

| Status | Description                                              | Schema                                 |
| ------ | -------------------------------------------------------- | -------------------------------------- |
| 200    | Per-comment outcomes.                                    | object                                 |
| 400    | Validation error.                                        | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                              | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                              | [`ApiError`](#standard-error-envelope) |
| 409    | The Idempotency-Key was reused with a different request. | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/comments/admin/queue` — Read the moderation queue.

- **operationId**: `listCommentModerationQueue`
- **Security**: bearerAuth + tenantHeader

Requires `comments.moderation.read`. This is the ONLY surface exposing moderation metadata: reason codes, masked author email, and open report counts. Keyset-paginated on `(created_at, id)`.

**Parameters**

| Name       | In    | Required | Type                                                       | Description                                        |
| ---------- | ----- | -------- | ---------------------------------------------------------- | -------------------------------------------------- |
| `status`   | query | no       | enum(`pending`, `approved`, `rejected`, `spam`, `deleted`) |                                                    |
| `limit`    | query | no       | integer                                                    |                                                    |
| `cursor`   | query | no       | string                                                     | Full-precision `created_at`; send with `cursorId`. |
| `cursorId` | query | no       | string (uuid)                                              |                                                    |

**Responses**

| Status | Description                     | Schema                                 |
| ------ | ------------------------------- | -------------------------------------- |
| 200    | A page of the moderation queue. | object                                 |
| 400    | Validation error.               | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.     | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.     | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/comments/admin/settings` — Read this tenant's comment configuration.

- **operationId**: `getCommentSettings`
- **Security**: bearerAuth + tenantHeader

Requires `comments.settings.read`. Returns the stored configuration, or the built-in defaults when the tenant has never saved one.

**Responses**

| Status | Description                         | Schema                                 |
| ------ | ----------------------------------- | -------------------------------------- |
| 200    | The tenant's comment configuration. | object                                 |
| 401    | Missing or invalid session.         | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.         | [`ApiError`](#standard-error-envelope) |

### `PUT /api/v1/comments/admin/settings` — Update this tenant's comment configuration.

- **operationId**: `updateCommentSettings`
- **Security**: bearerAuth + tenantHeader

Requires `comments.settings.update`. A partial body is merged over the current settings. High-risk (it changes the public comment surface), idempotency-keyed, and audited with before/after values. Every bound mirrors a database CHECK constraint, so an out-of-range value is a 400 rather than a constraint violation.

**Parameters**

| Name              | In     | Required | Type   | Description |
| ----------------- | ------ | -------- | ------ | ----------- |
| `Idempotency-Key` | header | yes      | string |             |

**Request body** (required): [`CommentSettings`](#schema-commentsettings)

**Responses**

| Status | Description                                              | Schema                                 |
| ------ | -------------------------------------------------------- | -------------------------------------- |
| 200    | The saved configuration.                                 | object                                 |
| 400    | Validation error.                                        | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                              | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                              | [`ApiError`](#standard-error-envelope) |
| 409    | The Idempotency-Key was reused with a different request. | [`ApiError`](#standard-error-envelope) |

## Push Delivery

Transactional outbox for device push notifications (push_delivery module, ADR-0074) — the caller's own device registration/revocation plus the operator's queue diagnostics, message cancel, and end-to-end delivery probe. It is a SECOND outbox on purpose: domain-event-runtime calls its consumers INSIDE the claim transaction by design, and ADR-0006 forbids the external HTTP call a push provider needs from inside a transaction. Two transports, neither of which costs a client byte or a CSP origin: Web Push (RFC 8030/8291/8292, VAPID) to browsers — chosen over the FCM Web SDK, which is 2.1x the per-file asset budget and demands three third-party origins the CSP does not have — and FCM HTTP v1 server-to-Google for native clients. Managing one's own device is self-service (the subject is the caller and no recipient is accepted); everything that touches another person's rows or makes the deployment emit traffic goes through the ABAC chokepoint. Endpoints are credential-grade and are stored hashed/masked, projected raw by exactly one function immediately before a provider call.

### `GET /api/v1/push/diagnostics` — The tenant's push outbox — queue counts, recent messages, attempts, devices.

- **operationId**: `getPushDiagnostics`
- **Security**: bearerAuth + tenantHeader

One endpoint rather than four because the four parts are only readable together: they come from ONE transaction, so a queue count and a message list can never describe two different instants. Bounded rather than paginated — the historical tail is removed by retention (`bun run push:queue:purge`), not browsed. Endpoints are masked everywhere and notification bodies are never projected. `configured` reports the DEPLOYMENT's push flag and adapter name, which is what distinguishes a stuck queue from a deployment where push is simply off. Requires `push_delivery.diagnostics.read`.

**Parameters**

| Name     | In    | Required | Type                                             | Description                                                                                                                                                                       |
| -------- | ----- | -------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `status` | query | no       | [`PushMessageStatus`](#schema-pushmessagestatus) | Narrow the message list to one queue status.                                                                                                                                      |
| `limit`  | query | no       | integer                                          | 1-200, default 50. Out-of-range values are REJECTED rather than clamped: a caller asking for 1000 and silently receiving 200 would read the short list as "that is all there is". |

**Responses**

| Status | Description                                      | Schema                                 |
| ------ | ------------------------------------------------ | -------------------------------------- |
| 200    | Push outbox diagnostics.                         | object                                 |
| 401    | Missing or invalid session.                      | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                      | [`ApiError`](#standard-error-envelope) |
| 422    | Unknown status filter, or a limit outside 1-200. | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/push/messages/{id}/cancel` — Cancel a push notification that has not been sent yet.

- **operationId**: `cancelPushMessage`
- **Security**: bearerAuth + tenantHeader

Only `queued` and `retry_wait` are cancellable. A row in `sending` has been claimed by a dispatcher pass that may already be inside the HTTP call, so recording it as cancelled would be a claim this system cannot substantiate. Deliberately NOT idempotency-keyed: a second call performs no new work, so there is no replay contract to honour. Requires `push_delivery.messages.cancel`.

**Parameters**

| Name | In   | Required | Type          | Description |
| ---- | ---- | -------- | ------------- | ----------- |
| `id` | path | yes      | string (uuid) |             |

**Responses**

| Status | Description                                                                                                                                                                                                             | Schema                                 |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 200    | The message was cancelled before delivery.                                                                                                                                                                              | object                                 |
| 400    | Validation error.                                                                                                                                                                                                       | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                                                                                                                                                                             | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                                                                                                                                                                             | [`ApiError`](#standard-error-envelope) |
| 409    | Not cancellable. One answer for "no such message", "already sent", "already failed", "already cancelled" and "being sent right now" — distinguishing them would hand a narrow grant an existence oracle over the queue. | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/push/stream` — Server-sent stream of the push queue summary, re-authorized every tick.

- **operationId**: `streamPushQueueSummary`
- **Security**: bearerAuth + tenantHeader

`text/event-stream`. The only SSE endpoint in this contract, and the one place where an authorization decision would otherwise become a STANDING permission: an ordinary route returns its connection to the pool before any byte reaches the client, so a thirty-minute stream would keep serving a role revoked at minute two. ADR-0075 decides otherwise — every tick opens its own transaction, runs the full guard chain again, and reads only after it allows.

Three event names. `push-queue-summary` carries a `PushQueueSummary` every 5 s. `authorization-revoked` is terminal and the client must NOT reconnect — whatever it held is gone. `stream-error` is terminal and retryable, and is deliberately a DIFFERENT name: telling a client its access was revoked when the database was merely busy is a lie in the direction that gets investigated as a permissions bug.

A connection ends after 10 minutes regardless; `EventSource` reconnects by itself, so the ceiling costs a reconnect while its absence would cost a connection slot forever. The message and attempt lists are NOT streamed — they are bounded at 50 rows and change shape rather than value. Requires `push_delivery.diagnostics.read`, re-checked per tick.

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | The event stream.           | string                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |

### `GET /api/v1/push/subscriptions` — List the caller's own registered push devices.

- **operationId**: `listOwnPushSubscriptions`
- **Security**: bearerAuth + tenantHeader

Every device the calling identity has registered in this tenant, newest first, with the endpoint MASKED — the raw endpoint is credential-grade and is projected by exactly one server-side function, immediately before a provider call. Also returns whether Web Push is configured on this deployment and, if so, the VAPID application server key the browser needs for PushManager.subscribe(). That key is public by definition; it travels with the list so a client needs one round trip rather than two. A machine credential presented here receives the ordinary 401: it has no device.

**Responses**

| Status | Description                                                     | Schema                                 |
| ------ | --------------------------------------------------------------- | -------------------------------------- |
| 200    | The caller's devices plus the deployment's Web Push capability. | object                                 |
| 400    | Validation error.                                               | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                     | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/push/subscriptions` — Register (or re-activate) a push device for the caller.

- **operationId**: `registerOwnPushSubscription`
- **Security**: bearerAuth + tenantHeader

Takes the browser's own PushSubscription.toJSON() shape plus a transport discriminator. The owner is the calling identity and cannot be supplied: there is no recipient parameter on this endpoint. Re-registration is safe and expected — browsers re-issue PushManager.subscribe() on every page load once permission is granted, so a conflict on the endpoint hash updates the existing row (and re-activates it if a push service had previously reported it gone) instead of creating a second one. Returns 201 in both cases: "created" versus "already yours" is a distinction the client cannot act on. A suspended tenant is refused (ADR-0073).

**Request body** (required): [`PushSubscriptionRegistration`](#schema-pushsubscriptionregistration)

**Responses**

| Status | Description                                                                                                                                                         | Schema                                 |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 201    | The registered device.                                                                                                                                              | object                                 |
| 400    | Validation error.                                                                                                                                                   | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session.                                                                                                                                         | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                                                                                                                         | [`ApiError`](#standard-error-envelope) |
| 422    | Malformed registration — unknown transport, a non-https endpoint, an endpoint pointing at a literal private address, or key material that is not the RFC 8291 size. | [`ApiError`](#standard-error-envelope) |

### `DELETE /api/v1/push/subscriptions/{id}` — Retire one of the caller's own push devices.

- **operationId**: `revokeOwnPushSubscription`
- **Security**: bearerAuth + tenantHeader

Ownership is matched inside the UPDATE rather than checked after a read, so there is no window between the two and no way to learn whether an id belongs to somebody else. "No such subscription", "belongs to another user" and "already revoked" all answer 404. The row survives as evidence that the device was revoked and when, but the stored endpoint does not: a user-initiated revocation destroys it, because unlike a subscription the push service reported gone, this one may still be perfectly usable.

**Parameters**

| Name | In   | Required | Type          | Description |
| ---- | ---- | -------- | ------------- | ----------- |
| `id` | path | yes      | string (uuid) |             |

**Responses**

| Status | Description                 | Schema                                 |
| ------ | --------------------------- | -------------------------------------- |
| 200    | The device was revoked.     | object                                 |
| 400    | Validation error.           | [`ApiError`](#standard-error-envelope) |
| 401    | Missing or invalid session. | [`ApiError`](#standard-error-envelope) |
| 404    | Resource not found.         | [`ApiError`](#standard-error-envelope) |

### `POST /api/v1/push/test` — Queue a test notification to the caller's own devices.

- **operationId**: `sendPushTestNotification`
- **Security**: bearerAuth + tenantHeader

Proves the parts of the chain nothing else can see — that the VAPID key pair matches the one the browser subscribed with, that the service worker registered at the right scope, that the operating system is not withholding permission. Each of those fails as a queue that drains cleanly and a device that shows nothing. The recipient is the CALLER and the endpoint accepts no recipient parameter: a test that took one would be an arbitrary-notification surface, delivering system-branded text of the sender's choosing to any colleague's lock screen. Title and body are fixed for the same reason. Requires `push_delivery.diagnostics.check`.

**Responses**

| Status | Description                                                                                                                                                | Schema                                 |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 200    | How many devices the test was queued to.                                                                                                                   | object                                 |
| 401    | Missing or invalid session.                                                                                                                                | [`ApiError`](#standard-error-envelope) |
| 403    | Access denied by RBAC/ABAC.                                                                                                                                | [`ApiError`](#standard-error-envelope) |
| 409    | Push is disabled on this deployment (the dispatcher would claim nothing, leaving the probe queued forever), or the caller has no active device to send to. | [`ApiError`](#standard-error-envelope) |

## Schema appendix

Every schema referenced by at least one operation above (excluding the standard envelope schemas, covered in §Standard success/error envelope).

### Schema: AbacDslPolicyConditions

A bounded, deterministic condition AST (Issue #179). A node is either a composition — exactly one of `allOf` (array; empty = true), `anyOf` (array; empty = false), or `not` (a single node) — or a leaf `{ attr, op, value | valueAttr }` over the server-side attribute allow-list (`subject.*`, `resource.*`, `action`, `env.*`) with the bounded operator set (eq, ne, in, nin, lt, lte, gt, gte, exists). No regex, functions, or arbitrary expressions. Depth ≤ 32, ≤ 512 nodes.

A bounded, deterministic condition AST (Issue #179). A node is either a composition — exactly one of `allOf` (array; empty = true), `anyOf` (array; empty = false), or `not` (a single node) — or a leaf `{ attr, op, value | valueAttr }` over the server-side attribute allow-list (`subject.*`, `resource.*`, `action`, `env.*`) with the bounded operator set (eq, ne, in, nin, lt, lte, gt, gte, exists). No regex, functions, or arbitrary expressions. Depth ≤ 32, ≤ 512 nodes.

**Example**

```json
{}
```

### Schema: AbacDslPolicyWriteRequest

| Field          | Type                                                         | Required | Nullable | Description                                                                           |
| -------------- | ------------------------------------------------------------ | -------- | -------- | ------------------------------------------------------------------------------------- |
| `policyCode`   | string                                                       | yes      | no       | 3-100 chars, alphanumerics plus . _ - (not at the edges).                             |
| `effect`       | enum(`allow`, `deny`)                                        | yes      | no       |                                                                                       |
| `description`  | string                                                       | no       | yes      |                                                                                       |
| `moduleKey`    | string                                                       | no       | yes      | Applicability filter — null is a wildcard.                                            |
| `activityCode` | string                                                       | no       | yes      |                                                                                       |
| `action`       | string                                                       | no       | yes      |                                                                                       |
| `resourceType` | string                                                       | no       | yes      |                                                                                       |
| `dslVersion`   | integer                                                      | no       | no       | Defaults to the current DSL version (1). A value newer than supported is rejected.    |
| `priority`     | integer                                                      | no       | no       | Lower evaluates first (deterministic). Defaults to 100.                               |
| `conditions`   | [`AbacDslPolicyConditions`](#schema-abacdslpolicyconditions) | yes      | no       |                                                                                       |
| `isActive`     | boolean                                                      | no       | no       | On create only — author enabled immediately. Defaults to false (author, then enable). |

**Example**

```json
{
  "policyCode": "string",
  "effect": "allow",
  "description": "string",
  "moduleKey": "string",
  "activityCode": "string",
  "action": "string",
  "resourceType": "string",
  "dslVersion": 0,
  "priority": 0,
  "conditions": "(operation-specific payload)",
  "isActive": false
}
```

### Schema: AbacSimulationRequest

| Field         | Type   | Required | Nullable | Description |
| ------------- | ------ | -------- | -------- | ----------- |
| `subject`     | object | no       | no       |             |
| `request`     | object | yes      | no       |             |
| `environment` | object | no       | no       |             |

**Example**

```json
{
  "subject": {
    "tenantUserId": "00000000-0000-0000-0000-000000000000",
    "roles": ["string"]
  },
  "request": {
    "moduleKey": "string",
    "activityCode": "string",
    "action": "string",
    "resourceType": "string",
    "resourceAttributes": "(operation-specific payload)"
  },
  "environment": {
    "ipTrusted": false,
    "now": "2026-01-01T00:00:00.000Z"
  }
}
```

### Schema: AccessEvaluateRequest

| Field                | Type          | Required | Nullable | Description |
| -------------------- | ------------- | -------- | -------- | ----------- |
| `moduleKey`          | string        | yes      | no       |             |
| `activityCode`       | string        | yes      | no       |             |
| `action`             | string        | yes      | no       |             |
| `resourceType`       | string        | no       | no       |             |
| `resourceId`         | string (uuid) | no       | no       |             |
| `resourceAttributes` | object        | no       | no       |             |

**Example**

```json
{
  "moduleKey": "string",
  "activityCode": "string",
  "action": "string",
  "resourceType": "string",
  "resourceId": "00000000-0000-0000-0000-000000000000",
  "resourceAttributes": "(operation-specific payload)"
}
```

### Schema: AdPlacementCreateRequest

| Field           | Type                                                                                                                                                                                                                             | Required | Nullable | Description                                                        |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------- | ------------------------------------------------------------------ |
| `placementKey`  | enum(`header_banner`, `below_headline`, `homepage_middle`, `homepage_bottom`, `article_top`, `article_middle`, `article_bottom`, `sidebar_top`, `sidebar_middle`, `sidebar_bottom`, `category_archive_top`, `search_result_top`) | yes      | no       |                                                                    |
| `name`          | string                                                                                                                                                                                                                           | yes      | no       |                                                                    |
| `mediaObjectId` | string (uuid)                                                                                                                                                                                                                    | yes      | no       |                                                                    |
| `linkUrl`       | string                                                                                                                                                                                                                           | no       | yes      |                                                                    |
| `rotationMode`  | enum(`latest`, `priority`, `random_safe`, `weighted`)                                                                                                                                                                            | no       | no       |                                                                    |
| `priority`      | integer                                                                                                                                                                                                                          | no       | no       |                                                                    |
| `isActive`      | boolean                                                                                                                                                                                                                          | no       | no       |                                                                    |
| `startsAt`      | string (date-time)                                                                                                                                                                                                               | no       | yes      |                                                                    |
| `endsAt`        | string (date-time)                                                                                                                                                                                                               | no       | yes      |                                                                    |
| `targetType`    | enum(`global`, `widget`, `post`, `page`)                                                                                                                                                                                         | no       | no       | Targeting scope (ADR-0044). Omit for a site-wide ad.               |
| `targetId`      | string (uuid)                                                                                                                                                                                                                    | no       | yes      | Required for `widget`/`post`/`page`, must be omitted for `global`. |

**Example**

```json
{
  "placementKey": "header_banner",
  "name": "string",
  "mediaObjectId": "00000000-0000-0000-0000-000000000000",
  "linkUrl": "https://example.com/resource",
  "rotationMode": "latest",
  "priority": 0,
  "isActive": false,
  "startsAt": "2026-01-01T00:00:00.000Z",
  "endsAt": "2026-01-01T00:00:00.000Z",
  "targetType": "global",
  "targetId": "00000000-0000-0000-0000-000000000000"
}
```

### Schema: AdPlacementUpdateRequest

| Field           | Type                                                                                                                                                                                                                             | Required | Nullable | Description                                                                                                                                                                |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `placementKey`  | enum(`header_banner`, `below_headline`, `homepage_middle`, `homepage_bottom`, `article_top`, `article_middle`, `article_bottom`, `sidebar_top`, `sidebar_middle`, `sidebar_bottom`, `category_archive_top`, `search_result_top`) | no       | no       |                                                                                                                                                                            |
| `name`          | string                                                                                                                                                                                                                           | no       | no       |                                                                                                                                                                            |
| `mediaObjectId` | string (uuid)                                                                                                                                                                                                                    | no       | no       |                                                                                                                                                                            |
| `linkUrl`       | string                                                                                                                                                                                                                           | no       | yes      |                                                                                                                                                                            |
| `rotationMode`  | enum(`latest`, `priority`, `random_safe`, `weighted`)                                                                                                                                                                            | no       | no       |                                                                                                                                                                            |
| `priority`      | integer                                                                                                                                                                                                                          | no       | no       |                                                                                                                                                                            |
| `isActive`      | boolean                                                                                                                                                                                                                          | no       | no       |                                                                                                                                                                            |
| `startsAt`      | string (date-time)                                                                                                                                                                                                               | no       | yes      |                                                                                                                                                                            |
| `endsAt`        | string (date-time)                                                                                                                                                                                                               | no       | yes      |                                                                                                                                                                            |
| `targetType`    | enum(`global`, `widget`, `post`, `page`)                                                                                                                                                                                         | no       | no       | Targeting scope (ADR-0044). Must be sent whenever `targetId` is sent — the pair moves together or not at all, so that switching to `global` also clears the stored target. |
| `targetId`      | string (uuid)                                                                                                                                                                                                                    | no       | yes      | Required for `widget`/`post`/`page`, must be omitted for `global`. Sending it without `targetType` is a validation error.                                                  |

**Example**

```json
{
  "placementKey": "header_banner",
  "name": "string",
  "mediaObjectId": "00000000-0000-0000-0000-000000000000",
  "linkUrl": "https://example.com/resource",
  "rotationMode": "latest",
  "priority": 0,
  "isActive": false,
  "startsAt": "2026-01-01T00:00:00.000Z",
  "endsAt": "2026-01-01T00:00:00.000Z",
  "targetType": "global",
  "targetId": "00000000-0000-0000-0000-000000000000"
}
```

### Schema: BlogContentBlock

One block of `content_json`. The vocabulary is closed: a value outside
the six variants below is not stored and not rendered.

This schema exists because the vocabulary previously lived only in a
TypeScript type and one prose sentence, so every consumer re-derived it
by reading. One did, and disagreed with it in three ways at once —
silently, because a wrong block type raises no error anywhere. It
renders wrongly, or the section disappears.

Held to `blog-content/domain/content-block-rendering.ts`'s
`CONTENT_BLOCK_TYPES` by `tests/content-block-contract.test.ts`, which
also holds that constant to the renderer's own switch.

Note two shapes that are easy to guess wrong:

- Ordering is a FIELD on `list` (`ordered: true`), not a separate
  `ordered_list` type.
- `gallery` and `video_news` carry NO `text` field. A renderer that
  falls back to "render `text` as a paragraph" drops them entirely.

One block of `content_json`. The vocabulary is closed: a value outside
the six variants below is not stored and not rendered.

This schema exists because the vocabulary previously lived only in a
TypeScript type and one prose sentence, so every consumer re-derived it
by reading. One did, and disagreed with it in three ways at once —
silently, because a wrong block type raises no error anywhere. It
renders wrongly, or the section disappears.

Held to `blog-content/domain/content-block-rendering.ts`'s
`CONTENT_BLOCK_TYPES` by `tests/content-block-contract.test.ts`, which
also holds that constant to the renderer's own switch.

Note two shapes that are easy to guess wrong:

- Ordering is a FIELD on `list` (`ordered: true`), not a separate
  `ordered_list` type.
- `gallery` and `video_news` carry NO `text` field. A renderer that
  falls back to "render `text` as a paragraph" drops them entirely.

**Example**

```json
{
  "type": "paragraph",
  "text": "string"
}
```

### Schema: BlogContentJson

Structured post/page body. `{ blocks: BlogContentBlock[] }` — never raw HTML, by construction: there is no block variant that carries markup.

| Field    | Type                                                    | Required | Nullable | Description |
| -------- | ------------------------------------------------------- | -------- | -------- | ----------- |
| `blocks` | array of [`BlogContentBlock`](#schema-blogcontentblock) | no       | no       |             |

**Example**

```json
{
  "blocks": [
    {
      "type": "paragraph",
      "text": "string"
    }
  ]
}
```

### Schema: BlogPageWriteInput

Shared shape for POST /api/v1/blog/pages and PATCH /api/v1/blog/pages/{id} (all fields optional on update).

| Field             | Type                                           | Required | Nullable | Description |
| ----------------- | ---------------------------------------------- | -------- | -------- | ----------- |
| `title`           | string                                         | no       | no       |             |
| `slug`            | string                                         | no       | no       |             |
| `excerpt`         | string                                         | no       | yes      |             |
| `contentJson`     | [`BlogContentJson`](#schema-blogcontentjson)   | no       | no       |             |
| `contentText`     | string                                         | no       | no       |             |
| `locale`          | string                                         | no       | no       |             |
| `visibility`      | enum(`public`, `private`, `unlisted`)          | no       | no       |             |
| `featuredMediaId` | string (uuid)                                  | no       | yes      |             |
| `seoTitle`        | string                                         | no       | yes      |             |
| `metaDescription` | string                                         | no       | yes      |             |
| `canonicalUrl`    | string                                         | no       | yes      |             |
| `pageType`        | enum(`standard`, `landing`, `legal`, `system`) | no       | no       |             |
| `parentPageId`    | string (uuid)                                  | no       | yes      |             |
| `menuOrder`       | integer                                        | no       | no       |             |

**Example**

```json
{
  "title": "string",
  "slug": "example-slug",
  "excerpt": "string",
  "contentJson": {
    "blocks": [
      {
        "type": null,
        "text": null
      }
    ]
  },
  "contentText": "string",
  "locale": "string",
  "visibility": "public",
  "featuredMediaId": "00000000-0000-0000-0000-000000000000",
  "seoTitle": "string",
  "metaDescription": "string",
  "canonicalUrl": "https://example.com/resource",
  "pageType": "standard",
  "parentPageId": "00000000-0000-0000-0000-000000000000",
  "menuOrder": 0
}
```

### Schema: BlogPostWriteInput

Shared shape for POST /api/v1/blog/posts (all fields required) and PATCH /api/v1/blog/posts/{id} (all fields optional, only present fields change).

| Field                          | Type                                         | Required | Nullable | Description                                                                                      |
| ------------------------------ | -------------------------------------------- | -------- | -------- | ------------------------------------------------------------------------------------------------ |
| `title`                        | string                                       | no       | no       |                                                                                                  |
| `slug`                         | string                                       | no       | no       |                                                                                                  |
| `excerpt`                      | string                                       | no       | yes      |                                                                                                  |
| `contentJson`                  | [`BlogContentJson`](#schema-blogcontentjson) | no       | no       |                                                                                                  |
| `contentText`                  | string                                       | no       | no       |                                                                                                  |
| `locale`                       | string                                       | no       | no       |                                                                                                  |
| `visibility`                   | enum(`public`, `private`, `unlisted`)        | no       | no       |                                                                                                  |
| `featuredMediaId`              | string (uuid)                                | no       | yes      |                                                                                                  |
| `seoImageMediaId`              | string (uuid)                                | no       | yes      | Explicit "use this image for social/SEO preview" override — takes priority over featuredMediaId. |
| `seoTitle`                     | string                                       | no       | yes      |                                                                                                  |
| `metaDescription`              | string                                       | no       | yes      |                                                                                                  |
| `canonicalUrl`                 | string                                       | no       | yes      |                                                                                                  |
| `termIds`                      | array of string (uuid)                       | no       | no       |                                                                                                  |
| `translationGroupId`           | string (uuid)                                | no       | yes      |                                                                                                  |
| `autoInternalTagLinksDisabled` | boolean                                      | no       | no       | Per-post opt-out of automatic internal tag linking.                                              |

**Example**

```json
{
  "title": "string",
  "slug": "example-slug",
  "excerpt": "string",
  "contentJson": {
    "blocks": [
      {
        "type": null,
        "text": null
      }
    ]
  },
  "contentText": "string",
  "locale": "string",
  "visibility": "public",
  "featuredMediaId": "00000000-0000-0000-0000-000000000000",
  "seoImageMediaId": "00000000-0000-0000-0000-000000000000",
  "seoTitle": "string",
  "metaDescription": "string",
  "canonicalUrl": "https://example.com/resource",
  "termIds": ["00000000-0000-0000-0000-000000000000"],
  "translationGroupId": "00000000-0000-0000-0000-000000000000",
  "autoInternalTagLinksDisabled": false
}
```

### Schema: BlogTermWriteInput

| Field          | Type                    | Required | Nullable | Description |
| -------------- | ----------------------- | -------- | -------- | ----------- |
| `taxonomyType` | enum(`category`, `tag`) | no       | no       |             |
| `parentId`     | string (uuid)           | no       | yes      |             |
| `name`         | string                  | no       | no       |             |
| `slug`         | string                  | no       | no       |             |
| `description`  | string                  | no       | yes      |             |

**Example**

```json
{
  "taxonomyType": "category",
  "parentId": "00000000-0000-0000-0000-000000000000",
  "name": "string",
  "slug": "example-slug",
  "description": "string"
}
```

### Schema: CollectVisitBeaconRequest

| Field        | Type   | Required | Nullable | Description                                                                                                     |
| ------------ | ------ | -------- | -------- | --------------------------------------------------------------------------------------------------------------- |
| `tenantCode` | string | yes      | no       | Public tenant code the beacon is reporting for.                                                                 |
| `path`       | string | yes      | no       | The page path being reported (must start with '/'). Sanitized server-side; sensitive query params are stripped. |
| `referrer`   | string | no       | yes      | Optional referrer URL; only its bare hostname is ever stored.                                                   |

**Example**

```json
{
  "tenantCode": "string",
  "path": "string",
  "referrer": "string"
}
```

### Schema: CommentSettings

Per-tenant comment configuration. Every numeric bound mirrors a CHECK constraint in sql/066.

| Field                | Type                                                                                  | Required | Nullable | Description                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------- | -------- | -------- | -------------------------------------------------------------------------------------------------- |
| `defaultPolicyMode`  | enum(`disabled`, `authenticated-only`, `moderated-anonymous`, `moderated-registered`) | no       | no       |                                                                                                    |
| `requireModeration`  | boolean                                                                               | no       | no       |                                                                                                    |
| `allowAnonymous`     | boolean                                                                               | no       | no       |                                                                                                    |
| `editWindowSeconds`  | integer                                                                               | no       | no       |                                                                                                    |
| `maxDepth`           | integer                                                                               | no       | no       | Only ever TIGHTENS the structural hard cap of 4; a larger value does not deepen the rendered tree. |
| `maxLength`          | integer                                                                               | no       | no       |                                                                                                    |
| `maxLinksPerComment` | integer                                                                               | no       | no       |                                                                                                    |
| `minSubmitSeconds`   | integer                                                                               | no       | no       |                                                                                                    |
| `rateLimitPerHour`   | integer                                                                               | no       | no       |                                                                                                    |
| `blockedTerms`       | array of string                                                                       | no       | no       |                                                                                                    |
| `turnstileEnabled`   | boolean                                                                               | no       | no       |                                                                                                    |
| `notifyOnReply`      | boolean                                                                               | no       | no       |                                                                                                    |

**Example**

```json
{
  "defaultPolicyMode": "disabled",
  "requireModeration": false,
  "allowAnonymous": false,
  "editWindowSeconds": 0,
  "maxDepth": 0,
  "maxLength": 100,
  "maxLinksPerComment": 0,
  "minSubmitSeconds": 0,
  "rateLimitPerHour": 1,
  "blockedTerms": ["string"],
  "turnstileEnabled": false,
  "notifyOnReply": false
}
```

### Schema: CreateInvitationInput

| Field                   | Type                   | Required | Nullable | Description                                                                                                                                |
| ----------------------- | ---------------------- | -------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `loginIdentifier`       | string                 | yes      | no       | An email address. Stored trimmed and NEVER lowercased, matching every identifier lookup on the auth path.                                  |
| `displayName`           | string                 | yes      | no       |                                                                                                                                            |
| `roleIds`               | array of string (uuid) | no       | no       | Absent or empty admits the person without granting anything. A non-empty list additionally requires identity_access.access_control.assign. |
| `skipEmailConfirmation` | boolean                | no       | no       | PLATFORM-scoped unless the address already holds an active identity in this tenant. Only the literal `true` opts in.                       |

**Example**

```json
{
  "loginIdentifier": "string",
  "displayName": "string",
  "roleIds": ["00000000-0000-0000-0000-000000000000"],
  "skipEmailConfirmation": false
}
```

### Schema: CreateNewsMediaUploadSessionRequest

| Field              | Type    | Required | Nullable | Description                                                                                                                                                                      |
| ------------------ | ------- | -------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mimeType`         | string  | yes      | no       | Must be one of the deployment's configured NEWS_MEDIA_R2_ALLOWED_MIME_TYPES (default: image/jpeg, image/png, image/webp, image/gif — image/svg+xml is never allowed by default). |
| `byteSize`         | integer | yes      | no       | Claimed size in bytes — shape-only check against NEWS_MEDIA_R2_MAX_UPLOAD_BYTES; the real size is re-checked from R2 itself at finalize time.                                    |
| `originalFilename` | string  | no       | yes      | Stored as display-only metadata — never part of the server-generated object key.                                                                                                 |
| `altText`          | string  | no       | yes      |                                                                                                                                                                                  |
| `caption`          | string  | no       | yes      |                                                                                                                                                                                  |

**Example**

```json
{
  "mimeType": "image/jpeg",
  "byteSize": 1,
  "originalFilename": "string",
  "altText": "string",
  "caption": "string"
}
```

### Schema: CreateTenantDomainRequest

| Field                     | Type                                                   | Required | Nullable | Description                                                            |
| ------------------------- | ------------------------------------------------------ | -------- | -------- | ---------------------------------------------------------------------- |
| `hostname`                | string                                                 | yes      | no       | DNS hostname (no port). Normalized to lowercase for uniqueness/lookup. |
| `domainType`              | enum(`subdomain`, `custom_domain`)                     | no       | no       |                                                                        |
| `routeMode`               | enum(`canonical`, `legacy_blog`)                       | no       | no       |                                                                        |
| `verificationMethod`      | enum(`dns_txt`, `dns_cname`, `file`, `manual`, `null`) | no       | yes      |                                                                        |
| `verificationRecordName`  | string                                                 | no       | yes      |                                                                        |
| `verificationRecordValue` | string                                                 | no       | yes      |                                                                        |
| `redirectToPrimary`       | boolean                                                | no       | no       |                                                                        |

**Example**

```json
{
  "hostname": "tenant.example.com",
  "domainType": "subdomain",
  "routeMode": "canonical",
  "verificationMethod": "dns_txt",
  "verificationRecordName": "string",
  "verificationRecordValue": "string",
  "redirectToPrimary": false
}
```

### Schema: DataLifecycleCreateLegalHoldRequest

| Field                | Type               | Required | Nullable | Description                                                                                                                                                      |
| -------------------- | ------------------ | -------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `descriptorKey`      | string             | no       | yes      | Omit or null for a tenant-wide hold applying to every registered descriptor.                                                                                     |
| `scopeDescription`   | string             | yes      | no       |                                                                                                                                                                  |
| `reason`             | string             | yes      | no       |                                                                                                                                                                  |
| `authorityReference` | string             | yes      | no       | e.g. a court order or regulator reference number.                                                                                                                |
| `endsAt`             | string (date-time) | no       | yes      | Reporting metadata only (an operator's expected review date) — NEVER an automatic-expiry mechanism. A hold stops applying only via an explicit, audited release. |

**Example**

```json
{
  "descriptorKey": "string",
  "scopeDescription": "string",
  "reason": "string",
  "authorityReference": "string",
  "endsAt": "2026-01-01T00:00:00.000Z"
}
```

### Schema: DataLifecycleDryRunRequest

| Field                   | Type    | Required | Nullable | Description                                                                                                                                                                    |
| ----------------------- | ------- | -------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `descriptorKey`         | string  | yes      | no       | A key from GET /api/v1/data-lifecycle/registry.                                                                                                                                |
| `retentionDaysOverride` | integer | no       | no       | Optional — clamped to the descriptor's [retentionMinDays, retentionMaxDays] bounds. Cannot widen eligibility around a legal hold (the hold check runs first, unconditionally). |

**Example**

```json
{
  "descriptorKey": "string",
  "retentionDaysOverride": 0
}
```

### Schema: DataLifecycleReleaseLegalHoldRequest

| Field           | Type   | Required | Nullable | Description |
| --------------- | ------ | -------- | -------- | ----------- |
| `releaseReason` | string | yes      | no       |             |

**Example**

```json
{
  "releaseReason": "string"
}
```

### Schema: DeleteTenantDomainRequest

| Field    | Type   | Required | Nullable | Description                             |
| -------- | ------ | -------- | -------- | --------------------------------------- |
| `reason` | string | yes      | no       | Non-empty soft-delete reason (audited). |

**Example**

```json
{
  "reason": "string"
}
```

### Schema: FinalizeNewsMediaUploadSessionRequest

| Field            | Type   | Required | Nullable | Description                                                                                                                                                                                              |
| ---------------- | ------ | -------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `checksumSha256` | string | no       | yes      | Optional. When supplied, compared against the checksum computed server-side from the bytes actually read from R2 — a transport-corruption check only, never a substitute for the server-side MIME sniff. |

**Example**

```json
{
  "checksumSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
}
```

### Schema: FormDraftCreateRequest

| Field          | Type               | Required | Nullable | Description                                                                                                                                         |
| -------------- | ------------------ | -------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `moduleKey`    | string             | yes      | no       | Lowercase snake_case, 2-64 characters, starting with a letter.                                                                                      |
| `wizardKey`    | string             | yes      | no       | Lowercase snake_case, 2-64 characters, starting with a letter.                                                                                      |
| `resourceType` | string             | yes      | no       | Lowercase snake_case, 2-64 characters, starting with a letter.                                                                                      |
| `resourceId`   | string             | no       | no       | Free-form text, not a uuid — a draft may reference a not-yet-created resource or a non-UUID external identifier.                                    |
| `currentStep`  | string             | yes      | no       |                                                                                                                                                     |
| `payload`      | object             | yes      | no       | JSON object, at most 32768 bytes serialized. Rejected outright if any key at any depth matches password/token/secret/credential/ apiKey/privateKey. |
| `expiresAt`    | string (date-time) | no       | no       |                                                                                                                                                     |

**Example**

```json
{
  "moduleKey": "string",
  "wizardKey": "string",
  "resourceType": "string",
  "resourceId": "string",
  "currentStep": "string",
  "payload": "(operation-specific payload)",
  "expiresAt": "2026-01-01T00:00:00.000Z"
}
```

### Schema: FormDraftStatus

Enum values: `draft`, `submitted`, `abandoned`, `expired`.

**Example**

```json
"draft"
```

### Schema: FormDraftUpdateRequest

At least one of currentStep, payload, or expiresAt is required.

| Field         | Type               | Required | Nullable | Description |
| ------------- | ------------------ | -------- | -------- | ----------- |
| `currentStep` | string             | no       | no       |             |
| `payload`     | object             | no       | no       |             |
| `expiresAt`   | string (date-time) | no       | yes      |             |

**Example**

```json
{
  "currentStep": "string",
  "payload": "(operation-specific payload)",
  "expiresAt": "2026-01-01T00:00:00.000Z"
}
```

### Schema: HomepageSectionConfig

Shape depends on sectionType — headline: {postId}; latest_posts: {limit?, categorySlug?}; featured_posts/editor_picks: {postIds: []}; category_grid: {categorySlugs: [], postsPerCategory?}; gallery_block: {mediaObjectIds: [], caption?}. Validated server-side per sectionType; every id/slug must already exist for the same tenant, and gallery_block's mediaObjectIds must each be a verified R2 media object.

Shape depends on sectionType — headline: {postId}; latest_posts: {limit?, categorySlug?}; featured_posts/editor_picks: {postIds: []}; category_grid: {categorySlugs: [], postsPerCategory?}; gallery_block: {mediaObjectIds: [], caption?}. Validated server-side per sectionType; every id/slug must already exist for the same tenant, and gallery_block's mediaObjectIds must each be a verified R2 media object.

**Example**

```json
{}
```

### Schema: HomepageSectionCreateRequest

| Field         | Type                                                                                                 | Required | Nullable | Description |
| ------------- | ---------------------------------------------------------------------------------------------------- | -------- | -------- | ----------- |
| `sectionKey`  | string                                                                                               | yes      | no       |             |
| `sectionType` | enum(`headline`, `latest_posts`, `featured_posts`, `editor_picks`, `category_grid`, `gallery_block`) | yes      | no       |             |
| `title`       | string                                                                                               | no       | yes      |             |
| `config`      | [`HomepageSectionConfig`](#schema-homepagesectionconfig)                                             | yes      | no       |             |
| `sortOrder`   | integer                                                                                              | no       | no       |             |
| `isEnabled`   | boolean                                                                                              | no       | no       |             |
| `startsAt`    | string (date-time)                                                                                   | no       | yes      |             |
| `endsAt`      | string (date-time)                                                                                   | no       | yes      |             |

**Example**

```json
{
  "sectionKey": "string",
  "sectionType": "headline",
  "title": "string",
  "config": "(operation-specific payload)",
  "sortOrder": 0,
  "isEnabled": false,
  "startsAt": "2026-01-01T00:00:00.000Z",
  "endsAt": "2026-01-01T00:00:00.000Z"
}
```

### Schema: HomepageSectionUpdateRequest

sectionType cannot be changed after creation — omit it, do not send the old or a new value.

| Field       | Type                                                     | Required | Nullable | Description |
| ----------- | -------------------------------------------------------- | -------- | -------- | ----------- |
| `title`     | string                                                   | no       | yes      |             |
| `config`    | [`HomepageSectionConfig`](#schema-homepagesectionconfig) | no       | no       |             |
| `sortOrder` | integer                                                  | no       | no       |             |
| `isEnabled` | boolean                                                  | no       | no       |             |
| `startsAt`  | string (date-time)                                       | no       | yes      |             |
| `endsAt`    | string (date-time)                                       | no       | yes      |             |

**Example**

```json
{
  "title": "string",
  "config": "(operation-specific payload)",
  "sortOrder": 0,
  "isEnabled": false,
  "startsAt": "2026-01-01T00:00:00.000Z",
  "endsAt": "2026-01-01T00:00:00.000Z"
}
```

### Schema: IssueMachineCredentialRequest

| Field                   | Type                              | Required | Nullable | Description                                                                                                                                                                        |
| ----------------------- | --------------------------------- | -------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`                  | string                            | yes      | no       | Operator-facing label, e.g. "awcms-astro build feed".                                                                                                                              |
| `tenantUserId`          | string (uuid)                     | yes      | no       | An existing tenant user in THIS tenant (the service account).                                                                                                                      |
| `allowedPermissionKeys` | array of string                   | yes      | no       | Permission keys (`module.activity.action`) this credential may use. Required and non-empty — an empty list means "can do nothing", never "unrestricted".                           |
| `allowedWriteActions`   | array of enum(`create`, `update`) | no       | no       | ADR-0092. OPTIONAL — omitting it (or sending an empty array) issues the read-only credential of ADR-0049, which is what every caller written before this class got and still gets. |

Naming any action switches the guard to `identity_access.machine_credentials_write.create` and makes `allowedIpCidrs` mandatory. `read` is REJECTED here rather than accepted as a no-op: every credential may already read whatever its `allowedPermissionKeys` name, and accepting it would suggest otherwise.
|
| `allowedIpCidrs` | array of string | no | no | ADR-0092. IPv4/IPv6 literals or CIDR blocks. Required and non-empty when `allowedWriteActions` is non-empty, and REJECTED when it is empty — a read-only credential is not restricted by this list, so accepting one would describe a binding that is not enforced.

Unparseable entries are refused at issuance. At request time an unreadable entry matches nothing, so the failure would otherwise be a credential that reads as bound and can never authenticate.
|
| `expiresAt` | string (date-time) | yes | no | Required, in the future, at most 365 days away — or at most 30 days when `allowedWriteActions` is non-empty. There is no perpetual credential. |

**Example**

```json
{
  "name": "string",
  "tenantUserId": "00000000-0000-0000-0000-000000000000",
  "allowedPermissionKeys": ["string"],
  "allowedWriteActions": ["create"],
  "allowedIpCidrs": ["string"],
  "expiresAt": "2026-01-01T00:00:00.000Z"
}
```

### Schema: IssueSessionHandoffRequest

| Field         | Type         | Required | Nullable | Description                                                                                                               |
| ------------- | ------------ | -------- | -------- | ------------------------------------------------------------------------------------------------------------------------- |
| `clientKey`   | string       | yes      | no       | The registered BFF client's public key. Not a secret, and never treated as one — the secret authenticates at redeem time. |
| `redirectUri` | string (uri) | yes      | no       | Must appear EXACTLY in the client's registered allow-list. https only, no query, no fragment.                             |

**Example**

```json
{
  "clientKey": "string",
  "redirectUri": "string"
}
```

### Schema: PushMessageStatus

Enum values: `queued`, `retry_wait`, `sending`, `sent`, `failed`, `cancelled`.

**Example**

```json
"queued"
```

### Schema: PushSubscriptionRegistration

| Field       | Type                                     | Required | Nullable | Description                                                                                                                                                                                                                                |
| ----------- | ---------------------------------------- | -------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `transport` | [`PushTransport`](#schema-pushtransport) | yes      | no       |                                                                                                                                                                                                                                            |
| `endpoint`  | string                                   | yes      | no       | The push service URL (web_push, https: only, never a literal private address) or the FCM registration token. Bounded because it is an opaque credential-shaped string written by an authenticated caller; real values are ~200 characters. |
| `keys`      | object                                   | no       | no       | REQUIRED for web_push, and rejected for fcm — a client sending both has confused its two registration paths, and silently dropping half of what it sent would store a row that cannot deliver while reporting success.                     |

**Example**

```json
{
  "transport": "web_push",
  "endpoint": "string",
  "keys": {
    "p256dh": "string",
    "auth": "string"
  }
}
```

### Schema: PushTransport

`web_push` is RFC 8030/8291/8292 to a browser; `fcm` is FCM HTTP v1 to a native Android/iOS client. The choice is the CLIENT's — a deployment can serve both, and the dispatcher's configured provider must match the transport of the row it claims.

Enum values: `web_push`, `fcm`.

**Example**

```json
"web_push"
```

### Schema: RedeemSessionHandoffRequest

| Field          | Type         | Required | Nullable | Description                                            |
| -------------- | ------------ | -------- | -------- | ------------------------------------------------------ |
| `clientKey`    | string       | yes      | no       |                                                        |
| `clientSecret` | string       | yes      | no       | Server-to-server only. A browser must never hold this. |
| `code`         | string       | yes      | no       |                                                        |
| `redirectUri`  | string (uri) | yes      | no       | Must equal the URI the code was issued against.        |

**Example**

```json
{
  "clientKey": "string",
  "clientSecret": "string",
  "code": "string",
  "redirectUri": "string"
}
```

### Schema: RegisterPartnerRequest

| Field             | Type          | Required | Nullable | Description                                                                                                                                                                                                                                                                               |
| ----------------- | ------------- | -------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `partnerTenantId` | string (uuid) | yes      | no       | An EXISTING tenant on this deployment, and not the platform tenant itself. The platform learns this id out of band — there is no picker and there is not meant to be.                                                                                                                     |
| `partnerCode`     | string        | yes      | no       | Lower-case letters, digits and hyphens; starts and ends with a letter or digit. Globally unique. The format is enforced in the application rather than by a CHECK because the uniqueness index is global: a stray capital produces a second row that reads like the first one to a human. |
| `displayName`     | string        | yes      | no       |                                                                                                                                                                                                                                                                                           |

**Example**

```json
{
  "partnerTenantId": "00000000-0000-0000-0000-000000000000",
  "partnerCode": "string",
  "displayName": "string"
}
```

### Schema: SeoConfigUpdateRequest

PUT body for seoConfigUpdate — a full replace of the mutable SEO-defaults fields. Every field is optional in the request; an omitted string field is treated as null, and omitted booleans/limit fall back to their defaults (noindex=false, sitemap/feeds enabled=true, feedItemLimit=50). Unknown keys are ignored.

| Field                     | Type            | Required | Nullable | Description |
| ------------------------- | --------------- | -------- | -------- | ----------- |
| `siteName`                | string          | no       | yes      |             |
| `defaultMetaDescription`  | string          | no       | yes      |             |
| `defaultSocialMediaId`    | string (uuid)   | no       | yes      |             |
| `twitterSiteHandle`       | string          | no       | yes      |             |
| `organizationName`        | string          | no       | yes      |             |
| `organizationLogoMediaId` | string (uuid)   | no       | yes      |             |
| `defaultRobotsNoindex`    | boolean         | no       | no       |             |
| `feedTitle`               | string          | no       | yes      |             |
| `feedDescription`         | string          | no       | yes      |             |
| `feedLogoMediaId`         | string (uuid)   | no       | yes      |             |
| `feedItemLimit`           | integer         | no       | no       |             |
| `includedResourceTypes`   | array of string | no       | yes      |             |
| `sitemapEnabled`          | boolean         | no       | no       |             |
| `feedsEnabled`            | boolean         | no       | no       |             |

**Example**

```json
{
  "siteName": "string",
  "defaultMetaDescription": "string",
  "defaultSocialMediaId": "00000000-0000-0000-0000-000000000000",
  "twitterSiteHandle": "string",
  "organizationName": "string",
  "organizationLogoMediaId": "00000000-0000-0000-0000-000000000000",
  "defaultRobotsNoindex": false,
  "feedTitle": "string",
  "feedDescription": "string",
  "feedLogoMediaId": "00000000-0000-0000-0000-000000000000",
  "feedItemLimit": 1,
  "includedResourceTypes": ["string"],
  "sitemapEnabled": false,
  "feedsEnabled": false
}
```

### Schema: SeoRedirectCreateRequest

| Field             | Type                                                                                     | Required | Nullable | Description                                                                                                                                                                                             |
| ----------------- | ---------------------------------------------------------------------------------------- | -------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sourcePath`      | string                                                                                   | yes      | no       | The source path (path-absolute; normalized before matching/uniqueness).                                                                                                                                 |
| `target`          | string                                                                                   | yes      | no       | A relative same-origin path or an absolute URL to one of this tenant's verified hosts. The target TYPE is derived; any unsafe/cross-host/protocol-relative/CRLF target is rejected by the frozen guard. |
| `localeScope`     | string                                                                                   | no       | yes      |                                                                                                                                                                                                         |
| `domainScopeHost` | string                                                                                   | no       | yes      | Must be one of this tenant's verified domains, or null.                                                                                                                                                 |
| `statusCode`      | enum(`301`, `302`, `307`, `308`)                                                         | no       | no       |                                                                                                                                                                                                         |
| `state`           | enum(`active`, `inactive`, `archived`)                                                   | no       | no       |                                                                                                                                                                                                         |
| `effectiveFrom`   | string (date-time)                                                                       | no       | yes      |                                                                                                                                                                                                         |
| `effectiveUntil`  | string (date-time)                                                                       | no       | yes      |                                                                                                                                                                                                         |
| `preserveQuery`   | boolean                                                                                  | no       | no       |                                                                                                                                                                                                         |
| `reason`          | string                                                                                   | no       | yes      |                                                                                                                                                                                                         |
| `origin`          | enum(`manual`, `slug_change`, `domain_change`, `locale_change`, `import`, `legacy_blog`) | no       | no       |                                                                                                                                                                                                         |

**Example**

```json
{
  "sourcePath": "string",
  "target": "string",
  "localeScope": "string",
  "domainScopeHost": "tenant.example.com",
  "statusCode": 301,
  "state": "active",
  "effectiveFrom": "2026-01-01T00:00:00.000Z",
  "effectiveUntil": "2026-01-01T00:00:00.000Z",
  "preserveQuery": false,
  "reason": "string",
  "origin": "manual"
}
```

### Schema: SeoRedirectSettings

Per-tenant redirect governance policy (awcms_seo_redirect_settings).

| Field                       | Type                              | Required | Nullable | Description                                                                                                                                                                                                                             |
| --------------------------- | --------------------------------- | -------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `legacyBlogRedirectEnabled` | boolean                           | yes      | no       | INERT in awcms (no /news route family) — retained for parity. When true (and the tenant has a verified primary host) /blog/{tenantCode}... would 301-redirect to the canonical /news... equivalent. Default false = behavior unchanged. |
| `urlChangeAutoPolicy`       | enum(`skip`, `propose`, `create`) | yes      | no       | Default action when a URL change is captured. 'propose' (default) creates an INACTIVE rule for operator review; 'create' activates immediately; 'skip' does nothing.                                                                    |

**Example**

```json
{
  "legacyBlogRedirectEnabled": false,
  "urlChangeAutoPolicy": "skip"
}
```

### Schema: SeoRedirectUpdateRequest

Update the mutable fields (source path is immutable — supplied only at create).

| Field             | Type                                   | Required | Nullable | Description |
| ----------------- | -------------------------------------- | -------- | -------- | ----------- |
| `target`          | string                                 | yes      | no       |             |
| `localeScope`     | string                                 | no       | yes      |             |
| `domainScopeHost` | string                                 | no       | yes      |             |
| `statusCode`      | enum(`301`, `302`, `307`, `308`)       | no       | no       |             |
| `state`           | enum(`active`, `inactive`, `archived`) | no       | no       |             |
| `effectiveFrom`   | string (date-time)                     | no       | yes      |             |
| `effectiveUntil`  | string (date-time)                     | no       | yes      |             |
| `preserveQuery`   | boolean                                | no       | no       |             |
| `reason`          | string                                 | no       | yes      |             |

**Example**

```json
{
  "target": "string",
  "localeScope": "string",
  "domainScopeHost": "tenant.example.com",
  "statusCode": 301,
  "state": "active",
  "effectiveFrom": "2026-01-01T00:00:00.000Z",
  "effectiveUntil": "2026-01-01T00:00:00.000Z",
  "preserveQuery": false,
  "reason": "string"
}
```

### Schema: SiteSearchSettingsUpdateRequest

Every field is optional — an omitted field keeps its current value.

| Field                  | Type            | Required | Nullable | Description |
| ---------------------- | --------------- | -------- | -------- | ----------- |
| `enabled`              | boolean         | no       | no       |             |
| `enabledResourceTypes` | array of string | no       | yes      |             |
| `resultLimit`          | integer         | no       | no       |             |
| `minQueryLength`       | integer         | no       | no       |             |
| `suggestionsEnabled`   | boolean         | no       | no       |             |
| `suggestionLimit`      | integer         | no       | no       |             |
| `analyticsEnabled`     | boolean         | no       | no       |             |

**Example**

```json
{
  "enabled": false,
  "enabledResourceTypes": ["string"],
  "resultLimit": 1,
  "minQueryLength": 1,
  "suggestionsEnabled": false,
  "suggestionLimit": 1,
  "analyticsEnabled": false
}
```

### Schema: SoftDeleteMediaObjectRequest

| Field    | Type   | Required | Nullable | Description                                                                                                                                                                                          |
| -------- | ------ | -------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reason` | string | yes      | no       | Why the object is being removed. Trimmed before length-checking, so a whitespace-only value fails as "required". Written to the audit row, which outlives the object it describes — hence the bound. |

**Example**

```json
{
  "reason": "string"
}
```

### Schema: SubmitCommentRequest

| Field                | Type          | Required | Nullable | Description                                                                                                                                                               |
| -------------------- | ------------- | -------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `body`               | string        | yes      | no       |                                                                                                                                                                           |
| `resourceType`       | string        | no       | no       | Required when submitting to `/api/v1/comments`; implied by the parent on a reply.                                                                                         |
| `resourceId`         | string (uuid) | no       | no       |                                                                                                                                                                           |
| `locale`             | string        | no       | no       |                                                                                                                                                                           |
| `parentId`           | string (uuid) | no       | yes      |                                                                                                                                                                           |
| `authorDisplayName`  | string        | no       | yes      |                                                                                                                                                                           |
| `authorEmail`        | string        | no       | yes      | Never stored raw. Normalized, then persisted only as a sha256 hash plus a masked form for the moderation queue.                                                           |
| `website`            | string        | no       | yes      | The honeypot field. Hidden from human visitors; any non-empty value marks the submission as automated.                                                                    |
| `timingToken`        | string        | no       | yes      | The HMAC-signed token issued when the form was rendered. Supplies the elapsed-time measurement for the anti-abuse timing floor without trusting a client-supplied number. |
| `subscribeToReplies` | boolean       | no       | no       | Opt in to reply notifications. Requires `authorEmail` and the tenant's `notifyOnReply` setting; the address is encrypted at rest and never returned.                      |

**Example**

```json
{
  "body": "string",
  "resourceType": "string",
  "resourceId": "00000000-0000-0000-0000-000000000000",
  "locale": "string",
  "parentId": "00000000-0000-0000-0000-000000000000",
  "authorDisplayName": "string",
  "authorEmail": "user@example.com",
  "website": "string",
  "timingToken": "string",
  "subscribeToReplies": false
}
```

### Schema: ThemeConfigRequest

A tenant's DATA-only theme configuration. Every key/value is validated against the chosen theme descriptor; unknown tokens/slots/assets/sections are rejected, and token values are validated by rejection against strict CSS grammars (no url()/expression()/@import/javascript:/comment-breakout).

| Field            | Type            | Required | Nullable | Description                                                                                                                   |
| ---------------- | --------------- | -------- | -------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `themeKey`       | string          | yes      | no       | A registered (build-time) theme key.                                                                                          |
| `tokenOverrides` | object          | no       | no       | tokenKey -> validated token value (color/dimension/number, or a font-family allow-list key). Unknown token keys are rejected. |
| `slotSelections` | object          | no       | no       | slotKey -> chosen variant key (from the slot's allow-list).                                                                   |
| `assetRefs`      | object          | no       | no       | assetSlotKey -> media object UUID (never a URL); null clears the slot.                                                        |
| `sectionOrder`   | array of string | no       | no       | An ordering of the theme's declared content-section keys.                                                                     |
| `navPlacement`   | string          | no       | no       | One of the theme's declared nav placements.                                                                                   |

**Example**

```json
{
  "themeKey": "string",
  "tokenOverrides": "(operation-specific payload)",
  "slotSelections": "(operation-specific payload)",
  "assetRefs": "(operation-specific payload)",
  "sectionOrder": ["string"],
  "navPlacement": "string"
}
```

### Schema: UpdateTenantDomainRequest

At least one field required. `status` may not be `active` (use verify); `hostname`/`is_primary` are immutable.

| Field                     | Type                                                   | Required | Nullable | Description |
| ------------------------- | ------------------------------------------------------ | -------- | -------- | ----------- |
| `domainType`              | enum(`subdomain`, `custom_domain`)                     | no       | no       |             |
| `routeMode`               | enum(`canonical`, `legacy_blog`)                       | no       | no       |             |
| `status`                  | enum(`pending_verification`, `suspended`, `failed`)    | no       | no       |             |
| `verificationMethod`      | enum(`dns_txt`, `dns_cname`, `file`, `manual`, `null`) | no       | yes      |             |
| `verificationRecordName`  | string                                                 | no       | yes      |             |
| `verificationRecordValue` | string                                                 | no       | yes      |             |
| `redirectToPrimary`       | boolean                                                | no       | no       |             |

**Example**

```json
{
  "domainType": "subdomain",
  "routeMode": "canonical",
  "status": "pending_verification",
  "verificationMethod": "dns_txt",
  "verificationRecordName": "string",
  "verificationRecordValue": "string",
  "redirectToPrimary": false
}
```

### Schema: UserGroupMembershipInput

| Field          | Type          | Required | Nullable | Description |
| -------------- | ------------- | -------- | -------- | ----------- |
| `userGroupId`  | string (uuid) | yes      | no       |             |
| `tenantUserId` | string (uuid) | yes      | no       |             |

**Example**

```json
{
  "userGroupId": "00000000-0000-0000-0000-000000000000",
  "tenantUserId": "00000000-0000-0000-0000-000000000000"
}
```

## Domain events

Every channel below carries the SAME message envelope (`DomainEvent` /
`DomainEventEnvelope`) — documented once here instead of once per channel.
Producer direction is always `send` (this repo publishes events; there is no
consumer/subscriber contract in this file).

### Event envelope

| Field           | Type   | Required | Description |
| --------------- | ------ | -------- | ----------- |
| `eventId`       | string | yes      |             |
| `eventType`     | string | yes      |             |
| `eventVersion`  | string | yes      |             |
| `tenantId`      | string | yes      |             |
| `nodeId`        | string | no       |             |
| `aggregateType` | string | yes      |             |
| `aggregateId`   | string | yes      |             |
| `occurredAt`    | string | yes      |             |
| `actor`         | object | no       |             |
| `correlationId` | string | no       |             |
| `causationId`   | string | no       |             |
| `payload`       | object | yes      |             |
| `metadata`      | object | yes      |             |

**Message headers** (HMAC-signed, same scheme as Sync Storage requests):
`X-AWCMS-Node-ID`, `X-AWCMS-Timestamp`, `X-AWCMS-Signature`.

**Example**

```json
{
  "eventId": "00000000-0000-0000-0000-000000000000",
  "eventType": "string",
  "eventVersion": "string",
  "tenantId": "00000000-0000-0000-0000-000000000000",
  "nodeId": "00000000-0000-0000-0000-000000000000",
  "aggregateType": "string",
  "aggregateId": "string",
  "occurredAt": "2026-01-01T00:00:00.000Z",
  "actor": {
    "tenantUserId": "00000000-0000-0000-0000-000000000000",
    "profileId": "00000000-0000-0000-0000-000000000000"
  },
  "correlationId": "string",
  "causationId": "string",
  "payload": null,
  "metadata": {
    "sourceModule": "string",
    "schemaVersion": "string"
  }
}
```

### Channels (44)

- `awcms.blog-content.ad.created` — An advertisement was created. Documented contract only; producer is `pages/api/v1/blog/ads/index.ts`'s `blog-content.ad.created` log line.
- `awcms.blog-content.ad.deleted` — An advertisement was soft-deleted. Documented contract only; producer is `pages/api/v1/blog/ads/[id].ts`'s `blog-content.ad.deleted` log line.
- `awcms.blog-content.ad.updated` — An advertisement (or its placements) was updated. Documented contract only; producer is `pages/api/v1/blog/ads/[id].ts`'s `blog-content.ad.updated` log line.
- `awcms.blog-content.internal-tag-linking-policy.updated` — A tenant's automatic internal tag linking policy was updated. Documented contract only; producer is `pages/api/v1/blog/internal-tag-links/settings.ts`'s `blog-content.internal-tag-linking-policy.updated` log line.
- `awcms.blog-content.menu.created` — A navigation menu was created. Documented contract only; producer is `pages/api/v1/blog/menus/index.ts`'s `blog-content.menu.created` log line.
- `awcms.blog-content.menu.deleted` — A navigation menu was soft-deleted. Documented contract only; producer is `pages/api/v1/blog/menus/[id].ts`'s `blog-content.menu.deleted` log line.
- `awcms.blog-content.menu.updated` — A navigation menu (or its items tree) was updated. Documented contract only; producer is `pages/api/v1/blog/menus/[id].ts`'s `blog-content.menu.updated` log line.
- `awcms.blog-content.post.archived` — A blog post was archived. Documented contract only; producer is `pages/api/v1/blog/posts/[id]/archive.ts`'s `blog-content.post.archived` log line.
- `awcms.blog-content.post.created` — A blog post was created (draft). Ported from awcms-mini. Documented contract only, same structured-logger-producer convention as `awcms.email.*` above; producer is `pages/api/v1/blog/posts/index.ts`'s `blog-content.post.created` log line.
- `awcms.blog-content.post.deleted` — A blog post was soft-deleted. Documented contract only; producer is `pages/api/v1/blog/posts/[id].ts`'s `blog-content.post.deleted` log line.
- `awcms.blog-content.post.published` — A blog post was published (manually or by the scheduled-publish job). Documented contract only; producer is `pages/api/v1/blog/posts/[id]/publish.ts` / `application/blog-scheduled-publish.ts`'s `blog-content.post.published` log line.
- `awcms.blog-content.post.purged` — A soft-deleted blog post was permanently purged. Documented contract only; producer is `pages/api/v1/blog/posts/[id]/purge.ts`'s `blog-content.post.purged` log line.
- `awcms.blog-content.post.restored` — A soft-deleted blog post was restored. Documented contract only; producer is `pages/api/v1/blog/posts/[id]/restore.ts`'s `blog-content.post.restored` log line.
- `awcms.blog-content.post.scheduled` — A blog post was scheduled for future publishing. Documented contract only; producer is `pages/api/v1/blog/posts/[id]/schedule.ts`'s `blog-content.post.scheduled` log line.
- `awcms.blog-content.post.submitted-for-review` — A blog post transitioned draft -> review. Documented contract only; producer is `pages/api/v1/blog/posts/[id]/submit-review.ts`'s `blog-content.post.submitted-for-review` log line.
- `awcms.blog-content.post.updated` — A blog post was updated. Documented contract only; producer is `pages/api/v1/blog/posts/[id].ts`'s `blog-content.post.updated` log line.
- `awcms.blog-content.revision.created` — An append-only revision snapshot was created for a post/page (a significant content change, or a revision restore). Documented contract only; producer is `application/blog-revision-directory.ts`'s `blog-content.revision.created` log line.
- `awcms.blog-content.settings.updated` — A tenant's blog settings were updated. Documented contract only; producer is `pages/api/v1/blog/settings/index.ts`'s `blog-content.settings.updated` log line.
- `awcms.blog-content.template.created` — A presentation template was created. Documented contract only; producer is `pages/api/v1/blog/templates/index.ts`'s `blog-content.template.created` log line.
- `awcms.blog-content.template.deleted` — A presentation template was soft-deleted. Documented contract only; producer is `pages/api/v1/blog/templates/[id].ts`'s `blog-content.template.deleted` log line.
- `awcms.blog-content.template.updated` — A presentation template was updated. Documented contract only; producer is `pages/api/v1/blog/templates/[id].ts`'s `blog-content.template.updated` log line.
- `awcms.blog-content.term.created` — A blog category/tag was created. Documented contract only; producer is `pages/api/v1/blog/terms/index.ts`'s `blog-content.term.created` log line.
- `awcms.blog-content.term.updated` — A blog category/tag was updated or soft-deleted. Documented contract only; producer is `pages/api/v1/blog/terms/[id].ts`'s `blog-content.term.updated` log line.
- `awcms.blog-content.theme.updated` — A tenant's blog theme mode override was updated. Documented contract only; producer is `pages/api/v1/blog/theme/index.ts`'s `blog-content.theme.updated` log line.
- `awcms.blog-content.widget.created` — A widget was created. Documented contract only; producer is `pages/api/v1/blog/widgets/index.ts`'s `blog-content.widget.created` log line.
- `awcms.blog-content.widget.deleted` — A widget was soft-deleted. Documented contract only; producer is `pages/api/v1/blog/widgets/[id].ts`'s `blog-content.widget.deleted` log line.
- `awcms.blog-content.widget.updated` — A widget was updated. Documented contract only; producer is `pages/api/v1/blog/widgets/[id].ts`'s `blog-content.widget.updated` log line.
- `awcms.comments.comment.approved` — A comment became publicly visible, either by auto-approval under the thread policy or by a moderator's approve decision. Producers: `comments/application/comment-service.ts`'s `submitComment` and `comments/application/comment-moderation.ts`'s `moderateComment`. The reply-notification consumer keys off THIS event rather than `comment.submitted`, so a comment still held for moderation never triggers a notification.
- `awcms.comments.comment.submitted` — A comment was submitted against a published, public commentable resource (ADR-0041). Producer: `comments/application/comment-service.ts`'s `submitComment`. The payload carries opaque references only — comment and thread id, resource type, the server-derived public URL, and the resulting status. Never the body text, the author address, or any identity hash.
- `awcms.comments.reply.created` — A submitted comment was a reply to an existing comment. Producer: `comments/application/comment-service.ts`'s `submitComment`, published alongside `comment.submitted` so a consumer can distinguish thread replies without re-reading the row. The recipient address is resolved from encrypted storage by the dispatcher at send time and is never carried here.
- `awcms.domain-event-runtime.sample.recorded` — Reference/example event used to exercise the domain-event-runtime outbox, dispatcher, ordering, retry/backoff, dead-letter, and replay mechanism end-to-end. Real producer modules publish their OWN event types the same way, via `appendDomainEvent` — this one is intentionally self-contained rather than tied to another module's business logic in this foundation module (see `src/modules/domain-event-runtime/domain/event-type-registry.ts`'s own doc comment). Producer: any caller of `application/append-domain-event.ts`'s `appendDomainEvent` for this event type; consumers: `infrastructure/consumer-registry.ts`'s two reference consumers (a same-process cross-module audit projector and a self-contained read-model activity-rollup projection).
- `awcms.email.message.cancelled` — An operator cancelled a still-queued message (`POST /api/v1/email/messages/{id}/cancel`) before dispatch. Documented contract only; producer is the structured JSON logger (`pages/api/v1/email/messages/[id]/cancel.ts`'s `email.message.cancelled` log line).
- `awcms.email.message.failed` — The email dispatcher exhausted retries (or hit a non-retryable failure) for a queued message. Documented contract only; producer is the structured JSON logger (`email/application/email-dispatch.ts`'s `email.dispatch.failed` log line).
- `awcms.email.message.queued` — An email message was enqueued into `awcms_email_messages`. Documented contract only, same convention as `database.pool.saturated` — the concrete producer is the structured JSON logger, invoked from `email/application/announcement-directory.ts`'s `enqueueAnnouncement` (`email.message.queued` log line).
- `awcms.email.message.sent` — The email dispatcher (`bun run email:dispatch`) delivered a message through the configured provider. Documented contract only; producer is the structured JSON logger (`email/application/email-dispatch.ts`'s `email.dispatch.sent` log line).
- `awcms.email.message.suppressed` — The email dispatcher found a claimed message's recipient newly present on `awcms_email_suppression_list` (added after enqueue, before dispatch) and skipped the provider call entirely. Documented contract only; producer is the structured JSON logger (`email/application/email-dispatch.ts`'s `email.dispatch.suppressed` log line).
- `awcms.workflow.delegation.created` — A workflow delegation/substitute assignment was created. Producer: `workflow-approval/application/workflow-delegation-directory.ts`'s `createWorkflowDelegation`.
- `awcms.workflow.delegation.revoked` — A workflow delegation/substitute assignment was revoked. Producer: `workflow-approval/application/workflow-delegation-directory.ts`'s `revokeWorkflowDelegation`.
- `awcms.workflow.instance.advanced` — A workflow instance's active task was decided (or force-decided) and the instance advanced to its next node(s), without yet reaching a terminal outcome. Producer: `workflow-approval/application/workflow-instance-decision.ts`'s `completeApprovalTaskAndAdvance`.
- `awcms.workflow.instance.approved` — A workflow instance reached an `end` node with outcome `approved`. Producer: `workflow-approval/application/workflow-instance.ts` / `workflow-instance-decision.ts`.
- `awcms.workflow.instance.cancelled` — An administrator cancelled a running workflow instance. Producer: `workflow-approval/application/workflow-recovery.ts`'s `cancelWorkflowInstance`, via `POST /api/v1/workflows/instances/{id}/cancel`.
- `awcms.workflow.instance.rejected` — A workflow instance reached an `end` node with outcome `rejected`, or was force-rejected. Producer: `workflow-approval/application/workflow-instance.ts` / `workflow-instance-decision.ts`.
- `awcms.workflow.instance.started` — A workflow instance was started, pinned to the currently-active workflow definition version. Producer: `workflow-approval/application/workflow-instance.ts`'s `startWorkflowInstance`, via `appendDomainEvent` in the same transaction as the instance's creation.
- `awcms.workflow.task.escalated` — A pending workflow task passed its due date and was escalated by the scheduled escalation/timeout job. Producer: `workflow-approval/application/workflow-escalation.ts`'s `escalateDueTasksForTenant`, run via `bun run workflow:escalations:dispatch`.

## Compatibility & deprecation policy

Contract changes follow ADR-0008's SemVer rules (independent of the package
release version):

- **PATCH** — description/documentation-only fixes, no schema change.
- **MINOR** — additive, backward-compatible changes (new endpoint/event, new
  optional field/parameter).
- **MAJOR** — breaking changes (removed/renamed field or endpoint, changed
  response shape).

See [`docs/adr/0008-independent-contract-and-module-versioning.md`](../adr/0008-independent-contract-and-module-versioning.md)
for the full policy.

**Currently deprecated** (derived from `deprecated: true` on any operation,
schema, or event channel in the bundled contracts):

- REST: `POST /api/v1/blog/ads` (`blogCreateAd`)
- REST: `PATCH /api/v1/blog/ads/{id}` (`blogUpdateAd`)
