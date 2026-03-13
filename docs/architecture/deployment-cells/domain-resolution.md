# Deployment Cells — Domain Resolution

Describes the hostname-to-tenant resolution algorithm used by the AWCMS runtime.

**Spec reference:** §10 Domain Resolution Contract

---

## How Resolution Works

All traffic is resolved through a single DB RPC: `resolve_tenant_by_hostname(p_hostname)`.

### Algorithm (§10.2)

1. Normalize hostname: lowercase, trim whitespace.
2. Query `tenant_domains` for an exact hostname match.
3. Apply active-domain filters:
   - `verification_status = 'verified'`
   - `active_from <= now()` (or NULL)
   - `active_to > now()` (or NULL)
4. Join `tenants_control` — reject if `status != 'active'`.
5. Join `deployment_cells` — reject if `status != 'active'`.
6. Return the full context object including `domain_kind`.
7. Derive `routeClass` from `domain_kind` (client-side, in `routeClass.js`).

### Failure Responses (§10.3)

| Scenario | Behavior |
|---|---|
| Unknown hostname | `null` → show 404 / fallback landing page |
| Inactive tenant | `null` → show suspension policy |
| Inactive cell | `null` → show maintenance page |
| Verified mismatch | `null` → block routing |

### Route Class Mapping (§10.4)

| `domain_kind` | `routeClass` |
|---|---|
| `platform_subdomain` | `public` |
| `custom_domain` | `public` |
| `admin_domain` | `admin` |
| `api_domain` | `api` |
| `cdn_domain` | `cdn` |
| `preview_domain` | `preview` |

---

## Dev Mode

In `localhost` / `127.0.0.1`, `TenantContext.jsx` skips hostname lookup and uses `VITE_DEV_TENANT_SLUG` (defaults to `'primary'`) to simulate a known hostname.

---

## Key Files

- `src/lib/tenancy/resolveTenant.js` — `resolveTenantByHostname()`
- `src/lib/tenancy/routeClass.js` — `deriveRouteClass()`
- `supabase/migrations/20260313000400_create_tenant_domains.sql` — DB schema
- `supabase/migrations/20260313000700_add_deployment_cell_helper_functions.sql` — RPC
