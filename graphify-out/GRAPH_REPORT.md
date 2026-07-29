# Graph Report - /home/data/dev_bun/awcms  (2026-07-29)

## Corpus Check
- 105 files · ~1,355,029 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 8247 nodes · 24098 edges · 495 communities (410 shown, 85 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 406 edges (avg confidence: 0.77)
- Token cost: 791,182 input · 0 output

## Community Hubs (Navigation)
- Tenant Transaction & Auth Guard
- Audit Log & Request Hashing
- Blog Post & Page Admin API
- API Response & Body Limits
- Module Descriptor Registry
- SEO Facts Port & Metadata
- Data Lifecycle Archive & Legal Hold
- SEO Discovery Routes & Feeds
- OpenAPI Bundle & API Docs Gates
- Metrics Port & Circuit Breaker
- Public Blog Rendering
- Password Reset & Self Registration
- Site Search Query & Suggest
- package.json Script Surface
- MFA TOTP & Step-Up
- Tenant Module Lifecycle & Presets
- Scheduled Job Runner
- Retention Purge Across Modules
- ABAC Policy Evaluator
- Business Scope Assignments
- Security Readiness Checks
- Search Index Engine & Sources
- Email Announcements & Identifier Masking
- OIDC SSO Linking
- Admin Shell & Sidebar Menu
- Blog Content Validation
- Capability Contracts & Media Ownership
- Tenant Domain DNS Sync
- sod.integration.test & sod exception service
- media library port adapter & blog scheduled publish
- internal tag link rendering & internal tag linking
- domains & tenant domain directory
- tenant context & access guard
- comment service & comments domain.test
- harness & getRuntimeSql
- resolveClientIp & replies
- access control & permissionKey
- dispatch domain events & database busy refusal.test
- encodeKeysetCursor & blog search
- homepage section policy & homepage section directory
- safeErrorDetail & cache
- ad placement directory & [id]
- media reconciliation & media reconciliation categorization
- media r2 client & media r2 verification
- generic oidc client & getProviderCircuitBreaker
- public host tenant resolver & public seo tenant resolution
- post status & blog taxonomy directory
- mailketing provider & email provider resolver
- ModuleDescriptor & descriptor sync
- media object directory & media finalize upload session
- checkRateLimit & forgot
- media r2 config & resolveNewsMediaR2Config
- sync storage.test & sync auth
- check docs.mjs & docs checks.mjs
- table write ownership check & validate module routes
- news article seo metadata & blog settings directory
- AWCMS Backend & Integration Hardening (skill) & AWCMS Observability (skill)
- index & comments.integration.test
- health registry & computeGenericSignals
- collector & collectVisitorTelemetry
- collect & visitor analytics domain.test
- workflow definition directory & workflow definition lifecycle
- step up & verify
- tenant route & index
- turnstile & turnstile verifier.test
- module composition & module composition.test
- initialize & hashPassword
- auth provider directory & tenant sso policy
- capacity config & health
- content quality checklist & blog settings policy
- workflow instance & workflow graph engine
- security & tenant auth policy
- projection rebuild & rebuild run store
- workflow instance decision & workflow approval concurrency.test
- login policy & login env parsing.test
- query plan) & production:preflight read only preflight
- work class registry generate & module job registry check
- abac policy evaluator.integration.test & module tenant lifecycle.integration.test
- legacy ad ingest & media object key
- content block rendering & gallery block renderer
- party directory & party validation
- ADR 0029 & theme public css
- ADR 0016 organization structure module admission & ADR 0020 ERP extension readiness contracts
- properties & additionalProperties
- theme preview & theme preview render
- admin form client & registrations
- object storage uploader & object queue
- ADR 0039 & url change capture
- ad placement policy & validateCreateAdPlacementInput
- index & [id]
- theming.integration.test & theme service
- email dispatch & logScriptFailure
- family conformance check & main
- edge cache.test & cacheability
- theme descriptor & InvalidThemeDescriptorError
- workflow graph & validateWorkflowGraph
- package.json & generated artifacts have tooling.test
- Intentional divergence registry & MFA TOTP + recovery codes
- consumer registry & consumer state directory
- role admin & roles
- projection incremental worker & reporting projections.integration.test
- office directory & offices
- theme config & css value validation
- email template directory & email templates
- assertUuid & workflow recovery
- domain event directory & delivery replay
- export generation & local export adapter
- compilerOptions & tsconfig.json
- blog ads ingest & legacy ad ingest.integration.test
- family conformance.test & db migrate
- email template validation & announcement validation
- form draft directory & form draft validation
- blog content module & ADR 0044: merge news portal into blog content
- comments module guidance (moderation first) & 074 075, stores no credential)
- ADR 0001 Rebuild AWCMS as ERP modular monolith platform & ADR 0003 PostgreSQL + RLS multi tenant isolation
- AWCMS Public API Pre migration OpenAPI Snapshot & Email Module
- turnstile enforcement.test & validate env
- redirect safety & redirect chain
- Module Management system & Jualanku.info porting plan (ADR 0045)
- properties & adr
- identity access OpenAPI fragment & accessCreateAbacPolicy
- edge cache surfaces check & surface registry
- config & loadEdgeCacheConfig
- blog page directory & boundedPageNumber
- widget policy & widget directory
- comment settings & comment settings directory
- abac admin & abac admin validation
- blog:ads:ingest job & One way managed media enforcement (no disable path)
- seo redirect guards.test & redirect path
- sod rule registry & sod rule registry.test
- login & POST
- redirect resolution service & ADR 0028
- ads directory & toAdView
- comment moderation & comments
- append domain event & envelope
- email template render & email template categories
- user admin & validateSetStatusInput
- redirect rule & validateRedirectInput
- analytics & analytics queries
- workflow approval.test & workflow delegation
- e2e auth & provideTenant
- Generated script inventory (60 targets, 23 in the check chain) & AWCMS Public API bundled OpenAPI contract (generated)
- Five bounded contexts, not seven & jualanku directory context (merchants, membership, taxonomy, business pages, scope hierarchy)
- error log & object dispatch
- middleware & security headers
- jwt verify & oidc jwt verify.test
- menu directory & menu policy
- dashboard view & buildSessionRowCells
- family contract & validateFamilyManifestShape
- ADR 0041: comments module admission & ADR 0040: site search module admission
- Blocking quality gates (existing repo gates + Jualanku specific ones) & What stays out of bun run check, and why
- Jualanku.info implementation blueprint (plan, not code) & session — safe claims introspection endpoint (to be added, owned by identity access)
- module settings & fetchModuleSettingsView
- [id] & index
- site search.integration.test & search diagnostics
- AWCMS Project Skills catalog & integration hub module (NOT ported; port spec)
- properties & required
- required & divergence
- family & properties
- local archive adapter & archive port
- {tenantCode} (legacy) & edge cache:surfaces:check gate (probes 16 must never cache paths)
- module management OpenAPI fragment & disable lifecycle
- db role separation worker setup migration.test & site search module.test
- oidc integration.test & buildOAuthStateParam
- batching & business scope expiry job
- redaction & error sanitizer
- social share links & isAbsoluteHttpUrl
- Static Consumer Registry (DOMAIN EVENT CONSUMERS) & Domain Event Dispatcher
- access directory & abac policies
- Varnish edge cache layer (ADR 0042) & Rule 21: enqueue edge purge inside the content transaction
- checkSsoBreakGlassReady (critical readiness check) & Break glass SOP
- AWCMS = online first hybrid ERP template and AWCMS family superset & withTenant tenant context: work class gate, circuit breaker, SET LOCAL tenant GUC
- legacy ad drop readiness.integration.test & blog ads drop readiness
- ADR 0042 & edge cache purge
- projection directory & ProjectionDescriptor
- projection metric store & projection reconciliation
- person profile) & modules:table writes:check gate
- ADR 0045 — Jualanku porting: awcms system of record, awcms astro BFF & PROJECT STATE — versioned continuation point
- AWCMS technical document package index (docs 01 21 plus runbooks) & Doc 21 — module admission, lifecycle and registry governance
- adr) & ADR 0027 MFA TOTP, Session Assurance, Step up
- SSO tenant aware reference (Issue #185, ADR 0028) & token fetches
- logging lint check & scanSourceForLoggingProblems
- ADR 0041 & reply notifications
- runtime & pressure
- permission sync & fetchModulePermissionSyncReport
- event activity projection & module
- [id] & PUT
- redirect directory & toRecord
- theme lifecycle preview.test & preview token
- visitor analytics privacy.test & analytics response shaping
- awcms family compatibility.schema.json & required
- ApiError schema & form drafts OpenAPI fragment
- changeset policy check & isExempt
- ad policy & validateCreateAdInput
- seo redirect governance.integration.test & not found directory
- redirect middleware & redirect eligibility
- condition action registry & workflow condition port
- Telegram channel adapter (bot administrator + can post messages) & looksLikeRawSecretToken rejection heuristic
- ADR 0044 — merge news portal into blog content, union of features never a reduction & 001 079)
- migrationChecksum & properties
- required & contracts
- properties & familyContractVersion
- comments OpenAPI fragment & submitPublicComment
- scripts inventory & scripts inventory.test
- sync agent memory & main
- [id] & index
- blog content presentation domain.test & template policy
- video news block validation & validateVideoNewsBlock
- business scope access control.test & BusinessScopeFact
- rollup & rollupVisitorAnalyticsForDate
- awcms family compatibility.yaml (family manifest) & ADR 0032: stack version pinning non free floating
- ADR 0042: Varnish edge cache tier, off by default & edge cache purge
- Data Lifecycle module README & Reporting module (management reporting + projections)
- env contract coverage check & env contract coverage.test
- projection registry & reporting projection registry.test
- [id] & preview
- role admin validation & validatePermissionRefInput
- scheduled export dispatch & scheduled export store
- office validation & validateUpdateOfficeInput
- news portal module (historic; merged into blog content) & Finalize does a full GET plus magic byte sniff and server side checksum
- Idempotent High Risk Mutation Skill & ABAC Guard & Tenant Isolation Skill
- sign attest publish) & checkout 7.0.0→7.0.1 bump
- devDependencies & cli
- release verify checks & release verify
- HR) & Base reusable modules
- Row Level Security (RLS) & Threat Model and Security Architecture (Doc 20)
- Derived Application Guide (DEPRECATED, ADR 0034) & First Derived App Pilot Plan (AWPOS, DEPRECATED)
- check docs translation.mjs & docs i18n checks.mjs
- commentable resource registry & comments resources check
- tenant context usage check & collectUsageViolations
- compare & parseSemver
- ad placement rotation & selectAdsForRotation
- media upload session validation & validateCreateNewsMediaUploadSessionInput
- navigation registry & fetchVisibleModuleNavigationEntries
- user agent & parseUserAgent
- Mini first development flow (mature in awcms mini, then port to awcms) & Two flag full online deployment gate (SOCIAL PUBLISHING ENABLED +  PROFILE)
- retire & visitor analytics module (ported, type system)
- required & stack
- config.json & access
- ADR 0031 Segregation of Duties Conflict Enforcement & ADR 0033 Dynamic ABAC Policy Evaluator
- admin) & New permission = new seed migration (descriptor alone grants nothing)
- Eleven ERP contract families (neutral contracts, base is not ERP) & ABAC (Attribute Based Access Control)
- blog content module (epic #536, first domain module registered directly in the base) & Absorption of news portal into blog content (ADR 0044)
- site search OpenAPI fragment & siteSearchIndexRebuild
- .prettierrc.json & prettier plugin astro
- keywords & abac
- resolvePublicTenantFromRequest resolution order & awcms app fail closed default GUC
- template directory & toView
- theme policy & theme settings directory
- news portal preset readiness & news portal preset readiness.test
- run record store & listLifecycleRuns
- GOVERNANCE & Private vulnerability reporting policy
- FORCE ROW LEVEL SECURITY (ENABLE alone is inert) & micro port playbook (adapt, not copy)
- Meta adapters (Facebook Page + Instagram Business), two provider keys & Outbox discipline: job row written inside the transaction, provider call outside
- properties & astro
- Media Library Module & ADR 0036 media library Module Admission (Ownership Inversion)
- Posting (append only) & ERP Specific Threats
- data lifecycle permissions & module
- reporting projection rebuild lock.test & lockProjectionForWrite
- sync health report & sync health
- freshness & reporting projection freshness.test
- soft delete & soft delete.test
- legacy ad write path retired.test & DELETE
- ) reading guide & Changeset: sync docs, agent skills, and knowledge graph post Wave 2
- ADR 0034 Direct use Templates and Derived Pathway Removal & data lifecycle module
- authorizeInTransaction — single authorization chokepoint incl. module enabled check & Merchant modelled as a business scope, filling the fail closed hierarchy resolver
- data lifecycle module (registry + safe lifecycle engine) & Module Descriptor
- Minimal domain module example (expense category) & OpenAPI bundle (generated, one file per module)
- Correction 1 — news portal was MERGED, not 'not yet built' & Negative claims are the dangerous kind of documentation rot
- listPublicComments & siteSearchQuery
- commentableResources descriptor seam & Per tenant sidebar arrangement stored as a delta
- tenant route factory check & evaluateTenantRouteMigration
- 009 awcms domain event runtime schema.sql & awcms domain event deliveries
- 013 awcms workflow approval schema.sql & awcms workflow instances
- 015 awcms reporting projections schema.sql & awcms reporting export runs
- 035 awcms blog content schema.sql & awcms blog post terms
- 037 awcms blog content presentation schema.sql & awcms blog ad placements
- 066 awcms comments schema.sql & awcms comments comments
- suppression validation & validateSuppressionInput
- access guard field access.test & resetPolicyCache
- Per tenant Salted Visitor Key Hash & Redirect Governance (ADR 0039)
- settings validation & validateUpdateTenantSettingsInput
- [id] & PUT
- media no local fallback.test & findOffenders
- Admin sidebar rendered from module registry (sidebar menu) & Permission seed migration reaches only tenants created after it
- idn admin regions module (NOT ported; port spec) & CONTENT BLOCK TYPES runtime vocabulary
- work class registry generator + freshness gate (ghost .generated artifact) & awcms setup)
- CodeQL triage process & trivial conditional on a build time extension seam (historic)
- edge cache:purge job (structural exception, no owning module) & runJob (advisory lock per job name runner)
- declared & source
- hygiene) & family:conformance:check gate
- Changeset:   dry run for retention jobs & Unmigrated workers without cross instance lock (comments:retention, form drafts:purge, site search:reconcile, tenant domain:dns:sync)
- ModuleDescriptor contract & ADR 0025 Deterministic Build time Module Composition
- seo distribution module (discovery scope) & seo facts capability port
- Provider feature flags (default off) & Hybrid online first operating mode
- Segregation of duties (SoD) & ABAC default policy set
- Bun only backend platform standard & Admin shell & role aware navigation
- Frozen open redirect guard & Managed media enforcement (one way switch, ADR 0036)
- db pool health & main
- 005 awcms abac access control schema.sql & awcms role permissions
- online security config & isFullOnlineSecurityActive
- ADR 0015 & family conformance ci parity.test
- index & PATCH
- Email Dispatcher (claim lease outbox) & EmailProvider Port Contract
- sod conflict evaluation log & listSoDConflictEvaluations
- media r2 client.test & readCappedStream
- email health report & email health
- index & POST
- pages (ADR 0043) & matrix + per module audit summary
- Changeset: module job registry crosscheck & ModuleDescriptor.jobs (operator facing job schedule descriptor)
- deployment profiles & capacity config (fleet wide connection budget validator)
- ADR index and register (ADR 0001 to ADR 0045) & ADRs are never deleted; superseded decisions are marked and back referenced
- Idempotency & Double Payment mitigation
- withTenant integration point (SET LOCAL tenant + backpressure) & Database Connection Pooling and Backpressure
- submitFormDraft & Tenant module presets
- news share.js & enhanceCopyLinkButtons
- 024 awcms mfa totp schema.sql & awcms identity mfa factors
- 033 awcms theming config schema.sql & awcms theming config versions
- public content port adapter & public content port
- db role grants narrow migration.test & migrationSql
- db role separation migration.test & migrationSql
- Seven binding posting invariants (immutable posted, reversal, business identity uniqueness) & example erp extension fixture as machine verifiable proof
- Tenant Admin Module & Composite FK parent office (GHSA r7cx)
- Workflow Approval Module & Delegation (standing based, not permission grant)
- ADR 0039 — SEO Distribution Redirect Governance & Privacy Minimized 404 Observation Telemetry
- Module Management registry tables & Blog Content module SOP (future port)
- Varnish 7.5 edge cache service & default grace=0 belt and braces
- 010 awcms sync storage outbox inbox schema.sql & awcms sync nodes
- 014 awcms email schema.sql & awcms email delivery attempts
- 025 awcms oidc sso schema.sql & awcms auth providers
- 055 awcms data lifecycle schema.sql & awcms data lifecycle archive manifests
- correlation response & correlation response.test
- visitor analytics collect rate limit.test & resetRateLimitForTests
- Reusable wizard form component library (target spec, not ported) & postJson) mandatory import
- Issue template chooser config & Bug report issue template
- ADR 0034 — Direct Use Templates & Derived Pathway Removal & micro)
- Changeset: DATABASE BUSY typed refusal (withTenant split) & db:tenant context:check gate
- Changeset: env var .env.example coverage gate & config:env:coverage:check gate
- CONTRIBUTING & bun run check (main CI validation gate)
- Typed admin API client (admin form client) & Cookie httpOnly auth & session
- 002 awcms tenant office schema.sql & awcms tenants
- 003 awcms central profile schema.sql & awcms profiles
- 004 awcms identity login schema.sql & awcms identities
- 050 awcms visitor analytics schema.sql & awcms visit events
- 060 awcms seo distribution redirect schema.sql & awcms seo not found observations
- comments:retention anonymization sweep & Legal hold enforced at the purge, not in data lifecycle
- lifecycle validation & DeleteReasonRequestBody
- CSS Value Validation by Rejection & ThemeConfig (data, not code)
- OpenAPI Conflict Fixture: base path override & Bundle Fragment Conflict Rejection (BundleConflictError)
- migration tenant guc consistency.test & readMigrations
- FakeRedisClient & .asClient
- isFullOnlineSecurityActive shared deployment gate & TOTP paused login (state driven, not env gated)
- defineTenantRoute (mandatory tenant route opener) & NOT YET MIGRATED shrink only allow list
- :tenantCode urlTemplate placeholder (throws if unresolved) & Public tenant scoped routes via path tenantCode (ADR 0009)
- Bounded file parsing (HTTP tier + early parser abort) & readJsonBody body size limit tiers
- searchSources descriptor seam (owner declares, aggregator discovers) & seo facts capability port (content modules provide facts)
- Sync HMAC & Offline Sync & Node inactive by default registration + admin approve
- half open) & Idempotency store (awcms idempotency keys, race loser replay)
- ERD & data dictionary & RLS tenant isolation standard
- milestone plan & Base generic GitHub issues backlog
- CI quality gate parity & Branch Protection — Required Status Checks
- Static by default with on demand routes (not 'hybrid') & auth matrix
- IEC 40500:2025) & Reuse AWCMS design tokens via theming, no new token system
- Domain event outbox + dead letter replay & Domain Event Runtime module (API surface)
- 011 awcms sync storage conflict schema.sql & awcms sync aggregate versions
- 031 awcms abac policy dsl schema.sql & awcms abac decision logs
- 071 awcms sidebar menu schema.sql & awcms sidebar menu items
- author lookup & AuthorLookupRow
- Secret shaped keys rejected, not redacted & Opaque JSONB payload owned by the creating module
- Graphify tracked graph artifact refresh & Untracking .graphify labels.json
- commentableResources contribution seam (arrow must not be reversed) & comments module port (21st base module, ADR 0041)
- Modular OpenAPI fragment pipeline (ADR 0026) & Public discovery routes are Astro, not OpenAPI
- Publication state enforced at index boundary; index is not authorization & Centralized public visibility predicate tested exhaustively
- DB gated suites: .env auto enables, harness needs privileged role, two suites must not share a process & AWCMS layered test pyramid
- WCAG 2.1 AA audit checklist & UX Improvement Review guide
- astro.config.mjs & ADR 0002
- AWCMS Domain Events (AsyncAPI 3.0.0 contract) & domain event runtime reference event (outbox exerciser)
- Media library ownership inversion (ADR 0036) & theming asset resolution wired through MediaLibraryPort
- domain event runtime: generic multi consumer outbox & Transactional outbox (same commit event write)
- Redis ACL init (users.acl generator, awcms app least privilege) & Standalone optional Redis service (internal network only)
- ADR 0023 Bilingual Docs (ID source, EN default) & Docs staleness gate (i18n source hash)
- Standard error code taxonomy & AsyncAPI contract standard
- Implementation Ready & 14 sprint implementation blueprint
- Profile Identity module (API surface) & setup)
- 006 awcms setup wizard schema.sql & awcms setup state
- 007 awcms audit logging schema.sql & awcms audit events
- 012 awcms object sync queue schema.sql & awcms object sync queue
- 039 awcms blog content internal tag links schema.sql & awcms blog internal tag link settings
- 041 awcms news media object registry schema.sql & awcms news media objects
- 043 awcms news portal tenant state schema.sql & awcms news portal tenant state
- 044 awcms news portal homepage sections schema.sql & awcms news portal homepage sections
- 045 awcms news portal ad placements schema.sql & awcms news portal ad placements
- 046 awcms tenant domain schema.sql & awcms tenant domains
- 053 awcms media library tenant state schema.sql & awcms media library tenant state
- 057 awcms seo distribution config schema.sql & awcms seo tenant settings
- 059 awcms seo distribution feed config schema.sql & awcms seo tenant settings
- 062 awcms form drafts schema.sql & awcms form drafts
- 064 awcms site search schema.sql & awcms site search documents
- 068 awcms edge cache purge queue.sql & awcms edge cache purges
- 073 awcms identity password reset schema.sql & awcms password reset tokens
- 074 awcms identity self registration schema.sql & awcms registration requests
- 078 awcms ad placement targeting.sql & awcms news portal ad placements
- 079 awcms legacy ad ingest provenance.sql & awcms news portal ad placements
- One way Managed Media Enforcement & evaluateManagedMediaReadiness
- Dangling DNS domain takeover residual risk (M1) & Immutable hostname, atomic set primary
- tenant domain:dns:sync reconciliation job & Drifted records moved, never duplicated or deleted
- Timeout Dispatch & Concurrency & Quorum Integrity
- Browser E2E Test (Playwright+Bun) Skill
- GitHub Snapshot Refresh Skill
- fail)
- Edge cache dual obligation (purge enqueue + surface registry)
- Standard error code catalog
- Migration naming NNN awcms <area> <desc>.sql
- COMMIT in migrations)
- AWCMS Repo Inventory Regenerate (skill)
- Five live management reporting views
- Canonical host derived server side, never from Host header
- renderControlledJsonLd (closed union, escaped)
- Redirect governance + 404 telemetry (ADR 0039)
- renderSafeSnippet escape then sentinel ordering (XSS)
- Two layer content sanitization testing (input + render)
- Public auth pages must return uniform post submit messages (no oracle)
- Never render disabled controls as sole capability guard
- Design tokens & state pattern (doc 14)
- Dependabot config (bun + github actions)
- GitHub Sponsor FUNDING config
- PR template Definition of Done checklist
- Mandatory Per Task Workflow (branch first, atomic PR, bun run check)
- Bun does not transmit non standard HTTP methods (BAN  > GET)
- Varnish ban expression whitespace defect (invalidation never worked)
- 070 repair + migration tenant guc consistency gate
- README generated inventory
- Migration runner (checksum, immutable once applied)
- ADR 0000 Template
- Accepted but not implemented admission notice
- Binary content referenced, never stored as DB blobs
- AI Business Analyst module
- Central Profile module
- Changesets SemVer versioning
- Sequential migration order & numbering
- Repository structure & module layout
- LAN first
- Stock Movement (append only)
- Inbox
- ISO 27001 Compliance Matrix (target)
- pool probes)
- Operator safe Delivery Replay
- Email Template Management + Category Allowlist
- WORKFLOW ACTION HANDLERS

## God Nodes (most connected - your core abstractions)
1. `getDatabaseClient()` - 552 edges
2. `fail()` - 517 edges
3. `ok()` - 501 edges
4. `withTenant()` - 481 edges
5. `hashSessionToken()` - 473 edges
6. `resolveAuthInputs()` - 449 edges
7. `authorizeInTransaction()` - 439 edges
8. `recordAuditEvent()` - 293 edges
9. `bodyTooLargeResponse()` - 218 edges
10. `readJsonBody()` - 195 edges

## Surprising Connections (you probably didn't know these)
- `GET /api/v1/auth/session — safe-claims introspection endpoint (to be added, owned by identity_access)` --semantically_similar_to--> `padUnresolvedTenantLatency — timing side-channel fix for host-based tenant probing`  [INFERRED] [semantically similar]
  docs/awcms/jualanku/05-kontrak-sesi-dan-bff.md → src/modules/blog-content/README.md
- `Polymorphic target_id without foreign key` --semantically_similar_to--> `owner_resource_type/owner_resource_id: polymorphic reference without FK`  [INFERRED] [semantically similar]
  .changeset/ad-placement-targeting.md → .claude/skills/awcms-news-portal/SKILL.md
- `Known gap: /blog/{tenantCode} has no module-disabled check` --semantically_similar_to--> `13-case negative-authorization test matrix (must be red first)`  [INFERRED] [semantically similar]
  src/modules/blog-content/README.md → docs/awcms/jualanku/02-model-tenant-merchant-otorisasi.md
- `Two public visibility predicates (listing strict, detail allows unlisted)` --semantically_similar_to--> `jualanku_directory context (merchants, membership, taxonomy, business pages, scope hierarchy)`  [INFERRED] [semantically similar]
  src/modules/blog-content/README.md → docs/awcms/jualanku/03-bounded-context-dan-model-data.md
- `Target endpoint inventory (public / portal merchant / portal affiliate / admin)` --semantically_similar_to--> `Blog Content OpenAPI module fragment`  [INFERRED] [semantically similar]
  docs/awcms/jualanku/04-kontrak-api.md → openapi/modules/blog-content.openapi.yaml

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Legacy free-URL ad retirement sequence (ADR-0044 Fase 2)** — _changeset_merge_news_portal_into_blog_content_adr_0044_merge, _changeset_ad_placement_targeting_placement_targeting_widening, _changeset_blog_ads_ingest_blog_ads_ingest_job, _changeset_blog_ads_write_path_retired_endpoint_retired_410, _changeset_blog_ads_write_path_retired_drop_readiness_gate [EXTRACTED 1.00]
- **Closing the managed-media bypass across modules** — _claude_skills_awcms_media_library_skill_media_library_module, _claude_skills_awcms_media_library_skill_one_way_enforcement, _changeset_merge_news_portal_into_blog_content_dual_ad_systems_hazard, _changeset_blog_ads_write_path_retired_endpoint_retired_410, _claude_skills_awcms_blog_content_skill_media_library_capability_consumption [INFERRED 0.85]
- **Traps that report success while doing nothing** — _claude_skills_awcms_edge_cache_skill_ban_whitespace_trap, _claude_skills_awcms_edge_cache_skill_bun_nonstandard_method_trap, _claude_skills_awcms_edge_cache_skill_guc_name_mismatch_trap, _claude_skills_awcms_edge_cache_skill_purge_without_surface_noop, _changeset_blog_ads_write_path_retired_rls_masking_mutation_lesson [INFERRED 0.85]
- **Pre-tenant-context public tenant resolution (bootstrap read path)** — _claude_skills_awcms_tenant_domain_routing_skill_awcms_resolve_tenant_domain_lookup, _claude_skills_awcms_tenant_domain_routing_skill_awcms_domain_bootstrap_role, _claude_skills_awcms_tenant_domain_routing_skill_tenant_domains_bootstrap_read_policy, _claude_skills_awcms_tenant_domain_routing_skill_resolve_public_tenant_from_request, _claude_skills_awcms_visitor_analytics_skill_public_ingest_endpoint, docs_architecture_rls_exception_allow_list [EXTRACTED 1.00]
- **Social provider adapter contract and its three concrete implementations** — _claude_skills_awcms_social_publishing_skill_social_provider_adapter, _claude_skills_awcms_social_publishing_skill_meta_provider_adapter, _claude_skills_awcms_social_publishing_skill_linkedin_provider_adapter, _claude_skills_awcms_social_publishing_skill_telegram_provider_adapter, _claude_skills_awcms_social_publishing_skill_supported_account_types_enforcement, _claude_skills_awcms_social_publishing_skill_accounts_verify_endpoint [EXTRACTED 1.00]
- **awcms-micro absorption program (ADR-0035 waves and landed modules)** — docs_awcms_absorb_awcms_micro_roadmap_absorption_roadmap, docs_project_state_absorption_waves, docs_adr_0044_merge_news_portal_into_blog_content_merge_decision, _claude_skills_awcms_tenant_domain_routing_skill_tenant_domain, _claude_skills_awcms_visitor_analytics_skill_visitor_analytics, _claude_skills_awcms_theming_skill_theming, _claude_skills_awcms_social_publishing_skill_social_publishing [EXTRACTED 1.00]
- **The five Jualanku domain modules that together replace a seven-context split** — docs_awcms_jualanku_03_bounded_context_dan_model_data_five_bounded_contexts, docs_awcms_jualanku_03_bounded_context_dan_model_data_jualanku_directory, docs_awcms_jualanku_03_bounded_context_dan_model_data_jualanku_catalog_growth, docs_awcms_jualanku_03_bounded_context_dan_model_data_jualanku_affiliate, docs_awcms_jualanku_03_bounded_context_dan_model_data_jualanku_commercial, docs_awcms_jualanku_03_bounded_context_dan_model_data_jualanku_trust_operations [EXTRACTED 1.00]
- **Cross-origin portal session flow (browser -> BFF -> awcms) and its controls** — docs_awcms_jualanku_01_arsitektur_porting_bff_mandate, docs_awcms_jualanku_05_kontrak_sesi_dan_bff_cross_origin_session_contract, docs_awcms_jualanku_05_kontrak_sesi_dan_bff_session_introspection_endpoint, docs_awcms_jualanku_05_kontrak_sesi_dan_bff_bff_obligations, docs_awcms_jualanku_05_kontrak_sesi_dan_bff_threat_model, openapi_awcms_public_api_openapi_security_schemes [EXTRACTED 1.00]
- **Edge cache purge pipeline: surface declaration -> in-transaction enqueue -> worker -> VCL ban** — docs_awcms_edge_cache_architecture_surface_registry, docs_awcms_edge_cache_architecture_surfaces_check_gate, docs_awcms_edge_cache_architecture_purge_invalidation_scopes, docs_awcms_edge_cache_architecture_purge_wire_protocol, src_modules_blog_content_readme_blog_content_module, scripts_readme_script_inventory, docs_awcms_environments_edge_cache_rollout [EXTRACTED 1.00]
- **withTenant/withTenantOrThrow typed-refusal redesign group** — concept_db_tenant_context_check, changeset_database_busy_typed_refusal [EXTRACTED 0.90]
- **Anonymous surfaces answer uniformly: no enumeration oracle anywhere** — _claude_skills_awcms_comments_skill_public_write_security, _changeset_self_registration_flow, _changeset_password_reset_via_email_flow, _claude_skills_awcms_blog_content_skill_public_visibility_predicates [INFERRED 0.85]
- **Break-glass guarantee: save-time policy check plus runtime drift re-derivation** — _changeset_sso_break_glass_readiness_savetenantauthpolicy, _changeset_sso_break_glass_readiness_checkssobreakglassready, _changeset_sso_break_glass_readiness_fetcheligiblebreakglassidentityids, _changeset_sso_break_glass_readiness_evaluatebreakglassrequirement, docs_awcms_oidc_sso_break_glass_sop [EXTRACTED 1.00]
- **ADR-0013 §6 single-writer table ownership enforcement** — _changeset_table_write_ownership_gate_modules_table_writes_check, _changeset_table_write_ownership_gate_no_shared_table_write, _changeset_table_write_ownership_gate_derived_ownership, _changeset_table_write_ownership_gate_excusedowner, src_modules_profile_identity_readme_createpersonprofileforidentity, src_modules_identity_access_readme_auth_notification_port [EXTRACTED 1.00]
- **Registry contribution seams: owner module declares, aggregator discovers via listModules()** — _claude_skills_awcms_comments_skill_commentableresources, _claude_skills_awcms_data_lifecycle_skill_highvolumetabledescriptor, _changeset_admin_sidebar_from_registry_sidebar, _changeset_module_route_ownership_routes [INFERRED 0.85]
- **ADR-0006 Provider-Outside-Transaction Discipline** — _claude_skills_awcms_integration_skill_adr_0006, _claude_skills_awcms_integration_skill_transactional_outbox, _claude_skills_awcms_integration_hub_skill_outbound_fanout_consumer, _claude_skills_awcms_observability_skill_extension_point [INFERRED 0.85]
- **Tenant isolation enforcement stack (FORCE RLS + composite FK + least-privilege roles + scoped bootstrap read)** — _claude_skills_awcms_new_migration_skill_forcerls, _claude_skills_awcms_new_migration_skill_compositefk, _claude_skills_awcms_new_migration_skill_workerrolegrants, docs_adr_0016_organization_structure_module_admission_tenantvslegalentity [INFERRED 0.85]
- **Direct-Use / Online-First-Superset Governance Chain** — agents_adr_0034_derived_pathway_removal, agents_adr_0020_erp_readiness_contracts, agents_awcms_family_direct_use [EXTRACTED 1.00]
- **Family conformance manifest + stack pinning group** — awcms_family_compatibility_manifest, concept_family_conformance_check, concept_stack_astro_declared, changeset_astro_7_1_3 [EXTRACTED 0.90]
- **AWCMS foundation technical standards (ADR-0001 baseline)** — docs_adr_0001_rebuild_on_awcms_foundation_erp_scope_decision, docs_adr_0002_bun_only_runtime_decision, docs_adr_0003_postgresql_rls_multi_tenant_decision, docs_adr_0004_rbac_abac_default_deny_decision, docs_adr_0005_soft_delete_and_immutability_decision, docs_adr_0006_offline_first_sync_outbox_decision, docs_adr_0007_openapi_asyncapi_contracts_decision [EXTRACTED 0.90]
- **Ported/hardened login security controls (MFA, OIDC, Turnstile)** — docs_adr_0027_mfa_totp_session_assurance_step_up_adr, docs_adr_0028_oidc_sso_tenant_aware_account_linking_break_glass_adr, docs_adr_0029_deployment_profile_aware_turnstile_bot_protection_adr [EXTRACTED 0.90]
- **Wave 2 ERP authorization stack (business-scope, SoD, ABAC)** — docs_adr_0030_business_scope_hierarchy_generic_authorization_layer_adr, docs_adr_0031_segregation_of_duties_conflict_enforcement_adr, docs_adr_0033_abac_dynamic_policy_evaluator_adr [EXTRACTED 0.90]
- **SEO discovery renderer + seam + surfaces** — docs_adr_0038_seo_distribution_module_admission_discovery_scope_seo_distribution_module, docs_adr_0038_seo_distribution_module_admission_discovery_scope_seo_facts_port, docs_adr_0038_seo_distribution_module_admission_discovery_scope_discovery_routes, docs_adr_0038_seo_distribution_module_admission_discovery_scope_host_poisoning_defense [EXTRACTED 1.00]
- **Descriptor-list contribution seam pattern (inward, many providers)** — docs_adr_0040_site_search_module_admission_search_source_descriptor, docs_adr_0041_comments_module_admission_commentable_resources, docs_adr_0040_site_search_module_admission_inward_dependency_direction, docs_awcms_21_module_admission_governance_lifecycle_vs_capability_dependency [EXTRACTED 1.00]
- **Edge-cache defence in depth (allow-list, labelling, default-deny VCL, anchored invalidation)** — docs_adr_0042_varnish_edge_cache_auto_activation_decide_cacheability, docs_adr_0042_varnish_edge_cache_auto_activation_default_deny_vcl, docs_adr_0042_varnish_edge_cache_auto_activation_surrogate_key_invalidation, docs_adr_0042_varnish_edge_cache_auto_activation_cache_key_space_bound [EXTRACTED 1.00]
- **AWCMS security baseline (RBAC/ABAC/RLS/audit/idempotency)** — docs_awcms_17_default_seed_rbac_abac_rbac_abac_model, docs_awcms_04_erd_data_dictionary_rls_standard, docs_awcms_10_template_kode_coding_standard_abac_guard [INFERRED 0.85]
- **AWCMS layered security control stack** — docs_awcms_19_glossary_terminology_rls, docs_awcms_19_glossary_terminology_abac, docs_awcms_19_glossary_terminology_default_deny, docs_awcms_19_glossary_terminology_idempotency, docs_awcms_20_threat_model_security_architecture_layered_controls [INFERRED 0.85]
- **Database pooling / backpressure protection stack** — docs_awcms_database_pooling_bun_sql_pool, docs_awcms_database_pooling_work_class_gate, docs_awcms_database_pooling_circuit_breaker, docs_awcms_database_pooling_withtenant [EXTRACTED 0.85]
- **Job registry / work-class scheduling crosscheck group** — concept_moduledescriptor_jobs, concept_job_work_class_registry, concept_modules_jobs_check, changeset_module_job_registry_crosscheck, concept_runjob [EXTRACTED 0.85]
- **Derived-application / ERP-extension composition model** — docs_awcms_derived_application_guide_build_time_composition, docs_awcms_api_contribution_guide_modular_openapi, docs_awcms_erp_extension_contracts_eleven_contracts, docs_awcms_derived_app_pilot_purchase_requisition_plan_pilot [INFERRED 0.75]
- **Non-production safety interlock (target guard reuse)** — docs_awcms_production_preflight_runbook_authorizeapply, docs_awcms_resilience_dr_verification_target_guard, docs_awcms_performance_suite_safety_interlock [EXTRACTED 0.90]
- **Production readiness preflight orchestration** — docs_awcms_production_readiness_config_validate, docs_awcms_production_readiness_security_readiness, docs_awcms_production_readiness_db_pool_health, docs_awcms_production_readiness_preflight_orchestrator, docs_awcms_production_preflight_runbook_preflight [EXTRACTED 0.90]
- **Layered login-flow security (Turnstile/MFA/OIDC)** — docs_awcms_turnstile_bot_protection_turnstile, docs_awcms_mfa_totp_step_up_mfa, docs_awcms_mfa_totp_step_up_per_factor_lockout [INFERRED 0.80]
- **Verified R2 media-object dependency (managed media)** — openapi_modules_media_library_openapi_newsmediaobjectitem, openapi_modules_media_library_openapi_enforcement, openapi_modules_theming_openapi_module, openapi_modules_seo_distribution_openapi_module [EXTRACTED 0.90]
- **Layered authorization stack behind one chokepoint** — src_modules_identity_access_readme_authorizeintransaction, src_modules_identity_access_readme_evaluateaccess, src_modules_identity_access_readme_abac_dsl_evaluator, src_modules_identity_access_readme_business_scope_hierarchy, src_modules_identity_access_readme_sod_enforcement [EXTRACTED 1.00]
- **Capability Port Seam Pattern (provides/consumes)** — src_modules_media_library_readme_media_library_port, src_modules_seo_distribution_readme_seo_facts_contract, src_modules_workflow_approval_readme_condition_registry, src_modules_sync_storage_readme_object_uploader, src_modules_email_readme_email_provider_contract [INFERRED 0.75]
- **ADR-0006 Transactional Outbox / Three-phase Dispatcher Pattern** — src_modules_domain_event_runtime_readme_dispatcher, src_modules_email_readme_email_dispatcher, src_modules_sync_storage_readme_object_dispatcher [INFERRED 0.85]

## Communities (495 total, 85 thin omitted)

### Community 0 - "Tenant Transaction & Auth Guard"
Cohesion: 0.03
Nodes (272): hashSessionToken(), getDatabaseClient(), withTenant(), fetchBlogPageById(), countExistingTagTermIds(), isBlogContentStatus(), listConsumerStates(), deleteFormDraft() (+264 more)

### Community 1 - "Audit Log & Request Hashing"
Cohesion: 0.04
Nodes (154): POOL_MAX_OVERRIDE_ENV_VAR, sharedClients, purgeBlogPost(), restoreBlogPost(), bulkModerateComments(), moderateComment(), rejectSoDConflictException(), AuditEventInput (+146 more)

### Community 2 - "Blog Post & Page Admin API"
Cohesion: 0.05
Nodes (90): enqueueModuleContentPurge(), readJsonBody(), softDeleteBlogPage(), BlogPostAdminListRow, BlogPostRow, BlogPostSummary, BlogPostSummaryRow, BlogPostView (+82 more)

### Community 3 - "API Response & Body Limits"
Cohesion: 0.04
Nodes (80): BODY_SIZE_TIER_BYTES, BodyReadResult, BodySizeTier, bodyTooLargeResponse(), checkContentLengthCeiling(), parseDeclaredLength(), readCappedText(), readTextBody() (+72 more)

### Community 4 - "Module Descriptor Registry"
Cohesion: 0.03
Nodes (68): ADR-0026, ADR-0028, ADR-0034, commentsModule, ADR-0006, domainEventRuntimeModule, emailModule, FORM_DRAFT_PERMISSIONS (+60 more)

### Community 5 - "SEO Facts Port & Metadata"
Cohesion: 0.04
Nodes (75): blogContentSeoFactsAdapter, BlogPostSeoRow, buildArticleJsonLd(), createBlogContentSeoFactsAdapter(), deriveVisibility(), robotsFor(), toFacts(), fetchTenantModuleEntry() (+67 more)

### Community 6 - "Data Lifecycle Archive & Legal Hold"
Cohesion: 0.05
Nodes (68): main(), runBoundedBatches(), assertSafeIdentifier(), computeCutoff(), DataLifecycleArchivePurgeResult, RunArchivePurgeOptions, runDataLifecycleArchivePurge(), runGenericArchivePass() (+60 more)

### Community 7 - "SEO Discovery Routes & Feeds"
Cohesion: 0.07
Nodes (69): RFC-822, notFoundTextResponse(), notFoundXmlResponse(), serverErrorTextResponse(), serverErrorXmlResponse(), escapeXmlText(), PrimaryHostRow, fetchSeoSettingsUpdatedAt() (+61 more)

### Community 8 - "OpenAPI Bundle & API Docs Gates"
Cohesion: 0.05
Nodes (73): RFC-2606, runApiDocsCheck(), AnyRecord, asArray(), asRecord(), buildApiReferenceMarkdown(), buildRawApiReferenceMarkdown(), ENVELOPE_SCHEMA_NAMES (+65 more)

### Community 9 - "Metrics Port & Circuit Breaker"
Cohesion: 0.05
Nodes (61): CircuitBreaker, CircuitBreakerOptions, CircuitState, circuitStateRank(), createCircuitBreaker(), decorateWithMetrics(), deriveProviderFamilyLabel(), getDatabaseCircuitBreaker() (+53 more)

### Community 10 - "Public Blog Rendering"
Cohesion: 0.09
Nodes (65): isPostgresClientInputError(), POSTGRES_CLIENT_INPUT_ERROR_CLASSES, runTenantWork(), withTenantOrThrow(), ADR-0009, ADR-0010, errorPage(), notFoundHtmlResponse() (+57 more)

### Community 11 - "Password Reset & Self Registration"
Cohesion: 0.05
Nodes (64): RFC-5321, generateResetToken(), hashResetToken(), openUrlParams(), resolveUrlParamKey(), sealUrlParams(), CompletePasswordResetResult, INELIGIBLE (+56 more)

### Community 12 - "Site Search Query & Suggest"
Cohesion: 0.05
Nodes (65): buildPublicHostResolverConfigFromEnv(), checkSiteSearchGate(), padUnresolvedSearchTenantLatency(), SiteSearchTenantHandler, ADR-0040, withSiteSearchTenant(), recordSearchQuery(), ADR-0040 (+57 more)

### Community 13 - "package.json Script Surface"
Cohesion: 0.03
Nodes (76): scripts, analytics:purge, analytics:rollup, api:docs:check, api:docs:generate, api:spec:check, api:tenant-route:check, blog:ads:drop-readiness (+68 more)

### Community 14 - "MFA TOTP & Step-Up"
Cohesion: 0.06
Nodes (62): RFC-4226, RFC-4648, AUTH_MFA_REQUIRED_WHEN_ENABLED, KNOWN_TOTP_DIGITS, resolveMfaLockoutMinutes(), resolveMfaMaxVerifyAttempts(), resolveStepUpTtlSec(), resolveTotpDigits() (+54 more)

### Community 15 - "Tenant Module Lifecycle & Presets"
Cohesion: 0.06
Nodes (57): fetchModuleCatalog(), fetchModuleCatalogEntry(), fetchRegistryRows(), ModuleCatalogEntry, ModuleRegistryRow, DEPENDENCY_WARNING_CODES, fetchModuleMatrix(), ModuleMatrixRow (+49 more)

### Community 16 - "Scheduled Job Runner"
Cohesion: 0.12
Nodes (53): main(), main(), main(), DomainEventsDispatchOptions, DomainEventsDispatchRunResult, main(), runDomainEventsDispatch(), main() (+45 more)

### Community 17 - "Retention Purge Across Modules"
Cohesion: 0.07
Nodes (47): AuditLogPurgeOptions, AuditLogPurgeResult, resolveRetentionDays(), runAuditLogPurge(), main(), resolveRetentionDays(), TenantRow, ADR-0037 (+39 more)

### Community 18 - "ABAC Policy Evaluator"
Cohesion: 0.06
Nodes (60): cache, CacheEntry, compileRow(), loadActivePolicies(), PolicyRow, queryAndCompile(), versions, AbacPass (+52 more)

### Community 19 - "Business Scope Assignments"
Cohesion: 0.06
Nodes (50): ADR-0030, BusinessScopeAssignmentDbRow, BusinessScopeAssignmentRow, createBusinessScopeAssignment(), CreateBusinessScopeAssignmentResult, listBusinessScopeAssignments(), ListBusinessScopeAssignmentsFilter, revokeBusinessScopeAssignment() (+42 more)

### Community 20 - "Security Readiness Checks"
Cohesion: 0.06
Nodes (55): ADR-0039, ADR-0042, ALL_FOUR_PRIVILEGES, ALL_WRITE_PRIVILEGES, checkAbacDefaultDeny(), checkAppDbUserNotSuperuser(), checkAuditLogTableReachable(), checkCommentsSecretsConfigured() (+47 more)

### Community 21 - "Search Index Engine & Sources"
Cohesion: 0.06
Nodes (56): main(), readFlag(), TenantRow, ADR-0040, main(), ADR-0040, SearchSourceDescriptor, countSource() (+48 more)

### Community 22 - "Email Announcements & Identifier Masking"
Cohesion: 0.07
Nodes (46): AnnouncementPreviewResult, BoundedTargets, enqueueAnnouncement(), EnqueueAnnouncementResult, previewAnnouncement(), resolveAnnouncementTargets(), resolveBoundedAnnouncementTargets(), ResolvedRecipient (+38 more)

### Community 23 - "OIDC SSO Linking"
Cohesion: 0.08
Nodes (50): computePkceChallengeS256(), generateOAuthState(), generateOidcNonce(), generatePkceVerifier(), hashOAuthState(), parseOAuthStateParam(), sanitizeReturnTo(), isSsoEnabled() (+42 more)

### Community 24 - "Admin Shell & Sidebar Menu"
Cohesion: 0.08
Nodes (40): buildSidebarEditorModel(), fetchRenderedSidebar(), fetchSidebarArrangement(), ItemRow, resetSidebarArrangement(), saveSidebarArrangement(), SidebarEditorModel, TypeRow (+32 more)

### Community 25 - "Blog Content Validation"
Cohesion: 0.09
Nodes (50): CreateBlogPageValidationResult, SoftDeleteBlogPageInput, SoftDeleteBlogPageValidationResult, UpdateBlogPageValidationResult, validateCreateBlogPageInput(), validateFeaturedMediaId(), validateMenuOrder(), validateParentPageId() (+42 more)

### Community 26 - "Capability Contracts & Media Ownership"
Cohesion: 0.06
Nodes (29): ADR-0009, ADR-0020, blogContentModule, ADR-0036, ADR-0038, ADR-0040, ADR-0041, ADR-0044 (+21 more)

### Community 27 - "Tenant Domain DNS Sync"
Cohesion: 0.06
Nodes (39): RFC-2181, main(), TenantRow, ReconcileOutcome, reconcileServingRecords(), ReconcileSummary, resolveServingTarget(), ServingDomainRow (+31 more)

### Community 28 - "sod.integration.test & sod exception service"
Cohesion: 0.06
Nodes (43): checkHighRiskSoDConflicts(), DEFAULT_SOD_RELEVANT_PERMISSION_KEYS, extractRequestedScope(), HighRiskSoDCheckOptions, HighRiskSoDCheckResult, relevantKeysFor(), SOD_RULES, approveSoDConflictException() (+35 more)

### Community 29 - "media library port adapter & blog scheduled publish"
Cohesion: 0.06
Nodes (36): DuePostRow, PublishDueScheduledPostsOptions, PublishDueScheduledPostsResult, ADR-0006, ChecklistEvaluableContent, evaluateContentQualityChecklistForContent(), EvaluateContentQualityChecklistOptions, SocialPreviewFallbackOptions (+28 more)

### Community 30 - "internal tag link rendering & internal tag linking"
Cohesion: 0.07
Nodes (42): buildTagArchiveUrl(), InternalTagLinkingContext, InternalTagLinkingDisabledReason, InternalTagLinkingPreview, previewInternalTagLinksForContent(), resolveInternalTagLinkingContext(), DEFAULT_SETTINGS, fetchInternalTagLinkingSettings() (+34 more)

### Community 31 - "domains & tenant domain directory"
Cohesion: 0.06
Nodes (41): createTenantDomain(), fetchActiveTenantDomain(), listTenantDomains(), setPrimaryTenantDomain(), SetPrimaryTenantDomainResult, softDeleteTenantDomain(), TenantDomainListPage, TenantDomainListRow (+33 more)

### Community 32 - "tenant context & access guard"
Cohesion: 0.07
Nodes (32): astro, RejectionCause, TenantWorkOutcome, WithTenantOptions, publicContentPortAdapter, listAuditEvents(), IdempotencyRaceLostError, isKnownAnalyticsRange() (+24 more)

### Community 33 - "comment service & comments domain.test"
Cohesion: 0.08
Nodes (39): CommentCursor, CommentRow, EditCommentResult, isBoundAuthor(), isDuplicate(), PublicCommentView, recordAbuseEvent(), ReportReason (+31 more)

### Community 34 - "harness & getRuntimeSql"
Cohesion: 0.09
Nodes (36): listBreakGlassCandidates(), ADR-0044, candidates(), seedAccount(), seedTenant(), FORCED_RLS_TABLES, seedTwoTenants(), activateAppRole() (+28 more)

### Community 35 - "resolveClientIp & replies"
Cohesion: 0.10
Nodes (33): App, Locals, resolveSsrContext(), SsrContext, Bucket, buckets, isTrustedProxyEnabled(), RateLimitConfig (+25 more)

### Community 36 - "access control & permissionKey"
Cohesion: 0.09
Nodes (33): ContentOwnershipAttributes, evaluateContentUpdateAccess(), ADR-0004, evaluatePageUpdateAccess(), PageOwnershipAttributes, ADR-0004, UPDATE_GUARD, evaluatePostUpdateAccess() (+25 more)

### Community 37 - "dispatch domain events & database busy refusal.test"
Cohesion: 0.07
Nodes (31): DatabaseBusyError, WorkClass, classifyError(), NOT_RETRYABLE_SQLSTATE_CLASSES, RETRYABLE_SQLSTATE_CLASSES, RETRYABLE_SQLSTATES, RetryClassification, ADR-0006 (+23 more)

### Community 38 - "encodeKeysetCursor & blog search"
Cohesion: 0.07
Nodes (36): BlogSearchResourceType, BlogSearchResult, BlogSearchResultItem, BlogSearchRow, searchBlogContentAdmin(), SearchBlogContentAdminFilter, searchPublicBlogContent(), SearchPublicBlogContentFilter (+28 more)

### Community 39 - "homepage section policy & homepage section directory"
Cohesion: 0.09
Nodes (39): createHomepageSection(), fetchHomepageSectionById(), HomepageSectionRow, HomepageSectionView, listActiveHomepageSectionsForRendering(), listHomepageSections(), softDeleteHomepageSection(), toView() (+31 more)

### Community 40 - "safeErrorDetail & cache"
Cohesion: 0.12
Nodes (35): config, failures, findings, safeErrorDetail, deleteRedisCache(), getRedisJson(), redisCacheAside(), RedisCacheAsideOptions (+27 more)

### Community 41 - "ad placement directory & [id]"
Cohesion: 0.09
Nodes (37): ActiveAdPlacementForRendering, ActiveAdPlacementRow, AdPlacementRow, AdPlacementView, createAdPlacement(), fetchAdPlacementById(), listActiveAdPlacementsForRendering(), listAdPlacements() (+29 more)

### Community 42 - "media reconciliation & media reconciliation categorization"
Cohesion: 0.09
Nodes (37): fetchNewsMediaObjectsForReconciliation(), markNewsMediaObjectFailed(), markStaleOrphanedNewsMediaObjectDeleted(), objectKeyExistsForTenant(), purgeExpiredPendingNewsMediaObject(), cleanupExpiredPending(), cleanupOrphanInR2(), cleanupStaleOrphaned() (+29 more)

### Community 43 - "media r2 client & media r2 verification"
Cohesion: 0.06
Nodes (32): NewsMediaR2VerificationRejectionReason, NewsMediaR2VerificationResult, ADR-0006, verifyNewsMediaR2Object(), VerifyNewsMediaR2ObjectInput, decideNewsMediaFinalizeOutcome(), NewsMediaFinalizeDecision, NewsMediaFinalizeDecisionInput (+24 more)

### Community 44 - "generic oidc client & getProviderCircuitBreaker"
Cohesion: 0.09
Nodes (35): RFC-1918, discoverOidcConfiguration(), DiscoverOidcResult, discoveryCache, discoveryFailureCache, exchangeAuthorizationCode(), ExchangeCodeParams, ExchangeCodeResult (+27 more)

### Community 45 - "public host tenant resolver & public seo tenant resolution"
Cohesion: 0.08
Nodes (31): defaultDeps, extractHostHeader(), fetchActivePublicTenantById(), isValidHostnameShape(), normalizePublicHost(), PublicHostResolverConfig, PublicHostResolverDeps, PublicTenantResolutionMode (+23 more)

### Community 46 - "post status & blog taxonomy directory"
Cohesion: 0.09
Nodes (34): BlogTermRow, BlogTermView, createBlogTerm(), fetchBlogTermById(), fetchBlogTermsByTaxonomyType(), listBlogTerms(), ListBlogTermsFilter, toView() (+26 more)

### Community 47 - "mailketing provider & email provider resolver"
Cohesion: 0.09
Nodes (26): main(), EMAIL_MAILKETING_REQUIRED_WHEN_SELECTED, EMAIL_REQUIRED_WHEN_ENABLED, EmailProviderKind, isKnownEmailProvider(), KNOWN_EMAIL_PROVIDERS, resolveEmailSendTimeoutMs(), EmailAddress (+18 more)

### Community 48 - "ModuleDescriptor & descriptor sync"
Cohesion: 0.10
Nodes (28): findLibNamespaceViolations(), LIB_NAMESPACE_ALIASES, LIB_NAMESPACE_EXCEPTIONS, libNamespaces(), LibNamespaceViolation, main(), DescriptorSyncResult, fetchExistingModules() (+20 more)

### Community 49 - "media object directory & media finalize upload session"
Cohesion: 0.08
Nodes (32): ADR-0006, defaultR2ClientFactory(), FinalizeNewsMediaUploadSessionDeps, FinalizeNewsMediaUploadSessionInput, PrecheckResult, ADR-0006, VERIFY_GUARD, attachNewsMediaObject() (+24 more)

### Community 50 - "checkRateLimit & forgot"
Cohesion: 0.12
Nodes (29): setLogSink(), hashClientIp(), PLACEHOLDER_SECRETS, resetClientFingerprintKeyForTests(), resolveIpHashKey(), summarizeUserAgent(), checkRateLimit(), enforceTurnstileIfRequired() (+21 more)

### Community 51 - "media r2 config & resolveNewsMediaR2Config"
Cohesion: 0.12
Nodes (31): enableManagedMediaEnforcement(), EnableManagedMediaEnforcementResult, isManagedMediaEnforcedForTenant(), markManagedMediaEnforced(), evaluateManagedMediaReadiness(), ManagedMediaReadinessReason, ManagedMediaReadinessResult, allowsSvgMimeType() (+23 more)

### Community 52 - "sync storage.test & sync auth"
Cohesion: 0.09
Nodes (28): legacyAllowed(), SyncAuthFailure, SyncAuthSuccess, NODE_STATUSES, Result, UpdateSyncNodeInput, validateUpdateSyncNodeInput(), ValidationError (+20 more)

### Community 53 - "check docs.mjs & docs checks.mjs"
Cohesion: 0.15
Nodes (31): anyComposeFileExists(), checkLinks(), COMPOSE_FILE_CANDIDATES, GENERATED_EXEMPT, listMarkdown(), loadComposeServiceNames(), loadPackageScripts(), loadSqlFileNames() (+23 more)

### Community 54 - "table write ownership check & validate module routes"
Cohesion: 0.12
Nodes (29): accountableOwners(), collectTableWrites(), directoryKeyMap(), DOCUMENTED_EXCEPTIONS, findSharedTableWrites(), main(), ownerOfFile(), SharedTableWrite (+21 more)

### Community 55 - "news article seo metadata & blog settings directory"
Cohesion: 0.10
Nodes (28): BlogSettingsRow, BlogSettingsView, sanitizeSocialPreviewFallbackImageMediaId(), toView(), upsertBlogSettings(), buildNewsArticleSeoMetadata(), NewsArticleSeoMetadata, NewsArticleSeoMetadataInput (+20 more)

### Community 56 - "AWCMS Backend & Integration Hardening (skill) & AWCMS Observability (skill)"
Cohesion: 0.08
Nodes (34): ADR-0006 Provider Optional & Outside DB Transaction, AWCMS Backend & Integration Hardening (skill), Per-Provider Circuit Breaker Registry (getProviderCircuitBreaker), Fixed-Window Rate Limiter (checkRateLimit), Shared Worker Runner (job-runner.ts), Transactional Outbox Pattern (CLAIM/UPLOAD/FINALIZE), AWCMS Legacy Data Migration (skill, descoped), AppendDomainEventInput / appendDomainEvent Outbox Input (+26 more)

### Community 57 - "index & comments.integration.test"
Cohesion: 0.14
Nodes (28): listApprovedComments(), CommentThread, findThread(), findThreadByComment(), getOrCreateThread(), ThreadRow, toThread(), buildCommentableResourceUrl() (+20 more)

### Community 58 - "health registry & computeGenericSignals"
Cohesion: 0.12
Nodes (27): asyncApiDocumentedSignal(), computeGenericSignals(), dbRegistrySyncedSignal(), fetchModuleHealthReport(), findDescriptor(), jobsDocumentedSignal(), listMigrationFileNames(), migrationsAppliedSignal() (+19 more)

### Community 59 - "collector & collectVisitorTelemetry"
Cohesion: 0.13
Nodes (26): extractReferrerDomain(), collectVisitorTelemetry(), CollectVisitorTelemetryInput, SessionRow, shouldCollectRequest(), upsertVisitorSession(), ClassifyHumanInput, classifyHumanStatus() (+18 more)

### Community 60 - "collect & visitor analytics domain.test"
Cohesion: 0.13
Nodes (26): extractSingleTrustedHeaderValue(), resolveAnalyticsClientIp(), EMPTY_GEO, GeoEnrichment, normalizeCountryCode(), resolveGeoEnrichment(), isKnownVisitorAnalyticsMode(), isSet() (+18 more)

### Community 61 - "workflow definition directory & workflow definition lifecycle"
Cohesion: 0.10
Nodes (30): createNewDraftVersion(), createWorkflowDefinition(), CreateWorkflowDefinitionParams, fetchDefinitionForUpdate(), getWorkflowDefinitionById(), InvalidWorkflowGraphError, listWorkflowDefinitions(), ListWorkflowDefinitionsFilters (+22 more)

### Community 62 - "step up & verify"
Cohesion: 0.13
Nodes (27): resolveMfaRateLimitMax(), resolveMfaRateLimitWindowSec(), resolveLoginPolicyConfig(), createSessionWithAssurance(), resolveSessionAssurance(), SessionAssurance, setSessionCookies(), StepUpGateResult (+19 more)

### Community 63 - "tenant route & index"
Cohesion: 0.09
Nodes (21): AuthorizeResult, boundAuditSummaryLimit(), fetchModuleAuditSummary(), ModuleAuditSummaryEntry, RELEVANT_RESOURCE_TYPES, AccessAuditReport, fetchAccessAuditReport(), fetchModuleUsageReport() (+13 more)

### Community 64 - "turnstile & turnstile verifier.test"
Cohesion: 0.09
Nodes (25): EnforceTurnstileOptions, isFreshChallenge(), readCappedText(), redact(), redactTruncate(), resolvePositiveIntEnv(), resolveTurnstileConfig(), resolveTurnstileMaxResponseBytes() (+17 more)

### Community 65 - "module composition & module composition.test"
Cohesion: 0.14
Nodes (21): runModuleCompositionInventoryCheck(), buildModuleCompositionInventoryJson(), main(), listBaseModules(), buildComposedModuleInventory(), checkCapabilityBindings(), checkDeploymentProfiles(), checkDuplicateModuleKeys() (+13 more)

### Community 66 - "initialize & hashPassword"
Cohesion: 0.10
Nodes (22): hashPassword(), getSetupDatabaseClient(), bootstrapPlatformTenant(), PlatformBootstrapResult, REQUIRED_STRING_FIELDS, SetupInitializeInput, SetupInitializeValidationResult, validateSetupInitializeInput() (+14 more)

### Community 67 - "auth provider directory & tenant sso policy"
Cohesion: 0.11
Nodes (27): resolveSsoMaxProvidersPerTenant(), encryptSsoClientSecret(), resolveSsoEncryptionKey(), AuthProviderRow, createAuthProvider(), CreateAuthProviderResult, fetchAuthProviderById(), fetchRawById() (+19 more)

### Community 68 - "capacity config & health"
Cohesion: 0.11
Nodes (26): CapacityBudgetReport, CapacityConfig, CapacityFinding, CapacityFindingSeverity, CapacityScenario, CapacityUsage, computeCapacityUsage(), DEFAULT_INSTANCE_COUNTS (+18 more)

### Community 69 - "content quality checklist & blog settings policy"
Cohesion: 0.11
Nodes (25): sanitizeChecklistPolicyOverrides(), UpdateBlogSettingsInput, UpdateBlogSettingsValidationResult, validateContentQualityChecklistPolicy(), validateOptionalBoundedString(), validateUpdateBlogSettingsInput(), ValidationError, ChecklistRuleId (+17 more)

### Community 70 - "workflow instance & workflow graph engine"
Cohesion: 0.10
Nodes (22): WorkflowNotificationPort, WorkflowNotificationRequest, activateNode(), ActivateNodeDeps, ActivateNodeOutcome, createApprovalTask(), factsToVariables(), QueueEntry (+14 more)

### Community 71 - "security & tenant auth policy"
Cohesion: 0.10
Nodes (27): AuthProviderView, BreakGlassCandidateView, countEligibleBreakGlassIdentities(), DEFAULT_POLICY_VIEW, fetchEligibleBreakGlassIdentityIds(), getTenantAuthPolicy(), isPasswordLoginDisabledForIdentity(), saveTenantAuthPolicy() (+19 more)

### Community 72 - "projection rebuild & rebuild run store"
Cohesion: 0.14
Nodes (27): applyEventActivityProjectionIncrement(), getStreamCursor(), applyMetricDeltas(), resetProjectionMetrics(), assertSafeIdentifier(), collectRebuildMetricKeys(), collectRebuildStreamKeys(), continueAllRunningRebuilds() (+19 more)

### Community 73 - "workflow instance decision & workflow approval concurrency.test"
Cohesion: 0.09
Nodes (24): DueTaskRow, EscalateDueTasksResult, AssignmentRow, CompleteApprovalTaskParams, DelegationDbRow, findEligibleAssignment(), RecordTaskDecisionParams, RecordTaskDecisionResult (+16 more)

### Community 74 - "login policy & login env parsing.test"
Cohesion: 0.10
Nodes (23): verifyPassword(), LogEntry, LoginDenyResponse, LoginPolicyConfig, parsePositiveIntEnv(), resetLoginPolicyEnvWarningsForTests(), verifyPasswordOrDummy(), warnedEnvValues (+15 more)

### Community 75 - "query plan) & production:preflight read only preflight"
Cohesion: 0.09
Nodes (28): Authorized dependency-health endpoint, Mandatory shared instrumentation points, METRIC_DEFINITIONS registry (cardinality/privacy), MetricsPort observability contract, deriveProviderFamilyLabel cardinality bounding, SLI/SLO and burn-rate guidance, Deterministic seeded fixtures (mulberry32), Query-plan regression budgets (+20 more)

### Community 76 - "work class registry generate & module job registry check"
Cohesion: 0.13
Nodes (22): DOCUMENTED_EXCEPTIONS, findJobRegistryViolations(), JobRegistryViolation, main(), PackageScripts, REASON, targetForScript(), main() (+14 more)

### Community 77 - "abac policy evaluator.integration.test & module tenant lifecycle.integration.test"
Cohesion: 0.15
Nodes (23): resetDatabaseCircuitBreakerForTests(), Bootstrap, createPolicy(), evaluate(), headers(), seedUserWithPermissions(), setActive(), TARGET (+15 more)

### Community 78 - "legacy ad ingest & media object key"
Cohesion: 0.11
Nodes (21): AdTarget, AdTargetType, classifyLegacyAdImage(), ClassifyLegacyAdImageInput, isObjectKeyForTenant(), LegacyAdClassification, LegacyAdResidueReason, LegacyPlacementMapping (+13 more)

### Community 79 - "content block rendering & gallery block renderer"
Cohesion: 0.11
Nodes (24): CONTENT_BLOCK_TYPES, ContentBlock, ContentBlockType, ContentBlockTypesMatchUnion, EMPTY_RESOLVED_MEDIA_URLS, GalleryItem, isRecord(), renderBlock() (+16 more)

### Community 80 - "party directory & party validation"
Cohesion: 0.10
Nodes (23): listParties(), ListPartiesOptions, ListPartiesResult, PartyRow, toRecord(), CreatePartyInput, PARTY_RISK_LEVELS, PARTY_SETTABLE_STATUSES (+15 more)

### Community 81 - "ADR 0029 & theme public css"
Cohesion: 0.19
Nodes (21): ThemeConfigVersion, defaultThemeCss(), resolveActiveThemeCssForTenant(), ResolvedThemeCss, resolveVersionThemeCss(), defaultThemeConfig(), ThemeDescriptor, cssResponse() (+13 more)

### Community 82 - "ADR 0016 organization structure module admission & ADR 0020 ERP extension readiness contracts"
Cohesion: 0.09
Nodes (27): computeProjectionFreshness (derived, never cached), ProjectionDescriptor registry (cursor_table vs domain_event), Scheduled exports with checksum + CSV formula neutralization, TOCTOU rebuild lock via pg_advisory_xact_lock, Two-layer projection read guard (route ABAC + descriptor requiredPermission), Idempotent index operations (reconcile/rebuild/reindex), ADR-0016 organization_structure module admission, organization_hierarchy_resolution capability (BusinessScopeHierarchyPort impl) (+19 more)

### Community 83 - "properties & additionalProperties"
Cohesion: 0.07
Nodes (27): minLength, type, minLength, type, minLength, type, additionalProperties, type (+19 more)

### Community 84 - "theme preview & theme preview render"
Cohesion: 0.12
Nodes (16): createPreviewSession(), findActivePreviewSession(), PreviewSessionRecord, buildPreviewViewModel(), PreviewAsset, PreviewSection, PreviewViewModel, SAMPLE_COPY (+8 more)

### Community 85 - "admin form client & registrations"
Cohesion: 0.11
Nodes (18): isSelfRegistrationEnabled(), resolveTurnstileSiteKey(), postJson(), sendJson(), PendingRegistrationView, loadTenantPickerModel(), MANUAL, resolveTenantPickerModel() (+10 more)

### Community 86 - "object storage uploader & object queue"
Cohesion: 0.11
Nodes (19): TimeoutError, withTimeout(), ObjectRetryEvaluation, ObjectSyncEnqueueRequestBody, ObjectSyncEnqueueValidationResult, ObjectSyncQueueItem, validateObjectSyncEnqueueRequestBody(), ValidationError (+11 more)

### Community 87 - "ADR 0039 & url change capture"
Cohesion: 0.13
Nodes (22): ADR-0039, createRedirect(), fetchRedirectSettings(), RedirectSettingsAuditHook, SettingsRow, toSettings(), updateRedirectSettings(), captureUrlChangeRedirect() (+14 more)

### Community 88 - "ad placement policy & validateCreateAdPlacementInput"
Cohesion: 0.17
Nodes (24): AD_PLACEMENT_DEFAULT_MEDIA_TYPES, AD_PLACEMENT_KEYS, AD_PLACEMENT_PRESETS, AD_ROTATION_MODES, AD_TARGET_TYPES, AdPlacementPreset, CreateAdPlacementValidationResult, isAdPlacementKey() (+16 more)

### Community 89 - "index & [id]"
Cohesion: 0.16
Nodes (22): AbacPolicyRecord, getAbacPolicyById(), insertAbacPolicy(), listAbacPolicies(), mapRow(), PolicyDbRow, setAbacPolicyActive(), updateAbacPolicy() (+14 more)

### Community 90 - "theming.integration.test & theme service"
Cohesion: 0.18
Nodes (23): EMPTY_THEME_TENANT_STATE, fetchDraftVersion(), fetchThemeTenantState(), fetchVersionById(), insertPublishedVersion(), listPublishedVersionIds(), listPublishedVersions(), nextPublishedVersionNumber() (+15 more)

### Community 91 - "email dispatch & logScriptFailure"
Cohesion: 0.13
Nodes (20): main(), TenantRow, logScriptFailure(), ClaimedRow, claimEligibleEntries(), createTemplateLoader(), dispatchEmailQueue(), DispatchEmailQueueOptions (+12 more)

### Community 92 - "family conformance check & main"
Cohesion: 0.12
Nodes (25): ADR_DIR, assertEvidenceReportSecretFree(), ASYNCAPI_PATH, buildEvidenceReport(), CI_YML_PATH, collectFamilyConformanceChecks(), EvidenceReport, extractCiBunVersions() (+17 more)

### Community 93 - "edge cache.test & cacheability"
Cohesion: 0.15
Nodes (20): buildScopesForSurface(), CacheabilityInput, CACHEABLE_METHODS, CACHEABLE_STATUSES, CacheDecision, CacheSkipReason, decideCacheability(), declaresUncacheable() (+12 more)

### Community 94 - "theme descriptor & InvalidThemeDescriptorError"
Cohesion: 0.08
Nodes (24): DimensionConstraint, NumberConstraint, assertSubset(), defineTheme(), InvalidThemeDescriptorError, THEME_ALLOWED_EXTERNAL_FRAME_SOURCES, THEME_ALLOWED_EXTERNAL_SCRIPT_SOURCES, THEME_ALLOWED_EXTERNAL_STYLE_SOURCES (+16 more)

### Community 95 - "workflow graph & validateWorkflowGraph"
Cohesion: 0.14
Nodes (25): CONDITION_OPERATORS, ConditionOperator, detectCycle(), EndNode, FactsSchemaValidationResult, FactType, GraphValidationError, GraphValidationResult (+17 more)

### Community 96 - "package.json & generated artifacts have tooling.test"
Cohesion: 0.08
Nodes (22): @astrojs/node, author, bugs, url, dependencies, astro, @astrojs/node, description (+14 more)

### Community 97 - "Intentional divergence registry & MFA TOTP + recovery codes"
Cohesion: 0.09
Nodes (25): compatibleAwcmsRange support-window guidance, Deprecation policy (announce/coexist/remove), extension:check compatibility enforcement (deprecated ADR-0034), Six independent versioning schemes, AWCMS family conformance to AWCMS-Mini standard, family:conformance:check gate + evidence report, FAMILY_CONTRACT_VERSION (seventh versioning scheme), AWCMS family conformance to AWCMS-Mini standard (Bahasa Indonesia source) (+17 more)

### Community 98 - "consumer registry & consumer state directory"
Cohesion: 0.11
Nodes (17): applyConsumerEffectOnce(), BacklogCountRow, ConsumerStateRow, DomainEventConsumerView, pauseConsumer(), resumeConsumer(), UnknownDomainEventConsumerError, DOMAIN_EVENT_TYPE_REGISTRY (+9 more)

### Community 99 - "role admin & roles"
Cohesion: 0.11
Nodes (19): DeletedRoleView, DuplicateRoleCodeError, DuplicateRolePermissionError, fetchLiveRoleById(), GrantResult, listDeletedRoles(), listPermissionCatalog(), listRolePermissions() (+11 more)

### Community 100 - "projection incremental worker & reporting projections.integration.test"
Cohesion: 0.14
Nodes (21): resetProjectionCursors(), upsertStreamCursor(), assertSafeIdentifier(), computeMetricDeltas(), CursorStreamPassResult, IncrementalUpdateOutcome, runCursorStreamPass(), runIncrementalUpdateForTenant() (+13 more)

### Community 101 - "office directory & offices"
Cohesion: 0.13
Nodes (13): createOffice(), DuplicateOfficeCodeError, fetchOfficeById(), listDeletedOffices(), listOffices(), OfficeListPage, OfficeRecord, OfficeRow (+5 more)

### Community 102 - "theme config & css value validation"
Cohesion: 0.19
Nodes (20): assertSafeCssPrimitive(), CssValueError, DIMENSION_UNIT_ALLOW_LIST, FORBIDDEN_CSS_SUBSTRINGS, hasBalancedParens(), hasBalancedQuotes(), NAMED_COLOR_ALLOW_LIST, validateColorValue() (+12 more)

### Community 103 - "email template directory & email templates"
Cohesion: 0.12
Nodes (19): main(), readArg(), createEmailTemplate(), EmailTemplateRow, EmailTemplateView, listEmailTemplates(), ListEmailTemplatesFilter, restoreEmailTemplate() (+11 more)

### Community 104 - "assertUuid & workflow recovery"
Cohesion: 0.13
Nodes (20): assertUuid(), appendDomainEvent(), createWorkflowDelegation(), CreateWorkflowDelegationParams, listWorkflowDelegations(), revokeWorkflowDelegation(), RevokeWorkflowDelegationParams, WorkflowDelegationForbiddenError (+12 more)

### Community 105 - "domain event directory & delivery replay"
Cohesion: 0.12
Nodes (18): DeliveryNotDeadLetteredError, replayDomainEventDelivery(), ReplaySchemaIncompatibleError, UnknownReplayConsumerError, DomainEventDeliveryRow, DomainEventDeliveryView, DomainEventRow, DomainEventView (+10 more)

### Community 106 - "export generation & local export adapter"
Cohesion: 0.14
Nodes (21): GenerateExportInput, generateProjectionExport(), resolveExportRootPath(), resolveRetentionDays(), ADR-0006, ExportRunDbRow, ExportRunFormat, ExportRunRow (+13 more)

### Community 107 - "compilerOptions & tsconfig.json"
Cohesion: 0.09
Nodes (22): astro/tsconfigs/strict, .astro/types.d.ts, dist, ES2024, node_modules, scripts/**/*, src/**/*, tests/**/* (+14 more)

### Community 108 - "blog ads ingest & legacy ad ingest.integration.test"
Cohesion: 0.14
Nodes (17): main(), Residue, resolvePlacementKey(), TenantRow, ADR-0044, IngestedAdPlacementInput, insertIngestedAdPlacement(), LegacyAdForIngest (+9 more)

### Community 109 - "family conformance.test & db migrate"
Cohesion: 0.14
Nodes (17): AppliedMigration, computeMigrationChecksum(), discoverMigrationFiles(), getDatabaseUrl(), main(), maskUrlPassword(), MigrationFile, MigrationResult (+9 more)

### Community 110 - "email template validation & announcement validation"
Cohesion: 0.13
Nodes (19): AnnouncementInput, AnnouncementTarget, isPlainObject(), Result, validateAnnouncementInput(), validateTarget(), validateVariables(), ValidationError (+11 more)

### Community 111 - "form draft directory & form draft validation"
Cohesion: 0.16
Nodes (20): createFormDraft(), fetchActiveFormDraft(), FormDraftRow, FormDraftView, listFormDrafts(), ListFormDraftsFilter, submitFormDraft(), toView() (+12 more)

### Community 112 - "blog content module & ADR 0044: merge news portal into blog content"
Cohesion: 0.15
Nodes (22): Ad Placement Targeting Widening (sql/078), Polymorphic target_id without foreign key, placement_key is SLOT, target_type/target_id is SCOPE, Union render: page-targeted ads merged with global ads, ADR-0044: merge news_portal into blog_content, tests/news-portal-merge.test.ts, Preserve awcms_news_portal_* table names and API paths, Union, not subtraction (+14 more)

### Community 113 - "comments module guidance (moderation first) & 074 075, stores no credential)"
Cohesion: 0.11
Nodes (22): Reuse exact endpoint permission keys (mfa_admin.reset as read gate), /admin/security authentication policy screen, Email password reset flow (sql/073, non-oracle, FOR UPDATE single use), Admin-approved self-registration (sql/074-075, stores no credential), Peta ke artefak nyata awcms (micro names vs awcms names), Full-precision text keyset cursor (microsecond vs millisecond trap), comments module guidance (moderation-first), Unauthenticated public write surface backbone (no oracle, PII minimized) (+14 more)

### Community 114 - "ADR 0001 Rebuild AWCMS as ERP modular monolith platform & ADR 0003 PostgreSQL + RLS multi tenant isolation"
Cohesion: 0.11
Nodes (22): ADR-0001 Rebuild AWCMS as ERP modular-monolith platform, ADR-0002 Bun-only runtime & tooling, ADR-0003 PostgreSQL + RLS multi-tenant isolation, SECURITY DEFINER bootstrap-read checklist (ADR-0003), ADR-0004 RBAC + ABAC default-deny baseline, ADR-0005 Soft delete for master/config, immutability for posted data, ADR-0006 Offline-first + transactional outbox + sync HMAC, ADR-0007 OpenAPI & AsyncAPI as mandatory contracts (+14 more)

### Community 115 - "AWCMS Public API Pre migration OpenAPI Snapshot & Email Module"
Cohesion: 0.13
Nodes (22): Identity & Access module, Cross-module request pipeline (Auth/Tenant/ABAC/Idempotency), Business scope hierarchy authorization, ABAC guard contract, Default role catalog (ERP), RBAC + ABAC access model, Setup wizard default seed, Email Module (+14 more)

### Community 116 - "turnstile enforcement.test & validate env"
Cohesion: 0.12
Nodes (16): checkOnlineAuthSecurityReady(), checkTurnstileReady(), BOOL_VALUES, EnvBag, isBase32ByteKey(), isValidUrl(), PLACEHOLDER_SECRETS, Rule (+8 more)

### Community 117 - "redirect safety & redirect chain"
Cohesion: 0.16
Nodes (20): RedirectRecord, makeOverlayLookup(), previewRedirectChainForInput(), RedirectSafetyOptions, RedirectSafetyResult, siblingInScope(), toHopRule(), buildRedirect() (+12 more)

### Community 118 - "Module Management system & Jualanku.info porting plan (ADR 0045)"
Cohesion: 0.15
Nodes (21): sql/076 permission repoint: insert, move grants, then delete, blog_content as cross-module descriptor contributor (seo_facts, searchSources), decideCacheability: allow-list, not deny-list, Permissions may only use existing AccessAction values, Five bounded contexts, not seven, Jualanku.info porting plan (ADR-0045), Merchant is a business scope, not a new ABAC attribute, The real session gap is cross-origin introspection, not cookie support (+13 more)

### Community 119 - "properties & adr"
Cohesion: 0.10
Nodes (21): pattern, type, properties, pattern, type, minLength, type, adr (+13 more)

### Community 120 - "identity access OpenAPI fragment & accessCreateAbacPolicy"
Cohesion: 0.10
Nodes (21): AbacDslPolicyConditions schema, accessCreateAbacPolicy, accessEvaluate, accessSimulateAbacPolicy, approveRegistrationRequest, approveSoDConflictException, createBusinessScopeAssignment, identity-access OpenAPI fragment (+13 more)

### Community 121 - "edge cache surfaces check & surface registry"
Cohesion: 0.19
Nodes (18): collectPurgedModuleKeys(), findCacheableForbiddenPaths(), findOwnersWithoutPurges(), main(), MUST_NEVER_MATCH, PURGE_CALLER_ROOTS, SurfaceLike, validateSurfaces() (+10 more)

### Community 122 - "config & loadEdgeCacheConfig"
Cohesion: 0.13
Nodes (14): DEFAULTS, EdgeCacheEnvironment, EdgeCacheMode, EdgeCacheValidationFinding, loadEdgeCacheConfig(), MODES, readBoundedInt(), readNonEmpty() (+6 more)

### Community 123 - "blog page directory & boundedPageNumber"
Cohesion: 0.13
Nodes (20): BlogPageRow, BlogPageSummary, BlogPageSummaryRow, BlogPageView, createBlogPage(), FetchBlogPageOptions, listBlogPages(), ListBlogPagesFilter (+12 more)

### Community 124 - "widget policy & widget directory"
Cohesion: 0.16
Nodes (19): BlogWidgetRow, BlogWidgetView, createWidget(), fetchWidgetById(), listWidgets(), ListWidgetsFilter, toView(), updateWidget() (+11 more)

### Community 125 - "comment settings & comment settings directory"
Cohesion: 0.15
Nodes (18): CommentSettingsAuditHook, fetchCommentSettings(), SettingsRow, toSettings(), updateCommentSettings(), CommentAuthorKind, CommentPolicyDecision, CommentPolicyMode (+10 more)

### Community 126 - "abac admin & abac admin validation"
Cohesion: 0.16
Nodes (17): AbacPolicyRow, createPolicy(), DuplicatePolicyCodeError, fetchPolicyById(), setPolicyActive(), toView(), updatePolicy(), ABAC_EFFECTS (+9 more)

### Community 127 - "blog:ads:ingest job & One way managed media enforcement (no disable path)"
Cohesion: 0.11
Nodes (20): blog:ads:ingest job, NEWS_MEDIA_R2_* absent from .env.example, Preview-by-default (--apply is opt-in), source_legacy_ad_id partial unique index with NULLS NOT DISTINCT, blog:ads:drop-readiness gate, 410 ENDPOINT_RETIRED on POST/PATCH /api/v1/blog/ads, DROP awcms_news_portal_tenant_state (sql/077), Two ad systems, one weakening the other's security control (+12 more)

### Community 128 - "seo redirect guards.test & redirect path"
Cohesion: 0.17
Nodes (16): RFC-3986, normalizeRedirectPath(), NormalizeRedirectPathOptions, RedirectPathNormalizationResult, RFC-6761, assertSafeRedirectTarget(), classifyRedirectTarget(), RedirectTargetClass (+8 more)

### Community 129 - "sod rule registry & sod rule registry.test"
Cohesion: 0.16
Nodes (14): main(), collectSoDRuleDescriptors(), formatSoDRuleRegistryIssue(), SoDRuleRegistryIssue, SoDRuleRegistryValidationResult, VALID_SCOPE_APPLICABILITIES, VALID_SEVERITIES, validateSingleRule() (+6 more)

### Community 130 - "login & POST"
Cohesion: 0.18
Nodes (18): generateChallengeToken(), hashChallengeToken(), isMfaFeatureEnabled(), resolveChallengeTtlSec(), generateSessionToken(), resolveLoginDenyResponse(), createEnrollmentGrant(), createMfaChallenge() (+10 more)

### Community 131 - "redirect resolution service & ADR 0028"
Cohesion: 0.18
Nodes (17): ADR-0028, findActiveRedirectByPath(), incrementRedirectHit(), isSeoDistributionEnabled(), RedirectResolution, resolveHostBasedRedirect(), resolveLegacyBlogRedirect(), resolvePublicRedirect() (+9 more)

### Community 132 - "ads directory & toAdView"
Cohesion: 0.13
Nodes (18): ActiveAdForPlacement, ActiveAdRow, BlogAdPlacementRow, BlogAdPlacementView, BlogAdRow, BlogAdView, createAd(), fetchAdById() (+10 more)

### Community 133 - "comment moderation & comments"
Cohesion: 0.15
Nodes (15): BulkModerateResult, listModerationQueue(), ModerateResult, ModerationAuditHook, ModerationCursor, ModerationQueueItem, QUEUE_STATUSES, QueueRow (+7 more)

### Community 134 - "append domain event & envelope"
Cohesion: 0.15
Nodes (15): AppendDomainEventInput, AppendDomainEventResult, DomainEventRow, InvalidDomainEventPayloadError, ADR-0006, UnregisteredDomainEventTypeError, collectCredentialShapedKeys(), CREDENTIAL_KEY_SUBSTRINGS (+7 more)

### Community 135 - "email template render & email template categories"
Cohesion: 0.19
Nodes (15): BASE_CATEGORY_ALLOWLISTS, derivedCategoryAllowlists, getAllowedVariablesForCategory(), registerDerivedEmailTemplateCategory(), resetDerivedEmailTemplateCategoriesForTests(), buildSyntheticSampleVariables(), EmailTemplateSource, escapeHtmlValue() (+7 more)

### Community 136 - "user admin & validateSetStatusInput"
Cohesion: 0.11
Nodes (14): AssignmentInput, AssignmentRecord, AssignmentTargetNotFoundError, DuplicateAssignmentError, SetStatusInput, SetStatusResult, SystemRoleAssignmentError, TENANT_USER_STATUSES (+6 more)

### Community 137 - "redirect rule & validateRedirectInput"
Cohesion: 0.22
Nodes (19): ALLOWED_REDIRECT_ORIGINS, ALLOWED_REDIRECT_STATES, ALLOWED_REDIRECT_STATUS_CODES, isPlainObject(), normalizeOptionalString(), RedirectCreateValidationResult, RedirectUpdateValidationResult, RedirectValidationContext (+11 more)

### Community 138 - "analytics & analytics queries"
Cohesion: 0.22
Nodes (17): ALLOWED_JSON_COLUMNS, ALLOWED_JSON_KEYS, AnalyticsSummary, fetchAnalyticsSummary(), fetchRealtimeStats(), fetchSecurityView(), fetchTopBrowsers(), fetchTopCountries() (+9 more)

### Community 139 - "workflow approval.test & workflow delegation"
Cohesion: 0.14
Nodes (17): validateFactsAgainstSchema(), CreateDelegationInput, CreateDelegationValidationResult, delegationActiveAt(), delegationCoversScope(), DelegationInputValidationError, DelegationScopeQuery, resolveEffectiveDeciderIds() (+9 more)

### Community 140 - "e2e auth & provideTenant"
Cohesion: 0.15
Nodes (10): seeded, seeded, seeded, seeded, seeded, seeded, seeded, seeded (+2 more)

### Community 141 - "Generated script inventory (60 targets, 23 in the check chain) & AWCMS Public API bundled OpenAPI contract (generated)"
Cohesion: 0.16
Nodes (19): AWCMS API & Event Reference (generated from the bundled contracts), Cross-cutting API conventions (envelope, pagination, idempotency, correlation), Tenant subdomain root domain is an explicitly-written assumption, not a decision, Draft ModuleDescriptor for a Jualanku module (MODULE_CONTRACT_VERSION 2.4.0), Binding minimum API contract (envelope, error codes, pagination, idempotency, concurrency), Application-level 128 KiB request body cap independent of the reverse proxy, AWCMS Public API bundled OpenAPI contract (generated), Security schemes bearerAuth / tenantHeader / syncHmac (+11 more)

### Community 142 - "Five bounded contexts, not seven & jualanku directory context (merchants, membership, taxonomy, business pages, scope hierarchy)"
Cohesion: 0.14
Nodes (19): Seven mandatory Jualanku ABAC rules, Decision log + audit for merchant-scoped access, Personal-data classes and retention treatment, Five bounded contexts, not seven, jualanku_affiliate context (links, attribution, conversions, fraud flags), jualanku_catalog_growth context (offerings, promotions, leads, interactions), jualanku_commercial context (plans, entitlements, invoices, commission ledger, payouts), jualanku_directory context (merchants, membership, taxonomy, business pages, scope hierarchy) (+11 more)

### Community 143 - "error log & object dispatch"
Cohesion: 0.15
Nodes (16): main(), TenantRow, logAdminPageError(), sanitizeErrorForLog(), LogContext, ClaimedRow, claimEligibleEntries(), dispatchObjectSyncQueue() (+8 more)

### Community 144 - "middleware & security headers"
Cohesion: 0.17
Nodes (11): BASE_CSP_DIRECTIVES, buildContentSecurityPolicy(), buildSecurityHeaders(), scriptSrcSources(), SecurityHeaderOptions, isTurnstileEnabled(), isTurnstileRequired(), applyResponseHeaders() (+3 more)

### Community 145 - "jwt verify & oidc jwt verify.test"
Cohesion: 0.19
Nodes (17): ALLOWED_JWT_ALGORITHMS, AllowedJwtAlgorithm, base64UrlDecode(), findJwk(), isAllowedJwtAlgorithm(), Jwk, JwtHeader, JwtPayload (+9 more)

### Community 146 - "menu directory & menu policy"
Cohesion: 0.16
Nodes (17): BlogMenuItemRow, BlogMenuItemView, BlogMenuRow, BlogMenuView, createMenu(), fetchMenuById(), listMenus(), toMenuView() (+9 more)

### Community 147 - "dashboard view & buildSessionRowCells"
Cohesion: 0.11
Nodes (14): ANALYTICS_AREA_FILTERS, ANALYTICS_VISITOR_TYPE_FILTERS, AnalyticsAreaFilter, AnalyticsVisitorTypeFilter, buildSessionRowCells(), displayOrPlaceholder(), isNamedCountListEmpty(), isSummaryEmpty() (+6 more)

### Community 148 - "family contract & validateFamilyManifestShape"
Cohesion: 0.16
Nodes (17): ADR-0001, checkStackEntry(), FAMILY_OWNED_CONTRACT_VERSIONS, FamilyCompatibilityManifest, FamilyContracts, FamilyOwnedContractKey, FamilyStack, IntentionalDivergence (+9 more)

### Community 149 - "ADR 0041: comments module admission & ADR 0040: site search module admission"
Cohesion: 0.14
Nodes (18): Inward contribution direction (DAG-safe aggregator), awcms_site_search_documents index projection, Search index is never an authorization source, SearchSourceDescriptor (descriptor-list contribution seam), ADR-0040: site_search module admission, ts_headline sentinel snippet escaping, :tenantCode URL template adaptation, commentableResources descriptor seam (+10 more)

### Community 150 - "Blocking quality gates (existing repo gates + Jualanku specific ones) & What stays out of bun run check, and why"
Cohesion: 0.13
Nodes (18): Two Coolify deploy patterns (build-from-repo vs pull-image), Single-VPS Coolify topology and its trade-off, APP_URL is load-bearing for OIDC callbacks, Coolify/postgres images create POSTGRES_USER as a superuser, DATABASE_URL serves two conflicting roles once .env exists, Local development made row-for-row identical to production (2026-07-26), Run migrations as a one-shot container, not docker exec, The 0 / 1 / 0 RLS isolation proof run as awcms_app (+10 more)

### Community 151 - "Jualanku.info implementation blueprint (plan, not code) & session — safe claims introspection endpoint (to be added, owned by identity access)"
Cohesion: 0.14
Nodes (18): Why the BFF is mandatory (six concrete failures it closes), Merchant modelled as a business scope (ADR-0030), not a new ABAC attribute, Ownership predicate in every query as the second safety belt, RLS separates tenants, not merchants, Six isolation layers (tenant, merchant, role, workflow, field, surface), BFF obligations (cookie, token storage, CSRF, tenant, logout order, rotation, revocation), Cross-origin session contract (the real gap), What awcms session support already is (often misread) (+10 more)

### Community 152 - "module settings & fetchModuleSettingsView"
Cohesion: 0.21
Nodes (15): fetchModuleSettingsView(), fetchSettingsRow(), findDescriptor(), ModuleSettingsRow, ModuleSettingsView, toView(), updateModuleSettings(), UpdateModuleSettingsResult (+7 more)

### Community 153 - "[id] & index"
Cohesion: 0.16
Nodes (16): createParty(), softDeleteParty(), updateParty(), validateDeleteReasonRequestBody(), toPartyMaskedAdminDTO(), DELETE(), DELETE_GUARD, GET() (+8 more)

### Community 154 - "site search.integration.test & search diagnostics"
Cohesion: 0.14
Nodes (15): fetchIndexStatus(), fetchRecentRuns(), IndexFailureItem, IndexRunSummary, IndexStatus, RunRow, toRunSummary(), ADR-0040 (+7 more)

### Community 155 - "AWCMS Project Skills catalog & integration hub module (NOT ported; port spec)"
Cohesion: 0.12
Nodes (17): Two different public visibility predicates (listing vs detail), Revisions are append-only (rule 3), Concurrency-safe numbering via SELECT ... FOR UPDATE, Confidentiality-tier gating, document_infrastructure module (NOT ported; port spec), awcms_document_versions is immutable and append-only, integration_hub module (NOT ported; port spec), Replay protection as a real DB constraint (+9 more)

### Community 156 - "properties & required"
Cohesion: 0.12
Nodes (17): additionalProperties, properties, required, type, $ref, $ref, $ref, $ref (+9 more)

### Community 157 - "required & divergence"
Cohesion: 0.12
Nodes (17): definitions, divergence, stackEntry, additionalProperties, required, type, additionalProperties, required (+9 more)

### Community 158 - "family & properties"
Cohesion: 0.12
Nodes (17): additionalProperties, properties, required, type, family, role, standard, standardRepository (+9 more)

### Community 159 - "local archive adapter & archive port"
Cohesion: 0.16
Nodes (12): RFC-4180, ArchivePortKind, ArchiveWriteInput, ArchiveWriteResult, ADR-0006, buildArtifactPath(), csvEscape(), descriptorDirSegments() (+4 more)

### Community 160 - "{tenantCode} (legacy) & edge cache:surfaces:check gate (probes 16 must never cache paths)"
Cohesion: 0.13
Nodes (17): PUBLIC_CACHE_SURFACES surface registry, edge-cache:surfaces:check gate (probes 16 must-never-cache paths), Why PUBLIC_DEFAULT_TENANT_* is pinned even though resolution works without it, Layer split: experience vs business platform vs data vs edge, Deployment topology: jualanku.info vs ops.jualanku.info, Portal session threat model, GO / PIVOT / PAUSE / STOP criteria, Jualanku KPI framework and North Star (+9 more)

### Community 161 - "module management OpenAPI fragment & disable lifecycle"
Cohesion: 0.13
Nodes (17): checkModuleHealth, disableTenantModule, enableTenantModule, module-management OpenAPI fragment, getModuleAuditSummary, getTenantModuleMatrix, listModuleCatalog, ModuleCatalogEntry schema (+9 more)

### Community 162 - "db role separation worker setup migration.test & site search module.test"
Cohesion: 0.12
Nodes (11): SETUP_ROLE_GRANTS, WORKER_ROLE_GRANTS, allMigrationStatements, migrationSql, migrationStatements, normalize(), ParsedGrants, repoRoot (+3 more)

### Community 163 - "oidc integration.test & buildOAuthStateParam"
Cohesion: 0.16
Nodes (10): resetGenericOidcCachesForTests(), buildOAuthStateParam(), createProvider(), env(), loginWith(), makeSigner(), Signer, startRequest() (+2 more)

### Community 164 - "batching & business scope expiry job"
Cohesion: 0.18
Nodes (14): BatchPassResult, BoundedBatchOptions, BoundedBatchOutcome, iterateTenantsInBatches(), IterateTenantsOptions, TenantBatchOutcome, TenantRow, BusinessScopeExpiryResult (+6 more)

### Community 165 - "redaction & error sanitizer"
Cohesion: 0.21
Nodes (14): sanitizeOne(), collectKeysDeep(), collectSecretShapedValuePaths(), EXACT_SENSITIVE_KEY_SYNONYMS, findSensitiveKeys(), isSecretShapedValue(), isSensitiveKey(), normalizeKeyForExactMatch() (+6 more)

### Community 166 - "social share links & isAbsoluteHttpUrl"
Cohesion: 0.19
Nodes (14): isAbsoluteHttpUrl(), readBooleanFlag(), resolveBlogShareConfig(), buildSocialShareLinks(), renderInstagramNote(), renderSocialShareButtonsHtml(), shareText(), SocialShareArticle (+6 more)

### Community 167 - "Static Consumer Registry (DOMAIN EVENT CONSUMERS) & Domain Event Dispatcher"
Cohesion: 0.13
Nodes (17): Static Consumer Registry (DOMAIN_EVENT_CONSUMERS), Domain Event Dispatcher, Domain Event Runtime, Versioned Event-Type Registry, Idempotent Consumer Effect (applyConsumerEffectOnce), Transactional Outbox Producer (appendDomainEvent), Announcement / Notification Enqueue (enqueueAnnouncement), Email Suppression List (+9 more)

### Community 168 - "access directory & abac policies"
Cohesion: 0.16
Nodes (13): AbacPolicyRow, AbacPolicyView, listAbacPolicies(), listRoles(), listTenantUsers(), RoleRow, RoleView, TenantUserRow (+5 more)

### Community 169 - "Varnish edge cache layer (ADR 0042) & Rule 21: enqueue edge purge inside the content transaction"
Cohesion: 0.17
Nodes (16): RLS silently doing what an explicit predicate claims, Rule 21: enqueue edge purge inside the content transaction, Literal spaces in a ban expression make invalidation never work, Bun does not send non-standard HTTP methods (BAN arrives as GET), Wrong RLS GUC name killed the write path, not just the cache, Load pressure changes only HOW LONG, never WHETHER, Purge for a module with no declared surface matches nothing, Surrogate keys are constrained because they enter a regex (+8 more)

### Community 170 - "checkSsoBreakGlassReady (critical readiness check) & Break glass SOP"
Cohesion: 0.15
Nodes (16): Break-glass eligibility drift after save, checkSsoBreakGlassReady (critical readiness check), evaluateBreakGlassRequirement, fetchEligibleBreakGlassIdentityIds, saveTenantAuthPolicy (save-time break-glass guarantee), bun run security:readiness gate, Break-glass SOP, checkSsoBreakGlassReady (drift enforcement) (+8 more)

### Community 171 - "AWCMS = online first hybrid ERP template and AWCMS family superset & withTenant tenant context: work class gate, circuit breaker, SET LOCAL tenant GUC"
Cohesion: 0.13
Nodes (16): awcms_domain_bootstrap owner role (NOLOGIN, memberless, non-superuser), awcms_resolve_tenant_domain_lookup SECURITY DEFINER bootstrap function, ensureServingRecord desired-state DNS write (PUT on drift, never a second POST), Host routing is additive to path-based /blog/{tenantCode} (ADR-0009 kept intact), Serving-record reconciliation worker (sequential, no deletes, no default target), resolvePublicTenantFromRequest fallback chain (host lookup then safe defaults), Scoped bootstrap read policy OR'd with tenant_isolation (FORCE RLS untouched), Collection via public ingest endpoint, deliberately not middleware (+8 more)

### Community 172 - "legacy ad drop readiness.integration.test & blog ads drop readiness"
Cohesion: 0.19
Nodes (9): main(), TenantRow, ADR-0044, assessLegacyAdDropReadiness(), isReadyToDrop(), LegacyAdDropReadiness, ADR-0044, assess() (+1 more)

### Community 173 - "ADR 0042 & edge cache purge"
Cohesion: 0.25
Nodes (11): main(), TenantRow, ADR-0042, claimEdgeCachePurges(), EdgeCachePurgeRow, markEdgeCachePurgeDone(), markEdgeCachePurgeFailed(), pruneCompletedEdgeCachePurges() (+3 more)

### Community 174 - "projection directory & ProjectionDescriptor"
Cohesion: 0.25
Nodes (12): buildSummaryView(), getProjectionSummaryForTenant(), listProjectionSummariesForTenant(), listRegisteredProjectionDescriptors(), ProjectionSummaryLookupResult, ProjectionSummaryView, getProjectionState(), computeProjectionFreshness() (+4 more)

### Community 175 - "projection metric store & projection reconciliation"
Cohesion: 0.21
Nodes (13): getProjectionMetrics(), MetricDelta, ProjectionMetricValues, assertSafeIdentifier(), computeSourceTotals(), reconcileProjection(), listReconciliationRuns(), ReconciliationMetricDetail (+5 more)

### Community 176 - "person profile) & modules:table writes:check gate"
Cohesion: 0.17
Nodes (15): createPersonProfileForIdentity (single writer for awcms_profiles), Ownership derived, not declared, excusedOwner exception shape, modules:table-writes:check gate, ADR-0013 §6 no shared-table write, tenant_admin platform-bootstrap.ts (one-shot setup wizard), Cross-module pattern discovery without imports, auth_notification port (email adapter, avoids cross-module INSERT) (+7 more)

### Community 177 - "ADR 0045 — Jualanku porting: awcms system of record, awcms astro BFF & PROJECT STATE — versioned continuation point"
Cohesion: 0.16
Nodes (15): Keyset cursor built from full-precision text, not JS Date (microsecond trap), Full-precision text keyset cursor convention (not micro's Date-based encode), Public reading experience moves to ahliweb/awcms-astro; awcms stays admin + content API, Permissions repointed not re-seeded: insert, move grants, then delete old rows, BFF orchestrates and projects but never decides; browser never calls awcms directly, ADR-0045 — Jualanku porting: awcms system of record, awcms-astro BFF, Migration runner: checksum ledger, advisory lock, applied migrations immutable, awcms-micro absorption roadmap (execution map for ADR-0035) (+7 more)

### Community 178 - "AWCMS technical document package index (docs 01 21 plus runbooks) & Doc 21 — module admission, lifecycle and registry governance"
Cohesion: 0.18
Nodes (15): Theme = build-time trusted code, ThemeConfig = tenant data (strict separation), Five jualanku_* bounded contexts, not seven (boundaries from invariants), module-boundary test: declared graph vs actual cross-module imports, Build-time module registry composition and validation (composeModuleRegistry), modules:table-writes:check — coupling through SQL writes, ownership derived not declared, Module vs migration matrix (partly stale, carries an explicit accuracy warning), Security control vs enforcing agent skill matrix, Doc 13 — master document index and traceability matrix (+7 more)

### Community 179 - "adr) & ADR 0027 MFA TOTP, Session Assurance, Step up"
Cohesion: 0.17
Nodes (15): ADR-0022 ERP Modules Live in Extension Repos, ADR-0024 SemVer Continues Legacy Major Line (5.0.0), ADR-0026 Modular OpenAPI Ownership and Composition, Deterministic OpenAPI fragment bundler, ADR-0027 MFA TOTP, Session Assurance, Step-up, TOTP anti-replay compare-and-swap (last_used_step), Session assurance (aal1/aal2) + requireStepUp, ADR-0028 OIDC/SSO Tenant-aware, Account Linking, Break-glass (+7 more)

### Community 180 - "SSO tenant aware reference (Issue #185, ADR 0028) & token fetches"
Cohesion: 0.14
Nodes (15): Provider config as per-tenant DATA (awcms_auth_providers), Auto-link / JIT account-takeover warning, Fail-closed ID token verification (RS256/ES256 allow-list), OIDC/SSO tenant-aware reference (Issue #185, ADR-0028), IdP is authenticator, not authority (opaque AWCMS session), SSRF guard for discovery/JWKS/token fetches, External provider data-governance checklist, Dynamic ABAC DSL evaluator (Issue #179, ADR-0033) (+7 more)

### Community 181 - "logging lint check & scanSourceForLoggingProblems"
Cohesion: 0.24
Nodes (14): ALLOWED_SANITIZER_CALLS, ConsoleCall, findConsoleErrorWarnCalls(), findRawIdiomAssignments(), isDangerousConsoleCall(), lineNumberAt(), LOGGING_LINT_EXEMPTIONS, LoggingLintProblem (+6 more)

### Community 182 - "ADR 0041 & reply notifications"
Cohesion: 0.23
Nodes (11): ADR-0041, CommentEventInput, createReplySubscription(), CreateReplySubscriptionInput, ReplySubscriptionResult, sha256(), ADR-0006, decryptSubscriberEmail() (+3 more)

### Community 183 - "runtime & pressure"
Cohesion: 0.22
Nodes (12): EdgeCacheConfig, isEdgeCacheActive(), createPressureTracker(), Observation, PressureSample, PressureTracker, annotateEdgeCache(), AnnotateEdgeCacheInput (+4 more)

### Community 184 - "permission sync & fetchModulePermissionSyncReport"
Cohesion: 0.22
Nodes (12): CatalogPermissionRow, descriptorPermissionsForModule(), fetchCatalogPermissions(), fetchModulePermissionSyncReport(), ModulePermissionSyncReport, CatalogPermission, comparePermissions(), DescriptorPermission (+4 more)

### Community 185 - "event activity projection & module"
Cohesion: 0.18
Nodes (10): ProjectionRebuildInProgressError, ACCESS_AUDIT_METRIC_KEYS, EVENT_ACTIVITY_METRIC_KEYS, MODULE_ACTIVITY_METRIC_KEYS, REPORTING_PROJECTION_PERMISSIONS, ReportingProjectionPermissionKey, ReportingProjectionPermissionValue, CURSOR_TABLE_FRESHNESS (+2 more)

### Community 186 - "[id] & PUT"
Cohesion: 0.22
Nodes (13): dismissNotFoundObservation(), getRedirectById(), DELETE(), POST(), resolveId(), UPDATE_GUARD, DELETE(), DELETE_GUARD (+5 more)

### Community 187 - "redirect directory & toRecord"
Cohesion: 0.20
Nodes (14): escapeLike(), findConflictingRedirect(), listRedirects(), RedirectListFilters, RedirectRow, ResolvedRedirectRule, restoreRedirect(), setRedirectState() (+6 more)

### Community 188 - "theme lifecycle preview.test & preview token"
Cohesion: 0.24
Nodes (12): buildPreviewUrlToken(), generatePreviewToken(), hashPreviewToken(), isPreviewSessionActive(), isWellFormedPreviewToken(), parsePreviewUrlToken(), resolvePreviewTtlMinutes(), canActivateVersion() (+4 more)

### Community 189 - "visitor analytics privacy.test & analytics response shaping"
Cohesion: 0.18
Nodes (10): listVisitorSessions(), VisitorSessionListPage, VisitorSessionListRow, shapeVisitEvent(), shapeVisitorSession(), VisitEventDto, VisitEventRow, VisitorSessionDto (+2 more)

### Community 190 - "awcms family compatibility.schema.json & required"
Cohesion: 0.14
Nodes (13): additionalProperties, description, $id, required, $schema, title, type, contracts (+5 more)

### Community 191 - "ApiError schema & form drafts OpenAPI fragment"
Cohesion: 0.15
Nodes (14): ApiError schema, ApiMeta schema (correlationId/requestId), bearerAuth security scheme, 128 KiB application-level body size cap, Root OpenAPI source fragment, syncHmac (X-AWCMS-Signature) scheme, tenantHeader (X-AWCMS-Tenant-ID) scheme, createFormDraft (+6 more)

### Community 192 - "changeset policy check & isExempt"
Cohesion: 0.22
Nodes (10): CHANGESET_POLICY_PATH_EXEMPTIONS, ChangesetFrontmatterResult, ChangesetPolicyResult, evaluateChangesetPolicy(), EXEMPT_PATH_PATTERNS, isExempt(), isPackageJsonVersionOnlyChange(), readGitFile() (+2 more)

### Community 193 - "ad policy & validateCreateAdInput"
Cohesion: 0.22
Nodes (13): AD_PLACEMENT_TYPES, CreateAdInput, CreateAdValidationResult, isAdPlacementType(), isNonEmptyString(), parseOptionalDate(), UpdateAdInput, UpdateAdValidationResult (+5 more)

### Community 194 - "seo redirect governance.integration.test & not found directory"
Cohesion: 0.18
Nodes (11): listNotFoundObservations(), NotFoundObservation, ObservationRow, RecordNotFoundInput, recordNotFoundObservation(), resolveNotFoundObservation(), toObservation(), HOST_ENV (+3 more)

### Community 195 - "redirect middleware & redirect eligibility"
Cohesion: 0.22
Nodes (12): NotFoundCaptureContext, EXCLUDED_EXACT, EXCLUDED_SEGMENT_PREFIXES, EXCLUDED_STARTSWITH, fileExtension(), hasControlCharacter(), isRedirectEligiblePath(), STATIC_ASSET_EXTENSIONS (+4 more)

### Community 196 - "condition action registry & workflow condition port"
Cohesion: 0.16
Nodes (8): WorkflowActionContext, WorkflowActionHandler, WorkflowConditionEvaluationContext, WorkflowConditionResolver, alwaysTrueConditionResolver, BASE_ACTION_HANDLERS, BASE_CONDITION_RESOLVERS, noopActionHandler

### Community 197 - "Telegram channel adapter (bot administrator + can post messages) & looksLikeRawSecretToken rejection heuristic"
Cohesion: 0.19
Nodes (13): Provider-neutral POST /accounts/{id}/verify (3-phase, informational 200), Bot-token-in-URL containment (never read response.url, JSON body params), LinkedIn organization-page adapter (live role check on every publish), looksLikeRawSecretToken rejection heuristic, Redact-before-truncate ordering (partial token fragment leak), SocialProviderAdapter interface + empty provider registry, Telegram parse-mode sanitization: plain text default, single-pass escape, Telegram channel adapter (bot administrator + can_post_messages) (+5 more)

### Community 198 - "ADR 0044 — merge news portal into blog content, union of features never a reduction & 001 079)"
Cohesion: 0.22
Nodes (13): Canonical URL resolved from the verified primary tenant domain, not url.origin, social_publishing module (READ-ONLY, not yet ported), Residual risk M1: dangling-DNS takeover via manual-first verify + soft-delete reuse, tenant_domain module (host to tenant mapping), Theme asset resolution delegates ownership/verification entirely to MediaLibraryPort, theming module (first website module living directly in the base), ADR-0044 — merge news_portal into blog_content, union of features never a reduction, Inert writerless tenant-state table dropped; enforcement moves to media_library switch (+5 more)

### Community 199 - "migrationChecksum & properties"
Cohesion: 0.15
Nodes (13): minLength, type, additionalProperties, properties, required, type, algorithm, migrationChecksum (+5 more)

### Community 200 - "required & contracts"
Cohesion: 0.15
Nodes (13): additionalProperties, required, type, contracts, apiResponseEnvelopeVersion, auditRedactionContractVersion, capabilityContractVersions, eventApiInfoVersion (+5 more)

### Community 201 - "properties & familyContractVersion"
Cohesion: 0.15
Nodes (13): description, pattern, type, items, type, $ref, const, description (+5 more)

### Community 202 - "comments OpenAPI fragment & submitPublicComment"
Cohesion: 0.15
Nodes (13): bulkModerateComments, CommentSettings schema, comments OpenAPI fragment, listCommentModerationQueue, moderateComment, reportPublicComment, SubmitCommentResult schema, submitPublicComment (+5 more)

### Community 203 - "scripts inventory & scripts inventory.test"
Cohesion: 0.33
Nodes (11): buildInventory(), extractInventoryBlock(), findFalseAbsenceClaims(), InventoryRow, main(), PackageScripts, parseInventoryBlock(), readPackageScripts() (+3 more)

### Community 204 - "sync agent memory & main"
Cohesion: 0.27
Nodes (12): DOC_PATH, EXCLUDE, exists(), header(), main(), memoryDir(), parseGenerated(), quoteDescription() (+4 more)

### Community 205 - "[id] & index"
Cohesion: 0.24
Nodes (11): fetchMenuItems(), softDeleteMenu(), syncMenuItems(), toItemView(), CONFIGURE_GUARD, DELETE(), PATCH(), CONFIGURE_GUARD (+3 more)

### Community 206 - "blog content presentation domain.test & template policy"
Cohesion: 0.27
Nodes (11): CreateTemplateInput, CreateTemplateValidationResult, isNonEmptyString(), UpdateTemplateValidationResult, VALID_COLUMNS, VALID_SIDEBAR_POSITIONS, validateCreateTemplateInput(), validateTemplateLayout() (+3 more)

### Community 207 - "video news block validation & validateVideoNewsBlock"
Cohesion: 0.26
Nodes (11): ContentJsonVideoBlocksValidationResult, isRecord(), isRecordArray(), isVideoNewsProvider(), NormalizedVideoNewsBlock, normalizeYouTubeVideoId(), validateOptionalStringField(), validateVideoNewsBlock() (+3 more)

### Community 208 - "business scope access control.test & BusinessScopeFact"
Cohesion: 0.15
Nodes (9): BusinessScopeFact, context, DELETE_KEY, grantedDelete, grantedRead, OFFICE_A, OFFICE_CHILD, OFFICE_PARENT (+1 more)

### Community 209 - "rollup & rollupVisitorAnalyticsForDate"
Cohesion: 0.22
Nodes (12): ALLOWED_JSON_COLUMNS, ALLOWED_JSON_KEYS, AreaCountRow, computeDailyAreaRollup(), DailyAreaRollup, fetchDailyAreaCounts(), fetchTopJsonFieldForDay(), fetchTopPathsForDay() (+4 more)

### Community 210 - "awcms family compatibility.yaml (family manifest) & ADR 0032: stack version pinning non free floating"
Cohesion: 0.17
Nodes (12): ADR-0026: modular OpenAPI ownership and composition, ADR-0027: MFA TOTP/session-assurance built new (not ported), ADR-0028: OIDC/SSO SSRF guard blocks private IPs (reverses mini), ADR-0029: Turnstile retains deployment-profile gate, ADR-0030: base business-scope hierarchy resolver is fail-closed NO-OP, ADR-0031: SoD rules illustrative-in-fixture, base ships 0 rules, ADR-0032: stack version pinning non-free-floating, awcms-family-compatibility.yaml (family manifest) (+4 more)

### Community 211 - "ADR 0042: Varnish edge cache tier, off by default & edge cache purge"
Cohesion: 0.17
Nodes (12): Bounded cache key space via allowedQueryParams, decideCacheability fail-closed allow-list, Layered defence against Varnish cache-by-default, ADR-0042: Varnish edge-cache tier, off by default, Origin-pressure auto-activation (pressure changes HOW LONG, never WHAT), Anchored surrogate-key invalidation via durable purge queue, Host-resolved discovery surfaces deliberately not declared, Unlimited-subdomain junction (Cloudflare DNS + host-resolved routes) (+4 more)

### Community 212 - "Data Lifecycle module README & Reporting module (management reporting + projections)"
Cohesion: 0.20
Nodes (12): DataLifecycleDescriptor (HighVolumeTableDescriptor), DataLifecycleLegalHold, Data Lifecycle module (API surface), Email module (API surface), AuditEvent, Logging & Audit module (API surface), Reporting module (management reporting + projections), Sync Storage module (API surface) (+4 more)

### Community 213 - "env contract coverage check & env contract coverage.test"
Cohesion: 0.32
Nodes (10): collectEnvReads(), declaredInEnvExample(), EnvCoverageViolation, findCoverageViolations(), main(), SOURCE_EXTENSIONS, SOURCE_ROOTS, stripComments() (+2 more)

### Community 214 - "projection registry & reporting projection registry.test"
Cohesion: 0.27
Nodes (7): main(), formatProjectionRegistryIssue(), ProjectionRegistryIssue, ProjectionRegistryValidationResult, validateCursorStream(), validateProjectionRegistry(), validateSingleDescriptor()

### Community 215 - "[id] & preview"
Cohesion: 0.21
Nodes (10): fetchActiveEmailTemplate(), softDeleteEmailTemplate(), DELETE(), DELETE_GUARD, GET(), PATCH(), POST(), READ_GUARD (+2 more)

### Community 216 - "role admin validation & validatePermissionRefInput"
Cohesion: 0.23
Nodes (10): CreateRoleInput, DeleteRoleInput, PermissionRefInput, UpdateRoleInput, validateCreateRoleInput(), validateDeleteRoleInput(), validatePermissionRefInput(), validateUpdateRoleInput() (+2 more)

### Community 217 - "scheduled export dispatch & scheduled export store"
Cohesion: 0.26
Nodes (10): dispatchDueScheduledExports(), ScheduledExportDispatchResult, createScheduledExport(), getScheduledExport(), listDueScheduledExports(), listScheduledExports(), ScheduledExportDbRow, ScheduledExportFormat (+2 more)

### Community 218 - "office validation & validateUpdateOfficeInput"
Cohesion: 0.21
Nodes (11): CreateOfficeInput, DeleteOfficeInput, OFFICE_STATUSES, OFFICE_TYPES, OfficeStatus, OfficeType, UpdateOfficeInput, validateCreateOfficeInput() (+3 more)

### Community 219 - "news portal module (historic; merged into blog content) & Finalize does a full GET plus magic byte sniff and server side checksum"
Cohesion: 0.25
Nodes (11): Refusal to fetch external URLs during ingest, js/incomplete-url-substring-sanitization in test fetch mocks, .gitattributes binary override preserves vendored bytes and checksums, Two-layer SSRF guard with redirect: manual re-validation, Presigned direct-to-R2 upload / finalize / cancel, Finalize does a full GET plus magic-byte sniff and server-side checksum, news_portal module (historic; merged into blog_content), Key decision #3: object keys never carry PII or the original filename (+3 more)

### Community 220 - "Idempotent High Risk Mutation Skill & ABAC Guard & Tenant Isolation Skill"
Cohesion: 0.38
Nodes (11): AWCMS Coder Agent, AWCMS Reviewer Agent, AWCMS Security Auditor Agent, ABAC Guard & Tenant Isolation Skill, Audit Log (High-Risk) Skill, Email Module Skill, ERP Extension Readiness Skill (historical, ADR-0034), i18n (String UI & Multilingual Content) Skill (+3 more)

### Community 221 - "sign attest publish) & checkout 7.0.0→7.0.1 bump"
Cohesion: 0.18
Nodes (11): ADR-0024: SemVer continues legacy major line (v5.x), Changeset: actions/checkout 7.0.0→7.0.1 bump, Changeset: github/codeql-action 4.37.1→4.37.3 bump, Changeset: docker/login-action 4.4.0→4.5.1 bump, changesets:policy:check (PR-diff shaped gate), CodeQL job least-required permissions (Issue #685), Integration tests: harness suite vs legacy ad-hoc suite (separate bun test processes), Release: rehearsal (workflow_dispatch) vs real release (tag push) share same job graph (+3 more)

### Community 222 - "devDependencies & cli"
Cohesion: 0.18
Nodes (11): @changesets/cli, devDependencies, @changesets/cli, @playwright/test, prettier, @types/bun, yaml, @playwright/test (+3 more)

### Community 223 - "release verify checks & release verify"
Cohesion: 0.33
Nodes (7): ADR-0024, checkChangelogHasSection(), checkNoPendingChangesets(), checkTagMatchesPackageVersion(), parseVersionFromTag(), Problem, ROOT

### Community 224 - "HR) & Base reusable modules"
Cohesion: 0.18
Nodes (11): Base reusable modules, AWCMS design principles, AWCMS modular monolith architecture, Accounting Tax/Coretax module, ERP domain modules (finance/inventory/procurement/HR), Finance & General Ledger module, Procurement & Vendor module, Warehouse Management module (+3 more)

### Community 225 - "Row Level Security (RLS) & Threat Model and Security Architecture (Doc 20)"
Cohesion: 0.18
Nodes (11): Legal Entity, Organization Unit, Row-Level Security (RLS), Tenant (RLS security boundary), Threat Model and Security Architecture (Doc 20), Layered Security Controls, STRIDE Threat Model, Database Migration Runner (+3 more)

### Community 226 - "Derived Application Guide (DEPRECATED, ADR 0034) & First Derived App Pilot Plan (AWPOS, DEPRECATED)"
Cohesion: 0.25
Nodes (11): BundleConflictError (default-deny override), API Contribution Guide (Issue #182, ADR-0026), Modular OpenAPI ownership & composition, AWPOS pilot (candidate matrix recommendation), First Derived App Pilot Plan (AWPOS, DEPRECATED), Purchase Requisition Pilot Execution Runbook (#187, DEPRECATED), Purchase Requisition Pilot Plan (#187, DEPRECATED), awcms-erp-pilot purchase_requisition vertical slice (+3 more)

### Community 227 - "check docs translation.mjs & docs i18n checks.mjs"
Cohesion: 0.40
Nodes (8): listIdSources(), ROOT, runChecks(), checkTranslationPair(), computeSourceHash(), deriveEnglishPath(), extractRecordedHash(), ADR-0023

### Community 228 - "commentable resource registry & comments resources check"
Cohesion: 0.31
Nodes (9): main(), checkColumn(), COMMENTABLE_POLICY_MODES, CommentableResourceRegistryIssue, CommentableResourceRegistryValidationResult, formatCommentableResourceRegistryIssue(), ADR-0009, validateCommentableResourceRegistry() (+1 more)

### Community 229 - "tenant context usage check & collectUsageViolations"
Cohesion: 0.29
Nodes (9): collectUsageViolations(), EXEMPT_FILES, findUsageViolations(), main(), REASON, SOURCE_EXTENSIONS, SOURCE_ROOTS, UsageViolation (+1 more)

### Community 230 - "compare & parseSemver"
Cohesion: 0.40
Nodes (9): Comparator, compareSemver(), isValidSemver(), ParsedSemver, parseSemver(), parseSemverRange(), satisfiesComparator(), satisfiesSemverRange() (+1 more)

### Community 231 - "ad placement rotation & selectAdsForRotation"
Cohesion: 0.29
Nodes (7): AdRotationMode, AdRotationCandidate, selectAdsForRotation(), shuffle(), sortByLatest(), sortByPriority(), weightedSampleWithoutReplacement()

### Community 232 - "media upload session validation & validateCreateNewsMediaUploadSessionInput"
Cohesion: 0.24
Nodes (9): CreateNewsMediaUploadSessionInput, CreateNewsMediaUploadSessionValidationResult, FinalizeNewsMediaUploadSessionInput, FinalizeNewsMediaUploadSessionValidationResult, validateCreateNewsMediaUploadSessionInput(), validateFinalizeNewsMediaUploadSessionInput(), validateOptionalText(), ValidationError (+1 more)

### Community 233 - "navigation registry & fetchVisibleModuleNavigationEntries"
Cohesion: 0.31
Nodes (7): collectNavigationCandidates(), fetchTenantDisabledModuleKeys(), fetchVisibleModuleNavigationEntries(), filterVisibleNavigationEntries(), NavigationCandidate, NavigationFilterOptions, ModuleLifecycleStatus

### Community 234 - "user agent & parseUserAgent"
Cohesion: 0.31
Nodes (10): BOT_SIGNATURES, BROWSER_PATTERNS, BROWSER_VERSION_PATTERNS, detectBrowser(), detectDeviceType(), detectOs(), DeviceType, isBotUserAgent() (+2 more)

### Community 235 - "Mini first development flow (mature in awcms mini, then port to awcms) & Two flag full online deployment gate (SOCIAL PUBLISHING ENABLED +  PROFILE)"
Cohesion: 0.20
Nodes (10): Per-tenant auto-publishing settings table is deliberately tenant-writable, Two-flag full-online deployment gate (SOCIAL_PUBLISHING_ENABLED + _PROFILE), Modular monolith layout (module.ts, domain, application, api), Modular OpenAPI: per-module fragments, deterministic bundle, api:spec:check parity, Compatibility classes: offline-lan-safe vs full-online-only opt-in, Three sibling templates: mini offline-first, awcms online-first superset, micro website-only, Mini-first development flow (mature in awcms-mini, then port to awcms), Eight port steps (scope adapt, prefix rename, contracts, tests, conformance, changeset) (+2 more)

### Community 236 - "retire & visitor analytics module (ported, type system)"
Cohesion: 0.20
Nodes (10): Edge-cache purge enqueued inside the same transaction as the theming mutation, Preview session retention by read-filter on expires_at, not a purge job, Published version immutability enforced in three layers (app, trigger, pointer), Theming lifecycle draft to validate to preview to publish to rollback/retire, Legal-hold guard gates the WHOLE analytics purge, wider than awcms-micro, Privacy invariants: off by default, salted hashing, fail-safe path sanitization, Raw detail double opt-in, shaped once server-side by permission, visitor_analytics module (ported, type system) (+2 more)

### Community 237 - "required & stack"
Cohesion: 0.20
Nodes (10): astro, bun, stack, additionalProperties, required, type, typescript, astroNode (+2 more)

### Community 238 - "config.json & access"
Cohesion: 0.20
Nodes (9): access, baseBranch, changelog, commit, fixed, ignore, linked, $schema (+1 more)

### Community 239 - "ADR 0031 Segregation of Duties Conflict Enforcement & ADR 0033 Dynamic ABAC Policy Evaluator"
Cohesion: 0.24
Nodes (10): ADR-0030 Business-scope Hierarchy Generic Authorization Layer, Generic (scope_type, scope_id) reference + no base scope tables, Base no-op fail-closed scope resolver, ADR-0031 Segregation of Duties Conflict Enforcement, Maker/checker exception override (no self-approval), Two-point SoD enforcement (assignment-time + action-time), ADR-0033 Dynamic ABAC Policy Evaluator, ABAC condition DSL (bounded jsonb AST interpreter) (+2 more)

### Community 240 - "admin) & New permission = new seed migration (descriptor alone grants nothing)"
Cohesion: 0.20
Nodes (10): Zero new AccessAction (spam marked via reject), Permission seed migrations never reach pre-existing tenants (production incident 2026-07-26), Permission shape ${moduleKey}.${activityCode}.${action} bound to the existing AccessAction union, Jualanku role catalog (13 personas incl. merchant_*, affiliate_member, onboarding_agent), Target endpoint inventory (public / portal merchant / portal affiliate / admin), Deliberately not built in the early phase, Three API namespaces, one rule implementation, Binding repo rules that constrain the Jualanku implementation (+2 more)

### Community 241 - "Eleven ERP contract families (neutral contracts, base is not ERP) & ABAC (Attribute Based Access Control)"
Cohesion: 0.22
Nodes (10): ABAC (Attribute-Based Access Control), Capability Port, Default Deny / Deny Overrides Allow, Glossary and Terminology (Doc 19), Fiscal Period, RBAC (Role-Based Access Control), Dynamic ABAC Policy Evaluator (Issue #179, ADR-0033), Eleven ERP contract families (neutral contracts, base is not ERP) (+2 more)

### Community 242 - "blog content module (epic #536, first domain module registered directly in the base) & Absorption of news portal into blog content (ADR 0044)"
Cohesion: 0.24
Nodes (10): Shared DomainEvent envelope and 44 documented channels, Edge cache: what is deliberately not wired yet, Reuse of existing awcms website modules by Jualanku, One table = one writing module; cross-context only via service/port/read model/event, Jualanku domain events as the only automatic cross-context path, AdPlacement schemas (R2-only media reference), blog_content module (epic #536, first domain module registered directly in the base), 26 AsyncAPI channels whose real producer is the structured logger (+2 more)

### Community 243 - "site search OpenAPI fragment & siteSearchIndexRebuild"
Cohesion: 0.22
Nodes (10): site-search OpenAPI fragment, siteSearchIndexFailures, siteSearchIndexRebuild, siteSearchIndexReconcile, SiteSearchIndexRun schema, siteSearchIndexStatus, SiteSearchSettings schema, siteSearchSettingsUpdate (+2 more)

### Community 244 - ".prettierrc.json & prettier plugin astro"
Cohesion: 0.20
Nodes (9): prettier-plugin-astro, prettier-plugin-astro, overrides, plugins, printWidth, proseWrap, semi, singleQuote (+1 more)

### Community 245 - "keywords & abac"
Cohesion: 0.20
Nodes (10): keywords, abac, bun, business-integration, erp, multi-tenant, offline-first, postgresql (+2 more)

### Community 246 - "resolvePublicTenantFromRequest resolution order & awcms app fail closed default GUC"
Cohesion: 0.20
Nodes (10): awcms_app fail-closed default GUC, src/lib boundary: technical infrastructure only (ADR-0043), logging/ documented namespace exception, modules:dag:check namespace-collision gate, client.ts pool kinds app/worker/setup, withTenant work-class + circuit-breaker gate, site_search port adaptations vs awcms-micro, Host-based tenant routing seam (+2 more)

### Community 247 - "template directory & toView"
Cohesion: 0.29
Nodes (9): BlogTemplateRow, BlogTemplateView, createTemplate(), fetchTemplateById(), listTemplates(), toView(), updateTemplate(), TemplateLayout (+1 more)

### Community 248 - "theme policy & theme settings directory"
Cohesion: 0.27
Nodes (8): BlogThemeSettings, BLOG_THEME_MODES, BlogThemeMode, isBlogThemeMode(), UpdateThemeSettingsInput, UpdateThemeSettingsValidationResult, validateUpdateThemeSettingsInput(), ValidationError

### Community 249 - "news portal preset readiness & news portal preset readiness.test"
Cohesion: 0.29
Nodes (8): evaluateNewsPortalFullOnlineR2Readiness(), isKnownNewsPortalProfile(), NEWS_PORTAL_PROFILES, NewsPortalPresetReadinessReason, NewsPortalPresetReadinessResult, NewsPortalProfile, ADR-0036, FULLY_CONFIGURED_ENV

### Community 250 - "run record store & listLifecycleRuns"
Cohesion: 0.22
Nodes (9): LifecycleRunCounts, LifecycleRunRow, LifecycleRunStatus, LifecycleRunType, listLifecycleRuns(), ListLifecycleRunsFilter, RecordLifecycleRunInput, RunDbRow (+1 more)

### Community 251 - "GOVERNANCE & Private vulnerability reporting policy"
Cohesion: 0.25
Nodes (7): Changesets workflow README, Contributor Covenant Code of Conduct, ADR-based decision-making process, Maintainer / contributor / security-responder roles, Baseline security controls, SECURITY.md — Security Policy, Private vulnerability reporting policy

### Community 252 - "FORCE ROW LEVEL SECURITY (ENABLE alone is inert) & micro port playbook (adapt, not copy)"
Cohesion: 0.22
Nodes (9): Composite tenant-scoped foreign keys (FK bypasses RLS), FORCE ROW LEVEL SECURITY (ENABLE alone is inert), RLS_FREE_TABLES registration for global tables, SECURITY DEFINER bootstrap-read checklist, WORKER_ROLE_GRANTS least-privilege drift matrix, Definition of Done full `bun run check` chain, Mini/micro port playbook (adapt, not copy), Non-negotiable rename rules (awcms_mini_ / awcms_micro_ → awcms_) (+1 more)

### Community 253 - "Meta adapters (Facebook Page + Instagram Business), two provider keys & Outbox discipline: job row written inside the transaction, provider call outside"
Cohesion: 0.25
Nodes (9): Meta error normalization to a fixed safe-message catalog (no fbtrace_id passthrough), Meta adapters (Facebook Page + Instagram Business), two provider keys, Outbox discipline: job row written inside the transaction, provider call outside, Exact-host R2 media URL re-validation before the outbound provider call, Job idempotency enforced by a DB unique index, not application discipline, Exponential retry/backoff with provider rate-limit floor, SocialPublishingPort / NewsMediaPort cross-module capability seams, supportedAccountTypes enforced in the dispatcher, not only at verify/connect (+1 more)

### Community 254 - "properties & astro"
Cohesion: 0.22
Nodes (9): $ref, $ref, $ref, astro, astroNode, postgres, typescript, properties (+1 more)

### Community 255 - "Media Library Module & ADR 0036 media library Module Admission (Ownership Inversion)"
Cohesion: 0.22
Nodes (9): ADR-0036 media_library Module Admission (Ownership Inversion), MediaLibraryPort, Media registry ownership inversion (extraction from news_portal), Media Library Module, MediaLibraryPort Capability, Presigned Direct-to-R2 Upload/Finalize Flow, Public Discovery/Syndication (sitemap/feeds), Central SEO Head Renderer (+1 more)

### Community 256 - "Posting (append only) & ERP Specific Threats"
Cohesion: 0.25
Nodes (9): Coretax / VAT Invoice, HMAC (sync integrity), Ledger Entry / Posting (append-only), Payroll Run, ERP-Specific Threats, Financial Data Integrity (ledger immutability), Payroll & PII Leakage protection, External Webhook Forgery mitigation (+1 more)

### Community 257 - "data lifecycle permissions & module"
Cohesion: 0.33
Nodes (5): DATA_LIFECYCLE_PERMISSIONS, DataLifecyclePermissionKey, DataLifecyclePermissionValue, dataLifecycleModule, ROOT

### Community 258 - "reporting projection rebuild lock.test & lockProjectionForWrite"
Cohesion: 0.31
Nodes (6): hashProjectionLockKey(), lockProjectionForWrite(), DESCRIPTOR, settleWithin(), sleep(), STREAM

### Community 259 - "sync health report & sync health"
Cohesion: 0.33
Nodes (6): fetchSyncHealthReport(), SyncHealthReport, shapeSyncHealth(), SyncHealthCounts, SyncHealthView, GET

### Community 260 - "freshness & reporting projection freshness.test"
Cohesion: 0.28
Nodes (6): ProjectionFreshnessFacts, ProjectionFreshnessStatus, ProjectionFreshnessView, ProjectionFreshnessPolicy, NOW, POLICY

### Community 261 - "soft delete & soft delete.test"
Cohesion: 0.33
Nodes (7): activeRecordPredicate(), deletedRecordPredicate(), ListOptions, shouldIncludeDeleted(), shouldOnlyListDeleted(), SOFT_DELETE_COLUMNS, SoftDeleteColumns

### Community 262 - "legacy ad write path retired.test & DELETE"
Cohesion: 0.25
Nodes (8): DELETE(), PATCH(), GET(), POST(), callRetired(), retiredRequest(), ADR-0036, ADR-0044

### Community 263 - ") reading guide & Changeset: sync docs, agent skills, and knowledge graph post Wave 2"
Cohesion: 0.29
Nodes (8): Changeset: sync docs, agent skills, and knowledge graph post-Wave 2, graphify-out incremental update (8159 nodes, 21470 edges), Stale skill warning hazard (agents rebuild what already exists), Misread 1: graph mixes 'was true' with 'is true', Knowledge Gaps isolated-node count is noise, Knowledge graph (graphify-out/) reading guide, Misread 2: low cohesion is not a split candidate, Tenant Transaction & Authorization Core community (264 nodes)

### Community 264 - "ADR 0034 Direct use Templates and Derived Pathway Removal & data lifecycle module"
Cohesion: 0.25
Nodes (8): ADR-0034 Direct-use Templates and Derived Pathway Removal, Three family repos as direct-use templates, ADR-0035 awcms Online-first ERP+SaaS Superset Repositioning, awcms as superset absorbing awcms-micro website/e-commerce, ADR-0037 data_lifecycle Module Admission, data_lifecycle module, LegalHoldGuardPort (isDescriptorHeld), Legal hold cannot be silently bypassed

### Community 265 - "authorizeInTransaction — single authorization chokepoint incl. module enabled check & Merchant modelled as a business scope, filling the fail closed hierarchy resolver"
Cohesion: 0.25
Nodes (8): ABAC attribute allow-list stays closed — no bespoke merchant attributes, Commission/payout artifacts append-only; prepare vs approve split by SoD, Merchant modelled as a business scope, filling the fail-closed hierarchy resolver, Merchant isolation in three layers; RLS separates tenants and only tenants, authorizeInTransaction — single authorization chokepoint incl. module-enabled check, evaluateAccess — default deny, deny-overrides-allow, structural guards, Opaque-token sessions with SHA-256 storage (not JWT) plus MFA/OIDC/Turnstile layers, recordAuditEvent audit trail with automatic redaction and retention purge

### Community 266 - "data lifecycle module (registry + safe lifecycle engine) & Module Descriptor"
Cohesion: 0.25
Nodes (8): Module Descriptor, Soft Delete, Archive Port + restore procedure (local_offline), Data Lifecycle — operational & compliance guide, HighVolumeTableDescriptor + retention class, Legal Hold (fail-closed precedence), data_lifecycle module (registry + safe lifecycle engine), modular-monolith

### Community 267 - "Minimal domain module example (expense category) & OpenAPI bundle (generated, one file per module)"
Cohesion: 0.29
Nodes (8): Minimal domain module example (expense-category), Module migration RLS ENABLE+FORCE pattern, Thin route auth->tenant->ABAC->service pattern, Module admission decision checklist, Module proposal template, api:spec:check verifications, OpenAPI bundle (generated, one-file-per-module), Derived-application OpenAPI fragments

### Community 268 - "Correction 1 — news portal was MERGED, not 'not yet built' & Negative claims are the dangerous kind of documentation rot"
Cohesion: 0.29
Nodes (8): Composite FK (tenant_id, id) because plain FKs bypass RLS, Table conventions: awcms_jualanku_<context>_<entity>, FORCE RLS, numeric money, Correction 1 — news_portal was MERGED, not 'not yet built', docs/awcms/repo-inventory.md — target-structure document whose body is stale, Candidate RLS-exempt allow-list (infra/registry tables only), Stale negative claims inside a 'generated' inventory document, Deferred reference scripts, guarded against silent resurrection, Negative claims are the dangerous kind of documentation rot

### Community 269 - "listPublicComments & siteSearchQuery"
Cohesion: 0.25
Nodes (8): listPublicComments, PublicComment schema, siteSearchQuery, SiteSearchQueryResult schema, Store plain text, escape then autolink, Publication boundary at resource->thread, The index is a public-content projection, never an authorization source, ts_headline sentinel + escape then mark

### Community 270 - "commentableResources descriptor seam & Per tenant sidebar arrangement stored as a delta"
Cohesion: 0.29
Nodes (8): saveTenantSidebarArrangement, commentableResources descriptor seam, comments:resources:check registry gate, Navigation filtering is not authorization, Per-tenant sidebar arrangement stored as a delta, Registry-derived sidebar model, SearchSourceDescriptor contribution seam, Bound query parameter + validated identifiers

### Community 271 - "tenant route factory check & evaluateTenantRouteMigration"
Cohesion: 0.39
Nodes (6): callsWithTenantDirectly(), evaluateTenantRouteMigration(), main(), NOT_YET_MIGRATED, TenantRouteMigrationResult, walk()

### Community 272 - "009 awcms domain event runtime schema.sql & awcms domain event deliveries"
Cohesion: 0.32
Nodes (7): awcms_domain_event_activity_daily, awcms_domain_event_consumer_effects, awcms_domain_event_consumer_state, awcms_domain_event_deliveries, awcms_domain_event_replays, awcms_domain_events, awcms_idempotency_keys

### Community 273 - "013 awcms workflow approval schema.sql & awcms workflow instances"
Cohesion: 0.43
Nodes (7): awcms_workflow_decisions, awcms_workflow_definitions, awcms_workflow_delegations, awcms_workflow_instances, awcms_workflow_join_arrivals, awcms_workflow_task_assignments, awcms_workflow_tasks

### Community 274 - "015 awcms reporting projections schema.sql & awcms reporting export runs"
Cohesion: 0.29
Nodes (7): awcms_reporting_export_runs, awcms_reporting_projection_cursors, awcms_reporting_projection_metrics, awcms_reporting_projection_state, awcms_reporting_rebuild_runs, awcms_reporting_reconciliation_runs, awcms_reporting_scheduled_exports

### Community 275 - "035 awcms blog content schema.sql & awcms blog post terms"
Cohesion: 0.32
Nodes (7): awcms_blog_pages, awcms_blog_post_terms, awcms_blog_posts, awcms_blog_redirects, awcms_blog_revisions, awcms_blog_settings, awcms_blog_terms

### Community 276 - "037 awcms blog content presentation schema.sql & awcms blog ad placements"
Cohesion: 0.32
Nodes (7): awcms_blog_ad_placements, awcms_blog_ads, awcms_blog_menu_items, awcms_blog_menus, awcms_blog_templates, awcms_blog_theme_settings, awcms_blog_widgets

### Community 277 - "066 awcms comments schema.sql & awcms comments comments"
Cohesion: 0.43
Nodes (7): awcms_comments_abuse_events, awcms_comments_comments, awcms_comments_moderation_events, awcms_comments_reply_subscriptions, awcms_comments_reports, awcms_comments_settings, awcms_comments_threads

### Community 278 - "suppression validation & validateSuppressionInput"
Cohesion: 0.32
Nodes (6): KNOWN_REASONS, Result, SuppressionInput, SuppressionReason, validateSuppressionInput(), ValidationError

### Community 279 - "access guard field access.test & resetPolicyCache"
Cohesion: 0.25
Nodes (4): resetPolicyCache(), GRANTED, NOW, RAW_DETAIL_GUARD

### Community 280 - "Per tenant Salted Visitor Key Hash & Redirect Governance (ADR 0039)"
Cohesion: 0.25
Nodes (8): Redirect Governance (ADR-0039), SEO Distribution Module, Composite Tenant-bound FK (GHSA-r7cx-c4jh-cvvw), Office Hierarchy + Soft-delete/Restore, Public Ingest Beacon (POST /analytics/collect), Retention-based Purge + Legal Hold Gate, Visitor Analytics Module, Per-tenant Salted Visitor-Key Hash

### Community 281 - "settings validation & validateUpdateTenantSettingsInput"
Cohesion: 0.36
Nodes (7): isPlainObject(), Result, UpdateTenantSettingsInput, VALID_LOCALES, VALID_THEMES, validateUpdateTenantSettingsInput(), ValidationError

### Community 282 - "[id] & PUT"
Cohesion: 0.36
Nodes (7): validateUpdateWorkflowDefinitionRequestBody(), DELETE_GUARD, GET(), PUT(), READ_GUARD, serializeDefinition(), UPDATE_GUARD

### Community 283 - "media no local fallback.test & findOffenders"
Cohesion: 0.25
Nodes (5): FORBIDDEN_PATTERNS, MEDIA_OWNING_MODULE_DIRS, NEWS_MEDIA_ROUTES_DIR, ADR-0036, ADR-0044

### Community 284 - "Admin sidebar rendered from module registry (sidebar menu) & Permission seed migration reaches only tenants created after it"
Cohesion: 0.29
Nodes (7): Admin sidebar rendered from module registry (sidebar-menu.ts), Integration suite hook timeout + exit 143 misreporting fix, Per-tenant sidebar arrangement stored as DELTA, never snapshot, Admin shell parity with awcms-micro (AdminLayout, CSP hashed theme-init), navigation split-brain (descriptor vs static navSections), Permission-seed migration reaches only tenants created after it, site_search module port + searchSources seam (ADR-0040)

### Community 285 - "idn admin regions module (NOT ported; port spec) & CONTENT BLOCK TYPES runtime vocabulary"
Cohesion: 0.33
Nodes (7): BlogContentBlock / BlogContentJson OpenAPI schema, tests/content-block-contract.test.ts, CONTENT_BLOCK_TYPES runtime vocabulary, Prose-only vocabulary gets re-derived, and re-derivation is where it breaks, idn_admin_regions module (NOT ported; port spec), source-provenance.ts as single source of truth for source/license/caveat, The browser never calls awcms directly (awcms-astro BFF)

### Community 286 - "work class registry generator + freshness gate (ghost .generated artifact) & awcms setup)"
Cohesion: 0.29
Nodes (7): defineTenantRoute + api:tenant-route:check (shrink-only NOT_YET_MIGRATED), work-class registry generator + freshness gate (ghost .generated artifact), PaaS superuser makes FORCE RLS inert (staging 2026-07-25), Deployment profile selection (LAN-first vs registry-based), Three-role database model (awcms_app / awcms_worker / awcms_setup), edge-cache:surfaces:check ownership-derived purge obligation, Ghost env vars AUTH_JWT_SECRET / APP_TIMEZONE documented but unread

### Community 287 - "CodeQL triage process & trivial conditional on a build time extension seam (historic)"
Cohesion: 0.43
Nodes (7): js/comparison-between-incompatible-types on the typeof/null idiom, Official dismissal without code reformulation (alerts #16-#18), js/insufficient-password-hash name heuristic false positive, js/implicit-operand-conversion on a Bun.SQL tagged template, CodeQL triage process, js/trivial-conditional on a build-time extension seam (historic), js/trivial-conditional as a REAL dead-code bug (alert #140)

### Community 288 - "edge cache:purge job (structural exception, no owning module) & runJob (advisory lock per job name runner)"
Cohesion: 0.29
Nodes (7): ADR-0043: edge-cache as src/lib infrastructure, not a module, Changeset: edge-cache:surfaces:check made testable, Claim-lease per-row pattern (FOR UPDATE SKIP LOCKED), edge-cache:purge job (structural exception, no owning module), edge-cache:surfaces:check allow-list gate, matchPublicCacheSurface traversal guard, runJob (advisory-lock-per-job-name runner)

### Community 289 - "declared & source"
Cohesion: 0.29
Nodes (7): minLength, type, declared, source, minLength, type, properties

### Community 290 - "hygiene) & family:conformance:check gate"
Cohesion: 0.38
Nodes (7): Changeset: @playwright/test 1.61.1→1.62.0 bump, Changeset: prettier 3.9.5→3.9.6 bump, bun run check gate chain, E2E smoke seeds tenant via setup wizard bootstrap, family:conformance:check gate, Minimum-supported Bun floor CI cell (1.3.0), CI workflow (quality/e2e-smoke/integration-tests/minimum-supported/hygiene)

### Community 291 - "Changeset:   dry run for retention jobs & Unmigrated workers without cross instance lock (comments:retention, form drafts:purge, site search:reconcile, tenant domain:dns:sync)"
Cohesion: 0.29
Nodes (7): Changeset: --dry-run for retention jobs, Legal hold guard consulted by retention dry-run preview, resolveCommentsRetentionCutoff (shared cutoff function), resolveFormDraftRetentionCutoff (shared cutoff function), --dry-run for form-drafts:purge & comments:retention, Unmigrated workers without cross-instance lock (comments:retention, form-drafts:purge, site-search:reconcile, tenant-domain:dns:sync), Issue #291: migrate remaining dispatchers to runJob

### Community 292 - "ModuleDescriptor contract & ADR 0025 Deterministic Build time Module Composition"
Cohesion: 0.38
Nodes (7): ADR-0025 Deterministic Build-time Module Composition, Module composition seam (mergeModuleRegistries/composeModuleRegistry), SoDRuleDescriptor registry (code-only rules), HighVolumeTableDescriptor (module-contributed lifecycle registry), ModuleDescriptor contract, Coding agent generator prompt, Claude Code skills & subagents plan

### Community 293 - "seo distribution module (discovery scope) & seo facts capability port"
Cohesion: 0.33
Nodes (7): blog_content as seo_facts provider, Public discovery routes (robots/sitemap/feed), Host-header poisoning defense (resolve-canonical-host), Controlled JSON-LD emission guard, seo_distribution module (discovery scope), seo_facts capability port, awcms_seo_tenant_settings config table

### Community 294 - "Provider feature flags (default off) & Hybrid online first operating mode"
Cohesion: 0.29
Nodes (7): Hybrid online-first operating mode, Production readiness checklist & go-live gates, Two-layer i18n (.po catalog + DB content), Offline-first resilience (SW + IndexedDB outbox), Database role separation (app/worker/setup), Environment variable reference, Provider feature flags (default off)

### Community 295 - "Segregation of duties (SoD) & ABAC default policy set"
Cohesion: 0.33
Nodes (7): Segregation of duties (SoD), Sensitive data classification & masking, ABAC default policy set, Business-Scope Hierarchy (Issue #180, ADR-0030), Segregation of Duties Layer (Issue #181, ADR-0031), requester!=approver SoD rule + self-approval deny, BusinessScopeHierarchyPort resolver injection

### Community 296 - "Bun only backend platform standard & Admin shell & role aware navigation"
Cohesion: 0.29
Nodes (7): Bun-only backend platform standard, Admin shell & role-aware navigation, Component library, Design tokens & theming, WCAG 2.1 AA accessibility, Astro SSR on Bun runtime, Development Standard Compliance Audit (2026-07-04, historical)

### Community 297 - "Frozen open redirect guard & Managed media enforcement (one way switch, ADR 0036)"
Cohesion: 0.29
Nodes (7): Managed-media enforcement (one-way switch, ADR-0036), Media Library module (API surface), NewsMediaObjectItem (media registry object), SEO & Distribution module (API surface), Frozen open-redirect guard, Tenant Domain module (hostname mappings), Theming module (draft/publish/rollback)

### Community 298 - "db pool health & main"
Cohesion: 0.43
Nodes (4): interpretPoolHealthStatus(), main(), PoolHealthOutcome, resolveAppBaseUrl()

### Community 299 - "005 awcms abac access control schema.sql & awcms role permissions"
Cohesion: 0.43
Nodes (6): awcms_abac_decision_logs, awcms_abac_policies, awcms_access_assignments, awcms_permissions, awcms_role_permissions, awcms_roles

### Community 300 - "online security config & isFullOnlineSecurityActive"
Cohesion: 0.43
Nodes (6): isFullOnlineSecurityActive(), isKnownOnlineSecurityProfile(), isOnlineSecurityEnabled(), KNOWN_ONLINE_SECURITY_PROFILES, OnlineSecurityProfile, resolveOnlineSecurityProfile()

### Community 301 - "ADR 0015 & family conformance ci parity.test"
Cohesion: 0.29
Nodes (3): ADR-0015, ROOT, ADR-0032

### Community 302 - "index & PATCH"
Cohesion: 0.38
Nodes (6): fetchBlogThemeSettings(), upsertBlogThemeSettings(), CONFIGURE_GUARD, GET(), PATCH(), READ_GUARD

### Community 303 - "Email Dispatcher (claim lease outbox) & EmailProvider Port Contract"
Cohesion: 0.33
Nodes (7): Per-provider Circuit Breaker, Email Dispatcher (claim-lease outbox), EmailProvider Port Contract, Mailketing Provider Adapter, Object Sync Dispatcher (CLAIM/UPLOAD/FINALIZE), Object Sync Upload Queue, ObjectUploader Port

### Community 304 - "sod conflict evaluation log & listSoDConflictEvaluations"
Cohesion: 0.33
Nodes (6): listSoDConflictEvaluations(), ListSoDConflictEvaluationsFilter, SoDConflictEvaluationDbRow, SoDConflictEvaluationInput, SoDConflictEvaluationRow, toRow()

### Community 305 - "media r2 client.test & readCappedStream"
Cohesion: 0.33
Nodes (4): readCappedStream(), BASE_CONFIG, fetch(), xmlListResponse()

### Community 306 - "email health report & email health"
Cohesion: 0.43
Nodes (5): EmailHealthReport, fetchEmailHealthReport(), EmailHealthCounts, EmailHealthView, shapeEmailHealth()

### Community 307 - "index & POST"
Cohesion: 0.43
Nodes (6): validateCreateWorkflowDefinitionRequestBody(), CREATE_GUARD, GET(), POST(), READ_GUARD, serializeDefinition()

### Community 308 - "pages (ADR 0043) & matrix + per module audit summary"
Cohesion: 0.33
Nodes (6): src/lib boundary + module-boundary gate over src/pages (ADR-0043), GET /api/v1/tenant/modules/matrix + per-module audit summary, Tenant module presets (minimal/website/news_portal/back_office), ModuleApiContract.routes + modules:routes:check (longest-prefix ownership), adr-admission-implementation-status test (Accepted != shipped), tests/module-boundary.test.ts (declared-graph gate)

### Community 309 - "Changeset: module job registry crosscheck & ModuleDescriptor.jobs (operator facing job schedule descriptor)"
Cohesion: 0.40
Nodes (6): Changeset: module job registry crosscheck, db:work-class:check CI drift gate (Issue #263), JOB_WORK_CLASS_REGISTRY (capacity budget, ground-truth enforced), ModuleDescriptor.jobs (operator-facing job schedule descriptor), modules:jobs:check gate, tenant-domain:dns:sync job (newly deployed with descriptor)

### Community 310 - "deployment profiles & capacity config (fleet wide connection budget validator)"
Cohesion: 0.47
Nodes (4): src/lib/database/capacity-config.ts (fleet-wide connection budget validator), bun run database:capacity:check (planned CLI wrapper, not yet built), Process class inventory: app/worker/setup roles, Two/three-role DB model: awcms_app / awcms_worker / awcms_setup

### Community 311 - "ADR index and register (ADR 0001 to ADR 0045) & ADRs are never deleted; superseded decisions are marked and back referenced"
Cohesion: 0.33
Nodes (6): ADR index and register (ADR-0001 to ADR-0045), ADRs are never deleted; superseded decisions are marked and back-referenced, ADR index (Indonesian source), Finding: five ADR-Accepted modules with no code, awcms-mini backbone absorption roadmap (waves A-D), SaaS control-plane admission ADR as a governance blocker

### Community 312 - "Idempotency & Double Payment mitigation"
Cohesion: 0.33
Nodes (6): Domain Event + Envelope, Idempotency, Double-Posting / Double-Payment mitigation, Verified base seam map (auth/workflow/audit/idempotency), Nine-step derived-app build flow, Posting request/result event envelope

### Community 313 - "withTenant integration point (SET LOCAL tenant + backpressure) & Database Connection Pooling and Backpressure"
Cohesion: 0.47
Nodes (6): Work Class, Bun.SQL pool config, Circuit Breaker (3-state, fail-fast), Database Connection Pooling and Backpressure, withTenant integration point (SET LOCAL tenant + backpressure), Work-Class Concurrency Gate

### Community 314 - "submitFormDraft & Tenant module presets"
Cohesion: 0.33
Nodes (6): submitFormDraft, applyTenantModulePreset, Idempotency-Key on submit but not create, No separate submit AccessAction, Tenant module presets, Reuse the stronger existing permission

### Community 315 - "news share.js & enhanceCopyLinkButtons"
Cohesion: 0.67
Nodes (5): enhanceCopyLinkButtons(), enhanceNativeShareButtons(), fallbackCopyToClipboard(), findWidget(), showStatus()

### Community 316 - "024 awcms mfa totp schema.sql & awcms identity mfa factors"
Cohesion: 0.40
Nodes (5): awcms_identity_mfa_factors, awcms_identity_mfa_recovery_codes, awcms_mfa_challenges, awcms_sessions, awcms_tenant_mfa_policies

### Community 317 - "033 awcms theming config schema.sql & awcms theming config versions"
Cohesion: 0.53
Nodes (5): awcms_theming_config_versions, awcms_theming_preview_sessions, awcms_theming_tenant_state, awcms_theming_versions_guard(), awcms_theming_versions_immutable

### Community 318 - "public content port adapter & public content port"
Cohesion: 0.60
Nodes (4): PublicContentCategoryDTO, PublicContentPort, PublicContentPostPageDTO, PublicContentPostSummaryDTO

### Community 319 - "db role grants narrow migration.test & migrationSql"
Cohesion: 0.33
Nodes (3): migrationSql, migrationStatements, repoRoot

### Community 320 - "db role separation migration.test & migrationSql"
Cohesion: 0.33
Nodes (3): migrationSql, migrationStatements, repoRoot

### Community 321 - "Seven binding posting invariants (immutable posted, reversal, business identity uniqueness) & example erp extension fixture as machine verifiable proof"
Cohesion: 0.40
Nodes (5): Append-only & immutable table policy, business-transaction-contract passive data types, A security claim in an ADR is not proof of the claim, example-erp-extension fixture as machine-verifiable proof, Seven binding posting invariants (immutable posted, reversal, business-identity uniqueness)

### Community 322 - "Tenant Admin Module & Composite FK parent office (GHSA r7cx)"
Cohesion: 0.40
Nodes (5): Composite FK parent office (GHSA-r7cx), Tenant Admin Module, Office soft-delete + restore, Setup wizard bootstrapPlatformTenant, awcms_tenants RLS-free root table

### Community 323 - "Workflow Approval Module & Delegation (standing based, not permission grant)"
Cohesion: 0.50
Nodes (5): Delegation (standing-based, not permission grant), Escalation/timeout worker job, Closed-set graph node model, Workflow Approval Module, Self-approval-deny check

### Community 324 - "ADR 0039 — SEO Distribution Redirect Governance & Privacy Minimized 404 Observation Telemetry"
Cohesion: 0.40
Nodes (5): ADR-0039 — SEO Distribution Redirect Governance, Privacy-Minimized 404 Observation Telemetry, ADR-0038 — SEO Distribution Discovery Scope, Fail-Open Public Redirect Middleware Hook (src/middleware.ts), Frozen Open-Redirect Guard (redirect-target-classification.ts)

### Community 325 - "Module Management registry tables & Blog Content module SOP (future port)"
Cohesion: 0.40
Nodes (5): Email base infrastructure tables, Module Management registry tables, Blog Content module SOP (future port), Module Management operational SOP, Operational SOP & user guide

### Community 326 - "Varnish 7.5 edge cache service & default grace=0 belt and braces"
Cohesion: 0.40
Nodes (5): default_ttl=0 / default_grace=0 belt-and-braces, Malloc storage sizing vs ban lurker, EDGE_CACHE_PURGE_TOKEN shared secret, Varnish 7.5 edge-cache service, Adoption is a two-sided change

### Community 327 - "010 awcms sync storage outbox inbox schema.sql & awcms sync nodes"
Cohesion: 0.70
Nodes (4): awcms_sync_inbox, awcms_sync_nodes, awcms_sync_outbox, awcms_sync_push_batches

### Community 328 - "014 awcms email schema.sql & awcms email delivery attempts"
Cohesion: 0.50
Nodes (4): awcms_email_delivery_attempts, awcms_email_messages, awcms_email_suppression_list, awcms_email_templates

### Community 329 - "025 awcms oidc sso schema.sql & awcms auth providers"
Cohesion: 0.60
Nodes (4): awcms_auth_providers, awcms_external_identities, awcms_oidc_auth_requests, awcms_tenant_auth_policies

### Community 330 - "055 awcms data lifecycle schema.sql & awcms data lifecycle archive manifests"
Cohesion: 0.40
Nodes (4): awcms_data_lifecycle_archive_manifests, awcms_data_lifecycle_cursors, awcms_data_lifecycle_legal_holds, awcms_data_lifecycle_runs

### Community 331 - "correlation response & correlation response.test"
Cohesion: 0.60
Nodes (3): CorrelationMergeResult, isApiJsonResponseCandidate(), mergeCorrelationIdIntoApiPayload()

### Community 332 - "visitor analytics collect rate limit.test & resetRateLimitForTests"
Cohesion: 0.50
Nodes (4): resetRateLimitForTests(), callCollect(), COLLECT_LIMIT, fakeCookies()

### Community 333 - "Reusable wizard form component library (target spec, not ported) & postJson) mandatory import"
Cohesion: 0.50
Nodes (4): admin-form-client (lockElement/sendJson/postJson) mandatory import, No component library — hand-rolled markup conventions, Client-side wizard drafts hold only non-sensitive, non-persistent state, Reusable wizard-form component library (target spec, not ported)

### Community 334 - "Issue template chooser config & Bug report issue template"
Cohesion: 0.50
Nodes (4): Bug report issue template, Issue template chooser config, Documentation issue template, Feature request issue template

### Community 335 - "ADR 0034 — Direct Use Templates & Derived Pathway Removal & micro)"
Cohesion: 0.50
Nodes (4): ADR-0020 — Neutral ERP-Readiness Contracts, ADR-0034 — Direct-Use Templates & Derived Pathway Removal, AWCMS Family Direct-Use Templates (mini/awcms/micro), Family Compatibility Manifest + CI Conformance Gate

### Community 336 - "Changeset: DATABASE BUSY typed refusal (withTenant split) & db:tenant context:check gate"
Cohesion: 0.67
Nodes (4): Changeset: DATABASE_BUSY typed refusal (withTenant split), db:tenant-context:check gate, purgeExpiredAuditEvents (broken by `as T` cast), runBoundedBatches (count===0 loop bug)

### Community 337 - "Changeset: env var .env.example coverage gate & config:env:coverage:check gate"
Cohesion: 0.50
Nodes (4): Changeset: env var .env.example coverage gate, config:env:coverage:check gate, R2_ACCOUNT_ID/R2_BUCKET/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY vars, TENANT_DOMAIN_DNS_PROVIDER env var (undocumented)

### Community 338 - "CONTRIBUTING & bun run check (main CI validation gate)"
Cohesion: 0.50
Nodes (3): bun run check (main CI validation gate), Conventional Commits convention, Definition of Done

### Community 339 - "Typed admin API client (admin form client) & Cookie httpOnly auth & session"
Cohesion: 0.50
Nodes (4): Idempotency wrapper rules, Typed admin API client (admin-form-client), Cookie httpOnly auth & session, Full-online auth security hardening gate

### Community 340 - "002 awcms tenant office schema.sql & awcms tenants"
Cohesion: 0.83
Nodes (3): awcms_offices, awcms_tenant_settings, awcms_tenants

### Community 341 - "003 awcms central profile schema.sql & awcms profiles"
Cohesion: 0.83
Nodes (3): awcms_profile_entity_links, awcms_profile_identifiers, awcms_profiles

### Community 342 - "004 awcms identity login schema.sql & awcms identities"
Cohesion: 0.83
Nodes (3): awcms_identities, awcms_sessions, awcms_tenant_users

### Community 343 - "050 awcms visitor analytics schema.sql & awcms visit events"
Cohesion: 0.67
Nodes (3): awcms_visit_events, awcms_visitor_daily_rollups, awcms_visitor_sessions

### Community 344 - "060 awcms seo distribution redirect schema.sql & awcms seo not found observations"
Cohesion: 0.50
Nodes (3): awcms_seo_not_found_observations, awcms_seo_redirect_settings, awcms_seo_redirects

### Community 345 - "comments:retention anonymization sweep & Legal hold enforced at the purge, not in data lifecycle"
Cohesion: 0.50
Nodes (4): Minimized PII (hash, mask, AES-256-GCM), comments:retention anonymization sweep, Two-phase retention: expire then purge, Legal hold enforced at the purge, not in data_lifecycle

### Community 346 - "lifecycle validation & DeleteReasonRequestBody"
Cohesion: 0.50
Nodes (3): DeleteReasonRequestBody, DeleteReasonValidationResult, ValidationError

### Community 347 - "CSS Value Validation by Rejection & ThemeConfig (data, not code)"
Cohesion: 0.50
Nodes (4): CSS Value Validation by Rejection, ThemeConfig (data, not code), Theme Lifecycle (draft→publish→rollback), Theming Module

### Community 349 - "OpenAPI Conflict Fixture: base path override & Bundle Fragment Conflict Rejection (BundleConflictError)"
Cohesion: 0.83
Nodes (4): OpenAPI Conflict Fixture: unsupported components section, OpenAPI Conflict Fixture: base path override, OpenAPI Conflict Fixture: shared schema override, Bundle Fragment Conflict Rejection (BundleConflictError)

### Community 350 - "migration tenant guc consistency.test & readMigrations"
Cohesion: 0.67
Nodes (3): ALLOWED_OTHER_GUCS, readMigrations(), stripSqlComments()

### Community 352 - "isFullOnlineSecurityActive shared deployment gate & TOTP paused login (state driven, not env gated)"
Cohesion: 0.67
Nodes (3): isFullOnlineSecurityActive shared deployment gate, MFA/TOTP paused login (state-driven, not env-gated), Turnstile enforcement (enforceTurnstileIfRequired, breaker discipline)

### Community 353 - "defineTenantRoute (mandatory tenant route opener) & NOT YET MIGRATED shrink only allow list"
Cohesion: 0.67
Nodes (3): defineTenantRoute (mandatory tenant route opener), NOT_YET_MIGRATED shrink-only allow-list, workClass pool budget (required, no default)

### Community 354 - ":tenantCode urlTemplate placeholder (throws if unresolved) & Public tenant scoped routes via path tenantCode (ADR 0009)"
Cohesion: 0.67
Nodes (3): Public tenant-scoped routes via path tenantCode (ADR-0009), ADR-0035 awcms as online-first superset absorbing awcms-micro, :tenantCode urlTemplate placeholder (throws if unresolved)

### Community 355 - "Bounded file parsing (HTTP tier + early parser abort) & readJsonBody body size limit tiers"
Cohesion: 0.67
Nodes (3): readJsonBody body-size limit tiers, Non-configurable sitemap/feed amplification ceilings, Bounded file parsing (HTTP tier + early parser abort)

### Community 356 - "searchSources descriptor seam (owner declares, aggregator discovers) & seo facts capability port (content modules provide facts)"
Cohesion: 0.67
Nodes (3): seo_facts capability port (content modules provide facts), Aggregator-never-depends-on-provider arrow direction, searchSources descriptor seam (owner declares, aggregator discovers)

### Community 357 - "Sync HMAC & Offline Sync & Node inactive by default registration + admin approve"
Cohesion: 0.67
Nodes (3): Sync HMAC & Offline Sync, Node inactive-by-default registration + admin approve, Versioned v2 HMAC signature (GHSA-c972)

### Community 358 - "half open) & Idempotency store (awcms idempotency keys, race loser replay)"
Cohesion: 0.67
Nodes (3): Circuit breaker (per-provider fail-fast, open/closed/half_open), Idempotency store (awcms_idempotency_keys, race-loser replay), Work-class pool gate + queue + circuit breaker

### Community 359 - "ERD & data dictionary & RLS tenant isolation standard"
Cohesion: 0.67
Nodes (3): ERD & data dictionary, RLS tenant-isolation standard, Soft delete standard

### Community 360 - "milestone plan & Base generic GitHub issues backlog"
Cohesion: 0.67
Nodes (3): Base generic GitHub issues backlog, Sprint/milestone plan, Testing pyramid strategy

### Community 361 - "CI quality gate parity & Branch Protection — Required Status Checks"
Cohesion: 1.00
Nodes (3): bun run check / CI quality gate parity, Branch Protection — Required Status Checks, Required Status Checks (Repository Ruleset)

### Community 362 - "Static by default with on demand routes (not 'hybrid') & auth matrix"
Cohesion: 0.67
Nodes (3): Per-surface rendering/cache/auth matrix, Static-by-default with on-demand routes (not 'hybrid'), Correction 7 — 'hybrid application' is not a valid Astro term

### Community 363 - "IEC 40500:2025) & Reuse AWCMS design tokens via theming, no new token system"
Cohesion: 0.67
Nodes (3): Reuse AWCMS design tokens via theming, no new token system, WCAG 2.2 AA baseline (ISO/IEC 40500:2025), Standards baseline (ISO/IEC 27001/27002/27005/27701/27018/15408, OWASP ASVS 5.0, WCAG 2.2)

### Community 364 - "Domain event outbox + dead letter replay & Domain Event Runtime module (API surface)"
Cohesion: 0.67
Nodes (3): Domain Event Runtime module (API surface), Domain event outbox + dead-letter replay, HMAC-authenticated sync (push/pull/status/objects)

### Community 369 - "Secret shaped keys rejected, not redacted & Opaque JSONB payload owned by the creating module"
Cohesion: 0.67
Nodes (3): Opaque JSONB payload owned by the creating module, Secret-shaped keys rejected, not redacted, Non-secret tenant module settings

## Ambiguous Edges - Review These
- `Integration suite hook timeout + exit 143 misreporting fix` → `Permission-seed migration reaches only tenants created after it`  [AMBIGUOUS]
  .changeset/integration-hook-timeout.md · relation: conceptually_related_to
- `GET /api/v1/tenant/modules/matrix + per-module audit summary` → `ModuleApiContract.routes + modules:routes:check (longest-prefix ownership)`  [AMBIGUOUS]
  .changeset/module-route-ownership.md · relation: conceptually_related_to
- `Root tag catalog (module-level API surface grouping)` → `Blog Content OpenAPI module fragment`  [AMBIGUOUS]
  openapi/awcms-public-api.openapi.yaml · relation: references
- `Blog Content OpenAPI module fragment` → `AWCMS API & Event Reference (generated from the bundled contracts)`  [AMBIGUOUS]
  docs/awcms/api-reference.md · relation: references

## Knowledge Gaps
- **2574 isolated node(s):** `$schema`, `changelog`, `commit`, `fixed`, `linked` (+2569 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **85 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Integration suite hook timeout + exit 143 misreporting fix` and `Permission-seed migration reaches only tenants created after it`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `GET /api/v1/tenant/modules/matrix + per-module audit summary` and `ModuleApiContract.routes + modules:routes:check (longest-prefix ownership)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Root tag catalog (module-level API surface grouping)` and `Blog Content OpenAPI module fragment`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._
- **What is the exact relationship between `Blog Content OpenAPI module fragment` and `AWCMS API & Event Reference (generated from the bundled contracts)`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._
- **Why does `keywords` connect `keywords & abac` to `package.json & generated artifacts have tooling.test`, `tenant context & access guard`, `data lifecycle module (registry + safe lifecycle engine) & Module Descriptor`?**
  _High betweenness centrality (0.118) - this node is a cross-community bridge._
- **Why does `modular-monolith` connect `data lifecycle module (registry + safe lifecycle engine) & Module Descriptor` to `keywords & abac`?**
  _High betweenness centrality (0.110) - this node is a cross-community bridge._
- **Why does `Module Descriptor` connect `data lifecycle module (registry + safe lifecycle engine) & Module Descriptor` to `Eleven ERP contract families (neutral contracts, base is not ERP) & ABAC (Attribute Based Access Control)`?**
  _High betweenness centrality (0.110) - this node is a cross-community bridge._