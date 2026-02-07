# AWCMS Public Portal

## Purpose
Multi-tenant public portal implemented in Astro.

## Audience
- Public portal developers

## Prerequisites
- Node.js 20+

## Quick Start

```bash
cd awcms-public/primary
npm install
# Create .env with Supabase variables and PUBLIC_TENANT_ID
npm run dev
```

## Features

- Tenant resolution via build-time `PUBLIC_TENANT_ID` (`awcms-public/primary/src/lib/publicTenant.ts`).
- Visitor analytics logging is available when SSR/runtime middleware is enabled.
- Public stats page at `/visitor-stats` and `/[tenant]/visitor-stats`.

## References

- `primary/README.md`
- `../DOCS_INDEX.md`
