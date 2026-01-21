# Modules Guide

## Purpose

Describe how admin modules are organized, where to find them, and how they map to permissions.

## Audience

- Admin panel developers
- Extension authors

## Module Structure

| Component Type     | Location                                                    | Naming           |
| :----------------- | :---------------------------------------------------------- | :--------------- |
| Manager Components | `awcms/src/components/dashboard/`                           | `*Manager.jsx`   |
| Route Pages        | `awcms/src/pages/cmspanel/`                                 | Module-specific  |
| Sidebar Config     | `awcms/src/templates/flowbite-admin/components/Sidebar.jsx` | `MENU_ITEMS`     |

## Available Modules (Comprehensive List)

Modules are categorized to match the **Permission Matrix**.

### 1. Content

- **Blogs** (`BlogsManager.jsx`)
- **Pages** (`PagesManager.jsx`)
- **Visual Pages** (`VisualPagesManager.jsx`) - *New*
- **Widgets** (`WidgetsManager.jsx`) - *New*
- **Templates** (`TemplatesManager.jsx`)
- **Portfolio** (`PortfolioManager.jsx`)
- **Testimonies** (`TestimonyManager.jsx`)
- **Announcements** (`AnnouncementsManager.jsx`)

### 2. Media

- **Media Library** (`MediaLibrary.jsx`)
- **Photo Gallery** (`PhotoGalleryManager.jsx`)
- **Video Gallery** (`VideoGalleryManager.jsx`)

### 3. Commerce

- **Products** (`ProductManager.jsx`)
- **Product Types** (`ProductTypeManager.jsx`)
- **Orders** (`OrderManager.jsx`)
- **Promotions** (`PromotionManager.jsx`)

### 4. Navigation

- **Menus** (`MenusManager.jsx`)
- **Categories** (`CategoriesManager.jsx`)
- **Tags** (`TagsManager.jsx`)

### 5. System & Access

- **Users** (`UsersManager.jsx`)
- **Roles** (`RolesManager.jsx`)
- **Permissions** (`PermissionsManager.jsx`)
- **Settings** (`SettingsManager.jsx`)
- **Audit Logs** (`AuditLogsManager.jsx`)
- **SEO** (`SeoManager.jsx`)
- **Languages** (`LanguageSettings.jsx`)
- **SSO** (`SSOManager.jsx`)
- **Backups** (`BackupManager.jsx`)

### 6. Platform & Plugins

- **Tenants** (`TenantsManager.jsx`)
- **Regions** (`RegionManager.jsx`) - *New*
- **Mailketing** (`MailketingManager.jsx`) - *New*
- **Analytics** (`AnalyticsManager.jsx`)

### 7. Mobile & IoT

- **Mobile Users** (`MobileUsersManager.jsx`)
- **IoT Devices** (`IoTManager.jsx`)

## Implementation Pattern

To add a new module, ensure you implement:

1. **Manager Component**: Using `AdminPageLayout` and checking `requiredPermission`.
2. **Routes**: Add to `MainRouter.jsx`.
3. **Sidebar**: Add to `Sidebar.jsx` (or `useAdminMenu` for dynamic loading).
4. **Database**: Add to `permissions` table if new resource type.
5. **RLS**: Ensure backing table has `tenant_id` and RLS enabled.

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
