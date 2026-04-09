> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) -> [AGENTS.md](../../AGENTS.md) -> [README.md](../../README.md) -> [DOCS_INDEX.md](../../DOCS_INDEX.md)
>
> **Status:** Maintained
>
> **Last Refreshed:** 2026-04-09

# Audit Trail System

## Purpose

Document the current audit-trail model in AWCMS across business audit logs, extension lifecycle auditing, and related operational event history.

This is a current-state guide, not a promise that every historical table or trigger pattern is still the preferred path for new work.

## Current Audit Model

AWCMS currently uses multiple audit/event-history surfaces rather than a single all-purpose log.

Current important audit families include:

- `audit_logs` for business and operational accountability events
- `extension_lifecycle_audit` for extension lifecycle activity
- feature-specific audit-style tables such as SSO/2FA audit logs where applicable
- queue/dead-letter and notification dispatch history for operational troubleshooting

## Current `audit_logs` Role

`audit_logs` remains the main cross-cutting application audit surface.

Current important fields/concepts still include:

- tenant scope
- acting user
- action name
- resource/table identifier
- details payload
- request/context metadata where available
- event timestamp

## Current Audit Semantics

Audit events should still answer the practical questions:

- who acted
- what happened
- which resource/surface was involved
- when it happened
- which tenant/channel/context applied

Current guidance:

- action names should be meaningful and normalized
- details payloads should be useful for review/debugging without leaking secrets

## Current Write Patterns

Audit writes currently happen through a combination of:

- database-side helpers/triggers for selected lifecycle events
- explicit server-side inserts from Worker/admin flows where the operation is orchestration-heavy
- feature-specific audit hooks and operational event writers

That means new work should follow the existing audited flow for the surface being changed instead of assuming one trigger function covers everything.

## Current UI And Hook Surfaces

Current admin/runtime audit-related helpers include:

- `useAuditLog()` for audit log consumption
- `useExtensionAudit()` for extension-oriented audit surfaces

Audit-style history may also surface indirectly through:

- notification dispatch logs
- queue dead-letter inspection/replay tooling
- feature-specific history views

## Current Extension Audit Note

Extension lifecycle events now have a canonical audit destination in `extension_lifecycle_audit`.

Current important rule:

- extension lifecycle history should be documented against the canonical lifecycle audit table rather than older ad hoc `extension_logs` assumptions

## Current RLS / Access Expectations

- audit/history tables remain scoped and protected
- tenant-scoped audit reads must preserve tenant isolation
- platform/global audit visibility is an explicit privileged behavior, not a default client-side assumption
- admin UI permissions still gate visibility where the feature requires it

## Current Data-Handling Rules

- do not log secrets, tokens, passwords, or equivalent sensitive values
- details payloads should be filtered/sanitized when necessary
- soft-delete lifecycle context may appear in audit history, but the audit record itself is not just a copy of business lifecycle logic

## Current Operational Audit Surfaces

In the current repo, operational observability also includes adjacent history surfaces such as:

- `queue_dead_letters`
- `notification_dispatches`
- extension lifecycle history

These should be documented as complementary operational history, not all collapsed into `audit_logs`.

## Current Retention Guidance

Retention/cleanup policy should follow the live operational and compliance expectations of the deployed environment.

Do not treat an old fixed-day deletion snippet as the authoritative policy without checking the latest migrations/ops guidance.

## Validation Guidance

| Surface | Validation |
| --- | --- |
| maintained docs | `cd awcms && npm run docs:check` |
| Worker/audit route implications | `cd awcms-edge && npm test && npm run typecheck` when relevant |
| migration/audit-policy changes | `scripts/verify_supabase_migration_consistency.sh` plus relevant migration validation |

## Related Docs

- [docs/security/overview.md](../security/overview.md)
- [docs/security/abac.md](../security/abac.md)
- [docs/modules/MONITORING.md](./MONITORING.md)
- [docs/architecture/database.md](../architecture/database.md)
