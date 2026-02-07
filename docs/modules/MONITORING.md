> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) Section 2 (Data Integrity)

# Monitoring and Observability

## Purpose

Describe the monitoring tools and logging practices for AWCMS.

## Audience

- Operators and SREs
- Developers adding telemetry

## Prerequisites

- [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) - **Primary authority** for monitoring and observability
- [AGENTS.md](../../AGENTS.md) - Implementation patterns and Context7 references
- `docs/modules/AUDIT_TRAIL.md`

## Core Concepts

- Audit logs capture critical actions.
- Edge functions should log failures and context.
- Cloudflare Pages provides build and runtime logs.
- Visitor analytics are stored in `analytics_events` with daily rollups in `analytics_daily`.

## How It Works

- Audit logs are stored in `audit_logs`.
- Extension logs are stored in `extension_logs`.
- Visitor telemetry is stored in `analytics_events` (raw) and `analytics_daily` (aggregate).

## Implementation Patterns

- Use `useAuditLog()` and `useExtensionAudit()` hooks.
- Prefer aggregated analytics queries for dashboards to avoid full scans of `analytics_events`.

## Security and Compliance Notes

- Do not log secrets or access tokens.

## References

- `docs/modules/AUDIT_TRAIL.md`
- `docs/security/overview.md`
