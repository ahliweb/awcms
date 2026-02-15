# Implementation Plan - Supabase Advisor Fixes

## 1. Tables Missing RLS (Critical)
Found 0 tables without RLS enabled.

## 2. Security Fixes (Permissive Policies)
The following tables have `tenant_id` but use permissive `USING (true)` or `WITH CHECK (true)` policies.
- **Table**: `sso_audit_logs`
  - **Policy**: `Admins View SSO Logs`
  - **Current**: `FOR SELECT USING (((("tenant_id" = "public"."current_tenant_id"()) AND "public"."has_permission"('tenant.sso.read'::"text")) OR "public"."is_platform_admin"() OR "public"."has_permission"('platform.sso.read'::"text")));



CREATE POLICY "Allow public read access" ON "public"."provinces" FOR SELECT USING (true)`
- **Table**: `extension_logs`
  - **Policy**: `Authenticated Insert`
  - **Current**: `FOR INSERT WITH CHECK ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"()));



CREATE POLICY "Enable insert for anonymous users" ON "public"."orders" FOR INSERT TO "anon" WITH CHECK (("tenant_id" = "public"."current_tenant_id"()));



CREATE POLICY "File permissions tenant isolation" ON "public"."file_permissions" TO "authenticated" USING (("public"."is_platform_admin"() OR (EXISTS ( SELECT 1
   FROM "public"."files" "f"
  WHERE (("f"."id" = "file_permissions"."file_id") AND ("f"."tenant_id" = "public"."current_tenant_id"())))))) WITH CHECK (("public"."is_platform_admin"() OR (EXISTS ( SELECT 1
   FROM "public"."files" "f"
  WHERE (("f"."id" = "file_permissions"."file_id") AND ("f"."tenant_id" = "public"."current_tenant_id"()))))));



CREATE POLICY "No Updates" ON "public"."extension_logs" FOR UPDATE USING (false);



CREATE POLICY "Payment methods Delete" ON "public"."payment_methods" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."users" "u"
  WHERE (("u"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("u"."role_id" IN ( SELECT "roles"."id"
           FROM "public"."roles"
          WHERE ("roles"."name" = ANY (ARRAY['owner'::"text", 'super_admin'::"text", 'admin'::"text"]))))))));



CREATE POLICY "Payment methods Insert" ON "public"."payment_methods" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users" "u"
  WHERE (("u"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("u"."role_id" IN ( SELECT "roles"."id"
           FROM "public"."roles"
          WHERE ("roles"."name" = ANY (ARRAY['owner'::"text", 'super_admin'::"text", 'admin'::"text"]))))))));



CREATE POLICY "Payment methods Select" ON "public"."payment_methods" FOR SELECT USING (((("is_active" = true) AND ("deleted_at" IS NULL)) OR (EXISTS ( SELECT 1
   FROM "public"."users" "u"
  WHERE (("u"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("u"."role_id" IN ( SELECT "roles"."id"
           FROM "public"."roles"
          WHERE ("roles"."name" = ANY (ARRAY['owner'::"text", 'super_admin'::"text", 'admin'::"text"])))))))));



CREATE POLICY "Payment methods Update" ON "public"."payment_methods" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."users" "u"
  WHERE (("u"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("u"."role_id" IN ( SELECT "roles"."id"
           FROM "public"."roles"
          WHERE ("roles"."name" = ANY (ARRAY['owner'::"text", 'super_admin'::"text", 'admin'::"text"]))))))));



CREATE POLICY "Payments Delete" ON "public"."payments" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."users" "u"
  WHERE (("u"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("u"."role_id" IN ( SELECT "roles"."id"
           FROM "public"."roles"
          WHERE ("roles"."name" = ANY (ARRAY['owner'::"text", 'super_admin'::"text", 'admin'::"text"]))))))));



CREATE POLICY "Payments Insert" ON "public"."payments" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users" "u"
  WHERE (("u"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("u"."role_id" IN ( SELECT "roles"."id"
           FROM "public"."roles"
          WHERE ("roles"."name" = ANY (ARRAY['owner'::"text", 'super_admin'::"text", 'admin'::"text"]))))))));



CREATE POLICY "Payments Select" ON "public"."payments" FOR SELECT USING (((EXISTS ( SELECT 1
   FROM "public"."users" "u"
  WHERE (("u"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("u"."role_id" IN ( SELECT "roles"."id"
           FROM "public"."roles"
          WHERE ("roles"."name" = ANY (ARRAY['owner'::"text", 'super_admin'::"text", 'admin'::"text"]))))))) OR (EXISTS ( SELECT 1
   FROM "public"."orders" "o"
  WHERE (("o"."id" = "payments"."order_id") AND ("o"."user_id" = ( SELECT "auth"."uid"() AS "uid")))))));



CREATE POLICY "Payments Update" ON "public"."payments" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."users" "u"
  WHERE (("u"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("u"."role_id" IN ( SELECT "roles"."id"
           FROM "public"."roles"
          WHERE ("roles"."name" = ANY (ARRAY['owner'::"text", 'super_admin'::"text", 'admin'::"text"]))))))));



CREATE POLICY "Platform Admin Delete Only" ON "public"."extension_logs" FOR DELETE USING ("public"."is_platform_admin"());



CREATE POLICY "Platform admins delete editor configs" ON "public"."component_registry" FOR DELETE USING (( SELECT "public"."is_platform_admin"() AS "is_platform_admin"));



CREATE POLICY "Platform admins delete resources" ON "public"."resources_registry" FOR DELETE USING (( SELECT "public"."is_platform_admin"() AS "is_platform_admin"));



CREATE POLICY "Platform admins delete schemas" ON "public"."ui_configs" FOR DELETE USING ("public"."is_platform_admin"());



CREATE POLICY "Platform admins insert editor configs" ON "public"."component_registry" FOR INSERT WITH CHECK (( SELECT "public"."is_platform_admin"() AS "is_platform_admin"));



CREATE POLICY "Platform admins insert resources" ON "public"."resources_registry" FOR INSERT WITH CHECK (( SELECT "public"."is_platform_admin"() AS "is_platform_admin"));



CREATE POLICY "Platform admins insert schemas" ON "public"."ui_configs" FOR INSERT WITH CHECK ("public"."is_platform_admin"());



CREATE POLICY "Platform admins update editor configs" ON "public"."component_registry" FOR UPDATE USING (( SELECT "public"."is_platform_admin"() AS "is_platform_admin")) WITH CHECK (( SELECT "public"."is_platform_admin"() AS "is_platform_admin"));



CREATE POLICY "Platform admins update resources" ON "public"."resources_registry" FOR UPDATE USING (( SELECT "public"."is_platform_admin"() AS "is_platform_admin")) WITH CHECK (( SELECT "public"."is_platform_admin"() AS "is_platform_admin"));



CREATE POLICY "Platform admins update schemas" ON "public"."ui_configs" FOR UPDATE USING ("public"."is_platform_admin"()) WITH CHECK ("public"."is_platform_admin"());



CREATE POLICY "Region levels viewable by authenticated" ON "public"."region_levels" FOR SELECT TO "authenticated" USING (true)`
- **Table**: `regions`
  - **Policy**: `Regions tenant isolation`
  - **Current**: `TO "authenticated" USING (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")));



CREATE POLICY "Tenant Delete Funfacts" ON "public"."funfacts" FOR DELETE TO "authenticated" USING (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")));



CREATE POLICY "Tenant Delete Partners" ON "public"."partners" FOR DELETE TO "authenticated" USING (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")));



CREATE POLICY "Tenant Delete Teams" ON "public"."teams" FOR DELETE TO "authenticated" USING (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")));



CREATE POLICY "Tenant Insert Funfacts" ON "public"."funfacts" FOR INSERT TO "authenticated" WITH CHECK (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")));



CREATE POLICY "Tenant Insert Partners" ON "public"."partners" FOR INSERT TO "authenticated" WITH CHECK (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")));



CREATE POLICY "Tenant Insert Teams" ON "public"."teams" FOR INSERT TO "authenticated" WITH CHECK (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")));



CREATE POLICY "Tenant Read Own Logs" ON "public"."extension_logs" FOR SELECT USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"()));



CREATE POLICY "Tenant Update Funfacts" ON "public"."funfacts" FOR UPDATE TO "authenticated" USING (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")));



CREATE POLICY "Tenant Update Partners" ON "public"."partners" FOR UPDATE TO "authenticated" USING (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")));



CREATE POLICY "Tenant Update Teams" ON "public"."teams" FOR UPDATE TO "authenticated" USING (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")));



CREATE POLICY "Unified delete analytics daily" ON "public"."analytics_daily" FOR DELETE TO "authenticated" USING (((("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")) AND "public"."is_admin_or_above"()) OR ( SELECT "public"."is_platform_admin"() AS "is_platform_admin")));



CREATE POLICY "Unified delete extension permissions" ON "public"."extension_permissions" FOR DELETE USING ((( SELECT "public"."is_platform_admin"() AS "is_platform_admin") OR (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")) OR "public"."tenant_can_access_resource"("tenant_id", 'extensions'::"text", 'write'::"text")) OR ( SELECT "public"."has_permission"('platform.extensions.delete'::"text") AS "has_permission")));



CREATE POLICY "Unified delete extension rbac" ON "public"."extension_rbac_integration" FOR DELETE USING ((( SELECT "public"."is_platform_admin"() AS "is_platform_admin") OR (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")) OR "public"."tenant_can_access_resource"("tenant_id", 'extensions'::"text", 'write'::"text")) OR ( SELECT "public"."has_permission"('platform.extensions.delete'::"text") AS "has_permission") OR (EXISTS ( SELECT 1
   FROM "public"."roles" "r"
  WHERE (("r"."id" = "extension_rbac_integration"."role_id") AND ("r"."tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")) AND "public"."is_admin_or_above"())))));



CREATE POLICY "Unified insert analytics daily" ON "public"."analytics_daily" FOR INSERT TO "authenticated" WITH CHECK (((("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")) AND "public"."is_admin_or_above"()) OR ( SELECT "public"."is_platform_admin"() AS "is_platform_admin")));



CREATE POLICY "Unified insert extension permissions" ON "public"."extension_permissions" FOR INSERT WITH CHECK ((( SELECT "public"."is_platform_admin"() AS "is_platform_admin") OR (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")) OR "public"."tenant_can_access_resource"("tenant_id", 'extensions'::"text", 'write'::"text")) OR ( SELECT "public"."has_permission"('platform.extensions.create'::"text") AS "has_permission")));



CREATE POLICY "Unified insert extension rbac" ON "public"."extension_rbac_integration" FOR INSERT WITH CHECK ((( SELECT "public"."is_platform_admin"() AS "is_platform_admin") OR (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")) OR "public"."tenant_can_access_resource"("tenant_id", 'extensions'::"text", 'write'::"text")) OR ( SELECT "public"."has_permission"('platform.extensions.create'::"text") AS "has_permission") OR (EXISTS ( SELECT 1
   FROM "public"."roles" "r"
  WHERE (("r"."id" = "extension_rbac_integration"."role_id") AND ("r"."tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")) AND "public"."is_admin_or_above"())))));



CREATE POLICY "Unified read analytics daily" ON "public"."analytics_daily" FOR SELECT USING ((("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")) OR ( SELECT "public"."is_platform_admin"() AS "is_platform_admin")));



CREATE POLICY "Unified read editor configs" ON "public"."component_registry" FOR SELECT USING ((( SELECT "public"."is_platform_admin"() AS "is_platform_admin") OR ("tenant_id" IS NULL) OR ("tenant_id" = ( SELECT "users"."tenant_id"
   FROM "public"."users"
  WHERE ("users"."id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Unified read resources" ON "public"."resources_registry" FOR SELECT USING ((( SELECT "public"."is_platform_admin"() AS "is_platform_admin") OR ("active" = true)));



CREATE POLICY "Unified read schemas" ON "public"."ui_configs" FOR SELECT USING ((( SELECT "public"."is_platform_admin"() AS "is_platform_admin") OR ("tenant_id" IS NULL) OR ("tenant_id" = ( SELECT "users"."tenant_id"
   FROM "public"."users"
  WHERE ("users"."id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Unified select extension permissions" ON "public"."extension_permissions" FOR SELECT USING ((( SELECT "public"."is_platform_admin"() AS "is_platform_admin") OR ("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")) OR "public"."tenant_can_access_resource"("tenant_id", 'extensions'::"text", 'read'::"text") OR ( SELECT "public"."has_permission"('platform.extensions.read'::"text") AS "has_permission")));



CREATE POLICY "Unified select extension rbac" ON "public"."extension_rbac_integration" FOR SELECT USING ((( SELECT "public"."is_platform_admin"() AS "is_platform_admin") OR ("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")) OR "public"."tenant_can_access_resource"("tenant_id", 'extensions'::"text", 'read'::"text") OR ( SELECT "public"."has_permission"('platform.extensions.read'::"text") AS "has_permission")));



CREATE POLICY "Unified select extension routes" ON "public"."extension_routes_registry" FOR SELECT USING ((("deleted_at" IS NULL) AND (( SELECT "public"."is_platform_admin"() AS "is_platform_admin") OR ("is_active" = true) OR ( SELECT "public"."has_permission"('platform.extensions.read'::"text") AS "has_permission"))));



CREATE POLICY "Unified update analytics daily" ON "public"."analytics_daily" FOR UPDATE TO "authenticated" USING (((("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")) AND "public"."is_admin_or_above"()) OR ( SELECT "public"."is_platform_admin"() AS "is_platform_admin"))) WITH CHECK (((("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")) AND "public"."is_admin_or_above"()) OR ( SELECT "public"."is_platform_admin"() AS "is_platform_admin")));



CREATE POLICY "Unified update extension permissions" ON "public"."extension_permissions" FOR UPDATE USING ((( SELECT "public"."is_platform_admin"() AS "is_platform_admin") OR (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")) OR "public"."tenant_can_access_resource"("tenant_id", 'extensions'::"text", 'write'::"text")) OR ( SELECT "public"."has_permission"('platform.extensions.update'::"text") AS "has_permission"))) WITH CHECK ((( SELECT "public"."is_platform_admin"() AS "is_platform_admin") OR (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")) OR "public"."tenant_can_access_resource"("tenant_id", 'extensions'::"text", 'write'::"text")) OR ( SELECT "public"."has_permission"('platform.extensions.update'::"text") AS "has_permission")));



CREATE POLICY "Unified update extension rbac" ON "public"."extension_rbac_integration" FOR UPDATE USING ((( SELECT "public"."is_platform_admin"() AS "is_platform_admin") OR (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")) OR "public"."tenant_can_access_resource"("tenant_id", 'extensions'::"text", 'write'::"text")) OR ( SELECT "public"."has_permission"('platform.extensions.update'::"text") AS "has_permission") OR (EXISTS ( SELECT 1
   FROM "public"."roles" "r"
  WHERE (("r"."id" = "extension_rbac_integration"."role_id") AND ("r"."tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")) AND "public"."is_admin_or_above"()))))) WITH CHECK ((( SELECT "public"."is_platform_admin"() AS "is_platform_admin") OR (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")) OR "public"."tenant_can_access_resource"("tenant_id", 'extensions'::"text", 'write'::"text")) OR ( SELECT "public"."has_permission"('platform.extensions.update'::"text") AS "has_permission") OR (EXISTS ( SELECT 1
   FROM "public"."roles" "r"
  WHERE (("r"."id" = "extension_rbac_integration"."role_id") AND ("r"."tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")) AND "public"."is_admin_or_above"())))));



CREATE POLICY "Users can delete own 2fa" ON "public"."two_factor_auth" FOR DELETE USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Users can insert own carts" ON "public"."carts" FOR INSERT WITH CHECK ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR ("session_id" IS NOT NULL)));



CREATE POLICY "Users can modify own 2fa" ON "public"."two_factor_auth" FOR UPDATE USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Users can update own 2fa" ON "public"."two_factor_auth" FOR INSERT WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Users can update own carts" ON "public"."carts" FOR UPDATE USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR ("session_id" IS NOT NULL)));



CREATE POLICY "Users can view own 2fa" ON "public"."two_factor_auth" FOR SELECT USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Users can view own 2fa logs" ON "public"."two_factor_audit_logs" FOR SELECT USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



ALTER TABLE "public"."account_requests" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "account_requests_delete_unified" ON "public"."account_requests" FOR DELETE USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"()));



CREATE POLICY "account_requests_insert_unified" ON "public"."account_requests" FOR INSERT WITH CHECK ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"()));



CREATE POLICY "account_requests_select_unified" ON "public"."account_requests" FOR SELECT USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"()));



CREATE POLICY "account_requests_update_unified" ON "public"."account_requests" FOR UPDATE USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"()));



ALTER TABLE "public"."admin_menus" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "admin_menus_delete_unified" ON "public"."admin_menus" FOR DELETE USING ("public"."is_platform_admin"());



CREATE POLICY "admin_menus_insert_unified" ON "public"."admin_menus" FOR INSERT WITH CHECK ("public"."is_platform_admin"());



CREATE POLICY "admin_menus_select_unified" ON "public"."admin_menus" FOR SELECT TO "authenticated" USING (true)`
- **Table**: `backup_schedules`
  - **Policy**: `backup_schedules_delete_owner`
  - **Current**: `FOR DELETE TO "authenticated" USING (("created_by" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "backup_schedules_insert_owner" ON "public"."backup_schedules" FOR INSERT TO "authenticated" WITH CHECK (("created_by" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "backup_schedules_select_auth" ON "public"."backup_schedules" FOR SELECT TO "authenticated" USING ((("created_by" IS NULL) OR ("created_by" = ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "backup_schedules_update_owner" ON "public"."backup_schedules" FOR UPDATE TO "authenticated" USING (("created_by" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("created_by" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."backups" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "backups_delete_unified" ON "public"."backups" FOR DELETE USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"()));



CREATE POLICY "backups_insert_unified" ON "public"."backups" FOR INSERT WITH CHECK ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"()));



CREATE POLICY "backups_select_unified" ON "public"."backups" FOR SELECT USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"()));



CREATE POLICY "backups_update_unified" ON "public"."backups" FOR UPDATE USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"()));



ALTER TABLE "public"."blog_tags" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "blog_tags_delete_hierarchy" ON "public"."blog_tags" FOR DELETE USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."tenant_can_access_resource"("tenant_id", 'content'::"text", 'write'::"text") OR "public"."is_platform_admin"()));



CREATE POLICY "blog_tags_insert_hierarchy" ON "public"."blog_tags" FOR INSERT WITH CHECK ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."tenant_can_access_resource"("tenant_id", 'content'::"text", 'write'::"text") OR "public"."is_platform_admin"()));



CREATE POLICY "blog_tags_select_hierarchy" ON "public"."blog_tags" FOR SELECT USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."tenant_can_access_resource"("tenant_id", 'content'::"text", 'read'::"text") OR "public"."is_platform_admin"()));



CREATE POLICY "blog_tags_update_hierarchy" ON "public"."blog_tags" FOR UPDATE USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."tenant_can_access_resource"("tenant_id", 'content'::"text", 'write'::"text") OR "public"."is_platform_admin"())) WITH CHECK ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."tenant_can_access_resource"("tenant_id", 'content'::"text", 'write'::"text") OR "public"."is_platform_admin"()));



ALTER TABLE "public"."blogs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "blogs_delete_hierarchy" ON "public"."blogs" FOR DELETE USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."tenant_can_access_resource"("tenant_id", 'content'::"text", 'write'::"text") OR "public"."is_platform_admin"()));



CREATE POLICY "blogs_insert_hierarchy" ON "public"."blogs" FOR INSERT WITH CHECK ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."tenant_can_access_resource"("tenant_id", 'content'::"text", 'write'::"text") OR "public"."is_platform_admin"()));



CREATE POLICY "blogs_select_unified" ON "public"."blogs" FOR SELECT USING ((("status" = 'published'::"text") OR (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")) OR "public"."tenant_can_access_resource"("tenant_id", 'content'::"text", 'read'::"text") OR "public"."is_platform_admin"())));



CREATE POLICY "blogs_update_hierarchy" ON "public"."blogs" FOR UPDATE USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."tenant_can_access_resource"("tenant_id", 'content'::"text", 'write'::"text") OR "public"."is_platform_admin"())) WITH CHECK ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."tenant_can_access_resource"("tenant_id", 'content'::"text", 'write'::"text") OR "public"."is_platform_admin"()));



ALTER TABLE "public"."cart_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "cart_items_delete_unified" ON "public"."cart_items" FOR DELETE USING (((("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin_or_above"()) OR "public"."is_platform_admin"()));



CREATE POLICY "cart_items_insert_unified" ON "public"."cart_items" FOR INSERT WITH CHECK (((("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin_or_above"()) OR "public"."is_platform_admin"()));



CREATE POLICY "cart_items_select_unified" ON "public"."cart_items" FOR SELECT USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"()));



CREATE POLICY "cart_items_update_unified" ON "public"."cart_items" FOR UPDATE USING (((("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin_or_above"()) OR "public"."is_platform_admin"()));



ALTER TABLE "public"."carts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "carts_select_policy" ON "public"."carts" FOR SELECT USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR ("session_id" IS NOT NULL) OR (EXISTS ( SELECT 1
   FROM "public"."users" "u"
  WHERE (("u"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("u"."role_id" IN ( SELECT "roles"."id"
           FROM "public"."roles"
          WHERE ("roles"."name" = ANY (ARRAY['owner'::"text", 'super_admin'::"text", 'admin'::"text"])))))))));



ALTER TABLE "public"."categories" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "categories_delete_unified" ON "public"."categories" FOR DELETE USING (((("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin_or_above"()) OR "public"."is_platform_admin"()));



CREATE POLICY "categories_insert_unified" ON "public"."categories" FOR INSERT WITH CHECK (((("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin_or_above"()) OR "public"."is_platform_admin"()));



CREATE POLICY "categories_select_unified" ON "public"."categories" FOR SELECT USING (true)`
- **Table**: `categories`
  - **Policy**: `categories_update_unified`
  - **Current**: `FOR UPDATE USING (((("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin_or_above"()) OR "public"."is_platform_admin"()));



ALTER TABLE "public"."component_registry" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."contact_messages" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "contact_messages_delete_admin" ON "public"."contact_messages" FOR DELETE USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"()));



CREATE POLICY "contact_messages_insert_with_tenant" ON "public"."contact_messages" FOR INSERT WITH CHECK (("tenant_id" IS NOT NULL));



CREATE POLICY "contact_messages_modify_admin" ON "public"."contact_messages" FOR UPDATE USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"()));



CREATE POLICY "contact_messages_select_unified" ON "public"."contact_messages" FOR SELECT USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"()));



ALTER TABLE "public"."contacts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "contacts_delete_unified" ON "public"."contacts" FOR DELETE USING (((("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin_or_above"()) OR "public"."is_platform_admin"()));



CREATE POLICY "contacts_insert_unified" ON "public"."contacts" FOR INSERT WITH CHECK (((("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin_or_above"()) OR "public"."is_platform_admin"()));



CREATE POLICY "contacts_select_unified" ON "public"."contacts" FOR SELECT USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"()));



CREATE POLICY "contacts_update_unified" ON "public"."contacts" FOR UPDATE USING (((("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin_or_above"()) OR "public"."is_platform_admin"()));



ALTER TABLE "public"."content_translations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "content_translations_delete_tenant" ON "public"."content_translations" FOR DELETE USING (("tenant_id" = "public"."get_current_tenant_id"()));



CREATE POLICY "content_translations_insert_tenant" ON "public"."content_translations" FOR INSERT WITH CHECK (("tenant_id" = "public"."get_current_tenant_id"()));



CREATE POLICY "content_translations_read_all" ON "public"."content_translations" FOR SELECT USING (true)`
- **Table**: `content_translations`
  - **Policy**: `content_translations_update_tenant`
  - **Current**: `FOR UPDATE USING (("tenant_id" = "public"."get_current_tenant_id"())) WITH CHECK (("tenant_id" = "public"."get_current_tenant_id"()));



ALTER TABLE "public"."devices" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "devices_delete_policy" ON "public"."devices" FOR DELETE USING (((("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")) AND ("owner_id" = ( SELECT "auth"."uid"() AS "uid"))) OR ( SELECT "public"."is_platform_admin"() AS "is_platform_admin")));



CREATE POLICY "devices_insert_policy" ON "public"."devices" FOR INSERT WITH CHECK (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")));



CREATE POLICY "devices_select_policy" ON "public"."devices" FOR SELECT USING (((("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")) AND ("owner_id" = ( SELECT "auth"."uid"() AS "uid"))) OR ( SELECT "public"."is_platform_admin"() AS "is_platform_admin")));



CREATE POLICY "devices_update_policy" ON "public"."devices" FOR UPDATE USING (((("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")) AND ("owner_id" = ( SELECT "auth"."uid"() AS "uid"))) OR ( SELECT "public"."is_platform_admin"() AS "is_platform_admin")));



ALTER TABLE "public"."email_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "email_logs_insert_unified" ON "public"."email_logs" FOR INSERT WITH CHECK (("public"."is_admin_or_above"() OR "public"."is_platform_admin"()));



CREATE POLICY "email_logs_select_unified" ON "public"."email_logs" FOR SELECT USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"()));



ALTER TABLE "public"."extension_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."extension_menu_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "extension_menu_items_delete_hierarchy" ON "public"."extension_menu_items" FOR DELETE USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."tenant_can_access_resource"("tenant_id", 'extensions'::"text", 'write'::"text") OR "public"."is_platform_admin"()));



CREATE POLICY "extension_menu_items_insert_hierarchy" ON "public"."extension_menu_items" FOR INSERT WITH CHECK ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."tenant_can_access_resource"("tenant_id", 'extensions'::"text", 'write'::"text") OR "public"."is_platform_admin"()));



CREATE POLICY "extension_menu_items_select_hierarchy" ON "public"."extension_menu_items" FOR SELECT USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."tenant_can_access_resource"("tenant_id", 'extensions'::"text", 'read'::"text") OR "public"."is_platform_admin"()));



CREATE POLICY "extension_menu_items_update_hierarchy" ON "public"."extension_menu_items" FOR UPDATE USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."tenant_can_access_resource"("tenant_id", 'extensions'::"text", 'write'::"text") OR "public"."is_platform_admin"())) WITH CHECK ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."tenant_can_access_resource"("tenant_id", 'extensions'::"text", 'write'::"text") OR "public"."is_platform_admin"()));



ALTER TABLE "public"."extension_permissions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."extension_rbac_integration" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."extension_routes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "extension_routes_delete_unified" ON "public"."extension_routes" FOR DELETE USING (((("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin_or_above"()) OR "public"."is_platform_admin"()));



CREATE POLICY "extension_routes_insert_unified" ON "public"."extension_routes" FOR INSERT WITH CHECK (((("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin_or_above"()) OR "public"."is_platform_admin"()));



ALTER TABLE "public"."extension_routes_registry" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "extension_routes_registry_delete_hierarchy" ON "public"."extension_routes_registry" FOR DELETE USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."tenant_can_access_resource"("tenant_id", 'extensions'::"text", 'write'::"text") OR "public"."is_platform_admin"()));



CREATE POLICY "extension_routes_registry_insert_hierarchy" ON "public"."extension_routes_registry" FOR INSERT WITH CHECK ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."tenant_can_access_resource"("tenant_id", 'extensions'::"text", 'write'::"text") OR "public"."is_platform_admin"()));



CREATE POLICY "extension_routes_registry_update_hierarchy" ON "public"."extension_routes_registry" FOR UPDATE USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."tenant_can_access_resource"("tenant_id", 'extensions'::"text", 'write'::"text") OR "public"."is_platform_admin"())) WITH CHECK ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."tenant_can_access_resource"("tenant_id", 'extensions'::"text", 'write'::"text") OR "public"."is_platform_admin"()));



CREATE POLICY "extension_routes_select_unified" ON "public"."extension_routes" FOR SELECT USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"()));



CREATE POLICY "extension_routes_update_unified" ON "public"."extension_routes" FOR UPDATE USING (((("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin_or_above"()) OR "public"."is_platform_admin"()));



ALTER TABLE "public"."extensions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "extensions_delete_hierarchy" ON "public"."extensions" FOR DELETE USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."tenant_can_access_resource"("tenant_id", 'extensions'::"text", 'write'::"text") OR "public"."is_platform_admin"()));



CREATE POLICY "extensions_insert_hierarchy" ON "public"."extensions" FOR INSERT WITH CHECK ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."tenant_can_access_resource"("tenant_id", 'extensions'::"text", 'write'::"text") OR "public"."is_platform_admin"()));



CREATE POLICY "extensions_select_hierarchy" ON "public"."extensions" FOR SELECT USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."tenant_can_access_resource"("tenant_id", 'extensions'::"text", 'read'::"text") OR "public"."is_platform_admin"()));



CREATE POLICY "extensions_update_hierarchy" ON "public"."extensions" FOR UPDATE USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."tenant_can_access_resource"("tenant_id", 'extensions'::"text", 'write'::"text") OR "public"."is_platform_admin"())) WITH CHECK ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."tenant_can_access_resource"("tenant_id", 'extensions'::"text", 'write'::"text") OR "public"."is_platform_admin"()));



ALTER TABLE "public"."file_permissions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."files" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "files_delete_hierarchy" ON "public"."files" FOR DELETE USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."tenant_can_access_resource"("tenant_id", 'media'::"text", 'write'::"text") OR "public"."is_platform_admin"()));



CREATE POLICY "files_insert_hierarchy" ON "public"."files" FOR INSERT WITH CHECK ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."tenant_can_access_resource"("tenant_id", 'media'::"text", 'write'::"text") OR "public"."is_platform_admin"()));



CREATE POLICY "files_select_hierarchy" ON "public"."files" FOR SELECT USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."tenant_can_access_resource"("tenant_id", 'media'::"text", 'read'::"text") OR "public"."is_platform_admin"()));



CREATE POLICY "files_update_hierarchy" ON "public"."files" FOR UPDATE USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."tenant_can_access_resource"("tenant_id", 'media'::"text", 'write'::"text") OR "public"."is_platform_admin"())) WITH CHECK ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."tenant_can_access_resource"("tenant_id", 'media'::"text", 'write'::"text") OR "public"."is_platform_admin"()));



ALTER TABLE "public"."funfacts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "funfacts_select_unified" ON "public"."funfacts" FOR SELECT USING ((("status" = 'published'::"text") OR ("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")) OR "public"."is_platform_admin"()));



ALTER TABLE "public"."menu_permissions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "menu_permissions_select_public" ON "public"."menu_permissions" FOR SELECT USING (true)`
- **Table**: `menus`
  - **Policy**: `menus_delete_hierarchy`
  - **Current**: `FOR DELETE USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."tenant_can_access_resource"("tenant_id", 'menus'::"text", 'write'::"text") OR "public"."is_platform_admin"()));



CREATE POLICY "menus_insert_hierarchy" ON "public"."menus" FOR INSERT WITH CHECK ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."tenant_can_access_resource"("tenant_id", 'menus'::"text", 'write'::"text") OR "public"."is_platform_admin"()));



CREATE POLICY "menus_select_hierarchy" ON "public"."menus" FOR SELECT USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."tenant_can_access_resource"("tenant_id", 'menus'::"text", 'read'::"text") OR "public"."is_platform_admin"()));



CREATE POLICY "menus_update_hierarchy" ON "public"."menus" FOR UPDATE USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."tenant_can_access_resource"("tenant_id", 'menus'::"text", 'write'::"text") OR "public"."is_platform_admin"())) WITH CHECK ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."tenant_can_access_resource"("tenant_id", 'menus'::"text", 'write'::"text") OR "public"."is_platform_admin"()));



ALTER TABLE "public"."mobile_app_config" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "mobile_app_config_access" ON "public"."mobile_app_config" USING ((("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")) OR ( SELECT "public"."is_platform_admin"() AS "is_platform_admin")));



ALTER TABLE "public"."mobile_users" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "mobile_users_access" ON "public"."mobile_users" USING (((("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")) AND ("user_id" = ( SELECT "auth"."uid"() AS "uid"))) OR ( SELECT "public"."is_admin_or_above"() AS "is_admin_or_above") OR ( SELECT "public"."is_platform_admin"() AS "is_platform_admin")));



ALTER TABLE "public"."modules" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "modules_read_policy" ON "public"."modules" FOR SELECT USING (("public"."is_platform_admin"() OR (("tenant_id" = "public"."get_current_tenant_id"()) AND "public"."is_admin_or_above"())));



ALTER TABLE "public"."notification_readers" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "notification_readers_delete_policy" ON "public"."notification_readers" FOR DELETE USING (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "notification_readers_insert_policy" ON "public"."notification_readers" FOR INSERT WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "notification_readers_select_policy" ON "public"."notification_readers" FOR SELECT USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR (("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin_or_above"()) OR "public"."is_platform_admin"()));



ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "notifications_delete_unified" ON "public"."notifications" FOR DELETE USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR (("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin_or_above"()) OR "public"."is_platform_admin"()));



CREATE POLICY "notifications_insert_unified" ON "public"."notifications" FOR INSERT WITH CHECK ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR (("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin_or_above"()) OR "public"."is_platform_admin"()));



CREATE POLICY "notifications_select_unified" ON "public"."notifications" FOR SELECT USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR (("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin_or_above"()) OR "public"."is_platform_admin"()));



CREATE POLICY "notifications_update_unified" ON "public"."notifications" FOR UPDATE USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR (("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin_or_above"()) OR "public"."is_platform_admin"()));



ALTER TABLE "public"."order_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "order_items_delete_unified" ON "public"."order_items" FOR DELETE USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"()));



CREATE POLICY "order_items_insert_unified" ON "public"."order_items" FOR INSERT WITH CHECK ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"()));



CREATE POLICY "order_items_select_unified" ON "public"."order_items" FOR SELECT USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"()));



CREATE POLICY "order_items_update_unified" ON "public"."order_items" FOR UPDATE USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"()));



ALTER TABLE "public"."orders" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "orders_insert_auth" ON "public"."orders" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "orders_select_auth" ON "public"."orders" FOR SELECT TO "authenticated" USING (((( SELECT "auth"."uid"() AS "uid") = "user_id") OR (("tenant_id" = ( SELECT "users"."tenant_id"
   FROM "public"."users"
  WHERE ("users"."id" = ( SELECT "auth"."uid"() AS "uid")))) AND (( SELECT "public"."get_my_role_name"() AS "get_my_role_name") = ANY (ARRAY['admin'::"text", 'editor'::"text"]))) OR (( SELECT "public"."get_my_role_name"() AS "get_my_role_name") = 'super_admin'::"text")));



ALTER TABLE "public"."page_categories" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "page_categories_delete_hierarchy" ON "public"."page_categories" FOR DELETE USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."tenant_can_access_resource"("tenant_id", 'content'::"text", 'write'::"text") OR "public"."is_platform_admin"()));



CREATE POLICY "page_categories_insert_hierarchy" ON "public"."page_categories" FOR INSERT WITH CHECK ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."tenant_can_access_resource"("tenant_id", 'content'::"text", 'write'::"text") OR "public"."is_platform_admin"()));



CREATE POLICY "page_categories_select_hierarchy" ON "public"."page_categories" FOR SELECT USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."tenant_can_access_resource"("tenant_id", 'content'::"text", 'read'::"text") OR "public"."is_platform_admin"()));



CREATE POLICY "page_categories_update_hierarchy" ON "public"."page_categories" FOR UPDATE USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."tenant_can_access_resource"("tenant_id", 'content'::"text", 'write'::"text") OR "public"."is_platform_admin"())) WITH CHECK ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."tenant_can_access_resource"("tenant_id", 'content'::"text", 'write'::"text") OR "public"."is_platform_admin"()));



ALTER TABLE "public"."page_files" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "page_files_delete_tenant" ON "public"."page_files" FOR DELETE USING (("tenant_id" = "public"."get_current_tenant_id"()));



CREATE POLICY "page_files_insert_tenant" ON "public"."page_files" FOR INSERT WITH CHECK (("tenant_id" = "public"."get_current_tenant_id"()));



CREATE POLICY "page_files_read_all" ON "public"."page_files" FOR SELECT USING (true)`
- **Table**: `page_files`
  - **Policy**: `page_files_update_tenant`
  - **Current**: `FOR UPDATE USING (("tenant_id" = "public"."get_current_tenant_id"())) WITH CHECK (("tenant_id" = "public"."get_current_tenant_id"()));



ALTER TABLE "public"."pages" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "pages_delete_hierarchy" ON "public"."pages" FOR DELETE USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."tenant_can_access_resource"("tenant_id", 'content'::"text", 'write'::"text") OR "public"."is_platform_admin"()));



CREATE POLICY "pages_insert_hierarchy" ON "public"."pages" FOR INSERT WITH CHECK ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."tenant_can_access_resource"("tenant_id", 'content'::"text", 'write'::"text") OR "public"."is_platform_admin"()));



CREATE POLICY "pages_select_hierarchy" ON "public"."pages" FOR SELECT USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."tenant_can_access_resource"("tenant_id", 'content'::"text", 'read'::"text") OR "public"."is_platform_admin"()));



CREATE POLICY "pages_update_hierarchy" ON "public"."pages" FOR UPDATE USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."tenant_can_access_resource"("tenant_id", 'content'::"text", 'write'::"text") OR "public"."is_platform_admin"())) WITH CHECK ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."tenant_can_access_resource"("tenant_id", 'content'::"text", 'write'::"text") OR "public"."is_platform_admin"()));



ALTER TABLE "public"."partners" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "partners_select_unified" ON "public"."partners" FOR SELECT USING ((("status" = 'published'::"text") OR ("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")) OR "public"."is_platform_admin"()));



ALTER TABLE "public"."payment_methods" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."payments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."permissions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "permissions_delete_policy" ON "public"."permissions" FOR DELETE TO "authenticated" USING ("public"."is_super_admin"());



CREATE POLICY "permissions_insert_policy" ON "public"."permissions" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_super_admin"());



CREATE POLICY "permissions_select_policy" ON "public"."permissions" FOR SELECT TO "authenticated" USING (true)`
- **Table**: `services`
  - **Policy**: `services_delete_hierarchy`
  - **Current**: `FOR DELETE USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."tenant_can_access_resource"("tenant_id", 'content'::"text", 'write'::"text") OR "public"."is_platform_admin"()));



CREATE POLICY "services_insert_hierarchy" ON "public"."services" FOR INSERT WITH CHECK ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."tenant_can_access_resource"("tenant_id", 'content'::"text", 'write'::"text") OR "public"."is_platform_admin"()));



CREATE POLICY "services_select_unified" ON "public"."services" FOR SELECT USING ((("status" = 'published'::"text") OR (("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")) OR "public"."tenant_can_access_resource"("tenant_id", 'content'::"text", 'read'::"text") OR "public"."is_platform_admin"())));



CREATE POLICY "services_update_hierarchy" ON "public"."services" FOR UPDATE USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."tenant_can_access_resource"("tenant_id", 'content'::"text", 'write'::"text") OR "public"."is_platform_admin"())) WITH CHECK ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."tenant_can_access_resource"("tenant_id", 'content'::"text", 'write'::"text") OR "public"."is_platform_admin"()));



ALTER TABLE "public"."settings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "settings_delete_hierarchy" ON "public"."settings" FOR DELETE USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."tenant_can_access_resource"("tenant_id", 'settings'::"text", 'write'::"text") OR "public"."is_platform_admin"()));



CREATE POLICY "settings_insert_hierarchy" ON "public"."settings" FOR INSERT WITH CHECK ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."tenant_can_access_resource"("tenant_id", 'settings'::"text", 'write'::"text") OR "public"."is_platform_admin"()));



CREATE POLICY "settings_select_hierarchy" ON "public"."settings" FOR SELECT USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."tenant_can_access_resource"("tenant_id", 'settings'::"text", 'read'::"text") OR "public"."is_platform_admin"()));



CREATE POLICY "settings_update_hierarchy" ON "public"."settings" FOR UPDATE USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."tenant_can_access_resource"("tenant_id", 'settings'::"text", 'write'::"text") OR "public"."is_platform_admin"())) WITH CHECK ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."tenant_can_access_resource"("tenant_id", 'settings'::"text", 'write'::"text") OR "public"."is_platform_admin"()));



ALTER TABLE "public"."sso_audit_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sso_providers" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sso_providers_isolation_policy" ON "public"."sso_providers" USING (((("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin_or_above"()) OR "public"."is_platform_admin"()));



ALTER TABLE "public"."sso_role_mappings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sso_role_mappings_delete_unified" ON "public"."sso_role_mappings" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."sso_providers" "p"
  WHERE (("p"."id" = ("sso_role_mappings"."provider_id")::"uuid") AND ((("p"."tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin_or_above"()) OR "public"."is_platform_admin"())))));



CREATE POLICY "sso_role_mappings_insert_unified" ON "public"."sso_role_mappings" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."sso_providers" "p"
  WHERE (("p"."id" = ("sso_role_mappings"."provider_id")::"uuid") AND ((("p"."tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin_or_above"()) OR "public"."is_platform_admin"())))));



CREATE POLICY "sso_role_mappings_select_unified" ON "public"."sso_role_mappings" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."sso_providers" "p"
  WHERE (("p"."id" = ("sso_role_mappings"."provider_id")::"uuid") AND (("p"."tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"())))));



CREATE POLICY "sso_role_mappings_update_unified" ON "public"."sso_role_mappings" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."sso_providers" "p"
  WHERE (("p"."id" = ("sso_role_mappings"."provider_id")::"uuid") AND ((("p"."tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin_or_above"()) OR "public"."is_platform_admin"())))));



ALTER TABLE "public"."tags" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "tags_delete_unified" ON "public"."tags" FOR DELETE USING (((("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin_or_above"()) OR "public"."is_platform_admin"()));



CREATE POLICY "tags_insert_unified" ON "public"."tags" FOR INSERT WITH CHECK (((("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin_or_above"()) OR "public"."is_platform_admin"()));



CREATE POLICY "tags_select_unified" ON "public"."tags" FOR SELECT USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"()));



CREATE POLICY "tags_update_unified" ON "public"."tags" FOR UPDATE USING (((("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_admin_or_above"()) OR "public"."is_platform_admin"()));



ALTER TABLE "public"."teams" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "teams_select_unified" ON "public"."teams" FOR SELECT USING ((("status" = 'published'::"text") OR ("tenant_id" = ( SELECT "public"."current_tenant_id"() AS "current_tenant_id")) OR "public"."is_platform_admin"()));



ALTER TABLE "public"."template_assignments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "template_assignments_delete_unified" ON "public"."template_assignments" FOR DELETE USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"()));



CREATE POLICY "template_assignments_modify_unified" ON "public"."template_assignments" FOR INSERT WITH CHECK ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"()));



CREATE POLICY "template_assignments_select_unified" ON "public"."template_assignments" FOR SELECT USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"()));



CREATE POLICY "template_assignments_update_unified" ON "public"."template_assignments" FOR UPDATE USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"()));



ALTER TABLE "public"."template_parts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "template_parts_delete_unified" ON "public"."template_parts" FOR DELETE USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"()));



CREATE POLICY "template_parts_modify_unified" ON "public"."template_parts" FOR INSERT WITH CHECK ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"()));



CREATE POLICY "template_parts_select_unified" ON "public"."template_parts" FOR SELECT USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"()));



CREATE POLICY "template_parts_update_unified" ON "public"."template_parts" FOR UPDATE USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."is_platform_admin"()));



ALTER TABLE "public"."template_strings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "template_strings_delete_unified" ON "public"."template_strings" FOR DELETE USING ("public"."is_platform_admin"());



CREATE POLICY "template_strings_insert_unified" ON "public"."template_strings" FOR INSERT WITH CHECK ("public"."is_platform_admin"());



CREATE POLICY "template_strings_select_unified" ON "public"."template_strings" FOR SELECT USING (true)`
- **Table**: `template_strings`
  - **Policy**: `template_strings_update_unified`
  - **Current**: `FOR UPDATE USING ("public"."is_platform_admin"());



ALTER TABLE "public"."templates" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "templates_delete_hierarchy" ON "public"."templates" FOR DELETE USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."tenant_can_access_resource"("tenant_id", 'templates'::"text", 'write'::"text") OR "public"."is_platform_admin"()));



CREATE POLICY "templates_insert_hierarchy" ON "public"."templates" FOR INSERT WITH CHECK ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."tenant_can_access_resource"("tenant_id", 'templates'::"text", 'write'::"text") OR "public"."is_platform_admin"()));



CREATE POLICY "templates_select_hierarchy" ON "public"."templates" FOR SELECT USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."tenant_can_access_resource"("tenant_id", 'templates'::"text", 'read'::"text") OR "public"."is_platform_admin"()));



CREATE POLICY "templates_update_hierarchy" ON "public"."templates" FOR UPDATE USING ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."tenant_can_access_resource"("tenant_id", 'templates'::"text", 'write'::"text") OR "public"."is_platform_admin"())) WITH CHECK ((("tenant_id" = "public"."current_tenant_id"()) OR "public"."tenant_can_access_resource"("tenant_id", 'templates'::"text", 'write'::"text") OR "public"."is_platform_admin"()));



ALTER TABLE "public"."tenant_channels" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "tenant_channels_delete" ON "public"."tenant_channels" FOR DELETE USING ("public"."is_platform_admin"());



CREATE POLICY "tenant_channels_insert" ON "public"."tenant_channels" FOR INSERT WITH CHECK (("public"."is_platform_admin"() OR (("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_media_manage_role"())));



CREATE POLICY "tenant_channels_select_active" ON "public"."tenant_channels" FOR SELECT USING (("is_active" = true));



CREATE POLICY "tenant_channels_update" ON "public"."tenant_channels" FOR UPDATE USING (("public"."is_platform_admin"() OR (("tenant_id" = "public"."current_tenant_id"()) AND "public"."is_media_manage_role"())));



ALTER TABLE "public"."tenant_resource_registry" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "tenant_resource_registry_select" ON "public"."tenant_resource_registry" FOR SELECT TO "authenticated" USING (true)`

## 3. Performance Fixes (Missing Indexes)
The following Foreign Keys are unindexed.

### 3.1 Critical Indexes (tenant_id) - 7 found
- Table: `analytics_daily`, Column: `tenant_id`
- Table: `analytics_events`, Column: `tenant_id`
- Table: `mobile_app_config`, Column: `tenant_id`
- Table: `modules`, Column: `tenant_id`
- Table: `tenant_channels`, Column: `tenant_id`
- Table: `tenant_resource_rules`, Column: `tenant_id`
- Table: `tenant_role_links`, Column: `tenant_id`

### 3.2 Other Foreign Key Indexes - 3 found
- Table: `extension_permissions`, Column: `extension_id`
- Table: `two_factor_auth`, Column: `user_id`
- Table: `ui_configs`, Column: `resource_key`
