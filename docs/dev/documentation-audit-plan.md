# Repository Documentation Audit and Revision Plan (Context7-First)

> **Owner:** Documentation Steward (AI + Maintainers)
>
> **Last Updated:** 2026-02-27
>
> **Primary Authority Chain:** `SYSTEM_MODEL.md` -> `AGENTS.md` -> `README.md` -> `DOCS_INDEX.md` -> package/module docs

## Objective

Run a full-repository documentation audit and revision cycle so all docs accurately reflect:

- current database schema and migration behavior,
- active scripts and CI/CD commands,
- real implementation behavior across Admin, Public, Mobile, MCP, and Infra surfaces,
- latest library best practices using **Context7 MCP as the primary reference**.

## Execution Status

- Phase 0 (inventory + drift detection): Completed
- Phase 1 (authority docs + CI/runtime alignment): Completed
- Phase 2 (DB/security/tenancy reconciliation): Completed
- Phase 3 (scripts/CI/ops reconciliation): Completed
- Phase 4 (module/feature/package docs): Completed
- Tracker artifact: `docs/dev/documentation-audit-tracker.md`

## Success Criteria

1. Core authority docs (`README.md`, `AGENTS.md`, `SYSTEM_MODEL.md`) are synchronized and contradiction-free.
2. Every operational command in docs is executable in the current repository layout.
3. Database/security docs match active SQL migrations and RLS/ABAC behavior.
4. Library-facing guidance is validated against Context7 for each major stack component.
5. `DOCS_INDEX.md` and `docs/README.md` provide a correct map of all maintained docs.

## Current Baseline Snapshot (for planning)

- **Node requirement (codebase):** `>=22.12.0` (awcms, awcms-public/primary, awcms-mcp)
- **Admin stack:** React 19.2.4, Vite 7.x, Tailwind v4, Supabase JS v2.93.3
- **Public stack:** Astro 5.17.1, React 19.2.4, Supabase JS v2.93.3
- **MCP stack:** TypeScript + Model Context Protocol SDK
- **Supabase migration surfaces:**
  - `supabase/migrations/**`
  - `awcms/supabase/migrations/**`
- **Primary docs validation commands currently available:**
  - `awcms`: `npm run docs:check`
  - `awcms-public/primary`: `npm run check`
  - `awcms-mcp`: `npm run lint && npm run build`

## Repository-Wide Scope

| Tier | Target | Paths |
| --- | --- | --- |
| Tier 0 (Authority) | Canonical project governance and entry docs | `README.md`, `SYSTEM_MODEL.md`, `AGENTS.md`, `DOCS_INDEX.md`, `docs/README.md` |
| Tier 1 (Architecture/Security/Tenancy) | Architectural truth, risk boundaries, deployment and tenancy behavior | `docs/architecture/**`, `docs/security/**`, `docs/tenancy/**`, `docs/deploy/**`, `docs/compliance/**` |
| Tier 1 (Developer + Module docs) | Feature behavior, workflows, testing, and extension usage | `docs/dev/**`, `docs/modules/**`, `docs/guides/**` |
| Tier 2 (Package docs) | Package READMEs and package-level runbooks | `awcms/**/README*.md`, `awcms-public/**/README*.md`, `awcms-mcp/**/README*.md`, `awcms-mobile*/**/README*.md`, `awcms-esp32/**/README*.md`, `awcms-ext/**/README*.md` |
| Tier 2 (Operational truth sources) | Non-doc sources that docs must mirror | `package.json` scripts, `.github/workflows/**`, `scripts/**`, `supabase/**`, `awcms/supabase/**`, `mcp.json` |

## Context7 Reference Matrix (Primary External Source)

Use Context7 MCP for every library-facing section before publishing changes.

| Library | Context7 ID | Docs to align |
| --- | --- | --- |
| Supabase platform | `/supabase/supabase` | tenancy, RLS, migrations, edge-function docs |
| Supabase JS | `/supabase/supabase-js` | client init, auth flow, query/storage examples |
| Supabase CLI | `/supabase/cli` | migration, lint, push/pull and environment docs |
| Vite | `/vitejs/vite` | admin build/config/env and chunking docs |
| Astro | `/withastro/docs` | SSG, islands, script directives, env usage |
| React Router | `/remix-run/react-router` | routing conventions, loaders, params |
| React | `/websites/react_dev` | React 19 patterns and anti-patterns |
| Tailwind CSS | `/websites/tailwindcss` | v4 styling and configuration guidance |
| Puck | `/puckeditor/puck` | visual editor docs and render contracts |
| TipTap | `/ueberdosis/tiptap-docs` | rich-text handling and extension usage |
| Framer Motion | `/grx7/framer-motion` | animation guidance and performance constraints |
| OpenClaw | `/openclaw/openclaw` | AI gateway and multi-agent docs |

## Audit Method (Evidence-Driven)

### 1) Documentation Inventory + Ownership

- Build an inventory of all `.md` files and map each file to:
  - owner/reviewer,
  - source-of-truth files,
  - last verification date.
- Tag each doc as: `Authority`, `Architecture`, `Operational`, `Feature`, `Package`, or `Historical`.

### 2) Truth-Source Validation

- Validate docs against concrete sources:
  - SQL/migrations (`supabase/migrations/**`, `awcms/supabase/migrations/**`),
  - runtime scripts (`package.json`),
  - CI behavior (`.github/workflows/**`),
  - implementation (`awcms/src/**`, `awcms-public/primary/src/**`, `awcms-mcp/src/**`).
- Any doc claim without a traceable source is either corrected or removed.

### 3) Context7 Best-Practice Pass

- For each library-facing section, run Context7 lookup and record:
  - library ID,
  - query topic,
  - update decision (keep/revise/remove).
- Add a short verification note in revised docs when behavior materially changed.

### 4) Consistency + Link Integrity

- Resolve terminology drift (role names, env vars, permission keys, migration commands).
- Ensure links resolve and index entries match file paths.

## Workstreams and Checklist

### Workstream A - Authority Docs (Highest Priority)

Targets:

- `README.md`
- `AGENTS.md`
- `SYSTEM_MODEL.md`
- `DOCS_INDEX.md`
- `docs/README.md`

Checklist:

- versions and constraints are identical where duplicated,
- env var names match current conventions (`VITE_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`),
- command examples are executable in current folder structure,
- authority chain is explicit and non-conflicting.

### Workstream B - Database, Security, and Tenancy Docs

Targets:

- `docs/security/**`
- `docs/tenancy/**`
- `docs/architecture/database.md`
- `docs/dev/edge-functions.md`

Checklist:

- migration guidance matches current dual migration layout,
- RLS, ABAC, and soft-delete patterns reflect active SQL,
- policy examples use current permission key format,
- tenant and locale behavior matches current implementation.

### Workstream C - Scripts, CI/CD, and Operations Docs

Targets:

- `docs/dev/setup.md`
- `docs/dev/troubleshooting.md`
- `docs/dev/ci-cd.md`
- `docs/deploy/**`

Checklist:

- all script snippets match real `package.json` scripts,
- CI docs align with `.github/workflows/**`,
- Node runtime statements match package constraints,
- Supabase operational commands are safe and current.

### Workstream D - Module and Feature Documentation

Targets:

- `docs/modules/**`
- `docs/dev/admin.md`, `docs/dev/public.md`, `docs/dev/mobile.md`, `docs/dev/esp32.md`
- `docs/guides/**`

Checklist:

- UI behavior docs match current components/routes,
- visual builder and template docs match current Puck/Tiptap behavior,
- route security docs reflect signed parameter enforcement,
- performance and monitoring docs match current implementation.

### Workstream E - Package READMEs and Internal Surfaces

Targets:

- `awcms/README.md`
- `awcms-public/**/README*.md`
- `awcms-mcp/**/README*.md`
- `awcms-mobile*/**/README*.md`
- `awcms-esp32/**/README*.md`
- `awcms-ext/**/README*.md`

Checklist:

- local setup and run commands are valid,
- package-specific constraints and prerequisites are current,
- cross-package links point to canonical docs.

## Execution Plan (Phased)

### Phase 0 - Inventory and Drift Detection

- generate doc inventory and ownership map,
- identify duplicate/stale docs and conflicting guidance,
- record drift findings in a working tracker.

### Phase 1 - Authority Doc Reconciliation

- update Tier 0 docs first,
- freeze terminology and environment key conventions,
- align DOCS index maps.

### Phase 2 - DB/Security/Tenancy Reconciliation

- validate against migrations and active SQL behavior,
- revise RLS/ABAC and migration runbooks,
- verify Supabase best-practice references via Context7.

### Phase 3 - Scripts/CI/Ops Reconciliation

- audit script commands vs package/workflow reality,
- revise setup/deploy/troubleshooting docs,
- ensure local and CI instructions are environment-safe.

### Phase 4 - Module/Feature and Package Docs

- revise module docs and package READMEs,
- normalize examples and architecture narratives,
- cross-link to canonical docs.

### Phase 5 - QA, Consistency, and Release Notes

- run docs validation commands,
- resolve final link/terminology issues,
- update `CHANGELOG.md` with documentation audit summary.

## Validation Commands

- `awcms`: `npm run docs:check`
- `awcms`: `npm run lint && npm run build && npm run test -- --run`
- `awcms-public/primary`: `npm run check && npm run build`
- `awcms-mcp`: `npm run lint && npm run build`
- Supabase migration sanity (both roots):
  - `supabase db lint`
  - `supabase migration list`

## Deliverables

1. Updated and reconciled documentation across all tiers.
2. Context7 verification notes for every revised library-facing section.
3. Updated `DOCS_INDEX.md` map and fixed cross-links.
4. Documentation audit changelog entry in `CHANGELOG.md`.

## Definition of Done

- All Tier 0 + Tier 1 docs are reconciled against current implementation and migrations.
- No known contradictions remain between authority docs and module/package docs.
- Context7 verification completed for each library-facing section touched.
- Validation command suite passes without docs/lint/type/prettier failures in audited packages.
