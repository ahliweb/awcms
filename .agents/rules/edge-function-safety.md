---
description: Enforce approved server-side runtimes — no standalone Node.js servers permitted
---

# Edge Runtime Safety

> **Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) Section 1.3

## Rule

Backend logic MUST reside in approved AWCMS server-side runtimes: **Supabase** (PostgreSQL functions, RLS, ABAC) and **Cloudflare Workers** in `awcms-edge/` for edge HTTP orchestration. Standalone Node.js servers are **FORBIDDEN**.

## Allowed Backend Patterns

| Pattern | Location | Runtime |
|---------|----------|---------|
| PostgreSQL functions (PL/pgSQL) | `supabase/migrations/*.sql` | Supabase Postgres |
| Cloudflare Worker routes / queue consumers | `awcms-edge/src/**/*.ts` | Cloudflare Workers |
| Database triggers | Migration files | Supabase Postgres |
| RLS policies | Migration files | Supabase Postgres |

## Violations

```
❌ Creating an Express.js / Fastify / Hono server
❌ Adding a server.js or server.ts entry point
❌ Adding Node.js server dependencies (express, fastify, koa, hapi, nest)
❌ Creating a package.json with a "start" script that runs a Node.js server
❌ Using node:http or node:net directly for server purposes
```

## Exceptions

- **Build tools** (Vite, Astro dev server) are permitted — they are development tooling,
  not production backend servers.
- **MCP servers** (local developer tooling in `awcms-mcp/`) are permitted — they are not
  deployed to production.
- **OpenClaw CLI** runs locally for AI gateway — not a production server.

## Enforcement

1. **Dependency review**: Reject PRs adding `express`, `fastify`, `koa`, `hapi`,
   `@nestjs/*` or similar server framework dependencies.
2. **Architecture review**: Any new API endpoint must be implemented as a Cloudflare Worker route in `awcms-edge/` or a PostgreSQL function/RPC path, not a standalone server.
3. **CI check**: No `node server.js` or equivalent in production deployment scripts.

## Rationale

- Supabase handles connection pooling, authentication, RLS, and ABAC enforcement
- Cloudflare Workers provide the maintained edge HTTP runtime for privileged orchestration and integrations
- Eliminates infrastructure maintenance burden of standalone servers
- Maintains consistency with multi-tenant RLS model
