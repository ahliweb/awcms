> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) -> [AGENTS.md](../../AGENTS.md) -> [README.md](../../README.md) -> [DOCS_INDEX.md](../../DOCS_INDEX.md)
>
> **Status:** Maintained
>
> **Last Refreshed:** 2026-04-09

# Developer Setup Guide

## Purpose

Provide the current monorepo setup and local-development bootstrap path for AWCMS across admin, public, edge, MCP, mobile, and ESP32 workspaces.

## Current Prerequisites

- Node.js `>=24.14.1`
- npm `>=10`
- Flutter for mobile work
- PlatformIO for ESP32 work
- Supabase CLI for local/linked database workflows
- Docker when required by local GitHub MCP setup

## Current Monorepo Bootstrap

### 1. Clone

```bash
git clone <repository_url>
cd <repo-root>
```

### 2. Environment Setup

- use the relevant `.env.example` files
- public static builds require tenant envs such as `PUBLIC_TENANT_ID` or `VITE_PUBLIC_TENANT_ID`
- Worker local development requires `awcms-edge/.dev.vars`
- if using Context7 through `awcms-mcp`, set `CONTEXT7_API_KEY`

For the broader bootstrap path, also use:

- `docs/dev/environment-bootstrap.md`
- `python3 scripts/setup_awcms_environment.py`

### 3. Install Dependencies

Representative setup path:

```bash
cd awcms && npm install
cd ../awcms-public/primary && npm install
cd ../../awcms-edge && npm install
cd ../awcms-mcp && npm install
```

## Current Local Runtime Commands

| Service | Command | Directory |
| --- | --- | --- |
| Admin Panel | `npm run dev` | `awcms/` |
| Public Portal | `npm run dev` | `awcms-public/primary/` |
| Edge Worker | `npm run dev:local` | `awcms-edge/` |
| MCP Server | `npm run dev` | `awcms-mcp/` |
| Mobile App | `flutter run` | `awcms-mobile/primary/` |
| ESP32 Firmware | `pio run -t upload` | `awcms-esp32/primary/` |

## Current Local Supabase Bootstrap

For local admin development:

```bash
npx supabase start
node awcms/src/scripts/seed-primary-tenant.js
node awcms/src/scripts/create-admin-user.js
```

`seed-primary-tenant.js` seeds both the `primary` tenant and the local control-plane `localhost` mapping consumed by the current dev resolver.

`create-admin-user.js` provisions the local bootstrap user `cms@ahliweb.com` on tenant `primary` with the platform-scoped `owner` role and resets that local password when the user already exists.

Optional local bootstrap helpers may include owner-role or sidebar/module seed scripts where the local environment needs them.

## Current Migration Workflow Notes

Use the current local/linked Supabase workflow rather than older generic CLI assumptions.

Representative commands:

```bash
npx supabase migration list --local
npx supabase db push --local
npx supabase migration list --linked
npx supabase db pull --schema public,extensions
scripts/verify_supabase_migration_consistency.sh
```

If migration history drifts:

```bash
scripts/repair_supabase_migration_history.sh
scripts/repair_supabase_migration_history.sh --apply --local
scripts/repair_supabase_migration_history.sh --apply --linked
```

## Current Edge Worker Setup

```bash
cd awcms-edge
cp .dev.vars.example .dev.vars
npm run dev:local
```

Current important notes:

- local Worker secrets come from `.dev.vars`
- Worker bindings live in `wrangler.jsonc`
- local R2 state is isolated from remote by default
- use `sync:r2:*` commands only when reconciliation is needed

## Current MCP Setup Notes

- repo MCP topology is defined in `mcp.json`
- local `awcms-mcp` can be run directly if needed
- GitHub MCP requires Docker plus a valid token env

## Current Shared Package Note

`packages/awcms-shared/` is source-first and validated separately when touched.

Representative command:

```bash
cd packages/awcms-shared
npm install
npm run typecheck
```

## Current Validation Commands

Representative current validation commands:

```bash
cd awcms && npm run build
cd awcms && npm run docs:check
cd awcms-public/primary && npm run check:astro
cd awcms-edge && npm test && npm run typecheck
```

Use workspace-specific validation for mobile/ESP32/shared packages when those surfaces are touched.

## Related Docs

- [docs/dev/environment-bootstrap.md](./environment-bootstrap.md)
- [docs/dev/troubleshooting.md](./troubleshooting.md)
- [docs/dev/edge-functions.md](./edge-functions.md)
- [docs/architecture/runtime-boundaries.md](../architecture/runtime-boundaries.md)
