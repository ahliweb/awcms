alter table "public"."audit_logs" add column "deleted_at" timestamp with time zone;

alter table "public"."settings" add column "deleted_at" timestamp with time zone;

alter table "public"."template_parts" add column "slug" text;

CREATE INDEX idx_template_parts_slug ON public.template_parts USING btree (slug);


