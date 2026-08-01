# `idn_admin_regions` — Indonesia administrative regions

Versioned master data for Indonesia's administrative hierarchy — **province /
regency-city / district / village** — admitted by
[ADR-0046](../../../docs/adr/0046-idn-admin-regions-module-admission.md).

| Aspect      | Value                                                                                                    |
| ----------- | -------------------------------------------------------------------------------------------------------- |
| Key / type  | `idn_admin_regions` · `system`, `isCore: false`                                                          |
| Tables      | `awcms_idn_region_datasets`, `awcms_idn_admin_regions` (`sql/080`)                                       |
| Permissions | `region.read`, `dataset.read` (`sql/081`; `dataset.configure`/`.restore` revoked by `sql/084`, ADR-0052) |
| API         | `/api/v1/idn-regions/*` (`openapi/modules/idn-admin-regions.openapi.yaml`)                               |
| Job         | `bun run idn-regions:import`                                                                             |
| Dataset     | `data/idn-admin-regions/` — vendored `cahyadsn/wilayah` (MIT)                                            |
| Depends on  | `tenant_admin`, `identity_access` — nothing depends on this module                                       |

## Source, licence, and the claim this module does NOT make

The data comes from the third-party community project
[`cahyadsn/wilayah`](https://github.com/cahyadsn/wilayah) (MIT), vendored under
`data/idn-admin-regions/` with its licence, upstream commit, per-file checksums,
and per-file decree reference.

**This is not an official Kementerian Dalam Negeri (Kemendagri) API or export.**
It is a community packaging of the Kepmendagri decree — AWCMS never claims to
publish this data, and it does not replace an operator's own legal/compliance
reference to the decree itself. The imported file (`db/wilayah.sql`) cites
**Kepmendagri No 300.2.2-2138 Tahun 2025**.

That caveat lives in exactly one place in code —
[`domain/source-provenance.ts`](domain/source-provenance.ts) — and is re-read by
the dataset API response and the admin screen, so the three can never drift.

## Why this data is GLOBAL, and what replaces RLS

Province "Aceh" is the same row for every tenant. Both tables therefore have **no
`tenant_id`, no RLS, and no policy** — the same posture as `awcms_permissions`
and `awcms_modules`. Duplicating 91,599 rows per tenant would turn reference data
into storage that grows with the customer list and make "is every tenant on the
same region version?" unanswerable.

What replaces RLS is **not** trust:

- both tables are registered in `GLOBAL_TABLE_FORBIDDEN_PRIVILEGES`
  (`scripts/security-readiness.ts`), which forces an explicit per-role privilege
  declaration instead of inheriting blanket DML from `ALTER DEFAULT PRIVILEGES`;
- `awcms_app` holds `SELECT` on both plus `UPDATE` on the dataset table only
  (activation); `awcms_worker` holds the insert path; **neither holds `DELETE`**;
- every endpoint still runs session → tenant context → default-deny RBAC/ABAC.
  What is global is the ROW, not the authorization.

## Versioning: import, activate, roll back

```text
import (job)            activate (admin action)        rollback (admin action)
  ─────────►  validated  ──────────────────────►  active  ─────────────►  superseded
                                                    ▲                          │
                                                    └──────────────────────────┘
```

- **Import** parses the vendored dump as **text** (no SQL engine, no MySQL, no
  network), validates it whole, and writes one new dataset **beside** the
  previous one — never over it. That is what makes rollback a status flip
  instead of a re-import.
- A new dataset always lands `validated`, never `active`: importing is a
  deployment step, choosing what is SERVED is an operator decision that gets
  audited.
- **Only one dataset is active**, enforced by a partial unique index in the
  database — not by an application check two concurrent requests could interleave
  through.

```bash
bun run idn-regions:import            # dry run: parse, validate, report, write nothing
bun run idn-regions:import --commit   # write one new dataset version
```

Re-running `--commit` on identical bytes is a no-op: the dataset code is derived
from the upstream commit + file checksum, so it collides instead of creating a
duplicate version.

## Validation refuses partial hierarchies

An import fails — rather than importing what it could — when any of these hold:

| Condition                               | Why it is fatal                                                  |
| --------------------------------------- | ---------------------------------------------------------------- |
| A line does not match the value grammar | Regions would be silently missing, and nothing would say so      |
| A duplicate region code                 | The dataset contradicts itself about a real place                |
| A region whose parent is absent         | A hierarchy missing its middle breaks pickers, invisibly         |
| A tier with zero rows                   | Structurally not a full hierarchy — most likely a truncated file |
| Checksum ≠ the manifest                 | The recorded provenance would be fiction                         |

## Lookup API

| Method + path                            | Permission     | Notes                                           |
| ---------------------------------------- | -------------- | ----------------------------------------------- |
| `GET /api/v1/idn-regions/regions`        | `region.read`  | `level`, `parentCode`, `search`, keyset `after` |
| `GET /api/v1/idn-regions/regions/{code}` | `region.read`  | One region + resolved ancestor path             |
| `GET /api/v1/idn-regions/datasets`       | `dataset.read` | Versions + provenance + caveat                  |

Every endpoint here is **read-only**. Activation and rollback used to sit in this
table and are gone — [ADR-0052](../../../docs/adr/0052-idn-region-dataset-lifecycle-is-an-operator-job.md)
made them operator jobs:

```bash
bun run idn-regions:activate -- --dataset <code|uuid>            # dry run
bun run idn-regions:activate -- --dataset <code|uuid> --commit   # serves it
bun run idn-regions:rollback --commit                            # undo
```

They changed the dataset served to **every** tenant, but their permissions were
seeded into the global catalog that `setup/initialize` grants wholesale to each
tenant's `owner` — so an ordinary tenant owner held authority over data served to
other tenants. These tables have no `tenant_id` and no RLS: there is no tenant the
action belongs to, so no tenant permission can honestly express it.

Queries default to the **active** dataset; `?dataset=<code>` reads a specific
version, which is what makes keeping superseded versions worth the rows. With
nothing activated yet, list responses are empty and carry
`reason: "no_active_dataset"` — a fresh install is a real state, not an error to
debug.

## Deliberately not here

- **No `import` permission.** Import is a job, not an HTTP action; seeding a
  permission would advertise a surface that does not exist.
- **No capability port / no events.** Consumers read the API; nothing subscribes
  to region changes.
- **No `dataLifecycle` descriptor.** Versioned reference data is superseded, not
  aged out.
- **No island / population / area code.** Those three dumps are vendored from the
  same upstream commit, but nothing reads them yet.
- **Local term for districts is `null`.** Upstream ships bare district names;
  filling in "Kecamatan" would be wrong for the provinces whose tier is
  "Distrik". A null an operator can see beats a plausible value they cannot check.
