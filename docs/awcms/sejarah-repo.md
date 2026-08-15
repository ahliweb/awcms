🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](sejarah-repo.id.md)

# History of the AWCMS repo

> A historical note, moved out of `README.md` on 13 August 2026.
>
> It lives here because the README is supposed to answer **"what is this, now"**,
> and history piling up at the front slowly buries that answer. Not a single
> claim on this page binds the state of the repo today — for that, read
> [`../ARCHITECTURE.md`](../ARCHITECTURE.md) and
> [`../PROJECT_STATE.md`](../PROJECT_STATE.md).

## Why this repo was rebuilt

The old version of AWCMS was built on a combination of Node.js, Vite/React (admin & public), and Supabase. Throughout the migration cycle (ADR-013 through ADR-023), every component was moved in stages to a new runtime and architecture:

- `chore(mcp): migrasi awcms-mcp ke runtime Bun (ADR-019, #113)`
- `chore(public): migrasi awcms-public ke Bun (ADR-019, #113)`
- `chore(admin): migrasi awcms admin (Vite/React) ke Bun (ADR-019, #113)`
- `docs: referensi keputusan arsitektur kanonik (ADR-013…023 per produk)`
- `docs(readme): add architecture update note (PostgreSQL-only, RLS wajib, EmDash optional)`
- `docs: inventaris pemakaian Supabase (audit off-Supabase, #108)`

Once every component (mcp, public, admin) had finished moving and Supabase was no longer used, the legacy files in this repo were removed (`chore(foundation): remove legacy repository files`) — not to retire the repo, but to clear the ground so AWCMS could be rebuilt on a new standard foundation, with a business scope far broader than before.

## Technology base adopted from awcms-mini

| Aspect         | Before (old repo)                    | Now (awcms-mini base)                                                                                                                               |
| -------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime        | Node.js                              | **Bun** (Bun-only, see ADR-0002)                                                                                                                    |
| Web framework  | Vite + React (separate admin/public) | **Astro 7** (SSR on Bun, single modular-monolith shell)                                                                                             |
| Database       | Supabase (managed Postgres)          | **PostgreSQL** with **mandatory RLS** (ADR-0003)                                                                                                    |
| Architecture   | Separate apps (mcp, public, admin)   | **Modular monolith, microservice-ready** (ADR-0001), reusable base modules (Tenant, Identity, Profile, Access/RBAC-ABAC, Sync, Workflow, Reporting) |
| Operating mode | Online-dependent                     | **Hybrid online-first** (online is the primary path; offline/LAN is the resilience mode with HMAC-signed sync outbox, ADR-0006)                     |
| API contract   | Ad-hoc                               | Validated OpenAPI/AsyncAPI, standard response helper                                                                                                |

## The English counterpart, as it once appeared in the README

## Why this repo was rebuilt

The old version of AWCMS was built on a combination of Node.js, Vite/React (admin & public), and Supabase. Throughout the migration cycle (ADR-013 through ADR-023), every component was moved in stages to a new runtime and architecture:

- `chore(mcp): migrasi awcms-mcp ke runtime Bun (ADR-019, #113)`
- `chore(public): migrasi awcms-public ke Bun (ADR-019, #113)`
- `chore(admin): migrasi awcms admin (Vite/React) ke Bun (ADR-019, #113)`
- `docs: referensi keputusan arsitektur kanonik (ADR-013…023 per produk)`
- `docs(readme): add architecture update note (PostgreSQL-only, RLS wajib, EmDash optional)`
- `docs: inventaris pemakaian Supabase (audit off-Supabase, #108)`

Once every component (mcp, public, admin) had finished moving and Supabase was no longer used, the legacy files in this repo were removed (`chore(foundation): remove legacy repository files`) — not to retire the repo, but to clear the ground so AWCMS could be rebuilt on the new standard foundation, with a much broader business scope than before.

Technology base adopted from awcms-mini:

| Aspect         | Before (old repo)                    | Now (awcms-mini base)                                                                                                                               |
| -------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime        | Node.js                              | **Bun** (Bun-only, see ADR-0002)                                                                                                                    |
| Web framework  | Vite + React (separate admin/public) | **Astro 7** (SSR on Bun, single modular-monolith shell)                                                                                             |
| Database       | Supabase (managed Postgres)          | **PostgreSQL** with **mandatory RLS** (ADR-0003)                                                                                                    |
| Architecture   | Separate apps (mcp, public, admin)   | **Modular monolith, microservice-ready** (ADR-0001), reusable base modules (Tenant, Identity, Profile, Access/RBAC-ABAC, Sync, Workflow, Reporting) |
| Operating mode | Online-dependent                     | **Hybrid online-first** (online is the primary path; offline/LAN is the resilience mode with HMAC-signed sync outbox, ADR-0006)                     |
| API contract   | Ad-hoc                               | Validated OpenAPI/AsyncAPI, standard response helper                                                                                                |
