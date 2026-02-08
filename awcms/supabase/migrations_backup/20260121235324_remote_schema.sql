drop trigger if exists "lock_created_by_trg" on "public"."article_tags";

drop trigger if exists "set_created_by_trg" on "public"."article_tags";

drop trigger if exists "lock_created_by_trg" on "public"."articles";

drop trigger if exists "set_created_by_trg" on "public"."articles";

drop trigger if exists "trg_articles_audit" on "public"."articles";

drop trigger if exists "trg_set_tenant_id" on "public"."articles";

drop trigger if exists "update_articles_updated_at" on "public"."articles";

drop policy "article_tags_select_public" on "public"."article_tags";

drop policy "articles_delete_unified" on "public"."articles";

drop policy "articles_insert_unified" on "public"."articles";

drop policy "articles_select_unified" on "public"."articles";

drop policy "articles_update_unified" on "public"."articles";

revoke delete on table "public"."article_tags" from "anon";

revoke insert on table "public"."article_tags" from "anon";

revoke references on table "public"."article_tags" from "anon";

revoke select on table "public"."article_tags" from "anon";

revoke trigger on table "public"."article_tags" from "anon";

revoke truncate on table "public"."article_tags" from "anon";

revoke update on table "public"."article_tags" from "anon";

revoke delete on table "public"."article_tags" from "authenticated";

revoke insert on table "public"."article_tags" from "authenticated";

revoke references on table "public"."article_tags" from "authenticated";

revoke select on table "public"."article_tags" from "authenticated";

revoke trigger on table "public"."article_tags" from "authenticated";

revoke truncate on table "public"."article_tags" from "authenticated";

revoke update on table "public"."article_tags" from "authenticated";

revoke delete on table "public"."article_tags" from "service_role";

revoke insert on table "public"."article_tags" from "service_role";

revoke references on table "public"."article_tags" from "service_role";

revoke select on table "public"."article_tags" from "service_role";

revoke trigger on table "public"."article_tags" from "service_role";

revoke truncate on table "public"."article_tags" from "service_role";

revoke update on table "public"."article_tags" from "service_role";

revoke delete on table "public"."articles" from "anon";

revoke insert on table "public"."articles" from "anon";

revoke references on table "public"."articles" from "anon";

revoke select on table "public"."articles" from "anon";

revoke trigger on table "public"."articles" from "anon";

revoke truncate on table "public"."articles" from "anon";

revoke update on table "public"."articles" from "anon";

revoke delete on table "public"."articles" from "authenticated";

revoke insert on table "public"."articles" from "authenticated";

revoke references on table "public"."articles" from "authenticated";

revoke select on table "public"."articles" from "authenticated";

revoke trigger on table "public"."articles" from "authenticated";

revoke truncate on table "public"."articles" from "authenticated";

revoke update on table "public"."articles" from "authenticated";

revoke delete on table "public"."articles" from "service_role";

revoke insert on table "public"."articles" from "service_role";

revoke references on table "public"."articles" from "service_role";

revoke select on table "public"."articles" from "service_role";

revoke trigger on table "public"."articles" from "service_role";

revoke truncate on table "public"."articles" from "service_role";

revoke update on table "public"."articles" from "service_role";

alter table "public"."article_tags" drop constraint "article_tags_article_id_fkey";

alter table "public"."article_tags" drop constraint "article_tags_tag_id_fkey";

alter table "public"."article_tags" drop constraint "article_tags_tenant_id_fkey";

alter table "public"."articles" drop constraint "articles_author_id_fkey";

alter table "public"."articles" drop constraint "articles_category_id_fkey";

alter table "public"."articles" drop constraint "articles_created_by_fkey";

alter table "public"."articles" drop constraint "articles_current_assignee_id_fkey";

alter table "public"."articles" drop constraint "articles_region_id_fkey";

alter table "public"."articles" drop constraint "articles_slug_key";

alter table "public"."articles" drop constraint "articles_tenant_id_fkey";

alter table "public"."content_translations" drop constraint "content_translations_content_type_check";

drop view if exists "public"."published_articles_view";

alter table "public"."article_tags" drop constraint "article_tags_pkey";

alter table "public"."articles" drop constraint "articles_pkey";

drop index if exists "public"."article_tags_pkey";

drop index if exists "public"."articles_pkey";

drop index if exists "public"."articles_slug_key";

drop index if exists "public"."idx_article_tags_article_id";

drop index if exists "public"."idx_article_tags_created_by";

drop index if exists "public"."idx_article_tags_tag_id";

drop index if exists "public"."idx_article_tags_tenant_id";

drop index if exists "public"."idx_articles_author_id";

drop index if exists "public"."idx_articles_category_id";

drop index if exists "public"."idx_articles_created_by";

drop index if exists "public"."idx_articles_current_assignee_id";

drop index if exists "public"."idx_articles_deleted_at";

drop index if exists "public"."idx_articles_region";

drop index if exists "public"."idx_articles_status";

drop index if exists "public"."idx_articles_tenant_id";

drop index if exists "public"."idx_articles_tenant_slug";

drop index if exists "public"."idx_articles_tenant_status";

drop index if exists "public"."idx_articles_workflow_state";

drop table "public"."article_tags";

drop table "public"."articles";


  create table "public"."blog_tags" (
    "blog_id" uuid not null,
    "tag_id" uuid not null,
    "created_by" uuid,
    "tenant_id" uuid
      );


alter table "public"."blog_tags" enable row level security;


  create table "public"."blogs" (
    "id" uuid not null default gen_random_uuid(),
    "title" text not null,
    "slug" text not null,
    "content" text,
    "excerpt" text,
    "featured_image" text,
    "author_id" uuid,
    "status" text default 'draft'::text,
    "published_at" timestamp with time zone,
    "created_at" timestamp with time zone default now(),
    "updated_at" timestamp with time zone default now(),
    "deleted_at" timestamp with time zone,
    "category_id" uuid,
    "tags" text[],
    "is_active" boolean default true,
    "is_public" boolean default true,
    "meta_title" text,
    "meta_description" text,
    "meta_keywords" text,
    "og_image" text,
    "created_by" uuid,
    "canonical_url" text,
    "robots" text default 'index, follow'::text,
    "og_title" text,
    "og_description" text,
    "twitter_card_type" text default 'summary_large_image'::text,
    "twitter_image" text,
    "views" integer default 0,
    "tenant_id" uuid not null,
    "workflow_state" text default 'draft'::text,
    "puck_layout_jsonb" jsonb default '{}'::jsonb,
    "tiptap_doc_jsonb" jsonb default '{}'::jsonb,
    "region_id" uuid,
    "current_assignee_id" uuid,
    "sync_source_id" uuid
      );


alter table "public"."blogs" enable row level security;

CREATE UNIQUE INDEX article_tags_pkey ON public.blog_tags USING btree (blog_id, tag_id);

CREATE UNIQUE INDEX articles_pkey ON public.blogs USING btree (id);

CREATE UNIQUE INDEX articles_slug_key ON public.blogs USING btree (slug);

CREATE INDEX idx_article_tags_article_id ON public.blog_tags USING btree (blog_id);

CREATE INDEX idx_article_tags_created_by ON public.blog_tags USING btree (created_by);

CREATE INDEX idx_article_tags_tag_id ON public.blog_tags USING btree (tag_id);

CREATE INDEX idx_article_tags_tenant_id ON public.blog_tags USING btree (tenant_id);

CREATE INDEX idx_articles_author_id ON public.blogs USING btree (author_id);

CREATE INDEX idx_articles_category_id ON public.blogs USING btree (category_id);

CREATE INDEX idx_articles_created_by ON public.blogs USING btree (created_by);

CREATE INDEX idx_articles_current_assignee_id ON public.blogs USING btree (current_assignee_id);

CREATE INDEX idx_articles_deleted_at ON public.blogs USING btree (deleted_at);

CREATE INDEX idx_articles_region ON public.blogs USING btree (region_id);

CREATE INDEX idx_articles_status ON public.blogs USING btree (status);

CREATE INDEX idx_articles_tenant_id ON public.blogs USING btree (tenant_id);

CREATE INDEX idx_articles_tenant_slug ON public.blogs USING btree (tenant_id, slug);

CREATE INDEX idx_articles_tenant_status ON public.blogs USING btree (tenant_id, status);

CREATE INDEX idx_articles_workflow_state ON public.blogs USING btree (workflow_state);

alter table "public"."blog_tags" add constraint "article_tags_pkey" PRIMARY KEY using index "article_tags_pkey";

alter table "public"."blogs" add constraint "articles_pkey" PRIMARY KEY using index "articles_pkey";

alter table "public"."blog_tags" add constraint "article_tags_article_id_fkey" FOREIGN KEY (blog_id) REFERENCES public.blogs(id) ON DELETE CASCADE not valid;

alter table "public"."blog_tags" validate constraint "article_tags_article_id_fkey";

alter table "public"."blog_tags" add constraint "article_tags_tag_id_fkey" FOREIGN KEY (tag_id) REFERENCES public.tags(id) ON DELETE CASCADE not valid;

alter table "public"."blog_tags" validate constraint "article_tags_tag_id_fkey";

alter table "public"."blog_tags" add constraint "article_tags_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE not valid;

alter table "public"."blog_tags" validate constraint "article_tags_tenant_id_fkey";

alter table "public"."blogs" add constraint "articles_author_id_fkey" FOREIGN KEY (author_id) REFERENCES public.users(id) not valid;

alter table "public"."blogs" validate constraint "articles_author_id_fkey";

alter table "public"."blogs" add constraint "articles_category_id_fkey" FOREIGN KEY (category_id) REFERENCES public.categories(id) not valid;

alter table "public"."blogs" validate constraint "articles_category_id_fkey";

alter table "public"."blogs" add constraint "articles_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.users(id) not valid;

alter table "public"."blogs" validate constraint "articles_created_by_fkey";

alter table "public"."blogs" add constraint "articles_current_assignee_id_fkey" FOREIGN KEY (current_assignee_id) REFERENCES public.users(id) not valid;

alter table "public"."blogs" validate constraint "articles_current_assignee_id_fkey";

alter table "public"."blogs" add constraint "articles_region_id_fkey" FOREIGN KEY (region_id) REFERENCES public.regions(id) ON DELETE SET NULL not valid;

alter table "public"."blogs" validate constraint "articles_region_id_fkey";

alter table "public"."blogs" add constraint "articles_slug_key" UNIQUE using index "articles_slug_key";

alter table "public"."blogs" add constraint "articles_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) not valid;

alter table "public"."blogs" validate constraint "articles_tenant_id_fkey";

alter table "public"."content_translations" add constraint "content_translations_content_type_check" CHECK ((content_type = ANY (ARRAY['page'::text, 'article'::text]))) not valid;

alter table "public"."content_translations" validate constraint "content_translations_content_type_check";

set check_function_bodies = off;

create or replace view "public"."published_blogs_view" as  SELECT id,
    tenant_id,
    title,
    content,
    excerpt,
    featured_image,
    status,
    author_id,
    created_at,
    updated_at
   FROM public.blogs
  WHERE ((status = 'published'::text) AND (deleted_at IS NULL));


CREATE OR REPLACE FUNCTION public.sync_resource_tags(p_resource_id uuid, p_resource_type text, p_tags text[], p_tenant_id uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_tag_id uuid;
    v_tag_name text;
    v_tag_ids uuid[] := ARRAY[]::uuid[];
    v_slug text;
BEGIN
    -- Strict Tenant Check
    IF p_tenant_id IS NULL THEN
        RAISE EXCEPTION 'Tenant ID is required for tag synchronization';
    END IF;

    IF p_tags IS NOT NULL THEN
        FOREACH v_tag_name IN ARRAY p_tags
        LOOP
            IF length(trim(v_tag_name)) > 0 THEN
                v_tag_name := trim(v_tag_name);
                v_slug := lower(regexp_replace(v_tag_name, '[^a-zA-Z0-9]+', '-', 'g'));
                v_slug := regexp_replace(v_slug, '^-+|-+$', '', 'g');
                
                -- Insert with tenant_id, conflict on (tenant_id, slug)
                INSERT INTO tags (name, slug, tenant_id, created_at, updated_at)
                VALUES (v_tag_name, v_slug, p_tenant_id, NOW(), NOW())
                ON CONFLICT (tenant_id, slug) DO UPDATE SET updated_at = NOW()
                RETURNING id INTO v_tag_id;
                
                -- Fallback lookup if simple update/insert didn't return (shouldn't happen with RETURNING but strict safety)
                IF v_tag_id IS NULL THEN
                    SELECT id INTO v_tag_id FROM tags WHERE slug = v_slug AND tenant_id = p_tenant_id;
                END IF;

                IF v_tag_id IS NOT NULL THEN
                    v_tag_ids := array_append(v_tag_ids, v_tag_id);
                END IF;
            END IF;
        END LOOP;
    END IF;

    -- Update Junction Tables
    IF p_resource_type = 'articles' OR p_resource_type = 'blogs' THEN
        DELETE FROM blog_tags WHERE blog_id = p_resource_id AND (cardinality(v_tag_ids) = 0 OR tag_id != ALL(v_tag_ids));
        IF cardinality(v_tag_ids) > 0 THEN
            INSERT INTO blog_tags (blog_id, tag_id)
            SELECT p_resource_id, unnest(v_tag_ids)
            ON CONFLICT (blog_id, tag_id) DO NOTHING;
        END IF;
    ELSIF p_resource_type = 'pages' THEN
        DELETE FROM page_tags WHERE page_id = p_resource_id AND (cardinality(v_tag_ids) = 0 OR tag_id != ALL(v_tag_ids));
        IF cardinality(v_tag_ids) > 0 THEN
            INSERT INTO page_tags (page_id, tag_id)
            SELECT p_resource_id, unnest(v_tag_ids)
            ON CONFLICT (page_id, tag_id) DO NOTHING;
        END IF;
    ELSIF p_resource_type = 'video_gallery' THEN
        DELETE FROM video_gallery_tags WHERE video_gallery_id = p_resource_id AND (cardinality(v_tag_ids) = 0 OR tag_id != ALL(v_tag_ids));
        IF cardinality(v_tag_ids) > 0 THEN
             INSERT INTO video_gallery_tags (video_gallery_id, tag_id)
             SELECT p_resource_id, unnest(v_tag_ids)
             ON CONFLICT (video_gallery_id, tag_id) DO NOTHING;
        END IF;
    ELSIF p_resource_type = 'contacts' THEN
        DELETE FROM contact_tags WHERE contact_id = p_resource_id AND (cardinality(v_tag_ids) = 0 OR tag_id != ALL(v_tag_ids));
        IF cardinality(v_tag_ids) > 0 THEN
             INSERT INTO contact_tags (contact_id, tag_id)
             SELECT p_resource_id, unnest(v_tag_ids)
             ON CONFLICT (contact_id, tag_id) DO NOTHING;
        END IF;
    ELSIF p_resource_type = 'contact_messages' THEN
        DELETE FROM contact_message_tags WHERE message_id = p_resource_id AND (cardinality(v_tag_ids) = 0 OR tag_id != ALL(v_tag_ids));
        IF cardinality(v_tag_ids) > 0 THEN
             INSERT INTO contact_message_tags (message_id, tag_id)
             SELECT p_resource_id, unnest(v_tag_ids)
             ON CONFLICT (message_id, tag_id) DO NOTHING;
        END IF;
    ELSIF p_resource_type = 'product_types' THEN
        DELETE FROM product_type_tags WHERE product_type_id = p_resource_id AND (cardinality(v_tag_ids) = 0 OR tag_id != ALL(v_tag_ids));
        IF cardinality(v_tag_ids) > 0 THEN
             INSERT INTO product_type_tags (product_type_id, tag_id)
             SELECT p_resource_id, unnest(v_tag_ids)
             ON CONFLICT (product_type_id, tag_id) DO NOTHING;
        END IF;
    END IF;
END;
$function$
;

grant delete on table "public"."blog_tags" to "anon";

grant insert on table "public"."blog_tags" to "anon";

grant references on table "public"."blog_tags" to "anon";

grant select on table "public"."blog_tags" to "anon";

grant trigger on table "public"."blog_tags" to "anon";

grant truncate on table "public"."blog_tags" to "anon";

grant update on table "public"."blog_tags" to "anon";

grant delete on table "public"."blog_tags" to "authenticated";

grant insert on table "public"."blog_tags" to "authenticated";

grant references on table "public"."blog_tags" to "authenticated";

grant select on table "public"."blog_tags" to "authenticated";

grant trigger on table "public"."blog_tags" to "authenticated";

grant truncate on table "public"."blog_tags" to "authenticated";

grant update on table "public"."blog_tags" to "authenticated";

grant delete on table "public"."blog_tags" to "service_role";

grant insert on table "public"."blog_tags" to "service_role";

grant references on table "public"."blog_tags" to "service_role";

grant select on table "public"."blog_tags" to "service_role";

grant trigger on table "public"."blog_tags" to "service_role";

grant truncate on table "public"."blog_tags" to "service_role";

grant update on table "public"."blog_tags" to "service_role";

grant delete on table "public"."blogs" to "anon";

grant insert on table "public"."blogs" to "anon";

grant references on table "public"."blogs" to "anon";

grant select on table "public"."blogs" to "anon";

grant trigger on table "public"."blogs" to "anon";

grant truncate on table "public"."blogs" to "anon";

grant update on table "public"."blogs" to "anon";

grant delete on table "public"."blogs" to "authenticated";

grant insert on table "public"."blogs" to "authenticated";

grant references on table "public"."blogs" to "authenticated";

grant select on table "public"."blogs" to "authenticated";

grant trigger on table "public"."blogs" to "authenticated";

grant truncate on table "public"."blogs" to "authenticated";

grant update on table "public"."blogs" to "authenticated";

grant delete on table "public"."blogs" to "service_role";

grant insert on table "public"."blogs" to "service_role";

grant references on table "public"."blogs" to "service_role";

grant select on table "public"."blogs" to "service_role";

grant trigger on table "public"."blogs" to "service_role";

grant truncate on table "public"."blogs" to "service_role";

grant update on table "public"."blogs" to "service_role";


  create policy "article_tags_select_public"
  on "public"."blog_tags"
  as permissive
  for select
  to public
using (true);



  create policy "articles_delete_unified"
  on "public"."blogs"
  as permissive
  for delete
  to public
using ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()));



  create policy "articles_insert_unified"
  on "public"."blogs"
  as permissive
  for insert
  to public
with check ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()));



  create policy "articles_select_unified"
  on "public"."blogs"
  as permissive
  for select
  to public
using (((tenant_id = public.current_tenant_id()) OR public.is_platform_admin()));



  create policy "articles_update_unified"
  on "public"."blogs"
  as permissive
  for update
  to public
using ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()));


CREATE TRIGGER lock_created_by_trg BEFORE UPDATE ON public.blog_tags FOR EACH ROW EXECUTE FUNCTION public.lock_created_by();

CREATE TRIGGER set_created_by_trg BEFORE INSERT ON public.blog_tags FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

CREATE TRIGGER lock_created_by_trg BEFORE UPDATE ON public.blogs FOR EACH ROW EXECUTE FUNCTION public.lock_created_by();

CREATE TRIGGER set_created_by_trg BEFORE INSERT ON public.blogs FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

CREATE TRIGGER trg_articles_audit AFTER INSERT OR DELETE OR UPDATE ON public.blogs FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();

CREATE TRIGGER trg_set_tenant_id BEFORE INSERT ON public.blogs FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id();

CREATE TRIGGER update_articles_updated_at BEFORE UPDATE ON public.blogs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


