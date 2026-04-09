> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) -> [AGENTS.md](../../AGENTS.md) -> [README.md](../../README.md) -> [DOCS_INDEX.md](../../DOCS_INDEX.md)
>
> **Status:** Maintained
>
> **Last Refreshed:** 2026-04-09

# Monitoring and Observability

## Purpose

Describe the current monitoring and observability model for AWCMS across audit history, Worker/runtime failures, notification dispatch history, queue dead letters, and analytics surfaces.

## Current Observability Model

AWCMS currently uses several complementary observability surfaces rather than a single metrics stack.

Current important surfaces include:

- `audit_logs`
- `extension_lifecycle_audit`
- `notification_dispatches`
- `queue_dead_letters`
- analytics/event tables such as `analytics_events` and `analytics_daily`
- Cloudflare Worker logs and platform-level deploy/runtime logs

## Current Runtime Logging Model

Current practical split:

- business/security/accountability history -> database-backed audit/history tables
- Worker runtime failures and request-path diagnostics -> Worker logging plus related operational tables where persisted
- deployment/build/runtime platform logs -> Cloudflare Pages/Workers platform logs

## Current Worker/Queue Observability

Current edge operational visibility includes:

- request/route failure visibility in the Worker runtime
- queue dead-letter capture in `queue_dead_letters`
- replay-oriented operational flows for dead-letter handling

Current important rule:

- queue dead-letter behavior is part of the current operational observability model, not just an implementation detail of a single queue consumer

## Current Notification Observability

Notification operations now have an explicit dispatch-history surface.

Current important note:

- `notification_dispatches` belongs to the monitoring/operational story and should be treated as a first-class observability surface for notification delivery outcomes

## Current Analytics Observability

Current analytics visibility remains split between:

- raw or near-raw event capture (`analytics_events`)
- aggregate/rollup-style reporting (`analytics_daily`)

Current guidance:

- dashboards should prefer aggregate/filtered queries over unbounded raw-event scans

## Current Admin/Hook Surfaces

Current admin-facing observability hooks and adjacent helpers include:

- `useAuditLog()`
- `useExtensionAudit()`
- dashboard statistics helpers such as `useDashboardData()` where applicable

These are consumption surfaces for current observability data, not the only producers.

## Current Security Rules

- do not log secrets or access tokens
- preserve tenant scoping for tenant-bound observability/history tables
- do not imply global visibility where the current permissions/RLS model does not allow it

## Current Performance Rules For Monitoring Data

- prefer indexed/filtered reads for audit and analytics tables
- prefer aggregate summaries for dashboards when possible
- avoid full-table scans of large event tables for ordinary admin widgets/pages

## Validation Guidance

| Surface | Validation |
| --- | --- |
| maintained docs | `cd awcms && npm run docs:check` |
| Worker/queue observability changes | `cd awcms-edge && npm test && npm run typecheck` when relevant |
| migration/monitoring table changes | `scripts/verify_supabase_migration_consistency.sh` plus relevant migration validation |

## Related Docs

- [docs/modules/AUDIT_TRAIL.md](./AUDIT_TRAIL.md)
- [docs/security/overview.md](../security/overview.md)
- [docs/architecture/queue-topology.md](../architecture/queue-topology.md)
- [docs/architecture/database.md](../architecture/database.md)
