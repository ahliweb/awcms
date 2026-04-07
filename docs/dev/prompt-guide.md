> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) -> [AGENTS.md](../../AGENTS.md) -> [README.md](../../README.md) -> [DOCS_INDEX.md](../../DOCS_INDEX.md)

# AWCMS Prompt Guide

## Purpose

Provide a current prompt-writing guide for AWCMS work so requests align with the live architecture, standards, modules, workflows, and documentation rules.

## When To Use This Guide

Use this guide when writing prompts for:

- code changes
- bug fixes
- migrations
- RLS / ABAC updates
- Worker routes
- public portal features
- module additions
- extension work
- documentation updates
- review requests

## Start With Authority

Before writing a detailed prompt, anchor it to the current documentation chain:

1. [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) for architecture, stack versions, runtime boundaries, tenancy, and security mandates
2. [AGENTS.md](../../AGENTS.md) for implementation rules, patterns, hooks, and guardrails
3. [README.md](../../README.md) for the current repo layout, runtime summary, and operational commands
4. [DOCS_INDEX.md](../../DOCS_INDEX.md) for canonical docs by topic

If the task is documentation-heavy, also name the exact canonical docs that should stay in sync.

## The 6 Essential Prompt Components

Every strong AWCMS prompt should answer these six questions up front.

### 1. Workspace

State exactly where the change belongs.

| Workspace | Use When The Request Is About |
| --- | --- |
| `awcms/` | Admin panel UI, hooks, contexts, routes, module screens, dashboard widgets |
| `awcms-public/primary/` | Default public portal, Astro static pages, React islands |
| `awcms-public/smandapbun/` | The dedicated SMANDAPBUN public portal |
| `awcms-edge/` | Cloudflare Worker routes, edge validation, queue consumers, R2 flows |
| `supabase/migrations/` | Canonical database migrations |
| `awcms/supabase/migrations/` | Mirrored migration path that must stay in parity with root migrations |
| `awcms-mcp/` | Local MCP server integrations and tooling |
| `packages/awcms-shared/` | Shared TypeScript utilities used by public runtimes |
| `awcms-mobile/primary/` | Flutter mobile app work |
| `awcms-esp32/primary/` | ESP32 / PlatformIO firmware work |
| `openclaw/` | AI gateway routing and tenant model configuration |
| `docs/` | Documentation updates |

Example:

> Working in `awcms-edge/` and `docs/dev/`.

### 2. Task Type

Name the category of change so the right rules and patterns get applied.

| Task Type | Typical Keywords |
| --- | --- |
| Admin UI | `new component`, `manager screen`, `dialog`, `dashboard widget` |
| Hook / context | `new hook`, `update context`, `tenant-aware data fetching` |
| Public portal | `Astro page`, `island`, `static rendering`, `build-time content` |
| Migration | `new migration`, `alter table`, `new table`, `index`, `constraint` |
| RLS / ABAC | `policy`, `permission`, `has_permission`, `tenant isolation` |
| Edge route | `Worker route`, `queue consumer`, `R2`, `webhook`, `OpenAPI` |
| CI / workflow | `GitHub Actions`, `workflow`, `deploy`, `Pages`, `credential preflight` |
| Module work | `new module`, `sidebar item`, `resource registry`, `MainRouter` |
| Extension work | `extension`, `extension.json`, `platform_extension_catalog`, `tenant_extensions` |
| Mobile / IoT | `Flutter`, `ESP32`, `device config`, `realtime retrieval` |
| Documentation | `update docs`, `prompt guide`, `audit docs`, `release summary` |
| Review | `review this change`, `find bugs`, `identify regressions` |

### 3. Scope, Tenant, And Permission Context

State who the feature is for and what security boundary applies.

Use one of these patterns:

| Scope | Prompt Language To Use |
| --- | --- |
| Platform | `This is a platform-level feature. It may use approved server-side SUPABASE_SECRET_KEY paths and platform-authorized roles only.` |
| Tenant | `This is tenant-scoped. Use useTenant() or equivalent tenant context. Permission key format must be scope.resource.action.` |
| Public | `This is public-facing. No auth bypass, no secret key path, and only published non-deleted content may render.` |
| Cross-tenant admin flow | `This touches multiple tenants and must preserve isolation, idempotency, and auditability.` |

Examples:

> Tenant-scoped. Use `useTenant()` for tenant context and `tenant.blog.update` for authorization.
>
> Platform-only onboarding flow. Validate platform permission before any write and audit the action.

### 4. Existing Patterns To Follow

Point to real files or docs that should be treated as the pattern source.

Useful references include:

- `awcms/src/hooks/useAdminMenu.js`
- `awcms/src/hooks/useMedia.js`
- `awcms/src/hooks/useTemplates.js`
- `awcms/src/components/MainRouter.jsx`
- `awcms/src/components/dashboard/widgets/DashboardWidgetHeader.jsx`
- `awcms-edge/src/index.ts`
- `awcms-edge/src/middleware/`
- `docs/modules/MODULES_GUIDE.md`
- `docs/dev/admin.md`
- `docs/dev/public.md`
- `docs/dev/edge-functions.md`
- `.github/workflows/ci-push.yml`
- `.github/workflows/deploy-smandapbun.yml`
- `scripts/resolve_cloudflare_credentials.mjs`
- `scripts/resolve_smandapbun_public_env.mjs`
- `.agents/workflows/migration-workflow.md`
- `.agents/workflows/rls-change-workflow.md`
- `.agents/workflows/ui-change-workflow.md`
- `.agents/workflows/ci-validation-workflow.md`

Example:

> Follow the route and tenant-validation pattern already used in `awcms-edge/src/index.ts` and the module registration pattern documented in `docs/modules/MODULES_GUIDE.md`.

### 5. Constraints And Non-Negotiables

State the rules the implementation must not violate.

Common AWCMS constraints:

```text
- Respect SYSTEM_MODEL.md and AGENTS.md as the primary authority.
- Tenant-scoped tables must use tenant_id.
- Soft delete only for business data; do not use .delete() for normal content lifecycle.
- All reads must account for deleted_at is null where applicable.
- Permission keys must use scope.resource.action.
- Admin panel code in awcms/ is JavaScript ES2022+, not TypeScript.
- Public portal code is TypeScript/TSX and static-first.
- Public rendering must use published-only content and build-time tenant resolution.
- Workers must validate Supabase auth context before protected work.
- SUPABASE_SECRET_KEY is server-side only.
- Cloudflare Workers are the supported edge runtime; no custom Node.js server.
- Use signed route params for protected edit/detail routes when identifiers are exposed in admin URLs.
- Use semantic theme variables; no hardcoded hex colors in UI work.
- Toast feedback is required for significant admin user actions.
```

### 6. Definition Of Done

Say what success includes beyond just the code change.

Good prompt additions:

- which tests or validation commands to run
- whether docs must be updated
- whether both migration folders must stay in sync
- whether OpenAPI artifacts need updating
- whether a review summary is expected

Example:

> Done means the feature works, relevant docs are updated, root and mirrored migrations remain in parity, and the affected workspace build or typecheck passes.

## AWCMS-Specific Guardrails To Call Out Explicitly

These details prevent the most common bad prompts and bad implementations.

### Stack And Runtime

- `awcms/`: React 19.2.4, Vite `^8.0.5`, JavaScript only
- `awcms-public/primary/`: Astro 6.1.4, React 19.2.4 islands, TypeScript/TSX, static output by default
- `awcms-public/smandapbun/`: Astro 6.0.8, React 19.2.4 islands, TypeScript/TSX, static output by default
- `awcms-edge/`: Cloudflare Workers + Hono, not Node.js server code
- Supabase: source of truth for Auth, PostgreSQL, RLS, and ABAC
- Cloudflare R2: object storage layer
- Cloudflare Queues: background offload for media and notifications
- Node.js baseline across active workspaces: `>=24.14.1`

### Security And Data Lifecycle

- RLS is mandatory
- client code must never bypass RLS
- `SUPABASE_SECRET_KEY` belongs only in approved server-side runtimes
- `deleted_at` is the standard business-data deletion path
- public queries must filter to published content and non-deleted rows
- worker-side checks are additive; PostgreSQL RLS and permission functions remain authoritative

### Current Module Surfaces

When prompts target admin modules, use the current module names and locations from [docs/modules/MODULES_GUIDE.md](../modules/MODULES_GUIDE.md).

High-frequency module groups:

- Content: Blogs, Pages, Visual Pages, Widgets, Templates, Portfolio, Announcements, Services, Team
- Media: Files / Media Library, gallery resources
- Commerce: Products, Product Types, Orders, Promotions
- Navigation: Menus, Categories, Tags
- System and access: Users, Roles, Permissions, Policies, Settings, Branding, Email Settings, Notifications, Contacts, Themes, SEO
- Platform and plugins: Tenants, Modules, Extensions, Sidebar Menus, Platform Settings, Platform Dashboard
- Mobile and IoT: Mobile Users, Push Notifications, Devices, Mobile Config

### Documentation Maintenance

Prompts for docs work should say whether the change also needs to update:

- `DOCS_INDEX.md`
- `README.md`
- `AGENTS.md`
- `docs/dev/documentation-audit-plan.md`
- `docs/dev/documentation-audit-tracker.md`
- release summary docs in `docs/dev/`

For repository-wide or cross-topic doc updates, explicitly ask for audit-plan and audit-tracker alignment.

### CI And Deployment Guardrails

- GitHub Actions workflow fixes should stay minimal and scoped to the failing job or shared duplicated logic.
- For Cloudflare Pages deploy workflows, prompts should tell the agent to inspect both the workflow file and the target workspace manifest.
- Cloudflare account resolution may come from env files, GitHub secrets/vars, or project-based auto-resolution in workflow preflight.
- When a workspace already pins `wrangler`, the workflow `wranglerVersion` should stay aligned to avoid npm `EOVERRIDE` conflicts during `cloudflare/wrangler-action` installs.
- Public CI prompts should mention deployment-env wrapper scripts when present, for example `scripts/run-with-deployment-env.mjs` and `scripts/resolve_smandapbun_public_env.mjs`.

## Workflow-Aware Prompting

Use the workflow docs when the task crosses sensitive boundaries.

| Change Type | Workflow / Doc To Reference |
| --- | --- |
| Migration | `.agents/workflows/migration-workflow.md` |
| RLS / ABAC | `.agents/workflows/rls-change-workflow.md` |
| UI changes | `.agents/workflows/ui-change-workflow.md` |
| Validation gate | `.agents/workflows/ci-validation-workflow.md` |
| CI failure fix | GitHub Actions workflow file + `gh run view ... --log` |
| Planning discipline | [docs/dev/ai-planning-workflow.md](ai-planning-workflow.md) |
| Review expectations | [docs/dev/review-checklist.md](review-checklist.md) |
| Edge runtime changes | [docs/dev/edge-functions.md](edge-functions.md) |

Also align with [docs/dev/ai-workflows.md](ai-workflows.md):

- one objective per prompt when feasible
- prefer atomic changes
- verify after changes
- plan first for migrations, RLS / ABAC, auth, storage, sanitization, and cross-tenant work

## Prompt Templates

### Template A: Admin Module Or UI Change

```text
Working in `awcms/`.
Task type: admin UI / module change.
Scope: tenant-scoped.
Permission key: `tenant.<resource>.<action>`.
Follow: `awcms/src/components/MainRouter.jsx`, `awcms/src/hooks/useAdminMenu.js`, and the relevant manager pattern in `awcms/src/components/dashboard/`.
Constraints:
- JavaScript ES2022+ only
- use tenant context, not hardcoded tenant IDs
- soft delete only for business data
- toast feedback for user-visible actions
- use signed route params for protected edit/detail routes
Done when:
- route, menu, permission, and module behavior are aligned
- affected build/tests pass
- docs are updated if the module surface changes

<specific request>
```

### Template B: Public Portal Feature

```text
Working in `awcms-public/primary/`.
Task type: Astro page / island / public rendering update.
Scope: public-facing.
Follow: `docs/dev/public.md` and existing tenant-scoped content-fetching patterns.
Constraints:
- Astro 6 static-first output
- TypeScript/TSX only
- resolve tenant at build time using PUBLIC_TENANT_ID or VITE_PUBLIC_TENANT_ID
- render only published and non-deleted content
- no secret key path
- no Puck editor runtime; use Render only when rendering Puck content
Done when:
- build-time content flow is correct
- no draft or cross-tenant leakage occurs
- affected checks pass

<specific request>
```

### Template C: Cloudflare Worker Route

```text
Working in `awcms-edge/`.
Task type: new or updated Worker route.
Scope: protected server-side edge flow.
Follow: `awcms-edge/src/index.ts`, `awcms-edge/src/middleware/`, and `docs/dev/edge-functions.md`.
Constraints:
- validate caller auth context before protected work
- use publishable-key caller auth for session validation and SUPABASE_SECRET_KEY only for approved admin operations
- preserve Supabase as the authority for Auth, RLS, and ABAC
- validate request shape before writes
- use tenant-aware filters and deleted_at guards where applicable
- no Node.js-only APIs
- update OpenAPI docs if this route is part of a documented surface
Done when:
- typecheck passes
- negative auth and validation paths are covered
- runtime docs are updated if needed

<specific request>
```

### Template D: Migration Or RLS Change

```text
Working in `supabase/migrations/` and `awcms/supabase/migrations/`.
Task type: migration / RLS / ABAC change.
Plan first before editing.
Follow: `.agents/workflows/migration-workflow.md` and `.agents/workflows/rls-change-workflow.md`.
Constraints:
- keep root and mirrored migrations in parity
- use tenant_id for tenant-scoped tables
- include deleted_at for business-data lifecycle where appropriate
- permission keys must use scope.resource.action
- policies must preserve tenant isolation and soft-delete filtering
Done when:
- migration files match in both folders
- validation commands are identified or run
- any affected docs are updated

<specific request>
```

### Template E: Extension Platform Work

```text
Working in `awcms/`, `awcms-edge/`, and/or extension docs as needed.
Task type: extension platform / extension authoring update.
Scope: platform catalog plus tenant activation model.
Follow: `docs/modules/EXTENSIONS.md`, `docs/extensions/EXTENSION_SPEC.md`, and `docs/extensions/EXTENSION_AUTHORING_GUIDE.md`.
Constraints:
- extension.json is the manifest contract
- platform package metadata belongs in platform_extension_catalog
- tenant activation/config belongs in tenant_extensions
- lifecycle events must remain auditable
- avoid direct router mutation; compose through registries
Done when:
- extension ownership model remains correct
- docs and manifests are aligned

<specific request>
```

### Template F: Documentation Update

```text
Working in `docs/`.
Task type: documentation update.
Authority order: SYSTEM_MODEL.md -> AGENTS.md -> README.md -> DOCS_INDEX.md -> target doc.
Constraints:
- keep stack versions and runtime boundaries current
- use relative links
- update canonical references if topic routing changes
- update audit plan/tracker if this is a repo-wide or cross-topic doc correction
Done when:
- the target doc is accurate
- cross-references are aligned
- related canonical docs are updated if needed

<specific request>
```

### Template G: CI / Workflow Repair

```text
Working in the AWCMS monorepo.
Task type: CI failure investigation and targeted fix.
Start from the failing GitHub Actions run/job logs.
Follow: `docs/dev/prompt-guide.md`, `docs/dev/ai-workflows.md`, the exact workflow file, and the affected workspace manifest/config.
Investigation requirements:
- use `gh` to inspect the run, job, and failed step logs
- identify the exact failing command or action step
- distinguish app failure, workflow/config failure, environment/toolchain issue, or upstream/external issue
Constraints:
- apply the smallest safe fix
- do not weaken security, validation, or deployment safeguards
- if Cloudflare Pages deploy is involved, inspect credential resolution, Pages project validation, and `wranglerVersion` alignment with the workspace
Done when:
- root cause is identified
- the necessary workflow or workspace fix is applied
- relevant local validation passes if reproducible locally
- any remaining external dependency on a GitHub rerun is stated clearly

<GitHub Actions URL or run/job id>
```

### Template H: Code Review Request

```text
Review this change with a code-review mindset.
Prioritize bugs, regressions, security risks, tenancy issues, permission mistakes, and missing tests.
Check against: SYSTEM_MODEL.md, AGENTS.md, and the relevant workspace docs.
Call out findings first with file references, then open questions, then a short summary.

<PR, diff, or file list>
```

## High-Value References To Mention In Prompts

Use these when you want the agent to ground itself quickly:

- [docs/dev/admin.md](admin.md)
- [docs/dev/public.md](public.md)
- [docs/dev/edge-functions.md](edge-functions.md)
- [docs/modules/MODULES_GUIDE.md](../modules/MODULES_GUIDE.md)
- [docs/security/abac.md](../security/abac.md)
- [docs/security/rls.md](../security/rls.md)
- [docs/architecture/runtime-boundaries.md](../architecture/runtime-boundaries.md)
- [docs/dev/ai-workflows.md](ai-workflows.md)
- [docs/dev/review-checklist.md](review-checklist.md)
- [docs/dev/context7-benchmark-playbook.md](context7-benchmark-playbook.md)

## Vague Vs Useful Prompting

| Avoid This | Prefer This |
| --- | --- |
| `Add a feature.` | `Add a tenant-scoped manager screen in awcms/ for X following the existing dashboard manager pattern.` |
| `Update the database.` | `Add a timestamped migration in both migration folders, preserve parity, and include RLS / deleted_at handling.` |
| `Make an API endpoint.` | `Add a Cloudflare Worker route in awcms-edge/, validate Supabase auth context first, and keep Supabase as the authority.` |
| `Fix CI.` | `Inspect the failing GitHub Actions job with gh, identify the exact failing step, and apply the smallest safe workflow or workspace fix.` |
| `Show content publicly.` | `Render tenant-scoped published content in awcms-public/primary using build-time tenant resolution.` |
| `Delete this item.` | `Soft-delete the business record via deleted_at and keep reads filtered to non-deleted rows.` |
| `Add permissions.` | `Add permission keys using scope.resource.action and wire them through frontend and RLS patterns.` |

## Checklist Before Sending A Prompt

1. Did you name the workspace?
2. Did you state whether the work is platform, tenant, public, or cross-tenant?
3. Did you name the permission model if authorization matters?
4. Did you point to an existing pattern or canonical doc?
5. Did you state hard constraints like soft delete, static output, or Worker-only runtime?
6. Did you say how the result should be verified?
7. Did you say whether docs or mirrored migrations must also be updated?

## References

- [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md)
- [AGENTS.md](../../AGENTS.md)
- [README.md](../../README.md)
- [DOCS_INDEX.md](../../DOCS_INDEX.md)
- [docs/dev/ai-workflows.md](ai-workflows.md)
- [docs/dev/admin.md](admin.md)
- [docs/dev/public.md](public.md)
- [docs/dev/edge-functions.md](edge-functions.md)
- [docs/modules/MODULES_GUIDE.md](../modules/MODULES_GUIDE.md)
