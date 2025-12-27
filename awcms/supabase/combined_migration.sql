-- ============================================
-- AWCMS COMBINED SQL MIGRATION
-- Run this in Supabase SQL Editor
-- ============================================


-- ============================================
-- PART 1: NOTIFICATIONS TABLE
-- ============================================

-- 1. Create notifications table
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT,
  type TEXT NOT NULL DEFAULT 'info' CHECK (type IN ('info', 'warning', 'success', 'error')),
  data JSONB,
  is_read BOOLEAN DEFAULT FALSE,
  channel TEXT DEFAULT 'mobile',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Create indexes
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_tenant_id ON notifications(tenant_id);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(is_read) WHERE is_read = FALSE;

-- 3. Enable RLS
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- 4. RLS Policies for notifications
DROP POLICY IF EXISTS "Users can read own notifications" ON notifications;
CREATE POLICY "Users can read own notifications"
ON notifications FOR SELECT
USING (user_id = auth.uid() OR user_id IS NULL);

DROP POLICY IF EXISTS "Users can update own notifications" ON notifications;
CREATE POLICY "Users can update own notifications"
ON notifications FOR UPDATE
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete own notifications" ON notifications;
CREATE POLICY "Users can delete own notifications"
ON notifications FOR DELETE
USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Service role can insert notifications" ON notifications;
CREATE POLICY "Service role can insert notifications"
ON notifications FOR INSERT
WITH CHECK (true);

-- 5. Enable Realtime for notifications
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' 
    AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
  END IF;
END $$;

-- 6. Create trigger for updated_at
CREATE OR REPLACE FUNCTION update_notifications_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_notifications_updated_at ON notifications;
CREATE TRIGGER trigger_notifications_updated_at
  BEFORE UPDATE ON notifications
  FOR EACH ROW
  EXECUTE FUNCTION update_notifications_updated_at();


-- ============================================
-- PART 2: FIX SECURITY ADVISOR ISSUES
-- ============================================

-- Fix Security Definer View
DROP VIEW IF EXISTS public.published_articles_view;

CREATE VIEW public.published_articles_view 
WITH (security_invoker = true)
AS
SELECT 
  id,
  tenant_id,
  title,
  content,
  excerpt,
  cover_image,
  status,
  owner_id,
  created_at,
  updated_at
FROM public.articles
WHERE status = 'published'
  AND deleted_at IS NULL;

GRANT SELECT ON public.published_articles_view TO authenticated;
GRANT SELECT ON public.published_articles_view TO anon;


-- ============================================
-- PART 3: FIX PERFORMANCE ADVISOR ISSUES
-- ============================================

-- Create helper functions (evaluated once per query)
CREATE OR REPLACE FUNCTION get_current_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid()
$$;

CREATE OR REPLACE FUNCTION get_current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NULLIF(current_setting('request.jwt.claims', true)::json->>'tenant_id', '')::uuid
$$;

-- Optimized RLS policy using subquery pattern
DROP POLICY IF EXISTS "articles_select_policy" ON public.articles;

CREATE POLICY "articles_select_policy" ON public.articles
FOR SELECT
USING (
  -- Published articles are public
  (status = 'published' AND deleted_at IS NULL)
  OR
  -- Owner can see their own articles (subquery evaluates once)
  (owner_id = (SELECT auth.uid()))
  OR
  -- Same tenant members can see tenant articles
  (tenant_id = (SELECT NULLIF(current_setting('request.jwt.claims', true)::json->>'tenant_id', '')::uuid))
);


-- ============================================
-- VERIFICATION QUERIES
-- ============================================
-- Run these to verify:

-- Check notifications table exists:
-- SELECT COUNT(*) FROM notifications;

-- Check Realtime enabled:
-- SELECT * FROM pg_publication_tables WHERE pubname = 'supabase_realtime';

-- Check view security:
-- SELECT schemaname, viewname FROM pg_views WHERE viewname = 'published_articles_view';

-- Check RLS policies:
-- SELECT * FROM pg_policies WHERE tablename = 'articles';
