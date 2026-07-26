---
"awcms": minor
---

Make route ownership derivable: `ModuleApiContract.routes` and
`modules:routes:check`.

`basePath` was the only ownership claim a descriptor could make, and
`tenant_admin` declared `basePath: "/api/v1"` — a prefix of every route in the
application. Resolving a route to its longest-matching `basePath` handed
`tenant_admin` 36 routes it does not own (all of
`/api/v1/{access,roles,users,abac,identity}`, which are `identity_access`, plus
`/api/v1/tenant/modules`, which is `module_management`), while 30 public routes
matched nothing at all.

`api.routes` is a list of owned prefixes, longest-prefix wins — because
ownership genuinely is not one prefix: `/api/v1/tenant` is split between
`tenant_domain` and `module_management`, and public surfaces (`/blog`,
`/robots.txt`, `/search`, `/theming`, `/login`) belong to modules too.

`bun run modules:routes:check` (check chain + `ci.yml`) requires every file
under `src/pages` outside `/admin/**` to resolve to exactly one module or be
named in a reviewed `PLATFORM_ROUTES` allow-list. It also rejects `/`, `/api`
and `/api/v1` as claims outright — a coverage-only rule cannot see them, since a
prefix matching everything leaves nothing uncovered.

`MODULE_CONTRACT_VERSION` 2.3.0 -> 2.4.0 (additive; `routes` omitted means
`[basePath]`). `openapi_documented` readiness now checks every owned prefix
rather than the display `basePath`, which for `tenant_admin` had been matching
any path at all.
