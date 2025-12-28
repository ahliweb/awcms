-- ============================================
-- Mobile Admin Module Schema for AWCMS
-- ============================================

-- Mobile Users Table (registered app users)
CREATE TABLE IF NOT EXISTS public.mobile_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  device_token TEXT,
  device_type TEXT CHECK (device_type IN ('ios', 'android', 'web')),
  device_name TEXT,
  app_version TEXT,
  os_version TEXT,
  last_active TIMESTAMPTZ,
  push_enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_mobile_users_tenant ON public.mobile_users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_mobile_users_user ON public.mobile_users(user_id);
CREATE INDEX IF NOT EXISTS idx_mobile_users_device ON public.mobile_users(device_type);
CREATE INDEX IF NOT EXISTS idx_mobile_users_active ON public.mobile_users(last_active DESC);

-- Push Notifications Table
CREATE TABLE IF NOT EXISTS public.push_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT,
  image_url TEXT,
  action_url TEXT,
  data JSONB DEFAULT '{}',
  target_type TEXT DEFAULT 'all' CHECK (target_type IN ('all', 'user', 'segment', 'topic')),
  target_ids UUID[],
  target_topics TEXT[],
  scheduled_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  sent_count INTEGER DEFAULT 0,
  failed_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'sending', 'sent', 'failed')),
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_push_notifications_tenant ON public.push_notifications(tenant_id);
CREATE INDEX IF NOT EXISTS idx_push_notifications_status ON public.push_notifications(status);
CREATE INDEX IF NOT EXISTS idx_push_notifications_created ON public.push_notifications(created_at DESC);

-- Mobile App Config Table (per-tenant app settings)
CREATE TABLE IF NOT EXISTS public.mobile_app_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE UNIQUE,
  app_name TEXT,
  app_logo_url TEXT,
  app_icon_url TEXT,
  primary_color TEXT DEFAULT '#3b82f6',
  secondary_color TEXT DEFAULT '#10b981',
  force_update_version TEXT,
  recommended_version TEXT,
  maintenance_mode BOOLEAN DEFAULT false,
  maintenance_message TEXT,
  features JSONB DEFAULT '{"articles": true, "notifications": true, "offline": true}',
  config JSONB DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id)
);

-- ============================================
-- RLS Policies
-- ============================================

ALTER TABLE public.mobile_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mobile_app_config ENABLE ROW LEVEL SECURITY;

-- Mobile Users: Tenant isolation
CREATE POLICY "mobile_users_tenant_policy" ON public.mobile_users
  FOR ALL USING (
    tenant_id = (SELECT NULLIF(current_setting('request.jwt.claims', true)::json->>'tenant_id', '')::uuid)
  );

-- Push Notifications: Tenant isolation
CREATE POLICY "push_notifications_tenant_policy" ON public.push_notifications
  FOR ALL USING (
    tenant_id = (SELECT NULLIF(current_setting('request.jwt.claims', true)::json->>'tenant_id', '')::uuid)
  );

-- Mobile App Config: Tenant isolation
CREATE POLICY "mobile_app_config_tenant_policy" ON public.mobile_app_config
  FOR ALL USING (
    tenant_id = (SELECT NULLIF(current_setting('request.jwt.claims', true)::json->>'tenant_id', '')::uuid)
  );

-- Service role policies for mobile app API
CREATE POLICY "mobile_users_service_policy" ON public.mobile_users
  FOR ALL USING (auth.jwt()->>'role' = 'service_role');

CREATE POLICY "mobile_app_config_public_read" ON public.mobile_app_config
  FOR SELECT USING (true);

-- ============================================
-- Enable Realtime
-- ============================================

ALTER PUBLICATION supabase_realtime ADD TABLE public.mobile_users;
ALTER PUBLICATION supabase_realtime ADD TABLE public.push_notifications;

-- ============================================
-- Triggers
-- ============================================

CREATE OR REPLACE FUNCTION update_mobile_users_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER mobile_users_updated_at_trigger
  BEFORE UPDATE ON public.mobile_users
  FOR EACH ROW
  EXECUTE FUNCTION update_mobile_users_updated_at();

CREATE OR REPLACE FUNCTION update_mobile_app_config_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER mobile_app_config_updated_at_trigger
  BEFORE UPDATE ON public.mobile_app_config
  FOR EACH ROW
  EXECUTE FUNCTION update_mobile_app_config_updated_at();

-- ============================================
-- Comments
-- ============================================

COMMENT ON TABLE public.mobile_users IS 'Registered mobile app users and their devices';
COMMENT ON TABLE public.push_notifications IS 'Push notification campaigns and history';
COMMENT ON TABLE public.mobile_app_config IS 'Per-tenant mobile app configuration';
