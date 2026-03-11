# Security Guide

> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) Section 2 - Architectural Pillars (Security)

## Purpose

Describe AWCMS security posture, enforcement points, and operational expectations.

## Audience

- Developers implementing security-sensitive features
- Operators configuring deployments

## Prerequisites

- [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) - **Primary authority** for security mandates
- [AGENTS.md](../../AGENTS.md) - Permission patterns and Context7 security references
- [docs/architecture/standards.md](../architecture/standards.md) - Core standards
- [docs/tenancy/overview.md](../tenancy/overview.md) - Tenant isolation

## Core Concepts

- Zero Trust with ABAC and RLS.
- Tenant isolation at UI, API, and database layers.
- Soft delete lifecycle for all tenant-scoped data.
- Rich content import/rendering paths must enforce sanitization before any `set:html`/`dangerouslySetInnerHTML` usage.

## How It Works

### OWASP Top 10 Alignment (2021)

| Risk | Implementation |
| --- | --- |
| A01: Broken Access Control | ABAC + RLS + protected routes |
| A02: Cryptographic Failures | Supabase managed encryption at rest |
| A03: Injection (XSS) | TipTap-safe rendering + admin DOMPurify + public `sanitize-html` for RawHTML fallback |
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

- TipTap data is rendered with controlled editor mappings.
- Admin fallback HTML rendering uses `awcms/src/utils/sanitize.js` (DOMPurify).
- Public fallback HTML rendering uses `awcms-public/primary/src/components/common/puckRendererRawHtml.ts` + `awcms-public/primary/src/utils/sanitize.ts` (`sanitize-html`).

```javascript
import { sanitizeHTML } from '@/utils/sanitize';

<div dangerouslySetInnerHTML={sanitizeHTML(rawContent)} />
```

### Authorization (ABAC)

```javascript
import { usePermissions } from '@/contexts/PermissionContext';

const { hasPermission } = usePermissions();
if (!hasPermission('tenant.blog.update')) {
  return <AccessDenied />;
}
```

### Row Level Security (RLS)

All tenant-scoped tables include `tenant_id` and RLS policies.

```sql
CREATE POLICY "table_select_abac" ON public.table_name
FOR SELECT USING (
  (tenant_id = current_tenant_id() AND has_permission('tenant.module.read'))
  OR auth_is_admin()
);
```

Legacy tables may still use tenant-only select policies and rely on admin UI ABAC checks. New tables should follow the ABAC pattern above.

### Tenant Isolation

- Tenant context is injected via `x-tenant-id` in Supabase requests.
- `current_tenant_id()` resolves tenant context in SQL.
- Storage paths are scoped to `{tenant_id}/...`.
- Public static builds resolve tenant via `PUBLIC_TENANT_ID`, `VITE_PUBLIC_TENANT_ID`, or `VITE_TENANT_ID`.

### Edge Logic

- Cloudflare Workers are the primary edge HTTP layer and must validate tenant context and permissions.
- Privileged access with `SUPABASE_SECRET_KEY` is allowed only in approved server-side edge runtimes, migrations, and trusted operational scripts.

## Implementation Patterns

- Admin enforcement: `awcms/src/contexts/PermissionContext.jsx`
- Tenant context: `awcms/src/contexts/TenantContext.jsx`
- Public tenant resolution: `awcms-public/primary/src/lib/publicTenant.ts` (middleware is SSR-only)

## Security and Compliance Notes

- Use `deleted_at` for deletions and filter it on reads.
- Do not bypass RLS unless explicitly implementing platform admin features.
- Supabase is the system of record; Cloudflare Workers are the primary edge runtime.
- Admin edit/detail routes use signed IDs (`{uuid}.{signature}`); use `encodeRouteParam` and `useSecureRouteParam` for non-guessable URLs.
- Public telemetry (analytics events) must remain tenant-scoped and documented via consent notices.

Example (core routes):

```javascript
import { encodeRouteParam } from '@/lib/routeSecurity';

const handleEdit = async (role) => {
  const routeId = await encodeRouteParam({ value: role.id, scope: 'roles.edit' });
  if (!routeId) return;
  navigate(`/cmspanel/roles/edit/${routeId}`);
};
```

```javascript
import useSecureRouteParam from '@/hooks/useSecureRouteParam';
import { useParams } from 'react-router-dom';

const RoleEditor = () => {
  const { id: routeParam } = useParams();
  const { value: roleId } = useSecureRouteParam(routeParam, 'roles.edit');
  // roleId is decoded UUID or null
};
```

- Analytics events include IP address, page path, referrer, user agent, and geo headers; treat these as personal data and apply retention policies.
- Admin-only profile metadata is encrypted at rest in `user_profile_admin` via pgcrypto and accessed only through RPC.

## Operational Concerns

### HTTP Security Headers

Development headers are set in `awcms/vite.config.js`. Production headers must be enforced at the CDN or hosting layer (Cloudflare Pages recommended).

### Secrets Management

- Never commit `.env.local` or `SUPABASE_SECRET_KEY` values.
- Store production secrets in CI or Cloudflare Pages environment variables.

### Migration Hygiene

- Author timestamped migrations in `supabase/migrations/`.
- Mirror each migration into `awcms/supabase/migrations/` for CI parity.
- Keep non-migration SQL in `supabase/manual/`.
- Use `scripts/repair_supabase_migration_history.sh` when migration history drifts.
- Run `scripts/verify_supabase_migration_consistency.sh` before PR merge.

## Troubleshooting

- Permission denied: check ABAC key, role assignments, and RLS policies.
- Tenant leaks: verify `x-tenant-id` header and tenant filters.

## References

- `docs/security/rls.md`
- `docs/security/abac.md`
- `docs/architecture/database.md`
