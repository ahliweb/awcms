---
name: awcms-idn-admin-regions
description: Kerjakan bagian mana pun dari epic idn_admin_regions AWCMS (Issue #655-#664, epic #654 — master data wilayah administratif Indonesia dari cahyadsn/wilayah). Gunakan saat menambah/mengubah vendoring source metadata, schema dataset region, parser/normalizer SQL upstream, validation gate, import pipeline, activation/rollback/diff, lookup API, atau admin UI untuk modul `idn_admin_regions`. Merangkum keputusan yang sudah dibuat supaya issue lanjutan tidak mengulang investigasi/kontradiksi.
---

# AWCMS — Indonesia Administrative Regions (`idn_admin_regions`)

Epic #654 (Issue #655-#664): master data wilayah administratif Indonesia
(provinsi/kabupaten-kota/kecamatan/desa-kelurahan) sebagai modul
`base`/reference reusable, disumber dari repository third-party
`cahyadsn/wilayah` (MIT License). Modul ini didaftarkan **langsung** di
repo base ini (bukan aplikasi turunan) karena master data wilayah relevan
untuk hampir semua aplikasi turunan (POS, portal, sistem pengaduan, dsb.)
— sama alasan `blog-content`/`news-portal`/`tenant-domain`/
`visitor-analytics` terdaftar langsung, tapi `idn_admin_regions` sendiri
`type: "base"` (bukan `domain`/`system`) karena ini reference data murni,
bukan fitur bisnis tenant atau infrastruktur platform.

## Sumber dan lisensi (WAJIB dipertahankan setiap issue lanjutan)

- **Repository**: <https://github.com/cahyadsn/wilayah>
- **Source folder**: <https://github.com/cahyadsn/wilayah/tree/master/db>
- **License**: MIT
- **Upstream statement**: "Kode dan Data Wilayah Administrasi Pemerintahan
  dan Kode Pulau Indonesia sesuai Kepmendagri No. 300.2.2-2430 Tahun
  2025."
- **Official-reference caveat (WAJIB tetap ditulis eksplisit di setiap
  README/docs/UI yang menampilkan dataset ini)**: ini dataset
  third-party/komunitas, BUKAN API atau ekspor resmi Kementerian Dalam
  Negeri (Kemendagri). AWCMS tidak pernah mengklaim sebagai
  penerbit resmi data ini, dan dataset ini tidak menggantikan rujukan
  legal/kepatuhan resmi operator ke Kepmendagri asli.

Konstanta kode tunggal untuk ketiga fakta ini:
`src/modules/idn-admin-regions/domain/source-provenance.ts` — issue
lanjutan (#656 vendoring, #660 import, #664 docs) WAJIB import konstanta
ini, jangan menulis ulang string URL/license/caveat secara terpisah agar
tidak drift.

## Kapan pakai skill ini vs skill generik

Skill ini melengkapi (bukan menggantikan) `awcms-new-module`
(struktur modul awal), `awcms-new-migration` (schema dataset #657),
`awcms-new-endpoint` (lookup API #662), `awcms-abac-guard` +
`awcms-audit-log` (import/activate/rollback #660-#661 adalah
mutation high-risk), `awcms-idempotency` (activate/rollback WAJIB
`Idempotency-Key` per acceptance criteria #661), dan `awcms-ui-screen`
(admin UI #663). Skill ini menyediakan konteks **cross-cutting epic
spesifik** — terutama fakta sumber/lisensi di atas dan keputusan
penamaan/struktur yang sudah dibuat di #655, supaya issue lanjutan tidak
menginvestigasi ulang dari nol.

## Status per issue (jangan bangun ulang yang sudah ada)

| Issue | Scope                                                                                  | Status                                                           |
| ----- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| #655  | Scaffold modul `idn_admin_regions` (descriptor, permission catalog, README)            | **Selesai** — lihat §655 di bawah                                |
| #656  | Vendor source metadata + license `cahyadsn/wilayah` di bawah `data/idn-admin-regions/` | **Selesai** — lihat §656 di bawah                                |
| #657  | Schema PostgreSQL versioned (`awcms_idn_region_datasets`, `awcms_idn_admin_regions`)   | **Selesai** — lihat §657 di bawah                                |
| #658  | Parser & normalizer SQL dump upstream `cahyadsn/wilayah` (MySQL-style insert dumps)    | Deferred (closed, `NOT_PLANNED` — temporary hold, bukan ditolak) |
| #659  | Validation gate repository untuk file dataset yang di-vendor/dinormalisasi             | Deferred (closed, `NOT_PLANNED` — temporary hold, bukan ditolak) |
| #660  | Import pipeline PostgreSQL (dry-run/commit)                                            | Deferred (closed, `NOT_PLANNED` — temporary hold, bukan ditolak) |
| #661  | Activation, rollback, dan diff dataset                                                 | Deferred (closed, `NOT_PLANNED` — temporary hold, bukan ditolak) |
| #662  | Read-only lookup API wilayah Indonesia                                                 | Deferred (closed, `NOT_PLANNED` — temporary hold, bukan ditolak) |
| #663  | Admin UI untuk browse dataset dan status validasi                                      | Deferred (closed, `NOT_PLANNED` — temporary hold, bukan ditolak) |
| #664  | SOP, docs, dan security review                                                         | Deferred (closed, `NOT_PLANNED` — temporary hold, bukan ditolak) |

**Catatan:** #658-#664 ditutup `NOT_PLANNED` oleh maintainer pada
2026-07-13 sebagai hold sementara (judul issue berawalan `PENDING:`) —
**jangan lanjutkan scope ini tanpa maintainer membuka ulang issue-nya
secara eksplisit.**

Urutan dependency yang disarankan (dari objective masing-masing issue):
655 → 656 (butuh modul terdaftar untuk `data/idn-admin-regions/` punya
tempat bernaung secara konseptual, walau file vendor sendiri di luar
`src/modules/`) → 657 (schema, independen dari 656 secara teknis tapi
secara isi butuh tahu bentuk `db/wilayah.sql`) → 658 (parser, butuh file
vendor #656 sebagai input nyata) → 659 (validator, butuh #656+#657+#658
ada untuk divalidasi) → 660 (import, butuh #657 schema + #658
output ternormalisasi + #659 validator lulus dulu) → 661 (activate/
rollback, butuh dataset ter-import #660) → 662 (lookup API, butuh dataset
aktif #661) → 663 (admin UI, butuh #660/#661/#662 semua ada) → 664
(docs/SOP final, merangkum semua).

## §655 — Scaffold modul (Selesai)

Implementasi lengkap: `src/modules/idn-admin-regions/module.ts` (module
baru, minimal — `key: "idn_admin_regions"`, `name: "Indonesia
Administrative Regions"`, `version: "0.1.0"`, `status: "experimental"`,
`type: "base"`, `dependencies: ["identity_access", "logging",
"module_management"]`, lima `permissions`), `domain/source-provenance.ts`
(konstanta source/license/caveat, lihat §Sumber dan lisensi di atas),
`application/.gitkeep` (kosong — belum ada logic apa pun untuk ditulis
sampai issue lanjutan memberi modul ini tabel/endpoint pertama untuk
diorkestrasi), `README.md` (dokumentasi source+lisensi+caveat+scope
per-issue). Migration `sql/048_awcms_idn_admin_regions_permissions.sql`
menyeed lima permission ke `awcms_permissions` — TIDAK ada tabel
domain baru (schema region ditunda ke #657, sesuai instruksi issue #655
sendiri: "no database schema/migration for actual region data yet").

### Keputusan/judgment call issue ini (mengikat untuk issue lanjutan)

1. **`type: "base"`, bukan `"domain"`/`"system"`** — dipilih karena master
   data wilayah adalah reference data murni yang identik untuk semua
   tenant (bukan konten yang dimiliki tenant seperti `blog_content`, dan
   bukan infrastruktur observability/lifecycle platform seperti
   `visitor_analytics`/`tenant_domain`). Ini modul `base` PERTAMA yang
   didaftarkan langsung di repo base sejak sembilan modul base generik asli
   (Issue 2.1-2.4/12.1/6.1-6.3/9.1/10.1/11.1) — lihat AGENTS.md §Peta modul,
   modul ini masuk daftar "base generik" itu, BUKAN daftar "Pengecualian
   empat modul domain/system".
2. **Permission key derivation** — issue #655 menulis lima permission
   string lengkap (`idn_admin_regions.region.read`, dst). Mekanisme modul
   descriptor memakai `{activityCode, action}` terpisah, digabung sebagai
   `${moduleKey}.${activityCode}.${action}`
   (`src/modules/module-management/domain/permission-sync.ts`'s `keyOf`).
   Pemetaan yang dipakai: `region.read` → activityCode `"region"` action
   `"read"`; `dataset.read`/`dataset.import`/`dataset.activate`/
   `dataset.rollback` → activityCode `"dataset"`, action masing-masing.
   Issue lanjutan (#660-#662) yang menambah endpoint/wiring **wajib**
   memakai activityCode/action yang SAMA persis (jangan buat activityCode
   baru untuk konsep yang sama).
3. **Mekanisme seed permission** — mengikuti PERSIS pola
   `sql/038_awcms_visitor_analytics_permissions.sql`/
   `sql/032_awcms_tenant_domain_permissions.sql`: satu migration SQL
   baru (`048`) yang `INSERT INTO awcms_permissions ... ON CONFLICT
DO NOTHING`, tidak ada mekanisme baru yang ditemukan. Migration ini HANYA
   menyeed katalog ABAC global (tabel yang sudah ada sejak base generik),
   BUKAN skema `idn_admin_regions` sendiri (yang tetap ditunda ke #657) —
   jadi ini konsisten dengan instruksi issue #655 "no database
   schema/migration for actual region data yet" karena
   `awcms_permissions` bukan skema domain modul ini.
4. **`domain/source-provenance.ts` sebagai single source of truth** —
   ditambahkan walau issue #655 sendiri tidak secara eksplisit
   menyebutnya, karena README (acceptance criteria: dokumentasi source
   repo + lisensi + caveat) butuh konten yang sama persis yang akan
   dipakai lagi oleh #656 (vendoring)/#660 (import)/#664 (docs) — daripada
   membiarkan string URL/license/caveat diketik ulang di banyak tempat dan
   berisiko drift, satu file konstanta kode dijadikan rujukan. Ini BUKAN
   logic domain (parsing/validasi/derivasi) — murni deskriptif, tidak
   melanggar batas scope "no import logic yet".
5. **`application/` kosong (`.gitkeep`)** — issue #655 secara eksplisit
   scaffold-only, tidak ada logic aplikasi nyata (tidak ada DB read/write,
   tidak ada orkestrasi apa pun) untuk ditulis. Konvensi `.gitkeep` untuk
   direktori yang sengaja kosong sudah ada di repo ini (`src/lib/files/`,
   `src/lib/logging/`, `src/lib/errors/`) — diikuti persis, bukan
   mekanisme baru.
6. **Tidak `api`/`navigation`/`jobs`/`health`/`settings`/`events` di
   descriptor** — sama pola `visitor_analytics` (Issue #617) dan
   `news_portal` (Issue #632) sebelum fitur nyatanya ada: descriptor hanya
   mengklaim capability yang benar-benar sudah ada. `api.basePath` untuk
   #662 kemungkinan `/api/v1/idn-regions` (sesuai daftar endpoint issue
   #662's body), tapi TIDAK di-pre-declare di sini — implementor #662
   menambahkannya sendiri saat endpoint itu benar-benar ada (beda dari
   `tenant_domain`/`visitor_analytics` yang PERNAH pre-declare `api`
   sebelum endpoint ada — keputusan sengaja tidak mengikuti pola itu di
   sini karena tidak ada kebutuhan konkret yang memaksa pre-declare lebih
   awal, dan sesuai instruksi tugas ini untuk tetap scaffold minimal).

### File yang dibuat/diubah (referensi cepat)

- `sql/048_awcms_idn_admin_regions_permissions.sql`.
- `src/modules/idn-admin-regions/module.ts`,
  `domain/source-provenance.ts`, `application/.gitkeep`, `README.md`.
- `src/modules/index.ts` (import + registry array).
- Test: `tests/modules/idn-admin-regions-module.test.ts`,
  `tests/unit/idn-admin-regions-source-provenance.test.ts`; diperbarui:
  `tests/foundation.test.ts` (module count 14→15, tambah blok
  `idn_admin_regions`).
- Docs: `AGENTS.md` §Peta modul + tabel skill + diagram mermaid,
  `.claude/skills/README.md`, `docs/awcms/repo-inventory.md`
  (regenerated).
- Changeset: `.changeset/idn-admin-regions-scaffold-issue-655.md`.

## §656 — Vendor source metadata + license (Selesai)

Implementasi lengkap: `data/idn-admin-regions/` (BUKAN
`src/modules/idn-admin-regions/` — file vendor bukan source TypeScript,
jadi hidup di luar `src/` sesuai struktur eksplisit di body issue #656),
berisi `README.md`, `NOTICE.md` (atribusi upstream + caveat
official-reference), `manifest.schema.json` (JSON Schema untuk
`manifest.json`), `manifest.json` (dataset code, upstream repo/branch/
commit/license, file list dengan sha256+bytes+role, `normalizedFiles: []`
kosong), `checksums.sha256` (top-level, mencakup seluruh file vendor), dan
`upstream/cahyadsn-wilayah/` (LICENSE upstream verbatim, `SOURCE.md`,
`checksums.sha256` sendiri, `db/wilayah.sql` + `wilayah_pulau.sql` +
`wilayah_penduduk.sql` + `wilayah_luas.sql` — persis empat file yang
diminta body issue, BUKAN kelima file yang ada di `db/` upstream:
`wilayah_level_1_2.sql` dan folder `archive/` sengaja TIDAK divendor
karena di luar scope).

### Fakta import (mengikat untuk issue lanjutan yang membaca dataset ini)

- **Commit SHA upstream**: `cae306278e5be616c83ba2d8096b00767f45b5fe`
  (branch `master`, di-resolve via shallow `git clone` sungguhan terhadap
  `https://github.com/cahyadsn/wilayah.git` — bukan nilai rekaan).
- **Waktu import**: `2026-07-12T11:40:47Z` (UTC).
- Kelima checksum SHA-256 (LICENSE + 4 file `.sql`) dihitung dari byte
  file yang benar-benar di-commit (`sha256sum`), diverifikasi ulang
  identik terhadap file asli hasil clone sebelum ditulis ke
  `manifest.json`/`checksums.sha256`.

### Keputusan/judgment call issue ini (mengikat untuk issue lanjutan)

1. **`.gitattributes` override untuk `data/idn-admin-regions/upstream/**`
   → `binary`** — `db/wilayah.sql` upstream memakai CRLF line ending
   (tiga file `.sql` lain + `LICENSE` memakai LF). Konvensi repo ini
   (`* text=auto eol=lf`) akan menormalisasi CRLF→LF saat `git add`,
   yang diam-diam mengubah byte file vendor dan langsung membuat checksum
   yang direkam menjadi salah/basi pada commit yang sama. Override
   `binary` (meniru pola `*.png binary` yang sudah ada) mematikan
   normalisasi EOL sepenuhnya untuk seluruh subtree `upstream/`, sehingga
   byte yang ter-commit persis sama dengan byte upstream — diverifikasi
   langsung (`git show ":<path>" | sha256sum` dibandingkan `sha256sum`
   pada file asli hasil clone, hasilnya identik untuk kelima file).
   **Issue lanjutan yang menambah file vendor upstream baru ke bawah
   `data/idn-admin-regions/upstream/` otomatis ikut aturan ini** (pattern
   sudah mencakup seluruh subtree), tidak perlu override baru per file.
2. **`manifest.schema.json` sengaja tidak divalidasi otomatis oleh
   tooling apa pun issue ini** — repo tidak punya dependency validator
   JSON Schema (`ajv` dsb.) terpasang. Validasi terhadap schema ini
   dilakukan manual (baca berdampingan) untuk issue ini; Issue #659
   ("Validation gate repository untuk file dataset yang di-vendor/
   dinormalisasi") adalah tempat yang tepat untuk menambahkan validator
   otomatis nyata (bisa memilih dependency Bun-compatible atau validator
   tulisan tangan) — jangan anggap schema ini sudah divalidasi machine-
   enforced sampai #659 benar-benar menambahkannya.
3. **`normalizedFiles: []` kosong di `manifest.json`, tidak ada folder
   `normalized/` dibuat** — sesuai scope tree eksplisit body issue #656
   (tidak menyebutkan `normalized/`) dan rule "if normalized files are
   generated, store them separately" (kondisional — belum ada file
   ternormalisasi apa pun di issue ini). Issue #658 (parser/normalizer)
   yang pertama kali mengisi direktori ini dan array ini.
4. **Empat file `.sql` yang divendor PERSIS yang diminta body issue**,
   bukan seluruh isi `db/` upstream — `db/wilayah_level_1_2.sql` (dataset
   provinsi/kab-kota dengan koordinat/elevation/timezone/luas/penduduk/
   boundaries, jauh lebih besar) dan `db/archive/` (dataset tahun-tahun
   sebelumnya) TIDAK divendor. Issue lanjutan yang butuh salah satu file
   ini harus menambah entry vendor baru secara eksplisit (bukan asumsi
   sudah ada).

### File yang dibuat/diubah (referensi cepat)

- `data/idn-admin-regions/{README.md,NOTICE.md,manifest.schema.json,
manifest.json,checksums.sha256}`.
- `data/idn-admin-regions/upstream/cahyadsn-wilayah/{LICENSE,SOURCE.md,
checksums.sha256,db/wilayah.sql,db/wilayah_pulau.sql,
db/wilayah_penduduk.sql,db/wilayah_luas.sql}`.
- `.gitattributes` (tambah rule `data/idn-admin-regions/upstream/** binary`).
- Docs: `.claude/skills/awcms-idn-admin-regions/SKILL.md` (file ini),
  `src/modules/idn-admin-regions/README.md` (status tabel).
- Changeset: `.changeset/idn-admin-regions-vendor-source-issue-656.md`.
- Tidak ada perubahan `src/`, migration, endpoint, atau test kode —
  murni vendoring data + metadata provenance, sesuai scope issue.

## §657 — Schema PostgreSQL versioned (Selesai)

Implementasi lengkap: migration `sql/054_awcms_idn_admin_regions_schema.sql`
menambah dua tabel — `awcms_idn_region_datasets` (metadata satu baris
per dataset/versi yang diimpor: `dataset_code` unik, source
repo/path/commit SHA/license/checksum, `row_count`, `status`,
`validation_summary` jsonb, `created_at`/`created_by`,
`activated_at`/`activated_by`) dan `awcms_idn_admin_regions` (satu
baris per region ternormalisasi milik satu `dataset_id`: `code`/
`code_compact`/`parent_code`/`level`/`region_type`/`local_term`/
`official_name`/`normalized_name`/`full_path_code`/`full_path_name`/
`province_code`/`regency_code`/`district_code`/`village_code`/
`source_row_hash`/`metadata` jsonb). Kolom persis sesuai daftar di body
issue #657 sendiri — tidak ditambah/dikurangi.

### Keputusan/judgment call issue ini (mengikat untuk issue lanjutan)

1. **Global reference data, BUKAN tenant-scoped** — TIDAK ada kolom
   `tenant_id`, TIDAK ada RLS, TIDAK ada `CREATE POLICY` (beda dari
   template default `awcms-new-migration`, yang mengasumsikan
   tenant-scoped). Kedua tabel ditambahkan ke `RLS_FREE_TABLES` DAN
   `ALLOWED_GLOBAL_TABLE_GRANTS` di `scripts/security-readiness.ts` —
   tanpa keduanya `checkRlsEnabled`/`checkRuntimeRoleGlobalTableGrants`
   akan gagal begitu tabel ini ada di database migrated. Diverifikasi
   langsung: `bun run security:readiness` terhadap DB nyata setelah
   migration di-apply — kedua check PASS.
2. **`awcms_app` diberi NOL grant pada kedua tabel ini** — bukan
   grant read-only "jaga-jaga". `ALTER DEFAULT PRIVILEGES` migration 013
   otomatis meng-grant `SELECT, INSERT, UPDATE, DELETE` ke `awcms_app`
   begitu `CREATE TABLE` jalan (persis seperti 9 tabel global lain sebelum
   migration 045 menyempitkannya) — migration `054` langsung
   `REVOKE ALL ... FROM awcms_app` pada kedua tabel di transaction
   yang sama. Alasan: issue ini SCHEMA ONLY, tidak ada jalur kode apa pun
   yang membaca/menulis tabel ini sekarang (`awcms_worker`/
   `awcms_setup` sudah otomatis nol karena tidak ada
   `ALTER DEFAULT PRIVILEGES` untuk mereka). Diverifikasi via `psql \dp`
   terhadap DB nyata setelah migrate: hanya role owner (`awcms`) yang
   muncul di access privileges, `awcms_app` sudah hilang sepenuhnya
   dari ACL. Issue lanjutan menambah grant PERSIS yang jalur kode barunya
   butuhkan, di migration mereka sendiri — jangan asumsikan
   `awcms_app` sudah punya SELECT/INSERT di sini, tambahkan
   eksplisit (#660 import perlu INSERT+UPDATE, #661 activate/rollback
   perlu UPDATE pada `status`/`activated_at`/`activated_by`, #662 lookup
   API perlu SELECT).
3. **"Hanya satu dataset aktif" via partial unique index pada kolom
   `status` itu sendiri** —
   `CREATE UNIQUE INDEX ... ON awcms_idn_region_datasets (status)
WHERE status = 'active'`. Karena setiap baris yang ter-index oleh
   partial index ini pasti bernilai `'active'` (sama persis), constraint
   unique pada kolom itu berarti maksimal SATU baris bisa punya
   `status = 'active'` — trik idiom Postgres standar untuk "singleton
   flag" tanpa perlu kolom boolean/computed terpisah. Index yang sama
   sekaligus jadi index tercepat untuk query default #662 ("cari dataset
   aktif"). Diverifikasi via integration test nyata (insert baris aktif
   kedua ditolak, insert baris `validated`/`superseded` lain tetap boleh,
   dan setelah baris pertama di-`UPDATE ... SET status='superseded'`
   slot aktif terbuka lagi untuk baris lain).
4. **CHECK constraint `status`** dibatasi ke
   `('validated','active','superseded','rejected')` — nilai `validated`/
   `active` diambil LANGSUNG dari kalimat eksplisit body issue #660
   ("Leave dataset as `validated`, not `active`") dan #661 ("Only one
   dataset can be active at a time" + rollback mengaktifkan kembali
   dataset sebelumnya). `superseded` menampung dataset yang PERNAH aktif
   lalu digantikan/di-rollback (mempertahankan `activated_at`/
   `activated_by` historis — lihat catatan #661 "Dataset source metadata
   remains immutable after activation", hanya `status` yang berubah).
   `rejected` disediakan untuk kemungkinan mencatat percobaan impor yang
   gagal validasi. **Daftar ini bukan final** — issue #659/#660/#661
   boleh menambah `ALTER TABLE ... DROP/ADD CONSTRAINT` di migration baru
   kalau butuh nilai lifecycle tambahan yang tidak diantisipasi issue
   schema-only ini; ini BUKAN mengedit migration `054` yang sudah rilis.
5. **CHECK constraint `region_type`** dibatasi ke
   `('province','regency','district','village')` — istilah PERSIS yang
   sudah dipakai `src/modules/idn-admin-regions/README.md` sejak #655.
   `level` (smallint) di-CHECK `BETWEEN 1 AND 4`, mencerminkan 4 tingkat
   hierarki yang sama secara numerik (province=1..village=4) — disinkron
   manual oleh penulis baris (#658 normalizer / #660 importer), BUKAN
   generated column, karena pemetaan ini fakta domain tetap, bukan
   turunan dari kolom lain di baris yang sama.
6. **Index**: unique `(dataset_id, code)` (persis acceptance criteria —
   `code` hanya unik DALAM satu dataset, dataset baru boleh punya baris
   `code` yang sama seperti dataset lama karena me-reimpor hierarki dari
   nol), index `(dataset_id, parent_code)` (parent lookup), index
   `(dataset_id, normalized_name)` (search index — diberi awalan
   `dataset_id` karena setiap query nyata selalu dataset-scoped, sesuai
   default #662 "query dataset aktif kecuali diminta eksplisit"). Tidak
   pakai `pg_trgm`/GIN — repo ini belum punya precedent extension
   tersebut di manapun di `sql/`, dan acceptance criteria tidak meminta
   fuzzy substring search; btree biasa cukup untuk equality/prefix/ORDER
   BY yang #662 kemungkinan besar butuhkan.
7. **Tidak ada kolom soft-delete** (`deleted_at`/`deleted_by`/dst.) pada
   kedua tabel — daftar kolom di body issue #657 sendiri sudah eksplisit
   dan tidak menyebutkannya; dataset/region di sini berperilaku lebih
   dekat ke "riwayat versi append-only" (tidak ada issue manapun di epic
   ini yang menghapus dataset) daripada master data yang bisa
   diarsipkan. `created_by`/`activated_by` sengaja `uuid` polos tanpa FK
   — pola yang SAMA dipakai di seluruh repo ini untuk kolom actor-id
   (`awcms_offices.created_by`, `awcms_email_messages.created_by`,
   dst.), bukan pengecualian baru.
8. **Migration test**: `tests/integration/idn-admin-regions-schema.integration.test.ts`
   — karena tabel ini TIDAK tenant-scoped, test ini TIDAK menguji isolasi
   RLS (beda dari kebanyakan `*-schema.integration.test.ts` lain di repo
   ini) — sebaliknya membuktikan KETIADAAN `tenant_id`/RLS secara
   eksplisit, plus constraint nyata: unique `(dataset_id, code)`, index
   parent lookup, index search `normalized_name`, single-active-dataset,
   CHECK `status`/`region_type`/`level`, dan nol grant `awcms_app`.
   Semua query test lewat `getAdminSql()` (koneksi migration owner) —
   BUKAN `getTestSql()` (role `awcms_app`) — karena `awcms_app`
   memang sengaja nol akses pada tabel ini di issue ini (lihat poin 2 di
   atas); pola yang sama dipakai
   `module-management-schema.integration.test.ts` sebelum modul itu
   punya service pertamanya (Issue #513).
9. **Data provenance nyata dari #656 dipakai di test** — konstanta
   commit SHA (`cae306278e5be616c83ba2d8096b00767f45b5fe`) dan checksum
   `db/wilayah.sql` (`data/idn-admin-regions/manifest.json`) disalin
   verbatim ke dalam test sebagai bukti bahwa `source_commit_sha`/
   `source_file_sha256` (`text`, tanpa batasan panjang) benar-benar bisa
   menampung nilai asli tersebut, bukan hanya placeholder pendek.

### File yang dibuat/diubah (referensi cepat)

- `sql/054_awcms_idn_admin_regions_schema.sql`.
- `scripts/security-readiness.ts` (`RLS_FREE_TABLES` +
  `ALLOWED_GLOBAL_TABLE_GRANTS` — dua entry baru, nol grant).
- Test: `tests/integration/idn-admin-regions-schema.integration.test.ts`.
- Docs: `.claude/skills/awcms-idn-admin-regions/SKILL.md` (file ini),
  `src/modules/idn-admin-regions/README.md` (status tabel),
  `docs/awcms/04_erd_data_dictionary.md` (entri baru + table
  ownership matrix), `docs/awcms/repo-inventory.md` (regenerated).
- Changeset: `.changeset/idn-admin-regions-schema-issue-657.md`.
- Tidak ada perubahan OpenAPI/AsyncAPI — tidak ada endpoint/event baru di
  issue ini (lookup API adalah #662).

## Catatan untuk issue lanjutan (#658-#664)

- **#658 (parser)**: HARUS bisa jalan tanpa runtime MySQL (acceptance
  criteria eksplisit) — parser dump SQL MySQL-style insert secara string,
  BUKAN eksekusi SQL apa pun (baik terhadap Postgres maupun MySQL).
- **#660/#661 (import/activate/rollback)**: mutation high-risk — WAJIB
  `Idempotency-Key` (skill `awcms-idempotency`) dan audit event
  (skill `awcms-audit-log`). Import TIDAK boleh memanggil provider
  eksternal di dalam transaksi DB (aturan wajib #11 AGENTS.md) — tapi
  perhatikan bahwa import #660 tidak melibatkan provider eksternal sama
  sekali (murni baca file lokal + tulis Postgres), jadi aturan ini
  relevan hanya bila implementasi masa depan menambah fetch jarak jauh.
- **#662 (lookup API)**: default HARUS query dataset `active` saja
  (acceptance criteria eksplisit) — parameter `dataset=active|<code>`
  untuk override eksplisit. Read-only, pakai response helper standar
  (skill `awcms-new-endpoint`), permission `idn_admin_regions.region.read`
  / `idn_admin_regions.dataset.read` dari #655 ini.
- **#663 (admin UI)**: path `/admin/master-data/idn-regions/...` — ikuti
  design system (skill `awcms-ui-screen`), permission-gated pakai
  permission yang sama dari #655, tombol activate/rollback wajib
  konfirmasi eksplisit.
- **Setiap issue lanjutan yang menyentuh dataset ini WAJIB tetap
  menampilkan §Sumber dan lisensi di atas** (repo URL, MIT, caveat resmi)
  di README/docs/UI-nya sendiri — jangan pernah dihilangkan demi
  keringkasan.
