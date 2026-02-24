-- Migration: Add Platform permissions for School Modules
-- Description: Unlocks management of School Pages and Site Images for custom Platform roles.

-- 1. Insert permissions for 'school_pages' (covers strict module access)
INSERT INTO public.permissions (name, description, resource, action, module)
VALUES
  ('platform.school_pages.read', 'View school/site content', 'school_pages', 'read', 'school_pages'),
  ('platform.school_pages.update', 'Manage school/site content', 'school_pages', 'update', 'school_pages')
ON CONFLICT (name) DO UPDATE SET
  description = EXCLUDED.description,
  module = EXCLUDED.module;

-- Note: We are reusing 'school_pages' module for both School Pages and Site Images managers 
-- to keep the permission set simple, as they are closely related content features.
