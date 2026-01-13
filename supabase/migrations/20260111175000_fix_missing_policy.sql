-- Fix for missing policy "audit_logs_insert_unified" which causes db pull to fail
-- when subsequent migration tries to drop it.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
        AND tablename = 'audit_logs'
        AND policyname = 'audit_logs_insert_unified'
    ) THEN
        CREATE POLICY "audit_logs_insert_unified" ON "public"."audit_logs" FOR INSERT WITH CHECK (true);
    END IF;
END
$$;
