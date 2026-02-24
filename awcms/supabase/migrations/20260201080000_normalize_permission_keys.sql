-- Migration: Normalize permission keys to ABAC format
-- Format: {scope}.{module}.{action}
-- Scope: 'tenant' for tenant-scoped, 'platform' for platform-scoped

-- Step 1: Update legacy permissions to new format
-- Pattern: create_X -> tenant.X.create, read_X -> tenant.X.read, etc.

BEGIN;

-- Create a function to normalize permission names
CREATE OR REPLACE FUNCTION normalize_permission_name(old_name TEXT) RETURNS TEXT AS $$
DECLARE
  action TEXT;
  resource TEXT;
  parts TEXT[];
BEGIN
  -- Skip already normalized permissions
  IF old_name LIKE 'tenant.%' OR old_name LIKE 'platform.%' OR old_name LIKE 'content.%' THEN
    RETURN old_name;
  END IF;
  
  -- Handle format: action_resource (e.g., create_articles)
  IF old_name ~ '^(create|read|update|delete|manage|publish|restore|view)_' THEN
    action := split_part(old_name, '_', 1);
    resource := substring(old_name FROM position('_' IN old_name) + 1);
    RETURN 'tenant.' || resource || '.' || action;
  END IF;
  
  -- Handle format: resource.action (e.g., promotions.read)
  IF old_name ~ '\.' THEN
    parts := string_to_array(old_name, '.');
    IF array_length(parts, 1) = 2 THEN
      RETURN 'tenant.' || parts[1] || '.' || parts[2];
    END IF;
  END IF;
  
  -- Default: keep as-is if format not recognized
  RETURN old_name;
END;
$$ LANGUAGE plpgsql;

-- Step 2: Update permissions with normalized names
-- Step 2: Update permissions directly where possible, or soft-delete if conflict exists
DO $$
DECLARE
  r RECORD;
  new_name TEXT;
BEGIN
  FOR r IN 
    SELECT * FROM permissions 
    WHERE name NOT LIKE 'tenant.%' 
      AND name NOT LIKE 'platform.%' 
      AND name NOT LIKE 'content.%' 
      AND deleted_at IS NULL
  LOOP
    new_name := normalize_permission_name(r.name);
    
    -- If the name wouldn't change, skip
    IF new_name = r.name THEN
      CONTINUE;
    END IF;

    -- Check if target name already exists
    IF EXISTS (SELECT 1 FROM permissions WHERE name = new_name) THEN
      -- Target exists: Soft delete the legacy row to resolve conflict
      UPDATE permissions SET deleted_at = NOW() WHERE id = r.id;
    ELSE
      -- Target free: safe to rename
      UPDATE permissions SET name = new_name, updated_at = NOW() WHERE id = r.id;
    END IF;
  END LOOP;
END $$;

-- Step 4: Drop the helper function
DROP FUNCTION IF EXISTS normalize_permission_name(TEXT);

-- Step 5: Log the migration
INSERT INTO audit_logs (
  action,
  resource,
  details,
  created_at
) VALUES (
  'MIGRATION',
  'permissions',
  jsonb_build_object(
    'description', 'Normalized permission keys to ABAC format',
    'migration', '20260201_normalize_permission_keys'
  ),
  NOW()
);

COMMIT;
