---
name: awcms-production-preflight
description: Jalankan preflight & go-live readiness AWCMS sebelum production. Gunakan menjelang deploy/go-live, saat menyiapkan release, atau saat diminta cek production readiness. Sesuai doc 07 & 12.
---

# AWCMS — Production Preflight & Go-Live

Ikuti `docs/awcms/07_sprint_testing_production_readiness.md` dan `docs/awcms/12_generator_prompt.md`.

## Command preflight

```bash
bun install
bun run production:preflight
```

Sejak Issue #689 (epic #679), `config:validate`'s CLI report menambahkan
satu seksi baru di akhir output — **deprecation notices** (informational,
tidak pernah menggagalkan check ini), didorong oleh `src/lib/config/
registry.ts`'s field `deprecated`. Bentuk/urutan/exit-code stage lain di
bawah ini tidak berubah. `bun run config:docs:check` (bagian dari `bun run
check`, BUKAN bagian dari `production:preflight` — lihat doc 18 §Config
registry) menjaga registry ini, `.env.example`, dan doc 18 tetap sinkron;
jalankan itu terpisah sebelum preflight bila baru saja mengubah env var.

Sejak Issue #684 (epic #679), `bun run production:preflight` (Issue 12.2)
adalah SATU perintah **read-only** yang menjalankan urutan lengkap sendiri
— `config:validate` → `security:readiness` → `database:capacity` (Issue
#743, epic #738 platform-evolution — kalkulator kapasitas koneksi
lintas-instance, murni aritmatika config, tanpa koneksi database sama
sekali; lihat `database-capacity-runbook.md`) → `db:connectivity` (satu
`SELECT` memverifikasi koneksi + tabel ledger migrasi) → `api:spec:check`
→ `modules:compose:check` (Issue #740, epic #738 — registry komposisi
build-time aplikasi turunan valid) → `extension:check` (Issue #741, epic
#738 — kompatibilitas manifest aplikasi turunan terhadap rilis base
saat ini) → `test` → `build` → `db:pool:health` (skip bila server belum
jalan, kecuali `APP_ENV=production` — di situ skip BLOKIR go-live) →
`migration:plan` (dry-run: daftar migrasi pending TANPA menjalankannya).
**Sebelas** stage read-only total (`scripts/production-preflight.ts`'s
`REMAINING_CHILD_PROCESS_STAGES` + `db:connectivity`/`db:pool:health`/
`migration:plan` yang ditangani terpisah). Tidak ada stage yang menulis ke
database. Menjalankan command satu-satu secara manual (seperti daftar lama
di atas) TIDAK lagi direkomendasikan — `bun run db:migrate` secara
terpisah TIDAK termasuk dalam preflight ini sama sekali; lihat §Menerapkan
migrasi di bawah.

### Menerapkan migrasi (langkah terpisah, wajib eksplisit)

`bun run production:preflight` sendiri **tidak pernah** menulis ke
database — bug lama (Issue #684): `db:migrate` dulu berjalan sebagai
stage awal tanpa syarat, jadi stage belakangan (spec check/test/build)
yang gagal tetap meninggalkan database ter-migrasi walau verdict akhirnya
"GO-LIVE DIBLOKIR". Sekarang menerapkan migrasi butuh flag eksplisit,
HANYA berjalan bila verdict `GO-LIVE DIIZINKAN` (sebelas stage read-only
di atas semua lulus):

```bash
APP_ENV=production DATABASE_URL=<production-url> bun run production:preflight \
  --apply-migrations --backup-verified --acknowledge-target=production
```

Ketiga flag WAJIB bersamaan (`scripts/production-preflight.ts`'s
`authorizeApply`, diuji unit test): `--apply-migrations` (niat operator),
`--backup-verified` (atestasi backup baru yang sudah dibuktikan bisa
di-restore), `--acknowledge-target=<nilai>` yang harus SAMA PERSIS dengan
`APP_ENV` (penangkap typo — menjalankan di shell/`.env` yang salah dengan
`--acknowledge-target` salah menghasilkan penolakan keras, bukan mutasi
diam-diam ke database yang salah). Prosedur lengkap (rehearsal staging,
bukti backup, apply, rollback): `docs/awcms/production-preflight-runbook.md`.

## Checklist go-live

**Application:** build pass · migration pass · OpenAPI valid · setup wizard locked · role default ada · ABAC default deny tested · RLS tested · soft delete default filter tested · logging aktif.

**Database:** versi sesuai target · PostgreSQL tidak public · least-privilege user · backup aktif · restore tested · index utama ada · partial index soft delete ada bila relevan · pool sehat · slow query monitoring.

**Security:** no hardcoded secret · `.env` aman & tidak dikomit · password hash modern · login lockout · RLS aktif · ABAC aktif · audit aktif · restore/purge berizin dan diaudit · tax data masked · CRM opt-out respected · AI read-only · sync HMAC bila hybrid · error tanpa stack trace · **no critical finding**.

**Runtime platform:** backend, script, test, migration, build, dan preflight berjalan dengan Bun. Tidak ada `node`, `npm`, `npx`, `pnpm`, `yarn`, adapter server Node.js, atau dependency yang memaksa runtime Node.js kecuali pengecualian tertulis sudah disetujui dan dicatat di docs/audit.

## Gate

```mermaid
flowchart LR
  C[Jalankan preflight] --> F{Critical finding?}
  F -- Ya --> Block[GO-LIVE DIBLOKIR]
  F -- Tidak --> Ready([Go-Live diizinkan])
```

## Backup & restore (wajib teruji)

Sejak Issue 12.2, alur ini sudah diimplementasikan sebagai skrip siap
pakai — sejak Issue #691 (epic #679) skrip ini mewajibkan **backup
terenkripsi + manifest bertanda tangan (HMAC)**, dan restore memverifikasi
checksum SEBELUM mutasi apa pun (lihat `deploy/backup/README.md` untuk
model keamanan lengkap: kunci wajib dari FILE — `BACKUP_ENCRYPTION_KEY_FILE`/
`BACKUP_HMAC_KEY_FILE` — bukan CLI/env-content; `DATABASE_URL` tidak pernah
muncul di argv `pg_dump`/`pg_restore`/`psql`; lock mutual-exclusion; off-site
copy opsional via `deploy/backup/offsite-copy.sh`; restore drill terjadwal
via `deploy/backup/restore-drill.sh`):

```bash
DATABASE_URL="$DATABASE_URL" \
BACKUP_DIR=/var/backups/awcms \
BACKUP_ENCRYPTION_KEY_FILE=/etc/awcms/backup-encryption.key \
BACKUP_HMAC_KEY_FILE=/etc/awcms/backup-hmac.key \
./deploy/backup/backup-postgres.sh

DATABASE_URL="$DATABASE_URL" \
BACKUP_ENCRYPTION_KEY_FILE=/etc/awcms/backup-encryption.key \
BACKUP_HMAC_KEY_FILE=/etc/awcms/backup-hmac.key \
./deploy/backup/restore-postgres.sh /var/backups/awcms/awcms_YYYYMMDD_HHMMSS.dump.enc
```

(Restores into the disposable `awcms_restore_test` database by
default — never the live one. `--target=<dbname>` + matching
`--acknowledge-target=<dbname>` is required for a real recovery target.)

Validasi restore: tenant/user/produk/stok/transaksi terbaca · login test · POS smoke test · report smoke test. `deploy/backup/restore-drill.sh` mengotomasi sebagian validasi ini (migrasi schema, tenant isolation RLS, sample record) plus laporan RTO/RPO — jalankan terjadwal, terpisah dari backup harian.

Sejak Issue #684, `--backup-verified` di atas WAJIB berdasarkan bukti
restore-test nyata dari skrip ini, bukan sekadar backup yang "ada" —
lihat `docs/awcms/production-preflight-runbook.md`'s §Backup evidence
untuk urutan lengkap (dump → restore-test → catat evidence).

## Output

Laporan production readiness: status tiap gate, temuan (severity), rollback plan, keputusan go/no-go. Critical control fail **memblokir** go-live.
`--json-output=<path>` (opsional, Issue #684) menulis hasil terstruktur
(`{ go, failedStages, blockingSkips, results, plan, applied }`) ke file — untuk arsip evidence deploy,
tidak mengubah output stdout default.
