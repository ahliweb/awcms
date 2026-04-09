> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) -> [AGENTS.md](../../AGENTS.md) -> [README.md](../../README.md) -> [DOCS_INDEX.md](../../DOCS_INDEX.md)
>
> **Status:** Maintained
>
> **Last Refreshed:** 2026-04-09

# Mobile App Development

## Purpose

Describe the current mobile development model for `awcms-mobile/primary`: Flutter app boundaries, Supabase usage, tenant-aware data access, realtime/fallback behavior, and the current relationship between the mobile app and the maintained Worker/runtime architecture.

## Current Mobile Model

The mobile app is currently a Flutter client application that uses Supabase for client-authenticated access and current Flutter state-management patterns inside the mobile workspace.

Current important rules:

- the mobile app is a client, not a privileged backend
- the mobile app must not use `SUPABASE_SECRET_KEY`
- mobile data access must remain tenant-scoped where applicable
- Worker-backed flows should be used when the operation belongs to the maintained edge/runtime boundary

## Current Stack

- Flutter (`awcms-mobile/primary`)
- `supabase_flutter`
- current workspace state-management/runtime conventions
- secure local storage/session handling through the mobile stack

## Current Supabase Usage

The mobile app still uses a publishable-key Supabase client initialized on app startup.

Current important rule:

- initialize once at app startup and keep privileged logic out of the client

## Current Auth Model

Current mobile auth remains based on Supabase Auth session flows.

Representative current behavior:

- email/password sign-in
- optional helper auth flows where implemented
- current-session based tenant/user resolution
- session-aware gating of signed-in features

## Current Tenant Model

Current mobile reads should derive tenant context from trusted session/profile metadata, not arbitrary UI input.

Current important rules:

- tenant id should come from authenticated user metadata/profile state
- realtime and fallback fetches should preserve explicit tenant filters
- published/non-deleted filters still apply to public-facing content lists surfaced in mobile

## Current Realtime / Fallback Guidance

Current mobile content retrieval may use a realtime-first pattern with fallback fetch behavior.

Current practical rule:

- if realtime is used, keep a one-shot fallback for degraded connections instead of leaving the screen empty on stream failure

## Current Runtime Boundary Notes

- mobile should use direct Supabase client access for approved client data flows
- mobile should use Worker-backed routes for privileged or edge-owned behavior
- the maintained server-side HTTP runtime remains `awcms-edge/`, not a custom mobile backend

## Current Validation Guidance

| Surface | Validation |
| --- | --- |
| mobile workspace changes | `cd awcms-mobile/primary && flutter pub get && flutter analyze && flutter test` |
| maintained docs | `cd awcms && npm run docs:check` |
| Worker/runtime implications | `cd awcms-edge && npm test && npm run typecheck` when relevant |

## Related Docs

- [docs/tenancy/supabase.md](../tenancy/supabase.md)
- [docs/dev/api-usage.md](./api-usage.md)
- [docs/architecture/runtime-boundaries.md](../architecture/runtime-boundaries.md)
