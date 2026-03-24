# AWCMS Edge

Cloudflare Worker edge service for AWCMS.

## Purpose

`awcms-edge/` is the primary edge HTTP layer for AWCMS. It handles Worker-side API routes,
R2-backed media flows, and other request/response orchestration that should not live in a custom Node server.

## Stack

- Cloudflare Workers
- Hono
- Wrangler
- `@supabase/supabase-js` `^2.99.3`

## Commands

| Command | Description |
| --- | --- |
| `npm run dev` | Start Wrangler in default local dev mode |
| `npm run dev:local` | Start Wrangler on `127.0.0.1:8787` using `awcms-edge/.dev.vars` |
| `npm run deploy` | Deploy the Worker via Wrangler |
| `npm run typecheck` | Run `tsc --noEmit` |

## Local Development

```bash
cd awcms-edge
npm install
npm run dev:local
```

Notes:

- Copy `awcms-edge/.dev.vars.example` to `awcms-edge/.dev.vars` for local Worker secrets.
- Worker bindings and runtime configuration live in `wrangler.jsonc`.
- R2 is configured through the `STORAGE` bucket binding in `wrangler.jsonc`.
- Local `wrangler dev` R2 writes stay in `.wrangler/state/` by default and do not sync to remote Cloudflare R2 automatically.
- Use `npm run sync:r2:remote` when you need to reconcile local tenant media into the remote `awcms-s3` bucket and remote `media_objects` rows.
- Use `npm run sync:r2:local` when you need to pull remote tenant media back into the local Worker/R2 simulation and local `media_objects` rows.
- Use `npm run sync:r2:cleanup-local` after an older non-exact local import flow to soft-delete duplicate local rows and remove duplicate local R2 objects once exact-key rows exist.
- Use `npm run sync:r2:cleanup-remote` if remote still contains generated duplicate keys for the same tenant/file and you want to keep only the canonical exact-key copy.
- Production secrets should be uploaded with `wrangler secret put <NAME>` rather than committed config files.

## Dependency Scope Note

`awcms/`, `awcms-public/primary/`, `awcms-public/smandapbun/`, and `awcms-edge/` now align on
`@supabase/supabase-js` `^2.99.3`. Treat `awcms-edge/package.json` as the source of truth for
Worker-only dependency alignment if the Worker runtime needs to diverge again in the future.

## CI / Validation Reality

The current GitHub push/PR workflows now include a dedicated `typecheck-edge` job.
Run this locally before pushing Worker changes for parity:

```bash
cd awcms-edge
npm run typecheck
```

Local runtime verification is still manual:

```bash
cd awcms-edge
npm run dev:local
curl http://127.0.0.1:8787/health
```

## References

- `../SYSTEM_MODEL.md`
- `../docs/dev/edge-functions.md`
- `../docs/dev/ci-cd.md`
- `./wrangler.jsonc`

## Public Rebuild Webhook

`awcms-edge` also hosts rebuild endpoints for the SMANDAPBUN public portal:

- Authenticated route used by the Admin panel: `/api/public/rebuild`
- Optional secret-based route for database-trigger/webhook setups: `/webhooks/public-rebuild/smandapbun`
- Expected header: `x-awcms-rebuild-secret`
- Required Worker secrets:
  - `SMANDAPBUN_REBUILD_WEBHOOK_SECRET`
  - `GITHUB_REBUILD_TOKEN`
  - `GITHUB_REBUILD_OWNER`
  - `GITHUB_REBUILD_REPO`
  - optional `GITHUB_REBUILD_EVENT_TYPE`

The authenticated Admin route resolves the tenant's configured deploy hook from Supabase settings and triggers the
Cloudflare Pages project rebuild directly.
