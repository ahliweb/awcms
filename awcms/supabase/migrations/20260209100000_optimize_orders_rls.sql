-- Optimize security policies for orders table
-- 1. Split "select" policy into "view own" (fast) and "view tenant/admin" (slower but restricted)
-- 2. Ensure tenant isolation for non-super-admins

-- Drop existing inefficient policies
DROP POLICY IF EXISTS "Users view own orders" ON "public"."orders";
DROP POLICY IF EXISTS "Users create own orders" ON "public"."orders";

-- 1. Simple, fast policy for users viewing their own orders
CREATE POLICY "orders_select_own" 
ON "public"."orders" 
FOR SELECT 
TO authenticated 
USING ( auth.uid() = user_id );

-- 2. Policy for users creating their own orders
CREATE POLICY "orders_insert_own" 
ON "public"."orders" 
FOR INSERT 
TO authenticated 
WITH CHECK ( auth.uid() = user_id );

-- 3. Policy for Admins and Editors (Tenant Scoped)
-- They can view all orders belonging to their tenant
CREATE POLICY "orders_select_tenant_staff" 
ON "public"."orders" 
FOR SELECT 
TO authenticated 
USING (
  (
    -- Check if user is in the same tenant as the order
    tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid())
    AND
    -- Check if user has staff role
    (SELECT public.get_my_role_name()) IN ('admin', 'editor')
  )
  OR
  -- Super admins can see everything (global role, no tenant check needed or they match special cases)
  (SELECT public.get_my_role_name()) = 'super_admin'
);

-- Ensure RLS is enabled
ALTER TABLE "public"."orders" ENABLE ROW LEVEL SECURITY;
