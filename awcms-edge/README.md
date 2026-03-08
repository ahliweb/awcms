# AWCMS Edge

Cloudflare Worker edge service for AWCMS.

## Purpose

`awcms-edge/` is the primary edge HTTP layer for AWCMS. It handles Worker-side API routes,
R2-backed media flows, and other request/response orchestration that should not live in a custom Node server.

## Stack

- Cloudflare Workers
- Hono
- Wrangler
- `@supabase/supabase-js` (currently pinned in this workspace to `^2.45.0`)

## Commands

| Command | Description |
| --- | --- |
| `npm run dev` | Start Wrangler in default local dev mode |
| `npm run dev:local` | Start Wrangler on `127.0.0.1:8787` using `../awcms/.env.local` |
| `npm run deploy` | Deploy the Worker via Wrangler |
| `npm run typecheck` | Run `tsc --noEmit` |

## Local Development

```bash
cd awcms-edge
npm install
npm run dev:local
```

Notes:

- `dev:local` intentionally loads environment values from `awcms/.env.local`.
- Worker bindings and runtime configuration live in `wrangler.jsonc`.
- R2 is configured through the `STORAGE` bucket binding in `wrangler.jsonc`.

## Dependency Scope Note

Admin and public workspaces currently use `@supabase/supabase-js` `2.93.3`, while this Worker
workspace still pins `^2.45.0`. Treat `awcms-edge/package.json` as the source of truth for Worker-only
dependency alignment until that package is upgraded deliberately and validated.

## CI / Validation Reality

The current GitHub push/PR workflows now include a dedicated `typecheck-edge` job.
Run this locally before pushing Worker changes for parity:

```bash
cd awcms-edge
npm run typecheck
```

## References

- `../SYSTEM_MODEL.md`
- `../docs/dev/edge-functions.md`
- `../docs/dev/ci-cd.md`
- `./wrangler.jsonc`
