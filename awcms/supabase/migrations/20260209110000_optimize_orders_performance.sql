-- Optimize orders RLS performance based on Context7 best practices

-- Drop policies created in the previous step to replace them with optimized versions
DROP POLICY IF EXISTS "orders_select_own" ON "public"."orders";
DROP POLICY IF EXISTS "orders_insert_own" ON "public"."orders";
DROP POLICY IF EXISTS "orders_select_tenant_staff" ON "public"."orders";

-- 1. Optimized "view own" policy
-- Uses (select auth.uid()) for better query plan stability and caching
CREATE POLICY "orders_select_own" 
ON "public"."orders" 
FOR SELECT 
TO authenticated 
USING ( 
  user_id = (select auth.uid()) 
);

-- 2. Optimized "create own" policy
CREATE POLICY "orders_insert_own" 
ON "public"."orders" 
FOR INSERT 
TO authenticated 
WITH CHECK ( 
  user_id = (select auth.uid()) 
);

-- 3. Optimized "tenant staff" policy
-- Uses public.current_tenant_id() which leverages JWT claims/app settings for performance
-- Uses public.is_platform_admin() for consistent and efficient admin checks
CREATE POLICY "orders_select_tenant_staff" 
ON "public"."orders" 
FOR SELECT 
TO authenticated 
USING (
  (
    -- Check if user is in the same tenant using optimized function
    tenant_id = public.current_tenant_id()
    AND
    -- Check if user has staff role (admin/editor) within that tenant
    (SELECT public.get_my_role_name()) IN ('admin', 'editor')
  )
  OR
  -- Super admins can see everything
  public.is_platform_admin()
);
