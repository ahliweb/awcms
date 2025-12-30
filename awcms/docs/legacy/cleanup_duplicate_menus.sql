-- Clean up duplicate menu items in admin_menus table
-- This script removes duplicates while keeping one entry per key

-- Step 1: Delete duplicates based on 'key' field, keeping the first created entry
DELETE FROM admin_menus 
WHERE id IN (
    SELECT id FROM (
        SELECT id, 
               ROW_NUMBER() OVER (PARTITION BY key ORDER BY created_at ASC) as rn
        FROM admin_menus 
        WHERE key IS NOT NULL
    ) duplicates
    WHERE rn > 1
);

-- Step 2: Delete rows with NULL key (these cause errors)
DELETE FROM admin_menus WHERE key IS NULL;

-- Step 3: Clean up placeholder items where real items exist in that group
DELETE FROM admin_menus 
WHERE key LIKE 'group_placeholder_%' 
AND group_label IN (
    SELECT DISTINCT group_label FROM admin_menus WHERE key NOT LIKE 'group_placeholder_%'
);
