# Role Hierarchy (ABAC Framework)

## Purpose

Define the *default* role definitions and hierarchy used by AWCMS.
> **Note:** With the ABAC system, "Hierarchy" is conceptual. In practice, roles are mutable collections of permissions. An "Editor" could theoretically have more permissions than an "Admin" if customized.

## Audience

- Policy designers
- Admin panel developers

## Prerequisites

- `docs/security/abac.md`

## Default Role Definitions (Baselines)

These are the standard templates provided in the "Roles" manager.

| Role | Scope | Description |
| ---- | ----- | ----------- |
| **Owner** | Global | **Supreme Authority**. Full system access across all tenants. Cannot be restricted. |
| **Super Admin** | Global | **Platform Manager**. Manages tenants, billing, and global settings. |
| **Admin** | Tenant | **Tenant Manager**. Full access *within* their tenant. Can manage tenant users and roles. |
| **Editor** | Tenant | **Content Manager**. Can review, approve, and publish content. Cannot manage users/settings. |
| **Author** | Tenant | **Creator**. Can create and edit *own* content. Needs approval to publish. |
| **Member** | Tenant | **User**. Registered end-user with basic profile access. |
| **Subscriber** | Tenant | **Customer**. Read-only access to premium/gated content. |
| **Public** | - | **Visitor**. Anonymous read-only access to public content. |

---

## Conceptual Hierarchy

```mermaid
graph TD
    A[Owner] --> B[Super Admin]
    B --> C[Admin (Tenant)]
    C --> D[Editor]
    D --> E[Author]
    E --> F[Member]
```

## Permission Matrix (Default Templates)

The following matrix represents the *default* configuration for new tenants.

### Content Operations

| Role | Create | Read | Update | Publish | Delete |
| ---- | :----: | :--: | :----: | :-----: | :----: |
| Owner | ✅ | ✅ | ✅ | ✅ | ✅ |
| Admin | ✅ | ✅ | ✅ | ✅ | ✅ |
| Editor | ✅ | ✅ | ✅ | ✅ | ❌ |
| Author | ✅ | ✅ | Own Only* | ❌ | ❌ |

### System Operations

| Role | User Mgmt | Role Mgmt | Settings | Audit Logs |
| ---- | :-------: | :-------: | :------: | :--------: |
| Owner | ✅ | ✅ | ✅ | ✅ |
| Admin | ✅ | ✅ | ✅ | ✅ |
| Editor | ❌ | ❌ | ❌ | ❌ |

---

## Database Implementation

### Roles Table

```sql
CREATE TABLE roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  tenant_id UUID REFERENCES tenants(id),  -- NULL for global roles
  is_system BOOLEAN DEFAULT FALSE -- Protected roles
);
```

### Global vs Tenant Roles

- **Global Roles** (`tenant_id` is NULL): Visible to all, managed by Platform Admins.
- **Tenant Roles** (`tenant_id` is set): Visible only to that tenant.

## DB Helper Functions

> **Warning:** These functions are strictly for **Platform Administration** logic. Do not use them for feature access (use `has_permission` instead).

- `is_super_admin()`: Returns true for Owner/Super Admin.
- `is_admin_or_above()`: **Deprecated** for feature checks.

## References

- `docs/security/abac.md`
- `docs/security/rls.md`
