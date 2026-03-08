# AWCMS MCP

## Purpose

Model Context Protocol (MCP) server workspace for AWCMS tooling (Supabase and Context7 helpers).

## Prerequisites

- Node.js >= 22.12.0
- npm 10+

## Quick Start

```bash
cd awcms-mcp
npm install
npm run dev
```

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start MCP server in development mode (`tsx`) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run start` | Run compiled server from `dist/index.js` |
| `npm run lint` | Lint TypeScript source files |
| `npm run lint:fix` | Lint with autofix |
| `npm run format` | Format source files with Prettier |

## Environment Notes

- Configure Supabase and Context7 keys in your local env files before starting tools that require external APIs.
- `mcp.json` is the repository source of truth for the active MCP server topology used by OpenCode.
- Keep secret values out of Git-tracked files.

## References

- `../AGENTS.md`
- `../docs/dev/setup.md`
- `../docs/tenancy/supabase.md`
