# Repository Documentation Audit and Remediation Plan (Context7-First)

> Owner: Documentation Steward (AI + Maintainers)
>
> Audit Cycle: 2026-03-19 Phase 5 queue integration drift remediation
>
> Last Updated: 2026-03-19
>
> Primary Authority Chain: `SYSTEM_MODEL.md` -> `AGENTS.md` -> `README.md` -> `DOCS_INDEX.md` -> implementation/package docs

## Mission

Audit every maintained documentation surface in the repository, reconcile each claim against the live
codebase, database migrations, scripts, workflows, and package manifests, and use Context7 as the
primary external reference for library-specific best practices.

This cycle explicitly covers:

- stale authority docs and contradictory version claims
- database schema and migration drift
- broken, missing, or misleading scripts and commands
- security guidance drift around secrets, auth, RLS, and edge runtimes
- performance guidance drift across admin, public, and Worker surfaces
- dead links, missing canonical targets, and stale navigation
- package README drift and workspace-level setup inaccuracies

## Current Baseline (Verified 2026-03-19)

| Surface | Verified State | Evidence Source |
| --- | --- | --- |
| Tracked Markdown files | `144` | `git ls-files '*.md'` (decreased from 153 after doc cleanup during Phase 5) |
| Tracked docs files | `82` | `git ls-files 'docs/**/*.md'` |
| Root Supabase migrations | `145` | `supabase/migrations/*.sql` |
| Mirrored admin/CI migrations | `145` | `awcms/supabase/migrations/*.sql` |
| Package manifests | `10` | `git ls-files '**/package.json'` |
| GitHub workflows | `4` | `.github/workflows/*` |
| MCP servers in `mcp.json` | `cloudflare`, `context7`, `github`, `supabase`, `paper` | `mcp.json` |
| Docs validation | Passes | `cd awcms && npm run docs:check` |
| Migration parity | Passes | `scripts/verify_supabase_migration_consistency.sh` |

## Critical Findings Driving This Cycle

| ID | Severity | Finding | Evidence | Required Action |
| --- | --- | --- | --- | --- |
| PLAN-201 | High | Authority docs used stale runtime versions (Astro 5, older Supabase JS, older Framer/Lucide/i18next versions) | Resolved against workspace manifests | Completed |
| PLAN-202 | High | Audit plan/tracker previously presented the prior cycle as closed and fully reconciled | Resolved by reopening the cycle with current evidence | Completed |
| PLAN-203 | High | Supabase migration mirror parity was broken by 8 mirror-only files | Resolved by backfilling the canonical root migrations and restoring filename/content parity | Completed |
| PLAN-204 | Medium | Top-level snapshots previously claimed stale inventory and parity counts | Resolved with current `153` / `81` / `144/144` baseline | Completed |
| PLAN-205 | Medium | Public portal docs still referenced Astro 5 while active workspaces ran Astro 6 | Resolved in authority/public/package docs | Completed |
| PLAN-206 | Medium | Cloudflare Worker secret guidance needed alignment with Wrangler `.dev.vars` and `wrangler secret put` practices | Resolved by standardizing local docs and Worker scripts around `.dev.vars` and production secrets via Wrangler | Completed |
| PLAN-207 | High | `deploy-smandapbun.yml` hardcoded a real Cloudflare account ID (`5255727b...`) in `env:` — a security risk exposing account-level identifiers in public CI logs | Replaced hardcoded value with `${{ secrets.CLOUDFLARE_ACCOUNT_ID \|\| vars.CLOUDFLARE_ACCOUNT_ID }}` | Completed |
| PLAN-208 | High | MCP topology in `SYSTEM_MODEL.md`, `AGENTS.md`, and `README.md` did not match `mcp.json`: `paper` server omitted; `cloudflare` entry incorrectly listed as 7 separate granular servers instead of the single `@cloudflare/mcp-server-cloudflare` package | Reconciled all authority docs against `mcp.json` | Completed |
| PLAN-209 | Medium | Repository inventory snapshot counts were stale: `145` Markdown files (actual `153`), `77` docs (actual `81`), `5` GitHub workflows (current `4`) | Updated all snapshot references in authority docs and audit docs | Completed |
| PLAN-210 | Medium | `docs/dev/ci-cd.md` needed to reflect the current workflow inventory accurately after the latest CI cleanup | Reconciled the workflow inventory to the current 4-workflow baseline | Completed |
| PLAN-211 | Low | `docs/dev/versioning.md` section 5 CI excerpt still used the obsolete `contains(github.event.commits[0].modified, ...)` condition instead of the current `dorny/paths-filter` pattern | Updated excerpt to reflect current `paths-filter` architecture | Completed |
| PLAN-212 | Low | `scripts/detect_legacy_storage.sh` became obsolete once Worker compatibility proxies and client storage guards became the canonical runtime checks; its legacy-pattern checks now produced false positives | Removed the obsolete script and retained validation through runtime tests and Worker smoke checks | Completed |
| PLAN-213 | High | Migration mirror parity broken by Phase 5: `20260319120000_create_queue_dead_letters.sql` was not copied to `awcms/supabase/migrations/` | Copied missing migration; parity restored at 145/145 | Completed 2026-03-19 |
| PLAN-214 | Medium | `docs/architecture/queue-topology.md` "Planned Queues" table mislabeled delivered Phase 5 work: listed `awcms-audit-export` as "Phase 5" when Phase 5 (DLQ + observability + replay) was already shipped | Relabeled to "Phase 6+" | Completed 2026-03-19 |
| PLAN-215 | Medium | `docs/dev/edge-functions.md` omitted `awcms-notifications` queue, both DLQ queues, the DLQ consumer, and the admin replay route from the queue reference, Runtime Coverage list, and Validation Checklist | Updated all three sections to reflect current four-queue + DLQ consumer + replay route architecture | Completed 2026-03-19 |

## Context7 Validation Matrix

| Surface | Library ID | Current Guidance Used In This Cycle |
| --- | --- | --- |
| Supabase JS client usage | `/supabase/supabase-js` | Use `createClient(...)` with PKCE/session options, `getSession()` / `onAuthStateChange()`, and keep secret keys server-side only |
| Astro static builds | `/withastro/docs` | Keep static output build-time data fetching centered on `getStaticPaths()` and build env values |
| Cloudflare Workers | `/cloudflare/cloudflare-docs` | Use `wrangler dev`, `wrangler deploy`, and `wrangler secret put`; local-only secrets should be documented clearly |

## Scope

### In Scope

| Tier | Paths | Purpose |
| --- | --- | --- |
| Tier 0 - Authority | `SYSTEM_MODEL.md`, `AGENTS.md`, `README.md`, `DOCS_INDEX.md`, `docs/README.md` | Canonical architecture, operational baseline, and routing |
| Tier 1 - Core docs | `docs/architecture/**`, `docs/security/**`, `docs/tenancy/**`, `docs/deploy/**`, `docs/dev/**`, `docs/modules/**`, `docs/product/**`, `docs/guides/**`, `docs/compliance/**` | Implementation, runbooks, and product docs |
| Tier 2 - Package docs | `**/README.md` for maintained workspaces/packages | Workspace setup and runtime notes |
| Tier 3 - Truth sources | `supabase/**`, `awcms/supabase/**`, `awcms-edge/**`, `scripts/**`, `.github/workflows/**`, `package.json` files, `pubspec.yaml`, `mcp.json` | Evidence used for reconciliation |

### Out of Scope

- Vendored, generated, or upstream template docs that are not part of the maintained canonical surface.
- Binary assets and non-Markdown deliverables.

## Audit Workflow

### Phase 0 - Inventory and Authority Re-baseline

1. Refresh repository metrics and active status snapshots.
2. Correct authority docs before editing downstream docs.
3. Record contradictions, missing docs, and unresolved structural drift in the tracker.

### Phase 1 - Schema, Security, and Tenancy Reconciliation

1. Treat `supabase/migrations/` as the canonical schema source until parity is restored.
2. Reconcile database, tenancy, and security docs against current migrations and helper functions.
3. Verify soft-delete, `tenant_id`, RLS, ABAC, and secret-naming guidance.

### Phase 2 - Scripts, Tooling, and CI/CD Reconciliation

1. Validate every documented command against actual scripts and workflow jobs.
2. Reconcile docs with the current four-workflow GitHub Actions setup.
3. Document known intentional divergences, not just the happy path.

### Phase 3 - Public, Admin, Worker, Mobile, IoT, and Package README Pass

1. Verify workspace-specific versions and commands from local manifests.
2. Update package READMEs to link back to canonical docs.
3. Remove stale claims copied from previous stack baselines.

### Phase 4 - Conflict Review and Risk Closure

1. Triage dependency drift, dead links, script failures, security concerns, and performance guidance drift.
2. Mark each finding as `resolved`, `accepted divergence`, `follow-up required`, or `blocked`.
3. Do not close the cycle while any high-severity drift remains unresolved or undocumented.

## Conflict Review Matrix

| Conflict Class | Detection Method | Exit Criteria |
| --- | --- | --- |
| Version drift | Compare docs to `package.json` / `pubspec.yaml` / lockfiles | Authority and package docs match active manifests |
| Migration drift | Run `scripts/verify_supabase_migration_consistency.sh` | Root/mirror parity restored or divergence explicitly documented and approved |
| Script drift | Compare docs to `scripts/**` and workspace scripts | Every documented command exists and reflects current behavior |
| Security drift | Review env naming, key handling, auth, RLS, Worker docs | No doc instructs unsafe secret handling or RLS bypass |
| Performance drift | Compare docs to current public/admin architecture | Performance guidance matches the current static-first and Worker-backed model |
| Dead links | Run `npm run docs:check` and review local target validator output | Canonical docs link only to valid maintained targets |

## Execution Queue

1. Re-baseline the authority docs and package/version references.
2. Re-open the tracker with current evidence and unresolved blockers.
3. Keep root/mirror migration parity intact as new migrations are added.
4. Reconcile public portal docs against Astro 6 and current per-workspace dependency versions.
5. Re-run docs validation and migration consistency after each remediation batch.
6. Close the cycle only after all high-severity findings are resolved or explicitly accepted with owner and rationale.

## Validation Gates

| Gate | Command | Expected Result |
| --- | --- | --- |
| Docs links | `cd awcms && npm run docs:check` | Pass |
| Migration parity | `scripts/verify_supabase_migration_consistency.sh` | Pass after remediation |
| Admin sanity | `cd awcms && npm run lint && npm run build` | Pass when admin-facing docs or scripts change materially |
| Public sanity | `cd awcms-public/primary && npm run check && npm run build` | Pass when public docs or env guidance change materially |
| Worker sanity | `cd awcms-edge && npm run typecheck` | Pass when Worker docs or runtime guidance change materially |

## Deliverables

- Updated authority docs that match the live repository state.
- A live tracker with evidence-backed findings and owners.
- Corrected package/public docs for current versions and commands.
- A clear remediation path for migration parity, dependency drift, security wording, and script accuracy.
