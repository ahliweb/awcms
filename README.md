🇬🇧 English (default) · 🇮🇩 [Bahasa Indonesia (sumber)](README.id.md)

<!-- i18n-source-hash: sha256:3ee7d3e62741206daf218bc4d73a43b59ccd6fd06b379c851deb13a540739e3f -->

# AWCMS — Foundation Platform for ERP & Business Solutions

> **AWCMS is not an ERP.** It is a **modular-monolith foundation/base** that ERP applications & business solutions are built on top of (in separate extension/derived repos). There is no chart of accounts, general ledger, journal, AR/AP, inventory valuation, payroll, or tax computation in this repo — and there never will be; the base only provides reusable foundation modules + **neutral contracts** for ERP readiness. See [ADR-0013](docs/adr/0013-extension-layers-and-boundary-model.md), [ADR-0020](docs/adr/0020-erp-extension-readiness-contracts.md), [ADR-0022](docs/adr/0022-erp-modules-live-in-extension-repos.md), and [`docs/awcms/erp-extension-contracts.md`](docs/awcms/erp-extension-contracts.md).

> **Status: foundation rebuild.** Legacy code files in this repo have already been removed (see commit `chore(foundation): remove legacy repository files`). This repo has been **rebuilt from scratch** on a modular-monolith technical standard (Bun + Astro 7 + PostgreSQL/RLS), as a **foundation** for ERP and business-solution development (not just a generic CMS/base, and not a finished ERP either).

## Why this repo was rebuilt

The old version of AWCMS was built on a combination of Node.js, Vite/React (admin & public), and Supabase. Throughout the migration cycle (ADR-013 through ADR-023), every component was moved in stages to a new runtime and architecture:

- `chore(mcp): migrasi awcms-mcp ke runtime Bun (ADR-019, #113)`
- `chore(public): migrasi awcms-public ke Bun (ADR-019, #113)`
- `chore(admin): migrasi awcms admin (Vite/React) ke Bun (ADR-019, #113)`
- `docs: referensi keputusan arsitektur kanonik (ADR-013…023 per produk)`
- `docs(readme): add architecture update note (PostgreSQL-only, RLS wajib, EmDash optional)`
- `docs: inventaris pemakaian Supabase (audit off-Supabase, #108)`

Once every component (mcp, public, admin) had finished moving and Supabase was no longer used, the legacy files in this repo were removed (`chore(foundation): remove legacy repository files`) — not to retire the repo, but to clear the ground so AWCMS could be rebuilt on the new standard foundation, with a much broader business scope than before.

## Direction: awcms-mini technology base, ERP-foundation scope

This repo **adopts the stack and technical standard from [awcms-mini](https://github.com/ahliweb/awcms-mini)** — AhliWeb's _modular monolith standard_ — as its technology base, but is **not just a derivative of the generic base**. This repo's development focus is **providing the foundation**, not building the ERP itself:

- **Reusable foundation modules** — tenant, identity/access (RBAC/ABAC/RLS), central profile, sync/outbox, workflow, reporting, observability, etc. — used as-is by every derived application.
- **Neutral ERP-readiness contracts** — passive data shapes, capability ports, and event payload schemas (business transaction, posting, period-lock, item/currency/UoM, inventory movement, reporting projection — [ADR-0020](docs/adr/0020-erp-extension-readiness-contracts.md)) that are **implemented/consumed by ERP extensions in a separate repo**, not given their logic here.
- **Business-integration framework** — the same offline-first-safe outbox/queue pattern + provider adapters (e.g. payment gateways, marketplaces, tax/Coretax, logistics) as the mounting point for domain connectors in derived applications.
- **Multi-tenant/multi-entity scale** — RBAC/ABAC/RLS + tenant/legal-entity/organization-unit boundaries ([ADR-0013](docs/adr/0013-extension-layers-and-boundary-model.md)) reused across many derived applications.

Actual ERP domain modules (finance/GL, inventory/warehouse, procurement, manufacturing, HR/payroll) and business verticals (POS, school portal, etc.) are **built in separate extension/derived repos on top of this base** — see [`docs/awcms/derived-application-guide.md`](docs/awcms/derived-application-guide.md).

Technology base adopted from awcms-mini:

| Aspect         | Before (old repo)                    | Now (awcms-mini base)                                                                                                                               |
| -------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime        | Node.js                              | **Bun** (Bun-only, see ADR-0002)                                                                                                                    |
| Web framework  | Vite + React (separate admin/public) | **Astro 7** (SSR on Bun, single modular-monolith shell)                                                                                             |
| Database       | Supabase (managed Postgres)          | **PostgreSQL** with **mandatory RLS** (ADR-0003)                                                                                                    |
| Architecture   | Separate apps (mcp, public, admin)   | **Modular monolith, microservice-ready** (ADR-0001), reusable base modules (Tenant, Identity, Profile, Access/RBAC-ABAC, Sync, Workflow, Reporting) |
| Operating mode | Online-dependent                     | **Offline-first / LAN-first** with HMAC-signed sync outbox (ADR-0006)                                                                               |
| API contract   | Ad-hoc                               | Validated OpenAPI/AsyncAPI, standard response helper                                                                                                |

Reusable base modules (Tenant, Identity, Profile, Access/RBAC-ABAC, Sync, Workflow, Reporting) from awcms-mini are used as-is as the foundation; ERP domain modules and business integrations are developed **on top of that foundation, in a separate extension/derived repo** — not inside this base ([ADR-0022](docs/adr/0022-erp-modules-live-in-extension-repos.md)).

## References & starting points

- Read `AGENTS.md` for mandatory conventions (module structure, RLS, ABAC, idempotency, audit, etc.) before adding a foundation module.
- Building an ERP/vertical application on top of this base: [`docs/awcms/derived-application-guide.md`](docs/awcms/derived-application-guide.md) + contracts in [`docs/awcms/erp-extension-contracts.md`](docs/awcms/erp-extension-contracts.md).
- This repo's architectural decisions: [`docs/adr/`](docs/adr/README.md) — start at [ADR-0001](docs/adr/0001-rebuild-on-awcms-foundation-erp-scope.md) (rebuild), updated by [ADR-0013](docs/adr/0013-extension-layers-and-boundary-model.md) (extension layers) and [ADR-0022](docs/adr/0022-erp-modules-live-in-extension-repos.md) (ERP in a separate repo).
- Full baseline standard reference (Bun-only, RLS, offline-first) lives in [awcms-mini](https://github.com/ahliweb/awcms-mini/blob/main/docs/adr/README.md)'s ADRs (ADR-0001 modular monolith, ADR-0002 Bun-only runtime, ADR-0003 PostgreSQL + RLS, ADR-0006 offline-first sync).
- Old-platform migration history: git history ADR-013..023 (Bun migration, off-Supabase).

The `awcms` repo is under **active development** — not archived — as the **foundation** that ERP and business solutions are built on top of, not a finished ERP.
