> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) -> [AGENTS.md](../../AGENTS.md) -> [README.md](../../README.md) -> [DOCS_INDEX.md](../../DOCS_INDEX.md)
>
> **Status:** Maintained
>
> **Last Refreshed:** 2026-04-09

# Public Portal Development

## Purpose

Document the current public-portal development model for AWCMS as it exists now across `awcms-public/primary/`, `awcms-public/smandapbun/`, and the public edge compatibility/runtime surfaces they depend on.

This guide is meant to be practical and repo-state-aware. It should help contributors and agents understand:

- where public functionality belongs
- how tenant resolution works today
- what data can appear on public surfaces
- when public work belongs in Astro vs Cloudflare Workers
- which validation commands and docs must be updated together

## Current State

### Current Public Runtime Model

- The maintained public portals live in `awcms-public/`.
- `awcms-public/primary/` is the reusable Astro portal and the main reference implementation.
- `awcms-public/smandapbun/` is a dedicated sovereign public portal with its own implementation constraints documented in [docs/tenancy/smandapbun.md](../tenancy/smandapbun.md).
- Astro 6.0.8 with React 19.2.4 islands is the current public stack.
- Public builds are static-first (`output: "static"`) unless a task explicitly introduces or targets a different deployment/runtime mode.
- Supabase JS remains the public data client.
- Cloudflare Workers in `awcms-edge/` are the only maintained server-side HTTP runtime for public compatibility routes, guarded media access, tenant/domain-mediated public route logic, and other edge-managed flows.

### Current Public Data Rules

- Public content must remain tenant-scoped.
- Public content must remain published-only.
- Public content must exclude soft-deleted rows.
- Client code must not use `SUPABASE_SECRET_KEY`.
- Public portal code must not bypass RLS through privileged backend patterns.
- Puck editor runtime is not allowed in public portals; render-only usage is allowed.

### Current Public/Edge Split

Public work is now split more clearly than older docs implied:

- Use Astro/Supabase client code for static build-time content rendering and public page composition.
- Use Cloudflare Worker routes when public behavior depends on:
  - tenant/domain-mediated compatibility routes
  - guarded public media delivery
  - form verification or edge-side integrations
  - public compatibility endpoints already implemented in `awcms-edge/`

If a task changes a documented public Worker route, it likely also needs updates in:

- [docs/dev/edge-functions.md](edge-functions.md)
- [docs/architecture/edge-openapi-spec.md](../architecture/edge-openapi-spec.md)
- [docs/dev/openapi-quality-checklist.md](openapi-quality-checklist.md)
- `awcms-edge/src/lib/openapi/route-catalog.ts`

## Public Workspace Overview

### `awcms-public/primary/`

Use `primary` for:

- the default tenant-scoped public portal pattern
- Astro page routing and static generation
- shared public content/query helpers
- tenant-scoped widgets, menu rendering, search, sitemap generation, and localized content rendering

Current primary-portal composition now follows a more EmDash-style public structure while preserving AWCMS runtime boundaries:

- shared page composition is centered around `src/layouts/Layout.astro` and `src/layouts/PageLayout.astro`
- page-level public plugin injection is resolved through:
  - `src/components/common/PublicHead.astro`
  - `src/components/common/PublicBodyStart.astro`
  - `src/components/common/PublicBodyEnd.astro`
- reusable public widget-area rendering is centered around `src/components/common/WidgetArea.astro`
- homepage rendering is centralized in `src/components/public/HomePageContent.astro` instead of duplicating large AstroWind fallback pages per locale
- shared marketing/showcase section primitives now live under `src/components/public/`, including:
  - `Hero.astro`
  - `Section.astro`
  - `FeatureGrid.astro`
  - `SplitSection.astro`
  - `StatGrid.astro`
  - `TestimonialGrid.astro`
  - `FaqList.astro`
  - `CtaBanner.astro`
- these section primitives now back the core localized marketing pages, the main showcase home variants, and the maintained landing pages, replacing most page-local AstroWind widget assemblies in `primary`
- canonical tenant-facing content routes now live under locale-prefixed public paths such as:
  - `/{locale}/blogs`
  - `/{locale}/blogs/[slug]`
  - `/{locale}/p/[slug]`
  - `/{locale}/events`
- remaining non-localized legacy AstroWind demo surfaces are being reduced to compatibility redirects where appropriate rather than maintained as a parallel public content model
- legacy bundled Astro content-demo posts and their page-local marketing widget assemblies are no longer part of the maintained `primary` public surface; tenant content now comes from AWCMS public data flows and the shared `src/components/public/*` section system

Important live helper surfaces include:

- `awcms-public/primary/src/lib/content.ts`
- `awcms-public/primary/src/lib/widgets.ts`
- `awcms-public/primary/src/lib/search.ts`
- `awcms-public/primary/src/lib/sitemap.ts`
- `awcms-public/primary/src/components/puck-blocks/WidgetAreaBlock.astro`

### `awcms-public/smandapbun/`

Use `smandapbun` when the request is specifically about the sovereign/public-specialized portal.

Do not assume `smandapbun` follows the exact same internal helper layout as `primary`. If the task targets that workspace, read the checked-in files and [docs/tenancy/smandapbun.md](../tenancy/smandapbun.md) first.

## Public Architecture

### Stack

- Astro 6.0.8
- React 19.2.4 islands
- TypeScript / TSX
- TailwindCSS `^4.2.2`
- `@supabase/supabase-js` `^2.99.3`

### Rendering Model

- Default public deployments are static-first.
- `getStaticPaths()` and build-time data fetching are the normal content path.
- Public tenant selection for static builds must come from build-time environment variables.
- Middleware-based request-time tenant resolution is not the canonical path for static public builds.

### Runtime Boundaries

Public portal development must respect [docs/architecture/runtime-boundaries.md](../architecture/runtime-boundaries.md):

- Cloudflare Workers are the only maintained function runtime.
- Cloudflare R2 is the only maintained object storage runtime.
- Supabase Storage is not the maintained storage layer.
- Worker compatibility/public routes must resolve through `VITE_EDGE_URL` / `PUBLIC_EDGE_URL`, not Supabase-hosted Edge Functions.

## Multi-Tenancy Strategy

### Static Tenant Resolution

Static public builds should resolve tenant identity using build-time env values:

- `PUBLIC_TENANT_ID` (preferred)
- `VITE_PUBLIC_TENANT_ID`
- `VITE_TENANT_ID`

The build should fail closed when no tenant can be resolved for a tenant-specific static build.

For public content fetching helpers, current code paths in `awcms-public/primary/src/lib/content.ts` and related helpers explicitly preserve tenant filtering and null-tenant fallback behavior where appropriate.

### Build-Time Guardrails

- Do not rely on `Astro.locals` for canonical static builds.
- Do not silently render empty or wrong-tenant content when tenant env is missing.
- Preserve explicit `tenant_id` filters even when RLS is present.
- Preserve `.is("deleted_at", null)` and published-state filters.

### Public Worker Guardrails

Some public-facing compatibility routes now resolve tenant context through the Worker layer. Current public guardrails include:

- public tenant-aware routes may accept `tenantId`, `tenant_id`, or `domain`, depending on the route
- when tenant and domain inputs are both provided, they must resolve to the same tenant
- mismatch is an explicit failure mode (`400 Tenant/domain mismatch`)
- `/public/media/*` only accepts canonical public keys shaped like `tenants/<tenant_id>/...`
- `/public/media/*` rejects malformed paths, traversal-like segments, and `tenants/<tenant_id>/protected/...`

When a public task depends on those routes, read [docs/dev/edge-functions.md](edge-functions.md) first.

## Static Content Fetching Pattern

### Objective

Statically render tenant-scoped content without leaking drafts, soft-deleted content, or cross-tenant rows.

### Required Inputs

| Field | Source | Required | Notes |
| --- | --- | --- | --- |
| `PUBLIC_TENANT_ID` | Build env | Yes | Preferred tenant resolver |
| `VITE_PUBLIC_TENANT_ID` / `VITE_TENANT_ID` | Build env | Optional | Fallback tenant resolvers |
| `PUBLIC_SUPABASE_URL` / `VITE_SUPABASE_URL` | Build env | Yes | Public Supabase URL |
| `PUBLIC_SUPABASE_PUBLISHABLE_KEY` / `VITE_SUPABASE_PUBLISHABLE_KEY` | Build env | Yes | Public publishable key |
| `PUBLIC_TURNSTILE_SITE_KEY` | Build env | Conditional | Required for Turnstile-protected public forms |

### Workflow

1. Resolve tenant identity at build time.
2. Create the public Supabase client from build-time env values.
3. Query only published, tenant-scoped, non-deleted rows.
4. Generate static paths.
5. Render content using the existing public rendering pattern.
6. Keep related helpers aligned if search, sitemap, widgets, or public media references are affected.

### Current Reference Pattern

The current `awcms-public/primary/src/lib/content.ts` helpers show the expected shape:

- page and blog reads explicitly filter `status = 'published'`
- soft delete is respected
- tenant filtering is explicit
- translation lookups fall back carefully when tenant-specific translation rows are absent
- related content lookups are tenant-aware

### Validation Checklist

- only published rows are rendered
- soft-deleted rows are excluded
- cross-tenant rows are not rendered
- missing tenant env fails clearly rather than silently
- localized or related-content helpers preserve tenant scope

## Current Public Surfaces To Know

### Primary Portal Routes

Common public surfaces currently include:

- `/` and locale-prefixed home routes
- page routes such as `/p/[slug]`
- blog routes such as `/blogs` and `/blogs/[slug]`
- public analytics/statistics surfaces where implemented
- widget-rendered content blocks and public menus

Before changing route behavior, inspect the actual page/component/helper files in `awcms-public/primary/src/` rather than assuming older folder conventions.

### Public Worker Surfaces

Current public edge surfaces relevant to public-portal work include:

- `/public/sitemap`
- `/public/media/*`
- `/functions/v1/serve-sitemap` (compatibility route)
- `/functions/v1/extensions/events/public`
- `/functions/v1/extensions/public-modules`
- `/functions/v1/verify-turnstile`

Treat these as part of the public product surface, not merely internal implementation details.

## Environment Variables

Current public work should expect these env categories:

- `PUBLIC_SUPABASE_URL`
- `PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `PUBLIC_TENANT_ID`
- `VITE_PUBLIC_TENANT_ID`
- `VITE_TENANT_ID`
- `PUBLIC_TENANT_SLUG` where deployment clarity or tenant branding depends on it
- `PUBLIC_TURNSTILE_SITE_KEY` for Turnstile-protected public forms
- `PUBLIC_EDGE_URL` / `VITE_EDGE_URL` where public runtime behavior needs Worker route access

`awcms-public/primary` currently wraps some commands through deployment-env scripts so local validation uses the same environment resolution model as deployment.

## Development Workflow

### Typical Flow

1. Work in the target public workspace.
2. Follow the existing helper/component/page pattern instead of inventing a new public architecture.
3. Keep public data published-only, tenant-scoped, and non-deleted.
4. If the change depends on a public Worker route, update the edge/runtime docs and route catalog as needed.
5. Validate the workspace and docs surface.

### Current Validation Commands

Use the most relevant commands for the touched public surface.

| Surface | Validation |
| --- | --- |
| `awcms-public/primary/` | `npm run check:astro` |
| `awcms-public/smandapbun/` | run the workspace's relevant build/check command |
| maintained docs | `cd awcms && npm run docs:check` |
| public Worker compatibility route changes | `cd awcms-edge && npm test` and `npm run typecheck` |
| route catalog/OpenAPI changes | `cd awcms-edge && npm run openapi:build && npm run openapi:validate && npm run openapi:diff` |

## Public Development Guardrails

### Content Rules

- render only published content
- exclude soft-deleted rows
- keep tenant filtering explicit
- do not assume global data unless the helper intentionally uses `tenant_id is null`

### Security Rules

- do not introduce secret-key usage into public code
- do not describe protected or session-bound media as public media
- do not weaken public Worker tenant/domain guardrails
- do not bypass RLS through browser-side privileged patterns

### UI And Theming Rules

- use semantic theme variables rather than hardcoded brand colors
- preserve the existing visual language of the target portal
- keep React islands purposeful; do not add unnecessary client-side interactivity

### Documentation And Contract Rules

If the change affects:

- public Worker route behavior
- public route parameters
- public media delivery semantics
- sitemap or public module/event feed behavior

then prompts and implementations should usually keep these in sync:

- `docs/dev/public.md`
- `docs/dev/edge-functions.md`
- `docs/architecture/edge-openapi-spec.md`
- `docs/dev/openapi-quality-checklist.md`
- `awcms-edge/src/lib/openapi/route-catalog.ts`

## Prompting Guidance For Public Work

Good public prompts should say:

- which public workspace is being changed
- whether the task is Astro-side, Worker-side, or both
- how tenant resolution is expected to work
- that content must remain published-only and non-deleted
- how validation should be run
- whether public Worker docs/OpenAPI metadata must also be updated

Example prompt framing:

```text
Working in `awcms-public/primary/` and `awcms-edge/`.
This is a public-facing tenant-scoped feature.
Keep rendering static-first where possible, preserve published-only and non-deleted filtering, and fail closed on tenant/domain mismatch if the public Worker route contract changes.
Follow the existing patterns in `awcms-public/primary/src/lib/content.ts`, `docs/dev/public.md`, and `docs/dev/edge-functions.md`.
Done when Astro checks pass, edge tests/typecheck pass if touched, and public route docs/OpenAPI metadata stay aligned.
```

## Related Docs

- [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md)
- [AGENTS.md](../../AGENTS.md)
- [docs/architecture/runtime-boundaries.md](../architecture/runtime-boundaries.md)
- [docs/dev/edge-functions.md](edge-functions.md)
- [docs/architecture/edge-openapi-spec.md](../architecture/edge-openapi-spec.md)
- [docs/dev/openapi-quality-checklist.md](openapi-quality-checklist.md)
- [docs/tenancy/smandapbun.md](../tenancy/smandapbun.md)
- [docs/dev/admin-public-db-driven-checklist.md](admin-public-db-driven-checklist.md)
