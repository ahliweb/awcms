---
name: awcms-idn-admin-regions
description: The idn_admin_regions module ALREADY EXISTS in this repo (ADR-0046, migrations `sql/080` schema + `sql/081` permissions) — VERSIONED master data of Indonesian administrative regions (province/regency-city/district/village/urban-village), sourced from the community dataset `cahyadsn/wilayah` (MIT) which is VENDORED under `data/idn-admin-regions/`. Coverage here is BROADER than awcms-mini (which stopped at scaffold+schema): upstream dump parser, import pipeline `bun run idn-regions:import` (dry-run by default, `--commit` writes), audited dataset activation/rollback, and lookup API `/api/v1/idn-regions/*`. Its two tables are GLOBAL (no `tenant_id`, no RLS — listed in `GLOBAL_TABLE_FORBIDDEN_PRIVILEGES`), authorization stays per-tenant default-deny. Use when changing the parser/normalizer, the dataset schema, the import/activation path, the lookup API, or when vendoring the next Kepmendagri update. The BODY of the skill below is the awcms-mini specification (mini `sql/NNN` numbering, issues #655-#664) — treat it as history, not as a map of this repo's code.
---

🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](SKILL.id.md)

# AWCMS — Indonesia Administrative Regions (`idn_admin_regions`)

<!-- sql-refs: awcms-mini — the skill body uses awcms-mini numbering; the REAL migrations in this repo are sql/080 + sql/081 -->

> **STATUS — THIS MODULE ALREADY EXISTS IN THIS REPO, and is more complete than
> what is described below**
> ([ADR-0046](../../../docs/adr/0046-idn-admin-regions-module-admission.md)).
>
> - Real code: `src/modules/idn-admin-regions/` — descriptor, `domain/`
>   (provenance, dump parser, hierarchy normalizer), `application/`
>   (import, dataset lifecycle, lookup), plus routes
>   `src/pages/api/v1/idn-regions/**` and the job `scripts/idn-regions-import.ts`.
> - REAL migrations: **`sql/080`** (two tables) + **`sql/081`** (4 permissions).
>   Every `sql/NNN` in the body of this skill is **awcms-mini** numbering.
> - Vendored dataset: `data/idn-admin-regions/` (4 upstream files + LICENSE +
>   `manifest.json` + `checksums.sha256`), gated by
>   `tests/idn-admin-regions-vendor-manifest.test.ts`.
>
> **What DIFFERS from awcms-mini** (do not carry mini assumptions over here):
>
> | Item              | awcms-mini                                                 | this repo                                                                                                           |
> | ----------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
> | Coverage          | scaffold + vendor + schema (#658–#664 on hold)             | full functional module: import, activation/rollback, lookup API                                                     |
> | `type`            | `base`                                                     | `system` (`isCore: false`) — this repo has no module of type `base`                                                 |
> | Permissions       | 5 (including `dataset.import`)                             | **4** — there is no import permission: import is a JOB, not an HTTP action                                          |
> | Lifecycle actions | planned `activate`/`rollback`                              | mapped onto `AccessAction` literals that ALREADY EXIST: `configure` (activate) and `restore` (rollback)             |
> | Provenance        | one sentence naming Kepmendagri 300.2.2-2430 for all files | **per file**, read from each file's own header — the file that is imported (`db/wilayah.sql`) says **300.2.2-2138** |
> | Grants            | zero grants (schema-only)                                  | `awcms_app` SELECT (+UPDATE on datasets), `awcms_worker` SELECT/INSERT/UPDATE, **zero DELETE for both**             |
>
> To CHANGE the real code: read
> [`src/modules/idn-admin-regions/README.md`](../../../src/modules/idn-admin-regions/README.md)
> and ADR-0046 first. The body below is kept as a record of the original
> decisions (source/license/caveat and permission derivation), not as a map of
> today's code.

Epic #654 (Issues #655-#664): master data of Indonesian administrative regions
(province/regency-city/district/village/urban-village) as a reusable
`base`/reference module, sourced from the third-party repository
`cahyadsn/wilayah` (MIT License). This module is registered **directly** in
this base repo (not in a derived application) because regional master data is
relevant to almost every derived application (POS, portal, complaint systems,
etc.) — the same reason `blog-content`/`tenant-domain`/
`visitor-analytics` are registered directly, but `idn_admin_regions` itself is
`type: "base"` (not `domain`/`system`) because this is pure reference data,
not a tenant business feature and not platform infrastructure.

## Source and license (MUST be preserved by every follow-up issue)

- **Repository**: <https://github.com/cahyadsn/wilayah>
- **Source folder**: <https://github.com/cahyadsn/wilayah/tree/master/db>
- **License**: MIT
- **Upstream statement**: "Codes and Data of Indonesian Government
  Administrative Regions and Island Codes per Kepmendagri No. 300.2.2-2430 of
  2025."
- **Official-reference caveat (MUST stay written explicitly in every
  README/docs/UI that displays this dataset)**: this is a
  third-party/community dataset, NOT an official API or export of the Ministry
  of Home Affairs (Kemendagri). AWCMS never claims to be the official
  publisher of this data, and this dataset does not replace an operator's
  official legal/compliance reference to the original Kepmendagri.

The single code constant for all three of these facts:
`src/modules/idn-admin-regions/domain/source-provenance.ts` — follow-up issues
(#656 vendoring, #660 import, #664 docs) MUST import this constant; do not
rewrite the URL/license/caveat strings separately, so they cannot drift.

## When to use this skill vs the generic skills

This skill complements (does not replace) `awcms-new-module`
(initial module structure), `awcms-new-migration` (dataset schema #657),
`awcms-new-endpoint` (lookup API #662), `awcms-abac-guard` +
`awcms-audit-log` (import/activate/rollback #660-#661 are
high-risk mutations), `awcms-idempotency` (activate/rollback MUST carry
`Idempotency-Key` per acceptance criteria #661), and `awcms-ui-screen`
(admin UI #663). This skill supplies the **epic-specific cross-cutting**
context — above all the source/license facts above and the naming/structure
decisions already made in #655, so follow-up issues do not have to
re-investigate from scratch.

## Status per issue (do not rebuild what already exists)

| Issue | Scope                                                                                        | Status                                                          |
| ----- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| #655  | Scaffold the `idn_admin_regions` module (descriptor, permission catalog, README)             | **Done** — see §655 below                                       |
| #656  | Vendor source metadata + license of `cahyadsn/wilayah` under `data/idn-admin-regions/`       | **Done** — see §656 below                                       |
| #657  | Versioned PostgreSQL schema (`awcms_idn_region_datasets`, `awcms_idn_admin_regions`)         | **Done** — see §657 below                                       |
| #658  | Parser & normalizer for the upstream `cahyadsn/wilayah` SQL dumps (MySQL-style insert dumps) | Deferred (closed, `NOT_PLANNED` — temporary hold, not rejected) |
| #659  | Repository validation gate for vendored/normalized dataset files                             | Deferred (closed, `NOT_PLANNED` — temporary hold, not rejected) |
| #660  | PostgreSQL import pipeline (dry-run/commit)                                                  | Deferred (closed, `NOT_PLANNED` — temporary hold, not rejected) |
| #661  | Dataset activation, rollback, and diff                                                       | Deferred (closed, `NOT_PLANNED` — temporary hold, not rejected) |
| #662  | Read-only lookup API for Indonesian regions                                                  | Deferred (closed, `NOT_PLANNED` — temporary hold, not rejected) |
| #663  | Admin UI to browse datasets and validation status                                            | Deferred (closed, `NOT_PLANNED` — temporary hold, not rejected) |
| #664  | SOP, docs, and security review                                                               | Deferred (closed, `NOT_PLANNED` — temporary hold, not rejected) |

**Note:** #658-#664 were closed as `NOT_PLANNED` by the maintainer on
2026-07-13 as a temporary hold (issue titles prefixed `PENDING:`) —
**do not continue this scope unless the maintainer explicitly reopens those
issues.**

Suggested dependency order (from each issue's own objective):
655 → 656 (needs the module registered so that `data/idn-admin-regions/` has a
conceptual home, even though the vendor files themselves live outside
`src/modules/`) → 657 (schema, technically independent of 656 but in substance
needs to know the shape of `db/wilayah.sql`) → 658 (parser, needs the #656
vendor files as real input) → 659 (validator, needs #656+#657+#658 to exist in
order to validate them) → 660 (import, needs the #657 schema + the normalized
#658 output + the #659 validator passing first) → 661 (activate/
rollback, needs an imported dataset from #660) → 662 (lookup API, needs an
active dataset from #661) → 663 (admin UI, needs #660/#661/#662 all present) → 664
(final docs/SOP, summarizing everything).

## §655 — Module scaffold (Done)

Full implementation: `src/modules/idn-admin-regions/module.ts` (new,
minimal module — `key: "idn_admin_regions"`, `name: "Indonesia
Administrative Regions"`, `version: "0.1.0"`, `status: "experimental"`,
`type: "base"`, `dependencies: ["identity_access", "logging",
"module_management"]`, five `permissions`), `domain/source-provenance.ts`
(source/license/caveat constants, see §Source and license above),
`application/.gitkeep` (empty — there is no logic at all to write until a
follow-up issue gives this module its first table/endpoint to orchestrate),
`README.md` (documentation of source+license+caveat+per-issue scope).
Migration `sql/048_awcms_idn_admin_regions_permissions.sql`
seeds five permissions into `awcms_permissions` — there is NO new domain
table (the region schema is deferred to #657, per issue #655's own
instruction: "no database schema/migration for actual region data yet").

### Decisions/judgment calls in this issue (binding for follow-up issues)

1. **`type: "base"`, not `"domain"`/`"system"`** — chosen because regional
   master data is pure reference data identical for every tenant (not content
   owned by a tenant like `blog_content`, and not platform
   observability/lifecycle infrastructure like
   `visitor_analytics`/`tenant_domain`). This is the FIRST `base` module
   registered directly in the base repo since the original nine generic base
   modules (Issues 2.1-2.4/12.1/6.1-6.3/9.1/10.1/11.1) — see AGENTS.md §Module
   map; this module belongs to that "generic base" list, NOT to the "Exception:
   four domain/system modules" list.
2. **Permission key derivation** — issue #655 writes five full permission
   strings (`idn_admin_regions.region.read`, etc.). The module descriptor
   mechanism uses separate `{activityCode, action}` pairs, joined as
   `${moduleKey}.${activityCode}.${action}`
   (`src/modules/module-management/domain/permission-sync.ts`'s `keyOf`).
   The mapping used: `region.read` → activityCode `"region"` action
   `"read"`; `dataset.read`/`dataset.import`/`dataset.activate`/
   `dataset.rollback` → activityCode `"dataset"` with the respective actions.
   Follow-up issues (#660-#662) that add endpoints/wiring **must**
   use exactly the SAME activityCode/action (do not invent a new activityCode
   for the same concept).
3. **Permission seeding mechanism** — follows EXACTLY the pattern of
   `sql/038_awcms_visitor_analytics_permissions.sql`/
   `sql/032_awcms_tenant_domain_permissions.sql`: one new SQL migration
   (`048`) that does `INSERT INTO awcms_permissions ... ON CONFLICT
DO NOTHING`; no new mechanism was invented. This migration ONLY
   seeds the global ABAC catalog (a table that has existed since the generic
   base), NOT the `idn_admin_regions` schema itself (which stays deferred to
   #657) — so it is consistent with issue #655's instruction "no database
   schema/migration for actual region data yet", because
   `awcms_permissions` is not this module's domain schema.
4. **`domain/source-provenance.ts` as the single source of truth** —
   added even though issue #655 itself does not explicitly
   mention it, because the README (acceptance criteria: documentation of the
   source repo + license + caveat) needs exactly the same content that will be
   reused by #656 (vendoring)/#660 (import)/#664 (docs) — rather than
   letting the URL/license/caveat strings be retyped in many places and
   risking drift, one code constant file is made the reference. This is NOT
   domain logic (parsing/validation/derivation) — it is purely descriptive and
   does not violate the "no import logic yet" scope boundary.
5. **`application/` empty (`.gitkeep`)** — issue #655 is explicitly
   scaffold-only; there is no real application logic (no DB read/write,
   no orchestration whatsoever) to write. The `.gitkeep` convention for
   deliberately empty directories already exists in this repo (`src/lib/files/`,
   `src/lib/logging/`, `src/lib/errors/`) — followed exactly, not a new
   mechanism.
6. **No `api`/`navigation`/`jobs`/`health`/`settings`/`events` in the
   descriptor** — same pattern as `visitor_analytics` (Issue #617) and
   `news_portal` (Issue #632, that module is now merged into `blog_content`)
   before their real features existed: the descriptor only
   claims capabilities that genuinely already exist. The `api.basePath` for
   #662 will most likely be `/api/v1/idn-regions` (per the endpoint list in
   issue #662's body), but it is NOT pre-declared here — the #662 implementor
   adds it when that endpoint actually exists (unlike
   `tenant_domain`/`visitor_analytics`, which DID pre-declare `api`
   before the endpoints existed — deliberately not following that pattern
   here because there is no concrete need forcing an early pre-declaration,
   and per this task's instruction to keep the scaffold minimal).

### Files created/changed (quick reference)

- `sql/048_awcms_idn_admin_regions_permissions.sql`.
- `src/modules/idn-admin-regions/module.ts`,
  `domain/source-provenance.ts`, `application/.gitkeep`, `README.md`.
- `src/modules/index.ts` (import + registry array).
- Tests: `tests/modules/idn-admin-regions-module.test.ts`,
  `tests/unit/idn-admin-regions-source-provenance.test.ts`; updated:
  `tests/foundation.test.ts` (module count 14→15, added the
  `idn_admin_regions` block).
- Docs: `AGENTS.md` §Module map + skill table + mermaid diagram,
  `.claude/skills/README.md`, `docs/awcms/repo-inventory.md`
  (regenerated).
- Changeset: `.changeset/idn-admin-regions-scaffold-issue-655.md`.

## §656 — Vendor source metadata + license (Done)

Full implementation: `data/idn-admin-regions/` (NOT
`src/modules/idn-admin-regions/` — vendor files are not TypeScript source,
so they live outside `src/` per the explicit structure in issue #656's body),
containing `README.md`, `NOTICE.md` (upstream attribution + the
official-reference caveat), `manifest.schema.json` (JSON Schema for
`manifest.json`), `manifest.json` (dataset code, upstream repo/branch/
commit/license, file list with sha256+bytes+role, empty `normalizedFiles: []`),
`checksums.sha256` (top-level, covering every vendor file), and
`upstream/cahyadsn-wilayah/` (upstream LICENSE verbatim, `SOURCE.md`,
its own `checksums.sha256`, `db/wilayah.sql` + `wilayah_pulau.sql` +
`wilayah_penduduk.sql` + `wilayah_luas.sql` — exactly the four files the
issue body asked for, NOT all five files present in upstream `db/`:
`wilayah_level_1_2.sql` and the `archive/` folder are deliberately NOT
vendored because they are out of scope).

### Import facts (binding for follow-up issues that read this dataset)

- **Upstream commit SHA**: `cae306278e5be616c83ba2d8096b00767f45b5fe`
  (branch `master`, resolved via a real shallow `git clone` against
  `https://github.com/cahyadsn/wilayah.git` — not a made-up value).
- **Import time**: `2026-07-12T11:40:47Z` (UTC).
- All five SHA-256 checksums (LICENSE + 4 `.sql` files) were computed from the
  bytes of the files actually committed (`sha256sum`), and re-verified as
  identical against the original clone output before being written to
  `manifest.json`/`checksums.sha256`.

### Decisions/judgment calls in this issue (binding for follow-up issues)

1. **`.gitattributes` override for `data/idn-admin-regions/upstream/**`
   → `binary`** — upstream `db/wilayah.sql` uses CRLF line endings
   (the other three `.sql` files + `LICENSE` use LF). This repo's convention
   (`* text=auto eol=lf`) would normalize CRLF→LF at `git add`,
   which silently changes the vendor file's bytes and immediately makes the
   recorded checksums wrong/stale in the very same commit. The
   `binary` override (mirroring the existing `*.png binary` pattern) turns off
   EOL normalization entirely for the whole `upstream/` subtree, so the
   committed bytes are exactly the upstream bytes — verified
   directly (`git show ":<path>" | sha256sum` compared against `sha256sum`
   on the original clone output; identical for all five files).
   **Follow-up issues that add new upstream vendor files under
   `data/idn-admin-regions/upstream/` are automatically covered by this rule**
   (the pattern already covers the whole subtree); no new per-file override is
   needed.
2. **`manifest.schema.json` is deliberately not validated automatically by
   any tooling in this issue** — the repo has no JSON Schema validator
   dependency (`ajv` etc.) installed. Validation against this schema was
   done manually (read side by side) for this issue; Issue #659
   ("Repository validation gate for vendored/normalized dataset files")
   is the right place to add a real automated validator (it may pick a
   Bun-compatible dependency or a hand-written validator) — do not assume this
   schema is machine-enforced until #659 actually adds that.
3. **Empty `normalizedFiles: []` in `manifest.json`, no `normalized/` folder
   created** — per the explicit scope tree in issue #656's body
   (which does not mention `normalized/`) and the rule "if normalized files are
   generated, store them separately" (conditional — there are no normalized
   files at all in this issue). Issue #658 (parser/normalizer)
   is the first to populate this directory and this array.
4. **The four vendored `.sql` files are EXACTLY the ones the issue body asked
   for**, not the entire upstream `db/` — `db/wilayah_level_1_2.sql` (the
   province/regency-city dataset with coordinates/elevation/timezone/area/population/
   boundaries, far larger) and `db/archive/` (datasets from earlier years)
   are NOT vendored. Follow-up issues needing one of these files must
   add a new vendor entry explicitly (do not assume it is already there).

### Files created/changed (quick reference)

- `data/idn-admin-regions/{README.md,NOTICE.md,manifest.schema.json,
manifest.json,checksums.sha256}`.
- `data/idn-admin-regions/upstream/cahyadsn-wilayah/{LICENSE,SOURCE.md,
checksums.sha256,db/wilayah.sql,db/wilayah_pulau.sql,
db/wilayah_penduduk.sql,db/wilayah_luas.sql}`.
- `.gitattributes` (added the rule `data/idn-admin-regions/upstream/** binary`).
- Docs: `.claude/skills/awcms-idn-admin-regions/SKILL.md` (this file),
  `src/modules/idn-admin-regions/README.md` (status table).
- Changeset: `.changeset/idn-admin-regions-vendor-source-issue-656.md`.
- No changes to `src/`, no migration, no endpoint, and no test code —
  purely data vendoring + provenance metadata, per the issue scope.

## §657 — Versioned PostgreSQL schema (Done)

Full implementation: migration `sql/054_awcms_idn_admin_regions_schema.sql`
adds two tables — `awcms_idn_region_datasets` (metadata, one row
per imported dataset/version: unique `dataset_code`, source
repo/path/commit SHA/license/checksum, `row_count`, `status`,
`validation_summary` jsonb, `created_at`/`created_by`,
`activated_at`/`activated_by`) and `awcms_idn_admin_regions` (one
row per normalized region belonging to a single `dataset_id`: `code`/
`code_compact`/`parent_code`/`level`/`region_type`/`local_term`/
`official_name`/`normalized_name`/`full_path_code`/`full_path_name`/
`province_code`/`regency_code`/`district_code`/`village_code`/
`source_row_hash`/`metadata` jsonb). The columns are exactly the list in
issue #657's own body — nothing added, nothing removed.

### Decisions/judgment calls in this issue (binding for follow-up issues)

1. **Global reference data, NOT tenant-scoped** — there is NO
   `tenant_id` column, NO RLS, NO `CREATE POLICY` (unlike the default
   `awcms-new-migration` template, which assumes
   tenant-scoped). Both tables were added to `RLS_FREE_TABLES` AND
   `ALLOWED_GLOBAL_TABLE_GRANTS` in `scripts/security-readiness.ts` —
   without both, `checkRlsEnabled`/`checkRuntimeRoleGlobalTableGrants`
   would fail as soon as these tables exist in a migrated database. Verified
   directly: `bun run security:readiness` against a real DB after the
   migration was applied — both checks PASS.
2. **`awcms_app` is given ZERO grants on both tables** — not a
   "just in case" read-only grant. The `ALTER DEFAULT PRIVILEGES` of migration 013
   automatically grants `SELECT, INSERT, UPDATE, DELETE` to `awcms_app`
   the moment `CREATE TABLE` runs (exactly like the 9 other global tables before
   migration 045 narrowed them) — migration `054` immediately does
   `REVOKE ALL ... FROM awcms_app` on both tables in the same
   transaction. Reason: this issue is SCHEMA ONLY; there is no code path at all
   that reads/writes these tables right now (`awcms_worker`/
   `awcms_setup` are already automatically at zero because there is no
   `ALTER DEFAULT PRIVILEGES` for them). Verified via `psql \dp`
   against a real DB after migrating: only the owner role (`awcms`)
   appears in the access privileges, `awcms_app` has disappeared entirely
   from the ACL. Follow-up issues add EXACTLY the grants their new code path
   needs, in their own migrations — do not assume
   `awcms_app` already has SELECT/INSERT here, add it
   explicitly (#660 import needs INSERT+UPDATE, #661 activate/rollback
   needs UPDATE on `status`/`activated_at`/`activated_by`, #662 lookup
   API needs SELECT).
3. **"Only one active dataset" via a partial unique index on the `status`
   column itself** —
   `CREATE UNIQUE INDEX ... ON awcms_idn_region_datasets (status)
WHERE status = 'active'`. Because every row indexed by this
   partial index necessarily holds `'active'` (exactly the same value), a
   unique constraint on that column means at most ONE row can have
   `status = 'active'` — the standard Postgres idiom for a "singleton
   flag" without a separate boolean/computed column. The same index is
   simultaneously the fastest index for #662's default query ("find the active
   dataset"). Verified via a real integration test (inserting a second active
   row is rejected, inserting other `validated`/`superseded` rows is still
   allowed, and after the first row is `UPDATE ... SET status='superseded'`
   the active slot opens again for another row).
4. **The `status` CHECK constraint** is restricted to
   `('validated','active','superseded','rejected')` — the values `validated`/
   `active` are taken DIRECTLY from explicit sentences in issue #660's body
   ("Leave dataset as `validated`, not `active`") and #661 ("Only one
   dataset can be active at a time" + rollback reactivating the previous
   dataset). `superseded` holds datasets that WERE active
   and were then replaced/rolled back (preserving the historical `activated_at`/
   `activated_by` — see #661's note "Dataset source metadata
   remains immutable after activation"; only `status` changes).
   `rejected` is provided for possibly recording import attempts that
   failed validation. **This list is not final** — issues #659/#660/#661
   may add `ALTER TABLE ... DROP/ADD CONSTRAINT` in a new migration
   if they need extra lifecycle values that this schema-only issue did not
   anticipate; that is NOT editing the already-released migration `054`.
5. **The `region_type` CHECK constraint** is restricted to
   `('province','regency','district','village')` — the EXACT terms
   already used by `src/modules/idn-admin-regions/README.md` since #655.
   `level` (smallint) is CHECKed `BETWEEN 1 AND 4`, mirroring the same 4
   hierarchy tiers numerically (province=1..village=4) — kept in sync
   manually by whoever writes the row (#658 normalizer / #660 importer), NOT a
   generated column, because this mapping is a fixed domain fact, not a
   derivation from another column in the same row.
6. **Indexes**: unique `(dataset_id, code)` (exactly the acceptance criteria —
   `code` is only unique WITHIN one dataset; a new dataset may have rows with
   the same `code` as an older dataset because it re-imports the hierarchy from
   scratch), index `(dataset_id, parent_code)` (parent lookup), index
   `(dataset_id, normalized_name)` (search index — prefixed with
   `dataset_id` because every real query is always dataset-scoped, per
   #662's default "query the active dataset unless explicitly asked otherwise").
   No `pg_trgm`/GIN — this repo has no precedent for that extension
   anywhere in `sql/`, and the acceptance criteria do not ask for
   fuzzy substring search; a plain btree is enough for the equality/prefix/ORDER
   BY that #662 most likely needs.
7. **No soft-delete columns** (`deleted_at`/`deleted_by`/etc.) on
   either table — the column list in issue #657's own body is explicit
   and does not mention them; datasets/regions here behave more
   like an "append-only version history" (no issue in this epic
   deletes a dataset) than like master data that can be
   archived. `created_by`/`activated_by` are deliberately plain `uuid` with no FK
   — the SAME pattern is used throughout this repo for actor-id columns
   (`awcms_offices.created_by`, `awcms_email_messages.created_by`,
   etc.), not a new exception.
8. **Migration test**: `tests/integration/idn-admin-regions-schema.integration.test.ts`
   — because these tables are NOT tenant-scoped, this test does NOT exercise
   RLS isolation (unlike most other `*-schema.integration.test.ts` in this
   repo) — instead it proves the ABSENCE of `tenant_id`/RLS
   explicitly, plus the real constraints: unique `(dataset_id, code)`, the
   parent-lookup index, the `normalized_name` search index, single-active-dataset,
   the `status`/`region_type`/`level` CHECKs, and zero `awcms_app` grants.
   Every test query goes through `getAdminSql()` (the migration owner
   connection) — NOT `getTestSql()` (role `awcms_app`) — because `awcms_app`
   is deliberately at zero access on these tables in this issue (see point 2
   above); the same pattern is used by
   `module-management-schema.integration.test.ts` before that module
   had its first service (Issue #513).
9. **Real provenance data from #656 is used in the test** — the
   commit SHA constant (`cae306278e5be616c83ba2d8096b00767f45b5fe`) and the
   `db/wilayah.sql` checksum (`data/idn-admin-regions/manifest.json`) are copied
   verbatim into the test as proof that `source_commit_sha`/
   `source_file_sha256` (`text`, no length limit) can really
   hold those actual values, not just short placeholders.

### Files created/changed (quick reference)

- `sql/054_awcms_idn_admin_regions_schema.sql`.
- `scripts/security-readiness.ts` (`RLS_FREE_TABLES` +
  `ALLOWED_GLOBAL_TABLE_GRANTS` — two new entries, zero grants).
- Test: `tests/integration/idn-admin-regions-schema.integration.test.ts`.
- Docs: `.claude/skills/awcms-idn-admin-regions/SKILL.md` (this file),
  `src/modules/idn-admin-regions/README.md` (status table),
  `docs/awcms/04_erd_data_dictionary.md` (new entries + table
  ownership matrix), `docs/awcms/repo-inventory.md` (regenerated).
- Changeset: `.changeset/idn-admin-regions-schema-issue-657.md`.
- No OpenAPI/AsyncAPI changes — there is no new endpoint/event in
  this issue (the lookup API is #662).

## Notes for follow-up issues (#658-#664)

- **#658 (parser)**: MUST be able to run without a MySQL runtime (explicit
  acceptance criteria) — parse the MySQL-style insert SQL dump as strings,
  NOT by executing any SQL (neither against Postgres nor MySQL).
- **#660/#661 (import/activate/rollback)**: high-risk mutations — MUST have
  an `Idempotency-Key` (skill `awcms-idempotency`) and audit events
  (skill `awcms-audit-log`). Import must NOT call external providers
  inside a DB transaction (mandatory rule #11 of AGENTS.md) — but
  note that the #660 import involves no external provider at
  all (purely reading local files + writing Postgres), so this rule is
  relevant only if a future implementation adds a remote fetch.
- **#662 (lookup API)**: by default it MUST query only the `active` dataset
  (explicit acceptance criteria) — with a `dataset=active|<code>` parameter
  for an explicit override. Read-only, use the standard response helpers
  (skill `awcms-new-endpoint`), permissions `idn_admin_regions.region.read`
  / `idn_admin_regions.dataset.read` from #655 above.
- **#663 (admin UI)**: path `/admin/master-data/idn-regions/...` — follow
  the design system (skill `awcms-ui-screen`), permission-gated with the same
  permissions from #655; the activate/rollback buttons must require explicit
  confirmation.
- **Every follow-up issue that touches this dataset MUST keep
  displaying §Source and license above** (repo URL, MIT, the official caveat)
  in its own README/docs/UI — never drop it for brevity.
