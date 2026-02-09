drop trigger if exists "lock_created_by_trg" on "public"."announcement_tags";

drop trigger if exists "set_created_by_trg" on "public"."announcement_tags";

drop trigger if exists "lock_created_by_trg" on "public"."contact_message_tags";

drop trigger if exists "set_created_by_trg" on "public"."contact_message_tags";

drop trigger if exists "lock_created_by_trg" on "public"."contact_tags";

drop trigger if exists "set_created_by_trg" on "public"."contact_tags";

drop trigger if exists "lock_created_by_trg" on "public"."page_tags";

drop trigger if exists "set_created_by_trg" on "public"."page_tags";

drop trigger if exists "lock_created_by_trg" on "public"."photo_gallery_tags";

drop trigger if exists "set_created_by_trg" on "public"."photo_gallery_tags";

drop trigger if exists "lock_created_by_trg" on "public"."portfolio_tags";

drop trigger if exists "set_created_by_trg" on "public"."portfolio_tags";

drop trigger if exists "lock_created_by_trg" on "public"."product_tags";

drop trigger if exists "set_created_by_trg" on "public"."product_tags";

drop trigger if exists "lock_created_by_trg" on "public"."product_type_tags";

drop trigger if exists "set_created_by_trg" on "public"."product_type_tags";

drop trigger if exists "lock_created_by_trg" on "public"."promotion_tags";

drop trigger if exists "set_created_by_trg" on "public"."promotion_tags";

drop trigger if exists "lock_created_by_trg" on "public"."testimony_tags";

drop trigger if exists "set_created_by_trg" on "public"."testimony_tags";

drop trigger if exists "lock_created_by_trg" on "public"."video_gallery_tags";

drop trigger if exists "set_created_by_trg" on "public"."video_gallery_tags";

drop policy "announcement_tags_select_public" on "public"."announcement_tags";

drop policy "contact_message_tags_select_public" on "public"."contact_message_tags";

drop policy "contact_tags_select_public" on "public"."contact_tags";

drop policy "page_tags_delete_hierarchy" on "public"."page_tags";

drop policy "page_tags_insert_hierarchy" on "public"."page_tags";

drop policy "page_tags_select_hierarchy" on "public"."page_tags";

drop policy "page_tags_update_hierarchy" on "public"."page_tags";

drop policy "photo_gallery_tags_select_public" on "public"."photo_gallery_tags";

drop policy "portfolio_tags_select_public" on "public"."portfolio_tags";

drop policy "product_tags_select_public" on "public"."product_tags";

drop policy "product_type_tags_select_public" on "public"."product_type_tags";

drop policy "promotion_tags_select_public" on "public"."promotion_tags";

drop policy "testimony_tags_delete" on "public"."testimony_tags";

drop policy "testimony_tags_insert" on "public"."testimony_tags";

drop policy "testimony_tags_select" on "public"."testimony_tags";

drop policy "testimony_tags_update" on "public"."testimony_tags";

drop policy "video_gallery_tags_select_public" on "public"."video_gallery_tags";

revoke delete on table "public"."announcement_tags" from "anon";

revoke insert on table "public"."announcement_tags" from "anon";

revoke references on table "public"."announcement_tags" from "anon";

revoke select on table "public"."announcement_tags" from "anon";

revoke trigger on table "public"."announcement_tags" from "anon";

revoke truncate on table "public"."announcement_tags" from "anon";

revoke update on table "public"."announcement_tags" from "anon";

revoke delete on table "public"."announcement_tags" from "authenticated";

revoke insert on table "public"."announcement_tags" from "authenticated";

revoke references on table "public"."announcement_tags" from "authenticated";

revoke select on table "public"."announcement_tags" from "authenticated";

revoke trigger on table "public"."announcement_tags" from "authenticated";

revoke truncate on table "public"."announcement_tags" from "authenticated";

revoke update on table "public"."announcement_tags" from "authenticated";

revoke delete on table "public"."announcement_tags" from "service_role";

revoke insert on table "public"."announcement_tags" from "service_role";

revoke references on table "public"."announcement_tags" from "service_role";

revoke select on table "public"."announcement_tags" from "service_role";

revoke trigger on table "public"."announcement_tags" from "service_role";

revoke truncate on table "public"."announcement_tags" from "service_role";

revoke update on table "public"."announcement_tags" from "service_role";

revoke delete on table "public"."contact_message_tags" from "anon";

revoke insert on table "public"."contact_message_tags" from "anon";

revoke references on table "public"."contact_message_tags" from "anon";

revoke select on table "public"."contact_message_tags" from "anon";

revoke trigger on table "public"."contact_message_tags" from "anon";

revoke truncate on table "public"."contact_message_tags" from "anon";

revoke update on table "public"."contact_message_tags" from "anon";

revoke delete on table "public"."contact_message_tags" from "authenticated";

revoke insert on table "public"."contact_message_tags" from "authenticated";

revoke references on table "public"."contact_message_tags" from "authenticated";

revoke select on table "public"."contact_message_tags" from "authenticated";

revoke trigger on table "public"."contact_message_tags" from "authenticated";

revoke truncate on table "public"."contact_message_tags" from "authenticated";

revoke update on table "public"."contact_message_tags" from "authenticated";

revoke delete on table "public"."contact_message_tags" from "service_role";

revoke insert on table "public"."contact_message_tags" from "service_role";

revoke references on table "public"."contact_message_tags" from "service_role";

revoke select on table "public"."contact_message_tags" from "service_role";

revoke trigger on table "public"."contact_message_tags" from "service_role";

revoke truncate on table "public"."contact_message_tags" from "service_role";

revoke update on table "public"."contact_message_tags" from "service_role";

revoke delete on table "public"."contact_tags" from "anon";

revoke insert on table "public"."contact_tags" from "anon";

revoke references on table "public"."contact_tags" from "anon";

revoke select on table "public"."contact_tags" from "anon";

revoke trigger on table "public"."contact_tags" from "anon";

revoke truncate on table "public"."contact_tags" from "anon";

revoke update on table "public"."contact_tags" from "anon";

revoke delete on table "public"."contact_tags" from "authenticated";

revoke insert on table "public"."contact_tags" from "authenticated";

revoke references on table "public"."contact_tags" from "authenticated";

revoke select on table "public"."contact_tags" from "authenticated";

revoke trigger on table "public"."contact_tags" from "authenticated";

revoke truncate on table "public"."contact_tags" from "authenticated";

revoke update on table "public"."contact_tags" from "authenticated";

revoke delete on table "public"."contact_tags" from "service_role";

revoke insert on table "public"."contact_tags" from "service_role";

revoke references on table "public"."contact_tags" from "service_role";

revoke select on table "public"."contact_tags" from "service_role";

revoke trigger on table "public"."contact_tags" from "service_role";

revoke truncate on table "public"."contact_tags" from "service_role";

revoke update on table "public"."contact_tags" from "service_role";

revoke delete on table "public"."page_tags" from "anon";

revoke insert on table "public"."page_tags" from "anon";

revoke references on table "public"."page_tags" from "anon";

revoke select on table "public"."page_tags" from "anon";

revoke trigger on table "public"."page_tags" from "anon";

revoke truncate on table "public"."page_tags" from "anon";

revoke update on table "public"."page_tags" from "anon";

revoke delete on table "public"."page_tags" from "authenticated";

revoke insert on table "public"."page_tags" from "authenticated";

revoke references on table "public"."page_tags" from "authenticated";

revoke select on table "public"."page_tags" from "authenticated";

revoke trigger on table "public"."page_tags" from "authenticated";

revoke truncate on table "public"."page_tags" from "authenticated";

revoke update on table "public"."page_tags" from "authenticated";

revoke delete on table "public"."page_tags" from "service_role";

revoke insert on table "public"."page_tags" from "service_role";

revoke references on table "public"."page_tags" from "service_role";

revoke select on table "public"."page_tags" from "service_role";

revoke trigger on table "public"."page_tags" from "service_role";

revoke truncate on table "public"."page_tags" from "service_role";

revoke update on table "public"."page_tags" from "service_role";

revoke delete on table "public"."photo_gallery_tags" from "anon";

revoke insert on table "public"."photo_gallery_tags" from "anon";

revoke references on table "public"."photo_gallery_tags" from "anon";

revoke select on table "public"."photo_gallery_tags" from "anon";

revoke trigger on table "public"."photo_gallery_tags" from "anon";

revoke truncate on table "public"."photo_gallery_tags" from "anon";

revoke update on table "public"."photo_gallery_tags" from "anon";

revoke delete on table "public"."photo_gallery_tags" from "authenticated";

revoke insert on table "public"."photo_gallery_tags" from "authenticated";

revoke references on table "public"."photo_gallery_tags" from "authenticated";

revoke select on table "public"."photo_gallery_tags" from "authenticated";

revoke trigger on table "public"."photo_gallery_tags" from "authenticated";

revoke truncate on table "public"."photo_gallery_tags" from "authenticated";

revoke update on table "public"."photo_gallery_tags" from "authenticated";

revoke delete on table "public"."photo_gallery_tags" from "service_role";

revoke insert on table "public"."photo_gallery_tags" from "service_role";

revoke references on table "public"."photo_gallery_tags" from "service_role";

revoke select on table "public"."photo_gallery_tags" from "service_role";

revoke trigger on table "public"."photo_gallery_tags" from "service_role";

revoke truncate on table "public"."photo_gallery_tags" from "service_role";

revoke update on table "public"."photo_gallery_tags" from "service_role";

revoke delete on table "public"."portfolio_tags" from "anon";

revoke insert on table "public"."portfolio_tags" from "anon";

revoke references on table "public"."portfolio_tags" from "anon";

revoke select on table "public"."portfolio_tags" from "anon";

revoke trigger on table "public"."portfolio_tags" from "anon";

revoke truncate on table "public"."portfolio_tags" from "anon";

revoke update on table "public"."portfolio_tags" from "anon";

revoke delete on table "public"."portfolio_tags" from "authenticated";

revoke insert on table "public"."portfolio_tags" from "authenticated";

revoke references on table "public"."portfolio_tags" from "authenticated";

revoke select on table "public"."portfolio_tags" from "authenticated";

revoke trigger on table "public"."portfolio_tags" from "authenticated";

revoke truncate on table "public"."portfolio_tags" from "authenticated";

revoke update on table "public"."portfolio_tags" from "authenticated";

revoke delete on table "public"."portfolio_tags" from "service_role";

revoke insert on table "public"."portfolio_tags" from "service_role";

revoke references on table "public"."portfolio_tags" from "service_role";

revoke select on table "public"."portfolio_tags" from "service_role";

revoke trigger on table "public"."portfolio_tags" from "service_role";

revoke truncate on table "public"."portfolio_tags" from "service_role";

revoke update on table "public"."portfolio_tags" from "service_role";

revoke delete on table "public"."product_tags" from "anon";

revoke insert on table "public"."product_tags" from "anon";

revoke references on table "public"."product_tags" from "anon";

revoke select on table "public"."product_tags" from "anon";

revoke trigger on table "public"."product_tags" from "anon";

revoke truncate on table "public"."product_tags" from "anon";

revoke update on table "public"."product_tags" from "anon";

revoke delete on table "public"."product_tags" from "authenticated";

revoke insert on table "public"."product_tags" from "authenticated";

revoke references on table "public"."product_tags" from "authenticated";

revoke select on table "public"."product_tags" from "authenticated";

revoke trigger on table "public"."product_tags" from "authenticated";

revoke truncate on table "public"."product_tags" from "authenticated";

revoke update on table "public"."product_tags" from "authenticated";

revoke delete on table "public"."product_tags" from "service_role";

revoke insert on table "public"."product_tags" from "service_role";

revoke references on table "public"."product_tags" from "service_role";

revoke select on table "public"."product_tags" from "service_role";

revoke trigger on table "public"."product_tags" from "service_role";

revoke truncate on table "public"."product_tags" from "service_role";

revoke update on table "public"."product_tags" from "service_role";

revoke delete on table "public"."product_type_tags" from "anon";

revoke insert on table "public"."product_type_tags" from "anon";

revoke references on table "public"."product_type_tags" from "anon";

revoke select on table "public"."product_type_tags" from "anon";

revoke trigger on table "public"."product_type_tags" from "anon";

revoke truncate on table "public"."product_type_tags" from "anon";

revoke update on table "public"."product_type_tags" from "anon";

revoke delete on table "public"."product_type_tags" from "authenticated";

revoke insert on table "public"."product_type_tags" from "authenticated";

revoke references on table "public"."product_type_tags" from "authenticated";

revoke select on table "public"."product_type_tags" from "authenticated";

revoke trigger on table "public"."product_type_tags" from "authenticated";

revoke truncate on table "public"."product_type_tags" from "authenticated";

revoke update on table "public"."product_type_tags" from "authenticated";

revoke delete on table "public"."product_type_tags" from "service_role";

revoke insert on table "public"."product_type_tags" from "service_role";

revoke references on table "public"."product_type_tags" from "service_role";

revoke select on table "public"."product_type_tags" from "service_role";

revoke trigger on table "public"."product_type_tags" from "service_role";

revoke truncate on table "public"."product_type_tags" from "service_role";

revoke update on table "public"."product_type_tags" from "service_role";

revoke delete on table "public"."promotion_tags" from "anon";

revoke insert on table "public"."promotion_tags" from "anon";

revoke references on table "public"."promotion_tags" from "anon";

revoke select on table "public"."promotion_tags" from "anon";

revoke trigger on table "public"."promotion_tags" from "anon";

revoke truncate on table "public"."promotion_tags" from "anon";

revoke update on table "public"."promotion_tags" from "anon";

revoke delete on table "public"."promotion_tags" from "authenticated";

revoke insert on table "public"."promotion_tags" from "authenticated";

revoke references on table "public"."promotion_tags" from "authenticated";

revoke select on table "public"."promotion_tags" from "authenticated";

revoke trigger on table "public"."promotion_tags" from "authenticated";

revoke truncate on table "public"."promotion_tags" from "authenticated";

revoke update on table "public"."promotion_tags" from "authenticated";

revoke delete on table "public"."promotion_tags" from "service_role";

revoke insert on table "public"."promotion_tags" from "service_role";

revoke references on table "public"."promotion_tags" from "service_role";

revoke select on table "public"."promotion_tags" from "service_role";

revoke trigger on table "public"."promotion_tags" from "service_role";

revoke truncate on table "public"."promotion_tags" from "service_role";

revoke update on table "public"."promotion_tags" from "service_role";

revoke delete on table "public"."testimony_tags" from "anon";

revoke insert on table "public"."testimony_tags" from "anon";

revoke references on table "public"."testimony_tags" from "anon";

revoke select on table "public"."testimony_tags" from "anon";

revoke trigger on table "public"."testimony_tags" from "anon";

revoke truncate on table "public"."testimony_tags" from "anon";

revoke update on table "public"."testimony_tags" from "anon";

revoke delete on table "public"."testimony_tags" from "authenticated";

revoke insert on table "public"."testimony_tags" from "authenticated";

revoke references on table "public"."testimony_tags" from "authenticated";

revoke select on table "public"."testimony_tags" from "authenticated";

revoke trigger on table "public"."testimony_tags" from "authenticated";

revoke truncate on table "public"."testimony_tags" from "authenticated";

revoke update on table "public"."testimony_tags" from "authenticated";

revoke delete on table "public"."testimony_tags" from "service_role";

revoke insert on table "public"."testimony_tags" from "service_role";

revoke references on table "public"."testimony_tags" from "service_role";

revoke select on table "public"."testimony_tags" from "service_role";

revoke trigger on table "public"."testimony_tags" from "service_role";

revoke truncate on table "public"."testimony_tags" from "service_role";

revoke update on table "public"."testimony_tags" from "service_role";

revoke delete on table "public"."video_gallery_tags" from "anon";

revoke insert on table "public"."video_gallery_tags" from "anon";

revoke references on table "public"."video_gallery_tags" from "anon";

revoke select on table "public"."video_gallery_tags" from "anon";

revoke trigger on table "public"."video_gallery_tags" from "anon";

revoke truncate on table "public"."video_gallery_tags" from "anon";

revoke update on table "public"."video_gallery_tags" from "anon";

revoke delete on table "public"."video_gallery_tags" from "authenticated";

revoke insert on table "public"."video_gallery_tags" from "authenticated";

revoke references on table "public"."video_gallery_tags" from "authenticated";

revoke select on table "public"."video_gallery_tags" from "authenticated";

revoke trigger on table "public"."video_gallery_tags" from "authenticated";

revoke truncate on table "public"."video_gallery_tags" from "authenticated";

revoke update on table "public"."video_gallery_tags" from "authenticated";

revoke delete on table "public"."video_gallery_tags" from "service_role";

revoke insert on table "public"."video_gallery_tags" from "service_role";

revoke references on table "public"."video_gallery_tags" from "service_role";

revoke select on table "public"."video_gallery_tags" from "service_role";

revoke trigger on table "public"."video_gallery_tags" from "service_role";

revoke truncate on table "public"."video_gallery_tags" from "service_role";

revoke update on table "public"."video_gallery_tags" from "service_role";

alter table "public"."announcement_tags" drop constraint "announcement_tags_announcement_id_fkey";

alter table "public"."announcement_tags" drop constraint "announcement_tags_tag_id_fkey";

alter table "public"."announcement_tags" drop constraint "announcement_tags_tenant_id_fkey";

alter table "public"."contact_message_tags" drop constraint "contact_message_tags_message_id_fkey";

alter table "public"."contact_message_tags" drop constraint "contact_message_tags_tag_id_fkey";

alter table "public"."contact_message_tags" drop constraint "contact_message_tags_tenant_id_fkey";

alter table "public"."contact_tags" drop constraint "contact_tags_contact_id_fkey";

alter table "public"."contact_tags" drop constraint "contact_tags_tag_id_fkey";

alter table "public"."contact_tags" drop constraint "contact_tags_tenant_id_fkey";

alter table "public"."page_tags" drop constraint "page_tags_page_id_fkey";

alter table "public"."page_tags" drop constraint "page_tags_tag_id_fkey";

alter table "public"."page_tags" drop constraint "page_tags_tenant_id_fkey";

alter table "public"."photo_gallery_tags" drop constraint "photo_gallery_tags_photo_gallery_id_fkey";

alter table "public"."photo_gallery_tags" drop constraint "photo_gallery_tags_tag_id_fkey";

alter table "public"."photo_gallery_tags" drop constraint "photo_gallery_tags_tenant_id_fkey";

alter table "public"."portfolio_tags" drop constraint "portfolio_tags_portfolio_id_fkey";

alter table "public"."portfolio_tags" drop constraint "portfolio_tags_tag_id_fkey";

alter table "public"."portfolio_tags" drop constraint "portfolio_tags_tenant_id_fkey";

alter table "public"."product_tags" drop constraint "product_tags_product_id_fkey";

alter table "public"."product_tags" drop constraint "product_tags_tag_id_fkey";

alter table "public"."product_tags" drop constraint "product_tags_tenant_id_fkey";

alter table "public"."product_type_tags" drop constraint "product_type_tags_product_type_id_fkey";

alter table "public"."product_type_tags" drop constraint "product_type_tags_tag_id_fkey";

alter table "public"."product_type_tags" drop constraint "product_type_tags_tenant_id_fkey";

alter table "public"."promotion_tags" drop constraint "promotion_tags_promotion_id_fkey";

alter table "public"."promotion_tags" drop constraint "promotion_tags_tag_id_fkey";

alter table "public"."promotion_tags" drop constraint "promotion_tags_tenant_id_fkey";

alter table "public"."testimony_tags" drop constraint "testimony_tags_tag_id_fkey";

alter table "public"."testimony_tags" drop constraint "testimony_tags_tenant_id_fkey";

alter table "public"."testimony_tags" drop constraint "testimony_tags_testimony_id_fkey";

alter table "public"."video_gallery_tags" drop constraint "video_gallery_tags_tag_id_fkey";

alter table "public"."video_gallery_tags" drop constraint "video_gallery_tags_tenant_id_fkey";

alter table "public"."video_gallery_tags" drop constraint "video_gallery_tags_video_gallery_id_fkey";

alter table "public"."announcement_tags" drop constraint "announcement_tags_pkey";

alter table "public"."contact_message_tags" drop constraint "contact_message_tags_pkey";

alter table "public"."contact_tags" drop constraint "contact_tags_pkey";

alter table "public"."page_tags" drop constraint "page_tags_pkey";

alter table "public"."photo_gallery_tags" drop constraint "photo_gallery_tags_pkey";

alter table "public"."portfolio_tags" drop constraint "portfolio_tags_pkey";

alter table "public"."product_tags" drop constraint "product_tags_pkey";

alter table "public"."product_type_tags" drop constraint "product_type_tags_pkey";

alter table "public"."promotion_tags" drop constraint "promotion_tags_pkey";

alter table "public"."testimony_tags" drop constraint "testimony_tags_pkey";

alter table "public"."video_gallery_tags" drop constraint "video_gallery_tags_pkey";

drop index if exists "public"."announcement_tags_pkey";

drop index if exists "public"."contact_message_tags_pkey";

drop index if exists "public"."contact_tags_pkey";

drop index if exists "public"."idx_announcement_tags_announcement_id";

drop index if exists "public"."idx_announcement_tags_created_by";

drop index if exists "public"."idx_announcement_tags_tag_id";

drop index if exists "public"."idx_announcement_tags_tenant_id";

drop index if exists "public"."idx_contact_message_tags_created_by";

drop index if exists "public"."idx_contact_message_tags_message_id";

drop index if exists "public"."idx_contact_message_tags_tag_id";

drop index if exists "public"."idx_contact_message_tags_tenant_id";

drop index if exists "public"."idx_contact_tags_contact_id";

drop index if exists "public"."idx_contact_tags_created_by";

drop index if exists "public"."idx_contact_tags_tag_id";

drop index if exists "public"."idx_contact_tags_tenant_id";

drop index if exists "public"."idx_page_tags_created_by";

drop index if exists "public"."idx_page_tags_page_id";

drop index if exists "public"."idx_page_tags_tag_id";

drop index if exists "public"."idx_page_tags_tenant_id";

drop index if exists "public"."idx_photo_gallery_tags_created_by";

drop index if exists "public"."idx_photo_gallery_tags_photo_gallery_id";

drop index if exists "public"."idx_photo_gallery_tags_tag_id";

drop index if exists "public"."idx_photo_gallery_tags_tenant_id";

drop index if exists "public"."idx_portfolio_tags_created_by";

drop index if exists "public"."idx_portfolio_tags_portfolio_id";

drop index if exists "public"."idx_portfolio_tags_tag_id";

drop index if exists "public"."idx_portfolio_tags_tenant_id";

drop index if exists "public"."idx_product_tags_created_by";

drop index if exists "public"."idx_product_tags_product_id";

drop index if exists "public"."idx_product_tags_tag_id";

drop index if exists "public"."idx_product_tags_tenant_id";

drop index if exists "public"."idx_product_type_tags_created_by";

drop index if exists "public"."idx_product_type_tags_product_type_id";

drop index if exists "public"."idx_product_type_tags_tag_id";

drop index if exists "public"."idx_product_type_tags_tenant_id";

drop index if exists "public"."idx_promotion_tags_created_by";

drop index if exists "public"."idx_promotion_tags_promotion_id";

drop index if exists "public"."idx_promotion_tags_tag_id";

drop index if exists "public"."idx_promotion_tags_tenant_id";

drop index if exists "public"."idx_testimony_tags_created_by";

drop index if exists "public"."idx_testimony_tags_tag_id";

drop index if exists "public"."idx_testimony_tags_tenant_id";

drop index if exists "public"."idx_testimony_tags_testimony_id";

drop index if exists "public"."idx_video_gallery_tags_created_by";

drop index if exists "public"."idx_video_gallery_tags_tag_id";

drop index if exists "public"."idx_video_gallery_tags_tenant_id";

drop index if exists "public"."idx_video_gallery_tags_video_gallery_id";

drop index if exists "public"."page_tags_pkey";

drop index if exists "public"."photo_gallery_tags_pkey";

drop index if exists "public"."portfolio_tags_pkey";

drop index if exists "public"."product_tags_pkey";

drop index if exists "public"."product_type_tags_pkey";

drop index if exists "public"."promotion_tags_pkey";

drop index if exists "public"."testimony_tags_pkey";

drop index if exists "public"."video_gallery_tags_pkey";

drop table "public"."announcement_tags";

drop table "public"."contact_message_tags";

drop table "public"."contact_tags";

drop table "public"."page_tags";

drop table "public"."photo_gallery_tags";

drop table "public"."portfolio_tags";

drop table "public"."product_tags";

drop table "public"."product_type_tags";

drop table "public"."promotion_tags";

drop table "public"."testimony_tags";

drop table "public"."video_gallery_tags";

alter table "public"."contacts" add column "category_id" uuid;

alter table "public"."files" add column "category_id" uuid;

CREATE INDEX files_category_id_idx ON public.files USING btree (category_id);

CREATE INDEX idx_contacts_category_id ON public.contacts USING btree (category_id);

alter table "public"."contacts" add constraint "contacts_category_id_fkey" FOREIGN KEY (category_id) REFERENCES public.categories(id) ON DELETE SET NULL not valid;

alter table "public"."contacts" validate constraint "contacts_category_id_fkey";

alter table "public"."files" add constraint "files_category_id_fkey" FOREIGN KEY (category_id) REFERENCES public.categories(id) ON DELETE SET NULL not valid;

alter table "public"."files" validate constraint "files_category_id_fkey";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.handle_storage_sync()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_tenant_id UUID;
    v_public_url TEXT;
BEGIN
    -- Extract tenant_id from the first path token
    -- Pattern: bucket/tenant-id/path/to/file
    BEGIN
        v_tenant_id := (NEW.path_tokens[1])::UUID;
    EXCEPTION WHEN OTHERS THEN
        -- If the first token is not a valid UUID, skip synchronization
        -- This handles system files or non-tenant organized buckets
        RETURN NEW;
    END;

    -- Construct Public URL (using standard Supabase pattern)
    -- Format: https://[project-id].supabase.co/storage/v1/object/public/[bucket]/[path]
    -- Note: Project ID is stable per environment
    v_public_url := 'https://db.imveukxxtdwjgwsafwfl.supabase.co/storage/v1/object/public/' || NEW.bucket_id || '/' || NEW.name;

    IF (TG_OP = 'INSERT') THEN
        INSERT INTO public.files (
            id,
            name,
            file_path,
            file_size,
            file_type,
            bucket_name,
            uploaded_by,
            tenant_id,
            created_at,
            updated_at
        ) VALUES (
            NEW.id,
            NEW.name,
            v_public_url,
            (NEW.metadata->>'size')::BIGINT,
            NEW.metadata->>'mimetype',
            NEW.bucket_id,
            NEW.owner,
            v_tenant_id,
            NEW.created_at,
            NEW.updated_at
        ) ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            file_path = EXCLUDED.file_path,
            file_size = EXCLUDED.file_size,
            file_type = EXCLUDED.file_type,
            updated_at = EXCLUDED.updated_at;

    ELSIF (TG_OP = 'UPDATE') THEN
        UPDATE public.files SET
            name = NEW.name,
            file_path = v_public_url,
            file_size = (NEW.metadata->>'size')::BIGINT,
            file_type = NEW.metadata->>'mimetype',
            updated_at = NEW.updated_at,
            tenant_id = v_tenant_id
        WHERE id = NEW.id;

    ELSIF (TG_OP = 'DELETE') THEN
        -- Mark as deleted in public.files
        -- Frontend can decide to purge or keep soft-deleted record
        UPDATE public.files SET
            deleted_at = now()
        WHERE id = OLD.id;
    END IF;

    RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_resource_tags(p_resource_id uuid, p_resource_type text, p_tags text[], p_tenant_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tag_id UUID;
  v_tag_name TEXT;
  v_slug TEXT;
  target_table regclass;
BEGIN
  -- Restrict tag usage to articles only
  IF p_resource_type != 'articles' THEN
    RETURN;
  END IF;

  target_table := to_regclass('public.article_tags');
  
  IF target_table IS NULL THEN
    RETURN;
  END IF;

  -- Delete existing tags for this resource
  DELETE FROM "public"."article_tags" WHERE article_id = p_resource_id;

  IF p_tags IS NOT NULL THEN
    FOREACH v_tag_name IN ARRAY p_tags
    LOOP
      v_slug := trim(both '-' from lower(regexp_replace(v_tag_name, '[^a-zA-Z0-9]+', '-', 'g')));

      -- Ensure tag exists in public.tags (tenant-isolated)
      INSERT INTO public.tags (name, slug, tenant_id)
      VALUES (v_tag_name, v_slug, p_tenant_id)
      ON CONFLICT (tenant_id, slug) DO UPDATE SET name = v_tag_name
      RETURNING id INTO v_tag_id;

      -- Link tag to article
      INSERT INTO "public"."article_tags" (article_id, tag_id) VALUES (p_resource_id, v_tag_id);
    END LOOP;
  END IF;
END;
$function$
;


  create policy "Enable insert for authenticated users with permission"
  on "public"."orders"
  as permissive
  for insert
  to authenticated
with check (((user_id = auth.uid()) OR public.is_platform_admin() OR ((tenant_id = public.current_tenant_id()) AND (public.has_permission('create_orders'::text) OR public.has_permission('tenant.orders.create'::text)))));


CREATE TRIGGER objects_delete_delete_prefix AFTER DELETE ON storage.objects FOR EACH ROW EXECUTE FUNCTION storage.delete_prefix_hierarchy_trigger();

CREATE TRIGGER objects_insert_create_prefix BEFORE INSERT ON storage.objects FOR EACH ROW EXECUTE FUNCTION storage.objects_insert_prefix_trigger();

CREATE TRIGGER objects_update_create_prefix BEFORE UPDATE ON storage.objects FOR EACH ROW WHEN (((new.name <> old.name) OR (new.bucket_id <> old.bucket_id))) EXECUTE FUNCTION storage.objects_update_prefix_trigger();

CREATE TRIGGER tr_sync_storage_to_files AFTER INSERT OR DELETE OR UPDATE ON storage.objects FOR EACH ROW EXECUTE FUNCTION public.handle_storage_sync();

CREATE TRIGGER prefixes_create_hierarchy BEFORE INSERT ON storage.prefixes FOR EACH ROW WHEN ((pg_trigger_depth() < 1)) EXECUTE FUNCTION storage.prefixes_insert_trigger();

CREATE TRIGGER prefixes_delete_hierarchy AFTER DELETE ON storage.prefixes FOR EACH ROW EXECUTE FUNCTION storage.delete_prefix_hierarchy_trigger();


