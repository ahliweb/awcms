> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) -> [AGENTS.md](../../AGENTS.md) -> [README.md](../../README.md) -> [DOCS_INDEX.md](../../DOCS_INDEX.md)

# AWCMS Prompt Guide

## Purpose

Provide a current, practical guide for writing prompts that match the live AWCMS monorepo: its stack, security model, workspace boundaries, validation habits, and currently implemented feature waves.

This guide is intended for humans and AI operators who want prompts to be actionable, minimal, and aligned with how the repository actually works today.

## Current State

This document reflects the current condition of the repository as of the latest EmDash import work and the current AWCMS runtime boundaries.

Current realities that prompts should assume unless the task says otherwise:

- `SYSTEM_MODEL.md` and `AGENTS.md` remain the primary implementation authority.
- `awcms/` is React 19.2.4 + Vite `^8.0.5` and uses JavaScript ES2022+, not TypeScript.
- `awcms-public/primary/` and `awcms-public/smandapbun/` are Astro 6.0.8 public portals with static-first rendering and React 19.2.4 islands.
- `awcms-edge/` is Cloudflare Workers + Hono, not a custom Node.js server.
- Supabase is authoritative for Auth, PostgreSQL, RLS, and ABAC.
- Cloudflare R2 is the file/object storage layer.
- Soft delete remains the normal business-data deletion model.
- Permission keys must use `scope.resource.action`.
- Prompting should prefer atomic vertical slices over broad multi-surface rewrites.

## What Has Changed Recently

Prompts that ignore recent repository changes tend to produce stale or low-value results. The following are now part of the current repo condition and should be reflected in prompts when relevant:

- EmDash tenant import flows now have executable waves for:
  - blog imports
  - marketing imports
  - portfolio imports
- External EmDash `seed.json` sources can now come from:
  - `http(s)` URLs
  - local file paths
  - `file://` locators
- The canonical EmDash seed contract now lives in:
  - [docs/architecture/emdash-seed-json.md](../architecture/emdash-seed-json.md)
- Copyable EmDash fixtures now exist in:
  - [docs/examples/emdash/blog/seed.json](../examples/emdash/blog/seed.json)
  - [docs/examples/emdash/blog/seed.minimal.json](../examples/emdash/blog/seed.minimal.json)
  - [docs/examples/emdash/marketing/seed.json](../examples/emdash/marketing/seed.json)
  - [docs/examples/emdash/portfolio/seed.json](../examples/emdash/portfolio/seed.json)
- `tenant-imports` in `awcms-edge/src/index.ts` is now a meaningful prompt target, not just a dry-run shell.
- `docs:check` is a real and maintained validation step for doc updates.

## When To Use This Guide

Use this guide when writing prompts for:

- code changes
- bug fixes
- migrations
- RLS / ABAC updates
- Cloudflare Worker routes
- public portal features
- module additions
- extension work
- EmDash import work
- documentation maintenance
- CI investigation
- review requests

## Prompting Principles

Good AWCMS prompts are:

- specific about workspace and authority
- explicit about tenant or platform scope
- grounded in existing files and docs
- clear about non-negotiable constraints
- clear about validation expectations
- small enough to complete in one end-to-end pass when feasible

Bad AWCMS prompts are usually vague in one of these ways:

- they do not name the target workspace
- they do not identify whether the task is tenant-scoped, public-facing, or platform-only
- they omit soft-delete, RLS, ABAC, or build-time rendering constraints
- they ask for multiple unrelated objectives in one request
- they fail to point to existing implementation patterns

## Start With Authority

Before writing a detailed prompt, anchor the request to the current documentation chain:

1. [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md)
2. [AGENTS.md](../../AGENTS.md)
3. [README.md](../../README.md)
4. [DOCS_INDEX.md](../../DOCS_INDEX.md)

If the task is domain-specific, also cite the nearest canonical doc set:

- Admin work: [docs/dev/admin.md](admin.md)
- Public work: [docs/dev/public.md](public.md)
- Worker work: [docs/dev/edge-functions.md](edge-functions.md)
- Security-sensitive work: [docs/security/abac.md](../security/abac.md) and [docs/security/rls.md](../security/rls.md)
- Module routing and ownership: [docs/modules/MODULES_GUIDE.md](../modules/MODULES_GUIDE.md)
- EmDash import work: [docs/architecture/emdash-tenant-packages.md](../architecture/emdash-tenant-packages.md) and [docs/architecture/emdash-seed-json.md](../architecture/emdash-seed-json.md)

If the task is documentation-heavy, the prompt should name which docs must stay aligned.

## The 6 Essential Prompt Components

Every useful AWCMS prompt should answer these six questions up front.

### 1. Workspace

State exactly where the change belongs.

| Workspace | Use When The Request Is About |
| --- | --- |
| `awcms/` | Admin panel UI, contexts, hooks, manager screens, dashboard widgets, module routes |
| `awcms-public/primary/` | Default public portal, Astro pages, islands, static content rendering |
| `awcms-public/smandapbun/` | Sovereign SMANDAPBUN public portal |
| `awcms-edge/` | Cloudflare Worker routes, queue consumers, import execution, R2-backed workflows, auth-validated server flows |
| `supabase/migrations/` | Canonical root database migrations |
| `awcms/supabase/migrations/` | Mirrored migration path that must remain in parity with root migrations |
| `awcms-mcp/` | Local MCP server tooling and integrations |
| `packages/awcms-shared/` | Shared TypeScript utilities consumed by public runtimes |
| `awcms-mobile/primary/` | Flutter mobile implementation |
| `awcms-esp32/primary/` | PlatformIO / ESP32 firmware work |
| `openclaw/` | AI gateway routing, tenant model configuration, tool profiles |
| `docs/` | Documentation updates |

Example:

> Working in `awcms-edge/` and `docs/architecture/`.

### 2. Task Type

Name the category of change so the correct rules and workflows are applied.

| Task Type | Typical Keywords |
| --- | --- |
| Admin UI | `manager screen`, `dashboard widget`, `dialog`, `settings form` |
| Hook / context | `new hook`, `tenant-aware fetch`, `context update` |
| Public portal | `Astro page`, `island`, `build-time content`, `published-only render` |
| Migration | `new migration`, `alter table`, `index`, `constraint`, `schema` |
| RLS / ABAC | `policy`, `permission`, `tenant isolation`, `has_permission` |
| Edge route | `Worker route`, `queue consumer`, `webhook`, `R2`, `edge auth` |
| Import pipeline | `seed.json`, `tenant-imports`, `materialization`, `mapping`, `artifact` |
| Module work | `new module`, `sidebar`, `route`, `manager`, `permission` |
| Extension work | `extension.json`, `tenant_extensions`, `platform_extension_catalog` |
| CI / workflow | `GitHub Actions`, `Pages deploy`, `wrangler`, `workflow fix` |
| Mobile / IoT | `Flutter`, `ESP32`, `device config`, `realtime` |
| Documentation | `update docs`, `prompt guide`, `architecture docs`, `release summary` |
| Review | `review`, `find bugs`, `regression risk`, `missing tests` |

### 3. Scope, Tenant, And Permission Context

Prompts should state the security boundary directly.

| Scope | Prompt Language To Use |
| --- | --- |
| Platform | `This is platform-level. It may use approved server-side SUPABASE_SECRET_KEY paths only where required.` |
| Tenant | `This is tenant-scoped. Use tenant context and preserve tenant isolation, soft delete, and ABAC naming.` |
| Public | `This is public-facing. Render only published, non-deleted, tenant-scoped data and do not use secret-key paths.` |
| Cross-tenant admin flow | `This touches multiple tenants and must remain auditable, idempotent, and isolated.` |

Examples:

> Tenant-scoped. Use `useTenant()` and permission keys like `tenant.blog.update`.

> Public-facing. Only published and non-deleted content may render, and tenant resolution must be build-time or Worker-mediated as appropriate.

### 4. Existing Patterns To Follow

Point prompts at real files instead of asking the agent to invent patterns.

Useful references include:

- `awcms/src/components/MainRouter.jsx`
- `awcms/src/hooks/useAdminMenu.js`
- `awcms/src/hooks/useMedia.js`
- `awcms/src/hooks/useTemplates.js`
- `awcms/src/components/dashboard/widgets/DashboardWidgetHeader.jsx`
- `awcms/src/components/dashboard/EmdashImportsManager.jsx`
- `awcms-edge/src/index.ts`
- `awcms-public/primary/src/components/puck-blocks/WidgetAreaBlock.astro`
- [docs/dev/admin.md](admin.md)
- [docs/dev/public.md](public.md)
- [docs/dev/edge-functions.md](edge-functions.md)
- [docs/modules/MODULES_GUIDE.md](../modules/MODULES_GUIDE.md)
- [docs/architecture/emdash-seed-json.md](../architecture/emdash-seed-json.md)
- [docs/architecture/emdash-tenant-packages.md](../architecture/emdash-tenant-packages.md)
- `.agents/workflows/migration-workflow.md`
- `.agents/workflows/rls-change-workflow.md`
- `.agents/workflows/ui-change-workflow.md`
- `.agents/workflows/ci-validation-workflow.md`

Example:

> Follow the current `tenant-imports` materialization pattern in `awcms-edge/src/index.ts` and keep docs aligned with `docs/architecture/emdash-seed-json.md`.

### 5. Constraints And Non-Negotiables

Prompts should explicitly state the rules that must not be violated.

Common AWCMS constraints:

```text
- Respect SYSTEM_MODEL.md and AGENTS.md as the primary authority.
- Tenant-scoped resources must use tenant_id and preserve tenant isolation.
- Soft delete only for business data; do not use hard delete for normal content lifecycle.
- Reads must account for deleted_at is null where applicable.
- Permission keys must use scope.resource.action.
- Admin panel code in awcms/ is JavaScript ES2022+, not TypeScript.
- Public portal code is TypeScript/TSX and static-first.
- Public rendering must use published-only content and tenant-scoped filtering.
- Workers must validate caller auth context before protected work.
- SUPABASE_SECRET_KEY is server-side only.
- Cloudflare Workers are the supported edge runtime; no custom Node.js server.
- Use signed route params for protected edit/detail admin routes.
- Use semantic theme variables; avoid hardcoded hex colors in UI work.
- Significant admin actions should provide toast feedback.
```

### 6. Definition Of Done

Prompts should say what success includes beyond code edits.

Useful completion language:

- run the relevant build, typecheck, test, or docs checks
- update related docs if the surface or contract changes
- keep both migration folders in parity if schema work is involved
- update OpenAPI or route docs if a documented edge surface changes
- include a review summary or findings list if the task is review-oriented

Example:

> Done means the feature works, affected docs are aligned, validation passes in the changed workspace, and any mirrored migrations remain in parity.

## AWCMS-Specific Guardrails To Call Out Explicitly

### Stack And Runtime

- `awcms/`: React 19.2.4, Vite `^8.0.5`, JavaScript ES2022+
- `awcms-public/primary/`: Astro 6.0.8, React 19.2.4 islands, TypeScript/TSX, static-first output
- `awcms-public/smandapbun/`: Astro 6.0.8, React 19.2.4 islands, TypeScript/TSX, static-first output
- `awcms-edge/`: Cloudflare Workers + Hono
- Supabase: Auth, PostgreSQL, RLS, ABAC authority
- Cloudflare R2: object storage
- Cloudflare Queues: background offload
- Node.js baseline: `>=24.14.1`

### Security And Data Lifecycle

- RLS is mandatory
- client code must not bypass RLS
- `SUPABASE_SECRET_KEY` is allowed only in approved server-side runtimes
- `deleted_at` is the normal business-data deletion path
- public queries must remain published-only and non-deleted
- worker-side authorization checks are additive; RLS and permission functions remain authoritative

### Current Module Surfaces

When prompts target admin work, use current module names and surfaces.

High-frequency module groups:

- Content: Blogs, Pages, Visual Pages, Widgets, Templates, Portfolio, Announcements, Services, Team, Testimonies
- Media: Files / Media Library, gallery resources
- Commerce: Products, Product Types, Orders, Promotions
- Navigation: Menus, Categories, Tags
- System and access: Users, Roles, Permissions, Policies, Settings, Branding, Email Settings, Notifications, Contacts, Themes, SEO
- Platform and plugins: Tenants, Modules, Extensions, Sidebar Menus, Platform Settings, Platform Dashboard
- Mobile and IoT: Mobile Users, Push Notifications, Devices, Mobile Config

### Current Import Surfaces

Prompts for import work should reflect the fact that `tenant-imports` is no longer a placeholder-only route.

Current executable import waves:

- `blog`
- `marketing`
- `portfolio`

Current import tables and artifacts:

- `tenant_import_jobs`
- `tenant_import_sources`
- `tenant_import_mappings`
- `tenant_import_artifacts`
- `tenant_import_audit`

Current EmDash prompt references:

- [docs/architecture/emdash-tenant-packages.md](../architecture/emdash-tenant-packages.md)
- [docs/architecture/emdash-seed-json.md](../architecture/emdash-seed-json.md)
- `awcms-edge/src/index.ts`
- `awcms/src/components/dashboard/EmdashImportsManager.jsx`

When prompts target EmDash imports, say whether the task is about:

- seed contract changes
- loader support
- mapping/idempotency behavior
- artifact output
- admin import surface
- public rendering parity

### Documentation Maintenance

Prompts for documentation work should say whether the change must also update:

- `DOCS_INDEX.md`
- `README.md`
- `AGENTS.md`
- `docs/dev/documentation-audit-plan.md`
- `docs/dev/documentation-audit-tracker.md`
- release summary docs in `docs/dev/`

Doc prompts should also call out `npm run docs:check` when the change touches maintained docs.

### CI And Deployment Guardrails

- GitHub Actions fixes should remain minimal and scoped to the failing job or duplicated logic
- for Pages deploy workflows, prompts should mention both the workflow file and the target workspace manifest
- Cloudflare account resolution may come from env files, GitHub secrets/vars, or project resolution scripts
- if a workspace pins `wrangler`, workflow `wranglerVersion` should remain aligned to avoid install conflicts
- public CI prompts should mention deployment-env wrapper scripts when present

## Workflow-Aware Prompting

Use workflow docs when the task crosses sensitive boundaries.

| Change Type | Workflow / Doc To Reference |
| --- | --- |
| Migration | `.agents/workflows/migration-workflow.md` |
| RLS / ABAC | `.agents/workflows/rls-change-workflow.md` |
| UI changes | `.agents/workflows/ui-change-workflow.md` |
| Validation gate | `.agents/workflows/ci-validation-workflow.md` |
| Planning discipline | [docs/dev/ai-planning-workflow.md](ai-planning-workflow.md) |
| Review expectations | [docs/dev/review-checklist.md](review-checklist.md) |
| Edge runtime changes | [docs/dev/edge-functions.md](edge-functions.md) |
| Import contract changes | [docs/architecture/emdash-seed-json.md](../architecture/emdash-seed-json.md) |

Also align with [docs/dev/ai-workflows.md](ai-workflows.md):

- prefer one objective per prompt when feasible
- prefer atomic changes over broad rewrites
- verify after changes
- plan first for migrations, RLS/ABAC, auth, storage, sanitization, and cross-tenant work

## Current Validation Commands To Mention In Prompts

Use the most relevant validation command for the touched surface instead of vague language like "run checks".

| Surface | Typical Validation |
| --- | --- |
| `awcms/` | `npm run build` |
| `awcms-edge/` | `npm test` and `npm run typecheck` |
| `awcms-public/primary/` | `npm run check:astro` |
| maintained docs | `npm run docs:check` from `awcms/` |
| migration work | identify or run the appropriate migration validation path and keep mirrored migrations aligned |

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
- `npm run build` passes in `awcms/`
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
- Astro 6.0.8 static-first output
- TypeScript/TSX only
- resolve tenant at build time using PUBLIC_TENANT_ID or VITE_PUBLIC_TENANT_ID
- render only published and non-deleted content
- no secret key path
- no Puck editor runtime; use Render only when rendering Puck content
Done when:
- build-time content flow is correct
- no draft or cross-tenant leakage occurs
- `npm run check:astro` passes

<specific request>
```

### Template C: Cloudflare Worker Route

```text
Working in `awcms-edge/`.
Task type: new or updated Worker route.
Scope: protected server-side edge flow.
Follow: `awcms-edge/src/index.ts` and `docs/dev/edge-functions.md`.
Constraints:
- validate caller auth context before protected work
- use publishable-key caller auth for session validation and SUPABASE_SECRET_KEY only for approved admin operations
- preserve Supabase as the authority for Auth, RLS, and ABAC
- validate request shape before writes
- use tenant-aware filters and deleted_at guards where applicable
- avoid Node-only APIs unless the task is explicitly local tooling or loader support
- update runtime docs if the documented route surface changes
Done when:
- `npm test` passes in `awcms-edge/`
- `npm run typecheck` passes in `awcms-edge/`
- negative auth and validation paths are covered where relevant

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
- affected docs are updated if the schema contract changed

<specific request>
```

### Template E: Import Pipeline Or EmDash Contract Update

```text
Working in `awcms-edge/`, the relevant docs under `docs/architecture/`, and admin import UI files if needed.
Task type: import pipeline / seed contract / materialization update.
Scope: cross-tenant-safe operator flow.
Follow: `awcms-edge/src/index.ts`, `awcms/src/components/dashboard/EmdashImportsManager.jsx`, `docs/architecture/emdash-seed-json.md`, and `docs/architecture/emdash-tenant-packages.md`.
Constraints:
- preserve replayability through tenant_import_mappings
- keep artifacts/audit output meaningful
- maintain tenant isolation and deleted_at guards
- do not break currently executable waves: blog, marketing, portfolio
- update copyable seed examples if the contract changes
Done when:
- changed import wave or contract works end-to-end
- `npm test` and `npm run typecheck` pass in `awcms-edge/`
- `npm run docs:check` passes if docs changed

<specific request>
```

### Template F: Extension Platform Work

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

### Template G: Documentation Update

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
- `npm run docs:check` passes
- related canonical docs are updated if needed

<specific request>
```

### Template H: CI / Workflow Repair

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

### Template I: Code Review Request

```text
Review this change with a code-review mindset.
Prioritize bugs, regressions, security risks, tenancy issues, permission mistakes, import/data-lifecycle mistakes, and missing tests.
Check against: SYSTEM_MODEL.md, AGENTS.md, and the relevant workspace docs.
Call out findings first with file references, then open questions, then a short summary.

<PR, diff, or file list>
```

## High-Value References To Mention In Prompts

Use these when you want the agent to ground itself quickly:

- [docs/dev/admin.md](admin.md)
- [docs/dev/public.md](public.md)
- [docs/dev/edge-functions.md](edge-functions.md)
- [docs/dev/ai-workflows.md](ai-workflows.md)
- [docs/dev/review-checklist.md](review-checklist.md)
- [docs/modules/MODULES_GUIDE.md](../modules/MODULES_GUIDE.md)
- [docs/security/abac.md](../security/abac.md)
- [docs/security/rls.md](../security/rls.md)
- [docs/architecture/runtime-boundaries.md](../architecture/runtime-boundaries.md)
- [docs/architecture/emdash-seed-json.md](../architecture/emdash-seed-json.md)
- [docs/architecture/emdash-tenant-packages.md](../architecture/emdash-tenant-packages.md)
- [docs/dev/context7-benchmark-playbook.md](context7-benchmark-playbook.md)

## Vague Vs Useful Prompting

| Avoid This | Prefer This |
| --- | --- |
| `Add a feature.` | `Add a tenant-scoped manager screen in awcms/ for X following the existing dashboard manager pattern.` |
| `Update the database.` | `Add a timestamped migration in both migration folders, preserve parity, and include tenant_id, deleted_at, and policy implications.` |
| `Make an API endpoint.` | `Add a Cloudflare Worker route in awcms-edge/, validate Supabase auth first, and keep Supabase as the authority.` |
| `Fix CI.` | `Inspect the failing GitHub Actions job with gh, identify the exact failing step, and apply the smallest safe workflow or workspace fix.` |
| `Show content publicly.` | `Render tenant-scoped published content in awcms-public/primary using build-time tenant resolution.` |
| `Delete this item.` | `Soft-delete the business record via deleted_at and keep reads filtered to non-deleted rows.` |
| `Add permissions.` | `Add permission keys using scope.resource.action and wire them through frontend and RLS patterns.` |
| `Import EmDash.` | `Update the tenant-imports flow for the <wave> seed contract, preserve mappings/artifacts, and validate with awcms-edge tests plus docs updates.` |

## Checklist Before Sending A Prompt

1. Did you name the workspace?
2. Did you state whether the work is platform, tenant, public, or cross-tenant?
3. Did you name the permission model if authorization matters?
4. Did you point to an existing pattern or canonical doc?
5. Did you state hard constraints like soft delete, static output, or Worker-only runtime?
6. Did you say how the result should be verified?
7. Did you say whether docs or mirrored migrations must also be updated?
8. If the task is import-related, did you say which wave or contract surface is being changed?

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
- [docs/architecture/emdash-seed-json.md](../architecture/emdash-seed-json.md)
- [docs/architecture/emdash-tenant-packages.md](../architecture/emdash-tenant-packages.md)
