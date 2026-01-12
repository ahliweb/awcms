# Public URL Migration Guide

## Purpose
Explain the current public portal URL resolution and legacy behavior.

## Audience
- Developers updating routing
- Operators managing tenant domains

## Prerequisites
- `awcms/docs/03-features/PUBLIC_PORTAL_ARCHITECTURE.md`

## Steps

### Current URL Behavior

- Path-based tenant resolution is primary: `/{tenant}/{slug}`.
- Host-based resolution is supported for legacy domains and served at root paths.
- No automatic redirects are applied by middleware.

### Examples

```text
/primary/                 -> path-based tenant
/primary/articles         -> path-based tenant
/about                    -> host-based tenant
/articles/news-post       -> host-based tenant
```

### Tenant Resolution Order

1. Path slug via `get_tenant_by_slug`.
2. Host fallback via `get_tenant_id_by_host`.

## Verification

- Confirm both `/primary/...` and host-based routes resolve to the same tenant.
- Validate `locals.tenant_source` in middleware logs.

## Troubleshooting

- 404 responses: verify tenant slug and host mapping.
- Missing tenant context: check `awcms-public/primary/src/middleware.ts`.

## References

- `../03-features/PUBLIC_PORTAL_ARCHITECTURE.md`
- `../00-core/MULTI_TENANCY.md`
