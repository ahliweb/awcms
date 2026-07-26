# Graph Report - /home/data/dev_bun/awcms  (2026-07-27)

## Corpus Check
- 19 files · ~1,303,490 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 8245 nodes · 21477 edges · 495 communities (415 shown, 80 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 338 edges (avg confidence: 0.77)
- Token cost: 138,814 input · 0 output

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
- safeErrorDetail
- password-reset.ts
- public-blog-directory.ts
- media-library-port-adapter.ts
- AWCMS Backend & Integration Hardening (skill)
- redirect-safety.ts
- registrations.astro
- tenant-sso-policy.ts
- form-draft-directory.ts
- tenant-sso.ts
- seo-facts-port.ts
- mailketing-provider.ts
- dispatch-domain-events.ts
- comment-service.ts
- security-readiness.ts
- ADR-0041: comments module admission
- homepage-section-policy.ts
- runJob()
- listModules()
- export-generation.ts
- visitor-analytics-domain.test.ts
- src/modules/index.ts
- serveDiscovery()
- module-composition.ts
- login.ts
- step-up.ts
- public-host-tenant-resolver.ts
- blog-term-validation.ts
- internal-tag-link-rendering.ts
- media-object-directory.ts
- url-change-capture.ts
- object-dispatch.ts
- workflow-definition-directory.ts
- self-registration.integration.test.ts
- sod-exception-service.ts
- theming.integration.test.ts
- media-library/module.ts
- audit-log-purge.ts
- blog-content-presentation-domain.test.ts
- workflow-instance-decision.ts
- tenant-route.ts
- Arsitektur AWCMS (ARCHITECTURE.md)
- ADR-0033 Dynamic ABAC Policy Evaluator
- email-template-directory.ts
- auth-provider-directory.ts
- recordCounter()
- metrics-port.ts
- turnstile.ts
- report.ts
- media-r2-config.ts
- theme-config.ts
- abac-admin.ts
- abac-policy.ts
- access-control.ts
- ERP domain modules (finance/inventory/procurement/HR)
- fetchActiveTenants()
- ads-directory.ts
- append-domain-event.ts
- ModuleDescriptor
- redirects/[id].ts
- family-conformance-check.ts
- application/login-policy.ts
- business-scope.integration.test.ts
- properties
- application/email-dispatch.ts
- comment-moderation.ts
- archive-purge-job.ts
- legal-hold-service.ts
- workflow-graph.ts
- createPersonProfileForIdentity (application/person-profile.ts)
- redirect-resolution-service.ts
- withTenant / SET LOCAL RLS context
- register.astro
- sod-rule-registry.ts
- public-search-tenant-resolution.ts
- collect.ts
- workflow-instance.ts
- capacity-config.ts
- escapeHtml()
- post-status.ts
- party-directory.ts
- theme-descriptor.ts
- package.json
- edge-cache/config.ts
- presentation/theme-preview.ts
- commentable-resource-registry.ts
- family-conformance.test.ts
- surrogate-keys.ts
- docs-checks.mjs
- media-r2-verification.ts
- media-r2-client.ts
- seo-distribution.integration.test.ts
- redirect-rule.ts
- office-directory.ts
- module-management OpenAPI fragment
- compilerOptions
- collector.ts
- menu-directory.ts
- email-template-render.ts
- abac-policy-evaluator.integration.test.ts
- ADR-0003 PostgreSQL + RLS multi-tenant isolation
- AdminLayout.astro
- edge-cache.test.ts
- blog-post-directory.ts
- widget-policy.ts
- comment-settings.ts
- business-scope-assignment-service.ts
- abac-evaluator.ts
- Varnish edge-cache infrastructure layer (ADR-0042)
- properties
- local-archive-adapter.ts
- identity-access OpenAPI fragment
- runtime.ts
- [tenantCode]/feed.xml.ts
- domain-event-directory.ts
- ad-placement-directory.ts
- production:preflight read-only preflight
- work-class-registry-generate.ts
- runSecurityReadinessChecks()
- workflow-recovery.ts
- user-admin.ts
- seo-metadata-service.ts
- provideTenant()
- family-contract.ts
- capability-contract-versions.ts
- module-boundary.test.ts
- content-quality-checklist.ts
- comments-domain.test.ts
- dry-run-planner.ts
- consumer-state-directory.ts
- seo-document.ts
- search-diagnostics.ts
- tenant-domain-directory.ts
- tenant-domain-validation.ts
- user-agent.ts
- workflow-approval.test.ts
- CI job: quality
- required
- authorizeInTransaction() single authorization chokepoint
- OpenAPI bundle (generated, one-file-per-module)
- [revisionId].ts
- TenantContext
- reply-notifications.ts
- high-risk-sod-guard.ts
- homepage-section-reference-validation.ts
- application/health-registry.ts
- application/module-settings.ts
- ad-placement-policy.ts
- profiles/[id].ts
- theme-lifecycle-preview.test.ts
- visitor-analytics-privacy.test.ts
- Release job: validate (read-only)
- bun
- required
- family
- MFA TOTP + recovery codes
- jwt-verify.ts
- social-share-links.ts
- redaction.ts
- redirect-target.ts
- theme-registry.test.ts
- checkSsoBreakGlassReady (critical readiness check)
- Sync-first rule (syncModuleDescriptors)
- AWCMS family conformance to AWCMS-Mini standard
- lifecycle-registry.ts
- getRegisteredCommentableResources()
- internal-tag-link-settings-directory.ts
- redirect-directory.ts
- analytics-queries.ts
- ADR-0016 organization_structure module admission
- devDependencies
- seo_distribution module (discovery scope)
- domains.astro
- comments OpenAPI fragment
- logging-lint-check.ts
- table-write-ownership-check.ts
- posts/[id].ts
- job-runner.ts
- application/permission-sync.ts
- reporting.test.ts
- discovery-cache.ts
- condition-action-registry.ts
- Varnish 7.5 edge-cache service
- awcms-family-compatibility.schema.json
- business-scope-facts.ts
- security.astro
- Data Lifecycle module README
- changeset-policy-check.ts
- getRegisteredSearchSources()
- validate-env.ts
- rollup.ts
- blog-page-directory.ts
- video-news-block-validation.ts
- media-object-key.ts
- Idempotent High-Risk Mutation Skill
- migrationChecksum
- required
- properties
- comment-retention.ts
- error-sanitizer.ts
- sync-agent-memory.ts
- theme-render-resolver.ts
- presentation/theme-public-css.ts
- awcms_resolve_tenant_domain_lookup SECURITY DEFINER bootstrap read
- Tenant Admin Module
- ADR-0042: Varnish edge-cache tier, off by default
- ERP-Specific Threats
- Derived Application Guide (DEPRECATED, ADR-0034)
- Bundled published OpenAPI contract
- check-docs.mjs
- docs-i18n-checks.mjs
- application/form-draft-purge.ts
- security-headers.ts
- compare.ts
- data-lifecycle/module.ts
- Domain Event Dispatcher
- role-admin-validation.ts
- office-validation.ts
- sod.integration.test.ts
- form_drafts module (domain-agnostic server-side draft store)
- intentionalDivergences (reason + owner + reviewDate + ADR)
- AWCMS project skill catalog
- release-verify-checks.ts
- Row-Level Security (RLS)
- keywords
- db-role-separation-worker-setup-migration.test.ts
- validate-module-graph.ts
- run-record-store.ts
- AWCMS Public API Pre-migration OpenAPI Snapshot
- policy-cache.ts
- abac-evaluator.test.ts
- media-upload-session-validation.ts
- application/navigation-registry.ts
- Per-tenant Salted Visitor-Key Hash
- comments module guidance (moderation-first)
- ProjectionDescriptor registry (cursor_table vs domain_event)
- config.json
- Eleven ERP contract families (neutral contracts, base is not ERP)
- Four deployment profiles (development/staging/production/offline-LAN)
- ApiError schema
- Blog Content module README
- site-search OpenAPI fragment
- turnstile-enforcement.test.ts
- surface-registry.ts
- announcement-validation.ts
- enable-managed-media-enforcement.ts
- news-portal-preset-readiness.ts
- not-found-directory.ts
- redirect-eligibility.ts
- v1/settings/index.ts
- Private vulnerability reporting policy
- capabilities field (ports-and-adapters seam)
- Theming lifecycle draft→validate→preview→publish→rollback/retire
- requester!=approver SoD rule + self-approval deny
- commentableResources descriptor seam
- .prettierrc.json
- social-publishing-port.ts
- timing-token.ts
- manifest-store.ts
- soft-delete.ts
- Reusable wizard-form component library (target spec, not ported)
- ADR-0028 OIDC/SSO Tenant-aware, Account Linking, Break-glass
- data_lifecycle module (registry + safe lifecycle engine)
- analytics.astro
- Publication boundary at resource->thread
- tenant-route-factory-check.ts
- 009_awcms_domain_event_runtime_schema.sql
- 013_awcms_workflow_approval_schema.sql
- 015_awcms_reporting_projections_schema.sql
- 035_awcms_blog_content_schema.sql
- 037_awcms_blog_content_presentation_schema.sql
- 066_awcms_comments_schema.sql
- application/blog-scheduled-publish.ts
- suppression-validation.ts
- access-guard-field-access.test.ts
- settings-validation.ts
- Admin sidebar rendered from module registry (sidebar-menu.ts)
- capabilityContractVersions (party_directory, media_library, seo_facts, auth_notification)
- ADR-0019 integration_hub module admission (System Foundation)
- properties
- tenant-domain:dns:sync reconciliation job
- 005_awcms_abac_access_control_schema.sql
- online-security-config.ts
- workflow-notification-port-adapter.ts
- EmailProvider Port Contract
- domain/health-registry.ts
- tenant-domain-dns-config.ts
- theme-preview-render.ts
- announcement-enqueue-batching.test.ts
- withTenant integration point (SET LOCAL tenant + backpressure)
- news-share.js
- edge-cache-surfaces-check.ts
- 024_awcms_mfa_totp_schema.sql
- 033_awcms_theming_config_schema.sql
- db-role-grants-narrow-migration.test.ts
- db-role-separation-migration.test.ts
- news-portal-no-local-fallback.test.ts
- HighVolumeTableDescriptor registry (owner module declares its own table)
- Workflow Approval Module
- awcms_sync_nodes
- 014_awcms_email_schema.sql
- 025_awcms_oidc_sso_schema.sql
- 055_awcms_data_lifecycle_schema.sql
- correlation-response.ts
- localized-content-directory.ts
- Workflow Approval Module
- MediaLibraryPort Capability
- admin-security-page-contract.test.ts
- family-conformance-ci-parity.test.ts
- AWCMS Media Library Module (skill)
- validateModuleDependencyGraph (registry-wide DAG validator)
- defineTenantRoute (mandatory tenant route opener)
- Issue template chooser config
- AWCMS Family Direct-Use Templates (mini/awcms/micro)
- CONTRIBUTING.md
- awcms_tenants
- awcms_profiles
- awcms_identities
- 050_awcms_visitor_analytics_schema.sql
- 060_awcms_seo_distribution_redirect_schema.sql
- env.d.ts
- admin-form-client.ts
- Legal hold enforced at the purge, not in data_lifecycle
- data-lifecycle-config.ts
- lifecycle-validation.ts
- Sync Storage Module
- ThemeConfig (data, not code)
- data-lifecycle-legal-hold-guard-adapter.test.ts
- Bundle Fragment Conflict Rejection (BundleConflictError)
- migration-tenant-guc-consistency.test.ts
- FakeRedisClient
- Bounded file parsing (HTTP tier + early parser abort)
- Finalize does full GET + magic-byte sniff + server checksum
- Separate R2 bucket/credentials from sync-storage (key decision #1)
- Postgres status does not gate R2 storage access (key decision #4)
- adr-admission-implementation-status.test.ts
- Sprint/milestone plan
- Mini-First Development Flow
- Required Status Checks (Repository Ruleset)
- Domain event outbox + dead-letter replay
- security-readiness-failclosed.test.ts
- security-readiness-worker-setup-grants.test.ts
- 011_awcms_sync_storage_conflict_schema.sql
- 031_awcms_abac_policy_dsl_schema.sql
- 071_awcms_sidebar_menu_schema.sql
- author-lookup.ts
- Secret-shaped keys rejected, not redacted
- evaluateManagedMediaReadiness
- access-audit-report.ts
- tenant-activity-report.ts
- edge-cache-content-purge.test.ts
- family-conformance-db.test.ts
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
- Generated API & event reference
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
- Immutable hostname, atomic set-primary
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
- Committed snapshot of Claude Code agent memory
- Keyset cursor microsecond precision trap
- Operator-safe Delivery Replay
- Email Template Management + Category Allowlist
- WORKFLOW_ACTION_HANDLERS

## God Nodes (most connected - your core abstractions)
1. `withTenant()` - 538 edges
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
- `verification_status drift between JIT SSO and self-registration` --semantically_similar_to--> `Break-glass eligibility drift after save`  [INFERRED] [semantically similar]
  src/modules/profile-identity/README.md → .changeset/sso-break-glass-readiness.md
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
- **Break-glass guarantee: save-time policy check plus runtime drift re-derivation** — _changeset_sso_break_glass_readiness_savetenantauthpolicy, _changeset_sso_break_glass_readiness_checkssobreakglassready, _changeset_sso_break_glass_readiness_fetcheligiblebreakglassidentityids, _changeset_sso_break_glass_readiness_evaluatebreakglassrequirement, docs_awcms_oidc_sso_break_glass_sop [EXTRACTED 1.00]
- **ADR-0013 §6 single-writer table ownership enforcement** — _changeset_table_write_ownership_gate_modules_table_writes_check, _changeset_table_write_ownership_gate_no_shared_table_write, _changeset_table_write_ownership_gate_derived_ownership, _changeset_table_write_ownership_gate_excusedowner, src_modules_profile_identity_readme_createpersonprofileforidentity, src_modules_identity_access_readme_auth_notification_port [EXTRACTED 1.00]
- **Layered authorization stack behind one chokepoint** — docs_architecture_withtenant, src_modules_identity_access_readme_authorizeintransaction, src_modules_identity_access_readme_evaluateaccess, src_modules_identity_access_readme_abac_dsl_evaluator, src_modules_identity_access_readme_business_scope_hierarchy, src_modules_identity_access_readme_sod_enforcement [EXTRACTED 1.00]
- **Registry contribution seams: owner module declares, aggregator discovers via listModules()** — _claude_skills_awcms_comments_skill_commentableresources, _claude_skills_awcms_blog_content_skill_descriptor_contributions, _claude_skills_awcms_data_lifecycle_skill_highvolumetabledescriptor, _changeset_admin_sidebar_from_registry_sidebar, _changeset_module_route_ownership_routes [INFERRED 0.85]
- **Edge-cache invalidation failure chain (three silent defects, all reporting success)** — changelog_edge_cache_ban_expression_fix, changelog_bun_nonstandard_method_defect, changelog_edge_cache_guc_mismatch_fix, changelog_edge_cache_surfaces_check, _claude_skills_awcms_edge_cache_skill_surrogate_key_vocabulary [EXTRACTED 0.95]
- **Anonymous surfaces answer uniformly: no enumeration oracle anywhere** — _claude_skills_awcms_comments_skill_public_write_security, _changeset_self_registration_flow, _changeset_password_reset_via_email_flow, _claude_skills_awcms_blog_content_skill_public_visibility_predicates [INFERRED 0.85]
- **Descriptor-list seam pattern: module declares, central aggregator discovers via listModules()** — _claude_skills_awcms_module_management_skill_modulecontractversion, _claude_skills_awcms_site_search_skill_searchsourcesseam, _claude_skills_awcms_reporting_skill_projectiondescriptor, docs_adr_0018_data_exchange_module_admission_adapterport, docs_adr_0021_reference_data_module_admission_referencedataport [INFERRED 0.85]
- **Direct-to-R2 media upload defense-in-depth chain** — _claude_skills_awcms_news_portal_skill_r2bucketseparation, _claude_skills_awcms_news_portal_skill_objectkeynopii, _claude_skills_awcms_news_portal_skill_finalizemimesniffing, _claude_skills_awcms_news_portal_skill_toctousizecap, _claude_skills_awcms_news_portal_skill_atomicuploadclaim [EXTRACTED 1.00]
- **Tenant isolation enforcement stack (FORCE RLS + composite FK + least-privilege roles + scoped bootstrap read)** — _claude_skills_awcms_new_migration_skill_forcerls, _claude_skills_awcms_new_migration_skill_compositefk, _claude_skills_awcms_new_migration_skill_workerrolegrants, _claude_skills_awcms_tenant_domain_routing_skill_domainbootstraprole, docs_adr_0016_organization_structure_module_admission_tenantvslegalentity [INFERRED 0.85]
- **Descriptor-list contribution seam pattern (inward, many providers)** — docs_adr_0040_site_search_module_admission_search_source_descriptor, docs_adr_0041_comments_module_admission_commentable_resources, docs_adr_0040_site_search_module_admission_inward_dependency_direction, docs_awcms_absorb_awcms_micro_roadmap_contract_version_per_seam, docs_awcms_21_module_admission_governance_lifecycle_vs_capability_dependency [EXTRACTED 1.00]
- **Edge-cache defence in depth (allow-list, labelling, default-deny VCL, anchored invalidation)** — docs_adr_0042_varnish_edge_cache_auto_activation_decide_cacheability, docs_adr_0042_varnish_edge_cache_auto_activation_default_deny_vcl, docs_adr_0042_varnish_edge_cache_auto_activation_surrogate_key_invalidation, docs_adr_0042_varnish_edge_cache_auto_activation_cache_key_space_bound, docs_awcms_edge_cache_architecture_public_cache_surfaces [EXTRACTED 1.00]
- **DB-gated suite execution split across CI and release** — _github_workflows_ci_integration_tests, _github_workflows_ci_suite_collision_split, _github_workflows_ci_integration_timeout, _github_workflows_release_validate, _github_workflows_release_database_url_unset [EXTRACTED 1.00]
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
- **Layered login-flow security (Turnstile/MFA/OIDC)** — docs_awcms_turnstile_bot_protection_turnstile, docs_awcms_mfa_totp_step_up_mfa, docs_awcms_mfa_totp_step_up_per_factor_lockout [INFERRED 0.80]
- **Non-production safety interlock (target guard reuse)** — docs_awcms_production_preflight_runbook_authorizeapply, docs_awcms_resilience_dr_verification_target_guard, docs_awcms_performance_suite_safety_interlock [EXTRACTED 0.90]
- **Verified R2 media-object dependency (managed media)** — openapi_modules_media_library_openapi_newsmediaobjectitem, openapi_modules_media_library_openapi_enforcement, openapi_modules_news_portal_openapi_module, openapi_modules_theming_openapi_module, openapi_modules_seo_distribution_openapi_module, src_modules_blog_content_readme [EXTRACTED 0.90]
- **ADR-0006 Transactional Outbox / Three-phase Dispatcher Pattern** — src_modules_domain_event_runtime_readme_dispatcher, src_modules_email_readme_email_dispatcher, src_modules_sync_storage_readme_object_dispatcher [INFERRED 0.85]
- **Capability Port Seam Pattern (provides/consumes)** — src_modules_media_library_readme_media_library_port, src_modules_seo_distribution_readme_seo_facts_contract, src_modules_workflow_approval_readme_condition_registry, src_modules_sync_storage_readme_object_uploader, src_modules_email_readme_email_provider_contract [INFERRED 0.75]

## Communities (495 total, 80 thin omitted)

### Community 0 - "Tenant Transaction & Authorization Core"
Cohesion: 0.03
Nodes (194): hashSessionToken(), POOL_MAX_OVERRIDE_ENV_VAR, sharedClients, isPostgresClientInputError(), POSTGRES_CLIENT_INPUT_ERROR_CLASSES, WithTenantOptions, isBlogContentStatus(), listConsumerStates() (+186 more)

### Community 1 - "Audit Log & Idempotency"
Cohesion: 0.04
Nodes (138): fetchBlogPostById(), purgeBlogPost(), transitionBlogPostStatus(), fetchPostTermIds(), checklistBlockersToErrorDetails(), evaluateContentQualityChecklistForContent(), isValidStatusTransition(), authorizeInTransaction() (+130 more)

### Community 2 - "Database Client & Request Body Limits"
Cohesion: 0.03
Nodes (122): getDatabaseClient(), BODY_SIZE_TIER_BYTES, BodyReadResult, BodySizeTier, bodyTooLargeResponse(), checkContentLengthCeiling(), parseDeclaredLength(), readCappedText() (+114 more)

### Community 3 - "Error Responses & HTML Escaping"
Cohesion: 0.03
Nodes (76): ADR-0025, emailModule, ADR-0011, ADR-0013, identityAccessModule, ADR-0011, loggingModule, ADR-0037 (+68 more)

### Community 4 - "SSR Session & Blog Revisions"
Cohesion: 0.05
Nodes (69): listBreakGlassCandidates(), VISITOR_ANALYTICS_DEFAULTS, candidates(), eligible(), seedAccount(), seedTenant(), seedFixtures(), insertPost() (+61 more)

### Community 5 - "MFA TOTP & Recovery Codes"
Cohesion: 0.04
Nodes (70): currentThreshold(), log(), LOG_LEVEL_SEVERITY, LogLevel, LogSink, fetchAdPlacements(), softDeleteAd(), syncAdPlacements() (+62 more)

### Community 6 - "Module Descriptor Registry"
Cohesion: 0.05
Nodes (74): RFC-2606, runApiDocsCheck(), AnyRecord, asArray(), asRecord(), buildApiReferenceMarkdown(), buildRawApiReferenceMarkdown(), ENVELOPE_SCHEMA_NAMES (+66 more)

### Community 7 - "OIDC OAuth State & PKCE"
Cohesion: 0.06
Nodes (66): RFC-4226, RFC-4648, AUTH_MFA_REQUIRED_WHEN_ENABLED, isMfaFeatureEnabled(), KNOWN_TOTP_DIGITS, resolveMfaLockoutMinutes(), resolveMfaMaxVerifyAttempts(), resolveTotpDigits() (+58 more)

### Community 8 - "Circuit Breaker & Provider Metrics"
Cohesion: 0.07
Nodes (59): runBoundedBatches(), applyEventActivityProjectionIncrement(), ProjectionRebuildInProgressError, getStreamCursor(), resetProjectionCursors(), upsertStreamCursor(), assertSafeIdentifier(), computeMetricDeltas() (+51 more)

### Community 9 - "Integration Test Seeding"
Cohesion: 0.03
Nodes (69): scripts, analytics:purge, analytics:rollup, api:docs:check, api:docs:generate, api:spec:check, api:tenant-route:check, blog:publish:scheduled (+61 more)

### Community 10 - "Reporting Projection Workers"
Cohesion: 0.08
Nodes (48): withTenant(), readTextBody(), resolveLimitBytes(), AbacPolicyRecord, getAbacPolicyById(), insertAbacPolicy(), listAbacPolicies(), mapRow() (+40 more)

### Community 11 - "package.json Script Surface"
Cohesion: 0.07
Nodes (52): ADR-0003, main(), ADR-0040, SearchSourceDescriptor, countSource(), createRun(), finalizeRun(), IndexRunResult (+44 more)

### Community 12 - "MFA Config & Client Fingerprint"
Cohesion: 0.07
Nodes (46): withSiteSearchTenant(), recordSearchQuery(), ADR-0040, decodeSearchCursor(), encodeSearchCursor(), escapeLike(), SearchCursor, SearchQueryOptions (+38 more)

### Community 13 - "Site Search Index Engine"
Cohesion: 0.09
Nodes (41): resolveSsrContext(), SsrContext, createBlogPage(), fetchBlogPageById(), softDeleteBlogPage(), toView(), updateBlogPage(), validateNewsMediaReferencesForFullOnlineR2Mode() (+33 more)

### Community 14 - "Admin Page Imports"
Cohesion: 0.09
Nodes (47): CreateBlogPageValidationResult, SoftDeleteBlogPageInput, SoftDeleteBlogPageValidationResult, UpdateBlogPageValidationResult, validateCreateBlogPageInput(), validateFeaturedMediaId(), validateMenuOrder(), validateParentPageId() (+39 more)

### Community 15 - "Scheduled Job Entrypoints"
Cohesion: 0.09
Nodes (46): RFC-822, escapeXmlText(), absoluteUrl(), buildFeedPayload(), buildRobotsPayload(), buildSitemapIndexPayload(), buildSitemapPagePayload(), computeLastModified() (+38 more)

### Community 16 - "Password Reset Tokens & Delivery"
Cohesion: 0.06
Nodes (37): astro, RFC-5321, isSelfRegistrationEnabled(), enforceTurnstileIfRequired(), createEmailAuthNotificationAdapter(), PublicAuthTenantOptions, withPublicAuthTenant(), CompleteResetInput (+29 more)

### Community 17 - "Projection Directory & Reconciliation"
Cohesion: 0.08
Nodes (36): main(), buildSummaryView(), getProjectionSummaryForTenant(), listProjectionSummariesForTenant(), listRegisteredProjectionDescriptors(), ProjectionSummaryLookupResult, ProjectionSummaryView, getProjectionMetrics() (+28 more)

### Community 18 - "Internal Tag Link Rendering"
Cohesion: 0.07
Nodes (37): RFC-1035, RFC-2181, main(), TenantRow, ReconcileOutcome, reconcileServingRecords(), ReconcileSummary, resolveServingTarget() (+29 more)

### Community 19 - "Blog Page/Post Validation"
Cohesion: 0.07
Nodes (37): BlogSearchResourceType, BlogSearchResult, BlogSearchResultItem, BlogSearchRow, searchBlogContentAdmin(), SearchBlogContentAdminFilter, SearchPublicBlogContentFilter, toResultItem() (+29 more)

### Community 20 - "SEO Discovery Payloads"
Cohesion: 0.08
Nodes (38): AnnouncementPreviewResult, BoundedTargets, enqueueAnnouncement(), EnqueueAnnouncementResult, resolveAnnouncementTargets(), resolveBoundedAnnouncementTargets(), ResolvedRecipient, TargetRow (+30 more)

### Community 21 - "API Response & Keyset Pagination"
Cohesion: 0.07
Nodes (37): legacyAllowed(), SyncAuthFailure, SyncAuthSuccess, verifySyncHeaders(), NODE_STATUSES, Result, UpdateSyncNodeInput, validateUpdateSyncNodeInput() (+29 more)

### Community 22 - "Capacity Budget Config"
Cohesion: 0.07
Nodes (35): hashPassword(), getSetupDatabaseClient(), Bucket, buckets, checkRateLimit(), isTrustedProxyEnabled(), RateLimitConfig, RateLimitResult (+27 more)

### Community 23 - "Sidebar Menu Arrangement"
Cohesion: 0.07
Nodes (36): emitCapacityGauges(), CircuitBreaker, CircuitBreakerOptions, CircuitState, circuitStateRank(), createCircuitBreaker(), deriveProviderFamilyLabel(), getDatabaseCircuitBreaker() (+28 more)

### Community 24 - "Tenant Domain DNS Reconciliation"
Cohesion: 0.09
Nodes (34): buildSidebarEditorModel(), fetchRenderedSidebar(), fetchSidebarArrangement(), ItemRow, resetSidebarArrangement(), saveSidebarArrangement(), TypeRow, applySidebarOverrides() (+26 more)

### Community 25 - "ABAC Policy Admin Routes"
Cohesion: 0.11
Nodes (34): renderContentHtmlWithInternalTagLinks(), buildNewsArticleSeoMetadata(), NewsArticleSeoMetadata, NewsArticleSeoMetadataInput, ResolvedNewsArticlePreviewImage, resolveNewsArticlePreviewImage(), fetchPublicBlogPostBySlug(), fetchPublicPostTaxonomyTerms() (+26 more)

### Community 26 - "Redis Cache & Health"
Cohesion: 0.07
Nodes (32): listRoles(), createRole(), DeletedRoleView, DuplicateRoleCodeError, DuplicateRolePermissionError, fetchLiveRoleById(), grantPermissionToRole(), GrantResult (+24 more)

### Community 27 - "Content Ownership ABAC Policies"
Cohesion: 0.08
Nodes (32): DEPENDENCY_WARNING_CODES, fetchModuleMatrix(), ModuleMatrixRow, ModuleMatrixWarning, applyModulePreset(), currentTenantState(), listModulePresets(), ModulePresetApplyResult (+24 more)

### Community 28 - "Blog Page Directory"
Cohesion: 0.09
Nodes (38): fetchNewsMediaObjectsForReconciliation(), markNewsMediaObjectFailed(), markStaleOrphanedNewsMediaObjectDeleted(), objectKeyExistsForTenant(), purgeExpiredPendingNewsMediaObject(), cleanupExpiredPending(), cleanupOrphanInR2(), cleanupStaleOrphaned() (+30 more)

### Community 29 - "Comments Service"
Cohesion: 0.09
Nodes (36): RFC-1918, discoverOidcConfiguration(), DiscoverOidcResult, discoveryCache, discoveryFailureCache, exchangeAuthorizationCode(), ExchangeCodeParams, ExchangeCodeResult (+28 more)

### Community 30 - "safeErrorDetail"
Cohesion: 0.12
Nodes (35): config, failures, findings, safeErrorDetail, deleteRedisCache(), getRedisJson(), redisCacheAside(), RedisCacheAsideOptions (+27 more)

### Community 31 - "password-reset.ts"
Cohesion: 0.09
Nodes (34): generateResetToken(), hashResetToken(), openUrlParams(), resolveUrlParamKey(), sealUrlParams(), completePasswordReset(), CompletePasswordResetResult, INELIGIBLE (+26 more)

### Community 32 - "public-blog-directory.ts"
Cohesion: 0.13
Nodes (30): errorPage(), notFoundHtmlResponse(), serverErrorHtmlResponse(), ADR-0038, boundedPage(), fetchPublicBlogPostSummariesByIds(), fetchPublicBlogSettings(), fetchPublicTermBySlug() (+22 more)

### Community 33 - "media-library-port-adapter.ts"
Cohesion: 0.08
Nodes (29): ChecklistEvaluableContent, EvaluateContentQualityChecklistOptions, SocialPreviewFallbackOptions, ADR-0011, NewsMediaReferenceValidationError, NewsMediaReferenceValidationResult, violationMessage(), VideoNewsThumbnailReferenceValidationError (+21 more)

### Community 34 - "AWCMS Backend & Integration Hardening (skill)"
Cohesion: 0.07
Nodes (40): AWCMS Integration Hub Module (skill, read-only spec), Integration Hub Outbound Fanout Consumer, DB-Constraint Replay Protection (UNIQUE replay_key), Secret Reference Prefix Validation (INTEGRATION_HUB_), Two-Layer SSRF Guard with Manual-Redirect Re-Validation, Timing-Safe Signature Verification (timingSafeEqualHex), ADR-0006 Provider Optional & Outside DB Transaction, AWCMS Backend & Integration Hardening (skill) (+32 more)

### Community 35 - "redirect-safety.ts"
Cohesion: 0.08
Nodes (36): RFC-3986, RedirectRecord, makeOverlayLookup(), previewRedirectChainForInput(), RedirectSafetyOptions, RedirectSafetyResult, siblingInScope(), toHopRule() (+28 more)

### Community 36 - "registrations.astro"
Cohesion: 0.09
Nodes (29): ../lib/database/client, ../lib/database/tenant-context, ../lib/ui/admin-form-client, ../../modules/email/application/email-template-directory, ../../modules/email/domain/email-template-categories, ../../modules/identity-access/application/access-directory, ../../modules/identity-access/application/role-admin, ../../modules/identity-access/application/self-registration (+21 more)

### Community 37 - "tenant-sso-policy.ts"
Cohesion: 0.07
Nodes (32): computePkceChallengeS256(), parseOAuthStateParam(), RFC-7636, evaluateOAuthRequest(), IdTokenClaims, IdTokenDenyReason, IdTokenValidation, IdTokenValidationOptions (+24 more)

### Community 38 - "form-draft-directory.ts"
Cohesion: 0.10
Nodes (34): createFormDraft(), deleteFormDraft(), fetchActiveFormDraft(), FormDraftRow, FormDraftView, listFormDrafts(), ListFormDraftsFilter, submitFormDraft() (+26 more)

### Community 39 - "tenant-sso.ts"
Cohesion: 0.07
Nodes (30): buildOAuthStateParam(), autoLinkByEmailForProvider(), AutoLinkResult, BuildAuthorizationUrlResult, CompleteSsoOAuthResult, completeTenantSsoCallback(), consumeSsoOAuthRequest(), ConsumeSsoOAuthRequestResult (+22 more)

### Community 40 - "seo-facts-port.ts"
Cohesion: 0.08
Nodes (32): blogContentSeoFactsAdapter, BlogPostSeoRow, buildArticleJsonLd(), createBlogContentSeoFactsAdapter(), deriveVisibility(), robotsFor(), toFacts(), ADR-0028 (+24 more)

### Community 41 - "mailketing-provider.ts"
Cohesion: 0.09
Nodes (26): main(), EMAIL_MAILKETING_REQUIRED_WHEN_SELECTED, EMAIL_REQUIRED_WHEN_ENABLED, EmailProviderKind, isKnownEmailProvider(), KNOWN_EMAIL_PROVIDERS, resolveEmailSendTimeoutMs(), EmailAddress (+18 more)

### Community 42 - "dispatch-domain-events.ts"
Cohesion: 0.08
Nodes (28): classifyError(), NOT_RETRYABLE_SQLSTATE_CLASSES, RETRYABLE_SQLSTATE_CLASSES, RETRYABLE_SQLSTATES, RetryClassification, ADR-0006, ClaimedDeliveryRow, dispatchDomainEventsForTenant() (+20 more)

### Community 43 - "comment-service.ts"
Cohesion: 0.08
Nodes (34): CommentCursor, CommentRow, EditCommentResult, isDuplicate(), PublicCommentView, recordAbuseEvent(), submitComment(), SubmitCommentInput (+26 more)

### Community 44 - "security-readiness.ts"
Cohesion: 0.08
Nodes (35): ADR-0037, ADR-0039, ADR-0040, ADR-0041, ADR-0042, ALL_FOUR_PRIVILEGES, ALL_WRITE_PRIVILEGES, checkAbacDefaultDeny() (+27 more)

### Community 45 - "ADR-0041: comments module admission"
Cohesion: 0.08
Nodes (37): Inward contribution direction (DAG-safe aggregator), awcms_site_search_documents index projection, Search index is never an authorization source, SearchSourceDescriptor (descriptor-list contribution seam), ADR-0040: site_search module admission, ts_headline sentinel snippet escaping, :tenantCode URL template adaptation, commentableResources descriptor seam (+29 more)

### Community 46 - "homepage-section-policy.ts"
Cohesion: 0.10
Nodes (34): createHomepageSection(), fetchHomepageSectionById(), HomepageSectionRow, HomepageSectionView, listActiveHomepageSectionsForRendering(), listHomepageSections(), toView(), updateHomepageSection() (+26 more)

### Community 47 - "runJob()"
Cohesion: 0.28
Nodes (28): main(), main(), ADR-0011, ADR-0036, main(), ADR-0037, main(), main() (+20 more)

### Community 48 - "listModules()"
Cohesion: 0.10
Nodes (27): listModules(), fetchModuleJobs(), disableTenantModule(), enableTenantModule(), fetchTenantModuleEntries(), fetchTenantModuleRows(), findDescriptor(), resolveTenantState() (+19 more)

### Community 49 - "export-generation.ts"
Cohesion: 0.09
Nodes (31): GenerateExportInput, generateProjectionExport(), resolveExportRootPath(), resolveRetentionDays(), ADR-0006, ExportRunDbRow, ExportRunFormat, ExportRunRow (+23 more)

### Community 50 - "visitor-analytics-domain.test.ts"
Cohesion: 0.09
Nodes (27): ANALYTICS_AREA_FILTERS, ANALYTICS_VISITOR_TYPE_FILTERS, AnalyticsAreaFilter, AnalyticsVisitorTypeFilter, buildSessionRowCells(), displayOrPlaceholder(), isNamedCountListEmpty(), isSummaryEmpty() (+19 more)

### Community 51 - "src/modules/index.ts"
Cohesion: 0.08
Nodes (25): ADR-0006, ADR-0028, commentsModule, ADR-0041, FORM_DRAFT_PERMISSIONS, FormDraftPermission, formDraftsModule, ADR-0037 (+17 more)

### Community 52 - "serveDiscovery()"
Cohesion: 0.10
Nodes (25): RFC-7232, EnabledSeoProviders, resolveEnabledSeoProviders(), ADR-0038, DiscoveryBuilder, DiscoveryFallbacks, finalizeDiscoveryResponse(), parseDiscoveryLocaleParam() (+17 more)

### Community 53 - "module-composition.ts"
Cohesion: 0.11
Nodes (26): runModuleCompositionInventoryCheck(), ADR-0025, buildModuleCompositionInventoryJson(), main(), ADR-0034, listBaseModules(), validateJobDescriptor(), buildComposedModuleInventory() (+18 more)

### Community 54 - "login.ts"
Cohesion: 0.10
Nodes (31): generateChallengeToken(), hashChallengeToken(), resolveChallengeTtlSec(), generateSessionToken(), resolveLoginDenyResponse(), verifyPasswordOrDummy(), createEnrollmentGrant(), createMfaChallenge() (+23 more)

### Community 55 - "step-up.ts"
Cohesion: 0.13
Nodes (28): resolveMfaRateLimitMax(), resolveMfaRateLimitWindowSec(), resolveStepUpTtlSec(), LogEntry, setLogSink(), hashClientIp(), PLACEHOLDER_SECRETS, resetClientFingerprintKeyForTests() (+20 more)

### Community 56 - "public-host-tenant-resolver.ts"
Cohesion: 0.09
Nodes (28): defaultDeps, extractHostHeader(), fetchActivePublicTenantById(), isValidHostnameShape(), PublicHostResolverConfig, PublicHostResolverDeps, PublicTenantResolutionMode, resolveDefaultPublicTenantFromEnv() (+20 more)

### Community 57 - "blog-term-validation.ts"
Cohesion: 0.10
Nodes (28): BlogTermRow, BlogTermView, createBlogTerm(), fetchBlogTermById(), fetchBlogTermsByTaxonomyType(), listBlogTerms(), ListBlogTermsFilter, toView() (+20 more)

### Community 58 - "internal-tag-link-rendering.ts"
Cohesion: 0.10
Nodes (29): buildTagArchiveUrl(), InternalTagLinkingContext, InternalTagLinkingDisabledReason, InternalTagLinkingPreview, previewInternalTagLinksForContent(), resolveInternalTagLinkingContext(), applyInternalTagLinksToHtml(), buildTermPattern() (+21 more)

### Community 59 - "media-object-directory.ts"
Cohesion: 0.08
Nodes (32): defaultR2ClientFactory(), FinalizeNewsMediaUploadSessionDeps, FinalizeNewsMediaUploadSessionInput, PrecheckResult, ADR-0006, VERIFY_GUARD, attachNewsMediaObject(), AttachNewsMediaObjectInput (+24 more)

### Community 60 - "url-change-capture.ts"
Cohesion: 0.09
Nodes (30): createRedirect(), fetchRedirectSettings(), RedirectSettingsAuditHook, SettingsRow, toSettings(), ADR-0039, updateRedirectSettings(), captureUrlChangeRedirect() (+22 more)

### Community 61 - "object-dispatch.ts"
Cohesion: 0.09
Nodes (25): main(), TenantRow, getProviderCircuitBreaker(), TimeoutError, withTimeout(), ClaimedRow, claimEligibleEntries(), dispatchObjectSyncQueue() (+17 more)

### Community 62 - "workflow-definition-directory.ts"
Cohesion: 0.11
Nodes (31): assertUuid(), createNewDraftVersion(), createWorkflowDefinition(), CreateWorkflowDefinitionParams, fetchDefinitionForUpdate(), getWorkflowDefinitionById(), InvalidWorkflowGraphError, listWorkflowDefinitions() (+23 more)

### Community 63 - "self-registration.integration.test.ts"
Cohesion: 0.09
Nodes (28): ADR-0011, ApproveRegistrationOptions, approveRegistrationRequest(), ApproveRegistrationResult, listPendingRegistrations(), maskAddress(), rejectRegistrationRequest(), RejectRegistrationResult (+20 more)

### Community 64 - "sod-exception-service.ts"
Cohesion: 0.10
Nodes (31): approveSoDConflictException(), createSoDConflictException(), CreateSoDConflictExceptionResult, DecideSoDConflictExceptionResult, findValidSoDConflictException(), findValidSoDConflictExceptionsByRuleKeys(), listSoDConflictExceptions(), ListSoDConflictExceptionsFilter (+23 more)

### Community 65 - "theming.integration.test.ts"
Cohesion: 0.12
Nodes (29): EMPTY_THEME_TENANT_STATE, fetchDraftVersion(), insertPublishedVersion(), listPublishedVersionIds(), listPublishedVersions(), nextPublishedVersionNumber(), setActiveThemeVersion(), setDraftThemeKey() (+21 more)

### Community 66 - "media-library/module.ts"
Cohesion: 0.08
Nodes (23): ADR-0026, blogContentModule, ADR-0009, ADR-0036, ADR-0038, ADR-0040, ADR-0041, MEDIA_ENFORCEMENT_PERMISSIONS (+15 more)

### Community 67 - "audit-log-purge.ts"
Cohesion: 0.10
Nodes (26): AuditLogPurgeOptions, AuditLogPurgeResult, resolveRetentionDays(), runAuditLogPurge(), runVisitorAnalyticsPurge(), legalHoldGuardPortAdapter, countPurgeableAuditEvents(), PurgeAuditEventsOptions (+18 more)

### Community 68 - "blog-content-presentation-domain.test.ts"
Cohesion: 0.10
Nodes (28): BlogTemplateRow, BlogTemplateView, createTemplate(), fetchTemplateById(), listTemplates(), toView(), updateTemplate(), BlogThemeSettings (+20 more)

### Community 69 - "workflow-instance-decision.ts"
Cohesion: 0.09
Nodes (27): DueTaskRow, escalateDueTasksForTenant(), EscalateDueTasksResult, AssignmentRow, completeApprovalTaskAndAdvance(), CompleteApprovalTaskParams, DelegationDbRow, findEligibleAssignment() (+19 more)

### Community 70 - "tenant-route.ts"
Cohesion: 0.08
Nodes (19): boundAuditSummaryLimit(), fetchModuleAuditSummary(), ModuleAuditSummaryEntry, RELEVANT_RESOURCE_TYPES, AuthorizedAccess, defineTenantRoute(), TenantRouteConfig, TenantRouteHandlerContext (+11 more)

### Community 71 - "Arsitektur AWCMS (ARCHITECTURE.md)"
Cohesion: 0.09
Nodes (31): Changeset: sync docs, agent skills, and knowledge graph post-Wave 2, graphify-out incremental update (8159 nodes, 21470 edges), Stale skill warning hazard (agents rebuild what already exists), ADR-0035 online-first ERP/SaaS superset repositioning, ADR-0036 media-library ownership inversion, Arsitektur AWCMS (ARCHITECTURE.md), AsyncAPI domain-event channels, blog-content module (+23 more)

### Community 72 - "ADR-0033 Dynamic ABAC Policy Evaluator"
Cohesion: 0.08
Nodes (31): ADR-0022 ERP Modules Live in Extension Repos, ADR-0024 SemVer Continues Legacy Major Line (5.0.0), ADR-0025 Deterministic Build-time Module Composition, Module composition seam (mergeModuleRegistries/composeModuleRegistry), ModuleDescriptor contract, ADR-0026 Modular OpenAPI Ownership and Composition, Deterministic OpenAPI fragment bundler, ADR-0030 Business-scope Hierarchy Generic Authorization Layer (+23 more)

### Community 73 - "email-template-directory.ts"
Cohesion: 0.11
Nodes (26): main(), readArg(), logScriptFailure(), createEmailTemplate(), EmailTemplateRow, EmailTemplateView, listEmailTemplates(), ListEmailTemplatesFilter (+18 more)

### Community 74 - "auth-provider-directory.ts"
Cohesion: 0.14
Nodes (24): sanitizeReturnTo(), isSsoEnabled(), resolveSsoMaxProvidersPerTenant(), resolveSsoOAuthRequestTtlSec(), SSO_REQUIRED_WHEN_ENABLED, encryptSsoClientSecret(), resolveSsoEncryptionKey(), AuthProviderRow (+16 more)

### Community 75 - "recordCounter()"
Cohesion: 0.12
Nodes (26): decorateWithMetrics(), emitJobRunMetrics(), filterLabels(), recordCounter(), recordGauge(), recordHistogram(), reportAdapterError(), bulkModerateComments() (+18 more)

### Community 76 - "metrics-port.ts"
Cohesion: 0.10
Nodes (19): CounterOrGaugeSeries, HistogramSeries, PrometheusTextMetricsPort, createInMemoryMetricsPort(), InMemoryHistogramSnapshot, InMemoryMetricsPort, InMemoryMetricsSnapshot, createNoopMetricsPort() (+11 more)

### Community 77 - "turnstile.ts"
Cohesion: 0.09
Nodes (25): EnforceTurnstileOptions, isFreshChallenge(), readCappedText(), redact(), redactTruncate(), resolvePositiveIntEnv(), resolveTurnstileConfig(), resolveTurnstileMaxResponseBytes() (+17 more)

### Community 78 - "report.ts"
Cohesion: 0.13
Nodes (25): ResolvedAuthor, resolveOptionalRegisteredAuthor(), ADR-0041, editCommentWithinWindow(), isBoundAuthor(), reportComment(), ReportReason, requestCommentDeletion() (+17 more)

### Community 79 - "media-r2-config.ts"
Cohesion: 0.14
Nodes (27): evaluateManagedMediaReadiness(), ManagedMediaReadinessResult, ADR-0036, allowsSvgMimeType(), findMissingNewsMediaR2Vars(), findNewsMediaR2PublicBaseUrlProductionUnsafeReason(), findNewsMediaR2SeparationViolations(), findUnknownNewsMediaR2MimeTypes() (+19 more)

### Community 80 - "theme-config.ts"
Cohesion: 0.13
Nodes (26): assertSafeCssPrimitive(), CssValueError, DIMENSION_UNIT_ALLOW_LIST, DimensionConstraint, FORBIDDEN_CSS_SUBSTRINGS, hasBalancedParens(), hasBalancedQuotes(), NAMED_COLOR_ALLOW_LIST (+18 more)

### Community 81 - "abac-admin.ts"
Cohesion: 0.10
Nodes (25): AbacPolicyRow, createPolicy(), DuplicatePolicyCodeError, fetchPolicyById(), setPolicyActive(), toView(), ADR-0033, updatePolicy() (+17 more)

### Community 82 - "abac-policy.ts"
Cohesion: 0.10
Nodes (28): ABAC_ATTRIBUTES, AbacAllOfNode, AbacAnyOfNode, AbacAttributeSpec, AbacNotNode, AbacParseFailure, AbacParseResult, AbacParseSuccess (+20 more)

### Community 83 - "access-control.ts"
Cohesion: 0.09
Nodes (24): AbacEvaluationInput, AccessAction, BusinessScopeFact, BusinessScopeReference, BusinessScopeRelation, evaluateAccess(), HIGH_RISK_ACTIONS, isHighRiskAction() (+16 more)

### Community 84 - "ERP domain modules (finance/inventory/procurement/HR)"
Cohesion: 0.07
Nodes (29): ADR-0039 — SEO Distribution Redirect Governance, Privacy-Minimized 404 Observation Telemetry, ADR-0038 — SEO Distribution Discovery Scope, Fail-Open Public Redirect Middleware Hook (src/middleware.ts), Frozen Open-Redirect Guard (redirect-target-classification.ts), Base reusable modules, AWCMS design principles, AWCMS modular monolith architecture (+21 more)

### Community 85 - "fetchActiveTenants()"
Cohesion: 0.13
Nodes (24): DomainEventsDispatchOptions, DomainEventsDispatchRunResult, runDomainEventsDispatch(), runWorkflowEscalationsDispatch(), WorkflowEscalationsDispatchOptions, WorkflowEscalationsDispatchRunResult, BatchPassResult, BoundedBatchOptions (+16 more)

### Community 86 - "ads-directory.ts"
Cohesion: 0.10
Nodes (26): ActiveAdForPlacement, ActiveAdRow, BlogAdPlacementRow, BlogAdPlacementView, BlogAdRow, BlogAdView, createAd(), fetchAdById() (+18 more)

### Community 87 - "append-domain-event.ts"
Cohesion: 0.11
Nodes (20): AppendDomainEventInput, AppendDomainEventResult, DomainEventRow, InvalidDomainEventPayloadError, ADR-0006, UnregisteredDomainEventTypeError, collectCredentialShapedKeys(), CREDENTIAL_KEY_SUBSTRINGS (+12 more)

### Community 88 - "ModuleDescriptor"
Cohesion: 0.13
Nodes (21): DescriptorSyncResult, fetchExistingModules(), findDuplicateDescriptorKeys(), markOrphaned(), ModuleRegistryInvalidError, replaceDependencies(), replaceJobs(), replaceNavigation() (+13 more)

### Community 89 - "redirects/[id].ts"
Cohesion: 0.10
Nodes (25): dismissNotFoundObservation(), getRedirectById(), SeoConfigAction, SeoNotFoundAction, SeoRedirectAction, ADR-0028, ADR-0038, ADR-0039 (+17 more)

### Community 90 - "family-conformance-check.ts"
Cohesion: 0.11
Nodes (27): ADR_DIR, assertEvidenceReportSecretFree(), ASYNCAPI_PATH, buildEvidenceReport(), CI_YML_PATH, collectFamilyConformanceChecks(), EvidenceCheck, EvidenceReport (+19 more)

### Community 91 - "application/login-policy.ts"
Cohesion: 0.11
Nodes (21): verifyPassword(), LoginDenyResponse, LoginPolicyConfig, parsePositiveIntEnv(), resetLoginPolicyEnvWarningsForTests(), warnedEnvValues, warnOnce(), computeLockedUntil() (+13 more)

### Community 92 - "business-scope.integration.test.ts"
Cohesion: 0.11
Nodes (19): resolveScopeGuarded(), defaultBusinessScopeHierarchyPortAdapter, ADR-0011, UNRESOLVED, BusinessScopeHierarchyPort, BusinessScopeReference, BusinessScopeResolution, ADR-0011 (+11 more)

### Community 93 - "properties"
Cohesion: 0.07
Nodes (27): minLength, type, minLength, type, minLength, type, additionalProperties, type (+19 more)

### Community 94 - "application/email-dispatch.ts"
Cohesion: 0.13
Nodes (21): main(), TenantRow, ClaimedRow, claimEligibleEntries(), createTemplateLoader(), dispatchEmailQueue(), DispatchEmailQueueOptions, DispatchEmailQueueResult (+13 more)

### Community 95 - "comment-moderation.ts"
Cohesion: 0.11
Nodes (21): BulkModerateResult, listModerationQueue(), ModerateResult, ModerationAuditHook, ModerationCursor, ModerationQueueItem, QUEUE_STATUSES, QueueRow (+13 more)

### Community 96 - "archive-purge-job.ts"
Cohesion: 0.13
Nodes (25): assertSafeIdentifier(), computeCutoff(), DataLifecycleArchivePurgeResult, RunArchivePurgeOptions, runDataLifecycleArchivePurge(), runGenericArchivePass(), runGenericPurgePass(), toDate() (+17 more)

### Community 97 - "legal-hold-service.ts"
Cohesion: 0.13
Nodes (23): ADR-0011, ADR-0037, createLegalHold(), CreateLegalHoldResult, LegalHoldDbRow, LegalHoldRow, listLegalHolds(), ListLegalHoldsFilter (+15 more)

### Community 98 - "workflow-graph.ts"
Cohesion: 0.13
Nodes (26): CONDITION_OPERATORS, ConditionOperator, detectCycle(), EndNode, FactsSchemaValidationResult, FactType, GraphValidationError, GraphValidationResult (+18 more)

### Community 99 - "createPersonProfileForIdentity (application/person-profile.ts)"
Cohesion: 0.10
Nodes (26): createPersonProfileForIdentity (single writer for awcms_profiles), Ownership derived, not declared, excusedOwner exception shape, modules:table-writes:check gate, ADR-0013 §6 no shared-table write, tenant_admin platform-bootstrap.ts (one-shot setup wizard), tests/module-boundary.test.ts extended to src/pages, ADR-0034 family direct-use templates, derived pathway removed (+18 more)

### Community 100 - "redirect-resolution-service.ts"
Cohesion: 0.14
Nodes (23): ADR-0010, normalizePublicHost(), findActiveRedirectByPath(), incrementRedirectHit(), isSeoDistributionEnabled(), NotFoundCaptureContext, RedirectResolution, resolveHostBasedRedirect() (+15 more)

### Community 101 - "withTenant / SET LOCAL RLS context"
Cohesion: 0.08
Nodes (26): Hybrid online-first operating mode, Sync Storage module, ERD & data dictionary, RLS tenant-isolation standard, Soft delete standard, Production readiness checklist & go-live gates, Sequential migration order & numbering, Bun-only backend platform standard (+18 more)

### Community 102 - "register.astro"
Cohesion: 0.14
Nodes (21): ../lib/auth/self-registration-config, ../lib/security/secure-url-params, ../lib/security/turnstile, ../modules/identity-access/domain/password-reset-validation, ../modules/tenant-admin/application/tenant-picker-directory, ../styles/auth.css, ../styles/motion.css, ../styles/tokens.css (+13 more)

### Community 103 - "sod-rule-registry.ts"
Cohesion: 0.11
Nodes (18): main(), BundleConflictError, collectSoDRuleDescriptors(), formatSoDRuleRegistryIssue(), SoDRuleRegistryIssue, SoDRuleRegistryValidationResult, ADR-0037, VALID_SCOPE_APPLICABILITIES (+10 more)

### Community 104 - "public-search-tenant-resolution.ts"
Cohesion: 0.14
Nodes (22): buildPublicHostResolverConfigFromEnv(), checkSiteSearchGate(), padUnresolvedSearchTenantLatency(), SiteSearchTenantHandler, ADR-0040, fetchSiteSearchSettings(), SettingsRow, SiteSearchSettingsAuditHook (+14 more)

### Community 105 - "collect.ts"
Cohesion: 0.12
Nodes (20): extractSingleTrustedHeaderValue(), resolveAnalyticsClientIp(), EMPTY_GEO, GeoEnrichment, normalizeCountryCode(), resolveGeoEnrichment(), fileExtension(), isTrackablePath() (+12 more)

### Community 106 - "workflow-instance.ts"
Cohesion: 0.12
Nodes (21): activateNode(), ActivateNodeDeps, ActivateNodeOutcome, createApprovalTask(), factsToVariables(), QueueEntry, ActiveDefinitionRow, InvalidWorkflowFactsError (+13 more)

### Community 107 - "capacity-config.ts"
Cohesion: 0.12
Nodes (22): CapacityBudgetReport, CapacityConfig, CapacityFinding, CapacityFindingSeverity, CapacityScenario, CapacityUsage, computeCapacityUsage(), DEFAULT_INSTANCE_COUNTS (+14 more)

### Community 108 - "escapeHtml()"
Cohesion: 0.17
Nodes (21): escapeHtml(), ADR-0038, ContentBlock, EMPTY_RESOLVED_MEDIA_URLS, GalleryItem, isRecord(), renderBlock(), renderHeading() (+13 more)

### Community 109 - "post-status.ts"
Cohesion: 0.14
Nodes (21): BlogSettingsRow, BlogSettingsView, sanitizeChecklistPolicyOverrides(), sanitizeSocialPreviewFallbackImageMediaId(), toView(), upsertBlogSettings(), UpdateBlogSettingsInput, UpdateBlogSettingsValidationResult (+13 more)

### Community 110 - "party-directory.ts"
Cohesion: 0.11
Nodes (21): listParties(), ListPartiesOptions, ListPartiesResult, PartyRow, toRecord(), CreatePartyInput, PARTY_RISK_LEVELS, PARTY_SETTABLE_STATUSES (+13 more)

### Community 111 - "theme-descriptor.ts"
Cohesion: 0.08
Nodes (23): assertSubset(), InvalidThemeDescriptorError, THEME_ALLOWED_EXTERNAL_FRAME_SOURCES, THEME_ALLOWED_EXTERNAL_SCRIPT_SOURCES, THEME_ALLOWED_EXTERNAL_STYLE_SOURCES, ThemeAccessibilityDeclaration, ThemeAssetSlotKind, ThemeAssetSlotSpec (+15 more)

### Community 112 - "package.json"
Cohesion: 0.08
Nodes (21): @astrojs/node, author, bugs, url, dependencies, astro, @astrojs/node, description (+13 more)

### Community 113 - "edge-cache/config.ts"
Cohesion: 0.11
Nodes (17): ADR-0002, DEFAULTS, EdgeCacheEnvironment, EdgeCacheMode, EdgeCacheValidationFinding, loadEdgeCacheConfig(), MODES, readBoundedInt() (+9 more)

### Community 114 - "presentation/theme-preview.ts"
Cohesion: 0.11
Nodes (16): ../../../layouts/PublicThemeLayout.astro, ../../../modules/theming/application/theme-preview-render, ../../../modules/theming/presentation/theme-preview, ResolvedThemeAsset, resolveThemeAssetUrls(), ADR-0029, ADR-0034, ADR-0036 (+8 more)

### Community 115 - "commentable-resource-registry.ts"
Cohesion: 0.14
Nodes (21): main(), ADR-0041, buildCommentableResourceUrl(), findDescriptorByResourceType(), resolvePublishedCommentableResource(), ADR-0009, ADR-0013, ADR-0041 (+13 more)

### Community 116 - "family-conformance.test.ts"
Cohesion: 0.14
Nodes (18): AppliedMigration, computeMigrationChecksum(), discoverMigrationFiles(), getDatabaseUrl(), main(), maskUrlPassword(), MigrationFile, MigrationResult (+10 more)

### Community 117 - "surrogate-keys.ts"
Cohesion: 0.14
Nodes (19): main(), TenantRow, ADR-0042, ADR-0042, claimEdgeCachePurges(), EdgeCachePurgeRow, enqueueEdgeCachePurge(), markEdgeCachePurgeDone() (+11 more)

### Community 118 - "docs-checks.mjs"
Cohesion: 0.17
Nodes (20): AUTHORITATIVE_SCRIPT_DOC_FILES, checkComposeServiceNames(), checkKnownScripts(), checkMermaid(), checkNaming(), checkSqlMigrationReferences(), classifyLink(), COMPOSE_BOOLEAN_FLAG_OVERRIDES (+12 more)

### Community 119 - "media-r2-verification.ts"
Cohesion: 0.11
Nodes (18): NewsMediaR2VerificationRejectionReason, NewsMediaR2VerificationResult, ADR-0006, verifyNewsMediaR2Object(), VerifyNewsMediaR2ObjectInput, decideNewsMediaFinalizeOutcome(), NewsMediaFinalizeDecision, NewsMediaFinalizeDecisionInput (+10 more)

### Community 120 - "media-r2-client.ts"
Cohesion: 0.11
Nodes (18): NewsMediaR2ClientConfig, NewsMediaR2DeleteResult, NewsMediaR2GetResult, NewsMediaR2HeadResult, NewsMediaR2ListObjectsInput, NewsMediaR2ListObjectsResult, NewsMediaR2ObjectSummary, NewsMediaR2PresignUploadInput (+10 more)

### Community 121 - "seo-distribution.integration.test.ts"
Cohesion: 0.12
Nodes (19): fetchSeoSettingsUpdatedAt(), fetchSeoTenantSettings(), SeoConfigAuditHook, SeoSettingsRow, toSettings(), ADR-0038, updateSeoTenantSettings(), SeoDiscoveryContext (+11 more)

### Community 122 - "redirect-rule.ts"
Cohesion: 0.18
Nodes (23): normalizeRedirectPath(), ALLOWED_REDIRECT_ORIGINS, ALLOWED_REDIRECT_STATES, ALLOWED_REDIRECT_STATUS_CODES, isPlainObject(), normalizeOptionalString(), RedirectCreateValidationResult, RedirectUpdateValidationResult (+15 more)

### Community 123 - "office-directory.ts"
Cohesion: 0.13
Nodes (13): createOffice(), DuplicateOfficeCodeError, fetchOfficeById(), listDeletedOffices(), listOffices(), OfficeListPage, OfficeRecord, OfficeRow (+5 more)

### Community 124 - "module-management OpenAPI fragment"
Cohesion: 0.10
Nodes (23): submitFormDraft, applyTenantModulePreset, checkModuleHealth, disableTenantModule, enableTenantModule, module-management OpenAPI fragment, getModuleAuditSummary, getTenantModuleMatrix (+15 more)

### Community 125 - "compilerOptions"
Cohesion: 0.09
Nodes (22): astro/tsconfigs/strict, .astro/types.d.ts, dist, ES2024, node_modules, scripts/**/*, src/**/*, tests/**/* (+14 more)

### Community 126 - "collector.ts"
Cohesion: 0.13
Nodes (17): onRequest, ADR-0039, ADR-0042, buildRedirectResponse(), isPermanent(), MiddlewareRedirectResult, recordPublicNotFound(), resolvePublicRedirectForRequest() (+9 more)

### Community 127 - "menu-directory.ts"
Cohesion: 0.12
Nodes (20): BlogMenuItemRow, BlogMenuItemView, BlogMenuRow, BlogMenuView, createMenu(), fetchMenuById(), listMenus(), toMenuView() (+12 more)

### Community 128 - "email-template-render.ts"
Cohesion: 0.16
Nodes (18): previewAnnouncement(), BASE_CATEGORY_ALLOWLISTS, BASE_EMAIL_TEMPLATE_CATEGORIES, derivedCategoryAllowlists, getAllowedVariablesForCategory(), isKnownEmailTemplateCategory(), registerDerivedEmailTemplateCategory(), resetDerivedEmailTemplateCategoriesForTests() (+10 more)

### Community 129 - "abac-policy-evaluator.integration.test.ts"
Cohesion: 0.18
Nodes (19): Bootstrap, createPolicy(), evaluate(), headers(), seedUserWithPermissions(), setActive(), TARGET, createCookieJar() (+11 more)

### Community 130 - "ADR-0003 PostgreSQL + RLS multi-tenant isolation"
Cohesion: 0.11
Nodes (22): ADR-0001 Rebuild AWCMS as ERP modular-monolith platform, ADR-0002 Bun-only runtime & tooling, ADR-0003 PostgreSQL + RLS multi-tenant isolation, SECURITY DEFINER bootstrap-read checklist (ADR-0003), ADR-0004 RBAC + ABAC default-deny baseline, ADR-0005 Soft delete for master/config, immutability for posted data, ADR-0006 Offline-first + transactional outbox + sync HMAC, ADR-0007 OpenAPI & AsyncAPI as mandatory contracts (+14 more)

### Community 131 - "AdminLayout.astro"
Cohesion: 0.10
Nodes (19): ../components/LocaleBadge.astro, ../components/SyncIndicator.astro, ../components/TenantBadge.astro, ../components/ThemeToggle.astro, ../../lib/logging/error-log, ../lib/security/theme-init-script, ../modules, ../modules/module-management/application/sidebar-menu-config (+11 more)

### Community 132 - "edge-cache.test.ts"
Cohesion: 0.15
Nodes (18): buildScopesForSurface(), CacheabilityInput, CACHEABLE_METHODS, CACHEABLE_STATUSES, CacheDecision, CacheSkipReason, decideCacheability(), declaresUncacheable() (+10 more)

### Community 133 - "blog-post-directory.ts"
Cohesion: 0.13
Nodes (20): BlogPostAdminListRow, BlogPostRow, BlogPostSummary, BlogPostSummaryRow, BlogPostView, createBlogPost(), FetchBlogPostOptions, listBlogPosts() (+12 more)

### Community 134 - "widget-policy.ts"
Cohesion: 0.16
Nodes (20): BlogWidgetRow, BlogWidgetView, createWidget(), fetchWidgetById(), listWidgets(), ListWidgetsFilter, toView(), updateWidget() (+12 more)

### Community 135 - "comment-settings.ts"
Cohesion: 0.16
Nodes (19): CommentSettingsAuditHook, fetchCommentSettings(), SettingsRow, toSettings(), ADR-0041, updateCommentSettings(), boundedInt(), CommentSettings (+11 more)

### Community 136 - "business-scope-assignment-service.ts"
Cohesion: 0.16
Nodes (18): BusinessScopeAssignmentDbRow, BusinessScopeAssignmentRow, createBusinessScopeAssignment(), CreateBusinessScopeAssignmentResult, listBusinessScopeAssignments(), ListBusinessScopeAssignmentsFilter, revokeBusinessScopeAssignment(), RevokeBusinessScopeAssignmentResult (+10 more)

### Community 137 - "abac-evaluator.ts"
Cohesion: 0.13
Nodes (21): AbacPass, booleanOrAbsent(), buildAttributeBag(), evaluateLeaf(), lookup(), numberOrAbsent(), OPERATOR_SET, orderedCompare() (+13 more)

### Community 138 - "Varnish edge-cache infrastructure layer (ADR-0042)"
Cohesion: 0.10
Nodes (21): src/lib boundary + module-boundary gate over src/pages (ADR-0043), GET /api/v1/tenant/modules/matrix + per-module audit summary, Tenant module presets (minimal/website/news_portal/back_office), ModuleApiContract.routes + modules:routes:check (longest-prefix ownership), defineTenantRoute + api:tenant-route:check (shrink-only NOT_YET_MIGRATED), work-class registry generator + freshness gate (ghost .generated artifact), Rule 21: enqueueModuleContentPurge inside the content transaction, PaaS superuser makes FORCE RLS inert (staging 2026-07-25) (+13 more)

### Community 139 - "properties"
Cohesion: 0.10
Nodes (21): pattern, type, properties, pattern, type, minLength, type, adr (+13 more)

### Community 140 - "local-archive-adapter.ts"
Cohesion: 0.12
Nodes (16): RFC-4180, ArchivePortKind, ArchiveWriteInput, ArchiveWriteResult, ADR-0006, ADR-0011, ADR-0013, ADR-0037 (+8 more)

### Community 141 - "identity-access OpenAPI fragment"
Cohesion: 0.10
Nodes (21): AbacDslPolicyConditions schema, accessCreateAbacPolicy, accessEvaluate, accessSimulateAbacPolicy, approveRegistrationRequest, approveSoDConflictException, createBusinessScopeAssignment, identity-access OpenAPI fragment (+13 more)

### Community 142 - "runtime.ts"
Cohesion: 0.15
Nodes (17): EdgeCacheConfig, isEdgeCacheActive(), createPressureTracker(), Observation, PressureSample, PressureTracker, ADR-0042, annotateEdgeCache() (+9 more)

### Community 143 - "[tenantCode]/feed.xml.ts"
Cohesion: 0.24
Nodes (16): notFoundXmlResponse(), serverErrorXmlResponse(), resolvePublicTenantByCode(), TenantRow, ADR-0003, ADR-0009, searchPublicBlogContent(), fetchBlogSettings() (+8 more)

### Community 144 - "domain-event-directory.ts"
Cohesion: 0.13
Nodes (16): DeliveryNotDeadLetteredError, replayDomainEventDelivery(), ReplaySchemaIncompatibleError, UnknownReplayConsumerError, DomainEventDeliveryRow, DomainEventDeliveryView, DomainEventRow, DomainEventView (+8 more)

### Community 145 - "ad-placement-directory.ts"
Cohesion: 0.15
Nodes (16): ActiveAdPlacementForRendering, ActiveAdPlacementRow, AdPlacementRow, AdPlacementView, listActiveAdPlacementsForRendering(), renderAdPlacementHtml(), selectAndRenderActiveAdsForPlacement(), AdRotationMode (+8 more)

### Community 146 - "production:preflight read-only preflight"
Cohesion: 0.12
Nodes (20): Authorized dependency-health endpoint, Mandatory shared instrumentation points, METRIC_DEFINITIONS registry (cardinality/privacy), MetricsPort observability contract, deriveProviderFamilyLabel cardinality bounding, SLI/SLO and burn-rate guidance, Deterministic seeded fixtures (mulberry32), Query-plan regression budgets (+12 more)

### Community 147 - "work-class-registry-generate.ts"
Cohesion: 0.19
Nodes (16): bun, main(), buildSnapshot(), classifyRoute(), codeOnly(), compareJobRegistry(), JobDiscrepancy, JobEntry (+8 more)

### Community 148 - "runSecurityReadinessChecks()"
Cohesion: 0.16
Nodes (17): checkAppDbUserNotSuperuser(), checkAuditLogTableReachable(), checkCommentsSecretsConfigured(), checkDataLifecycleLegalHoldReleaseSeparate(), checkDataLifecycleRegistryValid(), checkEdgeCacheConfigured(), checkEnvNotTracked(), checkLeastPrivilegeRoleProvisioned() (+9 more)

### Community 149 - "workflow-recovery.ts"
Cohesion: 0.12
Nodes (16): appendDomainEvent(), createWorkflowDelegation(), CreateWorkflowDelegationParams, revokeWorkflowDelegation(), RevokeWorkflowDelegationParams, WorkflowDelegationForbiddenError, WorkflowDelegationNotFoundError, WorkflowDelegationRow (+8 more)

### Community 150 - "user-admin.ts"
Cohesion: 0.11
Nodes (14): AssignmentInput, AssignmentRecord, AssignmentTargetNotFoundError, DuplicateAssignmentError, SetStatusInput, SetStatusResult, SystemRoleAssignmentError, TENANT_USER_STATUSES (+6 more)

### Community 151 - "seo-metadata-service.ts"
Cohesion: 0.18
Nodes (18): renderResourceSeoHead(), resolveImages(), SeoResourceRenderInput, SeoResourceRenderResult, ADR-0038, ResolvedSeoImage, SeoDocument, metaName() (+10 more)

### Community 152 - "provideTenant()"
Cohesion: 0.15
Nodes (10): seeded, seeded, seeded, seeded, seeded, seeded, seeded, seeded (+2 more)

### Community 153 - "family-contract.ts"
Cohesion: 0.15
Nodes (18): ADR-0001, checkStackEntry(), FAMILY_OWNED_CONTRACT_VERSIONS, FamilyCompatibilityManifest, FamilyContracts, FamilyOwnedContractKey, FamilyStack, IntentionalDivergence (+10 more)

### Community 154 - "capability-contract-versions.ts"
Cohesion: 0.12
Nodes (14): ADR-0008, ADR-0015, seoDistributionModule, ADR-0028, ADR-0035, ADR-0038, ADR-0039, CAPABILITY_CONTRACT_VERSIONS (+6 more)

### Community 155 - "module-boundary.test.ts"
Cohesion: 0.20
Nodes (16): collectClaims(), main(), OVERBROAD_PREFIXES, PLATFORM_ROUTES, resolveOwner(), routeOf(), RouteOwnership, walk() (+8 more)

### Community 156 - "content-quality-checklist.ts"
Cohesion: 0.15
Nodes (16): ChecklistRuleId, ChecklistRuleOutcome, ChecklistSeverity, classifyRawImageUrl(), ContentQualityChecklistInput, evaluateContentQualityChecklist(), NOT_APPLICABLE, notApplicableChecklistResult() (+8 more)

### Community 157 - "comments-domain.test.ts"
Cohesion: 0.17
Nodes (15): listApprovedComments(), CommentBodyRejectionReason, countLinks(), escapeCommentHtml(), isSafeLinkUrl(), normalizeCommentBody(), NormalizeCommentResult, renderCommentHtml() (+7 more)

### Community 158 - "dry-run-planner.ts"
Cohesion: 0.16
Nodes (13): assertSafeIdentifier(), clampRetentionDays(), LifecycleDryRunOutcome, LifecycleDryRunResult, planLifecycleDryRun(), planLifecycleDryRunForAllDescriptors(), ADR-0037, findArchivedThroughCursor() (+5 more)

### Community 159 - "consumer-state-directory.ts"
Cohesion: 0.14
Nodes (13): BacklogCountRow, ConsumerStateRow, DomainEventConsumerView, pauseConsumer(), resumeConsumer(), UnknownDomainEventConsumerError, activityRollupProjectorConsumer, BASE_DOMAIN_EVENT_CONSUMERS (+5 more)

### Community 160 - "seo-document.ts"
Cohesion: 0.17
Nodes (15): absoluteOrRelative(), buildSeoDocument(), buildSiteIdentityNodes(), composeRobots(), parseRobots(), SeoDocumentResult, SeoLocaleLink, SeoOpenGraphModel (+7 more)

### Community 161 - "search-diagnostics.ts"
Cohesion: 0.16
Nodes (14): fetchIndexFailures(), fetchIndexStatus(), fetchRecentRuns(), IndexFailureItem, IndexRunSummary, IndexStatus, RunRow, toRunSummary() (+6 more)

### Community 162 - "tenant-domain-directory.ts"
Cohesion: 0.18
Nodes (16): createTenantDomain(), fetchActiveTenantDomain(), listTenantDomains(), setPrimaryTenantDomain(), SetPrimaryTenantDomainResult, softDeleteTenantDomain(), TenantDomainListPage, TenantDomainListRow (+8 more)

### Community 163 - "tenant-domain-validation.ts"
Cohesion: 0.13
Nodes (17): Result, TENANT_DOMAIN_ROUTE_MODES, TENANT_DOMAIN_TYPES, TENANT_DOMAIN_UPDATABLE_STATUSES, TENANT_DOMAIN_VERIFICATION_METHODS, TenantDomainRouteMode, TenantDomainType, TenantDomainVerificationMethod (+9 more)

### Community 164 - "user-agent.ts"
Cohesion: 0.15
Nodes (15): ClassifyHumanInput, ClassifySessionHumanityInput, HumanStatus, SessionHumanity, BOT_SIGNATURES, BROWSER_PATTERNS, BROWSER_VERSION_PATTERNS, detectBrowser() (+7 more)

### Community 165 - "workflow-approval.test.ts"
Cohesion: 0.15
Nodes (16): CreateDelegationInput, CreateDelegationValidationResult, delegationActiveAt(), delegationCoversScope(), DelegationInputValidationError, DelegationScopeQuery, resolveEffectiveDeciderIds(), validateCreateDelegationRequestBody() (+8 more)

### Community 166 - "CI job: quality"
Cohesion: 0.14
Nodes (18): Quality steps mirror package.json check, CI job: quality, ADR-0034 Direct-Use Family Templates, ADR-0035 Online-First ERP/SaaS Superset Repositioning, Frozen OpenAPI snapshot / INTENTIONALLY_EVOLVED_PATHS, awcms-micro absorption waves 0-3, Mini-first workflow contract, 21-module base inventory (+10 more)

### Community 167 - "required"
Cohesion: 0.11
Nodes (18): $ref, $ref, astro, bun, $ref, astro, astroNode, postgres (+10 more)

### Community 168 - "authorizeInTransaction() single authorization chokepoint"
Cohesion: 0.13
Nodes (18): auth_notification capability port, authorizeInTransaction() single authorization chokepoint, Database role separation (awcms_app/awcms_worker/awcms_setup), email module (provider-neutral dispatcher), evaluateAccess() default-deny evaluator, Gelombang 2 auth/admin delta (sql/073-075), identity_access module, module_management module (isCore) (+10 more)

### Community 169 - "OpenAPI bundle (generated, one-file-per-module)"
Cohesion: 0.12
Nodes (18): Minimal domain module example (expense-category), Module migration RLS ENABLE+FORCE pattern, Thin route auth->tenant->ABAC->service pattern, Provider config as per-tenant DATA (awcms_auth_providers), Auto-link / JIT account-takeover warning, Fail-closed ID token verification (RS256/ES256 allow-list), OIDC/SSO tenant-aware reference (Issue #185, ADR-0028), IdP is authenticator, not authority (opaque AWCMS session) (+10 more)

### Community 170 - "[revisionId].ts"
Cohesion: 0.16
Nodes (15): BlogRevisionDetail, BlogRevisionDetailRow, BlogRevisionSnapshot, BlogRevisionSummary, BlogRevisionSummaryRow, createBlogRevision(), fetchBlogRevisionById(), listBlogRevisions() (+7 more)

### Community 171 - "TenantContext"
Cohesion: 0.18
Nodes (15): ContentOwnershipAttributes, evaluateContentUpdateAccess(), ADR-0004, evaluatePageUpdateAccess(), PageOwnershipAttributes, ADR-0004, UPDATE_GUARD, evaluatePostUpdateAccess() (+7 more)

### Community 172 - "reply-notifications.ts"
Cohesion: 0.16
Nodes (14): appendCommentEvent(), CommentEventInput, createReplySubscription(), CreateReplySubscriptionInput, ReplySubscriptionResult, sha256(), ADR-0006, ADR-0041 (+6 more)

### Community 173 - "high-risk-sod-guard.ts"
Cohesion: 0.14
Nodes (16): checkHighRiskSoDConflicts(), DEFAULT_SOD_RELEVANT_PERMISSION_KEYS, extractRequestedScope(), HighRiskSoDCheckOptions, HighRiskSoDCheckResult, relevantKeysFor(), SOD_RULES, ADR-0037 (+8 more)

### Community 174 - "homepage-section-reference-validation.ts"
Cohesion: 0.19
Nodes (16): fetchNewsMediaObjectById(), isNewsMediaObjectSafeForPublicReference(), AdPlacementReferenceValidationError, AdPlacementReferenceValidationResult, ADR-0036, validateAdPlacementMediaReference(), HomepageSectionReferenceValidationError, HomepageSectionReferenceValidationResult (+8 more)

### Community 175 - "application/health-registry.ts"
Cohesion: 0.22
Nodes (17): asyncApiDocumentedSignal(), computeGenericSignals(), dbRegistrySyncedSignal(), fetchModuleHealthReport(), findDescriptor(), jobsDocumentedSignal(), listMigrationFileNames(), migrationsAppliedSignal() (+9 more)

### Community 176 - "application/module-settings.ts"
Cohesion: 0.21
Nodes (15): fetchModuleSettingsView(), fetchSettingsRow(), findDescriptor(), ModuleSettingsRow, ModuleSettingsView, toView(), updateModuleSettings(), UpdateModuleSettingsResult (+7 more)

### Community 177 - "ad-placement-policy.ts"
Cohesion: 0.27
Nodes (16): AD_PLACEMENT_DEFAULT_MEDIA_TYPES, AD_PLACEMENT_KEYS, AD_PLACEMENT_PRESETS, AD_ROTATION_MODES, AdPlacementPreset, CreateAdPlacementValidationResult, isAdPlacementKey(), isAdRotationMode() (+8 more)

### Community 178 - "profiles/[id].ts"
Cohesion: 0.16
Nodes (16): createParty(), softDeleteParty(), updateParty(), validateDeleteReasonRequestBody(), toPartyMaskedAdminDTO(), DELETE(), DELETE_GUARD, GET() (+8 more)

### Community 179 - "theme-lifecycle-preview.test.ts"
Cohesion: 0.18
Nodes (15): buildPreviewUrlToken(), generatePreviewToken(), hashPreviewToken(), isPreviewSessionActive(), isWellFormedPreviewToken(), parsePreviewUrlToken(), resolvePreviewTtlMinutes(), ADR-0029 (+7 more)

### Community 180 - "visitor-analytics-privacy.test.ts"
Cohesion: 0.21
Nodes (13): shapeVisitEvent(), shapeVisitorSession(), VisitEventDto, VisitEventRow, VisitorSessionDto, VisitorSessionRow, generateVisitorKey(), hashIpAddress() (+5 more)

### Community 181 - "Release job: validate (read-only)"
Cohesion: 0.12
Nodes (17): CI job: e2e-smoke (Playwright), Ephemeral per-job postgres:18.4 service, HOST=127.0.0.1 IPv4 pinning for E2E, CI job: integration-tests (RLS + DB role separation), --timeout 60000 for ephemeral DB setup, E2E seed via POST /api/v1/setup/initialize, Harness vs legacy DB-gated suite split, Ancestor-of-main guard (+9 more)

### Community 182 - "bun"
Cohesion: 0.12
Nodes (17): additionalProperties, properties, required, type, $ref, $ref, $ref, $ref (+9 more)

### Community 183 - "required"
Cohesion: 0.12
Nodes (17): definitions, divergence, stackEntry, additionalProperties, required, type, additionalProperties, required (+9 more)

### Community 184 - "family"
Cohesion: 0.12
Nodes (17): additionalProperties, properties, required, type, family, role, standard, standardRepository (+9 more)

### Community 185 - "MFA TOTP + recovery codes"
Cohesion: 0.14
Nodes (17): Intentional-divergence registry, Tenant MFA enforcement policy, MFA TOTP + recovery codes, Per-factor cumulative lockout, Step-up authentication (requireStepUp), MFA threat model, config:validate env validation, production:preflight orchestrator (+9 more)

### Community 186 - "jwt-verify.ts"
Cohesion: 0.20
Nodes (15): ALLOWED_JWT_ALGORITHMS, AllowedJwtAlgorithm, base64UrlDecode(), findJwk(), isAllowedJwtAlgorithm(), Jwk, JwtHeader, JwtPayload (+7 more)

### Community 187 - "social-share-links.ts"
Cohesion: 0.19
Nodes (14): isAbsoluteHttpUrl(), readBooleanFlag(), resolveBlogShareConfig(), buildSocialShareLinks(), renderInstagramNote(), renderSocialShareButtonsHtml(), shareText(), SocialShareArticle (+6 more)

### Community 188 - "redaction.ts"
Cohesion: 0.21
Nodes (14): redactEventPayloadForResponse(), collectKeysDeep(), collectSecretShapedValuePaths(), EXACT_SENSITIVE_KEY_SYNONYMS, findSensitiveKeys(), isSecretShapedValue(), isSensitiveKey(), normalizeKeyForExactMatch() (+6 more)

### Community 189 - "redirect-target.ts"
Cohesion: 0.13
Nodes (14): RedirectQueryPolicyInput, ADR-0028, ADR-0039, classifyRedirectTarget(), RedirectTargetClass, ADR-0028, ADR-0038, ADR-0039 (+6 more)

### Community 190 - "theme-registry.test.ts"
Cohesion: 0.21
Nodes (14): assertValidThemeDescriptor(), defineTheme(), ThemeDescriptor, BASE_THEME_DESCRIPTORS, composeThemeDescriptors(), getThemeDescriptor(), listThemeDescriptors(), ADR-0029 (+6 more)

### Community 191 - "checkSsoBreakGlassReady (critical readiness check)"
Cohesion: 0.15
Nodes (16): Break-glass eligibility drift after save, checkSsoBreakGlassReady (critical readiness check), evaluateBreakGlassRequirement, fetchEligibleBreakGlassIdentityIds, saveTenantAuthPolicy (save-time break-glass guarantee), bun run security:readiness gate, Admin shell (13 admin screens + CSP single owner), Break-glass SOP (+8 more)

### Community 192 - "Sync-first rule (syncModuleDescriptors)"
Cohesion: 0.12
Nodes (16): Route ownership via api.routes (longest-prefix wins), Tenant module presets (applyModulePreset), Permission sync status report (synced/missing/orphaned), resolveProtectedModuleKeys (dependency closure of core), Module settings shallow merge + secret-shaped value rejection, Admin sidebar rendered from module navigation registry, Sync-first rule (syncModuleDescriptors), RLS_FREE_TABLES registration for global tables (+8 more)

### Community 193 - "AWCMS family conformance to AWCMS-Mini standard"
Cohesion: 0.12
Nodes (16): compatibleAwcmsRange support-window guidance, Deprecation policy (announce/coexist/remove), extension:check compatibility enforcement (deprecated ADR-0034), Six independent versioning schemes, AWCMS family conformance to AWCMS-Mini standard, family:conformance:check gate + evidence report, FAMILY_CONTRACT_VERSION (seventh versioning scheme), AWCMS family conformance to AWCMS-Mini standard (Bahasa Indonesia source) (+8 more)

### Community 194 - "lifecycle-registry.ts"
Cohesion: 0.20
Nodes (11): main(), ADR-0037, collectHighVolumeTableDescriptors(), formatLifecycleRegistryIssue(), LifecycleRegistryIssue, LifecycleRegistryValidationResult, ADR-0037, VALID_RETENTION_CLASSES (+3 more)

### Community 195 - "getRegisteredCommentableResources()"
Cohesion: 0.20
Nodes (12): WORKER_ROLE_GRANTS, getRegisteredCommentableResources(), ADR-0041, CommentableResourceDescriptor, isRecord(), POST(), ADR-0041, GET() (+4 more)

### Community 196 - "internal-tag-link-settings-directory.ts"
Cohesion: 0.19
Nodes (13): DEFAULT_SETTINGS, fetchInternalTagLinkingSettings(), InternalTagLinkingSettingsRow, InternalTagLinkingSettingsView, parsePostgresUuidArray(), toView(), upsertInternalTagLinkingSettings(), isValidUuid() (+5 more)

### Community 197 - "redirect-directory.ts"
Cohesion: 0.18
Nodes (15): escapeLike(), findConflictingRedirect(), listRedirects(), RedirectListFilters, RedirectRow, ResolvedRedirectRule, restoreRedirect(), setRedirectState() (+7 more)

### Community 198 - "analytics-queries.ts"
Cohesion: 0.19
Nodes (15): ALLOWED_JSON_COLUMNS, ALLOWED_JSON_KEYS, AnalyticsSummary, fetchAnalyticsSummary(), fetchRealtimeStats(), fetchTopBrowsers(), fetchTopCountries(), fetchTopDevices() (+7 more)

### Community 199 - "ADR-0016 organization_structure module admission"
Cohesion: 0.18
Nodes (15): Module admission governance policy (doc 21), Scheduled exports with checksum + CSV formula neutralization, ADR-0016 organization_structure module admission, Accepted-but-not-implemented admission notice, Tenant vs legal entity vs organization unit boundary (RLS only on tenant_id), ADR-0017 document_infrastructure module admission, Concurrency-safe document numbering (FOR UPDATE + unique reservation), ADR-0018 data_exchange module admission (+7 more)

### Community 200 - "devDependencies"
Cohesion: 0.13
Nodes (15): @changesets/cli, devDependencies, @changesets/cli, @playwright/test, prettier, prettier-plugin-astro, @types/bun, typescript (+7 more)

### Community 201 - "seo_distribution module (discovery scope)"
Cohesion: 0.14
Nodes (15): blog_content as seo_facts provider, Public discovery routes (robots/sitemap/feed), Host-header poisoning defense (resolve-canonical-host), Controlled JSON-LD emission guard, seo_distribution module (discovery scope), seo_facts capability port, awcms_seo_tenant_settings config table, Email base infrastructure tables (+7 more)

### Community 202 - "domains.astro"
Cohesion: 0.13
Nodes (10): ../../../modules/tenant-domain/application/tenant-domain-directory, ../../../modules/tenant-domain/domain/tenant-domain-validation, actionError, canCreate, canDelete, canRead, canSetPrimary, canUpdate (+2 more)

### Community 203 - "comments OpenAPI fragment"
Cohesion: 0.13
Nodes (15): bulkModerateComments, CommentSettings schema, comments OpenAPI fragment, listCommentModerationQueue, moderateComment, reportPublicComment, SubmitCommentResult schema, submitPublicComment (+7 more)

### Community 204 - "logging-lint-check.ts"
Cohesion: 0.24
Nodes (14): ALLOWED_SANITIZER_CALLS, ConsoleCall, findConsoleErrorWarnCalls(), findRawIdiomAssignments(), isDangerousConsoleCall(), lineNumberAt(), LOGGING_LINT_EXEMPTIONS, LoggingLintProblem (+6 more)

### Community 205 - "table-write-ownership-check.ts"
Cohesion: 0.24
Nodes (13): accountableOwners(), collectTableWrites(), directoryKeyMap(), DOCUMENTED_EXCEPTIONS, findSharedTableWrites(), main(), ownerOfFile(), SharedTableWrite (+5 more)

### Community 206 - "posts/[id].ts"
Cohesion: 0.16
Nodes (11): enqueueModuleContentPurge(), DELETE(), DELETE_GUARD, PATCH(), READ_GUARD, ADR-0042, UPDATE_ACTIVITY, CREATE_GUARD (+3 more)

### Community 207 - "job-runner.ts"
Cohesion: 0.19
Nodes (12): acquireAdvisoryLock(), AdvisoryLockHandle, hashJobNameToInt32(), buildResult(), JobCliOptions, JobDefinition, JobHandlerResult, JobResult (+4 more)

### Community 208 - "application/permission-sync.ts"
Cohesion: 0.22
Nodes (12): CatalogPermissionRow, descriptorPermissionsForModule(), fetchCatalogPermissions(), fetchModulePermissionSyncReport(), ModulePermissionSyncReport, CatalogPermission, comparePermissions(), DescriptorPermission (+4 more)

### Community 209 - "reporting.test.ts"
Cohesion: 0.21
Nodes (10): EmailHealthReport, fetchEmailHealthReport(), fetchSyncHealthReport(), SyncHealthReport, EmailHealthCounts, EmailHealthView, shapeEmailHealth(), shapeSyncHealth() (+2 more)

### Community 210 - "discovery-cache.ts"
Cohesion: 0.22
Nodes (13): buildDiscoveryCacheControl(), buildDiscoverySignature(), buildEtag(), contentHash(), DiscoverySignatureParts, ifNoneMatchSatisfied(), isNotModified(), normalizeEtag() (+5 more)

### Community 211 - "condition-action-registry.ts"
Cohesion: 0.15
Nodes (9): ADR-0011, WorkflowActionContext, WorkflowActionHandler, WorkflowConditionEvaluationContext, WorkflowConditionResolver, alwaysTrueConditionResolver, BASE_ACTION_HANDLERS, BASE_CONDITION_RESOLVERS (+1 more)

### Community 212 - "Varnish 7.5 edge-cache service"
Cohesion: 0.15
Nodes (14): CI job: minimum-supported (Bun 1.3.0 floor), Varnish edge cache auto-activation (ADR-0042), RLS ENABLE without FORCE is inert, Applied migrations are immutable, 4xx returned inside withTenant commits, default_ttl=0 / default_grace=0 belt-and-braces, Malloc storage sizing vs ban lurker, EDGE_CACHE_PURGE_TOKEN shared secret (+6 more)

### Community 213 - "awcms-family-compatibility.schema.json"
Cohesion: 0.14
Nodes (13): additionalProperties, description, $id, required, $schema, title, type, contracts (+5 more)

### Community 214 - "business-scope-facts.ts"
Cohesion: 0.21
Nodes (13): ADR-0030, ActiveAssignmentRow, AssignmentPermissionRow, clampInt(), fetchActiveAssignmentRows(), HierarchyGuardConfig, OrdinaryRbacPermissionRow, resolveBusinessScopeFacts() (+5 more)

### Community 215 - "security.astro"
Cohesion: 0.14
Nodes (13): ../../lib/auth/mfa-config, ../../lib/auth/online-security-config, ../../lib/auth/sso-config, ../../modules/identity-access/application/auth-provider-directory, ../../modules/identity-access/application/tenant-auth-policy, ../../modules/identity-access/application/tenant-mfa-policy, canConfigureMfa, canReadMfa (+5 more)

### Community 216 - "Data Lifecycle module README"
Cohesion: 0.18
Nodes (14): DataLifecycleDescriptor (HighVolumeTableDescriptor), DataLifecycleLegalHold, Data Lifecycle module (API surface), Email module (API surface), Foundation module (health/pool probes), AuditEvent, Logging & Audit module (API surface), Reporting module (management reporting + projections) (+6 more)

### Community 217 - "changeset-policy-check.ts"
Cohesion: 0.22
Nodes (10): CHANGESET_POLICY_PATH_EXEMPTIONS, ChangesetFrontmatterResult, ChangesetPolicyResult, evaluateChangesetPolicy(), EXEMPT_PATH_PATTERNS, isExempt(), isPackageJsonVersionOnlyChange(), readGitFile() (+2 more)

### Community 218 - "getRegisteredSearchSources()"
Cohesion: 0.22
Nodes (10): main(), readFlag(), TenantRow, ADR-0040, getRegisteredSearchSources(), ADR-0040, POST(), REBUILD_GUARD (+2 more)

### Community 219 - "validate-env.ts"
Cohesion: 0.20
Nodes (11): BOOL_VALUES, EnvBag, isBase32ByteKey(), isValidUrl(), PLACEHOLDER_SECRETS, Rule, RULES, ADR-0041 (+3 more)

### Community 220 - "rollup.ts"
Cohesion: 0.20
Nodes (13): runVisitorAnalyticsRollup(), ALLOWED_JSON_COLUMNS, ALLOWED_JSON_KEYS, AreaCountRow, computeDailyAreaRollup(), DailyAreaRollup, fetchDailyAreaCounts(), fetchTopJsonFieldForDay() (+5 more)

### Community 221 - "blog-page-directory.ts"
Cohesion: 0.16
Nodes (13): BlogPageRow, BlogPageSummary, BlogPageSummaryRow, BlogPageView, FetchBlogPageOptions, listBlogPages(), ListBlogPagesFilter, listBlogPagesForAdmin() (+5 more)

### Community 222 - "video-news-block-validation.ts"
Cohesion: 0.26
Nodes (12): ContentJsonVideoBlocksValidationResult, isRecord(), isRecordArray(), isVideoNewsProvider(), NormalizedVideoNewsBlock, normalizeYouTubeVideoId(), validateAndNormalizeContentJsonVideoBlocks(), validateOptionalStringField() (+4 more)

### Community 223 - "media-object-key.ts"
Cohesion: 0.24
Nodes (10): createPendingNewsMediaObject(), buildNewsMediaObjectKey(), BuildNewsMediaObjectKeyInput, buildNewsMediaPublicUrl(), deriveExtensionFromMimeType(), isValidNewsMediaObjectKey(), MIME_TYPE_TO_EXTENSION, pad2() (+2 more)

### Community 224 - "Idempotent High-Risk Mutation Skill"
Cohesion: 0.37
Nodes (13): AWCMS Coder Agent, AWCMS Reviewer Agent, AWCMS Security Auditor Agent, ABAC Guard & Tenant Isolation Skill, Audit Log (High-Risk) Skill, Document Infrastructure Module Skill, Email Module Skill, ERP Extension Readiness Skill (historical, ADR-0034) (+5 more)

### Community 225 - "migrationChecksum"
Cohesion: 0.15
Nodes (13): minLength, type, additionalProperties, properties, required, type, algorithm, migrationChecksum (+5 more)

### Community 226 - "required"
Cohesion: 0.15
Nodes (13): additionalProperties, required, type, contracts, apiResponseEnvelopeVersion, auditRedactionContractVersion, capabilityContractVersions, eventApiInfoVersion (+5 more)

### Community 227 - "properties"
Cohesion: 0.15
Nodes (13): description, pattern, type, items, type, $ref, const, description (+5 more)

### Community 228 - "comment-retention.ts"
Cohesion: 0.22
Nodes (11): main(), resolveRetentionDays(), TenantRow, ADR-0037, ADR-0041, anonymizeAgedComments(), AnonymizeResult, PurgeSubscriptionsResult (+3 more)

### Community 229 - "error-sanitizer.ts"
Cohesion: 0.23
Nodes (8): interpretPoolHealthStatus(), main(), PoolHealthOutcome, resolveAppBaseUrl(), logAdminPageError(), sanitizeErrorForLog(), sanitizeOne(), LogContext

### Community 230 - "sync-agent-memory.ts"
Cohesion: 0.28
Nodes (12): DOC_PATH, EXCLUDE, exists(), header(), main(), memoryDir(), parseGenerated(), quoteDescription() (+4 more)

### Community 231 - "theme-render-resolver.ts"
Cohesion: 0.31
Nodes (11): fetchThemeTenantState(), fetchVersionById(), ThemeConfigVersion, defaultThemeCss(), resolveActiveThemeCssForTenant(), ResolvedThemeCss, resolveVersionThemeCss(), ADR-0029 (+3 more)

### Community 232 - "presentation/theme-public-css.ts"
Cohesion: 0.24
Nodes (11): cssResponse(), etagFor(), notModified(), serveActiveThemeTokensCss(), ADR-0009, ADR-0029, ADR-0034, GET() (+3 more)

### Community 233 - "awcms_resolve_tenant_domain_lookup SECURITY DEFINER bootstrap read"
Cohesion: 0.17
Nodes (12): Base registry composition validation (composeModuleRegistry), Public tenant-scoped routes via path tenantCode (ADR-0009), ADR-0034 direct-use templates (derived pathway removed), ADR-0035 awcms as online-first superset absorbing awcms-micro, :tenantCode urlTemplate placeholder (throws if unresolved), awcms_resolve_tenant_domain_lookup SECURITY DEFINER bootstrap read, awcms_domain_bootstrap role + scoped bootstrap read policy, resolvePublicTenantFromRequest fallback ladder (+4 more)

### Community 234 - "Tenant Admin Module"
Cohesion: 0.17
Nodes (12): Sync HMAC & Offline Sync, Node inactive-by-default registration + admin approve, Versioned v2 HMAC signature (GHSA-c972), Composite FK parent office (GHSA-r7cx), Tenant Admin Module, Office soft-delete + restore, Setup wizard bootstrapPlatformTenant, awcms_tenants RLS-free root table (+4 more)

### Community 235 - "ADR-0042: Varnish edge-cache tier, off by default"
Cohesion: 0.20
Nodes (12): Bounded cache key space via allowedQueryParams, decideCacheability fail-closed allow-list, Layered defence against Varnish cache-by-default, ADR-0042: Varnish edge-cache tier, off by default, Origin-pressure auto-activation (pressure changes HOW LONG, never WHAT), Anchored surrogate-key invalidation via durable purge queue, Host-resolved discovery surfaces deliberately not declared, Unlimited-subdomain junction (Cloudflare DNS + host-resolved routes) (+4 more)

### Community 236 - "ERP-Specific Threats"
Cohesion: 0.18
Nodes (12): Coretax / VAT Invoice, Domain Event + Envelope, HMAC (sync integrity), Ledger Entry / Posting (append-only), Payroll Run, Double-Posting / Double-Payment mitigation, ERP-Specific Threats, Financial Data Integrity (ledger immutability) (+4 more)

### Community 237 - "Derived Application Guide (DEPRECATED, ADR-0034)"
Cohesion: 0.23
Nodes (12): BundleConflictError (default-deny override), API Contribution Guide (Issue #182, ADR-0026), Modular OpenAPI ownership & composition, Bun-only Backend Platform standard, Development Standard Compliance Audit (2026-07-04, historical), AWPOS pilot (candidate matrix recommendation), First Derived App Pilot Plan (AWPOS, DEPRECATED), Purchase Requisition Pilot Plan (#187, DEPRECATED) (+4 more)

### Community 238 - "Bundled published OpenAPI contract"
Cohesion: 0.17
Nodes (12): AbacDslPolicy schema, Bundled published OpenAPI contract, DataLifecycleDescriptor schema, MediaEnforcementState schema, SeoRedirect schema, createFormDraft, deleteFormDraft, FormDraft schema (+4 more)

### Community 239 - "check-docs.mjs"
Cohesion: 0.30
Nodes (10): anyComposeFileExists(), checkLinks(), COMPOSE_FILE_CANDIDATES, GENERATED_EXEMPT, listMarkdown(), loadComposeServiceNames(), loadPackageScripts(), loadSqlFileNames() (+2 more)

### Community 240 - "docs-i18n-checks.mjs"
Cohesion: 0.33
Nodes (9): listIdSources(), ADR-0023, ROOT, runChecks(), checkTranslationPair(), computeSourceHash(), deriveEnglishPath(), extractRecordedHash() (+1 more)

### Community 241 - "application/form-draft-purge.ts"
Cohesion: 0.24
Nodes (10): main(), resolveRetentionDays(), TenantRow, ExpireFormDraftsOptions, ExpireFormDraftsResult, expireOverdueFormDrafts(), IdRow, purgeExpiredFormDrafts() (+2 more)

### Community 242 - "security-headers.ts"
Cohesion: 0.29
Nodes (7): BASE_CSP_DIRECTIVES, buildContentSecurityPolicy(), buildSecurityHeaders(), scriptSrcSources(), SecurityHeaderOptions, cspFor(), directives()

### Community 243 - "compare.ts"
Cohesion: 0.35
Nodes (10): Comparator, compareSemver(), isValidSemver(), ParsedSemver, parseSemver(), parseSemverRange(), satisfiesComparator(), satisfiesSemverRange() (+2 more)

### Community 244 - "data-lifecycle/module.ts"
Cohesion: 0.23
Nodes (8): DATA_LIFECYCLE_PERMISSIONS, DataLifecyclePermissionKey, DataLifecyclePermissionValue, ADR-0037, dataLifecycleModule, ADR-0013, ADR-0037, ROOT

### Community 245 - "Domain Event Dispatcher"
Cohesion: 0.20
Nodes (12): Static Consumer Registry (DOMAIN_EVENT_CONSUMERS), Domain Event Dispatcher, Domain Event Runtime, Idempotent Consumer Effect (applyConsumerEffectOnce), Announcement / Notification Enqueue (enqueueAnnouncement), Email Suppression List, reporting.event_activity_projector consumer, Live-computed Projection Freshness (+4 more)

### Community 246 - "role-admin-validation.ts"
Cohesion: 0.23
Nodes (10): CreateRoleInput, DeleteRoleInput, PermissionRefInput, UpdateRoleInput, validateCreateRoleInput(), validateDeleteRoleInput(), validatePermissionRefInput(), validateUpdateRoleInput() (+2 more)

### Community 247 - "office-validation.ts"
Cohesion: 0.21
Nodes (11): CreateOfficeInput, DeleteOfficeInput, OFFICE_STATUSES, OFFICE_TYPES, OfficeStatus, OfficeType, UpdateOfficeInput, validateCreateOfficeInput() (+3 more)

### Community 248 - "sod.integration.test.ts"
Cohesion: 0.18
Nodes (7): HIERARCHY, HIERARCHY_PORT, permId(), PERMS, seedFixtures(), seedRoleWithPermissions(), SOD_RULES

### Community 249 - "form_drafts module (domain-agnostic server-side draft store)"
Cohesion: 0.22
Nodes (11): Reuse exact endpoint permission keys (mfa_admin.reset as read gate), /admin/security authentication policy screen, Email password reset flow (sql/073, non-oracle, FOR UPDATE single use), Admin-approved self-registration (sql/074-075, stores no credential), Peta ke artefak nyata awcms (micro names vs awcms names), Two public visibility predicates (listing strict vs detail unlisted), Unauthenticated public write surface backbone (no oracle, PII minimized), form_drafts module (domain-agnostic server-side draft store) (+3 more)

### Community 250 - "intentionalDivergences (reason + owner + reviewDate + ADR)"
Cohesion: 0.20
Nodes (11): isFullOnlineSecurityActive shared deployment gate, MFA/TOTP paused login (state-driven, not env-gated), Turnstile enforcement (enforceTurnstileIfRequired, breaker discipline), Divergence: business-scope-base-resolver-noop (fail-closed), intentionalDivergences (reason + owner + reviewDate + ADR), Divergence: mfa-session-assurance-built-new, Divergence: oidc-ssrf-blocks-private-ip, Divergence: openapi-one-file-per-module (+3 more)

### Community 251 - "AWCMS project skill catalog"
Cohesion: 0.18
Nodes (11): FORCE ROW LEVEL SECURITY (ENABLE alone is inert), SECURITY DEFINER bootstrap-read checklist, WORKER_ROLE_GRANTS least-privilege drift matrix, Definition of Done full `bun run check` chain, Mini/micro port playbook (adapt, not copy), Non-negotiable rename rules (awcms_mini_ / awcms_micro_ → awcms_), Canonical host derived server-side, never from Host header, Redirect governance + 404 telemetry (ADR-0039) (+3 more)

### Community 252 - "release-verify-checks.ts"
Cohesion: 0.33
Nodes (7): ADR-0024, checkChangelogHasSection(), checkNoPendingChangesets(), checkTagMatchesPackageVersion(), parseVersionFromTag(), Problem, ROOT

### Community 253 - "Row-Level Security (RLS)"
Cohesion: 0.18
Nodes (11): Legal Entity, Organization Unit, Row-Level Security (RLS), Tenant (RLS security boundary), Threat Model and Security Architecture (Doc 20), Layered Security Controls, STRIDE Threat Model, Database Migration Runner (+3 more)

### Community 254 - "keywords"
Cohesion: 0.18
Nodes (11): keywords, abac, bun, business-integration, erp, modular-monolith, multi-tenant, offline-first (+3 more)

### Community 255 - "db-role-separation-worker-setup-migration.test.ts"
Cohesion: 0.18
Nodes (7): SETUP_ROLE_GRANTS, allMigrationStatements, migrationSql, migrationStatements, normalize(), ParsedGrants, repoRoot

### Community 256 - "validate-module-graph.ts"
Cohesion: 0.24
Nodes (9): findLibNamespaceViolations(), LIB_NAMESPACE_ALIASES, LIB_NAMESPACE_EXCEPTIONS, libNamespaces(), LibNamespaceViolation, main(), ADR-0038, KEYS (+1 more)

### Community 257 - "run-record-store.ts"
Cohesion: 0.20
Nodes (10): LifecycleRunCounts, LifecycleRunRow, LifecycleRunStatus, LifecycleRunType, listLifecycleRuns(), ListLifecycleRunsFilter, RecordLifecycleRunInput, RunDbRow (+2 more)

### Community 258 - "AWCMS Public API Pre-migration OpenAPI Snapshot"
Cohesion: 0.25
Nodes (11): Email Module, Profile Identity module README, Management Reporting Module, Five Generic Reporting Views, One-time Setup Wizard / Platform Bootstrap, Tenant Admin Module, example-crm OpenAPI Fragment, Dummy BusinessScopeHierarchyPort Resolver (+3 more)

### Community 259 - "policy-cache.ts"
Cohesion: 0.22
Nodes (9): cache, CacheEntry, compileRow(), PolicyRow, queryAndCompile(), ADR-0033, versions, AbacPolicyEffect (+1 more)

### Community 260 - "abac-evaluator.test.ts"
Cohesion: 0.22
Nodes (8): AbacEnvironment, AbacEvaluationError, CompiledPolicy, evaluateAbacPolicies(), evaluateCondition(), isPolicyApplicable(), CONTEXT, ENV

### Community 261 - "media-upload-session-validation.ts"
Cohesion: 0.24
Nodes (9): CreateNewsMediaUploadSessionInput, CreateNewsMediaUploadSessionValidationResult, FinalizeNewsMediaUploadSessionInput, FinalizeNewsMediaUploadSessionValidationResult, validateCreateNewsMediaUploadSessionInput(), validateFinalizeNewsMediaUploadSessionInput(), validateOptionalText(), ValidationError (+1 more)

### Community 262 - "application/navigation-registry.ts"
Cohesion: 0.31
Nodes (7): collectNavigationCandidates(), fetchTenantDisabledModuleKeys(), fetchVisibleModuleNavigationEntries(), filterVisibleNavigationEntries(), NavigationCandidate, NavigationFilterOptions, ModuleLifecycleStatus

### Community 263 - "Per-tenant Salted Visitor-Key Hash"
Cohesion: 0.18
Nodes (11): Public Discovery/Syndication (sitemap/feeds), Redirect Governance (ADR-0039), SEO Distribution Module, Central SEO Head Renderer, seo_facts Contribution Contract, Composite Tenant-bound FK (GHSA-r7cx-c4jh-cvvw), Office Hierarchy + Soft-delete/Restore, Public Ingest Beacon (POST /analytics/collect) (+3 more)

### Community 264 - "comments module guidance (moderation-first)"
Cohesion: 0.20
Nodes (10): blog_content module guidance, Full-precision text keyset cursor (microsecond vs millisecond trap), comments module guidance (moderation-first), CURSOR_BOUNDARY_SAFETY_MARGIN_MS (timestamptz vs JS Date precision), awcms.blog-content.* channels (27), awcms.comments.* channels, DomainEventEnvelope schema, awcms.email.message.* channels (+2 more)

### Community 265 - "ProjectionDescriptor registry (cursor_table vs domain_event)"
Cohesion: 0.20
Nodes (10): Composite tenant-scoped foreign keys (FK bypasses RLS), ADR-0036 media ownership inversion (media_library extraction), Atomic uploaded-claim as mutual exclusion + revert path, News media object registry (awcms_news_media_objects), Polymorphic owner_resource_type/id without FK, computeProjectionFreshness (derived, never cached), ProjectionDescriptor registry (cursor_table vs domain_event), TOCTOU rebuild lock via pg_advisory_xact_lock (+2 more)

### Community 266 - "config.json"
Cohesion: 0.20
Nodes (9): access, baseBranch, changelog, commit, fixed, ignore, linked, $schema (+1 more)

### Community 267 - "Eleven ERP contract families (neutral contracts, base is not ERP)"
Cohesion: 0.22
Nodes (10): ABAC (Attribute-Based Access Control), Capability Port, Default Deny / Deny Overrides Allow, Glossary and Terminology (Doc 19), Fiscal Period, RBAC (Role-Based Access Control), Dynamic ABAC Policy Evaluator (Issue #179, ADR-0033), Eleven ERP contract families (neutral contracts, base is not ERP) (+2 more)

### Community 268 - "Four deployment profiles (development/staging/production/offline-LAN)"
Cohesion: 0.22
Nodes (10): Fleet-wide connection capacity formula, Graceful saturation: bounded queue and controlled 503, Process class inventory (app/worker/setup) and worker budget trap, Two Coolify deploy patterns (build-from-repo vs pull-image), Single-VPS Coolify topology and its trade-off, Four deployment profiles (development/staging/production/offline-LAN), Scheduled CLI dispatcher pattern, src/lib/jobs shared worker runner (+2 more)

### Community 269 - "ApiError schema"
Cohesion: 0.24
Nodes (10): ApiError schema, ApiMeta schema (correlationId/requestId), bearerAuth security scheme, 128 KiB application-level body size cap, Root OpenAPI source fragment, syncHmac (X-AWCMS-Signature) scheme, tenantHeader (X-AWCMS-Tenant-ID) scheme, BlogPost schema + draft/review/publish lifecycle (+2 more)

### Community 270 - "Blog Content module README"
Cohesion: 0.27
Nodes (10): Managed-media enforcement (one-way switch, ADR-0036), Media Library module (API surface), NewsMediaObjectItem (media registry object), News Portal module (API surface), SEO & Distribution module (API surface), Frozen open-redirect guard, Tenant Domain module (hostname mappings), Theming module (draft/publish/rollback) (+2 more)

### Community 271 - "site-search OpenAPI fragment"
Cohesion: 0.22
Nodes (10): site-search OpenAPI fragment, siteSearchIndexFailures, siteSearchIndexRebuild, siteSearchIndexReconcile, SiteSearchIndexRun schema, siteSearchIndexStatus, SiteSearchSettings schema, siteSearchSettingsUpdate (+2 more)

### Community 272 - "turnstile-enforcement.test.ts"
Cohesion: 0.22
Nodes (7): checkOnlineAuthSecurityReady(), checkTurnstileReady(), installFetchSpy(), login, SECRET, siteverify(), TOKEN

### Community 273 - "surface-registry.ts"
Cohesion: 0.27
Nodes (9): hasReservedSegment(), hasTraversalSegment(), matchPublicCacheSurface(), PUBLIC_CACHE_SURFACES, PublicCacheSurface, RESERVED_SEGMENTS, ADR-0009, ADR-0010 (+1 more)

### Community 274 - "announcement-validation.ts"
Cohesion: 0.31
Nodes (8): AnnouncementInput, AnnouncementTarget, isPlainObject(), Result, validateAnnouncementInput(), validateTarget(), validateVariables(), ValidationError

### Community 275 - "enable-managed-media-enforcement.ts"
Cohesion: 0.29
Nodes (8): enableManagedMediaEnforcement(), EnableManagedMediaEnforcementResult, ADR-0026, isManagedMediaEnforcedForTenant(), markManagedMediaEnforced(), ADR-0026, ADR-0036, ManagedMediaReadinessReason

### Community 276 - "news-portal-preset-readiness.ts"
Cohesion: 0.29
Nodes (8): evaluateNewsPortalFullOnlineR2Readiness(), isKnownNewsPortalProfile(), NEWS_PORTAL_PROFILES, NewsPortalPresetReadinessReason, NewsPortalPresetReadinessResult, NewsPortalProfile, ADR-0036, FULLY_CONFIGURED_ENV

### Community 277 - "not-found-directory.ts"
Cohesion: 0.24
Nodes (9): listNotFoundObservations(), NotFoundObservation, ObservationRow, RecordNotFoundInput, recordNotFoundObservation(), resolveNotFoundObservation(), toObservation(), ADR-0028 (+1 more)

### Community 278 - "redirect-eligibility.ts"
Cohesion: 0.27
Nodes (9): EXCLUDED_EXACT, EXCLUDED_SEGMENT_PREFIXES, EXCLUDED_STARTSWITH, fileExtension(), hasControlCharacter(), isRedirectEligiblePath(), STATIC_ASSET_EXTENSIONS, ADR-0028 (+1 more)

### Community 279 - "v1/settings/index.ts"
Cohesion: 0.31
Nodes (8): fetchTenantSettings(), TenantSettingsView, updateTenantSettings(), UpdateTenantSettingsFields, GET(), PATCH(), READ_GUARD, UPDATE_GUARD

### Community 280 - "Private vulnerability reporting policy"
Cohesion: 0.25
Nodes (7): Changesets workflow README, Contributor Covenant Code of Conduct, ADR-based decision-making process, Maintainer / contributor / security-responder roles, Baseline security controls, SECURITY.md — Security Policy, Private vulnerability reporting policy

### Community 281 - "capabilities field (ports-and-adapters seam)"
Cohesion: 0.25
Nodes (9): capabilities field (ports-and-adapters seam), Two composition-root variants (implicit port vs explicit enable gate), MODULE_CONTRACT_VERSION 2.3.0 descriptor-list seams, seo_facts capability port (content modules provide facts), Aggregator-never-depends-on-provider arrow direction, searchSources descriptor seam (owner declares, aggregator discovers), organization_hierarchy_resolution capability (BusinessScopeHierarchyPort impl), DataExchangeAdapterPort + ExchangeDescriptor seam (+1 more)

### Community 282 - "Theming lifecycle draft→validate→preview→publish→rollback/retire"
Cohesion: 0.22
Nodes (9): Edge-cache dual obligation (purge enqueue + surface registry), Append-only & immutable table policy, Published version immutability enforced in three layers, Theming lifecycle draft→validate→preview→publish→rollback/retire, Preview session retention via read-filter, not purge job, business-transaction-contract passive data types, A security claim in an ADR is not proof of the claim, example-erp-extension fixture as machine-verifiable proof (+1 more)

### Community 283 - "requester!=approver SoD rule + self-approval deny"
Cohesion: 0.25
Nodes (9): Idempotency, Segregation of Duties (SoD), Business-Scope Hierarchy (Issue #180, ADR-0030), Segregation of Duties Layer (Issue #181, ADR-0031), Purchase Requisition Pilot Execution Runbook (#187, DEPRECATED), Verified base seam map (auth/workflow/audit/idempotency), requester!=approver SoD rule + self-approval deny, BusinessScopeHierarchyPort resolver injection (+1 more)

### Community 284 - "commentableResources descriptor seam"
Cohesion: 0.28
Nodes (9): MODULE_CONTRACT_VERSION 2.3.0, saveTenantSidebarArrangement, commentableResources descriptor seam, comments:resources:check registry gate, Navigation filtering is not authorization, Per-tenant sidebar arrangement stored as a delta, Registry-derived sidebar model, SearchSourceDescriptor contribution seam (+1 more)

### Community 285 - ".prettierrc.json"
Cohesion: 0.22
Nodes (8): overrides, plugins, printWidth, proseWrap, semi, singleQuote, trailingComma, prettier-plugin-astro

### Community 286 - "social-publishing-port.ts"
Cohesion: 0.28
Nodes (7): noopSocialPublishingPortAdapter, ArticlePublishedEventInput, ArticlePublishedPortResult, SocialPublishingPort, SocialPublishingTriggerEvent, ADR-0006, ADR-0036

### Community 287 - "timing-token.ts"
Cohesion: 0.33
Nodes (7): mintTimingToken(), PLACEHOLDER_SECRETS, resolveSecret(), sign(), TimingTokenVerification, ADR-0041, verifyTimingToken()

### Community 288 - "manifest-store.ts"
Cohesion: 0.28
Nodes (7): ArchiveManifestRow, getArchiveManifest(), InsertArchiveManifestInput, listArchiveManifests(), ManifestDbRow, toRow(), ADR-0037

### Community 289 - "soft-delete.ts"
Cohesion: 0.33
Nodes (7): activeRecordPredicate(), deletedRecordPredicate(), ListOptions, shouldIncludeDeleted(), shouldOnlyListDeleted(), SOFT_DELETE_COLUMNS, SoftDeleteColumns

### Community 290 - "Reusable wizard-form component library (target spec, not ported)"
Cohesion: 0.25
Nodes (8): renderSafeSnippet escape-then-sentinel ordering (XSS), Two-layer content sanitization testing (input + render), CSS value validation by rejection (not sanitization), Tokens served as external same-origin stylesheet to preserve CSP, admin-form-client (lockElement/sendJson/postJson) mandatory import, No component library — hand-rolled markup conventions, Client-side wizard drafts hold only non-sensitive, non-persistent state, Reusable wizard-form component library (target spec, not ported)

### Community 291 - "ADR-0028 OIDC/SSO Tenant-aware, Account Linking, Break-glass"
Cohesion: 0.29
Nodes (8): ADR-0027 MFA TOTP, Session Assurance, Step-up, TOTP anti-replay compare-and-swap (last_used_step), Session assurance (aal1/aal2) + requireStepUp, ADR-0028 OIDC/SSO Tenant-aware, Account Linking, Break-glass, Break-glass enforcement at policy save, OIDC SSRF guard (block private/metadata IPs), ADR-0029 Deployment-profile-aware Turnstile Bot Protection, Deployment profile gate (isTurnstileRequired/full_online)

### Community 292 - "data_lifecycle module (registry + safe lifecycle engine)"
Cohesion: 0.25
Nodes (8): Modular Monolith, Module Descriptor, Soft Delete, Archive Port + restore procedure (local_offline), Data Lifecycle — operational & compliance guide, HighVolumeTableDescriptor + retention class, Legal Hold (fail-closed precedence), data_lifecycle module (registry + safe lifecycle engine)

### Community 293 - "analytics.astro"
Cohesion: 0.25
Nodes (7): ../../modules/identity-access/application/access-guard, ../../modules/visitor-analytics/application/analytics-queries, ../../modules/visitor-analytics/application/session-directory, ../../modules/visitor-analytics/domain/analytics-range, ../../modules/visitor-analytics/domain/analytics-response-shaping, ../../modules/visitor-analytics/domain/dashboard-view, ../../modules/visitor-analytics/domain/visitor-analytics-config

### Community 294 - "Publication boundary at resource->thread"
Cohesion: 0.25
Nodes (8): listPublicComments, PublicComment schema, siteSearchQuery, SiteSearchQueryResult schema, Store plain text, escape then autolink, Publication boundary at resource->thread, The index is a public-content projection, never an authorization source, ts_headline sentinel + escape then mark

### Community 295 - "tenant-route-factory-check.ts"
Cohesion: 0.39
Nodes (6): callsWithTenantDirectly(), evaluateTenantRouteMigration(), main(), NOT_YET_MIGRATED, TenantRouteMigrationResult, walk()

### Community 296 - "009_awcms_domain_event_runtime_schema.sql"
Cohesion: 0.32
Nodes (7): awcms_domain_event_activity_daily, awcms_domain_event_consumer_effects, awcms_domain_event_consumer_state, awcms_domain_event_deliveries, awcms_domain_event_replays, awcms_domain_events, awcms_idempotency_keys

### Community 297 - "013_awcms_workflow_approval_schema.sql"
Cohesion: 0.43
Nodes (7): awcms_workflow_decisions, awcms_workflow_definitions, awcms_workflow_delegations, awcms_workflow_instances, awcms_workflow_join_arrivals, awcms_workflow_task_assignments, awcms_workflow_tasks

### Community 298 - "015_awcms_reporting_projections_schema.sql"
Cohesion: 0.29
Nodes (7): awcms_reporting_export_runs, awcms_reporting_projection_cursors, awcms_reporting_projection_metrics, awcms_reporting_projection_state, awcms_reporting_rebuild_runs, awcms_reporting_reconciliation_runs, awcms_reporting_scheduled_exports

### Community 299 - "035_awcms_blog_content_schema.sql"
Cohesion: 0.32
Nodes (7): awcms_blog_pages, awcms_blog_post_terms, awcms_blog_posts, awcms_blog_redirects, awcms_blog_revisions, awcms_blog_settings, awcms_blog_terms

### Community 300 - "037_awcms_blog_content_presentation_schema.sql"
Cohesion: 0.32
Nodes (7): awcms_blog_ad_placements, awcms_blog_ads, awcms_blog_menu_items, awcms_blog_menus, awcms_blog_templates, awcms_blog_theme_settings, awcms_blog_widgets

### Community 301 - "066_awcms_comments_schema.sql"
Cohesion: 0.43
Nodes (7): awcms_comments_abuse_events, awcms_comments_comments, awcms_comments_moderation_events, awcms_comments_reply_subscriptions, awcms_comments_reports, awcms_comments_settings, awcms_comments_threads

### Community 302 - "application/blog-scheduled-publish.ts"
Cohesion: 0.25
Nodes (7): DuePostRow, publishDueScheduledPosts(), PublishDueScheduledPostsOptions, PublishDueScheduledPostsResult, ADR-0006, ADR-0011, ADR-0042

### Community 303 - "suppression-validation.ts"
Cohesion: 0.32
Nodes (6): KNOWN_REASONS, Result, SuppressionInput, SuppressionReason, validateSuppressionInput(), ValidationError

### Community 304 - "access-guard-field-access.test.ts"
Cohesion: 0.25
Nodes (4): resetPolicyCache(), GRANTED, NOW, RAW_DETAIL_GUARD

### Community 305 - "settings-validation.ts"
Cohesion: 0.36
Nodes (7): isPlainObject(), Result, UpdateTenantSettingsInput, VALID_LOCALES, VALID_THEMES, validateUpdateTenantSettingsInput(), ValidationError

### Community 306 - "Admin sidebar rendered from module registry (sidebar-menu.ts)"
Cohesion: 0.29
Nodes (7): Admin sidebar rendered from module registry (sidebar-menu.ts), Integration suite hook timeout + exit 143 misreporting fix, Per-tenant sidebar arrangement stored as DELTA, never snapshot, Admin shell parity with awcms-micro (AdminLayout, CSP hashed theme-init), navigation split-brain (descriptor vs static navSections), Permission-seed migration reaches only tenants created after it, site_search module port + searchSources seam (ADR-0040)

### Community 307 - "capabilityContractVersions (party_directory, media_library, seo_facts, auth_notification)"
Cohesion: 0.29
Nodes (7): blog_content as cross-module descriptor contributor (seo_facts, searchSources), commentableResources contribution seam (arrow must not be reversed), auth_notification capability (email -> identity_access), capabilityContractVersions (party_directory, media_library, seo_facts, auth_notification), family:conformance:check gate, AWCMS family compatibility manifest, comments module port (21st base module, ADR-0041)

### Community 308 - "ADR-0019 integration_hub module admission (System Foundation)"
Cohesion: 0.29
Nodes (7): Provider-neutral adapter registry (empty at foundation), token_reference is a pointer, with raw-secret rejection heuristic, document_resource_relations capability port (no shared-table write), integration_adapter_registration capability port, ADR-0019 integration_hub module admission (System Foundation), Hub owns delivery envelope status, never final business data, Inbound webhook signature verification + DB replay-key dedup (not Idempotency-Key)

### Community 309 - "properties"
Cohesion: 0.29
Nodes (7): minLength, type, declared, source, minLength, type, properties

### Community 310 - "tenant-domain:dns:sync reconciliation job"
Cohesion: 0.29
Nodes (7): ADRs accepted without implementation, repo:inventory generator not yet ported, Tenant subdomain DNS reconciliation (#236), Neutral ERP-readiness contracts (ADR-0020), External providers via outbox, never inside a transaction, tenant-domain:dns:sync reconciliation job, Drifted records moved, never duplicated or deleted

### Community 311 - "005_awcms_abac_access_control_schema.sql"
Cohesion: 0.43
Nodes (6): awcms_abac_decision_logs, awcms_abac_policies, awcms_access_assignments, awcms_permissions, awcms_role_permissions, awcms_roles

### Community 312 - "online-security-config.ts"
Cohesion: 0.43
Nodes (6): isFullOnlineSecurityActive(), isKnownOnlineSecurityProfile(), isOnlineSecurityEnabled(), KNOWN_ONLINE_SECURITY_PROFILES, OnlineSecurityProfile, resolveOnlineSecurityProfile()

### Community 313 - "workflow-notification-port-adapter.ts"
Cohesion: 0.38
Nodes (4): ADR-0011, ADR-0011, WorkflowNotificationPort, WorkflowNotificationRequest

### Community 314 - "EmailProvider Port Contract"
Cohesion: 0.33
Nodes (7): Per-provider Circuit Breaker, Email Dispatcher (claim-lease outbox), EmailProvider Port Contract, Mailketing Provider Adapter, Object Sync Dispatcher (CLAIM/UPLOAD/FINALIZE), Object Sync Upload Queue, ObjectUploader Port

### Community 315 - "domain/health-registry.ts"
Cohesion: 0.38
Nodes (4): classifyHealthStatus(), HealthStatus, ReadinessSignal, ReadinessSignalStatus

### Community 316 - "tenant-domain-dns-config.ts"
Cohesion: 0.38
Nodes (5): isKnownTenantDomainDnsProvider(), KNOWN_TENANT_DOMAIN_DNS_PROVIDERS, resolveTenantDomainCloudflareTimeoutMs(), TENANT_DOMAIN_CLOUDFLARE_REQUIRED_WHEN_SELECTED, TenantDomainDnsProviderKind

### Community 317 - "theme-preview-render.ts"
Cohesion: 0.29
Nodes (6): buildPreviewViewModel(), PreviewAsset, PreviewSection, PreviewViewModel, SAMPLE_COPY, ADR-0029

### Community 318 - "announcement-enqueue-batching.test.ts"
Cohesion: 0.33
Nodes (5): CapturedQuery, createFakeSql(), FakeArray, targetRows(), TEMPLATE_ROW

### Community 319 - "withTenant integration point (SET LOCAL tenant + backpressure)"
Cohesion: 0.47
Nodes (6): Work Class, Bun.SQL pool config, Circuit Breaker (3-state, fail-fast), Database Connection Pooling and Backpressure, withTenant integration point (SET LOCAL tenant + backpressure), Work-Class Concurrency Gate

### Community 320 - "news-share.js"
Cohesion: 0.67
Nodes (5): enhanceCopyLinkButtons(), enhanceNativeShareButtons(), fallbackCopyToClipboard(), findWidget(), showStatus()

### Community 321 - "edge-cache-surfaces-check.ts"
Cohesion: 0.40
Nodes (5): collectPurgedModuleKeys(), main(), MUST_NEVER_MATCH, PURGE_CALLER_ROOTS, ADR-0042

### Community 322 - "024_awcms_mfa_totp_schema.sql"
Cohesion: 0.40
Nodes (5): awcms_identity_mfa_factors, awcms_identity_mfa_recovery_codes, awcms_mfa_challenges, awcms_sessions, awcms_tenant_mfa_policies

### Community 323 - "033_awcms_theming_config_schema.sql"
Cohesion: 0.53
Nodes (5): awcms_theming_config_versions, awcms_theming_preview_sessions, awcms_theming_tenant_state, awcms_theming_versions_guard(), awcms_theming_versions_immutable

### Community 324 - "db-role-grants-narrow-migration.test.ts"
Cohesion: 0.33
Nodes (3): migrationSql, migrationStatements, repoRoot

### Community 325 - "db-role-separation-migration.test.ts"
Cohesion: 0.33
Nodes (3): migrationSql, migrationStatements, repoRoot

### Community 326 - "news-portal-no-local-fallback.test.ts"
Cohesion: 0.33
Nodes (3): FORBIDDEN_PATTERNS, NEWS_MEDIA_ROUTES_DIR, NEWS_PORTAL_SRC_DIR

### Community 327 - "HighVolumeTableDescriptor registry (owner module declares its own table)"
Cohesion: 0.40
Nodes (5): HighVolumeTableDescriptor registry (owner module declares its own table), Legal hold precedence + separate create/release permissions, LegalHoldGuardPort (source-level seam, not capability registry), data_lifecycle module (registry, dry-run, archive/purge), Two-phase retention with legal hold gated at phase 2 only

### Community 328 - "Workflow Approval Module"
Cohesion: 0.50
Nodes (5): Delegation (standing-based, not permission grant), Escalation/timeout worker job, Closed-set graph node model, Workflow Approval Module, Self-approval-deny check

### Community 329 - "awcms_sync_nodes"
Cohesion: 0.70
Nodes (4): awcms_sync_inbox, awcms_sync_nodes, awcms_sync_outbox, awcms_sync_push_batches

### Community 330 - "014_awcms_email_schema.sql"
Cohesion: 0.50
Nodes (4): awcms_email_delivery_attempts, awcms_email_messages, awcms_email_suppression_list, awcms_email_templates

### Community 331 - "025_awcms_oidc_sso_schema.sql"
Cohesion: 0.60
Nodes (4): awcms_auth_providers, awcms_external_identities, awcms_oidc_auth_requests, awcms_tenant_auth_policies

### Community 332 - "055_awcms_data_lifecycle_schema.sql"
Cohesion: 0.40
Nodes (4): awcms_data_lifecycle_archive_manifests, awcms_data_lifecycle_cursors, awcms_data_lifecycle_legal_holds, awcms_data_lifecycle_runs

### Community 333 - "correlation-response.ts"
Cohesion: 0.60
Nodes (3): CorrelationMergeResult, isApiJsonResponseCandidate(), mergeCorrelationIdIntoApiPayload()

### Community 335 - "Workflow Approval Module"
Cohesion: 0.40
Nodes (5): Versioned Event-Type Registry, Transactional Outbox Producer (appendDomainEvent), Workflow Delegation, Workflow Approval Module, Closed-set Workflow Graph Model

### Community 336 - "MediaLibraryPort Capability"
Cohesion: 0.50
Nodes (5): Media Library Module, MediaLibraryPort Capability, Presigned Direct-to-R2 Upload/Finalize Flow, R2-only Advertisement Placement Presets, News Portal Module

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

### Community 344 - "CONTRIBUTING.md"
Cohesion: 0.50
Nodes (3): bun run check (main CI validation gate), Conventional Commits convention, Definition of Done

### Community 345 - "awcms_tenants"
Cohesion: 0.83
Nodes (3): awcms_offices, awcms_tenant_settings, awcms_tenants

### Community 346 - "awcms_profiles"
Cohesion: 0.83
Nodes (3): awcms_profile_entity_links, awcms_profile_identifiers, awcms_profiles

### Community 347 - "awcms_identities"
Cohesion: 0.83
Nodes (3): awcms_identities, awcms_sessions, awcms_tenant_users

### Community 348 - "050_awcms_visitor_analytics_schema.sql"
Cohesion: 0.67
Nodes (3): awcms_visit_events, awcms_visitor_daily_rollups, awcms_visitor_sessions

### Community 349 - "060_awcms_seo_distribution_redirect_schema.sql"
Cohesion: 0.50
Nodes (3): awcms_seo_not_found_observations, awcms_seo_redirect_settings, awcms_seo_redirects

### Community 350 - "env.d.ts"
Cohesion: 0.50
Nodes (3): App, Locals, ADR-0042

### Community 352 - "Legal hold enforced at the purge, not in data_lifecycle"
Cohesion: 0.50
Nodes (4): Minimized PII (hash, mask, AES-256-GCM), comments:retention anonymization sweep, Two-phase retention: expire then purge, Legal hold enforced at the purge, not in data_lifecycle

### Community 353 - "data-lifecycle-config.ts"
Cohesion: 0.50
Nodes (3): DataLifecycleConfig, resolveDataLifecycleConfig(), ADR-0037

### Community 354 - "lifecycle-validation.ts"
Cohesion: 0.50
Nodes (3): DeleteReasonRequestBody, DeleteReasonValidationResult, ValidationError

### Community 355 - "Sync Storage Module"
Cohesion: 0.50
Nodes (4): Optimistic-concurrency Conflict Tracking, HMAC Node-to-Node Authentication (v1/v2), Sync Outbox/Inbox Event Exchange, Sync Storage Module

### Community 356 - "ThemeConfig (data, not code)"
Cohesion: 0.50
Nodes (4): CSS Value Validation by Rejection, ThemeConfig (data, not code), Theme Lifecycle (draft→publish→rollback), Theming Module

### Community 359 - "Bundle Fragment Conflict Rejection (BundleConflictError)"
Cohesion: 0.83
Nodes (4): OpenAPI Conflict Fixture: unsupported components section, OpenAPI Conflict Fixture: base path override, OpenAPI Conflict Fixture: shared schema override, Bundle Fragment Conflict Rejection (BundleConflictError)

### Community 361 - "migration-tenant-guc-consistency.test.ts"
Cohesion: 0.67
Nodes (3): ALLOWED_OTHER_GUCS, readMigrations(), stripSqlComments()

### Community 363 - "Bounded file parsing (HTTP tier + early parser abort)"
Cohesion: 0.67
Nodes (3): readJsonBody body-size limit tiers, Non-configurable sitemap/feed amplification ceilings, Bounded file parsing (HTTP tier + early parser abort)

### Community 364 - "Finalize does full GET + magic-byte sniff + server checksum"
Cohesion: 0.67
Nodes (3): Finalize does full GET + magic-byte sniff + server checksum, image/svg+xml forbidden by default (key decision #5), TOCTOU size-cap fix (readCappedStream)

### Community 365 - "Separate R2 bucket/credentials from sync-storage (key decision #1)"
Cohesion: 0.67
Nodes (3): No local fallback / no temp files (key decision #2), Separate R2 bucket/credentials from sync-storage (key decision #1), Two-flag env deployment gate (SOCIAL_PUBLISHING_ENABLED/_PROFILE)

### Community 366 - "Postgres status does not gate R2 storage access (key decision #4)"
Cohesion: 0.67
Nodes (3): Object key never contains PII/original filename (key decision #3), Postgres status does not gate R2 storage access (key decision #4), Tenant-writable auto-publish toggle (business preference, not security control)

### Community 368 - "Sprint/milestone plan"
Cohesion: 0.67
Nodes (3): Base generic GitHub issues backlog, Sprint/milestone plan, Testing pyramid strategy

### Community 369 - "Mini-First Development Flow"
Cohesion: 0.67
Nodes (3): Mini-First Development Flow, AWCMS Family (three parallel templates), Test-in-awcms-mini-then-port rule

### Community 370 - "Required Status Checks (Repository Ruleset)"
Cohesion: 1.00
Nodes (3): bun run check / CI quality gate parity, Branch Protection — Required Status Checks, Required Status Checks (Repository Ruleset)

### Community 371 - "Domain event outbox + dead-letter replay"
Cohesion: 0.67
Nodes (3): Domain Event Runtime module (API surface), Domain event outbox + dead-letter replay, HMAC-authenticated sync (push/pull/status/objects)

### Community 378 - "Secret-shaped keys rejected, not redacted"
Cohesion: 0.67
Nodes (3): Opaque JSONB payload owned by the creating module, Secret-shaped keys rejected, not redacted, Non-secret tenant module settings

### Community 379 - "evaluateManagedMediaReadiness"
Cohesion: 0.67
Nodes (3): One-way Managed-Media Enforcement, evaluateManagedMediaReadiness, Editorial Homepage Section Composer

## Ambiguous Edges - Review These
- `Permission-seed migration reaches only tenants created after it` → `Integration suite hook timeout + exit 143 misreporting fix`  [AMBIGUOUS]
  .changeset/integration-hook-timeout.md · relation: conceptually_related_to
- `GET /api/v1/tenant/modules/matrix + per-module audit summary` → `ModuleApiContract.routes + modules:routes:check (longest-prefix ownership)`  [AMBIGUOUS]
  .changeset/module-route-ownership.md · relation: conceptually_related_to

## Knowledge Gaps
- **2886 isolated node(s):** `$schema`, `changelog`, `commit`, `fixed`, `linked` (+2881 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **80 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Permission-seed migration reaches only tenants created after it` and `Integration suite hook timeout + exit 143 misreporting fix`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `GET /api/v1/tenant/modules/matrix + per-module audit summary` and `ModuleApiContract.routes + modules:routes:check (longest-prefix ownership)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `withTenant()` connect `Reporting Projection Workers` to `Tenant Transaction & Authorization Core`, `Audit Log & Idempotency`, `Database Client & Request Body Limits`, `abac-policy-evaluator.integration.test.ts`, `SSR Session & Blog Revisions`, `MFA TOTP & Recovery Codes`, `OIDC OAuth State & PKCE`, `Circuit Breaker & Provider Metrics`, `Site Search Index Engine`, `[tenantCode]/feed.xml.ts`, `Sidebar Menu Arrangement`, `v1/settings/index.ts`, `ABAC Policy Admin Routes`, `Redis Cache & Health`, `Blog Page Directory`, `public-blog-directory.ts`, `tenant-domain-directory.ts`, `dispatch-domain-events.ts`, `[revisionId].ts`, `runJob()`, `export-generation.ts`, `profiles/[id].ts`, `login.ts`, `step-up.ts`, `public-host-tenant-resolver.ts`, `media-object-directory.ts`, `object-dispatch.ts`, `workflow-definition-directory.ts`, `theming.integration.test.ts`, `audit-log-purge.ts`, `workflow-instance-decision.ts`, `email-template-directory.ts`, `auth-provider-directory.ts`, `fetchActiveTenants()`, `redirects/[id].ts`, `rollup.ts`, `business-scope.integration.test.ts`, `application/email-dispatch.ts`, `archive-purge-job.ts`, `redirect-resolution-service.ts`, `sod.integration.test.ts`, `seo-distribution.integration.test.ts`?**
  _High betweenness centrality (0.084) - this node is a cross-community bridge._
- **Why does `astro` connect `Password Reset Tokens & Delivery` to `search-diagnostics.ts`, `getRegisteredCommentableResources()`, `SSR Session & Blog Revisions`, `tenant-route.ts`, `comment-settings.ts`, `form-draft-directory.ts`, `public-search-tenant-resolution.ts`, `presentation/theme-public-css.ts`, `recordCounter()`, `MFA Config & Client Fingerprint`, `posts/[id].ts`, `report.ts`, `package.json`, `presentation/theme-preview.ts`, `serveDiscovery()`, `getRegisteredSearchSources()`, `keywords`, `comment-moderation.ts`?**
  _High betweenness centrality (0.051) - this node is a cross-community bridge._
- **Why does `recordAuditEvent()` connect `Audit Log & Idempotency` to `Tenant Transaction & Authorization Core`, `Database Client & Request Body Limits`, `MFA TOTP & Recovery Codes`, `OIDC OAuth State & PKCE`, `business-scope-assignment-service.ts`, `Reporting Projection Workers`, `Site Search Index Engine`, `domain-event-directory.ts`, `ad-placement-directory.ts`, `enable-managed-media-enforcement.ts`, `SEO Discovery Payloads`, `user-admin.ts`, `Redis Cache & Health`, `Blog Page Directory`, `consumer-state-directory.ts`, `dispatch-domain-events.ts`, `profiles/[id].ts`, `login.ts`, `step-up.ts`, `media-object-directory.ts`, `redaction.ts`, `sod-exception-service.ts`, `audit-log-purge.ts`, `email-template-directory.ts`, `auth-provider-directory.ts`, `abac-admin.ts`, `fetchActiveTenants()`, `redirects/[id].ts`, `media-object-key.ts`, `archive-purge-job.ts`, `legal-hold-service.ts`, `party-directory.ts`, `office-directory.ts`?**
  _High betweenness centrality (0.030) - this node is a cross-community bridge._
- **What connects `$schema`, `changelog`, `commit` to the rest of the system?**
  _2886 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Tenant Transaction & Authorization Core` be split into smaller, more focused modules?**
  _Cohesion score 0.031210120401708927 - nodes in this community are weakly interconnected._