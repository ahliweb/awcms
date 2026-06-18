# AWCMS MCP

## Purpose

Model Context Protocol (MCP) server workspace for AWCMS tooling (Supabase and Context7 helpers).

Current AWCMS-specific operator coverage includes:

- Supabase CLI helpers
- Context7 documentation lookup
- Flutter environment helpers
- Site composition inventory helpers for:
  - `site_blueprints`
  - `tenant_site_blueprint_state`
  - `reusable_sections`

## Prerequisites

- Node.js >= 24.14.1
- Bun 1.3+

## Quick Start

```bash
cd awcms-mcp
bun install
bun run dev
```

## Scripts

| Command | Description |
| --- | --- |
| `bun run dev` | Start MCP server in watch mode (Bun runs TypeScript natively) |
| `bun run build` | Type-check / compile TypeScript to `dist/` (opsional; runtime pakai TS langsung) |
| `bun run start` | Run MCP server (`bun src/index.ts`) |
| `bun run lint` | Lint TypeScript source files |
| `bun run lint:fix` | Lint with autofix |
| `bun run format` | Format source files with Prettier |

## Environment Notes

- Configure Supabase and Context7 keys in your local env files before starting tools that require external APIs.
- Set `SUPABASE_DB_URL` when using the site composition MCP tools so the server can query local blueprint and reusable-section state.
- Set `AWCMS_OPERATOR_BEARER_TOKEN` plus `VITE_LOCAL_EDGE_URL` or `VITE_EDGE_URL` when using write-capable site composition tools that call the Worker routes.
- `mcp.json` is the repository source of truth for the active MCP server topology used by OpenCode.
- Keep secret values out of Git-tracked files.

## Site Composition Tools

The Phase 4 operator surface currently exposes read-only MCP tools for the new template-composition primitives:

- `awcms_list_site_blueprints`
- `awcms_get_tenant_blueprint_state`
- `awcms_list_reusable_sections`

These tools are intended for AI/operator workflows and diagnostics, not end-user editing.

Write-capable operator tools:

- `awcms_apply_site_blueprint`
- `awcms_materialize_reusable_section`

These tools call the existing Worker routes and require a valid platform admin bearer token.

## References

- `../AGENTS.md`
- `../docs/dev/setup.md`
- `../docs/tenancy/supabase.md`
