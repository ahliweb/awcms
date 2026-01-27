ALTER TABLE public.roles
  ADD COLUMN IF NOT EXISTS is_default_public_registration boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_default_invite boolean NOT NULL DEFAULT false;

UPDATE public.roles
SET is_default_public_registration = true
WHERE name = 'pending';

UPDATE public.roles
SET is_default_invite = true
WHERE name IN ('user', 'subscriber');

CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    default_role_id UUID;
    pending_role_id UUID;
    target_tenant_id UUID;
    primary_tenant_id UUID;
    is_public_registration BOOLEAN;
    initial_approval_status TEXT;
BEGIN
    BEGIN
        is_public_registration := COALESCE((NEW.raw_user_meta_data->>'public_registration')::BOOLEAN, FALSE);
    EXCEPTION WHEN OTHERS THEN
        is_public_registration := FALSE;
    END;

    BEGIN
        target_tenant_id := (NEW.raw_user_meta_data->>'tenant_id')::UUID;
    EXCEPTION WHEN OTHERS THEN
        target_tenant_id := NULL;
    END;

    SELECT id INTO primary_tenant_id FROM public.tenants WHERE slug = 'primary' LIMIT 1;

    IF target_tenant_id IS NULL THEN
        target_tenant_id := primary_tenant_id;
    END IF;

    IF is_public_registration THEN
        SELECT id INTO pending_role_id
        FROM public.roles
        WHERE is_default_public_registration = true
          AND deleted_at IS NULL
          AND (tenant_id = target_tenant_id OR tenant_id IS NULL)
        ORDER BY tenant_id NULLS LAST, created_at ASC
        LIMIT 1;

        IF pending_role_id IS NULL THEN
            SELECT id INTO pending_role_id
            FROM public.roles
            WHERE is_public = true
              AND deleted_at IS NULL
              AND (tenant_id = target_tenant_id OR tenant_id IS NULL)
            ORDER BY tenant_id NULLS LAST, created_at ASC
            LIMIT 1;
        END IF;

        IF pending_role_id IS NULL THEN
            SELECT id INTO pending_role_id
            FROM public.roles
            WHERE is_guest = true
              AND deleted_at IS NULL
              AND (tenant_id = target_tenant_id OR tenant_id IS NULL)
            ORDER BY tenant_id NULLS LAST, created_at ASC
            LIMIT 1;
        END IF;

        default_role_id := pending_role_id;
        initial_approval_status := 'pending_admin';
    ELSE
        SELECT id INTO default_role_id
        FROM public.roles
        WHERE is_default_invite = true
          AND deleted_at IS NULL
          AND (tenant_id = target_tenant_id OR tenant_id IS NULL)
        ORDER BY tenant_id NULLS LAST, created_at ASC
        LIMIT 1;

        IF default_role_id IS NULL THEN
            SELECT id INTO default_role_id
            FROM public.roles
            WHERE deleted_at IS NULL
              AND tenant_id = target_tenant_id
              AND is_guest = false
              AND is_public = false
              AND is_tenant_admin = false
              AND is_platform_admin = false
              AND is_full_access = false
            ORDER BY is_staff ASC, staff_level DESC NULLS LAST, created_at ASC
            LIMIT 1;
        END IF;

        IF default_role_id IS NULL THEN
            SELECT id INTO default_role_id
            FROM public.roles
            WHERE deleted_at IS NULL
              AND (tenant_id = target_tenant_id OR tenant_id IS NULL)
              AND (is_guest = true OR is_public = true)
            ORDER BY tenant_id NULLS LAST, created_at ASC
            LIMIT 1;
        END IF;

        initial_approval_status := 'approved';
    END IF;

    INSERT INTO public.users (
        id,
        email,
        full_name,
        role_id,
        tenant_id,
        approval_status,
        created_at,
        updated_at
    )
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
        default_role_id,
        target_tenant_id,
        initial_approval_status,
        NOW(),
        NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        full_name = COALESCE(EXCLUDED.full_name, public.users.full_name),
        updated_at = NOW();

    RETURN NEW;
END;
$$;

ALTER TABLE public.extension_menu_items
  ADD COLUMN IF NOT EXISTS tenant_id uuid;

ALTER TABLE public.extension_permissions
  ADD COLUMN IF NOT EXISTS tenant_id uuid;

ALTER TABLE public.extension_rbac_integration
  ADD COLUMN IF NOT EXISTS tenant_id uuid;

ALTER TABLE public.extension_routes_registry
  ADD COLUMN IF NOT EXISTS tenant_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'extension_menu_items_tenant_id_fkey'
  ) THEN
    ALTER TABLE public.extension_menu_items
      ADD CONSTRAINT extension_menu_items_tenant_id_fkey
      FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'extension_permissions_tenant_id_fkey'
  ) THEN
    ALTER TABLE public.extension_permissions
      ADD CONSTRAINT extension_permissions_tenant_id_fkey
      FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'extension_rbac_integration_tenant_id_fkey'
  ) THEN
    ALTER TABLE public.extension_rbac_integration
      ADD CONSTRAINT extension_rbac_integration_tenant_id_fkey
      FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'extension_routes_registry_tenant_id_fkey'
  ) THEN
    ALTER TABLE public.extension_routes_registry
      ADD CONSTRAINT extension_routes_registry_tenant_id_fkey
      FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_extension_menu_items_tenant_id
  ON public.extension_menu_items (tenant_id);

CREATE INDEX IF NOT EXISTS idx_extension_permissions_tenant_id
  ON public.extension_permissions (tenant_id);

CREATE INDEX IF NOT EXISTS idx_extension_rbac_integration_tenant_id
  ON public.extension_rbac_integration (tenant_id);

CREATE INDEX IF NOT EXISTS idx_extension_routes_registry_tenant_id
  ON public.extension_routes_registry (tenant_id);

UPDATE public.extension_menu_items emi
SET tenant_id = e.tenant_id
FROM public.extensions e
WHERE emi.extension_id = e.id
  AND emi.tenant_id IS NULL;

UPDATE public.extension_permissions ep
SET tenant_id = e.tenant_id
FROM public.extensions e
WHERE ep.extension_id = e.id
  AND ep.tenant_id IS NULL;

UPDATE public.extension_routes_registry err
SET tenant_id = e.tenant_id
FROM public.extensions e
WHERE err.extension_id = e.id
  AND err.tenant_id IS NULL;

UPDATE public.extension_rbac_integration eri
SET tenant_id = e.tenant_id
FROM public.extensions e
WHERE eri.extension_id = e.id
  AND eri.tenant_id IS NULL
  AND e.tenant_id IS NOT NULL;

UPDATE public.extension_rbac_integration eri
SET tenant_id = r.tenant_id
FROM public.roles r
WHERE eri.tenant_id IS NULL
  AND eri.role_id = r.id;

CREATE OR REPLACE FUNCTION public.set_extension_tenant_id() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  extension_tenant uuid;
BEGIN
  IF NEW.extension_id IS NOT NULL THEN
    SELECT tenant_id INTO extension_tenant
    FROM public.extensions
    WHERE id = NEW.extension_id;

    IF extension_tenant IS NOT NULL THEN
      NEW.tenant_id := extension_tenant;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_extension_menu_items_tenant_id ON public.extension_menu_items;
CREATE TRIGGER set_extension_menu_items_tenant_id
  BEFORE INSERT OR UPDATE ON public.extension_menu_items
  FOR EACH ROW EXECUTE FUNCTION public.set_extension_tenant_id();

DROP TRIGGER IF EXISTS set_extension_permissions_tenant_id ON public.extension_permissions;
CREATE TRIGGER set_extension_permissions_tenant_id
  BEFORE INSERT OR UPDATE ON public.extension_permissions
  FOR EACH ROW EXECUTE FUNCTION public.set_extension_tenant_id();

DROP TRIGGER IF EXISTS set_extension_rbac_integration_tenant_id ON public.extension_rbac_integration;
CREATE TRIGGER set_extension_rbac_integration_tenant_id
  BEFORE INSERT OR UPDATE ON public.extension_rbac_integration
  FOR EACH ROW EXECUTE FUNCTION public.set_extension_tenant_id();

DROP TRIGGER IF EXISTS set_extension_routes_registry_tenant_id ON public.extension_routes_registry;
CREATE TRIGGER set_extension_routes_registry_tenant_id
  BEFORE INSERT OR UPDATE ON public.extension_routes_registry
  FOR EACH ROW EXECUTE FUNCTION public.set_extension_tenant_id();

DROP POLICY IF EXISTS "Admins manage extension_menu_items" ON public.extension_menu_items;
DROP POLICY IF EXISTS "extension_menu_items_select" ON public.extension_menu_items;
DROP POLICY IF EXISTS "extension_menu_items_insert" ON public.extension_menu_items;
DROP POLICY IF EXISTS "extension_menu_items_update" ON public.extension_menu_items;
DROP POLICY IF EXISTS "extension_menu_items_delete" ON public.extension_menu_items;

CREATE POLICY "extension_menu_items_select" ON public.extension_menu_items
  FOR SELECT
  USING (
    tenant_id = public.current_tenant_id()
    OR tenant_id IS NULL
    OR public.is_platform_admin()
  );

CREATE POLICY "extension_menu_items_insert" ON public.extension_menu_items
  FOR INSERT
  WITH CHECK (
    public.is_platform_admin()
    OR (tenant_id = public.current_tenant_id() AND public.is_admin_or_above())
  );

CREATE POLICY "extension_menu_items_update" ON public.extension_menu_items
  FOR UPDATE
  USING (
    public.is_platform_admin()
    OR (tenant_id = public.current_tenant_id() AND public.is_admin_or_above())
  )
  WITH CHECK (
    public.is_platform_admin()
    OR (tenant_id = public.current_tenant_id() AND public.is_admin_or_above())
  );

CREATE POLICY "extension_menu_items_delete" ON public.extension_menu_items
  FOR DELETE
  USING (
    public.is_platform_admin()
    OR (tenant_id = public.current_tenant_id() AND public.is_admin_or_above())
  );

DROP POLICY IF EXISTS "extension_permissions_select_auth" ON public.extension_permissions;
DROP POLICY IF EXISTS "extension_permissions_select" ON public.extension_permissions;
DROP POLICY IF EXISTS "extension_permissions_insert" ON public.extension_permissions;
DROP POLICY IF EXISTS "extension_permissions_update" ON public.extension_permissions;
DROP POLICY IF EXISTS "extension_permissions_delete" ON public.extension_permissions;
DROP POLICY IF EXISTS "extension_permissions_insert_admin" ON public.extension_permissions;
DROP POLICY IF EXISTS "extension_permissions_update_admin" ON public.extension_permissions;

CREATE POLICY "extension_permissions_select" ON public.extension_permissions
  FOR SELECT
  USING (
    tenant_id = public.current_tenant_id()
    OR tenant_id IS NULL
    OR public.is_platform_admin()
  );

CREATE POLICY "extension_permissions_insert" ON public.extension_permissions
  FOR INSERT
  WITH CHECK (
    public.is_platform_admin()
    OR (tenant_id = public.current_tenant_id() AND public.is_admin_or_above())
  );

CREATE POLICY "extension_permissions_update" ON public.extension_permissions
  FOR UPDATE
  USING (
    public.is_platform_admin()
    OR (tenant_id = public.current_tenant_id() AND public.is_admin_or_above())
  )
  WITH CHECK (
    public.is_platform_admin()
    OR (tenant_id = public.current_tenant_id() AND public.is_admin_or_above())
  );

CREATE POLICY "extension_permissions_delete" ON public.extension_permissions
  FOR DELETE
  USING (
    public.is_platform_admin()
    OR (tenant_id = public.current_tenant_id() AND public.is_admin_or_above())
  );

DROP POLICY IF EXISTS "extension_rbac_select" ON public.extension_rbac_integration;
DROP POLICY IF EXISTS "extension_rbac_select_scoped" ON public.extension_rbac_integration;

CREATE POLICY "extension_rbac_select_scoped" ON public.extension_rbac_integration
  FOR SELECT
  USING (
    tenant_id = public.current_tenant_id()
    OR public.is_platform_admin()
  );

DROP POLICY IF EXISTS "extension_routes_registry_select" ON public.extension_routes_registry;
DROP POLICY IF EXISTS "extension_routes_registry_insert" ON public.extension_routes_registry;
DROP POLICY IF EXISTS "extension_routes_registry_update" ON public.extension_routes_registry;
DROP POLICY IF EXISTS "extension_routes_registry_delete" ON public.extension_routes_registry;

CREATE POLICY "extension_routes_registry_select" ON public.extension_routes_registry
  FOR SELECT
  USING (
    deleted_at IS NULL
    AND (is_active = true OR public.is_platform_admin())
    AND (
      tenant_id = public.current_tenant_id()
      OR tenant_id IS NULL
      OR public.is_platform_admin()
    )
  );

CREATE POLICY "extension_routes_registry_insert" ON public.extension_routes_registry
  FOR INSERT
  WITH CHECK (
    public.is_platform_admin()
    OR (tenant_id = public.current_tenant_id() AND public.is_admin_or_above())
  );

CREATE POLICY "extension_routes_registry_update" ON public.extension_routes_registry
  FOR UPDATE
  USING (
    public.is_platform_admin()
    OR (tenant_id = public.current_tenant_id() AND public.is_admin_or_above())
  )
  WITH CHECK (
    public.is_platform_admin()
    OR (tenant_id = public.current_tenant_id() AND public.is_admin_or_above())
  );

CREATE POLICY "extension_routes_registry_delete" ON public.extension_routes_registry
  FOR DELETE
  USING (
    public.is_platform_admin()
    OR (tenant_id = public.current_tenant_id() AND public.is_admin_or_above())
  );

DO $$
DECLARE
  v_perm_id uuid;
BEGIN
  SELECT id INTO v_perm_id FROM public.permissions WHERE name = 'tenant.modules.read';

  IF v_perm_id IS NULL THEN
    INSERT INTO public.permissions (name, description, resource, action, module)
    VALUES ('tenant.modules.read', 'Can view modules list', 'modules', 'read', 'top_level')
    RETURNING id INTO v_perm_id;
  END IF;

  IF v_perm_id IS NOT NULL THEN
    INSERT INTO public.role_permissions (role_id, permission_id)
    SELECT r.id, v_perm_id
    FROM public.roles r
    WHERE r.deleted_at IS NULL
      AND (r.is_platform_admin OR r.is_full_access OR r.is_tenant_admin)
      AND NOT EXISTS (
        SELECT 1
        FROM public.role_permissions rp
        WHERE rp.role_id = r.id
          AND rp.permission_id = v_perm_id
          AND rp.deleted_at IS NULL
      );
  END IF;
END $$;
