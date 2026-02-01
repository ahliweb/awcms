drop policy "Platform admins manage components" on "public"."component_registry";

drop policy "Tenants read components" on "public"."component_registry";

drop policy "Platform admins manage configs" on "public"."ui_configs";

drop policy "Tenants read configs" on "public"."ui_configs";

alter table "public"."admin_menus" drop constraint "admin_menus_resource_id_fkey";

alter table "public"."component_registry" drop constraint "component_registry_editor_type_check";

alter table "public"."component_registry" drop constraint "component_registry_resource_key_fkey";

alter table "public"."component_registry" drop constraint "component_registry_tenant_id_fkey";

alter table "public"."ui_configs" drop constraint "ui_configs_resource_key_fkey";

alter table "public"."ui_configs" drop constraint "ui_configs_resource_key_type_tenant_id_name_key";

alter table "public"."ui_configs" drop constraint "ui_configs_tenant_id_fkey";

alter table "public"."ui_configs" drop constraint "ui_configs_type_check";

alter table "public"."resources_registry" drop constraint "resources_registry_key_key";

alter table "public"."component_registry" drop constraint "component_registry_pkey";

alter table "public"."resources_registry" drop constraint "resources_registry_pkey";

alter table "public"."ui_configs" drop constraint "ui_configs_pkey";

drop index if exists "public"."component_registry_pkey";

drop index if exists "public"."resources_registry_key_key";

drop index if exists "public"."resources_registry_pkey";

drop index if exists "public"."ui_configs_pkey";

drop index if exists "public"."ui_configs_resource_key_type_tenant_id_name_key";

CREATE UNIQUE INDEX editor_configurations_pkey ON public.component_registry USING btree (id);

CREATE UNIQUE INDEX system_resources_key_key ON public.resources_registry USING btree (key);

CREATE UNIQUE INDEX system_resources_pkey ON public.resources_registry USING btree (id);

CREATE UNIQUE INDEX ui_schemas_pkey ON public.ui_configs USING btree (id);

CREATE UNIQUE INDEX ui_schemas_resource_key_type_tenant_id_name_key ON public.ui_configs USING btree (resource_key, type, tenant_id, name);

alter table "public"."component_registry" add constraint "editor_configurations_pkey" PRIMARY KEY using index "editor_configurations_pkey";

alter table "public"."resources_registry" add constraint "system_resources_pkey" PRIMARY KEY using index "system_resources_pkey";

alter table "public"."ui_configs" add constraint "ui_schemas_pkey" PRIMARY KEY using index "ui_schemas_pkey";

alter table "public"."component_registry" add constraint "editor_configurations_editor_type_check" CHECK ((editor_type = ANY (ARRAY['tiptap'::text, 'puck'::text, 'monaco'::text]))) not valid;

alter table "public"."component_registry" validate constraint "editor_configurations_editor_type_check";

alter table "public"."component_registry" add constraint "editor_configurations_resource_key_fkey" FOREIGN KEY (resource_key) REFERENCES public.resources_registry(key) ON DELETE CASCADE not valid;

alter table "public"."component_registry" validate constraint "editor_configurations_resource_key_fkey";

alter table "public"."component_registry" add constraint "editor_configurations_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE not valid;

alter table "public"."component_registry" validate constraint "editor_configurations_tenant_id_fkey";

alter table "public"."resources_registry" add constraint "system_resources_key_key" UNIQUE using index "system_resources_key_key";

alter table "public"."ui_configs" add constraint "ui_schemas_resource_key_fkey" FOREIGN KEY (resource_key) REFERENCES public.resources_registry(key) ON DELETE CASCADE not valid;

alter table "public"."ui_configs" validate constraint "ui_schemas_resource_key_fkey";

alter table "public"."ui_configs" add constraint "ui_schemas_resource_key_type_tenant_id_name_key" UNIQUE using index "ui_schemas_resource_key_type_tenant_id_name_key";

alter table "public"."ui_configs" add constraint "ui_schemas_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE not valid;

alter table "public"."ui_configs" validate constraint "ui_schemas_tenant_id_fkey";

alter table "public"."ui_configs" add constraint "ui_schemas_type_check" CHECK ((type = ANY (ARRAY['form'::text, 'table'::text, 'view'::text, 'dashboard'::text]))) not valid;

alter table "public"."ui_configs" validate constraint "ui_schemas_type_check";


  create policy "Platform admins manage editor configs"
  on "public"."component_registry"
  as permissive
  for all
  to public
using (public.is_platform_admin())
with check (public.is_platform_admin());



  create policy "Tenants read editor configs"
  on "public"."component_registry"
  as permissive
  for select
  to public
using (((tenant_id IS NULL) OR (tenant_id = ( SELECT users.tenant_id
   FROM public.users
  WHERE (users.id = auth.uid())))));



  create policy "Platform admins manage schemas"
  on "public"."ui_configs"
  as permissive
  for all
  to public
using (public.is_platform_admin())
with check (public.is_platform_admin());



  create policy "Tenants read schemas"
  on "public"."ui_configs"
  as permissive
  for select
  to public
using (((tenant_id IS NULL) OR (tenant_id = ( SELECT users.tenant_id
   FROM public.users
  WHERE (users.id = auth.uid())))));


-- CREATE TRIGGER objects_delete_delete_prefix AFTER DELETE ON storage.objects FOR EACH ROW EXECUTE FUNCTION storage.delete_prefix_hierarchy_trigger();

-- CREATE TRIGGER objects_insert_create_prefix BEFORE INSERT ON storage.objects FOR EACH ROW EXECUTE FUNCTION storage.objects_insert_prefix_trigger();

-- CREATE TRIGGER objects_update_create_prefix BEFORE UPDATE ON storage.objects FOR EACH ROW WHEN (((new.name <> old.name) OR (new.bucket_id <> old.bucket_id))) EXECUTE FUNCTION storage.objects_update_prefix_trigger();

-- CREATE TRIGGER prefixes_create_hierarchy BEFORE INSERT ON storage.prefixes FOR EACH ROW WHEN ((pg_trigger_depth() < 1)) EXECUTE FUNCTION storage.prefixes_insert_trigger();

-- CREATE TRIGGER prefixes_delete_hierarchy AFTER DELETE ON storage.prefixes FOR EACH ROW EXECUTE FUNCTION storage.delete_prefix_hierarchy_trigger();



alter table "public"."admin_menus" add constraint "admin_menus_resource_id_fkey" FOREIGN KEY (resource_id) REFERENCES public.resources_registry(id) ON DELETE SET NULL;
