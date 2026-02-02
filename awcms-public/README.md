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
# Create .env with Supabase variables
npm run dev
```

## Features

- Tenant resolution via middleware (`awcms-public/primary/src/middleware.ts`).
- Visitor analytics logging with consent notice (`analytics_events`, `analytics_daily`).
- Public stats page at `/visitor-stats` and `/[tenant]/visitor-stats`.

## References

- `primary/README.md`
- `../DOCS_INDEX.md`
