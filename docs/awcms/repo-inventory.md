# AWCMS Repository Inventory (generated)

> **GENERATED BLOCK — jangan edit tabel di bawah penanda secara manual.** Tabel
> di antara `<!-- BEGIN GENERATED: repo-inventory -->

### Ringkasan

| Aspek                              | Nilai |
| ---------------------------------- | ----- |
| Modul terdaftar                    | 22    |
| Migrasi                            | 97    |
| Tabel `awcms_*`                    | 130   |
| Tabel dengan `FORCE` RLS           | 119   |
| Tabel RLS-free (global, by design) | 11    |
| Berkas test                        | 336   |
| Berkas route                       | 318   |
| ADR                                | 77    |

### Modul

| Key                    | Version | Status | Type   | Core  | Dependencies                                                                                       |
| ---------------------- | ------- | ------ | ------ | ----- | -------------------------------------------------------------------------------------------------- |
| `logging`              | 1.0.0   | active | —      | tidak | `tenant_admin`                                                                                     |
| `tenant_admin`         | 1.0.0   | active | —      | tidak | —                                                                                                  |
| `profile_identity`     | 1.0.0   | active | —      | tidak | `tenant_admin`                                                                                     |
| `identity_access`      | 1.0.0   | active | —      | tidak | `tenant_admin`, `profile_identity`                                                                 |
| `module_management`    | 0.1.0   | active | system | ya    | `tenant_admin`, `identity_access`                                                                  |
| `domain_event_runtime` | 0.1.0   | active | system | tidak | `tenant_admin`, `identity_access`, `logging`                                                       |
| `sync_storage`         | 1.0.0   | active | system | tidak | `tenant_admin`                                                                                     |
| `workflow`             | 2.0.0   | active | system | tidak | `tenant_admin`, `identity_access`, `domain_event_runtime`                                          |
| `email`                | 0.5.0   | active | —      | tidak | `tenant_admin`, `profile_identity`, `identity_access`                                              |
| `reporting`            | 1.2.0   | active | —      | tidak | `tenant_admin`, `identity_access`, `sync_storage`, `email`, `domain_event_runtime`                 |
| `theming`              | 1.0.0   | active | domain | tidak | `tenant_admin`, `identity_access`, `module_management`                                             |
| `media_library`        | 0.1.0   | active | system | tidak | `tenant_admin`, `identity_access`                                                                  |
| `blog_content`         | 0.12.0  | active | domain | tidak | `tenant_admin`, `identity_access`, `module_management`, `logging`                                  |
| `tenant_domain`        | 0.1.0   | active | domain | tidak | `tenant_admin`, `identity_access`                                                                  |
| `visitor_analytics`    | 0.1.0   | active | system | tidak | `tenant_admin`, `identity_access`, `logging`, `data_lifecycle`, `module_management`                |
| `data_lifecycle`       | 0.1.0   | active | system | tidak | `tenant_admin`, `identity_access`, `logging`                                                       |
| `seo_distribution`     | 0.2.0   | active | domain | tidak | `tenant_admin`, `identity_access`, `module_management`                                             |
| `form_drafts`          | 0.1.0   | active | system | tidak | `identity_access`                                                                                  |
| `site_search`          | 0.1.0   | active | domain | tidak | `tenant_admin`, `identity_access`, `module_management`                                             |
| `comments`             | 0.1.0   | active | domain | tidak | `tenant_admin`, `identity_access`, `module_management`, `profile_identity`, `domain_event_runtime` |
| `idn_admin_regions`    | 0.1.0   | active | system | tidak | `tenant_admin`, `identity_access`                                                                  |
| `push_delivery`        | 0.1.0   | active | —      | tidak | `tenant_admin`, `logging`                                                                          |

### Migrasi

| #   | File                                                               |
| --- | ------------------------------------------------------------------ |
| 1   | `sql/001_awcms_foundation_schema.sql`                              |
| 2   | `sql/002_awcms_tenant_office_schema.sql`                           |
| 3   | `sql/003_awcms_central_profile_schema.sql`                         |
| 4   | `sql/004_awcms_identity_login_schema.sql`                          |
| 5   | `sql/005_awcms_abac_access_control_schema.sql`                     |
| 6   | `sql/006_awcms_setup_wizard_schema.sql`                            |
| 7   | `sql/007_awcms_audit_logging_schema.sql`                           |
| 8   | `sql/008_awcms_module_management_schema.sql`                       |
| 9   | `sql/009_awcms_domain_event_runtime_schema.sql`                    |
| 10  | `sql/010_awcms_sync_storage_outbox_inbox_schema.sql`               |
| 11  | `sql/011_awcms_sync_storage_conflict_schema.sql`                   |
| 12  | `sql/012_awcms_object_sync_queue_schema.sql`                       |
| 13  | `sql/013_awcms_workflow_approval_schema.sql`                       |
| 14  | `sql/014_awcms_email_schema.sql`                                   |
| 15  | `sql/015_awcms_reporting_projections_schema.sql`                   |
| 16  | `sql/016_awcms_reporting_permissions.sql`                          |
| 17  | `sql/017_awcms_enforce_rls_force.sql`                              |
| 18  | `sql/018_awcms_workflow_concurrency.sql`                           |
| 19  | `sql/019_awcms_db_role_separation.sql`                             |
| 20  | `sql/020_awcms_offices_tenant_scoped_fk.sql`                       |
| 21  | `sql/021_awcms_db_role_grants_narrow.sql`                          |
| 22  | `sql/022_awcms_db_worker_setup_roles.sql`                          |
| 23  | `sql/023_awcms_seed_office_management_delete_permission.sql`       |
| 24  | `sql/024_awcms_mfa_totp_schema.sql`                                |
| 25  | `sql/025_awcms_oidc_sso_schema.sql`                                |
| 26  | `sql/026_awcms_seed_sso_permissions.sql`                           |
| 27  | `sql/027_awcms_business_scope_assignments_schema.sql`              |
| 28  | `sql/028_awcms_business_scope_permissions.sql`                     |
| 29  | `sql/029_awcms_sod_schema.sql`                                     |
| 30  | `sql/030_awcms_sod_permissions.sql`                                |
| 31  | `sql/031_awcms_abac_policy_dsl_schema.sql`                         |
| 32  | `sql/032_awcms_abac_policy_admin_permissions.sql`                  |
| 33  | `sql/033_awcms_theming_config_schema.sql`                          |
| 34  | `sql/034_awcms_theming_permissions.sql`                            |
| 35  | `sql/035_awcms_blog_content_schema.sql`                            |
| 36  | `sql/036_awcms_blog_content_permissions.sql`                       |
| 37  | `sql/037_awcms_blog_content_presentation_schema.sql`               |
| 38  | `sql/038_awcms_blog_content_presentation_permissions.sql`          |
| 39  | `sql/039_awcms_blog_content_internal_tag_links_schema.sql`         |
| 40  | `sql/040_awcms_blog_content_internal_tag_links_permissions.sql`    |
| 41  | `sql/041_awcms_news_media_object_registry_schema.sql`              |
| 42  | `sql/042_awcms_news_media_permissions.sql`                         |
| 43  | `sql/043_awcms_news_portal_tenant_state_schema.sql`                |
| 44  | `sql/044_awcms_news_portal_homepage_sections_schema.sql`           |
| 45  | `sql/045_awcms_news_portal_ad_placements_schema.sql`               |
| 46  | `sql/046_awcms_tenant_domain_schema.sql`                           |
| 47  | `sql/047_awcms_tenant_domain_permissions.sql`                      |
| 48  | `sql/048_awcms_tenant_domain_lookup_function.sql`                  |
| 49  | `sql/049_awcms_visitor_analytics_permissions.sql`                  |
| 50  | `sql/050_awcms_visitor_analytics_schema.sql`                       |
| 51  | `sql/051_awcms_visitor_analytics_session_lookup_index.sql`         |
| 52  | `sql/052_awcms_media_library_permission_ownership.sql`             |
| 53  | `sql/053_awcms_media_library_tenant_state_schema.sql`              |
| 54  | `sql/054_awcms_media_library_enforcement_permissions.sql`          |
| 55  | `sql/055_awcms_data_lifecycle_schema.sql`                          |
| 56  | `sql/056_awcms_data_lifecycle_permissions.sql`                     |
| 57  | `sql/057_awcms_seo_distribution_config_schema.sql`                 |
| 58  | `sql/058_awcms_seo_distribution_config_permissions.sql`            |
| 59  | `sql/059_awcms_seo_distribution_feed_config_schema.sql`            |
| 60  | `sql/060_awcms_seo_distribution_redirect_schema.sql`               |
| 61  | `sql/061_awcms_seo_distribution_redirect_permissions.sql`          |
| 62  | `sql/062_awcms_form_drafts_schema.sql`                             |
| 63  | `sql/063_awcms_form_drafts_permissions.sql`                        |
| 64  | `sql/064_awcms_site_search_schema.sql`                             |
| 65  | `sql/065_awcms_site_search_permissions.sql`                        |
| 66  | `sql/066_awcms_comments_schema.sql`                                |
| 67  | `sql/067_awcms_comments_permissions.sql`                           |
| 68  | `sql/068_awcms_edge_cache_purge_queue.sql`                         |
| 69  | `sql/069_awcms_tenant_domains_worker_read.sql`                     |
| 70  | `sql/070_awcms_edge_cache_purges_tenant_guc_fix.sql`               |
| 71  | `sql/071_awcms_sidebar_menu_schema.sql`                            |
| 72  | `sql/072_awcms_sidebar_menu_permissions.sql`                       |
| 73  | `sql/073_awcms_identity_password_reset_schema.sql`                 |
| 74  | `sql/074_awcms_identity_self_registration_schema.sql`              |
| 75  | `sql/075_awcms_identity_self_registration_permissions.sql`         |
| 76  | `sql/076_awcms_blog_content_absorbs_news_portal_permissions.sql`   |
| 77  | `sql/077_awcms_drop_inert_news_portal_tenant_state.sql`            |
| 78  | `sql/078_awcms_ad_placement_targeting.sql`                         |
| 79  | `sql/079_awcms_legacy_ad_ingest_provenance.sql`                    |
| 80  | `sql/080_awcms_idn_admin_regions_schema.sql`                       |
| 81  | `sql/081_awcms_idn_admin_regions_permissions.sql`                  |
| 82  | `sql/082_awcms_identity_machine_credentials_schema.sql`            |
| 83  | `sql/083_awcms_identity_machine_credentials_permissions.sql`       |
| 84  | `sql/084_awcms_idn_admin_regions_revoke_lifecycle_permissions.sql` |
| 85  | `sql/085_awcms_platform_scoped_permissions.sql`                    |
| 86  | `sql/086_awcms_tenant_provisioning_permissions.sql`                |
| 87  | `sql/087_awcms_media_library_revoke_attach_detach_permissions.sql` |
| 88  | `sql/088_awcms_session_handoff_schema.sql`                         |
| 89  | `sql/089_awcms_blog_content_revoke_seo_export_permissions.sql`     |
| 90  | `sql/090_awcms_foreign_key_indexes.sql`                            |
| 91  | `sql/091_awcms_abac_decision_log_retention.sql`                    |
| 92  | `sql/092_awcms_tenant_lifecycle.sql`                               |
| 93  | `sql/093_awcms_push_delivery_schema.sql`                           |
| 94  | `sql/094_awcms_push_delivery_permissions.sql`                      |
| 95  | `sql/095_awcms_email_retention.sql`                                |
| 96  | `sql/096_awcms_object_sync_queue_retention.sql`                    |
| 97  | `sql/097_awcms_domain_event_deliveries_retention.sql`              |

### Tabel & Row-Level Security

| Tabel                                    | Dibuat di                                                  | RLS   | FORCE |
| ---------------------------------------- | ---------------------------------------------------------- | ----- | ----- |
| `awcms_abac_decision_logs`               | `sql/005_awcms_abac_access_control_schema.sql`             | ya    | ya    |
| `awcms_abac_policies`                    | `sql/005_awcms_abac_access_control_schema.sql`             | ya    | ya    |
| `awcms_access_assignments`               | `sql/005_awcms_abac_access_control_schema.sql`             | ya    | ya    |
| `awcms_audit_events`                     | `sql/007_awcms_audit_logging_schema.sql`                   | ya    | ya    |
| `awcms_auth_providers`                   | `sql/025_awcms_oidc_sso_schema.sql`                        | ya    | ya    |
| `awcms_bff_clients`                      | `sql/088_awcms_session_handoff_schema.sql`                 | ya    | ya    |
| `awcms_blog_ad_placements`               | `sql/037_awcms_blog_content_presentation_schema.sql`       | ya    | ya    |
| `awcms_blog_ads`                         | `sql/037_awcms_blog_content_presentation_schema.sql`       | ya    | ya    |
| `awcms_blog_internal_tag_link_settings`  | `sql/039_awcms_blog_content_internal_tag_links_schema.sql` | ya    | ya    |
| `awcms_blog_menu_items`                  | `sql/037_awcms_blog_content_presentation_schema.sql`       | ya    | ya    |
| `awcms_blog_menus`                       | `sql/037_awcms_blog_content_presentation_schema.sql`       | ya    | ya    |
| `awcms_blog_pages`                       | `sql/035_awcms_blog_content_schema.sql`                    | ya    | ya    |
| `awcms_blog_post_terms`                  | `sql/035_awcms_blog_content_schema.sql`                    | ya    | ya    |
| `awcms_blog_posts`                       | `sql/035_awcms_blog_content_schema.sql`                    | ya    | ya    |
| `awcms_blog_redirects`                   | `sql/035_awcms_blog_content_schema.sql`                    | ya    | ya    |
| `awcms_blog_revisions`                   | `sql/035_awcms_blog_content_schema.sql`                    | ya    | ya    |
| `awcms_blog_settings`                    | `sql/035_awcms_blog_content_schema.sql`                    | ya    | ya    |
| `awcms_blog_templates`                   | `sql/037_awcms_blog_content_presentation_schema.sql`       | ya    | ya    |
| `awcms_blog_terms`                       | `sql/035_awcms_blog_content_schema.sql`                    | ya    | ya    |
| `awcms_blog_theme_settings`              | `sql/037_awcms_blog_content_presentation_schema.sql`       | ya    | ya    |
| `awcms_blog_widgets`                     | `sql/037_awcms_blog_content_presentation_schema.sql`       | ya    | ya    |
| `awcms_business_scope_assignment_events` | `sql/027_awcms_business_scope_assignments_schema.sql`      | ya    | ya    |
| `awcms_business_scope_assignments`       | `sql/027_awcms_business_scope_assignments_schema.sql`      | ya    | ya    |
| `awcms_comments_abuse_events`            | `sql/066_awcms_comments_schema.sql`                        | ya    | ya    |
| `awcms_comments_comments`                | `sql/066_awcms_comments_schema.sql`                        | ya    | ya    |
| `awcms_comments_moderation_events`       | `sql/066_awcms_comments_schema.sql`                        | ya    | ya    |
| `awcms_comments_reply_subscriptions`     | `sql/066_awcms_comments_schema.sql`                        | ya    | ya    |
| `awcms_comments_reports`                 | `sql/066_awcms_comments_schema.sql`                        | ya    | ya    |
| `awcms_comments_settings`                | `sql/066_awcms_comments_schema.sql`                        | ya    | ya    |
| `awcms_comments_threads`                 | `sql/066_awcms_comments_schema.sql`                        | ya    | ya    |
| `awcms_data_lifecycle_archive_manifests` | `sql/055_awcms_data_lifecycle_schema.sql`                  | ya    | ya    |
| `awcms_data_lifecycle_cursors`           | `sql/055_awcms_data_lifecycle_schema.sql`                  | ya    | ya    |
| `awcms_data_lifecycle_legal_holds`       | `sql/055_awcms_data_lifecycle_schema.sql`                  | ya    | ya    |
| `awcms_data_lifecycle_runs`              | `sql/055_awcms_data_lifecycle_schema.sql`                  | ya    | ya    |
| `awcms_domain_event_activity_daily`      | `sql/009_awcms_domain_event_runtime_schema.sql`            | ya    | ya    |
| `awcms_domain_event_consumer_effects`    | `sql/009_awcms_domain_event_runtime_schema.sql`            | ya    | ya    |
| `awcms_domain_event_consumer_state`      | `sql/009_awcms_domain_event_runtime_schema.sql`            | ya    | ya    |
| `awcms_domain_event_deliveries`          | `sql/009_awcms_domain_event_runtime_schema.sql`            | ya    | ya    |
| `awcms_domain_event_replays`             | `sql/009_awcms_domain_event_runtime_schema.sql`            | ya    | ya    |
| `awcms_domain_events`                    | `sql/009_awcms_domain_event_runtime_schema.sql`            | ya    | ya    |
| `awcms_edge_cache_purges`                | `sql/068_awcms_edge_cache_purge_queue.sql`                 | ya    | ya    |
| `awcms_email_delivery_attempts`          | `sql/014_awcms_email_schema.sql`                           | ya    | ya    |
| `awcms_email_messages`                   | `sql/014_awcms_email_schema.sql`                           | ya    | ya    |
| `awcms_email_suppression_list`           | `sql/014_awcms_email_schema.sql`                           | ya    | ya    |
| `awcms_email_templates`                  | `sql/014_awcms_email_schema.sql`                           | ya    | ya    |
| `awcms_external_identities`              | `sql/025_awcms_oidc_sso_schema.sql`                        | ya    | ya    |
| `awcms_form_drafts`                      | `sql/062_awcms_form_drafts_schema.sql`                     | ya    | ya    |
| `awcms_idempotency_keys`                 | `sql/009_awcms_domain_event_runtime_schema.sql`            | ya    | ya    |
| `awcms_identities`                       | `sql/004_awcms_identity_login_schema.sql`                  | ya    | ya    |
| `awcms_identity_mfa_factors`             | `sql/024_awcms_mfa_totp_schema.sql`                        | ya    | ya    |
| `awcms_identity_mfa_recovery_codes`      | `sql/024_awcms_mfa_totp_schema.sql`                        | ya    | ya    |
| `awcms_idn_admin_regions`                | `sql/080_awcms_idn_admin_regions_schema.sql`               | tidak | tidak |
| `awcms_idn_region_datasets`              | `sql/080_awcms_idn_admin_regions_schema.sql`               | tidak | tidak |
| `awcms_machine_credentials`              | `sql/082_awcms_identity_machine_credentials_schema.sql`    | ya    | ya    |
| `awcms_media_library_tenant_state`       | `sql/053_awcms_media_library_tenant_state_schema.sql`      | ya    | ya    |
| `awcms_mfa_challenges`                   | `sql/024_awcms_mfa_totp_schema.sql`                        | ya    | ya    |
| `awcms_module_dependencies`              | `sql/008_awcms_module_management_schema.sql`               | tidak | tidak |
| `awcms_module_health_checks`             | `sql/008_awcms_module_management_schema.sql`               | tidak | tidak |
| `awcms_module_jobs`                      | `sql/008_awcms_module_management_schema.sql`               | tidak | tidak |
| `awcms_module_navigation`                | `sql/008_awcms_module_management_schema.sql`               | tidak | tidak |
| `awcms_module_settings`                  | `sql/008_awcms_module_management_schema.sql`               | ya    | ya    |
| `awcms_modules`                          | `sql/001_awcms_foundation_schema.sql`                      | tidak | tidak |
| `awcms_news_media_objects`               | `sql/041_awcms_news_media_object_registry_schema.sql`      | ya    | ya    |
| `awcms_news_portal_ad_placements`        | `sql/045_awcms_news_portal_ad_placements_schema.sql`       | ya    | ya    |
| `awcms_news_portal_homepage_sections`    | `sql/044_awcms_news_portal_homepage_sections_schema.sql`   | ya    | ya    |
| `awcms_object_sync_queue`                | `sql/012_awcms_object_sync_queue_schema.sql`               | ya    | ya    |
| `awcms_offices`                          | `sql/002_awcms_tenant_office_schema.sql`                   | ya    | ya    |
| `awcms_oidc_auth_requests`               | `sql/025_awcms_oidc_sso_schema.sql`                        | ya    | ya    |
| `awcms_password_reset_tokens`            | `sql/073_awcms_identity_password_reset_schema.sql`         | ya    | ya    |
| `awcms_permissions`                      | `sql/005_awcms_abac_access_control_schema.sql`             | tidak | tidak |
| `awcms_profile_entity_links`             | `sql/003_awcms_central_profile_schema.sql`                 | ya    | ya    |
| `awcms_profile_identifiers`              | `sql/003_awcms_central_profile_schema.sql`                 | ya    | ya    |
| `awcms_profiles`                         | `sql/003_awcms_central_profile_schema.sql`                 | ya    | ya    |
| `awcms_push_delivery_attempts`           | `sql/093_awcms_push_delivery_schema.sql`                   | ya    | ya    |
| `awcms_push_messages`                    | `sql/093_awcms_push_delivery_schema.sql`                   | ya    | ya    |
| `awcms_push_subscriptions`               | `sql/093_awcms_push_delivery_schema.sql`                   | ya    | ya    |
| `awcms_registration_requests`            | `sql/074_awcms_identity_self_registration_schema.sql`      | ya    | ya    |
| `awcms_reporting_export_runs`            | `sql/015_awcms_reporting_projections_schema.sql`           | ya    | ya    |
| `awcms_reporting_projection_cursors`     | `sql/015_awcms_reporting_projections_schema.sql`           | ya    | ya    |
| `awcms_reporting_projection_metrics`     | `sql/015_awcms_reporting_projections_schema.sql`           | ya    | ya    |
| `awcms_reporting_projection_state`       | `sql/015_awcms_reporting_projections_schema.sql`           | ya    | ya    |
| `awcms_reporting_rebuild_runs`           | `sql/015_awcms_reporting_projections_schema.sql`           | ya    | ya    |
| `awcms_reporting_reconciliation_runs`    | `sql/015_awcms_reporting_projections_schema.sql`           | ya    | ya    |
| `awcms_reporting_scheduled_exports`      | `sql/015_awcms_reporting_projections_schema.sql`           | ya    | ya    |
| `awcms_role_permissions`                 | `sql/005_awcms_abac_access_control_schema.sql`             | ya    | ya    |
| `awcms_roles`                            | `sql/005_awcms_abac_access_control_schema.sql`             | ya    | ya    |
| `awcms_schema_migrations`                | `sql/001_awcms_foundation_schema.sql`                      | tidak | tidak |
| `awcms_seo_not_found_observations`       | `sql/060_awcms_seo_distribution_redirect_schema.sql`       | ya    | ya    |
| `awcms_seo_redirect_settings`            | `sql/060_awcms_seo_distribution_redirect_schema.sql`       | ya    | ya    |
| `awcms_seo_redirects`                    | `sql/060_awcms_seo_distribution_redirect_schema.sql`       | ya    | ya    |
| `awcms_seo_tenant_settings`              | `sql/057_awcms_seo_distribution_config_schema.sql`         | ya    | ya    |
| `awcms_session_handoff_codes`            | `sql/088_awcms_session_handoff_schema.sql`                 | ya    | ya    |
| `awcms_sessions`                         | `sql/004_awcms_identity_login_schema.sql`                  | ya    | ya    |
| `awcms_setup_state`                      | `sql/006_awcms_setup_wizard_schema.sql`                    | tidak | tidak |
| `awcms_sidebar_menu_items`               | `sql/071_awcms_sidebar_menu_schema.sql`                    | ya    | ya    |
| `awcms_sidebar_menu_types`               | `sql/071_awcms_sidebar_menu_schema.sql`                    | ya    | ya    |
| `awcms_site_search_documents`            | `sql/064_awcms_site_search_schema.sql`                     | ya    | ya    |
| `awcms_site_search_index_failures`       | `sql/064_awcms_site_search_schema.sql`                     | ya    | ya    |
| `awcms_site_search_index_runs`           | `sql/064_awcms_site_search_schema.sql`                     | ya    | ya    |
| `awcms_site_search_query_log`            | `sql/064_awcms_site_search_schema.sql`                     | ya    | ya    |
| `awcms_site_search_settings`             | `sql/064_awcms_site_search_schema.sql`                     | ya    | ya    |
| `awcms_sod_conflict_evaluations`         | `sql/029_awcms_sod_schema.sql`                             | ya    | ya    |
| `awcms_sod_conflict_exceptions`          | `sql/029_awcms_sod_schema.sql`                             | ya    | ya    |
| `awcms_sync_aggregate_versions`          | `sql/011_awcms_sync_storage_conflict_schema.sql`           | ya    | ya    |
| `awcms_sync_conflicts`                   | `sql/011_awcms_sync_storage_conflict_schema.sql`           | ya    | ya    |
| `awcms_sync_inbox`                       | `sql/010_awcms_sync_storage_outbox_inbox_schema.sql`       | ya    | ya    |
| `awcms_sync_nodes`                       | `sql/010_awcms_sync_storage_outbox_inbox_schema.sql`       | ya    | ya    |
| `awcms_sync_outbox`                      | `sql/010_awcms_sync_storage_outbox_inbox_schema.sql`       | ya    | ya    |
| `awcms_sync_push_batches`                | `sql/010_awcms_sync_storage_outbox_inbox_schema.sql`       | ya    | ya    |
| `awcms_tenant_auth_policies`             | `sql/025_awcms_oidc_sso_schema.sql`                        | ya    | ya    |
| `awcms_tenant_domains`                   | `sql/046_awcms_tenant_domain_schema.sql`                   | ya    | ya    |
| `awcms_tenant_mfa_policies`              | `sql/024_awcms_mfa_totp_schema.sql`                        | ya    | ya    |
| `awcms_tenant_modules`                   | `sql/008_awcms_module_management_schema.sql`               | ya    | ya    |
| `awcms_tenant_settings`                  | `sql/002_awcms_tenant_office_schema.sql`                   | ya    | ya    |
| `awcms_tenant_status_transitions`        | `sql/092_awcms_tenant_lifecycle.sql`                       | ya    | ya    |
| `awcms_tenant_users`                     | `sql/004_awcms_identity_login_schema.sql`                  | ya    | ya    |
| `awcms_tenants`                          | `sql/002_awcms_tenant_office_schema.sql`                   | tidak | tidak |
| `awcms_theming_config_versions`          | `sql/033_awcms_theming_config_schema.sql`                  | ya    | ya    |
| `awcms_theming_preview_sessions`         | `sql/033_awcms_theming_config_schema.sql`                  | ya    | ya    |
| `awcms_theming_tenant_state`             | `sql/033_awcms_theming_config_schema.sql`                  | ya    | ya    |
| `awcms_visit_events`                     | `sql/050_awcms_visitor_analytics_schema.sql`               | ya    | ya    |
| `awcms_visitor_daily_rollups`            | `sql/050_awcms_visitor_analytics_schema.sql`               | ya    | ya    |
| `awcms_visitor_sessions`                 | `sql/050_awcms_visitor_analytics_schema.sql`               | ya    | ya    |
| `awcms_workflow_decisions`               | `sql/013_awcms_workflow_approval_schema.sql`               | ya    | ya    |
| `awcms_workflow_definitions`             | `sql/013_awcms_workflow_approval_schema.sql`               | ya    | ya    |
| `awcms_workflow_delegations`             | `sql/013_awcms_workflow_approval_schema.sql`               | ya    | ya    |
| `awcms_workflow_instances`               | `sql/013_awcms_workflow_approval_schema.sql`               | ya    | ya    |
| `awcms_workflow_join_arrivals`           | `sql/013_awcms_workflow_approval_schema.sql`               | ya    | ya    |
| `awcms_workflow_task_assignments`        | `sql/013_awcms_workflow_approval_schema.sql`               | ya    | ya    |
| `awcms_workflow_tasks`                   | `sql/013_awcms_workflow_approval_schema.sql`               | ya    | ya    |

### Tests

| Direktori     | Test files |
| ------------- | ---------- |
| `(root)`      | 287        |
| `e2e`         | 12         |
| `integration` | 36         |
| `unit`        | 1          |

### Routes

| Permukaan       | Berkas |
| --------------- | ------ |
| `/api/v1/**`    | 263    |
| `/admin/**`     | 33     |
| publik / anonim | 22     |

<!-- END GENERATED: repo-inventory -->

## Catatan non-generated

- **Penomoran migrasi** sekuensial mulai `001`. Namespace `900+` untuk jalur
  aplikasi-turunan **sudah dicabut** ([ADR-0034](../adr/0034-awcms-family-direct-use-templates-and-derived-pathway-removal.md)):
  modul domain/website ditambahkan langsung ke `src/modules/` dan migrasinya
  melanjutkan penomoran yang sama.
- **Tabel RLS-free** di tabel di atas (kolom `RLS` = tidak) adalah tabel GLOBAL
  by design — ledger migrasi, registry modul, katalog permission, registry
  tenant, singleton setup state, dan dataset wilayah global. Daftar berikut
  otoritatifnya ada di `GLOBAL_TABLE_FORBIDDEN_PRIVILEGES`
  (`scripts/security-readiness.ts`), yang juga menyatakan privilege mana yang
  DILARANG dipegang `awcms_app` atas masing-masing. Tak ada tabel bisnis yang
  boleh masuk ke sana.
- **Snapshot GitHub** (issue/label/milestone) dilacak terpisah di
  `docs/awcms/github/`, di-refresh on-demand — sengaja di luar `bun run check`.

## Lihat juga

- [`../ARCHITECTURE.md`](../ARCHITECTURE.md) — penjelasan per-subsistem atas apa yang ada di kode.
- [`../PROJECT_STATE.md`](../PROJECT_STATE.md) — state proyek + backlog (titik-lanjut).
- [`deployment-profiles.md`](deployment-profiles.md) — model dua-peran basis data dan penegakan RLS.
