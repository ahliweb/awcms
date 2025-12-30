-- Create templates table
CREATE TABLE IF NOT EXISTS public.templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    description TEXT,
    data JSONB DEFAULT '{}'::jsonb, -- Stores the Puck editor data structure
    thumbnail TEXT,
    category TEXT DEFAULT 'General',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

-- Enable RLS
ALTER TABLE public.templates ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Public can view active templates" 
ON public.templates FOR SELECT 
USING (is_active = true AND deleted_at IS NULL);

CREATE POLICY "Authenticated users can view all templates" 
ON public.templates FOR SELECT 
USING (auth.role() = 'authenticated');

CREATE POLICY "Admins users can manage templates" 
ON public.templates FOR ALL 
USING (
    EXISTS (
        SELECT 1 FROM public.users 
        WHERE users.id = auth.uid() 
        AND users.role_id IN (
            SELECT id FROM public.roles WHERE name IN ('admin', 'super_admin')
        )
    )
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_templates_slug ON public.templates(slug);
CREATE INDEX IF NOT EXISTS idx_templates_category ON public.templates(category);

-- Tigger for updated_at
DROP TRIGGER IF EXISTS update_templates_updated_at ON public.templates;
CREATE TRIGGER update_templates_updated_at
BEFORE UPDATE ON public.templates
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();
