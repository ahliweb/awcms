🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](02-model-tenant-merchant-otorisasi.md)

<!-- i18n-source-hash: sha256:096689fbf7d72a655bc8c04b1d12219fef05f8adfa6af69f6a7b4774691f59d9 -->

# 02 — Tenant, merchant, role, dan otorisasi

> Rencana. Lihat [README](README.md) untuk status.

Dokumen ini adalah tulang punggung keamanan porting Jualanku. Satu kalimat yang
harus dipegang: **RLS memisahkan tenant, bukan merchant.** Semua yang lain di
bawah ada karena kalimat itu.

## 1. Model tenant pilot

Satu tenant penyelenggara (`JUALANKU_MAIN`). Merchant, membership, affiliate,
katalog, dan aktivitas adalah **entitas domain di dalam tenant itu** — bukan
tenant sendiri. Konsekuensinya:

- Direktori lintas merchant, taksonomi bersama, antrean moderasi, dan reporting
  platform tetap query biasa dalam satu tenant.
- Isolasi antar merchant **tidak gratis** dan harus dibangun (bagian 2–4).
- Model multi-penyelenggara/white-label tetap terbuka di kemudian hari justru
  karena isolasi merchant tidak menumpang batas tenant.

## 2. Enam lapis isolasi

| Lapis      | Memisahkan                | Kontrol                                                                                       | Gagal-nya seperti apa                               |
| ---------- | ------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Tenant     | Penyelenggara/white-label | PostgreSQL `FORCE` RLS + tenant context dari server                                           | Kebocoran lintas penyelenggara                      |
| Merchant   | Usaha dalam satu tenant   | Merchant sebagai **business scope** + grant membership + predikat kepemilikan di setiap query | Merchant A membaca/menulis data merchant B          |
| Role       | Jenis tindakan            | RBAC permission ter-seed migrasi + `configure`/`approve` terpisah dari `read`                 | Editor mengubah rekening bank                       |
| Workflow   | Maker/checker/approver    | `workflow_approval` + `sodRules` (ADR-0031)                                                   | Pembuat payout menyetujui payout-nya sendiri        |
| Field data | PII & keuangan            | Projection per-purpose + masking (`_shared` masking identifier)                               | NIK/rekening bocor lewat endpoint yang "hanya" list |
| Permukaan  | Publik/portal/internal    | Namespace rute, audience sesi, `noindex`, cache policy, security header                       | Halaman privat masuk sitemap atau cache publik      |

## 3. Merchant sebagai business scope

Repo ini sudah punya lapisan otorisasi berbasis scope (ADR-0030) dengan port
`src/modules/_shared/ports/business-scope-hierarchy-port.ts`. Implementasi base-nya
mengembalikan `resolved: false` untuk **setiap** tipe scope, dan pemanggil wajib
**default-deny untuk aksi high-risk** saat `resolved: false`. Artinya: selama
tidak ada modul yang menyediakan hierarki, aksi merchant high-risk gagal tertutup
— aman, tapi juga tidak berfungsi.

Rancangannya:

- `jualanku_directory` **menyediakan** capability hierarki scope untuk tipe
  `merchant`. Satu merchant = satu scope; grup/jaringan usaha di masa depan
  menjadi scope induk tanpa mengubah pemanggil mana pun.
- **Membership merchant = grant scope**, dengan effective dating (`valid_from`,
  `valid_until`). Pencabutan berlaku seketika karena evaluasi memakai `now`
  server, bukan kolom boolean yang harus diingat seseorang untuk di-set.
- **Assisted onboarding ("Pasukan Semut") = grant scope bertenggat** ke satu
  merchant. Pendamping tidak pernah mendapat role global.
- Policy ABAC merujuk `resource.businessScopeId` — atribut yang **sudah ada** di
  allow-list. Tidak ada atribut baru yang ditambahkan untuk Jualanku
  (lihat [08](08-koreksi-dokumen-validasi.md) §3).

**Dua sabuk pengaman, bukan satu.** ABAC adalah lapis kebijakan; lapis kedua
adalah **predikat kepemilikan di query**. Setiap SELECT/UPDATE/DELETE
merchant-scoped membawa `merchant_id IN (<scope grant terselesaikan>)`. Kalau
suatu hari policy salah tulis, query tetap tidak mengembalikan baris milik orang
lain.

## 4. Katalog role

Role code di bawah adalah role tenant `awcms` biasa; permission-nya diseed lewat
migrasi (descriptor modul saja **tidak** memberi permission ke tenant yang sudah
ada).

| Persona               | Role code           | Batas utama                                                              |
| --------------------- | ------------------- | ------------------------------------------------------------------------ |
| Owner SaaS            | `platform_owner`    | Governance & break-glass; bukan role harian, setiap pemakaian ter-audit. |
| Admin platform        | `platform_admin`    | Konfigurasi operasional; **tidak** menyetujui payout.                    |
| Verifier merchant     | `merchant_verifier` | Menilai bukti; tidak menyentuh payout maupun katalog.                    |
| Moderator konten      | `content_moderator` | Moderasi listing, ulasan, komplain.                                      |
| Customer success      | `customer_success`  | Onboarding & support; akses data sensitif dibatasi purpose.              |
| Finance maker         | `finance_operator`  | Menyiapkan payout/invoice.                                               |
| Finance checker       | `finance_approver`  | Menyetujui payout; **tidak boleh** pembuatnya (SoD).                     |
| Risk/compliance       | `risk_compliance`   | Legal hold, audit, kebijakan, review fraud.                              |
| Merchant owner        | `merchant_owner`    | Mengelola merchant miliknya + membership.                                |
| Merchant editor       | `merchant_editor`   | Konten/katalog; **tanpa** rekening, identitas legal, paket, atau role.   |
| Merchant analyst      | `merchant_analyst`  | Analytics read-only merchant miliknya.                                   |
| Affiliate             | `affiliate_member`  | Tautan, konversi, dan payout miliknya sendiri.                           |
| Pendamping onboarding | `onboarding_agent`  | Hanya merchant yang di-assign, selama masa berlaku assignment.           |

Tiga role terakhir plus `merchant_*` **tidak pernah** mendapat permission modul
internal apa pun, dan tidak punya entri navigasi ke `/admin/**`.

## 5. Bentuk permission

Kunci permission di repo ini adalah `${moduleKey}.${activityCode}.${action}`, dan
`action` harus salah satu nilai `AccessAction` yang **sudah ada**
(`src/modules/identity-access/domain/access-control.ts`). Tidak ada `submit`,
tidak ada `payout`, tidak ada `verify` — memakai action yang tidak ada di union
menghasilkan permission yang tidak pernah ter-seed dan deny senyap terhadap
pemilik sekalipun.

Pemetaan yang dipakai:

| Maksud bisnis                         | Action yang dipakai | Alasan                                                                  |
| ------------------------------------- | ------------------- | ----------------------------------------------------------------------- |
| Melihat data                          | `read`              | —                                                                       |
| Membuat/menyunting entitas            | `create` / `update` | —                                                                       |
| Mengajukan (submit) verifikasi/payout | `create`            | Pengajuan = membuat case/request, bukan action baru.                    |
| Menyetujui verifikasi/payout/moderasi | `approve`           | High-risk; pasangan SoD-nya `create`.                                   |
| Menolak                               | `reject`            | Ada di union; non-high-risk — keputusan negatif tidak memindahkan uang. |
| Menerbitkan halaman usaha             | `publish`           | Sudah dipakai lifecycle konten repo ini.                                |
| Menonaktifkan merchant/affiliate      | `disable`           | —                                                                       |
| Memulihkan yang di-soft-delete        | `restore`           | —                                                                       |
| Mengubah kebijakan/komisi/paket       | `configure`         | Bukan `update` — authoring kebijakan adalah kelas sendiri.              |
| Menugaskan pendamping/role            | `assign`            | —                                                                       |
| Ekspor laporan                        | `export`            | Menghasilkan artefak; high-risk untuk data PII/keuangan.                |

Seluruh action di tabel itu sudah ada di union saat dokumen ini ditulis
(`read`, `create`, `update`, `approve`, `reject`, `publish`, `disable`,
`restore`, `configure`, `assign`, `export`). Menambah nilai union baru butuh ADR
tersendiri — dan permission yang memakai action tak-ter-seed akan men-_deny_
bahkan pemilik tenant, hijau di CI karena tidak ada yang mengujinya.

## 6. Aturan ABAC wajib

Ditulis dengan atribut yang ada di allow-list (`subject.roles`,
`subject.tenantUserId`, `resource.businessScopeId`, `resource.ownerTenantUserId`,
`resource.status`, `resource.resourceType`, `resource.amount`, `action`,
`env.now`, `env.ipTrusted`).

1. **Kepemilikan merchant.** Akses resource bertipe merchant hanya diizinkan bila
   `resource.businessScopeId` termasuk grant scope subjek yang aktif pada
   `env.now`. `resolved: false` dari resolver hierarki = **deny** untuk aksi
   high-risk.
2. **Editor bukan pemilik.** `merchant_editor` ditolak pada resource bertipe
   rekening bank, identitas legal, kepemilikan, langganan, dan penugasan role —
   deny eksplisit, karena deny menang atas allow.
3. **Approver bukan pembuat.** `finance_approver` ditolak menyetujui payout yang
   `resource.ownerTenantUserId == subject.tenantUserId`. Ini deny ABAC **dan**
   `sodRules`; dua-duanya, karena satu-satunya adalah satu titik kegagalan.
4. **Pendamping hanya assignment aktif.** Sama seperti (1), dengan grant
   bertenggat; kedaluwarsa berlaku pada `env.now`, tanpa job pembersih.
5. **Affiliate tidak boleh self-referral.** Konversi yang identitas/instrumen
   pembayaran/merchant-nya terklasifikasi self-referral ditolak untuk atribusi
   dan payout.
6. **Break-glass ber-jejak.** `platform_owner` boleh melewati batas tertentu
   hanya lewat jalur break-glass yang sudah ada, selalu ter-audit, dan
   `env.ipTrusted` diperhitungkan.
7. **Atribut resource selalu dari baris nyata.** Endpoint membaca resource lebih
   dulu, lalu menyusun `resourceAttributes`. `merchantId` di body adalah input
   yang divalidasi, bukan klaim yang dipercaya.

## 7. Matriks negative-authorization test

Test ini ditulis **sebelum** implementasi dan harus merah dulu. Hijau sejak awal
= test tidak menguji apa pun.

| #   | Skenario                                                                 | Ekspektasi                                                                 |
| --- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| 1   | Merchant A membaca katalog/lead/analytics merchant B                     | 404 anti-oracle (bukan 403 yang mengonfirmasi keberadaan)                  |
| 2   | Merchant A mengubah `merchantId` di body ke merchant B                   | Diabaikan; resource owner diambil server. Tidak ada tulisan ke merchant B. |
| 3   | `merchant_editor` mengubah rekening bank/identitas legal                 | 403 + decision log; tidak ada baris berubah                                |
| 4   | `finance_approver` menyetujui payout buatannya sendiri                   | 409/403 `SOD_CONFLICT` + audit                                             |
| 5   | Affiliate membuka payout/konversi affiliate lain                         | 404 anti-oracle                                                            |
| 6   | Pendamping membuka merchant di luar assignment, atau setelah kedaluwarsa | 403; kedaluwarsa berlaku tanpa job                                         |
| 7   | Sesi merchant memanggil `/api/v1/jualanku/admin/*`                       | 403 sebelum service bisnis dijalankan                                      |
| 8   | Modul Jualanku dinonaktifkan untuk tenant, endpoint tetap dipanggil      | 403 `MODULE_DISABLED`                                                      |
| 9   | Sesi tenant lain dipakai pada host Jualanku                              | Ditolak sebelum service bisnis                                             |
| 10  | API publik meminta merchant/produk draft atau ditolak moderasi           | Tidak ditemukan; draft tidak pernah masuk projection publik                |
| 11  | Resolver hierarki scope mengembalikan `resolved: false`                  | Aksi high-risk **deny**, bukan lolos                                       |
| 12  | Payout disetujui dua kali (retry/double submit)                          | Idempotent: satu efek, satu entri ledger                                   |
| 13  | Cross-tenant: baris merchant tenant lain diakses sebagai `awcms_app`     | 0 baris (RLS terbukti, diuji sebagai role aplikasi, bukan superuser)       |

Uji RLS **wajib** dijalankan sebagai role aplikasi (`awcms_app`), bukan sebagai
superuser. Pada PaaS yang menjadikan user Postgres default superuser, `FORCE` RLS
diam-diam inert sementara migrasi tetap hijau.

## 8. Audit & decision log

- Setiap keputusan akses (allow maupun deny) atas resource merchant-scoped masuk
  decision log; deny karena `resolved: false` dicatat dengan sebabnya, agar
  "kenapa merchant ini tidak bisa apa-apa" bisa dijawab tanpa menebak.
- Aksi high-risk (verifikasi, moderasi, payout, perubahan paket, perubahan
  rekening, penugasan pendamping, ekspor data) wajib audit event ber-actor,
  resource, outcome, dan correlation ID; PII direduksi/masked pada payload log.
- Ekspor data pribadi dan pemulihan (restore/purge) ikut alur `data_lifecycle`
  dan menghormati legal hold.
