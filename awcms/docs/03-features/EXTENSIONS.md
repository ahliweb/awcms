# AWCMS Extension System

## Purpose
Describe the plugin and extension architecture for AWCMS.
## Audience
- Admin panel developers
- Extension authors

## Prerequisites
- `awcms/docs/00-core/CORE_STANDARDS.md`

AWCMS uses a dual extension system combining WordPress-style hooks with modern ES module architecture.

> [!IMPORTANT]
> **Terminology**: "Plugin" = Core bundled modules. "Extension" = External dynamic modules.

## Core Concepts

| Type | Location | Loading | Use Case |
| ---- | -------- | ------- | -------- |
| **Core Plugin** | `src/plugins/` | Bundled at build | Essential features |
| **External Extension** | `awcms-ext-{vendor}-{slug}/` | Dynamic at runtime | Third-party modules |

---

## How It Works

## Hook System

### Actions

Execute custom code at specific points:

```javascript
addAction('dashboard_top', 'my_widget', () => console.log('Dashboard loaded!'));
doAction('dashboard_top');
```

### Filters

Modify data passing through:

```javascript
addFilter('admin_sidebar_menu', 'add_menu', (items) => [
  ...items, 
  { label: 'My Plugin', path: '/my-plugin' }
]);
const menuItems = applyFilters('admin_sidebar_menu', defaultItems);
```

---

## Core Plugins

Located in `src/plugins/`. Bundled at build time.

### Structure

```text
src/plugins/{slug}/
├── plugin.json       # Manifest
├── index.js          # Entry with lifecycle
└── Components.jsx
```

### Manifest (`plugin.json`)

```json
{
  "name": "Backup Manager",
  "slug": "backup",
  "version": "1.0.0",
  "type": "core",
  "routes": [{ "path": "/cmspanel/backup", "component": "BackupSettings" }],
  "menu": { "label": "Backup", "icon": "Database", "path": "backup" },
  "permissions": ["tenant.backup.create"]
}
```

### Lifecycle (`index.js`)

```javascript
import manifest from './plugin.json';

export { manifest };

export const register = ({ addAction, addFilter, supabase, pluginConfig }) => {
  addFilter('dashboard_widgets', 'backup', (widgets) => [...widgets, MyWidget]);
};

export const activate = async (supabase, tenantId) => { /* per-tenant setup */ };
export const deactivate = async (supabase, tenantId) => { /* cleanup */ };
```

---

## External Extensions

Located in `awcms-ext-{vendor}-{slug}/` at project root. Loaded dynamically at runtime.

### Directory Structure

```text
awcms-ext-ahliweb-analytics/
├── manifest.json     # Extension manifest (NOT plugin.json)
├── package.json
└── src/
    ├── index.js      # Entry point
    └── components/
```

### Manifest (`manifest.json`)

```json
{
  "name": "Analytics Dashboard",
  "slug": "analytics",
  "vendor": "ahliweb",
  "version": "1.0.0",
  "type": "external",
  "entry": "src/index.js",
  "awcms_version": ">=2.0.0",
  "routes": [{ "path": "analytics", "component": "AnalyticsDashboard" }],
  "menu": { "label": "Analytics", "icon": "BarChart2", "path": "analytics" },
  "permissions": ["tenant.analytics.read"]
}
```

### Entry Point (`index.js`)

```javascript
export const register = ({ addAction, addFilter, supabase, tenantId }) => {
  // tenantId is provided for multi-tenant context
  addFilter('dashboard_widgets', 'analytics', (widgets) => [...widgets, AnalyticsWidget]);
};

export const activate = async (supabase, tenantId) => {
  // Called when extension is activated for a tenant
};

export const deactivate = async (supabase, tenantId) => {
  // Called when extension is deactivated
};

// Export components for routing
export { default as AnalyticsDashboard } from './components/AnalyticsDashboard';
```

---

## Available Hooks

| Hook Name | Type | Description |
| --------- | ---- | ----------- |
| `plugins_loaded` | Action | All plugins/extensions loaded |
| `dashboard_widgets` | Filter | Dashboard widgets array |
| `admin_menu_items` | Filter | Sidebar menu items |
| `admin_routes` | Filter | Admin panel routes |
| `before_extension_load` | Action | Before external extension loads |
| `after_extension_load` | Action | After external extension loads |

---

## Database Tables

### `extensions`

| Column | Type | Description |
| ------ | ---- | ----------- |
| id | UUID | Primary key |
| tenant_id | UUID | Tenant isolation |
| slug | TEXT | Unique identifier |
| extension_type | TEXT | 'core' or 'external' |
| external_path | TEXT | Path for external extensions |
| manifest | JSONB | Extension manifest |
| config | JSONB | Runtime configuration |
| is_active | BOOLEAN | Activation status |

### `extension_logs`

Audit trail with RLS for all extension actions:

- `install`, `uninstall`, `activate`, `deactivate`, `config_change`, `error`

---

## Security

### RLS Policies

- Tenant isolation on `extensions` table
- Platform admins can view all extensions

### ABAC Permissions

| Permission | Description |
| ---------- | ----------- |
| `ext.manage` | Install/uninstall extensions |
| `ext.configure` | Modify extension settings |
| `ext.view_logs` | View extension audit logs |

### Requirements

- Extensions must declare required permissions in manifest
- Permission check before extension activation
- Audit log for all extension lifecycle events

---

## Quick Start: Core Plugin

1. Create `src/plugins/{slug}/plugin.json`
2. Create `src/plugins/{slug}/index.js` with `register()`
3. Add import to `pluginRegistry.js`
4. Insert row in `extensions` table

## Quick Start: External Extension

1. Create folder `awcms-ext-{vendor}-{slug}/`
2. Create `manifest.json` with required fields
3. Create `src/index.js` with `register()` export
4. Register in database with `extension_type: 'external'`

---

## API Reference

```javascript
// In React components
import { usePlugins, PluginSlot } from '@/contexts/PluginContext';

const { addAction, addFilter, applyFilters, doAction } = usePlugins();

// Render plugin slot
<PluginSlot name="dashboard_top" args={{ user, tenantId }} />
```

### External Extension Loader

```javascript
import { loadExternalExtension, validateManifest } from '@/lib/externalExtensionLoader';

// Load extension dynamically
const extension = await loadExternalExtension(manifest);

// Validate manifest
const { valid, errors } = validateManifest(manifest);
```

---

## Template Extension APIs

Extensions can integrate with the Template System using these APIs:

```javascript
import { 
  registerTemplateBlock, 
  registerWidgetArea, 
  registerPageType 
} from '@/lib/templateExtensions';

// Register a custom Puck block for Visual Builder
registerTemplateBlock({
  type: 'my_plugin/carousel',
  label: 'Image Carousel',
  render: CarouselComponent,
  fields: { images: { type: 'array' } }
});

// Register a new widget type for Widget Areas
registerWidgetArea({
  type: 'my_plugin/social_links',
  name: 'Social Links',
  icon: ShareIcon,
  defaultConfig: { networks: [] }
});

// Register a new page type for Route Assignments
registerPageType({
  type: 'product_archive',
  label: 'Product Archive'
});
```

These APIs use the WordPress-style hooks system internally. Registered blocks will be available in both the Admin Panel's Visual Builder and the Public Portal's component registry.

---

## Permissions and Access

- Extensions must use `usePermissions()` for access checks.
- Tenant context is required for any data operations.

## Security and Compliance Notes

- External extensions are sandboxed and loaded per tenant.
- Public portal does not support runtime extension loading.

## References

- `../03-features/PUBLIC_PORTAL_ARCHITECTURE.md`
- `../00-core/CORE_STANDARDS.md`
