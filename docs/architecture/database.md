> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) Section 2 (Data Integrity)

# Database Schema

## Purpose

Describe the tenant-scoped PostgreSQL schema used by AWCMS.

## Audience

- Developers working with data models and migrations
- Operators reviewing RLS and data isolation

## Prerequisites

- [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) - **Primary authority** for database schema and data integrity
- [AGENTS.md](../../AGENTS.md) - Implementation patterns and Context7 references
- `docs/tenancy/overview.md`
- `docs/security/rls.md`

## Reference

AWCMS uses PostgreSQL via Supabase. This document describes the core database schema.

> **Schema Accuracy Note:** SQL blocks in this document are representative snapshots for developer orientation.
> Canonical executable schema truth is the migration history in `supabase/migrations/` (mirrored in `awcms/supabase/migrations/`).
> Before relying on a specific column, constraint, or policy shape, verify against the latest migration files.
> **2026-03-12 Baseline:** Migration inventory currently shows `131` root migrations and `131` mirrored migrations. Always run `scripts/verify_supabase_migration_consistency.sh` because matching counts alone do not guarantee filename/content parity.

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
  deleted_at TIMESTAMPTZ,
  host TEXT UNIQUE, -- resolved host header (e.g. "tenant.awcms.com")
  parent_tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
  level INTEGER DEFAULT 1, -- constrained to 1..5
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

### resources_registry

Registry of UI-facing resources for the database-driven admin UI.

```sql
CREATE TABLE resources_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  scope TEXT NOT NULL,
  type TEXT NOT NULL,
  db_table TEXT,
  icon TEXT,
  permission_prefix TEXT,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### ui_configs

Stores JSON schemas for admin tables/forms per resource.

```sql
CREATE TABLE ui_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_key TEXT REFERENCES resources_registry(key) ON DELETE CASCADE,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  schema JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_default BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(resource_key, type, tenant_id, name)
);
```

### component_registry

Stores TipTap/Puck editor configuration per tenant.

```sql
CREATE TABLE component_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_key TEXT REFERENCES resources_registry(key) ON DELETE CASCADE,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  editor_type TEXT NOT NULL,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
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

### analytics_events (New)

Stores raw visitor events for analytics. Public inserts are allowed with tenant scoping.

```sql
CREATE TABLE analytics_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  visitor_id TEXT,
  session_id TEXT,
  event_type TEXT DEFAULT 'page_view',
  path TEXT NOT NULL,
  referrer TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  ip_address TEXT,
  user_agent TEXT,
  device_type TEXT,
  country TEXT,
  region TEXT,
  consent_state TEXT DEFAULT 'unknown',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
```

### analytics_daily (New)

Daily rollups for analytics dashboards and public stats.

```sql
CREATE TABLE analytics_daily (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  path TEXT NOT NULL,
  page_views INTEGER DEFAULT 0,
  unique_visitors INTEGER DEFAULT 0,
  unique_sessions INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, date, path)
);
```

### users

```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  full_name TEXT,
  avatar_url TEXT,
  role_id UUID REFERENCES roles(id),
  language TEXT DEFAULT 'id',
  created_by UUID REFERENCES users(id),
  tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
  -- Approval Workflow
  approval_status TEXT DEFAULT 'approved', -- 'pending_admin', 'pending_super_admin' (platform admin), 'approved', 'rejected'
  admin_approved_at TIMESTAMPTZ,
  admin_approved_by UUID REFERENCES users(id),
  super_admin_approved_at TIMESTAMPTZ, -- platform admin approval timestamp
  super_admin_approved_by UUID REFERENCES users(id), -- platform admin approver
  rejection_reason TEXT,
  region_id UUID REFERENCES regions(id) ON DELETE SET NULL,
  administrative_region_id UUID REFERENCES administrative_regions(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role_id ON users(role_id);
CREATE INDEX idx_users_region_id ON users(region_id);
CREATE INDEX idx_users_admin_region_id ON users(administrative_region_id);
```

### regions (Operational Hierarchy)

Ten-level operational hierarchy for global segmentation.

```sql
CREATE TABLE regions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  level INTEGER NOT NULL CHECK (level BETWEEN 1 AND 10),
  parent_id UUID REFERENCES regions(id) ON DELETE SET NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (slug)
);

CREATE INDEX idx_regions_parent_id ON regions(parent_id);
```

### administrative_regions (Indonesia)

Government hierarchy from the `cahyadsn/wilayah` dataset, used for compliance and reporting.

```sql
CREATE TABLE administrative_regions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('provinsi', 'kabupaten', 'kota', 'kecamatan', 'kelurahan', 'desa')),
  parent_id UUID REFERENCES administrative_regions(id) ON DELETE SET NULL,
  postal_code TEXT,
  latitude NUMERIC,
  longitude NUMERIC,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (code)
);

CREATE INDEX idx_admin_regions_parent_id ON administrative_regions(parent_id);
CREATE INDEX idx_admin_regions_code ON administrative_regions(code);
CREATE INDEX idx_admin_regions_level ON administrative_regions(level);
```

### user_profiles

Extended profile metadata, separate from `users` for scalability.

```sql
CREATE TABLE user_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
  tenant_id UUID REFERENCES tenants(id) ON DELETE RESTRICT,
  description TEXT,
  job_title TEXT,
  department TEXT,
  phone TEXT,
  alternate_email TEXT,
  location TEXT,
  timezone TEXT,
  website_url TEXT,
  linkedin_url TEXT,
  twitter_url TEXT,
  github_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_user_profiles_tenant_id ON user_profiles(tenant_id);
```

### user_profile_admin

Admin-only profile fields encrypted with pgcrypto. Encryption uses a per-user salt and a passphrase derived from `user_profiles.description`. Updates to `description` re-key these fields via trigger.

```sql
CREATE TABLE user_profile_admin (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
  tenant_id UUID REFERENCES tenants(id) ON DELETE RESTRICT,
  admin_notes_encrypted BYTEA,
  admin_flags_encrypted BYTEA,
  admin_salt TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_user_profile_admin_tenant_id ON user_profile_admin(tenant_id);
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
  created_by UUID REFERENCES users(id),
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
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
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
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id UUID REFERENCES roles(id) ON DELETE CASCADE,
  permission_id UUID REFERENCES permissions(id) ON DELETE CASCADE,
  tenant_id UUID REFERENCES tenants(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  deleted_at TIMESTAMPTZ
);

-- Current helper functions filter soft-deleted mappings with rp.deleted_at IS NULL.
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

CREATE UNIQUE INDEX blogs_tenant_slug_key
  ON blogs(tenant_id, slug)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_articles_tenant_status ON blogs(tenant_id, status); -- Legacy index name retained in migration history
```

### pages

```sql
CREATE TABLE pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  content TEXT,
  template TEXT DEFAULT 'default',
  parent_id UUID REFERENCES pages(id),
  puck_layout_jsonb JSONB DEFAULT '{}', -- Page builder data
  status TEXT DEFAULT 'draft',
  sort_order INTEGER DEFAULT 0,
  page_type TEXT DEFAULT 'regular', -- 'homepage', 'regular', etc.
  is_active BOOLEAN DEFAULT FALSE,
  category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
  meta_title TEXT,
  meta_description TEXT,
  meta_keywords TEXT,
  og_image TEXT,
  canonical_url TEXT,
  sync_source_id UUID,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX pages_tenant_slug_key
  ON pages(tenant_id, slug)
  WHERE deleted_at IS NULL;
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
  type TEXT NOT NULL, -- canonical scopes include 'content', 'blog', 'page', 'product', 'portfolio', 'announcement', 'promotion', 'testimony', 'media', 'contact'
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
```

Notes:

- `content` categories are intentionally shared across blog and page selectors.
- Legacy plural aliases may still exist in older tenant data, but admin/public selectors normalize them through the shared taxonomy map.

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

Notes:

- Tags are tenant-scoped and reused across supported modules rather than owned by a single content type.
- Public and admin tag pickers should filter `deleted_at IS NULL` and `is_active = true`.

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
  name TEXT NOT NULL,
  label TEXT NOT NULL,
  slug TEXT,
  url TEXT NOT NULL,
  icon TEXT,
  location TEXT DEFAULT 'header', -- 'header', 'footer', 'sidebar'
  parent_id UUID REFERENCES menus(id),
  "order" INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  is_public BOOLEAN DEFAULT FALSE,
  group_label TEXT,
  role_id UUID REFERENCES roles(id),
  page_id UUID REFERENCES pages(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
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

AWCMS no longer treats generic role-only examples as the canonical policy model. Current policy guidance is:

- enable RLS on every tenant-scoped table
- scope rows with `tenant_id = public.current_tenant_id()`
- enforce permissions with `public.has_permission(...)`
- use `public.auth_is_admin()` only for recursion-safe administrative bypasses
- keep `deleted_at IS NULL` explicit for business reads unless the table is intentionally write-only telemetry

Representative current pattern:

```sql
ALTER TABLE public.blogs ENABLE ROW LEVEL SECURITY;

CREATE POLICY blogs_select_abac ON public.blogs
FOR SELECT USING (
  tenant_id = public.current_tenant_id()
  AND deleted_at IS NULL
  AND (
    public.has_permission('tenant.blog.read')
    OR public.auth_is_admin()
  )
);

CREATE POLICY blogs_update_abac ON public.blogs
FOR UPDATE USING (
  tenant_id = public.current_tenant_id()
  AND deleted_at IS NULL
  AND (
    public.has_permission('tenant.blog.update')
    OR (
      public.has_permission('tenant.blog.update_own')
      AND author_id = auth.uid()
    )
    OR public.auth_is_admin()
  )
)
WITH CHECK (tenant_id = public.current_tenant_id());
```

Public write-only telemetry pattern:

```sql
CREATE POLICY analytics_events_public_insert ON public.analytics_events
FOR INSERT TO anon, authenticated
WITH CHECK (tenant_id = public.current_tenant_id());
```

Helper function source baselines:

- `public.current_tenant_id()` -> `supabase/migrations/20260307070000_fix_users_rls_recursion.sql`
- `public.has_permission()` -> `supabase/migrations/20260127090000_role_flags_staff_hierarchy.sql`
- `public.auth_is_admin()` -> `supabase/migrations/20260127090000_role_flags_staff_hierarchy.sql`

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
- Public analytics inserts and aggregate reads are explicitly scoped by `current_tenant_id()`.

## Migration Source of Truth

- Author migrations in `supabase/migrations/` only.
- Mirror each migration to `awcms/supabase/migrations/` with identical filename and SQL content.
- Validate parity before PR merge:

```bash
scripts/verify_supabase_migration_consistency.sh
```

- Validate linked migration history when preparing production database changes:

```bash
scripts/verify_supabase_migration_consistency.sh --linked
```

## References

- `docs/security/rls.md`
- `docs/tenancy/supabase.md`
- `supabase/migrations/`
