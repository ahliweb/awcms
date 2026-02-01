-- Migration: Link Admin Menus to Resources Registry
-- Description: Enforces strict resource keys in admin_menus by adding a foreign key to resources_registry.

-- 1. Add resource_id column
ALTER TABLE public.admin_menus 
ADD COLUMN IF NOT EXISTS resource_id uuid REFERENCES public.resources_registry(id) ON DELETE SET NULL;

-- 2. Populate resource_id based on matching keys
UPDATE public.admin_menus am
SET resource_id = rr.id
FROM public.resources_registry rr
WHERE am.key = rr.key;

-- 3. (Optional) Enforce Foreign Key if we want strictness now, or just warn.
-- Let's keep it loose for now to allow 'custom' menu items that aren't resources,
-- but we should encourage resource linkage.

-- 4. Create an index for performance
CREATE INDEX IF NOT EXISTS idx_admin_menus_resource_id ON public.admin_menus(resource_id);
