-- Per-tenant admin sidebar overrides (Issue #260, continuation of #258;
-- ported from awcms-micro's sql/094).
--
-- The admin sidebar is a CODE-DERIVED default: the synthetic core items plus
-- every module's declared `navigation`, grouped type -> module -> items by
-- `module-management/domain/sidebar-menu.ts`. That landed in #258/#259 and is
-- what renders today.
--
-- These two tables hold ONLY a tenant's OVERRIDE of that default: reordering,
-- show/hide, relabelling, moving an item to a different type, and custom types.
-- Absence of a row means "use the code default", so an untouched tenant renders
-- exactly the code model and nothing here is required for the sidebar to work.
--
-- ## Why override rows and not a stored snapshot
--
-- The set of menu items is trusted, reviewed, BUILD-TIME data — never
-- tenant-writable. Storing only the delta means a newly added module's nav
-- entry appears for every tenant automatically, with no data migration, while
-- an explicit customization survives. A snapshot would freeze each tenant's
-- sidebar at the moment they first touched it, and every future module would
-- need a backfill to become visible.
--
-- `entry_key` = the nav item's stable `path`. `module-composition.ts` already
-- forbids two modules claiming the same path, and
-- `tests/admin-navigation-registry.test.ts` (#258) requires every declared path
-- to resolve to a real page — so the key space is both unique and non-dangling
-- before a row can reference it. Core items are keyed by their path too.
--
-- ## Isolation
--
-- Both tables are tenant-scoped with ENABLE + FORCE ROW LEVEL SECURITY and the
-- standard `tenant_isolation` policy. FORCE matters here specifically: these
-- rows drive what an operator SEES, so a leak across tenants would be a
-- confusing information disclosure rather than an obvious error. RLS is the
-- structural floor under the explicit `tenant_id` filter every query carries.
--
-- No worker or purge job touches either table, so there is no `awcms_worker`
-- GRANT — the least-privilege `awcms_app` role gets its DML from the
-- migration-019 default privileges. A GRANT for a role that never reads the
-- table is a permission nobody needs and everybody has to reason about.
--
-- Numbering: 071 = schema, 072 = permission seed — the same schema-then-
-- permissions split used by 066/067, 064/065 and 062/063.

-- ---------------------------------------------------------------------------
-- 1. Type (top-level category) overrides + custom types
-- ---------------------------------------------------------------------------
-- A row exists only when the tenant relabelled, reordered or hid a type, or
-- added a CUSTOM type (a `type_key` outside the code taxonomy).
CREATE TABLE IF NOT EXISTS awcms_sidebar_menu_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  type_key text NOT NULL,
  label_override text,
  position integer NOT NULL DEFAULT 0,
  hidden boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Mirrored by MAX_TYPE_KEY_LENGTH / MAX_LABEL_OVERRIDE_LENGTH in
  -- `domain/sidebar-menu.ts`, which validates BEFORE a write reaches the
  -- database. The CHECK is the floor, not the error message.
  CONSTRAINT awcms_sidebar_menu_types_type_key_len_check
    CHECK (type_key <> '' AND char_length(type_key) <= 64),
  CONSTRAINT awcms_sidebar_menu_types_label_override_len_check
    CHECK (label_override IS NULL OR char_length(label_override) <= 120),
  -- At most one override per (tenant, type). The save path is a full
  -- DELETE-then-INSERT replace of this tenant's rows, not an upsert, so this
  -- guards duplicates WITHIN one submitted payload (validation rejects those
  -- too) rather than backing an ON CONFLICT clause.
  CONSTRAINT awcms_sidebar_menu_types_tenant_type_key
    UNIQUE (tenant_id, type_key)
);

ALTER TABLE awcms_sidebar_menu_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_sidebar_menu_types FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_sidebar_menu_types_tenant_isolation
  ON awcms_sidebar_menu_types
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- ---------------------------------------------------------------------------
-- 2. Item (menu link) overrides
-- ---------------------------------------------------------------------------
-- `entry_key` = the nav item's stable `path`.
-- `type_key` = the type the item is PLACED under; NULL keeps its code default.
CREATE TABLE IF NOT EXISTS awcms_sidebar_menu_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  entry_key text NOT NULL,
  type_key text,
  position integer NOT NULL DEFAULT 0,
  label_override text,
  hidden boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_sidebar_menu_items_entry_key_len_check
    CHECK (entry_key <> '' AND char_length(entry_key) <= 256),
  CONSTRAINT awcms_sidebar_menu_items_type_key_len_check
    CHECK (type_key IS NULL OR (type_key <> '' AND char_length(type_key) <= 64)),
  CONSTRAINT awcms_sidebar_menu_items_label_override_len_check
    CHECK (label_override IS NULL OR char_length(label_override) <= 120),
  CONSTRAINT awcms_sidebar_menu_items_tenant_entry_key
    UNIQUE (tenant_id, entry_key)
);

-- The compose read path filters by tenant then groups by type, so the
-- composite keeps a whole-tenant fetch to one index range scan.
CREATE INDEX IF NOT EXISTS awcms_sidebar_menu_items_tenant_type_idx
  ON awcms_sidebar_menu_items (tenant_id, type_key);

ALTER TABLE awcms_sidebar_menu_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_sidebar_menu_items FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_sidebar_menu_items_tenant_isolation
  ON awcms_sidebar_menu_items
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
