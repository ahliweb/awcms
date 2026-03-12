# Repository Documentation Audit and Revision Plan (Context7-First)

> **Owner:** Documentation Steward (AI + Maintainers)
>
> **Audit Cycle:** 2026-03-12 Documentation, Integrity, and Conflict-Resolution Planning Refresh
>
> **Last Updated:** 2026-03-12
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
| Phase 0 - Re-Baseline and Inventory Refresh | Planned | Refresh tracked markdown, docs, migration, README, package, and workflow baselines against the current repo state |
| Phase 1 - Authority and Documentation Hub Reconciliation | Planned | Re-check `SYSTEM_MODEL.md`, `AGENTS.md`, `README.md`, `DOCS_INDEX.md`, and `docs/README.md` for contradictions or stale claims |
| Phase 2 - Schema, Security, and Tenancy Reconciliation | Planned | Reconcile docs against the `131/131` migration baseline, current helper functions, Worker/R2 architecture, and current resource map |
| Phase 3 - Scripts, Tooling, Deployment, and Workflow Reconciliation | Planned | Audit documented commands against actual package scripts, CI workflows, and Cloudflare-first deploy/runtime paths |
| Phase 4 - Feature, Module, Client, and Package README Pass | Planned | Audit per-feature and per-workspace docs against current implementation and route/UI reality |
| Phase 5 - Conflict Resolution, Validation, and Publication | Planned | Execute validation gates, log evidence, triage dependency/security/performance gaps, and close or carry forward all high-severity drift |

See `docs/dev/documentation-audit-tracker.md` for the live drift register and evidence log.

## Required Outcomes

1. Authority docs (`SYSTEM_MODEL.md`, `AGENTS.md`, `README.md`, `DOCS_INDEX.md`) are synchronized and contradiction-free.
2. Documentation claims about database schema, RLS/ABAC, migration workflows, and edge runtimes match active code and SQL.
3. All command snippets in maintained docs are valid for the current repository layout.
4. Library-specific guidance is verified with Context7 and logged in the tracker.
5. Top-level repo docs reflect the current MCP topology, edge-runtime model, and script inventory.
6. Potential conflict areas (dependencies, scripts, security, performance, dead links, stale roadmap/checklists) are identified and triaged.
7. Stitch is no longer used as a top-level repository status signal in `README.md`; feature-specific Stitch docs remain explicitly scoped where implementation still exists.
8. Missing or broken canonical references are either repaired, rerouted, or explicitly tracked with an owner and next action.

## Scope

### In Scope

| Tier | Purpose | Paths |
| --- | --- | --- |
| Tier 0 (Authority) | Governance and canonical references | `SYSTEM_MODEL.md`, `AGENTS.md`, `README.md`, `DOCS_INDEX.md`, `docs/README.md` |
| Tier 1 (Architecture/Security/Tenancy) | Core system behavior and constraints | `docs/architecture/**`, `docs/security/**`, `docs/tenancy/**`, `docs/deploy/**`, `docs/compliance/**` |
| Tier 1 (Dev/Modules/Guides) | Operational runbooks and feature docs | `docs/dev/**`, `docs/modules/**`, `docs/guides/**` |
| Tier 2 (Package READMEs) | Package-level setup and usage docs | `awcms/**/README*.md`, `awcms-public/**/README*.md`, `awcms-mcp/**/README*.md`, `awcms-mobile*/**/README*.md`, `awcms-esp32/**/README*.md`, `awcms-ext/**/README*.md`, `packages/**/README*.md` |
| Tier 2 (Truth Sources) | Implementation evidence used for reconciliation | `supabase/**`, `awcms/supabase/**`, `awcms-edge/**`, `scripts/**`, `.github/workflows/**`, `package.json` files, `mcp.json`, `openclaw/**`, `.agents/**` |

### Out of Scope

- Third-party/vendor/generated docs that are not project-authoritative.
- Binary assets and non-markdown content.
- Historical changelog entries except where current authority docs contradict them.

## 2026-03-12 Baseline Snapshot

| Surface | Baseline |
| --- | --- |
| Total tracked markdown files in repository | `136` |
| Tracked `docs/**/*.md` count | `68` |
| Root migrations | `131` SQL files in `supabase/migrations/` |
| Mirrored migrations | `131` SQL files in `awcms/supabase/migrations/` |
| Maintained package README surfaces | `14` |
| Package manifests (`package.json`) | `10` |
| GitHub workflow files | `3` |
| MCP servers from `mcp.json` | `cloudflare`, `context7`, `github`, `supabase` |
| Node baseline | `>=22.12.0` (validated runtime currently `v22.22.0`) |
| Public runtime model | Astro static output with React islands |
| Primary edge HTTP layer | Cloudflare Workers (`awcms-edge/`) |

## Immediate Blocker Queue

These issues should be addressed before broader doc polishing because they break trust in the documentation surface:

| ID | Severity | Blocker | Evidence | Planned Resolution |
| --- | --- | --- | --- | --- |
| PLAN-101 | High | Root planning docs are stale after recent migration, Worker, media, and lint-cleanup changes | `README.md` still references an active 2026-03-08 cycle while the tracker marks that cycle closed; migration baseline increased to `131/131`; edge/runtime docs changed materially | Refresh the planning docs, root snapshot, and tracker to the 2026-03-12 baseline before the next broad doc pass |
| PLAN-102 | High | Current audit plan still references removed Supabase-function validation workflow | `docs/dev/documentation-audit-plan.md` still lists `scripts/verify_supabase_function_consistency.sh`, which was removed during the Cloudflare-first migration | Replace that gate with current Worker/R2/runtime validation steps and log the migration in the tracker |
| PLAN-103 | Medium | Conflict-resolution plan needs explicit execution steps for resource-map reality, dependency drift, dead links, and broken scripts | Current plan has a good framework but does not yet turn recent repo findings into an ordered next execution queue | Add a 2026-03-12 execution queue with workstreams, detection commands, and exit criteria |

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
| Missing package docs | workspace/package manifests without maintained README surfaces | Add README or explicitly mark the workspace as internal-only |
| CI/documentation scope mismatch | workflow filters vs documented guarantees | Align docs to the actual guarantee or broaden automation |
| Incomplete link validation | current link checker treats many local file links as pending | Add a filesystem-aware validation step and rerun before closure |
| Resource map implementation drift | `docs/RESOURCE_MAP.md` vs current routes/components/hooks | Reconcile doc claims against the actual manager/editor/runtime surfaces before declaring docs current |

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
- repaired or intentionally rerouted canonical links for missing authority-level references

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
- documented CI/workflow coverage boundaries per maintained workspace

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
- resource-map/UI/runtime drift

Deliverables:

- active drift register in tracker
- triage decisions (`resolved`, `planned`, `archive`, `issue follow-up`)
- explicit owner/evidence for high-severity findings

## 2026-03-12 Execution Queue

1. Re-baseline the authority docs and inventory counts (`README.md`, `SYSTEM_MODEL.md`, `AGENTS.md`, `DOCS_INDEX.md`, `docs/README.md`).
2. Reconcile schema/security/tenancy docs against the current `131/131` migration baseline, `docs/RESOURCE_MAP.md`, and Cloudflare Worker + R2 implementation paths.
3. Re-audit script, MCP, and deployment docs against live package scripts, `.github/workflows/**`, `mcp.json`, `awcms-edge/wrangler.jsonc`, and current local validation commands.
4. Re-run package and client doc passes for `awcms/`, `awcms-edge/`, `awcms-public/**`, `awcms-mcp/`, `packages/**`, and maintained extension/mobile/ESP32 README surfaces.
5. Execute a repository conflict review for dependency drift, broken scripts, dead links, security posture, performance guidance, and stale route/component references; log every high-severity finding in the tracker.
6. Re-run validation gates, update the tracker with evidence, and only close the cycle when no unresolved high-severity documentation drift remains.

## Validation Gates

Run these before closing the cycle:

- Markdown lint:
  - `npx markdownlint-cli --config .markdownlint.json "**/*.md"`
- Link validation:
  - `cd awcms && npm run docs:check`
- Migration consistency:
  - `scripts/verify_supabase_migration_consistency.sh`
- Worker/runtime sanity for Cloudflare-first edge flows:
  - `cd awcms-edge && npm run typecheck`
  - confirm the configured Worker URL/route health (`/health`, `/functions/v1/*`, `/api/media/*`) for the active environment
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
5. Resolution plan for every open high-severity drift item, including missing docs, broken links, and version/script mismatches.

## Definition of Done

- Tier 0 and Tier 1 docs are reconciled and internally consistent.
- Package docs are updated for touched workspaces.
- Context7 verification evidence exists for revised library-facing sections.
- Validation gates pass for lint/link and relevant package checks.
- No unresolved high-severity drift items remain open in the tracker without an owner and next action.
- Canonical documentation links resolve successfully or are replaced with clearly scoped backlog references.
