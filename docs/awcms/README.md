🇬🇧 English (default) · 🇮🇩 [Bahasa Indonesia (sumber)](README.id.md)

<!-- i18n-source-hash: sha256:c2a4a1d122137c76cf122047da79927090fcad44f8bc9c7d5d3b9147a3c0377b -->

# AWCMS Technical Document Package

This folder holds AWCMS's standard technical document package — the **AWCMS-family ERP/back-office template, used DIRECTLY**, now positioned as **online-first hybrid, ERP + integrated-SaaS ready, and the family superset** that **absorbs** awcms-micro's website/e-commerce cluster ([ADR-0034](../adr/0034-awcms-family-direct-use-templates-and-derived-pathway-removal.md), [ADR-0035](../adr/0035-awcms-online-first-erp-saas-superset-repositioning.md)); domain modules (ERP/website/e-commerce/content) are added **directly in `src/modules/`**, not a derived repo. This package is adapted from the `docs/awcms-mini/` document package in the [awcms-mini](https://github.com/ahliweb/awcms-mini) repo (technology base: Bun + Astro 7 + PostgreSQL/RLS, modular monolith), tailored to a broader scope: ERP-readiness contracts (finance, inventory, procurement, manufacturing, HR/payroll), website/e-commerce capabilities, and a framework for integrating external business solutions.

> **Note (translation status).** This index and its short descriptions are maintained bilingually (this file is generated from [`README.id.md`](README.id.md), staleness-checked by `bun run check:docs:translation` — [ADR-0023](../adr/0023-bilingual-docs-indonesian-source-english-default.md)). The **body documents linked below are currently Indonesian-only** — English translations are rolled out per document as they're prioritized, not all at once (see ADR-0023 §Context for why: ~30,000 lines across ~40 files makes a single-pass translation impractical to review responsibly).

## Status

This repo is past the rebuild-foundation stage (see [ADR-0001](../adr/0001-rebuild-on-awcms-foundation-erp-scope.md)) — a dozen-plus foundation + website/content modules are already live (including `theming`, `blog-content`, `news-portal`; advanced auth MFA/OIDC/SSO/business-scope/SoD; see [`../ARCHITECTURE.md`](../ARCHITECTURE.md) as the source of truth for code state). Some documents in this folder are still **plan/target** for capabilities being absorbed from awcms-micro (see [`absorb-awcms-micro-roadmap.md`](absorb-awcms-micro-roadmap.md)), not all the current state of the code. Claims of "already live/available/verified" from the awcms-mini/awcms-micro source documents should be read as binding targets for future implementation here when the relevant module has not yet been ported.

This package now adapts **the entire** technical document set from the awcms-mini reference repo so AWCMS is ready to be developed with the same agent tooling (see also [`.claude/skills/`](../../.claude/skills/README.md) and [`Pedoman_Penggunaan_Agent_Keluarga_AWCMS_v1.0.pdf`](../Pedoman_Penggunaan_Agent_Keluarga_AWCMS_v1.0.pdf)). Documents from the website/e-commerce cluster (news portal, social publishing, visitor analytics, comments, newsletter, SEO, etc.) are now **target specifications for the awcms-micro absorption** ([ADR-0035](../adr/0035-awcms-online-first-erp-saas-superset-repositioning.md), map in [`absorb-awcms-micro-roadmap.md`](absorb-awcms-micro-roadmap.md)) — those modules are **absorbed directly into this template's `src/modules/`**, not merely patterns to map.

## Document index

| Document                                                                                               | Contents                                                                           |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| [`01_canvas_induk.md`](01_canvas_induk.md)                                                             | Product summary, high-level architecture, core principles                          |
| [`02_prd_detail_per_modul.md`](02_prd_detail_per_modul.md)                                             | PRD per module (foundation + ERP: finance, procurement, inventory, etc.)           |
| [`03_srs_detail_per_modul.md`](03_srs_detail_per_modul.md)                                             | SRS / technical requirements per module                                            |
| [`04_erd_data_dictionary.md`](04_erd_data_dictionary.md)                                               | ERD & data dictionary per module                                                   |
| [`05_openapi_asyncapi_detail.md`](05_openapi_asyncapi_detail.md)                                       | API/event contract detail per module                                               |
| [`06_github_issues_detail.md`](06_github_issues_detail.md)                                             | Epic/issue structuring pattern (reference from awcms-mini repo)                    |
| [`07_sprint_testing_production_readiness.md`](07_sprint_testing_production_readiness.md)               | Layered test strategy & production readiness                                       |
| [`08_sop_operasional_user_guide.md`](08_sop_operasional_user_guide.md)                                 | Operational SOPs & user guide (reference)                                          |
| [`09_roadmap_repository_commit.md`](09_roadmap_repository_commit.md)                                   | Roadmap, repository, and commit conventions                                        |
| [`10_template_kode_coding_standard.md`](10_template_kode_coding_standard.md)                           | Coding standard (module structure, Bun-only, conventions)                          |
| [`11_implementation_blueprint.md`](11_implementation_blueprint.md)                                     | Implementation blueprint per sprint (14 sprints: foundation → ERP → integration)   |
| [`12_generator_prompt.md`](12_generator_prompt.md)                                                     | Module scaffolding prompts per sprint                                              |
| [`13_final_master_index_traceability.md`](13_final_master_index_traceability.md)                       | Master index & cross-document traceability matrix                                  |
| [`14_ui_ux_design_system.md`](14_ui_ux_design_system.md)                                               | Design system, tokens, state pattern, a11y                                         |
| [`15_frontend_architecture_integration.md`](15_frontend_architecture_integration.md)                   | Frontend architecture (Astro SSR, islands, hybrid online-first)                    |
| [`16_backend_data_access_integration.md`](16_backend_data_access_integration.md)                       | Data access architecture (repository, RLS, outbox, idempotency)                    |
| [`17_default_seed_rbac_abac.md`](17_default_seed_rbac_abac.md)                                         | Default RBAC/ABAC role & policy seed                                               |
| [`18_configuration_env_reference.md`](18_configuration_env_reference.md)                               | Environment variable reference (foundation + ERP placeholders)                     |
| [`19_glossary_terminology.md`](19_glossary_terminology.md)                                             | Architecture & ERP domain terminology glossary                                     |
| [`20_threat_model_security_architecture.md`](20_threat_model_security_architecture.md)                 | Threat model & security architecture (+ ERP-specific threats)                      |
| [`21_module_admission_governance.md`](21_module_admission_governance.md)                               | New-module admission governance                                                    |
| [`branch-protection.md`](branch-protection.md)                                                         | GitHub branch protection policy                                                    |
| [`database-migrations.md`](database-migrations.md)                                                     | SQL migration conventions                                                          |
| [`database-pooling.md`](database-pooling.md)                                                           | Connection pooling & backpressure                                                  |
| [`database-capacity-runbook.md`](database-capacity-runbook.md)                                         | Database capacity runbook                                                          |
| [`data-lifecycle.md`](data-lifecycle.md)                                                               | Data retention & purge (including financial/legal retention considerations)        |
| [`deployment-profiles.md`](deployment-profiles.md)                                                     | Offline/LAN and online deployment profiles                                         |
| [`deploy-coolify.md`](deploy-coolify.md)                                                               | Coolify deployment guide                                                           |
| [`release-process.md`](release-process.md)                                                             | SemVer + Changesets release process                                                |
| [`observability-metrics.md`](observability-metrics.md)                                                 | Logging/metrics/observability conventions                                          |
| [`performance-suite.md`](performance-suite.md)                                                         | Performance test suite                                                             |
| [`production-preflight-runbook.md`](production-preflight-runbook.md)                                   | Pre-production deployment preflight checklist                                      |
| [`production-readiness.md`](production-readiness.md)                                                   | Production readiness gate                                                          |
| [`resilience-dr-verification.md`](resilience-dr-verification.md)                                       | Disaster-recovery verification                                                     |
| [`repo-inventory.md`](repo-inventory.md)                                                               | Repo file inventory tooling                                                        |
| [`extension-compatibility-policy.md`](extension-compatibility-policy.md)                               | Contract/module version compatibility policy                                       |
| [`templates/module-proposal-template.md`](templates/module-proposal-template.md)                       | New-module proposal template                                                       |
| [`templates/module-admission-decision-checklist.md`](templates/module-admission-decision-checklist.md) | Module admission decision checklist                                                |
| [`examples/minimal-domain-module.md`](examples/minimal-domain-module.md)                               | Minimal ERP domain-module example (`expense-category`)                             |
| [`api-reference.md`](api-reference.md)                                                                 | Combined API reference (format reference; generated, out of i18n scope — ADR-0023) |
| [`absorb-awcms-micro-roadmap.md`](absorb-awcms-micro-roadmap.md)                                       | awcms-micro website/e-commerce cluster absorption map (ADR-0035)                   |
| [`derived-application-guide.md`](derived-application-guide.md)                                         | **DEPRECATED** (ADR-0034) — derived-application guide (pathway removed)            |
| [`derived-app-pilot-plan.md`](derived-app-pilot-plan.md)                                               | **DEPRECATED** (ADR-0034) — derived-application pilot plan (pathway removed)       |
| [`erp-extension-contracts.md`](erp-extension-contracts.md)                                             | ERP extension readiness contracts (see ADR-0020)                                   |
| [`visitor-analytics.md`](visitor-analytics.md)                                                         | Visitor analytics (pattern reference, originating from the CMS product)            |
| [`AUDIT_STANDAR_PENGEMBANGAN_2026-07-04.md`](AUDIT_STANDAR_PENGEMBANGAN_2026-07-04.md)                 | Development-standard compliance audit (reference)                                  |
| [`module-composition-inventory.json`](module-composition-inventory.json)                               | Module composition inventory (generated artifact)                                  |
| [`work-class-registry.generated.json`](work-class-registry.generated.json)                             | Work-class registry (generated artifact)                                           |

AWCMS agent-family usage guide (PDF): [`../Pedoman_Penggunaan_Agent_Keluarga_AWCMS_v1.0.pdf`](../Pedoman_Penggunaan_Agent_Keluarga_AWCMS_v1.0.pdf).

The two JSON files above (`module-composition-inventory.json`, `work-class-registry.generated.json`) are **generated artifacts** from the reference repo; their values still reflect awcms-mini's modules and will be regenerated by this repo's tooling once the relevant ERP modules exist. The GitHub snapshot (`docs/awcms/github/`) has not been adapted yet — it's produced by the `awcms-github-snapshot` skill when run against this repo's tracker.

See also [`AGENTS.md`](../../AGENTS.md) for the mandatory workflow for every task, and [`docs/adr/`](../adr/README.md) for architectural decisions.
