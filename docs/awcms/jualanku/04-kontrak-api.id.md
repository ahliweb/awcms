🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](04-kontrak-api.md)

<!-- i18n-source-hash: sha256:8d88dcce3cb7c74b5661fee509337046002e41591e379e0aa6bc9b873efe6168 -->

# 04 — Kontrak API Jualanku

> Rencana. Lihat [README](README.md) untuk status. Belum ada satu pun rute
> `/api/v1/jualanku/**` di repo ini.

## 1. Tiga namespace, satu implementasi aturan

```
Publik (dibaca siapa pun, tanpa sesi):
  /api/v1/jualanku/public/**

Portal self-service (hanya dipanggil BFF awcms-astro):
  /api/v1/jualanku/portal/merchant/**
  /api/v1/jualanku/portal/affiliate/**

Administrasi internal (hanya sesi internal ber-role):
  /api/v1/jualanku/admin/**

Sesi (milik identity_access, bukan Jualanku):
  /api/v1/auth/login, /logout, /me, dan endpoint introspeksi sesi baru
  (lihat 05-kontrak-sesi-dan-bff.md)
```

Ketiganya memanggil **application service yang sama**. Yang berbeda hanya:
autentikasi, otorisasi, permukaan input yang diterima, dan projection respons.
Aturan bisnis yang ditulis dua kali adalah cacat, terlepas dari apakah kedua
salinannya saat ini sepakat.

## 2. Inventaris endpoint (bentuk target)

### 2.1 Publik

| Method & path                                   | Modul            | Catatan                                                          |
| ----------------------------------------------- | ---------------- | ---------------------------------------------------------------- |
| `GET /public/merchants`                         | `directory`      | Keyset pagination; hanya `published`; tanpa data legal/rekening. |
| `GET /public/merchants/{slug}`                  | `directory`      | 404 untuk draft/ditahan — bukan 403.                             |
| `GET /public/categories`                        | `directory`      | Taksonomi publik.                                                |
| `GET /public/offerings` / `{slug}`              | `catalog_growth` | Tanpa checkout pada fase awal.                                   |
| `POST /public/interactions`                     | `catalog_growth` | **Idempotent** (`Idempotency-Key`), rate-limited, minim data.    |
| `GET /public/affiliate/track/{code}` (redirect) | `affiliate`      | Mencatat klik lalu redirect; target divalidasi allow-list.       |

Pencarian direktori memakai `site_search` yang sudah ada, bukan endpoint
pencarian baru.

### 2.2 Portal merchant

| Method & path                                      | Permission (`modul.activity.action`)                 | Idempotency |
| -------------------------------------------------- | ---------------------------------------------------- | ----------- |
| `GET /portal/merchant/profile`                     | `jualanku_directory.merchant.read`                   | —           |
| `PATCH /portal/merchant/profile`                   | `jualanku_directory.merchant.update`                 | ETag/versi  |
| `POST /portal/merchant/publish`                    | `jualanku_directory.merchant.publish`                | wajib       |
| `GET/POST/PATCH /portal/merchant/offerings`        | `jualanku_catalog_growth.offering.*`                 | ETag/versi  |
| `GET/POST /portal/merchant/promotions`             | `jualanku_catalog_growth.promotion.*`                | —           |
| `GET /portal/merchant/leads`                       | `jualanku_catalog_growth.lead.read`                  | —           |
| `GET /portal/merchant/analytics`                   | `jualanku_catalog_growth.analytics.read`             | —           |
| `GET /portal/merchant/members` / `POST` / `DELETE` | `jualanku_directory.merchant_membership.assign`      | —           |
| `GET /portal/merchant/subscription` `/invoices`    | `jualanku_commercial.subscription.read`              | —           |
| `POST /portal/merchant/verification`               | `jualanku_trust_operations.verification_case.create` | wajib       |

### 2.3 Portal affiliate

| Method & path                       | Permission                                  | Idempotency |
| ----------------------------------- | ------------------------------------------- | ----------- |
| `GET /portal/affiliate/summary`     | `jualanku_affiliate.affiliate.read`         | —           |
| `GET/POST /portal/affiliate/links`  | `jualanku_affiliate.link.*`                 | —           |
| `GET /portal/affiliate/conversions` | `jualanku_affiliate.conversion.read`        | —           |
| `GET /portal/affiliate/commissions` | `jualanku_commercial.commission.read`       | —           |
| `POST /portal/affiliate/payouts`    | `jualanku_commercial.payout_request.create` | **wajib**   |
| `GET /portal/affiliate/payouts`     | `jualanku_commercial.payout_request.read`   | —           |

Saldo yang ditampilkan adalah **saldo available dari ledger** (setelah holding
period, reversal, dan dispute), bukan total konversi.

### 2.4 Admin internal

| Kelompok                                        | Permission utama                                                 | Kontrol tambahan                        |
| ----------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------- |
| `/admin/merchants`, `/admin/verifications`      | `jualanku_directory.merchant.*`, `..._trust_operations.*`        | Step-up untuk aksi high-risk            |
| `/admin/catalog`, `/admin/moderation`           | `jualanku_catalog_growth.*`, `..._trust_operations.moderation.*` | Audit + alasan wajib                    |
| `/admin/affiliates`, `/admin/commissions`       | `jualanku_affiliate.*`, `jualanku_commercial.commission.*`       | Reversal ber-alasan                     |
| `/admin/payouts`                                | `jualanku_commercial.payout_request.approve`                     | **SoD**: pembuat ≠ penyetuju + workflow |
| `/admin/plans`, `/admin/subscriptions`          | `jualanku_commercial.plan.configure`                             | Perubahan harga ter-audit               |
| `/admin/reports`, `/admin/risk`, `/admin/audit` | `*.report.read`, `*.export`                                      | Ekspor PII = aksi high-risk             |

## 3. Kontrak minimum yang mengikat

| Kontrol        | Ketentuan                                                                                                                                                                                    |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenAPI        | Satu fragmen per modul di `openapi/modules/`, di-bundle deterministik (ADR-0026). Endpoint tanpa fragmen gagal `bun run api:spec:check`.                                                     |
| AsyncAPI       | Setiap domain event: nama, versi, producer, consumer, payload, klasifikasi PII, retry, dead-letter.                                                                                          |
| Envelope       | Sukses `{ data, meta }`, gagal `{ error: { code, message, correlationId } }` — memakai `_shared/api-response`.                                                                               |
| Error code     | Stabil dan ber-makna: `VALIDATION_FAILED`, `ACCESS_DENIED`, `MODULE_DISABLED`, `SOD_CONFLICT`, `IDEMPOTENCY_CONFLICT`, `NOT_FOUND`.                                                          |
| Pagination     | Keyset/cursor untuk seluruh koleksi besar, limit ber-batas. Cursor membawa `created_at` sebagai **teks presisi penuh** — presisi mikrodetik Postgres vs milidetik JS membuat baris terlewat. |
| Idempotency    | Wajib untuk payout, invoice, publish, import, dan ingest interaksi. Kunci disimpan, hasil pertama diulang.                                                                                   |
| Concurrency    | ETag/versi optimistic locking untuk profil, katalog, dan case moderasi.                                                                                                                      |
| Audit          | Actor, tenant, resource, action, outcome, correlation ID; payload sensitif direduksi.                                                                                                        |
| Rate limit     | Berbeda per audience: pencarian publik, ingest interaksi, login, upload, payout, admin.                                                                                                      |
| Header standar | Security header lewat middleware (bukan `astro.config`), `no-store` untuk portal/admin.                                                                                                      |

## 4. Domain event

| Event                                    | Producer           | Konsumen tipikal                               |
| ---------------------------------------- | ------------------ | ---------------------------------------------- |
| `jualanku.merchant.published`            | `directory`        | `site_search`, `seo_distribution`, cache purge |
| `jualanku.merchant.verification_decided` | `trust_operations` | `directory` (projection status), `email`       |
| `jualanku.offering.published`            | `catalog_growth`   | `site_search`, cache purge                     |
| `jualanku.interaction.recorded`          | `catalog_growth`   | reporting/read model merchant                  |
| `jualanku.conversion.recorded`           | `affiliate`        | `commercial` (accrual komisi)                  |
| `jualanku.conversion.reversed`           | `affiliate`        | `commercial` (reversal)                        |
| `jualanku.payout.decided`                | `commercial`       | `email`, reporting, audit                      |
| `jualanku.subscription.changed`          | `commercial`       | `directory` (entitlement halaman usaha)        |

Event adalah satu-satunya jalur "otomatis" antar konteks. Tidak ada konteks yang
menulis tabel konteks lain, termasuk lewat job.

## 5. Yang sengaja **tidak** dibuat pada fase awal

- Checkout marketplace, escrow, wallet, logistik, transaksi multi-merchant.
- Endpoint pencarian sendiri (pakai `site_search`).
- Sistem identitas kedua di portal (pakai `identity_access`).
- Endpoint publik yang menerima `merchantId` sebagai penentu kepemilikan.
- Webhook keluar ke pihak ketiga sebelum ada kontrak, retry policy, dan
  klasifikasi data yang disetujui.
