# ABAC System (Attribute-Based Access Control)

## Purpose

Define the permission model and enforcement patterns for AWCMS.

## Audience

- Admin panel developers
- Edge function authors

## Prerequisites

- `docs/security/overview.md`
- `docs/tenancy/overview.md`

## Core Concepts

AWCMS implements a comprehensive ABAC system that combines roles with policy enforcement.

---

## 1. Permission Matrix (Live)

These lists correspond directly to the database `permissions` table and `PermissionMatrix.jsx`.

### A. Platform (Global Scope)

| Permission Key     | Actions                      | Channel |
| :----------------- | :--------------------------- | :------ |
| `platform.tenant`  | read, create, update, delete | web     |
| `platform.setting` | read, update                 | web     |
| `platform.module`  | read, create, update         | web     |
| `platform.billing` | read, update                 | web     |
| `platform.user`    | read, create, update, delete | web     |

### B. Tenant (Tenant Scope) - Standardized Pattern

**Format**: `tenant.{module}.{action}`

#### Content Modules

| Module        | Permission Prefix        | Actions                                                          |
| :------------ | :----------------------- | :--------------------------------------------------------------- |
| Blogs         | `tenant.article.*`       | read, create, update, delete, restore, permanent_delete, publish |
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

| Module | Permission Prefix | Actions                      |
| :----- | :---------------- | :--------------------------- |
| Users  | `tenant.user.*`   | read, create, update, delete |

#### System

| Module           | Permission Prefix           | Actions                                                 |
| :--------------- | :-------------------------- | :------------------------------------------------------ |
| Settings         | `tenant.setting.*`          | read, update                                            |
| Themes           | `tenant.theme.*`            | read, create, update, delete                            |
| Audit Logs       | `tenant.audit.*`            | read                                                    |
| Notifications    | `tenant.notification.*`     | read                                                    |
| Contacts         | `tenant.contacts.*`         | read, create, update, delete, restore, permanent_delete |
| Contact Messages | `tenant.contact_messages.*` | read, create, update, delete, restore, permanent_delete |
| Regions          | `tenant.region.*`           | read, create, update, delete                            |
| SEO              | `tenant.seo.*`              | read, update                                            |
| SSO              | `tenant.sso.*`              | read, update                                            |
| Languages        | `tenant.languages.*`        | read, update                                            |
| Backups          | `tenant.backups.*`          | read, create, delete                                    |

#### Mobile, IoT & Extensions

| Module        | Permission Prefix             | Actions                      |
| :------------ | :---------------------------- | :--------------------------- |
| Mobile Users  | `tenant.mobile_users.*`       | read, create, update, delete |
| Mobile Config | `tenant.mobile.*`             | read, update                 |
| IoT Devices   | `tenant.iot.*`                | read, create, update, delete |
| Mailketing    | `tenant.mailketing.*`         | read, send, template         |
| Analytics     | `tenant.analytics.*`          | read                         |

---

## 2. Implementation

### Database Schema

- **Users**: Linked to roles.
- **Roles**: Foundational grouping of permissions.
- **Permissions**: Granular capabilities (e.g. `tenant.article.create`).
- **Policies**: Advanced deny-rules (e.g., "No delete on mobile").

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

1. **Check Permissions, Not Roles**: Never check `if (role === 'editor')`. Always check `if (hasPermission('tenant.article.update'))`.
2. **Granularity**: Use the specific permission for the resource (e.g., `tenant.visual_pages` vs `tenant.pages`).
3. **Audit Trail**: All permission changes are logged in `audit_logs`.

## References

- `docs/modules/ROLE_HIERARCHY.md`
- `docs/security/rls.md`
