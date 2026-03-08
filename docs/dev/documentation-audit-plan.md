# Repository Documentation Audit and Revision Plan (Context7-First)

> **Owner:** Documentation Steward (AI + Maintainers)
>
> **Audit Cycle:** 2026-03-08 Full-Scope Documentation and Repository Integrity Cycle
>
> **Last Updated:** 2026-03-08
>
> **Primary Authority Chain:** `SYSTEM_MODEL.md` -> `AGENTS.md` -> `README.md` -> `DOCS_INDEX.md` -> implementation and package docs

## Mission

Run a full-repository documentation audit so every maintained doc is accurate, evidence-backed,
and aligned with the current implementation, database schema, scripts, CI/CD flows, edge-runtime
model, and dependency baseline, using Context7 as the primary external reference for library
best practices.

This cycle explicitly includes conflict detection and resolution planning for:

- outdated dependencies and version drift
- broken or nonfunctional scripts and commands
- security risks and bad secret-handling guidance
- performance guidance drift
- dead links and stale navigation
- stale or contradictory feature and architecture claims

## Current Cycle Status

| Phase | Status | Notes |
| --- | --- | --- |
| Phase 0 - Re-Baseline and Inventory Refresh | In Progress | 2026-03-08 baseline and active plan refresh underway |
| Phase 1 - Authority Reconciliation | In Progress | `README.md`, `AGENTS.md`, `SYSTEM_MODEL.md`, and navigation surfaces being refreshed first |
| Phase 2 - Schema, Security, and Tenancy Reconciliation | Pending | Re-validate against current migrations, RLS, and edge/runtime model |
| Phase 3 - Scripts, Tooling, and Deployment Reconciliation | Pending | Validate commands, MCP topology, build/run scripts, and deploy workflows |
| Phase 4 - Feature, Module, and Package Documentation Pass | Pending | Reconcile feature docs, package READMEs, and code-linked examples |
| Phase 5 - Conflict Resolution and Publication | Pending | Resolve open drift items, rerun checks, and publish updated baseline |

See `docs/dev/documentation-audit-tracker.md` for the live drift register and evidence log.

## Required Outcomes

1. Authority docs (`SYSTEM_MODEL.md`, `AGENTS.md`, `README.md`, `DOCS_INDEX.md`) are synchronized and contradiction-free.
2. Documentation claims about database schema, RLS/ABAC, migration workflows, and edge runtimes match active code and SQL.
3. All command snippets in maintained docs are valid for the current repository layout.
4. Library-specific guidance is verified with Context7 and logged in the tracker.
5. Top-level repo docs reflect the current MCP topology, edge-runtime model, and script inventory.
6. Potential conflict areas (dependencies, scripts, security, performance, dead links, stale roadmap/checklists) are identified and triaged.
7. Stitch is no longer used as a top-level repository status signal in `README.md`; feature-specific Stitch docs remain explicitly scoped where implementation still exists.

## Scope

### In Scope

| Tier | Purpose | Paths |
| --- | --- | --- |
| Tier 0 (Authority) | Governance and canonical references | `SYSTEM_MODEL.md`, `AGENTS.md`, `README.md`, `DOCS_INDEX.md`, `docs/README.md` |
| Tier 1 (Architecture/Security/Tenancy) | Core system behavior and constraints | `docs/architecture/**`, `docs/security/**`, `docs/tenancy/**`, `docs/deploy/**`, `docs/compliance/**` |
| Tier 1 (Dev/Modules/Guides) | Operational runbooks and feature docs | `docs/dev/**`, `docs/modules/**`, `docs/guides/**` |
| Tier 2 (Package READMEs) | Package-level setup and usage docs | `awcms/**/README*.md`, `awcms-public/**/README*.md`, `awcms-mcp/**/README*.md`, `awcms-mobile*/**/README*.md`, `awcms-esp32/**/README*.md`, `awcms-ext/**/README*.md` |
| Tier 2 (Truth Sources) | Implementation evidence used for reconciliation | `supabase/**`, `awcms/supabase/**`, `awcms-edge/**`, `scripts/**`, `.github/workflows/**`, `package.json` files, `mcp.json` |

### Out of Scope

- Third-party/vendor/generated docs that are not project-authoritative.
- Binary assets and non-markdown content.
- Historical changelog entries except where current authority docs contradict them.

## 2026-03-08 Baseline Snapshot

| Surface | Baseline |
| --- | --- |
| Total markdown files in repository | `113` |
| `docs/**/*.md` count | `71` |
| Root migrations | `117` SQL files in `supabase/migrations/` |
| Mirrored migrations | `117` SQL files in `awcms/supabase/migrations/` |
| MCP servers from `mcp.json` | `cloudflare`, `context7`, `github`, `supabase` |
| Node baseline | `>=22.12.0` (validated runtime currently `v22.22.0`) |
| Public runtime model | Astro static output with React islands |
| Primary edge HTTP layer | Cloudflare Workers (`awcms-edge/`) |

## Context7 Protocol (Mandatory)

### Library Matrix

| Surface | Context7 ID | Validation Focus |
| --- | --- | --- |
| Supabase platform | `/supabase/supabase` | tenancy, RLS, auth, schema patterns |
| Supabase JS | `/supabase/supabase-js` | client init, auth, queries, session handling |
| Supabase CLI | `/supabase/cli` | migration, repair, deploy, local vs linked workflows |
| Astro | `/withastro/docs` | static builds, `getStaticPaths`, env usage |
| Vite | `/vitejs/vite` | env exposure, `loadEnv`, build config |
| Cloudflare | `/cloudflare/cloudflare-docs` | Workers deploys, secrets, bindings, runtime boundaries |
| React | `/websites/react_dev` | React 19 patterns in examples |
| React Router | `/remix-run/react-router` | route/data-loading references |
| Tailwind CSS | `/websites/tailwindcss` | v4 utility and token guidance |
| Puck | `/puckeditor/puck` | render/config behavior |
| TipTap | `/ueberdosis/tiptap-docs` | content handling and editor safety |
| OpenClaw | `/openclaw/openclaw` | AI gateway and tenant routing docs |

### Verification Workflow

For each library-facing doc section:

1. Map the doc claim to the relevant library or runtime.
2. Query Context7 for current best practice and version-sensitive guidance.
3. Compare the guidance with the repository implementation.
4. Apply one decision: keep, revise, deprecate, or archive.
5. Log evidence in `docs/dev/documentation-audit-tracker.md`.

## Audit Method

### Step 1 - Inventory and Classification

- Inventory all markdown files and maintained package README surfaces.
- Classify each doc as `Authority`, `Architecture`, `Operational`, `Feature`, `Package`, or `Historical`.
- Mark whether the doc is `canonical`, `supporting`, `backlog/checklist`, or `historical`.

### Step 2 - Truth-Source Reconciliation

Validate each maintained doc against implementation evidence:

- database schema and migrations
- Supabase and edge functions/workers
- build/dev/deploy scripts
- CI workflows and Node/runtime constraints
- admin/public/mobile/device code paths

Any claim without evidence must be corrected, explicitly scoped as backlog, or removed.

### Step 3 - Security and Tenancy Integrity Pass

Confirm all docs preserve canonical rules:

- tenant isolation and RLS are mandatory
- `deleted_at` soft delete lifecycle is explicit
- permission keys use `scope.resource.action`
- secret naming uses `VITE_SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY`
- client docs never advise exposing secrets or bypassing RLS

### Step 4 - Conflict Identification Pass

Review and triage the following repository-wide conflict classes:

| Conflict Class | Detection Surface | Expected Action |
| --- | --- | --- |
| Outdated dependencies | `package.json`, lockfiles, changelog, Context7 guidance | Update docs, create upgrade backlog, or revise stale version claims |
| Broken/nonfunctional scripts | `scripts/**`, package scripts, deploy docs | Fix docs or flag script issue with owner and evidence |
| Security risks | env examples, auth docs, RLS/ABAC docs, secret naming | Correct guidance immediately and add tracker entry |
| Performance drift | public/admin best-practice docs vs current build/runtime model | Update docs and log required code follow-up if needed |
| Dead links/navigation | `README.md`, `DOCS_INDEX.md`, package READMEs, relative links | Repair links and update canonical routing |
| Stale roadmap/checklists | execution-plan docs, backlog docs, historical runbooks | Mark as backlog/historical or remove from canonical guidance |

### Step 5 - Consistency and Publication Pass

- Reconcile terminology across authority and implementation docs.
- Ensure top-level status docs do not over-emphasize feature-specific surfaces that are no longer canonical repo baselines.
- Update `CHANGELOG.md`, `DOCS_INDEX.md`, and `docs/README.md` where needed.

## Workstreams and Deliverables

### Workstream A - Authority Docs

Targets:

- `SYSTEM_MODEL.md`
- `AGENTS.md`
- `README.md`
- `DOCS_INDEX.md`
- `docs/README.md`

Deliverables:

- current stack/runtime baseline
- contradiction-free terminology and env naming
- current status snapshot without stale Stitch/MCP references

### Workstream B - Schema, Security, and Tenancy Docs

Targets:

- `docs/security/**`
- `docs/tenancy/**`
- `docs/architecture/database.md`
- `docs/dev/edge-functions.md`

Deliverables:

- migration-backed schema and RLS guidance
- current Cloudflare Workers / transitional Supabase function framing
- explicit secret-handling rules

### Workstream C - Scripts, Tooling, and Deploy Docs

Targets:

- `docs/dev/setup.md`
- `docs/dev/troubleshooting.md`
- `docs/dev/ci-cd.md`
- `docs/deploy/**`
- package README command sections

Deliverables:

- executable commands
- accurate script and MCP topology references
- correct deploy/runtime expectations

### Workstream D - Feature, Module, and Client Docs

Targets:

- `docs/dev/admin.md`
- `docs/dev/public.md`
- `docs/dev/mobile.md`
- `docs/dev/esp32.md`
- `docs/modules/**`
- `docs/guides/**`

Deliverables:

- feature docs that match current UI, routes, and workflows
- clear separation between shipped behavior and backlog/checklist content

### Workstream E - Package README Surfaces

Targets:

- maintained `README*.md` files across admin/public/mobile/mcp/esp32/ext workspaces

Deliverables:

- correct setup commands and env names
- working links back to canonical docs
- accurate runtime/dependency notes

### Workstream F - Conflict Resolution and Standards Hardening

Targets:

- dependency/version drift
- security/documentation drift
- dead links and stale references
- performance guidance drift

Deliverables:

- active drift register in tracker
- triage decisions (`resolved`, `planned`, `archive`, `issue follow-up`)
- explicit owner/evidence for high-severity findings

## Validation Gates

Run these before closing the cycle:

- Markdown lint:
  - `npx markdownlint-cli --config .markdownlint.json "**/*.md"`
- Link validation:
  - `cd awcms && npm run docs:check`
- Migration and function consistency:
  - `scripts/verify_supabase_migration_consistency.sh`
  - `scripts/verify_supabase_function_consistency.sh`
- Package sanity for touched areas:
  - `cd awcms && npm run lint && npm run build`
  - `cd awcms-public/primary && npm run check && npm run build`
  - `cd awcms-mcp && npm run lint && npm run build`
- Dependency review:
  - `npm outdated --prefix awcms`
  - `npm outdated --prefix awcms-public/primary`
  - `npm outdated --prefix awcms-mcp`

## Artifacts

Required outputs for this cycle:

1. Updated docs across all in-scope tiers.
2. Evidence log and drift register in `docs/dev/documentation-audit-tracker.md`.
3. Updated navigation in `DOCS_INDEX.md` and `docs/README.md` where needed.
4. Changelog entry summarizing documentation and planning updates.

## Definition of Done

- Tier 0 and Tier 1 docs are reconciled and internally consistent.
- Package docs are updated for touched workspaces.
- Context7 verification evidence exists for revised library-facing sections.
- Validation gates pass for lint/link and relevant package checks.
- No unresolved high-severity drift items remain open in the tracker without an owner and next action.
