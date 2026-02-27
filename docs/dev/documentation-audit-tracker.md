# Documentation Audit Tracker - Phase 0/1/2/3/4

> **Date:** 2026-02-27
>
> **Related Plan:** `docs/dev/documentation-audit-plan.md`
>
> **Status:** Phase 0 completed, Phase 1 completed, Phase 2 completed, Phase 3 completed, Phase 4 completed

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

2. Reclassify checklist-heavy docs into:
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
