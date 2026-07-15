# ADR-0009 — Resolusi tenant untuk rute publik (tanpa sesi)

- **Status:** Accepted
- **Tanggal:** 2026-07-07
- **Pengambil keputusan:** <maintainer>
- **Terkait:** `docs/awcms/15_frontend_architecture_integration.md`, `docs/awcms/16_backend_data_access_integration.md`, `docs/awcms/18_configuration_env_reference.md` §Topologi deployment LAN-first, Issue #540 (epic #536, `blog_content`), ADR-0003

## Konteks

Setiap mekanisme resolusi tenant yang ada hari ini mengasumsikan pemanggil sudah terautentikasi: `src/middleware.ts` hanya me-resolve tenant untuk `/admin/*` lewat sesi cookie, dan setiap endpoint `/api/v1/*` mengandalkan header `X-AWCMS-Tenant-ID` yang dikirim eksplisit oleh klien yang sudah tahu tenant-nya. **Tidak ada mekanisme untuk pengunjung anonim** (mis. pembaca blog publik) untuk request-nya di-scope ke tenant yang benar — repo ini belum pernah membangun rute publik yang tenant-scoped sama sekali (satu-satunya contoh, `/customer/receipts/{token}` di doc 14's screen inventory, murni ilustratif/belum pernah diimplementasikan, dan pola tokennya pun hanya cocok untuk satu resource spesifik, bukan navigasi publik lintas halaman seperti blog/RSS/sitemap).

Epic #536 (`blog_content`) butuh ini nyata: `GET /blog/{...}`, RSS, sitemap, dan halaman post publik (Issue #540) semuanya harus tahu tenant mana yang dilayani **tanpa** sesi/header eksplisit dari browser pengunjung biasa. Keputusan ini harus dibuat sekali di level base (bukan diputuskan ad-hoc oleh `blog_content`), karena modul turunan publik berikutnya (mis. portal customer, halaman landing per-tenant) akan menghadapi masalah yang identik.

## Keputusan

Kami memutuskan rute publik tenant-scoped me-resolve tenant lewat **segmen path eksplisit** yang membawa `tenant_code` yang sudah ada (`awcms_tenants.tenant_code`, unik global sejak migration 002) — bentuk `/<prefix>/{tenantCode}/...` (mis. `/blog/{tenantCode}/{slug}`), **bukan** subdomain-per-tenant.

Resolusi: sebelum membuka `withTenant` transaction, look up `tenant_code → tenant_id` dari `awcms_tenants` (tabel RLS-free — dia sendiri akar tenant, sama seperti alasan tabel ini RLS-free di ADR-0003) satu query ringan, `tenantCode` tidak ditemukan atau tenant `status != 'active'` → `404`, bukan bocor keberadaan tenant. Pola ini simetris dengan bagaimana `X-AWCMS-Tenant-ID` sudah di-resolve untuk API client terautentikasi — hanya sumber tenant id-nya beda (path, bukan header/sesi).

## Konsekuensi

- **Positif:** Bekerja identik di setiap profil deployment (LAN/offline/online, doc 18) tanpa DNS/TLS tambahan — sejalan dengan prinsip topologi LAN-first default AWCMS (satu server, klien LAN, tanpa ketergantungan internet). Mudah dites lokal (`http://localhost:4321/blog/{tenantCode}/...`), tidak butuh wildcard cert.
- **Negatif/trade-off:** `tenantCode` terlihat di URL publik — bukan white-labeling penuh (pengunjung tahu ini SaaS multi-tenant). Aplikasi turunan yang butuh domain custom per-tenant (mis. `blog.pelanggan-a.com`) butuh lapisan tambahan (lihat Alternatif di bawah) — di luar cakupan base ini.
- **Netral:** Setiap rute publik baru mengikuti pola yang sama (satu titik resolusi `tenantCode → tenant_id`, reusable helper, bukan diimplementasikan ulang per modul) — `awcms-new-endpoint` didokumentasikan untuk merujuk ADR ini.

## Alternatif yang dipertimbangkan

- **Subdomain per tenant** (`{tenantCode}.awcms.example.com`) — ditolak sebagai default base: butuh wildcard DNS + wildcard/SAN TLS certificate + domain publik nyata, bertentangan langsung dengan topologi LAN-first/offline default (doc 18) di mana server bahkan mungkin tidak punya domain publik sama sekali. Valid sebagai **ekstensi opsional** untuk deployment online-only (bisa jadi ADR susulan bila dibutuhkan aplikasi turunan tertentu), tidak untuk base generik.
- **Domain custom per tenant** (tabel mapping domain→tenant, mis. `blog.pelanggan-a.com`) — sama seperti di atas, ditolak untuk base (butuh provisioning DNS/TLS per tenant, tidak masuk akal untuk LAN-first); dicatat sebagai perluasan valid untuk aplikasi turunan SaaS online-only, didesain terpisah dari base ini kalau saatnya tiba.
- **Halaman publik global tanpa tenant di URL, tenant dipilih via switcher** — ditolak: mustahil bagi pengunjung anonim yang belum pernah tahu tenant mana yang mereka cari (mis. pengunjung datang dari link RSS/search engine langsung ke satu post tertentu), dan melemahkan model isolasi (satu domain publik jadi "daftar semua tenant").
