# 01 — Arsitektur porting Jualanku.info

> Rencana. Lihat [README](README.md) untuk status dan
> [ADR-0045](../../adr/0045-jualanku-porting-awcms-system-of-record-astro-bff.md)
> untuk keputusannya.

## 1. Pembagian lapisan

| Lapisan                  | Pemilik                                                      | Tanggung jawab                                                                                   | Yang **bukan** tanggung jawabnya                            |
| ------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| Experience publik        | `awcms-astro`                                                | Homepage, direktori, profil usaha, katalog publik, artikel, SEO, structured data, aksesibilitas. | Aturan bisnis, keputusan otorisasi, akses basis data.       |
| Portal penjual/affiliate | `awcms-astro` (on-demand)                                    | Render halaman privat, BFF `/_portal-api/*`, view model, header privat, CSRF.                    | Entitlement, kepemilikan, transisi state, ledger.           |
| Business platform        | `awcms`                                                      | Domain service, policy, validasi, workflow, reporting, audit, outbox, API.                       | Markup halaman publik, cache tepi, SEO halaman portal.      |
| Admin internal           | `awcms` (SSR `/admin/*`)                                     | Operasi, moderasi, verifikasi, finance, risk, support, settings.                                 | Akses merchant/affiliate — mereka tidak punya rute ke sini. |
| Data                     | PostgreSQL via `awcms`                                       | System of record, RLS, retensi, legal hold.                                                      | Diakses langsung oleh `awcms-astro` (tidak pernah).         |
| Media                    | `media_library` (R2) via `awcms`                             | Upload presigned, verifikasi MIME magic-byte, SHA-256, lifecycle, enforcement managed-media.     | Menerima URL gambar bebas dari portal.                      |
| Edge/routing             | Cloudflare/Traefik/Coolify + Varnish (`src/lib/edge-cache/`) | TLS, WAF, rate limit, routing host, pemisahan cache.                                             | Otorisasi. Cache bukan kontrol akses.                       |

## 2. Topologi

```
Internet
  │
Cloudflare (WAF, rate limit, TLS)
  │
Traefik / Coolify
  ├──────────────────────────────┐
  │                              │
jualanku.info                   ops.jualanku.info
awcms-astro                     awcms (Astro SSR, @astrojs/node)
- publik: prerender             - /admin/** internal
- /penjual/**  on-demand        - allowlist jaringan / Zero Trust
- /affiliate/** on-demand
- BFF /_portal-api/**
  │
  │ jaringan privat / service identity (mTLS atau token layanan)
  ▼
awcms REST API  ──►  PostgreSQL (RLS FORCE) + audit + outbox + R2
```

Catatan yang mengikat:

- `awcms` **tidak** dipublikasikan sebagai API umum. Rute publik yang memang
  sudah ada di repo ini (`/blog/{tenantCode}/*`, `/robots.txt`, `/sitemap*.xml`,
  feed, `/search`) tetap boleh terbuka; sisanya hanya menerima trafik dari
  experience layer.
- Host admin terpisah dari host publik. Satu origin yang melayani halaman
  merchant dan halaman admin membuat setiap kesalahan CSP, cookie, atau cache
  berubah menjadi kesalahan lintas-audience.
- Cache tepi hanya menyentuh permukaan publik. `private, no-store` untuk semua
  respons portal dan admin — lihat `bun run edge-cache:surfaces:check` sebelum
  menambah surface baru.

## 3. Matriks rendering per permukaan

| Permukaan                           | Repo          | Rendering                                | Cache                          | Autentikasi             |
| ----------------------------------- | ------------- | ---------------------------------------- | ------------------------------ | ----------------------- |
| `/`, halaman marketing, `/harga`    | `awcms-astro` | Prerender                                | Public, revalidate saat deploy | Tidak                   |
| `/artikel/**`, `/bantuan/**`        | `awcms-astro` | Prerender (fetch saat build)             | Public                         | Tidak                   |
| `/kategori/[slug]`, `/usaha/[slug]` | `awcms-astro` | Prerender + rebuild/purge                | Public, invalidasi ber-tag     | Tidak                   |
| `/cari`                             | `awcms-astro` | On-demand atau API publik ber-TTL pendek | Public, TTL terbatas           | Tidak                   |
| `/penjual/**`                       | `awcms-astro` | On-demand (`prerender = false`)          | `private, no-store`            | Sesi merchant           |
| `/affiliate/**` (dashboard)         | `awcms-astro` | On-demand (`prerender = false`)          | `private, no-store`            | Sesi affiliate          |
| `/affiliate` (landing)              | `awcms-astro` | Prerender                                | Public                         | Tidak                   |
| `/_portal-api/**`                   | `awcms-astro` | Server endpoint (BFF)                    | `no-store`                     | Sesi + CSRF             |
| `/admin/jualanku/**`                | `awcms`       | SSR                                      | `no-store`                     | Role internal + step-up |
| `/api/v1/jualanku/**`               | `awcms`       | API                                      | `no-store`                     | Sesuai namespace        |

Istilah yang dipakai: **static-by-default dengan rute on-demand**. Astro modern
hanya punya `output: 'static'` atau `'server'`; kemampuan campuran didapat dari
`export const prerender = false` per rute setelah adapter terpasang — bukan dari
nilai `output: 'hybrid'` yang sudah tidak ada.

## 4. Kenapa BFF wajib

Enam alasan, masing-masing menutup satu kegagalan konkret:

1. **Tenant tidak boleh ditentukan browser.** `awcms` menerima tenant dari header
   `x-awcms-tenant-id` atau cookie. Bila browser publik yang mengirimnya, pemilihan
   tenant menjadi input pengguna. BFF menurunkannya server-side dari konfigurasi
   deployment/host.
2. **Tidak ada token di penyimpanan browser.** Cookie httpOnly dipegang origin
   publik; token sesi `awcms` tidak pernah sampai ke JavaScript.
3. **CSRF, Origin/Referer, dan cache policy diterapkan di satu tempat**, bukan
   diulang di setiap halaman.
4. **Envelope `awcms` diproyeksikan menjadi view model**, sehingga perubahan
   bentuk respons internal tidak langsung menjadi perubahan HTML publik.
5. **Rate limit berbeda per audience** (pencarian publik, mutasi merchant, payout
   affiliate, admin) tanpa membebani satu konfigurasi.
6. **Permukaan serang `awcms` tetap kecil**: satu klien tepercaya, bukan seluruh
   internet.

**Batas keras:** BFF tidak boleh memutuskan apa pun yang punya konsekuensi bisnis.
Kalau sebuah cek hanya ada di BFF, cek itu tidak ada — panggilan langsung ke
`awcms` dari jaringan internal akan melewatinya. Setiap aturan yang penting
di-_re-check_ di `awcms` untuk setiap panggilan.

## 5. Bagaimana modul website yang sudah ada dipakai

Jualanku **tidak** membangun ulang kemampuan yang sudah ada di repo ini:

| Kebutuhan Jualanku                    | Modul yang dipakai                            | Catatan integrasi                                                                                  |
| ------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Artikel, halaman bantuan, legal       | `blog_content`                                | Halaman legal ber-versi + tanggal berlaku memakai lifecycle post/page yang sudah ada.              |
| Metadata SEO, sitemap, feed, redirect | `seo_distribution`                            | Modul konten Jualanku mendeklarasikan `seo_facts` lewat seam yang ada; host diturunkan server.     |
| Pencarian direktori                   | `site_search`                                 | `jualanku_directory`/`jualanku_catalog_growth` mendeklarasikan `searchSources` untuk baris terbit. |
| Gambar usaha/produk/bukti verifikasi  | `media_library`                               | Upload presigned + verifikasi MIME. Portal tidak pernah mengirim URL gambar bebas.                 |
| Tema & design token per tenant        | `theming`                                     | Token Jualanku menjadi konfigurasi tema, bukan CSS lepas di komponen.                              |
| Domain/host → tenant                  | `tenant_domain`                               | Sumber host kanonik untuk BFF dan SEO.                                                             |
| Analitik kunjungan privacy-minimal    | `visitor_analytics`                           | Metrik halaman publik. Metrik bisnis merchant tetap milik modul Jualanku.                          |
| Komentar/ulasan (bila dibuka)         | `comments`                                    | Hanya untuk resource yang sudah terbit; deklarasi lewat `commentableResources`.                    |
| Retensi/arsip/purge + legal hold      | `data_lifecycle`                              | Setiap tabel bervolume tinggi Jualanku mendeklarasikan `dataLifecycle`.                            |
| Notifikasi email                      | `email`                                       | Template + outbox dispatcher yang sudah ada.                                                       |
| Approval payout/verifikasi            | `workflow_approval` + `identity_access` (SoD) | Maker/checker sebagai definisi workflow + `sodRules`, bukan `if` di service.                       |
| Draft form multi-langkah onboarding   | `form_drafts`                                 | Payload JSONB generik; arti payload milik modul Jualanku.                                          |

Yang benar-benar baru hanya lima modul domain di
[03-bounded-context-dan-model-data.md](03-bounded-context-dan-model-data.md).
