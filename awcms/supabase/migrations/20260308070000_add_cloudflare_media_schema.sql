-- Migration: Add Cloudflare Media Schema
-- Date: 2026-03-08
-- Purpose: Schema for tracking media objects stored in Cloudflare R2

BEGIN;

CREATE TABLE IF NOT EXISTS public.media_objects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL,
    original_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes BIGINT NOT NULL,
    storage_key TEXT NOT NULL UNIQUE,  -- The R2 key
    status TEXT NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploading', 'uploaded', 'processing', 'failed', 'deleted')),
    access_control TEXT NOT NULL DEFAULT 'private' CHECK (access_control IN ('public', 'private', 'tenant_only')),
    meta_data JSONB DEFAULT '{}'::jsonb,
    uploader_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.media_variants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    media_object_id UUID NOT NULL REFERENCES public.media_objects(id) ON DELETE CASCADE,
    variant_name TEXT NOT NULL, -- e.g., 'thumbnail', 'medium', 'large', 'webp'
    storage_key TEXT NOT NULL UNIQUE,
    mime_type TEXT NOT NULL,
    size_bytes BIGINT NOT NULL,
    width INTEGER,
    height INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.media_upload_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    uploader_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes BIGINT,
    storage_key TEXT NOT NULL UNIQUE,
    upload_url TEXT NOT NULL, -- The pre-signed URL
    expires_at TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'expired')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.media_access_audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    media_object_id UUID NOT NULL REFERENCES public.media_objects(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    accessor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    action TEXT NOT NULL, -- 'read', 'download', 'delete', 'update'
    ip_address TEXT,
    user_agent TEXT,
    accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_media_objects_tenant_id ON public.media_objects(tenant_id);
CREATE INDEX IF NOT EXISTS idx_media_objects_storage_key ON public.media_objects(storage_key);
CREATE INDEX IF NOT EXISTS idx_media_variants_media_id ON public.media_variants(media_object_id);
CREATE INDEX IF NOT EXISTS idx_media_upload_sessions_tenant_id ON public.media_upload_sessions(tenant_id);

-- RLS
ALTER TABLE public.media_objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media_upload_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media_access_audit ENABLE ROW LEVEL SECURITY;

-- Policies for media_objects
CREATE POLICY media_objects_select_unified
    ON public.media_objects
    FOR SELECT
    TO public
    USING (
        (access_control = 'public' AND deleted_at IS NULL AND status = 'uploaded')
        OR
        (
            tenant_id = public.current_tenant_id()
            AND deleted_at IS NULL
        )
        OR
        public.is_platform_admin()
    );

CREATE POLICY media_objects_insert_auth
    ON public.media_objects
    FOR INSERT
    TO authenticated
    WITH CHECK (
        tenant_id = public.current_tenant_id()
        OR
        public.is_platform_admin()
    );

CREATE POLICY media_objects_update_auth
    ON public.media_objects
    FOR UPDATE
    TO authenticated
    USING (
        tenant_id = public.current_tenant_id()
        OR
        public.is_platform_admin()
    )
    WITH CHECK (
        tenant_id = public.current_tenant_id()
        OR
        public.is_platform_admin()
    );

-- Policies for media_variants
CREATE POLICY media_variants_select_unified
    ON public.media_variants
    FOR SELECT
    TO public
    USING (
        media_object_id IN (
            SELECT id FROM public.media_objects 
            WHERE 
                (access_control = 'public' AND deleted_at IS NULL AND status = 'uploaded')
                OR (tenant_id = public.current_tenant_id() AND deleted_at IS NULL)
                OR public.is_platform_admin()
        )
    );

CREATE POLICY media_variants_insert_auth
    ON public.media_variants
    FOR INSERT
    TO authenticated
    WITH CHECK (
        media_object_id IN (
            SELECT id FROM public.media_objects 
            WHERE (tenant_id = public.current_tenant_id() OR public.is_platform_admin())
        )
    );

-- Policies for media_upload_sessions
CREATE POLICY media_upload_sessions_select_auth
    ON public.media_upload_sessions
    FOR SELECT
    TO authenticated
    USING (
        tenant_id = public.current_tenant_id()
        OR public.is_platform_admin()
    );

CREATE POLICY media_upload_sessions_insert_auth
    ON public.media_upload_sessions
    FOR INSERT
    TO authenticated
    WITH CHECK (
        tenant_id = public.current_tenant_id()
        OR public.is_platform_admin()
    );

CREATE POLICY media_upload_sessions_update_auth
    ON public.media_upload_sessions
    FOR UPDATE
    TO authenticated
    USING (
        tenant_id = public.current_tenant_id()
        OR public.is_platform_admin()
    )
    WITH CHECK (
        tenant_id = public.current_tenant_id()
        OR public.is_platform_admin()
    );

-- Policies for media_access_audit (Admin only reads or system level insert)
CREATE POLICY media_access_audit_select_auth
    ON public.media_access_audit
    FOR SELECT
    TO authenticated
    USING (
        tenant_id = public.current_tenant_id()
        OR public.is_platform_admin()
    );

CREATE POLICY media_access_audit_insert_auth
    ON public.media_access_audit
    FOR INSERT
    TO authenticated
    WITH CHECK (
        tenant_id = public.current_tenant_id()
        OR public.is_platform_admin()
    );

-- Add resource to registry so it can have permissions via ABAC
INSERT INTO public.resources_registry (
    key,
    label,
    scope,
    type,
    db_table,
    icon,
    permission_prefix,
    active,
    created_at,
    updated_at
)
VALUES (
    'media_objects',
    'Media Objects',
    'tenant',
    'media',
    'media_objects',
    'Image',
    'tenant.media',
    true,
    NOW(),
    NOW()
)
ON CONFLICT (key) DO UPDATE
SET
    label = EXCLUDED.label,
    scope = EXCLUDED.scope,
    type = EXCLUDED.type,
    db_table = EXCLUDED.db_table,
    icon = EXCLUDED.icon,
    permission_prefix = EXCLUDED.permission_prefix,
    active = EXCLUDED.active,
    updated_at = NOW();

COMMIT;
