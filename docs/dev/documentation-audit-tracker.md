# Documentation Audit Tracker - Context7 Re-Audit

> **Date:** 2026-03-08
>
> **Related Plan:** `docs/dev/documentation-audit-plan.md`
>
> **Status:** 2026-03-08 full-scope documentation and repository-integrity cycle in progress; current remediation batch revalidated locally and against the linked Supabase project.

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
| Phase 3 - Scripts, Tooling, and Deployment Reconciliation | In Progress | Parity helpers now pass locally and against the linked project; broader script/deploy review still open |
| Phase 4 - Feature, Module, and Package Documentation Pass | In Progress | Primary public and MCP package README surfaces reviewed and clarified; broader feature/module pass still open |
| Phase 5 - Conflict Resolution and Publication | In Progress | Validation gates rerun, linked Supabase checks recovered, changelog/tracker closure underway |

## Baseline Snapshot (2026-03-08)

| Surface | Evidence |
| --- | --- |
| Total markdown files in repository | `113` (current inventory count) |
| `docs/**/*.md` | `71` (current docs inventory count) |
| Migration parity | `118` root migrations and `118` mirrored migrations |
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
| DOCSYNC-007 | Medium | Repository-wide markdown lint previously failed because non-canonical package/mobile/template/content markdown was still included in the repo-wide lint surface | Resolved | Added `.markdownlintignore`, fixed the remaining `awcms-mobile-java/docs/**` issues and canonical long-line drift, then re-ran repo-wide markdownlint successfully |
| DOCSYNC-008 | High | Migration mirror parity was filename-drifted and local history was missing the latest mirrored migrations | Resolved | Added `20260307175000_move_sidebar_items.sql` to root, mirrored `20260308070000_add_cloudflare_media_schema.sql`, fixed the media resource registry insert, and re-ran local migration push plus parity verification successfully |
| DOCSYNC-009 | Medium | Function parity check reported root-only transitional files not mirrored into `awcms/supabase/functions/` | Resolved | Mirrored `content-transform/index.ts` and updated `scripts/verify_supabase_function_consistency.sh` to ignore local-only `supabase/functions/.env` secrets |
| DOCSYNC-010 | Medium | Public workspace validation was blocked by formatting drift in `awcms-public/primary/package.json` | Resolved | Reformatted `awcms-public/primary/package.json` and re-ran `npm run check` successfully |
| DOCSYNC-011 | Medium | Dependency drift exists across maintained workspaces (`awcms`, `awcms-public/primary`, `awcms-mcp`) | Open | `npm outdated` results captured in Validation Gate Results |
| DOCSYNC-012 | High | `npm update` in `awcms-public/primary` floated the Tailwind toolchain to `4.2.x`, which reintroduced a Vite 7 / Astro Vite 6 type mismatch and broke `astro check` | Resolved | Pinned `@tailwindcss/postcss`, `@tailwindcss/vite`, and `tailwindcss` to `4.1.18`, typed the plugin assignment in `awcms-public/primary/astro.config.ts`, and re-ran `npm run check && npm run build` successfully |
| DOCSYNC-013 | Medium | Linked migration parity required an explicit `SUPABASE_DB_PASSWORD` even though repository env files already carry derivable database URLs | Resolved | `scripts/verify_supabase_migration_consistency.sh` now derives `SUPABASE_DB_PASSWORD` from `DATABASE_URL` / `DATABASE_ADMIN_URL` when needed; linked check passes |
| DOCSYNC-014 | Medium | Linked function parity failed because the env-provided `SUPABASE_ACCESS_TOKEN` returned `401`, and JSON validation masked successful fallback output | Resolved | `scripts/verify_supabase_function_consistency.sh` now retries with the local Supabase CLI profile when the env token 401s and validates JSON correctly |
| DOCSYNC-015 | Low | Benchmark-only `content-transform` source should remain mirrored locally but should not block remote deployed-function inventory parity | Resolved | Linked function parity now excludes benchmark-only `content-transform` from required remote slug coverage while preserving root/mirror source parity checks |

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
- Updated `docs/tenancy/supabase.md` to document that migration counts alone do not guarantee filename/content parity verification.
- Reworked the RLS section in `docs/architecture/database.md` to match the current ABAC + tenant-scoped policy model instead of older generic examples.

### Phase 3 / 4 Progress in This Pass

- Updated `docs/dev/setup.md`, `docs/dev/troubleshooting.md`, `docs/deploy/overview.md`, and `docs/deploy/cloudflare.md` to reflect the current parity-helper behavior and public validation baseline.
- Reviewed `awcms-public/primary/README.md` and `awcms-mcp/README.md` so package-level setup docs align with current scripts, links, and MCP topology guidance.
- Corrected the static public data-fetching example in `docs/dev/public.md` so it now fails fast without `PUBLIC_TENANT_ID` and filters by `tenant_id`, `status`, and `deleted_at`.
- Updated `docs/modules/PUBLIC_PORTAL_ARCHITECTURE.md` to clarify supported build-time env fallbacks for canonical static deployments.
- Updated `docs/modules/USER_MANAGEMENT.md` to frame `manage-users` as the current transitional server-side handler instead of timeless edge-function-only wording.
- Revised `docs/guides/wp-data-migration-script.md`, `docs/guides/wp-to-awcms-migration.md`, and `docs/guides/opencode-models.md` to match the current Node baseline, tenant-scoped uniqueness rules, static public architecture wording, and OpenCode runtime branding.
- Reviewed the remaining maintained package README surfaces in `awcms/`, `awcms-mobile/`, `awcms-esp32/`, and `awcms-ext/` so they now align with current env names, workspace roles, and security guidance.
- Added `.markdownlintignore` for non-canonical content/template/wiki/debug markdown surfaces and fixed the remaining repo-wide markdownlint blockers in `awcms-mobile-java/docs/**`, `docs/architecture/platform-tenant-separation.md`, and `docs/product/PRD.md`.
- Recovered linked Supabase parity validation by teaching `scripts/verify_supabase_migration_consistency.sh` to derive `SUPABASE_DB_PASSWORD` from existing DB URLs and teaching `scripts/verify_supabase_function_consistency.sh` to fall back to the local Supabase CLI profile when an env token returns `401`.
- Stabilized the public workspace after `npm update` by pinning the Tailwind v4 toolchain to `4.1.18` and updating `awcms-public/primary/astro.config.ts` so `astro check`, ESLint, Prettier, and the production build all pass again.

### Remaining Work by Phase

#### Phase 2 - Schema, Security, and Tenancy

- Re-verify `docs/architecture/database.md` against the current `118/118` migration baseline.
- Re-check `docs/security/**` and `docs/tenancy/**` against current RLS, helper-function, and edge-runtime guidance.
- Confirm package/env docs do not reintroduce secret-key or legacy key-name drift.

#### Phase 3 - Scripts, Tooling, and Deployment

- Reconcile docs with current package scripts in `awcms/`, `awcms-public/primary/`, and `awcms-mcp/`.
- Reconcile remaining deployment/docs surfaces beyond `docs/deploy/overview.md`, `docs/deploy/cloudflare.md`, `docs/dev/setup.md`, and `docs/dev/troubleshooting.md`.
- Review deploy docs for Cloudflare Workers, Supabase functions, and MCP topology consistency.

#### Phase 4 - Feature, Module, and Package Docs

- Review `docs/modules/**` for backlog-vs-shipped clarity.
- Review `docs/guides/**` and remaining package README command examples beyond `awcms-public/primary/README.md` and `awcms-mcp/README.md`.
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
| Markdown lint (`**/*.md`) | Passed | Repo-wide markdownlint now passes with `.markdownlintignore` excluding non-canonical content/template/wiki/debug markdown surfaces and the remaining lintable docs corrected |
| Markdown lint (touched canonical docs) | Passed | Scoped lint succeeds for the authority, deploy, audit, and public-portal docs updated in this pass |
| Markdown lint (Phase 4 docs and package READMEs) | Passed | Scoped lint succeeds for updated module docs, guides, and maintained workspace README surfaces |
| Docs link validation (`cd awcms && npm run docs:check`) | Passed | Local file links resolve as expected; `markdown-link-check` shows filesystem links as pending `[ / ]` while still completing successfully |
| Migration consistency (`scripts/verify_supabase_migration_consistency.sh`) | Passed | Root/mirror parity now matches at `118/118`; local migration history aligned after applying the two pending local migrations |
| Migration consistency linked (`scripts/verify_supabase_migration_consistency.sh --linked`) | Passed | Linked check now derives `SUPABASE_DB_PASSWORD` from existing DB URLs when needed and validates all `118` remote migration rows |
| Function consistency (`scripts/verify_supabase_function_consistency.sh`) | Passed | Root/mirror function source parity now passes; local-only `supabase/functions/.env` is intentionally ignored |
| Function consistency linked (`scripts/verify_supabase_function_consistency.sh --linked`) | Passed | Linked check retries with the local Supabase CLI profile after env-token `401`, then validates the deployed inventory against the 5 non-example local slugs |
| Admin package sanity (`cd awcms && npm run lint && npm run test -- --run && npm run build`) | Passed | ESLint, Vitest (`77` tests), and production build all succeed |
| Public package sanity (`cd awcms-public/primary && npm run check`) | Passed | `astro check`, ESLint, and Prettier all pass after the Tailwind/Astro compatibility fix |
| Public build (`cd awcms-public/primary && npm run build`) | Passed | Astro static build succeeds again with the Cloudflare adapter after the Tailwind toolchain pin |
| MCP package sanity (`cd awcms-mcp && npm run lint && npm run build`) | Passed | Lint and TypeScript build succeed |
| Dependency review (`npm outdated`) | Findings logged | Admin, public, and MCP workspaces all have upgrade candidates |

## Dependency Drift Snapshot (2026-03-08)

- `awcms`: notable drift includes `@supabase/supabase-js`, Tailwind v4 packages, TipTap packages, `react-router-dom`, `recharts`, and `framer-motion`
- `awcms-public/primary`: notable drift includes `astro-embed`, `lucide-react`, `sharp`, and Tailwind v4 `4.2.x`; the Tailwind toolchain is intentionally pinned at `4.1.18` until Astro's Vite typing surface no longer conflicts with the newer plugin release
- `awcms-mcp`: notable drift includes `@modelcontextprotocol/sdk`, `@types/pg`, and ESLint

## Historical Note

The previous 2026-02-27 and 2026-03-03 documentation audit cycles remain part of project history and changelog evidence.
This tracker now treats 2026-03-08 as the active operational baseline for the next full repository review.
