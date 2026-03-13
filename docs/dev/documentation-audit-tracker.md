# Documentation Audit Tracker - 2026-03-13 Re-Baseline

> Related Plan: `docs/dev/documentation-audit-plan.md`
>
> Status: Completed for the requested remediation scope; continue with routine maintenance for future drift.
>
> Last Updated: 2026-03-13

## Current Phase Status

| Phase | Status | Notes |
| --- | --- | --- |
| Phase 0 - Inventory and Authority Re-baseline | Completed | Authority docs and planning docs refreshed to current repo evidence |
| Phase 1 - Schema, Security, and Tenancy Reconciliation | Completed | Migration parity restored and schema-status docs re-baselined |
| Phase 2 - Scripts, Tooling, and CI/CD Reconciliation | Completed | Workflow count, script reality, and Worker secret guidance were reconciled |
| Phase 3 - Workspace and Package README Pass | Completed | Public and Worker README surfaces updated for current runtime versions |
| Phase 4 - Conflict Review and Risk Closure | Completed | Requested remediation scope closed with validation rerun |

## Verified Baseline Snapshot

| Surface | Current State | Evidence |
| --- | --- | --- |
| Tracked Markdown files | `145` | `git ls-files '*.md'` |
| Tracked docs files | `77` | `git ls-files 'docs/**/*.md'` |
| Root migrations | `139` | `supabase/migrations/*.sql` |
| Mirrored migrations | `139` | `awcms/supabase/migrations/*.sql` |
| Package manifests | `10` | `git ls-files '**/package.json'` |
| GitHub workflows | `4` | `.github/workflows/*` |
| Docs validation | Pass | `cd awcms && npm run docs:check` |
| Migration parity | Pass | `scripts/verify_supabase_migration_consistency.sh` |

## Active Drift Register

| ID | Severity | Finding | Status | Evidence | Next Action |
| --- | --- | --- | --- | --- | --- |
| DOCSYNC-101 | High | Authority docs used stale stack versions for Astro, Supabase JS, Framer Motion, Lucide, and i18next | Resolved in authority docs | `README.md`, `SYSTEM_MODEL.md`, `AGENTS.md`, `docs/architecture/tech-stack.md` vs workspace manifests | Continue cascading corrected versions into any remaining downstream docs |
| DOCSYNC-102 | High | Audit plan/tracker incorrectly implied the previous cycle was closed and current drift was resolved | Resolved | Replaced stale plan/tracker with active 2026-03-13 cycle docs | Keep tracker live until high-severity findings are closed |
| DOCSYNC-103 | High | Migration mirror parity was broken: 8 mirror-only SQL files existed in `awcms/supabase/migrations/` | Resolved | Backfilled `supabase/migrations/20260313000100` through `20260313000800` and reran parity verification successfully | Keep adding new migrations to both roots and rerun parity checks |
| DOCSYNC-104 | Medium | Baseline counts in docs were stale (`136` Markdown, `68` docs, `131/131` migrations, `3` workflows) | Resolved in plan/status docs | Inventory commands and workflow directory check | Sweep remaining references to old counts |
| DOCSYNC-105 | Medium | Public docs and package READMEs still referenced Astro 5 for active public workspaces | Resolved | Updated authority docs, public docs, `awcms-public/primary/README.md`, and `awcms-public/smandapbun/README.md` | Keep tenant-specific versions explicit when public workspaces diverge |
| DOCSYNC-106 | Medium | Worker secret/local-dev guidance needed standardization against current Wrangler best practices | Resolved | Standardized on `awcms-edge/.dev.vars` for local Worker secrets, added `.dev.vars.example`, updated `awcms-edge/package.json`, and documented production secrets via `wrangler secret put` | Keep Worker docs aligned with Wrangler conventions |

## Commands Run During This Cycle

| Command | Result | Notes |
| --- | --- | --- |
| `cd awcms && npm run docs:check` | Passed | Local markdown target validator confirmed maintained doc targets; `markdown-link-check` still reports filesystem links as `[ / ]`, which is expected in this workflow |
| `scripts/verify_supabase_migration_consistency.sh` | Passed | Root/mirror filename and content parity restored; local migration inventory aligns at `139` |

## Context7 Verification Log

| Library ID | Query Focus | Takeaway Applied |
| --- | --- | --- |
| `/supabase/supabase-js` | client init, auth session handling, server-only secrets | Preserve `createClient(...)`, auth session event handling, and strict separation between publishable and secret keys |
| `/withastro/docs` | static output, build-time envs, `getStaticPaths()` | Keep public docs static-first and centered on build-time tenant resolution |
| `/cloudflare/cloudflare-docs` | Wrangler local dev, deploys, secret handling | Keep `wrangler deploy` / `wrangler secret put` explicit and re-evaluate local secret workflow wording |

## Remaining Closure Criteria

- Rerun docs validation and migration parity after future authority-doc, migration, or Worker-runtime changes.
- Keep `.dev.vars` local-only and continue using `wrangler secret put` for deployed Worker secrets.
