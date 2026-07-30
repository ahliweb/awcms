---
name: awcms-port-from-mini
description: Port sebuah modul/fitur yang sudah matang & teruji dari repo awcms-mini ke repo awcms secara atomic, adaptasi (bukan copy), sampai semua cek hijau + commit atomic. Gunakan saat diminta "port modul <X> dari mini", "terapkan fitur mini ke awcms", atau saat sebuah modul fondasi awcms-mini belum ada di awcms. Menegakkan kontrak alur mini-first (docs/awcms/alur-pengembangan-mini-first.md): rename prefix awcms_mini_→awcms_, penomoran migrasi lanjutan, drop dependensi/toolchain yang belum ada di awcms, dan verifikasi DoD.
---

# AWCMS — Port modul dari awcms-mini

Baca `AGENTS.md` §Relasi + [`docs/awcms/alur-pengembangan-mini-first.md`](../../../docs/awcms/alur-pengembangan-mini-first.md) lebih dulu. awcms adalah rebuild ber-skop ERP di atas fondasi awcms-mini; fitur **dimatangkan di mini dulu**, lalu diport ke sini. Ini playbook port itu — **adaptasi, bukan salin mentah**.

- SUMBER (baca saja): `/home/data/dev_react/awcms-mini`
- TARGET: `/home/data/dev_bun/awcms`

> **Berlaku juga untuk port dari `awcms-micro`** — dan sejak 2026-07-24 itulah
> sumber yang paling aktif. [ADR-0035](../../../docs/adr/0035-awcms-online-first-erp-saas-superset-repositioning.md)
> menjadikan `awcms` **superset** yang menyerap klaster website/e-commerce
> `awcms-micro`; peta gelombang + urutan dependensinya di
> [`absorb-awcms-micro-roadmap.md`](../../../docs/awcms/absorb-awcms-micro-roadmap.md).
> Playbook di bawah identik, dengan dua penyesuaian: SUMBER =
> `/home/data/dev_react/awcms-micro`, dan aturan rename §2 berlaku untuk prefix
> `awcms_micro_` → `awcms_` (bukan `awcms_mini_`). Satu **adaptasi khas awcms**
> yang berulang di tiap port konten: rute publik micro **host-resolved**
> (`/news/:slug`), sedangkan base ini **path-tenant-scoped**
> (`/blog/{tenantCode}/{slug}`, ADR-0009) — jadi `urlTemplate` descriptor apa pun
> perlu placeholder `:tenantCode` yang diresolusi server.

## 1. Recon sebelum menulis

```bash
M=/home/data/dev_react/awcms-mini; A=/home/data/dev_bun/awcms
sed -n '/dependencies:/,/]/p' $M/src/modules/<mod>/module.ts     # deps → SEMUA harus sudah ada di $A/src/modules/index.ts
find $M/src/modules/<mod> -type f | wc -l                         # ukuran modul
ls $M/sql | grep -i <mod>                                         # migrasi (bisa >1 — konsolidasikan)
find $M/src/pages/api -path "*<mod>*"                             # route
grep -rl "<mod>\|<Symbol>" $M/tests                               # test (port yang unit/domain)
grep -rn "<mod>:" $M/package.json                                 # script (dispatcher/worker)
ls -1 $A/sql | tail -1                                            # nomor migrasi terakhir di awcms → +1
```

Kalau salah satu dependency modul **belum** ada di awcms → port dependency itu dulu (urut dependensi), atau adaptasi agar tak mengimpornya (§4).

## 2. Aturan rename (non-negotiable)

- Tabel/env/identifier `awcms_mini_…` → `awcms_…`, `AWCMS_MINI_…` → `AWCMS_…`.
- String/path/nama-event `awcms-mini` → `awcms` (mis. `awcms-mini.<mod>.x` → `awcms.<mod>.x`); header `X-AWCMS-Mini-*` → `X-AWCMS-*`.
- `openApiPath` → **fragment per-modul** `openapi/modules/<module>.openapi.yaml` (ADR-0026, Issue #182 — pipeline OpenAPI modular; `bun run openapi:bundle` menggabungnya). **Setiap** modul memakai bentuk ini sekarang: gate kepemilikan fragment di `api:spec:check` menolak `openApiPath` yang menunjuk bundel, menuntut berkas fragmentnya ada, dan menuntut tiap fragment diklaim tepat satu modul terdaftar (PR #308 — dua modul dulu menunjuk bundel, dan itulah yang membuat fragment modul pensiunan bertahan tanpa pemilik). Port juga WAJIB mendeklarasikan tag modulnya di `tags:` `openapi/awcms-public-api.src.yaml`; tanpa itu seluruh operasi hasil port hilang dari `docs/awcms/api-reference.md` (gate tag kini memerahkannya). `asyncApiPath` → `asyncapi/awcms-domain-events.asyncapi.yaml`.
- Verifikasi bersih: `grep -rnE "awcms[_-]mini_[a-z0-9]" <file-baru>` nihil **kecuali** komentar provenance header (mis. `-- ported from awcms-mini migration 0NN`). Untuk `.md`: setelah `git add -A`, `git ls-files '*.md' | xargs grep -lnE "awcms[_-]mini_[a-z0-9]"` HARUS kosong (changeset/README tak boleh memicu regresi `check:docs`; tulis `<worker-role>` bukan nama role bergaya `awcms_mini_…`).

## 3. Migrasi

- Nomor lanjutan (`NNN` = terakhir+1), nama `NNN_awcms_<area>_<desc>.sql`. Konsolidasikan beberapa migrasi mini menjadi bentuk final koheren (fresh DB, tanpa langkah backfill legacy).
- WAJIB per tabel tenant-scoped: `tenant_id uuid NOT NULL REFERENCES awcms_tenants(id)`, `ENABLE ROW LEVEL SECURITY` **+ `FORCE ROW LEVEL SECURITY`** + policy `tenant_id = current_setting('app.current_tenant_id')::uuid` (ikuti gaya `sql/005`/`008`/`013`). `ENABLE` tanpa `FORCE` **inert** selama app connect sebagai owner tabel — itulah gap yang `sql/017` tutup untuk 23 tabel; jangan bikin gap baru. Index untuk tiap FK, `timestamptz`, `numeric` (bukan float).
- **GRANT**: role `awcms_app` SUDAH ADA sejak `sql/019_awcms_db_role_separation.sql` (Issue #141) dan punya **blanket grant** — tabel baru tidak perlu `GRANT ... TO awcms_app` sendiri. **KOREKSI 2026-07-25: role `awcms_worker` (dan `awcms_setup`) SUDAH ADA** sejak `sql/022_awcms_db_worker_setup_roles.sql` — versi skill ini sebelumnya menyuruh men-DROP blok `GRANT ... TO awcms_worker`; itu **SALAH** dan akan menghasilkan job terjadwal yang kena `permission denied` di produksi. Yang benar: bila modul yang diport punya job worker, tulis grant least-privilege eksplisit per tabel **dan** tambahkan entri yang PERSIS sama ke `WORKER_ROLE_GRANTS` di `scripts/security-readiness.ts`. Matriks itu dijaga drift test dua-arah (`tests/*worker*`/`security-readiness`): under-grant → job mati di produksi, over-grant → isolasi yang jadi alasan split-role itu bohong. Lupa memperbaruinya = `bun run check` merah, bukan gagal senyap.
- Store idempotensi generik `awcms_idempotency_keys` sudah ada (`sql/009`) — jangan buat ulang.

## 4. Adaptasi kontrak & dependensi

- Kontrak `ModuleDescriptor` awcms (`src/modules/_shared/module-contract.ts`) lebih ramping dari mini, TAPI sejak Issue #178 (contract v1.2.0) sudah memodelkan `capabilities` (`provides`/`consumes`, ADR-0011) dan `compatibility.deploymentProfiles` — jadi field itu **boleh dipertahankan** saat porting (divalidasi `bun run modules:compose:check`). `ModuleType` awcms masih TANPA `"derived"` (CHECK constraint DB `sql/008` cuma base/system/domain/integration) — modul turunan pakai `"domain"`. Field lain yang belum ada tetap DROP; tambah ke kontrak hanya bila benar-benar butuh (naikkan `MODULE_CONTRACT_VERSION`).
- **Navigation entry BOLEH** — KOREKSI 2026-07-25: admin UI SSR read+write sudah ada (Issue #166/#171, shell paritas #229) dan modul seperti `blog_content`/`tenant_domain`/`visitor_analytics` sudah mendeklarasikan `navigation`. Syaratnya tetap: **hanya** tunjuk path yang benar-benar punya halaman di `src/pages/admin/*` — nav ke rute yang tidak ada = 404 buat pengguna. Kalau modul yang diport API-only, jangan deklarasikan nav.
- **Toolchain komposisi/kontrak SUDAH ADA**: `modules:compose:check`, `modules:composition:inventory:generate`/`:check` (Issue #178), `openapi:bundle` + `api:docs:generate`/`:check` (Issue #182) — pakai bila relevan. **`extension:check` DIHAPUS** oleh ADR-0034 (jalur aplikasi-turunan dicabut) — JANGAN rujuk. Yang MASIH belum ada di awcms (JANGAN rujuk): `repo:inventory`, `work-class`, `i18n:*`. Selalu cek `package.json` untuk daftar script nyata sebelum merujuk.
- Bila mini mengimpor modul yang **belum** diport (email, reporting, integration-hub, dst.) → DROP route/consumer/adapter itu, atau jadikan no-op/seam opsional yang tak mengimpor modul absen. Catat tiap drop.
- Daftarkan module di `src/modules/index.ts` (urut agar DAG valid).

## 5. Kontrak API/event, keamanan, test

- Route tipis: `withTenant` → `authorizeInTransaction` (default-deny ABAC) → handler; helper `_shared/api-response.ts`; audit ke `awcms_audit_events` untuk mutation high-risk; `Idempotency-Key` (`_shared/idempotency.ts`) untuk mutation high-risk.
- Tambah path ke fragment modulnya `openapi/modules/<module>.openapi.yaml`, lalu `bun run openapi:bundle` (parity diuji `api:spec:check`; pelajari `scripts/api-spec-check.ts`). Snapshot OpenAPI beku bersifat **add-only** — jangan mengedit snapshot, perbarui allow-list-nya. Untuk domain event: `appendDomainEvent` + channel di `asyncapi/awcms-domain-events.asyncapi.yaml` + daftarkan event-type di registry `domain-event-runtime`.
- Provider eksternal di luar transaksi (ADR-0006) via outbox + dispatcher; tambah script dispatcher ke `package.json`, dan bila menambah job update `tests/module-management-job-registry.test.ts`.
- Port test **unit/domain** ke `tests/` (layout flat; sesuaikan import `../../src`→`../src`). Test integrasi (butuh Postgres) boleh dilewati — catat.

## 6. Definition of Done — semua HARUS hijau

```bash
cd /home/data/dev_bun/awcms
git add -A                       # agar check:docs memindai .md baru (changeset/README)
bun run format                   # WAJIB dulu: prettier --write (file buatan subagent sering belum terformat)
bun run check                    # rantai PENUH — ini yang ditegakkan CI
```

`bun run check` menjalankan, berurutan: `lint` → `check:docs` →
`check:docs:translation` → `api:spec:check` → `api:docs:check` →
`modules:dag:check` → `modules:compose:check` →
`modules:composition:inventory:check` → `reporting:projections:registry:check` →
`identity-access:sod-registry:check` → `data-lifecycle:registry:check` →
`site-search:sources:check` → `family:conformance:check` →
`logging:lint:check` → `typecheck` → `test` → `build`. Rantai ini **tumbuh tiap
kali seam descriptor baru mendarat** — baca `package.json` daripada mempercayai
daftar ini bila terasa lebih pendek dari yang ada di sana.

Yang paling sering menggigit saat porting:

- `family:conformance:check` — bila port menaikkan versi kontrak
  (module/capability/OpenAPI/AsyncAPI) atau versi stack, perbarui
  `awcms-family-compatibility.yaml` **dulu** (Issue #183,
  `docs/awcms/family-compatibility.md`).
- `modules:composition:inventory:check` — regen inventory saat registry berubah.
- Gate registry descriptor (`data-lifecycle`, `site-search:sources`, dst.) —
  mendaftarkan descriptor tanpa memperbaruinya = merah.
- Drift matriks `WORKER_ROLE_GRANTS` (lihat §3) bila migrasi memberi grant worker.

**Jangan cukup dengan subset.** CI (`.github/workflows/ci.yml`) menjalankan `lint` (prettier) DAN `build` selain cek di atas — melewati keduanya adalah penyebab paling umum "hijau lokal tapi merah di CI". Selalu `bun run format` + `bun run lint` + `bun run build` sebelum commit/PR (setara `bun run check` penuh). JANGAN jalankan `config:validate` (butuh env) atau `db:migrate` tanpa DB. Untuk **memvalidasi migrasi terhadap Postgres nyata** tanpa konektivitas host→container, pakai skill `docker-host-container-network` §7 (`docker cp sql/` + `psql -f` di dalam container). Tambah changeset **minor**.

## 7. Commit atomic

Satu modul = satu commit (AGENTS.md: satu PR = satu perubahan). Format:
`feat(<mod>): port <mod> module from awcms-mini` + body ringkas (migrasi+RLS, route+OpenAPI, event, fitur yang di-drop, jumlah test). Sertakan trailer `Co-Authored-By`. Verifikasi **independen** hasil coder (jangan hanya percaya laporannya): jalankan ulang DoD + `grep` kebocoran prefix + hitung RLS migrasi sebelum commit.

## 8. Laporan akhir wajib

File dibuat/diubah; migrasi+tabel+RLS; field kontrak yang di-drop; route+OpenAPI; event/channel; fitur/consumer yang di-drop + alasan; test diport/dilewati; file di luar modul yang diubah + alasan; hasil PERSIS tiap perintah DoD (jujur — jangan klaim hijau bila tidak).
