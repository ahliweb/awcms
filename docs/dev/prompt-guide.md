> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) -> [AGENTS.md](../../AGENTS.md) -> [README.md](../../README.md) -> [DOCS_INDEX.md](../../DOCS_INDEX.md)
>
> **Status:** Maintained
>
> **Last Refreshed:** 2026-04-09

# AWCMS Prompt Guide

## Purpose

Provide a current, practical guide for writing prompts that match the live AWCMS monorepo as it exists now: the real workspace boundaries, runtime ownership model, multi-tenant rules, ABAC naming, validation gates, executable import surfaces, MCP/tooling shape, and the current documentation/OpenAPI maintenance workflow.

This guide is for humans and AI operators who want prompts to produce changes that are:

- accurate to the checked-in repo
- small enough to complete safely
- explicit about security and tenancy boundaries
- verified with the right commands
- aligned with the current documentation chain

This guide is descriptive, not authoritative. When it conflicts with a higher-level document, defer to:

1. [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md)
2. [AGENTS.md](../../AGENTS.md)
3. [README.md](../../README.md)
4. [DOCS_INDEX.md](../../DOCS_INDEX.md)

This guide complements, not replaces:

- [docs/dev/ai-workflows.md](ai-workflows.md) for execution discipline
- [docs/dev/ai-planning-workflow.md](ai-planning-workflow.md) for when planning is required
- [docs/dev/review-checklist.md](review-checklist.md) for review expectations

## How To Use This Guide

Use this guide in three passes when drafting a prompt:

1. Confirm the authority chain and the actual workspace path.
2. State the trust boundary, constraints, and validation commands explicitly.
3. Point the prompt at the real checked-in files or docs that define the existing pattern.

If the task is non-trivial, pair the prompt with a short planning record using [docs/dev/ai-planning-workflow.md](ai-planning-workflow.md).

## Current Repository Condition

Prompts should assume the following current repo condition unless the task explicitly says otherwise.

### Current Repository Snapshot

- The repo is an actively maintained monorepo with admin, public, edge, mobile, IoT, shared-package, MCP, and AI-gateway surfaces.
- The documentation audit cycle is active and tracked in:
  - [docs/dev/documentation-audit-plan.md](documentation-audit-plan.md)
  - [docs/dev/documentation-audit-tracker.md](documentation-audit-tracker.md)
- Canonical database migrations live in `supabase/migrations/` and are mirrored in `awcms/supabase/migrations/`.
- Runtime validation is not purely workspace-local anymore; prompts can target either a specific package check or the consolidated runtime script `bash scripts/ci-validate-runtime.sh`.
- Prompt authors should prefer workspace paths over package names because some workspace package manifests use historical or implementation-specific names.

### Documentation And Manifest Drift Reality

- The authority chain remains the decision source for architecture and constraints.
- Some patch-level package versions may move faster than higher-level docs. When version precision matters, prompts should say:
  - follow `SYSTEM_MODEL.md` and `AGENTS.md` for architectural constraints
  - verify the affected workspace manifest before making patch-version-sensitive changes
- This is especially important for public workspaces and toolchain/package-manager behavior.

### Core Runtime Reality

- `awcms/` is the admin panel: React 19.2.4 + Vite `^8.0.5` + JavaScript ES2022+.
- `awcms-public/` is the public-portal umbrella workspace.
- `awcms-public/primary/` and `awcms-public/smandapbun/` are Astro public portals with React 19.2.4 islands and static-first output.
- Public work should treat `awcms-public/primary/` and `awcms-public/smandapbun/` as separate implementation targets even when their architectural rules are shared.
- `awcms-edge/` is the maintained server-side HTTP runtime: Cloudflare Workers + Hono.
- Supabase remains authoritative for Auth, PostgreSQL data, RLS, and ABAC enforcement.
- Cloudflare R2 is the maintained object storage layer.
- Cloudflare Queues are used for asynchronous edge work such as media finalization and notification fan-out.
- `packages/awcms-shared/` contains shared public-facing TypeScript utilities and can affect multiple public workspaces at once.
- `awcms-mobile/primary/` is the maintained Flutter mobile client.
- `awcms-esp32/primary/` is the maintained ESP32/PlatformIO firmware workspace.
- `openclaw/` is the maintained AI gateway configuration surface.
- Custom Node.js backend servers are not part of the supported runtime.

### Security And Data Lifecycle Reality

- Tenant isolation is mandatory.
- `tenant_id` is required on tenant-scoped tables and must be respected in app code and Worker logic.
- Soft delete remains the standard business-data deletion model.
- Reads should filter `deleted_at IS NULL` where applicable.
- Permission keys must use the canonical format `scope.resource.action`.
- Worker-side auth and permission checks are additive guardrails; Supabase RLS and `has_permission(...)` remain the final authority.
- `SUPABASE_SECRET_KEY` is allowed only in approved server-side runtimes and operational contexts.

### Public Surface Reality

- Public rendering must stay published-only and non-deleted.
- Public tenant-aware Worker routes now support stricter guardrails:
  - tenant identity may be resolved by `tenantId`, `tenant_id`, or `domain`, depending on the route
  - when both tenant and domain inputs are supplied, they must resolve to the same tenant
  - mismatch is a first-class failure mode (`400 Tenant/domain mismatch`)
- Public media delivery through `/public/media/*` is intentionally narrow:
  - only canonical keys shaped like `tenants/<tenant_id>/...` are valid
  - malformed keys, traversal-like segments, and `tenants/<tenant_id>/protected/...` are rejected

### OpenAPI And Documentation Reality

- `awcms-edge/` maintains descriptive OpenAPI artifacts for public, admin, and internal boundaries.
- Generated artifacts live in:
  - `awcms-edge/openapi/public.json`
  - `awcms-edge/openapi/admin.json`
  - `awcms-edge/openapi/internal.json`
- The OpenAPI route catalog in `awcms-edge/src/lib/openapi/route-catalog.ts` is the source for generated artifacts.
- If a documented Worker route changes, prompts should usually require:
  - route implementation updates
  - route catalog/OpenAPI metadata updates
  - edge docs updates
  - generated artifact rebuild/validation
- Documentation validation with `npm run docs:check` is active and should be called out in prompts for maintained docs.

### MCP And Operator Tooling Reality

- The repo-level MCP topology is declared in `mcp.json`.
- The currently enabled MCP servers are `supabase`, `context7`, `github`, and `cloudflare`.
- `paper` remains configured but disabled by default.
- GitHub MCP is intentionally limited to `default,git` toolsets.
- Cloudflare MCP uses a curated disabled-tools list to reduce tool sprawl.
- Prompt authors should ask for repo-aware, bounded changes rather than vague "use MCP" instructions.

### Validation Entry Point Reality

- Validation should be named with real commands, not described generically.
- Important current entry points include:
  - `bash scripts/ci-validate-runtime.sh`
  - `bash scripts/verify_supabase_migration_consistency.sh`
  - `npm run docs:check` from `awcms/`
  - workspace-local build/check/typecheck/test commands
- Prompt authors should choose the narrowest correct validation path for the change and mention the broader runtime script only when cross-surface confidence is needed.

### Import / EmDash Reality

- EmDash import support is no longer placeholder-only.
- `tenant-imports` in `awcms-edge/src/index.ts` is a live prompt target.
- Executable import waves currently include:
  - `blog`
  - `marketing`
  - `portfolio`
- External EmDash seeds can be loaded from:
  - `http(s)` URLs
  - local file paths
  - `file://` locators
  - native EmDash repo roots that contain `templates/<wave>/seed/seed.json`
- The canonical contract lives in:
  - [docs/architecture/emdash-seed-json.md](../architecture/emdash-seed-json.md)
  - [docs/architecture/emdash-tenant-packages.md](../architecture/emdash-tenant-packages.md)

## What This Guide Should Help You Avoid

The most common low-value prompts in AWCMS are stale in one of these ways:

- they assume a Node/Express-style backend instead of Cloudflare Workers
- they treat Supabase Edge Functions as the maintained runtime
- they ask for raw UUID routes where signed route params are required
- they omit tenant isolation, soft delete, or ABAC naming requirements
- they ask for public rendering without saying published-only and non-deleted
- they request schema work without mentioning mirrored migration parity
- they change documented Worker routes but forget route catalog/OpenAPI/doc parity
- they ask for a broad rewrite when the repo really needs a narrow vertical slice

## When To Use This Guide

Use this guide when writing prompts for:

- admin panel code changes
- Astro public portal work
- Cloudflare Worker routes
- ABAC / RLS / tenancy fixes
- Supabase migration work
- OpenAPI or Swagger surface updates
- EmDash import work
- documentation maintenance
- CI or deployment debugging
- code review or regression review requests

## Prompting Principles

Good AWCMS prompts are:

- explicit about workspace ownership
- explicit about platform, tenant, public, or cross-tenant scope
- grounded in the actual current files and docs
- clear about the runtime boundary
- clear about validation requirements
- limited to one coherent objective when possible
- careful about doc/spec parity when touching documented surfaces
- aware of whether the task is local, cross-workspace, or audit/remediation work
- specific about whether the prompt needs implementation, investigation, review, or documentation maintenance

Bad AWCMS prompts are usually vague in one or more of these ways:

- no workspace is named
- no security boundary is named
- no existing implementation pattern is referenced
- no validation command is requested
- too many unrelated asks are bundled together
- the prompt ignores the documentation authority chain

## Start With Authority And Scope

Before writing a detailed prompt, anchor it to the authority chain and the relevant local docs.

### Authority Chain

1. [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md)
2. [AGENTS.md](../../AGENTS.md)
3. [README.md](../../README.md)
4. [DOCS_INDEX.md](../../DOCS_INDEX.md)

### Common Domain-Specific References

- Admin work: [docs/dev/admin.md](admin.md)
- Public portal work: [docs/dev/public.md](public.md)
- Worker/runtime work: [docs/dev/edge-functions.md](edge-functions.md)
- Security-sensitive work: [docs/security/abac.md](../security/abac.md) and [docs/security/rls.md](../security/rls.md)
- OpenAPI/runtime docs work: [docs/architecture/edge-openapi-spec.md](../architecture/edge-openapi-spec.md) and [docs/dev/openapi-quality-checklist.md](openapi-quality-checklist.md)
- Module routing/ownership: [docs/modules/MODULES_GUIDE.md](../modules/MODULES_GUIDE.md)
- EmDash/import work: [docs/architecture/emdash-seed-json.md](../architecture/emdash-seed-json.md) and [docs/architecture/emdash-tenant-packages.md](../architecture/emdash-tenant-packages.md)
- Planning/review discipline: [docs/dev/ai-workflows.md](ai-workflows.md), [docs/dev/ai-planning-workflow.md](ai-planning-workflow.md), and [docs/dev/review-checklist.md](review-checklist.md)

If the task is documentation-heavy, the prompt should say which docs must stay aligned.

## Prompt Anatomy

The current repo workflow expects prompt shape and execution discipline to work together.

For substantial work, a good prompt usually contains these fields explicitly or implicitly:

```text
Role: optional operator stance when useful
Context: workspace paths, docs, and runtime boundaries
Task: one concrete objective
Constraints: security, tenancy, lifecycle, styling, and runtime rules
Validation: exact commands or verification proof
Output: code/docs/spec/review result expected
```

This shape aligns with [docs/dev/ai-workflows.md](ai-workflows.md). Prompts do not need to be verbose, but they should still cover these elements.

## The 7 Essential Prompt Components

Every useful AWCMS prompt should answer these questions up front.

### 1. Workspace

State exactly where the change belongs.

| Workspace | Use When The Request Is About |
| --- | --- |
| `awcms/` | Admin panel UI, hooks, contexts, manager screens, dashboard widgets, module routes |
| `awcms-public/` | Umbrella public workspace commands that coordinate `primary` and `smandapbun` |
| `awcms-public/primary/` | Default public portal, Astro pages, islands, static content rendering |
| `awcms-public/smandapbun/` | Sovereign SMANDAPBUN portal |
| `awcms-edge/` | Worker routes, queue consumers, R2 delivery, edge auth, import execution |
| `supabase/migrations/` | Canonical root database migrations |
| `awcms/supabase/migrations/` | Mirrored migration path that must remain in parity with root migrations |
| `awcms-mcp/` | Local MCP server tooling |
| `packages/awcms-shared/` | Shared TypeScript utilities |
| `awcms-mobile/primary/` | Flutter mobile implementation |
| `awcms-esp32/primary/` | ESP32 / PlatformIO firmware |
| `openclaw/` | AI gateway routing and tenant model config |
| `scripts/` | Repo-level validation, migration parity, environment bootstrap, and operational automation |
| `docs/` | Documentation updates |

Example:

> Working in `awcms-edge/` and `docs/dev/`.

### 2. Task Type

Name the category of change so the correct guardrails and workflows are applied.

| Task Type | Typical Keywords |
| --- | --- |
| Admin UI | `manager screen`, `dashboard widget`, `settings form`, `dialog` |
| Hook / context | `new hook`, `tenant-aware fetch`, `context update` |
| Public portal | `Astro page`, `island`, `build-time content`, `published-only render` |
| Migration | `new migration`, `constraint`, `index`, `schema`, `table` |
| RLS / ABAC | `policy`, `permission`, `tenant isolation`, `has_permission` |
| Edge route | `Worker route`, `queue consumer`, `webhook`, `R2`, `edge auth` |
| OpenAPI / docs surface | `route catalog`, `Swagger`, `spec`, `public.json`, `admin.json` |
| Import pipeline | `seed.json`, `tenant-imports`, `materialization`, `mapping`, `artifact` |
| Extension work | `extension.json`, `tenant_extensions`, `platform_extension_catalog` |
| CI / workflow | `GitHub Actions`, `Pages deploy`, `wrangler`, `workflow fix` |
| Documentation | `update docs`, `prompt guide`, `architecture docs`, `release summary` |
| Review | `review`, `bugs`, `risks`, `regression`, `missing tests` |

### 3. Security Boundary And Scope

Prompts should state the boundary directly.

| Scope | Prompt Language To Use |
| --- | --- |
| Platform | `This is platform-level. Use approved server-side secret-key paths only where required.` |
| Tenant | `This is tenant-scoped. Preserve tenant isolation, soft delete, and ABAC naming.` |
| Public | `This is public-facing. Render only published, non-deleted, tenant-scoped data and do not use secret-key client paths.` |
| Cross-tenant admin flow | `This touches multiple tenants and must remain auditable, idempotent, and isolated.` |

Examples:

> Tenant-scoped. Use tenant context and permission keys like `tenant.blog.update`.

> Public-facing. Use build-time or Worker-mediated tenant resolution as appropriate and fail closed on missing or mismatched tenant context.

### 4. Existing Patterns To Follow

Point prompts at real files instead of asking the agent to invent patterns.

High-value references include:

- `awcms/src/components/MainRouter.jsx`
- `awcms/src/hooks/useAdminMenu.js`
- `awcms/src/hooks/useMedia.js`
- `awcms/src/hooks/useTemplates.js`
- `awcms/src/components/dashboard/widgets/DashboardWidgetHeader.jsx`
- `awcms/src/components/dashboard/EmdashImportsManager.jsx`
- `awcms-edge/src/index.ts`
- `awcms-edge/src/lib/openapi/route-catalog.ts`
- `awcms-public/primary/src/components/puck-blocks/WidgetAreaBlock.astro`
- [docs/dev/admin.md](admin.md)
- [docs/dev/public.md](public.md)
- [docs/dev/edge-functions.md](edge-functions.md)
- [docs/architecture/edge-openapi-spec.md](../architecture/edge-openapi-spec.md)
- [docs/dev/openapi-quality-checklist.md](openapi-quality-checklist.md)
- [docs/modules/MODULES_GUIDE.md](../modules/MODULES_GUIDE.md)
- [docs/architecture/emdash-seed-json.md](../architecture/emdash-seed-json.md)
- [docs/architecture/emdash-tenant-packages.md](../architecture/emdash-tenant-packages.md)
- `.agents/workflows/migration-workflow.md`
- `.agents/workflows/rls-change-workflow.md`
- `.agents/workflows/ui-change-workflow.md`
- `.agents/workflows/ci-validation-workflow.md`

### 5. Constraints And Non-Negotiables

Prompts should explicitly state the rules that must not be violated.

Common AWCMS constraints:

```text
- Respect SYSTEM_MODEL.md and AGENTS.md as the primary authority.
- Tenant-scoped resources must use tenant_id and preserve tenant isolation.
- Soft delete only for business data; do not use hard delete for normal lifecycle flows.
- Reads must account for deleted_at is null where applicable.
- Permission keys must use scope.resource.action.
- Admin panel code in awcms/ is JavaScript ES2022+, not TypeScript.
- Public portal code is TypeScript/TSX and static-first.
- Public rendering must be published-only and non-deleted.
- Worker routes must validate caller auth context before protected work.
- SUPABASE_SECRET_KEY is server-side only.
- Cloudflare Workers are the maintained edge runtime; do not introduce a custom Node.js server.
- Use signed route params for protected admin edit/detail routes.
- Use semantic theme variables; avoid hardcoded hex values in UI work.
- If a documented Worker route changes, update route docs/OpenAPI metadata/artifacts as needed.
```

### 6. Validation Requirements

Say exactly how success should be verified.

Useful validation language:

- run the relevant workspace build/test/typecheck/docs commands
- rebuild OpenAPI artifacts if documented edge route metadata changed
- validate generated specs when route catalog changes
- keep both migration folders in parity if schema work is involved
- update docs if a user-facing, runtime, or contract surface changed
- use the runtime validation script for cross-surface confidence when the change spans admin/shared/edge/migration boundaries

Example:

> Done means the route works, negative paths are covered, route docs stay aligned, `npm test` and `npm run typecheck` pass in `awcms-edge/`, and OpenAPI artifacts are rebuilt if the route catalog changed.

### 7. Definition Of Done

Prompts should say what “finished” means beyond code edits.

Useful completion language:

- the feature or fix works end to end
- relevant docs are aligned
- validation passes in the changed workspace(s)
- generated artifacts are refreshed if the source metadata changed
- mirrored migrations remain in parity if schema work was involved
- review findings are listed first if the task is a review

## AWCMS-Specific Guardrails Worth Calling Out Explicitly

### Stack And Runtime

- `awcms/`: React 19.2.4, Vite `^8.0.5`, JavaScript ES2022+
- `awcms-public/primary/`: Astro-based public portal, React 19.2.4 islands, TypeScript/TSX, static-first output
- `awcms-public/smandapbun/`: Astro-based public portal, React 19.2.4 islands, TypeScript/TSX, static-first output
- `awcms-edge/`: Cloudflare Workers + Hono
- Supabase: Auth, PostgreSQL, RLS, ABAC authority
- Cloudflare R2: object storage
- Cloudflare Queues: async background processing
- Node.js baseline: `>=24.14.1`

When exact patch versions matter, read the relevant workspace manifest in addition to the authority docs.

### Tenancy And Authorization

- RLS is mandatory.
- Client code must not bypass RLS.
- Worker-side permission checks are additive guardrails.
- Prompt language should use canonical permission families, not guessed names.
- Use the current ABAC docs for naming before inventing a new permission family.
- For public tenant-aware Worker routes, say whether the task affects:
  - `tenantId` / `tenant_id` handling
  - `domain` handling
  - mismatch rejection behavior

### Media And Storage

- Cloudflare R2 is the maintained object layer.
- Public media should use canonical tenant-prefixed keys.
- Protected or session-bound media must not be described as publicly fetchable.
- If the task changes `/public/media/*`, prompts should usually require tests for malformed and protected-path cases.

### Worker/OpenAPI Surface

- Route code changes in `awcms-edge/` may require updates in:
  - `awcms-edge/src/lib/openapi/route-catalog.ts`
  - `docs/dev/edge-functions.md`
  - `docs/architecture/edge-openapi-spec.md`
  - `docs/dev/openapi-quality-checklist.md`
- If the route catalog changes, prompts should usually mention:
  - `npm run openapi:build`
  - `npm run openapi:validate`
  - `npm run openapi:diff`

### Import And EmDash Work

When prompts target import work, say whether the task is about:

- seed contract changes
- external loader support
- mapping/idempotency behavior
- artifact output
- admin import UX
- public rendering parity

Current import tables/artifacts that prompts may need to reference:

- `tenant_import_jobs`
- `tenant_import_sources`
- `tenant_import_mappings`
- `tenant_import_artifacts`
- `tenant_import_audit`

### Documentation Maintenance

Prompts for docs should say whether the change must also update:

- `DOCS_INDEX.md`
- `README.md`
- `AGENTS.md`
- `docs/dev/documentation-audit-plan.md`
- `docs/dev/documentation-audit-tracker.md`
- route catalog/OpenAPI docs if the topic is a documented edge route

Doc prompts should also call out `npm run docs:check` when the change touches maintained docs.

### Planning And Review Discipline

- Non-trivial prompts should either include a planning expectation or explicitly say the work is small enough not to require one.
- High-risk prompts should say to plan first, especially for migrations, RLS/ABAC, auth, edge contracts, storage, sanitization, or cross-tenant flows.
- Review prompts should ask for findings first, file references, and explicit risk/test-gap callouts.
- If the task is a review of an implementation that changed docs or contracts, the prompt should ask the reviewer to verify doc/spec parity rather than only code correctness.

## Current Validation Commands To Mention In Prompts

Use the most relevant command for the changed surface instead of vague language like “run checks”.

| Surface | Typical Validation |
| --- | --- |
| `awcms/` | `npm run lint`, `npm run build`, or targeted `npm test -- --run <path>` depending on the change |
| `awcms/` docs | `npm run docs:check` |
| `awcms-edge/` | `npm test` and `npm run typecheck` |
| `awcms-edge/` OpenAPI changes | `npm run openapi:build`, `npm run openapi:validate`, `npm run openapi:diff` |
| `awcms-public/primary/` | `npm run check:astro`, `npm run check`, or `npm run build` as appropriate |
| `awcms-public/smandapbun/` | `npm run check`, `npm run lint`, or `npm run build` as appropriate |
| `awcms-public/` cross-portal work | `pnpm -C awcms-public run build` or the equivalent root public build command |
| maintained docs | `npm run docs:check` from `awcms/` |
| migration work | `bash scripts/verify_supabase_migration_consistency.sh` and keep mirrored migrations aligned |
| admin/shared/edge/runtime-crossing work | `bash scripts/ci-validate-runtime.sh` |

Choose the narrowest correct command set. Do not automatically ask for every validation command in the repo.

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
| OpenAPI/runtime docs | [docs/architecture/edge-openapi-spec.md](../architecture/edge-openapi-spec.md) and [docs/dev/openapi-quality-checklist.md](openapi-quality-checklist.md) |
| Import contract changes | [docs/architecture/emdash-seed-json.md](../architecture/emdash-seed-json.md) |

Also align with [docs/dev/ai-workflows.md](ai-workflows.md):

- prefer one objective per prompt when feasible
- prefer atomic changes over broad rewrites
- verify after changes
- plan first for migrations, RLS/ABAC, auth, storage, sanitization, and cross-tenant work
- use a tracked plan or planning record for non-trivial implementation work

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
Follow: `docs/dev/public.md` and current tenant-scoped content-fetching patterns.
Constraints:
- Astro static-first output
- TypeScript/TSX only
- resolve tenant at build time using PUBLIC_TENANT_ID or VITE_PUBLIC_TENANT_ID unless the task is explicitly Worker-mediated
- render only published and non-deleted content
- no secret-key path in client code
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
Follow: `awcms-edge/src/index.ts`, `docs/dev/edge-functions.md`, and `awcms-edge/src/lib/openapi/route-catalog.ts` if the route is documented.
Constraints:
- validate caller auth context before protected work
- use publishable-key caller auth for session validation and SUPABASE_SECRET_KEY only for approved admin operations
- preserve Supabase as the authority for Auth, RLS, and ABAC
- validate request shape before writes
- use tenant-aware filters and deleted_at guards where applicable
- update route docs/OpenAPI metadata if the route is on a documented surface
Done when:
- `npm test` passes in `awcms-edge/`
- `npm run typecheck` passes in `awcms-edge/`
- negative auth and validation paths are covered where relevant
- OpenAPI artifacts are rebuilt if the route catalog changed

<specific request>
```

### Template D: Public Worker Route Or Public Compatibility Route

```text
Working in `awcms-edge/`.
Task type: public Worker route update.
Scope: public-facing.
Follow: `docs/dev/edge-functions.md`, `docs/architecture/edge-openapi-spec.md`, and the current public-route patterns in `awcms-edge/src/index.ts`.
Constraints:
- public data must remain published-only / public-only / non-deleted as applicable
- if the route accepts tenant context, specify whether it uses tenantId, tenant_id, domain, or a combination
- fail closed on missing or mismatched tenant context
- if the route serves public media, preserve canonical storage-key restrictions and protected-path rejection
Done when:
- public failure modes are explicit
- `npm test` and `npm run typecheck` pass in `awcms-edge/`
- route catalog/docs/artifacts are updated if the route is documented

<specific request>
```

### Template E: Migration Or RLS Change

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

### Template F: Import Pipeline Or EmDash Contract Update

```text
Working in `awcms-edge/`, relevant docs under `docs/architecture/`, and admin import UI files if needed.
Task type: import pipeline / seed contract / materialization update.
Scope: cross-tenant-safe operator flow.
Follow: `awcms-edge/src/index.ts`, `awcms/src/components/dashboard/EmdashImportsManager.jsx`, `docs/architecture/emdash-seed-json.md`, and `docs/architecture/emdash-tenant-packages.md`.
Constraints:
- preserve replayability through tenant_import_mappings
- keep artifacts and audit output meaningful
- maintain tenant isolation and deleted_at guards
- do not break currently executable waves: blog, marketing, portfolio
- update copyable seed examples if the contract changes
Done when:
- changed import wave or contract works end to end
- `npm test` and `npm run typecheck` pass in `awcms-edge/`
- `npm run docs:check` passes if docs changed

<specific request>
```

### Template G: OpenAPI / Swagger Surface Update

```text
Working in `awcms-edge/` and the related edge docs.
Task type: OpenAPI/runtime docs alignment.
Follow: `awcms-edge/src/lib/openapi/route-catalog.ts`, `docs/architecture/edge-openapi-spec.md`, and `docs/dev/openapi-quality-checklist.md`.
Constraints:
- keep specs descriptive of runtime reality, not aspirational
- preserve boundary separation between public, admin, and internal routes
- document tenant/domain mismatch behavior and canonical media-key rules when relevant
- do not expose internal-only trust boundaries in public/admin docs
Done when:
- route catalog and docs are aligned
- `npm run openapi:build`, `npm run openapi:validate`, and `npm run openapi:diff` pass in `awcms-edge/`
- `npm run docs:check` passes if docs changed

<specific request>
```

### Template H: Documentation Update

```text
Working in `docs/`.
Task type: documentation update.
Authority order: SYSTEM_MODEL.md -> AGENTS.md -> README.md -> DOCS_INDEX.md -> target doc.
Constraints:
- keep stack versions and runtime boundaries current
- prefer path- and manifest-aware language over guessed package names or stale topology assumptions
- use relative links
- update canonical references if topic routing changes
- update the audit tracker if this is a repo-wide or cross-surface correction
Done when:
- the target doc is accurate
- cross-references are aligned
- `npm run docs:check` passes
- related canonical docs are updated if needed

<specific request>
```

### Template I: CI / Workflow Repair

```text
Working in the AWCMS monorepo.
Task type: CI failure investigation and targeted fix.
Start from the failing GitHub Actions run/job logs.
Follow: `docs/dev/ai-workflows.md`, the exact workflow file, and the affected workspace manifest/config.
Investigation requirements:
- use `gh` to inspect the run, job, and failed step logs
- identify the exact failing command or action step
- distinguish app failure, workflow/config failure, environment/toolchain issue, or upstream/external issue
Constraints:
- apply the smallest safe fix
- do not weaken security, validation, or deployment safeguards
- if Cloudflare Pages deploy is involved, inspect credential resolution and `wranglerVersion` alignment with the workspace
Done when:
- root cause is identified
- the necessary workflow or workspace fix is applied
- relevant local validation passes if reproducible locally
- any remaining external dependency on a rerun is stated clearly

<GitHub Actions URL or run/job id>
```

### Template J: Code Review Request

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
- [docs/dev/agent-skill-policy.md](agent-skill-policy.md)
- [docs/architecture/edge-openapi-spec.md](../architecture/edge-openapi-spec.md)
- [docs/dev/openapi-quality-checklist.md](openapi-quality-checklist.md)
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
| `Make an API endpoint.` | `Add or update a Cloudflare Worker route in awcms-edge/, validate Supabase auth first, and keep route docs/OpenAPI metadata aligned if the surface is documented.` |
| `Fix CI.` | `Inspect the failing GitHub Actions job with gh, identify the exact failing step, and apply the smallest safe workflow or workspace fix.` |
| `Show content publicly.` | `Render tenant-scoped published content using build-time tenant resolution or a guarded public Worker route, depending on the existing pattern.` |
| `Delete this item.` | `Soft-delete the business record via deleted_at and keep reads filtered to non-deleted rows.` |
| `Add permissions.` | `Add permission keys using scope.resource.action and wire them through frontend and RLS patterns.` |
| `Import EmDash.` | `Update the tenant-imports flow for the <wave> contract, preserve mappings/artifacts, and validate with awcms-edge tests plus docs updates.` |
| `Update the docs.` | `Update the target doc, keep authority docs aligned if needed, and run npm run docs:check.` |

## Checklist Before Sending A Prompt

1. Did you name the workspace?
2. Did you state whether the work is platform, tenant, public, or cross-tenant?
3. Did you name the permission model if authorization matters?
4. Did you point to an existing pattern or canonical doc?
5. Did you state hard constraints like soft delete, static output, or Worker-only runtime?
6. Did you say how the result should be verified?
7. Did you say whether docs, OpenAPI artifacts, or mirrored migrations must also be updated?
8. If the task is import-related, did you say which wave or contract surface is being changed?
9. If the task is a public Worker route, did you say how tenant resolution and failure paths should behave?
10. If the task is non-trivial, did you state whether planning is required?
11. If exact versions matter, did you say whether to trust authority docs, live manifests, or both?

## References

- [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md)
- [AGENTS.md](../../AGENTS.md)
- [README.md](../../README.md)
- [DOCS_INDEX.md](../../DOCS_INDEX.md)
- [docs/dev/ai-workflows.md](ai-workflows.md)
- [docs/dev/admin.md](admin.md)
- [docs/dev/public.md](public.md)
- [docs/dev/edge-functions.md](edge-functions.md)
- [docs/architecture/edge-openapi-spec.md](../architecture/edge-openapi-spec.md)
- [docs/dev/openapi-quality-checklist.md](openapi-quality-checklist.md)
- [docs/modules/MODULES_GUIDE.md](../modules/MODULES_GUIDE.md)
- [docs/security/abac.md](../security/abac.md)
- [docs/security/rls.md](../security/rls.md)
- [docs/architecture/emdash-seed-json.md](../architecture/emdash-seed-json.md)
- [docs/architecture/emdash-tenant-packages.md](../architecture/emdash-tenant-packages.md)
