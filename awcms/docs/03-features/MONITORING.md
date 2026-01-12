# Monitoring and Observability

## Purpose
Describe the monitoring tools and logging practices for AWCMS.

## Audience
- Operators and SREs
- Developers adding telemetry

## Prerequisites
- `awcms/docs/03-features/AUDIT_TRAIL.md`

## Core Concepts

- Audit logs capture critical actions.
- Edge functions should log failures and context.
- Cloudflare Pages provides build and runtime logs.

## How It Works

- Audit logs are stored in `audit_logs`.
- Extension logs are stored in `extension_logs`.

## Implementation Patterns

- Use `useAuditLog()` and `useExtensionAudit()` hooks.

## Security and Compliance Notes

- Do not log secrets or access tokens.

## References

- `../03-features/AUDIT_TRAIL.md`
- `../00-core/SECURITY.md`
