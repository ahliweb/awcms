
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
  subscription_tier TEXT DEFAULT 'free', -- free, pro, enterprise
  config JSONB DEFAULT '{}', -- brand colors, logo
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
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
  approval_status TEXT DEFAULT 'approved', -- 'pending_admin', 'pending_super_admin', 'approved', 'rejected'
  admin_approved_at TIMESTAMPTZ,
  admin_approved_by UUID,
  super_admin_approved_at TIMESTAMPTZ,
  super_admin_approved_by UUID,
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
  status TEXT DEFAULT 'pending_admin', -- pending_admin, pending_super_admin, completed, rejected
  
  admin_approved_at TIMESTAMPTZ,
  admin_approved_by UUID,
  super_admin_approved_at TIMESTAMPTZ,
  super_admin_approved_by UUID,
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
  name TEXT UNIQUE NOT NULL,
  description TEXT,
  is_system BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Default roles
INSERT INTO roles (name, description, is_system) VALUES
  ('super_admin', 'Full system access', TRUE),
  ('admin', 'Administrative access', TRUE),
  ('editor', 'Content management', TRUE),
  ('user', 'Basic user', TRUE),
  ('public', 'Unauthenticated visitor', TRUE);
```

### permissions

```sql
CREATE TABLE permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  description TEXT,
  module TEXT NOT NULL,
  action TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Example permissions
INSERT INTO permissions (name, description, module, action) VALUES
  ('view_articles', 'View blogs', 'articles', 'view'),
  ('create_articles', 'Create articles', 'articles', 'create'),
  ('edit_articles', 'Edit articles', 'articles', 'edit'),
  ('delete_articles', 'Delete articles', 'articles', 'delete'),
  ('publish_articles', 'Publish articles', 'articles', 'publish');
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

### blogs (Table name: `articles`)

```sql
CREATE TABLE articles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  content TEXT, -- Plain text or HTML fallback
  puck_layout_jsonb JSONB DEFAULT '{}', -- Visual Builder Layout
  tiptap_doc_jsonb JSONB DEFAULT '{}', -- Rich Text JSON
  excerpt TEXT,
  featured_image TEXT,
  author_id UUID REFERENCES users(id),
  category_id UUID REFERENCES categories(id),
  status TEXT DEFAULT 'draft',
  workflow_state TEXT DEFAULT 'draft', -- draft, reviewed, approved, published
  is_featured BOOLEAN DEFAULT FALSE,
  views INTEGER DEFAULT 0,
  published_at TIMESTAMPTZ,
  meta_title TEXT,
  meta_description TEXT,
  sync_source_id UUID, -- For cross-tenant synchronization
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_articles_slug ON articles(slug);
CREATE INDEX idx_articles_tenant_slug ON articles(tenant_id, slug); -- Optimized Lookup
CREATE INDEX idx_articles_tenant_status ON articles(tenant_id, status); -- Filter Opt
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
  content_type TEXT NOT NULL CHECK (content_type IN ('page', 'blog')),
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
  type TEXT NOT NULL, -- 'articles', 'products', 'portfolio'
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

### blog_tags (Table name: `article_tags`)

```sql
CREATE TABLE article_tags (
  article_id UUID REFERENCES articles(id) ON DELETE CASCADE,
  tag_id UUID REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (article_id, tag_id)
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
ALTER TABLE articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
-- ... etc

-- Example policy
CREATE POLICY "Public can view published articles"
ON articles FOR SELECT
USING (status = 'published' AND deleted_at IS NULL);

CREATE POLICY "Authors can edit own articles"
ON articles FOR UPDATE
USING (auth.uid() = author_id);

---

## Public Views (Secure Access)

### published_articles_view

Allows the Public Portal to fetch blog content without exposing internal columns.

```sql
CREATE VIEW published_articles_view AS
SELECT 
  id, tenant_id, title, slug, excerpt, featured_image,
  puck_layout_jsonb, tiptap_doc_jsonb, -- Exposed for rendering
  published_at, author_id, category_id
FROM articles
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
  label TEXT NOT NULL,
  icon TEXT,
  path TEXT NOT NULL,
  order_num INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE
);
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
CREATE INDEX idx_articles_search 
ON articles USING GIN(to_tsvector('english', title || ' ' || content));

-- Common queries
CREATE INDEX idx_articles_published 
ON articles(status, published_at DESC) 
WHERE deleted_at IS NULL;
```

---

## Security and Compliance Notes

- All tenant-scoped tables must include `tenant_id` and `deleted_at`.
- RLS policies and helper functions are defined in `supabase/migrations` and mirrored in `awcms/supabase/migrations` for CI linting.

## References

- `docs/security/rls.md`
- `docs/architecture/database.md`
- `../../schema_dump.sql`
