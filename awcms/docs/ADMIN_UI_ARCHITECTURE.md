# AWCMS Admin UI Architecture

This document describes the unified admin template system (`awadmintemplate01`) and conventions for building consistent admin modules.

## Overview

All AWCMS admin pages use the `awadmintemplate01` template for consistent:

- Layout structure (sidebar, header, content, footer)
- Navigation (breadcrumbs, tabs)
- Data display (tables, forms, empty states)
- ABAC enforcement (permission-based visibility)
- Tenant context awareness

## Template Components

### Import

```jsx
import { 
  AdminPageLayout, 
  PageHeader, 
  PageTabs, 
  TabsContent,
  DataTable,
  FormWrapper,
  EmptyState,
  LoadingSkeleton,
  NotAuthorized,
  TenantBadge
} from '@/templates/awadmintemplate01';
```

---

## Component Reference

### AdminPageLayout

Main wrapper that handles permission checks and tenant context.

```jsx
<AdminPageLayout 
  requiredPermission="tenant.articles.read"
  showTenantBadge={true}
>
  {/* Page content */}
</AdminPageLayout>
```

| Prop | Type | Description |
|------|------|-------------|
| `requiredPermission` | `string` | Permission required to view page |
| `loading` | `boolean` | Show loading skeleton |
| `showTenantBadge` | `boolean` | Show tenant context (default: true for platform admins) |

---

### PageHeader

Standardized header with breadcrumbs and ABAC-filtered actions.

```jsx
<PageHeader
  title="Articles"
  description="Manage your content"
  icon={FileText}
  breadcrumbs={[
    { label: 'Content', href: '/cmspanel/content', icon: Folder },
    { label: 'Articles' }
  ]}
  actions={[
    { label: 'New Article', onClick: handleCreate, icon: Plus, permission: 'tenant.articles.create' }
  ]}
/>
```

| Prop | Type | Description |
|------|------|-------------|
| `title` | `string` | Page title |
| `description` | `string` | Page description |
| `icon` | `Component` | Lucide icon component |
| `breadcrumbs` | `Array<{label, href?, icon?}>` | Breadcrumb items |
| `actions` | `Array<{label, onClick, icon?, variant?, permission?}>` | Action buttons |

---

### PageTabs

Standardized tabs with gradient styling.

```jsx
<PageTabs
  value={activeTab}
  onValueChange={setActiveTab}
  tabs={[
    { value: 'list', label: 'List', icon: List, color: 'blue' },
    { value: 'trash', label: 'Trash', icon: Trash2, color: 'rose' }
  ]}
>
  <TabsContent value="list">...</TabsContent>
  <TabsContent value="trash">...</TabsContent>
</PageTabs>
```

| Color Options |
|---------------|
| `blue`, `purple`, `emerald`, `amber`, `rose`, `slate` |

---

### DataTable

Table wrapper with auto tenant column injection.

```jsx
<DataTable
  data={items}
  columns={columns}
  loading={loading}
  searchPlaceholder="Search articles..."
  searchValue={query}
  onSearchChange={setQuery}
  onRefresh={fetchData}
  onEdit={handleEdit}
  onDelete={handleDelete}
  showTenantColumn={true}
  pagination={{
    currentPage,
    totalPages,
    totalItems,
    itemsPerPage,
    onPageChange: setCurrentPage,
    onLimitChange: setItemsPerPage
  }}
/>
```

---

## Building New Modules

### Step 1: Create Manager Component

```jsx
import React, { useState } from 'react';
import { AdminPageLayout, PageHeader, PageTabs, TabsContent } from '@/templates/awadmintemplate01';
import { YourIcon } from 'lucide-react';

function YourManager() {
  const [activeTab, setActiveTab] = useState('main');

  return (
    <AdminPageLayout requiredPermission="tenant.your_module.read">
      <PageHeader
        title="Your Module"
        description="Manage your data"
        icon={YourIcon}
        breadcrumbs={[{ label: 'Your Module' }]}
      />
      
      {/* Content goes here */}
    </AdminPageLayout>
  );
}
```

### Step 2: Add Route

In `MainRouter.jsx`:

```jsx
<Route path="your-module" element={<YourManager />} />
```

### Step 3: Add Menu Item

In sidebar configuration or `admin_menus` table:

- Ensure `required_permission` matches your ABAC setup

---

## Tenant Context

The template automatically handles tenant context:

1. **Platform Admins** (`owner`, `super_admin`):
   - See `TenantBadge` in header
   - "Nama Tenant" column auto-injected in tables

2. **Tenant Users**:
   - No tenant badge
   - Data scoped to their tenant via RLS

---

## Permission Conventions

| Scope | Format | Example |
|-------|--------|---------|
| Tenant | `tenant.{module}.{action}` | `tenant.articles.create` |
| Platform | `platform.{module}.{action}` | `platform.template.manage` |

### Template-Specific Permissions

| Permission | Roles | Description |
|------------|-------|-------------|
| `platform.template.read` | owner, super_admin | View templates |
| `platform.template.update` | owner, super_admin | Edit templates |
| `platform.template.manage` | owner, super_admin | Full management |

---

## Security Notes

1. **XSS Prevention**: All user-generated content is sanitized
2. **ABAC Enforcement**: Permissions checked at render time
3. **RLS Integration**: All queries scoped by `tenant_id`
4. **Route Guards**: `AdminPageLayout` blocks unauthorized access

---

## Version

- Template: `awadmintemplate01 v1.0.0`
- Last Updated: 2026-01-05
