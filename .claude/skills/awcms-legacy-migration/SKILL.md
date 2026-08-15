---
name: awcms-legacy-migration
description: READ-ONLY — legacy data migration was deliberately DESCOPED from the AWCMS base repo (see doc 06 §"Backlog change history"). Use this skill to understand WHY the feature does not exist here and where the concept must be built instead (a derived application, e.g. AWPOS) — do not use it as an implementation guide. The commands/tables/issues this skill used to reference (`legacy:preflight`, `awcms_legacy_migration_runs`, Issue 1.1/1.2) do not exist in this repo.
---

🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](SKILL.id.md)

# AWCMS — Legacy Data Migration (DESCOPED — not part of this base repo)

## Status: deliberately not built here

The "Legacy Migration" epic (originally Epic 1, Issue 1.1–1.2) existed in the
initial 38-issue AWCMS backlog, but was **closed `not planned`** on GitHub
together with 18 other POS/retail domain issues (POS MVP, Warehouse Management,
CRM Receipt Delivery, Accounting & Coretax, etc.) — 20 domain issues closed in
total, Legacy Migration being 2 of them — because it did not fit the context of
AWCMS as a **general-purpose development example repo** (a generic base, not a
retail application). Its content was **moved to the example derived
application** (e.g. AWPOS), its history not deleted — see the project memory
`awpos-standard-refactor` for that standardisation direction.

Source of the decision: `docs/awcms/06_github_issues_detail.md` §"Riwayat
perubahan backlog (2026-07-04)". That doc now jumps straight from
`EPIC 0 — Repository Foundation` to `EPIC 2 — Tenant, Identity, Profile` —
there is no longer an "EPIC 1" in the list of active epics, consistent with its
`not planned` status.

## What is NOT in this repo — do not implement it as if you were "finishing something unfinished"

Everything below is leftover content from the descoped epic, **never built**,
and is not a gap that needs filling in this base repo:

- The `legacy:preflight` script/command — **does not exist** in `package.json`
  (`grep -n "legacy" package.json` returns nothing).
- The `awcms_legacy_migration_runs` table (or its related mapping/row-count/
  validation-error/backfill-task tables) — **not a single** migration in
  `sql/*.sql` creates it.
- A separate Postgres schema named `legacy`.
- GitHub Issue 1.1/1.2 (the old "#4"/"#5" references in this repo) — neither
  number **resolves** to any issue in `ahliweb/awcms`
  (`gh issue view 4`/`gh issue view 5` → "could not resolve").
- The "Legacy migration checklist" section that may still linger in
  `docs/awcms/07_sprint_testing_production_readiness.md` is documentation
  residue from that same epic — do not treat it as an implementation reference
  without re-verifying its status first.

Do not write new migrations, scripts, endpoints, or tests based on the list
above as if it were an active backlog that just needs completing — it is not,
and there is no GitHub issue trace in this repo backing it.

## If you genuinely need legacy data migration

Legacy data migration is a **derived-application concern**, not a concern of
this generic base repo. The base repo (`awcms`) provides reusable
modules/patterns (migration toolkit, sensitive-data masking, module scaffold,
etc.) that a derived application can use to build its own legacy migration for
its own domain — for instance AWPOS (retail/POS) handles its own legacy
POS/retail data migration in its own derived repo, not in `awcms`.

If that need arises in a derived application:

1. Do not copy this skill's old content as a starting point — its content
   (dry-run/backfill flow, table names, commands) was never implemented or
   validated against any real code.
2. Redesign from the derived application's actual domain needs (source
   table/field mapping, dry-run strategy, row-count verification, and so on),
   built on top of the base repo's general patterns that do actually exist:
   `awcms-new-migration` (schema/RLS), `awcms-sensitive-data`
   (normalize/hash/mask identifier), `awcms-testing` (layered test strategy).
3. A general principle that holds wherever legacy migration is built: legacy
   passwords/credentials must never be re-imported — migrated users must go
   through a reset flow, the old hash is never used directly for login.

## Related skills

`awcms-new-migration` (general schema toolkit), `awcms-sensitive-data`
(normalize/hash/mask identifier), `awcms-testing` (layered test strategy).
