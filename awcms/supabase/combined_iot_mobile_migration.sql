-- ============================================
-- AWCMS Combined Migration
-- ESP32 IoT + Mobile Admin Schema
-- Execute in Supabase SQL Editor
-- ============================================

-- ============================================
-- PART 1: ESP32 IoT Devices
-- ============================================

-- Devices Table
CREATE TABLE IF NOT EXISTS public.devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  device_name TEXT,
  device_type TEXT DEFAULT 'esp32',
  ip_address TEXT,
  mac_address TEXT,
  firmware_version TEXT DEFAULT '1.0.0',
  is_online BOOLEAN DEFAULT false,
  last_seen TIMESTAMPTZ,
  config JSONB DEFAULT '{}',
  owner_id UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE(tenant_id, device_id)
);

-- Sensor Readings Table
CREATE TABLE IF NOT EXISTS public.sensor_readings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  gas_ppm FLOAT,
  gas_level TEXT,
  temperature FLOAT,
  humidity FLOAT,
  raw_data JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_devices_tenant ON public.devices(tenant_id);
CREATE INDEX IF NOT EXISTS idx_devices_device_id ON public.devices(device_id);
CREATE INDEX IF NOT EXISTS idx_sensor_readings_tenant ON public.sensor_readings(tenant_id);
CREATE INDEX IF NOT EXISTS idx_sensor_readings_device ON public.sensor_readings(device_id);

-- ============================================
-- PART 2: Mobile Admin
-- ============================================

-- Mobile Users Table
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

-- Mobile App Config Table
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

-- Indexes
CREATE INDEX IF NOT EXISTS idx_mobile_users_tenant ON public.mobile_users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_push_notifications_tenant ON public.push_notifications(tenant_id);

-- ============================================
-- PART 3: RLS Policies
-- ============================================

ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sensor_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mobile_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mobile_app_config ENABLE ROW LEVEL SECURITY;

-- Devices policies
DROP POLICY IF EXISTS "devices_select_policy" ON public.devices;
CREATE POLICY "devices_select_policy" ON public.devices
  FOR SELECT USING (
    tenant_id = (SELECT NULLIF(current_setting('request.jwt.claims', true)::json->>'tenant_id', '')::uuid)
    AND deleted_at IS NULL
  );

DROP POLICY IF EXISTS "devices_insert_policy" ON public.devices;
CREATE POLICY "devices_insert_policy" ON public.devices
  FOR INSERT WITH CHECK (
    tenant_id = (SELECT NULLIF(current_setting('request.jwt.claims', true)::json->>'tenant_id', '')::uuid)
  );

DROP POLICY IF EXISTS "devices_update_policy" ON public.devices;
CREATE POLICY "devices_update_policy" ON public.devices
  FOR UPDATE USING (
    tenant_id = (SELECT NULLIF(current_setting('request.jwt.claims', true)::json->>'tenant_id', '')::uuid)
  );

-- Sensor readings policies
DROP POLICY IF EXISTS "sensor_readings_select_policy" ON public.sensor_readings;
CREATE POLICY "sensor_readings_select_policy" ON public.sensor_readings
  FOR SELECT USING (
    tenant_id = (SELECT NULLIF(current_setting('request.jwt.claims', true)::json->>'tenant_id', '')::uuid)
  );

DROP POLICY IF EXISTS "sensor_readings_insert_policy" ON public.sensor_readings;
CREATE POLICY "sensor_readings_insert_policy" ON public.sensor_readings
  FOR INSERT WITH CHECK (
    tenant_id = (SELECT NULLIF(current_setting('request.jwt.claims', true)::json->>'tenant_id', '')::uuid)
  );

-- Mobile users policies
DROP POLICY IF EXISTS "mobile_users_tenant_policy" ON public.mobile_users;
CREATE POLICY "mobile_users_tenant_policy" ON public.mobile_users
  FOR ALL USING (
    tenant_id = (SELECT NULLIF(current_setting('request.jwt.claims', true)::json->>'tenant_id', '')::uuid)
  );

-- Push notifications policies
DROP POLICY IF EXISTS "push_notifications_tenant_policy" ON public.push_notifications;
CREATE POLICY "push_notifications_tenant_policy" ON public.push_notifications
  FOR ALL USING (
    tenant_id = (SELECT NULLIF(current_setting('request.jwt.claims', true)::json->>'tenant_id', '')::uuid)
  );

-- Mobile app config policies
DROP POLICY IF EXISTS "mobile_app_config_tenant_policy" ON public.mobile_app_config;
CREATE POLICY "mobile_app_config_tenant_policy" ON public.mobile_app_config
  FOR ALL USING (
    tenant_id = (SELECT NULLIF(current_setting('request.jwt.claims', true)::json->>'tenant_id', '')::uuid)
  );

DROP POLICY IF EXISTS "mobile_app_config_public_read" ON public.mobile_app_config;
CREATE POLICY "mobile_app_config_public_read" ON public.mobile_app_config
  FOR SELECT USING (true);

-- ============================================
-- PART 4: Enable Realtime
-- ============================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'devices'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.devices;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'sensor_readings'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.sensor_readings;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'mobile_users'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.mobile_users;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'push_notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.push_notifications;
  END IF;
END $$;

-- ============================================
-- Done!
-- ============================================
