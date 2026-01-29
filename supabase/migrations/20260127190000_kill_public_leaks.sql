-- Kill Public Leaks
-- These policies use `USING (true)` effectively, which breaks tenant isolation enforced by `_hierarchy` policies.
-- Advisor flagged `page_categories` overlap. `blog_tags` also affected.

DO $$
BEGIN
  IF to_regclass('public.page_categories') IS NOT NULL THEN
    DROP POLICY IF EXISTS page_categories_select_public ON public.page_categories;
  END IF;

  IF to_regclass('public.blog_tags') IS NOT NULL THEN
     -- Policy name might be 'article_tags_select_public' carried over from rename, or just a legacy name.
     -- Check if it exists on blog_tags
     IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'blog_tags' AND policyname = 'article_tags_select_public') THEN
        DROP POLICY "article_tags_select_public" ON public.blog_tags;
     END IF;
  END IF;
END $$;
