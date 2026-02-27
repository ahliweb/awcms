# AWCMS Monorepo

Welcome to the AWCMS monorepo. AWCMS is a **multi-tenant CMS platform** with admin, public, mobile, and IoT clients backed by Supabase.

## Status Snapshot (2026-02-27)

- Active Node runtime validated: `v22.22.0` (minimum remains `>=22.12.0`).
- Stitch import flow is tenant-configurable (`settings.key = 'stitch_import'`) with sanitized HTML fallback support.
- MCP topology includes Context7, Supabase, Stitch, Cloudflare managed servers, and GitHub MCP.
- Supabase migration repair workflow is scripted via `scripts/repair_supabase_migration_history.sh`.

## Documentation Authority

This repository follows a strict documentation hierarchy aligned with the **Context7 MCP** (Model Context Protocol):

1. **[SYSTEM_MODEL.md](SYSTEM_MODEL.md)** - **Single Source of Truth**: stack versions, architecture constraints, security mandates
2. **[AGENTS.md](AGENTS.md)** - agent execution rules, Context7 references, implementation patterns
3. **[README.md](README.md)** - canonical monorepo entrypoint and operational overview
4. **[DOCS_INDEX.md](DOCS_INDEX.md)** - canonical documentation map and topic routing
5. **Implementation Guides** - specific how-to documentation in `docs/`

> **For AI Agents**: Always follow `AGENTS.md` and `SYSTEM_MODEL.md` as primary authorities.

## Project Structure

| Directory | Description | Tech Stack |
| --- | --- | --- |
| `awcms/` | Admin Panel | React 19.2.4, Vite 7.2.7, Supabase |
| `awcms-public/primary/` | Public Portal | Astro 5.17.1 (static), React 19.2.4 |
| `awcms-mobile/primary/` | Mobile App | Flutter 3.38.5 |
| `awcms-esp32/primary/` | IoT Firmware | ESP32, PlatformIO |
| `awcms-ext/` | External Extensions | JavaScript modules |
| `supabase/` | Migrations and Edge Functions | Supabase CLI |
| `awcms-mcp/` | MCP Integration | Model Context Protocol tools |
| `openclaw/` | AI Gateway | OpenClaw multi-tenant AI routing |

## Current Stack Versions (Core)

- **React**: 19.2.4 (Admin + Public)
- **Vite**: 7.2.7 (Admin)
- **Astro**: 5.17.1 (Public) - *Requires Node.js >=22.12.0*
- **TailwindCSS**: 4.1.18
- **Supabase JS**: 2.93.3 (Admin + Public)
- **React Router DOM**: 7.10.1
- **TipTap**: 3.13.0
- **Puck**: 0.21.0
- **OpenClaw**: 2026.2.21-2 (AI Gateway)
- **Node.js**: >= 22.12.0 (managed via nvm)

## Quick Start

### For Developers

1. Read **[SYSTEM_MODEL.md](SYSTEM_MODEL.md)** - Understand the architecture (5 min)
2. Follow **[Developer Setup Guide](docs/dev/setup.md)** - Get running (10 min)
3. Reference **[AGENTS.md](AGENTS.md)** - Coding standards and patterns

### Per-Component Guides

- **Admin Panel**: [Guide](docs/dev/admin.md)
- **Public Portal**: [Guide](docs/dev/public.md)
- **Mobile App**: [Guide](docs/dev/mobile.md)
- **IoT Firmware**: [Guide](docs/dev/esp32.md)

## Documentation

- **[SYSTEM_MODEL.md](SYSTEM_MODEL.md)**: Authoritative system architecture and tech stack
- **[AGENTS.md](AGENTS.md)**: AI agent guidelines and coding standards
- **[DOCS_INDEX.md](DOCS_INDEX.md)**: Central navigation for all documentation
- **[docs/README.md](docs/README.md)**: Detailed wiki and concepts
- **[docs/dev/documentation-audit-plan.md](docs/dev/documentation-audit-plan.md)**: Context7-driven doc audit workflow
- **[docs/dev/documentation-audit-tracker.md](docs/dev/documentation-audit-tracker.md)**: Phase progress, drift register, and reconciliation backlog

## Database & Migrations

- Canonical timestamped migrations live in `supabase/migrations/` and are mirrored in `awcms/supabase/migrations/` for CI/Admin tooling compatibility.
- Non-migration SQL files must be kept outside migration folders (for example `supabase/manual/`).
- Local workflow:
  - `npx supabase migration list --local`
  - `npx supabase db push --local`
- Linked/remote workflow:
  - `npx supabase migration list --linked`
  - `npx supabase db push --linked`
- If migration history is out of sync, use `scripts/repair_supabase_migration_history.sh` (dry-run by default, `--apply` to execute).
- Validate migration health after apply/repair with `scripts/verify_supabase_migration_consistency.sh` (`--linked` for remote checks).

## Context7 MCP Integration

This repository uses Context7 for AI-assisted development. Key library IDs:

- `supabase/supabase-js` - Database operations
- `vitejs/vite` - Build tooling  
- `withastro/astro` - Public portal framework
- See [AGENTS.md](AGENTS.md) for complete list

## MCP Topology (OpenCode)

- Repo config: `mcp.json`
- Runtime client config: `~/.config/opencode/opencode.json`
- Active servers:
  - Context7: `https://mcp.context7.com/mcp`
  - Supabase (local): `node awcms-mcp/dist/index.js`
  - Stitch (local): `npx @_davideast/stitch-mcp proxy`
  - Cloudflare (remote): api/docs/bindings/observability/builds/radar/browser endpoints
  - GitHub (local): `scripts/start_github_mcp.sh` (Docker-based `github/github-mcp-server`)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

See [LICENSE](LICENSE).
