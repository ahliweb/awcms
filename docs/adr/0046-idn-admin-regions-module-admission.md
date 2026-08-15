🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0046-idn-admin-regions-module-admission.id.md)

# ADR-0046 — Admission of `idn_admin_regions` (Official Optional Module): Indonesian administrative region master data as VERSIONED GLOBAL reference data, with a vendored dataset and single-slot activation

- **Status:** Accepted
- **Date:** 2026-07-31
- **Decision maker:** @ahliweb
- **Adapts:** `awcms-mini` `src/modules/idn-admin-regions/` (epic #654, issues #655–#657 which landed there; #658–#664 on hold in that repo). There the migrations are numbered `048`/`054` — that repo's numbering, not this one's. Here the schema lands in `sql/080` and the permission seed in `sql/081`.
- **Related:** ADR-0034 (templates used directly — modules are added straight into `src/modules/`), ADR-0035 (ERP + SaaS superset positioning), ADR-0012/doc 21 (module admission governance), ADR-0037 (`data_lifecycle` — why this module's tables are NOT registered there), ADR-0026 (per-module OpenAPI fragments), ADR-0006 (external providers outside the transaction).

## Context

Almost every Indonesian business application built on this template needs official administrative regions: customer addresses, branches/offices, work areas, per-province/regency report aggregation, all the way to shipping-tariff mapping. Without a shared module, every derived application would copy its own CSV, at differing versions, without provenance, and with no way to prove which version is in use.

Four facts shape this decision:

1. **This data is identical for all tenants.** The province of Aceh is the same for every tenant on the platform. This is global reference data, not tenant-owned content.
2. **This data CHANGES periodically.** Kemendagri publishes updates to region codes/names (splits, renamings, changes to village/urban-village status). The dataset must therefore be **versioned**, not a single table `UPDATE`d in place — otherwise historical reports silently change meaning when the data is refreshed.
3. **There is no stable, freely usable official Kemendagri API** for use in a build/deploy pipeline. The best practical source is the community dataset `cahyadsn/wilayah` (MIT), which packages the Kepmendagri into SQL dumps.
4. **The volume is large for reference data** — 91,599 rows (38 provinces, 514 regencies/cities, 7,285 districts, 83,762 villages/urban-villages) — big enough to make "import over an HTTP request" the wrong decision, but far from big for PostgreSQL.

What must be bound **before** code is written: who owns this data, how its versions are managed, where its bytes come from and how that is proven, and what official claims this platform must **not** make.

## Decision

We admit **`idn_admin_regions`** as an **Official Optional Module** of the **versioned global reference data** kind, with the upstream dataset **vendored into the repo** and a **single active dataset** lifecycle model.

### 1. Admission parameters

| Parameter                | Value                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------- |
| Name                     | Indonesia Administrative Regions                                                                  |
| `key`                    | `idn_admin_regions`                                                                               |
| Category                 | **Official Optional Module** — generic cross-vertical reference data                              |
| `type` in code           | `system` (see §2 — a deliberate divergence from `awcms-mini`, which uses `base`)                  |
| `isCore`                 | no                                                                                                |
| `status`                 | `active` — descriptor, schema, import, activation, and lookup API land together                   |
| Lifecycle `dependencies` | `["tenant_admin", "identity_access"]` only                                                        |
| Data ownership           | **GLOBAL**, not tenant-scoped — no `tenant_id`, no RLS (§3)                                       |
| Compatibility class      | Pure DB + repo files = **fully offline-lan-safe**; no network calls on any path, including import |

### 2. `type: "system"`, not `"base"` — a deliberate divergence from `awcms-mini`

`awcms-mini` chose `type: "base"` on the grounds of "pure reference data, neither a business feature nor platform infrastructure". Here the decision differs because **the context differs**: this repo does not have a single module with `type: "base"` (14 typed modules split between `system`/`domain`), while `media_library` has already set exactly the precedent for this case — "System Foundation, `isCore: false`": a shared capability used by other modules, owned by the platform, not by a tenant.

Introducing a third `type` value for just one module would add a category that every gate, matrix, and reader must answer to — without buying any behaviour (`type` only affects classification/registry, not runtime). This module goes into the **`operations`** sidebar section (operational master data), not `system`.

### 3. GLOBAL data: no `tenant_id`, no RLS — and why that is safe

Both tables (`awcms_idn_region_datasets`, `awcms_idn_admin_regions`) deliberately have **no** `tenant_id`, no RLS, and no policy. This is a deliberate exception to this repo's default ("every tenant-scoped table must have RLS `FORCE`"), for three mutually supporting reasons:

- Their contents are **public facts** — government-published region codes and names. No personal data, no tenant business data, nothing that can leak across tenants because there is nothing tenant-specific to leak.
- Duplicating 91,599 rows per tenant would turn reference data into a storage burden growing linearly with the tenant count, and would make "do all tenants use the same region version?" an unanswerable question.
- The internal precedent already exists and is treated the same way: `awcms_permissions`, `awcms_modules`, `awcms_schema_migrations` are all global.

The consequence that **must** accompany it, not optionally: both tables are registered explicitly in `GLOBAL_TABLE_FORBIDDEN_PRIVILEGES` (`scripts/security-readiness.ts`). That registration forces an explicit privilege declaration — not merely an exclusion of the table from the RLS check. `awcms_app` gets **`SELECT` only**; `INSERT`/`UPDATE`/`DELETE` are forbidden for both, because the only write path is the import job running as `awcms_worker`.

**Authorization remains per-tenant.** Global data does not mean global access: every endpoint still passes through the session + tenant context + default-deny RBAC/ABAC guard. What is global is the ROWS, not the permissions.

### 4. Versioning: immutable datasets + one active slot

One `awcms_idn_region_datasets` row = one import. Its region rows point at a `dataset_id` and are **never updated in place**: updating the data means importing a new dataset alongside the old one.

Its lifecycle: `validated` (imported, not yet serving) → `active` (serving) → `superseded` (once active, replaced). `rejected` is provided to record import attempts that failed validation.

"Only one active dataset" is enforced **in the database** through a partial unique index on `status` for rows with `status = 'active'` — not through an application check that two concurrent requests can slip past. Rollback = reactivating the previously `superseded` dataset; the old dataset's region rows are still intact, so a rollback never needs a re-import.

### 5. Import is a JOB, activation is an ADMIN ACTION

This split is deliberate and binding:

- **Import** (`bun run idn-regions:import`) runs as `awcms_worker`, reads the dump file already vendored in the repo, parses it as text, and writes 91,599 rows in one transaction. It is **not** exposed over HTTP: putting a 91-thousand-row operation behind a request would create a timeout and abuse surface without buying anything — the dataset is inside the image, not uploaded by the operator. The default mode is `--dry-run` (parse, validate, report; no writes).
- ~~**Activation/rollback** is an admin action over HTTP (`POST /api/v1/idn-regions/datasets/{id}/activate` and `.../rollback`): high-risk, carrying an `Idempotency-Key`, audited, ABAC-gated. This is an operational decision needing a who/when/why trail — not a deployment step.~~ **Corrected by [ADR-0052](0052-idn-region-dataset-lifecycle-is-an-operator-job.md):** both are now operator jobs (`bun run idn-regions:activate`/`:rollback`) and their endpoints were removed. The reason is §5 of this very ADR — these actions change the data served to ALL tenants, so there is no tenant subject for ABAC to evaluate; their permissions (`dataset.configure`/`.restore`) seeded into the global catalogue would make an ordinary tenant owner authoritative over other tenants' data.

Grant consequence: `awcms_worker` holds `INSERT`/`UPDATE`/`SELECT` for the import, `awcms_app` holds `SELECT` (lookup) plus `UPDATE` **only** on `awcms_idn_region_datasets` (activation/rollback status transitions). No role holds `DELETE` on either table: datasets are never deleted, only `superseded`.

### 6. The dataset is VENDORED into the repo, not downloaded at import time

All four upstream dump files are stored verbatim in `data/idn-admin-regions/upstream/cahyadsn-wilayah/db/` together with the LICENSE, `manifest.json` (repo/branch/commit SHA/per-file checksum), and `checksums.sha256`.

The reason is not convenience: **the import must be deterministic and offline.** Every gate in this repo runs without a network; LAN/offline deployment is a supported class; and "which region version does this build use" must be answerable from the commit, not from the state of the internet on the day the import was run. The accepted consequence: the repo grows by ~4.2 MB, once.

Only `db/wilayah.sql` is read by code today. The three other files (`wilayah_pulau`, `wilayah_penduduk`, `wilayah_luas`) are vendored as companion datasets from the SAME commit — so that the next features (islands, population, area) do not have to guess which version matches the hierarchy already imported.

### 7. Claims this platform does NOT make

This is a **third-party community dataset** packaging the Kepmendagri, **not** an official API or export of the Ministry of Home Affairs. AWCMS never claims to be the official publisher of this data, and this dataset **does not replace** an operator's legal/compliance reference to the original Kepmendagri.

That caveat must appear in the module README, the dataset metadata API response, and the admin screen — not only in this document. A single code constant (`domain/source-provenance.ts`) is its single source so that it does not drift.

One correction to `awcms-mini` carried over here: mini recorded a single provenance sentence naming **Kepmendagri No. 300.2.2-2430 Tahun 2025** for the whole dataset. The actual file headers differ per file — `db/wilayah.sql` (the only one this module imports) names **Kepmendagri No. 300.2.2-2138 Tahun 2025**, while `db/wilayah_pulau.sql` names `300.2.2-2430`. This repo records the decree number **per file**, as-is from each header, because this is the reference an operator will cite when an auditor asks for the legal basis of the data.

## Consequences

**Positive**

- Every application built on this template has the same administrative regions, versioned, and traceable down to the upstream commit + file checksum.
- The next Kemendagri update = vendor the new files → import → activate, without touching the old dataset's rows, and rollback-able in a single action.
- Zero network dependencies on any path, including import — in line with the offline-LAN class.

**Negative / accepted costs**

- The repo grows by ~4.2 MB of vendored files.
- Two global tables without RLS add review burden: every time someone adds a global table, they must go through the `GLOBAL_TABLE_FORBIDDEN_PRIVILEGES` conversation — that is precisely the point, but the cost is real.
- The data is only as good as its community dataset. If upstream is late in carrying the latest Kepmendagri, this platform is late too; that is why the decree number is recorded per file and shown to the operator instead of hidden.

**What this ADR does NOT do**

- Island/population/area code (their files are vendored, their code does not exist).
- Fuzzy/trigram search — a plain btree is enough for prefix/equality; `pg_trgm` will only be considered if a real need appears.
- Relations to business entities (profile addresses, office work areas). This module provides lookup; connecting it to a domain is the consuming module's job.
