> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) -> [AGENTS.md](../../AGENTS.md) -> [README.md](../../README.md) -> [DOCS_INDEX.md](../../DOCS_INDEX.md)
>
> **Status:** Maintained
>
> **Last Refreshed:** 2026-04-09

# Performance Guide

## Purpose

Summarize the current performance model in AWCMS across admin shell loading, public rendering, data caching, and query/observability behavior.

## Current Performance Model

Current performance strategy is practical and layered rather than based on a single framework feature.

Current important themes include:

- route-level code splitting in the admin shell
- static-first public rendering where possible
- client-side caching through the current data utility layer where applicable
- aggregate/filtered reads for dashboards and observability surfaces
- keeping tenant/public/auth guardrails intact while optimizing

## Current Admin Performance Model

Current admin shell behavior still relies on patterns such as:

- `React.lazy` code splitting in the router/shell
- component/hook-level fetching patterns
- current shared data helpers/utilities where adopted

Current important note:

- the admin shell is still primarily `BrowserRouter` + component-driven data loading, not a full route-loader-first architecture

## Current Client Caching Model

`UnifiedDataManager` remains a current client-side caching utility in relevant surfaces.

Current practical guidance:

- use it where the existing data flow already expects it
- keep cache invalidation aligned with writes
- keep cache scope tenant-safe

Do not document client caching as an excuse to widen trust boundaries or cache cross-tenant data.

## Current Public Performance Model

Current public performance is driven primarily by:

- Astro static output
- build-time data fetching
- limited purposeful React island hydration
- allow-list-driven render paths for visual content/widgets

Current important rule:

- public performance work must not weaken published-only, non-deleted, or tenant-scoped rendering rules

## Current Query Performance Guidance

- prefer filtered/index-friendly queries
- prefer aggregate tables or summarized hooks for dashboard/reporting views
- avoid full scans of raw analytics/audit/event tables in ordinary UI paths
- keep explicit tenant and deleted filters so optimization does not widen scope accidentally

## Current Worker / Operational Performance Guidance

- use queues for async offload where the current runtime already does so
- prefer normalized route validation before expensive downstream work
- keep documented route/OpenAPI metadata in sync when contract changes affect operational behavior

## Current React/Router Guidance

Current repo direction still allows future loader-oriented improvements, but the checked-in admin app is not yet primarily route-loader-driven.

Current rule:

- optimize within the current shell architecture unless the task explicitly includes a route-loader migration

## Current Safety Rules

- performance optimizations must not bypass ABAC or RLS
- do not trade away tenant isolation for cache or query shortcuts
- do not cache protected data across tenants/users
- do not widen public route/media behavior in the name of performance

## Validation Guidance

| Surface | Validation |
| --- | --- |
| admin performance-related changes | `cd awcms && npm run build` |
| public performance-related changes | `cd awcms-public/primary && npm run check:astro` when relevant |
| Worker/runtime implications | `cd awcms-edge && npm test && npm run typecheck` when relevant |
| maintained docs | `cd awcms && npm run docs:check` |

## Related Docs

- [docs/architecture/overview.md](../architecture/overview.md)
- [docs/modules/SCALABILITY_GUIDE.md](./SCALABILITY_GUIDE.md)
- [docs/dev/testing.md](../dev/testing.md)
