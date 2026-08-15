🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](08-koreksi-dokumen-validasi.md)

<!-- i18n-source-hash: sha256:5ce7ffbb394d0d76c14d60db9aece1fb4717ba02a307bd8911927d2134a52b84 -->

# 08 — Koreksi terhadap dokumen validasi v1.0

> Dokumen validasi PT TIM SIX v1.0 (29 Juli 2026) sebagian bernalar dari
> dokumentasi repo, dan dokumentasi bisa basi. Setiap baris di bawah dicek ke
> **kode** repo ini pada tanggal yang sama. Yang terkonfirmasi tidak diulang di
> sini; yang berbeda dicatat lengkap dengan buktinya.

## 1. Inventaris modul — temuannya benar, sebabnya berbeda

Dokumen menyimpulkan `news-portal` "belum tersedia" dan meminta jangan
menganggapnya ada. Kesimpulan praktisnya tepat, tetapi sebabnya bukan "modul
belum dibuat", melainkan **modul dilebur**:

- `news_portal` **dilebur ke `blog_content`** oleh
  [ADR-0044](../../adr/0044-merge-news-portal-into-blog-content.md); fitur-nya
  (homepage section composer, ad placement ber-media terverifikasi) tetap ada,
  hanya berpindah pemilik.
- `src/modules/index.ts` berisi **20 modul** dan tidak memuat `news_portal`.
- Yang basi adalah prosa: `README.md` masih menyebutkannya dalam daftar
  "foundation modules"; `docs/ARCHITECTURE.md` menyebut "20 modul" tetapi
  **memerinci 21 butir**; `docs/PROJECT_STATE.md` menyebut 21 modul, 43 ADR, dan
  `MODULE_CONTRACT_VERSION` 2.3.0 — ketiganya tertinggal.

**Koreksi:** ketiga dokumen itu direkonsiliasi bersama perubahan yang membawa
ADR-0045. Aturan yang dipakai seterusnya sama dengan rekomendasi dokumen
validasi: `src/modules/index.ts` adalah bukti terkuat, prosa mengikuti.

## 2. "Portal memeriksa sesi lewat SSR — `auth/me` bearer-only"

Setengah benar, dan setengah yang salah mengubah rancangan.

- **Benar:** `GET /api/v1/auth/me` memang hanya menerima bearer token
  (`src/pages/api/v1/auth/me.ts`).
- **Tidak benar:** "`awcms` belum mendukung sesi berbasis cookie". Login sudah
  menyetel cookie httpOnly `awcms_session` + `awcms_tenant_id`, dan
  `resolveAuthInputs()` (`identity-access/application/access-guard.ts`) menerima
  **header ATAU cookie** — itulah cara admin SSR yang sudah jalan hari ini
  mengautentikasi dirinya.

**Koreksi:** gapnya lebih sempit dan lebih spesifik — tidak ada **kontrak
introspeksi sesi untuk origin yang berbeda**. Cookie `awcms` milik origin
`awcms`; browser di `jualanku.info` tidak akan mengirimkannya. Yang ditambahkan
adalah endpoint introspeksi yang dipanggil **BFF** (lihat
[05](05-kontrak-sesi-dan-bff.md)), bukan "dukungan cookie".

## 3. "Merchant isolation lewat ABAC `subject.merchantIds` / `resource.merchantId`"

Arahnya benar (ABAC + ownership + atribut dari server), tetapi bentuk konkretnya
tidak bisa diimplementasikan apa adanya:

- `ABAC_ATTRIBUTES` (`identity-access/domain/abac-policy.ts`) adalah **allow-list
  tertutup**. Atribut di luar daftar itu **invalid saat authoring** dan **deny
  saat evaluasi**. `subject.merchantIds` dan `resource.merchantId` tidak ada di
  sana.
- Menambah pasangan atribut per-produk akan mengubah allow-list terbatas menjadi
  daftar yang tumbuh mengikuti permintaan — properti yang justru membuatnya
  bernilai akan hilang.

**Koreksi:** merchant dimodelkan sebagai **business scope** (ADR-0030). Repo
sudah punya `resource.businessScopeId` di allow-list dan port hierarki scope yang
base-nya mengembalikan `resolved: false` sehingga aksi high-risk **fail closed**.
`jualanku_directory` mengisi port itu untuk tipe scope `merchant`. Rinciannya di
[02](02-model-tenant-merchant-otorisasi.md) §3.

## 4. "RLS memisahkan tenant" — benar, dengan satu jebakan operasional

Dokumen benar bahwa RLS tidak memisahkan merchant. Yang perlu ditambahkan: RLS
juga bisa **diam-diam tidak memisahkan tenant** pada platform tertentu.

`FORCE` RLS tidak berlaku untuk role superuser. Sejumlah PaaS membuat user
Postgres default menjadi superuser; bila `DATABASE_URL` runtime menunjuk ke sana,
isolasi tenant hilang total **sementara migrasi tetap hijau dan health check
tetap 200**.

**Koreksi:** verifikasi isolasi wajib dijalankan **sebagai role aplikasi**
(`awcms_app`) dan menjadi bagian test, bukan asumsi. Ini masuk gate P1
([07](07-roadmap-gates-kepatuhan.md) §2).

## 5. "Tujuh modul domain" → lima

Disetujui apa adanya oleh dokumen validasi sendiri (Alternatif C). Dicatat di
sini karena keputusannya mengikat: lima bounded context, dan pemecahan
selanjutnya hanya berdasarkan coupling terukur.

## 6. `awcms-astro`: fakta terkonfirmasi

Semua terverifikasi pada repo `ahliweb/awcms-astro`:

- `output: "static"`, tanpa adapter server.
- Nginx melayani berkas statis (`try_files` ke `index.html`).
- Konten ditarik saat build; CMS tidak menghadap pembaca.
- `AGENTS.md` repo itu sudah menyatakan bahwa perpindahan ke `output: 'server'`
  **harus** lewat ADR lebih dulu.

**Satu fakta sudah berubah sejak dokumen validasi ditulis.** Dokumen itu benar
bahwa `awcms-astro` memakai Node/npm (`engines`: Node ≥ 22.12, npm ≥ 10.9) dan
karena itu menolak klaim "runtime mengikuti Bun". Klaim itu kini **benar**:
repo tersebut sudah dipindahkan ke Bun (ADR-0015 di sana — `packageManager`
`bun@1.3.14`, `bun.lock`, `bun test`, image `oven/bun`, `setup-bun` di CI).
Koreksi dokumen validasi tetap sah untuk tanggalnya; yang tidak lagi berlaku
adalah kesimpulan turunannya ("pertahankan Node/npm sampai ada ADR migrasi") —
ADR itu sudah ada dan sudah dieksekusi.

Karena itu perubahan rendering/runtime dirancang dan diputuskan **di repo itu**,
bukan di sini. Seluruh keluarga AWCMS kini Bun-only tanpa pengecualian.

## 7. Terminologi rendering

"Hybrid application" bukan istilah yang tepat pada Astro modern: `output` hanya
`static` atau `server`, dan kemampuan campuran datang dari
`export const prerender = false` per rute setelah adapter terpasang.

**Koreksi:** istilah yang dipakai di seluruh dokumen keluarga ini adalah
**static-by-default dengan rute on-demand** (mixed prerender/on-demand).

## 8. Versi standar

Koreksi versi pada dokumen validasi (WCAG 2.2 / ISO/IEC 40500:2025, ISO/IEC
27701:2025, ISO/IEC 27018:2025, ISO/IEC 15408 Parts 1–5:2026, transisi ISO/IEC 27017) **diterima apa adanya** dan menjadi baseline di
[07](07-roadmap-gates-kepatuhan.md) §6.

Satu tambahan: baseline aksesibilitas keluarga ini sebelumnya tertulis WCAG 2.1
AA di template `awcms-astro`. Menaikkannya ke 2.2 AA adalah perubahan yang harus
dicatat di repo tersebut, bukan diasumsikan otomatis berlaku.

## 9. Hal yang dokumen validasi benar dan sering dilupakan implementator

Dicatat ulang di sini karena tiga hal ini paling sering hilang saat eksekusi:

1. **Visibility UI bukan kontrol keamanan.** Menyembunyikan menu tidak menutup
   endpoint.
2. **Namespace berbeda tidak boleh melahirkan tiga implementasi aturan bisnis.**
3. **Provider eksternal tidak dipanggil di dalam transaksi basis data** —
   outbox + idempotency key.
