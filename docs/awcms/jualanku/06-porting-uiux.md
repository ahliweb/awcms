# 06 — Porting UI/UX dan design system

> Rencana. Lihat [README](README.md) untuk status.

Dokumen ini menetapkan **cara** desain Elementor diterjemahkan. Spesifikasi
layar publik dan portal ada di repo `awcms-astro`; bagian yang mengikat di sini
adalah layar **admin internal** dan design token yang dipakai bersama.

## 1. Definisi porting

Porting = menerjemahkan tujuan pengguna, hierarki informasi, pola visual, copy,
state, dan perilaku komponen dari prototipe Elementor menjadi komponen Astro +
spesifikasi layar.

Porting **bukan** menyalin DOM, kelas CSS, widget, shortcode, plugin, atau model
data WordPress. Tidak ada satu baris pun markup WordPress yang masuk.

| Artefak Elementor               | Keputusan                                                 |
| ------------------------------- | --------------------------------------------------------- |
| Hero, kategori, card, pricing   | Ekstrak design token + kontrak komponen                   |
| Listing manual                  | Ganti projection/taksonomi dari `awcms`                   |
| Form login WordPress            | Ganti `identity_access` lewat BFF                         |
| Dashboard berupa gambar panjang | Bangun rute + komponen HTML nyata                         |
| Placeholder/lorem ipsum         | REMOVE — tidak pernah masuk produksi                      |
| Tautan hard-coded               | Generator rute dari slug + typed route                    |
| Data demo sensitif              | Tidak dimigrasikan ke seed produksi                       |
| Copy klaim manfaat              | Masuk content review + evidence owner + persetujuan legal |

## 2. Migration disposition

| Kode       | Makna                                  | Contoh                                        |
| ---------- | -------------------------------------- | --------------------------------------------- |
| `PORT`     | Tujuan dan struktur dipertahankan      | Hero, category card                           |
| `REDESIGN` | Tujuan tetap, alur/struktur diperbaiki | Dashboard penjual                             |
| `DYNAMIC`  | Komponen statis diganti data `awcms`   | Kategori, listing, pricing                    |
| `REMOVE`   | Tidak layak dibawa                     | Placeholder, catatan internal, seksi duplikat |
| `DEFER`    | Bernilai tetapi bukan MVP              | Rekomendasi AI, checkout marketplace          |

Inventaris per rute/seksi dibuat sebagai lembar kerja tersendiri sebelum layar
pertama dikerjakan (tindakan P0 #7 pada dokumen validasi). Setiap baris punya:
rute, seksi, disposition, pemilik data, dan catatan aksesibilitas.

## 3. Design token

Jualanku **tidak** membuat sistem token baru. Ia memakai token AWCMS yang sudah
distandarkan di [`../14_ui_ux_design_system.md`](../14_ui_ux_design_system.md)
(`--color-*`, `--space-*`, `--radius-*`, `--shadow-*`, token motion), dan
menyetel nilainya lewat modul `theming` per tenant.

Aturan yang berlaku:

- Warna semantik dipakai sesuai perannya; untuk fill solid + teks putih pakai
  varian `-strong` (token polos tidak lulus kontras AA pada sebagian kombinasi).
- Status verifikasi/payout/moderasi **tidak boleh** dibedakan hanya dengan warna:
  selalu ada label teks dan/atau ikon.
- Tidak ada gaya sekali pakai. Komponen baru memakai token yang sudah ada; token
  baru butuh alasan tertulis dan audit kontras ulang.

## 4. Komponen lintas permukaan

| Fondasi UI                      | Publik                   | Portal                | Admin internal                     |
| ------------------------------- | ------------------------ | --------------------- | ---------------------------------- |
| Button / FormField / StatusPill | CTA, filter              | Form & mutasi         | Form & approval                    |
| Card / Panel                    | Merchant, produk         | KPI, task             | Ringkasan operasional              |
| DataTable / Pagination          | Opsional (listing padat) | Katalog, lead         | Merchant, payout, moderasi         |
| Empty / Error / Loading         | Direktori kosong         | Wajib di setiap layar | Wajib di setiap layar              |
| Dialog / Drawer / Toast         | Minimal                  | Aksi mobile           | Aksi high-risk (dengan konfirmasi) |
| MaskedText / MoneyText          | Harga publik             | Rekening, invoice     | PII & keuangan                     |
| Breadcrumb / Nav                | SEO & navigasi           | Navigasi portal       | Navigasi admin sadar-role          |

Komponen admin dibangun di `awcms` mengikuti pola layar admin yang sudah ada
(`src/pages/admin/**`) — termasuk aturan CSP: **tidak ada script inline**; script
di-import dan di-bundle.

## 5. Layar admin internal Jualanku

Ditambahkan di `awcms` sebagai SSR di bawah `/admin/jualanku/**`, dan
**didaftarkan lewat `navigation` descriptor modul** (menu admin dibangun dari
registry; entri menu yang menunjuk 404 memerahkan test navigasi).

| Layar                                  | Isi utama                                                 | Kontrol khusus                        |
| -------------------------------------- | --------------------------------------------------------- | ------------------------------------- |
| `dashboard`                            | Ringkasan operasional, antrean SLA                        | —                                     |
| `merchants`                            | Daftar + detail + suspend/restore                         | Alasan wajib, audit                   |
| `verifications`                        | Antrean case, bukti **ter-masking**, keputusan            | Step-up; akses bukti ter-audit        |
| `catalog` / `moderation`               | Listing bermasalah, keputusan tahan/terbit                | Alasan wajib                          |
| `leads`                                | Kesehatan lead (agregat), bukan isi percakapan            | PII minimal                           |
| `affiliates` / `commissions`           | Profil, konversi, ledger, reversal                        | Reversal ber-alasan, append-only      |
| `payouts`                              | Antrean maker/checker                                     | **SoD**; approver ≠ pembuat           |
| `plans` / `subscriptions` / `invoices` | Paket, entitlement, tagihan                               | Perubahan harga = `configure` + audit |
| `complaints`                           | Pengaduan konsumen + resolusi                             | SLA & jejak                           |
| `onboarding-operations`                | Assignment pendamping, masa berlaku, persetujuan merchant | Grant bertenggat                      |
| `reports` / `risk` / `audit`           | Laporan, anomali, jejak keputusan akses                   | Ekspor PII = high-risk                |
| `settings`                             | Konfigurasi modul Jualanku per tenant                     | `configure`                           |

Merchant dan affiliate tidak punya rute, entri navigasi, role, maupun audience
sesi ke layar mana pun di atas.

## 6. Aksesibilitas

Baseline **WCAG 2.2 Level AA** (diadopsi sebagai ISO/IEC 40500:2025) — naik dari
2.1 AA yang dipakai template sebelumnya.

- Seluruh fungsi primer dapat dioperasikan keyboard, dengan fokus terlihat.
- Target sentuh CTA utama portal minimal 44 CSS px.
- Setiap form: label, hint, asosiasi error, pengumuman status, dan validasi
  server-side (validasi klien bukan kontrol).
- Status tidak pernah hanya-warna.
- `prefers-reduced-motion` dihormati — animasi dekoratif **dimatikan**, bukan
  dipercepat.
- Hierarki heading, landmark, skip link, caption/header tabel, dan atribut
  bahasa diuji otomatis **dan** manual pada alur kritis.
- Mobile-first dari lebar 360 px.

## 7. Bahasa & konten

- String UI lewat katalog i18n (`bahasa Indonesia` sebagai locale utama produk),
  bukan literal di komponen.
- Angka, mata uang, dan tanggal diformat lewat helper i18n; jangan pernah
  merangkai string mata uang manual.
- Klaim pemasaran, harga, dan janji layanan punya pemilik bukti dan persetujuan
  sebelum tayang — dicatat di claims register (lihat
  [07](07-roadmap-gates-kepatuhan.md)).
