# Repository Documentation Audit and Remediation Plan (Context7-First)

> Owner: Documentation Steward (AI + Maintainers)
>
> Audit Cycle: 2026-03-25 full repository re-baseline
>
> Last Updated: 2026-03-25
>
> Primary Authority Chain: `SYSTEM_MODEL.md` -> `AGENTS.md` -> `README.md` -> `DOCS_INDEX.md` -> implementation/package docs

## Mission

Audit every maintained documentation surface in the repository, reconcile each claim against the live
codebase, database migrations, scripts, workflows, package manifests, and operational commands, and use
Context7 as the primary external reference for library-specific best practices.

This cycle explicitly covers:

- authority-doc drift in `SYSTEM_MODEL.md`, `AGENTS.md`, `README.md`, `DOCS_INDEX.md`, and `docs/README.md`
- schema and migration drift between `supabase/migrations/` and `awcms/supabase/migrations/`
- script drift across workspace/package scripts, `scripts/**`, and new Worker sync/cleanup utilities
- security wording drift around secrets, RLS, ABAC, Workers, local dev, and Cloudflare R2 sync workflows
- performance guidance drift across Admin, Public, Worker, Mobile, and IoT docs
- dead links, stale navigation, and missing canonical references
- dependency/version drift against live manifests and current Context7 guidance
- implementation drift where docs no longer match current runtime behavior, current database shape, or current edge/storage flows

## Current Baseline (Verified 2026-03-25)

| Surface | Verified State | Evidence Source |
| --- | --- | --- |
| Tracked Markdown files | `146` | `git ls-files '*.md' | wc -l` |
| Tracked docs files | `84` | `git ls-files 'docs/**/*.md' | wc -l` |
| Root Supabase migrations | `150` | `ls supabase/migrations/*.sql | wc -l` |
| Mirrored admin/CI migrations | `150` | `ls awcms/supabase/migrations/*.sql | wc -l` |
| GitHub workflows | `4` | `ls .github/workflows | wc -l` |
| Admin package scripts | `11` | `awcms/package.json` |
| Public primary package scripts | `13` | `awcms-public/primary/package.json` |
| Public SMANDAPBUN package scripts | `8` | `awcms-public/smandapbun/package.json` |
| Edge package scripts | `10` | `awcms-edge/package.json` |
| Docs validation | Passes link scan, but many docs still require content re-baselining | `cd awcms && npm run docs:check` |
| Migration parity | Passing | `scripts/verify_supabase_migration_consistency.sh` |

## Authority Policy for This Cycle

- Authority docs must record exact installed versions from live manifests, not rounded series labels or aspirational targets.
- `SYSTEM_MODEL.md`, `AGENTS.md`, and `README.md` must match the active repository state before downstream docs are edited.
- Context7 remains the primary external source for library-specific best practices, but repository manifests, workflows, migrations, and scripts remain the source of truth for what AWCMS currently runs.
- Historical release summaries and older audit docs must either be reconciled to the current repo state or clearly labeled as archival snapshots.

## Critical Findings Driving This Cycle

| ID | Severity | Finding | Evidence | Required Action |
| --- | --- | --- | --- | --- |
| PLAN-301 | Resolved | Migration mirror parity was restored: root migrations and mirrored migrations are both `150` | `scripts/verify_supabase_migration_consistency.sh` now passes after mirroring `20260325120000_add_files_permanent_delete_permission.sql` into `awcms/supabase/migrations/` | Keep parity verification in the standard validation gate |
| PLAN-302 | Resolved | Documentation audit docs were re-baselined from the older 2026-03-22/2026-03-13 snapshot | `docs/dev/documentation-audit-plan.md`, `docs/dev/documentation-audit-tracker.md` now track the 2026-03-25 cycle | Keep counts, workflow inventory, and parity status current on each pass |
| PLAN-303 | High | Worker operational docs do not yet treat reverse R2 sync and duplicate cleanup as part of the maintained runtime/tooling surface | `awcms-edge/package.json` now includes `sync:r2:local`, `sync:r2:cleanup-local`, `sync:r2:cleanup-remote` | Update Worker, setup, deploy, and storage docs for current local/remote reconciliation workflows |
| PLAN-304 | High | Repository-wide docs still need a systematic pass for schema accuracy, script validity, dependency drift, dead links, and security wording | `README.md`, `AGENTS.md`, `SYSTEM_MODEL.md`, `DOCS_INDEX.md`, `docs/**`, workspace READMEs | Execute a fresh full-doc audit using current manifests, migrations, workflows, and Context7 guidance |
| PLAN-305 | Medium | Local/remote R2 behavior and reconciliation steps were undocumented until the new sync utilities landed | `awcms-edge/README.md`, recent Worker/runtime changes | Cascade the current R2 sync/cleanup model into relevant setup, edge, deploy, and storage docs |
| PLAN-306 | Medium | Docs validation passes for links, but link-check output alone does not guarantee content accuracy or script validity | `cd awcms && npm run docs:check` | Treat link validation as one gate only; add explicit schema/script/workflow review tasks in the audit execution queue |

## Context7 Validation Matrix

| Surface | Library ID | Current Guidance Used In This Cycle |
| --- | --- | --- |
| Supabase JS client usage | `/supabase/supabase-js` | Use `createClient(...)`, `upsert(...)`, and keep `SUPABASE_SECRET_KEY` server-side only |
| Astro static builds | `/withastro/docs` | Keep public docs static-first, use build-time env values, and align route guidance with `getStaticPaths()` |
| Cloudflare Workers / R2 | `/cloudflare/cloudflare-docs` and `/websites/developers_cloudflare_r2` | Document local-vs-remote R2 behavior explicitly; local `wrangler dev` storage is isolated unless remote bindings are enabled |
| React | `/websites/react_dev` | Keep docs aligned to React 19 modern patterns and remove stale legacy guidance |
| Vite | `/vitejs/vite/v8.0.0` | Keep env handling and build guidance aligned to Vite 8 (`loadEnv`, `VITE_` exposure, quoted env values when needed) |

## Scope

### In Scope

| Tier | Paths | Purpose |
| --- | --- | --- |
| Tier 0 - Authority | `SYSTEM_MODEL.md`, `AGENTS.md`, `README.md`, `DOCS_INDEX.md`, `docs/README.md` | Canonical architecture, operational baseline, doc routing |
| Tier 1 - Core docs | `docs/architecture/**`, `docs/security/**`, `docs/tenancy/**`, `docs/deploy/**`, `docs/dev/**`, `docs/modules/**`, `docs/product/**`, `docs/guides/**`, `docs/compliance/**` | Implementation guides, runbooks, product docs, ops docs |
| Tier 2 - Package docs | `**/README.md` for maintained workspaces/packages | Workspace setup, runtime notes, script accuracy |
| Tier 3 - Truth sources | `supabase/**`, `awcms/supabase/**`, `awcms-edge/**`, `scripts/**`, `.github/workflows/**`, workspace manifests, `pubspec.yaml`, `mcp.json` | Evidence used for reconciliation |

### Out of Scope

- Vendored, generated, or upstream template docs that are not part of the maintained canonical surface.
- Binary assets and non-Markdown deliverables.

## Audit Workflow

### Phase 0 - Inventory and Authority Re-baseline

1. Refresh counts, workflows, migration inventory, and active status snapshots.
2. Correct `SYSTEM_MODEL.md`, `AGENTS.md`, `README.md`, `DOCS_INDEX.md`, and `docs/README.md` first.
3. Use exact installed versions from manifests and live script inventories.
4. Re-open the tracker with current contradictions, missing coverage, and structural drift.

### Phase 1 - Schema, Security, and Tenancy Reconciliation

1. Keep root/mirror migration parity green while reconciling docs.
2. Reconcile schema, tenancy, and security docs against current migrations and helper functions.
3. Verify soft-delete, `tenant_id`, RLS, ABAC, permission naming, and secret-naming guidance.
4. Ensure Worker/storage docs match the current Cloudflare R2 + Supabase metadata model.

### Phase 2 - Scripts, Tooling, Worker Runtime, and CI/CD Reconciliation

1. Validate every documented command against `package.json`, `scripts/**`, and new Worker operational utilities.
2. Reconcile docs with the active four-workflow GitHub Actions setup.
3. Reconcile deployment/security docs with current Cloudflare account resolution, Worker secret handling, and R2 sync/cleanup workflows.
4. Explicitly document local-only vs remote-only commands and known intentional divergences.

### Phase 3 - Workspace and Package README Pass

1. Verify workspace-specific versions and commands from live manifests.
2. Update package READMEs to link back to canonical docs and current commands.
3. Reconcile release summaries and historical audit docs that still read like current guidance.
4. Remove stale claims copied from older stack baselines.

### Phase 4 - Quality and Risk Closure Pass

1. Review for outdated dependencies, broken or nonfunctional scripts, security risks, performance bottlenecks, dead links, and dead/stale docs.
2. Mark each finding as `resolved`, `accepted divergence`, `follow-up required`, or `blocked`.
3. Do not close the cycle while any critical/high-severity drift remains unresolved or undocumented.

## Conflict Review Matrix

| Conflict Class | Detection Method | Exit Criteria |
| --- | --- | --- |
| Version drift | Compare docs to `package.json` / `pubspec.yaml` / lockfiles | Authority and package docs match live manifests |
| Migration drift | Run `scripts/verify_supabase_migration_consistency.sh` and inspect current migrations | Root/mirror parity restored or divergence explicitly documented |
| Script drift | Compare docs to workspace scripts and `scripts/**` | Every documented command exists and reflects current behavior |
| Security drift | Review env naming, key handling, auth, RLS, Worker docs, and storage sync flows | No doc instructs unsafe secret handling or RLS bypass |
| Performance drift | Compare docs to current admin/public/Worker architecture | Performance guidance matches the current static-first and Worker-backed model |
| Dead links | Run `cd awcms && npm run docs:check` | Canonical docs link only to valid maintained targets |
| Historical drift | Review release summaries and older audit docs against current repo reality | Historical docs are either reconciled or clearly archival |
| Storage/runtime drift | Compare docs to current Cloudflare R2 local/remote behavior and Worker scripts | R2 sync/cleanup/local-dev behavior is documented accurately |

## Execution Queue

1. Re-baseline authority docs and package/version references.
2. Update the tracker with the current `150/150` migration baseline and current workflow/script inventory.
3. Keep `20260325120000_add_files_permanent_delete_permission.sql` mirrored in `awcms/supabase/migrations/` and verify parity after each migration change.
4. Reconcile Worker/runtime docs for `sync:r2:remote`, `sync:r2:local`, `sync:r2:cleanup-local`, and `sync:r2:cleanup-remote`.
5. Audit schema/security/tenancy docs against the latest migrations and current storage/media behavior.
6. Re-run workspace README and setup/deploy docs against current scripts and env flows.
7. Re-run validation gates after each remediation batch.
8. Close the cycle only after critical/high findings are resolved or explicitly accepted with owner and rationale.

## Validation Gates

| Gate | Command | Expected Result |
| --- | --- | --- |
| Docs links | `cd awcms && npm run docs:check` | Pass |
| Migration parity | `scripts/verify_supabase_migration_consistency.sh` | Pass |
| Admin sanity | `cd awcms && npm run lint && npm run build` | Pass when admin docs/scripts change materially |
| Public sanity | `cd awcms-public/primary && npm run check && npm run build` | Pass when public docs/env guidance change materially |
| Worker sanity | `cd awcms-edge && npm run typecheck` | Pass when Worker/runtime docs or scripts change materially |
| Workflow reality | Review `.github/workflows/*.yml` plus GitHub MCP state | Docs match active CI/deploy behavior |

## Deliverables

- Updated authority docs that match the live repository state.
- A live tracker with evidence-backed findings and owners.
- Reconciled Worker/storage/runtime docs for current R2 sync and cleanup behavior.
- Corrected package/public/admin/deploy docs for current versions, scripts, and env flows.
- A clear remediation path for migration parity, dependency drift, script accuracy, security wording, performance guidance drift, and dead-link/content drift.
