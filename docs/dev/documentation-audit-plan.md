# Documentation Audit Plan (Context7 MCP)

> **Owner:** Documentation Steward
> **Last Updated:** 2026-02-17
> **Authority:** SYSTEM_MODEL.md -> AGENTS.md -> DOCS_INDEX.md

## Purpose

Establish a repeatable, Context7-driven workflow to audit and update all AWCMS documentation so it reflects:

- Current database schema and migrations
- Actual scripts and runtime behavior in each package
- Latest library best practices (Context7 MCP is the primary reference)

## Current Focus (2026-02-17)

- Admin routes now use sub-slugs for tabs, trash views, and approvals.
- Edit/detail routes use signed IDs (`{uuid}.{signature}`) with legacy redirects.
- Dashboard widgets share a consistent header frame (core + plugin widgets).
- Supabase admin client updated to `@supabase/supabase-js` 2.93.3.
- Primary tenant seeding exists (`seed-primary-tenant.js` + migration) and must be documented in setup flows.
- Extension seeding relies on `extensions_tenant_slug_unique` and uses `seed-sidebar.js` with the secret key.

## Scope

| Area | Primary Sources | Notes |
| --- | --- | --- |
| Root docs | README.md, AGENTS.md, SYSTEM_MODEL.md, DOCS_INDEX.md | Authority chain and quick start content |
| Core docs | docs/README.md, docs/architecture/* | Architecture, tech stack, and data model |
| Security | docs/security/* | RLS, ABAC, threat model, compliance |
| Tenancy | docs/tenancy/* | Tenant hierarchy, isolation, sharing rules |
| Modules | docs/modules/* | Feature guides and module behavior |
| Dev guides | docs/dev/* | Setup, testing, CI/CD, public portal | 
| Public portal | awcms-public/README.md, awcms-public/primary/README.md | Astro + React guidance |
| Admin app | awcms/README.md, awcms/package.json scripts | React + Vite guidance |
| MCP | awcms-mcp/README.md, awcms-mcp/src/tools/* | Tooling and MCP usage |
| Mobile/IoT | awcms-mobile/**, awcms-esp32/** | Platform-specific setup |
| Database ops | awcms/supabase/migrations/*.sql | Ignore `current_*.sql` snapshots; validate timestamped migrations |
| Routing & security | docs/modules/ADMIN_UI_ARCHITECTURE.md, docs/security/* | Sub-slug routing + signed route params |
| Dashboard UX | docs/modules/EXTENSIONS.md | Widget headers + plugin frame conventions |

## Context7 MCP Reference Workflow

1. Start MCP server (if needed): `cd awcms-mcp && npm run dev`.
2. For each library below, run `context7_search` with the suggested queries.
3. Store the snippets in a review note or update the doc section directly.

| Library ID | Key Queries (examples) |
| --- | --- |
| supabase/supabase-js | auth + RLS patterns, client initialization, storage uploads |
| vitejs/vite | Vite 7 config, env handling, build output |
| withastro/astro | static output, islands, build config |
| remix-run/react-router | Router v7 loaders, data APIs |
| websites/react_dev | React 19 patterns, hooks guidance |
| websites/tailwindcss | Tailwind v4 CSS-first usage |
| puckeditor/puck | editor usage, renderer constraints |
| grx7/framer-motion | motion patterns and layout guidelines |
| ueberdosis/tiptap-docs | tiptap 3 setup, extension usage |

## Audit Checklist

### 1. Tech Stack Alignment

- Verify versions in SYSTEM_MODEL.md match `package.json` for each package.
- Confirm Node.js requirement (>= 20.0.0) is consistent across docs.
- Verify Supabase client versions (admin/public) match AGENTS.md and `package.json`.

### 2. Database Accuracy

- Compare schema docs with `supabase/migrations` and `awcms/supabase/migrations`.
- Ensure new tables (e.g., `user_profiles`, `user_profile_admin`) appear where user data is documented.
- Validate RLS patterns and permission keys match AGENTS.md and security docs.
- Ensure migration guidance references timestamped migrations (ignore `current_*.sql` snapshots).

### 3. Script and CLI Accuracy

- Validate `npm run` scripts listed in docs match each package `package.json`.
- Update migration instructions to use `npx supabase db push --local` when intended for local.
- Record any `supabase migration repair` steps required for local history mismatches.

### 4. Environment Keys

- Ensure `.env.example` contains all keys present in any `.env` file.
- Update docs to use `VITE_SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY` naming.

### 5. Cross-Doc Consistency

- Confirm that links in DOCS_INDEX.md resolve correctly from the repo root.
- Ensure definitions (tenant isolation, permissions) match SYSTEM_MODEL.md.
- Align route conventions (sub-slugs, signed IDs) across admin docs and module guides.
- Align dashboard widget header guidance with `docs/modules/EXTENSIONS.md`.

### 6. Routing & URL Security

- Verify admin routes document sub-slug patterns for tabs, approvals, and trash views.
- Confirm edit/detail links use signed IDs (`{uuid}.{signature}`) in docs and examples.
- Ensure extensions declare `secureParams` for routes that accept identifiers.

## Update Standards

- Add or refresh **Last Updated** metadata in top-level docs.
- Use tables for structured data (versions, configs, checklists).
- Include a short **Verified Against** section with references to code or migrations.
- Use relative links only (no absolute URLs for internal docs).
- Note when UI conventions (card headers, badges, empty states) are expected for dashboard widgets.

## Deliverables

1. Updated documentation files across all areas in scope.
2. Updated DOCS_INDEX.md with correct paths.
3. `DOCUMENTATION_UPDATE_SUMMARY.md` entry describing changes.
4. Optional CHANGELOG.md entry if major updates impact users.

## Validation

- `npm run docs:check` (from `awcms/`) to verify link health.
- `npm run check` (from `awcms-public/primary`) when public docs are updated.
- `npx supabase db pull --local --schema public` to confirm schema docs match local database.
