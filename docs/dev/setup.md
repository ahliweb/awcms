> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) Section 1 (Tech Stack)

# Developer Setup Guide

## 1. Prerequisites

- [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) - **Primary authority** for technology stack and version requirements
- [AGENTS.md](../../AGENTS.md) - Implementation patterns and Context7 references
- **Node.js**: v22.12.0 or higher (required by current Admin/Public toolchain)
- **npm**: v10+
- **Flutter**: v3.38.5+ (if working on mobile)
- **PlatformIO**: Core 6.1+ (if working on IoT)
- **Supabase CLI**: v2.70+ (install globally or use `npx supabase`)

## 2. Quick Start (Monorepo)

### 2.1 Clone the Repository

```bash
git clone <repository_url>
cd <repo-root>
```

### 2.2 Setup Environment Variables

Refer to `.env.example` in each directory. Public portal static builds require `PUBLIC_TENANT_ID` (or `VITE_PUBLIC_TENANT_ID`).

When syncing linked/remote schema snapshots, prefer:

```sh
npx supabase migration list --linked
npx supabase db pull --schema public,extensions
```

This avoids storage-managed objects that can churn migrations in local shadow databases.

For local schema changes, run:

```sh
npx supabase migration list --local
npx supabase db push --local
```

Validate root/mirror Supabase parity before opening a PR:

```sh
scripts/verify_supabase_migration_consistency.sh
```

If migration history drifts, use the repair helper from repo root:

```sh
scripts/repair_supabase_migration_history.sh
scripts/repair_supabase_migration_history.sh --apply --local
scripts/repair_supabase_migration_history.sh --apply --linked
```

If using Context7 tools via `awcms-mcp`, set `CONTEXT7_API_KEY` in `awcms/.env`.

### 2.3 Install Dependencies

We typically use `npm` for web projects and `flutter pub` for mobile.

```bash
# Admin Panel
cd awcms
npm install

# Public Portal (Primary Tenant)
cd ../awcms-public/primary
npm install

# Edge Worker
cd ../../awcms-edge
npm install

# MCP Server
cd ../awcms-mcp
npm install
```

## 3. Running Locally

| Service | Command | Directory | Port |
| --- | --- | --- | --- |
| Admin Panel | `npm run dev` | `awcms/` | `3000` |
| Public Portal | `npm run dev` | `awcms-public/primary/` | `4321` |
| Edge Worker | `npm run dev:local` | `awcms-edge/` | `8787` |
| MCP Server | `npm run dev` | `awcms-mcp/` | stdio / MCP runtime |
| Mobile App | `flutter run` | `awcms-mobile/primary/` | Device/Emu |
| IoT Firmware | `pio run -t upload` | `awcms-esp32/primary/` | Serial |

### 3.1 Local Supabase Bootstrap (Admin)

Local admin development expects a tenant to resolve on `localhost`. The default dev slug is `primary` via `VITE_DEV_TENANT_SLUG`, so make sure the tenant exists before signing in.

```bash
# Start local Supabase
npx supabase start

# Seed the primary tenant (required for localhost)
node awcms/src/scripts/seed-primary-tenant.js

# Create or reset the default admin user
node awcms/src/scripts/create-admin-user.js

# Optional: grant owner role and seed menus/modules
node awcms/src/scripts/assign-owner-role.js
node awcms/src/scripts/seed-sidebar.js
```

`seed-sidebar.js` requires `VITE_SUPABASE_URL` and `SUPABASE_SECRET_KEY` in `awcms/.env.local`. Never expose the secret key in client code.

### 3.2 MCP Tooling (OpenCode)

Use `mcp.json` as the repo source of truth for MCP topology.

```bash
# Optional: run local AWCMS MCP server directly
cd awcms-mcp
npm install
npm run dev

# Verify connected MCP servers in OpenCode
opencode mcp list
```

GitHub MCP uses `scripts/start_github_mcp.sh` and requires one of: `GITHUB_PERSONAL_ACCESS_TOKEN`, `GITHUB_MCP_PERSONAL_ACCESS_TOKEN`, `GH_TOKEN`, or `GITHUB_TOKEN`.

### 3.3 Edge Worker Local Runtime

The Cloudflare Worker layer lives in `awcms-edge/` and is the primary edge HTTP runtime for AWCMS.

```bash
cd awcms-edge
npm install
npm run dev:local
```

Notes:

- `npm run dev:local` loads `../awcms/.env.local`.
- Worker bindings are defined in `awcms-edge/wrangler.jsonc`.
- The current Worker workspace pins `@supabase/supabase-js` separately from the admin/public workspaces; use `awcms-edge/package.json` as the source of truth before upgrading.

### 3.4 Operational Script Quick Reference

| Script | Purpose | Scope |
| --- | --- | --- |
| `scripts/repair_supabase_migration_history.sh` | Repair migration history states (`applied`/`reverted`) from local timestamps | Local (`--local`) and linked (`--linked`) |
| `scripts/verify_supabase_migration_consistency.sh` | Verify root/mirror migration parity and migration-list alignment | Local by default; add `--linked` for remote check |
| `scripts/check_markdown_local_links.mjs` | Validate maintained markdown links to local repository targets before external link checks run | Docs workflow and local docs validation |
| `scripts/start_github_mcp.sh` | Start local Docker-backed GitHub MCP with token auto-discovery | MCP runtime |
| `scripts/update_cloudflare_secrets.sh` | Interactive Cloudflare Pages secret sync from project `.env` files | Deployment ops |

### 3.5 Shared Package Note

`packages/awcms-shared/` is a maintained source-first TypeScript package used by the public portals.
It currently ships a standalone `npm run typecheck` script for direct validation, while runtime/build
coverage still happens through consuming workspaces such as `awcms-public/primary` and `awcms-public/smandapbun`.

```bash
cd packages/awcms-shared
npm install
npm run typecheck
```

## 4. Linting & Formatting

We check code quality in CI. Run these before pushing:

```bash
# Admin
cd awcms
npm run lint

# Public
cd ../awcms-public/primary
npm run check
```
