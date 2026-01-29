
# Database Schema

## Purpose

Describe the tenant-scoped PostgreSQL schema used by AWCMS.

## Audience

- Developers working with data models and migrations
- Operators reviewing RLS and data isolation

## Prerequisites

- `docs/tenancy/overview.md`
- `docs/security/rls.md`

## Reference

AWCMS uses PostgreSQL via Supabase. This document describes the core database schema.

---

## Entity Relationship Diagram

```text
┌─────────────┐     ┌─────────────┐     ┌───────────────┐
│   tenants   │────▶│    users    │────▶│    roles    │
└─────────────┘     └─────────────┘     └───────────────┘
       │                   │                   │
       │                   │            ┌──────┴──────┐
       │                   │            │             │
       ▼                   ▼            ▼             ▼
│    files    │     │   blogs     │  │  menus  │  │ role_permissions│
└─────────────┘     └─────────────┘  └─────────┘  └─────────────────┘
       │
       │
       ▼
┌─────────────┐     ┌─────────────┐
│ categories  │◀────│   tags      │
└─────────────┘     └─────────────┘
```

---

## Core Tables

### tenants (New)

```sql
CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE, -- subdomain
  domain TEXT UNIQUE, -- custom domain
  host TEXT UNIQUE, -- resolved host header (e.g. "tenant.awcms.com")
  parent_tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
  level INTEGER DEFAULT 1,
  hierarchy_path UUID[],
  role_inheritance_mode TEXT DEFAULT 'auto', -- auto | linked
  subscription_tier TEXT DEFAULT 'free', -- free, pro, enterprise
  config JSONB DEFAULT '{}', -- brand colors, logo
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### tenant_resource_registry

Registry of resource keys and default sharing rules.

```sql
CREATE TABLE tenant_resource_registry (
  resource_key TEXT PRIMARY KEY,
  description TEXT,
  default_share_mode TEXT DEFAULT 'isolated',
  default_access_mode TEXT DEFAULT 'read_write',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### tenant_resource_rules

Tenant-specific resource sharing rules.

```sql
CREATE TABLE tenant_resource_rules (
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  resource_key TEXT REFERENCES tenant_resource_registry(resource_key) ON DELETE CASCADE,
  share_mode TEXT NOT NULL,
  access_mode TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID,
  PRIMARY KEY (tenant_id, resource_key)
);
```

### tenant_role_links

Explicit role inheritance mapping when `role_inheritance_mode = 'linked'`.

```sql
CREATE TABLE tenant_role_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  parent_role_id UUID REFERENCES roles(id) ON DELETE CASCADE,
  child_role_id UUID REFERENCES roles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID
);
```

### modules (New)

```sql
CREATE TABLE modules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'maintenance')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, slug)
);
```

### users

```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  full_name TEXT,
  role_id UUID REFERENCES roles(id),
  avatar_url TEXT,
  phone TEXT,
  bio TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  -- Approval Workflow
  approval_status TEXT DEFAULT 'approved', -- 'pending_admin', 'pending_super_admin' (platform admin), 'approved', 'rejected'
  admin_approved_at TIMESTAMPTZ,
  admin_approved_by UUID,
  super_admin_approved_at TIMESTAMPTZ, -- platform admin approval timestamp
  super_admin_approved_by UUID, -- platform admin approver
  rejection_reason TEXT,
  
  email_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role_id ON users(role_id);
```

### account_requests (New - Staging)

```sql
CREATE TABLE account_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id),
  email TEXT NOT NULL, -- normalized
  full_name TEXT,
  status TEXT DEFAULT 'pending_admin', -- pending_admin, pending_super_admin (platform admin), completed, rejected
  
  admin_approved_at TIMESTAMPTZ,
  admin_approved_by UUID,
  super_admin_approved_at TIMESTAMPTZ, -- platform admin approval timestamp
  super_admin_approved_by UUID, -- platform admin approver
  rejection_reason TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_account_requests_status ON account_requests(status);
CREATE INDEX idx_account_requests_email ON account_requests(email);
```

### roles

```sql
CREATE TABLE roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  tenant_id UUID REFERENCES tenants(id),
  scope TEXT DEFAULT 'tenant',
  is_system BOOLEAN DEFAULT FALSE,
  is_platform_admin BOOLEAN DEFAULT FALSE,
  is_full_access BOOLEAN DEFAULT FALSE,
  is_tenant_admin BOOLEAN DEFAULT FALSE,
  is_public BOOLEAN DEFAULT FALSE,
  is_guest BOOLEAN DEFAULT FALSE,
  is_staff BOOLEAN DEFAULT FALSE,
  staff_level INTEGER,
  is_default_public_registration BOOLEAN DEFAULT FALSE,
  is_default_invite BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Uniqueness: (tenant_id, name) for tenant roles + global unique name when tenant_id IS NULL.
-- Staff roles are seeded per tenant with staff_level 1-10.
-- Default onboarding roles are flagged via is_default_public_registration / is_default_invite.
```

### permissions

```sql
CREATE TABLE permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  description TEXT,
  resource TEXT NOT NULL,
  action TEXT NOT NULL,
  module TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  created_by UUID
);

-- Example permissions
INSERT INTO permissions (name, description, resource, action) VALUES
  ('tenant.blog.read', 'Read blogs', 'tenant.blog', 'read'),
  ('tenant.blog.create', 'Create blogs', 'tenant.blog', 'create'),
  ('tenant.blog.update', 'Update blogs', 'tenant.blog', 'update'),
  ('tenant.blog.delete', 'Soft delete blogs', 'tenant.blog', 'delete'),
  ('tenant.blog.publish', 'Publish blogs', 'tenant.blog', 'publish');
```

### role_permissions

```sql
CREATE TABLE role_permissions (
  role_id UUID REFERENCES roles(id) ON DELETE CASCADE,
  permission_id UUID REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);
```

---

## Content Tables

### blogs (Table name: `blogs`)

```sql
CREATE TABLE blogs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  content TEXT,
  excerpt TEXT,
  featured_image TEXT,
  author_id UUID REFERENCES users(id),
  status TEXT DEFAULT 'draft',
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  category_id UUID REFERENCES categories(id),
  tags TEXT[],
  is_active BOOLEAN DEFAULT TRUE,
  is_public BOOLEAN DEFAULT TRUE,
  meta_title TEXT,
  meta_description TEXT,
  meta_keywords TEXT,
  og_image TEXT,
  created_by UUID REFERENCES users(id),
  canonical_url TEXT,
  robots TEXT DEFAULT 'index, follow',
  og_title TEXT,
  og_description TEXT,
  twitter_card_type TEXT DEFAULT 'summary_large_image',
  twitter_image TEXT,
  views INTEGER DEFAULT 0,
  workflow_state TEXT DEFAULT 'draft',
  puck_layout_jsonb JSONB DEFAULT '{}',
  tiptap_doc_jsonb JSONB DEFAULT '{}',
  region_id UUID REFERENCES regions(id),
  current_assignee_id UUID REFERENCES users(id),
  sync_source_id UUID
);

CREATE UNIQUE INDEX articles_slug_key ON blogs(slug); -- Legacy index name
CREATE INDEX idx_articles_tenant_slug ON blogs(tenant_id, slug); -- Optimized lookup (legacy name)
CREATE INDEX idx_articles_tenant_status ON blogs(tenant_id, status); -- Filter optimization (legacy name)
```

### pages

```sql
CREATE TABLE pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  content TEXT,
  template TEXT DEFAULT 'default',
  parent_id UUID REFERENCES pages(id),
  puck_layout_jsonb JSONB DEFAULT '{}', -- Page builder data
  status TEXT DEFAULT 'draft',
  sort_order INTEGER DEFAULT 0,
  category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
  meta_title TEXT,
  meta_description TEXT,
  meta_keywords TEXT,
  og_image TEXT,
  canonical_url TEXT,
  sync_source_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_pages_tenant_slug ON pages(tenant_id, slug);
CREATE INDEX idx_pages_category_id ON pages(category_id);
```

### page_tags (New)

```sql
CREATE TABLE page_tags (
  page_id UUID NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (page_id, tag_id)
);
```

### page_files (New)

```sql
CREATE TABLE page_files (
  page_id UUID NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (page_id, file_id)
);
```

### content_translations (New - i18n)

```sql
CREATE TABLE content_translations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_type TEXT NOT NULL CHECK (content_type IN ('page', 'article')), -- 'article' is legacy for blogs
  content_id UUID NOT NULL,
  locale TEXT NOT NULL,
  title TEXT,
  slug TEXT,
  content TEXT,
  excerpt TEXT,
  meta_description TEXT,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(content_type, content_id, locale, tenant_id)
);
```

### products

```sql
CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT,
  sku TEXT UNIQUE,
  price DECIMAL(10,2),
  sale_price DECIMAL(10,2),
  stock_quantity INTEGER DEFAULT 0,
  is_featured BOOLEAN DEFAULT FALSE,
  status TEXT DEFAULT 'draft',
  category_id UUID REFERENCES categories(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
```

---

## Taxonomy Tables

### categories

```sql
CREATE TABLE categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT,
  parent_id UUID REFERENCES categories(id),
  type TEXT NOT NULL, -- e.g. 'blog', 'page', 'product', 'portfolio', 'announcement'
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
```

### tags

```sql
CREATE TABLE tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  color TEXT DEFAULT '#3b82f6',
  icon TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  tenant_id UUID REFERENCES tenants(id),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_tags_tenant_id ON tags(tenant_id);
CREATE INDEX idx_tags_is_active ON tags(is_active) WHERE deleted_at IS NULL;
```

### blog_tags

```sql
CREATE TABLE blog_tags (
  blog_id UUID REFERENCES blogs(id) ON DELETE CASCADE,
  tag_id UUID REFERENCES tags(id) ON DELETE CASCADE,
  created_by UUID REFERENCES users(id),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  PRIMARY KEY (blog_id, tag_id)
);
```

---

## Navigation Tables

### menus

```sql
CREATE TABLE menus (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  url TEXT NOT NULL,
  icon TEXT,
  location TEXT DEFAULT 'header', -- 'header', 'footer', 'sidebar'
  parent_id UUID REFERENCES menus(id),
  "order" INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  is_public BOOLEAN DEFAULT FALSE,
  group_label TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
```

### menu_permissions

```sql
CREATE TABLE menu_permissions (
  menu_id UUID REFERENCES menus(id) ON DELETE CASCADE,
  role_id UUID REFERENCES roles(id) ON DELETE CASCADE,
  can_view BOOLEAN DEFAULT FALSE,
  PRIMARY KEY (menu_id, role_id)
);
```

---

## Row Level Security (RLS)

Enable RLS on all tables:

```sql
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE blogs ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
-- ... etc

-- Example policy
CREATE POLICY "Public can view published blogs"
ON blogs FOR SELECT
USING (status = 'published' AND deleted_at IS NULL);

CREATE POLICY "Authors can edit own blogs"
ON blogs FOR UPDATE
USING (auth.uid() = author_id);

---

## Public Views (Secure Access)

### published_blogs_view

Allows the Public Portal to fetch blog content without exposing internal columns.

```sql
CREATE VIEW published_blogs_view AS
SELECT 
  id, tenant_id, title, slug, excerpt, featured_image,
  puck_layout_jsonb, tiptap_doc_jsonb, -- Exposed for rendering
  published_at, author_id, category_id
FROM blogs
WHERE 
  status = 'published' 
  AND deleted_at IS NULL;
```

---

## Soft Delete Pattern

All major tables use soft delete:

```sql
-- Instead of DELETE
UPDATE table_name 
SET deleted_at = NOW() 
WHERE id = $1;

-- Query active records
SELECT * FROM table_name 
WHERE deleted_at IS NULL;
```

---

## Extension System Tables

### extensions

Stores registered plugins and extensions.

```sql
CREATE TABLE extensions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  version TEXT DEFAULT '1.0.0',
  is_active BOOLEAN DEFAULT FALSE,
  extension_type TEXT DEFAULT 'core' CHECK (extension_type IN ('core', 'external')),
  external_path TEXT,            -- Path for external extensions
  manifest JSONB DEFAULT '{}',   -- Plugin manifest (plugin.json)
  config JSONB DEFAULT '{}',     -- Runtime configuration
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_extensions_tenant ON extensions(tenant_id);
CREATE INDEX idx_extensions_slug ON extensions(slug);
```

### extension_logs

Audit trail for extension lifecycle events.

```sql
CREATE TABLE extension_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  extension_id UUID REFERENCES extensions(id) ON DELETE SET NULL,
  extension_slug TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('install', 'uninstall', 'activate', 'deactivate', 'update', 'config_change', 'error')),
  details JSONB DEFAULT '{}',
  user_id UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_extension_logs_tenant ON extension_logs(tenant_id);
CREATE INDEX idx_extension_logs_extension ON extension_logs(extension_id);
CREATE INDEX idx_extension_logs_user ON extension_logs(user_id);
```

### extension_menu_items

Admin sidebar menu items added by extensions.

```sql
CREATE TABLE extension_menu_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  extension_id UUID REFERENCES extensions(id) ON DELETE CASCADE,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  icon TEXT,
  path TEXT NOT NULL,
  order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  parent_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID,
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_extension_menu_items_tenant_id ON extension_menu_items(tenant_id);
```

### extension_permissions

Extension-defined permission metadata.

```sql
CREATE TABLE extension_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  extension_id UUID REFERENCES extensions(id) ON DELETE CASCADE,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  permission_name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID
);

CREATE INDEX idx_extension_permissions_tenant_id ON extension_permissions(tenant_id);
```

### extension_rbac_integration

Role ↔ permission mappings for extension permissions.

```sql
CREATE TABLE extension_rbac_integration (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  extension_id UUID REFERENCES extensions(id) ON DELETE CASCADE,
  role_id UUID REFERENCES roles(id) ON DELETE CASCADE,
  permission_id UUID REFERENCES permissions(id) ON DELETE CASCADE,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID
);

CREATE INDEX idx_extension_rbac_integration_tenant_id ON extension_rbac_integration(tenant_id);
```

### extension_routes_registry

Admin route registry for extension routes.

```sql
CREATE TABLE extension_routes_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  extension_id UUID REFERENCES extensions(id) ON DELETE CASCADE,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  component_key TEXT NOT NULL,
  name TEXT NOT NULL,
  icon TEXT,
  requires_auth BOOLEAN DEFAULT TRUE,
  required_permissions TEXT[],
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID,
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_extension_routes_registry_tenant_id ON extension_routes_registry(tenant_id);
```

### regions (New)

Hierarchical administrative areas (Negara -> ... -> RT/RW).

```sql
CREATE TABLE regions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id),
  level_id UUID REFERENCES region_levels(id),
  parent_id UUID REFERENCES regions(id),
  code TEXT, -- e.g., '33', '3322'
  name TEXT NOT NULL,
  full_path TEXT, -- Cached: 'Indonesia > Jawa Tengah > Semarang'
  metadata JSONB DEFAULT '{}',
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_regions_tenant ON regions(tenant_id);
CREATE INDEX idx_regions_parent ON regions(parent_id);
CREATE INDEX idx_regions_level ON regions(level_id);
```

### region_levels (New)

Master levels configuration.

```sql
CREATE TABLE region_levels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT UNIQUE NOT NULL, -- 'negara', 'prop', 'kota_kab', etc.
  name TEXT NOT NULL,
  level_order INT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE
);
```

---

## Template System Tables (New)

### templates

Full page layouts using Puck visual builder.

```sql
CREATE TABLE templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  type TEXT DEFAULT 'page', -- 'page', 'archive', 'single', 'error'
  data JSONB DEFAULT '{}', -- Puck layout JSON
  parts JSONB DEFAULT '{}', -- { header: uuid, footer: uuid }
  language TEXT DEFAULT 'en',
  translation_group_id UUID,
  is_active BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_templates_tenant ON templates(tenant_id);
CREATE INDEX idx_templates_slug ON templates(tenant_id, slug);
```

### template_parts

Reusable template components (headers, footers, sidebars).

```sql
CREATE TABLE template_parts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL, -- 'header', 'footer', 'sidebar', 'widget_area'
  data JSONB DEFAULT '{}', -- Puck layout JSON
  language TEXT DEFAULT 'en',
  translation_group_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_template_parts_tenant ON template_parts(tenant_id);
CREATE INDEX idx_template_parts_type ON template_parts(tenant_id, type);
```

### template_assignments

Maps system routes to templates per channel.

```sql
CREATE TABLE template_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  route_type TEXT NOT NULL, -- 'home', '404', 'search', 'archive', 'single'
  template_id UUID REFERENCES templates(id) ON DELETE SET NULL,
  channel TEXT DEFAULT 'web', -- 'web', 'mobile', 'esp32'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, channel, route_type)
);
```

### widgets

Widget instances for widget areas.

```sql
CREATE TABLE widgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  area_id UUID REFERENCES template_parts(id) ON DELETE CASCADE,
  type TEXT NOT NULL, -- 'core/text', 'core/image', 'core/menu', etc.
  config JSONB DEFAULT '{}',
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_widgets_area ON widgets(area_id);
CREATE INDEX idx_widgets_tenant ON widgets(tenant_id);
```

### template_strings

Localized strings for template translations.

```sql
CREATE TABLE template_strings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'en',
  value TEXT,
  context TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_template_strings_tenant ON template_strings(tenant_id);
CREATE INDEX idx_template_strings_key ON template_strings(key, locale);
```

## Indexes

Recommended indexes for performance:

```sql
-- Full-text search
CREATE INDEX idx_blogs_search
ON blogs USING GIN(to_tsvector('english', title || ' ' || content));

-- Common queries
CREATE INDEX idx_blogs_published
ON blogs(status, published_at DESC)
WHERE deleted_at IS NULL;
```

---

## Security and Compliance Notes

- All tenant-scoped tables must include `tenant_id` and `deleted_at`.
- RLS policies and helper functions are defined in `supabase/migrations` and mirrored in `awcms/supabase/migrations` for CI linting.

## References

- `docs/security/rls.md`
- `docs/tenancy/supabase.md`
- `supabase/migrations/`
