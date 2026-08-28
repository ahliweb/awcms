# AWCMS Repository Inventory (generated)

> **GENERATED BLOCK — jangan edit tabel di bawah penanda secara manual.** Tabel
> di antara `<!-- BEGIN GENERATED: repo-inventory -->

### Summary

| Aspect                              | Value |
| ----------------------------------- | ----- |
| Registered modules                  | 24    |
| Migrations                          | 148   |
| `awcms_*` tables                    | 152   |
| Tables with `FORCE` RLS             | 134   |
| RLS-free tables (global, by design) | 18    |
| Test files                          | 507   |
| Route files                         | 388   |
| ADR                                 | 240   |

### Modules

| Key                    | Version | Status | Type   | Core | Dependencies                                                                                       |
| ---------------------- | ------- | ------ | ------ | ---- | -------------------------------------------------------------------------------------------------- |
| `logging`              | 1.0.0   | active | —      | no   | `tenant_admin`                                                                                     |
| `tenant_admin`         | 1.0.0   | active | —      | no   | —                                                                                                  |
| `profile_identity`     | 1.0.0   | active | —      | no   | `tenant_admin`                                                                                     |
| `identity_access`      | 1.0.0   | active | —      | no   | `tenant_admin`, `profile_identity`                                                                 |
| `module_management`    | 0.1.0   | active | system | yes  | `tenant_admin`, `identity_access`                                                                  |
| `domain_event_runtime` | 0.1.0   | active | system | no   | `tenant_admin`, `identity_access`, `logging`                                                       |
| `sync_storage`         | 1.0.0   | active | system | no   | `tenant_admin`                                                                                     |
| `workflow`             | 2.0.0   | active | system | no   | `tenant_admin`, `identity_access`, `domain_event_runtime`                                          |
| `email`                | 0.5.0   | active | —      | no   | `tenant_admin`, `profile_identity`, `identity_access`                                              |
| `reporting`            | 1.2.0   | active | —      | no   | `tenant_admin`, `identity_access`, `sync_storage`, `email`, `domain_event_runtime`                 |
| `theming`              | 1.0.0   | active | domain | no   | `tenant_admin`, `identity_access`, `module_management`                                             |
| `media_library`        | 0.1.0   | active | system | no   | `tenant_admin`, `identity_access`                                                                  |
| `blog_content`         | 0.12.0  | active | domain | no   | `tenant_admin`, `identity_access`, `module_management`, `logging`                                  |
| `tenant_domain`        | 0.1.0   | active | domain | no   | `tenant_admin`, `identity_access`                                                                  |
| `visitor_analytics`    | 0.1.0   | active | system | no   | `tenant_admin`, `identity_access`, `logging`, `data_lifecycle`, `module_management`                |
| `data_lifecycle`       | 0.1.0   | active | system | no   | `tenant_admin`, `identity_access`, `logging`                                                       |
| `seo_distribution`     | 0.2.0   | active | domain | no   | `tenant_admin`, `identity_access`, `module_management`                                             |
| `form_drafts`          | 0.1.0   | active | system | no   | `identity_access`                                                                                  |
| `site_search`          | 0.1.0   | active | domain | no   | `tenant_admin`, `identity_access`, `module_management`                                             |
| `newsletter`           | 0.1.0   | active | domain | no   | `tenant_admin`, `identity_access`, `module_management`, `email`, `profile_identity`                |
| `site_profile`         | 0.1.0   | active | domain | no   | `tenant_admin`, `identity_access`, `media_library`, `seo_distribution`                             |
| `comments`             | 0.1.0   | active | domain | no   | `tenant_admin`, `identity_access`, `module_management`, `profile_identity`, `domain_event_runtime` |
| `idn_admin_regions`    | 0.1.0   | active | system | no   | `tenant_admin`, `identity_access`                                                                  |
| `push_delivery`        | 0.1.0   | active | —      | no   | `tenant_admin`, `logging`                                                                          |

### Migrations

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
| 98  | `sql/098_awcms_sync_outbox_not_connected_comment.sql`              |
| 99  | `sql/099_awcms_sync_outbox_retire.sql`                             |
| 100 | `sql/100_awcms_session_fingerprint.sql`                            |
| 101 | `sql/101_awcms_identity_user_sessions_permissions.sql`             |
| 102 | `sql/102_awcms_access_policies_schema.sql`                         |
| 103 | `sql/103_awcms_access_assignments_backfill_retire.sql`             |
| 104 | `sql/104_awcms_user_groups_schema.sql`                             |
| 105 | `sql/105_awcms_user_groups_permissions.sql`                        |
| 106 | `sql/106_awcms_identity_invitations_schema.sql`                    |
| 107 | `sql/107_awcms_identity_invitation_permissions.sql`                |
| 108 | `sql/108_awcms_identity_invitations_worker_grants.sql`             |
| 109 | `sql/109_awcms_entitlement_schema.sql`                             |
| 110 | `sql/110_awcms_subscription_lifecycle_worker_grants.sql`           |
| 111 | `sql/111_awcms_entitlement_catalogue_and_subscriptions.sql`        |
| 112 | `sql/112_awcms_principals.sql`                                     |
| 113 | `sql/113_awcms_principal_lockout.sql`                              |
| 114 | `sql/114_awcms_principal_mfa.sql`                                  |
| 115 | `sql/115_awcms_tenant_selection.sql`                               |
| 116 | `sql/116_awcms_partners.sql`                                       |
| 117 | `sql/117_awcms_delegated_access.sql`                               |
| 118 | `sql/118_awcms_two_sided_attribution.sql`                          |
| 119 | `sql/119_awcms_partner_surface.sql`                                |
| 120 | `sql/120_awcms_grant_outlives_engagement.sql`                      |
| 121 | `sql/121_awcms_machine_credential_write_class.sql`                 |
| 122 | `sql/122_awcms_identity_machine_credential_write_permissions.sql`  |
| 123 | `sql/123_awcms_partner_registry_permissions.sql`                   |
| 124 | `sql/124_awcms_partner_suspension.sql`                             |
| 125 | `sql/125_awcms_subject_requests.sql`                               |
| 126 | `sql/126_awcms_subject_request_permissions.sql`                    |
| 127 | `sql/127_awcms_worker_on_conflict_select_grants.sql`               |
| 128 | `sql/128_awcms_principal_preferences.sql`                          |
| 129 | `sql/129_awcms_worker_lifecycle_purge_grants.sql`                  |
| 130 | `sql/130_awcms_principal_time_zone.sql`                            |
| 131 | `sql/131_awcms_blog_content_classification_dimensions.sql`         |
| 132 | `sql/132_awcms_blog_content_institution_permissions.sql`           |
| 133 | `sql/133_awcms_blog_content_scheduled_unpublish.sql`               |
| 134 | `sql/134_awcms_blog_portable_text_body.sql`                        |
| 135 | `sql/135_awcms_site_profile_schema.sql`                            |
| 136 | `sql/136_awcms_blog_pages_worker_select.sql`                       |
| 137 | `sql/137_awcms_media_rights_metadata.sql`                          |
| 138 | `sql/138_awcms_blog_legacy_provenance.sql`                         |
| 139 | `sql/139_awcms_newsletter_schema.sql`                              |
| 140 | `sql/140_awcms_site_search_term_facets.sql`                        |
| 141 | `sql/141_awcms_repair_jsonb_string_bodies.sql`                     |
| 142 | `sql/142_awcms_delegated_access_expiry_sweep.sql`                  |
| 143 | `sql/143_awcms_blog_list_ordering_indexes.sql`                     |
| 144 | `sql/144_awcms_credential_epoch.sql`                               |
| 145 | `sql/145_awcms_subject_actor_indexes.sql`                          |
| 146 | `sql/146_awcms_identity_public_byline.sql`                         |
| 147 | `sql/147_awcms_blog_pages_drop_legacy_provenance.sql`              |
| 148 | `sql/148_awcms_permission_description_resync.sql`                  |

### Tables & Row-Level Security

| Table                                    | Created in                                                 | RLS | FORCE |
| ---------------------------------------- | ---------------------------------------------------------- | --- | ----- |
| `awcms_abac_decision_logs`               | `sql/005_awcms_abac_access_control_schema.sql`             | yes | yes   |
| `awcms_abac_policies`                    | `sql/005_awcms_abac_access_control_schema.sql`             | yes | yes   |
| `awcms_access_assignments`               | `sql/005_awcms_abac_access_control_schema.sql`             | yes | yes   |
| `awcms_access_policies`                  | `sql/102_awcms_access_policies_schema.sql`                 | yes | yes   |
| `awcms_access_policy_events`             | `sql/102_awcms_access_policies_schema.sql`                 | yes | yes   |
| `awcms_audit_events`                     | `sql/007_awcms_audit_logging_schema.sql`                   | yes | yes   |
| `awcms_auth_providers`                   | `sql/025_awcms_oidc_sso_schema.sql`                        | yes | yes   |
| `awcms_bff_clients`                      | `sql/088_awcms_session_handoff_schema.sql`                 | yes | yes   |
| `awcms_blog_ad_placements`               | `sql/037_awcms_blog_content_presentation_schema.sql`       | yes | yes   |
| `awcms_blog_ads`                         | `sql/037_awcms_blog_content_presentation_schema.sql`       | yes | yes   |
| `awcms_blog_institutions`                | `sql/131_awcms_blog_content_classification_dimensions.sql` | yes | yes   |
| `awcms_blog_internal_tag_link_settings`  | `sql/039_awcms_blog_content_internal_tag_links_schema.sql` | yes | yes   |
| `awcms_blog_menu_items`                  | `sql/037_awcms_blog_content_presentation_schema.sql`       | yes | yes   |
| `awcms_blog_menus`                       | `sql/037_awcms_blog_content_presentation_schema.sql`       | yes | yes   |
| `awcms_blog_pages`                       | `sql/035_awcms_blog_content_schema.sql`                    | yes | yes   |
| `awcms_blog_post_institutions`           | `sql/131_awcms_blog_content_classification_dimensions.sql` | yes | yes   |
| `awcms_blog_post_terms`                  | `sql/035_awcms_blog_content_schema.sql`                    | yes | yes   |
| `awcms_blog_posts`                       | `sql/035_awcms_blog_content_schema.sql`                    | yes | yes   |
| `awcms_blog_redirects`                   | `sql/035_awcms_blog_content_schema.sql`                    | yes | yes   |
| `awcms_blog_revisions`                   | `sql/035_awcms_blog_content_schema.sql`                    | yes | yes   |
| `awcms_blog_settings`                    | `sql/035_awcms_blog_content_schema.sql`                    | yes | yes   |
| `awcms_blog_templates`                   | `sql/037_awcms_blog_content_presentation_schema.sql`       | yes | yes   |
| `awcms_blog_terms`                       | `sql/035_awcms_blog_content_schema.sql`                    | yes | yes   |
| `awcms_blog_theme_settings`              | `sql/037_awcms_blog_content_presentation_schema.sql`       | yes | yes   |
| `awcms_blog_widgets`                     | `sql/037_awcms_blog_content_presentation_schema.sql`       | yes | yes   |
| `awcms_business_scope_assignment_events` | `sql/027_awcms_business_scope_assignments_schema.sql`      | yes | yes   |
| `awcms_business_scope_assignments`       | `sql/027_awcms_business_scope_assignments_schema.sql`      | yes | yes   |
| `awcms_comments_abuse_events`            | `sql/066_awcms_comments_schema.sql`                        | yes | yes   |
| `awcms_comments_comments`                | `sql/066_awcms_comments_schema.sql`                        | yes | yes   |
| `awcms_comments_moderation_events`       | `sql/066_awcms_comments_schema.sql`                        | yes | yes   |
| `awcms_comments_reply_subscriptions`     | `sql/066_awcms_comments_schema.sql`                        | yes | yes   |
| `awcms_comments_reports`                 | `sql/066_awcms_comments_schema.sql`                        | yes | yes   |
| `awcms_comments_settings`                | `sql/066_awcms_comments_schema.sql`                        | yes | yes   |
| `awcms_comments_threads`                 | `sql/066_awcms_comments_schema.sql`                        | yes | yes   |
| `awcms_data_lifecycle_archive_manifests` | `sql/055_awcms_data_lifecycle_schema.sql`                  | yes | yes   |
| `awcms_data_lifecycle_cursors`           | `sql/055_awcms_data_lifecycle_schema.sql`                  | yes | yes   |
| `awcms_data_lifecycle_legal_holds`       | `sql/055_awcms_data_lifecycle_schema.sql`                  | yes | yes   |
| `awcms_data_lifecycle_runs`              | `sql/055_awcms_data_lifecycle_schema.sql`                  | yes | yes   |
| `awcms_delegated_access_grants`          | `sql/117_awcms_delegated_access.sql`                       | yes | yes   |
| `awcms_domain_event_activity_daily`      | `sql/009_awcms_domain_event_runtime_schema.sql`            | yes | yes   |
| `awcms_domain_event_consumer_effects`    | `sql/009_awcms_domain_event_runtime_schema.sql`            | yes | yes   |
| `awcms_domain_event_consumer_state`      | `sql/009_awcms_domain_event_runtime_schema.sql`            | yes | yes   |
| `awcms_domain_event_deliveries`          | `sql/009_awcms_domain_event_runtime_schema.sql`            | yes | yes   |
| `awcms_domain_event_replays`             | `sql/009_awcms_domain_event_runtime_schema.sql`            | yes | yes   |
| `awcms_domain_events`                    | `sql/009_awcms_domain_event_runtime_schema.sql`            | yes | yes   |
| `awcms_edge_cache_purges`                | `sql/068_awcms_edge_cache_purge_queue.sql`                 | yes | yes   |
| `awcms_email_delivery_attempts`          | `sql/014_awcms_email_schema.sql`                           | yes | yes   |
| `awcms_email_messages`                   | `sql/014_awcms_email_schema.sql`                           | yes | yes   |
| `awcms_email_suppression_list`           | `sql/014_awcms_email_schema.sql`                           | yes | yes   |
| `awcms_email_templates`                  | `sql/014_awcms_email_schema.sql`                           | yes | yes   |
| `awcms_entitlements`                     | `sql/109_awcms_entitlement_schema.sql`                     | no  | no    |
| `awcms_external_identities`              | `sql/025_awcms_oidc_sso_schema.sql`                        | yes | yes   |
| `awcms_form_drafts`                      | `sql/062_awcms_form_drafts_schema.sql`                     | yes | yes   |
| `awcms_idempotency_keys`                 | `sql/009_awcms_domain_event_runtime_schema.sql`            | yes | yes   |
| `awcms_identities`                       | `sql/004_awcms_identity_login_schema.sql`                  | yes | yes   |
| `awcms_identity_mfa_factors`             | `sql/024_awcms_mfa_totp_schema.sql`                        | yes | yes   |
| `awcms_identity_mfa_recovery_codes`      | `sql/024_awcms_mfa_totp_schema.sql`                        | yes | yes   |
| `awcms_idn_admin_regions`                | `sql/080_awcms_idn_admin_regions_schema.sql`               | no  | no    |
| `awcms_idn_region_datasets`              | `sql/080_awcms_idn_admin_regions_schema.sql`               | no  | no    |
| `awcms_invitation_policies`              | `sql/106_awcms_identity_invitations_schema.sql`            | yes | yes   |
| `awcms_invitations`                      | `sql/106_awcms_identity_invitations_schema.sql`            | yes | yes   |
| `awcms_machine_credentials`              | `sql/082_awcms_identity_machine_credentials_schema.sql`    | yes | yes   |
| `awcms_media_library_tenant_state`       | `sql/053_awcms_media_library_tenant_state_schema.sql`      | yes | yes   |
| `awcms_mfa_challenges`                   | `sql/024_awcms_mfa_totp_schema.sql`                        | yes | yes   |
| `awcms_module_dependencies`              | `sql/008_awcms_module_management_schema.sql`               | no  | no    |
| `awcms_module_health_checks`             | `sql/008_awcms_module_management_schema.sql`               | no  | no    |
| `awcms_module_jobs`                      | `sql/008_awcms_module_management_schema.sql`               | no  | no    |
| `awcms_module_navigation`                | `sql/008_awcms_module_management_schema.sql`               | no  | no    |
| `awcms_module_settings`                  | `sql/008_awcms_module_management_schema.sql`               | yes | yes   |
| `awcms_modules`                          | `sql/001_awcms_foundation_schema.sql`                      | no  | no    |
| `awcms_news_media_objects`               | `sql/041_awcms_news_media_object_registry_schema.sql`      | yes | yes   |
| `awcms_news_portal_ad_placements`        | `sql/045_awcms_news_portal_ad_placements_schema.sql`       | yes | yes   |
| `awcms_news_portal_homepage_sections`    | `sql/044_awcms_news_portal_homepage_sections_schema.sql`   | yes | yes   |
| `awcms_newsletter_subscribers`           | `sql/139_awcms_newsletter_schema.sql`                      | yes | yes   |
| `awcms_object_sync_queue`                | `sql/012_awcms_object_sync_queue_schema.sql`               | yes | yes   |
| `awcms_offices`                          | `sql/002_awcms_tenant_office_schema.sql`                   | yes | yes   |
| `awcms_oidc_auth_requests`               | `sql/025_awcms_oidc_sso_schema.sql`                        | yes | yes   |
| `awcms_partner_managed_tenants`          | `sql/116_awcms_partners.sql`                               | yes | yes   |
| `awcms_partners`                         | `sql/116_awcms_partners.sql`                               | yes | yes   |
| `awcms_password_reset_tokens`            | `sql/073_awcms_identity_password_reset_schema.sql`         | yes | yes   |
| `awcms_permissions`                      | `sql/005_awcms_abac_access_control_schema.sql`             | no  | no    |
| `awcms_plan_entitlements`                | `sql/109_awcms_entitlement_schema.sql`                     | no  | no    |
| `awcms_plans`                            | `sql/109_awcms_entitlement_schema.sql`                     | no  | no    |
| `awcms_principal_mfa_factors`            | `sql/114_awcms_principal_mfa.sql`                          | no  | no    |
| `awcms_principal_mfa_recovery_codes`     | `sql/114_awcms_principal_mfa.sql`                          | no  | no    |
| `awcms_principal_preferences`            | `sql/128_awcms_principal_preferences.sql`                  | no  | no    |
| `awcms_principals`                       | `sql/112_awcms_principals.sql`                             | no  | no    |
| `awcms_profile_entity_links`             | `sql/003_awcms_central_profile_schema.sql`                 | yes | yes   |
| `awcms_profile_identifiers`              | `sql/003_awcms_central_profile_schema.sql`                 | yes | yes   |
| `awcms_profiles`                         | `sql/003_awcms_central_profile_schema.sql`                 | yes | yes   |
| `awcms_push_delivery_attempts`           | `sql/093_awcms_push_delivery_schema.sql`                   | yes | yes   |
| `awcms_push_messages`                    | `sql/093_awcms_push_delivery_schema.sql`                   | yes | yes   |
| `awcms_push_subscriptions`               | `sql/093_awcms_push_delivery_schema.sql`                   | yes | yes   |
| `awcms_registration_requests`            | `sql/074_awcms_identity_self_registration_schema.sql`      | yes | yes   |
| `awcms_reporting_export_runs`            | `sql/015_awcms_reporting_projections_schema.sql`           | yes | yes   |
| `awcms_reporting_projection_cursors`     | `sql/015_awcms_reporting_projections_schema.sql`           | yes | yes   |
| `awcms_reporting_projection_metrics`     | `sql/015_awcms_reporting_projections_schema.sql`           | yes | yes   |
| `awcms_reporting_projection_state`       | `sql/015_awcms_reporting_projections_schema.sql`           | yes | yes   |
| `awcms_reporting_rebuild_runs`           | `sql/015_awcms_reporting_projections_schema.sql`           | yes | yes   |
| `awcms_reporting_reconciliation_runs`    | `sql/015_awcms_reporting_projections_schema.sql`           | yes | yes   |
| `awcms_reporting_scheduled_exports`      | `sql/015_awcms_reporting_projections_schema.sql`           | yes | yes   |
| `awcms_role_permissions`                 | `sql/005_awcms_abac_access_control_schema.sql`             | yes | yes   |
| `awcms_roles`                            | `sql/005_awcms_abac_access_control_schema.sql`             | yes | yes   |
| `awcms_schema_migrations`                | `sql/001_awcms_foundation_schema.sql`                      | no  | no    |
| `awcms_seo_not_found_observations`       | `sql/060_awcms_seo_distribution_redirect_schema.sql`       | yes | yes   |
| `awcms_seo_redirect_settings`            | `sql/060_awcms_seo_distribution_redirect_schema.sql`       | yes | yes   |
| `awcms_seo_redirects`                    | `sql/060_awcms_seo_distribution_redirect_schema.sql`       | yes | yes   |
| `awcms_seo_tenant_settings`              | `sql/057_awcms_seo_distribution_config_schema.sql`         | yes | yes   |
| `awcms_session_handoff_codes`            | `sql/088_awcms_session_handoff_schema.sql`                 | yes | yes   |
| `awcms_sessions`                         | `sql/004_awcms_identity_login_schema.sql`                  | yes | yes   |
| `awcms_setup_state`                      | `sql/006_awcms_setup_wizard_schema.sql`                    | no  | no    |
| `awcms_sidebar_menu_items`               | `sql/071_awcms_sidebar_menu_schema.sql`                    | yes | yes   |
| `awcms_sidebar_menu_types`               | `sql/071_awcms_sidebar_menu_schema.sql`                    | yes | yes   |
| `awcms_site_profile`                     | `sql/135_awcms_site_profile_schema.sql`                    | yes | yes   |
| `awcms_site_search_documents`            | `sql/064_awcms_site_search_schema.sql`                     | yes | yes   |
| `awcms_site_search_index_failures`       | `sql/064_awcms_site_search_schema.sql`                     | yes | yes   |
| `awcms_site_search_index_runs`           | `sql/064_awcms_site_search_schema.sql`                     | yes | yes   |
| `awcms_site_search_query_log`            | `sql/064_awcms_site_search_schema.sql`                     | yes | yes   |
| `awcms_site_search_settings`             | `sql/064_awcms_site_search_schema.sql`                     | yes | yes   |
| `awcms_sod_conflict_evaluations`         | `sql/029_awcms_sod_schema.sql`                             | yes | yes   |
| `awcms_sod_conflict_exceptions`          | `sql/029_awcms_sod_schema.sql`                             | yes | yes   |
| `awcms_subject_requests`                 | `sql/125_awcms_subject_requests.sql`                       | yes | yes   |
| `awcms_sync_aggregate_versions`          | `sql/011_awcms_sync_storage_conflict_schema.sql`           | yes | yes   |
| `awcms_sync_conflicts`                   | `sql/011_awcms_sync_storage_conflict_schema.sql`           | yes | yes   |
| `awcms_sync_inbox`                       | `sql/010_awcms_sync_storage_outbox_inbox_schema.sql`       | yes | yes   |
| `awcms_sync_nodes`                       | `sql/010_awcms_sync_storage_outbox_inbox_schema.sql`       | yes | yes   |
| `awcms_sync_push_batches`                | `sql/010_awcms_sync_storage_outbox_inbox_schema.sql`       | yes | yes   |
| `awcms_tenant_auth_policies`             | `sql/025_awcms_oidc_sso_schema.sql`                        | yes | yes   |
| `awcms_tenant_domains`                   | `sql/046_awcms_tenant_domain_schema.sql`                   | yes | yes   |
| `awcms_tenant_entitlements`              | `sql/109_awcms_entitlement_schema.sql`                     | yes | yes   |
| `awcms_tenant_mfa_policies`              | `sql/024_awcms_mfa_totp_schema.sql`                        | yes | yes   |
| `awcms_tenant_modules`                   | `sql/008_awcms_module_management_schema.sql`               | yes | yes   |
| `awcms_tenant_settings`                  | `sql/002_awcms_tenant_office_schema.sql`                   | yes | yes   |
| `awcms_tenant_status_transitions`        | `sql/092_awcms_tenant_lifecycle.sql`                       | yes | yes   |
| `awcms_tenant_subscriptions`             | `sql/109_awcms_entitlement_schema.sql`                     | yes | yes   |
| `awcms_tenant_users`                     | `sql/004_awcms_identity_login_schema.sql`                  | yes | yes   |
| `awcms_tenants`                          | `sql/002_awcms_tenant_office_schema.sql`                   | no  | no    |
| `awcms_theming_config_versions`          | `sql/033_awcms_theming_config_schema.sql`                  | yes | yes   |
| `awcms_theming_preview_sessions`         | `sql/033_awcms_theming_config_schema.sql`                  | yes | yes   |
| `awcms_theming_tenant_state`             | `sql/033_awcms_theming_config_schema.sql`                  | yes | yes   |
| `awcms_user_group_members`               | `sql/104_awcms_user_groups_schema.sql`                     | yes | yes   |
| `awcms_user_groups`                      | `sql/104_awcms_user_groups_schema.sql`                     | yes | yes   |
| `awcms_visit_events`                     | `sql/050_awcms_visitor_analytics_schema.sql`               | yes | yes   |
| `awcms_visitor_daily_rollups`            | `sql/050_awcms_visitor_analytics_schema.sql`               | yes | yes   |
| `awcms_visitor_sessions`                 | `sql/050_awcms_visitor_analytics_schema.sql`               | yes | yes   |
| `awcms_workflow_decisions`               | `sql/013_awcms_workflow_approval_schema.sql`               | yes | yes   |
| `awcms_workflow_definitions`             | `sql/013_awcms_workflow_approval_schema.sql`               | yes | yes   |
| `awcms_workflow_delegations`             | `sql/013_awcms_workflow_approval_schema.sql`               | yes | yes   |
| `awcms_workflow_instances`               | `sql/013_awcms_workflow_approval_schema.sql`               | yes | yes   |
| `awcms_workflow_join_arrivals`           | `sql/013_awcms_workflow_approval_schema.sql`               | yes | yes   |
| `awcms_workflow_task_assignments`        | `sql/013_awcms_workflow_approval_schema.sql`               | yes | yes   |
| `awcms_workflow_tasks`                   | `sql/013_awcms_workflow_approval_schema.sql`               | yes | yes   |

### Tests

| Directory     | Test files |
| ------------- | ---------- |
| `(root)`      | 414        |
| `e2e`         | 18         |
| `integration` | 74         |
| `unit`        | 1          |

### Routes

| Surface         | Files |
| --------------- | ----- |
| `/api/v1/**`    | 308   |
| `/admin/**`     | 50    |
| publik / anonim | 30    |

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
- **Snapshot GitHub** (issue/label/milestone) **tidak ada** di repo ini —
  `docs/awcms/github/` belum pernah dikomit. Untuk state tracker, query `gh`
  langsung; lihat skill `awcms-github-snapshot`, yang berupa spesifikasi
  target, bukan tugas yang bisa dijalankan.

## Lihat juga

- [`../ARCHITECTURE.md`](../ARCHITECTURE.md) — penjelasan per-subsistem atas apa yang ada di kode.
- [`../PROJECT_STATE.md`](../PROJECT_STATE.md) — state proyek + backlog (titik-lanjut).
- [`deployment-profiles.md`](deployment-profiles.md) — model dua-peran basis data dan penegakan RLS.
