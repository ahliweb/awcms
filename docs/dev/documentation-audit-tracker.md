# Documentation Audit Tracker - 2026-03-25 Re-Baseline

> Related Plan: `docs/dev/documentation-audit-plan.md`
>
> Status: Active - authority docs, schema docs, setup/deploy docs, and workspace READMEs require a fresh re-baseline against the current repository state.
>
> Last Updated: 2026-03-25

## Current Phase Status

| Phase | Status | Notes |
| --- | --- | --- |
| Phase 0 - Inventory and Authority Re-baseline | In Progress | Counts and migration inventory were refreshed; authority docs still need a complete exact-manifest pass |
| Phase 1 - Schema, Security, and Tenancy Reconciliation | In Progress | Migration parity is restored (`150/150`); schema, storage, and security docs are now being reconciled |
| Phase 2 - Scripts, Tooling, Worker Runtime, and CI/CD Reconciliation | In Progress | Worker sync/cleanup utilities and current workflow reality need documentation coverage |
| Phase 3 - Workspace and Package README Pass | Pending | Workspace READMEs and package docs need current script/version verification |
| Phase 4 - Quality and Risk Closure | Pending | Critical/high drift remains open until parity and doc coverage are restored |

## Verified Baseline Snapshot

| Surface | Current State | Evidence |
| --- | --- | --- |
| Tracked Markdown files | `146` | `git ls-files '*.md' | wc -l` |
| Tracked docs files | `84` | `git ls-files 'docs/**/*.md' | wc -l` |
| Root migrations | `150` | `ls supabase/migrations/*.sql | wc -l` |
| Mirrored migrations | `150` | `ls awcms/supabase/migrations/*.sql | wc -l` |
| GitHub workflows | `4` | `ls .github/workflows | wc -l` |
| Docs validation | Local-target and link check pass | `cd awcms && npm run docs:check` |
| Migration parity | Passing | `scripts/verify_supabase_migration_consistency.sh` |
| Edge runtime scripts | `10` | `awcms-edge/package.json` |

## Active Drift Register

| ID | Severity | Finding | Status | Evidence | Next Action |
| --- | --- | --- | --- | --- | --- |
| DOCSYNC-201 | Critical | Root/mirror migration parity had drifted because `20260325120000_add_files_permanent_delete_permission.sql` was missing from `awcms/supabase/migrations/` | Resolved 2026-03-25 | Mirrored file added; `scripts/verify_supabase_migration_consistency.sh` now passes with `150/150` | Keep parity checks in the validation gate for every migration change |
| DOCSYNC-202 | High | Audit plan/tracker still reflected the older 2026-03-22 baseline and `149/149` migration parity | Resolved 2026-03-25 | Updated both audit files to the current `150/150` baseline and current workflow/script reality | Keep counts and parity current on each pass |
| DOCSYNC-203 | High | Worker/local-dev storage docs were incomplete for reverse sync and duplicate cleanup | Resolved 2026-03-25 | `docs/dev/edge-functions.md`, `docs/dev/environment-bootstrap.md`, `docs/deploy/cloudflare.md`, `awcms-edge/README.md` now cover local/remote reconciliation behavior | Keep new Worker/runtime docs aligned when sync commands change |
| DOCSYNC-204 | High | Authority docs (`README.md`, `SYSTEM_MODEL.md`, `AGENTS.md`) still need a complete review against current manifests, migrations, and Worker/runtime behavior | In Progress | Current manifests, migration counts, new Worker routes/scripts | Finish re-baselining authority docs and align downstream runtime docs |
| DOCSYNC-205 | Medium | Docs validation passes for links, but content accuracy remains unverified for many docs; link success alone is insufficient | Open | `cd awcms && npm run docs:check` | Continue content reconciliation across docs/** and workspace READMEs |
| DOCSYNC-206 | Medium | New Worker utilities (`sync:r2:remote`, `sync:r2:local`, `sync:r2:cleanup-local`, `sync:r2:cleanup-remote`) were missing from operational docs | Resolved 2026-03-25 | `awcms-edge/README.md`, `docs/dev/edge-functions.md`, `docs/dev/environment-bootstrap.md`, and deploy docs now describe the maintained commands and local-only routes | Re-check command coverage whenever Worker scripts change |
| DOCSYNC-207 | Medium | Dependency/version review needs a fresh pass against current manifests and Context7 guidance | Open | Live manifests vs authority/workspace docs | Reconcile all major library/version claims and best-practice references |
| DOCSYNC-208 | Medium | Repository quality plan needs explicit coverage for broken/nonfunctional scripts, security risks, performance bottlenecks, dead links, and stale docs | Resolved 2026-03-25 in planning | Expanded audit plan scope and conflict matrix | Execute the new quality/risk queue and update tracker per finding |

## Commands Run During This Cycle

| Command | Result | Notes |
| --- | --- | --- |
| `git ls-files '*.md' | wc -l` | `146` | Current tracked Markdown baseline |
| `git ls-files 'docs/**/*.md' | wc -l` | `84` | Current tracked docs baseline |
| `ls .github/workflows | wc -l` | `4` | Current workflow inventory |
| `ls supabase/migrations/*.sql | wc -l` | `150` | Current root migration count |
| `ls awcms/supabase/migrations/*.sql | wc -l` | `150` | Current mirrored migration count |
| `scripts/verify_supabase_migration_consistency.sh` | Passed | Root/mirror migration parity restored (`150/150`) |
| `cd awcms && npm run docs:check` | Passed | Link validation passes; content audit still required |
| Workspace manifest extraction | Completed | React/Vite/Astro/Supabase versions re-verified from live manifests |

## Context7 Verification Log

| Library ID | Query Focus | Takeaway Applied |
| --- | --- | --- |
| `/withastro/docs` | static output, build-time envs, `getStaticPaths()` | Keep public docs static-first and centered on build-time tenant resolution |
| `/vitejs/vite/v8.0.0` | env handling, build modes, `loadEnv` guidance | Keep Vite docs aligned to Vite 8 env handling and build configuration |
| `/websites/react_dev` | React 19 modern guidance | Keep docs free of stale legacy/class-component-first guidance |
| `/supabase/supabase-js` | `createClient`, `upsert`, server-only secrets | Keep Supabase secret-key usage server-side only and document current client/server patterns |
| `/websites/developers_cloudflare_r2` | local-vs-remote R2 behavior and Wrangler object commands | Document that local `wrangler dev` R2 is isolated by default and sync requires explicit reconciliation |

## Immediate Remediation Queue

1. Finish re-baselining `README.md`, `SYSTEM_MODEL.md`, `AGENTS.md`, `DOCS_INDEX.md`, and `docs/README.md`.
2. Update Worker/storage/setup/deploy docs for the current R2 sync and cleanup lifecycle.
3. Reconcile schema/security/tenancy docs against the latest migration set and current media/storage behavior.
4. Re-run validation gates after each remediation batch.

## Closure Criteria

- Migration parity stays green.
- Authority docs match the live manifests, workflows, and runtime/tooling surface.
- Worker/storage docs cover the current local/remote sync and cleanup model accurately.
- High-severity drift items are resolved or explicitly accepted with owner and rationale.
