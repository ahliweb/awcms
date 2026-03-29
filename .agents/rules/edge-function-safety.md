---
description: Enforce Supabase-only backend architecture — no Node.js servers permitted
---

# Edge Function Safety

> **Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) Section 1.3

## Rule

All backend logic MUST reside in **Supabase** (PostgreSQL functions + Edge Functions).
Standalone Node.js servers are **FORBIDDEN**. This is a non-negotiable architectural
constraint that ensures the platform stays within the Supabase security and deployment model.

## Allowed Backend Patterns

| Pattern | Location | Runtime |
|---------|----------|---------|
| PostgreSQL functions (PL/pgSQL) | `supabase/migrations/*.sql` | Supabase Postgres |
| Edge Functions (Deno/TypeScript) | `supabase/functions/*/index.ts` | Supabase Edge Runtime |
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
2. **Architecture review**: Any new API endpoint must be implemented as a Supabase Edge
   Function or PostgreSQL function, not a standalone server.
3. **CI check**: No `node server.js` or equivalent in production deployment scripts.

## Rationale

- Supabase handles connection pooling, authentication, and RLS enforcement
- Edge Functions run in Deno with built-in isolation and security
- Eliminates infrastructure maintenance burden of standalone servers
- Maintains consistency with multi-tenant RLS model
