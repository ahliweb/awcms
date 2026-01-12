# Documentation Audit Report

## Purpose
Inventory documentation files, identify duplicates, and record gaps.

## Audience
- Maintainers auditing doc coverage
- Contributors planning doc changes

## Prerequisites
- `awcms/docs/00-core/DOCS_STRUCTURE.md`

## Inventory

### Root and Monorepo

| File | Purpose | Owner | Status | Gaps/Notes |
| --- | --- | --- | --- | --- |
| `DOCS_INDEX.md` | Monorepo docs index | Platform | OK | New canonical entry point |
| `README.md` | Monorepo overview | Platform | OK | Links to docs index |
| `AGENTS.md` | AI agent rules | Platform | OK | Canonical SSOT |
| `CONTRIBUTING.md` | Contribution rules | Platform | OK | Aligned to core standards |
| `CODE_OF_CONDUCT.md` | Community policy | Platform | OK | Canonical source |
| `SECURITY.md` | Security policy | Platform | OK | No changes needed |
| `LICENSE` | License | Platform | OK | Canonical license |

### Package Readmes

| File | Purpose | Owner | Status | Gaps/Notes |
| --- | --- | --- | --- | --- |
| `awcms/README.md` | Admin panel setup | Admin | OK | References docs index |
| `awcms-public/README.md` | Public portal root | Public | OK | Points to primary README |
| `awcms-public/primary/README.md` | Public portal setup | Public | OK | Updated routing and env vars |
| `awcms-mobile/README.md` | Mobile root | Mobile | OK | Points to primary README |
| `awcms-mobile/primary/README.md` | Mobile setup | Mobile | OK | Shortened and aligned |
| `awcms-esp32/README.md` | ESP32 root | IoT | OK | Points to primary README |
| `awcms-esp32/primary/README.md` | ESP32 setup | IoT | OK | Updated env guidance |
| `awcms-ext/README.md` | Extensions root | Extensions | OK | Links to extension docs |
| `awcms-mobile/primary/ios/Runner/Assets.xcassets/LaunchImage.imageset/README.md` | iOS launch assets | Mobile | OK | Asset note |

### Admin Docs - Core (awcms/docs/00-core)

| File | Purpose | Owner | Status | Gaps/Notes |
| --- | --- | --- | --- | --- |
| `awcms/docs/00-core/CORE_STANDARDS.md` | Core standards | Platform | OK | Version synced to 2.12.1 |
| `awcms/docs/00-core/ARCHITECTURE.md` | System architecture | Platform | OK | Updated to current paths |
| `awcms/docs/00-core/MULTI_TENANCY.md` | Tenant isolation | Platform | OK | Updated admin/public flow |
| `awcms/docs/00-core/SECURITY.md` | Security model | Platform | OK | Updated ABAC + RLS notes |
| `awcms/docs/00-core/SUPABASE_INTEGRATION.md` | Supabase integration | Platform | OK | Added canonical doc |
| `awcms/docs/00-core/SOFT_DELETE.md` | Soft delete lifecycle | Platform | OK | Added canonical doc |
| `awcms/docs/00-core/DOCS_STRUCTURE.md` | Docs structure | Platform | OK | New standard |

### Admin Docs - Guides (awcms/docs/01-guides)

| File | Purpose | Owner | Status | Gaps/Notes |
| --- | --- | --- | --- | --- |
| `awcms/docs/01-guides/INSTALLATION.md` | Setup steps | Platform | OK | Updated for monorepo |
| `awcms/docs/01-guides/CONFIGURATION.md` | Env vars | Platform | OK | Updated env list |
| `awcms/docs/01-guides/DEPLOYMENT.md` | Deployment | Platform | OK | Updated paths |
| `awcms/docs/01-guides/CLOUDFLARE_DEPLOYMENT.md` | Pages setup | Platform | OK | Updated root dirs |
| `awcms/docs/01-guides/CI_CD.md` | CI/CD guide | Platform | OK | Aligned with workflow |
| `awcms/docs/01-guides/TESTING.md` | Testing | Platform | OK | Updated commands |
| `awcms/docs/01-guides/TROUBLESHOOTING.md` | Troubleshooting | Platform | OK | Updated issues list |
| `awcms/docs/01-guides/MIGRATION.md` | Public URL migration | Public | OK | Updated behavior |
| `awcms/docs/01-guides/MOBILE_DEVELOPMENT.md` | Mobile guide | Mobile | OK | Simplified and aligned |
| `awcms/docs/01-guides/CONTRIBUTING.md` | Link-only | Platform | Duplicate | Points to root CONTRIBUTING |

### Admin Docs - Reference (awcms/docs/02-reference)

| File | Purpose | Owner | Status | Gaps/Notes |
| --- | --- | --- | --- | --- |
| `awcms/docs/02-reference/TECH_STACK.md` | Versions | Platform | OK | Updated versions |
| `awcms/docs/02-reference/FOLDER_STRUCTURE.md` | Repo layout | Platform | OK | Updated monorepo map |
| `awcms/docs/02-reference/API_DOCUMENTATION.md` | Supabase usage | Platform | OK | Removed nonexistent hooks |
| `awcms/docs/02-reference/DATABASE_SCHEMA.md` | Schema | Platform | OK | Added compliance notes |
| `awcms/docs/02-reference/RLS_POLICIES.md` | RLS patterns | Platform | OK | Simplified + source refs |
| `awcms/docs/02-reference/AGENTS.md` | Link-only | Platform | Duplicate | Points to root AGENTS.md |

### Admin Docs - Features (awcms/docs/03-features)

| File | Purpose | Owner | Status | Gaps/Notes |
| --- | --- | --- | --- | --- |
| `awcms/docs/03-features/ABAC_SYSTEM.md` | ABAC model | Platform | OK | Added legacy action note |
| `awcms/docs/03-features/ROLE_HIERARCHY.md` | Role matrix | Platform | OK | Added structure |
| `awcms/docs/03-features/ARTICLES_MODULE.md` | Articles module | Admin | OK | Added access notes |
| `awcms/docs/03-features/USER_MANAGEMENT.md` | User flows | Admin | OK | Updated structure |
| `awcms/docs/03-features/AUDIT_TRAIL.md` | Audit logs | Platform | OK | Added compliance notes |
| `awcms/docs/03-features/COMPONENT_GUIDE.md` | UI patterns | Admin | OK | Updated shadcn/ui patterns |
| `awcms/docs/03-features/ADMIN_UI_ARCHITECTURE.md` | Admin templates | Admin | OK | Updated paths |
| `awcms/docs/03-features/MENU_SYSTEM.md` | Admin menus | Admin | OK | Simplified to sources |
| `awcms/docs/03-features/MODULES_GUIDE.md` | Module structure | Admin | OK | Updated routing path |
| `awcms/docs/03-features/VISUAL_BUILDER.md` | Visual builder | Admin/Public | OK | Updated permissions |
| `awcms/docs/03-features/TEMPLATE_SYSTEM.md` | Templates | Admin/Public | OK | Updated channels |
| `awcms/docs/03-features/TEMPLATE_MIGRATION.md` | Template migration | Admin | OK | Updated migration steps |
| `awcms/docs/03-features/PUBLIC_PORTAL_ARCHITECTURE.md` | Public portal | Public | OK | Updated middleware flow |
| `awcms/docs/03-features/EXTENSIONS.md` | Extensions | Extensions | OK | Updated hook names |
| `awcms/docs/03-features/EMAIL_INTEGRATION.md` | Mailketing | Platform | OK | Updated functions |
| `awcms/docs/03-features/INTERNATIONALIZATION.md` | i18n | Admin | OK | Updated config path |
| `awcms/docs/03-features/THEMING.md` | Theming | Admin | OK | Updated config shape |
| `awcms/docs/03-features/PERFORMANCE.md` | Performance | Platform | OK | Updated caching details |
| `awcms/docs/03-features/SCALABILITY_GUIDE.md` | Scalability | Platform | OK | Updated guidance |
| `awcms/docs/03-features/MONITORING.md` | Monitoring | Platform | OK | Updated logging sources |
| `awcms/docs/03-features/VERSIONING.md` | Versioning | Platform | OK | Updated SSOT files |

### Admin Docs - Compliance and Project Info

| File | Purpose | Owner | Status | Gaps/Notes |
| --- | --- | --- | --- | --- |
| `awcms/docs/04-compliance/COMPLIANCE_MAP.md` | Compliance mapping | Platform | OK | Updated mappings |
| `awcms/docs/ARCHITECTURAL_RECOMMENDATIONS.md` | Best practices | Platform | OK | Updated structure |
| `awcms/docs/INDEX.md` | Admin docs index | Platform | OK | Updated to new core docs |
| `awcms/docs/CHANGELOG.md` | Docs changelog | Platform | OK | Added 2.12.1 entry |
| `awcms/docs/CODE_OF_CONDUCT.md` | Link-only | Platform | Duplicate | Points to root Code of Conduct |
| `awcms/docs/LICENSE.md` | Link-only | Platform | Duplicate | Points to root License |

## Gaps and Follow-ups

- Permission naming: code uses `permanent_delete` but `AGENTS.md` specifies `delete_permanent` as the canonical action key.
- Permission action naming varies between `read/update` and `view/edit` in code vs migrations.
- Supabase directories: both `supabase/` and `awcms/supabase/` exist; CI lints `awcms/supabase` while CLI defaults to root.
- Tenant theming: `useTenantTheme` expects `tenant` but `TenantContext` exposes `currentTenant` (hook likely not applying).
- Public build env in CI uses `PUBLIC_SUPABASE_*` while runtime expects `VITE_SUPABASE_*`.
