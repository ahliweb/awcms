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
| **Owner** | Platform | **Supreme Authority**. Full system access across all tenants. Cannot be restricted. |
| **Super Admin** | Platform | **Platform Admin**. Manages tenants, billing, and global settings (flagged via `is_platform_admin`). |
| **Admin** | Tenant | **Tenant Manager**. Full access *within* their tenant. Can manage tenant users and roles. |
| **Editor** | Tenant | **Content Manager**. Can review, approve, and publish content. Cannot manage users/settings. |
| **Author** | Tenant | **Creator**. Can create and edit *own* content. Needs approval to publish. |
| **Member** | Tenant | **User**. Registered end-user with basic profile access. |
| **Subscriber** | Tenant | **Customer**. Read-only access to premium/gated content. |
| **Public** | Tenant | **Visitor**. Anonymous read-only access to public content. |

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

| Role | Create | Read | Update | Publish | Delete | Restore | Permanent Delete |
| ---- | :----: | :--: | :----: | :-----: | :----: | :-----: | :----------: |
| Owner | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Admin | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Editor | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Author | ✅ | ✅ | Own Only* | ❌ | ❌ | ❌ | ❌ |

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
  tenant_id UUID REFERENCES tenants(id),
  scope TEXT DEFAULT 'tenant', -- platform | tenant | content | module
  is_system BOOLEAN DEFAULT FALSE,
  is_platform_admin BOOLEAN DEFAULT FALSE,
  is_full_access BOOLEAN DEFAULT FALSE,
  is_tenant_admin BOOLEAN DEFAULT FALSE,
  is_public BOOLEAN DEFAULT FALSE,
  is_guest BOOLEAN DEFAULT FALSE,
  is_staff BOOLEAN DEFAULT FALSE,
  staff_level INTEGER,
  is_default_public_registration BOOLEAN DEFAULT FALSE,
  is_default_invite BOOLEAN DEFAULT FALSE
);
```

### Global vs Tenant Roles

- **Global Roles** (`tenant_id` is NULL): Visible to all, managed by Platform Admins.
- **Tenant Roles** (`tenant_id` is set): Visible only to that tenant.

### Staff Hierarchy (Per Tenant)

| Level | Name |
| ----- | ---- |
| 10 | super_manager |
| 9 | senior_manager |
| 8 | manager |
| 7 | senior_supervisor |
| 6 | supervisor |
| 5 | senior_specialist |
| 4 | specialist |
| 3 | associate |
| 2 | assistant |
| 1 | internship |

### Default Onboarding Roles

- `is_default_public_registration` marks the role used for public signups.
- `is_default_invite` marks the role used for invite-based onboarding.

### Tenant Role Inheritance

- Tenants can inherit roles/permissions from a parent tenant in **auto** mode.
- In **linked** mode, inheritance occurs only for explicitly linked roles in `tenant_role_links`.
- The inheritance mode is stored on `tenants.role_inheritance_mode`.

## DB Helper Functions

> **Warning:** These functions are strictly for **Platform Administration** logic. Do not use them for feature access (use `has_permission` instead).

- `is_platform_admin()`: Returns true for platform admin/full access roles.
- `is_admin_or_above()`: **Deprecated** for feature checks.

**Action key note**: Use `permanent_delete` for destructive actions in permission keys (e.g., `tenant.blog.permanent_delete`).

> Platform admin access is determined by role flags (`is_platform_admin`/`is_full_access`), not role names.

## References

- `docs/security/abac.md`
- `docs/security/rls.md`
