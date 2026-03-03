# Documentation Audit Tracker - Context7 Re-Audit

> **Date:** 2026-03-03
>
> **Related Plan:** `docs/dev/documentation-audit-plan.md`
>
> **Status:** 2026-02-27 re-audit cycle completed. 2026-03-03 micro-cycle in progress.

## 2026-03-03 Micro-Cycle

### Trigger

Post-audit changes (2026-03-01 migration batch, new Ollama integration doc, Lucide version drift) introduced new drift items not covered by the completed 2026-02-27 cycle.

### Drift Register (2026-03-03)

| ID | Severity | Finding | Status | Evidence |
| --- | --- | --- | --- | --- |
| NEWDRIFT-001 | High | Migration parity broken: root had 107 files, mirror had 101 (6 unmirrored + 2 renamed files from 2026-03-01 batch) | Resolved | `diff` of `supabase/migrations/` vs `awcms/supabase/migrations/`; files copied and parity verified |
| NEWDRIFT-002 | High | Mirror contained renamed files (`remote_sync.sql`) that didn't match root filenames (`remote_schema.sql`, `fix_create_tenant_unused_var.sql`, etc.) | Resolved | Deleted incorrect files, copied correct files from root |
| NEWDRIFT-003 | Medium | AGENTS.md Lucide React version listed as `0.561.0 / 0.564.0` but admin `package.json` uses `^0.564.0` | Resolved | `AGENTS.md` line 68 updated to `0.564.0` |
| NEWDRIFT-004 | Medium | Tracker baseline claimed 99 mirrored migrations; actual count is now 107/107 | Resolved | This entry; baseline snapshot updated below |
| NEWDRIFT-005 | Low | `awcms.wiki/architecture/ollama-integration.md` added but not in tracker inventory | Resolved | Listed in DOCS_INDEX.md; added to inventory below |

### Updated Baseline Snapshot (2026-03-03)

| Surface | Evidence |
| --- | --- |
| Migration parity | `supabase/migrations/*.sql` = 107, `awcms/supabase/migrations/*.sql` = 107 (verified via `diff`) |
| Total markdown files in repository | 105+ (includes new `awcms.wiki/architecture/ollama-integration.md`) |
| Lucide React (Admin + Public) | `^0.564.0` (aligned) |

### Micro-Cycle Exit Check

- NEWDRIFT-001 through NEWDRIFT-005: all resolved.
- Migration parity confirmed via filename diff.
- AGENTS.md Lucide version corrected.
- Tracker inventory and baseline counts refreshed.

---

## Current Cycle Status

| Phase | Status | Notes |
| --- | --- | --- |
| Phase 0 - Re-Inventory and Drift Refresh | Completed | Inventory refreshed, baseline evidence captured, drift register updated |
| Phase 1 - Authority Reconciliation | Completed | Authority docs reconciled, Context7 IDs normalized, terminology aligned |
| Phase 2 - DB/Security/Tenancy Reconciliation | Completed | DB/security/tenancy docs reconciled against migrations and Context7 matrix expanded |
| Phase 3 - Scripts/CI/Deploy Reconciliation | Completed | CI/deploy/docs commands reconciled and runtime constraints aligned in package manifests |
| Phase 4 - Feature + Package Documentation Pass | Completed | Module/package reconciliation completed; README coverage and metadata classification gaps resolved |
| Phase 5 - QA and Publication | Completed | Lint/link/build validation gates executed and changelog updated |

## Phase 0 Update (Current Cycle)

### Scope Executed (Phase 0)

- Rebuilt markdown inventory across the full repository.
- Refreshed docs-area counts for all `docs/**` domains.
- Re-validated baseline truth sources (package scripts, workflows, migration roots).
- Logged Context7 preflight verification for Supabase CLI, Astro, and Vite guidance.

### Inventory Snapshot (2026-02-27)

| Surface | Count | Notes |
| --- | ---: | --- |
| Total markdown files in repository | 104 | Includes docs, package READMEs, `.agents` references, and issue templates |
| `docs/**/*.md` | 63 | Canonical documentation scope |
| `docs/architecture/*.md` | 7 | No change |
| `docs/security/*.md` | 4 | No change |
| `docs/tenancy/*.md` | 4 | No change |
| `docs/deploy/*.md` | 2 | No change |
| `docs/compliance/*.md` | 3 | No change |
| `docs/dev/*.md` | 17 | Increased from 15 (added benchmark playbook + refreshed plan) |
| `docs/modules/*.md` | 21 | No change |
| `docs/guides/*.md` | 3 | No change |
| `docs/*.md` root files | 2 | `docs/README.md`, `docs/RESOURCE_MAP.md` |

### Package README Surfaces (Current)

- Maintained/actionable package README files:
  - `awcms/README.md`
  - `awcms-mcp/README.md`
  - `awcms-public/README.md`
  - `awcms-public/primary/README.md`
  - `awcms-public/smandapbun/README.md`
  - `awcms-mobile/README.md`
  - `awcms-mobile/primary/README.md`
  - `awcms-mobile-java/README.md`
  - `awcms-esp32/README.md`
  - `awcms-esp32/primary/README.md`
  - `awcms-ext/README.md`
- Non-authoritative/vendor/template README files (excluded):
  - `awcms-public/primary/vendor/README.md`
  - `awcms-mobile/primary/ios/Runner/Assets.xcassets/LaunchImage.imageset/README.md`
  - `awcms/src/templates/flowbiteadminastro/README.md`
  - `awcms/src/templates/flowbiteadminastro/src/components/README.md`
  - `awcms/src/templates/flowbiteadminastro/src/services/README.md`

### Baseline Evidence Refresh

| Surface | Evidence |
| --- | --- |
| Node runtime in CI | `.github/workflows/ci-pr.yml` and `ci-push.yml` use `NODE_VERSION: '22.12.0'` |
| Core package engines | `awcms`, `awcms-public`, `awcms-public/primary`, `awcms-public/smandapbun` specify `>=22.12.0` |
| Docs link validation | `awcms`: `npm run docs:check` passes |
| Migration parity | `scripts/verify_supabase_migration_consistency.sh` passes (`99` mirrored migration files, local history aligned) |
| Migration roots | `supabase/migrations/*.sql` = `99`, `awcms/supabase/migrations/*.sql` = `99` |

### Context7 Verification Log (Phase 0 Preflight)

| Library ID | Query Focus | Takeaway |
| --- | --- | --- |
| `/supabase/cli` | local vs linked migration workflow and push safety | Keep docs explicit on `migration list --local\|--linked`, `db push --dry-run`, and repair workflow |
| `/withastro/docs` | static route generation and build-time data with `getStaticPaths` | Keep public docs build-time tenant resolution explicit; avoid runtime-only assumptions in static mode |
| `/vitejs/vite` | `loadEnv` behavior and `VITE_` exposure model | Preserve `VITE_` client exposure rules; use `loadEnv` in config-time scenarios |

### Drift Register (Current Cycle)

| ID | Severity | Finding | Status | Evidence |
| --- | --- | --- | --- | --- |
| REAUDIT-001 | High | `docs/README.md` contained broad conceptual sections not consistently evidence-linked to implementation/module docs | Resolved (Phase 1) | `docs/README.md`, `DOCS_INDEX.md`, `README.md`, `SYSTEM_MODEL.md` |
| REAUDIT-002 | Medium | No maintained package README exists for `awcms-public/smandapbun`, creating a documentation gap for that workspace | Resolved (Phase 4) | `awcms-public/smandapbun/README.md`, `awcms-public/README.md`, README inventory |
| REAUDIT-003 | Medium | Context7 matrix in plan included 12 libraries, but Phase 0 preflight re-validated only 3; remaining libraries needed verification pass | Resolved (Phase 2) | Context7 verification log (Phase 0 + Phase 2), `docs/dev/documentation-audit-plan.md` |
| REAUDIT-004 | Medium | Authority docs stated Node `>=22.12.0` baseline, but `awcms-mcp/package.json` did not declare `engines.node`; enforcement was implicit, not manifest-based | Resolved (Phase 3) | `awcms-mcp/package.json`, `docs/dev/ci-cd.md`, `.github/workflows/ci-pr.yml`, `.github/workflows/ci-push.yml` |
| REAUDIT-005 | Low | Repository has 104 markdown files, including `.agents` skill references and issue templates not yet classified by ownership/status in current cycle tracker | Resolved (Phase 4) | `rg --files -g "*.md" .agents`, `rg --files -g "*.md" .github/ISSUE_TEMPLATE`, classification notes in Phase 4 update |

## Phase 1 Update (Current Cycle)

### Scope Executed (Phase 1)

- Reconciled Tier 0 authority docs against current repository truth sources.
- Normalized Context7 Astro library ID references to `withastro/docs` across authority surfaces.
- Aligned security/key terminology to prioritize `SUPABASE_SECRET_KEY` server-side usage wording.
- Reworked `docs/README.md` into an implementation-backed hub that routes to canonical docs instead of conceptual guidance.

### Files Updated (Phase 1)

- `SYSTEM_MODEL.md`
- `AGENTS.md`
- `README.md`
- `DOCS_INDEX.md`
- `docs/README.md`

### Phase 1 Exit Check

- Authority chain remains consistent across all Tier 0 docs.
- Context7 library IDs in authority docs are aligned (`withastro/docs`).
- `docs/README.md` now functions as documentation routing hub with evidence-source guidance.

## Phase 2 Update (Current Cycle)

### Scope Executed (Phase 2)

- Reconciled tenancy, security, and database docs against active migration evidence.
- Normalized privileged access wording to `SUPABASE_SECRET_KEY` server-side usage.
- Clarified tenant provisioning RPC signature behavior in Supabase tenancy docs.
- Added migration-source snapshots for core security helper functions.
- Completed Context7 verification pass for the remaining libraries in the plan matrix.

### Files Updated (Phase 2)

- `SYSTEM_MODEL.md`
- `docs/tenancy/overview.md`
- `docs/tenancy/supabase.md`
- `docs/security/overview.md`
- `docs/security/abac.md`
- `docs/security/rls.md`
- `docs/architecture/database.md`

### Context7 Verification Log (Phase 2 Completion)

| Library ID | Query Focus | Takeaway |
| --- | --- | --- |
| `/supabase/supabase` | multi-tenant RLS policy design | Keep RLS as hard boundary with tenant-scoped predicates and security definer helpers |
| `/supabase/supabase-js` | client init/auth/session best practices | Keep PKCE, session persistence, and scoped headers patterns in docs |
| `/remix-run/react-router` | route params/loaders data safety | Keep dynamic params + loader patterns explicit in admin/public docs |
| `/websites/react_dev` | React 19 component patterns | Preserve function component-first guidance and targeted optimization notes |
| `/websites/tailwindcss` | Tailwind v4 tokens and CSS variables | Keep docs aligned to CSS-variable token strategy and utility-first usage |
| `/puckeditor/puck` | render and external data patterns | Keep `Render`-based safe rendering guidance and component config references |
| `/ueberdosis/tiptap-docs` | output/persistence and content handling | Keep JSON/HTML persistence guidance and sanitization boundaries explicit |
| `/grx7/framer-motion` | motion configuration and reduced motion | Keep animation guidance focused on performance and accessibility defaults |
| `/openclaw/openclaw` | multi-agent routing and secure gateway baseline | Keep per-tenant isolation and token/loopback security guidance in gateway docs |

### Phase 2 Exit Check

- Tenancy/security/database docs now reference migration-backed helper function sources.
- Service-role terminology in active docs is normalized to `SUPABASE_SECRET_KEY` server-only paths.
- Context7 matrix verification is complete for all libraries listed in the current audit plan.

## Phase 3 Update (Current Cycle)

### Scope Executed (Phase 3)

- Reconciled scripts/CI/deploy docs with active workflow files and script behavior.
- Validated documented migration and parity commands against current repository scripts.
- Fixed local verification path sequence in CI/CD docs to avoid invalid directory traversal.
- Added explicit note for known `supabase db lint` advisory warnings in CI parity guidance.
- Aligned package runtime enforcement by adding Node engine constraint to `awcms-mcp/package.json`.

### Files Updated (Phase 3)

- `docs/dev/ci-cd.md`
- `awcms-mcp/package.json`

### Evidence Snapshot (Phase 3)

- `scripts/verify_supabase_function_consistency.sh` -> passes (root/mirror function parity).
- `npx supabase migration list --local` -> executes successfully from repo root.
- `npx supabase db lint` (in `awcms/supabase`) -> executes with known advisory warnings and CI-compatible behavior.
- `.github/workflows/ci-pr.yml` and `.github/workflows/ci-push.yml` remain pinned to Node `22.12.0`.

### Phase 3 Exit Check

- CI/CD and deploy runbooks now use valid, reproducible command paths.
- Node runtime requirements are consistently declared in both authority docs and package manifests.
- Scripts/CI/deploy documentation reflects current workflow and script behavior.

## Phase 4 Update (Current Cycle)

### Scope Executed (Phase 4)

- Added maintained package README coverage for `awcms-public/smandapbun`.
- Updated `awcms-public/README.md` routing so package discovery includes both primary and tenant-specific portal packages.
- Classified non-canonical markdown surfaces tracked under REAUDIT-005.
- Completed package/module markdown quality pass for maintained README surfaces.

### Metadata Markdown Classification (Ownership/Status)

| Surface | Count | Classification | Ownership | Status in Current Cycle |
| --- | ---: | --- | --- | --- |
| `.agents/**/*.md` | 35 | Agent runtime skill/reference docs (non-canonical for product behavior) | AI tooling maintainers | Indexed as auxiliary; excluded from authority/module doc correctness gates |
| `.github/ISSUE_TEMPLATE/**/*.md` | 2 | Contribution templates (process docs) | Repository maintainers | Indexed as process docs; excluded from implementation truth-source reconciliation |

### Files Updated (Phase 4)

- `awcms-public/smandapbun/README.md` (new)
- `awcms-public/README.md`
- `awcms-mobile/README.md`
- `awcms-mobile/primary/README.md`
- `awcms-mobile-java/README.md`
- `awcms-esp32/README.md`
- `awcms-esp32/primary/README.md`
- `awcms-ext/README.md`

### Phase 4 Exit Check

- Package README gap REAUDIT-002 is resolved.
- Metadata ownership/status gap REAUDIT-005 is resolved.
- Maintained module docs and package README markdown lint checks pass.

## Phase 5 Update (Current Cycle)

### Scope Executed (Phase 5)

- Ran repository documentation validation gates for updated planning/tracker/docs surfaces.
- Re-ran docs link checks and migration/function parity checks to confirm no regression.
- Executed package sanity checks for touched workspaces (`awcms`, `awcms-public/primary`, `awcms-mcp`).
- Updated changelog with final re-audit closure notes.

### Evidence Snapshot (Phase 5)

- `npx markdownlint-cli --config ".markdownlint.json" docs/dev/documentation-audit-plan.md docs/dev/documentation-audit-tracker.md docs/dev/ci-cd.md` -> passes.
- `npx markdownlint-cli --config ".markdownlint.json" docs/modules/*.md` + maintained package README set -> passes.
- `cd awcms && npm run docs:check` -> passes.
- `scripts/verify_supabase_migration_consistency.sh` -> passes.
- `scripts/verify_supabase_function_consistency.sh` -> passes.
- `cd awcms && npm run lint && npm run build` -> passes.
- `cd awcms-public/primary && npm run check && npm run build` -> passes.
- `cd awcms-mcp && npm run lint && npm run build` -> passes.

### Phase 5 Exit Check

- Validation gates required by the current re-audit cycle are complete.
- No unresolved high-severity drift items remain in current-cycle register.

## Previous Cycle Archive (Completed Baseline)

## 1) Scope Executed

Phase 0 baseline coverage completed for:

- Tier 0 authority docs and documentation index surfaces.
- `docs/**` architecture, security, tenancy, deploy, dev, module, and guide docs.
- package-level README surfaces in `awcms*` packages.
- operational truth sources: `package.json`, `.github/workflows/**`, and Supabase migration trees.

## 2) Inventory Summary

### Tier 0 Authority Docs

| File | Present | Notes |
| --- | --- | --- |
| `README.md` | Yes | Canonical onboarding and stack overview |
| `AGENTS.md` | Yes | Primary AI collaboration rules |
| `SYSTEM_MODEL.md` | Yes | Canonical system constraints |
| `DOCS_INDEX.md` | Yes | Documentation map |
| `docs/README.md` | Yes | Docs entrypoint |

### `docs/**` Coverage Snapshot

| Area | Count |
| --- | ---: |
| `docs/architecture/*.md` | 7 |
| `docs/security/*.md` | 4 |
| `docs/tenancy/*.md` | 4 |
| `docs/deploy/*.md` | 2 |
| `docs/compliance/*.md` | 3 |
| `docs/dev/*.md` | 15 |
| `docs/modules/*.md` | 21 |
| `docs/guides/*.md` | 3 |
| root docs in `docs/` (`README.md`, `RESOURCE_MAP.md`) | 2 |
| **Total `docs/**` markdown files** | **61** |

### Package README Surfaces (Actionable)

- Primary package docs identified in:
  - `awcms/README.md`
  - `awcms-mcp/README.md`
  - `awcms-public/README.md`
  - `awcms-public/primary/README.md`
  - `awcms-public/smandapbun/README.md` (if added in later pass)
  - `awcms-mobile/README.md`
  - `awcms-mobile/primary/README.md`
  - `awcms-mobile-java/README.md`
  - `awcms-ext/README.md`
  - `awcms-esp32/README.md`
  - `awcms-esp32/primary/README.md`
- Excluded from audit scope as non-authoritative vendor/generated docs:
  - `awcms-public/primary/vendor/README.md`
  - `awcms-mobile/primary/ios/Runner/Assets.xcassets/LaunchImage.imageset/README.md`
  - `awcms/src/templates/flowbiteadminastro/README.md` (upstream third-party template docs)
  - `awcms/src/templates/flowbiteadminastro/src/components/README.md` (template-internal notes)
  - `awcms/src/templates/flowbiteadminastro/src/services/README.md` (template-internal notes)

## 3) Baseline Evidence Snapshot

### Runtime and Tooling Baseline

| Surface | Current Evidence |
| --- | --- |
| Node engines (`awcms`, `awcms-public/primary`, `awcms-public`, `awcms-public/smandapbun`) | `>=22.12.0` |
| Admin core stack | React 19.2.4, Vite 7.2.7, Tailwind 4.1.18, Supabase JS 2.93.3 |
| Public core stack | Astro 5.17.1, React 19.2.4, Tailwind 4.1.18, Supabase JS 2.93.3 |
| MCP package | `awcms-mcp` (TypeScript + MCP SDK) |
| CI Node pin | `.github/workflows/ci-pr.yml`, `.github/workflows/ci-push.yml`, `.github/workflows/docs-link-check.yml` pinned to Node `22.12.0` |

### Supabase Baseline

- Dual migration trees detected and currently mirrored:
  - `supabase/migrations/**`
  - `awcms/supabase/migrations/**`
- Local migration history is aligned in both roots through:
  - `20260226110000_fix_sync_resource_tags_article_tags_reference.sql`
- `supabase db lint` runs successfully from both roots (existing advisory warnings remain outside documentation scope).

### Docs Validation Baseline

- Link validation command passes:
  - `awcms`: `npm run docs:check`

## 4) Context7 Verification Log (Phase 0)

| Library ID | Query Focus | Baseline Takeaway |
| --- | --- | --- |
| `/supabase/cli` | migration/lint/push/pull workflow | Keep docs explicit about `--local` vs `--linked` and linked-project assumptions |
| `/withastro/docs` | `define:vars` and `is:inline` behavior | Astro docs should explicitly note implied inline behavior on script directives |
| `/vitejs/vite` | `loadEnv` and env exposure rules | Docs must preserve `VITE_` client exposure rule and `loadEnv` guidance in config |

## 5) Drift Register

| ID | Severity | Finding | Status | Evidence |
| --- | --- | --- | --- | --- |
| DRIFT-001 | High | CI runtime pinned to Node 20 while package engines and authority docs require `>=22.12.0` | Resolved (Phase 1) | `.github/workflows/ci-pr.yml`, `.github/workflows/ci-push.yml`, `.github/workflows/docs-link-check.yml`, `SYSTEM_MODEL.md`, `AGENTS.md`, `awcms/package.json` |
| DRIFT-002 | High | Package READMEs still advertise Node 20+ prerequisites | Resolved (Phase 1) | `awcms/README.md`, `awcms-public/primary/README.md` |
| DRIFT-003 | High | Dual migration roots increase risk of documentation ambiguity if canonical source is not explicit | Resolved (Phase 2) | `supabase/migrations/**`, `awcms/supabase/migrations/**`, `docs/tenancy/supabase.md`, `docs/architecture/database.md`, `docs/security/overview.md` |
| DRIFT-004 | Medium | Stitch integration plan contains stale unchecked tasks for migrations already present | Resolved (Phase 2) | `docs/dev/stitch-integration-plan.md`, `docs/RESOURCE_MAP.md`, migrations in both Supabase roots |
| DRIFT-005 | Medium | Legacy `*_ANON_KEY` terminology remains in CI docs, conflicting with current key naming direction | Resolved (Phase 1) | `docs/dev/ci-cd.md`, `AGENTS.md` |
| DRIFT-006 | Medium | Large number of checklist-style pending docs may blur what is backlog vs implemented behavior | Partially resolved (Phase 2 + Phase 4) | `docs/README.md`, `docs/dev/admin-public-db-driven-checklist.md`, `docs/compliance/indonesia.md`, `docs/dev/versioning.md`, `docs/dev/stitch-integration-plan.md` |
| DRIFT-007 | Medium | Mobile/ESP32 package docs used legacy `SUPABASE_ANON_KEY` terminology inconsistent with current key naming | Resolved (Phase 4) | `awcms-mobile/primary/README.md`, `awcms-esp32/primary/README.md`, `awcms-esp32/primary/.env.example` |
| DRIFT-008 | Low | `awcms-mobile-java` package README used incorrect relative links to root documentation | Resolved (Phase 4) | `awcms-mobile-java/README.md` |

## 6) Remaining Backlog (Post-Phase 4)

### Priority A

1. Complete checklist status classification pass for remaining checklist-heavy docs outside current reconciled set.

### Priority B

1. Reclassify checklist-heavy docs into:
    - implementation truth,
    - roadmap/backlog,
    so readers do not confuse planned and shipped behavior.

## 7) Artifacts Produced

- `docs/dev/documentation-audit-plan.md` (updated plan)
- `docs/dev/documentation-audit-tracker.md` (this tracker)

## 8) Phase 1 Update (Current Pass)

- Reconciled authority chain language in:
  - `README.md`
  - `AGENTS.md`
  - `SYSTEM_MODEL.md`
  - `DOCS_INDEX.md`
  - `docs/README.md`
- Added tracker cross-links in authority docs/index surfaces.
- Updated CI Node runtime pins to `22.12.0` in all workflow files.
- Aligned package README Node prerequisites with engines (`>=22.12.0`).
- Removed legacy `*_ANON_KEY` guidance from `docs/dev/ci-cd.md`.

## 9) Exit Criteria for Phase 1

- DRIFT-001 and DRIFT-002 resolved.
- Node/runtime guidance and CI workflow reality are consistent.
- Authority docs (`README.md`, `AGENTS.md`, `SYSTEM_MODEL.md`, `DOCS_INDEX.md`, `docs/README.md`) have no contradictions.

## 10) Phase 2 Update (Current Pass)

- Published and cross-linked canonical dual-root migration policy in:
  - `docs/tenancy/supabase.md`
  - `docs/architecture/database.md`
  - `docs/security/overview.md`
- Reconciled Stitch execution checklist against implemented migration/app state:
  - `docs/dev/stitch-integration-plan.md`
  - `docs/RESOURCE_MAP.md`
- Added explicit implemented-vs-backlog status framing in checklist-heavy docs:
  - `docs/README.md`
  - `docs/dev/admin-public-db-driven-checklist.md`
  - `docs/compliance/indonesia.md`
  - `docs/dev/versioning.md`

## 11) Phase 3 Update (Current Pass)

- Reconciled scripts/CI/runtime docs with active workflows and package scripts:
  - `docs/dev/setup.md`
  - `docs/dev/troubleshooting.md`
  - `docs/dev/ci-cd.md`
  - `docs/deploy/overview.md`
  - `docs/deploy/cloudflare.md`
- Context7 re-check: `/supabase/cli` confirms `migration list --local|--linked` and environment-scoped migration workflows used in docs.
- Added explicit notes for CI secret mapping (`VITE_*` to `PUBLIC_*` in public CI job), docs-link-check workflow behavior, and deploy scope boundaries.
- Added parity verification runbooks for root/mirror Supabase migrations and functions in setup/deploy/troubleshooting docs.

## 12) Phase 4 Update (Current Pass)

- Completed full module docs sweep and package README reconciliation for maintained surfaces.
- Updated module/package docs with high-impact drift fixes:
  - `docs/modules/STITCH_IMPORT.md`
  - `docs/modules/USER_MANAGEMENT.md`
  - `awcms-mcp/README.md` (new)
  - `awcms-mobile-java/README.md`
  - `awcms-mobile/primary/README.md`
  - `awcms-esp32/primary/README.md`
  - `awcms-esp32/primary/.env.example`
- Standardized public key naming to `SUPABASE_PUBLISHABLE_KEY` in mobile/ESP32 docs and environment template.
- Reclassified third-party template README surfaces as non-authoritative for AWCMS stack/version constraints:
  - `awcms/src/templates/flowbiteadminastro/README.md`
  - `awcms/src/templates/flowbiteadminastro/src/components/README.md`
  - `awcms/src/templates/flowbiteadminastro/src/services/README.md`
