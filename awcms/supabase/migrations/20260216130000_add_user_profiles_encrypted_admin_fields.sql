-- Migration: Add user profiles with encrypted admin fields
SET client_min_messages TO warning;

CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";

CREATE TABLE IF NOT EXISTS public.user_profiles (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  tenant_id uuid,
  description text,
  job_title text,
  department text,
  phone text,
  alternate_email text,
  location text,
  timezone text,
  website_url text,
  linkedin_url text,
  twitter_url text,
  github_url text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  deleted_at timestamp with time zone,
  created_by uuid,
  CONSTRAINT user_profiles_pkey PRIMARY KEY (id),
  CONSTRAINT user_profiles_user_id_key UNIQUE (user_id)
);

ALTER TABLE public.user_profiles OWNER TO postgres;

ALTER TABLE public.user_profiles
  ADD CONSTRAINT user_profiles_user_id_fkey
  FOREIGN KEY (user_id)
  REFERENCES public.users (id)
  ON DELETE RESTRICT;

ALTER TABLE public.user_profiles
  ADD CONSTRAINT user_profiles_tenant_id_fkey
  FOREIGN KEY (tenant_id)
  REFERENCES public.tenants (id)
  ON DELETE RESTRICT;

ALTER TABLE public.user_profiles
  ADD CONSTRAINT user_profiles_created_by_fkey
  FOREIGN KEY (created_by)
  REFERENCES public.users (id)
  ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_user_profiles_tenant_id ON public.user_profiles (tenant_id);

CREATE TABLE IF NOT EXISTS public.user_profile_admin (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  tenant_id uuid,
  admin_notes_encrypted bytea,
  admin_flags_encrypted bytea,
  admin_salt text NOT NULL DEFAULT encode(extensions.gen_random_bytes(16), 'hex'),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  deleted_at timestamp with time zone,
  created_by uuid,
  CONSTRAINT user_profile_admin_pkey PRIMARY KEY (id),
  CONSTRAINT user_profile_admin_user_id_key UNIQUE (user_id)
);

ALTER TABLE public.user_profile_admin OWNER TO postgres;

ALTER TABLE public.user_profile_admin
  ADD CONSTRAINT user_profile_admin_user_id_fkey
  FOREIGN KEY (user_id)
  REFERENCES public.users (id)
  ON DELETE RESTRICT;

ALTER TABLE public.user_profile_admin
  ADD CONSTRAINT user_profile_admin_tenant_id_fkey
  FOREIGN KEY (tenant_id)
  REFERENCES public.tenants (id)
  ON DELETE RESTRICT;

ALTER TABLE public.user_profile_admin
  ADD CONSTRAINT user_profile_admin_created_by_fkey
  FOREIGN KEY (created_by)
  REFERENCES public.users (id)
  ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_user_profile_admin_tenant_id ON public.user_profile_admin (tenant_id);

CREATE OR REPLACE FUNCTION public.derive_user_profile_passphrase(
  p_description text,
  p_salt text
) RETURNS text
  LANGUAGE sql STABLE
  SET search_path TO 'public', 'extensions', 'pg_temp'
  AS $$
  SELECT encode(
    extensions.digest(
      coalesce(p_description, '') || ':' || coalesce(p_salt, ''),
      'sha256'
    ),
    'hex'
  );
$$;

CREATE OR REPLACE FUNCTION public.encrypt_user_profile_admin_field(
  p_value text,
  p_description text,
  p_salt text
) RETURNS bytea
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public', 'extensions', 'pg_temp'
  AS $$
BEGIN
  IF p_value IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN extensions.pgp_sym_encrypt(
    p_value,
    public.derive_user_profile_passphrase(p_description, p_salt)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.decrypt_user_profile_admin_field(
  p_value bytea,
  p_description text,
  p_salt text
) RETURNS text
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public', 'extensions', 'pg_temp'
  AS $$
BEGIN
  IF p_value IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN extensions.pgp_sym_decrypt(
    p_value,
    public.derive_user_profile_passphrase(p_description, p_salt)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.create_user_profile() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public', 'extensions', 'pg_temp'
  AS $$
BEGIN
  INSERT INTO public.user_profiles (user_id, tenant_id)
  VALUES (NEW.id, NEW.tenant_id)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.rekey_user_profile_admin_fields() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public', 'extensions', 'pg_temp'
  AS $$
DECLARE
  v_admin public.user_profile_admin%ROWTYPE;
  v_notes text;
  v_flags text;
BEGIN
  IF NEW.description IS NOT DISTINCT FROM OLD.description THEN
    RETURN NEW;
  END IF;

  SELECT *
  INTO v_admin
  FROM public.user_profile_admin
  WHERE user_id = NEW.user_id
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  v_notes := public.decrypt_user_profile_admin_field(
    v_admin.admin_notes_encrypted,
    OLD.description,
    v_admin.admin_salt
  );

  v_flags := public.decrypt_user_profile_admin_field(
    v_admin.admin_flags_encrypted,
    OLD.description,
    v_admin.admin_salt
  );

  UPDATE public.user_profile_admin
  SET admin_notes_encrypted = public.encrypt_user_profile_admin_field(
        v_notes,
        NEW.description,
        v_admin.admin_salt
      ),
      admin_flags_encrypted = public.encrypt_user_profile_admin_field(
        v_flags,
        NEW.description,
        v_admin.admin_salt
      ),
      updated_at = now()
  WHERE id = v_admin.id;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_user_profile_admin_fields(
  p_user_id uuid
) RETURNS TABLE (
  admin_notes text,
  admin_flags text
)
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public', 'extensions', 'pg_temp'
  AS $$
DECLARE
  v_target_tenant uuid;
BEGIN
  SELECT tenant_id
  INTO v_target_tenant
  FROM public.users
  WHERE id = p_user_id;

  IF v_target_tenant IS NULL THEN
    RETURN;
  END IF;

  IF NOT (
    public.is_platform_admin()
    OR public.tenant_can_access_resource(v_target_tenant, 'users', 'write')
    OR (
      v_target_tenant = public.current_tenant_id()
      AND (public.is_admin_or_above() OR public.has_permission('tenant.user.update'))
    )
  ) THEN
    RAISE EXCEPTION 'Not authorized to access admin profile fields';
  END IF;

  RETURN QUERY
  SELECT
    public.decrypt_user_profile_admin_field(
      admin.admin_notes_encrypted,
      profile.description,
      admin.admin_salt
    ) AS admin_notes,
    public.decrypt_user_profile_admin_field(
      admin.admin_flags_encrypted,
      profile.description,
      admin.admin_salt
    ) AS admin_flags
  FROM public.user_profile_admin admin
  JOIN public.user_profiles profile
    ON profile.user_id = admin.user_id
  WHERE admin.user_id = p_user_id
    AND admin.deleted_at IS NULL
    AND profile.deleted_at IS NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_user_profile_admin_fields(
  p_user_id uuid,
  p_admin_notes text,
  p_admin_flags text
) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public', 'extensions', 'pg_temp'
  AS $$
DECLARE
  v_target_tenant uuid;
  v_description text;
  v_admin_salt text;
BEGIN
  SELECT tenant_id
  INTO v_target_tenant
  FROM public.users
  WHERE id = p_user_id;

  IF v_target_tenant IS NULL THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  IF NOT (
    public.is_platform_admin()
    OR public.tenant_can_access_resource(v_target_tenant, 'users', 'write')
    OR (
      v_target_tenant = public.current_tenant_id()
      AND (public.is_admin_or_above() OR public.has_permission('tenant.user.update'))
    )
  ) THEN
    RAISE EXCEPTION 'Not authorized to update admin profile fields';
  END IF;

  INSERT INTO public.user_profiles (user_id, tenant_id)
  VALUES (p_user_id, v_target_tenant)
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.user_profile_admin (user_id, tenant_id)
  VALUES (p_user_id, v_target_tenant)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT description
  INTO v_description
  FROM public.user_profiles
  WHERE user_id = p_user_id
    AND deleted_at IS NULL;

  SELECT admin_salt
  INTO v_admin_salt
  FROM public.user_profile_admin
  WHERE user_id = p_user_id
    AND deleted_at IS NULL;

  UPDATE public.user_profile_admin
  SET admin_notes_encrypted = public.encrypt_user_profile_admin_field(
        p_admin_notes,
        v_description,
        v_admin_salt
      ),
      admin_flags_encrypted = public.encrypt_user_profile_admin_field(
        p_admin_flags,
        v_description,
        v_admin_salt
      ),
      updated_at = now()
  WHERE user_id = p_user_id;
END;
$$;

CREATE TRIGGER set_created_by_trg
  BEFORE INSERT ON public.user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.set_created_by();

CREATE TRIGGER set_created_by_trg
  BEFORE INSERT ON public.user_profile_admin
  FOR EACH ROW
  EXECUTE FUNCTION public.set_created_by();

CREATE TRIGGER update_user_profiles_updated_at
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_user_profile_admin_updated_at
  BEFORE UPDATE ON public.user_profile_admin
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trigger_user_profiles_rekey_admin
  AFTER UPDATE OF description ON public.user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.rekey_user_profile_admin_fields();

CREATE TRIGGER trigger_create_user_profile
  AFTER INSERT ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.create_user_profile();

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_profiles_select_self_or_admin
  ON public.user_profiles
  FOR SELECT
  USING (
    public.is_platform_admin()
    OR public.tenant_can_access_resource(tenant_id, 'users', 'read')
    OR (
      tenant_id = public.current_tenant_id()
      AND (user_id = auth.uid() OR public.is_admin_or_above() OR public.has_permission('tenant.user.update'))
    )
  );

CREATE POLICY user_profiles_insert_self_or_admin
  ON public.user_profiles
  FOR INSERT
  WITH CHECK (
    public.is_platform_admin()
    OR public.tenant_can_access_resource(tenant_id, 'users', 'write')
    OR (
      tenant_id = public.current_tenant_id()
      AND (user_id = auth.uid() OR public.is_admin_or_above() OR public.has_permission('tenant.user.update'))
    )
  );

CREATE POLICY user_profiles_update_self_or_admin
  ON public.user_profiles
  FOR UPDATE
  USING (
    public.is_platform_admin()
    OR public.tenant_can_access_resource(tenant_id, 'users', 'write')
    OR (
      tenant_id = public.current_tenant_id()
      AND (user_id = auth.uid() OR public.is_admin_or_above() OR public.has_permission('tenant.user.update'))
    )
  )
  WITH CHECK (
    public.is_platform_admin()
    OR public.tenant_can_access_resource(tenant_id, 'users', 'write')
    OR (
      tenant_id = public.current_tenant_id()
      AND (user_id = auth.uid() OR public.is_admin_or_above() OR public.has_permission('tenant.user.update'))
    )
  );

ALTER TABLE public.user_profile_admin ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_profile_admin_select_admin
  ON public.user_profile_admin
  FOR SELECT
  USING (
    public.is_platform_admin()
    OR public.tenant_can_access_resource(tenant_id, 'users', 'write')
    OR (
      tenant_id = public.current_tenant_id()
      AND (public.is_admin_or_above() OR public.has_permission('tenant.user.update'))
    )
  );

CREATE POLICY user_profile_admin_insert_admin
  ON public.user_profile_admin
  FOR INSERT
  WITH CHECK (
    public.is_platform_admin()
    OR public.tenant_can_access_resource(tenant_id, 'users', 'write')
    OR (
      tenant_id = public.current_tenant_id()
      AND (public.is_admin_or_above() OR public.has_permission('tenant.user.update'))
    )
  );

CREATE POLICY user_profile_admin_update_admin
  ON public.user_profile_admin
  FOR UPDATE
  USING (
    public.is_platform_admin()
    OR public.tenant_can_access_resource(tenant_id, 'users', 'write')
    OR (
      tenant_id = public.current_tenant_id()
      AND (public.is_admin_or_above() OR public.has_permission('tenant.user.update'))
    )
  )
  WITH CHECK (
    public.is_platform_admin()
    OR public.tenant_can_access_resource(tenant_id, 'users', 'write')
    OR (
      tenant_id = public.current_tenant_id()
      AND (public.is_admin_or_above() OR public.has_permission('tenant.user.update'))
    )
  );

INSERT INTO public.user_profiles (user_id, tenant_id)
SELECT id, tenant_id
FROM public.users
WHERE deleted_at IS NULL
ON CONFLICT (user_id) DO NOTHING;
