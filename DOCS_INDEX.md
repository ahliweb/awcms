# AWCMS Documentation Index

## Purpose
Provide a single entry point for all AWCMS documentation across the monorepo and identify the canonical doc for each topic.

## Audience
- Contributors and maintainers working on any AWCMS package
- Operators deploying and supporting AWCMS
- AI coding agents (must follow AGENTS.md)

## Prerequisites
- Read and follow `AGENTS.md` (single source of truth for rules)
- For admin/public work, read `awcms/docs/00-core/CORE_STANDARDS.md`

## Canonical Docs Map

| Topic | Canonical Doc | Notes |
| --- | --- | --- |
| AI agent rules | `AGENTS.md` | Required for all contributors and tools |
| Core standards | `awcms/docs/00-core/CORE_STANDARDS.md` | Architecture, UI, security, extensions |
| Architecture | `awcms/docs/00-core/ARCHITECTURE.md` | Monorepo and runtime architecture |
| Multi-tenancy | `awcms/docs/00-core/MULTI_TENANCY.md` | Tenant resolution, RLS, isolation |
| Security model | `awcms/docs/00-core/SECURITY.md` | OWASP alignment, ABAC, edge boundaries |
| Supabase integration | `awcms/docs/00-core/SUPABASE_INTEGRATION.md` | Auth, migrations, RLS, edge functions |
| Soft delete lifecycle | `awcms/docs/00-core/SOFT_DELETE.md` | `deleted_at` policy and query patterns |
| ABAC permissions | `awcms/docs/03-features/ABAC_SYSTEM.md` | Permission keys and enforcement |
| Role hierarchy | `awcms/docs/03-features/ROLE_HIERARCHY.md` | Role matrix and responsibilities |
| RLS policies | `awcms/docs/02-reference/RLS_POLICIES.md` | Database enforcement patterns |
| Database schema | `awcms/docs/02-reference/DATABASE_SCHEMA.md` | Schema overview and tables |
| API usage | `awcms/docs/02-reference/API_DOCUMENTATION.md` | Supabase client patterns |
| Admin UI patterns | `awcms/docs/03-features/COMPONENT_GUIDE.md` | shadcn/ui, toasts, forms |
| Visual builder | `awcms/docs/03-features/VISUAL_BUILDER.md` | Puck editor and rendering |
| Template system | `awcms/docs/03-features/TEMPLATE_SYSTEM.md` | Templates and assignments |
| Public portal architecture | `awcms/docs/03-features/PUBLIC_PORTAL_ARCHITECTURE.md` | Astro runtime and PuckRenderer |
| Extensions | `awcms/docs/03-features/EXTENSIONS.md` | Plugins and registry APIs |
| Deployment | `awcms/docs/01-guides/DEPLOYMENT.md` | Admin, public, mobile, IoT |
| Cloudflare Pages | `awcms/docs/01-guides/CLOUDFLARE_DEPLOYMENT.md` | Astro and SPA hosting |
| CI/CD | `awcms/docs/01-guides/CI_CD.md` | GitHub Actions expectations |
| Testing | `awcms/docs/01-guides/TESTING.md` | Vitest and smoke checks |
| Troubleshooting | `awcms/docs/01-guides/TROUBLESHOOTING.md` | Common issues |
| Monorepo structure | `awcms/docs/02-reference/FOLDER_STRUCTURE.md` | Folder map and package paths |
| Versioning | `awcms/docs/03-features/VERSIONING.md` | Semver and release steps |
| Compliance | `awcms/docs/04-compliance/COMPLIANCE_MAP.md` | ISO/IEC and local compliance |

## Package Readmes

| Package | Readme | Scope |
| --- | --- | --- |
| Admin panel | `awcms/README.md` | React + Vite admin app |
| Public portal | `awcms-public/primary/README.md` | Astro public app |
| Mobile app | `awcms-mobile/primary/README.md` | Flutter app |
| ESP32 firmware | `awcms-esp32/primary/README.md` | PlatformIO firmware |
| Extensions | `awcms-ext/README.md` | External extensions |

## Docs Indexes

- `awcms/docs/INDEX.md` for the admin documentation tree
- `awcms/docs/00-core/DOCS_STRUCTURE.md` for documentation structure standards

## Change Management

- `awcms/CHANGELOG.md` for product releases
- `awcms/docs/CHANGELOG.md` for documentation changes
- `awcms/docs/DOCS_AUDIT.md` for the current doc inventory

## References

- React 18: https://react.dev
- Astro 5: https://docs.astro.build
- Supabase JS: https://supabase.com/docs
- TailwindCSS 4: https://tailwindcss.com/docs
- Flutter: https://flutter.dev/docs
- PlatformIO: https://docs.platformio.org
