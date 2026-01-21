-- Update Categories Data
UPDATE categories
SET type = 'blog'
WHERE type = 'article';

-- Update Tags Data (if applicable, usually tags might be polymorphic or linked to content)
-- Checking tags table structure or data might be needed, but assuming standard field naming:
-- If tags have a 'type' or 'module' column:
-- UPDATE tags SET type = 'blog' WHERE type = 'article';
-- Only run if column exists. I will skip for now to avoid errors if column doesn't exist.
