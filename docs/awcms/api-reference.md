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

Approves a pending exception (the sanctioned administrative override). Self-approval is denied (re-checked from the DB row). Gated on the dedicated `identity_access.business_scope_exceptions.approve` permission. Requires `Idempotency-Key`; audited at `critical` severity.

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

## Sync Storage

Offline-first sync node registration, HMAC-signed push/pull, conflict tracking, and the object sync upload queue.

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

Direct-to-R2 presigned upload flow for news images (news_portal module, ported from awcms-mini) — create an upload session (server-generated object key + short-lived presigned PUT URL), finalize (real R2 GET + magic-byte MIME sniffing + server-side SHA-256 checksum, never a bare HEAD), and cancel a still-pending_upload session. R2 credentials are never exposed to the browser; only a scoped, expiring presigned URL is returned.

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

## News Portal Homepage Sections

Editorial homepage section composer (news_portal module) — tenant-scoped, RLS-protected CRUD for configurable homepage sections (headline, latest_posts, featured_posts, editor_picks, category_grid, gallery_block). config shape is validated per sectionType server-side; every referenced post/category/media object must already exist for the same tenant (and gallery_block media must be a verified R2 media object). sectionType is immutable after creation; reordering is just a patchable sortOrder field.

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

R2-only advertisement placement presets for the news portal (news_portal module) — tenant-scoped, RLS-protected CRUD for ads assigned to a fixed set of placement keys. mediaObjectId must reference a verified R2 media object belonging to the same tenant — never a local path or arbitrary external image URL. linkUrl is optional and may be external, but is validated server-side as an absolute http(s) URL only.

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

| Field           | Type                                                                                                                                                                                                                             | Required | Nullable | Description |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------- | ----------- |
| `placementKey`  | enum(`header_banner`, `below_headline`, `homepage_middle`, `homepage_bottom`, `article_top`, `article_middle`, `article_bottom`, `sidebar_top`, `sidebar_middle`, `sidebar_bottom`, `category_archive_top`, `search_result_top`) | yes      | no       |             |
| `name`          | string                                                                                                                                                                                                                           | yes      | no       |             |
| `mediaObjectId` | string (uuid)                                                                                                                                                                                                                    | yes      | no       |             |
| `linkUrl`       | string                                                                                                                                                                                                                           | no       | yes      |             |
| `rotationMode`  | enum(`latest`, `priority`, `random_safe`, `weighted`)                                                                                                                                                                            | no       | no       |             |
| `priority`      | integer                                                                                                                                                                                                                          | no       | no       |             |
| `isActive`      | boolean                                                                                                                                                                                                                          | no       | no       |             |
| `startsAt`      | string (date-time)                                                                                                                                                                                                               | no       | yes      |             |
| `endsAt`        | string (date-time)                                                                                                                                                                                                               | no       | yes      |             |

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
  "endsAt": "2026-01-01T00:00:00.000Z"
}
```

### Schema: AdPlacementUpdateRequest

| Field           | Type                                                                                                                                                                                                                             | Required | Nullable | Description |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------- | ----------- |
| `placementKey`  | enum(`header_banner`, `below_headline`, `homepage_middle`, `homepage_bottom`, `article_top`, `article_middle`, `article_bottom`, `sidebar_top`, `sidebar_middle`, `sidebar_bottom`, `category_archive_top`, `search_result_top`) | no       | no       |             |
| `name`          | string                                                                                                                                                                                                                           | no       | no       |             |
| `mediaObjectId` | string (uuid)                                                                                                                                                                                                                    | no       | no       |             |
| `linkUrl`       | string                                                                                                                                                                                                                           | no       | yes      |             |
| `rotationMode`  | enum(`latest`, `priority`, `random_safe`, `weighted`)                                                                                                                                                                            | no       | no       |             |
| `priority`      | integer                                                                                                                                                                                                                          | no       | no       |             |
| `isActive`      | boolean                                                                                                                                                                                                                          | no       | no       |             |
| `startsAt`      | string (date-time)                                                                                                                                                                                                               | no       | yes      |             |
| `endsAt`        | string (date-time)                                                                                                                                                                                                               | no       | yes      |             |

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
  "endsAt": "2026-01-01T00:00:00.000Z"
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

### Channels (41)

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

_None — nothing in the bundled contracts is currently marked deprecated._
