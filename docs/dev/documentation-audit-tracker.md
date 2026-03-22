# Documentation Audit Tracker - 2026-03-22 Re-Baseline

> Related Plan: `docs/dev/documentation-audit-plan.md`
>
> Status: Active — authority docs, audit docs, and deployment/security guidance require a fresh re-baseline.
>
> Last Updated: 2026-03-22

## Current Phase Status

| Phase | Status | Notes |
| --- | --- | --- |
| Phase 0 - Inventory and Authority Re-baseline | In Progress | Current counts and installed versions drifted again; authority docs need exact-manifest re-baseline |
| Phase 1 - Schema, Security, and Tenancy Reconciliation | Pending | Recent migrations need downstream doc coverage |
| Phase 2 - Scripts, Tooling, and CI/CD Reconciliation | In Progress | Workflow/security docs conflict with current `deploy-smandapbun.yml` behavior |
| Phase 3 - Workspace and Package README Pass | Pending | Workspace READMEs still carry stale version claims |
| Phase 4 - Conflict Review and Risk Closure | Pending | Critical security/documentation mismatches remain open |

## Verified Baseline Snapshot

| Surface | Current State | Evidence |
| --- | --- | --- |
| Tracked Markdown files | `146` | `git ls-files '*.md' | wc -l` |
| Tracked docs files | `84` | `git ls-files 'docs/**/*.md' | wc -l` |
| Root migrations | `149` | `ls supabase/migrations/*.sql | wc -l` |
| Mirrored migrations | `149` | `ls awcms/supabase/migrations/*.sql | wc -l` |
| Package manifests | `10` | `git ls-files '**/package.json'` |
| GitHub workflows | `4` | `ls .github/workflows | wc -l` |
| Docs validation | Not rerun in this pass | Re-baseline pass focused on evidence gathering |
| Migration parity | Not rerun in this pass | Inventory-only count verification |

## Active Drift Register

| ID | Severity | Finding | Status | Evidence | Next Action |
| --- | --- | --- | --- | --- | --- |
| DOCSYNC-116 | Critical | The hardcoded Cloudflare account ID issue was marked resolved in docs while `deploy-smandapbun.yml` still carried a real fallback account ID | Resolved 2026-03-22 | Removed the fallback from `.github/workflows/deploy-smandapbun.yml`; updated `docs/deploy/cloudflare.md` and `SECURITY.md` to reflect current account/CORS behavior | Keep `CLOUDFLARE_ACCOUNT_ID` secret/variable-based only and fail explicitly when token scope is ambiguous |
| DOCSYNC-117 | High | Authority docs still reference stale dependency versions instead of exact installed versions from manifests | Resolved 2026-03-22 | Updated authority docs, workspace READMEs, and downstream admin/public/module docs to exact manifest-backed versions | Keep exact installed versions sourced from manifests |
| DOCSYNC-118 | High | Inventory and migration counts in authority/audit docs are stale again | Resolved 2026-03-22 | Updated snapshot references to the current `146` / `84` / `149` / `149` baseline and re-ran migration parity verification | Re-run counts and parity checks on each audit pass |
| DOCSYNC-119 | High | `docs/deploy/cloudflare.md` said the maintained workflow set excluded an active dedicated SMANDAPBUN deploy workflow | Resolved 2026-03-22 | Updated `docs/deploy/cloudflare.md` to reflect the active four-workflow baseline and `deploy-smandapbun.yml` ownership | Keep deploy docs synchronized with `.github/workflows/*.yml` changes |
| DOCSYNC-120 | Medium | Security documentation implied `VITE_CORS_ALLOWED_ORIGINS` was the deployment control for CORS, while Worker runtime uses `CORS_ALLOWED_ORIGINS` | Resolved 2026-03-22 | Updated `SECURITY.md` and `docs/deploy/cloudflare.md` to split admin Vite CORS from Worker runtime CORS | Keep admin/dev-server and Worker runtime env guidance documented separately |
| DOCSYNC-121 | Medium | Recent schema/runtime changes are missing documentation coverage | Resolved 2026-03-22 | Updated database, security, tenancy, and edge docs for notification tables, recursion-safe users RLS, and storage/security-advisor helper changes | Keep migration-driven docs updated whenever helper rewrites or new tables ship |
| DOCSYNC-101 | High | Authority docs used stale stack versions for Astro, Supabase JS, Framer Motion, Lucide, and i18next | Resolved in authority docs | `README.md`, `SYSTEM_MODEL.md`, `AGENTS.md`, `docs/architecture/tech-stack.md` vs workspace manifests | Continue cascading corrected versions into any remaining downstream docs |
| DOCSYNC-102 | High | Audit plan/tracker incorrectly implied the previous cycle was closed and current drift was resolved | Resolved | Replaced stale plan/tracker with active 2026-03-13 cycle docs | Keep tracker live until high-severity findings are closed |
| DOCSYNC-103 | High | Migration mirror parity was broken: 8 mirror-only SQL files existed in `awcms/supabase/migrations/` | Resolved | Backfilled `supabase/migrations/20260313000100` through `20260313000800` and reran parity verification successfully | Keep adding new migrations to both roots and rerun parity checks |
| DOCSYNC-104 | Medium | Baseline counts in docs were stale (`136` Markdown, `68` docs, `131/131` migrations, `3` workflows) | Resolved in plan/status docs | Inventory commands and workflow directory check | Sweep remaining references to old counts |
| DOCSYNC-105 | Medium | Public docs and package READMEs still referenced Astro 5 for active public workspaces | Resolved | Updated authority docs, public docs, `awcms-public/primary/README.md`, and `awcms-public/smandapbun/README.md` | Keep tenant-specific versions explicit when public workspaces diverge |
| DOCSYNC-106 | Medium | Worker secret/local-dev guidance needed standardization against current Wrangler best practices | Resolved | Standardized on `awcms-edge/.dev.vars` for local Worker secrets, added `.dev.vars.example`, updated `awcms-edge/package.json`, and documented production secrets via `wrangler secret put` | Keep Worker docs aligned with Wrangler conventions |
| DOCSYNC-107 | High | `deploy-smandapbun.yml` and `ci-push.yml` hardcoded the real Cloudflare account ID (`5255727b...`) as plain env values, exposing it in CI logs and public workflow files | Resolved 2026-03-22 | `ci-push.yml` already removed the fallback; `.github/workflows/deploy-smandapbun.yml` now also removes the remaining real-account fallback | Keep Cloudflare account resolution secret/variable-based and validated by API preflight |
| DOCSYNC-108 | High | MCP topology in `SYSTEM_MODEL.md`, `AGENTS.md`, and `README.md` diverged from `mcp.json`: `paper` server absent; `cloudflare` incorrectly described as 7 granular managed remote MCPs instead of the single `@cloudflare/mcp-server-cloudflare` package | Resolved | Reconciled all three authority docs against `mcp.json` | Re-verify after any future `mcp.json` change |
| DOCSYNC-109 | Medium | Inventory snapshot counts were stale in an earlier cycle | Historical checkpoint superseded by the current `146` / `84` / `149` / `149` baseline | Re-run `git ls-files '*.md' \| wc -l`, `git ls-files 'docs/**/*.md' \| wc -l`, and migration counts after each audit pass |
| DOCSYNC-110 | Medium | `docs/dev/ci-cd.md` workflow inventory needed re-baselining after the latest CI cleanup | Resolved | Reconciled `docs/dev/ci-cd.md` and audit docs to the current 4-workflow inventory | Keep `ci-cd.md` workflow table in sync as workflows change |
| DOCSYNC-111 | Low | `docs/dev/versioning.md` section 5 still showed the obsolete `contains(github.event.commits[0].modified, ...)` CI condition rather than the `dorny/paths-filter` pattern currently used | Resolved | Updated section 5 excerpt to reflect the current `paths-filter` pattern | No further action required unless CI architecture changes |
| DOCSYNC-112 | Low | `scripts/detect_legacy_storage.sh` no longer matched the supported runtime model after Worker compatibility proxies and client storage guards were added; the script reported false positives for supported compatibility calls | Resolved | Removed the obsolete script and retained runtime validation in `scripts/ci-validate-runtime.sh`, storage guard tests, and Worker smoke tests | Keep future cleanup scripts aligned with the canonical runtime model |
| DOCSYNC-113 | High | Migration mirror parity broken by Phase 5: `20260319120000_create_queue_dead_letters.sql` existed in `supabase/migrations/` but was not copied to `awcms/supabase/migrations/` | Resolved 2026-03-19 | Historical Phase 5 remediation; parity is now re-verified at `149/149` | Keep adding new migrations to both roots and rerun parity check |
| DOCSYNC-114 | Medium | `docs/architecture/queue-topology.md` "Planned Queues" table listed `awcms-audit-export` as "Phase 5", but Phase 5 (DLQ, observability, replay) was already fully delivered | Resolved 2026-03-19 | Updated label from "Phase 5" to "Phase 6+" | Re-check planned queue labels whenever a phase ships |
| DOCSYNC-115 | Medium | `docs/dev/edge-functions.md` line 26 referenced only `awcms-media-events`; `awcms-notifications` and both DLQs were omitted. Runtime Coverage and Validation Checklist also missing notifications consumer, DLQ consumers, and admin replay route | Resolved 2026-03-19 | Updated queue list, Runtime Coverage, and Validation Checklist to include all four queues plus DLQ consumer and replay route | Keep edge-functions.md queue references in sync after future queue additions |

## Commands Run During This Cycle

| Command | Result | Notes |
| --- | --- | --- |
| `git ls-files '*.md' | wc -l` | `146` | Current tracked Markdown baseline for this re-baseline pass |
| `git ls-files 'docs/**/*.md' | wc -l` | `84` | Current tracked docs baseline for this re-baseline pass |
| `ls .github/workflows | wc -l` | `4` | Current workflow inventory |
| `ls supabase/migrations/*.sql | wc -l` | `149` | Current root migration count |
| `ls awcms/supabase/migrations/*.sql | wc -l` | `149` | Current mirrored migration count |
| `git remote -v` | `ahliweb/awcms` | Confirmed repository identity for GitHub MCP review |

## Context7 Verification Log

| Library ID | Query Focus | Takeaway Applied |
| --- | --- | --- |
| `/supabase/supabase-js` | client init, auth session handling, server-only secrets | Preserve `createClient(...)`, auth session event handling, and strict separation between publishable and secret keys |
| `/withastro/docs` | static output, build-time envs, `getStaticPaths()` | Keep public docs static-first and centered on build-time tenant resolution |
| `/cloudflare/cloudflare-docs` | Wrangler local dev, deploys, secret handling | Keep `wrangler deploy` / `wrangler secret put` explicit and re-evaluate local secret workflow wording |
| `/vitejs/vite` | installed-major alignment and build/dev guidance | Authority docs should reflect actual installed Vite version from manifests |

## Prior Cycle Notes (Historical Reference)

The sections below are preserved as historical evidence from prior audit passes. They must not be treated as the current repository baseline.

## Commands Run During This Cycle (2026-03-19 Historical)

| Command | Result | Notes |
| --- | --- | --- |
| `scripts/verify_supabase_migration_consistency.sh` | Passed (145/145) | Historical Phase 5 snapshot; superseded by current `149/149` parity |
| `cd awcms && npm run docs:check` | Passed | No broken doc targets introduced by Phase 5 changes |
| `cd awcms-edge && npx tsc --noEmit` | 0 errors | TypeScript clean after Phase 5 queue additions |
| `git ls-files '*.md' \| wc -l` | `144` | Historical Phase 5 snapshot; superseded by current `146` baseline |
| `git ls-files 'docs/**/*.md' \| wc -l` | `82` | Historical Phase 5 snapshot; superseded by current `84` baseline |
| `ls supabase/migrations/*.sql \| wc -l` | `145` | Historical Phase 5 snapshot; superseded by current `149` baseline |

## Remaining Closure Criteria

- Remove the real Cloudflare account ID fallback from `.github/workflows/deploy-smandapbun.yml`.
- Re-baseline `README.md`, `SYSTEM_MODEL.md`, `AGENTS.md`, `docs/architecture/tech-stack.md`, and workspace READMEs to exact manifest versions.
- Update all stale inventory and migration-count snapshots to `146` / `84` / `149` / `149`.
- Reconcile `docs/deploy/cloudflare.md` and `SECURITY.md` with current workflow and Worker runtime behavior.
- Add documentation coverage for recent notification, user-RLS, and security-advisor/storage migrations.
- Rerun `cd awcms && npm run docs:check` and `scripts/verify_supabase_migration_consistency.sh` after the next remediation batch.
- Continue the workspace README and schema/security coverage pass before closing the cycle.
