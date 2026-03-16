# AWCMS Ecosystem

Welcome to the AWCMS Ecosystem. AWCMS is a **multi-tenant CMS platform** with admin, public, mobile, and IoT clients backed by Supabase.

## Status Snapshot (2026-03-14)

- Active Node runtime validated: `v22.22.0` (minimum remains `>=22.12.0`).
- The active documentation and repository-conflict audit cycle is tracked in `docs/dev/documentation-audit-plan.md` and `docs/dev/documentation-audit-tracker.md`.
- Public portal runtime has moved to Astro 6 while Cloudflare Workers remain the primary edge HTTP layer.
- MCP topology from `mcp.json` currently includes `cloudflare`, `context7`, `github`, `supabase`, and `paper`.
- Repository inventory currently shows `144` tracked Markdown files, `76` docs files, and `139` root/mirrored Supabase migrations.
- `scripts/verify_supabase_migration_consistency.sh` now passes after restoring root/mirror migration parity.

## Documentation Authority

This repository follows a strict documentation hierarchy aligned with the **Context7 MCP** (Model Context Protocol):

1. **[SYSTEM_MODEL.md](SYSTEM_MODEL.md)** - **Single Source of Truth**: stack versions, architecture constraints, security mandates
2. **[AGENTS.md](AGENTS.md)** - agent execution rules, Context7 references, implementation patterns
3. **[README.md](README.md)** - canonical AWCMS Ecosystem entrypoint and operational overview
4. **[DOCS_INDEX.md](DOCS_INDEX.md)** - canonical documentation map and topic routing
5. **Implementation Guides** - specific how-to documentation in `docs/`

> **For AI Agents**: Always follow `AGENTS.md` and `SYSTEM_MODEL.md` as primary authorities.

## Project Structure

| Directory | Description | Tech Stack |
| --- | --- | --- |
| `awcms/` | Admin Panel | React 19.2.4, Vite 7.3.1, Supabase |
| `awcms-public/primary/` | Public Portal | Astro 6.0.4 (static), React 19.2.4 |
| `awcms-mobile/primary/` | Mobile App | Flutter 3.38.5 |
| `awcms-esp32/primary/` | IoT Firmware | ESP32, PlatformIO |
| `awcms-ext/` | External Extensions | JavaScript modules |
| `awcms-edge/` | Worker API & Edge Logic | Cloudflare Workers, Hono |
| `packages/awcms-shared/` | Shared public-portal utilities | TypeScript helpers |
| `supabase/` | Migrations and local Supabase project config | Supabase CLI |
| `awcms-mcp/` | MCP Integration | Model Context Protocol tools |
| `openclaw/` | AI Gateway | OpenClaw multi-tenant AI routing |

## Current Stack Versions (Core)

- **React**: 19.2.4 (Admin + Public)
- **Vite**: 7.3.1 (Admin)
- **Astro**: 6.0.4 (Primary Public + SMANDAPBUN) - *Requires Node.js >=22.12.0*
- **TailwindCSS**: 4.1.18 (Admin), 4.2.1 (Primary Public)
- **Supabase JS**: 2.99.1 (Admin + Primary Public)
- **React Router DOM**: 7.10.1
- **TipTap**: 3.13.0
- **Puck**: 0.21.0
- **OpenClaw**: 2026.2.21-2 (AI Gateway)
- **Node.js**: >= 22.12.0 (managed via nvm)

Notes:

- `awcms/` and `awcms-public/primary/` currently use `@supabase/supabase-js` `^2.99.1`.
- `awcms-public/smandapbun/` now aligns on `@supabase/supabase-js` `^2.99.1`.
- `awcms-edge/` now aligns on `@supabase/supabase-js` `^2.99.1`.

## Runtime Architecture

- `awcms-edge/` is the server-side HTTP gateway for client applications when requests need privileged orchestration, external API calls, storage signing, webhook handling, or edge-managed request shaping.
- Supabase remains the system of record for authentication, PostgreSQL data, tenant context, RLS, and ABAC permission enforcement.
- Cloudflare Workers add an edge gateway layer; they do not replace Supabase Auth or move authorization truth out of PostgreSQL policies and permission functions.
- Cloudflare R2 handles object storage flows, while metadata, ownership, tenant isolation, and policy enforcement remain in Supabase.
- Client apps should continue to use Supabase Auth sessions, and Worker routes should validate those sessions before performing protected server-side work.

See also:

- `docs/architecture/runtime-boundaries.md`
- `docs/dev/release-summary-2026-03-extension-runtime-hardening.md`

## Runtime Validation

- Run the consolidated runtime validation script with:
  - `bash scripts/ci-validate-runtime.sh`
- This validates:
  - admin lint/build
  - client storage guards
  - shared storage guards
  - edge typecheck
  - migration parity
- Platform browser checks can also be run directly with:
  - `cd awcms && npm run test:platform-routes`

## Quick Start

### For Developers

1. Read **[SYSTEM_MODEL.md](SYSTEM_MODEL.md)** - Understand the architecture (5 min)
2. Follow **[Developer Setup Guide](docs/dev/setup.md)** - Get running (10 min)
3. Reference **[AGENTS.md](AGENTS.md)** - Coding standards and patterns
4. Use **[Environment Bootstrap Guide](docs/dev/environment-bootstrap.md)** for new environment + deployment configuration
5. Optionally run `python3 scripts/setup_awcms_environment.py` to generate local env files and a deployment checklist

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
- **[docs/dev/context7-benchmark-playbook.md](docs/dev/context7-benchmark-playbook.md)**: Structured benchmark response playbook and reusable templates
- **[docs/dev/environment-bootstrap.md](docs/dev/environment-bootstrap.md)**: Clone/bootstrap and deployment configuration guide

## Database & Migrations

- Canonical timestamped migrations live in `supabase/migrations/` and are mirrored in `awcms/supabase/migrations/` for CI/Admin tooling compatibility.
- Current observed state: `139` root migrations and `139` mirrored migrations, with parity verified by `scripts/verify_supabase_migration_consistency.sh`.
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
- `supabase/cli` - Migration and deployment workflows
- `vitejs/vite` - Build tooling  
- `withastro/docs` - Public portal framework
- `cloudflare/cloudflare-docs` - Worker and binding guidance
- See [AGENTS.md](AGENTS.md) for complete list

## MCP Topology (OpenCode)

- Repo config: `mcp.json`
- Runtime client config: `~/.config/opencode/opencode.json`
- Active servers:
  - Context7: `https://mcp.context7.com/mcp`
  - Supabase (local): `node awcms-mcp/dist/index.js`
  - Cloudflare (local npx): `@cloudflare/mcp-server-cloudflare`
  - GitHub (local): `scripts/start_github_mcp.sh` (Docker-based `github/github-mcp-server`)
  - Paper (local remote): `http://127.0.0.1:29979/mcp`

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

See [LICENSE](LICENSE).
