# Documentation Audit Tracker - Context7 Re-Audit

> **Date:** 2026-03-12
>
> **Related Plan:** `docs/dev/documentation-audit-plan.md`
>
> **Status:** 2026-03-12 planning refresh is open. The 2026-03-08 closure remains historical evidence, but the current repo state now requires a new re-baseline and execution pass across authority docs, schema/runtime docs, script/deploy docs, and repo-wide conflict surfaces.

## 2026-03-12 Planning Refresh Trigger

The previous 2026-02-27 / 2026-03-03 audit surfaces were no longer sufficient as the active planning baseline.
Core authority docs still carried an outdated README status snapshot, incomplete top-level MCP wording,
and no active plan for repository-wide conflict detection across dependencies, scripts, security, performance,
dead links, and stale implementation guidance.

This planning refresh also confirmed that repository inventory counts and several maintained docs
have drifted again after subsequent schema, Worker/media, lint, and validation changes.

## Current Planning Refresh Status

| Phase | Status | Notes |
| --- | --- | --- |
| Phase 0 - Re-Baseline and Inventory Refresh | In Progress | Tracked markdown/migration counts refreshed to `136` markdown, `68` docs, and `131/131` migrations |
| Phase 1 - Authority and Documentation Hub Reconciliation | In Progress | Root snapshots, docs-hub wording, and AGENTS edge-runtime references were reconciled to the 2026-03-12 baseline; one pass of broader authority-link verification still remains |
| Phase 2 - Schema, Security, and Tenancy Reconciliation | In Progress | Baseline counts, request-scoped tenant-resolution wording, and media/runtime terminology were refreshed; a deeper per-table/per-permission reconciliation still remains |
| Phase 3 - Scripts, Tooling, and Deployment Reconciliation | In Progress | Setup/shared-package validation wording and Cloudflare deploy-workflow wording were reconciled; a broader command/workflow pass still remains |
| Phase 4 - Feature, Module, and Package Documentation Pass | In Progress | Module inventory and route-backed surface mapping have been refreshed against `docs/RESOURCE_MAP.md` and `MainRouter.jsx`; broader per-module README review still remains |
| Phase 5 - Conflict Resolution and Publication | Pending | Need current evidence for dependency drift, dead links, script health, and other standards gaps |

## Current Cycle Status

| Phase | Status | Notes |
| --- | --- | --- |
| Phase 0 - Re-Baseline and Inventory Refresh | Completed | Counts updated to `115` markdown, `71` docs, `127/127` migrations, `10` package manifests, `14` maintained package README surfaces |
| Phase 1 - Authority and Documentation Hub Reconciliation | Completed | Authority docs, navigation hubs, and missing canonical targets were reconciled |
| Phase 2 - Schema, Security, and Tenancy Reconciliation | Completed | Core schema/security/tenancy docs were reconciled against current migrations, helpers, and runtime constraints |
| Phase 3 - Scripts, Tooling, and Deployment Reconciliation | Completed | CI/docs validation scope, workspace coverage, deploy docs, and runtime workflow claims were reconciled |
| Phase 4 - Feature, Module, and Package Documentation Pass | Completed | High-confidence module/package drift was corrected and maintained guides were spot-checked without new contradictions |
| Phase 5 - Conflict Resolution and Publication | Completed | Validation gates were rerun, migration parity was restored locally, dependency drift was refreshed, and remaining items were triaged into carry-forward maintenance |

## Baseline Snapshot (2026-03-12)

| Surface | Evidence |
| --- | --- |
| Total tracked markdown files in repository | `136` (via `git ls-files '*.md'`) |
| Tracked `docs/**/*.md` | `68` (via `git ls-files 'docs/**/*.md'`) |
| Migration parity | `131` root migrations and `131` mirrored migrations |
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
| DOCSYNC-005 | Medium | Full per-file review of all maintained docs is not yet rerun for the 2026-03-08 cycle | Resolved | The maintained-doc review was completed across authority, architecture, security, tenancy, deploy, dev, module, compliance, and package README surfaces in this cycle |
| DOCSYNC-006 | Medium | Dependency/script/security/performance conflict review has a plan but still needs execution across all maintained surfaces | Resolved | Validation gates, command checks, runtime/doc reconciliation, and dependency review were executed across the maintained surfaces; remaining package upgrades are now a separate maintenance stream |
| DOCSYNC-007 | Medium | Repository-wide markdown lint previously failed because non-canonical package/mobile/template/content markdown was still included in the repo-wide lint surface | Resolved | Added `.markdownlintignore`, fixed the remaining `awcms-mobile-java/docs/**` issues and canonical long-line drift, then re-ran repo-wide markdownlint successfully |
| DOCSYNC-008 | High | Migration mirror parity was filename-drifted and local history was missing the latest mirrored migrations | Resolved | Added `20260307175000_move_sidebar_items.sql` to root, mirrored `20260308070000_add_cloudflare_media_schema.sql`, fixed the media resource registry insert, and re-ran local migration push plus parity verification successfully |
| DOCSYNC-009 | Medium | Function parity check reported root-only transitional files not mirrored into `awcms/supabase/functions/` | Resolved | Mirrored `content-transform/index.ts` and updated `scripts/verify_supabase_function_consistency.sh` to ignore local-only `supabase/functions/.env` secrets |
| DOCSYNC-010 | Medium | Public workspace validation was blocked by formatting drift in `awcms-public/primary/package.json` | Resolved | Reformatted `awcms-public/primary/package.json` and re-ran `npm run check` successfully |
| DOCSYNC-011 | Medium | Dependency drift exists across maintained workspaces (`awcms`, `awcms-public/primary`, `awcms-mcp`) | Resolved | Drift was refreshed with `npm outdated`, documented in the Validation Gate Results and Dependency Drift Snapshot, and carried forward as a maintenance backlog rather than a docs inconsistency |
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
| DOCSYNC-026 | Medium | Remaining deploy/module docs still carried stale claims about primary edge deployment, public blog fetch paths, version-source authority, and default editor permissions | Resolved | Updated `docs/deploy/overview.md`, `docs/deploy/cloudflare.md`, `docs/modules/BLOGS_MODULE.md`, `docs/modules/VERSIONING.md`, and `docs/modules/ROLE_HIERARCHY.md` to match current workflows, public queries, and authority guidance |
| DOCSYNC-027 | Medium | Additional module docs still carried stale runtime assumptions, source-path references, and manager-component inventory claims | Resolved | Updated `docs/modules/MONITORING.md`, `docs/modules/PERFORMANCE.md`, `docs/modules/EXTENSIONS.md`, `docs/modules/MODULES_GUIDE.md`, `docs/modules/MENU_SYSTEM.md`, and `docs/modules/THEMING.md` to match current Worker/runtime boundaries, router reality, extension workspace layout, and actual admin module inventory |
| DOCSYNC-028 | Medium | Remaining dev/deploy/compliance docs still carried stale claims about mirrored function paths, CI branch/paths behavior, ESP32 version sources, SMANDAPBUN session wording, and privacy-policy configuration | Resolved | Updated `docs/dev/edge-functions.md`, `docs/dev/versioning.md`, `docs/deploy/overview.md`, `docs/deploy/cloudflare.md`, `docs/compliance/pdp-uu27-2022.md`, and `docs/compliance/indonesia.md` to match current repo structure and runtime behavior |
| DOCSYNC-029 | High | Root planning/docs baseline drifted again after recent Worker/media/lint changes | Resolved | `README.md`, `DOCS_INDEX.md`, `docs/README.md`, `docs/dev/documentation-audit-plan.md`, and this tracker were rebased to the 2026-03-12 planning refresh and the current `136` / `68` / `131/131` baseline |
| DOCSYNC-030 | High | Current audit plan still references removed Supabase-function validation workflow | Resolved | `docs/dev/documentation-audit-plan.md` now uses the current migration consistency plus Worker/runtime validation gates instead of the deleted function-consistency script |
| DOCSYNC-031 | Medium | Resource-map and feature docs need a new execution pass against current manager/editor/runtime surfaces | Open | Recent code audit surfaced route/UI/runtime drift for several resources; docs have not yet been re-baselined to those findings |
| DOCSYNC-032 | Medium | Conflict-resolution guidance needs a fresh execution queue for dependency drift, scripts, security, performance, and dead links | Open | The framework exists, but the current cycle needs updated commands, owners, and exit criteria tied to the 2026-03-12 baseline |
| DOCSYNC-033 | Medium | `AGENTS.md` still carried benchmark/reference sections that described Supabase Edge Functions and stale local test/deploy commands as if they were active | Resolved | Rebased the benchmark/reference sections to Cloudflare Worker routes in `awcms-edge/`, refreshed local/deploy commands, and aligned route inventory wording to the maintained Worker model |
| DOCSYNC-034 | Medium | Schema/tenancy docs still used stale migration baselines and legacy media wording after the 2026-03-12 re-baseline | Resolved | Updated `docs/architecture/database.md`, `docs/tenancy/overview.md`, and `docs/tenancy/supabase.md` to the `131/131` baseline and current Worker/R2 media model |
| DOCSYNC-035 | Medium | Security docs still referenced outdated helper-function source migrations for `has_permission()` and `auth_is_admin()` | Resolved | Updated `docs/security/abac.md` and `docs/security/rls.md` so the helper baselines now point to `20260119230212_remote_schema.sql` while keeping `current_tenant_id()` and hierarchy helper references current |
| DOCSYNC-036 | Medium | Script/deploy docs still carried stale shared-package validation wording and a reference to a non-existent SMANDAPBUN deploy workflow | Resolved | Updated `docs/dev/setup.md` to document the standalone `@awcms/shared` typecheck script and corrected `docs/deploy/cloudflare.md` to the current Cloudflare Pages/deploy-hook workflow reality |
| DOCSYNC-037 | Medium | Module guide inventory drifted from the current router/resource-map reality for settings-backed views, mobile routes, and dynamic media/gallery surfaces | Resolved | Updated `docs/modules/MODULES_GUIDE.md` so the listed module surfaces and route notes now match `docs/RESOURCE_MAP.md` and `awcms/src/components/MainRouter.jsx` |
| DOCSYNC-038 | Medium | Blogs/user/package docs still used transitional Worker wording or missed current route/runtime details | Resolved | Updated `docs/modules/BLOGS_MODULE.md`, `docs/modules/USER_MANAGEMENT.md`, `awcms-edge/README.md`, and `packages/awcms-shared/README.md` to reflect the current Worker-backed compatibility model and route/runtime behavior |
| DOCSYNC-039 | Medium | Email integration docs still described legacy secret handling instead of the maintained Wrangler/Worker flow | Resolved | Updated `docs/modules/EMAIL_INTEGRATION.md` to use the current `wrangler secret put` and `npm run dev:local` Worker workflow |

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

### Phase 3 / 4 Progress in This Pass

- Updated `docs/deploy/overview.md` so deployment guidance now treats `awcms-edge/` as the primary edge HTTP deploy surface and scopes Supabase Edge Functions to legacy/transitional flows.
- Updated `docs/deploy/cloudflare.md` to distinguish production secret mapping in `ci-push.yml` from the mock fork-safe values used by `ci-pr.yml`.
- Updated `docs/modules/BLOGS_MODULE.md`, `docs/modules/VERSIONING.md`, and `docs/modules/ROLE_HIERARCHY.md` to match current public query paths, package-manifest version authority, and the editor delete baseline from the canonical permission matrix.
- Updated `docs/modules/MONITORING.md`, `docs/modules/PERFORMANCE.md`,
  `docs/modules/EXTENSIONS.md`, `docs/modules/MODULES_GUIDE.md`,
  `docs/modules/MENU_SYSTEM.md`, and `docs/modules/THEMING.md` to match current Worker logging
  scope, router usage, extension workspace layout, route-backed module inventory, and correct
  in-repo hook paths.
- Spot-checked `docs/guides/**` and did not find additional high-confidence repo-state contradictions in the currently maintained guides.

### Phase 5 Progress in This Pass

- Updated `docs/dev/edge-functions.md`, `docs/dev/versioning.md`, `docs/deploy/overview.md`,
  `docs/deploy/cloudflare.md`, `docs/compliance/pdp-uu27-2022.md`, and
  `docs/compliance/indonesia.md` to remove the last high-confidence runtime and workflow drift found
  in the closure audit.
- Reran docs validation, function consistency, migration consistency, and dependency review so the
  tracker reflects current evidence instead of historical-only results.

## 2026-03-12 Phase 1 Progress Log

- Refreshed the top-level status snapshot in `README.md` from the closed 2026-03-08 audit wording to the active 2026-03-12 planning refresh, including the current `131/131` migration parity baseline.
- Updated `DOCS_INDEX.md` so the audit tracker entry now points to the 2026-03-12 baseline and the edge logic entry reflects the maintained Cloudflare Worker + R2 model.
- Updated `docs/README.md` to the 2026-03-12 planning refresh wording so the docs hub no longer points to the previous closed cycle.
- Updated `SYSTEM_MODEL.md` last-updated metadata to the 2026-03-12 planning refresh.
- Updated `AGENTS.md` authority content so the public-portal constraints and benchmark/reference sections now describe approved edge runtimes and Cloudflare Worker routes instead of Supabase Edge Functions.

## 2026-03-12 Phase 2 Progress Log

- Updated `docs/architecture/database.md` to the current `131/131` migration baseline.
- Updated `docs/tenancy/overview.md` so tenant-resolution wording matches the current `current_tenant_id()` behavior and Cloudflare Worker request-scoped flows.
- Updated `docs/tenancy/supabase.md` so the migration baseline, Worker invocation wording, and media/storage ownership reflect the current Cloudflare Worker + R2 runtime.
- Updated `docs/security/abac.md` and `docs/security/rls.md` so helper-function baseline references now match the current canonical migration source for `has_permission()` and `auth_is_admin()`.

## 2026-03-12 Phase 3 Progress Log

- Updated `docs/dev/setup.md` so the shared-package section now reflects the current standalone `npm run typecheck` validation path for `packages/awcms-shared`.
- Updated `docs/deploy/cloudflare.md` so SMANDAPBUN deployment guidance no longer references a non-existent GitHub workflow and instead reflects the current Cloudflare Pages/deploy-hook model.

## 2026-03-12 Phase 4 Progress Log

- Updated `docs/modules/MODULES_GUIDE.md` so the module inventory now reflects the current route-backed managers, settings-backed views, mobile route paths, and dynamic-resource caveats present in `MainRouter.jsx` and `docs/RESOURCE_MAP.md`.
- Updated `docs/modules/USER_MANAGEMENT.md`, `docs/modules/BLOGS_MODULE.md`, `awcms-edge/README.md`, and `packages/awcms-shared/README.md` so they reflect the current Worker-backed compatibility model, current blog route/workflow terminology, and direct Worker health/runtime validation notes.
- Updated `docs/modules/EMAIL_INTEGRATION.md` so Mailketing secret/development instructions now match the maintained Wrangler + Cloudflare Worker workflow.

### Closure Outcome

- The 2026-03-08 maintained-doc audit is complete for the current repository baseline.
- No additional high-confidence documentation contradictions remain in the maintained surfaces reviewed during this cycle.
- Remaining work is operational follow-up, not docs drift: package dependency upgrades in `awcms/`,
  `awcms-public/primary/`, and `awcms-mcp/`, plus routine revalidation when new migrations, docs,
  or workspaces are added.

### Carry-Forward Maintenance Backlog

- Re-run the maintained-doc audit whenever new canonical docs, migrations, workflows, or maintained workspaces are added.
- Plan and execute package upgrade work for `awcms/`, `awcms-public/primary/`, and `awcms-mcp/` separately from documentation reconciliation.
- Keep rerunning markdown lint, docs link validation, package checks, and parity scripts after future maintained-doc edits.

## Conflict Review Matrix

| Conflict Class | Current State | Next Action |
| --- | --- | --- |
| Outdated dependencies | Executed for current maintained JS workspaces; drift remains in admin/public/MCP, while edge/shared/ext showed no current output | Carry upgrade planning separately from docs reconciliation unless version claims drift again |
| Broken or nonfunctional scripts | Core documented commands were revalidated in this cycle | Revalidate documented commands when workflows or package scripts change |
| Security risks | Key naming and edge-runtime wording improved in authority docs | Re-scan env examples, auth docs, and security docs repo-wide in Phase 2 |
| Performance issues | Public/admin guidance partially aligned | Re-review public/admin performance docs against current architecture in Phase 4 |
| Dead links / stale navigation | Highest-risk missing canonical targets are resolved; broader rerun remains | Rerun link validation and fix any additional local-path findings in Phase 5 |
| Stale backlog/checklists | Some checklist-style docs remain | Explicitly classify backlog/historical vs canonical docs during feature pass |
| Missing package docs | Highest-risk coverage gaps resolved for edge/shared workspaces | Re-check remaining maintained README surfaces during Phase 4 |
| CI/doc scope mismatch | Resolved for currently maintained surfaces | Keep package scripts, docs policy, and workflow targets aligned when new maintained workspaces are introduced |

## Validation Gate Results (2026-03-08)

| Gate | Result | Notes |
| --- | --- | --- |
| Markdown lint (`**/*.md`) | Historical pass | Previous repo-wide pass remains baseline evidence; this cycle reran markdownlint on all touched maintained docs |
| Markdown lint (touched canonical docs) | Passed | Rerun completed across the touched deploy/module/dev/compliance docs in this closure pass |
| Markdown lint (Phase 4 docs and package READMEs) | Historical pass | Treat previous results as baseline evidence, not closure for this refresh |
| Docs local-target validation (`node scripts/check_markdown_local_links.mjs`) | Passed after fixes | The new validator caught and helped repair broken local links in `docs/architecture/platform-tenant-separation.md` and `docs/architecture/visual-builder-v2.md` |
| Docs link validation (`cd awcms && npm run docs:check`) | Passed with stronger local validation | Rerun completed in this closure pass; `docs:check` still shows pending `[ / ]` markers for many filesystem links, but the local validator proves target existence first |
| Migration consistency (`scripts/verify_supabase_migration_consistency.sh`) | Passed | Root/mirror file parity and local migration history both pass after applying the three previously missing local migrations |
| Migration consistency linked (`scripts/verify_supabase_migration_consistency.sh --linked`) | Historical pass | Previous linked parity remains evidence but should be rerun before cycle closure |
| Function consistency (`scripts/verify_supabase_function_consistency.sh`) | Passed | Rerun completed successfully; root/mirror function source parity passes and local-only `supabase/functions/.env` remains intentionally ignored |
| Function consistency linked (`scripts/verify_supabase_function_consistency.sh --linked`) | Passed | Linked check retries with the local Supabase CLI profile after env-token `401`, then validates the deployed inventory against the 5 non-example local slugs |
| Admin package sanity (`cd awcms && npm run lint && npm run test -- --run && npm run build`) | Passed | ESLint, Vitest (`77` tests), and production build all succeed |
| Public package sanity (`cd awcms-public/primary && npm run check`) | Passed | `astro check`, ESLint, and Prettier all pass after the Tailwind/Astro compatibility fix |
| Public build (`cd awcms-public/primary && npm run build`) | Passed | Astro static build succeeds again with the Cloudflare adapter after the Tailwind toolchain pin |
| MCP package sanity (`cd awcms-mcp && npm run lint && npm run build`) | Passed | Lint and TypeScript build succeed; this now mirrors the new dedicated CI job |
| Edge worker sanity (`cd awcms-edge && npm run typecheck`) | Passed | TypeScript check succeeds and now mirrors the new dedicated CI job |
| Extension package sanity (`cd awcms-ext/primary-analytics && npm run build:ci`) | Passed | SSR smoke build succeeds and now mirrors the new dedicated CI job |
| Shared package sanity (`cd packages/awcms-shared && npm run typecheck`) | Passed | Added local `ImportMeta` typings and a dedicated typecheck script so the package can validate standalone |
| Deploy/module doc reconciliation | Passed | Updated deploy and module docs now match current workflow behavior, edge deployment reality, and public blog query paths |
| Dependency review (`npm outdated`) | Findings logged | Admin, public, and MCP workspaces still have upgrade candidates; `awcms-edge`, `packages/awcms-shared`, and `awcms-ext/primary-analytics` produced no current output |

## Dependency Drift Snapshot (2026-03-08)

- `awcms`: notable drift now centers on the held ESLint 10 jump, the optional cross-major move to
  `@types/node` `25.x`, `@vitejs/plugin-react`, `react-dropzone`, `react-helmet-async`, and the
  previously deferred core runtime packages (`@supabase/supabase-js`, TipTap,
  `react-router-dom`, `recharts`, `framer-motion`)
- `awcms-public/primary`: notable drift now centers on `astro-embed` and the intentionally held Tailwind v4 `4.2.x` toolchain packages; Batch A already cleared the ESLint/globals/lucide updates
- `awcms-mcp`: notable drift now centers on `@modelcontextprotocol/sdk`, ESLint, and the optional cross-major move from Node 22 type definitions to `@types/node` `25.x`
- `awcms-edge`: `npm outdated` produced no current output in this pass; the Worker-specific Supabase version pin remains a deliberate scoped difference already documented elsewhere
- `packages/awcms-shared`: `npm outdated` produced no current output in this pass
- `awcms-ext/primary-analytics`: `npm outdated` produced no current output in this pass

## Dependency Upgrade Follow-Up Plan

### 1. `awcms` (Admin Panel)

- **Goal:** Keep the React 19 / Vite 7 admin surface current without mixing framework, lint, and runtime-risk upgrades in one batch.
- **Batch A - low-risk tools first:** completed in a compatibility-safe form. `lucide-react`,
  `jsdom`, and `@types/node` were updated, `@eslint/js`/`eslint` were refreshed to the latest
  ESLint 9 patch line, and `vitest.config.js` now explicitly excludes `e2e/**` so unit-test runs
  stay separate from Playwright specs. `npm run lint`, `npm run test -- --run`, and
  `npm run build` all pass.
- **Batch B - UI/runtime libraries:** evaluate `react-dropzone` `15.x` and `react-helmet-async` `3.x` together because both may require code changes; verify upload flows, document head behavior, and SSR-safe rendering.
- **Batch C - ecosystem alignment:** review the held ESLint 10 jump together with `@vitejs/plugin-react` `5.x` only after confirming plugin compatibility and existing build behavior remain stable.
- **Hold for targeted review:** `@supabase/supabase-js`, `react-router-dom`, `recharts`, `framer-motion`, and TipTap packages should be upgraded in feature-specific branches because they touch core app behavior and user-facing flows.

### 2. `awcms-public/primary` (Astro Public Portal)

- **Goal:** Preserve the current stable Astro/Tailwind build while separating safe upgrades from the known Tailwind `4.2.x` compatibility risk.
- **Batch A - low-risk packages:** completed. `@eslint/js`, `eslint`, `globals`, and
  `lucide-react` were updated; validation surfaced a few lint/type issues in `src/lib/menu.ts`,
  `src/lib/search.ts`, `src/lib/sidebar.ts`, and localized slug pages, and those were fixed so
  `npm run check` and `npm run build` pass again.
- **Batch B - content/runtime packages:** evaluate `astro-embed` and `sharp` in a separate branch; verify embeds, image optimization, and Cloudflare build output.
- **Explicit hold:** keep `@tailwindcss/postcss`, `@tailwindcss/vite`, and `tailwindcss` pinned at `4.1.18` until Astro/Vite compatibility is revalidated against the earlier type-mismatch regression.

### 3. `awcms-mcp` (MCP Server)

- **Goal:** Refresh server/tooling dependencies while keeping the TypeScript build and lint surface stable.
- **Batch A - type/tooling only:** completed. `@types/node` was moved to the latest Node 22-compatible patch range (`^22.19.15`) and `@types/pg` to `^8.18.0`; `npm run lint` and `npm run build` both pass.
- **Batch B - protocol/tooling stack:** review `@modelcontextprotocol/sdk` and ESLint major upgrades together; confirm no API surface changes in the SDK and no config breakage in the lint stack before merging.

### Sequencing Rules

- Upgrade one workspace at a time and keep each batch small enough to attribute regressions quickly.
- Re-run the existing package validation commands after every dependency batch instead of combining all upgrades into one PR.
- Update docs only if an upgrade changes a documented baseline or intentional version pin.

## Historical Note

The previous 2026-02-27 and 2026-03-03 documentation audit cycles remain part of project history and changelog evidence.
This tracker now treats 2026-03-08 as the active operational baseline for the next full repository review.
