# Rencana Pilot Aplikasi Turunan Pertama

> **⚠️ DEPRECATED ([ADR-0034](../adr/0034-awcms-family-direct-use-templates-and-derived-pathway-removal.md)).** Model aplikasi-turunan di repo terpisah DICABUT — keluarga AWCMS (`awcms-mini`/`awcms`/`awcms-micro`) kini template **dipakai-langsung**, tanpa membuat repo derivatif (kembangkan modul langsung di template). Dokumen ini dipertahankan sebagai catatan historis.

Issue #465. Base AWCMS sudah stabil (v0.23.5, 18 issue backlog doc06 +
epic M9 pasca-backlog tuntas) dan `derived-application-guide.md` sudah
menjelaskan cara membangun aplikasi turunan di atasnya. Dokumen ini
memilih **satu pilot nyata pertama** untuk memvalidasi pola tersebut
lewat use case sungguhan, tanpa mencampur domain bisnis apa pun ke base.

> **Dokumen ini tidak mengubah kode.** Tidak ada modul domain yang
> ditambahkan ke `src/modules/` base ini, tidak ada migration/OpenAPI/
> AsyncAPI base yang diubah, dan dokumen ini **tidak** mengeksekusi
> perubahan apa pun di repo turunan yang direkomendasikan — hanya
> merencanakan dan merekomendasikan langkah berikutnya.

## Matriks kandidat

Lima kandidat dari `derived-application-guide.md` §Contoh aplikasi
turunan, dinilai pada skala 1 (rendah) - 5 (tinggi) untuk tiap kriteria
(skor lebih tinggi = lebih cocok jadi pilot pertama, kecuali kolom risiko
yang sebaliknya — risiko lebih rendah lebih baik untuk pilot pertama):

| Kandidat                              | Kebutuhan bisnis | Risiko keamanan/privacy (lebih rendah lebih baik)                    | Kompleksitas data                   | Nilai validasi platform | Kesiapan implementasi                                  | Relevansi AhliWeb/AWCMS                     |
| ------------------------------------- | ---------------- | -------------------------------------------------------------------- | ----------------------------------- | ----------------------- | ------------------------------------------------------ | ------------------------------------------- |
| **AWPOS** (retail/POS)                | 5                | 2 (data transaksi/pembayaran, bukan data kesehatan/pribadi sensitif) | 4 (katalog, stok, transaksi, pajak) | 5                       | **5 — repo + 38 issue doc06 + GitHub setup sudah ada** | 5 — sumber standar dokumen base ini sendiri |
| Satu Sehat Kobar (internal kesehatan) | 3                | 5 (data rekam kesehatan — regulasi tinggi)                           | 4                                   | 3                       | 1 (belum ada planning/repo)                            | 3                                           |
| Sistem Manajemen Mutu Faskes          | 3                | 3 (data insiden/audit, bukan rekam medis langsung)                   | 3                                   | 3                       | 1 (belum ada planning/repo)                            | 3                                           |
| Smart School Portal                   | 3                | 4 (data siswa di bawah umur, nilai)                                  | 3                                   | 3                       | 1 (belum ada planning/repo)                            | 2                                           |
| Sistem Pengaduan Publik               | 3                | 4 (data pelapor, bisa sensitif secara politik/hukum)                 | 2                                   | 3                       | 1 (belum ada planning/repo)                            | 2                                           |

Kriteria "Kesiapan implementasi" adalah pembeda paling tajam: keempat
kandidat selain AWPOS masih murni ilustratif (nama modul di
`derived-application-guide.md` adalah contoh, belum ada planning/repo
nyata apa pun). AWPOS sebaliknya sudah:

- Repo GitHub nyata: [`ahliweb/awpos`](https://github.com/ahliweb/awpos),
  dengan `AGENTS.md`, `SECURITY.md`, `CHANGELOG.md`, dan paket dokumen
  `docs/awpos/01`-`19` — struktur dokumen **yang sama persis** dengan
  `docs/awcms/01`-`19` di repo ini.
- **38 issue GitHub sudah dibuat** (`Issue 0.1` s.d. `Issue 12.2`, milestone
  M0-M8), seluruhnya `OPEN` (implementasi belum dimulai — repo AWPOS masih
  docs-only per `AGENTS.md`-nya: "Belum ada kode aplikasi. Implementasi
  dimulai dari Issue 0.1").
- Label/milestone/security setup (Dependabot, CodeQL, dsb.) sudah
  dikonfigurasi — pola yang identik dengan yang diterapkan di repo ini.

## Fakta kunci: paket dokumen AWPOS adalah sumber asal base ini

Ini bukan kebetulan — `docs/awcms/AUDIT_STANDAR_PENGEMBANGAN_2026-07-04.md`
mencatat bahwa AWCMS direfaktor total pada 2026-07-04 mengikuti paket
dokumen AWPOS sebagai **sumber kebenaran standar**, mengekstrak 18 dari 38
issue doc06 AWPOS yang bersifat generik (foundation, tenant/identity,
sync, reporting, logging/security, setup wizard) menjadi base modular
monolith ini, sementara 20 issue sisanya (domain retail/POS spesifik)
ditutup `not planned` di repo base ini dengan catatan "dipindahkan ke
aplikasi turunan contoh (mis. AWPOS)".

Konsekuensi praktis: **18 dari 38 issue di repo `ahliweb/awpos` sekarang
sudah selesai secara generik** — bukan dengan mengimplementasikannya
ulang di AWPOS, tetapi dengan menjadikan AWCMS sebagai base/dependency
AWPOS. Pemetaan langsung (nomor issue AWPOS, judul identik dengan issue
yang sudah `completed` di base ini):

| Issue AWPOS (\#, judul)                  | Status di base AWCMS                                                                                                          |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| #1 Issue 0.1, #2 Issue 0.2, #3 Issue 0.3 | Foundation skeleton, migration runner, OpenAPI/AsyncAPI baseline — sudah ada sebagai base ini sendiri                         |
| #6-#9 Issue 2.1-2.4                      | Tenant/office, central profile, identity login, RBAC/ABAC — `src/modules/tenant-admin`, `profile-identity`, `identity-access` |
| #21-#23 Issue 6.1-6.3                    | Sync outbox/inbox, conflict tracking, R2 object sync queue — `src/modules/sync-storage`                                       |
| #28 Issue 8.1, #31 Issue 9.1             | Admin layout shell, management reporting views — `src/modules/reporting` + admin shell                                        |
| #33-#35 Issue 10.1-10.3                  | Structured logging/audit, connection pooling, security readiness — `src/modules/logging` + `scripts/`                         |
| #36 Issue 11.1                           | Workflow approval engine — `src/modules/workflow-approval`                                                                    |
| #37-#38 Issue 12.1-12.2                  | Setup wizard, offline/LAN deployment profile — `tenant-admin` + `deployment-profiles.md`                                      |

**Sisa 20 issue AWPOS yang benar-benar domain-specific** (belum ada
padanan di base, dan memang seharusnya tidak ada — ini murni domain
retail/POS): #4-#5 (1.1-1.2 legacy migration data lama), #10-#13 (3.1-3.4
katalog/stok/checkout/transaksi POS), #14-#17 (4.1-4.4 warehouse), #18-#20
(5.1-5.3 receipt PDF/WhatsApp/email), #24-#27 (7.1-7.4 tax profile/VAT/Coretax),
#29-#30 (8.2-8.3 UI kasir + portal customer), #32 (9.2 AI business
analyst).

Ini berarti pilot AWPOS **tidak mulai dari nol** — kerja nyata yang tersisa
adalah 20 issue domain-specific di atas, dikerjakan di atas AWCMS
sebagai base/dependency, bukan 38 issue dari awal.

## Rekomendasi

**AWPOS direkomendasikan sebagai pilot aplikasi turunan pertama.** Alasan:

1. Risiko keamanan/privasi paling rendah di antara lima kandidat (data
   transaksi retail, bukan data kesehatan/anak-anak/pengaduan yang secara
   regulasi lebih sensitif) — cocok untuk pilot pertama yang memvalidasi
   pola, bukan produksi berisiko tinggi.
2. Kesiapan implementasi jauh di atas kandidat lain: repo, docs 01-19,
   38 issue, milestone, dan security setup GitHub sudah ada — tidak perlu
   planning dari nol.
3. Relevansi tertinggi: AWPOS adalah sumber dokumen standar base ini
   sendiri, sehingga memvalidasi AWPOS otomatis memvalidasi bahwa base
   ini benar-benar general-purpose (tidak diam-diam masih berasumsi
   domain POS di baliknya).
4. Scope kerja nyata sudah terpangkas ke 20 issue domain-specific (lihat
   di atas), bukan 38 — pilot bisa mulai dari slice kecil dan cepat
   menunjukkan validasi nyata.

## Outline PRD/SRS

PRD/SRS lengkap **sudah ada** di
`/home/data/dev_bun/awpos/docs/awpos/02_prd_detail_per_modul.md` (PRD) dan
`03_srs_detail_per_modul.md` (SRS) — dokumen ini tidak menduplikasinya,
hanya meringkas untuk konteks keputusan pilot:

- **Persona**: Owner, Admin, Kasir, Petugas Gudang, Tax Officer, CRM
  Staff, Business Analyst, Customer, Admin Teknis.
- **Modul PRD**: Tenant Admin (sudah tercakup base), Catalog, Inventory/
  Warehouse, POS/Checkout, CRM/Receipt, Tax/Coretax, Reporting/AI (view
  tambahan di atas base), Sync (sudah tercakup base), Observability/
  Deployment (sudah tercakup base).
- Tindak lanjut yang direkomendasikan untuk repo AWPOS: tinjau ulang doc
  02/03 pada modul yang **sudah** tercakup base (Tenant Admin, Sync,
  Observability) untuk memastikan deskripsinya tetap konsisten dengan
  implementasi base ini, bukan diimplementasikan ulang.

## Modul domain & boundary base vs turunan

| Tetap di base (AWCMS — jangan diubah)                                                 | Modul domain baru AWPOS (repo turunan)                                               |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Identity/tenant/RBAC/ABAC/RLS (`identity-access`, `profile-identity`, `tenant-admin`) | `catalog` — produk, kategori, harga                                                  |
| Sync outbox/inbox/conflict/object queue (`sync-storage`)                              | `inventory` — stok, lot/batch/serial, warehouse, transfer, cycle count               |
| Audit/logging/pooling/security readiness (`logging`, `scripts/`)                      | `pos-checkout` — cart, checkout session, idempotent transaction posting              |
| Workflow approval engine (`workflow-approval`)                                        | `crm-receipt` — PDF receipt, WhatsApp (StarSender), email (Mailketing) delivery      |
| Reporting base + admin shell (`reporting`)                                            | `tax-coretax` — tax profile, VAT invoice staging, Coretax XML batch export           |
| Setup wizard, deployment profiles                                                     | `reporting-ai` — view tambahan spesifik retail, AI business analyst safe views/tools |
| —                                                                                     | UI: Cashier POS fullscreen, Customer receipt portal (di atas admin shell base)       |

Prinsip sama seperti `derived-application-guide.md` §Base reusable vs
domain-specific: kolom kiri dipakai ulang tanpa diubah; kolom kanan adalah
modul baru yang mengikuti pola RLS/ABAC/audit/idempotency base yang sudah
ada (lihat juga
[`examples/minimal-domain-module.md`](examples/minimal-domain-module.md)
untuk contoh konkret pola satu modul domain).

## Daftar issue atomic awal (repo turunan AWPOS)

Rekomendasi konkret untuk pemeliharaan `ahliweb/awpos` (bukan dieksekusi
oleh issue #465 ini):

1. **Tutup 18 issue yang sudah tercakup base** (#1-#3, #6-#9, #21-#23,
   #28, #31, #33-#36, #37-#38) dengan reason `not planned`/`duplicate`,
   catatan mengarah ke modul base yang setara — simetris dengan bagaimana
   base ini menutup 20 issue domain-specific-nya sendiri dan mengarah balik
   ke AWPOS.
2. **Tambahkan AWCMS sebagai base/dependency** AWPOS (fork, git
   subtree, atau restart repo dari base ini — keputusan teknis di luar
   scope dokumen ini, didiskusikan terpisah oleh pemilik repo AWPOS).
3. **Mulai dari slice pertama yang tervalidasi cepat**, urutan
   dependency-respecting dari 20 issue domain-specific:
   - #4-#5 (1.1-1.2) — legacy migration toolkit khusus retail (bila ada
     data lama yang perlu diimpor; lewati bila tidak ada).
   - #10-#13 (3.1-3.4) — **POS MVP**: katalog produk, stok, checkout,
     posting transaksi idempotent. Ini slice tervalidasi tercepat: modul
     domain pertama end-to-end (migration+RLS, ABAC, endpoint, UI dasar)
     di atas base yang sudah ada.
   - #14-#17 (4.1-4.4) — warehouse (zona/bin, lot/batch/serial, transfer,
     cycle count) setelah POS MVP stabil.
   - #18-#20 (5.1-5.3) — receipt PDF/WhatsApp/email, memakai sync
     outbox base yang sudah ada untuk pengiriman async.
   - #24-#27 (7.1-7.4) — tax/Coretax readiness.
   - #29-#30 (8.2-8.3) — UI kasir fullscreen, portal customer.
   - #32 (9.2) — AI business analyst safe views/tools.
4. Setiap issue tetap mengikuti alur 9 langkah
   `derived-application-guide.md` (migration+RLS → seed ABAC → endpoint+
   OpenAPI/event+AsyncAPI → UI → audit → test berlapis → deployment).

## Checklist keamanan, testing, deployment, handover

Turunan dari `derived-application-guide.md` §Checklist keamanan &
kepatuhan praktis, ditambah butir spesifik AWPOS:

**Keamanan**

- [ ] Tenant context/RLS FORCE untuk seluruh tabel domain baru (katalog,
      stok, transaksi, tax profile, dst).
- [ ] ABAC default-deny untuk permission baru per modul domain.
- [ ] Idempotency-Key wajib untuk posting transaksi (3.4) dan Coretax
      export (7.4) — keduanya mutation high-risk yang harus aman diulang.
- [ ] Redaksi data sensitif: nomor kartu/metode pembayaran, NPWP/NIK pada
      tax profile, nomor kontak pelanggan pada CRM/receipt.
- [ ] Payment/tax data diaudit via `recordAuditEvent` (transaksi posted/
      cancel/return, tax export, price change).

**Testing**

- [ ] Unit untuk domain logic murni (perhitungan stok, tax, harga).
- [ ] Integration terhadap PostgreSQL nyata untuk tiap endpoint domain
      baru (bukan mock) — pola sama seperti test integrasi base ini.
- [ ] Kontrak: `api:spec:check` untuk OpenAPI/AsyncAPI AWPOS sendiri.
- [ ] Keamanan: uji RLS FORCE dan ABAC default-deny gagal-dengan-benar
      (bukan hanya path bahagia).

**Deployment**

- [ ] Pilih profil deployment (`deployment-profiles.md`): LAN-first
      (`docker-compose.yml`) untuk operator retail single-outlet/offline,
      atau registry-based (`Dockerfile.production` + panduan
      [`deploy-coolify.md`](deploy-coolify.md)) untuk deployment online
      multi-outlet.
- [ ] `bun run production:preflight` hijau sebelum go-live tiap
      environment.

**Handover**

- [ ] Dokumentasi operator (SOP kasir, SOP gudang, SOP tax export) —
      pola `08_sop_operasional_user_guide.md` AWPOS sudah ada, tinjau
      ulang setelah implementasi nyata untuk memastikan tetap akurat.
- [ ] Backup/restore drill dijalankan minimal sekali sebelum go-live
      (lihat `deploy/backup/README.md` base).
- [ ] Kontak/pemilik teknis AWPOS pasca-pilot ditentukan eksplisit
      sebelum dianggap selesai sebagai validasi platform.

## Lihat juga

- [`derived-application-guide.md`](derived-application-guide.md) — alur 9
  langkah, tabel base-reusable vs domain-specific, lima contoh ilustratif.
- [`examples/minimal-domain-module.md`](examples/minimal-domain-module.md)
  — contoh konkret satu modul domain minimal.
- [`deploy-coolify.md`](deploy-coolify.md) — panduan deployment registry-
  based bila AWPOS memilih topologi online/multi-outlet.
- [`AUDIT_STANDAR_PENGEMBANGAN_2026-07-04.md`](AUDIT_STANDAR_PENGEMBANGAN_2026-07-04.md)
  — catatan asal-usul ekstraksi 18 issue generik dari 38 issue AWPOS
  menjadi base ini.
- Repo [`ahliweb/awpos`](https://github.com/ahliweb/awpos) — docs 01-19,
  38 issue GitHub, milestone M0-M8 (state per 2026-07-06; tinjau ulang
  state live sebelum eksekusi karena bisa berubah).
