# Documentation Audit Tracker - 2026-03-29 Re-Baseline

> Related Plan: `docs/dev/documentation-audit-plan.md`
>
> Status: Active - 2026-03-29 sync cycle complete for authority docs and MCP topology. Content accuracy audit across all 88 docs files remains ongoing.
>
> Last Updated: 2026-03-29

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
| Tracked Markdown files | `150` | `git ls-files '*.md' \| wc -l` (was `146` at 2026-03-25) |
| Tracked docs files | `88` | `git ls-files 'docs/**/*.md' \| wc -l` (was `84` at 2026-03-25) |
| Root migrations | `152` | `ls supabase/migrations/*.sql \| wc -l` (was `150` at 2026-03-25) |
| Mirrored migrations | `152` | `ls awcms/supabase/migrations/*.sql \| wc -l` (was `150` at 2026-03-25) |
| GitHub workflows | `4` | `ls .github/workflows \| wc -l` |
| Docs validation | Local-target and link check pass | `cd awcms && npm run docs:check` |
| Migration parity | Passing | `scripts/verify_supabase_migration_consistency.sh` |
| Edge runtime scripts | `10` | `awcms-edge/package.json` |
| MCP servers (active) | `4` | `mcp.json` — context7, supabase, github, cloudflare; paper disabled |

## Active Drift Register

| ID | Severity | Finding | Status | Evidence | Next Action |
| --- | --- | --- | --- | --- | --- |
| DOCSYNC-201 | Critical | Root/mirror migration parity had drifted because `20260325120000_add_files_permanent_delete_permission.sql` was missing from `awcms/supabase/migrations/` | Resolved 2026-03-25 | Mirrored file added; parity script passes | Keep parity checks in the validation gate |
| DOCSYNC-202 | High | Audit plan/tracker still reflected the older 2026-03-22 baseline and `149/149` migration parity | Resolved 2026-03-25 | Updated both audit files to `150/150` baseline | Keep counts and parity current on each pass |
| DOCSYNC-203 | High | Worker/local-dev storage docs were incomplete for reverse sync and duplicate cleanup | Resolved 2026-03-25 | `docs/dev/edge-functions.md`, `docs/dev/environment-bootstrap.md`, `docs/deploy/cloudflare.md`, `awcms-edge/README.md` updated | Keep Worker/runtime docs aligned when sync commands change |
| DOCSYNC-204 | High | Authority docs (`README.md`, `SYSTEM_MODEL.md`, `AGENTS.md`) needed a complete review against current manifests, migrations, and Worker/runtime behavior | Resolved 2026-03-29 | MCP topology (paper disabled, GitHub toolsets), migration count (152), Wrangler version, TipTap packages all updated in this cycle | Re-run on every new dependency or MCP topology change |
| DOCSYNC-205 | Medium | Docs validation passes for links, but content accuracy remains unverified for many docs | Open | `cd awcms && npm run docs:check` | Continue content reconciliation across `docs/**` and workspace READMEs |
| DOCSYNC-206 | Medium | New Worker utilities (`sync:r2:remote`, `sync:r2:local`, `sync:r2:cleanup-local`, `sync:r2:cleanup-remote`) were missing from operational docs | Resolved 2026-03-25 | Edge, environment, and deploy docs updated | Re-check command coverage when Worker scripts change |
| DOCSYNC-207 | Medium | Dependency/version review needed a fresh pass against current manifests | Resolved 2026-03-29 | Wrangler `^4.77.0` added to `tech-stack.md` and `AGENTS.md`; TipTap package list corrected; all key versions verified against live manifests | Re-run when manifests change |
| DOCSYNC-208 | Medium | Repository quality plan needed explicit coverage for broken scripts, security risks, dead links, and stale docs | Resolved 2026-03-25 in planning | Expanded audit plan scope and conflict matrix | Execute quality/risk queue and update tracker per finding |
| DOCSYNC-NEW-01 | High | Audit tracker baseline counts showed 146 MD / 84 docs / 150 migrations; live counts are 150 / 88 / 152 | Resolved 2026-03-29 | `git ls-files` and `ls supabase/migrations/` re-verified | Update tracker counts on each sync cycle |
| DOCSYNC-NEW-02 | High | `paper` MCP server was listed as connected in SYSTEM_MODEL.md §1.6 but is `enabled: false` in `mcp.json` | Resolved 2026-03-29 | `SYSTEM_MODEL.md` §1.6 updated to mark paper as disabled | Re-check `mcp.json` vs SYSTEM_MODEL.md on every MCP topology change |
| DOCSYNC-NEW-03 | Medium | `@tiptap/core` listed as single dependency in AGENTS.md tech table; actual installed packages are 7 specific extensions | Resolved 2026-03-29 | AGENTS.md tech table and `docs/architecture/tech-stack.md` corrected | Re-check on TipTap version bumps |
| DOCSYNC-NEW-04 | Medium | Wrangler `^4.77.0` (edge CLI) not mentioned in any documentation | Resolved 2026-03-29 | Added to AGENTS.md tech table and `docs/architecture/tech-stack.md` | Re-check on wrangler version bumps |
| DOCSYNC-NEW-05 | Medium | GitHub MCP `--toolsets=default,git` restriction not documented | Resolved 2026-03-29 | SYSTEM_MODEL.md §1.6 updated; release summary added | Re-check when `scripts/start_github_mcp.sh` args change |
| DOCSYNC-NEW-06 | Low | `testing.md` only covered Admin/Public/Mobile; Edge, MCP, Smandapbun, Shared workspaces were missing | Resolved 2026-03-29 | `docs/dev/testing.md` expanded with all maintained workspace coverage | Expand when new workspaces are added to CI |
| DOCSYNC-NEW-07 | Low | No release summary existed for the MCP optimization work (March 2026) | Resolved 2026-03-29 | `docs/dev/release-summary-2026-03-mcp-optimization.md` created | Follow the release summary pattern for future tooling changes |

## Commands Run During This Cycle

| Command | Result | Notes |
| --- | --- | --- |
| `git ls-files '*.md' \| wc -l` | `150` | Tracked Markdown count at 2026-03-29 baseline |
| `git ls-files 'docs/**/*.md' \| wc -l` | `88` | Tracked docs count at 2026-03-29 baseline |
| `ls .github/workflows \| wc -l` | `4` | Current workflow inventory |
| `ls supabase/migrations/*.sql \| wc -l` | `152` | Root migration count at 2026-03-29 baseline |
| `ls awcms/supabase/migrations/*.sql \| wc -l` | `152` | Mirrored migration count at 2026-03-29 baseline |
| `scripts/verify_supabase_migration_consistency.sh` | Passed | Root/mirror migration parity (`152/152`) |
| `cd awcms && npm run docs:check` | Passed | Link validation passes; content audit still required |
| Workspace manifest extraction | Completed | React/Vite/Astro/Supabase/Wrangler versions re-verified from live manifests |

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
