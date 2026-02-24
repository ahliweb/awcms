
-- Fix Guest Checkout: Allow anonymous users to create orders
DROP POLICY IF EXISTS "Enable insert for anonymous users" ON "public"."orders";
CREATE POLICY "Enable insert for anonymous users"
ON "public"."orders"
FOR INSERT
TO anon
WITH CHECK (true);

-- Fix Public Read for Blogs: Allow public access to published blogs
DROP POLICY IF EXISTS "Enable read access for all users" ON "public"."blogs";
CREATE POLICY "Enable read access for all users"
ON "public"."blogs"
FOR SELECT
TO public
USING (status = 'published');

-- Fix Public Read for Categories: Allow public access to categories (needed for blog joins)
DROP POLICY IF EXISTS "Enable read access for all users" ON "public"."categories";
CREATE POLICY "Enable read access for all users"
ON "public"."categories"
FOR SELECT
TO public
USING (true);
