# AWCMS Monorepo

Welcome to the AWCMS monorepo. AWCMS is a **multi-tenant CMS platform** with admin, public, mobile, and IoT clients backed by Supabase.

## Documentation Authority

This repository follows a strict documentation hierarchy aligned with the **Context7 MCP** (Model Context Protocol):

1. **[SYSTEM_MODEL.md](SYSTEM_MODEL.md)** - **Single Source of Truth**: Tech stack versions, architectural pillars, security mandates
2. **[AGENTS.md](AGENTS.md)** - AI coding guidelines, Context7 library references, permission patterns
3. **[DOCS_INDEX.md](DOCS_INDEX.md)** - Navigation and canonical references for all documentation
4. **Implementation Guides** - Specific how-to documentation in `docs/`

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

## Current Stack Versions (Core)

- **React**: 19.2.4 (Admin + Public)
- **Vite**: 7.2.7 (Admin)
- **Astro**: 5.17.1 (Public) - *Requires Node.js >=20.0.0*
- **TailwindCSS**: 4.1.18
- **Supabase JS**: 2.87.1 (Admin), 2.93.3 (Public)
- **React Router DOM**: 7.10.1
- **TipTap**: 3.13.0
- **Puck**: 0.21.0

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

## Database & Migrations

- Canonical migrations live in `supabase/migrations/` and are mirrored in `awcms/supabase/migrations/` for the Admin runtime.
- Use `npx supabase db push` to apply new migrations and `supabase db pull` to sync remote history.
- If migration history is out of sync, use `supabase migration repair` before pushing.

## Context7 MCP Integration

This repository uses Context7 for AI-assisted development. Key library IDs:
- `supabase/supabase-js` - Database operations
- `vitejs/vite` - Build tooling  
- `withastro/astro` - Public portal framework
- See [AGENTS.md](AGENTS.md) for complete list

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

See [LICENSE](LICENSE).
