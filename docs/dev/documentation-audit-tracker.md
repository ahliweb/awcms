# Documentation Audit Tracker - 2026-03-13 Re-Baseline

> Related Plan: `docs/dev/documentation-audit-plan.md`
>
> Status: Completed for the 2026-03-14 remediation scope; continue with routine maintenance for future drift.
>
> Last Updated: 2026-03-14

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
| Tracked Markdown files | `144` | `git ls-files '*.md'` |
| Tracked docs files | `76` | `git ls-files 'docs/**/*.md'` |
| Root migrations | `139` | `supabase/migrations/*.sql` |
| Mirrored migrations | `139` | `awcms/supabase/migrations/*.sql` |
| Package manifests | `10` | `git ls-files '**/package.json'` |
| GitHub workflows | `5` | `.github/workflows/*` |
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
| DOCSYNC-107 | High | `deploy-smandapbun.yml` hardcoded the real Cloudflare account ID (`5255727b...`) as a plain `env:` value, exposing it in CI logs and public workflow files | Resolved | Replaced with `${{ secrets.CLOUDFLARE_ACCOUNT_ID \|\| vars.CLOUDFLARE_ACCOUNT_ID }}` | Add `CLOUDFLARE_ACCOUNT_ID` to GitHub repository secrets or variables |
| DOCSYNC-108 | High | MCP topology in `SYSTEM_MODEL.md`, `AGENTS.md`, and `README.md` diverged from `mcp.json`: `paper` server absent; `cloudflare` incorrectly described as 7 granular managed remote MCPs instead of the single `@cloudflare/mcp-server-cloudflare` package | Resolved | Reconciled all three authority docs against `mcp.json` | Re-verify after any future `mcp.json` change |
| DOCSYNC-109 | Medium | Inventory snapshot counts were stale: `145` Markdown (actual `144`), `77` docs (actual `76`), `4` workflows (actual `5`) across `README.md`, `docs/dev/documentation-audit-plan.md`, and this tracker | Resolved | Updated all snapshot tables to `144` / `76` / `5` | Re-run `git ls-files '*.md' \| wc -l` and `ls .github/workflows/ \| wc -l` after each doc addition or workflow addition |
| DOCSYNC-110 | Medium | `docs/dev/ci-cd.md` omitted `deploy-smandapbun.yml` from its workflow inventory and stated an incorrect workflow count of `4` | Resolved | Added `deploy-smandapbun` workflow entry and updated count to `5` | Keep `ci-cd.md` workflow table in sync as new workflows are added |
| DOCSYNC-111 | Low | `docs/dev/versioning.md` section 5 still showed the obsolete `contains(github.event.commits[0].modified, ...)` CI condition rather than the `dorny/paths-filter` pattern currently used | Resolved | Updated section 5 excerpt to reflect the current `paths-filter` pattern | No further action required unless CI architecture changes |

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

## Commands Run During This Cycle (2026-03-14)

| Command | Result | Notes |
| --- | --- | --- |
| `git ls-files '*.md' \| wc -l` | `144` | Corrected from stale `145` snapshot |
| `git ls-files 'docs/**/*.md' \| wc -l` | `76` | Corrected from stale `77` snapshot |
| `ls .github/workflows/ \| wc -l` | `5` | Corrected from stale `4` — `deploy-smandapbun.yml` was uncounted |
| `cat mcp.json` | `supabase`, `context7`, `github`, `cloudflare`, `paper` | Corrected from stale list that omitted `paper` and misrepresented `cloudflare` |

## Remaining Closure Criteria

- Add `CLOUDFLARE_ACCOUNT_ID` to GitHub repository secrets or variables before the next `deploy-smandapbun` run.
- Rerun docs validation and migration parity after future authority-doc, migration, or Worker-runtime changes.
- Keep `.dev.vars` local-only and continue using `wrangler secret put` for deployed Worker secrets.
