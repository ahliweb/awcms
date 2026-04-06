drop trigger if exists "audit_account_requests" on "public"."account_requests";

drop trigger if exists "audit_log_changes_admin_menus" on "public"."admin_menus";

drop trigger if exists "handle_updated_at" on "public"."administrative_regions";

drop trigger if exists "analytics_events_rollup" on "public"."analytics_events";

drop trigger if exists "lock_created_by_trg" on "public"."announcements";

drop trigger if exists "set_created_by_trg" on "public"."announcements";

drop trigger if exists "trg_set_tenant_id" on "public"."announcements";

drop trigger if exists "update_announcements_updated_at" on "public"."announcements";

drop trigger if exists "lock_created_by_trg" on "public"."auth_hibp_events";

drop trigger if exists "set_created_by_trg" on "public"."auth_hibp_events";

drop trigger if exists "lock_created_by_trg" on "public"."backup_logs";

drop trigger if exists "set_created_by_trg" on "public"."backup_logs";

drop trigger if exists "lock_created_by_trg" on "public"."backup_schedules";

drop trigger if exists "set_created_by_trg" on "public"."backup_schedules";

drop trigger if exists "lock_created_by_trg" on "public"."backups";

drop trigger if exists "set_created_by_trg" on "public"."backups";

drop trigger if exists "lock_created_by_trg" on "public"."blog_tags";

drop trigger if exists "set_created_by_trg" on "public"."blog_tags";

drop trigger if exists "lock_created_by_trg" on "public"."blogs";

drop trigger if exists "request_public_rebuild_on_blogs" on "public"."blogs";

drop trigger if exists "set_created_by_trg" on "public"."blogs";

drop trigger if exists "trg_articles_audit" on "public"."blogs";

drop trigger if exists "trg_set_tenant_id" on "public"."blogs";

drop trigger if exists "update_articles_updated_at" on "public"."blogs";

drop trigger if exists "lock_created_by_trg" on "public"."categories";

drop trigger if exists "set_created_by_trg" on "public"."categories";

drop trigger if exists "trg_set_tenant_id" on "public"."categories";

drop trigger if exists "lock_created_by_trg" on "public"."contact_messages";

drop trigger if exists "set_created_by_trg" on "public"."contact_messages";

drop trigger if exists "trg_set_tenant_id" on "public"."contact_messages";

drop trigger if exists "lock_created_by_trg" on "public"."contacts";

drop trigger if exists "set_created_by_trg" on "public"."contacts";

drop trigger if exists "trg_deployment_cells_updated_at" on "public"."deployment_cells";

drop trigger if exists "lock_created_by_trg" on "public"."extension_menu_items";

drop trigger if exists "set_created_by_trg" on "public"."extension_menu_items";

drop trigger if exists "set_extension_menu_items_tenant_id" on "public"."extension_menu_items";

drop trigger if exists "lock_created_by_trg" on "public"."extension_permissions";

drop trigger if exists "set_created_by_trg" on "public"."extension_permissions";

drop trigger if exists "set_extension_permissions_tenant_id" on "public"."extension_permissions";

drop trigger if exists "lock_created_by_trg" on "public"."extension_rbac_integration";

drop trigger if exists "set_created_by_trg" on "public"."extension_rbac_integration";

drop trigger if exists "set_extension_rbac_integration_tenant_id" on "public"."extension_rbac_integration";

drop trigger if exists "lock_created_by_trg" on "public"."extension_routes";

drop trigger if exists "set_created_by_trg" on "public"."extension_routes";

drop trigger if exists "trg_set_tenant_id" on "public"."extension_routes";

drop trigger if exists "update_extension_routes_updated_at" on "public"."extension_routes";

drop trigger if exists "lock_created_by_trg" on "public"."extension_routes_registry";

drop trigger if exists "set_created_by_trg" on "public"."extension_routes_registry";

drop trigger if exists "set_extension_routes_registry_tenant_id" on "public"."extension_routes_registry";

drop trigger if exists "extension_audit_trigger" on "public"."extensions";

drop trigger if exists "lock_created_by_trg" on "public"."extensions";

drop trigger if exists "set_created_by_trg" on "public"."extensions";

drop trigger if exists "trg_set_tenant_id" on "public"."extensions";

drop trigger if exists "update_extensions_updated_at" on "public"."extensions";

drop trigger if exists "lock_created_by_trg" on "public"."menu_permissions";

drop trigger if exists "set_created_by_trg" on "public"."menu_permissions";

drop trigger if exists "lock_created_by_trg" on "public"."menus";

drop trigger if exists "request_public_rebuild_on_menus" on "public"."menus";

drop trigger if exists "set_created_by_trg" on "public"."menus";

drop trigger if exists "trg_set_tenant_id" on "public"."menus";

drop trigger if exists "update_notifications_updated_at" on "public"."notifications";

drop trigger if exists "audit_orders" on "public"."orders";

drop trigger if exists "trg_set_tenant_id" on "public"."orders";

drop trigger if exists "lock_created_by_trg" on "public"."page_categories";

drop trigger if exists "set_created_by_trg" on "public"."page_categories";

drop trigger if exists "lock_created_by_trg" on "public"."pages";

drop trigger if exists "request_public_rebuild_on_pages" on "public"."pages";

drop trigger if exists "set_created_by_trg" on "public"."pages";

drop trigger if exists "trg_set_tenant_id" on "public"."pages";

drop trigger if exists "update_pages_updated_at" on "public"."pages";

drop trigger if exists "audit_log_changes_permissions" on "public"."permissions";

drop trigger if exists "lock_created_by_trg" on "public"."permissions";

drop trigger if exists "set_created_by_trg" on "public"."permissions";

drop trigger if exists "trg_platform_projects_updated_at" on "public"."platform_projects";

drop trigger if exists "trg_platform_settings_updated_at" on "public"."platform_settings";

drop trigger if exists "audit_log_changes_policies" on "public"."policies";

drop trigger if exists "lock_created_by_trg" on "public"."portfolio";

drop trigger if exists "set_created_by_trg" on "public"."portfolio";

drop trigger if exists "trg_set_tenant_id" on "public"."portfolio";

drop trigger if exists "update_portfolio_updated_at" on "public"."portfolio";

drop trigger if exists "lock_created_by_trg" on "public"."product_types";

drop trigger if exists "set_created_by_trg" on "public"."product_types";

drop trigger if exists "trg_set_tenant_id" on "public"."product_types";

drop trigger if exists "audit_products" on "public"."products";

drop trigger if exists "lock_created_by_trg" on "public"."products";

drop trigger if exists "set_created_by_trg" on "public"."products";

drop trigger if exists "trg_set_tenant_id" on "public"."products";

drop trigger if exists "update_products_updated_at" on "public"."products";

drop trigger if exists "lock_created_by_trg" on "public"."promotions";

drop trigger if exists "set_created_by_trg" on "public"."promotions";

drop trigger if exists "trg_set_tenant_id" on "public"."promotions";

drop trigger if exists "update_promotions_updated_at" on "public"."promotions";

drop trigger if exists "handle_updated_at" on "public"."regions";

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

drop trigger if exists "harden_platform_settings_trigger" on "public"."settings";

drop trigger if exists "lock_created_by_trg" on "public"."tags";

drop trigger if exists "set_created_by_trg" on "public"."tags";

drop trigger if exists "trg_set_tenant_id" on "public"."tags";

drop trigger if exists "update_template_assignments_updated_at" on "public"."template_assignments";

drop trigger if exists "update_template_parts_updated_at" on "public"."template_parts";

drop trigger if exists "update_template_strings_updated_at" on "public"."template_strings";

drop trigger if exists "audit_log_changes_templates" on "public"."templates";

drop trigger if exists "trg_set_tenant_id" on "public"."templates";

drop trigger if exists "update_templates_updated_at" on "public"."templates";

drop trigger if exists "trg_tenant_domains_updated_at" on "public"."tenant_domains";

drop trigger if exists "trg_tenant_migrations_updated_at" on "public"."tenant_migrations";

drop trigger if exists "audit_log_changes_tenants" on "public"."tenants";

drop trigger if exists "refresh_tenant_subtree" on "public"."tenants";

drop trigger if exists "set_tenant_hierarchy" on "public"."tenants";

drop trigger if exists "trg_tenants_control_updated_at" on "public"."tenants_control";

drop trigger if exists "lock_created_by_trg" on "public"."testimonies";

drop trigger if exists "set_created_by_trg" on "public"."testimonies";

drop trigger if exists "trg_set_tenant_id" on "public"."testimonies";

drop trigger if exists "update_testimonies_updated_at" on "public"."testimonies";

drop trigger if exists "trg_set_tenant_id" on "public"."themes";

drop trigger if exists "trigger_ensure_single_active_theme" on "public"."themes";

drop trigger if exists "set_created_by_trg" on "public"."user_profile_admin";

drop trigger if exists "update_user_profile_admin_updated_at" on "public"."user_profile_admin";

drop trigger if exists "set_created_by_trg" on "public"."user_profiles";

drop trigger if exists "trigger_user_profiles_rekey_admin" on "public"."user_profiles";

drop trigger if exists "update_user_profiles_updated_at" on "public"."user_profiles";

drop trigger if exists "audit_log_changes_users" on "public"."users";

drop trigger if exists "lock_created_by_trg" on "public"."users";

drop trigger if exists "set_created_by_trg" on "public"."users";

drop trigger if exists "tr_enforce_user_limit" on "public"."users";

drop trigger if exists "trigger_create_user_profile" on "public"."users";

drop trigger if exists "update_users_updated_at" on "public"."users";

drop trigger if exists "update_widgets_updated_at" on "public"."widgets";

drop policy "account_requests_delete_unified" on "public"."account_requests";

drop policy "account_requests_insert_unified" on "public"."account_requests";

drop policy "account_requests_select_unified" on "public"."account_requests";

drop policy "account_requests_update_unified" on "public"."account_requests";

drop policy "admin_menus_delete_unified" on "public"."admin_menus";

drop policy "admin_menus_insert_unified" on "public"."admin_menus";

drop policy "admin_menus_select_unified" on "public"."admin_menus";

drop policy "admin_menus_update_unified" on "public"."admin_menus";

drop policy "admin_regions_delete_admin" on "public"."administrative_regions";

drop policy "admin_regions_insert_admin" on "public"."administrative_regions";

drop policy "admin_regions_select_all" on "public"."administrative_regions";

drop policy "admin_regions_update_admin" on "public"."administrative_regions";

drop policy "Unified delete analytics daily" on "public"."analytics_daily";

drop policy "Unified insert analytics daily" on "public"."analytics_daily";

drop policy "Unified read analytics daily" on "public"."analytics_daily";

drop policy "Unified update analytics daily" on "public"."analytics_daily";

drop policy "analytics_events_admin_delete" on "public"."analytics_events";

drop policy "analytics_events_admin_manage" on "public"."analytics_events";

drop policy "analytics_events_admin_read" on "public"."analytics_events";

drop policy "analytics_events_public_insert" on "public"."analytics_events";

drop policy "announcements_delete_unified" on "public"."announcements";

drop policy "announcements_insert_unified" on "public"."announcements";

drop policy "announcements_select_unified" on "public"."announcements";

drop policy "announcements_update_unified" on "public"."announcements";

drop policy "audit_logs_insert_unified" on "public"."audit_logs";

drop policy "audit_logs_select_unified" on "public"."audit_logs";

drop policy "backup_logs_insert_tenant_scoped" on "public"."backup_logs";

drop policy "backups_delete_unified" on "public"."backups";

drop policy "backups_insert_unified" on "public"."backups";

drop policy "backups_select_unified" on "public"."backups";

drop policy "backups_update_unified" on "public"."backups";

drop policy "blog_tags_delete_hierarchy" on "public"."blog_tags";

drop policy "blog_tags_insert_hierarchy" on "public"."blog_tags";

drop policy "blog_tags_select_hierarchy" on "public"."blog_tags";

drop policy "blog_tags_update_hierarchy" on "public"."blog_tags";

drop policy "blogs_delete" on "public"."blogs";

drop policy "blogs_insert" on "public"."blogs";

drop policy "blogs_select" on "public"."blogs";

drop policy "blogs_update" on "public"."blogs";

drop policy "cart_items_delete_unified" on "public"."cart_items";

drop policy "cart_items_insert_unified" on "public"."cart_items";

drop policy "cart_items_select_unified" on "public"."cart_items";

drop policy "cart_items_update_unified" on "public"."cart_items";

drop policy "carts_select_policy" on "public"."carts";

drop policy "categories_delete_unified" on "public"."categories";

drop policy "categories_insert_unified" on "public"."categories";

drop policy "categories_update_unified" on "public"."categories";

drop policy "Platform admins delete editor configs" on "public"."component_registry";

drop policy "Platform admins insert editor configs" on "public"."component_registry";

drop policy "Platform admins update editor configs" on "public"."component_registry";

drop policy "Unified read editor configs" on "public"."component_registry";

drop policy "contact_messages_delete_admin" on "public"."contact_messages";

drop policy "contact_messages_modify_admin" on "public"."contact_messages";

drop policy "contact_messages_select_unified" on "public"."contact_messages";

drop policy "contacts_delete_unified" on "public"."contacts";

drop policy "contacts_insert_unified" on "public"."contacts";

drop policy "contacts_select_unified" on "public"."contacts";

drop policy "contacts_update_unified" on "public"."contacts";

drop policy "content_translations_delete_tenant" on "public"."content_translations";

drop policy "content_translations_insert_tenant" on "public"."content_translations";

drop policy "content_translations_read_all" on "public"."content_translations";

drop policy "content_translations_update_tenant" on "public"."content_translations";

drop policy "Platform admins manage deployment_cells" on "public"."deployment_cells";

drop policy "Tenant members can read their active cell" on "public"."deployment_cells";

drop policy "devices_delete_policy" on "public"."devices";

drop policy "devices_insert_policy" on "public"."devices";

drop policy "devices_select_policy" on "public"."devices";

drop policy "devices_update_policy" on "public"."devices";

drop policy "email_logs_insert_unified" on "public"."email_logs";

drop policy "email_logs_select_unified" on "public"."email_logs";

drop policy "events_delete" on "public"."events";

drop policy "events_insert" on "public"."events";

drop policy "events_select" on "public"."events";

drop policy "events_update" on "public"."events";

drop policy "extension_lifecycle_audit_insert" on "public"."extension_lifecycle_audit";

drop policy "extension_lifecycle_audit_select" on "public"."extension_lifecycle_audit";

drop policy "extension_lifecycle_audit_update" on "public"."extension_lifecycle_audit";

drop policy "Authenticated Insert" on "public"."extension_logs";

drop policy "Platform Admin Delete Only" on "public"."extension_logs";

drop policy "Tenant Read Own Logs" on "public"."extension_logs";

drop policy "extension_menu_items_delete_hierarchy" on "public"."extension_menu_items";

drop policy "extension_menu_items_insert_hierarchy" on "public"."extension_menu_items";

drop policy "extension_menu_items_select_hierarchy" on "public"."extension_menu_items";

drop policy "extension_menu_items_update_hierarchy" on "public"."extension_menu_items";

drop policy "Unified delete extension permissions" on "public"."extension_permissions";

drop policy "Unified insert extension permissions" on "public"."extension_permissions";

drop policy "Unified select extension permissions" on "public"."extension_permissions";

drop policy "Unified update extension permissions" on "public"."extension_permissions";

drop policy "Unified delete extension rbac" on "public"."extension_rbac_integration";

drop policy "Unified insert extension rbac" on "public"."extension_rbac_integration";

drop policy "Unified select extension rbac" on "public"."extension_rbac_integration";

drop policy "Unified update extension rbac" on "public"."extension_rbac_integration";

drop policy "extension_routes_delete_unified" on "public"."extension_routes";

drop policy "extension_routes_insert_unified" on "public"."extension_routes";

drop policy "extension_routes_select_unified" on "public"."extension_routes";

drop policy "extension_routes_update_unified" on "public"."extension_routes";

drop policy "Unified select extension routes" on "public"."extension_routes_registry";

drop policy "extension_routes_registry_delete_hierarchy" on "public"."extension_routes_registry";

drop policy "extension_routes_registry_insert_hierarchy" on "public"."extension_routes_registry";

drop policy "extension_routes_registry_update_hierarchy" on "public"."extension_routes_registry";

drop policy "extensions_delete_hierarchy" on "public"."extensions";

drop policy "extensions_insert_hierarchy" on "public"."extensions";

drop policy "extensions_select_hierarchy" on "public"."extensions";

drop policy "extensions_update_hierarchy" on "public"."extensions";

drop policy "Tenant Delete Funfacts" on "public"."funfacts";

drop policy "Tenant Insert Funfacts" on "public"."funfacts";

drop policy "Tenant Update Funfacts" on "public"."funfacts";

drop policy "funfacts_select_unified" on "public"."funfacts";

drop policy "media_access_audit_insert_auth" on "public"."media_access_audit";

drop policy "media_access_audit_select_auth" on "public"."media_access_audit";

drop policy "media_objects_insert_auth" on "public"."media_objects";

drop policy "media_objects_select_unified" on "public"."media_objects";

drop policy "media_objects_update_auth" on "public"."media_objects";

drop policy "media_upload_sessions_insert_auth" on "public"."media_upload_sessions";

drop policy "media_upload_sessions_select_auth" on "public"."media_upload_sessions";

drop policy "media_upload_sessions_update_auth" on "public"."media_upload_sessions";

drop policy "media_variants_insert_auth" on "public"."media_variants";

drop policy "media_variants_select_unified" on "public"."media_variants";

drop policy "menus_delete_hierarchy" on "public"."menus";

drop policy "menus_insert_hierarchy" on "public"."menus";

drop policy "menus_select_hierarchy" on "public"."menus";

drop policy "menus_update_hierarchy" on "public"."menus";

drop policy "mobile_app_config_access" on "public"."mobile_app_config";

drop policy "mobile_users_access" on "public"."mobile_users";

drop policy "modules_read_policy" on "public"."modules";

drop policy "modules_update_policy" on "public"."modules";

drop policy "nd_select" on "public"."notification_dispatches";

drop policy "notification_readers_select_policy" on "public"."notification_readers";

drop policy "nt_insert" on "public"."notification_templates";

drop policy "nt_select" on "public"."notification_templates";

drop policy "nt_soft_delete" on "public"."notification_templates";

drop policy "nt_update" on "public"."notification_templates";

drop policy "notifications_delete_unified" on "public"."notifications";

drop policy "notifications_insert_unified" on "public"."notifications";

drop policy "notifications_select_unified" on "public"."notifications";

drop policy "notifications_update_unified" on "public"."notifications";

drop policy "order_items_delete_unified" on "public"."order_items";

drop policy "order_items_insert_unified" on "public"."order_items";

drop policy "order_items_select_unified" on "public"."order_items";

drop policy "order_items_update_unified" on "public"."order_items";

drop policy "Enable insert for anonymous users" on "public"."orders";

drop policy "orders_select_auth" on "public"."orders";

drop policy "page_categories_delete_hierarchy" on "public"."page_categories";

drop policy "page_categories_insert_hierarchy" on "public"."page_categories";

drop policy "page_categories_select_hierarchy" on "public"."page_categories";

drop policy "page_categories_update_hierarchy" on "public"."page_categories";

drop policy "page_files_delete_tenant" on "public"."page_files";

drop policy "page_files_insert_tenant" on "public"."page_files";

drop policy "page_files_read_all" on "public"."page_files";

drop policy "page_files_update_tenant" on "public"."page_files";

drop policy "pages_delete_hierarchy" on "public"."pages";

drop policy "pages_insert_hierarchy" on "public"."pages";

drop policy "pages_select_hierarchy" on "public"."pages";

drop policy "pages_update_hierarchy" on "public"."pages";

drop policy "Tenant Delete Partners" on "public"."partners";

drop policy "Tenant Insert Partners" on "public"."partners";

drop policy "Tenant Update Partners" on "public"."partners";

drop policy "partners_select_unified" on "public"."partners";

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

drop policy "platform_extension_catalog_delete" on "public"."platform_extension_catalog";

drop policy "platform_extension_catalog_insert" on "public"."platform_extension_catalog";

drop policy "platform_extension_catalog_select" on "public"."platform_extension_catalog";

drop policy "platform_extension_catalog_update" on "public"."platform_extension_catalog";

drop policy "Authenticated users can read their platform_project" on "public"."platform_projects";

drop policy "Platform admins manage platform_projects" on "public"."platform_projects";

drop policy "Platform admins can manage platform_settings" on "public"."platform_settings";

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

drop policy "queue_dead_letters_platform_admin_select" on "public"."queue_dead_letters";

drop policy "regions_delete_admin" on "public"."regions";

drop policy "regions_insert_admin" on "public"."regions";

drop policy "regions_select_all" on "public"."regions";

drop policy "regions_update_admin" on "public"."regions";

drop policy "Platform admins delete resources" on "public"."resources_registry";

drop policy "Platform admins insert resources" on "public"."resources_registry";

drop policy "Platform admins update resources" on "public"."resources_registry";

drop policy "Unified read resources" on "public"."resources_registry";

drop policy "reusable_section_action_requests_insert" on "public"."reusable_section_action_requests";

drop policy "reusable_section_action_requests_select" on "public"."reusable_section_action_requests";

drop policy "reusable_section_action_requests_update" on "public"."reusable_section_action_requests";

drop policy "reusable_section_detach_events_delete" on "public"."reusable_section_detach_events";

drop policy "reusable_section_detach_events_insert" on "public"."reusable_section_detach_events";

drop policy "reusable_section_detach_events_select" on "public"."reusable_section_detach_events";

drop policy "reusable_section_detach_events_update" on "public"."reusable_section_detach_events";

drop policy "reusable_section_revisions_insert" on "public"."reusable_section_revisions";

drop policy "reusable_section_revisions_select" on "public"."reusable_section_revisions";

drop policy "reusable_section_usages_delete" on "public"."reusable_section_usages";

drop policy "reusable_section_usages_insert" on "public"."reusable_section_usages";

drop policy "reusable_section_usages_select" on "public"."reusable_section_usages";

drop policy "reusable_section_usages_update" on "public"."reusable_section_usages";

drop policy "reusable_sections_insert" on "public"."reusable_sections";

drop policy "reusable_sections_select" on "public"."reusable_sections";

drop policy "reusable_sections_update" on "public"."reusable_sections";

drop policy "role_permissions_insert_policy" on "public"."role_permissions";

drop policy "role_permissions_select_hierarchy" on "public"."role_permissions";

drop policy "role_permissions_update_hierarchy" on "public"."role_permissions";

drop policy "role_policies_select_hierarchy" on "public"."role_policies";

drop policy "role_policies_update_hierarchy" on "public"."role_policies";

drop policy "roles_select_hierarchy" on "public"."roles";

drop policy "roles_update_hierarchy" on "public"."roles";

drop policy "sensor_readings_access" on "public"."sensor_readings";

drop policy "seo_metadata_select_public" on "public"."seo_metadata";

drop policy "services_delete_hierarchy" on "public"."services";

drop policy "services_insert_hierarchy" on "public"."services";

drop policy "services_select_unified" on "public"."services";

drop policy "services_update_hierarchy" on "public"."services";

drop policy "settings_delete_hierarchy" on "public"."settings";

drop policy "settings_insert_hierarchy" on "public"."settings";

drop policy "settings_select_hierarchy" on "public"."settings";

drop policy "settings_update_hierarchy" on "public"."settings";

drop policy "site_blueprints_insert" on "public"."site_blueprints";

drop policy "site_blueprints_select" on "public"."site_blueprints";

drop policy "site_blueprints_update" on "public"."site_blueprints";

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

drop policy "Tenant Delete Teams" on "public"."teams";

drop policy "Tenant Insert Teams" on "public"."teams";

drop policy "Tenant Update Teams" on "public"."teams";

drop policy "teams_select_unified" on "public"."teams";

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

drop policy "template_strings_select_unified" on "public"."template_strings";

drop policy "template_strings_update_unified" on "public"."template_strings";

drop policy "templates_delete_hierarchy" on "public"."templates";

drop policy "templates_insert_hierarchy" on "public"."templates";

drop policy "templates_select_hierarchy" on "public"."templates";

drop policy "templates_update_hierarchy" on "public"."templates";

drop policy "tenant_channels_delete" on "public"."tenant_channels";

drop policy "tenant_channels_insert" on "public"."tenant_channels";

drop policy "tenant_channels_update" on "public"."tenant_channels";

drop policy "Platform admins manage tenant_domains" on "public"."tenant_domains";

drop policy "Tenant domain managers can update own domains" on "public"."tenant_domains";

drop policy "Tenant members can read own tenant_domains" on "public"."tenant_domains";

drop policy "tenant_extensions_delete" on "public"."tenant_extensions";

drop policy "tenant_extensions_insert" on "public"."tenant_extensions";

drop policy "tenant_extensions_select" on "public"."tenant_extensions";

drop policy "tenant_extensions_update" on "public"."tenant_extensions";

drop policy "Platform admins manage tenant_migrations" on "public"."tenant_migrations";

drop policy "Tenant members can read own tenant_migrations" on "public"."tenant_migrations";

drop policy "tnc_insert" on "public"."tenant_notification_channels";

drop policy "tnc_select" on "public"."tenant_notification_channels";

drop policy "tnc_update" on "public"."tenant_notification_channels";

drop policy "tenant_resource_rules_delete" on "public"."tenant_resource_rules";

drop policy "tenant_resource_rules_insert" on "public"."tenant_resource_rules";

drop policy "tenant_resource_rules_select" on "public"."tenant_resource_rules";

drop policy "tenant_resource_rules_update" on "public"."tenant_resource_rules";

drop policy "tenant_role_links_delete" on "public"."tenant_role_links";

drop policy "tenant_role_links_insert" on "public"."tenant_role_links";

drop policy "tenant_role_links_select" on "public"."tenant_role_links";

drop policy "tenant_role_links_update" on "public"."tenant_role_links";

drop policy "Platform admins manage tenant_service_contracts" on "public"."tenant_service_contracts";

drop policy "Tenant members can read own service_contracts" on "public"."tenant_service_contracts";

drop policy "tenant_site_blueprint_state_insert" on "public"."tenant_site_blueprint_state";

drop policy "tenant_site_blueprint_state_select" on "public"."tenant_site_blueprint_state";

drop policy "tenant_site_blueprint_state_update" on "public"."tenant_site_blueprint_state";

drop policy "tenants_delete_unified" on "public"."tenants";

drop policy "tenants_insert_unified" on "public"."tenants";

drop policy "tenants_select_unified" on "public"."tenants";

drop policy "tenants_update_unified" on "public"."tenants";

drop policy "Platform admins manage tenants_control" on "public"."tenants_control";

drop policy "Tenant members can read their own tenants_control row" on "public"."tenants_control";

drop policy "testimonies_delete_hierarchy" on "public"."testimonies";

drop policy "testimonies_insert_hierarchy" on "public"."testimonies";

drop policy "testimonies_select_hierarchy" on "public"."testimonies";

drop policy "testimonies_update_hierarchy" on "public"."testimonies";

drop policy "themes_delete_hierarchy" on "public"."themes";

drop policy "themes_insert_hierarchy" on "public"."themes";

drop policy "themes_select_hierarchy" on "public"."themes";

drop policy "themes_update_hierarchy" on "public"."themes";

drop policy "Platform admins delete schemas" on "public"."ui_configs";

drop policy "Platform admins insert schemas" on "public"."ui_configs";

drop policy "Platform admins update schemas" on "public"."ui_configs";

drop policy "Unified read schemas" on "public"."ui_configs";

drop policy "user_profile_admin_insert_admin" on "public"."user_profile_admin";

drop policy "user_profile_admin_select_admin" on "public"."user_profile_admin";

drop policy "user_profile_admin_update_admin" on "public"."user_profile_admin";

drop policy "user_profiles_insert_self_or_admin" on "public"."user_profiles";

drop policy "user_profiles_select_self_or_admin" on "public"."user_profiles";

drop policy "user_profiles_update_self_or_admin" on "public"."user_profiles";

drop policy "users_select_hierarchy" on "public"."users";

drop policy "users_update_hierarchy" on "public"."users";

drop policy "widgets_delete_hierarchy" on "public"."widgets";

drop policy "widgets_insert_hierarchy" on "public"."widgets";

drop policy "widgets_select_hierarchy" on "public"."widgets";

drop policy "widgets_update_hierarchy" on "public"."widgets";

alter table "public"."account_requests" drop constraint "account_requests_admin_approved_by_fkey";

alter table "public"."account_requests" drop constraint "account_requests_super_admin_approved_by_fkey";

alter table "public"."account_requests" drop constraint "account_requests_tenant_id_fkey";

alter table "public"."admin_menus" drop constraint "admin_menus_resource_id_fkey";

alter table "public"."admin_menus" drop constraint "admin_menus_tenant_id_fkey";

alter table "public"."administrative_regions" drop constraint "administrative_regions_parent_id_fkey";

alter table "public"."analytics_daily" drop constraint "analytics_daily_tenant_id_fkey";

alter table "public"."analytics_events" drop constraint "analytics_events_tenant_id_fkey";

alter table "public"."analytics_events" drop constraint "analytics_events_user_id_fkey";

alter table "public"."announcements" drop constraint "announcements_category_id_fkey";

alter table "public"."announcements" drop constraint "announcements_created_by_fkey";

alter table "public"."announcements" drop constraint "announcements_tenant_id_fkey";

alter table "public"."audit_logs" drop constraint "audit_logs_tenant_id_fkey";

alter table "public"."audit_logs" drop constraint "audit_logs_user_id_fkey";

alter table "public"."backup_logs" drop constraint "backup_logs_backup_id_fkey";

alter table "public"."backup_logs" drop constraint "backup_logs_tenant_id_fkey";

alter table "public"."backup_schedules" drop constraint "backup_schedules_created_by_fkey";

alter table "public"."backup_schedules" drop constraint "backup_schedules_tenant_id_fkey";

alter table "public"."backups" drop constraint "backups_created_by_fkey";

alter table "public"."backups" drop constraint "backups_tenant_id_fkey";

alter table "public"."blog_tags" drop constraint "article_tags_article_id_fkey";

alter table "public"."blog_tags" drop constraint "article_tags_tag_id_fkey";

alter table "public"."blog_tags" drop constraint "article_tags_tenant_id_fkey";

alter table "public"."blogs" drop constraint "articles_author_id_fkey";

alter table "public"."blogs" drop constraint "articles_category_id_fkey";

alter table "public"."blogs" drop constraint "articles_created_by_fkey";

alter table "public"."blogs" drop constraint "articles_current_assignee_id_fkey";

alter table "public"."blogs" drop constraint "articles_region_id_fkey";

alter table "public"."blogs" drop constraint "articles_tenant_id_fkey";

alter table "public"."cart_items" drop constraint "cart_items_cart_id_fkey";

alter table "public"."cart_items" drop constraint "cart_items_product_id_fkey";

alter table "public"."cart_items" drop constraint "cart_items_tenant_id_fkey";

alter table "public"."carts" drop constraint "carts_tenant_id_fkey";

alter table "public"."carts" drop constraint "carts_user_id_fkey";

alter table "public"."categories" drop constraint "categories_created_by_fkey";

alter table "public"."categories" drop constraint "categories_tenant_id_fkey";

alter table "public"."component_registry" drop constraint "editor_configurations_resource_key_fkey";

alter table "public"."component_registry" drop constraint "editor_configurations_tenant_id_fkey";

alter table "public"."contact_messages" drop constraint "contact_messages_created_by_fkey";

alter table "public"."contact_messages" drop constraint "contact_messages_tenant_id_fkey";

alter table "public"."contacts" drop constraint "contacts_category_id_fkey";

alter table "public"."contacts" drop constraint "contacts_created_by_fkey";

alter table "public"."contacts" drop constraint "contacts_tenant_id_fkey";

alter table "public"."content_translations" drop constraint "content_translations_tenant_id_fkey";

alter table "public"."deployment_cells" drop constraint "deployment_cells_project_id_fkey";

alter table "public"."devices" drop constraint "devices_tenant_id_fkey";

alter table "public"."email_logs" drop constraint "email_logs_tenant_id_fkey";

alter table "public"."email_logs" drop constraint "email_logs_user_id_fkey";

alter table "public"."events" drop constraint "events_tenant_id_fkey";

alter table "public"."extension_lifecycle_audit" drop constraint "extension_lifecycle_audit_catalog_id_fkey";

alter table "public"."extension_lifecycle_audit" drop constraint "extension_lifecycle_audit_tenant_extension_id_fkey";

alter table "public"."extension_lifecycle_audit" drop constraint "extension_lifecycle_audit_tenant_id_fkey";

alter table "public"."extension_logs" drop constraint "extension_logs_extension_id_fkey";

alter table "public"."extension_logs" drop constraint "extension_logs_tenant_id_fkey";

alter table "public"."extension_menu_items" drop constraint "extension_menu_items_extension_id_fkey";

alter table "public"."extension_menu_items" drop constraint "extension_menu_items_tenant_id_fkey";

alter table "public"."extension_permissions" drop constraint "extension_permissions_extension_id_fkey";

alter table "public"."extension_permissions" drop constraint "extension_permissions_tenant_id_fkey";

alter table "public"."extension_rbac_integration" drop constraint "extension_rbac_integration_extension_id_fkey";

alter table "public"."extension_rbac_integration" drop constraint "extension_rbac_integration_permission_id_fkey";

alter table "public"."extension_rbac_integration" drop constraint "extension_rbac_integration_role_id_fkey";

alter table "public"."extension_rbac_integration" drop constraint "extension_rbac_integration_tenant_id_fkey";

alter table "public"."extension_routes" drop constraint "extension_routes_extension_id_fkey";

alter table "public"."extension_routes" drop constraint "extension_routes_tenant_id_fkey";

alter table "public"."extension_routes_registry" drop constraint "extension_routes_registry_extension_id_fkey";

alter table "public"."extension_routes_registry" drop constraint "extension_routes_registry_tenant_id_fkey";

alter table "public"."extensions" drop constraint "extensions_created_by_fkey";

alter table "public"."extensions" drop constraint "extensions_tenant_id_fkey";

alter table "public"."funfacts" drop constraint "funfacts_tenant_id_fkey";

alter table "public"."media_access_audit" drop constraint "media_access_audit_media_object_id_fkey";

alter table "public"."media_access_audit" drop constraint "media_access_audit_tenant_id_fkey";

alter table "public"."media_objects" drop constraint "media_objects_category_id_fkey";

alter table "public"."media_objects" drop constraint "media_objects_tenant_id_fkey";

alter table "public"."media_objects" drop constraint "media_objects_uploader_id_fkey";

alter table "public"."media_upload_sessions" drop constraint "media_upload_sessions_category_id_fkey";

alter table "public"."media_upload_sessions" drop constraint "media_upload_sessions_tenant_id_fkey";

alter table "public"."media_upload_sessions" drop constraint "media_upload_sessions_uploader_id_fkey";

alter table "public"."media_variants" drop constraint "media_variants_media_object_id_fkey";

alter table "public"."menu_permissions" drop constraint "menu_permissions_menu_id_fkey";

alter table "public"."menu_permissions" drop constraint "menu_permissions_role_id_fkey";

alter table "public"."menu_permissions" drop constraint "menu_permissions_tenant_id_fkey";

alter table "public"."menus" drop constraint "menus_created_by_fkey";

alter table "public"."menus" drop constraint "menus_page_id_fkey";

alter table "public"."menus" drop constraint "menus_parent_id_fkey";

alter table "public"."menus" drop constraint "menus_role_id_fkey";

alter table "public"."menus" drop constraint "menus_tenant_id_fkey";

alter table "public"."mobile_app_config" drop constraint "mobile_app_config_tenant_id_fkey";

alter table "public"."mobile_users" drop constraint "mobile_users_tenant_id_fkey";

alter table "public"."modules" drop constraint "modules_tenant_id_fkey";

alter table "public"."notification_dispatches" drop constraint "notification_dispatches_channel_id_fkey";

alter table "public"."notification_dispatches" drop constraint "notification_dispatches_tenant_id_fkey";

alter table "public"."notification_readers" drop constraint "notification_readers_notification_id_fkey";

alter table "public"."notification_readers" drop constraint "notification_readers_user_id_fkey";

alter table "public"."notification_templates" drop constraint "notification_templates_tenant_id_fkey";

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

alter table "public"."page_files" drop constraint "page_files_page_id_fkey";

alter table "public"."page_files" drop constraint "page_files_tenant_id_fkey";

alter table "public"."pages" drop constraint "pages_category_id_fkey";

alter table "public"."pages" drop constraint "pages_created_by_fkey";

alter table "public"."pages" drop constraint "pages_current_assignee_id_fkey";

alter table "public"."pages" drop constraint "pages_parent_id_fkey";

alter table "public"."pages" drop constraint "pages_tenant_id_fkey";

alter table "public"."partners" drop constraint "partners_tenant_id_fkey";

alter table "public"."payment_methods" drop constraint "payment_methods_tenant_id_fkey";

alter table "public"."payments" drop constraint "payments_order_id_fkey";

alter table "public"."payments" drop constraint "payments_payment_method_id_fkey";

alter table "public"."payments" drop constraint "payments_tenant_id_fkey";

alter table "public"."permissions" drop constraint "permissions_created_by_fkey";

alter table "public"."policies" drop constraint "policies_tenant_id_fkey";

alter table "public"."portfolio" drop constraint "portfolio_category_id_fkey";

alter table "public"."portfolio" drop constraint "portfolio_created_by_fkey";

alter table "public"."portfolio" drop constraint "portfolio_tenant_id_fkey";

alter table "public"."product_types" drop constraint "product_types_created_by_fkey";

alter table "public"."product_types" drop constraint "product_types_tenant_id_fkey";

alter table "public"."products" drop constraint "products_category_id_fkey";

alter table "public"."products" drop constraint "products_created_by_fkey";

alter table "public"."products" drop constraint "products_product_type_id_fkey";

alter table "public"."products" drop constraint "products_tenant_id_fkey";

alter table "public"."promotions" drop constraint "promotions_category_id_fkey";

alter table "public"."promotions" drop constraint "promotions_created_by_fkey";

alter table "public"."promotions" drop constraint "promotions_tenant_id_fkey";

alter table "public"."push_notifications" drop constraint "push_notifications_tenant_id_fkey";

alter table "public"."regions" drop constraint "regions_level_id_fkey";

alter table "public"."regions" drop constraint "regions_parent_id_fkey";

alter table "public"."regions" drop constraint "regions_tenant_id_fkey";

alter table "public"."reusable_section_action_requests" drop constraint "reusable_section_action_requests_reusable_section_id_fkey";

alter table "public"."reusable_section_action_requests" drop constraint "reusable_section_action_requests_tenant_id_fkey";

alter table "public"."reusable_section_detach_events" drop constraint "reusable_section_detach_events_reusable_section_id_fkey";

alter table "public"."reusable_section_detach_events" drop constraint "reusable_section_detach_events_tenant_id_fkey";

alter table "public"."reusable_section_revisions" drop constraint "reusable_section_revisions_reusable_section_id_fkey";

alter table "public"."reusable_section_revisions" drop constraint "reusable_section_revisions_tenant_id_fkey";

alter table "public"."reusable_section_usages" drop constraint "reusable_section_usages_reusable_section_id_fkey";

alter table "public"."reusable_section_usages" drop constraint "reusable_section_usages_tenant_id_fkey";

alter table "public"."reusable_sections" drop constraint "reusable_sections_owner_tenant_id_fkey";

alter table "public"."reusable_sections" drop constraint "reusable_sections_template_part_id_fkey";

alter table "public"."role_permissions" drop constraint "role_permissions_permission_id_fkey";

alter table "public"."role_permissions" drop constraint "role_permissions_role_id_fkey";

alter table "public"."role_permissions" drop constraint "role_permissions_tenant_id_fkey";

alter table "public"."role_policies" drop constraint "role_policies_policy_id_fkey";

alter table "public"."role_policies" drop constraint "role_policies_role_id_fkey";

alter table "public"."roles" drop constraint "roles_created_by_fkey";

alter table "public"."roles" drop constraint "roles_tenant_id_fkey";

alter table "public"."sensor_readings" drop constraint "sensor_readings_tenant_id_fkey";

alter table "public"."seo_metadata" drop constraint "seo_metadata_tenant_id_fkey";

alter table "public"."services" drop constraint "services_tenant_id_fkey";

alter table "public"."settings" drop constraint "settings_tenant_id_fkey";

alter table "public"."site_blueprints" drop constraint "site_blueprints_owner_tenant_id_fkey";

alter table "public"."site_blueprints" drop constraint "site_blueprints_source_blueprint_id_fkey";

alter table "public"."sso_audit_logs" drop constraint "sso_audit_logs_tenant_id_fkey";

alter table "public"."sso_audit_logs" drop constraint "sso_audit_logs_user_id_fkey";

alter table "public"."sso_providers" drop constraint "sso_providers_created_by_fkey";

alter table "public"."sso_providers" drop constraint "sso_providers_tenant_id_fkey";

alter table "public"."sso_role_mappings" drop constraint "sso_role_mappings_created_by_fkey";

alter table "public"."sso_role_mappings" drop constraint "sso_role_mappings_internal_role_id_fkey";

alter table "public"."tags" drop constraint "tags_created_by_fkey";

alter table "public"."tags" drop constraint "tags_tenant_id_fkey";

alter table "public"."teams" drop constraint "teams_tenant_id_fkey";

alter table "public"."template_assignments" drop constraint "template_assignments_template_id_fkey";

alter table "public"."template_assignments" drop constraint "template_assignments_tenant_id_fkey";

alter table "public"."template_parts" drop constraint "template_parts_tenant_id_fkey";

alter table "public"."templates" drop constraint "templates_tenant_id_fkey";

alter table "public"."tenant_channels" drop constraint "tenant_channels_tenant_id_fkey";

alter table "public"."tenant_domains" drop constraint "tenant_domains_cell_id_fkey";

alter table "public"."tenant_domains" drop constraint "tenant_domains_tenant_id_fkey";

alter table "public"."tenant_extensions" drop constraint "tenant_extensions_catalog_id_fkey";

alter table "public"."tenant_extensions" drop constraint "tenant_extensions_tenant_id_fkey";

alter table "public"."tenant_migrations" drop constraint "tenant_migrations_source_cell_id_fkey";

alter table "public"."tenant_migrations" drop constraint "tenant_migrations_target_cell_id_fkey";

alter table "public"."tenant_migrations" drop constraint "tenant_migrations_tenant_id_fkey";

alter table "public"."tenant_notification_channels" drop constraint "tenant_notification_channels_tenant_id_fkey";

alter table "public"."tenant_resource_rules" drop constraint "tenant_resource_rules_resource_key_fkey";

alter table "public"."tenant_resource_rules" drop constraint "tenant_resource_rules_tenant_id_fkey";

alter table "public"."tenant_role_links" drop constraint "tenant_role_links_child_role_id_fkey";

alter table "public"."tenant_role_links" drop constraint "tenant_role_links_parent_role_id_fkey";

alter table "public"."tenant_role_links" drop constraint "tenant_role_links_tenant_id_fkey";

alter table "public"."tenant_service_contracts" drop constraint "tenant_service_contracts_tenant_id_fkey";

alter table "public"."tenant_site_blueprint_state" drop constraint "tenant_site_blueprint_state_blueprint_id_fkey";

alter table "public"."tenant_site_blueprint_state" drop constraint "tenant_site_blueprint_state_tenant_id_fkey";

alter table "public"."tenants" drop constraint "tenants_parent_tenant_id_fkey";

alter table "public"."tenants_control" drop constraint "tenants_control_current_cell_id_fkey";

alter table "public"."tenants_control" drop constraint "tenants_control_primary_domain_fk";

alter table "public"."tenants_control" drop constraint "tenants_control_project_id_fkey";

alter table "public"."testimonies" drop constraint "testimonies_category_id_fkey";

alter table "public"."testimonies" drop constraint "testimonies_created_by_fkey";

alter table "public"."testimonies" drop constraint "testimonies_tenant_id_fkey";

alter table "public"."themes" drop constraint "themes_tenant_id_fkey";

alter table "public"."two_factor_audit_logs" drop constraint "two_factor_audit_logs_tenant_id_fkey";

alter table "public"."two_factor_audit_logs" drop constraint "two_factor_audit_logs_user_id_fkey";

alter table "public"."two_factor_auth" drop constraint "two_factor_auth_tenant_id_fkey";

alter table "public"."two_factor_auth" drop constraint "two_factor_auth_user_id_fkey";

alter table "public"."ui_configs" drop constraint "ui_schemas_resource_key_fkey";

alter table "public"."ui_configs" drop constraint "ui_schemas_tenant_id_fkey";

alter table "public"."user_profile_admin" drop constraint "user_profile_admin_created_by_fkey";

alter table "public"."user_profile_admin" drop constraint "user_profile_admin_tenant_id_fkey";

alter table "public"."user_profile_admin" drop constraint "user_profile_admin_user_id_fkey";

alter table "public"."user_profiles" drop constraint "user_profiles_created_by_fkey";

alter table "public"."user_profiles" drop constraint "user_profiles_tenant_id_fkey";

alter table "public"."user_profiles" drop constraint "user_profiles_user_id_fkey";

alter table "public"."users" drop constraint "users_admin_approved_by_fkey";

alter table "public"."users" drop constraint "users_administrative_region_id_fkey";

alter table "public"."users" drop constraint "users_created_by_fkey";

alter table "public"."users" drop constraint "users_region_id_fkey";

alter table "public"."users" drop constraint "users_role_id_fkey";

alter table "public"."users" drop constraint "users_super_admin_approved_by_fkey";

alter table "public"."users" drop constraint "users_tenant_id_fkey";

alter table "public"."widgets" drop constraint "widgets_area_id_fkey";

alter table "public"."widgets" drop constraint "widgets_tenant_id_fkey";

alter table "public"."auth_hibp_events" alter column "id" set default nextval('public.auth_hibp_events_id_seq'::regclass);

alter table "public"."deployment_cells" add column "coolify_mode" text not null;

alter table "public"."deployment_cells" add column "coolify_server_ref" text;

alter table "public"."templates" alter column "id" set default extensions.uuid_generate_v4();

alter table "public"."user_profile_admin" alter column "admin_salt" set default encode(extensions.gen_random_bytes(16), 'hex'::text);

alter table "public"."deployment_cells" add constraint "deployment_cells_coolify_mode_check" CHECK ((coolify_mode = ANY (ARRAY['self_hosted'::text, 'coolify_cloud'::text]))) not valid;

alter table "public"."deployment_cells" validate constraint "deployment_cells_coolify_mode_check";

alter table "public"."account_requests" add constraint "account_requests_admin_approved_by_fkey" FOREIGN KEY (admin_approved_by) REFERENCES public.users(id) not valid;

alter table "public"."account_requests" validate constraint "account_requests_admin_approved_by_fkey";

alter table "public"."account_requests" add constraint "account_requests_super_admin_approved_by_fkey" FOREIGN KEY (super_admin_approved_by) REFERENCES public.users(id) not valid;

alter table "public"."account_requests" validate constraint "account_requests_super_admin_approved_by_fkey";

alter table "public"."account_requests" add constraint "account_requests_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) not valid;

alter table "public"."account_requests" validate constraint "account_requests_tenant_id_fkey";

alter table "public"."admin_menus" add constraint "admin_menus_resource_id_fkey" FOREIGN KEY (resource_id) REFERENCES public.resources_registry(id) ON DELETE SET NULL not valid;

alter table "public"."admin_menus" validate constraint "admin_menus_resource_id_fkey";

alter table "public"."admin_menus" add constraint "admin_menus_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) not valid;

alter table "public"."admin_menus" validate constraint "admin_menus_tenant_id_fkey";

alter table "public"."administrative_regions" add constraint "administrative_regions_parent_id_fkey" FOREIGN KEY (parent_id) REFERENCES public.administrative_regions(id) ON DELETE SET NULL not valid;

alter table "public"."administrative_regions" validate constraint "administrative_regions_parent_id_fkey";

alter table "public"."analytics_daily" add constraint "analytics_daily_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE not valid;

alter table "public"."analytics_daily" validate constraint "analytics_daily_tenant_id_fkey";

alter table "public"."analytics_events" add constraint "analytics_events_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE not valid;

alter table "public"."analytics_events" validate constraint "analytics_events_tenant_id_fkey";

alter table "public"."analytics_events" add constraint "analytics_events_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL not valid;

alter table "public"."analytics_events" validate constraint "analytics_events_user_id_fkey";

alter table "public"."announcements" add constraint "announcements_category_id_fkey" FOREIGN KEY (category_id) REFERENCES public.categories(id) not valid;

alter table "public"."announcements" validate constraint "announcements_category_id_fkey";

alter table "public"."announcements" add constraint "announcements_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.users(id) not valid;

alter table "public"."announcements" validate constraint "announcements_created_by_fkey";

alter table "public"."announcements" add constraint "announcements_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) not valid;

alter table "public"."announcements" validate constraint "announcements_tenant_id_fkey";

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

alter table "public"."blogs" add constraint "articles_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) not valid;

alter table "public"."blogs" validate constraint "articles_tenant_id_fkey";

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

alter table "public"."component_registry" add constraint "editor_configurations_resource_key_fkey" FOREIGN KEY (resource_key) REFERENCES public.resources_registry(key) ON DELETE CASCADE not valid;

alter table "public"."component_registry" validate constraint "editor_configurations_resource_key_fkey";

alter table "public"."component_registry" add constraint "editor_configurations_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE not valid;

alter table "public"."component_registry" validate constraint "editor_configurations_tenant_id_fkey";

alter table "public"."contact_messages" add constraint "contact_messages_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.users(id) not valid;

alter table "public"."contact_messages" validate constraint "contact_messages_created_by_fkey";

alter table "public"."contact_messages" add constraint "contact_messages_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) not valid;

alter table "public"."contact_messages" validate constraint "contact_messages_tenant_id_fkey";

alter table "public"."contacts" add constraint "contacts_category_id_fkey" FOREIGN KEY (category_id) REFERENCES public.categories(id) ON DELETE SET NULL not valid;

alter table "public"."contacts" validate constraint "contacts_category_id_fkey";

alter table "public"."contacts" add constraint "contacts_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.users(id) not valid;

alter table "public"."contacts" validate constraint "contacts_created_by_fkey";

alter table "public"."contacts" add constraint "contacts_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) not valid;

alter table "public"."contacts" validate constraint "contacts_tenant_id_fkey";

alter table "public"."content_translations" add constraint "content_translations_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE not valid;

alter table "public"."content_translations" validate constraint "content_translations_tenant_id_fkey";

alter table "public"."deployment_cells" add constraint "deployment_cells_project_id_fkey" FOREIGN KEY (project_id) REFERENCES public.platform_projects(id) ON DELETE CASCADE not valid;

alter table "public"."deployment_cells" validate constraint "deployment_cells_project_id_fkey";

alter table "public"."devices" add constraint "devices_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE not valid;

alter table "public"."devices" validate constraint "devices_tenant_id_fkey";

alter table "public"."email_logs" add constraint "email_logs_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE not valid;

alter table "public"."email_logs" validate constraint "email_logs_tenant_id_fkey";

alter table "public"."email_logs" add constraint "email_logs_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL not valid;

alter table "public"."email_logs" validate constraint "email_logs_user_id_fkey";

alter table "public"."events" add constraint "events_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE not valid;

alter table "public"."events" validate constraint "events_tenant_id_fkey";

alter table "public"."extension_lifecycle_audit" add constraint "extension_lifecycle_audit_catalog_id_fkey" FOREIGN KEY (catalog_id) REFERENCES public.platform_extension_catalog(id) ON DELETE SET NULL not valid;

alter table "public"."extension_lifecycle_audit" validate constraint "extension_lifecycle_audit_catalog_id_fkey";

alter table "public"."extension_lifecycle_audit" add constraint "extension_lifecycle_audit_tenant_extension_id_fkey" FOREIGN KEY (tenant_extension_id) REFERENCES public.tenant_extensions(id) ON DELETE SET NULL not valid;

alter table "public"."extension_lifecycle_audit" validate constraint "extension_lifecycle_audit_tenant_extension_id_fkey";

alter table "public"."extension_lifecycle_audit" add constraint "extension_lifecycle_audit_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE not valid;

alter table "public"."extension_lifecycle_audit" validate constraint "extension_lifecycle_audit_tenant_id_fkey";

alter table "public"."extension_logs" add constraint "extension_logs_extension_id_fkey" FOREIGN KEY (extension_id) REFERENCES public.extensions(id) ON DELETE SET NULL not valid;

alter table "public"."extension_logs" validate constraint "extension_logs_extension_id_fkey";

alter table "public"."extension_logs" add constraint "extension_logs_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) not valid;

alter table "public"."extension_logs" validate constraint "extension_logs_tenant_id_fkey";

alter table "public"."extension_menu_items" add constraint "extension_menu_items_extension_id_fkey" FOREIGN KEY (extension_id) REFERENCES public.extensions(id) ON DELETE CASCADE not valid;

alter table "public"."extension_menu_items" validate constraint "extension_menu_items_extension_id_fkey";

alter table "public"."extension_menu_items" add constraint "extension_menu_items_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE not valid;

alter table "public"."extension_menu_items" validate constraint "extension_menu_items_tenant_id_fkey";

alter table "public"."extension_permissions" add constraint "extension_permissions_extension_id_fkey" FOREIGN KEY (extension_id) REFERENCES public.extensions(id) ON DELETE CASCADE not valid;

alter table "public"."extension_permissions" validate constraint "extension_permissions_extension_id_fkey";

alter table "public"."extension_permissions" add constraint "extension_permissions_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE not valid;

alter table "public"."extension_permissions" validate constraint "extension_permissions_tenant_id_fkey";

alter table "public"."extension_rbac_integration" add constraint "extension_rbac_integration_extension_id_fkey" FOREIGN KEY (extension_id) REFERENCES public.extensions(id) ON DELETE CASCADE not valid;

alter table "public"."extension_rbac_integration" validate constraint "extension_rbac_integration_extension_id_fkey";

alter table "public"."extension_rbac_integration" add constraint "extension_rbac_integration_permission_id_fkey" FOREIGN KEY (permission_id) REFERENCES public.permissions(id) ON DELETE CASCADE not valid;

alter table "public"."extension_rbac_integration" validate constraint "extension_rbac_integration_permission_id_fkey";

alter table "public"."extension_rbac_integration" add constraint "extension_rbac_integration_role_id_fkey" FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE CASCADE not valid;

alter table "public"."extension_rbac_integration" validate constraint "extension_rbac_integration_role_id_fkey";

alter table "public"."extension_rbac_integration" add constraint "extension_rbac_integration_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE not valid;

alter table "public"."extension_rbac_integration" validate constraint "extension_rbac_integration_tenant_id_fkey";

alter table "public"."extension_routes" add constraint "extension_routes_extension_id_fkey" FOREIGN KEY (extension_id) REFERENCES public.extensions(id) ON DELETE CASCADE not valid;

alter table "public"."extension_routes" validate constraint "extension_routes_extension_id_fkey";

alter table "public"."extension_routes" add constraint "extension_routes_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) not valid;

alter table "public"."extension_routes" validate constraint "extension_routes_tenant_id_fkey";

alter table "public"."extension_routes_registry" add constraint "extension_routes_registry_extension_id_fkey" FOREIGN KEY (extension_id) REFERENCES public.extensions(id) ON DELETE CASCADE not valid;

alter table "public"."extension_routes_registry" validate constraint "extension_routes_registry_extension_id_fkey";

alter table "public"."extension_routes_registry" add constraint "extension_routes_registry_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE not valid;

alter table "public"."extension_routes_registry" validate constraint "extension_routes_registry_tenant_id_fkey";

alter table "public"."extensions" add constraint "extensions_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.users(id) not valid;

alter table "public"."extensions" validate constraint "extensions_created_by_fkey";

alter table "public"."extensions" add constraint "extensions_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) not valid;

alter table "public"."extensions" validate constraint "extensions_tenant_id_fkey";

alter table "public"."funfacts" add constraint "funfacts_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) not valid;

alter table "public"."funfacts" validate constraint "funfacts_tenant_id_fkey";

alter table "public"."media_access_audit" add constraint "media_access_audit_media_object_id_fkey" FOREIGN KEY (media_object_id) REFERENCES public.media_objects(id) ON DELETE CASCADE not valid;

alter table "public"."media_access_audit" validate constraint "media_access_audit_media_object_id_fkey";

alter table "public"."media_access_audit" add constraint "media_access_audit_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE not valid;

alter table "public"."media_access_audit" validate constraint "media_access_audit_tenant_id_fkey";

alter table "public"."media_objects" add constraint "media_objects_category_id_fkey" FOREIGN KEY (category_id) REFERENCES public.categories(id) ON DELETE SET NULL not valid;

alter table "public"."media_objects" validate constraint "media_objects_category_id_fkey";

alter table "public"."media_objects" add constraint "media_objects_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE not valid;

alter table "public"."media_objects" validate constraint "media_objects_tenant_id_fkey";

alter table "public"."media_objects" add constraint "media_objects_uploader_id_fkey" FOREIGN KEY (uploader_id) REFERENCES public.users(id) ON DELETE SET NULL not valid;

alter table "public"."media_objects" validate constraint "media_objects_uploader_id_fkey";

alter table "public"."media_upload_sessions" add constraint "media_upload_sessions_category_id_fkey" FOREIGN KEY (category_id) REFERENCES public.categories(id) ON DELETE SET NULL not valid;

alter table "public"."media_upload_sessions" validate constraint "media_upload_sessions_category_id_fkey";

alter table "public"."media_upload_sessions" add constraint "media_upload_sessions_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE not valid;

alter table "public"."media_upload_sessions" validate constraint "media_upload_sessions_tenant_id_fkey";

alter table "public"."media_upload_sessions" add constraint "media_upload_sessions_uploader_id_fkey" FOREIGN KEY (uploader_id) REFERENCES public.users(id) ON DELETE CASCADE not valid;

alter table "public"."media_upload_sessions" validate constraint "media_upload_sessions_uploader_id_fkey";

alter table "public"."media_variants" add constraint "media_variants_media_object_id_fkey" FOREIGN KEY (media_object_id) REFERENCES public.media_objects(id) ON DELETE CASCADE not valid;

alter table "public"."media_variants" validate constraint "media_variants_media_object_id_fkey";

alter table "public"."menu_permissions" add constraint "menu_permissions_menu_id_fkey" FOREIGN KEY (menu_id) REFERENCES public.menus(id) ON DELETE CASCADE not valid;

alter table "public"."menu_permissions" validate constraint "menu_permissions_menu_id_fkey";

alter table "public"."menu_permissions" add constraint "menu_permissions_role_id_fkey" FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE CASCADE not valid;

alter table "public"."menu_permissions" validate constraint "menu_permissions_role_id_fkey";

alter table "public"."menu_permissions" add constraint "menu_permissions_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE not valid;

alter table "public"."menu_permissions" validate constraint "menu_permissions_tenant_id_fkey";

alter table "public"."menus" add constraint "menus_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.users(id) not valid;

alter table "public"."menus" validate constraint "menus_created_by_fkey";

alter table "public"."menus" add constraint "menus_page_id_fkey" FOREIGN KEY (page_id) REFERENCES public.pages(id) ON DELETE SET NULL not valid;

alter table "public"."menus" validate constraint "menus_page_id_fkey";

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

alter table "public"."modules" add constraint "modules_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE not valid;

alter table "public"."modules" validate constraint "modules_tenant_id_fkey";

alter table "public"."notification_dispatches" add constraint "notification_dispatches_channel_id_fkey" FOREIGN KEY (channel_id) REFERENCES public.tenant_notification_channels(id) not valid;

alter table "public"."notification_dispatches" validate constraint "notification_dispatches_channel_id_fkey";

alter table "public"."notification_dispatches" add constraint "notification_dispatches_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) not valid;

alter table "public"."notification_dispatches" validate constraint "notification_dispatches_tenant_id_fkey";

alter table "public"."notification_readers" add constraint "notification_readers_notification_id_fkey" FOREIGN KEY (notification_id) REFERENCES public.notifications(id) ON DELETE CASCADE not valid;

alter table "public"."notification_readers" validate constraint "notification_readers_notification_id_fkey";

alter table "public"."notification_readers" add constraint "notification_readers_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE not valid;

alter table "public"."notification_readers" validate constraint "notification_readers_user_id_fkey";

alter table "public"."notification_templates" add constraint "notification_templates_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) not valid;

alter table "public"."notification_templates" validate constraint "notification_templates_tenant_id_fkey";

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

alter table "public"."page_files" add constraint "page_files_page_id_fkey" FOREIGN KEY (page_id) REFERENCES public.pages(id) ON DELETE CASCADE not valid;

alter table "public"."page_files" validate constraint "page_files_page_id_fkey";

alter table "public"."page_files" add constraint "page_files_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE not valid;

alter table "public"."page_files" validate constraint "page_files_tenant_id_fkey";

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

alter table "public"."partners" add constraint "partners_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) not valid;

alter table "public"."partners" validate constraint "partners_tenant_id_fkey";

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

alter table "public"."policies" add constraint "policies_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) not valid;

alter table "public"."policies" validate constraint "policies_tenant_id_fkey";

alter table "public"."portfolio" add constraint "portfolio_category_id_fkey" FOREIGN KEY (category_id) REFERENCES public.categories(id) not valid;

alter table "public"."portfolio" validate constraint "portfolio_category_id_fkey";

alter table "public"."portfolio" add constraint "portfolio_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.users(id) not valid;

alter table "public"."portfolio" validate constraint "portfolio_created_by_fkey";

alter table "public"."portfolio" add constraint "portfolio_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) not valid;

alter table "public"."portfolio" validate constraint "portfolio_tenant_id_fkey";

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

alter table "public"."reusable_section_action_requests" add constraint "reusable_section_action_requests_reusable_section_id_fkey" FOREIGN KEY (reusable_section_id) REFERENCES public.reusable_sections(id) ON DELETE CASCADE not valid;

alter table "public"."reusable_section_action_requests" validate constraint "reusable_section_action_requests_reusable_section_id_fkey";

alter table "public"."reusable_section_action_requests" add constraint "reusable_section_action_requests_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE not valid;

alter table "public"."reusable_section_action_requests" validate constraint "reusable_section_action_requests_tenant_id_fkey";

alter table "public"."reusable_section_detach_events" add constraint "reusable_section_detach_events_reusable_section_id_fkey" FOREIGN KEY (reusable_section_id) REFERENCES public.reusable_sections(id) ON DELETE CASCADE not valid;

alter table "public"."reusable_section_detach_events" validate constraint "reusable_section_detach_events_reusable_section_id_fkey";

alter table "public"."reusable_section_detach_events" add constraint "reusable_section_detach_events_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE not valid;

alter table "public"."reusable_section_detach_events" validate constraint "reusable_section_detach_events_tenant_id_fkey";

alter table "public"."reusable_section_revisions" add constraint "reusable_section_revisions_reusable_section_id_fkey" FOREIGN KEY (reusable_section_id) REFERENCES public.reusable_sections(id) ON DELETE CASCADE not valid;

alter table "public"."reusable_section_revisions" validate constraint "reusable_section_revisions_reusable_section_id_fkey";

alter table "public"."reusable_section_revisions" add constraint "reusable_section_revisions_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE not valid;

alter table "public"."reusable_section_revisions" validate constraint "reusable_section_revisions_tenant_id_fkey";

alter table "public"."reusable_section_usages" add constraint "reusable_section_usages_reusable_section_id_fkey" FOREIGN KEY (reusable_section_id) REFERENCES public.reusable_sections(id) ON DELETE CASCADE not valid;

alter table "public"."reusable_section_usages" validate constraint "reusable_section_usages_reusable_section_id_fkey";

alter table "public"."reusable_section_usages" add constraint "reusable_section_usages_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE not valid;

alter table "public"."reusable_section_usages" validate constraint "reusable_section_usages_tenant_id_fkey";

alter table "public"."reusable_sections" add constraint "reusable_sections_owner_tenant_id_fkey" FOREIGN KEY (owner_tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE not valid;

alter table "public"."reusable_sections" validate constraint "reusable_sections_owner_tenant_id_fkey";

alter table "public"."reusable_sections" add constraint "reusable_sections_template_part_id_fkey" FOREIGN KEY (template_part_id) REFERENCES public.template_parts(id) ON DELETE SET NULL not valid;

alter table "public"."reusable_sections" validate constraint "reusable_sections_template_part_id_fkey";

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

alter table "public"."services" add constraint "services_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) not valid;

alter table "public"."services" validate constraint "services_tenant_id_fkey";

alter table "public"."settings" add constraint "settings_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) not valid;

alter table "public"."settings" validate constraint "settings_tenant_id_fkey";

alter table "public"."site_blueprints" add constraint "site_blueprints_owner_tenant_id_fkey" FOREIGN KEY (owner_tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE not valid;

alter table "public"."site_blueprints" validate constraint "site_blueprints_owner_tenant_id_fkey";

alter table "public"."site_blueprints" add constraint "site_blueprints_source_blueprint_id_fkey" FOREIGN KEY (source_blueprint_id) REFERENCES public.site_blueprints(id) ON DELETE SET NULL not valid;

alter table "public"."site_blueprints" validate constraint "site_blueprints_source_blueprint_id_fkey";

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

alter table "public"."teams" add constraint "teams_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) not valid;

alter table "public"."teams" validate constraint "teams_tenant_id_fkey";

alter table "public"."template_assignments" add constraint "template_assignments_template_id_fkey" FOREIGN KEY (template_id) REFERENCES public.templates(id) ON DELETE SET NULL not valid;

alter table "public"."template_assignments" validate constraint "template_assignments_template_id_fkey";

alter table "public"."template_assignments" add constraint "template_assignments_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE not valid;

alter table "public"."template_assignments" validate constraint "template_assignments_tenant_id_fkey";

alter table "public"."template_parts" add constraint "template_parts_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE not valid;

alter table "public"."template_parts" validate constraint "template_parts_tenant_id_fkey";

alter table "public"."templates" add constraint "templates_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) not valid;

alter table "public"."templates" validate constraint "templates_tenant_id_fkey";

alter table "public"."tenant_channels" add constraint "tenant_channels_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE not valid;

alter table "public"."tenant_channels" validate constraint "tenant_channels_tenant_id_fkey";

alter table "public"."tenant_domains" add constraint "tenant_domains_cell_id_fkey" FOREIGN KEY (cell_id) REFERENCES public.deployment_cells(id) not valid;

alter table "public"."tenant_domains" validate constraint "tenant_domains_cell_id_fkey";

alter table "public"."tenant_domains" add constraint "tenant_domains_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants_control(id) ON DELETE CASCADE not valid;

alter table "public"."tenant_domains" validate constraint "tenant_domains_tenant_id_fkey";

alter table "public"."tenant_extensions" add constraint "tenant_extensions_catalog_id_fkey" FOREIGN KEY (catalog_id) REFERENCES public.platform_extension_catalog(id) ON DELETE RESTRICT not valid;

alter table "public"."tenant_extensions" validate constraint "tenant_extensions_catalog_id_fkey";

alter table "public"."tenant_extensions" add constraint "tenant_extensions_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE not valid;

alter table "public"."tenant_extensions" validate constraint "tenant_extensions_tenant_id_fkey";

alter table "public"."tenant_migrations" add constraint "tenant_migrations_source_cell_id_fkey" FOREIGN KEY (source_cell_id) REFERENCES public.deployment_cells(id) not valid;

alter table "public"."tenant_migrations" validate constraint "tenant_migrations_source_cell_id_fkey";

alter table "public"."tenant_migrations" add constraint "tenant_migrations_target_cell_id_fkey" FOREIGN KEY (target_cell_id) REFERENCES public.deployment_cells(id) not valid;

alter table "public"."tenant_migrations" validate constraint "tenant_migrations_target_cell_id_fkey";

alter table "public"."tenant_migrations" add constraint "tenant_migrations_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants_control(id) ON DELETE CASCADE not valid;

alter table "public"."tenant_migrations" validate constraint "tenant_migrations_tenant_id_fkey";

alter table "public"."tenant_notification_channels" add constraint "tenant_notification_channels_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) not valid;

alter table "public"."tenant_notification_channels" validate constraint "tenant_notification_channels_tenant_id_fkey";

alter table "public"."tenant_resource_rules" add constraint "tenant_resource_rules_resource_key_fkey" FOREIGN KEY (resource_key) REFERENCES public.tenant_resource_registry(resource_key) ON DELETE CASCADE not valid;

alter table "public"."tenant_resource_rules" validate constraint "tenant_resource_rules_resource_key_fkey";

alter table "public"."tenant_resource_rules" add constraint "tenant_resource_rules_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE not valid;

alter table "public"."tenant_resource_rules" validate constraint "tenant_resource_rules_tenant_id_fkey";

alter table "public"."tenant_role_links" add constraint "tenant_role_links_child_role_id_fkey" FOREIGN KEY (child_role_id) REFERENCES public.roles(id) ON DELETE CASCADE not valid;

alter table "public"."tenant_role_links" validate constraint "tenant_role_links_child_role_id_fkey";

alter table "public"."tenant_role_links" add constraint "tenant_role_links_parent_role_id_fkey" FOREIGN KEY (parent_role_id) REFERENCES public.roles(id) ON DELETE CASCADE not valid;

alter table "public"."tenant_role_links" validate constraint "tenant_role_links_parent_role_id_fkey";

alter table "public"."tenant_role_links" add constraint "tenant_role_links_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE not valid;

alter table "public"."tenant_role_links" validate constraint "tenant_role_links_tenant_id_fkey";

alter table "public"."tenant_service_contracts" add constraint "tenant_service_contracts_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants_control(id) ON DELETE CASCADE not valid;

alter table "public"."tenant_service_contracts" validate constraint "tenant_service_contracts_tenant_id_fkey";

alter table "public"."tenant_site_blueprint_state" add constraint "tenant_site_blueprint_state_blueprint_id_fkey" FOREIGN KEY (blueprint_id) REFERENCES public.site_blueprints(id) ON DELETE RESTRICT not valid;

alter table "public"."tenant_site_blueprint_state" validate constraint "tenant_site_blueprint_state_blueprint_id_fkey";

alter table "public"."tenant_site_blueprint_state" add constraint "tenant_site_blueprint_state_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE not valid;

alter table "public"."tenant_site_blueprint_state" validate constraint "tenant_site_blueprint_state_tenant_id_fkey";

alter table "public"."tenants" add constraint "tenants_parent_tenant_id_fkey" FOREIGN KEY (parent_tenant_id) REFERENCES public.tenants(id) ON DELETE SET NULL not valid;

alter table "public"."tenants" validate constraint "tenants_parent_tenant_id_fkey";

alter table "public"."tenants_control" add constraint "tenants_control_current_cell_id_fkey" FOREIGN KEY (current_cell_id) REFERENCES public.deployment_cells(id) not valid;

alter table "public"."tenants_control" validate constraint "tenants_control_current_cell_id_fkey";

alter table "public"."tenants_control" add constraint "tenants_control_primary_domain_fk" FOREIGN KEY (primary_domain_id) REFERENCES public.tenant_domains(id) DEFERRABLE INITIALLY DEFERRED not valid;

alter table "public"."tenants_control" validate constraint "tenants_control_primary_domain_fk";

alter table "public"."tenants_control" add constraint "tenants_control_project_id_fkey" FOREIGN KEY (project_id) REFERENCES public.platform_projects(id) ON DELETE CASCADE not valid;

alter table "public"."tenants_control" validate constraint "tenants_control_project_id_fkey";

alter table "public"."testimonies" add constraint "testimonies_category_id_fkey" FOREIGN KEY (category_id) REFERENCES public.categories(id) not valid;

alter table "public"."testimonies" validate constraint "testimonies_category_id_fkey";

alter table "public"."testimonies" add constraint "testimonies_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.users(id) not valid;

alter table "public"."testimonies" validate constraint "testimonies_created_by_fkey";

alter table "public"."testimonies" add constraint "testimonies_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) not valid;

alter table "public"."testimonies" validate constraint "testimonies_tenant_id_fkey";

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

alter table "public"."ui_configs" add constraint "ui_schemas_resource_key_fkey" FOREIGN KEY (resource_key) REFERENCES public.resources_registry(key) ON DELETE CASCADE not valid;

alter table "public"."ui_configs" validate constraint "ui_schemas_resource_key_fkey";

alter table "public"."ui_configs" add constraint "ui_schemas_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE not valid;

alter table "public"."ui_configs" validate constraint "ui_schemas_tenant_id_fkey";

alter table "public"."user_profile_admin" add constraint "user_profile_admin_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL not valid;

alter table "public"."user_profile_admin" validate constraint "user_profile_admin_created_by_fkey";

alter table "public"."user_profile_admin" add constraint "user_profile_admin_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT not valid;

alter table "public"."user_profile_admin" validate constraint "user_profile_admin_tenant_id_fkey";

alter table "public"."user_profile_admin" add constraint "user_profile_admin_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE RESTRICT not valid;

alter table "public"."user_profile_admin" validate constraint "user_profile_admin_user_id_fkey";

alter table "public"."user_profiles" add constraint "user_profiles_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL not valid;

alter table "public"."user_profiles" validate constraint "user_profiles_created_by_fkey";

alter table "public"."user_profiles" add constraint "user_profiles_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE RESTRICT not valid;

alter table "public"."user_profiles" validate constraint "user_profiles_tenant_id_fkey";

alter table "public"."user_profiles" add constraint "user_profiles_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE RESTRICT not valid;

alter table "public"."user_profiles" validate constraint "user_profiles_user_id_fkey";

alter table "public"."users" add constraint "users_admin_approved_by_fkey" FOREIGN KEY (admin_approved_by) REFERENCES public.users(id) not valid;

alter table "public"."users" validate constraint "users_admin_approved_by_fkey";

alter table "public"."users" add constraint "users_administrative_region_id_fkey" FOREIGN KEY (administrative_region_id) REFERENCES public.administrative_regions(id) ON DELETE SET NULL not valid;

alter table "public"."users" validate constraint "users_administrative_region_id_fkey";

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

alter table "public"."widgets" add constraint "widgets_area_id_fkey" FOREIGN KEY (area_id) REFERENCES public.template_parts(id) ON DELETE SET NULL not valid;

alter table "public"."widgets" validate constraint "widgets_area_id_fkey";

alter table "public"."widgets" add constraint "widgets_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE not valid;

alter table "public"."widgets" validate constraint "widgets_tenant_id_fkey";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.log_access_event(p_tenant_id uuid DEFAULT NULL::uuid, p_user_id uuid DEFAULT NULL::uuid, p_action text DEFAULT 'access'::text, p_resource text DEFAULT 'access'::text, p_details jsonb DEFAULT '{}'::jsonb, p_ip_address text DEFAULT NULL::text, p_channel text DEFAULT NULL::text, p_actor_type text DEFAULT NULL::text, p_actor_role text DEFAULT NULL::text, p_auth_context jsonb DEFAULT '{}'::jsonb, p_module_name text DEFAULT NULL::text, p_feature_name text DEFAULT NULL::text, p_action_name text DEFAULT NULL::text, p_resource_type text DEFAULT NULL::text, p_resource_id text DEFAULT NULL::text, p_permission_key text DEFAULT NULL::text, p_server_timestamp timestamp with time zone DEFAULT now(), p_client_timestamp timestamp with time zone DEFAULT NULL::timestamp with time zone, p_request_duration_ms integer DEFAULT NULL::integer, p_workspace_source text DEFAULT NULL::text, p_route_path text DEFAULT NULL::text, p_url text DEFAULT NULL::text, p_screen_name text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text, p_device_metadata jsonb DEFAULT '{}'::jsonb, p_purpose text DEFAULT NULL::text, p_workflow_state text DEFAULT NULL::text, p_trigger_source text DEFAULT NULL::text, p_business_intent text DEFAULT NULL::text, p_access_channel text DEFAULT NULL::text, p_access_mechanism text DEFAULT NULL::text, p_integration_source text DEFAULT NULL::text, p_auth_method text DEFAULT NULL::text)
 RETURNS public.audit_logs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  inserted_row public.audit_logs;
begin
  insert into public.audit_logs (
    tenant_id,
    user_id,
    action,
    resource,
    details,
    ip_address,
    channel,
    actor_type,
    actor_role,
    auth_context,
    module_name,
    feature_name,
    action_name,
    resource_type,
    resource_id,
    permission_key,
    server_timestamp,
    client_timestamp,
    request_duration_ms,
    workspace_source,
    route_path,
    url,
    screen_name,
    user_agent,
    device_metadata,
    purpose,
    workflow_state,
    trigger_source,
    business_intent,
    access_channel,
    access_mechanism,
    integration_source,
    auth_method
  )
  values (
    p_tenant_id,
    p_user_id,
    coalesce(p_action, 'access'),
    coalesce(p_resource, 'access'),
    coalesce(p_details, '{}'::jsonb),
    p_ip_address,
    p_channel,
    p_actor_type,
    p_actor_role,
    coalesce(p_auth_context, '{}'::jsonb),
    p_module_name,
    p_feature_name,
    coalesce(p_action_name, p_action, 'access'),
    coalesce(p_resource_type, p_resource, 'access'),
    p_resource_id,
    p_permission_key,
    coalesce(p_server_timestamp, now()),
    p_client_timestamp,
    p_request_duration_ms,
    p_workspace_source,
    p_route_path,
    p_url,
    p_screen_name,
    p_user_agent,
    coalesce(p_device_metadata, '{}'::jsonb),
    p_purpose,
    p_workflow_state,
    p_trigger_source,
    p_business_intent,
    coalesce(p_access_channel, p_channel),
    p_access_mechanism,
    p_integration_source,
    p_auth_method
  )
  returning * into inserted_row;

  return inserted_row;
end;
$function$
;

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



  create policy "admin_menus_select_unified"
  on "public"."admin_menus"
  as permissive
  for select
  to authenticated
using (((tenant_id IS NULL) OR (tenant_id = public.current_tenant_id()) OR public.is_platform_admin()));



  create policy "admin_menus_update_unified"
  on "public"."admin_menus"
  as permissive
  for update
  to public
using (public.is_platform_admin());



  create policy "admin_regions_delete_admin"
  on "public"."administrative_regions"
  as permissive
  for delete
  to public
using (public.is_platform_admin());



  create policy "admin_regions_insert_admin"
  on "public"."administrative_regions"
  as permissive
  for insert
  to public
with check (public.is_platform_admin());



  create policy "admin_regions_select_all"
  on "public"."administrative_regions"
  as permissive
  for select
  to public
using (((is_active = true) OR public.is_platform_admin()));



  create policy "admin_regions_update_admin"
  on "public"."administrative_regions"
  as permissive
  for update
  to public
using (public.is_platform_admin())
with check (public.is_platform_admin());



  create policy "Unified delete analytics daily"
  on "public"."analytics_daily"
  as permissive
  for delete
  to authenticated
using ((((tenant_id = ( SELECT public.current_tenant_id() AS current_tenant_id)) AND public.is_admin_or_above()) OR ( SELECT public.is_platform_admin() AS is_platform_admin)));



  create policy "Unified insert analytics daily"
  on "public"."analytics_daily"
  as permissive
  for insert
  to authenticated
with check ((((tenant_id = ( SELECT public.current_tenant_id() AS current_tenant_id)) AND public.is_admin_or_above()) OR ( SELECT public.is_platform_admin() AS is_platform_admin)));



  create policy "Unified read analytics daily"
  on "public"."analytics_daily"
  as permissive
  for select
  to public
using (((tenant_id = ( SELECT public.current_tenant_id() AS current_tenant_id)) OR ( SELECT public.is_platform_admin() AS is_platform_admin)));



  create policy "Unified update analytics daily"
  on "public"."analytics_daily"
  as permissive
  for update
  to authenticated
using ((((tenant_id = ( SELECT public.current_tenant_id() AS current_tenant_id)) AND public.is_admin_or_above()) OR ( SELECT public.is_platform_admin() AS is_platform_admin)))
with check ((((tenant_id = ( SELECT public.current_tenant_id() AS current_tenant_id)) AND public.is_admin_or_above()) OR ( SELECT public.is_platform_admin() AS is_platform_admin)));



  create policy "analytics_events_admin_delete"
  on "public"."analytics_events"
  as permissive
  for delete
  to authenticated
using ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()));



  create policy "analytics_events_admin_manage"
  on "public"."analytics_events"
  as permissive
  for update
  to authenticated
using ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()))
with check ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()));



  create policy "analytics_events_admin_read"
  on "public"."analytics_events"
  as permissive
  for select
  to authenticated
using ((((tenant_id = public.current_tenant_id()) AND public.has_permission('tenant.analytics.read'::text)) OR public.is_platform_admin()));



  create policy "analytics_events_public_insert"
  on "public"."analytics_events"
  as permissive
  for insert
  to anon, authenticated
with check ((tenant_id = public.current_tenant_id()));



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



  create policy "audit_logs_insert_unified"
  on "public"."audit_logs"
  as permissive
  for insert
  to public
with check (((tenant_id = public.current_tenant_id()) OR ((tenant_id IS NULL) AND (( SELECT auth.uid() AS uid) IS NOT NULL))));



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



  create policy "blog_tags_delete_hierarchy"
  on "public"."blog_tags"
  as permissive
  for delete
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'content'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "blog_tags_insert_hierarchy"
  on "public"."blog_tags"
  as permissive
  for insert
  to public
with check (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'content'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "blog_tags_select_hierarchy"
  on "public"."blog_tags"
  as permissive
  for select
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'content'::text, 'read'::text) OR public.is_platform_admin()));



  create policy "blog_tags_update_hierarchy"
  on "public"."blog_tags"
  as permissive
  for update
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'content'::text, 'write'::text) OR public.is_platform_admin()))
with check (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'content'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "blogs_delete"
  on "public"."blogs"
  as permissive
  for delete
  to public
using (((tenant_id = ( SELECT public.current_tenant_id() AS current_tenant_id)) OR ( SELECT public.is_platform_admin() AS is_platform_admin) OR (EXISTS ( SELECT 1
   FROM (public.users u
     JOIN public.roles r ON ((u.role_id = r.id)))
  WHERE ((u.id = ( SELECT auth.uid() AS uid)) AND (r.is_full_access = true))))));



  create policy "blogs_insert"
  on "public"."blogs"
  as permissive
  for insert
  to public
with check (((tenant_id = ( SELECT public.current_tenant_id() AS current_tenant_id)) OR ( SELECT public.is_platform_admin() AS is_platform_admin) OR (EXISTS ( SELECT 1
   FROM (public.users u
     JOIN public.roles r ON ((u.role_id = r.id)))
  WHERE ((u.id = ( SELECT auth.uid() AS uid)) AND (r.is_full_access = true))))));



  create policy "blogs_select"
  on "public"."blogs"
  as permissive
  for select
  to public
using (((status = 'published'::text) OR (tenant_id = ( SELECT public.current_tenant_id() AS current_tenant_id)) OR ( SELECT public.is_platform_admin() AS is_platform_admin) OR (EXISTS ( SELECT 1
   FROM (public.users u
     JOIN public.roles r ON ((u.role_id = r.id)))
  WHERE ((u.id = ( SELECT auth.uid() AS uid)) AND (r.is_full_access = true))))));



  create policy "blogs_update"
  on "public"."blogs"
  as permissive
  for update
  to public
using (((tenant_id = ( SELECT public.current_tenant_id() AS current_tenant_id)) OR ( SELECT public.is_platform_admin() AS is_platform_admin) OR (EXISTS ( SELECT 1
   FROM (public.users u
     JOIN public.roles r ON ((u.role_id = r.id)))
  WHERE ((u.id = ( SELECT auth.uid() AS uid)) AND (r.is_full_access = true))))))
with check (((tenant_id = ( SELECT public.current_tenant_id() AS current_tenant_id)) OR ( SELECT public.is_platform_admin() AS is_platform_admin) OR (EXISTS ( SELECT 1
   FROM (public.users u
     JOIN public.roles r ON ((u.role_id = r.id)))
  WHERE ((u.id = ( SELECT auth.uid() AS uid)) AND (r.is_full_access = true))))));



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



  create policy "categories_update_unified"
  on "public"."categories"
  as permissive
  for update
  to public
using ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()));



  create policy "Platform admins delete editor configs"
  on "public"."component_registry"
  as permissive
  for delete
  to public
using (( SELECT public.is_platform_admin() AS is_platform_admin));



  create policy "Platform admins insert editor configs"
  on "public"."component_registry"
  as permissive
  for insert
  to public
with check (( SELECT public.is_platform_admin() AS is_platform_admin));



  create policy "Platform admins update editor configs"
  on "public"."component_registry"
  as permissive
  for update
  to public
using (( SELECT public.is_platform_admin() AS is_platform_admin))
with check (( SELECT public.is_platform_admin() AS is_platform_admin));



  create policy "Unified read editor configs"
  on "public"."component_registry"
  as permissive
  for select
  to public
using ((( SELECT public.is_platform_admin() AS is_platform_admin) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT users.tenant_id
   FROM public.users
  WHERE (users.id = ( SELECT auth.uid() AS uid))))));



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



  create policy "content_translations_delete_tenant"
  on "public"."content_translations"
  as permissive
  for delete
  to public
using ((((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'content'::text, 'write'::text) OR public.is_platform_admin()) AND (((content_type = 'page'::text) AND (public.has_permission('tenant.page.update'::text) OR public.has_permission('tenant.page.delete'::text) OR public.is_platform_admin())) OR ((content_type = ANY (ARRAY['blog'::text, 'article'::text])) AND (public.has_permission('tenant.blog.update'::text) OR public.has_permission('tenant.blog.delete'::text) OR public.is_platform_admin())))));



  create policy "content_translations_insert_tenant"
  on "public"."content_translations"
  as permissive
  for insert
  to public
with check ((((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'content'::text, 'write'::text) OR public.is_platform_admin()) AND (((content_type = 'page'::text) AND (public.has_permission('tenant.page.create'::text) OR public.has_permission('tenant.page.update'::text) OR public.has_permission('tenant.page.publish'::text) OR public.is_platform_admin())) OR ((content_type = ANY (ARRAY['blog'::text, 'article'::text])) AND (public.has_permission('tenant.blog.create'::text) OR public.has_permission('tenant.blog.update'::text) OR public.has_permission('tenant.blog.publish'::text) OR public.is_platform_admin())))));



  create policy "content_translations_read_all"
  on "public"."content_translations"
  as permissive
  for select
  to public
using ((tenant_id = public.current_tenant_id()));



  create policy "content_translations_update_tenant"
  on "public"."content_translations"
  as permissive
  for update
  to public
using ((((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'content'::text, 'write'::text) OR public.is_platform_admin()) AND (((content_type = 'page'::text) AND (public.has_permission('tenant.page.update'::text) OR public.has_permission('tenant.page.publish'::text) OR public.is_platform_admin())) OR ((content_type = ANY (ARRAY['blog'::text, 'article'::text])) AND (public.has_permission('tenant.blog.update'::text) OR public.has_permission('tenant.blog.publish'::text) OR public.is_platform_admin())))))
with check ((((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'content'::text, 'write'::text) OR public.is_platform_admin()) AND (((content_type = 'page'::text) AND (public.has_permission('tenant.page.update'::text) OR public.has_permission('tenant.page.publish'::text) OR public.is_platform_admin())) OR ((content_type = ANY (ARRAY['blog'::text, 'article'::text])) AND (public.has_permission('tenant.blog.update'::text) OR public.has_permission('tenant.blog.publish'::text) OR public.is_platform_admin())))));



  create policy "Platform admins manage deployment_cells"
  on "public"."deployment_cells"
  as permissive
  for all
  to public
using (public.auth_is_platform_admin())
with check (public.auth_is_platform_admin());



  create policy "Tenant members can read their active cell"
  on "public"."deployment_cells"
  as permissive
  for select
  to public
using (((auth.role() = 'authenticated'::text) AND (id IN ( SELECT tenants_control.current_cell_id
   FROM public.tenants_control
  WHERE (tenants_control.id IN ( SELECT users.tenant_id
           FROM public.users
          WHERE ((users.id = auth.uid()) AND (users.deleted_at IS NULL))))))));



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



  create policy "events_delete"
  on "public"."events"
  as permissive
  for delete
  to authenticated
using (((tenant_id = ( SELECT public.current_tenant_id() AS current_tenant_id)) AND (( SELECT public.has_permission('tenant.events.delete'::text) AS has_permission) OR ( SELECT public.auth_is_admin() AS auth_is_admin))));



  create policy "events_insert"
  on "public"."events"
  as permissive
  for insert
  to authenticated
with check (((tenant_id = ( SELECT public.current_tenant_id() AS current_tenant_id)) AND (( SELECT public.has_permission('tenant.events.create'::text) AS has_permission) OR ( SELECT public.auth_is_admin() AS auth_is_admin)) AND ((author_id IS NULL) OR (author_id = auth.uid()))));



  create policy "events_select"
  on "public"."events"
  as permissive
  for select
  to authenticated
using (((tenant_id = ( SELECT public.current_tenant_id() AS current_tenant_id)) AND (deleted_at IS NULL) AND (( SELECT public.has_permission('tenant.events.read'::text) AS has_permission) OR ( SELECT public.auth_is_admin() AS auth_is_admin))));



  create policy "events_update"
  on "public"."events"
  as permissive
  for update
  to authenticated
using (((tenant_id = ( SELECT public.current_tenant_id() AS current_tenant_id)) AND (deleted_at IS NULL) AND (( SELECT public.has_permission('tenant.events.update'::text) AS has_permission) OR ( SELECT public.auth_is_admin() AS auth_is_admin))))
with check (((tenant_id = ( SELECT public.current_tenant_id() AS current_tenant_id)) AND (( SELECT public.has_permission('tenant.events.update'::text) AS has_permission) OR ( SELECT public.auth_is_admin() AS auth_is_admin))));



  create policy "extension_lifecycle_audit_insert"
  on "public"."extension_lifecycle_audit"
  as permissive
  for insert
  to authenticated
with check (((actor_user_id = auth.uid()) AND ((tenant_id IS NULL) OR (tenant_id = ( SELECT public.current_tenant_id() AS current_tenant_id)) OR ( SELECT public.auth_is_admin() AS auth_is_admin))));



  create policy "extension_lifecycle_audit_select"
  on "public"."extension_lifecycle_audit"
  as permissive
  for select
  to authenticated
using (((deleted_at IS NULL) AND (((tenant_id = ( SELECT public.current_tenant_id() AS current_tenant_id)) AND (( SELECT public.has_permission('tenant.audit.read'::text) AS has_permission) OR ( SELECT public.has_permission('tenant.setting.read'::text) AS has_permission))) OR ( SELECT public.auth_is_admin() AS auth_is_admin) OR ( SELECT public.has_permission('platform.extensions.read'::text) AS has_permission) OR ( SELECT public.has_permission('platform.extensions.diagnostics.read'::text) AS has_permission))));



  create policy "extension_lifecycle_audit_update"
  on "public"."extension_lifecycle_audit"
  as permissive
  for update
  to authenticated
using (( SELECT public.auth_is_admin() AS auth_is_admin))
with check (( SELECT public.auth_is_admin() AS auth_is_admin));



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



  create policy "extension_menu_items_delete_hierarchy"
  on "public"."extension_menu_items"
  as permissive
  for delete
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'extensions'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "extension_menu_items_insert_hierarchy"
  on "public"."extension_menu_items"
  as permissive
  for insert
  to public
with check (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'extensions'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "extension_menu_items_select_hierarchy"
  on "public"."extension_menu_items"
  as permissive
  for select
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'extensions'::text, 'read'::text) OR public.is_platform_admin()));



  create policy "extension_menu_items_update_hierarchy"
  on "public"."extension_menu_items"
  as permissive
  for update
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'extensions'::text, 'write'::text) OR public.is_platform_admin()))
with check (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'extensions'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "Unified delete extension permissions"
  on "public"."extension_permissions"
  as permissive
  for delete
  to public
using ((( SELECT public.is_platform_admin() AS is_platform_admin) OR ((tenant_id = ( SELECT public.current_tenant_id() AS current_tenant_id)) OR public.tenant_can_access_resource(tenant_id, 'extensions'::text, 'write'::text)) OR ( SELECT public.has_permission('platform.extensions.delete'::text) AS has_permission)));



  create policy "Unified insert extension permissions"
  on "public"."extension_permissions"
  as permissive
  for insert
  to public
with check ((( SELECT public.is_platform_admin() AS is_platform_admin) OR ((tenant_id = ( SELECT public.current_tenant_id() AS current_tenant_id)) OR public.tenant_can_access_resource(tenant_id, 'extensions'::text, 'write'::text)) OR ( SELECT public.has_permission('platform.extensions.create'::text) AS has_permission)));



  create policy "Unified select extension permissions"
  on "public"."extension_permissions"
  as permissive
  for select
  to public
using ((( SELECT public.is_platform_admin() AS is_platform_admin) OR (tenant_id = ( SELECT public.current_tenant_id() AS current_tenant_id)) OR public.tenant_can_access_resource(tenant_id, 'extensions'::text, 'read'::text) OR ( SELECT public.has_permission('platform.extensions.read'::text) AS has_permission)));



  create policy "Unified update extension permissions"
  on "public"."extension_permissions"
  as permissive
  for update
  to public
using ((( SELECT public.is_platform_admin() AS is_platform_admin) OR ((tenant_id = ( SELECT public.current_tenant_id() AS current_tenant_id)) OR public.tenant_can_access_resource(tenant_id, 'extensions'::text, 'write'::text)) OR ( SELECT public.has_permission('platform.extensions.update'::text) AS has_permission)))
with check ((( SELECT public.is_platform_admin() AS is_platform_admin) OR ((tenant_id = ( SELECT public.current_tenant_id() AS current_tenant_id)) OR public.tenant_can_access_resource(tenant_id, 'extensions'::text, 'write'::text)) OR ( SELECT public.has_permission('platform.extensions.update'::text) AS has_permission)));



  create policy "Unified delete extension rbac"
  on "public"."extension_rbac_integration"
  as permissive
  for delete
  to public
using ((( SELECT public.is_platform_admin() AS is_platform_admin) OR ((tenant_id = ( SELECT public.current_tenant_id() AS current_tenant_id)) OR public.tenant_can_access_resource(tenant_id, 'extensions'::text, 'write'::text)) OR ( SELECT public.has_permission('platform.extensions.delete'::text) AS has_permission) OR (EXISTS ( SELECT 1
   FROM public.roles r
  WHERE ((r.id = extension_rbac_integration.role_id) AND (r.tenant_id = ( SELECT public.current_tenant_id() AS current_tenant_id)) AND public.is_admin_or_above())))));



  create policy "Unified insert extension rbac"
  on "public"."extension_rbac_integration"
  as permissive
  for insert
  to public
with check ((( SELECT public.is_platform_admin() AS is_platform_admin) OR ((tenant_id = ( SELECT public.current_tenant_id() AS current_tenant_id)) OR public.tenant_can_access_resource(tenant_id, 'extensions'::text, 'write'::text)) OR ( SELECT public.has_permission('platform.extensions.create'::text) AS has_permission) OR (EXISTS ( SELECT 1
   FROM public.roles r
  WHERE ((r.id = extension_rbac_integration.role_id) AND (r.tenant_id = ( SELECT public.current_tenant_id() AS current_tenant_id)) AND public.is_admin_or_above())))));



  create policy "Unified select extension rbac"
  on "public"."extension_rbac_integration"
  as permissive
  for select
  to public
using ((( SELECT public.is_platform_admin() AS is_platform_admin) OR (tenant_id = ( SELECT public.current_tenant_id() AS current_tenant_id)) OR public.tenant_can_access_resource(tenant_id, 'extensions'::text, 'read'::text) OR ( SELECT public.has_permission('platform.extensions.read'::text) AS has_permission)));



  create policy "Unified update extension rbac"
  on "public"."extension_rbac_integration"
  as permissive
  for update
  to public
using ((( SELECT public.is_platform_admin() AS is_platform_admin) OR ((tenant_id = ( SELECT public.current_tenant_id() AS current_tenant_id)) OR public.tenant_can_access_resource(tenant_id, 'extensions'::text, 'write'::text)) OR ( SELECT public.has_permission('platform.extensions.update'::text) AS has_permission) OR (EXISTS ( SELECT 1
   FROM public.roles r
  WHERE ((r.id = extension_rbac_integration.role_id) AND (r.tenant_id = ( SELECT public.current_tenant_id() AS current_tenant_id)) AND public.is_admin_or_above())))))
with check ((( SELECT public.is_platform_admin() AS is_platform_admin) OR ((tenant_id = ( SELECT public.current_tenant_id() AS current_tenant_id)) OR public.tenant_can_access_resource(tenant_id, 'extensions'::text, 'write'::text)) OR ( SELECT public.has_permission('platform.extensions.update'::text) AS has_permission) OR (EXISTS ( SELECT 1
   FROM public.roles r
  WHERE ((r.id = extension_rbac_integration.role_id) AND (r.tenant_id = ( SELECT public.current_tenant_id() AS current_tenant_id)) AND public.is_admin_or_above())))));



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



  create policy "Unified select extension routes"
  on "public"."extension_routes_registry"
  as permissive
  for select
  to public
using (((deleted_at IS NULL) AND (( SELECT public.is_platform_admin() AS is_platform_admin) OR (is_active = true) OR ( SELECT public.has_permission('platform.extensions.read'::text) AS has_permission))));



  create policy "extension_routes_registry_delete_hierarchy"
  on "public"."extension_routes_registry"
  as permissive
  for delete
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'extensions'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "extension_routes_registry_insert_hierarchy"
  on "public"."extension_routes_registry"
  as permissive
  for insert
  to public
with check (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'extensions'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "extension_routes_registry_update_hierarchy"
  on "public"."extension_routes_registry"
  as permissive
  for update
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'extensions'::text, 'write'::text) OR public.is_platform_admin()))
with check (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'extensions'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "extensions_delete_hierarchy"
  on "public"."extensions"
  as permissive
  for delete
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'extensions'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "extensions_insert_hierarchy"
  on "public"."extensions"
  as permissive
  for insert
  to public
with check (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'extensions'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "extensions_select_hierarchy"
  on "public"."extensions"
  as permissive
  for select
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'extensions'::text, 'read'::text) OR public.is_platform_admin()));



  create policy "extensions_update_hierarchy"
  on "public"."extensions"
  as permissive
  for update
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'extensions'::text, 'write'::text) OR public.is_platform_admin()))
with check (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'extensions'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "Tenant Delete Funfacts"
  on "public"."funfacts"
  as permissive
  for delete
  to authenticated
using ((tenant_id = ( SELECT public.current_tenant_id() AS current_tenant_id)));



  create policy "Tenant Insert Funfacts"
  on "public"."funfacts"
  as permissive
  for insert
  to authenticated
with check ((tenant_id = ( SELECT public.current_tenant_id() AS current_tenant_id)));



  create policy "Tenant Update Funfacts"
  on "public"."funfacts"
  as permissive
  for update
  to authenticated
using ((tenant_id = ( SELECT public.current_tenant_id() AS current_tenant_id)));



  create policy "funfacts_select_unified"
  on "public"."funfacts"
  as permissive
  for select
  to public
using (((status = 'published'::text) OR (tenant_id = ( SELECT public.current_tenant_id() AS current_tenant_id)) OR public.is_platform_admin()));



  create policy "media_access_audit_insert_auth"
  on "public"."media_access_audit"
  as permissive
  for insert
  to authenticated
with check (((tenant_id = public.current_tenant_id()) OR public.is_platform_admin()));



  create policy "media_access_audit_select_auth"
  on "public"."media_access_audit"
  as permissive
  for select
  to authenticated
using (((tenant_id = public.current_tenant_id()) OR public.is_platform_admin()));



  create policy "media_objects_insert_auth"
  on "public"."media_objects"
  as permissive
  for insert
  to authenticated
with check ((public.is_platform_admin() OR ((tenant_id = public.current_tenant_id()) AND (public.has_permission('tenant.files.create'::text) OR public.has_permission('tenant.files.manage'::text)))));



  create policy "media_objects_select_unified"
  on "public"."media_objects"
  as permissive
  for select
  to public
using ((((access_control = 'public'::text) AND (deleted_at IS NULL) AND (status = 'uploaded'::text)) OR (public.is_platform_admin() AND ((deleted_at IS NULL) OR (deleted_at IS NOT NULL))) OR ((tenant_id = public.current_tenant_id()) AND (deleted_at IS NULL) AND (public.has_permission('tenant.files.read'::text) OR public.has_permission('tenant.files.manage'::text) OR public.has_permission('tenant.files.update'::text) OR public.has_permission('tenant.files.delete'::text) OR public.is_admin_or_above())) OR ((tenant_id = public.current_tenant_id()) AND (deleted_at IS NOT NULL) AND (public.has_permission('tenant.files.manage'::text) OR public.has_permission('tenant.files.delete'::text) OR public.has_permission('tenant.files.restore'::text) OR public.is_admin_or_above()))));



  create policy "media_objects_update_auth"
  on "public"."media_objects"
  as permissive
  for update
  to authenticated
using ((public.is_platform_admin() OR ((tenant_id = public.current_tenant_id()) AND (public.has_permission('tenant.files.update'::text) OR public.has_permission('tenant.files.delete'::text) OR public.has_permission('tenant.files.manage'::text)))))
with check ((public.is_platform_admin() OR ((tenant_id = public.current_tenant_id()) AND (public.has_permission('tenant.files.update'::text) OR public.has_permission('tenant.files.delete'::text) OR public.has_permission('tenant.files.manage'::text)))));



  create policy "media_upload_sessions_insert_auth"
  on "public"."media_upload_sessions"
  as permissive
  for insert
  to authenticated
with check ((public.is_platform_admin() OR ((tenant_id = public.current_tenant_id()) AND (public.has_permission('tenant.files.create'::text) OR public.has_permission('tenant.files.manage'::text)))));



  create policy "media_upload_sessions_select_auth"
  on "public"."media_upload_sessions"
  as permissive
  for select
  to authenticated
using ((public.is_platform_admin() OR ((tenant_id = public.current_tenant_id()) AND (public.has_permission('tenant.files.read'::text) OR public.has_permission('tenant.files.create'::text) OR public.has_permission('tenant.files.manage'::text)))));



  create policy "media_upload_sessions_update_auth"
  on "public"."media_upload_sessions"
  as permissive
  for update
  to authenticated
using ((public.is_platform_admin() OR ((tenant_id = public.current_tenant_id()) AND (public.has_permission('tenant.files.create'::text) OR public.has_permission('tenant.files.update'::text) OR public.has_permission('tenant.files.manage'::text)))))
with check ((public.is_platform_admin() OR ((tenant_id = public.current_tenant_id()) AND (public.has_permission('tenant.files.create'::text) OR public.has_permission('tenant.files.update'::text) OR public.has_permission('tenant.files.manage'::text)))));



  create policy "media_variants_insert_auth"
  on "public"."media_variants"
  as permissive
  for insert
  to authenticated
with check ((media_object_id IN ( SELECT media_objects.id
   FROM public.media_objects
  WHERE ((media_objects.tenant_id = public.current_tenant_id()) OR public.is_platform_admin()))));



  create policy "media_variants_select_unified"
  on "public"."media_variants"
  as permissive
  for select
  to public
using ((media_object_id IN ( SELECT media_objects.id
   FROM public.media_objects
  WHERE (((media_objects.access_control = 'public'::text) AND (media_objects.deleted_at IS NULL) AND (media_objects.status = 'uploaded'::text)) OR ((media_objects.tenant_id = public.current_tenant_id()) AND (media_objects.deleted_at IS NULL)) OR public.is_platform_admin()))));



  create policy "menus_delete_hierarchy"
  on "public"."menus"
  as permissive
  for delete
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'menus'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "menus_insert_hierarchy"
  on "public"."menus"
  as permissive
  for insert
  to public
with check (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'menus'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "menus_select_hierarchy"
  on "public"."menus"
  as permissive
  for select
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'menus'::text, 'read'::text) OR public.is_platform_admin()));



  create policy "menus_update_hierarchy"
  on "public"."menus"
  as permissive
  for update
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'menus'::text, 'write'::text) OR public.is_platform_admin()))
with check (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'menus'::text, 'write'::text) OR public.is_platform_admin()));



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



  create policy "modules_read_policy"
  on "public"."modules"
  as permissive
  for select
  to public
using ((public.is_platform_admin() OR ((tenant_id = public.get_current_tenant_id()) AND public.is_admin_or_above())));



  create policy "modules_update_policy"
  on "public"."modules"
  as permissive
  for update
  to authenticated
using ((public.is_platform_admin() OR public.has_permission('platform.module.manage'::text)))
with check ((public.is_platform_admin() OR public.has_permission('platform.module.manage'::text)));



  create policy "nd_select"
  on "public"."notification_dispatches"
  as permissive
  for select
  to public
using (((tenant_id = public.current_tenant_id()) AND public.has_permission('tenant.notifications.read'::text)));



  create policy "notification_readers_select_policy"
  on "public"."notification_readers"
  as permissive
  for select
  to public
using (((user_id = ( SELECT auth.uid() AS uid)) OR ((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()));



  create policy "nt_insert"
  on "public"."notification_templates"
  as permissive
  for insert
  to public
with check (((tenant_id = public.current_tenant_id()) AND public.has_permission('tenant.notifications.manage'::text)));



  create policy "nt_select"
  on "public"."notification_templates"
  as permissive
  for select
  to public
using (((tenant_id = public.current_tenant_id()) AND (deleted_at IS NULL) AND public.has_permission('tenant.notifications.read'::text)));



  create policy "nt_soft_delete"
  on "public"."notification_templates"
  as permissive
  for update
  to public
using (((tenant_id = public.current_tenant_id()) AND (is_system = false) AND public.has_permission('tenant.notifications.manage'::text)))
with check ((tenant_id = public.current_tenant_id()));



  create policy "nt_update"
  on "public"."notification_templates"
  as permissive
  for update
  to public
using (((tenant_id = public.current_tenant_id()) AND (deleted_at IS NULL) AND public.has_permission('tenant.notifications.manage'::text)))
with check ((tenant_id = public.current_tenant_id()));



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



  create policy "Enable insert for anonymous users"
  on "public"."orders"
  as permissive
  for insert
  to anon
with check ((tenant_id = public.current_tenant_id()));



  create policy "orders_select_auth"
  on "public"."orders"
  as permissive
  for select
  to authenticated
using (((( SELECT auth.uid() AS uid) = user_id) OR ((tenant_id = ( SELECT users.tenant_id
   FROM public.users
  WHERE (users.id = ( SELECT auth.uid() AS uid)))) AND (( SELECT public.get_my_role_name() AS get_my_role_name) = ANY (ARRAY['admin'::text, 'editor'::text]))) OR (( SELECT public.get_my_role_name() AS get_my_role_name) = 'super_admin'::text)));



  create policy "page_categories_delete_hierarchy"
  on "public"."page_categories"
  as permissive
  for delete
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'content'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "page_categories_insert_hierarchy"
  on "public"."page_categories"
  as permissive
  for insert
  to public
with check (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'content'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "page_categories_select_hierarchy"
  on "public"."page_categories"
  as permissive
  for select
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'content'::text, 'read'::text) OR public.is_platform_admin()));



  create policy "page_categories_update_hierarchy"
  on "public"."page_categories"
  as permissive
  for update
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'content'::text, 'write'::text) OR public.is_platform_admin()))
with check (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'content'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "page_files_delete_tenant"
  on "public"."page_files"
  as permissive
  for delete
  to public
using ((tenant_id = public.get_current_tenant_id()));



  create policy "page_files_insert_tenant"
  on "public"."page_files"
  as permissive
  for insert
  to public
with check ((tenant_id = public.get_current_tenant_id()));



  create policy "page_files_read_all"
  on "public"."page_files"
  as permissive
  for select
  to public
using ((tenant_id = public.current_tenant_id()));



  create policy "page_files_update_tenant"
  on "public"."page_files"
  as permissive
  for update
  to public
using ((tenant_id = public.get_current_tenant_id()))
with check ((tenant_id = public.get_current_tenant_id()));



  create policy "pages_delete_hierarchy"
  on "public"."pages"
  as permissive
  for delete
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'content'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "pages_insert_hierarchy"
  on "public"."pages"
  as permissive
  for insert
  to public
with check (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'content'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "pages_select_hierarchy"
  on "public"."pages"
  as permissive
  for select
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'content'::text, 'read'::text) OR public.is_platform_admin()));



  create policy "pages_update_hierarchy"
  on "public"."pages"
  as permissive
  for update
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'content'::text, 'write'::text) OR public.is_platform_admin()))
with check (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'content'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "Tenant Delete Partners"
  on "public"."partners"
  as permissive
  for delete
  to authenticated
using ((tenant_id = ( SELECT public.current_tenant_id() AS current_tenant_id)));



  create policy "Tenant Insert Partners"
  on "public"."partners"
  as permissive
  for insert
  to authenticated
with check ((tenant_id = ( SELECT public.current_tenant_id() AS current_tenant_id)));



  create policy "Tenant Update Partners"
  on "public"."partners"
  as permissive
  for update
  to authenticated
using ((tenant_id = ( SELECT public.current_tenant_id() AS current_tenant_id)));



  create policy "partners_select_unified"
  on "public"."partners"
  as permissive
  for select
  to public
using (((status = 'published'::text) OR (tenant_id = ( SELECT public.current_tenant_id() AS current_tenant_id)) OR public.is_platform_admin()));



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



  create policy "platform_extension_catalog_delete"
  on "public"."platform_extension_catalog"
  as permissive
  for delete
  to authenticated
using ((( SELECT public.auth_is_admin() AS auth_is_admin) OR ( SELECT public.has_permission('platform.extensions.delete'::text) AS has_permission) OR ( SELECT public.has_permission('platform.extensions.manage'::text) AS has_permission)));



  create policy "platform_extension_catalog_insert"
  on "public"."platform_extension_catalog"
  as permissive
  for insert
  to authenticated
with check ((( SELECT public.auth_is_admin() AS auth_is_admin) OR ( SELECT public.has_permission('platform.extensions.create'::text) AS has_permission) OR ( SELECT public.has_permission('platform.extensions.manage'::text) AS has_permission)));



  create policy "platform_extension_catalog_select"
  on "public"."platform_extension_catalog"
  as permissive
  for select
  to authenticated
using (((deleted_at IS NULL) AND (( SELECT public.auth_is_admin() AS auth_is_admin) OR ( SELECT public.has_permission('platform.extensions.read'::text) AS has_permission) OR ( SELECT public.has_permission('platform.extensions.diagnostics.read'::text) AS has_permission) OR ( SELECT public.has_permission('tenant.setting.read'::text) AS has_permission))));



  create policy "platform_extension_catalog_update"
  on "public"."platform_extension_catalog"
  as permissive
  for update
  to authenticated
using ((( SELECT public.auth_is_admin() AS auth_is_admin) OR ( SELECT public.has_permission('platform.extensions.update'::text) AS has_permission) OR ( SELECT public.has_permission('platform.extensions.manage'::text) AS has_permission)))
with check ((( SELECT public.auth_is_admin() AS auth_is_admin) OR ( SELECT public.has_permission('platform.extensions.update'::text) AS has_permission) OR ( SELECT public.has_permission('platform.extensions.manage'::text) AS has_permission)));



  create policy "Authenticated users can read their platform_project"
  on "public"."platform_projects"
  as permissive
  for select
  to public
using (((auth.role() = 'authenticated'::text) AND (EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.deleted_at IS NULL) AND (u.tenant_id IN ( SELECT tenants_control.id
           FROM public.tenants_control
          WHERE (tenants_control.project_id = platform_projects.id))))))));



  create policy "Platform admins manage platform_projects"
  on "public"."platform_projects"
  as permissive
  for all
  to public
using (public.auth_is_platform_admin())
with check (public.auth_is_platform_admin());



  create policy "Platform admins can manage platform_settings"
  on "public"."platform_settings"
  as permissive
  for all
  to public
using (public.auth_is_platform_admin());



  create policy "policies_insert_unified"
  on "public"."policies"
  as permissive
  for insert
  to public
with check ((public.is_platform_admin() AND (deleted_at IS NULL)));



  create policy "policies_select_unified"
  on "public"."policies"
  as permissive
  for select
  to public
using ((((tenant_id = public.current_tenant_id()) OR (tenant_id IS NULL) OR public.is_platform_admin()) AND (deleted_at IS NULL)));



  create policy "policies_update_unified"
  on "public"."policies"
  as permissive
  for update
  to public
using (public.is_platform_admin())
with check (public.is_platform_admin());



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



  create policy "queue_dead_letters_platform_admin_select"
  on "public"."queue_dead_letters"
  as permissive
  for select
  to public
using (public.auth_is_platform_admin());



  create policy "regions_delete_admin"
  on "public"."regions"
  as permissive
  for delete
  to public
using (public.is_platform_admin());



  create policy "regions_insert_admin"
  on "public"."regions"
  as permissive
  for insert
  to public
with check (public.is_platform_admin());



  create policy "regions_select_all"
  on "public"."regions"
  as permissive
  for select
  to public
using (((is_active = true) OR public.is_platform_admin()));



  create policy "regions_update_admin"
  on "public"."regions"
  as permissive
  for update
  to public
using (public.is_platform_admin())
with check (public.is_platform_admin());



  create policy "Platform admins delete resources"
  on "public"."resources_registry"
  as permissive
  for delete
  to public
using (( SELECT public.is_platform_admin() AS is_platform_admin));



  create policy "Platform admins insert resources"
  on "public"."resources_registry"
  as permissive
  for insert
  to public
with check (( SELECT public.is_platform_admin() AS is_platform_admin));



  create policy "Platform admins update resources"
  on "public"."resources_registry"
  as permissive
  for update
  to public
using (( SELECT public.is_platform_admin() AS is_platform_admin))
with check (( SELECT public.is_platform_admin() AS is_platform_admin));



  create policy "Unified read resources"
  on "public"."resources_registry"
  as permissive
  for select
  to public
using ((( SELECT public.is_platform_admin() AS is_platform_admin) OR (active = true)));



  create policy "reusable_section_action_requests_insert"
  on "public"."reusable_section_action_requests"
  as permissive
  for insert
  to authenticated
with check (((tenant_id = public.current_tenant_id()) OR public.auth_is_admin() OR public.has_permission('platform.template.manage'::text) OR public.has_permission('tenant.setting.update'::text)));



  create policy "reusable_section_action_requests_select"
  on "public"."reusable_section_action_requests"
  as permissive
  for select
  to authenticated
using (((deleted_at IS NULL) AND ((tenant_id = public.current_tenant_id()) OR public.auth_is_admin() OR public.has_permission('platform.approvals.read'::text) OR public.has_permission('platform.template.manage'::text) OR public.has_permission('tenant.setting.read'::text))));



  create policy "reusable_section_action_requests_update"
  on "public"."reusable_section_action_requests"
  as permissive
  for update
  to authenticated
using (((deleted_at IS NULL) AND (public.auth_is_admin() OR public.has_permission('platform.approvals.read'::text) OR public.has_permission('platform.template.manage'::text))))
with check ((public.auth_is_admin() OR public.has_permission('platform.approvals.read'::text) OR public.has_permission('platform.template.manage'::text)));



  create policy "reusable_section_detach_events_delete"
  on "public"."reusable_section_detach_events"
  as permissive
  for delete
  to authenticated
using (((tenant_id = public.current_tenant_id()) OR public.auth_is_admin() OR public.has_permission('platform.template.manage'::text) OR public.has_permission('tenant.setting.update'::text)));



  create policy "reusable_section_detach_events_insert"
  on "public"."reusable_section_detach_events"
  as permissive
  for insert
  to authenticated
with check (((tenant_id = public.current_tenant_id()) OR public.auth_is_admin() OR public.has_permission('platform.template.manage'::text) OR public.has_permission('tenant.setting.update'::text)));



  create policy "reusable_section_detach_events_select"
  on "public"."reusable_section_detach_events"
  as permissive
  for select
  to authenticated
using (((deleted_at IS NULL) AND ((tenant_id = public.current_tenant_id()) OR public.auth_is_admin() OR public.has_permission('platform.template.manage'::text) OR public.has_permission('tenant.setting.read'::text))));



  create policy "reusable_section_detach_events_update"
  on "public"."reusable_section_detach_events"
  as permissive
  for update
  to authenticated
using (((deleted_at IS NULL) AND ((tenant_id = public.current_tenant_id()) OR public.auth_is_admin() OR public.has_permission('platform.template.manage'::text) OR public.has_permission('tenant.setting.update'::text))))
with check (((tenant_id = public.current_tenant_id()) OR public.auth_is_admin() OR public.has_permission('platform.template.manage'::text) OR public.has_permission('tenant.setting.update'::text)));



  create policy "reusable_section_revisions_insert"
  on "public"."reusable_section_revisions"
  as permissive
  for insert
  to authenticated
with check (((tenant_id = public.current_tenant_id()) OR (tenant_id IS NULL) OR public.auth_is_admin() OR public.has_permission('platform.template.manage'::text) OR public.has_permission('tenant.setting.update'::text)));



  create policy "reusable_section_revisions_select"
  on "public"."reusable_section_revisions"
  as permissive
  for select
  to authenticated
using (((deleted_at IS NULL) AND ((tenant_id = public.current_tenant_id()) OR public.auth_is_admin() OR public.has_permission('platform.template.manage'::text) OR public.has_permission('tenant.setting.read'::text))));



  create policy "reusable_section_usages_delete"
  on "public"."reusable_section_usages"
  as permissive
  for delete
  to authenticated
using (((tenant_id = public.current_tenant_id()) OR public.auth_is_admin() OR public.has_permission('platform.template.manage'::text) OR public.has_permission('tenant.setting.update'::text)));



  create policy "reusable_section_usages_insert"
  on "public"."reusable_section_usages"
  as permissive
  for insert
  to authenticated
with check (((tenant_id = public.current_tenant_id()) OR public.auth_is_admin() OR public.has_permission('platform.template.manage'::text) OR public.has_permission('tenant.setting.update'::text)));



  create policy "reusable_section_usages_select"
  on "public"."reusable_section_usages"
  as permissive
  for select
  to authenticated
using (((deleted_at IS NULL) AND ((tenant_id = public.current_tenant_id()) OR public.auth_is_admin() OR public.has_permission('platform.template.manage'::text) OR public.has_permission('tenant.setting.read'::text))));



  create policy "reusable_section_usages_update"
  on "public"."reusable_section_usages"
  as permissive
  for update
  to authenticated
using (((deleted_at IS NULL) AND ((tenant_id = public.current_tenant_id()) OR public.auth_is_admin() OR public.has_permission('platform.template.manage'::text) OR public.has_permission('tenant.setting.update'::text))))
with check (((tenant_id = public.current_tenant_id()) OR public.auth_is_admin() OR public.has_permission('platform.template.manage'::text) OR public.has_permission('tenant.setting.update'::text)));



  create policy "reusable_sections_insert"
  on "public"."reusable_sections"
  as permissive
  for insert
  to authenticated
with check ((((owner_tenant_id IS NULL) AND (public.auth_is_admin() OR public.has_permission('platform.template.manage'::text))) OR ((owner_tenant_id = public.current_tenant_id()) AND public.has_permission('tenant.setting.update'::text))));



  create policy "reusable_sections_select"
  on "public"."reusable_sections"
  as permissive
  for select
  to authenticated
using (((deleted_at IS NULL) AND ((owner_tenant_id IS NULL) OR (owner_tenant_id = public.current_tenant_id()) OR public.auth_is_admin() OR public.has_permission('platform.template.manage'::text) OR public.has_permission('tenant.setting.read'::text))));



  create policy "reusable_sections_update"
  on "public"."reusable_sections"
  as permissive
  for update
  to authenticated
using (((deleted_at IS NULL) AND (((owner_tenant_id IS NULL) AND (public.auth_is_admin() OR public.has_permission('platform.template.manage'::text))) OR ((owner_tenant_id = public.current_tenant_id()) AND public.has_permission('tenant.setting.update'::text)))))
with check ((((owner_tenant_id IS NULL) AND (public.auth_is_admin() OR public.has_permission('platform.template.manage'::text))) OR ((owner_tenant_id = public.current_tenant_id()) AND public.has_permission('tenant.setting.update'::text))));



  create policy "role_permissions_insert_policy"
  on "public"."role_permissions"
  as permissive
  for insert
  to authenticated
with check ((EXISTS ( SELECT 1
   FROM public.roles r
  WHERE ((r.id = role_permissions.role_id) AND ((r.tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(r.tenant_id, 'roles'::text, 'write'::text) OR public.is_platform_admin())))));



  create policy "role_permissions_select_hierarchy"
  on "public"."role_permissions"
  as permissive
  for select
  to public
using ((EXISTS ( SELECT 1
   FROM public.roles r
  WHERE ((r.id = role_permissions.role_id) AND ((r.tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(r.tenant_id, 'roles'::text, 'read'::text) OR public.is_platform_admin())))));



  create policy "role_permissions_update_hierarchy"
  on "public"."role_permissions"
  as permissive
  for update
  to authenticated
using ((EXISTS ( SELECT 1
   FROM public.roles r
  WHERE ((r.id = role_permissions.role_id) AND ((r.tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(r.tenant_id, 'roles'::text, 'write'::text) OR public.is_platform_admin())))));



  create policy "role_policies_select_hierarchy"
  on "public"."role_policies"
  as permissive
  for select
  to public
using ((EXISTS ( SELECT 1
   FROM public.roles r
  WHERE ((r.id = role_policies.role_id) AND ((r.tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(r.tenant_id, 'roles'::text, 'read'::text) OR public.is_platform_admin())))));



  create policy "role_policies_update_hierarchy"
  on "public"."role_policies"
  as permissive
  for update
  to public
using ((EXISTS ( SELECT 1
   FROM public.roles r
  WHERE ((r.id = role_policies.role_id) AND ((r.tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(r.tenant_id, 'roles'::text, 'write'::text) OR public.is_platform_admin())))))
with check ((EXISTS ( SELECT 1
   FROM public.roles r
  WHERE ((r.id = role_policies.role_id) AND ((r.tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(r.tenant_id, 'roles'::text, 'write'::text) OR public.is_platform_admin())))));



  create policy "roles_select_hierarchy"
  on "public"."roles"
  as permissive
  for select
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'roles'::text, 'read'::text) OR public.is_platform_admin() OR (tenant_id IS NULL)));



  create policy "roles_update_hierarchy"
  on "public"."roles"
  as permissive
  for update
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'roles'::text, 'write'::text) OR public.is_platform_admin()))
with check (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'roles'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "sensor_readings_access"
  on "public"."sensor_readings"
  as permissive
  for all
  to public
using (((tenant_id = ( SELECT public.current_tenant_id() AS current_tenant_id)) OR ( SELECT public.is_platform_admin() AS is_platform_admin)));



  create policy "seo_metadata_select_public"
  on "public"."seo_metadata"
  as permissive
  for select
  to public
using ((tenant_id = public.current_tenant_id()));



  create policy "services_delete_hierarchy"
  on "public"."services"
  as permissive
  for delete
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'content'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "services_insert_hierarchy"
  on "public"."services"
  as permissive
  for insert
  to public
with check (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'content'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "services_select_unified"
  on "public"."services"
  as permissive
  for select
  to public
using (((status = 'published'::text) OR ((tenant_id = ( SELECT public.current_tenant_id() AS current_tenant_id)) OR public.tenant_can_access_resource(tenant_id, 'content'::text, 'read'::text) OR public.is_platform_admin())));



  create policy "services_update_hierarchy"
  on "public"."services"
  as permissive
  for update
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'content'::text, 'write'::text) OR public.is_platform_admin()))
with check (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'content'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "settings_delete_hierarchy"
  on "public"."settings"
  as permissive
  for delete
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'settings'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "settings_insert_hierarchy"
  on "public"."settings"
  as permissive
  for insert
  to public
with check (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'settings'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "settings_select_hierarchy"
  on "public"."settings"
  as permissive
  for select
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'settings'::text, 'read'::text) OR public.is_platform_admin()));



  create policy "settings_update_hierarchy"
  on "public"."settings"
  as permissive
  for update
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'settings'::text, 'write'::text) OR public.is_platform_admin()))
with check (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'settings'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "site_blueprints_insert"
  on "public"."site_blueprints"
  as permissive
  for insert
  to authenticated
with check ((((owner_tenant_id IS NULL) AND (public.auth_is_admin() OR public.has_permission('platform.template.manage'::text))) OR ((owner_tenant_id = public.current_tenant_id()) AND public.has_permission('tenant.setting.update'::text))));



  create policy "site_blueprints_select"
  on "public"."site_blueprints"
  as permissive
  for select
  to authenticated
using (((deleted_at IS NULL) AND ((owner_tenant_id IS NULL) OR (owner_tenant_id = public.current_tenant_id()) OR public.auth_is_admin() OR public.has_permission('platform.template.manage'::text) OR public.has_permission('tenant.setting.read'::text))));



  create policy "site_blueprints_update"
  on "public"."site_blueprints"
  as permissive
  for update
  to authenticated
using (((deleted_at IS NULL) AND (((owner_tenant_id IS NULL) AND (public.auth_is_admin() OR public.has_permission('platform.template.manage'::text))) OR ((owner_tenant_id = public.current_tenant_id()) AND public.has_permission('tenant.setting.update'::text)))))
with check ((((owner_tenant_id IS NULL) AND (public.auth_is_admin() OR public.has_permission('platform.template.manage'::text))) OR ((owner_tenant_id = public.current_tenant_id()) AND public.has_permission('tenant.setting.update'::text))));



  create policy "Admins View SSO Logs"
  on "public"."sso_audit_logs"
  as permissive
  for select
  to public
using ((((tenant_id = public.current_tenant_id()) AND public.has_permission('tenant.sso.read'::text)) OR public.is_platform_admin() OR public.has_permission('platform.sso.read'::text)));



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



  create policy "Tenant Delete Teams"
  on "public"."teams"
  as permissive
  for delete
  to authenticated
using ((tenant_id = ( SELECT public.current_tenant_id() AS current_tenant_id)));



  create policy "Tenant Insert Teams"
  on "public"."teams"
  as permissive
  for insert
  to authenticated
with check ((tenant_id = ( SELECT public.current_tenant_id() AS current_tenant_id)));



  create policy "Tenant Update Teams"
  on "public"."teams"
  as permissive
  for update
  to authenticated
using ((tenant_id = ( SELECT public.current_tenant_id() AS current_tenant_id)));



  create policy "teams_select_unified"
  on "public"."teams"
  as permissive
  for select
  to public
using (((status = 'published'::text) OR (tenant_id = ( SELECT public.current_tenant_id() AS current_tenant_id)) OR public.is_platform_admin()));



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



  create policy "template_strings_select_unified"
  on "public"."template_strings"
  as permissive
  for select
  to public
using ((tenant_id = public.current_tenant_id()));



  create policy "template_strings_update_unified"
  on "public"."template_strings"
  as permissive
  for update
  to public
using (public.is_platform_admin());



  create policy "templates_delete_hierarchy"
  on "public"."templates"
  as permissive
  for delete
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'templates'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "templates_insert_hierarchy"
  on "public"."templates"
  as permissive
  for insert
  to public
with check (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'templates'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "templates_select_hierarchy"
  on "public"."templates"
  as permissive
  for select
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'templates'::text, 'read'::text) OR public.is_platform_admin()));



  create policy "templates_update_hierarchy"
  on "public"."templates"
  as permissive
  for update
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'templates'::text, 'write'::text) OR public.is_platform_admin()))
with check (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'templates'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "tenant_channels_delete"
  on "public"."tenant_channels"
  as permissive
  for delete
  to public
using (public.is_platform_admin());



  create policy "tenant_channels_insert"
  on "public"."tenant_channels"
  as permissive
  for insert
  to public
with check ((public.is_platform_admin() OR ((tenant_id = public.current_tenant_id()) AND public.is_media_manage_role())));



  create policy "tenant_channels_update"
  on "public"."tenant_channels"
  as permissive
  for update
  to public
using ((public.is_platform_admin() OR ((tenant_id = public.current_tenant_id()) AND public.is_media_manage_role())));



  create policy "Platform admins manage tenant_domains"
  on "public"."tenant_domains"
  as permissive
  for all
  to public
using (public.auth_is_platform_admin())
with check (public.auth_is_platform_admin());



  create policy "Tenant domain managers can update own domains"
  on "public"."tenant_domains"
  as permissive
  for update
  to public
using (((auth.role() = 'authenticated'::text) AND (tenant_id IN ( SELECT users.tenant_id
   FROM public.users
  WHERE ((users.id = auth.uid()) AND (users.deleted_at IS NULL))))));



  create policy "Tenant members can read own tenant_domains"
  on "public"."tenant_domains"
  as permissive
  for select
  to public
using (((auth.role() = 'authenticated'::text) AND (tenant_id IN ( SELECT users.tenant_id
   FROM public.users
  WHERE ((users.id = auth.uid()) AND (users.deleted_at IS NULL))))));



  create policy "tenant_extensions_delete"
  on "public"."tenant_extensions"
  as permissive
  for delete
  to authenticated
using ((((tenant_id = ( SELECT public.current_tenant_id() AS current_tenant_id)) AND ( SELECT public.has_permission('tenant.setting.update'::text) AS has_permission)) OR ( SELECT public.auth_is_admin() AS auth_is_admin) OR ( SELECT public.has_permission('platform.extensions.delete'::text) AS has_permission) OR ( SELECT public.has_permission('platform.extensions.manage'::text) AS has_permission)));



  create policy "tenant_extensions_insert"
  on "public"."tenant_extensions"
  as permissive
  for insert
  to authenticated
with check ((((tenant_id = ( SELECT public.current_tenant_id() AS current_tenant_id)) AND ( SELECT public.has_permission('tenant.setting.update'::text) AS has_permission)) OR ( SELECT public.auth_is_admin() AS auth_is_admin) OR ( SELECT public.has_permission('platform.extensions.update'::text) AS has_permission) OR ( SELECT public.has_permission('platform.extensions.manage'::text) AS has_permission)));



  create policy "tenant_extensions_select"
  on "public"."tenant_extensions"
  as permissive
  for select
  to authenticated
using (((deleted_at IS NULL) AND (((tenant_id = ( SELECT public.current_tenant_id() AS current_tenant_id)) AND (( SELECT public.has_permission('tenant.setting.read'::text) AS has_permission) OR ( SELECT public.has_permission('tenant.setting.update'::text) AS has_permission))) OR ( SELECT public.auth_is_admin() AS auth_is_admin) OR ( SELECT public.has_permission('platform.extensions.read'::text) AS has_permission))));



  create policy "tenant_extensions_update"
  on "public"."tenant_extensions"
  as permissive
  for update
  to authenticated
using ((((tenant_id = ( SELECT public.current_tenant_id() AS current_tenant_id)) AND ( SELECT public.has_permission('tenant.setting.update'::text) AS has_permission)) OR ( SELECT public.auth_is_admin() AS auth_is_admin) OR ( SELECT public.has_permission('platform.extensions.update'::text) AS has_permission) OR ( SELECT public.has_permission('platform.extensions.manage'::text) AS has_permission)))
with check ((((tenant_id = ( SELECT public.current_tenant_id() AS current_tenant_id)) AND ( SELECT public.has_permission('tenant.setting.update'::text) AS has_permission)) OR ( SELECT public.auth_is_admin() AS auth_is_admin) OR ( SELECT public.has_permission('platform.extensions.update'::text) AS has_permission) OR ( SELECT public.has_permission('platform.extensions.manage'::text) AS has_permission)));



  create policy "Platform admins manage tenant_migrations"
  on "public"."tenant_migrations"
  as permissive
  for all
  to public
using (public.auth_is_platform_admin())
with check (public.auth_is_platform_admin());



  create policy "Tenant members can read own tenant_migrations"
  on "public"."tenant_migrations"
  as permissive
  for select
  to public
using (((auth.role() = 'authenticated'::text) AND (tenant_id IN ( SELECT users.tenant_id
   FROM public.users
  WHERE ((users.id = auth.uid()) AND (users.deleted_at IS NULL))))));



  create policy "tnc_insert"
  on "public"."tenant_notification_channels"
  as permissive
  for insert
  to public
with check (((tenant_id = public.current_tenant_id()) AND public.has_permission('tenant.notifications.manage'::text)));



  create policy "tnc_select"
  on "public"."tenant_notification_channels"
  as permissive
  for select
  to public
using (((tenant_id = public.current_tenant_id()) AND (deleted_at IS NULL) AND public.has_permission('tenant.notifications.read'::text)));



  create policy "tnc_update"
  on "public"."tenant_notification_channels"
  as permissive
  for update
  to public
using (((tenant_id = public.current_tenant_id()) AND (deleted_at IS NULL) AND public.has_permission('tenant.notifications.manage'::text)))
with check ((tenant_id = public.current_tenant_id()));



  create policy "tenant_resource_rules_delete"
  on "public"."tenant_resource_rules"
  as permissive
  for delete
  to public
using ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()));



  create policy "tenant_resource_rules_insert"
  on "public"."tenant_resource_rules"
  as permissive
  for insert
  to public
with check ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()));



  create policy "tenant_resource_rules_select"
  on "public"."tenant_resource_rules"
  as permissive
  for select
  to authenticated
using (((tenant_id = public.current_tenant_id()) OR public.is_platform_admin()));



  create policy "tenant_resource_rules_update"
  on "public"."tenant_resource_rules"
  as permissive
  for update
  to public
using ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()))
with check ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()));



  create policy "tenant_role_links_delete"
  on "public"."tenant_role_links"
  as permissive
  for delete
  to public
using ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()));



  create policy "tenant_role_links_insert"
  on "public"."tenant_role_links"
  as permissive
  for insert
  to public
with check ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()));



  create policy "tenant_role_links_select"
  on "public"."tenant_role_links"
  as permissive
  for select
  to authenticated
using (((tenant_id = public.current_tenant_id()) OR public.is_platform_admin()));



  create policy "tenant_role_links_update"
  on "public"."tenant_role_links"
  as permissive
  for update
  to public
using ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()))
with check ((((tenant_id = public.current_tenant_id()) AND public.is_admin_or_above()) OR public.is_platform_admin()));



  create policy "Platform admins manage tenant_service_contracts"
  on "public"."tenant_service_contracts"
  as permissive
  for all
  to public
using (public.auth_is_platform_admin())
with check (public.auth_is_platform_admin());



  create policy "Tenant members can read own service_contracts"
  on "public"."tenant_service_contracts"
  as permissive
  for select
  to public
using (((auth.role() = 'authenticated'::text) AND (tenant_id IN ( SELECT users.tenant_id
   FROM public.users
  WHERE ((users.id = auth.uid()) AND (users.deleted_at IS NULL))))));



  create policy "tenant_site_blueprint_state_insert"
  on "public"."tenant_site_blueprint_state"
  as permissive
  for insert
  to authenticated
with check (((tenant_id = public.current_tenant_id()) OR public.auth_is_admin() OR public.has_permission('platform.template.manage'::text) OR public.has_permission('tenant.setting.update'::text)));



  create policy "tenant_site_blueprint_state_select"
  on "public"."tenant_site_blueprint_state"
  as permissive
  for select
  to authenticated
using (((deleted_at IS NULL) AND ((tenant_id = public.current_tenant_id()) OR public.auth_is_admin() OR public.has_permission('platform.template.manage'::text) OR public.has_permission('tenant.setting.read'::text))));



  create policy "tenant_site_blueprint_state_update"
  on "public"."tenant_site_blueprint_state"
  as permissive
  for update
  to authenticated
using (((deleted_at IS NULL) AND ((tenant_id = public.current_tenant_id()) OR public.auth_is_admin() OR public.has_permission('platform.template.manage'::text) OR public.has_permission('tenant.setting.update'::text))))
with check (((tenant_id = public.current_tenant_id()) OR public.auth_is_admin() OR public.has_permission('platform.template.manage'::text) OR public.has_permission('tenant.setting.update'::text)));



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



  create policy "Platform admins manage tenants_control"
  on "public"."tenants_control"
  as permissive
  for all
  to public
using (public.auth_is_platform_admin())
with check (public.auth_is_platform_admin());



  create policy "Tenant members can read their own tenants_control row"
  on "public"."tenants_control"
  as permissive
  for select
  to public
using (((auth.role() = 'authenticated'::text) AND (id IN ( SELECT users.tenant_id
   FROM public.users
  WHERE ((users.id = auth.uid()) AND (users.deleted_at IS NULL))))));



  create policy "testimonies_delete_hierarchy"
  on "public"."testimonies"
  as permissive
  for delete
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'content'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "testimonies_insert_hierarchy"
  on "public"."testimonies"
  as permissive
  for insert
  to public
with check (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'content'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "testimonies_select_hierarchy"
  on "public"."testimonies"
  as permissive
  for select
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'content'::text, 'read'::text) OR public.is_platform_admin()));



  create policy "testimonies_update_hierarchy"
  on "public"."testimonies"
  as permissive
  for update
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'content'::text, 'write'::text) OR public.is_platform_admin()))
with check (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'content'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "themes_delete_hierarchy"
  on "public"."themes"
  as permissive
  for delete
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'branding'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "themes_insert_hierarchy"
  on "public"."themes"
  as permissive
  for insert
  to public
with check (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'branding'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "themes_select_hierarchy"
  on "public"."themes"
  as permissive
  for select
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'branding'::text, 'read'::text) OR public.is_platform_admin()));



  create policy "themes_update_hierarchy"
  on "public"."themes"
  as permissive
  for update
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'branding'::text, 'write'::text) OR public.is_platform_admin()))
with check (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'branding'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "Platform admins delete schemas"
  on "public"."ui_configs"
  as permissive
  for delete
  to public
using (public.is_platform_admin());



  create policy "Platform admins insert schemas"
  on "public"."ui_configs"
  as permissive
  for insert
  to public
with check (public.is_platform_admin());



  create policy "Platform admins update schemas"
  on "public"."ui_configs"
  as permissive
  for update
  to public
using (public.is_platform_admin())
with check (public.is_platform_admin());



  create policy "Unified read schemas"
  on "public"."ui_configs"
  as permissive
  for select
  to public
using ((( SELECT public.is_platform_admin() AS is_platform_admin) OR (tenant_id IS NULL) OR (tenant_id = ( SELECT users.tenant_id
   FROM public.users
  WHERE (users.id = ( SELECT auth.uid() AS uid))))));



  create policy "user_profile_admin_insert_admin"
  on "public"."user_profile_admin"
  as permissive
  for insert
  to public
with check ((public.is_platform_admin() OR public.tenant_can_access_resource(tenant_id, 'users'::text, 'write'::text) OR ((tenant_id = public.current_tenant_id()) AND (public.is_admin_or_above() OR public.has_permission('tenant.user.update'::text)))));



  create policy "user_profile_admin_select_admin"
  on "public"."user_profile_admin"
  as permissive
  for select
  to public
using ((public.is_platform_admin() OR public.tenant_can_access_resource(tenant_id, 'users'::text, 'write'::text) OR ((tenant_id = public.current_tenant_id()) AND (public.is_admin_or_above() OR public.has_permission('tenant.user.update'::text)))));



  create policy "user_profile_admin_update_admin"
  on "public"."user_profile_admin"
  as permissive
  for update
  to public
using ((public.is_platform_admin() OR public.tenant_can_access_resource(tenant_id, 'users'::text, 'write'::text) OR ((tenant_id = public.current_tenant_id()) AND (public.is_admin_or_above() OR public.has_permission('tenant.user.update'::text)))))
with check ((public.is_platform_admin() OR public.tenant_can_access_resource(tenant_id, 'users'::text, 'write'::text) OR ((tenant_id = public.current_tenant_id()) AND (public.is_admin_or_above() OR public.has_permission('tenant.user.update'::text)))));



  create policy "user_profiles_insert_self_or_admin"
  on "public"."user_profiles"
  as permissive
  for insert
  to public
with check ((( SELECT public.is_platform_admin() AS is_platform_admin) OR public.tenant_can_access_resource(tenant_id, 'users'::text, 'write'::text) OR ((tenant_id = ( SELECT public.current_tenant_id() AS current_tenant_id)) AND ((user_id = ( SELECT auth.uid() AS uid)) OR ( SELECT public.is_admin_or_above() AS is_admin_or_above) OR ( SELECT public.has_permission('tenant.user.update'::text) AS has_permission)))));



  create policy "user_profiles_select_self_or_admin"
  on "public"."user_profiles"
  as permissive
  for select
  to public
using ((( SELECT public.is_platform_admin() AS is_platform_admin) OR public.tenant_can_access_resource(tenant_id, 'users'::text, 'read'::text) OR ((tenant_id = ( SELECT public.current_tenant_id() AS current_tenant_id)) AND ((user_id = ( SELECT auth.uid() AS uid)) OR ( SELECT public.is_admin_or_above() AS is_admin_or_above) OR ( SELECT public.has_permission('tenant.user.update'::text) AS has_permission)))));



  create policy "user_profiles_update_self_or_admin"
  on "public"."user_profiles"
  as permissive
  for update
  to public
using ((( SELECT public.is_platform_admin() AS is_platform_admin) OR public.tenant_can_access_resource(tenant_id, 'users'::text, 'write'::text) OR ((tenant_id = ( SELECT public.current_tenant_id() AS current_tenant_id)) AND ((user_id = ( SELECT auth.uid() AS uid)) OR ( SELECT public.is_admin_or_above() AS is_admin_or_above) OR ( SELECT public.has_permission('tenant.user.update'::text) AS has_permission)))))
with check ((( SELECT public.is_platform_admin() AS is_platform_admin) OR public.tenant_can_access_resource(tenant_id, 'users'::text, 'write'::text) OR ((tenant_id = ( SELECT public.current_tenant_id() AS current_tenant_id)) AND ((user_id = ( SELECT auth.uid() AS uid)) OR ( SELECT public.is_admin_or_above() AS is_admin_or_above) OR ( SELECT public.has_permission('tenant.user.update'::text) AS has_permission)))));



  create policy "users_select_hierarchy"
  on "public"."users"
  as permissive
  for select
  to public
using ((( SELECT public.is_platform_admin() AS is_platform_admin) OR (tenant_id = ( SELECT public.current_tenant_id() AS current_tenant_id)) OR public.tenant_can_access_resource(tenant_id, 'users'::text, 'read'::text)));



  create policy "users_update_hierarchy"
  on "public"."users"
  as permissive
  for update
  to public
using ((( SELECT public.is_platform_admin() AS is_platform_admin) OR ((tenant_id = ( SELECT public.current_tenant_id() AS current_tenant_id)) AND ((id = ( SELECT auth.uid() AS uid)) OR ( SELECT public.caller_has_permission('tenant.user.update'::text) AS caller_has_permission))) OR public.tenant_can_access_resource(tenant_id, 'users'::text, 'write'::text)));



  create policy "widgets_delete_hierarchy"
  on "public"."widgets"
  as permissive
  for delete
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'widgets'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "widgets_insert_hierarchy"
  on "public"."widgets"
  as permissive
  for insert
  to public
with check (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'widgets'::text, 'write'::text) OR public.is_platform_admin()));



  create policy "widgets_select_hierarchy"
  on "public"."widgets"
  as permissive
  for select
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'widgets'::text, 'read'::text) OR public.is_platform_admin()));



  create policy "widgets_update_hierarchy"
  on "public"."widgets"
  as permissive
  for update
  to public
using (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'widgets'::text, 'write'::text) OR public.is_platform_admin()))
with check (((tenant_id = public.current_tenant_id()) OR public.tenant_can_access_resource(tenant_id, 'widgets'::text, 'write'::text) OR public.is_platform_admin()));


CREATE TRIGGER audit_account_requests AFTER INSERT OR DELETE OR UPDATE ON public.account_requests FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();

CREATE TRIGGER audit_log_changes_admin_menus AFTER INSERT OR DELETE OR UPDATE ON public.admin_menus FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();

CREATE TRIGGER handle_updated_at BEFORE UPDATE ON public.administrative_regions FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER analytics_events_rollup AFTER INSERT ON public.analytics_events FOR EACH ROW EXECUTE FUNCTION public.update_analytics_daily();

CREATE TRIGGER lock_created_by_trg BEFORE UPDATE ON public.announcements FOR EACH ROW EXECUTE FUNCTION public.lock_created_by();

CREATE TRIGGER set_created_by_trg BEFORE INSERT ON public.announcements FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

CREATE TRIGGER trg_set_tenant_id BEFORE INSERT ON public.announcements FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id();

CREATE TRIGGER update_announcements_updated_at BEFORE UPDATE ON public.announcements FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER lock_created_by_trg BEFORE UPDATE ON public.auth_hibp_events FOR EACH ROW EXECUTE FUNCTION public.lock_created_by();

CREATE TRIGGER set_created_by_trg BEFORE INSERT ON public.auth_hibp_events FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

CREATE TRIGGER lock_created_by_trg BEFORE UPDATE ON public.backup_logs FOR EACH ROW EXECUTE FUNCTION public.lock_created_by();

CREATE TRIGGER set_created_by_trg BEFORE INSERT ON public.backup_logs FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

CREATE TRIGGER lock_created_by_trg BEFORE UPDATE ON public.backup_schedules FOR EACH ROW EXECUTE FUNCTION public.lock_created_by();

CREATE TRIGGER set_created_by_trg BEFORE INSERT ON public.backup_schedules FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

CREATE TRIGGER lock_created_by_trg BEFORE UPDATE ON public.backups FOR EACH ROW EXECUTE FUNCTION public.lock_created_by();

CREATE TRIGGER set_created_by_trg BEFORE INSERT ON public.backups FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

CREATE TRIGGER lock_created_by_trg BEFORE UPDATE ON public.blog_tags FOR EACH ROW EXECUTE FUNCTION public.lock_created_by();

CREATE TRIGGER set_created_by_trg BEFORE INSERT ON public.blog_tags FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

CREATE TRIGGER lock_created_by_trg BEFORE UPDATE ON public.blogs FOR EACH ROW EXECUTE FUNCTION public.lock_created_by();

CREATE TRIGGER request_public_rebuild_on_blogs AFTER INSERT OR DELETE OR UPDATE ON public.blogs FOR EACH ROW EXECUTE FUNCTION public.request_public_rebuild();

CREATE TRIGGER set_created_by_trg BEFORE INSERT ON public.blogs FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

CREATE TRIGGER trg_articles_audit AFTER INSERT OR DELETE OR UPDATE ON public.blogs FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();

CREATE TRIGGER trg_set_tenant_id BEFORE INSERT ON public.blogs FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id();

CREATE TRIGGER update_articles_updated_at BEFORE UPDATE ON public.blogs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER lock_created_by_trg BEFORE UPDATE ON public.categories FOR EACH ROW EXECUTE FUNCTION public.lock_created_by();

CREATE TRIGGER set_created_by_trg BEFORE INSERT ON public.categories FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

CREATE TRIGGER trg_set_tenant_id BEFORE INSERT ON public.categories FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id();

CREATE TRIGGER lock_created_by_trg BEFORE UPDATE ON public.contact_messages FOR EACH ROW EXECUTE FUNCTION public.lock_created_by();

CREATE TRIGGER set_created_by_trg BEFORE INSERT ON public.contact_messages FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

CREATE TRIGGER trg_set_tenant_id BEFORE INSERT ON public.contact_messages FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id();

CREATE TRIGGER lock_created_by_trg BEFORE UPDATE ON public.contacts FOR EACH ROW EXECUTE FUNCTION public.lock_created_by();

CREATE TRIGGER set_created_by_trg BEFORE INSERT ON public.contacts FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

CREATE TRIGGER trg_deployment_cells_updated_at BEFORE UPDATE ON public.deployment_cells FOR EACH ROW EXECUTE FUNCTION public.set_deployment_cells_updated_at();

CREATE TRIGGER lock_created_by_trg BEFORE UPDATE ON public.extension_menu_items FOR EACH ROW EXECUTE FUNCTION public.lock_created_by();

CREATE TRIGGER set_created_by_trg BEFORE INSERT ON public.extension_menu_items FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

CREATE TRIGGER set_extension_menu_items_tenant_id BEFORE INSERT OR UPDATE ON public.extension_menu_items FOR EACH ROW EXECUTE FUNCTION public.set_extension_tenant_id();

CREATE TRIGGER lock_created_by_trg BEFORE UPDATE ON public.extension_permissions FOR EACH ROW EXECUTE FUNCTION public.lock_created_by();

CREATE TRIGGER set_created_by_trg BEFORE INSERT ON public.extension_permissions FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

CREATE TRIGGER set_extension_permissions_tenant_id BEFORE INSERT OR UPDATE ON public.extension_permissions FOR EACH ROW EXECUTE FUNCTION public.set_extension_tenant_id();

CREATE TRIGGER lock_created_by_trg BEFORE UPDATE ON public.extension_rbac_integration FOR EACH ROW EXECUTE FUNCTION public.lock_created_by();

CREATE TRIGGER set_created_by_trg BEFORE INSERT ON public.extension_rbac_integration FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

CREATE TRIGGER set_extension_rbac_integration_tenant_id BEFORE INSERT OR UPDATE ON public.extension_rbac_integration FOR EACH ROW EXECUTE FUNCTION public.set_extension_tenant_id();

CREATE TRIGGER lock_created_by_trg BEFORE UPDATE ON public.extension_routes FOR EACH ROW EXECUTE FUNCTION public.lock_created_by();

CREATE TRIGGER set_created_by_trg BEFORE INSERT ON public.extension_routes FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

CREATE TRIGGER trg_set_tenant_id BEFORE INSERT ON public.extension_routes FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id();

CREATE TRIGGER update_extension_routes_updated_at BEFORE UPDATE ON public.extension_routes FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER lock_created_by_trg BEFORE UPDATE ON public.extension_routes_registry FOR EACH ROW EXECUTE FUNCTION public.lock_created_by();

CREATE TRIGGER set_created_by_trg BEFORE INSERT ON public.extension_routes_registry FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

CREATE TRIGGER set_extension_routes_registry_tenant_id BEFORE INSERT OR UPDATE ON public.extension_routes_registry FOR EACH ROW EXECUTE FUNCTION public.set_extension_tenant_id();

CREATE TRIGGER extension_audit_trigger AFTER INSERT OR DELETE OR UPDATE ON public.extensions FOR EACH ROW EXECUTE FUNCTION public.log_extension_change();

CREATE TRIGGER lock_created_by_trg BEFORE UPDATE ON public.extensions FOR EACH ROW EXECUTE FUNCTION public.lock_created_by();

CREATE TRIGGER set_created_by_trg BEFORE INSERT ON public.extensions FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

CREATE TRIGGER trg_set_tenant_id BEFORE INSERT ON public.extensions FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id();

CREATE TRIGGER update_extensions_updated_at BEFORE UPDATE ON public.extensions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER lock_created_by_trg BEFORE UPDATE ON public.menu_permissions FOR EACH ROW EXECUTE FUNCTION public.lock_created_by();

CREATE TRIGGER set_created_by_trg BEFORE INSERT ON public.menu_permissions FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

CREATE TRIGGER lock_created_by_trg BEFORE UPDATE ON public.menus FOR EACH ROW EXECUTE FUNCTION public.lock_created_by();

CREATE TRIGGER request_public_rebuild_on_menus AFTER INSERT OR DELETE OR UPDATE ON public.menus FOR EACH ROW EXECUTE FUNCTION public.request_public_rebuild();

CREATE TRIGGER set_created_by_trg BEFORE INSERT ON public.menus FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

CREATE TRIGGER trg_set_tenant_id BEFORE INSERT ON public.menus FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id();

CREATE TRIGGER update_notifications_updated_at BEFORE UPDATE ON public.notifications FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER audit_orders AFTER INSERT OR DELETE OR UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();

CREATE TRIGGER trg_set_tenant_id BEFORE INSERT ON public.orders FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id();

CREATE TRIGGER lock_created_by_trg BEFORE UPDATE ON public.page_categories FOR EACH ROW EXECUTE FUNCTION public.lock_created_by();

CREATE TRIGGER set_created_by_trg BEFORE INSERT ON public.page_categories FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

CREATE TRIGGER lock_created_by_trg BEFORE UPDATE ON public.pages FOR EACH ROW EXECUTE FUNCTION public.lock_created_by();

CREATE TRIGGER request_public_rebuild_on_pages AFTER INSERT OR DELETE OR UPDATE ON public.pages FOR EACH ROW EXECUTE FUNCTION public.request_public_rebuild();

CREATE TRIGGER set_created_by_trg BEFORE INSERT ON public.pages FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

CREATE TRIGGER trg_set_tenant_id BEFORE INSERT ON public.pages FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id();

CREATE TRIGGER update_pages_updated_at BEFORE UPDATE ON public.pages FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER audit_log_changes_permissions AFTER INSERT OR DELETE OR UPDATE ON public.permissions FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();

CREATE TRIGGER lock_created_by_trg BEFORE UPDATE ON public.permissions FOR EACH ROW EXECUTE FUNCTION public.lock_created_by();

CREATE TRIGGER set_created_by_trg BEFORE INSERT ON public.permissions FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

CREATE TRIGGER trg_platform_projects_updated_at BEFORE UPDATE ON public.platform_projects FOR EACH ROW EXECUTE FUNCTION public.set_platform_projects_updated_at();

CREATE TRIGGER trg_platform_settings_updated_at BEFORE UPDATE ON public.platform_settings FOR EACH ROW EXECUTE FUNCTION public.set_platform_settings_updated_at();

CREATE TRIGGER audit_log_changes_policies AFTER INSERT OR DELETE OR UPDATE ON public.policies FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();

CREATE TRIGGER lock_created_by_trg BEFORE UPDATE ON public.portfolio FOR EACH ROW EXECUTE FUNCTION public.lock_created_by();

CREATE TRIGGER set_created_by_trg BEFORE INSERT ON public.portfolio FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

CREATE TRIGGER trg_set_tenant_id BEFORE INSERT ON public.portfolio FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id();

CREATE TRIGGER update_portfolio_updated_at BEFORE UPDATE ON public.portfolio FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER lock_created_by_trg BEFORE UPDATE ON public.product_types FOR EACH ROW EXECUTE FUNCTION public.lock_created_by();

CREATE TRIGGER set_created_by_trg BEFORE INSERT ON public.product_types FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

CREATE TRIGGER trg_set_tenant_id BEFORE INSERT ON public.product_types FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id();

CREATE TRIGGER audit_products AFTER INSERT OR DELETE OR UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();

CREATE TRIGGER lock_created_by_trg BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.lock_created_by();

CREATE TRIGGER set_created_by_trg BEFORE INSERT ON public.products FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

CREATE TRIGGER trg_set_tenant_id BEFORE INSERT ON public.products FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id();

CREATE TRIGGER update_products_updated_at BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER lock_created_by_trg BEFORE UPDATE ON public.promotions FOR EACH ROW EXECUTE FUNCTION public.lock_created_by();

CREATE TRIGGER set_created_by_trg BEFORE INSERT ON public.promotions FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

CREATE TRIGGER trg_set_tenant_id BEFORE INSERT ON public.promotions FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id();

CREATE TRIGGER update_promotions_updated_at BEFORE UPDATE ON public.promotions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER handle_updated_at BEFORE UPDATE ON public.regions FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

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

CREATE TRIGGER harden_platform_settings_trigger BEFORE INSERT OR DELETE OR UPDATE ON public.settings FOR EACH ROW EXECUTE FUNCTION public.harden_platform_settings_rls();

CREATE TRIGGER lock_created_by_trg BEFORE UPDATE ON public.tags FOR EACH ROW EXECUTE FUNCTION public.lock_created_by();

CREATE TRIGGER set_created_by_trg BEFORE INSERT ON public.tags FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

CREATE TRIGGER trg_set_tenant_id BEFORE INSERT ON public.tags FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id();

CREATE TRIGGER update_template_assignments_updated_at BEFORE UPDATE ON public.template_assignments FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_template_parts_updated_at BEFORE UPDATE ON public.template_parts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_template_strings_updated_at BEFORE UPDATE ON public.template_strings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER audit_log_changes_templates AFTER INSERT OR DELETE OR UPDATE ON public.templates FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();

CREATE TRIGGER trg_set_tenant_id BEFORE INSERT ON public.templates FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id();

CREATE TRIGGER update_templates_updated_at BEFORE UPDATE ON public.templates FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_tenant_domains_updated_at BEFORE UPDATE ON public.tenant_domains FOR EACH ROW EXECUTE FUNCTION public.set_tenant_domains_updated_at();

CREATE TRIGGER trg_tenant_migrations_updated_at BEFORE UPDATE ON public.tenant_migrations FOR EACH ROW EXECUTE FUNCTION public.set_tenant_migrations_updated_at();

CREATE TRIGGER audit_log_changes_tenants AFTER INSERT OR DELETE OR UPDATE ON public.tenants FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();

CREATE TRIGGER refresh_tenant_subtree AFTER UPDATE OF parent_tenant_id ON public.tenants FOR EACH ROW WHEN ((old.parent_tenant_id IS DISTINCT FROM new.parent_tenant_id)) EXECUTE FUNCTION public.refresh_tenant_subtree_trigger();

CREATE TRIGGER set_tenant_hierarchy BEFORE INSERT OR UPDATE OF parent_tenant_id ON public.tenants FOR EACH ROW EXECUTE FUNCTION public.set_tenant_hierarchy();

CREATE TRIGGER trg_tenants_control_updated_at BEFORE UPDATE ON public.tenants_control FOR EACH ROW EXECUTE FUNCTION public.set_tenants_control_updated_at();

CREATE TRIGGER lock_created_by_trg BEFORE UPDATE ON public.testimonies FOR EACH ROW EXECUTE FUNCTION public.lock_created_by();

CREATE TRIGGER set_created_by_trg BEFORE INSERT ON public.testimonies FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

CREATE TRIGGER trg_set_tenant_id BEFORE INSERT ON public.testimonies FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id();

CREATE TRIGGER update_testimonies_updated_at BEFORE UPDATE ON public.testimonies FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_set_tenant_id BEFORE INSERT ON public.themes FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id();

CREATE TRIGGER trigger_ensure_single_active_theme BEFORE INSERT OR UPDATE OF is_active ON public.themes FOR EACH ROW EXECUTE FUNCTION public.ensure_single_active_theme();

CREATE TRIGGER set_created_by_trg BEFORE INSERT ON public.user_profile_admin FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

CREATE TRIGGER update_user_profile_admin_updated_at BEFORE UPDATE ON public.user_profile_admin FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER set_created_by_trg BEFORE INSERT ON public.user_profiles FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

CREATE TRIGGER trigger_user_profiles_rekey_admin AFTER UPDATE OF description ON public.user_profiles FOR EACH ROW EXECUTE FUNCTION public.rekey_user_profile_admin_fields();

CREATE TRIGGER update_user_profiles_updated_at BEFORE UPDATE ON public.user_profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER audit_log_changes_users AFTER INSERT OR DELETE OR UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();

CREATE TRIGGER lock_created_by_trg BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.lock_created_by();

CREATE TRIGGER set_created_by_trg BEFORE INSERT ON public.users FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

CREATE TRIGGER tr_enforce_user_limit BEFORE INSERT ON public.users FOR EACH ROW EXECUTE FUNCTION public.enforce_user_limit();

CREATE TRIGGER trigger_create_user_profile AFTER INSERT ON public.users FOR EACH ROW EXECUTE FUNCTION public.create_user_profile();

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_widgets_updated_at BEFORE UPDATE ON public.widgets FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

drop trigger if exists "on_auth_user_created" on "auth"."users";

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


  create policy "public_read_files"
  on "storage"."objects"
  as permissive
  for select
  to public
using ((bucket_id = 'cms-uploads'::text));



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


CREATE TRIGGER enforce_bucket_name_length_trigger BEFORE INSERT OR UPDATE OF name ON storage.buckets FOR EACH ROW EXECUTE FUNCTION storage.enforce_bucket_name_length();

CREATE TRIGGER tr_sync_storage_to_files AFTER INSERT OR DELETE OR UPDATE ON storage.objects FOR EACH ROW EXECUTE FUNCTION public.handle_storage_sync();

CREATE TRIGGER update_objects_updated_at BEFORE UPDATE ON storage.objects FOR EACH ROW EXECUTE FUNCTION storage.update_updated_at_column();


