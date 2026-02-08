ALTER TABLE IF EXISTS menus 
ADD COLUMN IF NOT EXISTS location text DEFAULT 'header';

COMMENT ON COLUMN menus.location IS 'Location of the menu (e.g., header, footer, sidebar)';
