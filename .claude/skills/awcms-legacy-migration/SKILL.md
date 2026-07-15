---
name: awcms-legacy-migration
description: BACAAN SAJA — migrasi data legacy sengaja DIDESKOP dari base repo AWCMS (lihat doc 06 §"Riwayat perubahan backlog"). Gunakan skill ini untuk memahami KENAPA fitur ini tidak ada di sini dan ke mana konsep ini harus dibangun (aplikasi turunan, mis. AWPOS) — jangan pakai sebagai panduan implementasi. Command/tabel/issue yang dulu dirujuk di skill ini (`legacy:preflight`, `awcms_legacy_migration_runs`, Issue 1.1/1.2) tidak ada di repo ini.
---

# AWCMS — Legacy Data Migration (DIDESKOP — bukan bagian base repo ini)

## Status: sengaja tidak dibangun di sini

Epic "Legacy Migration" (semula Epic 1, Issue 1.1–1.2) ada di backlog awal
38-issue AWCMS, tapi **ditutup `not planned`** di GitHub bersama 18
issue domain POS/retail lain (POS MVP, Warehouse Management, CRM Receipt
Delivery, Accounting & Coretax, dst.) — total 20 issue domain ditutup,
Legacy Migration sendiri 2 di antaranya — karena tidak sesuai konteks
AWCMS sebagai **contoh repo pengembangan umum** (generic base, bukan
aplikasi retail). Kontennya **dipindahkan ke aplikasi turunan contoh**
(mis. AWPOS), bukan dihapus historisnya — lihat memory proyek
`awpos-standard-refactor` untuk arah standar itu.

Sumber keputusan: `docs/awcms/06_github_issues_detail.md` §"Riwayat
perubahan backlog (2026-07-04)". Doc itu sekarang lompat langsung dari
`EPIC 0 — Repository Foundation` ke `EPIC 2 — Tenant, Identity, Profile`
— tidak ada lagi "EPIC 1" di daftar epic aktif, konsisten dengan status
`not planned`-nya.

## Yang TIDAK ada di repo ini — jangan diimplementasikan seolah "melengkapi yang belum selesai"

Semua berikut ini adalah sisa konten epic yang dideskop, **tidak pernah
dibangun**, dan bukan gap yang perlu diisi di base repo ini:

- Script/command `legacy:preflight` — **tidak ada** di `package.json`
  (`grep -n "legacy" package.json` kosong).
- Tabel `awcms_legacy_migration_runs` (atau mapping/row-count/
  validation-error/backfill-task terkait) — **tidak ada** satu pun
  migration di `sql/*.sql` yang membuatnya.
- Schema Postgres terpisah bernama `legacy`.
- GitHub Issue 1.1/1.2 (referensi lama "#4"/"#5" di repo ini) — kedua
  nomor itu **tidak resolve** ke issue apa pun di `ahliweb/awcms`
  (`gh issue view 4`/`gh issue view 5` → "could not resolve").
- Section "Legacy migration checklist" yang mungkin masih tersisa di
  `docs/awcms/07_sprint_testing_production_readiness.md` adalah sisa
  dokumentasi dari epic yang sama — jangan jadikan acuan implementasi
  tanpa memverifikasi ulang statusnya dulu.

Jangan menulis migration, script, endpoint, atau test baru berdasarkan
daftar di atas seakan itu backlog aktif yang tinggal dilengkapi — itu
bukan, dan tidak ada trace GitHub issue yang mendukungnya di repo ini.

## Kalau butuh migrasi data legacy sungguhan

Migrasi data legacy adalah **concern aplikasi turunan**, bukan base repo
generik ini. Base repo (`awcms`) menyediakan modul/pola reusable
(migration toolkit, sensitive-data masking, module scaffold, dst.) yang
bisa dipakai aplikasi turunan untuk membangun migrasi legacy-nya sendiri
sesuai domain masing-masing — misalnya AWPOS (retail/POS) menangani
migrasi data POS/retail legacy-nya sendiri di repo turunannya sendiri,
bukan di `awcms`.

Kalau kebutuhan itu muncul di sebuah aplikasi turunan:

1. Jangan salin isi lama skill ini sebagai starting point — kontennya
   (alur dry-run/backfill, nama tabel, command) tidak pernah
   diimplementasikan atau divalidasi terhadap kode nyata mana pun.
2. Desain ulang dari kebutuhan domain aplikasi turunan yang sebenarnya
   (mapping tabel/field sumber, strategi dry-run, verifikasi row count,
   dsb.), dibangun di atas pola umum base repo yang memang nyata ada:
   `awcms-new-migration` (schema/RLS), `awcms-sensitive-data`
   (normalize/hash/mask identifier), `awcms-testing` (strategi test
   berlapis).
3. Prinsip umum yang tetap berlaku di mana pun migrasi legacy dibangun:
   password/credential legacy tidak boleh diimpor ulang — user hasil
   migrasi harus melalui reset flow, hash lama tidak pernah dipakai
   langsung untuk login.

## Skill terkait

`awcms-new-migration` (schema toolkit umum), `awcms-sensitive-data`
(normalize/hash/mask identifier), `awcms-testing` (strategi test
berlapis).
