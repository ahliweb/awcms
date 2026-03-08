# Documentation Audit Tracker - Context7 Re-Audit

> **Date:** 2026-03-08
>
> **Related Plan:** `docs/dev/documentation-audit-plan.md`
>
> **Status:** 2026-03-08 full-scope documentation and repository-integrity cycle in progress.

## 2026-03-08 Cycle Trigger

The previous 2026-02-27 / 2026-03-03 audit surfaces were no longer sufficient as the active planning baseline.
Core authority docs still carried an outdated README status snapshot, incomplete top-level MCP wording,
and no active plan for repository-wide conflict detection across dependencies, scripts, security, performance,
dead links, and stale implementation guidance.

## Current Cycle Status

| Phase | Status | Notes |
| --- | --- | --- |
| Phase 0 - Re-Baseline and Inventory Refresh | In Progress | Baseline refreshed to current counts and topology |
| Phase 1 - Authority Reconciliation | In Progress | README snapshot, authority wording, and audit-plan surfaces updated first |
| Phase 2 - Schema, Security, and Tenancy Reconciliation | In Progress | Targeted reconciliation completed for `docs/security/**`, `docs/tenancy/**`, and `docs/architecture/database.md`; broader cycle review still open |
| Phase 3 - Scripts, Tooling, and Deployment Reconciliation | In Progress | Validation gates executed; command and parity issues now logged |
| Phase 4 - Feature, Module, and Package Documentation Pass | Pending | Feature docs and package READMEs require full pass |
| Phase 5 - Conflict Resolution and Publication | Pending | Validation gates, changelog closure, and final drift review |

## Baseline Snapshot (2026-03-08)

| Surface | Evidence |
| --- | --- |
| Total markdown files in repository | `113` (current inventory count) |
| `docs/**/*.md` | `71` (current docs inventory count) |
| Migration parity | `117` root migrations and `117` mirrored migrations |
| MCP topology | `cloudflare`, `context7`, `github`, `supabase` from `mcp.json` |
| Node baseline | `>=22.12.0`; current validated runtime in README snapshot is `v22.22.0` |
| Public runtime model | Astro static output with React islands |
| Primary edge HTTP layer | Cloudflare Workers (`awcms-edge/`) |

## Drift Register (2026-03-08)

| ID | Severity | Finding | Status | Evidence |
| --- | --- | --- | --- | --- |
| DOCSYNC-001 | High | `README.md` status snapshot was stale (`2026-02-27`) and still used Stitch as a top-level repository status signal | Resolved | `README.md` updated to `2026-03-08` snapshot and current MCP/runtime baseline |
| DOCSYNC-002 | High | Audit plan/tracker still presented the prior cycle as completed and did not provide an active full-scope plan for current repository review | Resolved | `docs/dev/documentation-audit-plan.md`, `docs/dev/documentation-audit-tracker.md` rewritten for active 2026-03-08 cycle |
| DOCSYNC-003 | Medium | Top-level documentation needed an explicit conflict-resolution workstream for dependencies, scripts, security, performance, and dead links | Resolved | New conflict matrix and validation gates added to `docs/dev/documentation-audit-plan.md` |
| DOCSYNC-004 | Medium | Authority docs needed refreshed status/baseline wording to align with current edge-runtime and MCP topology | Resolved | `README.md`, `SYSTEM_MODEL.md`, `DOCS_INDEX.md`, `AGENTS.md` |
| DOCSYNC-005 | Medium | Full per-file review of all maintained docs is not yet rerun for the 2026-03-08 cycle | Open | This tracker; execution remains pending for Phases 2-5 |
| DOCSYNC-006 | Medium | Dependency/script/security/performance conflict review has a plan but still needs execution across all maintained surfaces | Open | `docs/dev/documentation-audit-plan.md` workstreams + validation gates |
| DOCSYNC-007 | Medium | Repository-wide markdown lint still fails because the docs surface includes non-canonical package/mobile/template/content markdown that does not meet current markdownlint standards | Open | `npx markdownlint-cli --config .markdownlint.json "**/*.md" --ignore "**/node_modules/**"` |
| DOCSYNC-008 | High | Migration mirror parity is filename-drifted even though root and mirror counts are both `117` | Open | `scripts/verify_supabase_migration_consistency.sh` reports missing `20260308070000_add_cloudflare_media_schema.sql` in mirror and extra `20260307175000_move_sidebar_items.sql` in mirror |
| DOCSYNC-009 | Medium | Function parity check reports root-only transitional files not mirrored into `awcms/supabase/functions/` | Open | `scripts/verify_supabase_function_consistency.sh` reports root-only `.env` and `content-transform/index.ts` |
| DOCSYNC-010 | Medium | Public workspace validation is blocked by formatting drift in `awcms-public/primary/package.json` | Open | `npm run check` in `awcms-public/primary` fails at Prettier check |
| DOCSYNC-011 | Medium | Dependency drift exists across maintained workspaces (`awcms`, `awcms-public/primary`, `awcms-mcp`) | Open | `npm outdated` results captured in Validation Gate Results |

## Context7 Verification Log (2026-03-08 Planning Refresh)

| Library ID | Query Focus | Takeaway |
| --- | --- | --- |
| `/supabase/cli` | migration workflow, pull/push, linked safety, repair docs | Keep local vs linked commands explicit; use `db pull`, `db push --dry-run`, and migration repair guidance carefully |
| `/withastro/docs` | static output, `getStaticPaths`, build-time data, env usage | Keep public docs static-first and use `getStaticPaths`/build-time props instead of runtime-only assumptions |
| `/vitejs/vite` | `VITE_` exposure rules and `loadEnv` behavior | Preserve strict `VITE_` client exposure guidance and use `loadEnv` only at config time |
| `/cloudflare/cloudflare-docs` | Workers deployment, secrets, bindings, runtime responsibilities | Keep secrets in Wrangler-managed bindings, document `env` access, and position Workers as the primary edge HTTP layer |

## Execution Queue

### Phase 0 / 1 Completed in This Refresh

- Updated `README.md` status snapshot to the 2026-03-08 baseline.
- Removed Stitch from the top-level repository status narrative and MCP summary in README.
- Updated `SYSTEM_MODEL.md` last-updated baseline.
- Updated `AGENTS.md` documentation standards to require plan/tracker refresh for repo-wide doc changes.
- Updated `DOCS_INDEX.md` notes for the active audit plan/tracker surfaces.

### Phase 2 Progress in This Pass

- Reconciled `docs/security/abac.md` and `docs/security/rls.md` audience/runtime wording to use edge-runtime terminology instead of edge-function-only wording.
- Updated `docs/tenancy/overview.md` so the onboarding blueprint explicitly treats Supabase Edge Functions as a compatibility shape and Cloudflare Workers as the preferred production path.
- Updated `docs/tenancy/supabase.md` to document that `117/117` migration counts still require filename/content parity verification.
- Reworked the RLS section in `docs/architecture/database.md` to match the current ABAC + tenant-scoped policy model instead of older generic examples.

### Remaining Work by Phase

#### Phase 2 - Schema, Security, and Tenancy

- Re-verify `docs/architecture/database.md` against the current `117/117` migration baseline.
- Re-check `docs/security/**` and `docs/tenancy/**` against current RLS, helper-function, and edge-runtime guidance.
- Confirm package/env docs do not reintroduce secret-key or legacy key-name drift.

#### Phase 3 - Scripts, Tooling, and Deployment

- Reconcile docs with current package scripts in `awcms/`, `awcms-public/primary/`, and `awcms-mcp/`.
- Re-run migration/function verification commands and update evidence.
- Review deploy docs for Cloudflare Workers, Supabase functions, and MCP topology consistency.

#### Phase 4 - Feature, Module, and Package Docs

- Review `docs/modules/**` for backlog-vs-shipped clarity.
- Review `docs/guides/**` and package README command examples.
- Re-check feature docs for dead links and route/path drift.

#### Phase 5 - Conflict Resolution and Publication

- Run markdown lint, docs link validation, package checks, and dependency review commands from the plan.
- Update `CHANGELOG.md` with closure notes if additional doc surfaces change.
- Close or reclassify all high-severity findings.

## Conflict Review Matrix

| Conflict Class | Current State | Next Action |
| --- | --- | --- |
| Outdated dependencies | Planning coverage exists; execution pending | Run `npm outdated` in maintained workspaces and reconcile docs/version claims |
| Broken or nonfunctional scripts | Partial reconciliation already completed in prior cycle | Revalidate documented commands against active scripts in Phase 3 |
| Security risks | Key naming and edge-runtime wording improved in authority docs | Re-scan env examples, auth docs, and security docs repo-wide in Phase 2 |
| Performance issues | Public/admin guidance partially aligned | Re-review public/admin performance docs against current architecture in Phase 4 |
| Dead links / stale navigation | Top-level routing surfaces refreshed | Run link checks and package README routing pass in Phase 5 |
| Stale backlog/checklists | Some checklist-style docs remain | Explicitly classify backlog/historical vs canonical docs during feature pass |

## Validation Gate Results (2026-03-08)

| Gate | Result | Notes |
| --- | --- | --- |
| Markdown lint (`**/*.md`) | Failed | Initial run included vendored `awcms-edge/node_modules/**`; scoped rerun still reports non-canonical markdown debt in `awcms-mobile-java/docs/**`, template docs, public content markdown, and temp/debug surfaces |
| Docs link validation (`cd awcms && npm run docs:check`) | Passed | Local file links resolve as expected; `markdown-link-check` shows filesystem links as pending `[ / ]` while still completing successfully |
| Migration consistency (`scripts/verify_supabase_migration_consistency.sh`) | Failed | Counts are `117/117`, but filenames are drifted between root and mirror |
| Function consistency (`scripts/verify_supabase_function_consistency.sh`) | Failed | Root contains transitional files not mirrored in `awcms/supabase/functions/` |
| Admin package sanity (`cd awcms && npm run lint && npm run build`) | Passed with warnings | ESLint reports warnings only; production build succeeds |
| Public package sanity (`cd awcms-public/primary && npm run check`) | Failed | `astro check` and ESLint pass, but Prettier check fails on `package.json` |
| Public build (`cd awcms-public/primary && npm run build`) | Passed | Astro build succeeds with static output and Cloudflare adapter |
| MCP package sanity (`cd awcms-mcp && npm run lint && npm run build`) | Passed | Lint and TypeScript build succeed |
| Dependency review (`npm outdated`) | Findings logged | Admin, public, and MCP workspaces all have upgrade candidates |

## Dependency Drift Snapshot (2026-03-08)

- `awcms`: notable drift includes `@supabase/supabase-js`, Tailwind v4 packages, TipTap packages, `react-router-dom`, `recharts`, and `framer-motion`
- `awcms-public/primary`: notable drift includes `astro`, `@astrojs/rss`, `@astrojs/sitemap`, `@supabase/supabase-js`, Tailwind v4 packages, and ESLint/TypeScript-eslint packages
- `awcms-mcp`: notable drift includes `@modelcontextprotocol/sdk`, `@types/pg`, and ESLint

## Historical Note

The previous 2026-02-27 and 2026-03-03 documentation audit cycles remain part of project history and changelog evidence.
This tracker now treats 2026-03-08 as the active operational baseline for the next full repository review.
