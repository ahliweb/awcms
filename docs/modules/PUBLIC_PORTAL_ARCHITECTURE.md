> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) -> [AGENTS.md](../../AGENTS.md) -> [README.md](../../README.md) -> [DOCS_INDEX.md](../../DOCS_INDEX.md)
>
> **Status:** Maintained
>
> **Last Refreshed:** 2026-04-09

# Public Portal Architecture

## Purpose

Describe the current public portal architecture for AWCMS: static-first Astro rendering, tenant-scoped content resolution, public Worker compatibility routes, sanitization rules, and the relationship between `awcms-public/*` and `awcms-edge/`.

## Current Public Architecture Model

Current public delivery is split across:

- Astro-based public portal workspaces in `awcms-public/`
- build-time tenant resolution for canonical static builds
- public Supabase client reads for published/non-deleted tenant content
- Worker-backed compatibility routes for selected public runtime behavior

Current important rule:

- the maintained public model is static-first, not request-time SSR by default

## Current Core Stack

- Astro 6.0.8
- React 19.2.4 islands
- TypeScript / TSX
- Supabase JS for approved public data access
- Worker-backed public compatibility routes where server-side mediation is needed

## Current Workspace Model

### `awcms-public/primary/`

This remains the main public reference implementation.

Typical current responsibilities:

- locale-aware public routes
- page/blog content rendering
- widget rendering
- search/sitemap helpers
- shared public content-fetching patterns

### `awcms-public/smandapbun/`

This remains a dedicated/specialized public portal variant and should not be assumed to follow `primary` internals exactly.

## Current Tenant Resolution Model

### Static Builds

Canonical tenant resolution for static builds uses build-time env values such as:

- `PUBLIC_TENANT_ID`
- `VITE_PUBLIC_TENANT_ID`
- `VITE_TENANT_ID`

Current important rule:

- canonical static builds should fail closed when tenant identity is missing for tenant-specific output

### Public Worker Routes

Some public-compatible runtime routes now support guarded tenant resolution via:

- `tenantId`
- `tenant_id`
- `domain`

When both tenant and domain inputs are supplied, they must resolve to the same tenant.

## Current Rendering Model

- pages render statically where possible
- interactivity is added through React islands only where needed
- Puck content is rendered through the public render-only path
- TipTap editor runtime is not used on the public portal

## Current Rendering Components And Helpers

Current important public surfaces include:

- `PuckRenderer`
- widget renderers and widget-area blocks
- content/search/sitemap helpers in `awcms-public/primary/src/lib/`
- public env/client helpers in the public workspaces/shared package

## Current Security And Content Rules

- public content must remain published-only
- public content must remain non-deleted
- tenant scope must remain explicit where applicable
- raw HTML rendering must continue through the current sanitization path
- unknown/unregistered render blocks should not render freely in the public portal

## Current Public Worker / Compatibility Rules

Public portal work now intersects more directly with Worker route contracts than older docs implied.

Current examples include:

- `/public/sitemap`
- `/public/media/*`
- public extension compatibility routes
- Turnstile verification and other edge-mediated public flows

Current important rules:

- public Worker routes must preserve tenant/domain mismatch guardrails
- public media routes only accept canonical public storage keys
- protected/session-bound media is not part of the public object namespace

## Current Route Notes

Current public routing includes locale-aware pages and blog routes plus portal-specific helper routes where implemented.

Rather than depending on an old static list alone, verify the current `src/pages/` tree in the targeted public workspace before documenting a route as canonical.

## Current Implementation Guidance

- use the current env-driven client helpers for public reads
- keep tenant filtering explicit
- keep published/deleted filters explicit
- use `PuckRenderer`/render-only Puck paths for visual content
- update edge/OpenAPI docs when public Worker contracts change

## Current Operational Notes

- Cloudflare Pages remains the expected deployment target for the static public portals
- build-time env configuration must be present for the target tenant/public workspace
- root-path behavior may redirect to a locale or other canonical path depending on the current workspace implementation

## Validation Guidance

| Surface | Validation |
| --- | --- |
| public primary changes | `cd awcms-public/primary && npm run check:astro` |
| public Worker contract changes | `cd awcms-edge && npm test && npm run typecheck` |
| documented public route metadata changes | `cd awcms-edge && npm run openapi:build && npm run openapi:validate && npm run openapi:diff` when relevant |
| maintained docs | `cd awcms && npm run docs:check` |

## Related Docs

- [docs/dev/public.md](../dev/public.md)
- [docs/tenancy/overview.md](../tenancy/overview.md)
- [docs/tenancy/supabase.md](../tenancy/supabase.md)
- [docs/dev/edge-functions.md](../dev/edge-functions.md)
- [../../awcms-public/primary/README.md](../../awcms-public/primary/README.md)
