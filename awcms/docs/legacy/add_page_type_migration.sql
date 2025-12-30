-- Add page_type column to pages table
ALTER TABLE pages 
ADD COLUMN IF NOT EXISTS page_type TEXT DEFAULT 'regular';

-- Add comment to explain values
COMMENT ON COLUMN pages.page_type IS 'Type of page: regular, homepage, single_page, single_post, header, footer, 404, archive';

-- Create unique index to ensure only one active system page exists per type
-- This prevents having multiple active homepages, headers, etc.
CREATE UNIQUE INDEX IF NOT EXISTS idx_pages_unique_system_type 
ON pages (page_type) 
WHERE page_type IN ('homepage', 'header', 'footer', '404') 
AND status = 'published' 
AND deleted_at IS NULL;

-- Index for faster filtering by page type
CREATE INDEX IF NOT EXISTS idx_pages_page_type ON pages(page_type);
