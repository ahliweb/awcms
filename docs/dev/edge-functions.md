> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) -> [AGENTS.md](../../AGENTS.md) -> [README.md](../../README.md) -> [DOCS_INDEX.md](../../DOCS_INDEX.md)
>
> **Status:** Maintained
>
> **Last Refreshed:** 2026-04-09

# Cloudflare Edge API

## Purpose

Document the maintained edge runtime for AWCMS: Cloudflare Workers in `awcms-edge/` as the only supported server-side HTTP/API runtime for privileged orchestration, public compatibility routes, R2-backed media flows, queue processing, and generated API documentation surfaces.

This guide is intentionally current-state focused and should be read together with:

- [docs/architecture/runtime-boundaries.md](../architecture/runtime-boundaries.md)
- [docs/architecture/edge-openapi-spec.md](../architecture/edge-openapi-spec.md)
- [docs/dev/openapi-quality-checklist.md](openapi-quality-checklist.md)

## Current Edge Runtime Model

- Cloudflare Workers in `awcms-edge/` are the maintained edge HTTP gateway.
- Client applications may continue to use Supabase Auth sessions, but protected server-side workflows should execute through Worker routes.
- Supabase remains authoritative for Auth, PostgreSQL, RLS, and ABAC.
- Cloudflare R2 is the maintained object storage layer for file/media delivery.
- Cloudflare Queues are the maintained async offload layer.
- Supabase Edge Functions are not part of the maintained runtime or repo layout.
- OpenAPI artifacts for public/admin/internal surfaces are generated from the Worker route catalog.

## Current Runtime Coverage

The Worker currently covers maintained surfaces such as:

- media upload/session/finalize/access/public delivery
- site rebuild and email fan-out queue paths
- dead-letter capture and replay
- Turnstile verification
- client IP lookup
- user-management compatibility flows
- Mailketing integration flows
- content-transform helper routes
- sitemap/public compatibility routes
- extension public compatibility routes
- import/materialization routes including `tenant-imports`

Compatibility routes continue to use `/functions/v1/<name>` so existing clients can target the Worker runtime without relying on Supabase-hosted Edge Functions.

## Current Public Route Guardrails

Public Worker routes now have explicit, documented guardrails.

### Tenant / Domain Guardrails

- Public tenant-aware routes may resolve tenant identity from `tenantId`, `tenant_id`, or `domain`, depending on the route.
- When both tenant and domain inputs are supplied, they must resolve to the same tenant.
- Mismatch is an explicit request failure (`400 Tenant/domain mismatch`).
- Public compatibility routes such as `/functions/v1/extensions/events/public` and `/functions/v1/extensions/public-modules` support `domain` as an alternative to tenant id inputs.
- `/public/sitemap` fails closed on missing or mismatched tenant context.

### Public Media Guardrails

- `/public/media/*` serves only canonical tenant-prefixed public object keys shaped like `tenants/<tenant_id>/...`.
- The route rejects malformed keys.
- The route rejects traversal-like segments.
- The route rejects the reserved protected namespace `tenants/<tenant_id>/protected/...`.
- Public media delivery should be documented as a guarded Worker contract, not as arbitrary object access.

### Mailketing Guardrails

- `mailketing` `send` is no longer an anonymous compatibility action.
- `send` requires bearer auth.
- `send` requires tenant context consistent with the authenticated user’s scope.
- notification send/manage permission boundaries still apply.

## Local Development

Run from the Worker workspace:

```bash
cd awcms-edge
npm install
cp .dev.vars.example .dev.vars
npm run dev:local
```

Current local-dev notes:

- `dev:local` loads local secrets from `awcms-edge/.dev.vars`
- Worker bindings and runtime settings live in `awcms-edge/wrangler.jsonc`
- local validation should exercise Worker routes directly
- local `wrangler dev` storage is isolated from remote R2 by default
- production secrets belong in Cloudflare via `npx wrangler secret put <SECRET_NAME>`

## Operational Commands

Run from `awcms-edge/`:

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start Wrangler in default local dev mode |
| `npm run dev:local` | Start the Worker on `127.0.0.1:8787` |
| `npm run typecheck` | Validate the Worker TypeScript surface |
| `npm test` | Run route/spec/import regression tests |
| `npm run openapi:build` | Regenerate public/admin/internal OpenAPI artifacts |
| `npm run openapi:validate` | Validate generated OpenAPI artifacts |
| `npm run openapi:diff` | Check generated artifact sync state |
| `npm run deploy` | Deploy the Worker |
| `npm run sync:r2:remote` | Reconcile local tenant media into remote R2 plus metadata |
| `npm run sync:r2:local` | Pull remote tenant media into local Worker storage plus metadata |
| `npm run sync:r2:cleanup-local` | Remove/soft-delete local duplicate media after exact-key import |
| `npm run sync:r2:cleanup-remote` | Remove/soft-delete remote duplicate media |

## Preferred Route Implementation Pattern

For new or modified Worker routes, current preferred order is:

1. authenticate early for protected routes
2. parse and validate request shape before writes or sensitive reads
3. resolve tenant and permission context explicitly
4. perform database/storage/integration work
5. normalize success and error responses
6. update OpenAPI metadata when the route is part of a documented surface
7. update edge/runtime docs when the documented route contract changed

## Middleware And Shared Helpers

Current reusable middleware in `awcms-edge/src/middleware/` includes:

- `auth/require-session.ts`
- `auth/require-permission.ts`
- `auth/require-platform-scope.ts`
- `docs/require-docs-access.ts`

Current shared runtime helpers also include route-level validation/tenant-resolution patterns inside `awcms-edge/src/index.ts` and related libs.

## OpenAPI And Documented Surface Rules

If a documented Worker route changes, the change may need to update:

- `awcms-edge/src/lib/openapi/route-catalog.ts`
- generated artifacts in `awcms-edge/openapi/*.json`
- [docs/architecture/edge-openapi-spec.md](../architecture/edge-openapi-spec.md)
- [docs/dev/openapi-quality-checklist.md](openapi-quality-checklist.md)
- this document when the runtime contract or trust boundary changed

Important current rule:

- public/admin specs must describe runtime reality, not aspirational behavior

## Validation And Error Rules

- Do not let request bodies flow into writes without shape validation.
- Reflect critical database constraints in edge validation for user-controlled fields.
- Return normalized `400`, `401`, `403`, and `404` responses where applicable.
- Avoid surfacing raw database errors directly unless intentionally normalized.
- Keep reusable validation logic shared when multiple routes depend on the same trust boundary.

## Review Expectations For Edge Changes

For Worker changes, reviewers should confirm:

- validation runs before writes or sensitive reads
- auth middleware or equivalent auth checks are used where appropriate
- permission checks remain additive guardrails and do not replace Supabase authority
- public route guardrails remain explicit
- public media restrictions remain intact where applicable
- route catalog/docs/artifacts are updated when the route is on a documented surface
- negative-path verification includes malformed input and auth/permission failures

## R2 Reconciliation Model

- Local and remote R2 are intentionally separate surfaces.
- `sync:r2:remote` reads local `media_objects`, downloads the authoritative file through the local Worker, uploads the same `storage_key` to remote R2, then upserts remote metadata.
- `sync:r2:local` reads remote `media_objects`, downloads the authoritative file from remote R2, then imports the exact object and metadata into the local Worker/runtime.
- `sync:r2:cleanup-local` and `sync:r2:cleanup-remote` enforce the current duplicate rule for the same `tenant_id + file_name`.
- Reverse-sync exact-key import is handled by local-only reconciliation routes.

## Validation Checklist

- Worker routes resolve from the configured edge URL.
- Protected routes validate Supabase Auth context before protected work.
- Public tenant-aware routes reject missing tenant context where required.
- Public tenant-aware routes reject mismatched tenant/domain combinations.
- Privileged operations use `SUPABASE_SECRET_KEY` only in approved Worker code.
- Media flows use Cloudflare R2 and `media_objects` / `media_upload_sessions` metadata.
- Public media delivery accepts only canonical public storage keys and never serves protected/session-bound paths through `/public/media/*`.
- queue consumers re-read authoritative state from Supabase before writing side effects.
- generated OpenAPI artifacts remain in sync when route metadata changed.

## Troubleshooting

- `Missing VITE_EDGE_URL`: configure the Worker URL for the calling workspace.
- `401 Unauthorized`: verify the caller has a valid Supabase session and forwards the bearer token.
- `403 Forbidden`: verify ABAC grants and role flags in Supabase.
- `400 Tenant/domain mismatch`: verify the supplied tenant and domain resolve to the same tenant.
- `400 Invalid public storage key`: verify the requested public media key uses a canonical public path and does not target `/protected/` or traversal segments.
- `5xx` from media routes: verify R2 bindings and required Worker env values.
- `sync:r2:local` failures: verify `.dev.vars`, remote env files, local Worker availability, and auth in both environments.
- local media exists but remote does not: local `wrangler dev` storage is isolated by default; use the explicit sync commands.

## Related Docs

- [docs/deploy/overview.md](../deploy/overview.md)
- [docs/deploy/cloudflare.md](../deploy/cloudflare.md)
- [docs/tenancy/supabase.md](../tenancy/supabase.md)
- [docs/dev/api-usage.md](api-usage.md)
- [docs/architecture/runtime-boundaries.md](../architecture/runtime-boundaries.md)
- [docs/architecture/edge-openapi-spec.md](../architecture/edge-openapi-spec.md)
- [docs/dev/openapi-quality-checklist.md](openapi-quality-checklist.md)
- [docs/dev/review-checklist.md](review-checklist.md)
- [docs/architecture/queue-topology.md](../architecture/queue-topology.md)
