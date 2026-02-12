-- Step 1: Get all FK columns
CREATE TEMP TABLE fk_cols AS
SELECT c.conrelid::regclass::text as tbl, a.attname as col, c.conname as fk, c.conrelid as relid, a.attnum as anum
FROM pg_constraint c
JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace;

-- Step 2: Get all indexed columns
CREATE TEMP TABLE idx_cols AS
SELECT i.indrelid as relid, a.attnum as anum
FROM pg_index i
JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey);

-- Step 3: Find unindexed FK columns
SELECT f.tbl, f.col, f.fk
FROM fk_cols f
LEFT JOIN idx_cols i ON f.relid = i.relid AND f.anum = i.anum
WHERE i.relid IS NULL
ORDER BY f.tbl, f.col;

-- Cleanup
DROP TABLE fk_cols;
DROP TABLE idx_cols;
