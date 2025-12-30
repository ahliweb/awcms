-- Migration: Fix Menus Table Schema
-- Date: 2025-12-31
-- Description: Ensures 'menus' table has the necessary columns (group_label, label, url) used by the onboarding RPC.
-- This handles cases where the remote schema is simpler than the documented schema.

DO $$
BEGIN
    -- Ensure 'menus' table exists (it should, as per generic loop)
    CREATE TABLE IF NOT EXISTS public.menus (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID REFERENCES public.tenants(id),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Add columns if missing
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'menus' AND column_name = 'group_label') THEN
        ALTER TABLE public.menus ADD COLUMN group_label TEXT DEFAULT 'header';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'menus' AND column_name = 'label') THEN
        ALTER TABLE public.menus ADD COLUMN label TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'menus' AND column_name = 'url') THEN
        ALTER TABLE public.menus ADD COLUMN url TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'menus' AND column_name = 'is_public') THEN
        ALTER TABLE public.menus ADD COLUMN is_public BOOLEAN DEFAULT TRUE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'menus' AND column_name = 'is_active') THEN
        ALTER TABLE public.menus ADD COLUMN is_active BOOLEAN DEFAULT TRUE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'menus' AND column_name = 'order') THEN
        ALTER TABLE public.menus ADD COLUMN "order" INTEGER DEFAULT 0;
    END IF;

END $$;
