> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) Section 2.3 (Permissions) and Section 3 (Modules)

# Modules Guide

## Purpose

Describe how admin modules are organized, where to find them, and how they map to permissions.

## Audience

- Admin panel developers
- Extension authors

## Prerequisites

- [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) - **Primary authority** for module architecture and permissions
- [AGENTS.md](../../AGENTS.md) - Implementation patterns and Context7 references

## Module Structure

| Component Type     | Location                                                    | Naming           |
| :----------------- | :---------------------------------------------------------- | :--------------- |
| Manager Components | `awcms/src/components/dashboard/`                           | `*Manager.jsx`   |
| Route Definitions  | `awcms/src/components/MainRouter.jsx`                       | `/cmspanel/<module>/*` |
| Sidebar Config     | `awcms/src/hooks/useAdminMenu.js`                           | `admin_menus`    |
| Sidebar Rendering  | `awcms/src/templates/flowbite-admin/components/Sidebar.jsx` | menu renderer    |

Route paths use `*` splats so sub-slugs (tabs, trash views, approvals) are URL-backed and survive refreshes.

## Available Modules (Core List)

Modules are categorized to match the **Permission Matrix**. The canonical source of truth is the `admin_menus` table and `resources_registry`.
Where route aliases exist, prefer the canonical `MainRouter.jsx` path noted in parentheses.

### 1. Content

- **Blogs** (`BlogsManager.jsx`)
- **Pages** (`PagesManager.jsx`)
- **Visual Pages** (`VisualPagesManager.jsx`)
- **Widgets** (`WidgetsManager.jsx`)
- **Templates** (`TemplatesManager.jsx`)
- **Portfolio** (`PortfolioManager.jsx`)
- **Testimonials** (`TestimonyManager.jsx`)
- **Announcements** (`AnnouncementsManager.jsx`)
- **Fun Facts** (`FunFactsManager.jsx`)
- **Services** (`ServicesManager.jsx`)
- **Team** (`TeamManager.jsx`)
- **Partners** (`PartnersManager.jsx`)

### 2. Media

- **Media Library** (`FilesManager.jsx`, routes: `media/*`, `files/*`)
- **Photo Gallery** (resource exists in `resources_registry`; currently served through dynamic resource patterns rather than a dedicated route-backed manager component)
- **Video Gallery** (resource exists in `resources_registry`; currently served through dynamic resource patterns rather than a dedicated route-backed manager component)

### 3. Commerce

- **Products** (`ProductsManager.jsx`)
- **Product Types** (`ProductTypesManager.jsx`)
- **Orders** (`OrdersManager.jsx`)
- **Promotions** (`PromotionsManager.jsx`)

### 4. Navigation

- **Menus** (`MenusManager.jsx`)
- **Categories** (`CategoriesManager.jsx`)
- **Tags** (`TagsManager.jsx`)

### 5. System & Access

- **Users** (`UsersManager.jsx`)
- **Roles** (`RolesManager.jsx`)
- **Permissions** (`PermissionsManager.jsx`)
- **Policies** (`PolicyManager.jsx`)
- **Settings** (`SettingsManager.jsx`)
- **Branding Settings** (`TenantSettings.jsx`, route: `settings/branding`)
- **Email Settings** (`EmailSettingsManager.jsx`, route: `email-settings`)
- **Email Logs** (`EmailLogsManager.jsx`, route: `email-logs`)
- **Audit Logs** (`AuditLogsManager.jsx`)
- **Visitor Statistics** (`VisitorStatisticsManager.jsx`)
- **SEO** (`SeoManager.jsx`)
- **Languages** (`LanguageSettings.jsx`)
- **SSO** (`SSOManager.jsx`)
- **Notifications** (`NotificationsManager.jsx`)
- **Contacts** (`ContactsManager.jsx`)
- **Contact Messages** (`ContactMessagesManager.jsx`)
- **Themes** (`ThemesManager.jsx`)
- **School Pages** (`SchoolPagesManager.jsx`)
- **Site Images** (`SiteImagesManager.jsx`)

### 6. Platform & Plugins

- **Tenants** (`TenantsManager.jsx`)
- **Modules** (`ModulesManager.jsx`)
- **Extensions** (`ExtensionsManager.jsx`)
- **Sidebar Menus** (`SidebarMenuManager.jsx`, route: `admin-navigation/*`)
- **Platform Settings** (`PlatformSettingsManager.jsx`, route: `platform/settings`)
- **Platform Dashboard** (`PlatformDashboard.jsx`, route: `platform`)
- **Dynamic Resources** (`DynamicResourceManager.jsx`)

### 7. Mobile & IoT

- **Mobile Users** (`MobileUsersManager.jsx`)
- **Push Notifications** (`PushNotificationsManager.jsx`, route: `mobile/push`)
- **Mobile Config** (`MobileAppConfig.jsx`, route: `mobile/config`)
- **Devices** (`DevicesManager.jsx`, route: `devices`)

## Implementation Pattern

To add a new module, ensure you implement:

1. **Manager Component**: Using `AdminPageLayout` and checking `requiredPermission`.
2. **Routes**: Add to `MainRouter.jsx`.
3. **Sidebar**: Add to `admin_menus` (seed via `awcms/src/scripts/seed-sidebar.js`) and render via `useAdminMenu`.
4. **Database**: Add to `permissions` table if new resource type.
5. **RLS / ABAC**: Ensure backing tables have `tenant_id`, `deleted_at` where applicable, and policies aligned to the resource permission prefix.
6. **Dynamic Resources**: If a resource is intended to use the generic runtime, ensure `resources_registry`, `ui_configs`, and `DynamicResourceManager` can render it before documenting it as route-backed.

## Permission Mapping

Every module *must* map to a permission key:

```jsx
// Example: Widgets Manager
<AdminPageLayout requiredPermission="tenant.widgets.read">
  <WidgetsManager />
</AdminPageLayout>
```

## References

- `docs/security/abac.md`
- `docs/modules/ROLE_HIERARCHY.md`
