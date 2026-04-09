> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) -> [AGENTS.md](../../AGENTS.md) -> [README.md](../../README.md) -> [DOCS_INDEX.md](../../DOCS_INDEX.md)
>
> **Status:** Maintained
>
> **Last Refreshed:** 2026-04-09

# Scalability Guide

## Purpose

Summarize the current scalability model for AWCMS across public delivery, admin runtime behavior, tenant isolation, analytics/event volume, and Worker-backed async offload.

## Current Scalability Model

AWCMS scalability currently comes from a combination of:

- static-first public delivery
- stateless client applications
- Supabase-managed PostgreSQL/Auth scaling
- Cloudflare Worker and Queue runtime offload
- indexed tenant-aware query patterns
- aggregate/rollup use for high-volume analytics-style surfaces

## Current Public Scalability Model

Current public scalability is driven primarily by:

- static Astro builds where appropriate
- Cloudflare Pages asset/CDN delivery
- limited purposeful island hydration
- avoiding runtime-heavy public fetch paths when build-time content can be used

## Current Admin Scalability Model

The admin app remains a browser SPA with tenant-scoped query patterns.

Current practical rules:

- keep reads paginated and filtered
- avoid broad cross-tenant or unfiltered data loads
- use aggregate/summary views for dashboards where available

## Current Data / Query Scalability Guidance

- keep `tenant_id` and high-volume filter columns indexed
- prefer aggregate tables/views for monitoring-style dashboards
- avoid full scans of large raw event tables such as analytics/event logs in ordinary UI paths
- keep deleted/public/tenant filters explicit so scaling improvements do not widen scope accidentally

## Current Async / Queue Scalability Guidance

Current runtime already uses queues for appropriate async work.

Current practical rule:

- if a flow is already queue-backed or can safely be offloaded through the maintained Worker/Queue pattern, prefer that over pushing more synchronous work into client request paths

## Current Tenant-Isolation Rule Under Scale

Scalability optimizations must not weaken tenant isolation.

Current important rules:

- do not cache data across tenants unintentionally
- do not widen query scope in the name of performance
- do not trade ABAC/RLS safety for throughput shortcuts

## Current Analytics / Monitoring Note

Scalable observability currently depends on the distinction between raw and aggregated surfaces.

Current practical examples:

- prefer `analytics_daily` or equivalent aggregate sources for dashboards
- use audit/event/raw tables carefully and with filters/indexes

## Validation Guidance

| Surface | Validation |
| --- | --- |
| maintained docs | `cd awcms && npm run docs:check` |
| runtime changes affecting scalability paths | validate the touched workspace(s) and related edge/public checks as appropriate |

## Related Docs

- [docs/modules/PERFORMANCE.md](./PERFORMANCE.md)
- [docs/architecture/overview.md](../architecture/overview.md)
- [docs/architecture/runtime-boundaries.md](../architecture/runtime-boundaries.md)
