# ABAC System (Attribute-Based Access Control)

> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) Section 2.3 - Permission System (ABAC/RBAC)  
> **Permission Format**: `scope.resource.action` (e.g., `tenant.blog.publish`)

## Purpose

Define the permission model and enforcement patterns for AWCMS.

## Audience

- Admin panel developers
- Edge function authors

## Prerequisites

- [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) - **Primary authority** for permission system
- [AGENTS.md](../../AGENTS.md) - Permission implementation patterns and Context7 references
- [docs/security/overview.md](./overview.md) - Security overview
- [docs/tenancy/overview.md](../tenancy/overview.md) - Tenant context

---

## Core Concepts

AWCMS implements a comprehensive ABAC system that combines roles with policy enforcement.

### 4. Scopes (Access Boundaries)

The system defines 4 strict scopes for roles and permissions:

| Scope | Access Level | Assignment Rules |
| :--- | :--- | :--- |
| **platform** | **System-Wide**. Full access to all resources and tenants. | **Platform Roles Only**. (e.g. Owner, Super Admin). |
| **tenant** | **Tenant-Bounded**. Access strictly limited to user's `tenant_id`. | **Tenant Roles Only**. (e.g. Admin, Editor). |
| **content** | **Global Content**. Access to all content resources across tenants. | **Platform Roles Only**. Reserved for Content Moderators. |
| **module** | **Global Extensions**. Access to all plugins/extensions system-wide. | **Platform Roles Only**. Reserved for System Integrators. |

---

## 1. Permission Matrix (Live)

These lists correspond directly to the database `permissions` table and `PermissionMatrix.jsx`.

### A. Platform (Global Scope)

| Permission Key        | Actions                      | Channel |
| :-------------------- | :--------------------------- | :------ |
| `platform.tenant`     | read, create, update, delete | web     |
| `platform.setting`    | read, update                 | web     |
| `platform.module`     | read, create, update         | web     |
| `platform.extensions` | read, create, update, delete | web     |
| `platform.sidebar`    | read, update                 | web     |
| `platform.billing`    | read, update                 | web     |
| `platform.user`       | read, create, update, delete | web     |

### B. Tenant (Tenant Scope) - Standardized Pattern

**Format**: `tenant.{module}.{action}`

**Action conventions**: `create`, `read`, `update`, `delete`, `restore`, `permanent_delete`, `publish`.

#### Content Modules

| Module        | Permission Prefix        | Actions                                                          |
| :------------ | :----------------------- | :--------------------------------------------------------------- |
| Blogs         | `tenant.blog.*`          | read, create, update, delete, restore, permanent_delete, publish |
| Pages         | `tenant.page.*`          | read, create, update, delete, restore, permanent_delete, publish |
| Visual Pages  | `tenant.visual_pages.*`  | read, create, update, delete, restore, permanent_delete          |
| Portfolio     | `tenant.portfolio.*`     | read, create, update, delete, restore, permanent_delete          |
| Testimonies   | `tenant.testimonies.*`   | read, create, update, delete, restore, permanent_delete          |
| Announcements | `tenant.announcements.*` | read, create, update, delete, restore, permanent_delete          |
| Promotions    | `tenant.promotions.*`    | read, create, update, delete, restore, permanent_delete          |
| Widgets       | `tenant.widgets.*`       | read, create, update, delete                                     |
| Templates     | `tenant.templates.*`     | read, create, update, delete                                     |

#### Media Modules

| Module        | Permission Prefix        | Actions                                                 |
| :------------ | :----------------------- | :------------------------------------------------------ |
| Files (Lib)   | `tenant.files.*`         | read, create, update, delete, manage                    |
| Photo Gallery | `tenant.photo_gallery.*` | read, create, update, delete, restore, permanent_delete |
| Video Gallery | `tenant.video_gallery.*` | read, create, update, delete, restore, permanent_delete |

#### Commerce Modules

| Module        | Permission Prefix        | Actions                                                 |
| :------------ | :----------------------- | :------------------------------------------------------ |
| Products      | `tenant.products.*`      | read, create, update, delete, restore, permanent_delete |
| Product Types | `tenant.product_types.*` | read, create, update, delete, restore, permanent_delete |
| Orders        | `tenant.orders.*`        | read, create, update, delete, restore, permanent_delete |

#### Navigation & Taxonomy

| Module     | Permission Prefix     | Actions                                                 |
| :--------- | :-------------------- | :------------------------------------------------------ |
| Menus      | `tenant.menu.*`       | read, create, update, delete                            |
| Categories | `tenant.categories.*` | read, create, update, delete, restore, permanent_delete |
| Tags       | `tenant.tag.*`        | read, create, update, delete, restore, permanent_delete |

#### User Management

| Module   | Permission Prefix | Actions                      |
| :------- | :---------------- | :--------------------------- |
| Users    | `tenant.user.*`   | read, create, update, delete |
| Roles    | `tenant.role.*`   | read, create, update, delete |
| Policies | `tenant.policy.*` | read, create, update, delete |

#### System

| Module           | Permission Prefix           | Actions                                                 |
| :--------------- | :-------------------------- | :------------------------------------------------------ |
| Settings         | `tenant.setting.*`          | read, update                                            |
| Themes           | `tenant.theme.*`            | read, create, update, delete                            |
| Audit Logs       | `tenant.audit.*`            | read                                                    |
| Notifications    | `tenant.notification.*`     | read, create, update, delete                            |
| Contacts         | `tenant.contacts.*`         | read, create, update, delete, restore, permanent_delete |
| Contact Messages | `tenant.contact_messages.*` | read, create, update, delete, restore, permanent_delete |
| Regions          | `tenant.region.*`           | read, create, update, delete                            |
| SEO              | `tenant.seo.*`              | read, update                                            |
| SSO              | `tenant.sso.*`              | read, update                                            |
| Languages        | `tenant.languages.*`        | read, update                                            |
| School Pages     | `tenant.school_pages.*`     | read, update                                            |
| Backups          | `tenant.backups.*`          | read, create, delete                                    |

#### Mobile, IoT & Platform Extensions

| Module             | Permission Prefix             | Actions                      |
| :----------------- | :---------------------------- | :--------------------------- |
| Mobile Users       | `tenant.mobile_users.*`       | read, create, update, delete |
| Mobile Config      | `tenant.mobile.*`             | read, update                 |
| Push Notifications | `tenant.push_notifications.*` | read, create, update, delete |
| IoT Devices        | `tenant.iot.*`                | read, create, update, delete |
| Platform Extensions | `platform.extensions.*`      | read, create, update, delete  |
| Analytics          | `tenant.analytics.*`          | read                         |

---

## 2. Implementation

### Database Schema

- **Users**: Linked to roles.
- **Roles**: Foundational grouping of permissions.
- **Permissions**: Granular capabilities (e.g. `tenant.blog.create`).
- **Policies**: Advanced deny-rules (e.g., "No delete on mobile").
- **Analytics**: `analytics_events` and `analytics_daily` are protected by `tenant.analytics.read` for admin access.

### SQL Helper Functions (Backend Definitions)

AWCMS relies on a robust set of PostgreSQL helper functions to execute ABAC logic at the Row-Level Security (RLS) layer. Below are the canonical definitions:

#### 1. `current_tenant_id()`

Resolves the active tenant ID with three fallbacks: JWT (Auth), User Record, or App Config (used in Edge Functions).

```sql
CREATE OR REPLACE FUNCTION "public"."current_tenant_id"() RETURNS "uuid"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER SET "search_path" TO 'public' AS $_$
DECLARE
  config_tenant text;
BEGIN
  -- 1. Try JWT (Auth)
  IF (auth.jwt() -> 'app_metadata' ->> 'tenant_id') IS NOT NULL THEN
    RETURN (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid;
  END IF;

  -- 2. Try User Record (Auth)
  IF auth.uid() IS NOT NULL THEN
     RETURN (SELECT tenant_id FROM public.users WHERE id = auth.uid());
  END IF;

  -- 3. Try Config (Anon / Pre-request hook setup by Edge Functions)
  config_tenant := current_setting('app.current_tenant_id', true);
  IF config_tenant IS NOT NULL AND config_tenant ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN config_tenant::uuid;
  END IF;

  RETURN NULL;
END;
$_$;
```

#### 2. `has_permission(permission_name)`

Dynamically checks if the current authenticated user holds a specific permission via their assigned role. Short-circuits for platform admins or full-access roles for maximum performance.

```sql
CREATE OR REPLACE FUNCTION "public"."has_permission"("permission_name" "text") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER SET "search_path" TO 'public' AS $$
DECLARE
  has_perm boolean;
BEGIN
  -- 1. Short-circuit bypass for full-access or admin roles
  IF EXISTS (
    SELECT 1 FROM public.users u
    JOIN public.roles r ON u.role_id = r.id
    WHERE u.id = (SELECT auth.uid())
      AND r.deleted_at IS NULL
      AND (r.is_full_access OR r.is_platform_admin OR r.is_tenant_admin)
  ) THEN
    RETURN true;
  END IF;

  -- 2. Granular permission check
  SELECT EXISTS (
    SELECT 1 FROM public.users u
    JOIN public.roles r ON u.role_id = r.id
    JOIN public.role_permissions rp ON r.id = rp.role_id
    JOIN public.permissions p ON rp.permission_id = p.id
    WHERE u.id = (SELECT auth.uid())
      AND r.deleted_at IS NULL AND rp.deleted_at IS NULL AND p.deleted_at IS NULL
      AND p.name = permission_name
  ) INTO has_perm;

  RETURN has_perm;
END;
$$;
```

#### 3. `auth_is_admin()`

A lightning-fast, `SECURITY DEFINER` check for administrative privileges. Completely bypasses recursive RLS traps, making it safe to use in `tenant_select_abac` policies.

```sql
CREATE OR REPLACE FUNCTION "public"."auth_is_admin"() RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER SET "search_path" TO 'public' AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.users u
    JOIN public.roles r ON u.role_id = r.id
    WHERE u.id = auth.uid()
      AND r.deleted_at IS NULL
      AND (r.is_tenant_admin OR r.is_platform_admin OR r.is_full_access)
  );
END;
$$;
```

#### 4. `tenant_can_access_resource()`

Calculates hierarchical resource sharing between parent/child tenants natively in Postgres. Required for Multi-Tenancy implementations where root agencies share global content downwards.

```sql
CREATE OR REPLACE FUNCTION "public"."tenant_can_access_resource"("p_row_tenant_id" "uuid", "p_resource_key" "text", "p_action" "text") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SET "search_path" TO 'public' AS $$
DECLARE
  current_tenant uuid := public.current_tenant_id();
  share_mode text;
  access_mode text;
  current_root uuid;
  row_root uuid;
BEGIN
  -- ... [Initialization checks and auth_is_admin / self-tenant short-circuits omitted for brevity] ...
  
  -- Hierarchical logic: check if both tenants share the same root in hierarchy_path[1]
  SELECT hierarchy_path[1] INTO current_root FROM public.tenants WHERE id = current_tenant;
  SELECT hierarchy_path[1] INTO row_root FROM public.tenants WHERE id = p_row_tenant_id;
  IF current_root IS NULL OR row_root IS NULL OR current_root <> row_root THEN RETURN false; END IF;

  -- Resolve share mode for the specific resource
  SELECT tr.share_mode, tr.access_mode INTO share_mode, access_mode
  FROM public.tenant_resource_rules tr
  WHERE tr.tenant_id = p_row_tenant_id AND tr.resource_key = p_resource_key;

  IF share_mode IS NULL THEN
    SELECT rr.default_share_mode, rr.default_access_mode INTO share_mode, access_mode
    FROM public.tenant_resource_registry rr WHERE rr.resource_key = p_resource_key;
  END IF;

  -- Default fallback
  IF share_mode IS NULL THEN
    share_mode := 'isolated';
    access_mode := 'read_write';
  END IF;

  IF share_mode = 'isolated' THEN RETURN false; END IF;
  IF p_action = 'read' AND access_mode NOT IN ('read', 'read_write') THEN RETURN false; END IF;
  
  -- ... [Downward/Upward sharing inheritance logic completes the policy] ...
  RETURN can_access;
END;
$$;
```

### Plugin & Extension Permissions

- Plugin routes must declare explicit ABAC permissions (e.g., `tenant.setting.read`, `tenant.analytics.read`).
- Use registry keys when referencing plugin UI components (`mailketing:MailketingCreditsWidget`).
- New plugin permissions must be inserted into the `permissions` table before use.
- Prefer tenant scope permissions unless the feature is truly platform-wide.
- Extension lifecycle management in admin uses platform scope permissions (`platform.extensions.*`), while tenant-level extension settings should use tenant scope (`tenant.setting.*`).

### Context API (`usePermissions`)

```jsx
import { usePermissions } from '@/contexts/PermissionContext';

function MyComponent() {
  const { hasPermission, checkAccess } = usePermissions();

  if (hasPermission('tenant.widgets.create')) {
    return <CreateButton />;
  }
}
```

### 🔐 Multi-Device Channels

- **WEB**: Full management capabilities.
- **MOBILE**: Limited field reporting and content creation.
- **API**: Programmatic access (requires API keys).

---

## 3. Best Practices

1. **Check Permissions, Not Roles**: Never check `if (role === 'editor')`. Always check `if (hasPermission('tenant.blog.update'))`.
2. **Granularity**: Use the specific permission for the resource (e.g., `tenant.visual_pages` vs `tenant.pages`).
3. **Audit Trail**: All permission changes are logged in `audit_logs`.

## References

- `docs/modules/ROLE_HIERARCHY.md`
- `docs/security/rls.md`
