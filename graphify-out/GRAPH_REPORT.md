# Graph Report - /home/data/dev_bun/awcms  (2026-07-27)

## Corpus Check
- 231 files · ~1,295,906 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 8159 nodes · 21470 edges · 485 communities (412 shown, 73 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 342 edges (avg confidence: 0.77)
- Token cost: 817,243 input · 0 output

## Community Hubs (Navigation)
- Tenant Transaction & Authorization Core
- Audit Log & Idempotency
- Database Client & Request Body Limits
- Error Responses & HTML Escaping
- SSR Session & Blog Revisions
- MFA TOTP & Recovery Codes
- Module Descriptor Registry
- OIDC OAuth State & PKCE
- Circuit Breaker & Provider Metrics
- Integration Test Seeding
- Reporting Projection Workers
- package.json Script Surface
- MFA Config & Client Fingerprint
- Site Search Index Engine
- Admin Page Imports
- Scheduled Job Entrypoints
- Password Reset Tokens & Delivery
- Projection Directory & Reconciliation
- Internal Tag Link Rendering
- Blog Page/Post Validation
- SEO Discovery Payloads
- API Response & Keyset Pagination
- Capacity Budget Config
- Sidebar Menu Arrangement
- Tenant Domain DNS Reconciliation
- ABAC Policy Admin Routes
- Redis Cache & Health
- Content Ownership ABAC Policies
- Blog Page Directory
- Comments Service
- post-status.ts
- sod-exception-service.ts
- tenant-route.ts
- media-reconciliation.ts
- AWCMS Backend & Integration Hardening (skill)
- generic-oidc-client.ts
- audit-log-purge.ts
- form-draft-directory.ts
- seo-document.ts
- domain/module-presets.ts
- export-generation.ts
- mailketing-provider.ts
- assertUuid()
- dispatch-domain-events.ts
- ads-directory.ts
- content-quality-checklist.ts
- comment-settings.ts
- identifier-directory.ts
- src/modules/index.ts
- public-host-tenant-resolver.ts
- homepage-section-policy.ts
- identity-access OpenAPI fragment
- blog-content-presentation-domain.test.ts
- enforceTurnstileIfRequired()
- serveDiscovery()
- ADR-0041: comments module admission
- module-composition.ts
- media-object-directory.ts
- theming.integration.test.ts
- announcement-directory.ts
- listModules()
- media-library/module.ts
- ADR-0042: Varnish edge-cache tier, off by default
- abac-evaluator.ts
- auth-provider-directory.ts
- abac-admin.ts
- workflow-definition-directory.ts
- workflow-instance-decision.ts
- ADR-0033 Dynamic ABAC Policy Evaluator
- email-template-directory.ts
- turnstile.ts
- abac-policy.ts
- media-r2-config.ts
- url-change-capture.ts
- theme-config.ts
- workflow-instance.ts
- astro
- business-scope-facts.ts
- initialize.ts
- redirect-directory.ts
- api-docs-generate.ts
- seo-redirect-guards.test.ts
- ERP domain modules (finance/inventory/procurement/HR)
- MFA TOTP + recovery codes
- encodeKeysetCursor()
- report.ts
- ModuleDescriptor
- ad-placement-directory.ts
- visitor-analytics-domain.test.ts
- properties
- module-management OpenAPI fragment
- family-conformance-check.ts
- news-article-seo-metadata.ts
- comment-moderation.ts
- workflow-graph.ts
- withTenant / SET LOCAL RLS context
- security-readiness.ts
- append-domain-event.ts
- party-directory.ts
- application/email-dispatch.ts
- login-env-parsing.test.ts
- legal-hold-service.ts
- sod.integration.test.ts
- seo-facts-port.ts
- theme-descriptor.ts
- edge-cache/config.ts
- presentation/theme-preview.ts
- ../lib/ui/admin-form-client
- api-spec-check.ts
- commentable-resource-registry.ts
- family-conformance.test.ts
- docs-checks.mjs
- public-blog-directory.ts
- admin/[id]/restore.ts
- domain-event-directory.ts
- media-r2-verification.ts
- media-r2-client.ts
- seo-distribution.integration.test.ts
- redirect-rule.ts
- office-directory.ts
- collect.ts
- package.json
- compilerOptions
- widget-policy.ts
- query.ts
- theming/preview.ts
- abac-policy-evaluator.integration.test.ts
- ADR-0003 PostgreSQL + RLS multi-tenant isolation
- production:preflight read-only preflight
- Bundled published OpenAPI contract
- sod-rule-registry.ts
- menu-directory.ts
- content-block-rendering.ts
- business-scope-assignment-service.ts
- user-admin.ts
- visitor-analytics.integration.test.ts
- Varnish edge-cache infrastructure layer (ADR-0042)
- properties
- redirect-resolution-service.ts
- local-archive-adapter.ts
- Eleven ERP contract families (neutral contracts, base is not ERP)
- runtime.ts
- redaction.ts
- role-admin.ts
- work-class-registry-generate.ts
- edge-cache.test.ts
- media-library-port-adapter.ts
- workflow-inbox-directory.ts
- site-search/settings.ts
- provideTenant()
- family-contract.ts
- capability-contract-versions.ts
- module-boundary.test.ts
- jwt-verify.ts
- content-purge.ts
- object-storage-uploader.ts
- dry-run-planner.ts
- policy-cache.ts
- application/module-settings.ts
- search-diagnostics.ts
- tenant-domain-directory.ts
- tenant-domain-validation.ts
- user-agent.ts
- required
- errorMessage()
- announcement-validation.ts
- homepage-section-reference-validation.ts
- application/health-registry.ts
- seo-redirect-governance.integration.test.ts
- theme-render-resolver.ts
- ADR-0016 organization_structure module admission
- Release job: validate (read-only)
- bun
- required
- family
- business-scope-expiry-job.ts
- presentation/redirect-middleware.ts
- seo-facts-port-adapter.ts
- reply-notifications.ts
- archive-purge-job.ts
- consumer-state-directory.ts
- mfa-policy.ts
- redirect-target.ts
- theme-registry.test.ts
- Sync-first rule (syncModuleDescriptors)
- CI job: quality
- AWCMS family conformance to AWCMS-Mini standard
- runSecurityReadinessChecks()
- social-share-links.ts
- verifySyncHeaders()
- visitor-analytics-privacy.test.ts
- devDependencies
- seo_distribution module (discovery scope)
- withTenant integration point (SET LOCAL tenant + backpressure)
- security.astro
- domains.astro
- comments OpenAPI fragment
- lifecycle-registry.ts
- logging-lint-check.ts
- openapi-bundle.ts
- validate-env.ts
- db-role-separation-worker-setup-migration.test.ts
- content-block-media-references.ts
- application/permission-sync.ts
- ad-placements/[id].ts
- reporting.test.ts
- discovery-cache.ts
- condition-action-registry.ts
- definitions/[id].ts
- Varnish 7.5 edge-cache service
- awcms-family-compatibility.schema.json
- Data Lifecycle module README
- site-search OpenAPI fragment
- changeset-policy-check.ts
- object-dispatch.ts
- media-object-key.ts
- search-service.ts
- site-search-domain.test.ts
- sync-storage.test.ts
- Idempotent High-Risk Mutation Skill
- migrationChecksum
- required
- properties
- commentableResources descriptor seam
- comment-retention.ts
- sync-agent-memory.ts
- video-news-block-validation.ts
- office-validation.ts
- presentation/theme-public-css.ts
- rollup.ts
- awcms_resolve_tenant_domain_lookup SECURITY DEFINER bootstrap read
- Tenant Admin Module
- Row-Level Security (RLS)
- Derived Application Guide (DEPRECATED, ADR-0034)
- check-docs.mjs
- docs-i18n-checks.mjs
- purge-queue.ts
- application/form-draft-purge.ts
- security-headers.ts
- compare.ts
- getRegisteredCommentableResources()
- data-lifecycle/module.ts
- Domain Event Dispatcher
- email/templates/[id].ts
- Email Module
- tenant-auth-policy.ts
- reporting/module.ts
- intentionalDivergences (reason + owner + reviewDate + ADR)
- AWCMS project skill catalog
- release-verify-checks.ts
- keywords
- turnstile-enforcement.test.ts
- validate-module-graph.ts
- run-record-store.ts
- role-admin-validation.ts
- media-upload-session-validation.ts
- application/navigation-registry.ts
- suggest.ts
- sync-validation.ts
- visitor-analytics-config.ts
- Admin sidebar rendered from module registry (sidebar-menu.ts)
- ProjectionDescriptor registry (cursor_table vs domain_event)
- config.json
- Blog Content module README
- openapi-route-parity-mutation.test.ts
- cacheability.ts
- surface-registry.ts
- ads/[id].ts
- cursor-store.ts
- enable-managed-media-enforcement.ts
- ad-placement-rotation.ts
- news-portal-preset-readiness.ts
- redirect-eligibility.ts
- openapi-bundle.test.ts
- Private vulnerability reporting policy
- Theming lifecycle draft→validate→preview→publish→rollback/retire
- tenant-domain:dns:sync reconciliation job
- .prettierrc.json
- social-publishing-port.ts
- timing-token.ts
- manifest-store.ts
- abac-policy-directory.ts
- MediaLibraryPort Capability
- AWCMS Public API Pre-migration OpenAPI Snapshot
- soft-delete.ts
- capabilities field (ports-and-adapters seam)
- Reusable wizard-form component library (target spec, not ported)
- ADR-0028 OIDC/SSO Tenant-aware, Account Linking, Break-glass
- Five module categories and admission criteria
- data_lifecycle module (registry + safe lifecycle engine)
- index.astro
- tenant-route-factory-check.ts
- 009_awcms_domain_event_runtime_schema.sql
- 013_awcms_workflow_approval_schema.sql
- 015_awcms_reporting_projections_schema.sql
- 035_awcms_blog_content_schema.sql
- 037_awcms_blog_content_presentation_schema.sql
- 066_awcms_comments_schema.sql
- suppression-validation.ts
- settings-validation.ts
- path-sanitizer.ts
- Media-library ownership inversion (ADR-0036)
- form_drafts module (domain-agnostic server-side draft store)
- properties
- db-pool-health.ts
- 005_awcms_abac_access_control_schema.sql
- online-security-config.ts
- application/blog-scheduled-publish.ts
- menus/index.ts
- workflow-notification-port-adapter.ts
- sod-conflict-evaluation-log.ts
- domain/health-registry.ts
- Per-tenant Salted Visitor-Key Hash
- tenant-domain-dns-config.ts
- visitor-analytics/module.ts
- Admin-approved self-registration (sql/074-075, stores no credential)
- comments module guidance (moderation-first)
- ADR-0019 integration_hub module admission (System Foundation)
- news-share.js
- edge-cache-surfaces-check.ts
- 024_awcms_mfa_totp_schema.sql
- 033_awcms_theming_config_schema.sql
- node-management.ts
- example_crm Example Module
- db-role-grants-narrow-migration.test.ts
- db-role-separation-migration.test.ts
- news-portal-no-local-fallback.test.ts
- Workflow Approval Module
- awcms_sync_nodes
- 014_awcms_email_schema.sql
- 025_awcms_oidc_sso_schema.sql
- 055_awcms_data_lifecycle_schema.sql
- correlation-response.ts
- localized-content-directory.ts
- lifecycle-validation.ts
- tenant-settings-directory.ts
- theme-permissions.ts
- admin-security-page-contract.test.ts
- family-conformance-ci-parity.test.ts
- AWCMS Media Library Module (skill)
- validateModuleDependencyGraph (registry-wide DAG validator)
- defineTenantRoute (mandatory tenant route opener)
- Issue template chooser config
- AWCMS Family Direct-Use Templates (mini/awcms/micro)
- capabilityContractVersions (party_directory, media_library, seo_facts, auth_notification)
- CONTRIBUTING.md
- security-readiness-worker-setup-grants.test.ts
- awcms_tenants
- awcms_profiles
- awcms_identities
- 050_awcms_visitor_analytics_schema.sql
- 060_awcms_seo_distribution_redirect_schema.sql
- env.d.ts
- admin-form-client.ts
- Legal hold enforced at the purge, not in data_lifecycle
- ThemeConfig (data, not code)
- Bundle Fragment Conflict Rejection (BundleConflictError)
- migration-tenant-guc-consistency.test.ts
- Bounded file parsing (HTTP tier + early parser abort)
- Finalize does full GET + magic-byte sniff + server checksum
- Separate R2 bucket/credentials from sync-storage (key decision #1)
- Postgres status does not gate R2 storage access (key decision #4)
- adr-admission-implementation-status.test.ts
- Sprint/milestone plan
- Mini-First Development Flow
- Required Status Checks (Repository Ruleset)
- Domain event outbox + dead-letter replay
- 011_awcms_sync_storage_conflict_schema.sql
- 031_awcms_abac_policy_dsl_schema.sql
- 071_awcms_sidebar_menu_schema.sql
- author-lookup.ts
- Secret-shaped keys rejected, not redacted
- evaluateManagedMediaReadiness
- access-audit-report.ts
- tenant-activity-report.ts
- ProjectionDescriptor Contract
- edge-cache-content-purge.test.ts
- self-registration-contract.test.ts
- GitHub Snapshot Refresh Skill
- Public discovery routes are Astro, not OpenAPI
- Centralized public-visibility predicate tested exhaustively
- UI/UX Improvement Review guide
- Changesets policy gate workflow
- ADR-0002
- domain_event_runtime reference event (outbox exerciser)
- Standalone optional Redis service (internal-network only)
- Docs staleness gate (i18n-source-hash)
- awcms-family-compatibility manifest + family:conformance:check
- OpenAPI/AsyncAPI contract standard
- Tenant Admin module (offices/settings/setup)
- awcms_setup_state
- awcms_audit_events
- awcms_object_sync_queue
- awcms_blog_internal_tag_link_settings
- awcms_news_media_objects
- awcms_news_portal_tenant_state
- awcms_news_portal_homepage_sections
- awcms_news_portal_ad_placements
- awcms_tenant_domains
- awcms_media_library_tenant_state
- awcms_seo_tenant_settings
- awcms_seo_tenant_settings
- awcms_form_drafts
- awcms_site_search_documents
- awcms_edge_cache_purges
- awcms_password_reset_tokens
- awcms_registration_requests
- Concurrency & Quorum Integrity
- Browser E2E Test (Playwright+Bun) Skill
- Module health check (passive GET vs explicit POST)
- Job registry as documentation-only metadata
- Standard API response helpers (ok/created/fail)
- Standard error code catalog
- Migration naming NNN_awcms_<area>_<desc>.sql
- assertNoTransactionControl (no BEGIN/COMMIT in migrations)
- Standard module folder structure
- AWCMS Repo Inventory Regenerate (skill)
- Five live management reporting views
- renderControlledJsonLd (closed union, escaped)
- Design tokens & state pattern (doc 14)
- Dependabot config (bun + github-actions)
- GitHub Sponsor FUNDING config
- CI job: repo hygiene (Bun-only + no secrets)
- CodeQL analysis workflow
- Mandatory Per-Task Workflow (branch-first, atomic PR, bun run check)
- ADR-0000 Template
- AI Business Analyst module
- Central Profile module
- Changesets SemVer versioning
- Repository structure & module layout
- Offline-first / LAN-first
- Stock Movement (append-only)
- Transactional Outbox / Inbox
- OWASP/ASVS/ISO 27001 Compliance Matrix (target)
- Keyset cursor microsecond precision trap
- Operator-safe Delivery Replay
- Email Template Management + Category Allowlist
- WORKFLOW_ACTION_HANDLERS

## God Nodes (most connected - your core abstractions)
1. `withTenant()` - 540 edges
2. `getDatabaseClient()` - 461 edges
3. `fail()` - 455 edges
4. `ok()` - 434 edges
5. `hashSessionToken()` - 428 edges
6. `resolveAuthInputs()` - 413 edges
7. `authorizeInTransaction()` - 404 edges
8. `recordAuditEvent()` - 263 edges
9. `bodyTooLargeResponse()` - 188 edges
10. `readJsonBody()` - 160 edges

## Surprising Connections (you probably didn't know these)
- `Unauthenticated public write surface backbone (no oracle, PII minimized)` --semantically_similar_to--> `Admin-approved self-registration (sql/074-075, stores no credential)`  [INFERRED] [semantically similar]
  .claude/skills/awcms-comments/SKILL.md → .changeset/self-registration.md
- `normalize()` --indirect_call--> `table()`  [INFERRED]
  tests/db-role-separation-worker-setup-migration.test.ts → scripts/api-docs-generate.ts
- `Reporting module (management reporting + projections)` --semantically_similar_to--> `Data Lifecycle module README`  [INFERRED] [semantically similar]
  openapi/modules/reporting.openapi.yaml → src/modules/data-lifecycle/README.md
- `work-class registry generator + freshness gate (ghost .generated artifact)` --semantically_similar_to--> `edge-cache:surfaces:check ownership-derived purge obligation`  [INFERRED] [semantically similar]
  .changeset/work-class-registry-tooling.md → CHANGELOG.md
- `Ghost env vars AUTH_JWT_SECRET / APP_TIMEZONE documented but unread` --semantically_similar_to--> `work-class registry generator + freshness gate (ghost .generated artifact)`  [INFERRED] [semantically similar]
  CHANGELOG.md → .changeset/work-class-registry-tooling.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Registry contribution seams: owner module declares, aggregator discovers via listModules()** — _claude_skills_awcms_comments_skill_commentableresources, _claude_skills_awcms_blog_content_skill_descriptor_contributions, _claude_skills_awcms_data_lifecycle_skill_highvolumetabledescriptor, _changeset_admin_sidebar_from_registry_sidebar, _changeset_module_route_ownership_routes [INFERRED 0.85]
- **Edge-cache invalidation failure chain (three silent defects, all reporting success)** — changelog_edge_cache_ban_expression_fix, changelog_bun_nonstandard_method_defect, changelog_edge_cache_guc_mismatch_fix, changelog_edge_cache_surfaces_check, _claude_skills_awcms_edge_cache_skill_surrogate_key_vocabulary [EXTRACTED 0.95]
- **Anonymous surfaces answer uniformly: no enumeration oracle anywhere** — _claude_skills_awcms_comments_skill_public_write_security, _changeset_self_registration_flow, _changeset_password_reset_via_email_flow, _claude_skills_awcms_blog_content_skill_public_visibility_predicates [INFERRED 0.85]
- **Descriptor-list seam pattern: module declares, central aggregator discovers via listModules()** — _claude_skills_awcms_module_management_skill_modulecontractversion, _claude_skills_awcms_site_search_skill_searchsourcesseam, _claude_skills_awcms_reporting_skill_projectiondescriptor, docs_adr_0018_data_exchange_module_admission_adapterport, docs_adr_0021_reference_data_module_admission_referencedataport [INFERRED 0.85]
- **Direct-to-R2 media upload defense-in-depth chain** — _claude_skills_awcms_news_portal_skill_r2bucketseparation, _claude_skills_awcms_news_portal_skill_objectkeynopii, _claude_skills_awcms_news_portal_skill_finalizemimesniffing, _claude_skills_awcms_news_portal_skill_toctousizecap, _claude_skills_awcms_news_portal_skill_atomicuploadclaim [EXTRACTED 1.00]
- **Tenant isolation enforcement stack (FORCE RLS + composite FK + least-privilege roles + scoped bootstrap read)** — _claude_skills_awcms_new_migration_skill_forcerls, _claude_skills_awcms_new_migration_skill_compositefk, _claude_skills_awcms_new_migration_skill_workerrolegrants, _claude_skills_awcms_tenant_domain_routing_skill_domainbootstraprole, docs_adr_0016_organization_structure_module_admission_tenantvslegalentity [INFERRED 0.85]
- **Descriptor-list contribution seam pattern (inward, many providers)** — docs_adr_0040_site_search_module_admission_search_source_descriptor, docs_adr_0041_comments_module_admission_commentable_resources, docs_adr_0040_site_search_module_admission_inward_dependency_direction, docs_awcms_absorb_awcms_micro_roadmap_contract_version_per_seam, docs_awcms_21_module_admission_governance_lifecycle_vs_capability_dependency [EXTRACTED 1.00]
- **Edge-cache defence in depth (allow-list, labelling, default-deny VCL, anchored invalidation)** — docs_adr_0042_varnish_edge_cache_auto_activation_decide_cacheability, docs_adr_0042_varnish_edge_cache_auto_activation_default_deny_vcl, docs_adr_0042_varnish_edge_cache_auto_activation_surrogate_key_invalidation, docs_adr_0042_varnish_edge_cache_auto_activation_cache_key_space_bound, docs_awcms_edge_cache_architecture_public_cache_surfaces [EXTRACTED 1.00]
- **Tenant isolation backbone (tenant context, FORCE RLS + role separation, authorization chokepoint)** — docs_architecture_with_tenant_rls_context, docs_architecture_rls_force_and_role_separation, docs_architecture_authorize_in_transaction, docs_architecture_evaluate_access, docs_awcms_deployment_profiles_two_role_database_model [EXTRACTED 1.00]
- **DB-gated suite execution split across CI and release** — _github_workflows_ci_integration_tests, _github_workflows_ci_suite_collision_split, _github_workflows_ci_integration_timeout, _github_workflows_release_validate, _github_workflows_release_database_url_unset [EXTRACTED 1.00]
- **Unseeded permission action denies even the tenant owner** — src_modules_form_drafts_readme_no_submit_permission, src_modules_module_management_readme_no_new_permission, src_modules_identity_access_readme_seeded_action_constraint, src_modules_module_management_readme_module_audit_summary [INFERRED 0.95]
- **Pure-data descriptor seams discovered via listModules()** — src_modules_comments_readme_commentable_resources_seam, src_modules_site_search_readme_search_source_descriptor, src_modules_form_drafts_readme_legal_hold_enforcement, docs_project_state_module_contract_version [INFERRED 0.85]
- **Direct-Use / Online-First-Superset Governance Chain** — agents_adr_0034_derived_pathway_removal, agents_adr_0020_erp_readiness_contracts, agents_awcms_family_direct_use [EXTRACTED 1.00]
- **ADR-0006 Provider-Outside-Transaction Discipline** — _claude_skills_awcms_integration_skill_adr_0006, _claude_skills_awcms_integration_skill_transactional_outbox, _claude_skills_awcms_integration_hub_skill_outbound_fanout_consumer, _claude_skills_awcms_observability_skill_extension_point [INFERRED 0.85]
- **AWCMS foundation technical standards (ADR-0001 baseline)** — docs_adr_0001_rebuild_on_awcms_foundation_erp_scope_decision, docs_adr_0002_bun_only_runtime_decision, docs_adr_0003_postgresql_rls_multi_tenant_decision, docs_adr_0004_rbac_abac_default_deny_decision, docs_adr_0005_soft_delete_and_immutability_decision, docs_adr_0006_offline_first_sync_outbox_decision, docs_adr_0007_openapi_asyncapi_contracts_decision [EXTRACTED 0.90]
- **Wave 2 ERP authorization stack (business-scope, SoD, ABAC)** — docs_adr_0030_business_scope_hierarchy_generic_authorization_layer_adr, docs_adr_0031_segregation_of_duties_conflict_enforcement_adr, docs_adr_0033_abac_dynamic_policy_evaluator_adr [EXTRACTED 0.90]
- **Ported/hardened login security controls (MFA, OIDC, Turnstile)** — docs_adr_0027_mfa_totp_session_assurance_step_up_adr, docs_adr_0028_oidc_sso_tenant_aware_account_linking_break_glass_adr, docs_adr_0029_deployment_profile_aware_turnstile_bot_protection_adr [EXTRACTED 0.90]
- **SEO discovery renderer + seam + surfaces** — docs_adr_0038_seo_distribution_module_admission_discovery_scope_seo_distribution_module, docs_adr_0038_seo_distribution_module_admission_discovery_scope_seo_facts_port, docs_adr_0038_seo_distribution_module_admission_discovery_scope_discovery_routes, docs_adr_0038_seo_distribution_module_admission_discovery_scope_host_poisoning_defense [EXTRACTED 1.00]
- **AWCMS security baseline (RBAC/ABAC/RLS/audit/idempotency)** — docs_awcms_17_default_seed_rbac_abac_rbac_abac_model, docs_awcms_04_erd_data_dictionary_rls_standard, docs_awcms_10_template_kode_coding_standard_abac_guard, docs_awcms_16_backend_data_access_integration_idempotency_store, docs_awcms_16_backend_data_access_integration_withtenant_rls [INFERRED 0.85]
- **AWCMS layered security control stack** — docs_awcms_19_glossary_terminology_rls, docs_awcms_19_glossary_terminology_abac, docs_awcms_19_glossary_terminology_default_deny, docs_awcms_19_glossary_terminology_idempotency, docs_awcms_20_threat_model_security_architecture_layered_controls [INFERRED 0.85]
- **Database pooling / backpressure protection stack** — docs_awcms_database_pooling_bun_sql_pool, docs_awcms_database_pooling_work_class_gate, docs_awcms_database_pooling_circuit_breaker, docs_awcms_database_pooling_withtenant [EXTRACTED 0.85]
- **Derived-application / ERP-extension composition model** — docs_awcms_derived_application_guide_build_time_composition, docs_awcms_21_module_admission_governance_five_categories, docs_awcms_api_contribution_guide_modular_openapi, docs_awcms_erp_extension_contracts_eleven_contracts, docs_awcms_derived_app_pilot_purchase_requisition_plan_pilot [INFERRED 0.75]
- **Production readiness preflight orchestration** — docs_awcms_production_readiness_config_validate, docs_awcms_production_readiness_security_readiness, docs_awcms_production_readiness_db_pool_health, docs_awcms_production_readiness_preflight_orchestrator, docs_awcms_production_preflight_runbook_preflight [EXTRACTED 0.90]
- **Layered login-flow security (Turnstile/MFA/OIDC)** — docs_awcms_turnstile_bot_protection_turnstile, docs_awcms_mfa_totp_step_up_mfa, docs_awcms_oidc_sso_sso, docs_awcms_oidc_sso_break_glass, docs_awcms_mfa_totp_step_up_per_factor_lockout [INFERRED 0.80]
- **Non-production safety interlock (target guard reuse)** — docs_awcms_production_preflight_runbook_authorizeapply, docs_awcms_resilience_dr_verification_target_guard, docs_awcms_performance_suite_safety_interlock [EXTRACTED 0.90]
- **Verified R2 media-object dependency (managed media)** — openapi_modules_media_library_openapi_newsmediaobjectitem, openapi_modules_media_library_openapi_enforcement, openapi_modules_news_portal_openapi_module, openapi_modules_theming_openapi_module, openapi_modules_seo_distribution_openapi_module, src_modules_blog_content_readme [EXTRACTED 0.90]
- **ADR-0006 Transactional Outbox / Three-phase Dispatcher Pattern** — src_modules_domain_event_runtime_readme_dispatcher, src_modules_email_readme_email_dispatcher, src_modules_sync_storage_readme_object_dispatcher [INFERRED 0.85]
- **Capability Port Seam Pattern (provides/consumes)** — src_modules_media_library_readme_media_library_port, src_modules_seo_distribution_readme_seo_facts_contract, src_modules_workflow_approval_readme_condition_registry, src_modules_sync_storage_readme_object_uploader, src_modules_email_readme_email_provider_contract [INFERRED 0.75]

## Communities (485 total, 73 thin omitted)

### Community 0 - "Tenant Transaction & Authorization Core"
Cohesion: 0.03
Nodes (194): hashSessionToken(), isPostgresClientInputError(), POSTGRES_CLIENT_INPUT_ERROR_CLASSES, withTenant(), WithTenantOptions, listConsumerStates(), UnknownDomainEventConsumerError, authorizeInTransaction() (+186 more)

### Community 1 - "Audit Log & Idempotency"
Cohesion: 0.05
Nodes (121): resolveAuthInputs(), rejectSoDConflictException(), AuditEventInput, AuditEventRecord, ListAuditEventsOptions, recordAuditEvent(), finalizeNewsMediaUploadSession(), findProjectionDescriptor() (+113 more)

### Community 2 - "Database Client & Request Body Limits"
Cohesion: 0.03
Nodes (118): buildClient(), getNamedDatabaseClient(), POOL_MAX_OVERRIDE_ENV_VAR, sharedClients, BODY_SIZE_TIER_BYTES, BodyReadResult, BodySizeTier, bodyTooLargeResponse() (+110 more)

### Community 3 - "Error Responses & HTML Escaping"
Cohesion: 0.07
Nodes (74): errorPage(), notFoundHtmlResponse(), notFoundXmlResponse(), serverErrorHtmlResponse(), serverErrorXmlResponse(), ADR-0038, escapeHtml(), ADR-0038 (+66 more)

### Community 4 - "SSR Session & Blog Revisions"
Cohesion: 0.05
Nodes (60): resolveSsrContext(), SsrContext, BlogRevisionDetail, BlogRevisionDetailRow, BlogRevisionSnapshot, BlogRevisionSummary, BlogRevisionSummaryRow, createBlogRevision() (+52 more)

### Community 5 - "MFA TOTP & Recovery Codes"
Cohesion: 0.06
Nodes (67): RFC-4226, RFC-4648, generateChallengeToken(), hashChallengeToken(), resolveMfaLockoutMinutes(), resolveMfaMaxVerifyAttempts(), resolveTotpDigits(), resolveTotpIssuer() (+59 more)

### Community 6 - "Module Descriptor Registry"
Cohesion: 0.03
Nodes (65): ADR-0025, domainEventRuntimeModule, emailModule, ADR-0011, ADR-0013, identityAccessModule, ADR-0011, loggingModule (+57 more)

### Community 7 - "OIDC OAuth State & PKCE"
Cohesion: 0.05
Nodes (60): resetGenericOidcCachesForTests(), buildOAuthStateParam(), computePkceChallengeS256(), generateOAuthState(), generateOidcNonce(), generatePkceVerifier(), hashOAuthState(), parseOAuthStateParam() (+52 more)

### Community 8 - "Circuit Breaker & Provider Metrics"
Cohesion: 0.06
Nodes (52): CircuitBreaker, CircuitBreakerOptions, CircuitState, circuitStateRank(), createCircuitBreaker(), decorateWithMetrics(), deriveProviderFamilyLabel(), getDatabaseCircuitBreaker() (+44 more)

### Community 9 - "Integration Test Seeding"
Cohesion: 0.06
Nodes (57): listBreakGlassCandidates(), candidates(), seedAccount(), seedTenant(), insertPost(), publicList(), seedTenant(), settings (+49 more)

### Community 10 - "Reporting Projection Workers"
Cohesion: 0.07
Nodes (58): runBoundedBatches(), applyEventActivityProjectionIncrement(), ProjectionRebuildInProgressError, getStreamCursor(), resetProjectionCursors(), upsertStreamCursor(), assertSafeIdentifier(), computeMetricDeltas() (+50 more)

### Community 11 - "package.json Script Surface"
Cohesion: 0.03
Nodes (68): scripts, analytics:purge, analytics:rollup, api:docs:check, api:docs:generate, api:spec:check, api:tenant-route:check, blog:publish:scheduled (+60 more)

### Community 12 - "MFA Config & Client Fingerprint"
Cohesion: 0.08
Nodes (55): AUTH_MFA_REQUIRED_WHEN_ENABLED, isMfaFeatureEnabled(), KNOWN_TOTP_DIGITS, resolveChallengeTtlSec(), resolveMfaRateLimitMax(), resolveMfaRateLimitWindowSec(), resolveStepUpTtlSec(), verifyPassword() (+47 more)

### Community 13 - "Site Search Index Engine"
Cohesion: 0.07
Nodes (52): ADR-0003, main(), ADR-0040, SearchSourceDescriptor, countSource(), createRun(), finalizeRun(), IndexRunResult (+44 more)

### Community 14 - "Admin Page Imports"
Cohesion: 0.06
Nodes (44): ../components/LocaleBadge.astro, ../components/SyncIndicator.astro, ../components/TenantBadge.astro, ../components/ThemeToggle.astro, ../lib/auth/self-registration-config, ../lib/database/client, ../lib/database/tenant-context, ../lib/security/theme-init-script (+36 more)

### Community 15 - "Scheduled Job Entrypoints"
Cohesion: 0.15
Nodes (45): main(), main(), ADR-0011, ADR-0036, main(), ADR-0037, DomainEventsDispatchOptions, DomainEventsDispatchRunResult (+37 more)

### Community 16 - "Password Reset Tokens & Delivery"
Cohesion: 0.07
Nodes (45): generateResetToken(), hashResetToken(), openUrlParams(), resolveUrlParamKey(), sealUrlParams(), ADR-0011, completePasswordReset(), CompletePasswordResetResult (+37 more)

### Community 17 - "Projection Directory & Reconciliation"
Cohesion: 0.07
Nodes (39): main(), buildSummaryView(), getProjectionSummaryForTenant(), listProjectionSummariesForTenant(), listRegisteredProjectionDescriptors(), ProjectionSummaryLookupResult, ProjectionSummaryView, getProjectionMetrics() (+31 more)

### Community 18 - "Internal Tag Link Rendering"
Cohesion: 0.07
Nodes (44): buildTagArchiveUrl(), InternalTagLinkingContext, InternalTagLinkingDisabledReason, InternalTagLinkingPreview, previewInternalTagLinksForContent(), renderContentHtmlWithInternalTagLinks(), resolveInternalTagLinkingContext(), countExistingTagTermIds() (+36 more)

### Community 19 - "Blog Page/Post Validation"
Cohesion: 0.09
Nodes (47): CreateBlogPageValidationResult, SoftDeleteBlogPageInput, SoftDeleteBlogPageValidationResult, UpdateBlogPageValidationResult, validateCreateBlogPageInput(), validateFeaturedMediaId(), validateMenuOrder(), validateParentPageId() (+39 more)

### Community 20 - "SEO Discovery Payloads"
Cohesion: 0.09
Nodes (46): RFC-822, escapeXmlText(), absoluteUrl(), buildFeedPayload(), buildRobotsPayload(), buildSitemapIndexPayload(), buildSitemapPagePayload(), computeLastModified() (+38 more)

### Community 21 - "API Response & Keyset Pagination"
Cohesion: 0.06
Nodes (39): evaluateFieldAccessInTransaction(), createRole(), ApiErrorBody, ApiMeta, ApiSuccess, created(), JsonResponseInit, decodeKeysetCursor() (+31 more)

### Community 22 - "Capacity Budget Config"
Cohesion: 0.06
Nodes (43): CapacityBudgetReport, CapacityConfig, CapacityFinding, CapacityFindingSeverity, CapacityScenario, CapacityUsage, computeCapacityUsage(), DEFAULT_INSTANCE_COUNTS (+35 more)

### Community 23 - "Sidebar Menu Arrangement"
Cohesion: 0.08
Nodes (38): ../modules/module-management/application/sidebar-menu-config, ../modules/module-management/domain/sidebar-menu, buildSidebarEditorModel(), fetchRenderedSidebar(), fetchSidebarArrangement(), ItemRow, resetSidebarArrangement(), saveSidebarArrangement() (+30 more)

### Community 24 - "Tenant Domain DNS Reconciliation"
Cohesion: 0.07
Nodes (37): RFC-1035, RFC-2181, main(), TenantRow, ReconcileOutcome, reconcileServingRecords(), ReconcileSummary, resolveServingTarget() (+29 more)

### Community 25 - "ABAC Policy Admin Routes"
Cohesion: 0.08
Nodes (39): getDatabaseClient(), getAbacPolicyById(), invalidatePolicyCache(), createParty(), softDeleteParty(), toPartyMaskedAdminDTO(), PATCH(), UPDATE_GUARD (+31 more)

### Community 26 - "Redis Cache & Health"
Cohesion: 0.10
Nodes (36): config, failures, findings, safeErrorDetail, deleteRedisCache(), getRedisJson(), redisCacheAside(), RedisCacheAsideOptions (+28 more)

### Community 27 - "Content Ownership ABAC Policies"
Cohesion: 0.07
Nodes (36): ContentOwnershipAttributes, ADR-0004, PageOwnershipAttributes, ADR-0004, UPDATE_GUARD, PostOwnershipAttributes, ADR-0004, UPDATE_GUARD (+28 more)

### Community 28 - "Blog Page Directory"
Cohesion: 0.07
Nodes (40): BlogPageRow, BlogPageSummary, BlogPageSummaryRow, BlogPageView, createBlogPage(), fetchBlogPageById(), FetchBlogPageOptions, listBlogPages() (+32 more)

### Community 29 - "Comments Service"
Cohesion: 0.08
Nodes (38): CommentCursor, CommentRow, EditCommentResult, isBoundAuthor(), isDuplicate(), listApprovedComments(), PublicCommentView, recordAbuseEvent() (+30 more)

### Community 30 - "post-status.ts"
Cohesion: 0.08
Nodes (35): BlogTermRow, BlogTermView, createBlogTerm(), fetchBlogTermById(), fetchBlogTermsByTaxonomyType(), listBlogTerms(), ListBlogTermsFilter, softDeleteBlogTerm() (+27 more)

### Community 31 - "sod-exception-service.ts"
Cohesion: 0.09
Nodes (39): createBusinessScopeAssignment(), resolveSoDAssignmentFacts(), checkHighRiskSoDConflicts(), DEFAULT_SOD_RELEVANT_PERMISSION_KEYS, extractRequestedScope(), HighRiskSoDCheckOptions, HighRiskSoDCheckResult, relevantKeysFor() (+31 more)

### Community 32 - "tenant-route.ts"
Cohesion: 0.06
Nodes (26): rejectRegistrationRequest(), boundAuditSummaryLimit(), fetchModuleAuditSummary(), ModuleAuditSummaryEntry, RELEVANT_RESOURCE_TYPES, AuthorizedAccess, defineTenantRoute(), TenantRouteConfig (+18 more)

### Community 33 - "media-reconciliation.ts"
Cohesion: 0.09
Nodes (37): fetchNewsMediaObjectsForReconciliation(), markNewsMediaObjectFailed(), markStaleOrphanedNewsMediaObjectDeleted(), objectKeyExistsForTenant(), purgeExpiredPendingNewsMediaObject(), cleanupExpiredPending(), cleanupOrphanInR2(), cleanupStaleOrphaned() (+29 more)

### Community 34 - "AWCMS Backend & Integration Hardening (skill)"
Cohesion: 0.07
Nodes (40): AWCMS Integration Hub Module (skill, read-only spec), Integration Hub Outbound Fanout Consumer, DB-Constraint Replay Protection (UNIQUE replay_key), Secret Reference Prefix Validation (INTEGRATION_HUB_), Two-Layer SSRF Guard with Manual-Redirect Re-Validation, Timing-Safe Signature Verification (timingSafeEqualHex), ADR-0006 Provider Optional & Outside DB Transaction, AWCMS Backend & Integration Hardening (skill) (+32 more)

### Community 35 - "generic-oidc-client.ts"
Cohesion: 0.09
Nodes (35): RFC-1918, discoverOidcConfiguration(), DiscoverOidcResult, discoveryCache, discoveryFailureCache, exchangeAuthorizationCode(), ExchangeCodeParams, ExchangeCodeResult (+27 more)

### Community 36 - "audit-log-purge.ts"
Cohesion: 0.08
Nodes (29): AuditLogPurgeOptions, AuditLogPurgeResult, resolveRetentionDays(), runAuditLogPurge(), legalHoldGuardPortAdapter, ADR-0011, ADR-0037, countPurgeableAuditEvents() (+21 more)

### Community 37 - "form-draft-directory.ts"
Cohesion: 0.10
Nodes (34): createFormDraft(), deleteFormDraft(), fetchActiveFormDraft(), FormDraftRow, FormDraftView, listFormDrafts(), ListFormDraftsFilter, submitFormDraft() (+26 more)

### Community 38 - "seo-document.ts"
Cohesion: 0.10
Nodes (33): PrimaryHostRow, resolveTenantPrimaryHost(), ADR-0038, renderResourceSeoHead(), resolveImages(), SeoResourceRenderInput, SeoResourceRenderResult, ADR-0038 (+25 more)

### Community 39 - "domain/module-presets.ts"
Cohesion: 0.09
Nodes (30): DEPENDENCY_WARNING_CODES, fetchModuleMatrix(), ModuleMatrixRow, ModuleMatrixWarning, applyModulePreset(), currentTenantState(), listModulePresets(), ModulePresetApplyResult (+22 more)

### Community 40 - "export-generation.ts"
Cohesion: 0.08
Nodes (34): GenerateExportInput, generateProjectionExport(), resolveExportRootPath(), resolveRetentionDays(), ADR-0006, ExportRunDbRow, ExportRunFormat, ExportRunRow (+26 more)

### Community 41 - "mailketing-provider.ts"
Cohesion: 0.09
Nodes (26): main(), EMAIL_MAILKETING_REQUIRED_WHEN_SELECTED, EMAIL_REQUIRED_WHEN_ENABLED, EmailProviderKind, isKnownEmailProvider(), KNOWN_EMAIL_PROVIDERS, resolveEmailSendTimeoutMs(), EmailAddress (+18 more)

### Community 42 - "assertUuid()"
Cohesion: 0.09
Nodes (31): assertUuid(), appendDomainEvent(), createWorkflowDelegation(), CreateWorkflowDelegationParams, listWorkflowDelegations(), revokeWorkflowDelegation(), RevokeWorkflowDelegationParams, WorkflowDelegationForbiddenError (+23 more)

### Community 43 - "dispatch-domain-events.ts"
Cohesion: 0.08
Nodes (28): classifyError(), NOT_RETRYABLE_SQLSTATE_CLASSES, RETRYABLE_SQLSTATE_CLASSES, RETRYABLE_SQLSTATES, RetryClassification, ADR-0006, ClaimedDeliveryRow, dispatchDomainEventsForTenant() (+20 more)

### Community 44 - "ads-directory.ts"
Cohesion: 0.08
Nodes (34): ActiveAdForPlacement, ActiveAdRow, BlogAdPlacementRow, BlogAdPlacementView, BlogAdRow, BlogAdView, createAd(), fetchAdById() (+26 more)

### Community 45 - "content-quality-checklist.ts"
Cohesion: 0.09
Nodes (32): sanitizeChecklistPolicyOverrides(), ChecklistEvaluableContent, EvaluateContentQualityChecklistOptions, SocialPreviewFallbackOptions, ADR-0011, UpdateBlogSettingsInput, UpdateBlogSettingsValidationResult, validateContentQualityChecklistPolicy() (+24 more)

### Community 46 - "comment-settings.ts"
Cohesion: 0.09
Nodes (33): CommentSettingsAuditHook, fetchCommentSettings(), SettingsRow, toSettings(), ADR-0041, updateCommentSettings(), CommentThread, findThread() (+25 more)

### Community 47 - "identifier-directory.ts"
Cohesion: 0.10
Nodes (29): createSuppression(), CreateSuppressionResult, deleteSuppression(), listSuppressions(), SuppressionEntry, SuppressionRow, toView(), addIdentifierToProfile() (+21 more)

### Community 48 - "src/modules/index.ts"
Cohesion: 0.07
Nodes (26): ADR-0006, ADR-0028, commentsModule, ADR-0041, FORM_DRAFT_PERMISSIONS, FormDraftPermission, formDraftsModule, ADR-0037 (+18 more)

### Community 49 - "public-host-tenant-resolver.ts"
Cohesion: 0.09
Nodes (30): defaultDeps, extractHostHeader(), fetchActivePublicTenantById(), isValidHostnameShape(), normalizePublicHost(), PublicHostResolverConfig, PublicHostResolverDeps, PublicTenantResolutionMode (+22 more)

### Community 50 - "homepage-section-policy.ts"
Cohesion: 0.10
Nodes (34): createHomepageSection(), HomepageSectionRow, HomepageSectionView, listActiveHomepageSectionsForRendering(), listHomepageSections(), softDeleteHomepageSection(), toView(), updateHomepageSection() (+26 more)

### Community 51 - "identity-access OpenAPI fragment"
Cohesion: 0.07
Nodes (36): AbacDslPolicyConditions schema, accessCreateAbacPolicy, accessEvaluate, accessSimulateAbacPolicy, approveRegistrationRequest, approveSoDConflictException, createBusinessScopeAssignment, identity-access OpenAPI fragment (+28 more)

### Community 52 - "blog-content-presentation-domain.test.ts"
Cohesion: 0.09
Nodes (31): BlogTemplateRow, BlogTemplateView, createTemplate(), fetchTemplateById(), listTemplates(), softDeleteTemplate(), toView(), updateTemplate() (+23 more)

### Community 53 - "enforceTurnstileIfRequired()"
Cohesion: 0.10
Nodes (27): RFC-5321, isSelfRegistrationEnabled(), enforceTurnstileIfRequired(), createEmailAuthNotificationAdapter(), PublicAuthTenantOptions, withPublicAuthTenant(), CompleteResetInput, ForgotIdentifierInput (+19 more)

### Community 54 - "serveDiscovery()"
Cohesion: 0.10
Nodes (25): RFC-7232, EnabledSeoProviders, resolveEnabledSeoProviders(), ADR-0038, DiscoveryBuilder, DiscoveryFallbacks, finalizeDiscoveryResponse(), parseDiscoveryLocaleParam() (+17 more)

### Community 55 - "ADR-0041: comments module admission"
Cohesion: 0.09
Nodes (35): Inward contribution direction (DAG-safe aggregator), awcms_site_search_documents index projection, Search index is never an authorization source, SearchSourceDescriptor (descriptor-list contribution seam), ADR-0040: site_search module admission, ts_headline sentinel snippet escaping, :tenantCode URL template adaptation, commentableResources descriptor seam (+27 more)

### Community 56 - "module-composition.ts"
Cohesion: 0.11
Nodes (26): runModuleCompositionInventoryCheck(), ADR-0025, buildModuleCompositionInventoryJson(), main(), ADR-0034, listBaseModules(), validateJobDescriptor(), buildComposedModuleInventory() (+18 more)

### Community 57 - "media-object-directory.ts"
Cohesion: 0.08
Nodes (32): defaultR2ClientFactory(), FinalizeNewsMediaUploadSessionDeps, FinalizeNewsMediaUploadSessionInput, PrecheckResult, ADR-0006, VERIFY_GUARD, attachNewsMediaObject(), AttachNewsMediaObjectInput (+24 more)

### Community 58 - "theming.integration.test.ts"
Cohesion: 0.12
Nodes (30): EMPTY_THEME_TENANT_STATE, fetchDraftVersion(), fetchThemeTenantState(), fetchVersionById(), insertPublishedVersion(), listPublishedVersionIds(), listPublishedVersions(), nextPublishedVersionNumber() (+22 more)

### Community 59 - "announcement-directory.ts"
Cohesion: 0.10
Nodes (28): AnnouncementPreviewResult, BoundedTargets, enqueueAnnouncement(), EnqueueAnnouncementResult, previewAnnouncement(), resolveAnnouncementTargets(), resolveBoundedAnnouncementTargets(), ResolvedRecipient (+20 more)

### Community 60 - "listModules()"
Cohesion: 0.10
Nodes (26): listModules(), fetchModuleJobs(), disableTenantModule(), enableTenantModule(), fetchTenantModuleEntries(), fetchTenantModuleRows(), resolveTenantState(), TenantModuleListEntry (+18 more)

### Community 61 - "media-library/module.ts"
Cohesion: 0.08
Nodes (23): ADR-0026, blogContentModule, ADR-0009, ADR-0036, ADR-0038, ADR-0040, ADR-0041, MEDIA_ENFORCEMENT_PERMISSIONS (+15 more)

### Community 62 - "ADR-0042: Varnish edge-cache tier, off by default"
Cohesion: 0.08
Nodes (33): Bounded cache key space via allowedQueryParams, decideCacheability fail-closed allow-list, Layered defence against Varnish cache-by-default, ADR-0042: Varnish edge-cache tier, off by default, Origin-pressure auto-activation (pressure changes HOW LONG, never WHAT), Anchored surrogate-key invalidation via durable purge queue, Host-resolved discovery surfaces deliberately not declared, recordAuditEvent audit trail with redaction and purge (+25 more)

### Community 63 - "abac-evaluator.ts"
Cohesion: 0.10
Nodes (29): AbacEnvironment, AbacEvaluationError, AbacPass, booleanOrAbsent(), buildAttributeBag(), CompiledPolicy, evaluateAbacPolicies(), evaluateCondition() (+21 more)

### Community 64 - "auth-provider-directory.ts"
Cohesion: 0.10
Nodes (29): resolveSsoMaxProvidersPerTenant(), encryptSsoClientSecret(), resolveSsoEncryptionKey(), AuthProviderRow, AuthProviderView, createAuthProvider(), CreateAuthProviderResult, fetchAuthProviderById() (+21 more)

### Community 65 - "abac-admin.ts"
Cohesion: 0.09
Nodes (27): AbacPolicyRow, createPolicy(), DuplicatePolicyCodeError, fetchPolicyById(), setPolicyActive(), toView(), ADR-0033, updatePolicy() (+19 more)

### Community 66 - "workflow-definition-directory.ts"
Cohesion: 0.10
Nodes (30): createNewDraftVersion(), createWorkflowDefinition(), CreateWorkflowDefinitionParams, fetchDefinitionForUpdate(), getWorkflowDefinitionById(), listWorkflowDefinitions(), ListWorkflowDefinitionsFilters, listWorkflowDefinitionVersions() (+22 more)

### Community 67 - "workflow-instance-decision.ts"
Cohesion: 0.09
Nodes (27): AssignmentRow, CompleteApprovalTaskParams, DelegationDbRow, RecordTaskDecisionParams, RecordTaskDecisionResult, TaskWithInstanceRow, CreateDelegationInput, CreateDelegationValidationResult (+19 more)

### Community 68 - "ADR-0033 Dynamic ABAC Policy Evaluator"
Cohesion: 0.08
Nodes (31): ADR-0022 ERP Modules Live in Extension Repos, ADR-0024 SemVer Continues Legacy Major Line (5.0.0), ADR-0025 Deterministic Build-time Module Composition, Module composition seam (mergeModuleRegistries/composeModuleRegistry), ModuleDescriptor contract, ADR-0026 Modular OpenAPI Ownership and Composition, Deterministic OpenAPI fragment bundler, ADR-0030 Business-scope Hierarchy Generic Authorization Layer (+23 more)

### Community 69 - "email-template-directory.ts"
Cohesion: 0.11
Nodes (26): main(), readArg(), logScriptFailure(), createEmailTemplate(), EmailTemplateRow, EmailTemplateView, listEmailTemplates(), ListEmailTemplatesFilter (+18 more)

### Community 70 - "turnstile.ts"
Cohesion: 0.09
Nodes (25): EnforceTurnstileOptions, isFreshChallenge(), readCappedText(), redact(), redactTruncate(), resolvePositiveIntEnv(), resolveTurnstileConfig(), resolveTurnstileMaxResponseBytes() (+17 more)

### Community 71 - "abac-policy.ts"
Cohesion: 0.10
Nodes (29): ABAC_ATTRIBUTES, AbacAllOfNode, AbacAnyOfNode, AbacAttributeSpec, AbacNotNode, AbacParseFailure, AbacParseResult, AbacParseSuccess (+21 more)

### Community 72 - "media-r2-config.ts"
Cohesion: 0.14
Nodes (27): evaluateManagedMediaReadiness(), ManagedMediaReadinessResult, ADR-0036, allowsSvgMimeType(), findMissingNewsMediaR2Vars(), findNewsMediaR2PublicBaseUrlProductionUnsafeReason(), findNewsMediaR2SeparationViolations(), findUnknownNewsMediaR2MimeTypes() (+19 more)

### Community 73 - "url-change-capture.ts"
Cohesion: 0.10
Nodes (26): fetchRedirectSettings(), RedirectSettingsAuditHook, SettingsRow, toSettings(), ADR-0039, updateRedirectSettings(), ADR-0028, ADR-0039 (+18 more)

### Community 74 - "theme-config.ts"
Cohesion: 0.13
Nodes (26): assertSafeCssPrimitive(), CssValueError, DIMENSION_UNIT_ALLOW_LIST, DimensionConstraint, FORBIDDEN_CSS_SUBSTRINGS, hasBalancedParens(), hasBalancedQuotes(), NAMED_COLOR_ALLOW_LIST (+18 more)

### Community 75 - "workflow-instance.ts"
Cohesion: 0.10
Nodes (25): DueTaskRow, EscalateDueTasksResult, activateNode(), ActivateNodeDeps, ActivateNodeOutcome, createApprovalTask(), factsToVariables(), QueueEntry (+17 more)

### Community 76 - "astro"
Cohesion: 0.09
Nodes (20): astro, main(), readFlag(), TenantRow, ADR-0040, getRegisteredSearchSources(), ADR-0040, POST() (+12 more)

### Community 77 - "business-scope-facts.ts"
Cohesion: 0.10
Nodes (23): ADR-0030, ActiveAssignmentRow, AssignmentPermissionRow, clampInt(), fetchActiveAssignmentRows(), HierarchyGuardConfig, OrdinaryRbacPermissionRow, resolveBusinessScopeFacts() (+15 more)

### Community 78 - "initialize.ts"
Cohesion: 0.10
Nodes (22): hashPassword(), getSetupDatabaseClient(), bootstrapPlatformTenant(), PlatformBootstrapResult, REQUIRED_STRING_FIELDS, SetupInitializeInput, SetupInitializeValidationResult, validateSetupInitializeInput() (+14 more)

### Community 79 - "redirect-directory.ts"
Cohesion: 0.10
Nodes (28): escapeLike(), findConflictingRedirect(), listRedirects(), purgeRedirect(), RedirectListFilters, RedirectRecord, RedirectRow, ResolvedRedirectRule (+20 more)

### Community 80 - "api-docs-generate.ts"
Cohesion: 0.19
Nodes (28): RFC-2606, AnyRecord, asArray(), asRecord(), buildRawApiReferenceMarkdown(), ENVELOPE_SCHEMA_NAMES, exampleValue(), expandReachableClosure() (+20 more)

### Community 81 - "seo-redirect-guards.test.ts"
Cohesion: 0.10
Nodes (26): RFC-3986, buildRedirect(), combineChainStatus(), isMethodPreserving(), isPermanent(), RedirectChainLookup, RedirectHopRule, resolveRedirectChain() (+18 more)

### Community 82 - "ERP domain modules (finance/inventory/procurement/HR)"
Cohesion: 0.07
Nodes (29): ADR-0039 — SEO Distribution Redirect Governance, Privacy-Minimized 404 Observation Telemetry, ADR-0038 — SEO Distribution Discovery Scope, Fail-Open Public Redirect Middleware Hook (src/middleware.ts), Frozen Open-Redirect Guard (redirect-target-classification.ts), Base reusable modules, AWCMS design principles, AWCMS modular monolith architecture (+21 more)

### Community 83 - "MFA TOTP + recovery codes"
Cohesion: 0.09
Nodes (29): Minimal domain module example (expense-category), Module migration RLS ENABLE+FORCE pattern, Thin route auth->tenant->ABAC->service pattern, Intentional-divergence registry, Tenant MFA enforcement policy, MFA TOTP + recovery codes, Per-factor cumulative lockout, Step-up authentication (requireStepUp) (+21 more)

### Community 84 - "encodeKeysetCursor()"
Cohesion: 0.09
Nodes (24): BlogSearchResourceType, BlogSearchResult, BlogSearchResultItem, BlogSearchRow, searchBlogContentAdmin(), SearchBlogContentAdminFilter, searchPublicBlogContent(), SearchPublicBlogContentFilter (+16 more)

### Community 85 - "report.ts"
Cohesion: 0.14
Nodes (23): ResolvedAuthor, resolveOptionalRegisteredAuthor(), ADR-0041, editCommentWithinWindow(), reportComment(), ReportReason, buildPublicHostResolverConfigFromEnv(), checkCommentsGate() (+15 more)

### Community 86 - "ModuleDescriptor"
Cohesion: 0.13
Nodes (21): DescriptorSyncResult, fetchExistingModules(), findDuplicateDescriptorKeys(), markOrphaned(), ModuleRegistryInvalidError, replaceDependencies(), replaceJobs(), replaceNavigation() (+13 more)

### Community 87 - "ad-placement-directory.ts"
Cohesion: 0.14
Nodes (26): ActiveAdPlacementForRendering, ActiveAdPlacementRow, AdPlacementRow, AdPlacementView, listActiveAdPlacementsForRendering(), renderAdPlacementHtml(), selectAndRenderActiveAdsForPlacement(), AD_PLACEMENT_DEFAULT_MEDIA_TYPES (+18 more)

### Community 88 - "visitor-analytics-domain.test.ts"
Cohesion: 0.09
Nodes (20): collectVisitorTelemetry(), CollectVisitorTelemetryInput, SessionRow, shouldCollectRequest(), upsertVisitorSession(), ANALYTICS_AREA_FILTERS, ANALYTICS_VISITOR_TYPE_FILTERS, AnalyticsAreaFilter (+12 more)

### Community 89 - "properties"
Cohesion: 0.07
Nodes (27): minLength, type, minLength, type, minLength, type, additionalProperties, type (+19 more)

### Community 90 - "module-management OpenAPI fragment"
Cohesion: 0.09
Nodes (27): submitFormDraft, TenantAuthPolicy schema, updateSsoPolicy, applyTenantModulePreset, checkModuleHealth, disableTenantModule, enableTenantModule, module-management OpenAPI fragment (+19 more)

### Community 91 - "family-conformance-check.ts"
Cohesion: 0.11
Nodes (26): ADR_DIR, assertEvidenceReportSecretFree(), ASYNCAPI_PATH, buildEvidenceReport(), CI_YML_PATH, collectFamilyConformanceChecks(), EvidenceReport, extractCiBunVersions() (+18 more)

### Community 92 - "news-article-seo-metadata.ts"
Cohesion: 0.13
Nodes (21): BlogSettingsView, buildNewsArticleSeoMetadata(), NewsArticleSeoMetadata, NewsArticleSeoMetadataInput, ResolvedNewsArticlePreviewImage, resolveNewsArticlePreviewImage(), collectRenderableGalleryMediaObjectIds(), collectRenderableVideoNewsThumbnailMediaObjectIds() (+13 more)

### Community 93 - "comment-moderation.ts"
Cohesion: 0.11
Nodes (21): BulkModerateResult, listModerationQueue(), ModerateResult, ModerationAuditHook, ModerationCursor, ModerationQueueItem, QUEUE_STATUSES, QueueRow (+13 more)

### Community 94 - "workflow-graph.ts"
Cohesion: 0.13
Nodes (26): CONDITION_OPERATORS, ConditionOperator, detectCycle(), EndNode, FactsSchemaValidationResult, FactType, GraphValidationError, GraphValidationResult (+18 more)

### Community 95 - "withTenant / SET LOCAL RLS context"
Cohesion: 0.08
Nodes (26): Hybrid online-first operating mode, Sync Storage module, ERD & data dictionary, RLS tenant-isolation standard, Soft delete standard, Production readiness checklist & go-live gates, Sequential migration order & numbering, Bun-only backend platform standard (+18 more)

### Community 96 - "security-readiness.ts"
Cohesion: 0.09
Nodes (25): ALL_FOUR_PRIVILEGES, ALL_WRITE_PRIVILEGES, checkMfaEncryptionKeyConfigured(), CheckSeverity, checkSsoCredentialEncryptionKeyConfigured(), CheckStatus, GLOBAL_TABLE_FORBIDDEN_PRIVILEGES, main() (+17 more)

### Community 97 - "append-domain-event.ts"
Cohesion: 0.12
Nodes (18): AppendDomainEventInput, AppendDomainEventResult, DomainEventRow, InvalidDomainEventPayloadError, ADR-0006, UnregisteredDomainEventTypeError, collectCredentialShapedKeys(), CREDENTIAL_KEY_SUBSTRINGS (+10 more)

### Community 98 - "party-directory.ts"
Cohesion: 0.11
Nodes (22): listParties(), ListPartiesOptions, ListPartiesResult, PartyRow, toRecord(), updateParty(), CreatePartyInput, PARTY_RISK_LEVELS (+14 more)

### Community 99 - "application/email-dispatch.ts"
Cohesion: 0.14
Nodes (19): main(), TenantRow, ClaimedRow, claimEligibleEntries(), createTemplateLoader(), dispatchEmailQueue(), DispatchEmailQueueOptions, DispatchEmailQueueResult (+11 more)

### Community 100 - "login-env-parsing.test.ts"
Cohesion: 0.11
Nodes (18): LogEntry, setLogSink(), resetClientFingerprintKeyForTests(), resetLoginPolicyEnvWarningsForTests(), computeLockedUntil(), evaluateLoginAttempt(), IdentityStatus, isAccountLocked() (+10 more)

### Community 101 - "legal-hold-service.ts"
Cohesion: 0.14
Nodes (22): createLegalHold(), CreateLegalHoldResult, LegalHoldDbRow, LegalHoldRow, listLegalHolds(), ListLegalHoldsFilter, releaseLegalHold(), ReleaseLegalHoldResult (+14 more)

### Community 102 - "sod.integration.test.ts"
Cohesion: 0.10
Nodes (17): defaultBusinessScopeHierarchyPortAdapter, ADR-0011, UNRESOLVED, NO_TX, NODES, createDummyBusinessScopeHierarchyResolver(), DummyScopeNode, HIERARCHY (+9 more)

### Community 103 - "seo-facts-port.ts"
Cohesion: 0.12
Nodes (22): renderJsonLdScripts(), assertControlledJsonLd(), buildSeoCacheKey(), escapeJsonLdText(), JSON_LD_ALLOWED_TYPES, JsonLdNode, JsonLdScalar, JsonLdType (+14 more)

### Community 104 - "theme-descriptor.ts"
Cohesion: 0.08
Nodes (23): assertSubset(), InvalidThemeDescriptorError, THEME_ALLOWED_EXTERNAL_FRAME_SOURCES, THEME_ALLOWED_EXTERNAL_SCRIPT_SOURCES, THEME_ALLOWED_EXTERNAL_STYLE_SOURCES, ThemeAccessibilityDeclaration, ThemeAssetSlotKind, ThemeAssetSlotSpec (+15 more)

### Community 105 - "edge-cache/config.ts"
Cohesion: 0.11
Nodes (17): ADR-0002, DEFAULTS, EdgeCacheEnvironment, EdgeCacheMode, EdgeCacheValidationFinding, loadEdgeCacheConfig(), MODES, readBoundedInt() (+9 more)

### Community 106 - "presentation/theme-preview.ts"
Cohesion: 0.11
Nodes (16): ../../../layouts/PublicThemeLayout.astro, ../../../modules/theming/application/theme-preview-render, ../../../modules/theming/presentation/theme-preview, ResolvedThemeAsset, resolveThemeAssetUrls(), ADR-0029, ADR-0034, ADR-0036 (+8 more)

### Community 107 - "../lib/ui/admin-form-client"
Cohesion: 0.17
Nodes (19): ../lib/security/secure-url-params, ../lib/security/turnstile, ../lib/ui/admin-form-client, ../modules/identity-access/domain/password-reset-validation, ../modules/tenant-admin/application/tenant-picker-directory, ../styles/auth.css, ../styles/motion.css, ../styles/tokens.css (+11 more)

### Community 108 - "api-spec-check.ts"
Cohesion: 0.16
Nodes (23): ALLOWED_PUBLIC_OPERATIONS, API_ROUTES_DIR, asRecord(), ASYNCAPI_ABS_PATH, checkBundleFreshness(), checkPublicAllowListUsed(), checkRouteParity(), collectOperationIdProblems() (+15 more)

### Community 109 - "commentable-resource-registry.ts"
Cohesion: 0.14
Nodes (21): main(), ADR-0041, buildCommentableResourceUrl(), findDescriptorByResourceType(), resolvePublishedCommentableResource(), ADR-0009, ADR-0013, ADR-0041 (+13 more)

### Community 110 - "family-conformance.test.ts"
Cohesion: 0.13
Nodes (18): AppliedMigration, computeMigrationChecksum(), discoverMigrationFiles(), getDatabaseUrl(), main(), maskUrlPassword(), MigrationFile, MigrationResult (+10 more)

### Community 111 - "docs-checks.mjs"
Cohesion: 0.17
Nodes (20): AUTHORITATIVE_SCRIPT_DOC_FILES, checkComposeServiceNames(), checkKnownScripts(), checkMermaid(), checkNaming(), checkSqlMigrationReferences(), classifyLink(), COMPOSE_BOOLEAN_FLAG_OVERRIDES (+12 more)

### Community 112 - "public-blog-directory.ts"
Cohesion: 0.13
Nodes (21): boundedPage(), boundedPageSize(), fetchPublicBlogPostBySlug(), fetchPublicBlogPostSummariesByIds(), fetchPublicPostTaxonomyTerms(), listPublicBlogPosts(), listPublicBlogPostsByTermId(), PublicBlogPostDetail (+13 more)

### Community 113 - "admin/[id]/restore.ts"
Cohesion: 0.12
Nodes (19): bulkModerateComments(), moderateComment(), ADR-0041, Decision, isRecord(), POST(), ADR-0041, GUARD (+11 more)

### Community 114 - "domain-event-directory.ts"
Cohesion: 0.12
Nodes (18): DeliveryNotDeadLetteredError, replayDomainEventDelivery(), ReplaySchemaIncompatibleError, UnknownReplayConsumerError, DomainEventDeliveryRow, DomainEventDeliveryView, DomainEventRow, DomainEventView (+10 more)

### Community 115 - "media-r2-verification.ts"
Cohesion: 0.11
Nodes (18): NewsMediaR2VerificationRejectionReason, NewsMediaR2VerificationResult, ADR-0006, verifyNewsMediaR2Object(), VerifyNewsMediaR2ObjectInput, decideNewsMediaFinalizeOutcome(), NewsMediaFinalizeDecision, NewsMediaFinalizeDecisionInput (+10 more)

### Community 116 - "media-r2-client.ts"
Cohesion: 0.11
Nodes (18): NewsMediaR2ClientConfig, NewsMediaR2DeleteResult, NewsMediaR2GetResult, NewsMediaR2HeadResult, NewsMediaR2ListObjectsInput, NewsMediaR2ListObjectsResult, NewsMediaR2ObjectSummary, NewsMediaR2PresignUploadInput (+10 more)

### Community 117 - "seo-distribution.integration.test.ts"
Cohesion: 0.12
Nodes (19): fetchSeoSettingsUpdatedAt(), fetchSeoTenantSettings(), SeoConfigAuditHook, SeoSettingsRow, toSettings(), ADR-0038, updateSeoTenantSettings(), SeoDiscoveryContext (+11 more)

### Community 118 - "redirect-rule.ts"
Cohesion: 0.18
Nodes (23): normalizeRedirectPath(), ALLOWED_REDIRECT_ORIGINS, ALLOWED_REDIRECT_STATES, ALLOWED_REDIRECT_STATUS_CODES, isPlainObject(), normalizeOptionalString(), RedirectCreateValidationResult, RedirectUpdateValidationResult (+15 more)

### Community 119 - "office-directory.ts"
Cohesion: 0.13
Nodes (13): createOffice(), DuplicateOfficeCodeError, fetchOfficeById(), listDeletedOffices(), listOffices(), OfficeListPage, OfficeRecord, OfficeRow (+5 more)

### Community 120 - "collect.ts"
Cohesion: 0.14
Nodes (18): extractSingleTrustedHeaderValue(), resolveAnalyticsClientIp(), EMPTY_GEO, GeoEnrichment, normalizeCountryCode(), resolveGeoEnrichment(), determineArea(), RequestArea (+10 more)

### Community 121 - "package.json"
Cohesion: 0.09
Nodes (20): @astrojs/node, author, bugs, url, dependencies, astro, @astrojs/node, description (+12 more)

### Community 122 - "compilerOptions"
Cohesion: 0.09
Nodes (22): astro/tsconfigs/strict, .astro/types.d.ts, dist, ES2024, node_modules, scripts/**/*, src/**/*, tests/**/* (+14 more)

### Community 123 - "widget-policy.ts"
Cohesion: 0.15
Nodes (21): BlogWidgetRow, BlogWidgetView, createWidget(), fetchWidgetById(), listWidgets(), ListWidgetsFilter, softDeleteWidget(), toView() (+13 more)

### Community 124 - "query.ts"
Cohesion: 0.17
Nodes (19): recordSearchQuery(), ADR-0040, decodeSearchCursor(), searchSiteContent(), renderSearchPageDocument(), clampMinQueryLength(), hashSearchQuery(), NormalizedQueryResult (+11 more)

### Community 125 - "theming/preview.ts"
Cohesion: 0.17
Nodes (19): buildPreviewUrlToken(), generatePreviewToken(), hashPreviewToken(), isPreviewSessionActive(), isWellFormedPreviewToken(), parsePreviewUrlToken(), resolvePreviewTtlMinutes(), ADR-0029 (+11 more)

### Community 126 - "abac-policy-evaluator.integration.test.ts"
Cohesion: 0.18
Nodes (19): Bootstrap, createPolicy(), evaluate(), headers(), seedUserWithPermissions(), setActive(), TARGET, createCookieJar() (+11 more)

### Community 127 - "ADR-0003 PostgreSQL + RLS multi-tenant isolation"
Cohesion: 0.11
Nodes (22): ADR-0001 Rebuild AWCMS as ERP modular-monolith platform, ADR-0002 Bun-only runtime & tooling, ADR-0003 PostgreSQL + RLS multi-tenant isolation, SECURITY DEFINER bootstrap-read checklist (ADR-0003), ADR-0004 RBAC + ABAC default-deny baseline, ADR-0005 Soft delete for master/config, immutability for posted data, ADR-0006 Offline-first + transactional outbox + sync HMAC, ADR-0007 OpenAPI & AsyncAPI as mandatory contracts (+14 more)

### Community 128 - "production:preflight read-only preflight"
Cohesion: 0.12
Nodes (22): Authorized dependency-health endpoint, Mandatory shared instrumentation points, METRIC_DEFINITIONS registry (cardinality/privacy), MetricsPort observability contract, deriveProviderFamilyLabel cardinality bounding, SLI/SLO and burn-rate guidance, Deterministic seeded fixtures (mulberry32), Query-plan regression budgets (+14 more)

### Community 129 - "Bundled published OpenAPI contract"
Cohesion: 0.10
Nodes (22): AbacDslPolicy schema, Bundled published OpenAPI contract, DataLifecycleDescriptor schema, MediaEnforcementState schema, SeoRedirect schema, ApiError schema, ApiMeta schema (correlationId/requestId), bearerAuth security scheme (+14 more)

### Community 130 - "sod-rule-registry.ts"
Cohesion: 0.14
Nodes (16): main(), collectSoDRuleDescriptors(), formatSoDRuleRegistryIssue(), SoDRuleRegistryIssue, SoDRuleRegistryValidationResult, ADR-0037, VALID_SCOPE_APPLICABILITIES, VALID_SEVERITIES (+8 more)

### Community 131 - "menu-directory.ts"
Cohesion: 0.13
Nodes (20): BlogMenuItemRow, BlogMenuItemView, BlogMenuRow, BlogMenuView, createMenu(), fetchMenuById(), fetchMenuItems(), listMenus() (+12 more)

### Community 132 - "content-block-rendering.ts"
Cohesion: 0.16
Nodes (19): ContentBlock, EMPTY_RESOLVED_MEDIA_URLS, GalleryItem, isRecord(), renderBlock(), renderHeading(), renderList(), renderParagraph() (+11 more)

### Community 133 - "business-scope-assignment-service.ts"
Cohesion: 0.14
Nodes (18): BusinessScopeAssignmentDbRow, BusinessScopeAssignmentRow, CreateBusinessScopeAssignmentResult, listBusinessScopeAssignments(), ListBusinessScopeAssignmentsFilter, revokeBusinessScopeAssignment(), RevokeBusinessScopeAssignmentResult, SoDConflictSummary (+10 more)

### Community 134 - "user-admin.ts"
Cohesion: 0.11
Nodes (16): AssignmentInput, AssignmentRecord, AssignmentTargetNotFoundError, DuplicateAssignmentError, SetStatusInput, SetStatusResult, setTenantUserStatus(), SystemRoleAssignmentError (+8 more)

### Community 135 - "visitor-analytics.integration.test.ts"
Cohesion: 0.13
Nodes (20): ALLOWED_JSON_COLUMNS, ALLOWED_JSON_KEYS, AnalyticsSummary, fetchAnalyticsSummary(), fetchRealtimeStats(), fetchSecurityView(), fetchTopBrowsers(), fetchTopCountries() (+12 more)

### Community 136 - "Varnish edge-cache infrastructure layer (ADR-0042)"
Cohesion: 0.10
Nodes (21): src/lib boundary + module-boundary gate over src/pages (ADR-0043), GET /api/v1/tenant/modules/matrix + per-module audit summary, Tenant module presets (minimal/website/news_portal/back_office), ModuleApiContract.routes + modules:routes:check (longest-prefix ownership), defineTenantRoute + api:tenant-route:check (shrink-only NOT_YET_MIGRATED), work-class registry generator + freshness gate (ghost .generated artifact), Rule 21: enqueueModuleContentPurge inside the content transaction, PaaS superuser makes FORCE RLS inert (staging 2026-07-25) (+13 more)

### Community 137 - "properties"
Cohesion: 0.10
Nodes (21): pattern, type, properties, pattern, type, minLength, type, adr (+13 more)

### Community 138 - "redirect-resolution-service.ts"
Cohesion: 0.16
Nodes (19): ADR-0010, findActiveRedirectByPath(), incrementRedirectHit(), isSeoDistributionEnabled(), NotFoundCaptureContext, RedirectResolution, resolveHostBasedRedirect(), resolveLegacyBlogRedirect() (+11 more)

### Community 139 - "local-archive-adapter.ts"
Cohesion: 0.12
Nodes (16): RFC-4180, ArchivePortKind, ArchiveWriteInput, ArchiveWriteResult, ADR-0006, ADR-0011, ADR-0013, ADR-0037 (+8 more)

### Community 140 - "Eleven ERP contract families (neutral contracts, base is not ERP)"
Cohesion: 0.12
Nodes (21): Capability Port, Coretax / VAT Invoice, Domain Event + Envelope, Fiscal Period, HMAC (sync integrity), Ledger Entry / Posting (append-only), Payroll Run, Threat Model and Security Architecture (Doc 20) (+13 more)

### Community 141 - "runtime.ts"
Cohesion: 0.15
Nodes (17): EdgeCacheConfig, isEdgeCacheActive(), createPressureTracker(), Observation, PressureSample, PressureTracker, ADR-0042, annotateEdgeCache() (+9 more)

### Community 142 - "redaction.ts"
Cohesion: 0.17
Nodes (17): logAdminPageError(), sanitizeErrorForLog(), sanitizeOne(), LogContext, collectKeysDeep(), collectSecretShapedValuePaths(), EXACT_SENSITIVE_KEY_SYNONYMS, findSensitiveKeys() (+9 more)

### Community 143 - "role-admin.ts"
Cohesion: 0.11
Nodes (14): DeletedRoleView, DuplicateRoleCodeError, DuplicateRolePermissionError, fetchLiveRoleById(), GrantResult, PermissionCatalogEntry, PermissionNotFoundError, PermissionRow (+6 more)

### Community 144 - "work-class-registry-generate.ts"
Cohesion: 0.19
Nodes (16): engines, bun, main(), buildSnapshot(), classifyRoute(), codeOnly(), compareJobRegistry(), JobDiscrepancy (+8 more)

### Community 145 - "edge-cache.test.ts"
Cohesion: 0.17
Nodes (15): CacheDecision, enqueueEdgeCachePurge(), appendVary(), applyEdgeCacheHeaders(), ADR-0042, buildBanExpression(), buildSurrogateKey(), buildSurrogateKeyHeader() (+7 more)

### Community 146 - "media-library-port-adapter.ts"
Cohesion: 0.15
Nodes (12): validateVideoNewsThumbnailReferencesForFullOnlineR2Mode(), VideoNewsThumbnailReferenceValidationError, VideoNewsThumbnailReferenceValidationResult, ADR-0036, MediaLibraryPort, ResolvedMediaReferenceDTO, ADR-0036, BASE_CONTENT (+4 more)

### Community 147 - "workflow-inbox-directory.ts"
Cohesion: 0.13
Nodes (15): cancelEmailMessage(), CancelEmailMessageResult, EmailMessageEntry, EmailMessageListPage, EmailMessageRow, EmailMessageStatus, fetchEmailMessageEntries(), toView() (+7 more)

### Community 148 - "site-search/settings.ts"
Cohesion: 0.18
Nodes (17): fetchSiteSearchSettings(), SettingsRow, SiteSearchSettingsAuditHook, toSettings(), ADR-0040, updateSiteSearchSettings(), DEFAULT_SITE_SEARCH_SETTINGS, isPlainRecord() (+9 more)

### Community 149 - "provideTenant()"
Cohesion: 0.15
Nodes (10): seeded, seeded, seeded, seeded, seeded, seeded, seeded, seeded (+2 more)

### Community 150 - "family-contract.ts"
Cohesion: 0.15
Nodes (18): ADR-0001, checkStackEntry(), FAMILY_OWNED_CONTRACT_VERSIONS, FamilyCompatibilityManifest, FamilyContracts, FamilyOwnedContractKey, FamilyStack, IntentionalDivergence (+10 more)

### Community 151 - "capability-contract-versions.ts"
Cohesion: 0.12
Nodes (14): ADR-0008, ADR-0015, seoDistributionModule, ADR-0028, ADR-0035, ADR-0038, ADR-0039, CAPABILITY_CONTRACT_VERSIONS (+6 more)

### Community 152 - "module-boundary.test.ts"
Cohesion: 0.20
Nodes (16): collectClaims(), main(), OVERBROAD_PREFIXES, PLATFORM_ROUTES, resolveOwner(), routeOf(), RouteOwnership, walk() (+8 more)

### Community 153 - "jwt-verify.ts"
Cohesion: 0.19
Nodes (17): ALLOWED_JWT_ALGORITHMS, AllowedJwtAlgorithm, base64UrlDecode(), findJwk(), isAllowedJwtAlgorithm(), Jwk, JwtHeader, JwtPayload (+9 more)

### Community 154 - "content-purge.ts"
Cohesion: 0.13
Nodes (14): enqueueModuleContentPurge(), ADR-0042, SqlExecutor, SurrogateKeyScope, DELETE(), DELETE_GUARD, PATCH(), READ_GUARD (+6 more)

### Community 155 - "object-storage-uploader.ts"
Cohesion: 0.16
Nodes (12): TimeoutError, withTimeout(), createNoopObjectUploader(), createR2ObjectUploader(), ObjectUploadInput, R2UploaderConfig, resolveObjectUploader(), resolveUploadTimeoutMs() (+4 more)

### Community 156 - "dry-run-planner.ts"
Cohesion: 0.16
Nodes (13): assertSafeIdentifier(), clampRetentionDays(), LifecycleDryRunOutcome, LifecycleDryRunResult, planLifecycleDryRun(), planLifecycleDryRunForAllDescriptors(), ADR-0037, findArchivedThroughCursor() (+5 more)

### Community 157 - "policy-cache.ts"
Cohesion: 0.12
Nodes (13): cache, CacheEntry, compileRow(), loadActivePolicies(), PolicyRow, queryAndCompile(), resetPolicyCache(), ADR-0033 (+5 more)

### Community 158 - "application/module-settings.ts"
Cohesion: 0.20
Nodes (16): fetchModuleSettingsView(), fetchSettingsRow(), findDescriptor(), ModuleSettingsRow, ModuleSettingsView, toView(), updateModuleSettings(), UpdateModuleSettingsResult (+8 more)

### Community 159 - "search-diagnostics.ts"
Cohesion: 0.16
Nodes (14): fetchIndexFailures(), fetchIndexStatus(), fetchRecentRuns(), IndexFailureItem, IndexRunSummary, IndexStatus, RunRow, toRunSummary() (+6 more)

### Community 160 - "tenant-domain-directory.ts"
Cohesion: 0.18
Nodes (16): createTenantDomain(), fetchActiveTenantDomain(), listTenantDomains(), setPrimaryTenantDomain(), SetPrimaryTenantDomainResult, softDeleteTenantDomain(), TenantDomainListPage, TenantDomainListRow (+8 more)

### Community 161 - "tenant-domain-validation.ts"
Cohesion: 0.13
Nodes (17): CreateTenantDomainInput, Result, TENANT_DOMAIN_ROUTE_MODES, TENANT_DOMAIN_TYPES, TENANT_DOMAIN_UPDATABLE_STATUSES, TENANT_DOMAIN_VERIFICATION_METHODS, TenantDomainRouteMode, TenantDomainType (+9 more)

### Community 162 - "user-agent.ts"
Cohesion: 0.15
Nodes (15): ClassifyHumanInput, ClassifySessionHumanityInput, HumanStatus, SessionHumanity, BOT_SIGNATURES, BROWSER_PATTERNS, BROWSER_VERSION_PATTERNS, detectBrowser() (+7 more)

### Community 163 - "required"
Cohesion: 0.11
Nodes (18): $ref, $ref, astro, bun, $ref, astro, astroNode, postgres (+10 more)

### Community 164 - "errorMessage()"
Cohesion: 0.13
Nodes (11): checkAppDbUserNotSuperuser(), checkAuditLogTableReachable(), checkEnvNotTracked(), checkLeastPrivilegeRoleProvisioned(), checkPasswordHashingModern(), checkRlsEnabled(), checkRuntimeRoleGrants(), defaultRuntimeRoleGrantsPolicy() (+3 more)

### Community 165 - "announcement-validation.ts"
Cohesion: 0.18
Nodes (14): AnnouncementInput, AnnouncementTarget, isPlainObject(), Result, validateAnnouncementInput(), validateTarget(), validateVariables(), ValidationError (+6 more)

### Community 166 - "homepage-section-reference-validation.ts"
Cohesion: 0.19
Nodes (16): fetchNewsMediaObjectById(), isNewsMediaObjectSafeForPublicReference(), AdPlacementReferenceValidationError, AdPlacementReferenceValidationResult, ADR-0036, validateAdPlacementMediaReference(), HomepageSectionReferenceValidationError, HomepageSectionReferenceValidationResult (+8 more)

### Community 167 - "application/health-registry.ts"
Cohesion: 0.22
Nodes (17): asyncApiDocumentedSignal(), computeGenericSignals(), dbRegistrySyncedSignal(), fetchModuleHealthReport(), findDescriptor(), jobsDocumentedSignal(), listMigrationFileNames(), migrationsAppliedSignal() (+9 more)

### Community 168 - "seo-redirect-governance.integration.test.ts"
Cohesion: 0.13
Nodes (15): dismissNotFoundObservation(), listNotFoundObservations(), NotFoundObservation, ObservationRow, RecordNotFoundInput, recordNotFoundObservation(), resolveNotFoundObservation(), toObservation() (+7 more)

### Community 169 - "theme-render-resolver.ts"
Cohesion: 0.18
Nodes (15): ThemeConfigVersion, buildPreviewViewModel(), PreviewAsset, PreviewSection, PreviewViewModel, SAMPLE_COPY, ADR-0029, defaultThemeCss() (+7 more)

### Community 170 - "ADR-0016 organization_structure module admission"
Cohesion: 0.16
Nodes (17): Two composition-root variants (implicit port vs explicit enable gate), Module admission governance policy (doc 21), Scheduled exports with checksum + CSV formula neutralization, ADR-0016 organization_structure module admission, organization_hierarchy_resolution capability (BusinessScopeHierarchyPort impl), Accepted-but-not-implemented admission notice, Tenant vs legal entity vs organization unit boundary (RLS only on tenant_id), ADR-0017 document_infrastructure module admission (+9 more)

### Community 171 - "Release job: validate (read-only)"
Cohesion: 0.12
Nodes (17): CI job: e2e-smoke (Playwright), Ephemeral per-job postgres:18.4 service, HOST=127.0.0.1 IPv4 pinning for E2E, CI job: integration-tests (RLS + DB role separation), --timeout 60000 for ephemeral DB setup, E2E seed via POST /api/v1/setup/initialize, Harness vs legacy DB-gated suite split, Ancestor-of-main guard (+9 more)

### Community 172 - "bun"
Cohesion: 0.12
Nodes (17): additionalProperties, properties, required, type, $ref, $ref, $ref, $ref (+9 more)

### Community 173 - "required"
Cohesion: 0.12
Nodes (17): definitions, divergence, stackEntry, additionalProperties, required, type, additionalProperties, required (+9 more)

### Community 174 - "family"
Cohesion: 0.12
Nodes (17): additionalProperties, properties, required, type, family, role, standard, standardRepository (+9 more)

### Community 175 - "business-scope-expiry-job.ts"
Cohesion: 0.18
Nodes (14): BatchPassResult, BoundedBatchOptions, BoundedBatchOutcome, iterateTenantsInBatches(), IterateTenantsOptions, TenantBatchOutcome, TenantRow, BusinessScopeExpiryResult (+6 more)

### Community 176 - "presentation/redirect-middleware.ts"
Cohesion: 0.17
Nodes (12): applyResponseHeaders(), onRequest, ADR-0039, ADR-0042, buildRedirectResponse(), isPermanent(), MiddlewareRedirectResult, recordPublicNotFound() (+4 more)

### Community 177 - "seo-facts-port-adapter.ts"
Cohesion: 0.16
Nodes (13): blogContentSeoFactsAdapter, BlogPostSeoRow, buildArticleJsonLd(), createBlogContentSeoFactsAdapter(), deriveVisibility(), robotsFor(), toFacts(), ADR-0028 (+5 more)

### Community 178 - "reply-notifications.ts"
Cohesion: 0.18
Nodes (13): CommentEventInput, createReplySubscription(), CreateReplySubscriptionInput, ReplySubscriptionResult, sha256(), ADR-0006, ADR-0041, ADR-0041 (+5 more)

### Community 179 - "archive-purge-job.ts"
Cohesion: 0.23
Nodes (16): assertSafeIdentifier(), computeCutoff(), DataLifecycleArchivePurgeResult, RunArchivePurgeOptions, runDataLifecycleArchivePurge(), runGenericArchivePass(), runGenericPurgePass(), toDate() (+8 more)

### Community 180 - "consumer-state-directory.ts"
Cohesion: 0.16
Nodes (12): BacklogCountRow, ConsumerStateRow, DomainEventConsumerView, pauseConsumer(), resumeConsumer(), activityRollupProjectorConsumer, BASE_DOMAIN_EVENT_CONSUMERS, DOMAIN_EVENT_CONSUMERS (+4 more)

### Community 181 - "mfa-policy.ts"
Cohesion: 0.15
Nodes (15): saveTenantMfaPolicy(), SaveTenantMfaPolicyResult, TenantMfaPolicyView, evaluateStepUp(), isMfaEnforcementLevel(), isPrivilegedFromPermissionKeys(), MFA_ENFORCEMENT_LEVELS, MfaChallengeDenyReason (+7 more)

### Community 182 - "redirect-target.ts"
Cohesion: 0.13
Nodes (14): RedirectQueryPolicyInput, ADR-0028, ADR-0039, classifyRedirectTarget(), RedirectTargetClass, ADR-0028, ADR-0038, ADR-0039 (+6 more)

### Community 183 - "theme-registry.test.ts"
Cohesion: 0.21
Nodes (14): assertValidThemeDescriptor(), defineTheme(), ThemeDescriptor, BASE_THEME_DESCRIPTORS, composeThemeDescriptors(), getThemeDescriptor(), listThemeDescriptors(), ADR-0029 (+6 more)

### Community 184 - "Sync-first rule (syncModuleDescriptors)"
Cohesion: 0.12
Nodes (16): Route ownership via api.routes (longest-prefix wins), Tenant module presets (applyModulePreset), Permission sync status report (synced/missing/orphaned), resolveProtectedModuleKeys (dependency closure of core), Module settings shallow merge + secret-shaped value rejection, Admin sidebar rendered from module navigation registry, Sync-first rule (syncModuleDescriptors), RLS_FREE_TABLES registration for global tables (+8 more)

### Community 185 - "CI job: quality"
Cohesion: 0.17
Nodes (16): Quality steps mirror package.json check, CI job: quality, ADR-0034 Direct-Use Family Templates, ADR-0035 Online-First ERP/SaaS Superset Repositioning, Frozen OpenAPI snapshot / INTENTIONALLY_EVOLVED_PATHS, awcms-micro absorption waves 0-3, Mini-first workflow contract, AWCMS as family superset ERP/back-office template (+8 more)

### Community 186 - "AWCMS family conformance to AWCMS-Mini standard"
Cohesion: 0.12
Nodes (16): compatibleAwcmsRange support-window guidance, Deprecation policy (announce/coexist/remove), extension:check compatibility enforcement (deprecated ADR-0034), Six independent versioning schemes, AWCMS family conformance to AWCMS-Mini standard, family:conformance:check gate + evidence report, FAMILY_CONTRACT_VERSION (seventh versioning scheme), AWCMS family conformance to AWCMS-Mini standard (Bahasa Indonesia source) (+8 more)

### Community 187 - "runSecurityReadinessChecks()"
Cohesion: 0.17
Nodes (15): checkAbacDefaultDeny(), checkCommentsSecretsConfigured(), checkDataLifecycleLegalHoldReleaseSeparate(), checkDataLifecycleRegistryValid(), checkEdgeCacheConfigured(), checkLoginLockoutImplemented(), checkLoginRateLimitImplemented(), checkNoHardcodedSecret() (+7 more)

### Community 188 - "social-share-links.ts"
Cohesion: 0.19
Nodes (13): readBooleanFlag(), resolveBlogShareConfig(), buildSocialShareLinks(), renderInstagramNote(), renderSocialShareButtonsHtml(), shareText(), SocialShareArticle, SocialShareLink (+5 more)

### Community 189 - "verifySyncHeaders()"
Cohesion: 0.28
Nodes (11): legacyAllowed(), SyncAuthFailure, SyncAuthSuccess, verifySyncHeaders(), computeSyncSignature(), computeSyncSignatureV2(), isTenantIdUuid(), isTimestampWithinSkew() (+3 more)

### Community 190 - "visitor-analytics-privacy.test.ts"
Cohesion: 0.22
Nodes (11): shapeVisitEvent(), shapeVisitorSession(), VisitEventDto, VisitEventRow, VisitorSessionDto, VisitorSessionRow, generateVisitorKey(), hashIpAddress() (+3 more)

### Community 191 - "devDependencies"
Cohesion: 0.13
Nodes (15): @changesets/cli, devDependencies, @changesets/cli, @playwright/test, prettier, prettier-plugin-astro, @types/bun, typescript (+7 more)

### Community 192 - "seo_distribution module (discovery scope)"
Cohesion: 0.14
Nodes (15): blog_content as seo_facts provider, Public discovery routes (robots/sitemap/feed), Host-header poisoning defense (resolve-canonical-host), Controlled JSON-LD emission guard, seo_distribution module (discovery scope), seo_facts capability port, awcms_seo_tenant_settings config table, Email base infrastructure tables (+7 more)

### Community 193 - "withTenant integration point (SET LOCAL tenant + backpressure)"
Cohesion: 0.16
Nodes (15): Idempotency, Segregation of Duties (SoD), Work Class, Business-Scope Hierarchy (Issue #180, ADR-0030), Segregation of Duties Layer (Issue #181, ADR-0031), Bun.SQL pool config, Circuit Breaker (3-state, fail-fast), Database Connection Pooling and Backpressure (+7 more)

### Community 194 - "security.astro"
Cohesion: 0.13
Nodes (14): ../../lib/auth/mfa-config, ../../lib/auth/online-security-config, ../../lib/auth/sso-config, ../../modules/identity-access/application/auth-provider-directory, ../../modules/identity-access/application/tenant-auth-policy, ../../modules/identity-access/application/tenant-mfa-policy, BreakGlassCandidateView, canConfigureMfa (+6 more)

### Community 195 - "domains.astro"
Cohesion: 0.13
Nodes (10): ../../../modules/tenant-domain/application/tenant-domain-directory, ../../../modules/tenant-domain/domain/tenant-domain-validation, actionError, canCreate, canDelete, canRead, canSetPrimary, canUpdate (+2 more)

### Community 196 - "comments OpenAPI fragment"
Cohesion: 0.13
Nodes (15): bulkModerateComments, CommentSettings schema, comments OpenAPI fragment, listCommentModerationQueue, moderateComment, reportPublicComment, SubmitCommentResult schema, submitPublicComment (+7 more)

### Community 197 - "lifecycle-registry.ts"
Cohesion: 0.21
Nodes (10): main(), ADR-0037, formatLifecycleRegistryIssue(), LifecycleRegistryIssue, LifecycleRegistryValidationResult, ADR-0037, VALID_RETENTION_CLASSES, validateLifecycleRegistry() (+2 more)

### Community 198 - "logging-lint-check.ts"
Cohesion: 0.24
Nodes (14): ALLOWED_SANITIZER_CALLS, ConsoleCall, findConsoleErrorWarnCalls(), findRawIdiomAssignments(), isDangerousConsoleCall(), lineNumberAt(), LOGGING_LINT_EXEMPTIONS, LoggingLintProblem (+6 more)

### Community 199 - "openapi-bundle.ts"
Cohesion: 0.21
Nodes (12): AnyRecord, asRecord(), buildBundledDocument(), BundleConflictError, bundleOpenApi(), BundleOptions, listModuleFragmentFiles(), readYaml() (+4 more)

### Community 200 - "validate-env.ts"
Cohesion: 0.18
Nodes (12): checkEnvConfigValid(), BOOL_VALUES, EnvBag, isBase32ByteKey(), isValidUrl(), PLACEHOLDER_SECRETS, Rule, RULES (+4 more)

### Community 201 - "db-role-separation-worker-setup-migration.test.ts"
Cohesion: 0.13
Nodes (10): SETUP_ROLE_GRANTS, WORKER_ROLE_GRANTS, CommentableResourceDescriptor, BLOG_POST_DESCRIPTOR, allMigrationStatements, migrationSql, migrationStatements, normalize() (+2 more)

### Community 202 - "content-block-media-references.ts"
Cohesion: 0.22
Nodes (12): NewsMediaReferenceValidationError, NewsMediaReferenceValidationResult, validateNewsMediaReferencesForFullOnlineR2Mode(), violationMessage(), collectGalleryImageReferences(), collectVideoNewsThumbnailReferences(), GalleryImageReferences, GalleryImageReferenceViolation (+4 more)

### Community 203 - "application/permission-sync.ts"
Cohesion: 0.22
Nodes (12): CatalogPermissionRow, descriptorPermissionsForModule(), fetchCatalogPermissions(), fetchModulePermissionSyncReport(), ModulePermissionSyncReport, CatalogPermission, comparePermissions(), DescriptorPermission (+4 more)

### Community 204 - "ad-placements/[id].ts"
Cohesion: 0.21
Nodes (13): createAdPlacement(), fetchAdPlacementById(), listAdPlacements(), softDeleteAdPlacement(), toView(), updateAdPlacement(), CONFIGURE_GUARD, DELETE() (+5 more)

### Community 205 - "reporting.test.ts"
Cohesion: 0.21
Nodes (10): EmailHealthReport, fetchEmailHealthReport(), fetchSyncHealthReport(), SyncHealthReport, EmailHealthCounts, EmailHealthView, shapeEmailHealth(), shapeSyncHealth() (+2 more)

### Community 206 - "discovery-cache.ts"
Cohesion: 0.22
Nodes (13): buildDiscoveryCacheControl(), buildDiscoverySignature(), buildEtag(), contentHash(), DiscoverySignatureParts, ifNoneMatchSatisfied(), isNotModified(), normalizeEtag() (+5 more)

### Community 207 - "condition-action-registry.ts"
Cohesion: 0.15
Nodes (9): ADR-0011, WorkflowActionContext, WorkflowActionHandler, WorkflowConditionEvaluationContext, WorkflowConditionResolver, alwaysTrueConditionResolver, BASE_ACTION_HANDLERS, BASE_CONDITION_RESOLVERS (+1 more)

### Community 208 - "definitions/[id].ts"
Cohesion: 0.17
Nodes (12): InvalidWorkflowGraphError, DELETE_GUARD, GET(), PUT(), READ_GUARD, serializeDefinition(), UPDATE_GUARD, CREATE_GUARD (+4 more)

### Community 209 - "Varnish 7.5 edge-cache service"
Cohesion: 0.15
Nodes (14): CI job: minimum-supported (Bun 1.3.0 floor), Varnish edge cache auto-activation (ADR-0042), RLS ENABLE without FORCE is inert, Applied migrations are immutable, 4xx returned inside withTenant commits, default_ttl=0 / default_grace=0 belt-and-braces, Malloc storage sizing vs ban lurker, EDGE_CACHE_PURGE_TOKEN shared secret (+6 more)

### Community 210 - "awcms-family-compatibility.schema.json"
Cohesion: 0.14
Nodes (13): additionalProperties, description, $id, required, $schema, title, type, contracts (+5 more)

### Community 211 - "Data Lifecycle module README"
Cohesion: 0.18
Nodes (14): DataLifecycleDescriptor (HighVolumeTableDescriptor), DataLifecycleLegalHold, Data Lifecycle module (API surface), Email module (API surface), Foundation module (health/pool probes), AuditEvent, Logging & Audit module (API surface), Reporting module (management reporting + projections) (+6 more)

### Community 212 - "site-search OpenAPI fragment"
Cohesion: 0.15
Nodes (14): site-search OpenAPI fragment, siteSearchIndexFailures, siteSearchIndexRebuild, siteSearchIndexReconcile, SiteSearchIndexRun schema, siteSearchIndexStatus, siteSearchQuery, SiteSearchQueryResult schema (+6 more)

### Community 213 - "changeset-policy-check.ts"
Cohesion: 0.22
Nodes (10): CHANGESET_POLICY_PATH_EXEMPTIONS, ChangesetFrontmatterResult, ChangesetPolicyResult, evaluateChangesetPolicy(), EXEMPT_PATH_PATTERNS, isExempt(), isPackageJsonVersionOnlyChange(), readGitFile() (+2 more)

### Community 214 - "object-dispatch.ts"
Cohesion: 0.20
Nodes (12): main(), TenantRow, ClaimedRow, claimEligibleEntries(), dispatchObjectSyncQueue(), DispatchObjectSyncQueueOptions, DispatchObjectSyncQueueResult, finalizeFailure() (+4 more)

### Community 215 - "media-object-key.ts"
Cohesion: 0.24
Nodes (10): createPendingNewsMediaObject(), buildNewsMediaObjectKey(), BuildNewsMediaObjectKeyInput, buildNewsMediaPublicUrl(), deriveExtensionFromMimeType(), isValidNewsMediaObjectKey(), MIME_TYPE_TO_EXTENSION, pad2() (+2 more)

### Community 216 - "search-service.ts"
Cohesion: 0.18
Nodes (12): encodeSearchCursor(), escapeLike(), SearchCursor, SearchQueryOptions, SearchResult, SearchRow, SuggestionItem, suggestSiteContent() (+4 more)

### Community 217 - "site-search-domain.test.ts"
Cohesion: 0.20
Nodes (11): SearchResultItem, buildSearchCacheKey(), SearchCacheKeyParts, ADR-0040, DEFAULT_SEARCH_PAGE_LABELS, renderResultItem(), renderSearchPageBody(), SearchPageLabels (+3 more)

### Community 218 - "sync-storage.test.ts"
Cohesion: 0.19
Nodes (11): evaluateObjectRetry(), ObjectRetryEvaluation, ObjectSyncEnqueueRequestBody, ObjectSyncEnqueueValidationResult, ObjectSyncQueueItem, validateObjectSyncEnqueueRequestBody(), ValidationError, verifyObjectChecksum() (+3 more)

### Community 219 - "Idempotent High-Risk Mutation Skill"
Cohesion: 0.37
Nodes (13): AWCMS Coder Agent, AWCMS Reviewer Agent, AWCMS Security Auditor Agent, ABAC Guard & Tenant Isolation Skill, Audit Log (High-Risk) Skill, Document Infrastructure Module Skill, Email Module Skill, ERP Extension Readiness Skill (historical, ADR-0034) (+5 more)

### Community 220 - "migrationChecksum"
Cohesion: 0.15
Nodes (13): minLength, type, additionalProperties, properties, required, type, algorithm, migrationChecksum (+5 more)

### Community 221 - "required"
Cohesion: 0.15
Nodes (13): additionalProperties, required, type, contracts, apiResponseEnvelopeVersion, auditRedactionContractVersion, capabilityContractVersions, eventApiInfoVersion (+5 more)

### Community 222 - "properties"
Cohesion: 0.15
Nodes (13): description, pattern, type, items, type, $ref, const, description (+5 more)

### Community 223 - "commentableResources descriptor seam"
Cohesion: 0.18
Nodes (13): MODULE_CONTRACT_VERSION 2.3.0, listPublicComments, PublicComment schema, saveTenantSidebarArrangement, commentableResources descriptor seam, Publication boundary at resource->thread, comments:resources:check registry gate, Navigation filtering is not authorization (+5 more)

### Community 224 - "comment-retention.ts"
Cohesion: 0.22
Nodes (11): main(), resolveRetentionDays(), TenantRow, ADR-0037, ADR-0041, anonymizeAgedComments(), AnonymizeResult, PurgeSubscriptionsResult (+3 more)

### Community 225 - "sync-agent-memory.ts"
Cohesion: 0.28
Nodes (12): DOC_PATH, EXCLUDE, exists(), header(), main(), memoryDir(), parseGenerated(), quoteDescription() (+4 more)

### Community 226 - "video-news-block-validation.ts"
Cohesion: 0.26
Nodes (11): ContentJsonVideoBlocksValidationResult, isRecord(), isRecordArray(), isVideoNewsProvider(), NormalizedVideoNewsBlock, normalizeYouTubeVideoId(), validateOptionalStringField(), validateVideoNewsBlock() (+3 more)

### Community 227 - "office-validation.ts"
Cohesion: 0.19
Nodes (12): CreateOfficeInput, DeleteOfficeInput, OFFICE_STATUSES, OFFICE_TYPES, OfficeStatus, OfficeType, UpdateOfficeInput, validateCreateOfficeInput() (+4 more)

### Community 228 - "presentation/theme-public-css.ts"
Cohesion: 0.24
Nodes (11): cssResponse(), etagFor(), notModified(), serveActiveThemeTokensCss(), ADR-0009, ADR-0029, ADR-0034, GET() (+3 more)

### Community 229 - "rollup.ts"
Cohesion: 0.22
Nodes (12): ALLOWED_JSON_COLUMNS, ALLOWED_JSON_KEYS, AreaCountRow, computeDailyAreaRollup(), DailyAreaRollup, fetchDailyAreaCounts(), fetchTopJsonFieldForDay(), fetchTopPathsForDay() (+4 more)

### Community 230 - "awcms_resolve_tenant_domain_lookup SECURITY DEFINER bootstrap read"
Cohesion: 0.17
Nodes (12): Base registry composition validation (composeModuleRegistry), Public tenant-scoped routes via path tenantCode (ADR-0009), ADR-0034 direct-use templates (derived pathway removed), ADR-0035 awcms as online-first superset absorbing awcms-micro, :tenantCode urlTemplate placeholder (throws if unresolved), awcms_resolve_tenant_domain_lookup SECURITY DEFINER bootstrap read, awcms_domain_bootstrap role + scoped bootstrap read policy, resolvePublicTenantFromRequest fallback ladder (+4 more)

### Community 231 - "Tenant Admin Module"
Cohesion: 0.17
Nodes (12): Sync HMAC & Offline Sync, Node inactive-by-default registration + admin approve, Versioned v2 HMAC signature (GHSA-c972), Composite FK parent office (GHSA-r7cx), Tenant Admin Module, Office soft-delete + restore, Setup wizard bootstrapPlatformTenant, awcms_tenants RLS-free root table (+4 more)

### Community 232 - "Row-Level Security (RLS)"
Cohesion: 0.18
Nodes (12): ABAC (Attribute-Based Access Control), Default Deny / Deny Overrides Allow, Glossary and Terminology (Doc 19), Legal Entity, Organization Unit, RBAC (Role-Based Access Control), Row-Level Security (RLS), Tenant (RLS security boundary) (+4 more)

### Community 233 - "Derived Application Guide (DEPRECATED, ADR-0034)"
Cohesion: 0.23
Nodes (12): BundleConflictError (default-deny override), API Contribution Guide (Issue #182, ADR-0026), Modular OpenAPI ownership & composition, Bun-only Backend Platform standard, Development Standard Compliance Audit (2026-07-04, historical), AWPOS pilot (candidate matrix recommendation), First Derived App Pilot Plan (AWPOS, DEPRECATED), Purchase Requisition Pilot Plan (#187, DEPRECATED) (+4 more)

### Community 234 - "check-docs.mjs"
Cohesion: 0.30
Nodes (10): anyComposeFileExists(), checkLinks(), COMPOSE_FILE_CANDIDATES, GENERATED_EXEMPT, listMarkdown(), loadComposeServiceNames(), loadPackageScripts(), loadSqlFileNames() (+2 more)

### Community 235 - "docs-i18n-checks.mjs"
Cohesion: 0.33
Nodes (9): listIdSources(), ADR-0023, ROOT, runChecks(), checkTranslationPair(), computeSourceHash(), deriveEnglishPath(), extractRecordedHash() (+1 more)

### Community 236 - "purge-queue.ts"
Cohesion: 0.29
Nodes (10): main(), TenantRow, ADR-0042, claimEdgeCachePurges(), EdgeCachePurgeRow, markEdgeCachePurgeDone(), markEdgeCachePurgeFailed(), pruneCompletedEdgeCachePurges() (+2 more)

### Community 237 - "application/form-draft-purge.ts"
Cohesion: 0.24
Nodes (10): main(), resolveRetentionDays(), TenantRow, ExpireFormDraftsOptions, ExpireFormDraftsResult, expireOverdueFormDrafts(), IdRow, purgeExpiredFormDrafts() (+2 more)

### Community 238 - "security-headers.ts"
Cohesion: 0.29
Nodes (7): BASE_CSP_DIRECTIVES, buildContentSecurityPolicy(), buildSecurityHeaders(), scriptSrcSources(), SecurityHeaderOptions, cspFor(), directives()

### Community 239 - "compare.ts"
Cohesion: 0.35
Nodes (10): Comparator, compareSemver(), isValidSemver(), ParsedSemver, parseSemver(), parseSemverRange(), satisfiesComparator(), satisfiesSemverRange() (+2 more)

### Community 240 - "getRegisteredCommentableResources()"
Cohesion: 0.27
Nodes (9): getRegisteredCommentableResources(), ADR-0041, isRecord(), POST(), ADR-0041, GET(), isRecord(), POST() (+1 more)

### Community 241 - "data-lifecycle/module.ts"
Cohesion: 0.23
Nodes (8): DATA_LIFECYCLE_PERMISSIONS, DataLifecyclePermissionKey, DataLifecyclePermissionValue, ADR-0037, dataLifecycleModule, ADR-0013, ADR-0037, ROOT

### Community 242 - "Domain Event Dispatcher"
Cohesion: 0.20
Nodes (12): Static Consumer Registry (DOMAIN_EVENT_CONSUMERS), Domain Event Dispatcher, Domain Event Runtime, Versioned Event-Type Registry, Idempotent Consumer Effect (applyConsumerEffectOnce), Transactional Outbox Producer (appendDomainEvent), Announcement / Notification Enqueue (enqueueAnnouncement), Email Suppression List (+4 more)

### Community 243 - "email/templates/[id].ts"
Cohesion: 0.21
Nodes (10): fetchActiveEmailTemplate(), softDeleteEmailTemplate(), DELETE(), DELETE_GUARD, GET(), PATCH(), POST(), READ_GUARD (+2 more)

### Community 244 - "Email Module"
Cohesion: 0.21
Nodes (12): Per-provider Circuit Breaker, Email Dispatcher (claim-lease outbox), Email Module, EmailProvider Port Contract, Mailketing Provider Adapter, Generic Profile Entity Links, maskIdentifierValue (identifier masking), Profile Identity Module (+4 more)

### Community 245 - "tenant-auth-policy.ts"
Cohesion: 0.26
Nodes (11): countEligibleBreakGlassIdentities(), DEFAULT_POLICY_VIEW, fetchEligibleBreakGlassIdentityIds(), getTenantAuthPolicy(), saveTenantAuthPolicy(), SaveTenantAuthPolicyResult, TenantAuthPolicyRow, TenantAuthPolicyView (+3 more)

### Community 246 - "reporting/module.ts"
Cohesion: 0.23
Nodes (9): ACCESS_AUDIT_METRIC_KEYS, EVENT_ACTIVITY_METRIC_KEYS, MODULE_ACTIVITY_METRIC_KEYS, REPORTING_PROJECTION_PERMISSIONS, ReportingProjectionPermissionKey, ReportingProjectionPermissionValue, CURSOR_TABLE_FRESHNESS, EVENT_DRIVEN_FRESHNESS (+1 more)

### Community 247 - "intentionalDivergences (reason + owner + reviewDate + ADR)"
Cohesion: 0.20
Nodes (11): isFullOnlineSecurityActive shared deployment gate, MFA/TOTP paused login (state-driven, not env-gated), Turnstile enforcement (enforceTurnstileIfRequired, breaker discipline), Divergence: business-scope-base-resolver-noop (fail-closed), intentionalDivergences (reason + owner + reviewDate + ADR), Divergence: mfa-session-assurance-built-new, Divergence: oidc-ssrf-blocks-private-ip, Divergence: openapi-one-file-per-module (+3 more)

### Community 248 - "AWCMS project skill catalog"
Cohesion: 0.18
Nodes (11): FORCE ROW LEVEL SECURITY (ENABLE alone is inert), SECURITY DEFINER bootstrap-read checklist, WORKER_ROLE_GRANTS least-privilege drift matrix, Definition of Done full `bun run check` chain, Mini/micro port playbook (adapt, not copy), Non-negotiable rename rules (awcms_mini_ / awcms_micro_ → awcms_), Canonical host derived server-side, never from Host header, Redirect governance + 404 telemetry (ADR-0039) (+3 more)

### Community 249 - "release-verify-checks.ts"
Cohesion: 0.33
Nodes (7): ADR-0024, checkChangelogHasSection(), checkNoPendingChangesets(), checkTagMatchesPackageVersion(), parseVersionFromTag(), Problem, ROOT

### Community 250 - "keywords"
Cohesion: 0.18
Nodes (11): keywords, abac, bun, business-integration, erp, modular-monolith, multi-tenant, offline-first (+3 more)

### Community 251 - "turnstile-enforcement.test.ts"
Cohesion: 0.20
Nodes (8): checkOnlineAuthSecurityReady(), checkTurnstileReady(), isTurnstileEnabled(), installFetchSpy(), login, SECRET, siteverify(), TOKEN

### Community 252 - "validate-module-graph.ts"
Cohesion: 0.24
Nodes (9): findLibNamespaceViolations(), LIB_NAMESPACE_ALIASES, LIB_NAMESPACE_EXCEPTIONS, libNamespaces(), LibNamespaceViolation, main(), ADR-0038, KEYS (+1 more)

### Community 253 - "run-record-store.ts"
Cohesion: 0.20
Nodes (10): LifecycleRunCounts, LifecycleRunRow, LifecycleRunStatus, LifecycleRunType, listLifecycleRuns(), ListLifecycleRunsFilter, RecordLifecycleRunInput, RunDbRow (+2 more)

### Community 254 - "role-admin-validation.ts"
Cohesion: 0.24
Nodes (9): CreateRoleInput, DeleteRoleInput, PermissionRefInput, UpdateRoleInput, validateCreateRoleInput(), validateDeleteRoleInput(), validateUpdateRoleInput(), ValidationError (+1 more)

### Community 255 - "media-upload-session-validation.ts"
Cohesion: 0.24
Nodes (9): CreateNewsMediaUploadSessionInput, CreateNewsMediaUploadSessionValidationResult, FinalizeNewsMediaUploadSessionInput, FinalizeNewsMediaUploadSessionValidationResult, validateCreateNewsMediaUploadSessionInput(), validateFinalizeNewsMediaUploadSessionInput(), validateOptionalText(), ValidationError (+1 more)

### Community 256 - "application/navigation-registry.ts"
Cohesion: 0.31
Nodes (7): collectNavigationCandidates(), fetchTenantDisabledModuleKeys(), fetchVisibleModuleNavigationEntries(), filterVisibleNavigationEntries(), NavigationCandidate, NavigationFilterOptions, ModuleLifecycleStatus

### Community 257 - "suggest.ts"
Cohesion: 0.27
Nodes (9): buildPublicHostResolverConfigFromEnv(), checkSiteSearchGate(), padUnresolvedSearchTenantLatency(), SiteSearchTenantHandler, ADR-0040, withSiteSearchTenant(), RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_SEC (+1 more)

### Community 258 - "sync-validation.ts"
Cohesion: 0.20
Nodes (10): ConflictResolution, ConflictResolutionRequestBody, ConflictResolutionValidationResult, SyncPushEvent, SyncPushRequestBody, SyncPushValidationResult, VALID_RESOLUTIONS, validateConflictResolutionRequestBody() (+2 more)

### Community 259 - "visitor-analytics-config.ts"
Cohesion: 0.29
Nodes (10): isKnownVisitorAnalyticsMode(), isSet(), isVisitorAnalyticsEnabled(), parseBoolean(), parsePositiveInt(), resolveVisitorAnalyticsConfig(), VISITOR_ANALYTICS_DEFAULTS, VISITOR_ANALYTICS_MODES (+2 more)

### Community 260 - "Admin sidebar rendered from module registry (sidebar-menu.ts)"
Cohesion: 0.20
Nodes (10): Admin sidebar rendered from module registry (sidebar-menu.ts), Integration suite hook timeout + exit 143 misreporting fix, Per-tenant sidebar arrangement stored as DELTA, never snapshot, blog_content as cross-module descriptor contributor (seo_facts, searchSources), commentableResources contribution seam (arrow must not be reversed), Admin shell parity with awcms-micro (AdminLayout, CSP hashed theme-init), comments module port (21st base module, ADR-0041), navigation split-brain (descriptor vs static navSections) (+2 more)

### Community 261 - "ProjectionDescriptor registry (cursor_table vs domain_event)"
Cohesion: 0.20
Nodes (10): Composite tenant-scoped foreign keys (FK bypasses RLS), ADR-0036 media ownership inversion (media_library extraction), Atomic uploaded-claim as mutual exclusion + revert path, News media object registry (awcms_news_media_objects), Polymorphic owner_resource_type/id without FK, computeProjectionFreshness (derived, never cached), ProjectionDescriptor registry (cursor_table vs domain_event), TOCTOU rebuild lock via pg_advisory_xact_lock (+2 more)

### Community 262 - "config.json"
Cohesion: 0.20
Nodes (9): access, baseBranch, changelog, commit, fixed, ignore, linked, $schema (+1 more)

### Community 263 - "Blog Content module README"
Cohesion: 0.27
Nodes (10): Managed-media enforcement (one-way switch, ADR-0036), Media Library module (API surface), NewsMediaObjectItem (media registry object), News Portal module (API surface), SEO & Distribution module (API surface), Frozen open-redirect guard, Tenant Domain module (hostname mappings), Theming module (draft/publish/rollback) (+2 more)

### Community 264 - "openapi-route-parity-mutation.test.ts"
Cohesion: 0.27
Nodes (8): runApiDocsCheck(), buildApiReferenceMarkdown(), writeApiReferenceDocs(), routeFileToTemplate(), discoverRouteFiles(), liveSets(), ROOT, ROUTES_DIR

### Community 265 - "cacheability.ts"
Cohesion: 0.31
Nodes (9): buildScopesForSurface(), CacheabilityInput, CACHEABLE_METHODS, CACHEABLE_STATUSES, CacheSkipReason, decideCacheability(), declaresUncacheable(), hasIdentityCookie() (+1 more)

### Community 266 - "surface-registry.ts"
Cohesion: 0.27
Nodes (9): hasReservedSegment(), hasTraversalSegment(), matchPublicCacheSurface(), PUBLIC_CACHE_SURFACES, PublicCacheSurface, RESERVED_SEGMENTS, ADR-0009, ADR-0010 (+1 more)

### Community 267 - "ads/[id].ts"
Cohesion: 0.31
Nodes (8): syncAdPlacements(), validateAdPlacementsInput(), CONFIGURE_GUARD, PATCH(), CONFIGURE_GUARD, GET(), POST(), READ_GUARD

### Community 268 - "cursor-store.ts"
Cohesion: 0.22
Nodes (9): CursorDbRow, getCursor(), LifecycleCursorPhase, LifecycleCursorRow, LifecycleCursorStatus, resetCursor(), toRow(), ADR-0037 (+1 more)

### Community 269 - "enable-managed-media-enforcement.ts"
Cohesion: 0.29
Nodes (8): enableManagedMediaEnforcement(), EnableManagedMediaEnforcementResult, ADR-0026, isManagedMediaEnforcedForTenant(), markManagedMediaEnforced(), ADR-0026, ADR-0036, ManagedMediaReadinessReason

### Community 270 - "ad-placement-rotation.ts"
Cohesion: 0.33
Nodes (6): AdRotationCandidate, selectAdsForRotation(), shuffle(), sortByLatest(), sortByPriority(), weightedSampleWithoutReplacement()

### Community 271 - "news-portal-preset-readiness.ts"
Cohesion: 0.29
Nodes (8): evaluateNewsPortalFullOnlineR2Readiness(), isKnownNewsPortalProfile(), NEWS_PORTAL_PROFILES, NewsPortalPresetReadinessReason, NewsPortalPresetReadinessResult, NewsPortalProfile, ADR-0036, FULLY_CONFIGURED_ENV

### Community 272 - "redirect-eligibility.ts"
Cohesion: 0.27
Nodes (9): EXCLUDED_EXACT, EXCLUDED_SEGMENT_PREFIXES, EXCLUDED_STARTSWITH, fileExtension(), hasControlCharacter(), isRedirectEligiblePath(), STATIC_ASSET_EXTENSIONS, ADR-0028 (+1 more)

### Community 273 - "openapi-bundle.test.ts"
Cohesion: 0.20
Nodes (6): AnyRecord, ROOT, ADR-0034, ADR-0038, ADR-0040, ADR-0041

### Community 274 - "Private vulnerability reporting policy"
Cohesion: 0.25
Nodes (7): Changesets workflow README, Contributor Covenant Code of Conduct, ADR-based decision-making process, Maintainer / contributor / security-responder roles, Baseline security controls, SECURITY.md — Security Policy, Private vulnerability reporting policy

### Community 275 - "Theming lifecycle draft→validate→preview→publish→rollback/retire"
Cohesion: 0.22
Nodes (9): Edge-cache dual obligation (purge enqueue + surface registry), Append-only & immutable table policy, Published version immutability enforced in three layers, Theming lifecycle draft→validate→preview→publish→rollback/retire, Preview session retention via read-filter, not purge job, business-transaction-contract passive data types, A security claim in an ADR is not proof of the claim, example-erp-extension fixture as machine-verifiable proof (+1 more)

### Community 276 - "tenant-domain:dns:sync reconciliation job"
Cohesion: 0.22
Nodes (9): ADRs accepted without implementation, 21-module base inventory, repo:inventory generator not yet ported, Tenant subdomain DNS reconciliation (#236), docs/awcms document package 01-21, Neutral ERP-readiness contracts (ADR-0020), External providers via outbox, never inside a transaction, tenant-domain:dns:sync reconciliation job (+1 more)

### Community 277 - ".prettierrc.json"
Cohesion: 0.22
Nodes (8): overrides, plugins, printWidth, proseWrap, semi, singleQuote, trailingComma, prettier-plugin-astro

### Community 278 - "social-publishing-port.ts"
Cohesion: 0.28
Nodes (7): noopSocialPublishingPortAdapter, ArticlePublishedEventInput, ArticlePublishedPortResult, SocialPublishingPort, SocialPublishingTriggerEvent, ADR-0006, ADR-0036

### Community 279 - "timing-token.ts"
Cohesion: 0.33
Nodes (7): mintTimingToken(), PLACEHOLDER_SECRETS, resolveSecret(), sign(), TimingTokenVerification, ADR-0041, verifyTimingToken()

### Community 280 - "manifest-store.ts"
Cohesion: 0.28
Nodes (7): ArchiveManifestRow, getArchiveManifest(), InsertArchiveManifestInput, listArchiveManifests(), ManifestDbRow, toRow(), ADR-0037

### Community 281 - "abac-policy-directory.ts"
Cohesion: 0.33
Nodes (8): AbacPolicyRecord, insertAbacPolicy(), listAbacPolicies(), mapRow(), PolicyDbRow, setAbacPolicyActive(), updateAbacPolicy(), AbacPolicyValidated

### Community 282 - "MediaLibraryPort Capability"
Cohesion: 0.25
Nodes (9): Media Library Module, MediaLibraryPort Capability, Presigned Direct-to-R2 Upload/Finalize Flow, R2-only Advertisement Placement Presets, News Portal Module, Public Discovery/Syndication (sitemap/feeds), SEO Distribution Module, Central SEO Head Renderer (+1 more)

### Community 283 - "AWCMS Public API Pre-migration OpenAPI Snapshot"
Cohesion: 0.25
Nodes (9): Management Reporting Module, Five Generic Reporting Views, Optimistic-concurrency Conflict Tracking, HMAC Node-to-Node Authentication (v1/v2), Sync Outbox/Inbox Event Exchange, Sync Storage Module, Workflow Approval Module, Closed-set Workflow Graph Model (+1 more)

### Community 284 - "soft-delete.ts"
Cohesion: 0.33
Nodes (7): activeRecordPredicate(), deletedRecordPredicate(), ListOptions, shouldIncludeDeleted(), shouldOnlyListDeleted(), SOFT_DELETE_COLUMNS, SoftDeleteColumns

### Community 285 - "capabilities field (ports-and-adapters seam)"
Cohesion: 0.29
Nodes (8): capabilities field (ports-and-adapters seam), MODULE_CONTRACT_VERSION 2.3.0 descriptor-list seams, seo_facts capability port (content modules provide facts), Aggregator-never-depends-on-provider arrow direction, searchSources descriptor seam (owner declares, aggregator discovers), document_resource_relations capability port (no shared-table write), DataExchangeAdapterPort + ExchangeDescriptor seam, Two-phase import: non-mutating dry-run then idempotent commit

### Community 286 - "Reusable wizard-form component library (target spec, not ported)"
Cohesion: 0.25
Nodes (8): renderSafeSnippet escape-then-sentinel ordering (XSS), Two-layer content sanitization testing (input + render), CSS value validation by rejection (not sanitization), Tokens served as external same-origin stylesheet to preserve CSP, admin-form-client (lockElement/sendJson/postJson) mandatory import, No component library — hand-rolled markup conventions, Client-side wizard drafts hold only non-sensitive, non-persistent state, Reusable wizard-form component library (target spec, not ported)

### Community 287 - "ADR-0028 OIDC/SSO Tenant-aware, Account Linking, Break-glass"
Cohesion: 0.29
Nodes (8): ADR-0027 MFA TOTP, Session Assurance, Step-up, TOTP anti-replay compare-and-swap (last_used_step), Session assurance (aal1/aal2) + requireStepUp, ADR-0028 OIDC/SSO Tenant-aware, Account Linking, Break-glass, Break-glass enforcement at policy save, OIDC SSRF guard (block private/metadata IPs), ADR-0029 Deployment-profile-aware Turnstile Bot Protection, Deployment profile gate (isTurnstileRequired/full_online)

### Community 288 - "Five module categories and admission criteria"
Cohesion: 0.29
Nodes (8): Definition of Skeleton Done / Implementation Ready, 14-sprint implementation blueprint, Traceability matrix (business need -> module -> API -> issue -> sprint -> test), Admission decision tree with Q5 runtime-code gate first, Five module categories and admission criteria, Lifecycle dependency vs capability dependency, offline-lan-safe vs full-online-only compatibility classes, Trusted static registry policy (no marketplace, no runtime install)

### Community 289 - "data_lifecycle module (registry + safe lifecycle engine)"
Cohesion: 0.25
Nodes (8): Modular Monolith, Module Descriptor, Soft Delete, Archive Port + restore procedure (local_offline), Data Lifecycle — operational & compliance guide, HighVolumeTableDescriptor + retention class, Legal Hold (fail-closed precedence), data_lifecycle module (registry + safe lifecycle engine)

### Community 290 - "index.astro"
Cohesion: 0.25
Nodes (7): ../../lib/logging/error-log, ../../modules/reporting/application/access-audit-report, ../../modules/reporting/application/module-usage-report, ../../modules/reporting/application/sync-health-report, ../../modules/reporting/application/tenant-activity-report, DASHBOARD_PERMISSION, hasDashboardAccess

### Community 291 - "tenant-route-factory-check.ts"
Cohesion: 0.39
Nodes (6): callsWithTenantDirectly(), evaluateTenantRouteMigration(), main(), NOT_YET_MIGRATED, TenantRouteMigrationResult, walk()

### Community 292 - "009_awcms_domain_event_runtime_schema.sql"
Cohesion: 0.32
Nodes (7): awcms_domain_event_activity_daily, awcms_domain_event_consumer_effects, awcms_domain_event_consumer_state, awcms_domain_event_deliveries, awcms_domain_event_replays, awcms_domain_events, awcms_idempotency_keys

### Community 293 - "013_awcms_workflow_approval_schema.sql"
Cohesion: 0.43
Nodes (7): awcms_workflow_decisions, awcms_workflow_definitions, awcms_workflow_delegations, awcms_workflow_instances, awcms_workflow_join_arrivals, awcms_workflow_task_assignments, awcms_workflow_tasks

### Community 294 - "015_awcms_reporting_projections_schema.sql"
Cohesion: 0.29
Nodes (7): awcms_reporting_export_runs, awcms_reporting_projection_cursors, awcms_reporting_projection_metrics, awcms_reporting_projection_state, awcms_reporting_rebuild_runs, awcms_reporting_reconciliation_runs, awcms_reporting_scheduled_exports

### Community 295 - "035_awcms_blog_content_schema.sql"
Cohesion: 0.32
Nodes (7): awcms_blog_pages, awcms_blog_post_terms, awcms_blog_posts, awcms_blog_redirects, awcms_blog_revisions, awcms_blog_settings, awcms_blog_terms

### Community 296 - "037_awcms_blog_content_presentation_schema.sql"
Cohesion: 0.32
Nodes (7): awcms_blog_ad_placements, awcms_blog_ads, awcms_blog_menu_items, awcms_blog_menus, awcms_blog_templates, awcms_blog_theme_settings, awcms_blog_widgets

### Community 297 - "066_awcms_comments_schema.sql"
Cohesion: 0.43
Nodes (7): awcms_comments_abuse_events, awcms_comments_comments, awcms_comments_moderation_events, awcms_comments_reply_subscriptions, awcms_comments_reports, awcms_comments_settings, awcms_comments_threads

### Community 298 - "suppression-validation.ts"
Cohesion: 0.32
Nodes (6): KNOWN_REASONS, Result, SuppressionInput, SuppressionReason, validateSuppressionInput(), ValidationError

### Community 299 - "settings-validation.ts"
Cohesion: 0.36
Nodes (7): isPlainObject(), Result, UpdateTenantSettingsInput, VALID_LOCALES, VALID_THEMES, validateUpdateTenantSettingsInput(), ValidationError

### Community 300 - "path-sanitizer.ts"
Cohesion: 0.39
Nodes (7): fileExtension(), isTrackablePath(), sanitizePath(), SENSITIVE_QUERY_PARAM_NAMES, SKIPPED_PATH_PREFIXES, SKIPPED_PATH_SEGMENTS, STATIC_ASSET_EXTENSIONS

### Community 301 - "Media-library ownership inversion (ADR-0036)"
Cohesion: 0.29
Nodes (7): blog_content module guidance, awcms.blog-content.* channels (27), awcms.comments.* channels, DomainEventEnvelope schema, awcms.email.message.* channels, Media-library ownership inversion (ADR-0036), theming asset resolution wired through MediaLibraryPort

### Community 302 - "form_drafts module (domain-agnostic server-side draft store)"
Cohesion: 0.29
Nodes (7): HighVolumeTableDescriptor registry (owner module declares its own table), Legal hold precedence + separate create/release permissions, LegalHoldGuardPort (source-level seam, not capability registry), data_lifecycle module (registry, dry-run, archive/purge), form_drafts module (domain-agnostic server-side draft store), Two-phase retention with legal hold gated at phase 2 only, form_drafts module port (sql/062-063)

### Community 303 - "properties"
Cohesion: 0.29
Nodes (7): minLength, type, declared, source, minLength, type, properties

### Community 304 - "db-pool-health.ts"
Cohesion: 0.43
Nodes (4): interpretPoolHealthStatus(), main(), PoolHealthOutcome, resolveAppBaseUrl()

### Community 305 - "005_awcms_abac_access_control_schema.sql"
Cohesion: 0.43
Nodes (6): awcms_abac_decision_logs, awcms_abac_policies, awcms_access_assignments, awcms_permissions, awcms_role_permissions, awcms_roles

### Community 306 - "online-security-config.ts"
Cohesion: 0.43
Nodes (6): isFullOnlineSecurityActive(), isKnownOnlineSecurityProfile(), isOnlineSecurityEnabled(), KNOWN_ONLINE_SECURITY_PROFILES, OnlineSecurityProfile, resolveOnlineSecurityProfile()

### Community 307 - "application/blog-scheduled-publish.ts"
Cohesion: 0.29
Nodes (6): DuePostRow, PublishDueScheduledPostsOptions, PublishDueScheduledPostsResult, ADR-0006, ADR-0011, ADR-0042

### Community 308 - "menus/index.ts"
Cohesion: 0.33
Nodes (6): validateMenuItemsInput(), PATCH(), CONFIGURE_GUARD, GET(), POST(), READ_GUARD

### Community 309 - "workflow-notification-port-adapter.ts"
Cohesion: 0.38
Nodes (4): ADR-0011, ADR-0011, WorkflowNotificationPort, WorkflowNotificationRequest

### Community 310 - "sod-conflict-evaluation-log.ts"
Cohesion: 0.33
Nodes (6): listSoDConflictEvaluations(), ListSoDConflictEvaluationsFilter, SoDConflictEvaluationDbRow, SoDConflictEvaluationInput, SoDConflictEvaluationRow, toRow()

### Community 311 - "domain/health-registry.ts"
Cohesion: 0.38
Nodes (4): classifyHealthStatus(), HealthStatus, ReadinessSignal, ReadinessSignalStatus

### Community 312 - "Per-tenant Salted Visitor-Key Hash"
Cohesion: 0.29
Nodes (7): Redirect Governance (ADR-0039), Composite Tenant-bound FK (GHSA-r7cx-c4jh-cvvw), Office Hierarchy + Soft-delete/Restore, Public Ingest Beacon (POST /analytics/collect), Retention-based Purge + Legal Hold Gate, Visitor Analytics Module, Per-tenant Salted Visitor-Key Hash

### Community 313 - "tenant-domain-dns-config.ts"
Cohesion: 0.38
Nodes (5): isKnownTenantDomainDnsProvider(), KNOWN_TENANT_DOMAIN_DNS_PROVIDERS, resolveTenantDomainCloudflareTimeoutMs(), TENANT_DOMAIN_CLOUDFLARE_REQUIRED_WHEN_SELECTED, TenantDomainDnsProviderKind

### Community 314 - "visitor-analytics/module.ts"
Cohesion: 0.33
Nodes (4): ADR-0009, ADR-0037, visitorAnalyticsModule, ROOT

### Community 315 - "Admin-approved self-registration (sql/074-075, stores no credential)"
Cohesion: 0.40
Nodes (6): Reuse exact endpoint permission keys (mfa_admin.reset as read gate), /admin/security authentication policy screen, Email password reset flow (sql/073, non-oracle, FOR UPDATE single use), Admin-approved self-registration (sql/074-075, stores no credential), Peta ke artefak nyata awcms (micro names vs awcms names), No `submit` AccessAction (latent-authz trap avoidance)

### Community 316 - "comments module guidance (moderation-first)"
Cohesion: 0.33
Nodes (6): Two public visibility predicates (listing strict vs detail unlisted), Full-precision text keyset cursor (microsecond vs millisecond trap), comments module guidance (moderation-first), Unauthenticated public write surface backbone (no oracle, PII minimized), CURSOR_BOUNDARY_SAFETY_MARGIN_MS (timestamptz vs JS Date precision), Secret-like payload keys rejected outright, never silently redacted

### Community 317 - "ADR-0019 integration_hub module admission (System Foundation)"
Cohesion: 0.33
Nodes (6): Provider-neutral adapter registry (empty at foundation), token_reference is a pointer, with raw-secret rejection heuristic, integration_adapter_registration capability port, ADR-0019 integration_hub module admission (System Foundation), Hub owns delivery envelope status, never final business data, Inbound webhook signature verification + DB replay-key dedup (not Idempotency-Key)

### Community 318 - "news-share.js"
Cohesion: 0.67
Nodes (5): enhanceCopyLinkButtons(), enhanceNativeShareButtons(), fallbackCopyToClipboard(), findWidget(), showStatus()

### Community 319 - "edge-cache-surfaces-check.ts"
Cohesion: 0.40
Nodes (5): collectPurgedModuleKeys(), main(), MUST_NEVER_MATCH, PURGE_CALLER_ROOTS, ADR-0042

### Community 320 - "024_awcms_mfa_totp_schema.sql"
Cohesion: 0.40
Nodes (5): awcms_identity_mfa_factors, awcms_identity_mfa_recovery_codes, awcms_mfa_challenges, awcms_sessions, awcms_tenant_mfa_policies

### Community 321 - "033_awcms_theming_config_schema.sql"
Cohesion: 0.53
Nodes (5): awcms_theming_config_versions, awcms_theming_preview_sessions, awcms_theming_tenant_state, awcms_theming_versions_guard(), awcms_theming_versions_immutable

### Community 322 - "node-management.ts"
Cohesion: 0.40
Nodes (5): NODE_STATUSES, Result, UpdateSyncNodeInput, validateUpdateSyncNodeInput(), ValidationError

### Community 323 - "example_crm Example Module"
Cohesion: 0.33
Nodes (6): One-time Setup Wizard / Platform Bootstrap, Tenant Admin Module, example-crm OpenAPI Fragment, Dummy BusinessScopeHierarchyPort Resolver, example_crm Example Module, Example Domain Modules Fixture

### Community 324 - "db-role-grants-narrow-migration.test.ts"
Cohesion: 0.33
Nodes (3): migrationSql, migrationStatements, repoRoot

### Community 325 - "db-role-separation-migration.test.ts"
Cohesion: 0.33
Nodes (3): migrationSql, migrationStatements, repoRoot

### Community 326 - "news-portal-no-local-fallback.test.ts"
Cohesion: 0.33
Nodes (3): FORBIDDEN_PATTERNS, NEWS_MEDIA_ROUTES_DIR, NEWS_PORTAL_SRC_DIR

### Community 327 - "Workflow Approval Module"
Cohesion: 0.50
Nodes (5): Delegation (standing-based, not permission grant), Escalation/timeout worker job, Closed-set graph node model, Workflow Approval Module, Self-approval-deny check

### Community 328 - "awcms_sync_nodes"
Cohesion: 0.70
Nodes (4): awcms_sync_inbox, awcms_sync_nodes, awcms_sync_outbox, awcms_sync_push_batches

### Community 329 - "014_awcms_email_schema.sql"
Cohesion: 0.50
Nodes (4): awcms_email_delivery_attempts, awcms_email_messages, awcms_email_suppression_list, awcms_email_templates

### Community 330 - "025_awcms_oidc_sso_schema.sql"
Cohesion: 0.60
Nodes (4): awcms_auth_providers, awcms_external_identities, awcms_oidc_auth_requests, awcms_tenant_auth_policies

### Community 331 - "055_awcms_data_lifecycle_schema.sql"
Cohesion: 0.40
Nodes (4): awcms_data_lifecycle_archive_manifests, awcms_data_lifecycle_cursors, awcms_data_lifecycle_legal_holds, awcms_data_lifecycle_runs

### Community 332 - "correlation-response.ts"
Cohesion: 0.60
Nodes (3): CorrelationMergeResult, isApiJsonResponseCandidate(), mergeCorrelationIdIntoApiPayload()

### Community 334 - "lifecycle-validation.ts"
Cohesion: 0.40
Nodes (4): DeleteReasonRequestBody, DeleteReasonValidationResult, validateDeleteReasonRequestBody(), ValidationError

### Community 335 - "tenant-settings-directory.ts"
Cohesion: 0.50
Nodes (4): fetchTenantSettings(), TenantSettingsView, updateTenantSettings(), UpdateTenantSettingsFields

### Community 336 - "theme-permissions.ts"
Cohesion: 0.40
Nodes (4): ThemingConfigAction, ThemingPreviewAction, ThemingVersionAction, ADR-0029

### Community 338 - "family-conformance-ci-parity.test.ts"
Cohesion: 0.40
Nodes (3): ROOT, ADR-0015, ADR-0032

### Community 339 - "AWCMS Media Library Module (skill)"
Cohesion: 0.50
Nodes (4): ADR-0036 Media Library Ownership Inversion, One-Way Managed Media Enforcement, AWCMS Media Library Module (skill), MediaLibraryPort Capability

### Community 340 - "validateModuleDependencyGraph (registry-wide DAG validator)"
Cohesion: 0.50
Nodes (4): bootstrapPlatformTenant (composition-root orchestration), hasDependencyCycle (single-module cycle check), validateModuleDependencyGraph (registry-wide DAG validator), news_portal deliberately declares no dependency on blog_content

### Community 341 - "defineTenantRoute (mandatory tenant route opener)"
Cohesion: 0.50
Nodes (4): defineTenantRoute (mandatory tenant route opener), NOT_YET_MIGRATED shrink-only allow-list, workClass pool budget (required, no default), API routes live in src/pages, never inside module folders

### Community 342 - "Issue template chooser config"
Cohesion: 0.50
Nodes (4): Bug report issue template, Issue template chooser config, Documentation issue template, Feature request issue template

### Community 343 - "AWCMS Family Direct-Use Templates (mini/awcms/micro)"
Cohesion: 0.50
Nodes (4): ADR-0020 — Neutral ERP-Readiness Contracts, ADR-0034 — Direct-Use Templates & Derived Pathway Removal, AWCMS Family Direct-Use Templates (mini/awcms/micro), Family Compatibility Manifest + CI Conformance Gate

### Community 344 - "capabilityContractVersions (party_directory, media_library, seo_facts, auth_notification)"
Cohesion: 0.50
Nodes (4): auth_notification capability (email -> identity_access), capabilityContractVersions (party_directory, media_library, seo_facts, auth_notification), family:conformance:check gate, AWCMS family compatibility manifest

### Community 345 - "CONTRIBUTING.md"
Cohesion: 0.50
Nodes (3): bun run check (main CI validation gate), Conventional Commits convention, Definition of Done

### Community 347 - "awcms_tenants"
Cohesion: 0.83
Nodes (3): awcms_offices, awcms_tenant_settings, awcms_tenants

### Community 348 - "awcms_profiles"
Cohesion: 0.83
Nodes (3): awcms_profile_entity_links, awcms_profile_identifiers, awcms_profiles

### Community 349 - "awcms_identities"
Cohesion: 0.83
Nodes (3): awcms_identities, awcms_sessions, awcms_tenant_users

### Community 350 - "050_awcms_visitor_analytics_schema.sql"
Cohesion: 0.67
Nodes (3): awcms_visit_events, awcms_visitor_daily_rollups, awcms_visitor_sessions

### Community 351 - "060_awcms_seo_distribution_redirect_schema.sql"
Cohesion: 0.50
Nodes (3): awcms_seo_not_found_observations, awcms_seo_redirect_settings, awcms_seo_redirects

### Community 352 - "env.d.ts"
Cohesion: 0.50
Nodes (3): App, Locals, ADR-0042

### Community 354 - "Legal hold enforced at the purge, not in data_lifecycle"
Cohesion: 0.50
Nodes (4): Minimized PII (hash, mask, AES-256-GCM), comments:retention anonymization sweep, Two-phase retention: expire then purge, Legal hold enforced at the purge, not in data_lifecycle

### Community 355 - "ThemeConfig (data, not code)"
Cohesion: 0.50
Nodes (4): CSS Value Validation by Rejection, ThemeConfig (data, not code), Theme Lifecycle (draft→publish→rollback), Theming Module

### Community 357 - "Bundle Fragment Conflict Rejection (BundleConflictError)"
Cohesion: 0.83
Nodes (4): OpenAPI Conflict Fixture: unsupported components section, OpenAPI Conflict Fixture: base path override, OpenAPI Conflict Fixture: shared schema override, Bundle Fragment Conflict Rejection (BundleConflictError)

### Community 358 - "migration-tenant-guc-consistency.test.ts"
Cohesion: 0.67
Nodes (3): ALLOWED_OTHER_GUCS, readMigrations(), stripSqlComments()

### Community 359 - "Bounded file parsing (HTTP tier + early parser abort)"
Cohesion: 0.67
Nodes (3): readJsonBody body-size limit tiers, Non-configurable sitemap/feed amplification ceilings, Bounded file parsing (HTTP tier + early parser abort)

### Community 360 - "Finalize does full GET + magic-byte sniff + server checksum"
Cohesion: 0.67
Nodes (3): Finalize does full GET + magic-byte sniff + server checksum, image/svg+xml forbidden by default (key decision #5), TOCTOU size-cap fix (readCappedStream)

### Community 361 - "Separate R2 bucket/credentials from sync-storage (key decision #1)"
Cohesion: 0.67
Nodes (3): No local fallback / no temp files (key decision #2), Separate R2 bucket/credentials from sync-storage (key decision #1), Two-flag env deployment gate (SOCIAL_PUBLISHING_ENABLED/_PROFILE)

### Community 362 - "Postgres status does not gate R2 storage access (key decision #4)"
Cohesion: 0.67
Nodes (3): Object key never contains PII/original filename (key decision #3), Postgres status does not gate R2 storage access (key decision #4), Tenant-writable auto-publish toggle (business preference, not security control)

### Community 364 - "Sprint/milestone plan"
Cohesion: 0.67
Nodes (3): Base generic GitHub issues backlog, Sprint/milestone plan, Testing pyramid strategy

### Community 365 - "Mini-First Development Flow"
Cohesion: 0.67
Nodes (3): Mini-First Development Flow, AWCMS Family (three parallel templates), Test-in-awcms-mini-then-port rule

### Community 366 - "Required Status Checks (Repository Ruleset)"
Cohesion: 1.00
Nodes (3): bun run check / CI quality gate parity, Branch Protection — Required Status Checks, Required Status Checks (Repository Ruleset)

### Community 367 - "Domain event outbox + dead-letter replay"
Cohesion: 0.67
Nodes (3): Domain Event Runtime module (API surface), Domain event outbox + dead-letter replay, HMAC-authenticated sync (push/pull/status/objects)

### Community 372 - "Secret-shaped keys rejected, not redacted"
Cohesion: 0.67
Nodes (3): Opaque JSONB payload owned by the creating module, Secret-shaped keys rejected, not redacted, Non-secret tenant module settings

### Community 373 - "evaluateManagedMediaReadiness"
Cohesion: 0.67
Nodes (3): One-way Managed-Media Enforcement, evaluateManagedMediaReadiness, Editorial Homepage Section Composer

### Community 377 - "ProjectionDescriptor Contract"
Cohesion: 0.67
Nodes (3): Live-computed Projection Freshness, ProjectionDescriptor Contract, Scheduled Projection Exports

## Ambiguous Edges - Review These
- `Permission-seed migration reaches only tenants created after it` → `Integration suite hook timeout + exit 143 misreporting fix`  [AMBIGUOUS]
  .changeset/integration-hook-timeout.md · relation: conceptually_related_to
- `GET /api/v1/tenant/modules/matrix + per-module audit summary` → `ModuleApiContract.routes + modules:routes:check (longest-prefix ownership)`  [AMBIGUOUS]
  .changeset/module-route-ownership.md · relation: conceptually_related_to

## Knowledge Gaps
- **2858 isolated node(s):** `$schema`, `changelog`, `commit`, `fixed`, `linked` (+2853 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **73 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Permission-seed migration reaches only tenants created after it` and `Integration suite hook timeout + exit 143 misreporting fix`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `GET /api/v1/tenant/modules/matrix + per-module audit summary` and `ModuleApiContract.routes + modules:routes:check (longest-prefix ownership)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `withTenant()` connect `Tenant Transaction & Authorization Core` to `Audit Log & Idempotency`, `Database Client & Request Body Limits`, `Error Responses & HTML Escaping`, `SSR Session & Blog Revisions`, `OIDC OAuth State & PKCE`, `Circuit Breaker & Provider Metrics`, `Integration Test Seeding`, `Reporting Projection Workers`, `redirect-resolution-service.ts`, `MFA Config & Client Fingerprint`, `ads/[id].ts`, `visitor-analytics.integration.test.ts`, `Scheduled Job Entrypoints`, `API Response & Keyset Pagination`, `Capacity Budget Config`, `ABAC Policy Admin Routes`, `tenant-domain-directory.ts`, `media-reconciliation.ts`, `audit-log-purge.ts`, `export-generation.ts`, `seo-redirect-governance.integration.test.ts`, `assertUuid()`, `dispatch-domain-events.ts`, `business-scope-expiry-job.ts`, `public-host-tenant-resolver.ts`, `archive-purge-job.ts`, `menus/index.ts`, `media-object-directory.ts`, `theming.integration.test.ts`, `email-template-directory.ts`, `workflow-instance.ts`, `ad-placements/[id].ts`, `definitions/[id].ts`, `object-dispatch.ts`, `application/email-dispatch.ts`, `sod.integration.test.ts`, `email/templates/[id].ts`, `seo-distribution.integration.test.ts`, `theming/preview.ts`, `abac-policy-evaluator.integration.test.ts`?**
  _High betweenness centrality (0.082) - this node is a cross-community bridge._
- **Why does `astro` connect `astro` to `suggest.ts`, `Integration Test Seeding`, `site-search/settings.ts`, `content-purge.ts`, `search-diagnostics.ts`, `tenant-route.ts`, `form-draft-directory.ts`, `comment-settings.ts`, `enforceTurnstileIfRequired()`, `serveDiscovery()`, `report.ts`, `comment-moderation.ts`, `presentation/theme-public-css.ts`, `presentation/theme-preview.ts`, `getRegisteredCommentableResources()`, `admin/[id]/restore.ts`, `package.json`, `keywords`, `query.ts`?**
  _High betweenness centrality (0.045) - this node is a cross-community bridge._
- **Why does `recordAuditEvent()` connect `Audit Log & Idempotency` to `Tenant Transaction & Authorization Core`, `Database Client & Request Body Limits`, `Error Responses & HTML Escaping`, `SSR Session & Blog Revisions`, `business-scope-assignment-service.ts`, `user-admin.ts`, `ads/[id].ts`, `MFA Config & Client Fingerprint`, `enable-managed-media-enforcement.ts`, `role-admin.ts`, `API Response & Keyset Pagination`, `ABAC Policy Admin Routes`, `sod-exception-service.ts`, `media-reconciliation.ts`, `audit-log-purge.ts`, `dispatch-domain-events.ts`, `business-scope-expiry-job.ts`, `identifier-directory.ts`, `archive-purge-job.ts`, `consumer-state-directory.ts`, `menus/index.ts`, `media-object-directory.ts`, `abac-admin.ts`, `email-template-directory.ts`, `ad-placements/[id].ts`, `definitions/[id].ts`, `media-object-key.ts`, `ad-placement-directory.ts`, `party-directory.ts`, `legal-hold-service.ts`, `domain-event-directory.ts`, `email/templates/[id].ts`, `office-directory.ts`, `theming/preview.ts`?**
  _High betweenness centrality (0.025) - this node is a cross-community bridge._
- **What connects `$schema`, `changelog`, `commit` to the rest of the system?**
  _2858 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Tenant Transaction & Authorization Core` be split into smaller, more focused modules?**
  _Cohesion score 0.031051964512040557 - nodes in this community are weakly interconnected._