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
- Supabase Edge Functions are not part of the maintained runtime or repo layout.

## Runtime Coverage

The Worker currently provides maintained routes for:

- media upload, finalize, access, and public delivery
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
npm run dev:local
```

Notes:

- `dev:local` loads env values from `../awcms/.env.local`.
- Worker bindings and runtime settings live in `awcms-edge/wrangler.jsonc`.
- Local validation should exercise Worker routes directly, not `supabase functions serve`.

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

## Troubleshooting

- `Missing VITE_EDGE_URL`: configure the Worker URL for the client workspace.
- `401 Unauthorized`: verify the caller has a valid Supabase session and the Worker forwards the bearer token.
- `5xx` from media routes: check R2 bindings and required Worker env values.
- `403` from protected routes: verify the user's role flags and ABAC grants in Supabase.

## References

- `docs/deploy/overview.md`
- `docs/deploy/cloudflare.md`
- `docs/tenancy/supabase.md`
- `awcms-edge/README.md`
