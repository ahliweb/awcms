🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](README.md)

<!-- i18n-source-hash: sha256:f48fee685495e7b6fd93f5a209278e0b0f01c51ff982f3ef86768dec993c09d1 -->

# `website_engagement`

**Penangkapan lead dan kontak situs web** per tenant serta event interaksi situs web masuk (Issue #1153, [ADR-0155](../../../docs/adr/0155-website-engagement-is-an-intake-only-system-module-with-token-and-origin-provenance.id.md); desain dan catatan keamanan di [`docs/awcms/website-engagement.id.md`](../../../docs/awcms/website-engagement.id.md)).

Situs web milik tenant mengirim permintaan kontak, lead, atau interaksi ke SATU endpoint publik yang sengaja tanpa autentikasi, `POST /api/v1/website-engagement/submissions`. Permintaan diterima hanya dengan token buram per-**source** (disimpan hanya sebagai hash berkunci, ditampilkan sekali) **dan** host `Origin` yang terdaftar untuk source itu, dalam rate limit per alamat dan per source, di balik tantangan Turnstile opsional, terhadap himpunan field **tertutup dan berversi**. Data disimpan dengan **provenance persetujuan eksplisit** dan atribusi sumber, detail kontaknya terenkripsi saat disimpan, dan diumumkan oleh event outbox yang dikonsumsi adapter CRM.

**Hanya intake.** Bukan CRM, bukan pipeline lead, bukan mesin formulir, bukan widget obrolan; ia tidak membuat, mencocokkan, atau menggabungkan orang, tidak menyimpulkan identitas pengunjung (tidak ada sidik jari, cookie, IP, atau user agent yang disimpan), tidak menerima HTML atau unggahan, dan tidak membuat permintaan keluar saat menerima data. Widget tertanam telah dinilai dan **tidak dibangun** (lihat dokumen desain).

- **Tabel** (`sql/325`): `awcms_engagement_sources`, `awcms_engagement_source_domains`, `awcms_engagement_submissions`; RLS `FORCE`, `WITH CHECK`; penjaga integritas di `sql/327`; izin di `sql/326`.
- **Event**: `awcms.website_engagement.submission.received` dan `...submission.withdrawn` (AsyncAPI), membawa referensi buram, tidak pernah detail pengunjung.
- **API admin**: source (buat, ubah, rotasi, cabut, hapus), pembacaan kiriman tersamar, **reveal** teraudit, dan **penarikan** oleh pengendali; setiap rute default-deny dan `experimental` tanpa entri navigasi sampai layarnya hadir.
- **Retensi**: dideklarasikan di `module.ts` lewat `data_lifecycle` (bawaan 180 hari).
- **Konfigurasi**: `WEBSITE_ENGAGEMENT_KEYS` (wajib untuk menyimpan apa pun; gagal tertutup) dan variabel rate limit di `.env.example`.

Tata letak: `domain/` (murni: token, validator, kebijakan origin, event, pesan), `application/` (direktori source dan kiriman, intake, handler publik), `module.ts`. Rute berada di `src/pages/api/v1/website-engagement/`.

## Risiko sisa

- Profil offline/LAN tanpa Turnstile: token bocor ditambah Origin palsu non-browser hanya dibatasi oleh batas per alamat (berkunci IPv6 /64), jatah per source, dan retensi.
- Limiter berjalan di dalam proses kecuali Redis dikonfigurasi.
- Preflight menampakkan apakah sebuah hostname adalah domain tenant aktif pada deployment (seperti `newsletter`).
- Field atribusi memakai set karakter tertutup tetapi tidak dapat membuktikan sebuah nilai bukan data pribadi.
- Klik ganda pada formulir bertantangan dapat gagal di tantangan kedua (sekali pakai).
- Temuan audit L3, L5, dan informasional diterima sebagaimana tercatat di laporan audit dan tidak ditangani pada irisan ini.
- Tidak ada kanal penarikan publik, mode server-ke-server, masa tenggang rotasi, atau layar admin.
