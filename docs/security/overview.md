# Security Guide

## Purpose

Describe AWCMS security posture, enforcement points, and operational expectations.

## Audience

- Developers implementing security-sensitive features
- Operators configuring deployments

## Prerequisites

- `docs/architecture/standards.md`
- `docs/tenancy/overview.md`

## Core Concepts

- Zero Trust with ABAC and RLS.
- Tenant isolation at UI, API, and database layers.
- Soft delete lifecycle for all tenant-scoped data.

## How It Works

### OWASP Top 10 Alignment (2021)

| Risk | Implementation |
| --- | --- |
| A01: Broken Access Control | ABAC + RLS + protected routes |
| A02: Cryptographic Failures | Supabase managed encryption at rest |
| A03: Injection (XSS) | TipTap sanitization and DOMPurify |
| A04: Insecure Design | Multi-layer architecture |
| A05: Security Misconfiguration | CSP headers + secure defaults |
| A06: Vulnerable Components | Dependency audits |
| A07: Auth Failures | 2FA + JWT + refresh tokens |
| A08: Software Integrity | Supabase signed tokens |
| A09: Logging Failures | Audit trail + extension logs |
| A10: SSRF | No custom server-side fetch proxies |

### Security Layers

```text
1. Client Layer   - Input validation and XSS-safe rendering
2. Transport      - HTTPS and strict CORS
3. API Layer      - JWT auth + RLS policies
4. Database       - Role-based access + policy enforcement
```

### XSS Prevention

- TipTap data is rendered with controlled JSON-to-React mapping.
- HTML rendering uses `awcms/src/utils/sanitize.js` (DOMPurify).

```javascript
import { sanitizeHTML } from '@/utils/sanitize';

<div dangerouslySetInnerHTML={sanitizeHTML(rawContent)} />
```

### Authorization (ABAC)

```javascript
import { usePermissions } from '@/contexts/PermissionContext';

const { hasPermission } = usePermissions();
if (!hasPermission('tenant.article.update')) {
  return <AccessDenied />;
}
```

### Row Level Security (RLS)

All tenant-scoped tables include `tenant_id` and RLS policies.

```sql
CREATE POLICY "table_select_unified" ON public.table_name
USING (
  tenant_id = current_tenant_id()
  OR auth_is_admin()
);
```

### Tenant Isolation

- Tenant context is injected via `x-tenant-id` in Supabase requests.
- `current_tenant_id()` resolves tenant context in SQL.
- Storage paths are scoped to `{tenant_id}/...`.

### Edge Functions

- All edge functions must validate tenant context and permissions.
- Service role access is allowed only in functions and migrations.

## Implementation Patterns

- Admin enforcement: `awcms/src/contexts/PermissionContext.jsx`
- Tenant context: `awcms/src/contexts/TenantContext.jsx`
- Public tenant resolution: `awcms-public/primary/src/middleware.ts`

## Security and Compliance Notes

- Use `deleted_at` for deletions and filter it on reads.
- Do not bypass RLS unless explicitly implementing platform admin features.
- Supabase is the only backend.

## Operational Concerns

### HTTP Security Headers

Development headers are set in `awcms/vite.config.js`. Production headers must be enforced at the CDN or hosting layer (Cloudflare Pages recommended).

### Secrets Management

- Never commit `.env.local` or service role keys.
- Store production secrets in CI or Cloudflare Pages environment variables.

## Troubleshooting

- Permission denied: check ABAC key, role assignments, and RLS policies.
- Tenant leaks: verify `x-tenant-id` header and tenant filters.

## References

- `docs/security/rls.md`
- `docs/security/abac.md`
- `docs/architecture/database.md`
