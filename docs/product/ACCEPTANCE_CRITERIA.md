> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) -> [AGENTS.md](../../AGENTS.md) -> [PRD.md](PRD.md)

# AWCMS - Acceptance Criteria

> This document mirrors the current PRD sections and turns them into testable checks.

## 1. Requirements Baseline

| ID | Criterion | Verification |
| --- | --- | --- |
| RB-1 | Tenant-scoped business tables use `tenant_id` and Row Level Security. | Schema review plus `pg_tables`/policy audit show tenant-scoped tables are protected. |
| RB-2 | Business data uses soft delete rather than hard delete. | Application and migration review show `deleted_at` lifecycle usage for business entities. |
| RB-3 | Permission keys follow `scope.resource.action` and are enforced in UI and DB layers. | Permission audit plus code review of `hasPermission()` and `public.has_permission()` usage. |
| RB-4 | Public content delivery excludes draft and soft-deleted records. | Query review confirms `status = published` and `deleted_at IS NULL` filters. |
| RB-5 | Tenant theming relies on semantic variables rather than hardcoded brand colors. | UI review finds semantic CSS variable usage and no tenant-facing hardcoded hex values. |
| RB-6 | AI-assisted output is reviewable and does not bypass publication controls. | Workflow review shows AI-generated content lands in draft/review states instead of direct publish. |

## 2. Platform and Tenant Management

| ID | Criterion | Verification |
| --- | --- | --- |
| PT-1 | Tenant onboarding creates a usable isolated workspace. | Tenant create flow results in defaults, invite path, and tenant-scoped access on first login. |
| PT-2 | Tenant admins can manage tenant settings without affecting other tenants. | Update tests confirm branding, language, settings, and role changes stay within the active tenant. |
| PT-3 | Platform operators can manage platform-wide controls without exposing tenant data improperly. | Platform-only screens are permission-gated and cross-tenant visibility is limited to platform roles. |
| PT-4 | Audit activity is visible at the right scope. | Tenant users see only their tenant logs; platform users can access broader operational review where allowed. |

## 3. Content and Media Management

| ID | Criterion | Verification |
| --- | --- | --- |
| CM-1 | Content creation saves tenant and author context correctly. | Insert/update tests show records include correct `tenant_id` and `author_id`. |
| CM-2 | Visual and rich text editors use tenant-aware configuration and sanitization. | Review of editor flows confirms Puck/TipTap configuration and sanitized render/import paths. |
| CM-3 | Media operations are tenant-scoped and validated. | Upload/read tests confirm file isolation, expected bucket rules, and file validation behavior. |
| CM-4 | Tenant content modules map to permission-aware admin surfaces. | Admin route and menu review confirms enabled resources match permissions and visible modules. |

## 4. Workflow and Access Control

| ID | Criterion | Verification |
| --- | --- | --- |
| WA-1 | Draft, review, and publish transitions honor role permissions. | Workflow tests show unauthorized roles cannot publish or bypass review rules. |
| WA-2 | Own-only permissions restrict edits to owned content. | Cross-user tests show authors with own-only access cannot modify others' records. |
| WA-3 | Restricted personas remain restricted in both UI and DB access. | Auditor/member tests confirm read-only or self-service-only behavior with no hidden bypass path. |
| WA-4 | Sensitive admin routes use secure route parameter patterns where required. | Route review confirms identifier routes use signed/secured parameter handling. |

## 5. Public Experience and Publishing

| ID | Criterion | Verification |
| --- | --- | --- |
| PP-1 | Public builds resolve tenant context from build-time configuration. | Public portal config and build review confirm tenant resolution comes from expected environment variables. |
| PP-2 | Public pages render only eligible tenant content. | Public portal tests show published, non-deleted, tenant-matched content only. |
| PP-3 | Branding, locale, and SEO settings affect the public portal correctly. | Visual and configuration review confirm tenant settings are reflected in public output. |
| PP-4 | Analytics and telemetry flows respect consent expectations. | Consent banner/config review confirms analytics behavior follows tenant/public consent rules. |

## 6. Commerce, Communication, and Extensions

| ID | Criterion | Verification |
| --- | --- | --- |
| CE-1 | Commerce records remain tenant-scoped and permission-aware. | Product/order/promotion/payment method flows are inaccessible outside the active tenant and role scope. |
| CE-2 | Communication flows stay isolated and auditable. | Newsletter, subscriber, and contact/message data remain tenant-scoped with reviewable activity traces. |
| CE-3 | Extensions and resource-driven menus honor permissions and route safety. | Extension route/menu review confirms only allowed items appear and secured routes stay protected. |

## 7. AI, Mobile, and Device Channels

| ID | Criterion | Verification |
| --- | --- | --- |
| AMD-1 | AI-assisted workflows are tenant-isolated and human-governed. | AI request/output review confirms tenant-scoped routing and no auto-publish path. |
| AMD-2 | Mobile access respects session, tenant, and publication boundaries. | Mobile data flow review confirms signed-in gating and tenant/published filtering where required. |
| AMD-3 | Device registration and configuration stay tenant-scoped. | Device tests confirm registration, content push, and config actions do not cross tenant boundaries. |
| AMD-4 | Device firmware/config secrets are not committed to source control. | Repository review confirms local device secrets remain gitignored and out of tracked source. |

## 8. Architecture, Data, and Technical Constraints

| ID | Criterion | Verification |
| --- | --- | --- |
| AT-1 | The admin app builds successfully on the current stack baseline. | `awcms` build completes successfully under the documented Node and dependency versions. |
| AT-2 | The public app builds successfully on the current stack baseline. | `awcms-public/primary` build completes successfully under the documented Node and dependency versions. |
| AT-3 | Core backend business logic does not rely on custom Node.js application servers. | Architecture review confirms Supabase and Cloudflare Workers remain the backend execution model. |
| AT-4 | Canonical schema truth remains in `supabase/migrations/`. | Documentation and migration review confirm schema changes are represented through timestamped migrations. |
| AT-5 | Product docs stay aligned across PRD, user stories, acceptance criteria, and index references. | Documentation review confirms shared terminology and linked scope across `docs/product/` and `DOCS_INDEX.md`. |

## References

- [PRD.md](PRD.md) - Product requirements and scope
- [USER_STORY.md](USER_STORY.md) - Product-area stories by persona
- [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) - Authoritative architecture and constraints
- [README.md](../../README.md) - Current monorepo surfaces and stack snapshot
- [docs/security/abac.md](../security/abac.md) - ABAC model details
- [docs/security/rls.md](../security/rls.md) - RLS policy details
- [docs/architecture/database.md](../architecture/database.md) - Database orientation
