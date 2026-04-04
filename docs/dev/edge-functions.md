> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) Section 1.3 (Backend & Database)

# Cloudflare Edge API

## Purpose

Document the maintained edge runtime for AWCMS: Cloudflare Workers in `awcms-edge/` as the only supported server-side edge API layer.

## Audience

- Backend and integration developers
- Operators deploying Cloudflare Workers

## Prerequisites

- [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md)
- [AGENTS.md](../../AGENTS.md)
- `awcms-edge/` workspace dependencies installed

## Current Edge Runtime Model

- Cloudflare Workers in `awcms-edge/` are the maintained edge HTTP gateway.
- Client applications may keep using Supabase Auth sessions, but protected server-side workflows should execute through Worker routes.
- Supabase remains the authority for Auth, PostgreSQL, RLS, and ABAC.
- Cloudflare R2 is the maintained object storage layer for file/media delivery.
- Cloudflare Queues (`awcms-media-events`, `awcms-notifications`, `awcms-media-events-dlq`, `awcms-notifications-dlq`) are used to offload long-tail background work from the synchronous HTTP path. Queue consumers re-read authoritative state from Supabase before writing. See [docs/architecture/queue-topology.md](../architecture/queue-topology.md).
- Supabase Edge Functions are not part of the maintained runtime or repo layout.

## Runtime Coverage

The Worker currently provides maintained routes for:

- media upload, finalize (async via `awcms-media-events` queue), access, and public delivery
- site rebuild and email fan-out (async via `awcms-notifications` queue)
- dead letter queue processing (via `awcms-media-events-dlq` and `awcms-notifications-dlq` consumers)
- admin dead-letter replay (`POST /api/admin/queue/replay`)
- `verify-turnstile`
- `get-client-ip`
- `manage-users`
- `mailketing`
- `mailketing-webhook`
- `content-transform`
- `serve-sitemap`

Compatibility routes continue to use `/functions/v1/<name>` so existing clients can target the Worker API without depending on Supabase Edge Functions.

## Local Development

Run from the Worker workspace:

```bash
cd awcms-edge
npm install
cp .dev.vars.example .dev.vars
npm run dev:local
```

Notes:

- `dev:local` loads local secrets from `awcms-edge/.dev.vars`.
- Worker bindings and runtime settings live in `awcms-edge/wrangler.jsonc`.
- Local validation should exercise Worker routes directly. Supabase Edge Function tooling/config is not part of the supported runtime.
- Local `wrangler dev` uses the local `STORAGE` binding and `.wrangler/state/` by default; it does not read or mutate remote Cloudflare R2 automatically.
- Production secrets belong in Cloudflare via `npx wrangler secret put <SECRET_NAME>`.

## Operational Commands

Run from `awcms-edge/`:

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start Wrangler in default local dev mode |
| `npm run dev:local` | Start the Worker on `127.0.0.1:8787` |
| `npm run typecheck` | Validate the Worker TypeScript surface |
| `npm run deploy` | Deploy the Worker |
| `npm run sync:r2:remote` | Reconcile local tenant media into remote R2 plus remote `media_objects` metadata |
| `npm run sync:r2:local` | Pull remote tenant media back into local Worker storage plus local `media_objects` metadata |
| `npm run sync:r2:cleanup-local` | Soft-delete duplicate local metadata rows and remove duplicate local objects after exact-key import |
| `npm run sync:r2:cleanup-remote` | Soft-delete duplicate remote metadata rows and remove duplicate remote objects |

## Preferred Route Implementation Pattern

For new or modified Worker routes, prefer this sequence:

1. authenticate the caller early for protected routes
2. parse and validate request shape before database writes or sensitive reads
3. resolve tenant and permission context explicitly
4. perform database or storage work
5. normalize user-facing success and error responses
6. add or update OpenAPI docs when the route is part of a documented surface

Current reusable middleware already available in `awcms-edge/src/middleware/` includes:

- `auth/require-session.ts`
- `auth/require-permission.ts`
- `auth/require-platform-scope.ts`
- `docs/require-docs-access.ts`

## Validation And Error Rules

- Do not let request bodies flow into writes without shape validation.
- Reflect critical database constraints in edge validation for user-controlled fields.
- Return normalized `400`, `401`, `403`, and `404` responses where applicable.
- Avoid returning raw database error text directly to end users unless it has been intentionally normalized.
- Keep validation logic shared where it is reused across routes instead of copying request checks into every handler.

## Review Expectations For Edge Changes

For Worker route changes, reviewers should confirm:

- validation runs before writes or sensitive reads
- auth middleware is used where appropriate
- permission checks remain additive guardrails and do not replace Supabase authority
- OpenAPI artifacts and docs are updated when the route is on a documented runtime surface
- negative-path verification includes malformed input and auth failures

## R2 Reconciliation Model

- Local and remote R2 are intentionally separate surfaces.
- `sync:r2:remote` reads local `media_objects`, downloads the authoritative file through the local Worker, uploads the same `storage_key` to remote R2, then upserts the remote metadata row.
- `sync:r2:local` reads remote `media_objects`, downloads the authoritative file from remote R2, then imports the exact object and metadata into the local Worker/runtime.
- `sync:r2:cleanup-local` and `sync:r2:cleanup-remote` enforce the current canonical duplicate rule: for the same `tenant_id + file_name`, keep the lexicographically smallest `storage_key` and soft-delete/remove the other copies.
- Reverse-sync exact-key import is handled by the local-only Worker route `POST /api/media/import-local`.
- Local duplicate cleanup is handled by the local-only Worker route `POST /api/media/cleanup-local-duplicates`.

## Deployment

```bash
cd awcms-edge
npm run typecheck
npm run deploy
```

## Validation Checklist

- Worker routes respond from the configured `VITE_EDGE_URL` / `PUBLIC_EDGE_URL`.
- Worker routes validate Supabase Auth context before protected operations.
- Privileged operations use `SUPABASE_SECRET_KEY` only inside approved Worker code.
- Media flows use Cloudflare R2 and `media_objects` / `media_upload_sessions` metadata tables.
- Finalize route returns `202 Accepted` and a `job_id`; finalization completes asynchronously via the `awcms-media-events` queue consumer.
- Queue consumer does not trust message payload as authoritative; it re-reads from Supabase before writing.
- Notifications consumer handles `site.rebuild.requested` and `email.send.requested` events from `awcms-notifications` queue.
- Notifications infrastructure is backed by `tenant_notification_channels`, `notification_templates`, and `notification_dispatches`; tenants manage channel/template configuration through RLS, while the Worker queue path records dispatch outcomes.
- Failed messages exhaust retries and route to the DLQ (`awcms-media-events-dlq` / `awcms-notifications-dlq`); the DLQ consumer persists entries to `queue_dead_letters` in Supabase.
- Platform admins can replay a dead-letter entry via `POST /api/admin/queue/replay`.
- Local-only reconciliation routes reject non-local mode (`R2_ACCOUNT_ID !== local-dev`) and are not part of the deployed production API surface.

## Troubleshooting

- `Missing VITE_EDGE_URL`: configure the Worker URL for the client workspace.
- `401 Unauthorized`: verify the caller has a valid Supabase session and the Worker forwards the bearer token.
- `5xx` from media routes: check R2 bindings and required Worker env values.
- `403` from protected routes: verify the user's role flags and ABAC grants in Supabase.
- Stale storage helper behavior: if an older caller still invokes `sync_storage_files()`, it now returns a deprecation payload because maintained media flows use Cloudflare R2 plus `public.media_objects`.
- `sync:r2:local` fails: verify `awcms-edge/.dev.vars` and `awcms/.env.remote` both exist, the local Worker is running on `127.0.0.1:8787`, and the sync user can authenticate in both environments.
- Local media exists but remote does not: `wrangler dev` storage is isolated by default; run `npm run sync:r2:remote` explicitly.

## References

- `docs/deploy/overview.md`
- `docs/deploy/cloudflare.md`
- `docs/tenancy/supabase.md`
- `docs/dev/openapi-quality-checklist.md`
- `docs/dev/review-checklist.md`
- `docs/architecture/queue-topology.md`
- `awcms-edge/README.md`
