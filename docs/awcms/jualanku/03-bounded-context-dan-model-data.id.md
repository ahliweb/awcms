🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](03-bounded-context-dan-model-data.md)

<!-- i18n-source-hash: sha256:e7457b09408be574f57399d8e57b6b4aa3f44f0000ca406d360502ad8f76bec0 -->

# 03 — Bounded context, modul, dan model data

> Rencana. Lihat [README](README.md) untuk status. Tidak ada tabel di bawah ini
> yang sudah ada di `sql/`.

## 1. Lima konteks, bukan tujuh

| Module key                  | Memiliki                                                                                                                      | **Tidak** memiliki                                             |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `jualanku_directory`        | Merchant, membership, kategori usaha, lokasi, halaman usaha, publikasi, projection status verifikasi, hierarki scope merchant | Detail produk, pembayaran, ledger affiliate                    |
| `jualanku_catalog_growth`   | Produk/layanan, promosi, CTA, interaksi bermakna, lead, event sumber analytics                                                | Persetujuan komisi dan payout                                  |
| `jualanku_affiliate`        | Profil affiliate, referral link, atribusi, konversi, flag fraud                                                               | Invoice/langganan merchant                                     |
| `jualanku_commercial`       | Paket, entitlement, langganan, invoice, ledger komisi, permintaan payout                                                      | Settlement gateway (sebelum provider dipilih)                  |
| `jualanku_trust_operations` | Case verifikasi, moderasi, komplain, banding, assignment pendamping                                                           | Identitas/email/media/audit generik (sudah disediakan fondasi) |

Alasan tidak tujuh: batas modul mengikuti invariant, kepemilikan data, dan pola
perubahan — bukan struktur menu. Memecah lebih jauh dilakukan setelah coupling
terukur, bukan sebelum.

## 2. Draft `ModuleDescriptor`

Bentuk minimum yang dipakai setiap modul (nilai final ditetapkan saat scaffold;
`MODULE_CONTRACT_VERSION` repo saat dokumen ini ditulis adalah `2.4.0`):

```ts
export const jualankuDirectoryModule: ModuleDescriptor = {
  key: "jualanku_directory",
  name: "Jualanku Directory",
  version: "0.1.0",
  status: "experimental",
  type: "domain",
  description:
    "Merchant registry, membership, taxonomy, and public business pages.",
  dependencies: [
    "tenant_admin",
    "identity_access",
    "module_management",
    "logging"
  ],
  api: {
    openApiPath: "openapi/modules/jualanku-directory.openapi.yaml",
    basePath: "/api/v1/jualanku",
    routes: [
      "/api/v1/jualanku/public/merchants",
      "/api/v1/jualanku/portal/merchant",
      "/api/v1/jualanku/admin/merchants"
    ]
  },
  capabilities: {
    // Mengisi resolver hierarki scope untuk tipe `merchant` (ADR-0030) —
    // tanpa ini, aksi merchant high-risk deny karena `resolved: false`.
    provides: ["business_scope_hierarchy"]
  },
  permissions: [
    { activityCode: "merchant", action: "read", description: "..." },
    { activityCode: "merchant", action: "create", description: "..." },
    { activityCode: "merchant", action: "update", description: "..." },
    { activityCode: "merchant", action: "publish", description: "..." },
    {
      activityCode: "merchant_membership",
      action: "assign",
      description: "..."
    }
  ],
  searchSources: [/* baris terbit saja — lihat modul site_search */],
  dataLifecycle: [/* tabel bervolume tinggi + kelas retensi */]
};
```

Catatan yang menentukan lulus/tidaknya gate:

- `permissions` di descriptor **tidak** memberi permission ke tenant yang sudah
  ada. Setiap modul membawa **migrasi seed permission** sendiri, dan deploy ke
  tenant lama butuh backfill `awcms_role_permissions`.
- `routes` menyatakan kepemilikan rute (`bun run modules:routes:check`), dan
  hanya modul pemilik yang boleh menulis tabelnya
  (`bun run modules:table-writes:check`).
- Modul dengan `capabilities.provides` mengubah graf capability, bukan graf
  dependency — DAG tetap acyclic.
- Setiap modul domain baru butuh **ADR admission** sesuai
  [`../21_module_admission_governance.md`](../21_module_admission_governance.md).

## 3. Konvensi tabel

- Prefix `awcms_jualanku_<konteks>_<entitas>` (mis.
  `awcms_jualanku_directory_merchants`). Prefix panjang dipilih supaya
  kepemilikan modul terbaca dari nama tabel, sesuai kebiasaan repo ini.
- Kolom wajib: `id uuid`, `tenant_id uuid NOT NULL`, `created_at timestamptz`,
  `updated_at timestamptz`, dan `deleted_at timestamptz` untuk entitas yang
  di-soft-delete.
- **`FORCE` RLS pada semua tabel tenant-scoped**, kebijakan berbasis GUC tenant.
- FK lintas tabel tenant-scoped memakai **FK komposit** `(tenant_id, id)` —
  FK biasa melewati RLS dan menjadi jalur kebocoran lintas tenant. Tabel yang
  jadi target FK butuh `UNIQUE (tenant_id, id)`.
- Uang memakai `numeric`, bukan float. Waktu memakai `timestamptz`.
- Kolom kepemilikan merchant bernama `merchant_id` **di semua konteks**, agar
  predikat kepemilikan bisa ditinjau dengan satu grep.
- Kolom bervolume tinggi (klik, event interaksi, log) mendeklarasikan
  `dataLifecycle` dan menghormati legal hold.

Penomoran migrasi mengikuti nomor berikutnya yang tersedia saat modul ditulis —
**jangan** menuliskan nomor konkret di dokumen ini: rujukan ke berkas migrasi
yang belum ada digagalkan oleh `bun run check:docs`, dan migrasi yang sudah
terpasang bersifat immutable (koreksi lewat migrasi baru, bukan edit).

## 4. Entitas per konteks

### 4.1 `jualanku_directory`

| Tabel                       | Kolom kunci                                                                                                                                        | Catatan                                                           |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `..._merchants`             | `slug` (unik per tenant), `display_name`, `legal_name`, `category_id`, `status` (draft/published/suspended), `verification_status`, `published_at` | `legal_name` bukan data publik.                                   |
| `..._merchant_members`      | `merchant_id`, `identity_id`, `member_role` (owner/editor/analyst), `valid_from`, `valid_until`, `status`                                          | Sumber grant scope; unik `(tenant_id, merchant_id, identity_id)`. |
| `..._categories`            | `parent_id`, `slug`, `name`, `position`                                                                                                            | Taksonomi bersama lintas merchant.                                |
| `..._merchant_locations`    | `merchant_id`, `province`, `city`, `district`, `geo_point`                                                                                         | Alamat presisi tinggi = data terbatas, bukan publik.              |
| `..._merchant_pages`        | `merchant_id`, `sections jsonb`, `status`, `published_revision_id`                                                                                 | Blok konten memakai kosakata blok `blog_content`, bukan HTML.     |
| `..._merchant_publications` | `merchant_id`, `action` (publish/unpublish), `actor`, `occurred_at`                                                                                | Append-only; jejak publikasi.                                     |

Projection publik = baris `status = 'published'` **dan** tidak sedang ditahan
moderasi. Tidak ada query bebas ke tabel draft dari namespace publik.

### 4.2 `jualanku_catalog_growth`

| Tabel                | Kolom kunci                                                                                                        | Catatan                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| `..._offerings`      | `merchant_id`, `kind` (product/service), `slug`, `name`, `price_amount numeric`, `price_currency`, `status`        | Harga dari system of record, bukan teks halaman.          |
| `..._offering_media` | `offering_id`, `media_object_id`                                                                                   | FK ke registry `media_library`; tidak ada URL bebas.      |
| `..._promotions`     | `merchant_id`, `offering_id?`, `starts_at`, `ends_at`, `terms`                                                     | Klaim promosi masuk review konten.                        |
| `..._leads`          | `merchant_id`, `channel`, `contact_hash`, `contact_masked`, `status`, `occurred_at`                                | PII kontak di-hash + masked, tidak pernah mentah di list. |
| `..._interactions`   | `merchant_id`, `interaction_type` (whatsapp_click/call/direction/link), `idempotency_key`, `occurred_at`, `source` | Ingest publik; unik pada `idempotency_key`.               |

`..._interactions` adalah satu-satunya tabel yang menerima tulisan dari
permukaan publik. Karena itu ia: privacy-minimized (tanpa fingerprint),
idempotent, ber-rate-limit sendiri, dan tidak pernah menjadi sumber otorisasi.

### 4.3 `jualanku_affiliate`

| Tabel             | Kolom kunci                                                                                                                   | Catatan                                                |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `..._affiliates`  | `identity_id`, `status` (pending/approved/suspended), `payout_profile_id`                                                     | Approval affiliate adalah aksi high-risk.              |
| `..._links`       | `affiliate_id`, `code` (unik per tenant), `target_type`, `target_id`                                                          | Kode tidak boleh bisa ditebak berurutan.               |
| `..._clicks`      | `link_id`, `occurred_at`, `source_hash`                                                                                       | Bervolume tinggi → `dataLifecycle` + rollup.           |
| `..._conversions` | `link_id`, `merchant_id`, `subject_type`, `subject_id`, `status` (pending/held/approved/rejected/reversed), `idempotency_key` | Transisi status append-only di tabel event.            |
| `..._fraud_flags` | `conversion_id`, `flag_type` (self_referral/velocity/duplicate_instrument), `raised_by`, `resolved_at`                        | Self-referral adalah aturan, bukan heuristik opsional. |

### 4.4 `jualanku_commercial`

| Tabel                     | Kolom kunci                                                                                        | Catatan                                                            |
| ------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `..._plans`               | `code`, `name`, `price_amount`, `billing_period`, `status`                                         | Perubahan paket = `configure`, ter-audit.                          |
| `..._plan_entitlements`   | `plan_id`, `entitlement_key`, `limit_value`                                                        | Entitlement dievaluasi di service, bukan di UI.                    |
| `..._subscriptions`       | `merchant_id`, `plan_id`, `status`, `current_period_start/end`, `cancel_at`                        | —                                                                  |
| `..._invoices` / `_lines` | `merchant_id`, `number` (unik per tenant), `status`, `total_amount`                                | Nomor invoice tidak pernah dipakai ulang.                          |
| `..._commission_entries`  | `affiliate_id`, `conversion_id`, `entry_type` (accrual/reversal/adjustment), `amount`, `posted_at` | **Append-only**; koreksi = entri baru, bukan UPDATE.               |
| `..._payout_requests`     | `affiliate_id`, `amount`, `status`, `requested_by`, `idempotency_key`                              | Saldo _available_ dihitung dari ledger, bukan dari total konversi. |
| `..._payout_decisions`    | `payout_request_id`, `decision` (approve/reject), `decided_by`, `decided_at`, `reason`             | Pembuat ≠ penyetuju (SoD + workflow).                              |

Aturan yang tidak bisa dilonggarkan: **provider eksternal tidak pernah dipanggil
di dalam transaksi basis data**. Pemanggilan gateway/pajak/notifikasi lewat
outbox + idempotency key.

### 4.5 `jualanku_trust_operations`

| Tabel                        | Kolom kunci                                                                            | Catatan                                                |
| ---------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `..._verification_cases`     | `merchant_id`, `case_type`, `status`, `assigned_to`, `sla_due_at`                      | Merchant tidak bisa menyetujui dirinya sendiri.        |
| `..._verification_evidence`  | `case_id`, `media_object_id`, `evidence_type`, `masked_summary`                        | Bukti sensitif dimasking di response; akses ter-audit. |
| `..._moderation_cases`       | `subject_type`, `subject_id`, `reason`, `status`, `decided_by`                         | Menahan publikasi tanpa menghapus data.                |
| `..._complaints`             | `reporter_hash`, `subject_type`, `subject_id`, `status`, `resolution`                  | Kanal pengaduan wajib ada sebelum go-live (UU 8/1999). |
| `..._appeals`                | `case_id`, `submitted_by`, `status`, `decided_by`                                      | Banding diputus orang berbeda dari pemutus awal.       |
| `..._onboarding_assignments` | `merchant_id`, `agent_identity_id`, `valid_from`, `valid_until`, `consent_recorded_at` | Sumber grant scope bertenggat untuk pendamping.        |

## 5. Kepemilikan tabel & komunikasi lintas modul

- Satu tabel = satu modul penulis. Modul lain membaca lewat **application
  service**, **capability port**, **read model**, atau **domain event** — tidak
  pernah lewat join langsung ke tabel milik orang lain.
- Arah dependency: `commercial` dan `affiliate` **tidak** boleh bergantung pada
  `catalog_growth`; keterkaitannya lewat event (`conversion.recorded`,
  `subscription.activated`) dan read model.
- `directory` menyediakan hierarki scope merchant yang dikonsumsi seluruh modul
  Jualanku lain — itulah satu-satunya capability yang mereka bagi.
- Event domain memakai runtime outbox yang sudah ada (`domain_event_runtime`)
  dan dideklarasikan di AsyncAPI, lengkap dengan klasifikasi PII, retry, dan
  dead-letter.

## 6. Data pribadi & retensi

| Kelas data                                | Perlakuan                                                                                                      |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Nomor rekening, NIK, NPWP, telepon, email | Simpan ter-normalisasi + hash untuk lookup; tampilkan **masked** sesuai purpose; tidak pernah di list default. |
| Bukti verifikasi (dokumen/gambar)         | `media_library` + akses ter-audit + masking ringkasan; tidak pernah URL publik.                                |
| Klik/interaksi/analytics                  | Privacy-minimized, tanpa fingerprint, agregasi cepat, retensi pendek lewat `dataLifecycle`.                    |
| Ledger komisi, invoice, payout            | Retensi panjang (kewajiban pembukuan), append-only, tunduk legal hold.                                         |
| Komplain & bukti pengaduan                | Retensi terbatas + legal hold saat sengketa.                                                                   |

Alur permintaan hak subjek data (akses/koreksi/penghapusan/keberatan) memakai
mekanisme `data_lifecycle` yang sudah ada; data yang wajib dipertahankan dibatasi
dan alasannya dijelaskan ke pemohon.
