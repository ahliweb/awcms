# Documentation Audit Tracker - Context7 Re-Audit

> **Date:** 2026-03-08
>
> **Related Plan:** `docs/dev/documentation-audit-plan.md`
>
> **Status:** 2026-03-08 full-scope documentation, repository-integrity, and conflict-resolution cycle remains active; the current pass has now closed the CI coverage gap and reconciled the first schema/security/tenancy doc set against the latest migration/helper baselines.

## 2026-03-08 Cycle Trigger

The previous 2026-02-27 / 2026-03-03 audit surfaces were no longer sufficient as the active planning baseline.
Core authority docs still carried an outdated README status snapshot, incomplete top-level MCP wording,
and no active plan for repository-wide conflict detection across dependencies, scripts, security, performance,
dead links, and stale implementation guidance.

This planning refresh also confirmed that repository inventory counts and a small set of maintained docs
had drifted again after subsequent schema, media, and workflow changes.

## Current Cycle Status

| Phase | Status | Notes |
| --- | --- | --- |
| Phase 0 - Re-Baseline and Inventory Refresh | Completed | Counts updated to `115` markdown, `71` docs, `127/127` migrations, `10` package manifests, `14` maintained package README surfaces |
| Phase 1 - Authority and Documentation Hub Reconciliation | In Progress | `README.md`, `docs/README.md`, audit plan/tracker baseline refreshed; AGENTS/SYSTEM_MODEL/DOCS_INDEX link reconciliation still pending |
| Phase 2 - Schema, Security, and Tenancy Reconciliation | In Progress | `docs/architecture/database.md`, `docs/security/abac.md`, `docs/security/rls.md`, `docs/tenancy/overview.md`, and `docs/tenancy/supabase.md` reconciled; broader phase review remains open |
| Phase 3 - Scripts, Tooling, and Deployment Reconciliation | Pending | Reconcile documented scripts, MCP topology, docs-link workflow scope, and CI guarantees against live manifests/workflows |
| Phase 4 - Feature, Module, and Package Documentation Pass | Pending | Review all maintained module/dev/guides surfaces plus workspace/package READMEs |
| Phase 5 - Conflict Resolution and Publication | Pending | Close drift items, rerun validation gates, and publish updated docs baseline |

## Baseline Snapshot (2026-03-08)

| Surface | Evidence |
| --- | --- |
| Total markdown files in repository | `115` (current inventory count) |
| `docs/**/*.md` | `71` (current docs inventory count) |
| Migration parity | `127` root migrations and `127` mirrored migrations |
| Maintained package README surfaces | `14` |
| Package manifests (`package.json`) | `10` |
| GitHub workflows | `3` |
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
| DOCSYNC-016 | High | Current plan/tracker baselines were stale (`113` markdown / `71` docs / `118` migrations) after subsequent repository changes | Resolved | `docs/dev/documentation-audit-plan.md` and `docs/dev/documentation-audit-tracker.md` are now re-baselined to the current `115` markdown / `71` docs / `127/127` migrations inventory |
| DOCSYNC-017 | Medium | Maintained docs carried stale baseline details (`README.md` migration parity, `docs/README.md` update marker, `docs/tenancy/supabase.md` migration count) | Resolved | Updated those docs to the current 2026-03-08 planning baseline |
| DOCSYNC-018 | High | Canonical navigation still points to missing docs (`docs/architecture/ollama-integration.md`, `docs/modules/STITCH_IMPORT.md`) | Resolved | Added both docs and updated `DOCS_INDEX.md` notes to reflect their current scope |
| DOCSYNC-019 | Medium | Documentation automation scope is inconsistent: audit docs distinguish maintained vs non-canonical docs, but `docs-link-check.yml` still scans all markdown | Resolved | `docs-link-check.yml` now delegates to `cd awcms && npm run docs:check`, so workflow scope matches the maintained-doc policy already encoded in the local validator and package script |
| DOCSYNC-020 | Medium | Runtime dependency guidance drifts from implementation: `awcms-edge` still uses `@supabase/supabase-js` `^2.45.0` while authority docs describe `2.93.3` baseline | Resolved | Scoped docs now treat admin/public and Worker dependency versions separately, with `awcms-edge/package.json` documented as the Worker source of truth |
| DOCSYNC-021 | Medium | Maintained package-doc coverage is incomplete for some active workspaces/packages | Resolved | Added maintained README surfaces for `awcms-edge/` and `packages/awcms-shared/` |
| DOCSYNC-022 | Medium | CI coverage guarantees for maintained workspaces are not clearly documented and may not include every active package | Resolved | Added dedicated CI jobs for `awcms-edge` and `awcms-mcp`, and updated `docs/dev/ci-cd.md` to document the remaining uncovered surfaces explicitly |
| DOCSYNC-023 | Medium | Current docs link automation cannot reliably prove local markdown targets exist because many filesystem links are reported as pending `[ / ]` | Resolved | Added `scripts/check_markdown_local_links.mjs`, wired it into `awcms/package.json` and `docs-link-check.yml`, and used it to correct newly detected broken local links |
| DOCSYNC-024 | Medium | Dedicated CI coverage still does not include every maintained workspace/package | Resolved | Added dedicated jobs for `awcms-ext/primary-analytics/` and `packages/awcms-shared/`, plus package-level validation scripts/lockfiles so both surfaces can run standalone in CI |
| DOCSYNC-025 | Medium | Schema/security/tenancy docs still described stale migration counts, helper-function baselines, and tenant provisioning signatures | Resolved | Updated `docs/architecture/database.md`, `docs/security/abac.md`, `docs/security/rls.md`, `docs/tenancy/overview.md`, and `docs/tenancy/supabase.md` to reflect the current `127/127` migration baseline, recursion-safe `current_tenant_id()`, and the canonical 6-argument tenant provisioning RPC |

## Context7 Verification Log (2026-03-08 Planning Refresh)

| Library ID | Query Focus | Takeaway |
| --- | --- | --- |
| `/supabase/cli` | migration workflow, pull/push, linked safety, repair docs | Keep local vs linked commands explicit; prefer `db push --dry-run`, document `db pull`, and use migration repair only with evidence-backed recovery steps |
| `/supabase/supabase-js` | client init, auth session handling, secure key usage | Preserve PKCE/session guidance, document `getSession()` / `onAuthStateChange()`, and keep `SUPABASE_SECRET_KEY` server-side only |
| `/vitejs/vite` | `VITE_` exposure rules and `loadEnv` behavior | Preserve strict `VITE_` client exposure guidance, avoid broad `envPrefix`, and use `loadEnv` only inside config-time code |
| `/withastro/docs` | static output, `getStaticPaths`, build-time data, env usage | Keep public docs static-first and use `getStaticPaths`/build-time props instead of runtime-only assumptions |
| `/cloudflare/cloudflare-docs` | Workers deployment, secrets, bindings, runtime responsibilities | Keep secrets in Wrangler-managed bindings or secret stores, document `env` access, and position Workers as the primary edge HTTP layer |
| `/remix-run/react-router` | route modules, data loaders/actions, nested routes | Prefer route-module/data-API guidance in docs where React Router 7 patterns are documented |
| `/websites/tailwindcss` | v4 theme variables, CSS custom properties | Keep Tailwind docs CSS-variable-first and avoid reintroducing `theme()` or hardcoded design tokens as canonical guidance |
| `/websites/react_dev` | React 19 purity/effects/state derivation | Keep examples aligned to pure components and avoid redundant effect-driven derived state in documentation examples |

## Execution Queue

### Planning Refresh Completed in This Pass

- Re-baselined markdown, docs, migration, workflow, and manifest counts.
- Refreshed `README.md`, `docs/README.md`, and `docs/tenancy/supabase.md` where baseline values were already stale.
- Refreshed the audit plan/tracker so current open drift is tracked before broader doc editing resumes.

### Phase 1 / 3 Progress in This Pass

- Added `docs/architecture/ollama-integration.md` and `docs/modules/STITCH_IMPORT.md` so authority/navigation links resolve again.
- Added maintained README coverage for `awcms-edge/` and `packages/awcms-shared/`.
- Reconciled `docs/dev/ci-cd.md`, `docs/dev/setup.md`, and `README.md` with the current package manifests and GitHub workflow coverage boundaries.
- Added dedicated GitHub Actions jobs for `awcms-edge` and `awcms-mcp`, and added a stricter local markdown target validator to docs workflows.
- Closed the remaining docs-workflow scope gap by routing `docs-link-check.yml` through `cd awcms && npm run docs:check`.
- Added standalone CI coverage for `awcms-ext/primary-analytics/` and `packages/awcms-shared/`, including the shared-package type declarations needed for direct TypeScript validation.

### Phase 2 Progress in This Pass

- Rebased `docs/architecture/database.md` to the current `127/127` migration baseline and corrected the most drift-prone schema snapshots (`tenants`, `roles`, `role_permissions`, tenant-scoped slug indexes, and helper-function baselines).
- Updated `docs/security/abac.md` and `docs/security/rls.md` to reflect the current recursion-safe `current_tenant_id()` implementation and the tenant-admin/platform-admin/full-access semantics of `auth_is_admin()`.
- Updated `docs/tenancy/overview.md` and `docs/tenancy/supabase.md` to reflect the canonical 6-argument `create_tenant_with_defaults(...)` signature, current public shared-client usage, and the linked-workflow `db push --dry-run` recommendation.

### Remaining Work by Phase

#### Phase 2 - Schema, Security, and Tenancy

- Re-check the remaining schema/security/tenancy surfaces beyond the files already reconciled in this pass.
- Confirm package/env docs do not reintroduce secret-key or legacy key-name drift.

#### Phase 3 - Scripts, Tooling, and Deployment

- Reconcile docs with current package scripts in `awcms/`, `awcms-public/primary/`, `awcms-mcp/`, `awcms-ext/primary-analytics/`, and `packages/awcms-shared/`.
- Reconcile `awcms-edge/package.json`, `mcp.json`, and workflow files with current authority-doc claims.
- Reconcile remaining deployment/docs surfaces beyond `docs/deploy/overview.md`, `docs/deploy/cloudflare.md`, `docs/dev/setup.md`, and `docs/dev/troubleshooting.md`.
- Review deploy docs for Cloudflare Workers, Supabase functions, MCP topology consistency, documented CI guarantees, and any newly added extension-package coverage.

#### Phase 4 - Feature, Module, and Package Docs

- Review `docs/modules/**` for backlog-vs-shipped clarity.
- Review `docs/guides/**` and remaining package README command examples beyond `awcms-public/primary/README.md` and `awcms-mcp/README.md`.
- Add or explicitly classify missing package README coverage for any newly introduced maintained workspace/package.
- Re-check feature docs for dead links and route/path drift.

#### Phase 5 - Conflict Resolution and Publication

- Run markdown lint, docs link validation, package checks, and dependency review commands from the plan.
- Update `CHANGELOG.md` with closure notes if additional doc surfaces change.
- Close or reclassify all high-severity findings.

## Conflict Review Matrix

| Conflict Class | Current State | Next Action |
| --- | --- | --- |
| Outdated dependencies | Planning coverage exists; execution pending | Run `npm outdated` in maintained workspaces and reconcile docs/version claims |
| Broken or nonfunctional scripts | Partial reconciliation already completed in prior cycle | Revalidate documented commands against active scripts and package manifests in Phase 3 |
| Security risks | Key naming and edge-runtime wording improved in authority docs | Re-scan env examples, auth docs, and security docs repo-wide in Phase 2 |
| Performance issues | Public/admin guidance partially aligned | Re-review public/admin performance docs against current architecture in Phase 4 |
| Dead links / stale navigation | Highest-risk missing canonical targets are resolved; broader rerun remains | Rerun link validation and fix any additional local-path findings in Phase 5 |
| Stale backlog/checklists | Some checklist-style docs remain | Explicitly classify backlog/historical vs canonical docs during feature pass |
| Missing package docs | Highest-risk coverage gaps resolved for edge/shared workspaces | Re-check remaining maintained README surfaces during Phase 4 |
| CI/doc scope mismatch | Resolved for currently maintained surfaces | Keep package scripts, docs policy, and workflow targets aligned when new maintained workspaces are introduced |

## Validation Gate Results (2026-03-08)

| Gate | Result | Notes |
| --- | --- | --- |
| Markdown lint (`**/*.md`) | Historical pass | Previous cycle succeeded; rerun required after current authority/navigation edits |
| Markdown lint (touched canonical docs) | Pending rerun | Refresh after current planning and authority-doc edits |
| Markdown lint (Phase 4 docs and package READMEs) | Historical pass | Treat previous results as baseline evidence, not closure for this refresh |
| Docs local-target validation (`node scripts/check_markdown_local_links.mjs`) | Passed after fixes | The new validator caught and helped repair broken local links in `docs/architecture/platform-tenant-separation.md` and `docs/architecture/visual-builder-v2.md` |
| Docs link validation (`cd awcms && npm run docs:check`) | Passed with stronger local validation | `docs:check` now runs the local validator first, then `markdown-link-check`; remote/local pending markers remain a tooling quirk, not a missing-target blocker |
| Migration consistency (`scripts/verify_supabase_migration_consistency.sh`) | Historical pass | Previous cycle passed; current doc baseline now tracks `127/127` parity |
| Migration consistency linked (`scripts/verify_supabase_migration_consistency.sh --linked`) | Historical pass | Previous linked parity remains evidence but should be rerun before cycle closure |
| Function consistency (`scripts/verify_supabase_function_consistency.sh`) | Passed | Root/mirror function source parity now passes; local-only `supabase/functions/.env` is intentionally ignored |
| Function consistency linked (`scripts/verify_supabase_function_consistency.sh --linked`) | Passed | Linked check retries with the local Supabase CLI profile after env-token `401`, then validates the deployed inventory against the 5 non-example local slugs |
| Admin package sanity (`cd awcms && npm run lint && npm run test -- --run && npm run build`) | Passed | ESLint, Vitest (`77` tests), and production build all succeed |
| Public package sanity (`cd awcms-public/primary && npm run check`) | Passed | `astro check`, ESLint, and Prettier all pass after the Tailwind/Astro compatibility fix |
| Public build (`cd awcms-public/primary && npm run build`) | Passed | Astro static build succeeds again with the Cloudflare adapter after the Tailwind toolchain pin |
| MCP package sanity (`cd awcms-mcp && npm run lint && npm run build`) | Passed | Lint and TypeScript build succeed; this now mirrors the new dedicated CI job |
| Edge worker sanity (`cd awcms-edge && npm run typecheck`) | Passed | TypeScript check succeeds and now mirrors the new dedicated CI job |
| Extension package sanity (`cd awcms-ext/primary-analytics && npm run build:ci`) | Passed | SSR smoke build succeeds and now mirrors the new dedicated CI job |
| Shared package sanity (`cd packages/awcms-shared && npm run typecheck`) | Passed | Added local `ImportMeta` typings and a dedicated typecheck script so the package can validate standalone |
| Dependency review (`npm outdated`) | Findings logged | Admin, public, and MCP workspaces all have upgrade candidates; edge/shared version review remains a follow-up task |

## Dependency Drift Snapshot (2026-03-08)

- `awcms`: notable drift includes `@supabase/supabase-js`, Tailwind v4 packages, TipTap packages, `react-router-dom`, `recharts`, and `framer-motion`
- `awcms-public/primary`: notable drift includes `astro-embed`, `lucide-react`, `sharp`, and Tailwind v4 `4.2.x`; the Tailwind toolchain is intentionally pinned at `4.1.18` until Astro's Vite typing surface no longer conflicts with the newer plugin release
- `awcms-mcp`: notable drift includes `@modelcontextprotocol/sdk`, `@types/pg`, and ESLint
- `awcms-edge`: docs/runtime alignment review is still required because `@supabase/supabase-js` remains behind the authority-doc baseline

## Historical Note

The previous 2026-02-27 and 2026-03-03 documentation audit cycles remain part of project history and changelog evidence.
This tracker now treats 2026-03-08 as the active operational baseline for the next full repository review.
