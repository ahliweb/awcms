---
name: awcms-port-from-mini
description: Port sebuah modul/fitur yang sudah matang & teruji dari repo awcms-mini ke repo awcms secara atomic, adaptasi (bukan copy), sampai semua cek hijau + commit atomic. Gunakan saat diminta "port modul <X> dari mini", "terapkan fitur mini ke awcms", atau saat sebuah modul fondasi awcms-mini belum ada di awcms. Menegakkan kontrak alur mini-first (docs/awcms/alur-pengembangan-mini-first.md): rename prefix awcms_mini_→awcms_, penomoran migrasi lanjutan, drop dependensi/toolchain yang belum ada di awcms, dan verifikasi DoD.
---

# AWCMS — Port modul dari awcms-mini

Baca `AGENTS.md` §Relasi + [`docs/awcms/alur-pengembangan-mini-first.md`](../../../docs/awcms/alur-pengembangan-mini-first.md) lebih dulu. awcms adalah rebuild ber-skop ERP di atas fondasi awcms-mini; fitur **dimatangkan di mini dulu**, lalu diport ke sini. Ini playbook port itu — **adaptasi, bukan salin mentah**.

- SUMBER (baca saja): `/home/data/dev_react/awcms-mini`
- TARGET: `/home/data/dev_bun/awcms`

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
- `openApiPath` → `openapi/awcms-public-api.openapi.yaml`; `asyncApiPath` → `asyncapi/awcms-domain-events.asyncapi.yaml`.
- Verifikasi bersih: `grep -rnE "awcms[_-]mini_[a-z0-9]" <file-baru>` nihil **kecuali** komentar provenance header (mis. `-- ported from awcms-mini migration 0NN`). Untuk `.md`: setelah `git add -A`, `git ls-files '*.md' | xargs grep -lnE "awcms[_-]mini_[a-z0-9]"` HARUS kosong (changeset/README tak boleh memicu regresi `check:docs`; tulis `<worker-role>` bukan nama role bergaya `awcms_mini_…`).

## 3. Migrasi

- Nomor lanjutan (`NNN` = terakhir+1), nama `NNN_awcms_<area>_<desc>.sql`. Konsolidasikan beberapa migrasi mini menjadi bentuk final koheren (fresh DB, tanpa langkah backfill legacy).
- WAJIB per tabel tenant-scoped: `tenant_id uuid NOT NULL REFERENCES awcms_tenants(id)`, `ENABLE ROW LEVEL SECURITY` **+ `FORCE ROW LEVEL SECURITY`** + policy `tenant_id = current_setting('app.current_tenant_id')::uuid` (ikuti gaya `sql/005`/`008`/`013`). `ENABLE` tanpa `FORCE` **inert** selama app connect sebagai owner tabel — itulah gap yang `sql/017` tutup untuk 23 tabel; jangan bikin gap baru. Index untuk tiap FK, `timestamptz`, `numeric` (bukan float).
- **GRANT**: role `awcms_app` SUDAH ADA sejak `sql/019_awcms_db_role_separation.sql` (Issue #141) — pertahankan/adaptasi `GRANT ... TO awcms_app` dari mini, jangan di-drop lagi. Role **`awcms_worker` TIDAK ada** di sini: DROP blok `GRANT ... TO awcms_worker` (akan gagal jalan) dan catat di header migrasi. Baca header `sql/019` untuk batasannya sebelum menyalin pola grant mini apa pun.
- Store idempotensi generik `awcms_idempotency_keys` sudah ada (`sql/009`) — jangan buat ulang.

## 4. Adaptasi kontrak & dependensi

- Kontrak `ModuleDescriptor` awcms (`src/modules/_shared/module-contract.ts`) lebih ramping dari mini — DROP field tak didukung (mis. `capabilities`/`deploymentProfiles`) bila belum ada; tambah field ke kontrak **hanya** bila modul benar-benar butuh (naikkan `MODULE_CONTRACT_VERSION`).
- **JANGAN tambah navigation entry** (belum ada admin UI di awcms — nav ke halaman tak ada = 404).
- **JANGAN rujuk toolchain yang tak ada di awcms**: `repo:inventory`, `work-class`, `i18n:*`, `openapi:bundle`, `extension:check`, `api:docs:*`, `modules:compose:*`. Hanya ~23 script nyata (cek `package.json`).
- Bila mini mengimpor modul yang **belum** diport (email, reporting, integration-hub, dst.) → DROP route/consumer/adapter itu, atau jadikan no-op/seam opsional yang tak mengimpor modul absen. Catat tiap drop.
- Daftarkan module di `src/modules/index.ts` (urut agar DAG valid).

## 5. Kontrak API/event, keamanan, test

- Route tipis: `withTenant` → `authorizeInTransaction` (default-deny ABAC) → handler; helper `_shared/api-response.ts`; audit ke `awcms_audit_events` untuk mutation high-risk; `Idempotency-Key` (`_shared/idempotency.ts`) untuk mutation high-risk.
- Tambah path ke `openapi/awcms-public-api.openapi.yaml` (parity diuji `api:spec:check`; pelajari `scripts/api-spec-check.ts`). Untuk domain event: `appendDomainEvent` + channel di `asyncapi/awcms-domain-events.asyncapi.yaml` + daftarkan event-type di registry `domain-event-runtime`.
- Provider eksternal di luar transaksi (ADR-0006) via outbox + dispatcher; tambah script dispatcher ke `package.json`, dan bila menambah job update `tests/module-management-job-registry.test.ts`.
- Port test **unit/domain** ke `tests/` (layout flat; sesuaikan import `../../src`→`../src`). Test integrasi (butuh Postgres) boleh dilewati — catat.

## 6. Definition of Done — semua HARUS hijau

```bash
cd /home/data/dev_bun/awcms
git add -A                       # agar check:docs memindai .md baru (changeset/README)
bun run format                   # WAJIB dulu: prettier --write (file buatan subagent sering belum terformat)
bun run lint                     # WAJIB: prettier --check — CI gagal bila ada 1 file tak terformat
bun run typecheck
bun test
bun run api:spec:check
bun run modules:dag:check
bun run logging:lint:check
bun run check:docs
bun run build                    # WAJIB: CI menjalankan build; port bisa lolos typecheck tapi gagal build
```

**Jangan cukup dengan subset.** CI (`.github/workflows/ci.yml`) menjalankan `lint` (prettier) DAN `build` selain cek di atas — melewati keduanya adalah penyebab paling umum "hijau lokal tapi merah di CI". Selalu `bun run format` + `bun run lint` + `bun run build` sebelum commit/PR (setara `bun run check` penuh). JANGAN jalankan `config:validate` (butuh env) atau `db:migrate` tanpa DB. Untuk **memvalidasi migrasi terhadap Postgres nyata** tanpa konektivitas host→container, pakai skill `docker-host-container-network` §7 (`docker cp sql/` + `psql -f` di dalam container). Tambah changeset **minor**.

## 7. Commit atomic

Satu modul = satu commit (AGENTS.md: satu PR = satu perubahan). Format:
`feat(<mod>): port <mod> module from awcms-mini` + body ringkas (migrasi+RLS, route+OpenAPI, event, fitur yang di-drop, jumlah test). Sertakan trailer `Co-Authored-By`. Verifikasi **independen** hasil coder (jangan hanya percaya laporannya): jalankan ulang DoD + `grep` kebocoran prefix + hitung RLS migrasi sebelum commit.

## 8. Laporan akhir wajib

File dibuat/diubah; migrasi+tabel+RLS; field kontrak yang di-drop; route+OpenAPI; event/channel; fitur/consumer yang di-drop + alasan; test diport/dilewati; file di luar modul yang diubah + alasan; hasil PERSIS tiap perintah DoD (jujur — jangan klaim hijau bila tidak).
