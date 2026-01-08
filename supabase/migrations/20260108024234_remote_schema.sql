drop trigger if exists "audit_account_requests" on "public"."account_requests";

drop trigger if exists "audit_log_changes_admin_menus" on "public"."admin_menus";

drop trigger if exists "lock_created_by_trg" on "public"."announcement_tags";

drop trigger if exists "set_created_by_trg" on "public"."announcement_tags";

drop trigger if exists "lock_created_by_trg" on "public"."announcements";

drop trigger if exists "set_created_by_trg" on "public"."announcements";

drop trigger if exists "trg_set_tenant_id" on "public"."announcements";

drop trigger if exists "update_announcements_updated_at" on "public"."announcements";

drop trigger if exists "lock_created_by_trg" on "public"."article_tags";

drop trigger if exists "set_created_by_trg" on "public"."article_tags";

drop trigger if exists "lock_created_by_trg" on "public"."articles";

drop trigger if exists "set_created_by_trg" on "public"."articles";

drop trigger if exists "trg_articles_audit" on "public"."articles";

drop trigger if exists "trg_set_tenant_id" on "public"."articles";

drop trigger if exists "update_articles_updated_at" on "public"."articles";

drop trigger if exists "lock_created_by_trg" on "public"."auth_hibp_events";

drop trigger if exists "set_created_by_trg" on "public"."auth_hibp_events";

drop trigger if exists "lock_created_by_trg" on "public"."backup_logs";

drop trigger if exists "set_created_by_trg" on "public"."backup_logs";

drop trigger if exists "lock_created_by_trg" on "public"."backup_schedules";

drop trigger if exists "set_created_by_trg" on "public"."backup_schedules";

drop trigger if exists "lock_created_by_trg" on "public"."backups";

drop trigger if exists "set_created_by_trg" on "public"."backups";

drop trigger if exists "lock_created_by_trg" on "public"."categories";

drop trigger if exists "set_created_by_trg" on "public"."categories";

drop trigger if exists "trg_set_tenant_id" on "public"."categories";

drop trigger if exists "lock_created_by_trg" on "public"."contact_message_tags";

drop trigger if exists "set_created_by_trg" on "public"."contact_message_tags";

drop trigger if exists "lock_created_by_trg" on "public"."contact_messages";

drop trigger if exists "set_created_by_trg" on "public"."contact_messages";

drop trigger if exists "trg_set_tenant_id" on "public"."contact_messages";

drop trigger if exists "lock_created_by_trg" on "public"."contact_tags";

drop trigger if exists "set_created_by_trg" on "public"."contact_tags";

drop trigger if exists "lock_created_by_trg" on "public"."contacts";

drop trigger if exists "set_created_by_trg" on "public"."contacts";

drop trigger if exists "lock_created_by_trg" on "public"."extension_menu_items";

drop trigger if exists "set_created_by_trg" on "public"."extension_menu_items";

drop trigger if exists "lock_created_by_trg" on "public"."extension_permissions";

drop trigger if exists "set_created_by_trg" on "public"."extension_permissions";

drop trigger if exists "lock_created_by_trg" on "public"."extension_rbac_integration";

drop trigger if exists "set_created_by_trg" on "public"."extension_rbac_integration";

drop trigger if exists "lock_created_by_trg" on "public"."extension_routes";

drop trigger if exists "set_created_by_trg" on "public"."extension_routes";

drop trigger if exists "trg_set_tenant_id" on "public"."extension_routes";

drop trigger if exists "update_extension_routes_updated_at" on "public"."extension_routes";

drop trigger if exists "lock_created_by_trg" on "public"."extension_routes_registry";

drop trigger if exists "set_created_by_trg" on "public"."extension_routes_registry";

drop trigger if exists "extension_audit_trigger" on "public"."extensions";

drop trigger if exists "lock_created_by_trg" on "public"."extensions";

drop trigger if exists "set_created_by_trg" on "public"."extensions";

drop trigger if exists "trg_set_tenant_id" on "public"."extensions";

drop trigger if exists "update_extensions_updated_at" on "public"."extensions";

drop trigger if exists "tr_enforce_storage_limit" on "public"."files";

drop trigger if exists "trg_set_tenant_id" on "public"."files";

drop trigger if exists "update_files_updated_at" on "public"."files";

drop trigger if exists "lock_created_by_trg" on "public"."menu_permissions";

drop trigger if exists "set_created_by_trg" on "public"."menu_permissions";

drop trigger if exists "lock_created_by_trg" on "public"."menus";

drop trigger if exists "set_created_by_trg" on "public"."menus";

drop trigger if exists "trg_set_tenant_id" on "public"."menus";

drop trigger if exists "update_notifications_updated_at" on "public"."notifications";

drop trigger if exists "audit_orders" on "public"."orders";

drop trigger if exists "trg_set_tenant_id" on "public"."orders";

drop trigger if exists "lock_created_by_trg" on "public"."page_categories";

drop trigger if exists "set_created_by_trg" on "public"."page_categories";

drop trigger if exists "lock_created_by_trg" on "public"."page_tags";

drop trigger if exists "set_created_by_trg" on "public"."page_tags";

drop trigger if exists "lock_created_by_trg" on "public"."pages";

drop trigger if exists "set_created_by_trg" on "public"."pages";

drop trigger if exists "trg_set_tenant_id" on "public"."pages";

drop trigger if exists "update_pages_updated_at" on "public"."pages";

drop trigger if exists "audit_log_changes_permissions" on "public"."permissions";

drop trigger if exists "lock_created_by_trg" on "public"."permissions";

drop trigger if exists "set_created_by_trg" on "public"."permissions";

drop trigger if exists "lock_created_by_trg" on "public"."photo_gallery";

drop trigger if exists "set_created_by_trg" on "public"."photo_gallery";

drop trigger if exists "trg_set_tenant_id" on "public"."photo_gallery";

drop trigger if exists "update_photo_gallery_updated_at" on "public"."photo_gallery";

drop trigger if exists "lock_created_by_trg" on "public"."photo_gallery_tags";

drop trigger if exists "set_created_by_trg" on "public"."photo_gallery_tags";

drop trigger if exists "audit_log_changes_policies" on "public"."policies";

drop trigger if exists "lock_created_by_trg" on "public"."portfolio";

drop trigger if exists "set_created_by_trg" on "public"."portfolio";

drop trigger if exists "trg_set_tenant_id" on "public"."portfolio";

drop trigger if exists "update_portfolio_updated_at" on "public"."portfolio";

drop trigger if exists "lock_created_by_trg" on "public"."portfolio_tags";

drop trigger if exists "set_created_by_trg" on "public"."portfolio_tags";

drop trigger if exists "lock_created_by_trg" on "public"."product_tags";

drop trigger if exists "set_created_by_trg" on "public"."product_tags";

drop trigger if exists "lock_created_by_trg" on "public"."product_type_tags";

drop trigger if exists "set_created_by_trg" on "public"."product_type_tags";

drop trigger if exists "lock_created_by_trg" on "public"."product_types";

drop trigger if exists "set_created_by_trg" on "public"."product_types";

drop trigger if exists "trg_set_tenant_id" on "public"."product_types";

drop trigger if exists "audit_products" on "public"."products";

drop trigger if exists "lock_created_by_trg" on "public"."products";

drop trigger if exists "set_created_by_trg" on "public"."products";

drop trigger if exists "trg_set_tenant_id" on "public"."products";

drop trigger if exists "update_products_updated_at" on "public"."products";

drop trigger if exists "lock_created_by_trg" on "public"."promotion_tags";

drop trigger if exists "set_created_by_trg" on "public"."promotion_tags";

drop trigger if exists "lock_created_by_trg" on "public"."promotions";

drop trigger if exists "set_created_by_trg" on "public"."promotions";

drop trigger if exists "trg_set_tenant_id" on "public"."promotions";

drop trigger if exists "update_promotions_updated_at" on "public"."promotions";

drop trigger if exists "audit_log_changes_role_permissions" on "public"."role_permissions";

drop trigger if exists "audit_role_permissions" on "public"."role_permissions";

drop trigger if exists "lock_created_by_trg" on "public"."role_permissions";

drop trigger if exists "set_created_by_trg" on "public"."role_permissions";

drop trigger if exists "audit_log_changes_role_policies" on "public"."role_policies";

drop trigger if exists "audit_log_changes_roles" on "public"."roles";

drop trigger if exists "audit_roles" on "public"."roles";

drop trigger if exists "lock_created_by_trg" on "public"."roles";

drop trigger if exists "set_created_by_trg" on "public"."roles";

drop trigger if exists "update_roles_updated_at" on "public"."roles";

drop trigger if exists "lock_created_by_trg" on "public"."seo_metadata";

drop trigger if exists "set_created_by_trg" on "public"."seo_metadata";

drop trigger if exists "update_seo_metadata_updated_at" on "public"."seo_metadata";

drop trigger if exists "audit_settings" on "public"."settings";

drop trigger if exists "lock_created_by_trg" on "public"."tags";

drop trigger if exists "set_created_by_trg" on "public"."tags";

drop trigger if exists "trg_set_tenant_id" on "public"."tags";

drop trigger if exists "update_template_assignments_updated_at" on "public"."template_assignments";

drop trigger if exists "update_template_parts_updated_at" on "public"."template_parts";

drop trigger if exists "update_template_strings_updated_at" on "public"."template_strings";

drop trigger if exists "audit_log_changes_templates" on "public"."templates";

drop trigger if exists "trg_set_tenant_id" on "public"."templates";

drop trigger if exists "update_templates_updated_at" on "public"."templates";

drop trigger if exists "audit_log_changes_tenants" on "public"."tenants";

drop trigger if exists "lock_created_by_trg" on "public"."testimonies";

drop trigger if exists "set_created_by_trg" on "public"."testimonies";

drop trigger if exists "trg_set_tenant_id" on "public"."testimonies";

drop trigger if exists "update_testimonies_updated_at" on "public"."testimonies";

drop trigger if exists "lock_created_by_trg" on "public"."testimony_tags";

drop trigger if exists "set_created_by_trg" on "public"."testimony_tags";

drop trigger if exists "trg_set_tenant_id" on "public"."themes";

drop trigger if exists "trigger_ensure_single_active_theme" on "public"."themes";

drop trigger if exists "audit_log_changes_users" on "public"."users";

drop trigger if exists "audit_users" on "public"."users";

drop trigger if exists "lock_created_by_trg" on "public"."users";

drop trigger if exists "set_created_by_trg" on "public"."users";

drop trigger if exists "tr_enforce_user_limit" on "public"."users";

drop trigger if exists "update_users_updated_at" on "public"."users";

drop trigger if exists "lock_created_by_trg" on "public"."video_gallery";

drop trigger if exists "set_created_by_trg" on "public"."video_gallery";

drop trigger if exists "trg_set_tenant_id" on "public"."video_gallery";

drop trigger if exists "update_video_gallery_updated_at" on "public"."video_gallery";

drop trigger if exists "lock_created_by_trg" on "public"."video_gallery_tags";

drop trigger if exists "set_created_by_trg" on "public"."video_gallery_tags";

drop trigger if exists "update_widgets_updated_at" on "public"."widgets";

drop policy "account_requests_delete_unified" on "public"."account_requests";

drop policy "account_requests_insert_unified" on "public"."account_requests";

drop policy "account_requests_select_unified" on "public"."account_requests";

drop policy "account_requests_update_unified" on "public"."account_requests";

drop policy "admin_menus_delete_unified" on "public"."admin_menus";

drop policy "admin_menus_insert_unified" on "public"."admin_menus";

drop policy "admin_menus_update_unified" on "public"."admin_menus";

drop policy "announcements_delete_unified" on "public"."announcements";

drop policy "announcements_insert_unified" on "public"."announcements";

drop policy "announcements_select_unified" on "public"."announcements";

drop policy "announcements_update_unified" on "public"."announcements";

drop policy "articles_delete_unified" on "public"."articles";

drop policy "articles_insert_unified" on "public"."articles";

drop policy "articles_select_unified" on "public"."articles";

drop policy "articles_update_unified" on "public"."articles";

drop policy "audit_logs_insert_unified" on "public"."audit_logs";

drop policy "audit_logs_select_unified" on "public"."audit_logs";

drop policy "backup_logs_insert_tenant_scoped" on "public"."backup_logs";

drop policy "backups_delete_unified" on "public"."backups";

drop policy "backups_insert_unified" on "public"."backups";

drop policy "backups_select_unified" on "public"."backups";

drop policy "backups_update_unified" on "public"."backups";

drop policy "cart_items_delete_unified" on "public"."cart_items";

drop policy "cart_items_insert_unified" on "public"."cart_items";

drop policy "cart_items_select_unified" on "public"."cart_items";

drop policy "cart_items_update_unified" on "public"."cart_items";

drop policy "carts_select_policy" on "public"."carts";

drop policy "categories_delete_unified" on "public"."categories";

drop policy "categories_insert_unified" on "public"."categories";

drop policy "categories_select_unified" on "public"."categories";

drop policy "categories_update_unified" on "public"."categories";

drop policy "contact_messages_delete_admin" on "public"."contact_messages";

drop policy "contact_messages_modify_admin" on "public"."contact_messages";

drop policy "contact_messages_select_unified" on "public"."contact_messages";

drop policy "contacts_delete_unified" on "public"."contacts";

drop policy "contacts_insert_unified" on "public"."contacts";

drop policy "contacts_select_unified" on "public"."contacts";

drop policy "contacts_update_unified" on "public"."contacts";

drop policy "devices_delete_policy" on "public"."devices";

drop policy "devices_insert_policy" on "public"."devices";

drop policy "devices_select_policy" on "public"."devices";

drop policy "devices_update_policy" on "public"."devices";

drop policy "email_logs_insert_unified" on "public"."email_logs";

drop policy "email_logs_select_unified" on "public"."email_logs";

drop policy "Authenticated Insert" on "public"."extension_logs";

drop policy "Platform Admin Delete Only" on "public"."extension_logs";

drop policy "Tenant Read Own Logs" on "public"."extension_logs";

drop policy "Admins manage extension_menu_items" on "public"."extension_menu_items";

drop policy "extension_permissions_delete_admin" on "public"."extension_permissions";

drop policy "extension_permissions_insert_admin" on "public"."extension_permissions";

drop policy "extension_permissions_update_admin" on "public"."extension_permissions";

drop policy "extension_rbac_delete" on "public"."extension_rbac_integration";

drop policy "extension_rbac_insert" on "public"."extension_rbac_integration";

drop policy "extension_rbac_update" on "public"."extension_rbac_integration";

drop policy "extension_routes_delete_unified" on "public"."extension_routes";

drop policy "extension_routes_insert_unified" on "public"."extension_routes";

drop policy "extension_routes_select_unified" on "public"."extension_routes";

drop policy "extension_routes_update_unified" on "public"."extension_routes";

drop policy "extension_routes_registry_select" on "public"."extension_routes_registry";

drop policy "extensions_delete_unified" on "public"."extensions";

drop policy "extensions_insert_unified" on "public"."extensions";

drop policy "extensions_select_unified" on "public"."extensions";

drop policy "extensions_update_unified" on "public"."extensions";

drop policy "File permissions tenant isolation" on "public"."file_permissions";

drop policy "files_delete_unified" on "public"."files";

drop policy "files_insert_unified" on "public"."files";

drop policy "files_select_unified" on "public"."files";

drop policy "files_update_unified" on "public"."files";

drop policy "menus_delete_unified" on "public"."menus";

drop policy "menus_insert_unified" on "public"."menus";

drop policy "menus_select_unified" on "public"."menus";

drop policy "menus_update_unified" on "public"."menus";

drop policy "mobile_app_config_access" on "public"."mobile_app_config";

drop policy "mobile_users_access" on "public"."mobile_users";

drop policy "notification_readers_select_policy" on "public"."notification_readers";

drop policy "notifications_delete_unified" on "public"."notifications";

drop policy "notifications_insert_unified" on "public"."notifications";

drop policy "notifications_select_unified" on "public"."notifications";

drop policy "notifications_update_unified" on "public"."notifications";

drop policy "order_items_delete_unified" on "public"."order_items";

drop policy "order_items_insert_unified" on "public"."order_items";

drop policy "order_items_select_unified" on "public"."order_items";

drop policy "order_items_update_unified" on "public"."order_items";

drop policy "Users view own orders" on "public"."orders";

drop policy "pages_delete_unified" on "public"."pages";

drop policy "pages_insert_unified" on "public"."pages";

drop policy "pages_select_unified" on "public"."pages";

drop policy "pages_update_unified" on "public"."pages";

drop policy "Payment methods Delete" on "public"."payment_methods";

drop policy "Payment methods Insert" on "public"."payment_methods";

drop policy "Payment methods Select" on "public"."payment_methods";

drop policy "Payment methods Update" on "public"."payment_methods";

drop policy "Payments Delete" on "public"."payments";

drop policy "Payments Insert" on "public"."payments";

drop policy "Payments Select" on "public"."payments";

drop policy "Payments Update" on "public"."payments";

drop policy "permissions_delete_policy" on "public"."permissions";

drop policy "permissions_insert_policy" on "public"."permissions";

drop policy "permissions_update_policy" on "public"."permissions";

drop policy "photo_gallery_delete_unified" on "public"."photo_gallery";

drop policy "photo_gallery_insert_unified" on "public"."photo_gallery";

drop policy "photo_gallery_select_unified" on "public"."photo_gallery";

drop policy "photo_gallery_update_unified" on "public"."photo_gallery";

drop policy "policies_delete_unified" on "public"."policies";

drop policy "policies_insert_unified" on "public"."policies";

drop policy "policies_select_unified" on "public"."policies";

drop policy "policies_update_unified" on "public"."policies";

drop policy "portfolio_delete_unified" on "public"."portfolio";

drop policy "portfolio_insert_unified" on "public"."portfolio";

drop policy "portfolio_select_unified" on "public"."portfolio";

drop policy "portfolio_update_unified" on "public"."portfolio";

drop policy "product_types_delete_unified" on "public"."product_types";

drop policy "product_types_insert_unified" on "public"."product_types";

drop policy "product_types_select_unified" on "public"."product_types";

drop policy "product_types_update_unified" on "public"."product_types";

drop policy "products_delete_unified" on "public"."products";

drop policy "products_insert_unified" on "public"."products";

drop policy "products_select_unified" on "public"."products";

drop policy "products_update_unified" on "public"."products";

drop policy "promotions_delete_unified" on "public"."promotions";

drop policy "promotions_insert_unified" on "public"."promotions";

drop policy "promotions_select_unified" on "public"."promotions";

drop policy "promotions_update_unified" on "public"."promotions";

drop policy "push_notifications_access" on "public"."push_notifications";

drop policy "Regions tenant isolation" on "public"."regions";

drop policy "role_permissions_delete_policy" on "public"."role_permissions";

drop policy "role_permissions_insert_policy" on "public"."role_permissions";

drop policy "role_permissions_update_policy" on "public"."role_permissions";

drop policy "role_policies_delete_unified" on "public"."role_policies";

drop policy "role_policies_insert_unified" on "public"."role_policies";

drop policy "role_policies_update_unified" on "public"."role_policies";

drop policy "roles_delete_unified" on "public"."roles";

drop policy "roles_insert_unified" on "public"."roles";

drop policy "roles_select_unified" on "public"."roles";

drop policy "roles_update_unified" on "public"."roles";

drop policy "sensor_readings_access" on "public"."sensor_readings";

drop policy "settings_delete_unified" on "public"."settings";

drop policy "settings_insert_unified" on "public"."settings";

drop policy "settings_select_unified" on "public"."settings";

drop policy "settings_update_unified" on "public"."settings";

drop policy "Admins View SSO Logs" on "public"."sso_audit_logs";

drop policy "sso_providers_isolation_policy" on "public"."sso_providers";

drop policy "sso_role_mappings_delete_unified" on "public"."sso_role_mappings";

drop policy "sso_role_mappings_insert_unified" on "public"."sso_role_mappings";

drop policy "sso_role_mappings_select_unified" on "public"."sso_role_mappings";

drop policy "sso_role_mappings_update_unified" on "public"."sso_role_mappings";

drop policy "tags_delete_unified" on "public"."tags";

drop policy "tags_insert_unified" on "public"."tags";

drop policy "tags_select_unified" on "public"."tags";

drop policy "tags_update_unified" on "public"."tags";

drop policy "template_assignments_delete_unified" on "public"."template_assignments";

drop policy "template_assignments_modify_unified" on "public"."template_assignments";

drop policy "template_assignments_select_unified" on "public"."template_assignments";

drop policy "template_assignments_update_unified" on "public"."template_assignments";

drop policy "template_parts_delete_unified" on "public"."template_parts";

drop policy "template_parts_modify_unified" on "public"."template_parts";

drop policy "template_parts_select_unified" on "public"."template_parts";

drop policy "template_parts_update_unified" on "public"."template_parts";

drop policy "template_strings_delete_unified" on "public"."template_strings";

drop policy "template_strings_insert_unified" on "public"."template_strings";

drop policy "template_strings_update_unified" on "public"."template_strings";

drop policy "templates_delete_unified" on "public"."templates";

drop policy "templates_modify_unified" on "public"."templates";

drop policy "templates_select_unified" on "public"."templates";

drop policy "templates_update_unified" on "public"."templates";

drop policy "tenants_delete_unified" on "public"."tenants";

drop policy "tenants_insert_unified" on "public"."tenants";

drop policy "tenants_select_unified" on "public"."tenants";

drop policy "tenants_update_unified" on "public"."tenants";

drop policy "testimonies_delete_unified" on "public"."testimonies";

drop policy "testimonies_insert_unified" on "public"."testimonies";

drop policy "testimonies_select_unified" on "public"."testimonies";

drop policy "testimonies_update_unified" on "public"."testimonies";

drop policy "testimony_tags_delete" on "public"."testimony_tags";

drop policy "testimony_tags_insert" on "public"."testimony_tags";

drop policy "testimony_tags_update" on "public"."testimony_tags";

drop policy "themes_delete_unified" on "public"."themes";

drop policy "themes_insert_unified" on "public"."themes";

drop policy "themes_select_unified" on "public"."themes";

drop policy "themes_update_unified" on "public"."themes";

drop policy "users_delete_unified" on "public"."users";

drop policy "users_insert_unified" on "public"."users";

drop policy "users_select_unified" on "public"."users";

drop policy "users_update_unified" on "public"."users";

drop policy "video_gallery_delete_unified" on "public"."video_gallery";

drop policy "video_gallery_insert_unified" on "public"."video_gallery";

drop policy "video_gallery_select_unified" on "public"."video_gallery";

drop policy "video_gallery_update_unified" on "public"."video_gallery";

drop policy "widgets_delete_unified" on "public"."widgets";

drop policy "widgets_modify_unified" on "public"."widgets";

drop policy "widgets_select_unified" on "public"."widgets";

drop policy "widgets_update_unified" on "public"."widgets";

alter table "public"."account_requests" drop constraint "account_requests_admin_approved_by_fkey";

alter table "public"."account_requests" drop constraint "account_requests_super_admin_approved_by_fkey";

alter table "public"."account_requests" drop constraint "account_requests_tenant_id_fkey";

alter table "public"."announcement_tags" drop constraint "announcement_tags_announcement_id_fkey";

alter table "public"."announcement_tags" drop constraint "announcement_tags_tag_id_fkey";

alter table "public"."announcement_tags" drop constraint "announcement_tags_tenant_id_fkey";

alter table "public"."announcements" drop constraint "announcements_category_id_fkey";

alter table "public"."announcements" drop constraint "announcements_created_by_fkey";

alter table "public"."announcements" drop constraint "announcements_tenant_id_fkey";

alter table "public"."article_tags" drop constraint "article_tags_article_id_fkey";

alter table "public"."article_tags" drop constraint "article_tags_tag_id_fkey";

alter table "public"."article_tags" drop constraint "article_tags_tenant_id_fkey";

alter table "public"."articles" drop constraint "articles_author_id_fkey";

alter table "public"."articles" drop constraint "articles_category_id_fkey";

alter table "public"."articles" drop constraint "articles_created_by_fkey";

alter table "public"."articles" drop constraint "articles_current_assignee_id_fkey";

alter table "public"."articles" drop constraint "articles_region_id_fkey";

alter table "public"."articles" drop constraint "articles_tenant_id_fkey";

alter table "public"."audit_logs" drop constraint "audit_logs_tenant_id_fkey";

alter table "public"."audit_logs" drop constraint "audit_logs_user_id_fkey";

alter table "public"."backup_logs" drop constraint "backup_logs_backup_id_fkey";

alter table "public"."backup_logs" drop constraint "backup_logs_tenant_id_fkey";

alter table "public"."backup_schedules" drop constraint "backup_schedules_created_by_fkey";

alter table "public"."backup_schedules" drop constraint "backup_schedules_tenant_id_fkey";

alter table "public"."backups" drop constraint "backups_created_by_fkey";

alter table "public"."backups" drop constraint "backups_tenant_id_fkey";

alter table "public"."cart_items" drop constraint "cart_items_cart_id_fkey";

alter table "public"."cart_items" drop constraint "cart_items_product_id_fkey";

alter table "public"."cart_items" drop constraint "cart_items_tenant_id_fkey";

alter table "public"."carts" drop constraint "carts_tenant_id_fkey";

alter table "public"."carts" drop constraint "carts_user_id_fkey";

alter table "public"."categories" drop constraint "categories_created_by_fkey";

alter table "public"."categories" drop constraint "categories_tenant_id_fkey";

alter table "public"."contact_message_tags" drop constraint "contact_message_tags_message_id_fkey";

alter table "public"."contact_message_tags" drop constraint "contact_message_tags_tag_id_fkey";

alter table "public"."contact_message_tags" drop constraint "contact_message_tags_tenant_id_fkey";

alter table "public"."contact_messages" drop constraint "contact_messages_created_by_fkey";

alter table "public"."contact_messages" drop constraint "contact_messages_tenant_id_fkey";

alter table "public"."contact_tags" drop constraint "contact_tags_contact_id_fkey";

alter table "public"."contact_tags" drop constraint "contact_tags_tag_id_fkey";

alter table "public"."contact_tags" drop constraint "contact_tags_tenant_id_fkey";

alter table "public"."contacts" drop constraint "contacts_created_by_fkey";

alter table "public"."contacts" drop constraint "contacts_tenant_id_fkey";

alter table "public"."devices" drop constraint "devices_tenant_id_fkey";

alter table "public"."email_logs" drop constraint "email_logs_tenant_id_fkey";

alter table "public"."extension_logs" drop constraint "extension_logs_extension_id_fkey";

alter table "public"."extension_logs" drop constraint "extension_logs_tenant_id_fkey";

alter table "public"."extension_menu_items" drop constraint "extension_menu_items_extension_id_fkey";

alter table "public"."extension_permissions" drop constraint "extension_permissions_extension_id_fkey";

alter table "public"."extension_rbac_integration" drop constraint "extension_rbac_integration_extension_id_fkey";

alter table "public"."extension_rbac_integration" drop constraint "extension_rbac_integration_permission_id_fkey";

alter table "public"."extension_rbac_integration" drop constraint "extension_rbac_integration_role_id_fkey";

alter table "public"."extension_routes" drop constraint "extension_routes_extension_id_fkey";

alter table "public"."extension_routes" drop constraint "extension_routes_tenant_id_fkey";

alter table "public"."extension_routes_registry" drop constraint "extension_routes_registry_extension_id_fkey";

alter table "public"."extensions" drop constraint "extensions_created_by_fkey";

alter table "public"."extensions" drop constraint "extensions_tenant_id_fkey";

alter table "public"."file_permissions" drop constraint "file_permissions_file_id_fkey";

alter table "public"."file_permissions" drop constraint "file_permissions_tenant_id_fkey";

alter table "public"."files" drop constraint "files_tenant_id_fkey";

alter table "public"."files" drop constraint "files_uploaded_by_fkey";

alter table "public"."menu_permissions" drop constraint "menu_permissions_menu_id_fkey";

alter table "public"."menu_permissions" drop constraint "menu_permissions_role_id_fkey";

alter table "public"."menu_permissions" drop constraint "menu_permissions_tenant_id_fkey";

alter table "public"."menus" drop constraint "menus_created_by_fkey";

alter table "public"."menus" drop constraint "menus_parent_id_fkey";

alter table "public"."menus" drop constraint "menus_role_id_fkey";

alter table "public"."menus" drop constraint "menus_tenant_id_fkey";

alter table "public"."mobile_app_config" drop constraint "mobile_app_config_tenant_id_fkey";

alter table "public"."mobile_users" drop constraint "mobile_users_tenant_id_fkey";

alter table "public"."notification_readers" drop constraint "notification_readers_notification_id_fkey";

alter table "public"."notification_readers" drop constraint "notification_readers_user_id_fkey";

alter table "public"."notifications" drop constraint "notifications_created_by_fkey";

alter table "public"."notifications" drop constraint "notifications_tenant_id_fkey";

alter table "public"."notifications" drop constraint "notifications_user_id_fkey";

alter table "public"."order_items" drop constraint "order_items_order_id_fkey";

alter table "public"."order_items" drop constraint "order_items_product_id_fkey";

alter table "public"."order_items" drop constraint "order_items_tenant_id_fkey";

alter table "public"."orders" drop constraint "orders_tenant_id_fkey";

alter table "public"."orders" drop constraint "orders_user_id_fkey";

alter table "public"."page_categories" drop constraint "page_categories_category_id_fkey";

alter table "public"."page_categories" drop constraint "page_categories_page_id_fkey";

alter table "public"."page_categories" drop constraint "page_categories_tenant_id_fkey";

alter table "public"."page_tags" drop constraint "page_tags_page_id_fkey";

alter table "public"."page_tags" drop constraint "page_tags_tag_id_fkey";

alter table "public"."page_tags" drop constraint "page_tags_tenant_id_fkey";

alter table "public"."pages" drop constraint "pages_category_id_fkey";

alter table "public"."pages" drop constraint "pages_created_by_fkey";

alter table "public"."pages" drop constraint "pages_current_assignee_id_fkey";

alter table "public"."pages" drop constraint "pages_parent_id_fkey";

alter table "public"."pages" drop constraint "pages_tenant_id_fkey";

alter table "public"."payment_methods" drop constraint "payment_methods_tenant_id_fkey";

alter table "public"."payments" drop constraint "payments_order_id_fkey";

alter table "public"."payments" drop constraint "payments_payment_method_id_fkey";

alter table "public"."payments" drop constraint "payments_tenant_id_fkey";

alter table "public"."permissions" drop constraint "permissions_created_by_fkey";

alter table "public"."photo_gallery" drop constraint "photo_gallery_category_id_fkey";

alter table "public"."photo_gallery" drop constraint "photo_gallery_created_by_fkey";

alter table "public"."photo_gallery" drop constraint "photo_gallery_tenant_id_fkey";

alter table "public"."photo_gallery_tags" drop constraint "photo_gallery_tags_photo_gallery_id_fkey";

alter table "public"."photo_gallery_tags" drop constraint "photo_gallery_tags_tag_id_fkey";

alter table "public"."photo_gallery_tags" drop constraint "photo_gallery_tags_tenant_id_fkey";

alter table "public"."policies" drop constraint "policies_tenant_id_fkey";

alter table "public"."portfolio" drop constraint "portfolio_category_id_fkey";

alter table "public"."portfolio" drop constraint "portfolio_created_by_fkey";

alter table "public"."portfolio" drop constraint "portfolio_tenant_id_fkey";

alter table "public"."portfolio_tags" drop constraint "portfolio_tags_portfolio_id_fkey";

alter table "public"."portfolio_tags" drop constraint "portfolio_tags_tag_id_fkey";

alter table "public"."portfolio_tags" drop constraint "portfolio_tags_tenant_id_fkey";

alter table "public"."product_tags" drop constraint "product_tags_product_id_fkey";

alter table "public"."product_tags" drop constraint "product_tags_tag_id_fkey";

alter table "public"."product_tags" drop constraint "product_tags_tenant_id_fkey";

alter table "public"."product_type_tags" drop constraint "product_type_tags_product_type_id_fkey";

alter table "public"."product_type_tags" drop constraint "product_type_tags_tag_id_fkey";

alter table "public"."product_type_tags" drop constraint "product_type_tags_tenant_id_fkey";

alter table "public"."product_types" drop constraint "product_types_created_by_fkey";

alter table "public"."product_types" drop constraint "product_types_tenant_id_fkey";

alter table "public"."products" drop constraint "products_category_id_fkey";

alter table "public"."products" drop constraint "products_created_by_fkey";

alter table "public"."products" drop constraint "products_product_type_id_fkey";

alter table "public"."products" drop constraint "products_tenant_id_fkey";

alter table "public"."promotion_tags" drop constraint "promotion_tags_promotion_id_fkey";

alter table "public"."promotion_tags" drop constraint "promotion_tags_tag_id_fkey";

alter table "public"."promotion_tags" drop constraint "promotion_tags_tenant_id_fkey";

alter table "public"."promotions" drop constraint "promotions_category_id_fkey";

alter table "public"."promotions" drop constraint "promotions_created_by_fkey";

alter table "public"."promotions" drop constraint "promotions_tenant_id_fkey";

alter table "public"."push_notifications" drop constraint "push_notifications_tenant_id_fkey";

alter table "public"."regions" drop constraint "regions_level_id_fkey";

alter table "public"."regions" drop constraint "regions_parent_id_fkey";

alter table "public"."regions" drop constraint "regions_tenant_id_fkey";

alter table "public"."role_permissions" drop constraint "role_permissions_permission_id_fkey";

alter table "public"."role_permissions" drop constraint "role_permissions_role_id_fkey";

alter table "public"."role_permissions" drop constraint "role_permissions_tenant_id_fkey";

alter table "public"."role_policies" drop constraint "role_policies_policy_id_fkey";

alter table "public"."role_policies" drop constraint "role_policies_role_id_fkey";

alter table "public"."roles" drop constraint "roles_created_by_fkey";

alter table "public"."roles" drop constraint "roles_tenant_id_fkey";

alter table "public"."sensor_readings" drop constraint "sensor_readings_tenant_id_fkey";

alter table "public"."seo_metadata" drop constraint "seo_metadata_tenant_id_fkey";

alter table "public"."settings" drop constraint "settings_tenant_id_fkey";

alter table "public"."sso_audit_logs" drop constraint "sso_audit_logs_tenant_id_fkey";

alter table "public"."sso_audit_logs" drop constraint "sso_audit_logs_user_id_fkey";

alter table "public"."sso_providers" drop constraint "sso_providers_created_by_fkey";

alter table "public"."sso_providers" drop constraint "sso_providers_tenant_id_fkey";

alter table "public"."sso_role_mappings" drop constraint "sso_role_mappings_created_by_fkey";

alter table "public"."sso_role_mappings" drop constraint "sso_role_mappings_internal_role_id_fkey";

alter table "public"."tags" drop constraint "tags_created_by_fkey";

alter table "public"."tags" drop constraint "tags_tenant_id_fkey";

alter table "public"."template_assignments" drop constraint "template_assignments_template_id_fkey";

alter table "public"."template_assignments" drop constraint "template_assignments_tenant_id_fkey";

alter table "public"."template_parts" drop constraint "template_parts_tenant_id_fkey";

alter table "public"."templates" drop constraint "templates_tenant_id_fkey";

alter table "public"."testimonies" drop constraint "testimonies_category_id_fkey";

alter table "public"."testimonies" drop constraint "testimonies_created_by_fkey";

alter table "public"."testimonies" drop constraint "testimonies_tenant_id_fkey";

alter table "public"."testimony_tags" drop constraint "testimony_tags_tag_id_fkey";

alter table "public"."testimony_tags" drop constraint "testimony_tags_tenant_id_fkey";

alter table "public"."testimony_tags" drop constraint "testimony_tags_testimony_id_fkey";

alter table "public"."themes" drop constraint "themes_tenant_id_fkey";

alter table "public"."two_factor_audit_logs" drop constraint "two_factor_audit_logs_tenant_id_fkey";

alter table "public"."two_factor_audit_logs" drop constraint "two_factor_audit_logs_user_id_fkey";

alter table "public"."two_factor_auth" drop constraint "two_factor_auth_tenant_id_fkey";

alter table "public"."two_factor_auth" drop constraint "two_factor_auth_user_id_fkey";

alter table "public"."users" drop constraint "users_admin_approved_by_fkey";

alter table "public"."users" drop constraint "users_created_by_fkey";

alter table "public"."users" drop constraint "users_region_id_fkey";

alter table "public"."users" drop constraint "users_role_id_fkey";

alter table "public"."users" drop constraint "users_super_admin_approved_by_fkey";

alter table "public"."users" drop constraint "users_tenant_id_fkey";

alter table "public"."video_gallery" drop constraint "video_gallery_category_id_fkey";

alter table "public"."video_gallery" drop constraint "video_gallery_created_by_fkey";

alter table "public"."video_gallery" drop constraint "video_gallery_tenant_id_fkey";

alter table "public"."video_gallery_tags" drop constraint "video_gallery_tags_tag_id_fkey";

alter table "public"."video_gallery_tags" drop constraint "video_gallery_tags_tenant_id_fkey";

alter table "public"."video_gallery_tags" drop constraint "video_gallery_tags_video_gallery_id_fkey";

alter table "public"."widgets" drop constraint "widgets_area_id_fkey";

alter table "public"."widgets" drop constraint "widgets_tenant_id_fkey";

alter table "public"."auth_hibp_events" alter column "id" set default nextval('public.auth_hibp_events_id_seq'::regclass);

alter table "public"."templates" alter column "id" set default extensions.uuid_generate_v4();

alter table "public"."account_requests" add constraint "account_requests_admin_approved_by_fkey" FOREIGN KEY (admin_approved_by) REFERENCES public.users(id) not valid;

alter table "public"."account_requests" validate constraint "account_requests_admin_approved_by_fkey";

alter table "public"."account_requests" add constraint "account_requests_super_admin_approved_by_fkey" FOREIGN KEY (super_admin_approved_by) REFERENCES public.users(id) not valid;

alter table "public"."account_requests" validate constraint "account_requests_super_admin_approved_by_fkey";

alter table "public"."account_requests" add constraint "account_requests_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) not valid;

alter table "public"."account_requests" validate constraint "account_requests_tenant_id_fkey";

alter table "public"."announcement_tags" add constraint "announcement_tags_announcement_id_fkey" FOREIGN KEY (announcement_id) REFERENCES public.announcements(id) ON DELETE CASCADE not valid;

alter table "public"."announcement_tags" validate constraint "announcement_tags_announcement_id_fkey";

alter table "public"."announcement_tags" add constraint "announcement_tags_tag_id_fkey" FOREIGN KEY (tag_id) REFERENCES public.tags(id) ON DELETE CASCADE not valid;

alter table "public"."announcement_tags" validate constraint "announcement_tags_tag_id_fkey";

alter table "public"."announcement_tags" add constraint "announcement_tags_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE not valid;

alter table "public"."announcement_tags" validate constraint "announcement_tags_tenant_id_fkey";

alter table "public"."announcements" add constraint "announcements_category_id_fkey" FOREIGN KEY (category_id) REFERENCES public.categories(id) not valid;

alter table "public"."announcements" validate constraint "announcements_category_id_fkey";

alter table "public"."announcements" add constraint "announcements_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.users(id) not valid;

alter table "public"."announcements" validate constraint "announcements_created_by_fkey";

alter table "public"."announcements" add constraint "announcements_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) not valid;

alter table "public"."announcements" validate constraint "announcements_tenant_id_fkey";

alter table "public"."article_tags" add constraint "article_tags_article_id_fkey" FOREIGN KEY (article_id) REFERENCES public.articles(id) ON DELETE CASCADE not valid;

alter table "public"."article_tags" validate constraint "article_tags_article_id_fkey";

alter table "public"."article_tags" add constraint "article_tags_tag_id_fkey" FOREIGN KEY (tag_id) REFERENCES public.tags(id) ON DELETE CASCADE not valid;

alter table "public"."article_tags" validate constraint "article_tags_tag_id_fkey";

alter table "public"."article_tags" add constraint "article_tags_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE not valid;

alter table "public"."article_tags" validate constraint "article_tags_tenant_id_fkey";

alter table "public"."articles" add constraint "articles_author_id_fkey" FOREIGN KEY (author_id) REFERENCES public.users(id) not valid;

alter table "public"."articles" validate constraint "articles_author_id_fkey";

alter table "public"."articles" add constraint "articles_category_id_fkey" FOREIGN KEY (category_id) REFERENCES public.categories(id) not valid;

alter table "public"."articles" validate constraint "articles_category_id_fkey";

alter table "public"."articles" add constraint "articles_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.users(id) not valid;

alter table "public"."articles" validate constraint "articles_created_by_fkey";

alter table "public"."articles" add constraint "articles_current_assignee_id_fkey" FOREIGN KEY (current_assignee_id) REFERENCES public.users(id) not valid;

alter table "public"."articles" validate constraint "articles_current_assignee_id_fkey";

alter table "public"."articles" add constraint "articles_region_id_fkey" FOREIGN KEY (region_id) REFERENCES public.regions(id) ON DELETE SET NULL not valid;

alter table "public"."articles" validate constraint "articles_region_id_fkey";

alter table "public"."articles" add constraint "articles_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) not valid;

alter table "public"."articles" validate constraint "articles_tenant_id_fkey";

alter table "public"."audit_logs" add constraint "audit_logs_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) not valid;

alter table "public"."audit_logs" validate constraint "audit_logs_tenant_id_fkey";

alter table "public"."audit_logs" add constraint "audit_logs_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.users(id) not valid;

alter table "public"."audit_logs" validate constraint "audit_logs_user_id_fkey";

alter table "public"."backup_logs" add constraint "backup_logs_backup_id_fkey" FOREIGN KEY (backup_id) REFERENCES public.backups(id) ON DELETE SET NULL not valid;

alter table "public"."backup_logs" validate constraint "backup_logs_backup_id_fkey";

alter table "public"."backup_logs" add constraint "backup_logs_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) not valid;

alter table "public"."backup_logs" validate constraint "backup_logs_tenant_id_fkey";

alter table "public"."backup_schedules" add constraint "backup_schedules_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.users(id) not valid;

alter table "public"."backup_schedules" validate constraint "backup_schedules_created_by_fkey";

alter table "public"."backup_schedules" add constraint "backup_schedules_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE not valid;

alter table "public"."backup_schedules" validate constraint "backup_schedules_tenant_id_fkey";

alter table "public"."backups" add constraint "backups_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.users(id) not valid;

alter table "public"."backups" validate constraint "backups_created_by_fkey";

alter table "public"."backups" add constraint "backups_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) not valid;

alter table "public"."backups" validate constraint "backups_tenant_id_fkey";

alter table "public"."cart_items" add constraint "cart_items_cart_id_fkey" FOREIGN KEY (cart_id) REFERENCES public.carts(id) ON DELETE CASCADE not valid;

alter table "public"."cart_items" validate constraint "cart_items_cart_id_fkey";

alter table "public"."cart_items" add constraint "cart_items_product_id_fkey" FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE not valid;

alter table "public"."cart_items" validate constraint "cart_items_product_id_fkey";

alter table "public"."cart_items" add constraint "cart_items_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) not valid;

alter table "public"."cart_items" validate constraint "cart_items_tenant_id_fkey";

alter table "public"."carts" add constraint "carts_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE not valid;

alter table "public"."carts" validate constraint "carts_tenant_id_fkey";

alter table "public"."carts" add constraint "carts_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL not valid;

alter table "public"."carts" validate constraint "carts_user_id_fkey";

alter table "public"."categories" add constraint "categories_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.users(id) not valid;

alter table "public"."categories" validate constraint "categories_created_by_fkey";

alter table "public"."categories" add constraint "categories_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) not valid;

alter table "public"."categories" validate constraint "categories_tenant_id_fkey";

alter table "public"."contact_message_tags" add constraint "contact_message_tags_message_id_fkey" FOREIGN KEY (message_id) REFERENCES public.contact_messages(id) ON DELETE CASCADE not valid;

alter table "public"."contact_message_tags" validate constraint "contact_message_tags_message_id_fkey";

alter table "public"."contact_message_tags" add constraint "contact_message_tags_tag_id_fkey" FOREIGN KEY (tag_id) REFERENCES public.tags(id) ON DELETE CASCADE not valid;

alter table "public"."contact_message_tags" validate constraint "contact_message_tags_tag_id_fkey";

alter table "public"."contact_message_tags" add constraint "contact_message_tags_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE not valid;

alter table "public"."contact_message_tags" validate constraint "contact_message_tags_tenant_id_fkey";

alter table "public"."contact_messages" add constraint "contact_messages_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.users(id) not valid;

alter table "public"."contact_messages" validate constraint "contact_messages_created_by_fkey";

alter table "public"."contact_messages" add constraint "contact_messages_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) not valid;

alter table "public"."contact_messages" validate constraint "contact_messages_tenant_id_fkey";

alter table "public"."contact_tags" add constraint "contact_tags_contact_id_fkey" FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE not valid;

alter table "public"."contact_tags" validate constraint "contact_tags_contact_id_fkey";

alter table "public"."contact_tags" add constraint "contact_tags_tag_id_fkey" FOREIGN KEY (tag_id) REFERENCES public.tags(id) ON DELETE CASCADE not valid;

alter table "public"."contact_tags" validate constraint "contact_tags_tag_id_fkey";

alter table "public"."contact_tags" add constraint "contact_tags_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE not valid;

alter table "public"."contact_tags" validate constraint "contact_tags_tenant_id_fkey";

alter table "public"."contacts" add constraint "contacts_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.users(id) not valid;

alter table "public"."contacts" validate constraint "contacts_created_by_fkey";

alter table "public"."contacts" add constraint "contacts_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) not valid;

alter table "public"."contacts" validate constraint "contacts_tenant_id_fkey";

alter table "public"."devices" add constraint "devices_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE not valid;

alter table "public"."devices" validate constraint "devices_tenant_id_fkey";

alter table "public"."email_logs" add constraint "email_logs_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE not valid;

alter table "public"."email_logs" validate constraint "email_logs_tenant_id_fkey";

alter table "public"."extension_logs" add constraint "extension_logs_extension_id_fkey" FOREIGN KEY (extension_id) REFERENCES public.extensions(id) ON DELETE SET NULL not valid;

alter table "public"."extension_logs" validate constraint "extension_logs_extension_id_fkey";

alter table "public"."extension_logs" add constraint "extension_logs_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) not valid;

alter table "public"."extension_logs" validate constraint "extension_logs_tenant_id_fkey";

alter table "public"."extension_menu_items" add constraint "extension_menu_items_extension_id_fkey" FOREIGN KEY (extension_id) REFERENCES public.extensions(id) ON DELETE CASCADE not valid;

alter table "public"."extension_menu_items" validate constraint "extension_menu_items_extension_id_fkey";

alter table "public"."extension_permissions" add constraint "extension_permissions_extension_id_fkey" FOREIGN KEY (extension_id) REFERENCES public.extensions(id) ON DELETE CASCADE not valid;

alter table "public"."extension_permissions" validate constraint "extension_permissions_extension_id_fkey";

alter table "public"."extension_rbac_integration" add constraint "extension_rbac_integration_extension_id_fkey" FOREIGN KEY (extension_id) REFERENCES public.extensions(id) ON DELETE CASCADE not valid;

alter table "public"."extension_rbac_integration" validate constraint "extension_rbac_integration_extension_id_fkey";

alter table "public"."extension_rbac_integration" add constraint "extension_rbac_integration_permission_id_fkey" FOREIGN KEY (permission_id) REFERENCES public.permissions(id) ON DELETE CASCADE not valid;

alter table "public"."extension_rbac_integration" validate constraint "extension_rbac_integration_permission_id_fkey";

alter table "public"."extension_rbac_integration" add constraint "extension_rbac_integration_role_id_fkey" FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE CASCADE not valid;

alter table "public"."extension_rbac_integration" validate constraint "extension_rbac_integration_role_id_fkey";

alter table "public"."extension_routes" add constraint "extension_routes_extension_id_fkey" FOREIGN KEY (extension_id) REFERENCES public.extensions(id) ON DELETE CASCADE not valid;

alter table "public"."extension_routes" validate constraint "extension_routes_extension_id_fkey";

alter table "public"."extension_routes" add constraint "extension_routes_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) not valid;

alter table "public"."extension_routes" validate constraint "extension_routes_tenant_id_fkey";

alter table "public"."extension_routes_registry" add constraint "extension_routes_registry_extension_id_fkey" FOREIGN KEY (extension_id) REFERENCES public.extensions(id) ON DELETE CASCADE not valid;

alter table "public"."extension_routes_registry" validate constraint "extension_routes_registry_extension_id_fkey";

alter table "public"."extensions" add constraint "extensions_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.users(id) not valid;

alter table "public"."extensions" validate constraint "extensions_created_by_fkey";

alter table "public"."extensions" add constraint "extensions_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) not valid;

alter table "public"."extensions" validate constraint "extensions_tenant_id_fkey";

alter table "public"."file_permissions" add constraint "file_permissions_file_id_fkey" FOREIGN KEY (file_id) REFERENCES public.files(id) ON DELETE CASCADE not valid;

alter table "public"."file_permissions" validate constraint "file_permissions_file_id_fkey";

alter table "public"."file_permissions" add constraint "file_permissions_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE not valid;

alter table "public"."file_permissions" validate constraint "file_permissions_tenant_id_fkey";

alter table "public"."files" add constraint "files_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) not valid;

alter table "public"."files" validate constraint "files_tenant_id_fkey";

alter table "public"."files" add constraint "files_uploaded_by_fkey" FOREIGN KEY (uploaded_by) REFERENCES public.users(id) ON DELETE SET NULL not valid;

alter table "public"."files" validate constraint "files_uploaded_by_fkey";

alter table "public"."menu_permissions" add constraint "menu_permissions_menu_id_fkey" FOREIGN KEY (menu_id) REFERENCES public.menus(id) ON DELETE CASCADE not valid;

alter table "public"."menu_permissions" validate constraint "menu_permissions_menu_id_fkey";

alter table "public"."menu_permissions" add constraint "menu_permissions_role_id_fkey" FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE CASCADE not valid;

alter table "public"."menu_permissions" validate constraint "menu_permissions_role_id_fkey";

alter table "public"."menu_permissions" add constraint "menu_permissions_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE not valid;

alter table "public"."menu_permissions" validate constraint "menu_permissions_tenant_id_fkey";

alter table "public"."menus" add constraint "menus_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.users(id) not valid;

alter table "public"."menus" validate constraint "menus_created_by_fkey";

alter table "public"."menus" add constraint "menus_parent_id_fkey" FOREIGN KEY (parent_id) REFERENCES public.menus(id) not valid;

alter table "public"."menus" validate constraint "menus_parent_id_fkey";

alter table "public"."menus" add constraint "menus_role_id_fkey" FOREIGN KEY (role_id) REFERENCES public.roles(id) not valid;

alter table "public"."menus" validate constraint "menus_role_id_fkey";

alter table "public"."menus" add constraint "menus_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) not valid;

alter table "public"."menus" validate constraint "menus_tenant_id_fkey";

alter table "public"."mobile_app_config" add constraint "mobile_app_config_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE not valid;

alter table "public"."mobile_app_config" validate constraint "mobile_app_config_tenant_id_fkey";

alter table "public"."mobile_users" add constraint "mobile_users_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE not valid;

alter table "public"."mobile_users" validate constraint "mobile_users_tenant_id_fkey";

alter table "public"."notification_readers" add constraint "notification_readers_notification_id_fkey" FOREIGN KEY (notification_id) REFERENCES public.notifications(id) ON DELETE CASCADE not valid;

alter table "public"."notification_readers" validate constraint "notification_readers_notification_id_fkey";

alter table "public"."notification_readers" add constraint "notification_readers_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE not valid;

alter table "public"."notification_readers" validate constraint "notification_readers_user_id_fkey";

alter table "public"."notifications" add constraint "notifications_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.users(id) not valid;

alter table "public"."notifications" validate constraint "notifications_created_by_fkey";

alter table "public"."notifications" add constraint "notifications_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) not valid;

alter table "public"."notifications" validate constraint "notifications_tenant_id_fkey";

alter table "public"."notifications" add constraint "notifications_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.users(id) not valid;

alter table "public"."notifications" validate constraint "notifications_user_id_fkey";

alter table "public"."order_items" add constraint "order_items_order_id_fkey" FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE not valid;

alter table "public"."order_items" validate constraint "order_items_order_id_fkey";

alter table "public"."order_items" add constraint "order_items_product_id_fkey" FOREIGN KEY (product_id) REFERENCES public.products(id) not valid;

alter table "public"."order_items" validate constraint "order_items_product_id_fkey";

alter table "public"."order_items" add constraint "order_items_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) not valid;

alter table "public"."order_items" validate constraint "order_items_tenant_id_fkey";

alter table "public"."orders" add constraint "orders_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) not valid;

alter table "public"."orders" validate constraint "orders_tenant_id_fkey";

alter table "public"."orders" add constraint "orders_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.users(id) not valid;

alter table "public"."orders" validate constraint "orders_user_id_fkey";

alter table "public"."page_categories" add constraint "page_categories_category_id_fkey" FOREIGN KEY (category_id) REFERENCES public.categories(id) ON DELETE CASCADE not valid;

alter table "public"."page_categories" validate constraint "page_categories_category_id_fkey";

alter table "public"."page_categories" add constraint "page_categories_page_id_fkey" FOREIGN KEY (page_id) REFERENCES public.pages(id) ON DELETE CASCADE not valid;

alter table "public"."page_categories" validate constraint "page_categories_page_id_fkey";

alter table "public"."page_categories" add constraint "page_categories_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE not valid;

alter table "public"."page_categories" validate constraint "page_categories_tenant_id_fkey";

alter table "public"."page_tags" add constraint "page_tags_page_id_fkey" FOREIGN KEY (page_id) REFERENCES public.pages(id) ON DELETE CASCADE not valid;

alter table "public"."page_tags" validate constraint "page_tags_page_id_fkey";

alter table "public"."page_tags" add constraint "page_tags_tag_id_fkey" FOREIGN KEY (tag_id) REFERENCES public.tags(id) ON DELETE CASCADE not valid;

alter table "public"."page_tags" validate constraint "page_tags_tag_id_fkey";

alter table "public"."page_tags" add constraint "page_tags_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE not valid;

alter table "public"."page_tags" validate constraint "page_tags_tenant_id_fkey";

alter table "public"."pages" add constraint "pages_category_id_fkey" FOREIGN KEY (category_id) REFERENCES public.categories(id) not valid;

alter table "public"."pages" validate constraint "pages_category_id_fkey";

alter table "public"."pages" add constraint "pages_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.users(id) not valid;

alter table "public"."pages" validate constraint "pages_created_by_fkey";

alter table "public"."pages" add constraint "pages_current_assignee_id_fkey" FOREIGN KEY (current_assignee_id) REFERENCES public.users(id) not valid;

alter table "public"."pages" validate constraint "pages_current_assignee_id_fkey";

alter table "public"."pages" add constraint "pages_parent_id_fkey" FOREIGN KEY (parent_id) REFERENCES public.pages(id) not valid;

alter table "public"."pages" validate constraint "pages_parent_id_fkey";

alter table "public"."pages" add constraint "pages_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) not valid;

alter table "public"."pages" validate constraint "pages_tenant_id_fkey";

alter table "public"."payment_methods" add constraint "payment_methods_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE not valid;

alter table "public"."payment_methods" validate constraint "payment_methods_tenant_id_fkey";

alter table "public"."payments" add constraint "payments_order_id_fkey" FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE not valid;

alter table "public"."payments" validate constraint "payments_order_id_fkey";

alter table "public"."payments" add constraint "payments_payment_method_id_fkey" FOREIGN KEY (payment_method_id) REFERENCES public.payment_methods(id) not valid;

alter table "public"."payments" validate constraint "payments_payment_method_id_fkey";

alter table "public"."payments" add constraint "payments_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE not valid;

alter table "public"."payments" validate constraint "payments_tenant_id_fkey";

alter table "public"."permissions" add constraint "permissions_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.users(id) not valid;

alter table "public"."permissions" validate constraint "permissions_created_by_fkey";

alter table "public"."photo_gallery" add constraint "photo_gallery_category_id_fkey" FOREIGN KEY (category_id) REFERENCES public.categories(id) not valid;

alter table "public"."photo_gallery" validate constraint "photo_gallery_category_id_fkey";

alter table "public"."photo_gallery" add constraint "photo_gallery_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.users(id) not valid;

alter table "public"."photo_gallery" validate constraint "photo_gallery_created_by_fkey";

alter table "public"."photo_gallery" add constraint "photo_gallery_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) not valid;

alter table "public"."photo_gallery" validate constraint "photo_gallery_tenant_id_fkey";

alter table "public"."photo_gallery_tags" add constraint "photo_gallery_tags_photo_gallery_id_fkey" FOREIGN KEY (photo_gallery_id) REFERENCES public.photo_gallery(id) ON DELETE CASCADE not valid;

alter table "public"."photo_gallery_tags" validate constraint "photo_gallery_tags_photo_gallery_id_fkey";

alter table "public"."photo_gallery_tags" add constraint "photo_gallery_tags_tag_id_fkey" FOREIGN KEY (tag_id) REFERENCES public.tags(id) ON DELETE CASCADE not valid;

alter table "public"."photo_gallery_tags" validate constraint "photo_gallery_tags_tag_id_fkey";

alter table "public"."photo_gallery_tags" add constraint "photo_gallery_tags_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE not valid;

alter table "public"."photo_gallery_tags" validate constraint "photo_gallery_tags_tenant_id_fkey";

alter table "public"."policies" add constraint "policies_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) not valid;

alter table "public"."policies" validate constraint "policies_tenant_id_fkey";

alter table "public"."portfolio" add constraint "portfolio_category_id_fkey" FOREIGN KEY (category_id) REFERENCES public.categories(id) not valid;

alter table "public"."portfolio" validate constraint "portfolio_category_id_fkey";

alter table "public"."portfolio" add constraint "portfolio_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.users(id) not valid;

alter table "public"."portfolio" validate constraint "portfolio_created_by_fkey";

alter table "public"."portfolio" add constraint "portfolio_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) not valid;

alter table "public"."portfolio" validate constraint "portfolio_tenant_id_fkey";

alter table "public"."portfolio_tags" add constraint "portfolio_tags_portfolio_id_fkey" FOREIGN KEY (portfolio_id) REFERENCES public.portfolio(id) ON DELETE CASCADE not valid;

alter table "public"."portfolio_tags" validate constraint "portfolio_tags_portfolio_id_fkey";

alter table "public"."portfolio_tags" add constraint "portfolio_tags_tag_id_fkey" FOREIGN KEY (tag_id) REFERENCES public.tags(id) ON DELETE CASCADE not valid;

alter table "public"."portfolio_tags" validate constraint "portfolio_tags_tag_id_fkey";

alter table "public"."portfolio_tags" add constraint "portfolio_tags_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE not valid;

alter table "public"."portfolio_tags" validate constraint "portfolio_tags_tenant_id_fkey";

alter table "public"."product_tags" add constraint "product_tags_product_id_fkey" FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE not valid;

alter table "public"."product_tags" validate constraint "product_tags_product_id_fkey";

alter table "public"."product_tags" add constraint "product_tags_tag_id_fkey" FOREIGN KEY (tag_id) REFERENCES public.tags(id) ON DELETE CASCADE not valid;

alter table "public"."product_tags" validate constraint "product_tags_tag_id_fkey";

alter table "public"."product_tags" add constraint "product_tags_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE not valid;

alter table "public"."product_tags" validate constraint "product_tags_tenant_id_fkey";

alter table "public"."product_type_tags" add constraint "product_type_tags_product_type_id_fkey" FOREIGN KEY (product_type_id) REFERENCES public.product_types(id) ON DELETE CASCADE not valid;

alter table "public"."product_type_tags" validate constraint "product_type_tags_product_type_id_fkey";

alter table "public"."product_type_tags" add constraint "product_type_tags_tag_id_fkey" FOREIGN KEY (tag_id) REFERENCES public.tags(id) ON DELETE CASCADE not valid;

alter table "public"."product_type_tags" validate constraint "product_type_tags_tag_id_fkey";

alter table "public"."product_type_tags" add constraint "product_type_tags_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE not valid;

alter table "public"."product_type_tags" validate constraint "product_type_tags_tenant_id_fkey";

alter table "public"."product_types" add constraint "product_types_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.users(id) not valid;

alter table "public"."product_types" validate constraint "product_types_created_by_fkey";

alter table "public"."product_types" add constraint "product_types_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) not valid;

alter table "public"."product_types" validate constraint "product_types_tenant_id_fkey";

alter table "public"."products" add constraint "products_category_id_fkey" FOREIGN KEY (category_id) REFERENCES public.categories(id) not valid;

alter table "public"."products" validate constraint "products_category_id_fkey";

alter table "public"."products" add constraint "products_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.users(id) not valid;

alter table "public"."products" validate constraint "products_created_by_fkey";

alter table "public"."products" add constraint "products_product_type_id_fkey" FOREIGN KEY (product_type_id) REFERENCES public.product_types(id) not valid;

alter table "public"."products" validate constraint "products_product_type_id_fkey";

alter table "public"."products" add constraint "products_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) not valid;

alter table "public"."products" validate constraint "products_tenant_id_fkey";

alter table "public"."promotion_tags" add constraint "promotion_tags_promotion_id_fkey" FOREIGN KEY (promotion_id) REFERENCES public.promotions(id) ON DELETE CASCADE not valid;

alter table "public"."promotion_tags" validate constraint "promotion_tags_promotion_id_fkey";

alter table "public"."promotion_tags" add constraint "promotion_tags_tag_id_fkey" FOREIGN KEY (tag_id) REFERENCES public.tags(id) ON DELETE CASCADE not valid;

alter table "public"."promotion_tags" validate constraint "promotion_tags_tag_id_fkey";

alter table "public"."promotion_tags" add constraint "promotion_tags_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE not valid;

alter table "public"."promotion_tags" validate constraint "promotion_tags_tenant_id_fkey";

alter table "public"."promotions" add constraint "promotions_category_id_fkey" FOREIGN KEY (category_id) REFERENCES public.categories(id) not valid;

alter table "public"."promotions" validate constraint "promotions_category_id_fkey";

alter table "public"."promotions" add constraint "promotions_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.users(id) not valid;

alter table "public"."promotions" validate constraint "promotions_created_by_fkey";

alter table "public"."promotions" add constraint "promotions_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) not valid;

alter table "public"."promotions" validate constraint "promotions_tenant_id_fkey";

alter table "public"."push_notifications" add constraint "push_notifications_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE not valid;

alter table "public"."push_notifications" validate constraint "push_notifications_tenant_id_fkey";

alter table "public"."regions" add constraint "regions_level_id_fkey" FOREIGN KEY (level_id) REFERENCES public.region_levels(id) not valid;

alter table "public"."regions" validate constraint "regions_level_id_fkey";

alter table "public"."regions" add constraint "regions_parent_id_fkey" FOREIGN KEY (parent_id) REFERENCES public.regions(id) not valid;

alter table "public"."regions" validate constraint "regions_parent_id_fkey";

alter table "public"."regions" add constraint "regions_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) not valid;

alter table "public"."regions" validate constraint "regions_tenant_id_fkey";

alter table "public"."role_permissions" add constraint "role_permissions_permission_id_fkey" FOREIGN KEY (permission_id) REFERENCES public.permissions(id) ON DELETE CASCADE not valid;

alter table "public"."role_permissions" validate constraint "role_permissions_permission_id_fkey";

alter table "public"."role_permissions" add constraint "role_permissions_role_id_fkey" FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE CASCADE not valid;

alter table "public"."role_permissions" validate constraint "role_permissions_role_id_fkey";

alter table "public"."role_permissions" add constraint "role_permissions_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE not valid;

alter table "public"."role_permissions" validate constraint "role_permissions_tenant_id_fkey";

alter table "public"."role_policies" add constraint "role_policies_policy_id_fkey" FOREIGN KEY (policy_id) REFERENCES public.policies(id) ON DELETE CASCADE not valid;

alter table "public"."role_policies" validate constraint "role_policies_policy_id_fkey";

alter table "public"."role_policies" add constraint "role_policies_role_id_fkey" FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE CASCADE not valid;

alter table "public"."role_policies" validate constraint "role_policies_role_id_fkey";

alter table "public"."roles" add constraint "roles_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.users(id) not valid;

alter table "public"."roles" validate constraint "roles_created_by_fkey";

alter table "public"."roles" add constraint "roles_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) not valid;

alter table "public"."roles" validate constraint "roles_tenant_id_fkey";

alter table "public"."sensor_readings" add constraint "sensor_readings_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE not valid;

alter table "public"."sensor_readings" validate constraint "sensor_readings_tenant_id_fkey";

alter table "public"."seo_metadata" add constraint "seo_metadata_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) not valid;

alter table "public"."seo_metadata" validate constraint "seo_metadata_tenant_id_fkey";

alter table "public"."settings" add constraint "settings_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) not valid;

alter table "public"."settings" validate constraint "settings_tenant_id_fkey";

alter table "public"."sso_audit_logs" add constraint "sso_audit_logs_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE not valid;

alter table "public"."sso_audit_logs" validate constraint "sso_audit_logs_tenant_id_fkey";

alter table "public"."sso_audit_logs" add constraint "sso_audit_logs_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL not valid;

alter table "public"."sso_audit_logs" validate constraint "sso_audit_logs_user_id_fkey";

alter table "public"."sso_providers" add constraint "sso_providers_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.users(id) not valid;

alter table "public"."sso_providers" validate constraint "sso_providers_created_by_fkey";

alter table "public"."sso_providers" add constraint "sso_providers_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) not valid;

alter table "public"."sso_providers" validate constraint "sso_providers_tenant_id_fkey";

alter table "public"."sso_role_mappings" add constraint "sso_role_mappings_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.users(id) not valid;

alter table "public"."sso_role_mappings" validate constraint "sso_role_mappings_created_by_fkey";

alter table "public"."sso_role_mappings" add constraint "sso_role_mappings_internal_role_id_fkey" FOREIGN KEY (internal_role_id) REFERENCES public.roles(id) ON DELETE CASCADE not valid;

alter table "public"."sso_role_mappings" validate constraint "sso_role_mappings_internal_role_id_fkey";

alter table "public"."tags" add constraint "tags_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.users(id) not valid;

alter table "public"."tags" validate constraint "tags_created_by_fkey";

alter table "public"."tags" add constraint "tags_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) not valid;

alter table "public"."tags" validate constraint "tags_tenant_id_fkey";

alter table "public"."template_assignments" add constraint "template_assignments_template_id_fkey" FOREIGN KEY (template_id) REFERENCES public.templates(id) ON DELETE SET NULL not valid;

alter table "public"."template_assignments" validate constraint "template_assignments_template_id_fkey";

alter table "public"."template_assignments" add constraint "template_assignments_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE not valid;

alter table "public"."template_assignments" validate constraint "template_assignments_tenant_id_fkey";

alter table "public"."template_parts" add constraint "template_parts_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE not valid;

alter table "public"."template_parts" validate constraint "template_parts_tenant_id_fkey";

alter table "public"."templates" add constraint "templates_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) not valid;

alter table "public"."templates" validate constraint "templates_tenant_id_fkey";

alter table "public"."testimonies" add constraint "testimonies_category_id_fkey" FOREIGN KEY (category_id) REFERENCES public.categories(id) not valid;

alter table "public"."testimonies" validate constraint "testimonies_category_id_fkey";

alter table "public"."testimonies" add constraint "testimonies_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.users(id) not valid;

alter table "public"."testimonies" validate constraint "testimonies_created_by_fkey";

alter table "public"."testimonies" add constraint "testimonies_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) not valid;

alter table "public"."testimonies" validate constraint "testimonies_tenant_id_fkey";

alter table "public"."testimony_tags" add constraint "testimony_tags_tag_id_fkey" FOREIGN KEY (tag_id) REFERENCES public.tags(id) ON DELETE CASCADE not valid;

alter table "public"."testimony_tags" validate constraint "testimony_tags_tag_id_fkey";

alter table "public"."testimony_tags" add constraint "testimony_tags_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE not valid;

alter table "public"."testimony_tags" validate constraint "testimony_tags_tenant_id_fkey";

alter table "public"."testimony_tags" add constraint "testimony_tags_testimony_id_fkey" FOREIGN KEY (testimony_id) REFERENCES public.testimonies(id) ON DELETE CASCADE not valid;

alter table "public"."testimony_tags" validate constraint "testimony_tags_testimony_id_fkey";

alter table "public"."themes" add constraint "themes_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) not valid;

alter table "public"."themes" validate constraint "themes_tenant_id_fkey";

alter table "public"."two_factor_audit_logs" add constraint "two_factor_audit_logs_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE not valid;

alter table "public"."two_factor_audit_logs" validate constraint "two_factor_audit_logs_tenant_id_fkey";

alter table "public"."two_factor_audit_logs" add constraint "two_factor_audit_logs_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.users(id) not valid;

alter table "public"."two_factor_audit_logs" validate constraint "two_factor_audit_logs_user_id_fkey";

alter table "public"."two_factor_auth" add constraint "two_factor_auth_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE not valid;

alter table "public"."two_factor_auth" validate constraint "two_factor_auth_tenant_id_fkey";

alter table "public"."two_factor_auth" add constraint "two_factor_auth_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE not valid;

alter table "public"."two_factor_auth" validate constraint "two_factor_auth_user_id_fkey";

alter table "public"."users" add constraint "users_admin_approved_by_fkey" FOREIGN KEY (admin_approved_by) REFERENCES public.users(id) not valid;

alter table "public"."users" validate constraint "users_admin_approved_by_fkey";

alter table "public"."users" add constraint "users_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.users(id) not valid;

alter table "public"."users" validate constraint "users_created_by_fkey";

alter table "public"."users" add constraint "users_region_id_fkey" FOREIGN KEY (region_id) REFERENCES public.regions(id) ON DELETE SET NULL not valid;

alter table "public"."users" validate constraint "users_region_id_fkey";

alter table "public"."users" add constraint "users_role_id_fkey" FOREIGN KEY (role_id) REFERENCES public.roles(id) not valid;

alter table "public"."users" validate constraint "users_role_id_fkey";

alter table "public"."users" add constraint "users_super_admin_approved_by_fkey" FOREIGN KEY (super_admin_approved_by) REFERENCES public.users(id) not valid;

alter table "public"."users" validate constraint "users_super_admin_approved_by_fkey";

alter table "public"."users" add constraint "users_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) not valid;

alter table "public"."users" validate constraint "users_tenant_id_fkey";

alter table "public"."video_gallery" add constraint "video_gallery_category_id_fkey" FOREIGN KEY (category_id) REFERENCES public.categories(id) not valid;

alter table "public"."video_gallery" validate constraint "video_gallery_category_id_fkey";

alter table "public"."video_gallery" add constraint "video_gallery_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.users(id) not valid;

alter table "public"."video_gallery" validate constraint "video_gallery_created_by_fkey";

alter table "public"."video_gallery" add constraint "video_gallery_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) not valid;

alter table "public"."video_gallery" validate constraint "video_gallery_tenant_id_fkey";

alter table "public"."video_gallery_tags" add constraint "video_gallery_tags_tag_id_fkey" FOREIGN KEY (tag_id) REFERENCES public.tags(id) ON DELETE CASCADE not valid;

alter table "public"."video_gallery_tags" validate constraint "video_gallery_tags_tag_id_fkey";

alter table "public"."video_gallery_tags" add constraint "video_gallery_tags_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE not valid;

alter table "public"."video_gallery_tags" validate constraint "video_gallery_tags_tenant_id_fkey";

alter table "public"."video_gallery_tags" add constraint "video_gallery_tags_video_gallery_id_fkey" FOREIGN KEY (video_gallery_id) REFERENCES public.video_gallery(id) ON DELETE CASCADE not valid;

alter table "public"."video_gallery_tags" validate constraint "video_gallery_tags_video_gallery_id_fkey";

alter table "public"."widgets" add constraint "widgets_area_id_fkey" FOREIGN KEY (area_id) REFERENCES public.template_parts(id) ON DELETE SET NULL not valid;

alter table "public"."widgets" validate constraint "widgets_area_id_fkey";

alter table "public"."widgets" add constraint "widgets_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE not valid;

alter table "public"."widgets" validate constraint "widgets_tenant_id_fkey";

create or replace view "public"."published_articles_view" as  SELECT id,
    tenant_id,
    title,
    content,
    excerpt,
    featured_image,
    status,
    author_id,
    created_at,
    updated_at
   FROM public.articles
  WHERE ((status = 'published'::text) AND (deleted_at IS NULL));



  create policy "account_requests_delete_unified"
  on "public"."account_requests"
  as permissive
  for delete
  to public
using (((tenant_id = public.current_tenant_id()) OR public.is_platform_admin()));



  create policy "account_requests_insert_unified"
  on "public"."account_requests"
  as permissive
  for insert
  to public
with check (((tenant_id = public.current_tenant_id()) OR public.is_platform_admin()));



  create policy "account_requests_select_unified"
  on "public"."account_requests"
  as permissive
  for select
  to public
using (((tenant_id = public.current_tenant_id()) OR public.is_platform_admin()));



  create policy "account_requests_update_unified"
  on "public"."account_requests"
  as permissive
  for update
  to public
using (((tenant_id = public.current_tenant_id()) OR public.is_platform_admin()));



  create policy "admin_menus_delete_unified"
  on "public"."admin_menus"
  as permissive
  for delete
  to public
using (public.is_platform_admin());



  create policy "admin_menus_insert_unified"
  on "public"."admin_menus"
  as permissive
  for insert
  to public
with check (public.is_platform_admin());



  create policy "admin_menus_update_unified"
  on "public"."admin_menus"
  as permissive
  for update
  to public
using (public.is_platform_admin());



  create policy "announcements_delete_unified"
  on "public"."announcements"
  as permissive
  for delete
  to public
using ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()));



  create policy "announcements_insert_unified"
  on "public"."announcements"
  as permissive
  for insert
  to public
with check ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()));



  create policy "announcements_select_unified"
  on "public"."announcements"
  as permissive
  for select
  to public
using (((tenant_id = public.current_tenant_id()) OR public.is_platform_admin()));



  create policy "announcements_update_unified"
  on "public"."announcements"
  as permissive
  for update
  to public
using ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()));



  create policy "articles_delete_unified"
  on "public"."articles"
  as permissive
  for delete
  to public
using ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()));



  create policy "articles_insert_unified"
  on "public"."articles"
  as permissive
  for insert
  to public
with check ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()));



  create policy "articles_select_unified"
  on "public"."articles"
  as permissive
  for select
  to public
using (((tenant_id = public.current_tenant_id()) OR public.is_platform_admin()));



  create policy "articles_update_unified"
  on "public"."articles"
  as permissive
  for update
  to public
using ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()));



  create policy "audit_logs_insert_unified"
  on "public"."audit_logs"
  as permissive
  for insert
  to public
with check ((tenant_id = public.current_tenant_id()));



  create policy "audit_logs_select_unified"
  on "public"."audit_logs"
  as permissive
  for select
  to public
using ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR ((tenant_id IS NULL) AND public.is_platform_admin()) OR public.is_platform_admin()));



  create policy "backup_logs_insert_tenant_scoped"
  on "public"."backup_logs"
  as permissive
  for insert
  to authenticated
with check (((tenant_id = public.current_tenant_id()) OR public.is_platform_admin()));



  create policy "backups_delete_unified"
  on "public"."backups"
  as permissive
  for delete
  to public
using (((tenant_id = public.current_tenant_id()) OR public.is_platform_admin()));



  create policy "backups_insert_unified"
  on "public"."backups"
  as permissive
  for insert
  to public
with check (((tenant_id = public.current_tenant_id()) OR public.is_platform_admin()));



  create policy "backups_select_unified"
  on "public"."backups"
  as permissive
  for select
  to public
using (((tenant_id = public.current_tenant_id()) OR public.is_platform_admin()));



  create policy "backups_update_unified"
  on "public"."backups"
  as permissive
  for update
  to public
using (((tenant_id = public.current_tenant_id()) OR public.is_platform_admin()));



  create policy "cart_items_delete_unified"
  on "public"."cart_items"
  as permissive
  for delete
  to public
using ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()));



  create policy "cart_items_insert_unified"
  on "public"."cart_items"
  as permissive
  for insert
  to public
with check ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()));



  create policy "cart_items_select_unified"
  on "public"."cart_items"
  as permissive
  for select
  to public
using (((tenant_id = public.current_tenant_id()) OR public.is_platform_admin()));



  create policy "cart_items_update_unified"
  on "public"."cart_items"
  as permissive
  for update
  to public
using ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()));



  create policy "carts_select_policy"
  on "public"."carts"
  as permissive
  for select
  to public
using (((user_id = ( SELECT auth.uid() AS uid)) OR (session_id IS NOT NULL) OR (EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = ( SELECT auth.uid() AS uid)) AND (u.role_id IN ( SELECT roles.id
           FROM public.roles
          WHERE (roles.name = ANY (ARRAY['owner'::text, 'super_admin'::text, 'admin'::text])))))))));



  create policy "categories_delete_unified"
  on "public"."categories"
  as permissive
  for delete
  to public
using ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()));



  create policy "categories_insert_unified"
  on "public"."categories"
  as permissive
  for insert
  to public
with check ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()));



  create policy "categories_select_unified"
  on "public"."categories"
  as permissive
  for select
  to public
using (((tenant_id = public.current_tenant_id()) OR public.is_platform_admin()));



  create policy "categories_update_unified"
  on "public"."categories"
  as permissive
  for update
  to public
using ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()));



  create policy "contact_messages_delete_admin"
  on "public"."contact_messages"
  as permissive
  for delete
  to public
using (((tenant_id = public.current_tenant_id()) OR public.is_platform_admin()));



  create policy "contact_messages_modify_admin"
  on "public"."contact_messages"
  as permissive
  for update
  to public
using (((tenant_id = public.current_tenant_id()) OR public.is_platform_admin()));



  create policy "contact_messages_select_unified"
  on "public"."contact_messages"
  as permissive
  for select
  to public
using (((tenant_id = public.current_tenant_id()) OR public.is_platform_admin()));



  create policy "contacts_delete_unified"
  on "public"."contacts"
  as permissive
  for delete
  to public
using ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()));



  create policy "contacts_insert_unified"
  on "public"."contacts"
  as permissive
  for insert
  to public
with check ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()));



  create policy "contacts_select_unified"
  on "public"."contacts"
  as permissive
  for select
  to public
using (((tenant_id = public.current_tenant_id()) OR public.is_platform_admin()));



  create policy "contacts_update_unified"
  on "public"."contacts"
  as permissive
  for update
  to public
using ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()));



  create policy "devices_delete_policy"
  on "public"."devices"
  as permissive
  for delete
  to public
using ((((tenant_id = ( SELECT public.current_tenant_id() AS current_tenant_id)) AND (owner_id = ( SELECT auth.uid() AS uid))) OR ( SELECT public.is_platform_admin() AS is_platform_admin)));



  create policy "devices_insert_policy"
  on "public"."devices"
  as permissive
  for insert
  to public
with check ((tenant_id = ( SELECT public.current_tenant_id() AS current_tenant_id)));



  create policy "devices_select_policy"
  on "public"."devices"
  as permissive
  for select
  to public
using ((((tenant_id = ( SELECT public.current_tenant_id() AS current_tenant_id)) AND (owner_id = ( SELECT auth.uid() AS uid))) OR ( SELECT public.is_platform_admin() AS is_platform_admin)));



  create policy "devices_update_policy"
  on "public"."devices"
  as permissive
  for update
  to public
using ((((tenant_id = ( SELECT public.current_tenant_id() AS current_tenant_id)) AND (owner_id = ( SELECT auth.uid() AS uid))) OR ( SELECT public.is_platform_admin() AS is_platform_admin)));



  create policy "email_logs_insert_unified"
  on "public"."email_logs"
  as permissive
  for insert
  to public
with check ((public.is_admin_or_above() OR public.is_platform_admin()));



  create policy "email_logs_select_unified"
  on "public"."email_logs"
  as permissive
  for select
  to public
using (((tenant_id = public.current_tenant_id()) OR public.is_platform_admin()));



  create policy "Authenticated Insert"
  on "public"."extension_logs"
  as permissive
  for insert
  to public
with check (((tenant_id = public.current_tenant_id()) OR public.is_platform_admin()));



  create policy "Platform Admin Delete Only"
  on "public"."extension_logs"
  as permissive
  for delete
  to public
using (public.is_platform_admin());



  create policy "Tenant Read Own Logs"
  on "public"."extension_logs"
  as permissive
  for select
  to public
using (((tenant_id = public.current_tenant_id()) OR public.is_platform_admin()));



  create policy "Admins manage extension_menu_items"
  on "public"."extension_menu_items"
  as permissive
  for all
  to authenticated
using (public.is_admin_or_above())
with check (public.is_admin_or_above());



  create policy "extension_permissions_delete_admin"
  on "public"."extension_permissions"
  as permissive
  for delete
  to public
using ((( SELECT public.get_my_role() AS get_my_role) = ANY (ARRAY['super_admin'::text, 'admin'::text])));



  create policy "extension_permissions_insert_admin"
  on "public"."extension_permissions"
  as permissive
  for insert
  to public
with check ((( SELECT public.get_my_role() AS get_my_role) = ANY (ARRAY['super_admin'::text, 'admin'::text])));



  create policy "extension_permissions_update_admin"
  on "public"."extension_permissions"
  as permissive
  for update
  to public
using ((( SELECT public.get_my_role() AS get_my_role) = ANY (ARRAY['super_admin'::text, 'admin'::text])));



  create policy "extension_rbac_delete"
  on "public"."extension_rbac_integration"
  as permissive
  for delete
  to public
using ((( SELECT public.get_my_role() AS get_my_role) = 'super_admin'::text));



  create policy "extension_rbac_insert"
  on "public"."extension_rbac_integration"
  as permissive
  for insert
  to public
with check ((( SELECT public.get_my_role() AS get_my_role) = 'super_admin'::text));



  create policy "extension_rbac_update"
  on "public"."extension_rbac_integration"
  as permissive
  for update
  to public
using ((( SELECT public.get_my_role() AS get_my_role) = 'super_admin'::text));



  create policy "extension_routes_delete_unified"
  on "public"."extension_routes"
  as permissive
  for delete
  to public
using ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()));



  create policy "extension_routes_insert_unified"
  on "public"."extension_routes"
  as permissive
  for insert
  to public
with check ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()));



  create policy "extension_routes_select_unified"
  on "public"."extension_routes"
  as permissive
  for select
  to public
using (((tenant_id = public.current_tenant_id()) OR public.is_platform_admin()));



  create policy "extension_routes_update_unified"
  on "public"."extension_routes"
  as permissive
  for update
  to public
using ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()));



  create policy "extension_routes_registry_select"
  on "public"."extension_routes_registry"
  as permissive
  for select
  to public
using (((is_active = true) OR (( SELECT public.get_my_role() AS get_my_role) = 'super_admin'::text)));



  create policy "extensions_delete_unified"
  on "public"."extensions"
  as permissive
  for delete
  to public
using ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()));



  create policy "extensions_insert_unified"
  on "public"."extensions"
  as permissive
  for insert
  to public
with check ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()));



  create policy "extensions_select_unified"
  on "public"."extensions"
  as permissive
  for select
  to public
using (((tenant_id = public.current_tenant_id()) OR (tenant_id IS NULL) OR public.is_platform_admin()));



  create policy "extensions_update_unified"
  on "public"."extensions"
  as permissive
  for update
  to public
using ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()));



  create policy "File permissions tenant isolation"
  on "public"."file_permissions"
  as permissive
  for all
  to authenticated
using ((public.is_platform_admin() OR (EXISTS ( SELECT 1
   FROM public.files f
  WHERE ((f.id = file_permissions.file_id) AND (f.tenant_id = public.current_tenant_id()))))))
with check ((public.is_platform_admin() OR (EXISTS ( SELECT 1
   FROM public.files f
  WHERE ((f.id = file_permissions.file_id) AND (f.tenant_id = public.current_tenant_id()))))));



  create policy "files_delete_unified"
  on "public"."files"
  as permissive
  for delete
  to public
using (((tenant_id = public.current_tenant_id()) OR public.is_platform_admin()));



  create policy "files_insert_unified"
  on "public"."files"
  as permissive
  for insert
  to public
with check (((tenant_id = public.current_tenant_id()) OR public.is_platform_admin()));



  create policy "files_select_unified"
  on "public"."files"
  as permissive
  for select
  to public
using ((((tenant_id = public.current_tenant_id()) AND (deleted_at IS NULL)) OR public.is_platform_admin()));



  create policy "files_update_unified"
  on "public"."files"
  as permissive
  for update
  to public
using (((tenant_id = public.current_tenant_id()) OR public.is_platform_admin()));



  create policy "menus_delete_unified"
  on "public"."menus"
  as permissive
  for delete
  to public
using ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()));



  create policy "menus_insert_unified"
  on "public"."menus"
  as permissive
  for insert
  to public
with check ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()));



  create policy "menus_select_unified"
  on "public"."menus"
  as permissive
  for select
  to public
using (((tenant_id = public.current_tenant_id()) OR public.is_platform_admin()));



  create policy "menus_update_unified"
  on "public"."menus"
  as permissive
  for update
  to public
using ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()));



  create policy "mobile_app_config_access"
  on "public"."mobile_app_config"
  as permissive
  for all
  to public
using (((tenant_id = ( SELECT public.current_tenant_id() AS current_tenant_id)) OR ( SELECT public.is_platform_admin() AS is_platform_admin)));



  create policy "mobile_users_access"
  on "public"."mobile_users"
  as permissive
  for all
  to public
using ((((tenant_id = ( SELECT public.current_tenant_id() AS current_tenant_id)) AND (user_id = ( SELECT auth.uid() AS uid))) OR ( SELECT public.is_admin_or_above() AS is_admin_or_above) OR ( SELECT public.is_platform_admin() AS is_platform_admin)));



  create policy "notification_readers_select_policy"
  on "public"."notification_readers"
  as permissive
  for select
  to public
using (((user_id = ( SELECT auth.uid() AS uid)) OR (( SELECT public.get_my_role() AS get_my_role) = ANY (ARRAY['super_admin'::text, 'admin'::text]))));



  create policy "notifications_delete_unified"
  on "public"."notifications"
  as permissive
  for delete
  to public
using (((user_id = ( SELECT auth.uid() AS uid)) OR ((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()));



  create policy "notifications_insert_unified"
  on "public"."notifications"
  as permissive
  for insert
  to public
with check (((user_id = ( SELECT auth.uid() AS uid)) OR ((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()));



  create policy "notifications_select_unified"
  on "public"."notifications"
  as permissive
  for select
  to public
using (((user_id = ( SELECT auth.uid() AS uid)) OR ((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()));



  create policy "notifications_update_unified"
  on "public"."notifications"
  as permissive
  for update
  to public
using (((user_id = ( SELECT auth.uid() AS uid)) OR ((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()));



  create policy "order_items_delete_unified"
  on "public"."order_items"
  as permissive
  for delete
  to public
using (((tenant_id = public.current_tenant_id()) OR public.is_platform_admin()));



  create policy "order_items_insert_unified"
  on "public"."order_items"
  as permissive
  for insert
  to public
with check (((tenant_id = public.current_tenant_id()) OR public.is_platform_admin()));



  create policy "order_items_select_unified"
  on "public"."order_items"
  as permissive
  for select
  to public
using (((tenant_id = public.current_tenant_id()) OR public.is_platform_admin()));



  create policy "order_items_update_unified"
  on "public"."order_items"
  as permissive
  for update
  to public
using (((tenant_id = public.current_tenant_id()) OR public.is_platform_admin()));



  create policy "Users view own orders"
  on "public"."orders"
  as permissive
  for select
  to public
using (((user_id = ( SELECT auth.uid() AS uid)) OR (( SELECT public.get_my_role_name() AS get_my_role_name) = ANY (ARRAY['super_admin'::text, 'admin'::text, 'editor'::text]))));



  create policy "pages_delete_unified"
  on "public"."pages"
  as permissive
  for delete
  to public
using (((tenant_id = public.current_tenant_id()) OR public.is_platform_admin()));



  create policy "pages_insert_unified"
  on "public"."pages"
  as permissive
  for insert
  to public
with check (((tenant_id = public.current_tenant_id()) OR public.is_platform_admin()));



  create policy "pages_select_unified"
  on "public"."pages"
  as permissive
  for select
  to public
using ((((tenant_id = public.current_tenant_id()) AND (deleted_at IS NULL)) OR public.is_platform_admin()));



  create policy "pages_update_unified"
  on "public"."pages"
  as permissive
  for update
  to public
using (((tenant_id = public.current_tenant_id()) OR public.is_platform_admin()));



  create policy "Payment methods Delete"
  on "public"."payment_methods"
  as permissive
  for delete
  to public
using ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = ( SELECT auth.uid() AS uid)) AND (u.role_id IN ( SELECT roles.id
           FROM public.roles
          WHERE (roles.name = ANY (ARRAY['owner'::text, 'super_admin'::text, 'admin'::text]))))))));



  create policy "Payment methods Insert"
  on "public"."payment_methods"
  as permissive
  for insert
  to public
with check ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = ( SELECT auth.uid() AS uid)) AND (u.role_id IN ( SELECT roles.id
           FROM public.roles
          WHERE (roles.name = ANY (ARRAY['owner'::text, 'super_admin'::text, 'admin'::text]))))))));



  create policy "Payment methods Select"
  on "public"."payment_methods"
  as permissive
  for select
  to public
using ((((is_active = true) AND (deleted_at IS NULL)) OR (EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = ( SELECT auth.uid() AS uid)) AND (u.role_id IN ( SELECT roles.id
           FROM public.roles
          WHERE (roles.name = ANY (ARRAY['owner'::text, 'super_admin'::text, 'admin'::text])))))))));



  create policy "Payment methods Update"
  on "public"."payment_methods"
  as permissive
  for update
  to public
using ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = ( SELECT auth.uid() AS uid)) AND (u.role_id IN ( SELECT roles.id
           FROM public.roles
          WHERE (roles.name = ANY (ARRAY['owner'::text, 'super_admin'::text, 'admin'::text]))))))));



  create policy "Payments Delete"
  on "public"."payments"
  as permissive
  for delete
  to public
using ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = ( SELECT auth.uid() AS uid)) AND (u.role_id IN ( SELECT roles.id
           FROM public.roles
          WHERE (roles.name = ANY (ARRAY['owner'::text, 'super_admin'::text, 'admin'::text]))))))));



  create policy "Payments Insert"
  on "public"."payments"
  as permissive
  for insert
  to public
with check ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = ( SELECT auth.uid() AS uid)) AND (u.role_id IN ( SELECT roles.id
           FROM public.roles
          WHERE (roles.name = ANY (ARRAY['owner'::text, 'super_admin'::text, 'admin'::text]))))))));



  create policy "Payments Select"
  on "public"."payments"
  as permissive
  for select
  to public
using (((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = ( SELECT auth.uid() AS uid)) AND (u.role_id IN ( SELECT roles.id
           FROM public.roles
          WHERE (roles.name = ANY (ARRAY['owner'::text, 'super_admin'::text, 'admin'::text]))))))) OR (EXISTS ( SELECT 1
   FROM public.orders o
  WHERE ((o.id = payments.order_id) AND (o.user_id = ( SELECT auth.uid() AS uid)))))));



  create policy "Payments Update"
  on "public"."payments"
  as permissive
  for update
  to public
using ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = ( SELECT auth.uid() AS uid)) AND (u.role_id IN ( SELECT roles.id
           FROM public.roles
          WHERE (roles.name = ANY (ARRAY['owner'::text, 'super_admin'::text, 'admin'::text]))))))));



  create policy "permissions_delete_policy"
  on "public"."permissions"
  as permissive
  for delete
  to authenticated
using (public.is_super_admin());



  create policy "permissions_insert_policy"
  on "public"."permissions"
  as permissive
  for insert
  to authenticated
with check (public.is_super_admin());



  create policy "permissions_update_policy"
  on "public"."permissions"
  as permissive
  for update
  to authenticated
using (public.is_super_admin())
with check (public.is_super_admin());



  create policy "photo_gallery_delete_unified"
  on "public"."photo_gallery"
  as permissive
  for delete
  to public
using (((tenant_id = public.current_tenant_id()) OR public.is_platform_admin()));



  create policy "photo_gallery_insert_unified"
  on "public"."photo_gallery"
  as permissive
  for insert
  to public
with check (((tenant_id = public.current_tenant_id()) OR public.is_platform_admin()));



  create policy "photo_gallery_select_unified"
  on "public"."photo_gallery"
  as permissive
  for select
  to public
using (((tenant_id = public.current_tenant_id()) OR public.is_platform_admin()));



  create policy "photo_gallery_update_unified"
  on "public"."photo_gallery"
  as permissive
  for update
  to public
using (((tenant_id = public.current_tenant_id()) OR public.is_platform_admin()));



  create policy "policies_delete_unified"
  on "public"."policies"
  as permissive
  for delete
  to public
using (public.is_platform_admin());



  create policy "policies_insert_unified"
  on "public"."policies"
  as permissive
  for insert
  to public
with check (public.is_platform_admin());



  create policy "policies_select_unified"
  on "public"."policies"
  as permissive
  for select
  to public
using (((tenant_id = public.current_tenant_id()) OR (tenant_id IS NULL) OR public.is_platform_admin()));



  create policy "policies_update_unified"
  on "public"."policies"
  as permissive
  for update
  to public
using (public.is_platform_admin());



  create policy "portfolio_delete_unified"
  on "public"."portfolio"
  as permissive
  for delete
  to public
using ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()));



  create policy "portfolio_insert_unified"
  on "public"."portfolio"
  as permissive
  for insert
  to public
with check ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()));



  create policy "portfolio_select_unified"
  on "public"."portfolio"
  as permissive
  for select
  to public
using (((tenant_id = public.current_tenant_id()) OR public.is_platform_admin()));



  create policy "portfolio_update_unified"
  on "public"."portfolio"
  as permissive
  for update
  to public
using ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()));



  create policy "product_types_delete_unified"
  on "public"."product_types"
  as permissive
  for delete
  to public
using (((tenant_id = public.current_tenant_id()) OR public.is_platform_admin()));



  create policy "product_types_insert_unified"
  on "public"."product_types"
  as permissive
  for insert
  to public
with check (((tenant_id = public.current_tenant_id()) OR public.is_platform_admin()));



  create policy "product_types_select_unified"
  on "public"."product_types"
  as permissive
  for select
  to public
using (((tenant_id = public.current_tenant_id()) OR public.is_platform_admin()));



  create policy "product_types_update_unified"
  on "public"."product_types"
  as permissive
  for update
  to public
using (((tenant_id = public.current_tenant_id()) OR public.is_platform_admin()));



  create policy "products_delete_unified"
  on "public"."products"
  as permissive
  for delete
  to public
using ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()));



  create policy "products_insert_unified"
  on "public"."products"
  as permissive
  for insert
  to public
with check ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()));



  create policy "products_select_unified"
  on "public"."products"
  as permissive
  for select
  to public
using (((tenant_id = public.current_tenant_id()) OR public.is_platform_admin()));



  create policy "products_update_unified"
  on "public"."products"
  as permissive
  for update
  to public
using ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()));



  create policy "promotions_delete_unified"
  on "public"."promotions"
  as permissive
  for delete
  to public
using ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()));



  create policy "promotions_insert_unified"
  on "public"."promotions"
  as permissive
  for insert
  to public
with check ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()));



  create policy "promotions_select_unified"
  on "public"."promotions"
  as permissive
  for select
  to public
using (((tenant_id = public.current_tenant_id()) OR public.is_platform_admin()));



  create policy "promotions_update_unified"
  on "public"."promotions"
  as permissive
  for update
  to public
using ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()));



  create policy "push_notifications_access"
  on "public"."push_notifications"
  as permissive
  for all
  to public
using (((tenant_id = ( SELECT public.current_tenant_id() AS current_tenant_id)) OR ( SELECT public.is_platform_admin() AS is_platform_admin)));



  create policy "Regions tenant isolation"
  on "public"."regions"
  as permissive
  for all
  to authenticated
using ((tenant_id = ( SELECT public.current_tenant_id() AS current_tenant_id)));



  create policy "role_permissions_delete_policy"
  on "public"."role_permissions"
  as permissive
  for delete
  to authenticated
using (public.is_super_admin());



  create policy "role_permissions_insert_policy"
  on "public"."role_permissions"
  as permissive
  for insert
  to authenticated
with check (public.is_super_admin());



  create policy "role_permissions_update_policy"
  on "public"."role_permissions"
  as permissive
  for update
  to authenticated
using (public.is_super_admin())
with check (public.is_super_admin());



  create policy "role_policies_delete_unified"
  on "public"."role_policies"
  as permissive
  for delete
  to public
using (public.is_platform_admin());



  create policy "role_policies_insert_unified"
  on "public"."role_policies"
  as permissive
  for insert
  to public
with check (public.is_platform_admin());



  create policy "role_policies_update_unified"
  on "public"."role_policies"
  as permissive
  for update
  to public
using (public.is_platform_admin());



  create policy "roles_delete_unified"
  on "public"."roles"
  as permissive
  for delete
  to public
using ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()));



  create policy "roles_insert_unified"
  on "public"."roles"
  as permissive
  for insert
  to public
with check ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()));



  create policy "roles_select_unified"
  on "public"."roles"
  as permissive
  for select
  to public
using (((tenant_id = public.current_tenant_id()) OR (tenant_id IS NULL) OR public.is_platform_admin()));



  create policy "roles_update_unified"
  on "public"."roles"
  as permissive
  for update
  to public
using ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()));



  create policy "sensor_readings_access"
  on "public"."sensor_readings"
  as permissive
  for all
  to public
using (((tenant_id = ( SELECT public.current_tenant_id() AS current_tenant_id)) OR ( SELECT public.is_platform_admin() AS is_platform_admin)));



  create policy "settings_delete_unified"
  on "public"."settings"
  as permissive
  for delete
  to public
using ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()));



  create policy "settings_insert_unified"
  on "public"."settings"
  as permissive
  for insert
  to public
with check ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()));



  create policy "settings_select_unified"
  on "public"."settings"
  as permissive
  for select
  to public
using (((tenant_id = public.current_tenant_id()) OR (tenant_id IS NULL) OR public.is_platform_admin()));



  create policy "settings_update_unified"
  on "public"."settings"
  as permissive
  for update
  to public
using ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()));



  create policy "Admins View SSO Logs"
  on "public"."sso_audit_logs"
  as permissive
  for select
  to public
using ((public.get_my_role() = ANY (ARRAY['super_admin'::text, 'admin'::text])));



  create policy "sso_providers_isolation_policy"
  on "public"."sso_providers"
  as permissive
  for all
  to public
using ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()));



  create policy "sso_role_mappings_delete_unified"
  on "public"."sso_role_mappings"
  as permissive
  for delete
  to public
using ((EXISTS ( SELECT 1
   FROM public.sso_providers p
  WHERE ((p.id = (sso_role_mappings.provider_id)::uuid) AND (((p.tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin())))));



  create policy "sso_role_mappings_insert_unified"
  on "public"."sso_role_mappings"
  as permissive
  for insert
  to public
with check ((EXISTS ( SELECT 1
   FROM public.sso_providers p
  WHERE ((p.id = (sso_role_mappings.provider_id)::uuid) AND (((p.tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin())))));



  create policy "sso_role_mappings_select_unified"
  on "public"."sso_role_mappings"
  as permissive
  for select
  to public
using ((EXISTS ( SELECT 1
   FROM public.sso_providers p
  WHERE ((p.id = (sso_role_mappings.provider_id)::uuid) AND ((p.tenant_id = public.current_tenant_id()) OR public.is_platform_admin())))));



  create policy "sso_role_mappings_update_unified"
  on "public"."sso_role_mappings"
  as permissive
  for update
  to public
using ((EXISTS ( SELECT 1
   FROM public.sso_providers p
  WHERE ((p.id = (sso_role_mappings.provider_id)::uuid) AND (((p.tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin())))));



  create policy "tags_delete_unified"
  on "public"."tags"
  as permissive
  for delete
  to public
using ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()));



  create policy "tags_insert_unified"
  on "public"."tags"
  as permissive
  for insert
  to public
with check ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()));



  create policy "tags_select_unified"
  on "public"."tags"
  as permissive
  for select
  to public
using (((tenant_id = public.current_tenant_id()) OR public.is_platform_admin()));



  create policy "tags_update_unified"
  on "public"."tags"
  as permissive
  for update
  to public
using ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()));



  create policy "template_assignments_delete_unified"
  on "public"."template_assignments"
  as permissive
  for delete
  to public
using (((tenant_id = public.current_tenant_id()) OR public.is_platform_admin()));



  create policy "template_assignments_modify_unified"
  on "public"."template_assignments"
  as permissive
  for insert
  to public
with check (((tenant_id = public.current_tenant_id()) OR public.is_platform_admin()));



  create policy "template_assignments_select_unified"
  on "public"."template_assignments"
  as permissive
  for select
  to public
using (((tenant_id = public.current_tenant_id()) OR public.is_platform_admin()));



  create policy "template_assignments_update_unified"
  on "public"."template_assignments"
  as permissive
  for update
  to public
using (((tenant_id = public.current_tenant_id()) OR public.is_platform_admin()));



  create policy "template_parts_delete_unified"
  on "public"."template_parts"
  as permissive
  for delete
  to public
using (((tenant_id = public.current_tenant_id()) OR public.is_platform_admin()));



  create policy "template_parts_modify_unified"
  on "public"."template_parts"
  as permissive
  for insert
  to public
with check (((tenant_id = public.current_tenant_id()) OR public.is_platform_admin()));



  create policy "template_parts_select_unified"
  on "public"."template_parts"
  as permissive
  for select
  to public
using (((tenant_id = public.current_tenant_id()) OR public.is_platform_admin()));



  create policy "template_parts_update_unified"
  on "public"."template_parts"
  as permissive
  for update
  to public
using (((tenant_id = public.current_tenant_id()) OR public.is_platform_admin()));



  create policy "template_strings_delete_unified"
  on "public"."template_strings"
  as permissive
  for delete
  to public
using (public.is_platform_admin());



  create policy "template_strings_insert_unified"
  on "public"."template_strings"
  as permissive
  for insert
  to public
with check (public.is_platform_admin());



  create policy "template_strings_update_unified"
  on "public"."template_strings"
  as permissive
  for update
  to public
using (public.is_platform_admin());



  create policy "templates_delete_unified"
  on "public"."templates"
  as permissive
  for delete
  to public
using (((tenant_id = public.current_tenant_id()) OR public.is_platform_admin()));



  create policy "templates_modify_unified"
  on "public"."templates"
  as permissive
  for insert
  to public
with check (((tenant_id = public.current_tenant_id()) OR public.is_platform_admin()));



  create policy "templates_select_unified"
  on "public"."templates"
  as permissive
  for select
  to public
using (((tenant_id = public.current_tenant_id()) OR public.is_platform_admin()));



  create policy "templates_update_unified"
  on "public"."templates"
  as permissive
  for update
  to public
using (((tenant_id = public.current_tenant_id()) OR public.is_platform_admin()));



  create policy "tenants_delete_unified"
  on "public"."tenants"
  as permissive
  for delete
  to public
using (public.is_platform_admin());



  create policy "tenants_insert_unified"
  on "public"."tenants"
  as permissive
  for insert
  to public
with check (public.is_platform_admin());



  create policy "tenants_select_unified"
  on "public"."tenants"
  as permissive
  for select
  to public
using (((id = public.current_tenant_id()) OR public.is_platform_admin()));



  create policy "tenants_update_unified"
  on "public"."tenants"
  as permissive
  for update
  to public
using (public.is_platform_admin());



  create policy "testimonies_delete_unified"
  on "public"."testimonies"
  as permissive
  for delete
  to public
using ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()));



  create policy "testimonies_insert_unified"
  on "public"."testimonies"
  as permissive
  for insert
  to public
with check ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()));



  create policy "testimonies_select_unified"
  on "public"."testimonies"
  as permissive
  for select
  to public
using (((tenant_id = public.current_tenant_id()) OR public.is_platform_admin()));



  create policy "testimonies_update_unified"
  on "public"."testimonies"
  as permissive
  for update
  to public
using ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()));



  create policy "testimony_tags_delete"
  on "public"."testimony_tags"
  as permissive
  for delete
  to public
using ((( SELECT public.get_my_role() AS get_my_role) = ANY (ARRAY['super_admin'::text, 'admin'::text, 'editor'::text])));



  create policy "testimony_tags_insert"
  on "public"."testimony_tags"
  as permissive
  for insert
  to public
with check ((( SELECT public.get_my_role() AS get_my_role) = ANY (ARRAY['super_admin'::text, 'admin'::text, 'editor'::text])));



  create policy "testimony_tags_update"
  on "public"."testimony_tags"
  as permissive
  for update
  to public
using ((( SELECT public.get_my_role() AS get_my_role) = ANY (ARRAY['super_admin'::text, 'admin'::text, 'editor'::text])));



  create policy "themes_delete_unified"
  on "public"."themes"
  as permissive
  for delete
  to public
using ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()));



  create policy "themes_insert_unified"
  on "public"."themes"
  as permissive
  for insert
  to public
with check ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()));



  create policy "themes_select_unified"
  on "public"."themes"
  as permissive
  for select
  to public
using (((tenant_id = public.current_tenant_id()) OR (tenant_id IS NULL) OR public.is_platform_admin()));



  create policy "themes_update_unified"
  on "public"."themes"
  as permissive
  for update
  to public
using ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()));



  create policy "users_delete_unified"
  on "public"."users"
  as permissive
  for delete
  to public
using ((public.is_admin_or_above() OR public.is_platform_admin()));



  create policy "users_insert_unified"
  on "public"."users"
  as permissive
  for insert
  to public
with check ((public.is_admin_or_above() OR public.is_platform_admin()));



  create policy "users_select_unified"
  on "public"."users"
  as permissive
  for select
  to public
using (((id = ( SELECT auth.uid() AS uid)) OR ((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()));



  create policy "users_update_unified"
  on "public"."users"
  as permissive
  for update
  to public
using ((public.is_admin_or_above() OR public.is_platform_admin()));



  create policy "video_gallery_delete_unified"
  on "public"."video_gallery"
  as permissive
  for delete
  to public
using ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()));



  create policy "video_gallery_insert_unified"
  on "public"."video_gallery"
  as permissive
  for insert
  to public
with check ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()));



  create policy "video_gallery_select_unified"
  on "public"."video_gallery"
  as permissive
  for select
  to public
using (((tenant_id = public.current_tenant_id()) OR public.is_platform_admin()));



  create policy "video_gallery_update_unified"
  on "public"."video_gallery"
  as permissive
  for update
  to public
using ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()));



  create policy "widgets_delete_unified"
  on "public"."widgets"
  as permissive
  for delete
  to public
using (((tenant_id = public.current_tenant_id()) OR public.is_platform_admin()));



  create policy "widgets_modify_unified"
  on "public"."widgets"
  as permissive
  for insert
  to public
with check (((tenant_id = public.current_tenant_id()) OR public.is_platform_admin()));



  create policy "widgets_select_unified"
  on "public"."widgets"
  as permissive
  for select
  to public
using (((tenant_id = public.current_tenant_id()) OR public.is_platform_admin()));



  create policy "widgets_update_unified"
  on "public"."widgets"
  as permissive
  for update
  to public
using (((tenant_id = public.current_tenant_id()) OR public.is_platform_admin()));


CREATE TRIGGER audit_account_requests AFTER INSERT OR DELETE OR UPDATE ON public.account_requests FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();

CREATE TRIGGER audit_log_changes_admin_menus AFTER INSERT OR DELETE OR UPDATE ON public.admin_menus FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();

CREATE TRIGGER lock_created_by_trg BEFORE UPDATE ON public.announcement_tags FOR EACH ROW EXECUTE FUNCTION public.lock_created_by();

CREATE TRIGGER set_created_by_trg BEFORE INSERT ON public.announcement_tags FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

CREATE TRIGGER lock_created_by_trg BEFORE UPDATE ON public.announcements FOR EACH ROW EXECUTE FUNCTION public.lock_created_by();

CREATE TRIGGER set_created_by_trg BEFORE INSERT ON public.announcements FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

CREATE TRIGGER trg_set_tenant_id BEFORE INSERT ON public.announcements FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id();

CREATE TRIGGER update_announcements_updated_at BEFORE UPDATE ON public.announcements FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER lock_created_by_trg BEFORE UPDATE ON public.article_tags FOR EACH ROW EXECUTE FUNCTION public.lock_created_by();

CREATE TRIGGER set_created_by_trg BEFORE INSERT ON public.article_tags FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

CREATE TRIGGER lock_created_by_trg BEFORE UPDATE ON public.articles FOR EACH ROW EXECUTE FUNCTION public.lock_created_by();

CREATE TRIGGER set_created_by_trg BEFORE INSERT ON public.articles FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

CREATE TRIGGER trg_articles_audit AFTER INSERT OR DELETE OR UPDATE ON public.articles FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();

CREATE TRIGGER trg_set_tenant_id BEFORE INSERT ON public.articles FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id();

CREATE TRIGGER update_articles_updated_at BEFORE UPDATE ON public.articles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER lock_created_by_trg BEFORE UPDATE ON public.auth_hibp_events FOR EACH ROW EXECUTE FUNCTION public.lock_created_by();

CREATE TRIGGER set_created_by_trg BEFORE INSERT ON public.auth_hibp_events FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

CREATE TRIGGER lock_created_by_trg BEFORE UPDATE ON public.backup_logs FOR EACH ROW EXECUTE FUNCTION public.lock_created_by();

CREATE TRIGGER set_created_by_trg BEFORE INSERT ON public.backup_logs FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

CREATE TRIGGER lock_created_by_trg BEFORE UPDATE ON public.backup_schedules FOR EACH ROW EXECUTE FUNCTION public.lock_created_by();

CREATE TRIGGER set_created_by_trg BEFORE INSERT ON public.backup_schedules FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

CREATE TRIGGER lock_created_by_trg BEFORE UPDATE ON public.backups FOR EACH ROW EXECUTE FUNCTION public.lock_created_by();

CREATE TRIGGER set_created_by_trg BEFORE INSERT ON public.backups FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

CREATE TRIGGER lock_created_by_trg BEFORE UPDATE ON public.categories FOR EACH ROW EXECUTE FUNCTION public.lock_created_by();

CREATE TRIGGER set_created_by_trg BEFORE INSERT ON public.categories FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

CREATE TRIGGER trg_set_tenant_id BEFORE INSERT ON public.categories FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id();

CREATE TRIGGER lock_created_by_trg BEFORE UPDATE ON public.contact_message_tags FOR EACH ROW EXECUTE FUNCTION public.lock_created_by();

CREATE TRIGGER set_created_by_trg BEFORE INSERT ON public.contact_message_tags FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

CREATE TRIGGER lock_created_by_trg BEFORE UPDATE ON public.contact_messages FOR EACH ROW EXECUTE FUNCTION public.lock_created_by();

CREATE TRIGGER set_created_by_trg BEFORE INSERT ON public.contact_messages FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

CREATE TRIGGER trg_set_tenant_id BEFORE INSERT ON public.contact_messages FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id();

CREATE TRIGGER lock_created_by_trg BEFORE UPDATE ON public.contact_tags FOR EACH ROW EXECUTE FUNCTION public.lock_created_by();

CREATE TRIGGER set_created_by_trg BEFORE INSERT ON public.contact_tags FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

CREATE TRIGGER lock_created_by_trg BEFORE UPDATE ON public.contacts FOR EACH ROW EXECUTE FUNCTION public.lock_created_by();

CREATE TRIGGER set_created_by_trg BEFORE INSERT ON public.contacts FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

CREATE TRIGGER lock_created_by_trg BEFORE UPDATE ON public.extension_menu_items FOR EACH ROW EXECUTE FUNCTION public.lock_created_by();

CREATE TRIGGER set_created_by_trg BEFORE INSERT ON public.extension_menu_items FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

CREATE TRIGGER lock_created_by_trg BEFORE UPDATE ON public.extension_permissions FOR EACH ROW EXECUTE FUNCTION public.lock_created_by();

CREATE TRIGGER set_created_by_trg BEFORE INSERT ON public.extension_permissions FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

CREATE TRIGGER lock_created_by_trg BEFORE UPDATE ON public.extension_rbac_integration FOR EACH ROW EXECUTE FUNCTION public.lock_created_by();

CREATE TRIGGER set_created_by_trg BEFORE INSERT ON public.extension_rbac_integration FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

CREATE TRIGGER lock_created_by_trg BEFORE UPDATE ON public.extension_routes FOR EACH ROW EXECUTE FUNCTION public.lock_created_by();

CREATE TRIGGER set_created_by_trg BEFORE INSERT ON public.extension_routes FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

CREATE TRIGGER trg_set_tenant_id BEFORE INSERT ON public.extension_routes FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id();

CREATE TRIGGER update_extension_routes_updated_at BEFORE UPDATE ON public.extension_routes FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER lock_created_by_trg BEFORE UPDATE ON public.extension_routes_registry FOR EACH ROW EXECUTE FUNCTION public.lock_created_by();

CREATE TRIGGER set_created_by_trg BEFORE INSERT ON public.extension_routes_registry FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

CREATE TRIGGER extension_audit_trigger AFTER INSERT OR DELETE OR UPDATE ON public.extensions FOR EACH ROW EXECUTE FUNCTION public.log_extension_change();

CREATE TRIGGER lock_created_by_trg BEFORE UPDATE ON public.extensions FOR EACH ROW EXECUTE FUNCTION public.lock_created_by();

CREATE TRIGGER set_created_by_trg BEFORE INSERT ON public.extensions FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

CREATE TRIGGER trg_set_tenant_id BEFORE INSERT ON public.extensions FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id();

CREATE TRIGGER update_extensions_updated_at BEFORE UPDATE ON public.extensions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER tr_enforce_storage_limit BEFORE INSERT ON public.files FOR EACH ROW EXECUTE FUNCTION public.enforce_storage_limit();

CREATE TRIGGER trg_set_tenant_id BEFORE INSERT ON public.files FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id();

CREATE TRIGGER update_files_updated_at BEFORE UPDATE ON public.files FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER lock_created_by_trg BEFORE UPDATE ON public.menu_permissions FOR EACH ROW EXECUTE FUNCTION public.lock_created_by();

CREATE TRIGGER set_created_by_trg BEFORE INSERT ON public.menu_permissions FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

CREATE TRIGGER lock_created_by_trg BEFORE UPDATE ON public.menus FOR EACH ROW EXECUTE FUNCTION public.lock_created_by();

CREATE TRIGGER set_created_by_trg BEFORE INSERT ON public.menus FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

CREATE TRIGGER trg_set_tenant_id BEFORE INSERT ON public.menus FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id();

CREATE TRIGGER update_notifications_updated_at BEFORE UPDATE ON public.notifications FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER audit_orders AFTER INSERT OR DELETE OR UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();

CREATE TRIGGER trg_set_tenant_id BEFORE INSERT ON public.orders FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id();

CREATE TRIGGER lock_created_by_trg BEFORE UPDATE ON public.page_categories FOR EACH ROW EXECUTE FUNCTION public.lock_created_by();

CREATE TRIGGER set_created_by_trg BEFORE INSERT ON public.page_categories FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

CREATE TRIGGER lock_created_by_trg BEFORE UPDATE ON public.page_tags FOR EACH ROW EXECUTE FUNCTION public.lock_created_by();

CREATE TRIGGER set_created_by_trg BEFORE INSERT ON public.page_tags FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

CREATE TRIGGER lock_created_by_trg BEFORE UPDATE ON public.pages FOR EACH ROW EXECUTE FUNCTION public.lock_created_by();

CREATE TRIGGER set_created_by_trg BEFORE INSERT ON public.pages FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

CREATE TRIGGER trg_set_tenant_id BEFORE INSERT ON public.pages FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id();

CREATE TRIGGER update_pages_updated_at BEFORE UPDATE ON public.pages FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER audit_log_changes_permissions AFTER INSERT OR DELETE OR UPDATE ON public.permissions FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();

CREATE TRIGGER lock_created_by_trg BEFORE UPDATE ON public.permissions FOR EACH ROW EXECUTE FUNCTION public.lock_created_by();

CREATE TRIGGER set_created_by_trg BEFORE INSERT ON public.permissions FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

CREATE TRIGGER lock_created_by_trg BEFORE UPDATE ON public.photo_gallery FOR EACH ROW EXECUTE FUNCTION public.lock_created_by();

CREATE TRIGGER set_created_by_trg BEFORE INSERT ON public.photo_gallery FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

CREATE TRIGGER trg_set_tenant_id BEFORE INSERT ON public.photo_gallery FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id();

CREATE TRIGGER update_photo_gallery_updated_at BEFORE UPDATE ON public.photo_gallery FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER lock_created_by_trg BEFORE UPDATE ON public.photo_gallery_tags FOR EACH ROW EXECUTE FUNCTION public.lock_created_by();

CREATE TRIGGER set_created_by_trg BEFORE INSERT ON public.photo_gallery_tags FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

CREATE TRIGGER audit_log_changes_policies AFTER INSERT OR DELETE OR UPDATE ON public.policies FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();

CREATE TRIGGER lock_created_by_trg BEFORE UPDATE ON public.portfolio FOR EACH ROW EXECUTE FUNCTION public.lock_created_by();

CREATE TRIGGER set_created_by_trg BEFORE INSERT ON public.portfolio FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

CREATE TRIGGER trg_set_tenant_id BEFORE INSERT ON public.portfolio FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id();

CREATE TRIGGER update_portfolio_updated_at BEFORE UPDATE ON public.portfolio FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER lock_created_by_trg BEFORE UPDATE ON public.portfolio_tags FOR EACH ROW EXECUTE FUNCTION public.lock_created_by();

CREATE TRIGGER set_created_by_trg BEFORE INSERT ON public.portfolio_tags FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

CREATE TRIGGER lock_created_by_trg BEFORE UPDATE ON public.product_tags FOR EACH ROW EXECUTE FUNCTION public.lock_created_by();

CREATE TRIGGER set_created_by_trg BEFORE INSERT ON public.product_tags FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

CREATE TRIGGER lock_created_by_trg BEFORE UPDATE ON public.product_type_tags FOR EACH ROW EXECUTE FUNCTION public.lock_created_by();

CREATE TRIGGER set_created_by_trg BEFORE INSERT ON public.product_type_tags FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

CREATE TRIGGER lock_created_by_trg BEFORE UPDATE ON public.product_types FOR EACH ROW EXECUTE FUNCTION public.lock_created_by();

CREATE TRIGGER set_created_by_trg BEFORE INSERT ON public.product_types FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

CREATE TRIGGER trg_set_tenant_id BEFORE INSERT ON public.product_types FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id();

CREATE TRIGGER audit_products AFTER INSERT OR DELETE OR UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();

CREATE TRIGGER lock_created_by_trg BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.lock_created_by();

CREATE TRIGGER set_created_by_trg BEFORE INSERT ON public.products FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

CREATE TRIGGER trg_set_tenant_id BEFORE INSERT ON public.products FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id();

CREATE TRIGGER update_products_updated_at BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER lock_created_by_trg BEFORE UPDATE ON public.promotion_tags FOR EACH ROW EXECUTE FUNCTION public.lock_created_by();

CREATE TRIGGER set_created_by_trg BEFORE INSERT ON public.promotion_tags FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

CREATE TRIGGER lock_created_by_trg BEFORE UPDATE ON public.promotions FOR EACH ROW EXECUTE FUNCTION public.lock_created_by();

CREATE TRIGGER set_created_by_trg BEFORE INSERT ON public.promotions FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

CREATE TRIGGER trg_set_tenant_id BEFORE INSERT ON public.promotions FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id();

CREATE TRIGGER update_promotions_updated_at BEFORE UPDATE ON public.promotions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER audit_log_changes_role_permissions AFTER INSERT OR DELETE OR UPDATE ON public.role_permissions FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();

CREATE TRIGGER audit_role_permissions AFTER INSERT OR DELETE OR UPDATE ON public.role_permissions FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();

CREATE TRIGGER lock_created_by_trg BEFORE UPDATE ON public.role_permissions FOR EACH ROW EXECUTE FUNCTION public.lock_created_by();

CREATE TRIGGER set_created_by_trg BEFORE INSERT ON public.role_permissions FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

CREATE TRIGGER audit_log_changes_role_policies AFTER INSERT OR DELETE OR UPDATE ON public.role_policies FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();

CREATE TRIGGER audit_log_changes_roles AFTER INSERT OR DELETE OR UPDATE ON public.roles FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();

CREATE TRIGGER audit_roles AFTER INSERT OR DELETE OR UPDATE ON public.roles FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();

CREATE TRIGGER lock_created_by_trg BEFORE UPDATE ON public.roles FOR EACH ROW EXECUTE FUNCTION public.lock_created_by();

CREATE TRIGGER set_created_by_trg BEFORE INSERT ON public.roles FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

CREATE TRIGGER update_roles_updated_at BEFORE UPDATE ON public.roles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER lock_created_by_trg BEFORE UPDATE ON public.seo_metadata FOR EACH ROW EXECUTE FUNCTION public.lock_created_by();

CREATE TRIGGER set_created_by_trg BEFORE INSERT ON public.seo_metadata FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

CREATE TRIGGER update_seo_metadata_updated_at BEFORE UPDATE ON public.seo_metadata FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER audit_settings AFTER INSERT OR DELETE OR UPDATE ON public.settings FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();

CREATE TRIGGER lock_created_by_trg BEFORE UPDATE ON public.tags FOR EACH ROW EXECUTE FUNCTION public.lock_created_by();

CREATE TRIGGER set_created_by_trg BEFORE INSERT ON public.tags FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

CREATE TRIGGER trg_set_tenant_id BEFORE INSERT ON public.tags FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id();

CREATE TRIGGER update_template_assignments_updated_at BEFORE UPDATE ON public.template_assignments FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_template_parts_updated_at BEFORE UPDATE ON public.template_parts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_template_strings_updated_at BEFORE UPDATE ON public.template_strings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER audit_log_changes_templates AFTER INSERT OR DELETE OR UPDATE ON public.templates FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();

CREATE TRIGGER trg_set_tenant_id BEFORE INSERT ON public.templates FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id();

CREATE TRIGGER update_templates_updated_at BEFORE UPDATE ON public.templates FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER audit_log_changes_tenants AFTER INSERT OR DELETE OR UPDATE ON public.tenants FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();

CREATE TRIGGER lock_created_by_trg BEFORE UPDATE ON public.testimonies FOR EACH ROW EXECUTE FUNCTION public.lock_created_by();

CREATE TRIGGER set_created_by_trg BEFORE INSERT ON public.testimonies FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

CREATE TRIGGER trg_set_tenant_id BEFORE INSERT ON public.testimonies FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id();

CREATE TRIGGER update_testimonies_updated_at BEFORE UPDATE ON public.testimonies FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER lock_created_by_trg BEFORE UPDATE ON public.testimony_tags FOR EACH ROW EXECUTE FUNCTION public.lock_created_by();

CREATE TRIGGER set_created_by_trg BEFORE INSERT ON public.testimony_tags FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

CREATE TRIGGER trg_set_tenant_id BEFORE INSERT ON public.themes FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id();

CREATE TRIGGER trigger_ensure_single_active_theme BEFORE INSERT OR UPDATE OF is_active ON public.themes FOR EACH ROW EXECUTE FUNCTION public.ensure_single_active_theme();

CREATE TRIGGER audit_log_changes_users AFTER INSERT OR DELETE OR UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();

CREATE TRIGGER audit_users AFTER INSERT OR DELETE OR UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();

CREATE TRIGGER lock_created_by_trg BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.lock_created_by();

CREATE TRIGGER set_created_by_trg BEFORE INSERT ON public.users FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

CREATE TRIGGER tr_enforce_user_limit BEFORE INSERT ON public.users FOR EACH ROW EXECUTE FUNCTION public.enforce_user_limit();

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER lock_created_by_trg BEFORE UPDATE ON public.video_gallery FOR EACH ROW EXECUTE FUNCTION public.lock_created_by();

CREATE TRIGGER set_created_by_trg BEFORE INSERT ON public.video_gallery FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

CREATE TRIGGER trg_set_tenant_id BEFORE INSERT ON public.video_gallery FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id();

CREATE TRIGGER update_video_gallery_updated_at BEFORE UPDATE ON public.video_gallery FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER lock_created_by_trg BEFORE UPDATE ON public.video_gallery_tags FOR EACH ROW EXECUTE FUNCTION public.lock_created_by();

CREATE TRIGGER set_created_by_trg BEFORE INSERT ON public.video_gallery_tags FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

CREATE TRIGGER update_widgets_updated_at BEFORE UPDATE ON public.widgets FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

drop trigger if exists "on_auth_user_created" on "auth"."users";

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

drop policy "tenant_delete_isolation" on "storage"."objects";

drop policy "tenant_select_isolation" on "storage"."objects";

drop policy "tenant_update_isolation" on "storage"."objects";

drop policy "tenant_upload_isolation" on "storage"."objects";


  create policy "tenant_delete_isolation"
  on "storage"."objects"
  as permissive
  for delete
  to authenticated
using (((bucket_id = 'cms-uploads'::text) AND ((name ~~ (public.current_tenant_id() || '/%'::text)) OR public.is_platform_admin())));



  create policy "tenant_select_isolation"
  on "storage"."objects"
  as permissive
  for select
  to authenticated
using (((bucket_id = 'cms-uploads'::text) AND ((name ~~ (public.current_tenant_id() || '/%'::text)) OR public.is_platform_admin())));



  create policy "tenant_update_isolation"
  on "storage"."objects"
  as permissive
  for update
  to authenticated
using (((bucket_id = 'cms-uploads'::text) AND ((name ~~ (public.current_tenant_id() || '/%'::text)) OR public.is_platform_admin())));



  create policy "tenant_upload_isolation"
  on "storage"."objects"
  as permissive
  for insert
  to authenticated
with check (((bucket_id = 'cms-uploads'::text) AND ((name ~~ (public.current_tenant_id() || '/%'::text)) OR public.is_platform_admin())));



