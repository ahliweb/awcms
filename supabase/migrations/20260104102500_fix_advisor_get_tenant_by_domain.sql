-- Fix Security Advisor Warning: Function Search Path Mutable
-- Entity: public.get_tenant_by_domain

ALTER FUNCTION "public"."get_tenant_by_domain"("lookup_domain" "text") SET search_path = public;
