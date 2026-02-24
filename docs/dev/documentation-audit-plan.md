# Documentation Audit and Revision Plan (Context7 MCP)

> **Owner:** Documentation Steward
>
> **Last Updated:** 2026-02-24
>
> **Authority Chain:** `SYSTEM_MODEL.md` -> `AGENTS.md` -> `DOCS_INDEX.md` -> module/dev docs

## Objective

Run a repository-wide audit and revision cycle so docs always match current:

- database design and migration state,
- scripts and operational commands,
- implementation behavior in admin/public/mobile/MCP layers,
- library best practices, with **Context7 MCP as the primary reference**.

## Priority Outcomes

1. `README.md`, `AGENTS.md`, and `SYSTEM_MODEL.md` stay synchronized and authoritative.
2. All critical docs are traceable to actual code, migrations, and scripts.
3. Library guidance is reviewed against latest Context7 references before publication.
4. `DOCS_INDEX.md` remains a valid map of the documentation surface.

## Scope (Repository-Wide)

| Tier | Areas | Paths |
| --- | --- | --- |
| Tier 0 (Authority) | Core governance docs | `README.md`, `SYSTEM_MODEL.md`, `AGENTS.md`, `DOCS_INDEX.md`, `docs/README.md` |
| Tier 1 (Architecture + Security) | Architecture, tenancy, security, deploy | `docs/architecture/**`, `docs/tenancy/**`, `docs/security/**`, `docs/deploy/**`, `docs/compliance/**` |
| Tier 1 (Modules + Dev) | Module behavior and developer workflows | `docs/modules/**`, `docs/dev/**` |
| Tier 2 (Package docs) | Package-level READMEs and setup guides | `awcms/README*`, `awcms-public/**/README*`, `awcms-mobile/**`, `awcms-esp32/**`, `awcms-mcp/**`, `openclaw/**` |
| Tier 2 (Wiki mirror) | Public wiki parity where applicable | `awcms.wiki/**` |
| Tier 2 (Ops artifacts) | Script and migration documentation surfaces | `scripts/**`, `supabase/migrations/**`, `awcms/supabase/migrations/**` |

## Context7-First Review Workflow

1. Start/verify MCP availability (`context7` connected in `opencode mcp list`).
2. For each library area, run `context7_search` using the IDs below.
3. Capture references in working notes and apply updates to relevant docs.
4. Add a short "Verified Against" note in updated docs where material behavior changed.

### Context7 Reference Matrix

| Library ID | Doc Areas to Review | Key Checks |
| --- | --- | --- |
| `supabase/supabase-js` | security, tenancy, db guides, setup | auth flow, RLS-safe patterns, storage/query examples |
| `vitejs/vite` | admin/dev/build docs | env handling, Vite 7 behavior, config examples |
| `withastro/astro` | public portal docs | static output, islands, build-time env patterns |
| `remix-run/react-router` | admin routing docs | router v7 loaders/data APIs and route conventions |
| `websites/react_dev` | coding guidance docs | React 19 patterns and anti-patterns |
| `websites/tailwindcss` | UI/theming docs | Tailwind v4 CSS-first best practices |
| `puckeditor/puck` | visual builder docs | `data` contract and rendering constraints |
| `ueberdosis/tiptap-docs` | rich text/editor docs | import/content handling and extension usage |
| `grx7/framer-motion` | animation guidance docs | motion patterns and performance constraints |
| `openclaw/openclaw` | AI gateway docs | multi-tenant routing, token auth, operational hardening |

## Audit Method (Evidence-Driven)

### A) Database and Migration Evidence

- Validate docs against `supabase/migrations/*.sql` and `awcms/supabase/migrations/*.sql`.
- Confirm docs reference timestamped migrations only.
- Explicitly document exceptions/non-migration SQL files (outside migration directories).
- Reconcile docs with active migration history behavior (`migration list`, `repair`, `db push/pull`).

### B) Script and Runtime Evidence

- Validate all documented commands against each package `package.json` scripts.
- Verify operational scripts in `scripts/` are documented when they are part of runbooks.
- Ensure MCP setup docs match live config in `mcp.json` and runtime client config patterns.

### C) Implementation Evidence

- Confirm docs match current implementation for critical flows:
  - route security and signed IDs,
  - tenant-scoped settings,
  - visual builder and rich text behavior,
  - public rendering sanitization paths,
  - extension and dashboard conventions.

## Revision Phases

### Phase 0 - Baseline Snapshot

- Capture current versions from all `package.json` files.
- Capture migration inventory and current local migration state.
- Capture active MCP server topology (for ops docs).

### Phase 1 - Authority Docs Alignment

- Update `SYSTEM_MODEL.md` first (canonical constraints and versions).
- Reconcile `AGENTS.md` with `SYSTEM_MODEL.md` (no drift in rules/versions).
- Update `README.md` quick-start and architecture summaries.
- Validate `DOCS_INDEX.md` links and descriptions.

### Phase 2 - Database + Security Documentation

- Update tenancy/RLS/ABAC docs against latest schema and policy patterns.
- Ensure soft-delete, permission keys, and signed-route requirements are consistent.
- Update migration and repair runbooks with current safe flows.

### Phase 3 - Scripts + Operations Documentation

- Update setup/troubleshooting docs for current scripts and commands.
- Document new operational scripts and where they are used.
- Verify environment key naming conventions are consistent everywhere.

### Phase 4 - Module and Package Documentation

- Audit `docs/modules/**` and package READMEs against implementation.
- Ensure admin/public/mobile/MCP/OpenClaw docs reflect current behavior and constraints.

### Phase 5 - Consistency, QA, and Wiki Parity

- Resolve cross-doc inconsistencies and duplicated contradictory guidance.
- Mirror key updates into `awcms.wiki/**` where applicable.
- Update `DOCUMENTATION_UPDATE_SUMMARY.md` with the change set.

## Mandatory Checklists

### README, AGENTS, SYSTEM_MODEL

- Version numbers and constraints are identical across all three.
- Authority chain is explicitly documented and respected.
- No stale commands, deprecated env names, or obsolete architecture statements.

### Database and Scripts

- Docs reflect current migration paths, migration naming rules, and repair strategy.
- Commands in docs are executable as written.
- Script docs include purpose and scope (local vs linked/remote where relevant).

### Library Best Practices (Context7)

- Every updated library-specific section has a Context7 verification pass.
- Examples align with latest official guidance from mapped Context7 IDs.

## Deliverables

1. Updated docs across all scoped tiers.
2. Updated `DOCS_INDEX.md` entries and descriptions.
3. Updated `DOCUMENTATION_UPDATE_SUMMARY.md` entry for this audit cycle.
4. Wiki synchronization (`awcms.wiki/**`) for user-facing governance/operational docs.

## Validation Commands

- `npm run docs:check` (from `awcms/`) for docs link checks.
- `npm run check` (from `awcms-public/primary`) when public docs are revised.
- `npx supabase migration list --local` and `npx supabase db push --local` for migration doc sanity.
- `opencode mcp list` for MCP topology docs that include server setup status.

## Definition of Done

- Tier 0 and Tier 1 docs are fully reconciled with code and migrations.
- No known contradictions remain between authority docs and module/dev docs.
- Context7 verification completed for all library-facing guidance touched in the cycle.
- Validation commands pass and summary artifacts are updated.
