# Documentation Audit Tracker - 2026-03-29 Re-Baseline

> Related Plan: `docs/dev/documentation-audit-plan.md`
>
> Status: Active - 2026-03-29 sync cycle in progress. Authority docs are re-checked, and content accuracy reconciliation remains active across all 90 docs files.
>
> Last Updated: 2026-03-29

## Current Phase Status

| Phase | Status | Notes |
| --- | --- | --- |
| Phase 0 - Inventory and Authority Re-baseline | Completed | Counts, migration inventory, and active MCP topology were refreshed against live manifests and `mcp.json` |
| Phase 1 - Schema, Security, and Tenancy Reconciliation | In Progress | Migration parity is restored (`152/152`); schema, storage, and security docs are being reconciled against live migrations and runtime paths |
| Phase 2 - Scripts, Tooling, Worker Runtime, and CI/CD Reconciliation | In Progress | Worker/runtime docs are being aligned to Cloudflare Workers, current env naming, and compatibility paths |
| Phase 3 - Workspace and Package README Pass | In Progress | ESP32 and package-level README accuracy is under active review |
| Phase 4 - Quality and Risk Closure | Pending | Critical/high drift remains open until parity and doc coverage are restored |

## Verified Baseline Snapshot

| Surface | Current State | Evidence |
| --- | --- | --- |
| Tracked Markdown files | `686` | `git ls-files '*.md' \| wc -l` |
| Tracked docs files | `90` | `git ls-files 'docs/**/*.md' \| wc -l` |
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
| DOCSYNC-204 | High | Authority docs (`README.md`, `SYSTEM_MODEL.md`, `AGENTS.md`) needed a complete review against current manifests, migrations, and Worker/runtime behavior | Resolved 2026-03-29 | README inventory/MCP topology and AGENTS benchmark wording were refreshed against live manifests and Worker routes | Re-run on every new dependency or MCP topology change |
| DOCSYNC-205 | Medium | Docs validation passes for links, but content accuracy remains unverified for many docs | Open | `cd awcms && npm run docs:check` | Continue content reconciliation across `docs/**` and workspace READMEs |
| DOCSYNC-206 | Medium | New Worker utilities (`sync:r2:remote`, `sync:r2:local`, `sync:r2:cleanup-local`, `sync:r2:cleanup-remote`) were missing from operational docs | Resolved 2026-03-25 | Edge, environment, and deploy docs updated | Re-check command coverage when Worker scripts change |
| DOCSYNC-207 | Medium | Dependency/version review needed a fresh pass against current manifests | Resolved 2026-03-29 | Wrangler `^4.77.0` added to `tech-stack.md` and `AGENTS.md`; TipTap package list corrected; all key versions verified against live manifests | Re-run when manifests change |
| DOCSYNC-208 | Medium | Repository quality plan needed explicit coverage for broken scripts, security risks, dead links, and stale docs | Resolved 2026-03-25 in planning | Expanded audit plan scope and conflict matrix | Execute quality/risk queue and update tracker per finding |
| DOCSYNC-NEW-01 | High | Audit baseline counts drifted again; live inventory is `686` tracked Markdown files, `90` docs files, and `152/152` mirrored migrations | Resolved 2026-03-29 | `git ls-files` and migration inventory were re-verified against the current repo | Update tracker counts on each sync cycle |
| DOCSYNC-NEW-02 | High | `paper` MCP server was listed as connected in SYSTEM_MODEL.md §1.6 but is `enabled: false` in `mcp.json` | Resolved 2026-03-29 | `SYSTEM_MODEL.md` §1.6 updated to mark paper as disabled | Re-check `mcp.json` vs SYSTEM_MODEL.md on every MCP topology change |
| DOCSYNC-NEW-03 | Medium | `@tiptap/core` listed as single dependency in AGENTS.md tech table; actual installed packages are 7 specific extensions | Resolved 2026-03-29 | AGENTS.md tech table and `docs/architecture/tech-stack.md` corrected | Re-check on TipTap version bumps |
| DOCSYNC-NEW-04 | Medium | Wrangler `^4.77.0` (edge CLI) not mentioned in any documentation | Resolved 2026-03-29 | Added to AGENTS.md tech table and `docs/architecture/tech-stack.md` | Re-check on wrangler version bumps |
| DOCSYNC-NEW-05 | Medium | GitHub MCP `--toolsets=default,git` restriction not documented | Resolved 2026-03-29 | SYSTEM_MODEL.md §1.6 updated; release summary added | Re-check when `scripts/start_github_mcp.sh` args change |
| DOCSYNC-NEW-06 | Low | `testing.md` only covered Admin/Public/Mobile; Edge, MCP, Smandapbun, Shared workspaces were missing | Resolved 2026-03-29 | `docs/dev/testing.md` expanded with all maintained workspace coverage | Expand when new workspaces are added to CI |
| DOCSYNC-NEW-07 | Low | No release summary existed for the MCP optimization work (March 2026) | Resolved 2026-03-29 | `docs/dev/release-summary-2026-03-mcp-optimization.md` created | Follow the release summary pattern for future tooling changes |
| DOCSYNC-NEW-08 | High | ESP32 and benchmark docs referenced `/functions/v1/device-config` as an implemented Worker route, but `awcms-edge/src/index.ts` does not currently expose that endpoint | Resolved 2026-03-29 | `docs/dev/esp32.md`, `docs/dev/context7-benchmark-playbook.md`, and `AGENTS.md` were reframed to treat that route as example compatibility guidance only; `awcms-esp32/primary/README.md` now documents the current direct Supabase firmware behavior | If a live device route is added later, document the exact endpoint and auth contract |
| DOCSYNC-NEW-09 | High | `.agents/rules/edge-function-safety.md` still described Supabase Edge Functions as the maintained backend runtime | Resolved 2026-03-29 | Rule updated to point at `awcms-edge/src/**/*.ts` and the Cloudflare Worker-first runtime | Re-check when runtime boundaries change |
| DOCSYNC-NEW-10 | Medium | `.agents/rules/no-secrets-ever.md` still used legacy key names (`VITE_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) | Resolved 2026-03-29 | Rule updated to `VITE_SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY` terminology | Re-check when env naming changes |
| DOCSYNC-NEW-11 | Medium | `docs/architecture/tech-stack.md` mobile dependency versions drifted from `awcms-mobile/primary/pubspec.yaml` | Resolved 2026-03-29 | Riverpod/Drift/GoRouter versions refreshed from the live manifest | Re-run when the Flutter manifest changes |

## Commands Run During This Cycle

| Command | Result | Notes |
| --- | --- | --- |
| `git ls-files '*.md' \| wc -l` | `686` | Tracked Markdown count at 2026-03-29 baseline |
| `git ls-files 'docs/**/*.md' \| wc -l` | `90` | Tracked docs count at 2026-03-29 baseline |
| `ls .github/workflows \| wc -l` | `4` | Current workflow inventory |
| `ls supabase/migrations/*.sql \| wc -l` | `152` | Root migration count at 2026-03-29 baseline |
| `ls awcms/supabase/migrations/*.sql \| wc -l` | `152` | Mirrored migration count at 2026-03-29 baseline |
| `scripts/verify_supabase_migration_consistency.sh` | Not re-run in this pass | Existing tracker baseline remains `152/152`; re-run after doc edits if migration docs change materially |
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

1. Re-run validation gates after the current documentation patch batch.
2. Continue reviewing remaining workspace READMEs and lower-priority module docs for content-only drift.
3. Track the ESP32 direct-Supabase-vs-Worker-runtime split as an implementation follow-up if the firmware architecture is standardized later.

## Closure Criteria

- Migration parity stays green.
- Authority docs match the live manifests, workflows, and runtime/tooling surface.
- Worker/storage docs cover the current local/remote sync and cleanup model accurately.
- High-severity drift items are resolved or explicitly accepted with owner and rationale.
