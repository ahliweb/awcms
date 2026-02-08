-- Migration to fix Orders RLS policies and permissions

-- 1. Ensure permissions exist for orders module
DO $$
BEGIN
    -- Create permissions if they don't exist
    IF NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'view_orders') THEN
        INSERT INTO permissions (name, resource, action, description, created_at, updated_at)
        VALUES ('view_orders', 'orders', 'view', 'Can view orders', now(), now());
    END IF;

    IF NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'create_orders') THEN
        INSERT INTO permissions (name, resource, action, description, created_at, updated_at)
        VALUES ('create_orders', 'orders', 'create', 'Can create orders', now(), now());
    END IF;

    IF NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'edit_orders') THEN
        INSERT INTO permissions (name, resource, action, description, created_at, updated_at)
        VALUES ('edit_orders', 'orders', 'edit', 'Can edit orders', now(), now());
    END IF;

    IF NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'delete_orders') THEN
        INSERT INTO permissions (name, resource, action, description, created_at, updated_at)
        VALUES ('delete_orders', 'orders', 'delete', 'Can delete orders', now(), now());
    END IF;
END $$;

-- 2. Update RLS Policy for INSERT on orders table
-- Drop restrictions
DROP POLICY IF EXISTS "Users create own orders" ON "public"."orders";
DROP POLICY IF EXISTS "Enable insert for authenticated users with permission" ON "public"."orders";

-- Ensure permissions exist (using the correct names found in session)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'tenant.orders.create') THEN
        INSERT INTO permissions (name, resource, action, description, created_at, updated_at) VALUES ('tenant.orders.create', 'orders', 'create', 'Can create orders', now(), now());
    END IF;
    -- Also ensure standard CRUD permissions exist
    IF NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'tenant.orders.read') THEN
        INSERT INTO permissions (name, resource, action, description, created_at, updated_at) VALUES ('tenant.orders.read', 'orders', 'view', 'Can view orders', now(), now());
    END IF;
END $$;

-- Create a more permissive policy that allows admins and tenant staff to create orders
CREATE POLICY "Enable insert for authenticated users with permission" ON "public"."orders"
FOR INSERT TO authenticated
WITH CHECK (
  -- User creating their own order (if app logic supports self-registration of orders)
  (user_id = auth.uid()) 
  OR 
  -- Platform admins can create orders for anyone
  (public.is_platform_admin()) 
  OR 
  -- Tenant staff with permission can create orders within their tenant
  (
    (tenant_id = public.current_tenant_id()) 
    AND 
    (
      public.has_permission('create_orders'::text) 
      OR 
      public.has_permission('tenant.orders.create'::text)
    )
  )
);

-- Ensure RLS is enabled
ALTER TABLE "public"."orders" ENABLE ROW LEVEL SECURITY;

-- Grant permissions explicitly
GRANT ALL ON TABLE "public"."orders" TO "anon";
GRANT ALL ON TABLE "public"."orders" TO "authenticated";
GRANT ALL ON TABLE "public"."orders" TO "service_role";
