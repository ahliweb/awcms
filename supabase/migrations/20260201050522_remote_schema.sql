alter table "public"."roles" add constraint "check_roles_scope" CHECK ((scope = ANY (ARRAY['platform'::text, 'tenant'::text, 'content'::text, 'module'::text]))) not valid;

alter table "public"."roles" validate constraint "check_roles_scope";


