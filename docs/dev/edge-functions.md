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
- Production secrets belong in Cloudflare via `npx wrangler secret put <SECRET_NAME>`.

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
- Failed messages exhaust retries and route to the DLQ (`awcms-media-events-dlq` / `awcms-notifications-dlq`); the DLQ consumer persists entries to `queue_dead_letters` in Supabase.
- Platform admins can replay a dead-letter entry via `POST /api/admin/queue/replay`.

## Troubleshooting

- `Missing VITE_EDGE_URL`: configure the Worker URL for the client workspace.
- `401 Unauthorized`: verify the caller has a valid Supabase session and the Worker forwards the bearer token.
- `5xx` from media routes: check R2 bindings and required Worker env values.
- `403` from protected routes: verify the user's role flags and ABAC grants in Supabase.

## References

- `docs/deploy/overview.md`
- `docs/deploy/cloudflare.md`
- `docs/tenancy/supabase.md`
- `docs/architecture/queue-topology.md`
- `awcms-edge/README.md`
