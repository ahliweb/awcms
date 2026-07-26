---
"awcms": minor
---

Close the authorization chokepoint: `defineTenantRoute` + `api:tenant-route:check`.

The auth/tenant opening that 204 route files copy verbatim now lives once in
`src/modules/_shared/tenant-route.ts`. `workClass` is REQUIRED in the factory
type with no default — 176 of those 204 files pass none today, so they share
login's pool budget by omission rather than by decision.

The four `/api/v1/reports/*` routes are migrated. They had hand-rolled the guard
chain and called `evaluateAccess` with three arguments of five, which skipped
`resolveModuleEnabled` and dynamic ABAC entirely: a tenant that disabled
`reporting` was still served, and a `deny` policy authored through
`/api/v1/access/policies` was silently inert. Both are now enforced, so those
endpoints newly return `403 MODULE_DISABLED` when the module is off and honour
ABAC. They also accept a session cookie as well as a bearer token, because
`resolveAuthInputs` reads both.

`bun run api:tenant-route:check` rejects any NEW route that calls `withTenant`
directly. The 204 pre-existing routes are listed in a `NOT_YET_MIGRATED` ledger
that can only shrink: a stale entry fails the gate too.
