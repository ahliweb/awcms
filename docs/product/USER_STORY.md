> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) -> [AGENTS.md](../../AGENTS.md) -> [PRD.md](PRD.md)

# AWCMS - User Stories

> This document aligns to the current `docs/product/PRD.md` and groups stories by product area first, then by persona.

## 1. Platform and Tenant Management

| ID | Persona | Story | Expected Outcome |
| --- | --- | --- | --- |
| PT-1 | Platform Owner | As a Platform Owner, I can provision a new tenant so that each organization starts with an isolated workspace. | Tenant defaults are created, the first admin can be invited, and tenant isolation is active from first use. |
| PT-2 | Platform Owner / Super Admin | As a platform operator, I can manage tenant-level modules and shared platform controls so that capabilities can be turned on safely per tenant. | Module visibility and shared resource behavior are configurable without exposing cross-tenant data. |
| PT-3 | Tenant Admin | As a Tenant Admin, I can manage users, roles, branding, languages, and settings for my tenant so that my organization controls its own workspace. | Updates remain scoped to the active tenant and immediately affect allowed UI behavior. |
| PT-4 | Tenant Admin / Auditor | As a tenant operator, I can review audit activity so that I can monitor changes and investigate incidents. | Audit views stay scoped to the correct tenant, with broader access reserved for platform roles only. |

## 2. Content and Media Management

| ID | Persona | Story | Expected Outcome |
| --- | --- | --- | --- |
| CM-1 | Author | As an Author, I can create and edit my own content so that I can contribute safely without affecting other users' work. | New content saves with the correct `tenant_id` and `author_id`, and own-only restrictions are respected. |
| CM-2 | Editor | As an Editor, I can manage shared content and media so that published content has the right assets and quality. | Editors can update allowed content and media records within their tenant scope only. |
| CM-3 | Author / Editor | As a content creator, I can use visual and rich text editors so that I can produce structured pages and posts efficiently. | Puck templates and TipTap content load and save using tenant-aware configuration and sanitization rules. |
| CM-4 | Tenant Admin | As a Tenant Admin, I can configure templates, widgets, and import settings so that the content system fits my tenant's workflow. | Tenant-specific configuration drives available editing and import behavior. |

## 3. Workflow and Access Control

| ID | Persona | Story | Expected Outcome |
| --- | --- | --- | --- |
| WA-1 | Editor | As an Editor, I can move content through draft, review, and publish stages so that publication follows approval rules. | Status transitions are permission-aware and reflect the content workflow. |
| WA-2 | Author | As an Author, I can submit content for review without being able to publish directly when my role does not allow it. | Authors can create and update eligible records but cannot bypass publish controls. |
| WA-3 | Tenant Admin / Platform Owner | As an administrator, I can manage permissions and role behavior so that each user sees only allowed actions. | UI actions and database access remain aligned to ABAC permission keys. |
| WA-4 | Auditor / Member | As a restricted user, I can access only the views intended for my role so that governance and self-service remain safe. | Auditors stay read-only, and members can manage only their own permitted account data. |

## 4. Public Experience and Publishing

| ID | Persona | Story | Expected Outcome |
| --- | --- | --- | --- |
| PP-1 | Public User | As a Public User, I can browse published tenant content so that I can find current public information. | Only published, non-deleted content appears in the public portal. |
| PP-2 | Public User | As a Public User, I can search and navigate branded tenant pages so that the site feels consistent and useful. | Search, menus, SEO, and branding stay aligned to the active tenant's public configuration. |
| PP-3 | Public User | As a Public User, I can switch language when translations exist so that I can read content in my preferred locale. | Public routes expose enabled locales and fall back safely when a translation is unavailable. |
| PP-4 | Tenant Admin | As a Tenant Admin, I can control public presentation settings so that branding, consent, and publishing behavior match my organization. | Public output respects tenant SEO, analytics consent, language, and theme settings. |

## 5. Commerce, Communication, and Extensions

| ID | Persona | Story | Expected Outcome |
| --- | --- | --- | --- |
| CE-1 | Tenant Admin | As a Tenant Admin, I can manage products, product types, orders, promotions, and payment methods so that tenant commerce operations remain centralized. | Commerce records are isolated by tenant and visible only to authorized roles. |
| CE-2 | Tenant Admin | As a Tenant Admin, I can manage newsletter, subscriber, contact, and messaging flows so that I can communicate with my audience. | Communication data stays tenant-scoped and operational workflows remain auditable. |
| CE-3 | Platform Owner / Tenant Admin | As an operator, I can enable extensions and resource-driven admin menus so that the platform can grow without custom rewrites. | Extension surfaces integrate with permission-aware routes and menu visibility rules. |

## 6. AI, Mobile, and Device Channels

| ID | Persona | Story | Expected Outcome |
| --- | --- | --- | --- |
| AI-1 | Editor | As an Editor, I can use AI to generate or refine draft content so that content creation is faster. | AI output stays inside the tenant boundary and is saved as draft or reviewable work, not auto-published content. |
| AI-2 | Editor / Tenant Admin | As a tenant operator, I can use AI-assisted translation or suggestion flows so that multilingual publishing is easier to manage. | AI suggestions remain attributable, tenant-scoped, and subject to human approval. |
| MD-1 | Member / Subscriber | As a signed-in mobile user, I can access tenant content and features on mobile so that my experience extends beyond the web portal. | Mobile data access respects auth state, tenant scope, and published-content rules where applicable. |
| MD-2 | Device Operator | As a Device Operator, I can register and manage tenant devices so that digital signage and device-linked experiences stay under control. | Device records, content pushes, and configuration actions remain isolated to the tenant. |
| MD-3 | Device Operator | As a Device Operator, I can apply configuration and firmware updates so that devices stay current without manual rework. | Config delivery and OTA behavior are scoped, auditable, and safe for tenant-managed devices. |

## References

- [PRD.md](PRD.md) - Product requirements and scope
- [ACCEPTANCE_CRITERIA.md](ACCEPTANCE_CRITERIA.md) - Testable checks aligned to these stories
- [README.md](../../README.md) - Monorepo overview and active surfaces
- [docs/modules/MODULES_GUIDE.md](../modules/MODULES_GUIDE.md) - Current module surface and admin menu model
- [docs/security/abac.md](../security/abac.md) - Permission system details
- [docs/security/rls.md](../security/rls.md) - Database enforcement details
- [docs/tenancy/HIERARCHY.md](../tenancy/HIERARCHY.md) - Role hierarchy details
- [docs/modules/INTERNATIONALIZATION.md](../modules/INTERNATIONALIZATION.md) - Multi-language module
- [docs/modules/EMAIL_INTEGRATION.md](../modules/EMAIL_INTEGRATION.md) - Email and subscriber flows
- [docs/dev/esp32.md](../dev/esp32.md) - IoT development guide
