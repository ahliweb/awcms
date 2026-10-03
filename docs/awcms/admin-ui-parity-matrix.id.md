🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](admin-ui-parity-matrix.md)

<!-- i18n-source-hash: sha256:8d9f31dfec351d95fe252e2e4caad16aeb2a8f93965c1828d86f4288906ed73a -->

# Matriks paritas UI/UX admin AWCMS ↔ awcms-one

> Audit untuk [Issue #858](https://github.com/ahliweb/awcms/issues/858).
> Gelombang 1 adalah inventori + matriks paritas (docs only). Gelombang 2–7
> telah merekomposisi layar di atas matriks ini dan semuanya **SELESAI**
> (§7) — dokumen ini kini mendeskripsikan state AKHIR, bukan rencana.

## 1. Tujuan dan metode

[PR #813](https://github.com/ahliweb/awcms/pull/813) /
`ahliweb/awcms-one#170` meng-upstream chrome admin bersama dan delapan
primitif reusable ke `src/styles/admin.css`: `.admin-stat-card`,
`.admin-status-pill`, `.admin-segmented`, `.admin-bulk-bar`,
`.admin-two-pane`, `.admin-toggle`, `.admin-timeline`, `.admin-media-grid`.
Belum ada satu pun berkas di bawah `src/pages/admin/**/*.astro` di repo ini
yang memakainya — dikonfirmasi di bawah lewat grep, bukan sekadar mengulang
teks issue. Dokumen ini adalah pemetaan "layar mana dapat primitif mana, dan
kenapa" yang dituntut kriteria akseptansi issue sebelum satu layar pun
disentuh.

**Metode.** Setiap berkas dalam inventori (§4) dibaca pada level markup
`class=`/markup lewat `grep` bertarget di seluruh layar (data table, markup
status, form filter, kontrol toggle/tombol, daftar terurut/history, grid
media), lalu diverifikasi-spot dengan membaca markup di sekitar untuk setiap
sinyal ambigu (semua situs `.module-toggle`, situs
`.filter-bar`/`.admin-filter-*`, layar account/subject-requests/sidebar-menu/
module-detail yang tanpa sinyal grep sama sekali). Ini **bukan** pembacaan
baris-demi-baris seluruh 63 berkas; di mana keyakinan lebih rendah daripada
"dikonfirmasi dengan membaca markup", kolom Required change menyatakannya dan
menyerahkan keputusan akhir ke paket gelombang mana pun yang benar-benar
menyentuh layar itu.

**Aturan yang diterapkan sepanjang dokumen (dari issue), ditulis ulang agar
bisa dicek terhadap tiap baris di bawah:**

- jangan pernah memaksakan primitif ke layar yang tidak cocok dengannya;
- `.admin-bulk-bar` hanya di mana endpoint bulk yang aman sudah ada
  (diverifikasi terhadap `src/pages/api/**`, §5);
- `.admin-toggle` hanya untuk boolean nyata yang sudah dijamin otorisasi
  server-side, bukan untuk tombol yang memicu POST high-risk;
- `.admin-segmented` hanya untuk filter/tab yang benar-benar
  mutually-exclusive, bukan form filter `<select>`;
- pakai data nyata saja; hilangkan widget daripada memalsukan metrik.

## 2. Baseline tervalidasi

Diverifikasi ulang secara independen di branch ini terhadap
`/home/data/dev_bun/awcms-one` (checkout lokal `ahliweb/awcms-one`,
`apps/cms` meng-embed permukaan admin repo ini):

| Berkas                                                      | Hasil                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/styles/tokens.css`                                     | `diff -q` melaporkan **identik** dengan `apps/cms/src/styles/tokens.css`                                                                                                                                                                                                |
| `src/styles/admin.css` (3.402 baris)                        | `diff -q` melaporkan **identik** dengan `apps/cms/src/styles/admin.css` — kedelapan primitif didefinisikan di sana, byte-per-byte sama di kedua repo                                                                                                                    |
| `src/styles/admin-screens.css` (721 baris di sini)          | salinan awcms-one adalah **superset**: identik untuk 721 baris pertama, lalu 253 baris tambahan, semuanya di bawah banner eksplisit `/* commerce (awcms-one #171) ... */` yang menyatakan primitif tidak pernah dideklarasikan ulang di sana, hanya layout khusus layar |
| Pemakaian primitif di `src/pages/admin/**/*.astro`          | **nol** berkas mereferensikan kelas primitif `.admin-*` mana pun (`grep -rl` di seluruh 63 berkas tidak mengembalikan apa-apa)                                                                                                                                          |
| Pemakaian primitif di `apps/cms/src/pages/admin/**/*.astro` | **9** berkas, semuanya bernama `commerce*` (§3)                                                                                                                                                                                                                         |

Ini mengonfirmasi persis baseline yang dinyatakan issue: gap-nya adalah
komposisi layar, bukan token atau chrome.

## 3. Bagaimana awcms-one mengomposisi tiap primitif (referensi, bukan sumber salin)

`awcms-one` meng-embed repo ini di bawah `apps/cms` dan menambahkan sembilan
layar khusus commerce di atas `admin.css` yang identik. Pola komposisi yang
layak dipakai ulang, dan apa yang **tidak boleh** ikut pindah:

| Primitif             | Pemakaian di awcms-one (berkas)                                                                                 | Pola komposisi                                                                                                                                                                                                                                                                                                   | Bagian khusus commerce yang harus ditinggalkan                                                                                                                                                |
| -------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.admin-stat-card`   | `commerce-dashboard.astro`, `commerce-affiliates.astro`, `commerce-reports.astro`, `commerce-orders/[id].astro` | Grid 3–4 kartu, `-label`/`-value`/`-caption`; `.admin-status-pill` bersarang di dalam slot value kartu untuk jumlah low-stock/at-risk                                                                                                                                                                            | tidak ada — markup kartunya sendiri generik                                                                                                                                                   |
| `.admin-status-pill` | seluruh 9 berkas commerce                                                                                       | `data-tone` diset dari peta status→tone kecil di server-side (tak pernah enum mentah), selalu dipasangkan dengan `.admin-status-pill-dot` untuk kanal non-warna                                                                                                                                                  | _nilai-nilai_ peta tone (`paid`, `fulfilled`, `refunded`, …) adalah kosakata commerce                                                                                                         |
| `.admin-segmented`   | `commerce-orders.astro`, `commerce-inbox.astro`, `commerce-reports.astro`, `commerce.astro`                     | `<nav role="tablist">` (atau `<div>` + `role="tablist"` di segmented itu sendiri) membungkus tombol/label `.admin-segmented-option` dengan `aria-selected`; opsi adalah state mutually-exclusive nyata (status order, filter percakapan, tab laporan) bersumber dari enum yang sama dengan yang difilter backend | _opsi itu sendiri_ (set status order)                                                                                                                                                         |
| `.admin-bulk-bar`    | `commerce.astro` (daftar produk)                                                                                | Komentar di berkas menyatakan aturan load-bearing secara langsung: aksi bulk digerbangi predikat yang **sama** dengan kolom Actions per-baris, sehingga aksi bulk tidak pernah muncul untuk baris yang tidak bisa dilakukan operator secara individual                                                           | aksi bulk khusus produk (ubah harga massal, kategori massal)                                                                                                                                  |
| `.admin-two-pane`    | `commerce-inbox.astro`                                                                                          | `.admin-two-pane-list` (daftar thread scrollable) + `.admin-two-pane-detail` (transkrip), dengan state detail-kosong eksplisit saat tak ada yang dipilih                                                                                                                                                         | rendering transkrip thread inbox                                                                                                                                                              |
| `.admin-toggle`      | `commerce-settings.astro`                                                                                       | Satu switch berbasis checkbox per boolean setting yang benar-benar instan dan dijamin server, tak pernah untuk aksi yang butuh konfirmasi                                                                                                                                                                        | setting spesifik yang digerbanginya                                                                                                                                                           |
| `.admin-timeline`    | `commerce-orders/[id].astro`                                                                                    | `<ol class="admin-timeline">` berisi `.admin-timeline-item`, masing-masing dengan label `data-status` dan baris `-meta` (aktor + timestamp) — history status satu order                                                                                                                                          | kosakata event order                                                                                                                                                                          |
| `.admin-media-grid`  | tidak dipakai di awcms-one (tak ada layar commerce yang butuh)                                                  | t/a                                                                                                                                                                                                                                                                                                              | t/a — pemilih media bersama (`src/lib/ui/media-picker-client.ts`, Issue #872) adalah satu-satunya konsumen nyata di kedua repo; `/admin/media` sendiri dengan sengaja tidak memakainya (§6.6) |

**Jangan pernah di-upstream ke repo ini:** komponen `Commerce*` mana pun,
kesembilan rute `commerce-*.astro` itu sendiri, layout POS, CSS storefront,
atau kosakata label/status commerce yang tertanam di berkas-berkas itu.
Semua didaftar di sini hanya agar _pola_-nya (bentuk markup tab segmented,
paritas predikat bulk-bar/row-action, bentuk item timeline) bisa disalin
manual ke layar generik di bawah, dengan data dan label milik AWCMS sendiri.

## 4. Target konsolidasi — duplikat bespoke yang sudah ada

Ini **bukan** blok `<style>` per-berkas di `src/pages/admin/*.astro` —
tiap satu di antaranya didefinisikan sentral sekali di
`src/styles/admin.css` atau `src/styles/admin-screens.css` lalu
direferensikan lewat nama kelas dari puluhan layar. Bentuk itu sudah cocok
dengan bentuk "satu definisi, banyak konsumen" yang dipakai primitif
`.admin-*`; duplikasinya adalah **dua definisi sentral yang bersaing untuk
konsep yang sama**, bukan copy-paste per-layar.

| Kelas bespoke                                                                              | Didefinisikan di                          | Dipakai di                                                                                                                                                                                                                                                                   | Sebenarnya apa                                                                                                      | Hubungan dengan primitif baru                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------ | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.status-badge` / `.status-dot`                                                            | `src/styles/admin.css:1366`               | 40 berkas, 84 situs                                                                                                                                                                                                                                                          | Pill tint + dot, `data-variant="success\|neutral\|warning"`, per ADR-0120                                           | **Duplikat nyaris identik** `.admin-status-pill`/`.admin-status-pill-dot` — spesifikasi visual sama (isian tint, `--color-X-soft`/`--color-X-on-soft`, padding 3px/10px, `--radius-full`), rasional aksesibilitas sama (dot sebagai kanal kedua), nama atribut berbeda (`data-variant` vs `data-tone`) dan set tone lebih sempit (tanpa `danger`/`info`/`primary`). Ini adalah **konsolidasi bernilai tertinggi**: memigrasikan markup `.status-badge` ke `.admin-status-pill` menghapus satu blok CSS paralel utuh dan memberi tiap satu dari 40 layar itu tone `danger`/`info`/`primary` yang tidak mereka miliki hari ini.                                                                                                                                                                                                                                                                                                                                                                      |
| `.stat-card` / `.stat-grid` / `.stat-label` / `.stat-value` / `.stat-head` / `.stat-delta` | `src/styles/admin-screens.css:148-220an`  | 18 berkas (`analytics`, `data-lifecycle`, `domain-events`, `idn-regions`, `index`, `media`, `newsletter`, `omes/backups`, `omes/deployments`, `omes/health`, `omes/index`, `omes/jobs`, `omes/servers`, `push-notifications`, `reporting`, `site-search`, `sync`, `tenants`) | Tile KPI dashboard: value-first (layout terbalik ADR-0120), baris head ikon opsional `.stat-head` dan `.stat-delta` | **Sistem duplikat paralel** dengan `.admin-stat-card`/`-label`/`-value`/`-caption`. Keduanya mengkode "tile KPI value-first" tapi `.stat-card` tambahan punya afordansi head-ikon dan delta bertanda yang belum dimiliki `.admin-stat-card`. Konsolidasi berarti entah mem-port afordansi delta/head ke `.admin-stat-card` sebelum memigrasikan 18 layar ini, atau menerima hilangnya afordansi itu — keputusan desain nyata untuk gelombang 2, bukan sesuatu yang harus diputuskan-duluan audit ini.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `.count-pill` (`.admin-section-title .count-pill`)                                         | `src/styles/admin-screens.css:103`        | 36 berkas                                                                                                                                                                                                                                                                    | Pill netral kecil menampilkan jumlah item satu section di sebelah `<h2>`-nya (mis. "Users (42)")                    | Tujuan berbeda dari pill status — ini adalah **badge jumlah pada heading**, bukan state lifecycle. Cukup mirip secara visual dengan `.admin-status-pill[data-tone="neutral"]` sehingga _bisa_ memakai ulang CSS yang sama, tapi melakukannya adalah polish opsional, bukan konsolidasi wajib; ditandai prioritas-rendah di §6.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `.module-toggle`                                                                           | `src/styles/admin.css:1526`               | 16 berkas, setiap situs adalah `<button type="button">` atau `<button type="submit">` (terverifikasi — lihat di bawah)                                                                                                                                                       | **Tombol** row-action berbingkai: Enable/Disable, Save, Publish/Rollback, Verify/Set-primary, Delete, Resolve       | **Bukan duplikat `.admin-toggle`.** Namanya adalah kekeliruan sisa dari asal-usulnya sebagai tombol enable/disable modul, tapi setiap satu dari 16 berkas memakainya sebagai tombol aksi ber-POST yang terkonfirmasi, tak pernah checkbox switch hidup. Mengonversi satu pun dari ini ke `.admin-toggle` akan menjadi **regresi terkait keamanan**: itu akan membuat aksi high-risk, teraudit, sering digerbangi konfirmasi (enable/disable modul, verify/primary domain, delete redirect, publish/rollback tema) _terlihat_ seperti flip instan yang bisa dibalik di sisi klien, yang secara eksplisit dilarang issue ("jangan pernah mengandalkan kontrol hidden/disabled sebagai mekanisme otorisasi"). Repo ini tidak punya primitif "tombol row-action" reusable yang terpisah dari definisi `.module-toggle` sendiri; celah itu — bukan migrasi toggle — adalah peluang konsolidasi sebenarnya di sini, dan berkaitan dengan #854 (dialog konfirmasi pas sekali di depan tombol-tombol ini). |
| `.filter-bar` / `.admin-filter-bar` / `.admin-filter-form`                                 | inline di `admin.css`/`admin-screens.css` | `comments` (`.filter-bar`, `<nav aria-label="Filter by status">` berisi tautan `<a>`), `newsletter`/`media`/`push-notifications` (`.admin-filter-form`, `<form>` GET + `<select>`), `omes/orkestrasi-langsung` (`.admin-filter-bar`, `<form>` GET + `<select>`)              | Dua hal berbeda dengan nama mirip                                                                                   | `.filter-bar` milik `comments.astro` adalah **tab nav mutually-exclusive nyata** (status adalah salah satu dari set kecil tetap, masing-masing sebuah tautan) — kandidat `.admin-segmented` sejati. Empat lainnya adalah **form filter berbasis `<select>`** (status, kedalaman region, dll.) tanpa semantik tab — sesuai aturan issue sendiri, ini **bukan** kandidat `.admin-segmented` sebagaimana adanya; mengonversinya berarti mendesain ulang UI filter, di luar cakupan audit ini.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

## 5. Audit endpoint bulk (untuk kelayakan `.admin-bulk-bar`)

`grep -rli bulk src/pages/api` menemukan 8 berkas. Hanya satu yang benar-benar
**aksi bulk berbasis pemilihan baris pada layar daftar yang sudah ada**:

| Endpoint                                                                                                                   | Layar terkait                           | Vonis                                                                                                                                                                                                      |
| -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/pages/api/v1/comments/admin/bulk-moderate.ts`                                                                         | `comments.astro`                        | **Layak.** Terikat tenant, digerbangi ABAC per aksi, ber-`Idempotency-Key`, teraudit per item yang diterapkan, dibatasi 100 id/panggilan (ADR-0041). Ini persis bentuk yang diasumsikan `.admin-bulk-bar`. |
| `src/pages/api/v1/email/announcements/index.ts`, `.../preview.ts`                                                          | tidak ada (layar compose, bukan daftar) | Tidak layak — "bulk" di sini berarti "kirim satu pengumuman ke banyak penerima," bukan "aksi ke banyak baris terpilih di tabel."                                                                           |
| `src/pages/api/v1/comments/admin/[id]/delete.ts`                                                                           | `comments.astro`                        | Delete satu baris; bukan endpoint bulk meski cocok di grep (cocok pada komentar dokumentasi).                                                                                                              |
| `src/pages/api/v1/blog/pages/public/[slug].ts`, `.../news-portal/homepage-sections/[id].ts`, `.../seo/redirects/import.ts` | —                                       | False positive (kata "bulk" di komentar/deskripsi, bukan endpoint aksi-bulk).                                                                                                                              |

Tidak ada layar daftar lain dalam inventori (§6) yang punya endpoint bulk
layak hari ini. `.admin-bulk-bar` karena itu dicakup hanya untuk
`comments.astro` di gelombang 3; setiap godaan "adopsi bulk bar" lain di
layar daftar adalah **tidak** sampai ada endpoint bulk nyata untuknya (di
luar cakupan #858, yang UI-only).

## 6. Klasifikasi per-layar

63 berkas di bawah `src/pages/admin/**/*.astro`. Dikelompokkan menurut
famili yang diusulkan issue sendiri (§Scope butir 1–6). Klasifikasi adalah
**adopt** (kemenangan jelas, risiko rendah), **partially adopt** (satu atau
dua primitif cocok, atau baru cocok setelah keputusan lanjutan), atau **no
change** (tak ada primitif yang cocok tanpa dipaksakan, atau layarnya sudah
berbentuk primitif).

Legenda "Primitif": SC = `.admin-stat-card`, SP = `.admin-status-pill`,
SG = `.admin-segmented`, BB = `.admin-bulk-bar`, TP = `.admin-two-pane`,
TG = `.admin-toggle`, TL = `.admin-timeline`, MG = `.admin-media-grid`.

### 6.1 Dashboard / reporting / analytics

| Layar              | Primitif   | Klas.           | Perubahan diperlukan                                                                                                                                                                                                                          |
| ------------------ | ---------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.astro`      | SC         | adopt           | Migrasikan 4 tile KPI bespoke `.stat-card`/`.stat-grid` ke `.admin-stat-card`; tidak ada konten status/segmented.                                                                                                                             |
| `analytics.astro`  | SC, SP     | partially adopt | 13 situs family `.stat-card` → SC; 18 situs `data-table` membawa angka mentah, bukan status lifecycle, jadi SP hanya berlaku bila/di mana ada kolom status (perlu dibaca saat implementasi — ditandai, belum dikonfirmasi di sini).           |
| `reporting.astro`  | SC, SP, TL | partially adopt | 12 situs `.stat-card` → SC; 6 situs `.status-badge` → SP; section "Rebuild history" (`#reporting-rebuild-history`) adalah daftar history terurut nyata → kandidat TL.                                                                         |
| `omes/index.astro` | SC, TL     | partially adopt | 6 situs `.stat-card` → SC; sudah punya `<ol class="omes-lifecycle">` bespoke di baris 274 yang secara struktural adalah daftar event terurut — kandidat TL, perlu dibaca untuk mengonfirmasi bentuk item cocok dengan `.admin-timeline-item`. |

### 6.2 Layar list-management

Kelayakan bulk-bar nyata terbatas pada `comments.astro` (§5); kelayakan
tab-segmented nyata terbatas pada `comments.astro` (§4, baris terakhir).
Kolom SG/BB tiap baris lain sengaja kosong, bukan terlewat.

| Layar                                                                                                                                                               | Primitif          | Klas.                                                             | Perubahan diperlukan                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `comments.astro`                                                                                                                                                    | SP, SG, BB        | **adopt** (unggulan)                                              | Migrasikan tab nav status `.filter-bar` → `.admin-segmented`; status per-baris → `.admin-status-pill`; sambungkan UI seleksi yang ada ke `.admin-bulk-bar` memanggil endpoint `bulk-moderate` yang sudah ada, digerbangi predikat izin per-baris yang sama dengan kolom Actions baris (mencerminkan pola paritas-predikat `commerce.astro`, §3).                                                                                                                                                                                                                                                                 |
| `abac-policies.astro`                                                                                                                                               | SP                | partially adopt                                                   | 2 situs `.status-badge` → SP. 2 situs `.module-toggle` adalah tombol aksi enable/disable — no change (lihat §4).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `audit-trail.astro`                                                                                                                                                 | SP, TL (eval)     | partially adopt                                                   | 2 situs `.status-badge` → SP. 1 sinyal berbentuk timeline (history audit inheren kronologis) — evaluasi TL hanya bila/saat tampilan detail drill-in ditambahkan; layar saat ini adalah tabel datar.                                                                                                                                                                                                                                                                                                                                                                                                              |
| `blog-ads.astro`                                                                                                                                                    | SP                | partially adopt                                                   | 3 situs `.status-badge` → SP.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `blog.astro`                                                                                                                                                        | SP                | partially adopt                                                   | 1 situs `.status-badge` → SP (berkas terbesar dalam inventori, 2.075 baris — hanya normalisasi status, tanpa perubahan struktural).                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `blog-homepage.astro`                                                                                                                                               | SP                | partially adopt                                                   | 2 situs `.status-badge` → SP.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `blog-institutions.astro`                                                                                                                                           | SP                | partially adopt                                                   | 1 situs `.status-badge` → SP.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `blog-pages.astro`                                                                                                                                                  | SP                | partially adopt                                                   | 1 situs `.status-badge` → SP.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `blog-presentation.astro`                                                                                                                                           | SP                | partially adopt                                                   | 2 situs `.status-badge` → SP.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `blog-taxonomy.astro`                                                                                                                                               | SP                | partially adopt                                                   | 1 situs `.status-badge` → SP.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `data-lifecycle.astro`                                                                                                                                              | SC, SP, TL (eval) | partially adopt                                                   | 11 situs `.stat-card` → SC; 4 situs `.status-badge` → SP; section "Run history" adalah daftar history terurut nyata → kandidat TL. 2 situs `.module-toggle` adalah tombol aksi (terapkan legal-hold, dry-run) — no change.                                                                                                                                                                                                                                                                                                                                                                                       |
| `domain-events.astro`                                                                                                                                               | SC, SP            | partially adopt                                                   | 4 situs `.stat-card` → SC; 2 situs `.status-badge` → SP.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `email-suppression.astro`                                                                                                                                           | SP                | partially adopt                                                   | Tanpa hasil grep `.status-badge` tapi subjek layar adalah alasan/status suppression — perlu dibaca untuk mengonfirmasi markup saat ini sebelum berkomitmen ke SP; tentatif.                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `email-templates.astro`                                                                                                                                             | SP                | partially adopt                                                   | 1 situs `.status-badge` → SP.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `form-drafts.astro`                                                                                                                                                 | SP                | partially adopt                                                   | 1 situs `.status-badge` → SP.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `idn-regions.astro`                                                                                                                                                 | SC, SP            | partially adopt                                                   | 5 situs `.stat-card` → SC; 1 situs `.status-badge` → SP. 3 situs `.module-toggle` adalah tombol aktivasi/rollback dataset (ADR-0046, sengaja high-friction) — no change, dan secara spesifik **tidak boleh** menjadi switch sesuai aturan toggle issue sendiri.                                                                                                                                                                                                                                                                                                                                                  |
| `invitations.astro`                                                                                                                                                 | SP                | partially adopt                                                   | Tanpa hasil grep `.status-badge`; status undangan (pending/diterima/kedaluwarsa) adalah kandidat SP yang masuk akal — tentatif, perlu dibaca.                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `machine-credentials.astro`                                                                                                                                         | SP                | partially adopt                                                   | Tanpa hasil grep `.status-badge`; status kredensial adalah kandidat SP yang masuk akal — tentatif, perlu dibaca.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `modules.astro`                                                                                                                                                     | SP                | partially adopt                                                   | 2 situs `.status-badge` → SP. 3 situs `.module-toggle` adalah tombol aksi enable/disable modul — secara eksplisit **no change**; ini adalah situs `.module-toggle` paling berisiko-tinggi dalam inventori dan kasus terjelas untuk berkoordinasi dengan pekerjaan dialog-konfirmasi #854 daripada toggle visual.                                                                                                                                                                                                                                                                                                 |
| `newsletter.astro`                                                                                                                                                  | SC, SP            | partially adopt                                                   | 2 situs `.stat-card` → SC; 1 situs `.status-badge` → SP. `.admin-filter-form` adalah `<select>`, bukan tab — no change untuk SG.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `offices.astro`                                                                                                                                                     | SP                | partially adopt                                                   | 1 situs `.status-badge` → SP. 3 situs `.module-toggle` adalah tombol activate/deactivate — no change.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `partner-registry.astro`                                                                                                                                            | SP                | partially adopt                                                   | Sinyal rendah (tanpa hasil grep `.status-badge`); tentatif, perlu dibaca. 1 situs `.module-toggle` adalah tombol aksi — no change.                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `partners.astro`                                                                                                                                                    | SP                | partially adopt                                                   | Tanpa hasil grep `.status-badge`; status partner adalah kandidat SP yang masuk akal — tentatif, perlu dibaca.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `profiles.astro`                                                                                                                                                    | SP                | partially adopt                                                   | 1 situs `.status-badge` → SP. (Satu hasil grep "bulk" adalah komentar dokumentasi yang menyatakan merge profil secara eksplisit menghindari daftar bulk — mengonfirmasi tidak ada kandidat BB di sini.)                                                                                                                                                                                                                                                                                                                                                                                                          |
| `push-notifications.astro`                                                                                                                                          | SC                | partially adopt                                                   | 4 situs `.count-pill` mengindikasikan jumlah bergaya KPI; perlu dibaca untuk mengonfirmasi berbentuk `.stat-card` sebelum berkomitmen ke SC. `.admin-filter-form` adalah `<select>` — no change untuk SG.                                                                                                                                                                                                                                                                                                                                                                                                        |
| `registrations.astro`                                                                                                                                               | SP                | partially adopt                                                   | Tanpa hasil grep `.status-badge`; status registrasi adalah kandidat SP yang masuk akal — tentatif, perlu dibaca.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `roles.astro`                                                                                                                                                       | SP                | partially adopt                                                   | 1 situs `.status-badge` → SP. 3 situs `.module-toggle` adalah tombol aksi (proteksi system-role, activate/deactivate) — no change.                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `security.astro`                                                                                                                                                    | SP                | partially adopt                                                   | 2 situs `.status-badge` → SP.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `seo.astro`                                                                                                                                                         | SP                | partially adopt                                                   | 3 situs `.status-badge` → SP (pengguna `.module-toggle` terbanyak dengan 7 situs, semua terkonfirmasi tombol aksi: save/lifecycle/delete redirect, resolve observation — no change untuk semuanya).                                                                                                                                                                                                                                                                                                                                                                                                              |
| `site-search.astro`                                                                                                                                                 | SC, SP            | partially adopt                                                   | 5 situs `.stat-card` → SC; 3 situs `.status-badge` → SP. 2 situs `.module-toggle` adalah tombol aksi — no change.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `subject-requests.astro`                                                                                                                                            | SP                | partially adopt                                                   | **Sudah diperbaiki** (#861, item 4 dari #854): `{request.status}`/`{request.requestType}` tidak lagi dirender mentah — keduanya kini lewat peta lokal `REQUEST_STATUS_LABEL`/`REQUEST_TYPE_LABEL` di frontmatter halaman. SP (styling status-badge) masih terbuka.                                                                                                                                                                                                                                                                                                                                               |
| `sync.astro`                                                                                                                                                        | SC, SP            | partially adopt                                                   | 4 situs `.stat-card` → SC; 3 situs `.status-badge` → SP.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `tenant/domains.astro`                                                                                                                                              | SP                | partially adopt                                                   | 1 situs `.status-badge` → SP. 3 situs `.module-toggle` (verify, set-primary, delete) adalah tombol aksi terkonfirmasi — no change.                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `tenants.astro`                                                                                                                                                     | SC, SP            | partially adopt                                                   | 4 situs `.stat-card` → SC; 2 situs `.status-badge` → SP.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `theming.astro`                                                                                                                                                     | SP                | partially adopt                                                   | 5 situs `.status-badge` → SP. 4 situs `.module-toggle` (draft submit, preview, publish, rollback) adalah tombol aksi terkonfirmasi, termasuk dua tombol paling dekat-dengan-publish dalam inventori — secara eksplisit no change, rasional sama dengan `modules.astro`.                                                                                                                                                                                                                                                                                                                                          |
| `user-groups.astro`                                                                                                                                                 | SP                | partially adopt                                                   | Tanpa hasil grep `.status-badge`; sinyal rendah, tentatif — perlu dibaca.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `users.astro`                                                                                                                                                       | SP                | partially adopt                                                   | 1 situs `.status-badge` → SP. 4 situs `.module-toggle` adalah tombol aksi (deactivate adalah aksi pengubah-status, sesuai pola `awcms-admin-users-rbac-notes` yang sudah ada "deactivate = perubahan status", bukan switch hidup) — no change, koordinasi dengan #854.                                                                                                                                                                                                                                                                                                                                           |
| `email-suppression.astro`, `invitations.astro`, `machine-credentials.astro`, `partner-registry.astro`, `partners.astro`, `registrations.astro`, `user-groups.astro` | —                 | _(baris tentatif di atas; diulang di sini hanya sebagai penanda)_ | 7 layar ini **tidak** punya hasil grep `.status-badge`/`.count-pill` sama sekali, artinya entah mereka merender status sebagai teks polos atau tidak punya konsep status. **Status enum mentah kini diperbaiki** oleh #861 (item 4 dari #854) di mana pun berlaku — `email-suppression.astro` (`entry.reason`), `invitations.astro` (`invitation.status`), `machine-credentials.astro` (`credential.status`), dan `partner-registry.astro` (`partner.status`) kini semuanya lewat peta label terjemahan. Pertanyaan styling SP `.status-badge` (subjek asli baris ini) tidak terpengaruh dan masih perlu dibaca. |

### 6.3 Layar operasional OMES / platform

| Layar                            | Primitif          | Klas.           | Perubahan diperlukan                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------- | ----------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `omes/ai-privacy.astro`          | SP                | partially adopt | 4 situs `.status-badge` → SP.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `omes/arsitektur.astro`          | SP                | partially adopt | 2 situs `.status-badge` → SP. Merender kartu diagram bespoke `.omes-architecture-card*` — struktural berbeda dari tile KPI, **no change** untuk SC (memaksakannya akan salah merepresentasikan diagram arsitektur sebagai metrik).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `omes/audit.astro`               | SP                | partially adopt | 1 situs `.status-badge` → SP.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `omes/backups.astro`             | SC, SP            | partially adopt | 3 situs `.stat-card` → SC; 3 situs `.status-badge` → SP.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `omes/deployments.astro`         | SC, SP            | partially adopt | 3 situs `.stat-card` → SC; 2 situs `.status-badge` → SP.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `omes/enrollments.astro`         | SP                | partially adopt | 1 situs `.status-badge` → SP.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `omes/health.astro`              | SC, SP, TL        | **adopt**       | 3 situs `.stat-card` → SC; 3 situs `.status-badge` → SP; sinyal TL terkuat dalam inventori di luar `approvals.astro` — tampilan `mode: "history"` (`fetchHealthHistory`, dicapai lewat tautan "View history" tiap baris) adalah persis bentuk history snapshot terurut yang disasar `.admin-timeline`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `omes/hermes.astro`              | SP                | partially adopt | 1 situs `.status-badge` → SP.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `omes/mission-control.astro`     | SP                | partially adopt | Beberapa situs `.admin-status-pill` untuk status objek; adegan 3D bersifat dekoratif (`.omes-mc-canvas`, `aria-hidden`), tampilan kanonis adalah daftar objek yang aksesibel di bawahnya. Tidak ada tile `.stat-card` atau primitif lain yang dibutuhkan. Mode Riwayat (ahliweb/omes#266) menambahkan banner berarsir persisten (`.omes-mc-banner-historical`), daftar peristiwa `<ol>` tersinkron (`.omes-mc-event`, `aria-current="step"`) dan kontrol transport replay, sebagai kelas ber-lingkup halaman di `omes-control-center.css`; primitif `.btn`/`.admin-status-pill` yang sudah ada dipakai ulang. Aksi kontekstual (ahliweb/omes#267) menambahkan daftar aksi HUD, lencana "Perlu persetujuan", baris peringatan, dan panel preflight, memakai ulang aturan ber-lingkup halaman di atas ditambah satu kelas baru `.omes-mc-warning` di `omes-control-center.css`, dibangun di atas primitif `.btn` dan `ConfirmDialog` bersama. |
| `omes/index.astro`               | lihat §6.1        | —               | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `omes/jobs.astro`                | SC, SP            | partially adopt | 3 situs `.stat-card` → SC; 1 situs `.status-badge` → SP.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `omes/operations.astro`          | SP                | partially adopt | 1 situs `.status-badge` → SP.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `omes/orkestrasi-langsung.astro` | SP                | partially adopt | 4 situs `.status-badge` → SP. `.admin-filter-bar` adalah filter kedalaman `<select>`, bukan tab — no change untuk SG.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `omes/progres-hermes.astro`      | SP                | partially adopt | 4 situs `.status-badge` → SP.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `omes/servers.astro`             | SC, SP, TL (eval) | partially adopt | 3 situs `.stat-card` → SC; 3 situs `.status-badge` → SP. Komentar dokumentasi di baris 516 mengonfirmasi decommission mempertahankan "enrollment and audit history" — kandidat TL yang masuk akal untuk tampilan history masa depan, belum ada sebagai layar hari ini.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

### 6.4 Alur detail / operasional / history

| Layar                  | Primitif   | Klas.           | Perubahan diperlukan                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------- | ---------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `approvals.astro`      | SP, TL     | **adopt**       | Sinyal TL terkuat dalam inventori: section "Instance history" (`#instance-history`, di-fetch per `?instance=<id>`) adalah daftar `WorkflowInstanceHistoryEntry[]` terurut nyata — cocok langsung `.admin-timeline`. 3 section `data-table` (tasks/approvals/delegations) membawa kolom status → SP. `.admin-two-pane` adalah kecocokan yang masuk akal untuk relasi task-list ↔ instance-history (saat ini drill-in query-param, bukan split view) tapi itu adalah **redesign layout**, bukan sekadar swap kelas — ditandai untuk evaluasi gelombang 4, belum diputuskan-duluan sebagai adopt di sini. |
| `business-scope.astro` | SP, TL     | partially adopt | Section "Conflict history" (`#business-scope-conflicts-heading`) adalah daftar history terurut nyata → TL. Tanpa hasil grep `.status-badge` tapi state konflik SoD masuk akal berbentuk SP — tentatif. 1 situs `.module-toggle` adalah tombol aksi — no change.                                                                                                                                                                                                                                                                                                                                        |
| `domain-events.astro`  | lihat §6.2 | —               | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `audit-trail.astro`    | lihat §6.2 | —               | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `sync.astro`           | lihat §6.2 | —               | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

### 6.5 Layar settings / konfigurasi

| Layar                       | Primitif | Klas.           | Perubahan diperlukan                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------- | -------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `account.astro`             | SP       | partially adopt | `mfaEnabled` adalah boolean nyata terverifikasi-server (ADR-0096) tapi enrolment/disable MFA adalah alur multi-langkah (enrol dengan secret TOTP, konfirmasi kode; disable kemungkinan re-otentikasi) — **bukan** kandidat instant-flip yang aman, jadi **no change** untuk TG. State enabled/disabled MFA dan state current/active tiap sesi adalah kandidat SP yang masuk akal sebagai gantinya — tentatif, perlu dibaca markup saat ini (tanpa hasil grep `.status-badge`). |
| `blog-settings.astro`       | —        | no change       | Sinyal grep nol pada kelas apa pun yang relevan-primitif; form settings biasa. Tanpa kecocokan paksa.                                                                                                                                                                                                                                                                                                                                                                          |
| `site-profile.astro`        | —        | no change       | Sinyal grep nol; form settings biasa.                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `sidebar-menu.astro`        | —        | no change       | UI reorder/builder di atas `.admin-table` (bespoke, bukan `.data-table`) tanpa konsep status atau KPI — tak satu pun dari delapan primitif cocok untuk alat pengurutan menu.                                                                                                                                                                                                                                                                                                   |
| `modules/[moduleKey].astro` | —        | no change       | Dikonfirmasi dengan membaca berkas: form settings (`#module-settings-form.admin-form`) dengan fallback `.state-notice`, tanpa markup table/status/stat sama sekali.                                                                                                                                                                                                                                                                                                            |
| `access-policies.astro`     | SP       | partially adopt | Dikonfirmasi dengan membaca berkas: alat read + simulate (sengaja bukan layar authoring, sesuai komentar dokumentasinya sendiri) untuk evaluator kebijakan DSL. Vonis allow/deny simulator adalah satu-satunya pemakaian SP yang masuk akal — sisanya layar ini adalah form, bukan daftar.                                                                                                                                                                                     |

### 6.6 Media

| Layar                                                                                                 | Primitif                           | Klas.                                                                 | Perubahan diperlukan                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `media.astro`                                                                                         | SC, SP (bukan MG — lihat di bawah) | **partially adopt**                                                   | `.admin-stat-card`/`.admin-status-pill` mendarat (gelombang 5, Issue #864); `.admin-media-grid` TIDAK — tabel objek `media.astro` sengaja tidak merender thumbnail (keputusan keamanan yang terdokumentasi di header berkas itu sendiri), sehingga framing "adopsi media unggulan" baris ini semula mengasumsikan markup yang tidak dimiliki layar ini.                                                                                                                                                          |
| `src/lib/ui/media-picker-client.ts` (dikonsumsi `blog.astro`, `blog-ads.astro`, `site-profile.astro`) | MG                                 | **adopt** ([Issue #872](https://github.com/ahliweb/awcms/issues/872)) | Konsumen `.admin-media-grid` nyata yang dimiliki kedua repo — grid thumbnail-nya adalah target migrasi langsung. `blog-homepage.astro`, konsumen keempat yang disebut issue, tidak punya markup pemilih untuk dimigrasikan (diverifikasi lewat grep). Kontrak publik pemilih, seleksi keyboard, nama aksesibel dan alt text dipertahankan persis sama; ini mendarat sebagai perubahan markup/kelas ditambah indikator `aria-pressed` pilihan-saat-ini yang aditif, bukan perubahan atas perilaku yang sudah ada. |

---

**Total (klasifikasi saat audit Gelombang 1 — hasil akhir per-layar ada di
§7):** 63 layar diaudit. **Adopt: 4** (`comments.astro`, `omes/health.astro`,
`approvals.astro`, `index.astro`). **Partially adopt: 53** (normalisasi
hanya-SP adalah pola dominan; segelintir juga membawa SC dan/atau evaluasi
TL — `media.astro` pindah ke sini dari "adopt" setelah gelombang 5
mengonfirmasi ia tidak punya markup ber-bentuk `.admin-media-grid`, §6.6).
**No change: 6**
(`blog-settings.astro`, `site-profile.astro`, `sidebar-menu.astro`,
`modules/[moduleKey].astro`, plus `omes/arsitektur.astro` dan kolom _toggle_
setiap situs `.module-toggle`-saja secara spesifik — klasifikasi _toggle_
adalah no-change di 16 berkas bahkan di mana kolom _status_ adalah
partially-adopt di berkas yang sama). Tidak ada layar diklasifikasi
**adopt** untuk `.admin-toggle` — setiap permukaan boolean nyata yang
ditemukan (enable/disable modul, verify/primary domain, aktivasi dataset,
publish tema) digerbangi aksi teraudit yang layak-konfirmasi, bukan switch
instan yang aman; memaksakan `.admin-toggle` ke satu pun dari mereka akan
melanggar aturan toggle issue sendiri.

## 7. Usulan paket kerja gelombang 2–6 — file-disjoint

Diurutkan mengikuti penomoran gelombang usulan issue (§Implementation
approach). Tiap paket mendaftar berkas persis sehingga banyak agen bisa
berjalan paralel sesuai instruksi issue ("multiple agents may work in
parallel only on independent screen families; shared CSS/components must be
changed serially"). **Berkas bersama ditandai per paket** — paket mana pun
yang menyentuh `src/styles/admin.css` atau `src/styles/admin-screens.css`
harus mendarat serial relatif terhadap paket lain yang menyentuh berkas
sama, dan perubahan markup tiap paket hanya menyentuh string locale
layarnya sendiri jika teks baru yang bisa diterjemahkan diperkenalkan
(migrasi label status-pill/segmented memakai ulang string `t()` yang sudah
ada dan seharusnya tidak memperkenalkan yang baru).

### Gelombang 2 — Dashboard / reporting / analytics — **SELESAI** ([Issue #860](https://github.com/ahliweb/awcms/issues/860))

- **Berkas:** `src/pages/admin/index.astro`, `src/pages/admin/analytics.astro`,
  `src/pages/admin/reporting.astro` (hanya bagian stat-card, sesuai cakupan
  gelombang ini sendiri — evaluasi TL "Rebuild history" tetap di gelombang
  4), `src/pages/admin/omes/index.astro` — keempatnya sudah bermigrasi ke
  `.admin-stat-card`/`.admin-stat-card-grid`/`.admin-stat-card-label`/
  `.admin-stat-card-value`/`.admin-stat-card-caption`.
- **Bersama:** `src/styles/admin-screens.css` tidak disentuh — family
  `.stat-card`/`.stat-grid`-nya tetap didefinisikan untuk ~14 layar yang
  belum bermigrasi di gelombang 3/6, persis seperti yang diminta bagian ini
  semula. `.admin-stat-card-grid` di `src/styles/admin.css` dilipat ke
  deklarasi `.kpi-grid`/`.dashboard-grid` yang sudah ada (bentuk breakpoint
  sama) alih-alih aturan berdiri sendiri baru, untuk menjaga biaya
  asset-budget. `src/styles/omes-control-center.css` mendapat perluasan
  daftar selector (bukan blok duplikat) pada aturan telemetry/dot
  `.stat-card`-nya yang sudah ada, mencakup `.admin-stat-card` juga,
  sehingga 8 layar OMES lain (masih di `.stat-card`, gelombang 6) tetap
  mempertahankan gayanya.
- **Keputusan diambil:** memport `.stat-head`/`.stat-delta` ke
  `.admin-stat-card` sebagai `.admin-stat-card-head` (baris ikon,
  berpasangan dengan `.admin-tile` yang sudah ada) dan
  `.admin-stat-card-delta[data-tone="positive"\|"negative"]` (§4) — hanya
  warna di `admin.css` (tanpa glyph `::before`, untuk menahan kenaikan
  asset-budget gelombang ini pada kebutuhan nyata 4 layar); komentar
  dokumentasi modifier itu sendiri mewajibkan konsumennya menulis karakter
  awalan "+"/"-"/"±" ke teks nilai dan memasangkan kata tersembunyi-visual,
  sehingga "tidak disampaikan lewat warna saja" (§Aturan yang berlaku di
  seluruh dokumen) dipenuhi oleh kontrak konsumen, bukan pseudo-element
  CSS. Belum ada konsumen nyata untuk kedua modifier ini — tidak satu pun
  dari empat layar yang bermigrasi menghitung delta tren atau ikon KPI hari
  ini (data nyata saja, §Aturan yang berlaku di seluruh dokumen) — jadi
  keduanya menunggu layar mana pun di masa depan yang membutuhkannya.
  `APP_BUDGET_BYTES` milik `build:asset-budget:check` dinaikkan dari 239.956
  menjadi 240.975 (total terukur aktual, tanpa margin tambahan — lihat
  komentar ledger `scripts/client-asset-budget.ts` sendiri).

### Gelombang 3 — List-management: normalisasi status/filter/bulk — **SELESAI** ([Issue #862](https://github.com/ahliweb/awcms/issues/862))

Dipecah jadi dua sub-paket aman-serial karena menyentuh set berkas berbeda
tapi CSS bersama yang sama:

- **3a — unggulan (adopt):** hanya `src/pages/admin/comments.astro`.
  Tab segmented + bulk bar + status pill, memakai endpoint `bulk-moderate`
  yang sudah ada. Tidak ada layar lain bergantung pada berkas ini.
- **3b — sapuan status-pill (23 berkas):** `src/pages/admin/abac-policies.astro`,
  `audit-trail.astro`, `blog-ads.astro`, `blog.astro`, `blog-homepage.astro`,
  `blog-institutions.astro`, `blog-pages.astro`, `blog-presentation.astro`,
  `blog-taxonomy.astro`, `domain-events.astro`, `email-templates.astro`,
  `form-drafts.astro`, `idn-regions.astro`, `modules.astro`, `newsletter.astro`,
  `offices.astro`, `profiles.astro`, `roles.astro`, `security.astro`,
  `seo.astro`, `site-search.astro`, `sync.astro`, `tenant/domains.astro`,
  `tenants.astro`, `theming.astro`, `users.astro` — migrasikan markup
  `.status-badge` ke `.admin-status-pill` (data-variant → data-tone), satu
  bentuk find-and-replace yang bisa diprediksi per berkas, tanpa perubahan
  toggle/bulk/segmented.
- **3c — baca-dulu (7 berkas, penanganan status belum jelas):**
  `email-suppression.astro`, `invitations.astro`, `machine-credentials.astro`,
  `partner-registry.astro`, `partners.astro`, `registrations.astro`,
  `user-groups.astro`, plus `subject-requests.astro` (perbaikan enum-mentah,
  §6.2) — tiap satu perlu dibaca sebelum perubahannya ditulis, karena audit
  ini tidak bisa mengonfirmasi markup status saat ini hanya dari sinyal grep.
- **Bersama:** `src/styles/admin.css` (pensiunkan `.status-badge`/
  `.status-dot` setelah 3a+3b+3c mendarat, atau simpan keduanya tanpa batas
  waktu sebagai alias — keputusan untuk siapa pun yang mendaratkan terakhir
  dari ketiga sub-paket ini, bukan audit ini)

**Mendarat.** Ketiga sub-paket mendarat bersama di Issue #862: `comments.astro`
(3a), sapuan status-pill 26 berkas (3b — jumlah berkas di atas kurang tercatat 3;
pola template-literal `status-badge status-badge--${variant}` di `newsletter.astro`
butuh sunting khusus bentuknya, sisanya adalah find-and-replace mekanis), dan
pembacaan 3c. Dari pembacaan 3c: `invitations.astro`, `machine-credentials.astro`,
`partner-registry.astro`, `subject-requests.astro`, dan kolom state delegated-grant
milik `partners.astro` memang membawa status per-baris nyata dan mengadopsi
`.admin-status-pill`; `email-suppression.astro` (sebuah KODE alasan, bukan status
siklus hidup), `registrations.astro` dan `user-groups.astro` (tanpa konsep status
sama sekali) dikonfirmasi tidak ada yang perlu dimigrasikan dan tetap tak
tersentuh, sesuai aturan "jangan pernah memaksakan primitif pada layar yang tidak
cocok dengannya". `src/styles/admin.css` tetap mendefinisikan `.status-badge`/
`.status-dot` — **belum** dipensiunkan oleh issue ini; #866 melacak pensiun
akhirnya setelah setiap gelombang mendarat. `APP_BUDGET_BYTES`
(`scripts/client-asset-budget.ts`) dinaikkan sebesar pertumbuhan terukur
(tercatat di ledger berkas itu) untuk modul baru `src/lib/ui/admin-bulk-bar-client.ts`,
satu aturan CSS kecil `.cell-select`, dan perbaikan `flex-wrap` pada `.admin-segmented`
sendiri — `tests/e2e/responsive-360.e2e.ts` menangkap trek 5-opsi primitif bersama itu
meluap di 360px (konsumen nyata pertamanya), sehingga perbaikannya mendarat di
primitifnya, bukan tambalan per-layar. Sapuan status-pill sendiri tidak menambah CSS,
karena `.admin-status-pill` sudah diterbitkan, belum dipakai, sejak PR #813.

### Gelombang 4 — Alur detail/timeline/two-pane — **SELESAI** ([Issue #863](https://github.com/ahliweb/awcms/issues/863))

- **Berkas:** `src/pages/admin/approvals.astro`, `src/pages/admin/business-scope.astro`,
  `src/pages/admin/data-lifecycle.astro`, `src/pages/admin/omes/health.astro`,
  `src/pages/admin/reporting.astro` (hanya section history — dikoordinasikan
  dengan gelombang 2, yang menyentuh berkas ini untuk stat card-nya)
- **Keputusan yang dibuat:** `approvals.astro` tetap memakai
  drill-in-by-query-param instance history-nya (`?instance=<id>`) — **tidak
  ada** perubahan routing `.admin-two-pane`. Audit ini sengaja membiarkan hal
  ini terbuka (§6.4); issue-nya sendiri yang memutuskan sebelum pekerjaan
  dimulai.
- **Yang mendarat:** setiap section ordered event/history yang teridentifikasi
  di §6.4 — instance history approval, conflict history business-scope,
  legal-hold history DAN run history data-lifecycle, snapshot history OMES
  health (hanya mode `?serverId=…` — tabel "terbaru per server" tenant-wide
  adalah satu baris per server, bukan history, dan tetap `.data-table`), dan
  rebuild history projection reporting — kini dirender sebagai `<ol
class="admin-timeline">` sungguhan berisi `<li class="admin-timeline-
item">`, dengan `<time datetime>` asli per item (tidak pernah hanya
  warna/posisi). Setiap status yang disentuh issue ini di lima layar tersebut
  (status task/delegation, status assignment/exception business-scope, flag
  konflik SoD, status legal-hold/run, status overall/stale/check-source OMES,
  status rebuild) berpindah dari `.status-badge` lama ke `.admin-status-pill`,
  tetap mempertahankan hook nilai mentah `data-status` (atau setara) tiap sel
  untuk test/CSS/JS. Section lain `reporting.astro` (kesehatan antrean email,
  freshness projection, run scheduled-export) tetap di `.status-badge` — di
  luar cakupan kepemilikan berkas issue ini, alasan yang sama dengan
  cakupan stat-card gelombang 2.
- **Bersama:** `src/styles/admin.css` mendapat reset kecil `.admin-timeline {
list-style: none; margin: 0; padding: 0; }` untuk wrapper `<ol>`-nya sendiri
  (primitive yang sudah ada sebelumnya hanya men-styling `-item`/`-label`/
  `-meta`, jadi `<ol>` polos akan menampilkan bullet/nomor bawaan browser di
  depan dot `::before` milik primitive itu sendiri). `APP_BUDGET_BYTES` milik
  `build:asset-budget:check` dinaikkan dari 248.045 menjadi 248.096 (nilai
  terukur aktual, tanpa margin tambahan — lihat catatan ledger
  `scripts/client-asset-budget.ts` sendiri).

### Gelombang 5 — Pola settings/toggle/media — **SELESAI** ([Issue #864](https://github.com/ahliweb/awcms/issues/864))

- **Berkas:** `src/pages/admin/account.astro` (hanya status-pill, tanpa
  toggle — §6.5), `src/pages/admin/media.astro` (media-grid + stat-card +
  status-pill, adopsi media unggulan), `src/pages/admin/access-policies.astro`
  (hanya pill vonis simulator)
- **Secara eksplisit di luar cakupan gelombang ini:** setiap situs
  `.module-toggle` (16 berkas, §4) — tak satu pun kandidat `.admin-toggle`;
  bila primitif dialog-konfirmasi #854 mendarat lebih dulu, koordinasi di
  sana bukan di sini
- **Bersama:** tidak ada
- **Keputusan yang dibuat:** `account.astro` dan `access-policies.astro`
  mendarat persis sesuai cakupan — `.admin-status-pill` pada badge
  SSO-tersambung, badge sesi-saat-ini, pill status dua-faktor baru, dan
  vonis Allow/Deny simulator (dibangun di sisi klien dari atribut
  `data-verdict-*` yang sudah diterjemahkan pada form, karena markup itu
  hidup di `<script>`, bukan Astro SSR). `media.astro` **tidak** mendarat
  sepertiga "media-grid" dari baris cakupannya sendiri di atas: tabel
  objeknya dengan sengaja tidak merender `<img>` (terdokumentasi di header
  berkas itu sendiri, terkait keputusan keamanan — menampilkan ulang gambar
  yang melanggar kebijakan kepada operator yang sedang menghapusnya adalah
  hasil yang salah), sehingga framing "adopsi media unggulan" §6.6
  mengasumsikan markup yang tidak dimiliki layar ini. `.admin-stat-card` dan
  `.admin-status-pill` mendarat di sana sebagai penukaran class sungguhan;
  `.admin-media-grid` tetap tidak diadopsi di sini — lihat baris
  `MediaGrid` doc 14 untuk aturan pemakaian yang ditetapkan dari ini.
  Satu-satunya markup berbentuk `.admin-media-grid` sungguhan di repo ini
  adalah pemilih bersama (`src/lib/ui/media-picker-client.ts` +
  `.media-picker-panel`/`.media-option`), dikonsumsi oleh `blog.astro`,
  `blog-ads.astro`, `blog-homepage.astro` dan `site-profile.astro` — keempatnya
  di luar kepemilikan berkas issue ini dan sedang dikerjakan pihak lain pada
  saat itu. Memigrasikannya adalah tindak lanjut yang dicakup bersama skrip
  itu dan keempat konsumennya.

### Tindak lanjut — pemilih media bersama mengadopsi `.admin-media-grid` — **SELESAI** ([Issue #872](https://github.com/ahliweb/awcms/issues/872))

- **Berkas:** `src/lib/ui/media-picker-client.ts`, `src/styles/admin-screens.css`;
  `src/pages/admin/blog.astro` (2 pemilih), `src/pages/admin/blog-ads.astro`,
  `src/pages/admin/site-profile.astro` (2 pemilih) masing-masing menambahkan
  `admin-media-grid` ke markup statis `.media-picker-panel`-nya
- **Diverifikasi lewat grep, bukan sekadar disebut di issue:**
  `blog-homepage.astro` — konsumen keempat yang disebut issue — tidak punya
  markup `.media-choice`/`.media-picker-panel` sama sekali. Ia menyebut
  `wireMediaPickers` hanya dalam komentar dokumentasi yang menjelaskan
  mengapa layar itu SENGAJA tidak memakai pemilih (`gallery_block` adalah
  daftar id berurutan, bukan kontrol pilih-satu; alasan ADR-0009). Tidak ada
  yang perlu dimigrasikan di sana.
- **Keputusan yang dibuat:** setiap thumbnail yang dibangun
  `wireMediaPickers` kini adalah `.admin-media-grid-tile` sungguhan, dan
  panel yang menampungnya membawa `admin-media-grid` — primitive yang sama
  yang diputuskan TIDAK diadopsi `/admin/media` (§6.6 di atas). `<img>` tile
  mengisi penuh sesuai kontrak primitive, sehingga tidak menyisakan ruang
  untuk label di bawah gambar milik pemilih sebelumnya — label itu
  (`describePickableMedia`: alt text, lalu caption, lalu nama berkas)
  berpindah menjadi overlay `.media-option-caption`, dan menjadi nama
  aksesibel tombol tile itu sendiri (tanpa `aria-label` terpisah). CSS
  grid/box duplikat milik pemilih sendiri — `display: grid` +
  `grid-template-columns` pada `.media-picker-panel`, serta
  border/background/radius yang dulu diulang `.media-option` — dihapus dari
  `admin-screens.css` sekarang `admin.css` menyediakan keduanya; hanya
  chrome berbatas/scroll milik panel dan overlay caption baru yang tersisa
  di sana. Nilai field saat ini (bila ada) ditandai saat panel dibuka ulang
  lewat `aria-pressed`/`data-selected`, tidak pernah lewat warna/outline
  tile saja (WCAG 1.4.1) — pemilih sebelumnya sama sekali tidak
  mengekspos keadaan "pilihan saat ini" dalam grid-nya sendiri, jadi ini
  aditif, bukan perubahan perilaku atas apa pun yang diminta issue untuk
  dipertahankan. `PICKER_LIST_URL`, `fetchPickableMedia`,
  `describePickableMedia`, dan signature `wireMediaPickers` semuanya tidak
  berubah.
- **Bersama:** `APP_BUDGET_BYTES` (`scripts/client-asset-budget.ts`)
  dinaikkan dari 250.423 ke 250.480 (total terukur aktual setelah
  pengurangan CSS di atas) — lihat catatan ledger berkas itu sendiri.

### Gelombang 6 — Permukaan admin khusus OMES — **SELESAI** ([Issue #865](https://github.com/ahliweb/awcms/issues/865))

- **Berkas:** `src/pages/admin/omes/ai-privacy.astro`, `omes/arsitektur.astro`
  (hanya status-pill, tanpa stat-card — §6.3), `omes/audit.astro`,
  `omes/backups.astro`, `omes/deployments.astro`, `omes/enrollments.astro`,
  `omes/hermes.astro`, `omes/jobs.astro`, `omes/operations.astro`,
  `omes/orkestrasi-langsung.astro`, `omes/progres-hermes.astro`,
  `omes/servers.astro` — semuanya dimigrasikan ke `.admin-status-pill`/
  `.admin-status-pill-dot` (`data-variant` -> `data-tone`), dan empat yang
  punya tile KPI (`backups`, `deployments`, `jobs`, `servers`) juga ke
  `.admin-stat-card`/`.admin-stat-card-grid`. Client script polling
  `orkestrasi-langsung.astro` (render-ulang activity-stream) dimigrasikan
  serentak agar badge yang dirender client cocok dengan baris SSR.
- **Bersama:** `src/styles/omes-control-center.css` diaudit — tidak
  memerlukan CSS baru. Berkas ini sudah membawa daftar selector ganda
  `.stat-card`/`.admin-stat-card` dari Issue #860 (gelombang 2), dan tidak
  pernah mendeklarasikan ulang `.status-badge`/`.admin-status-pill` sendiri:
  kedua kelas itu memakai custom property `--color-*-soft`/`-on-soft` yang
  sama yang sudah di-override berkas ini untuk palet gelap OMES, sehingga
  cascade tone (termasuk `danger`/`info`, yang tidak pernah didefinisikan
  `.status-badge` polos — lihat di bawah) ikut terbawa otomatis.
  `omes/health.astro` (gelombang 4, di luar cakupan #865) tetap butuh separuh
  `.stat-card` dari tiap pasangan selector berkas ini sampai Issue #866
  (gelombang 7) memigrasikannya — lihat bagian itu.
- **Keputusan yang diambil:** migrasi ini justru menyingkap bug styling
  laten, bukan memperkenalkannya — beberapa layar ini mengirim
  `data-variant="danger"`/`"info"` ke `.status-badge`, yang hanya pernah
  mendefinisikan `success`/`neutral`/`warning`; badge itu diam-diam
  merender dengan fill default yang tak terbedakan. `.admin-status-pill`
  mendefinisikan kelima tone, jadi sekarang badge itu merender sesuai
  maksudnya, tanpa perubahan logika markup. `build:asset-budget:check`'s
  `APP_BUDGET_BYTES` dinaikkan dari 248.045 menjadi 248.058 (total aktual
  terukur — satu-satunya pertumbuhan adalah literal template client script
  `orkestrasi-langsung.astro`, yang nama kelasnya jadi lebih panjang).

### Gelombang 7 — Sapuan akhir, pensiun kelas legacy, docs — **SELESAI** ([Issue #866](https://github.com/ahliweb/awcms/issues/866))

- **Berkas dimigrasikan (konsumen `.stat-card`/`.stat-grid`/`.stat-label`/
  `.stat-value`/`.stat-hint` terakhir):** `src/pages/admin/data-lifecycle.astro`,
  `site-search.astro`, `idn-regions.astro`, `tenants.astro`, `sync.astro`,
  `push-notifications.astro`, `domain-events.astro`, `omes/health.astro` —
  semuanya ke `.admin-stat-card`/`.admin-stat-card-grid`/
  `.admin-stat-card-label`/`.admin-stat-card-value`/`.admin-stat-card-caption`.
  `newsletter.astro` diverifikasi sudah dimigrasikan (gelombang 3) — tidak
  ada yang tersisa di berkas ini. Satu hit `.stat-value` tersisa di
  `omes/index.astro` adalah rujukan-silang komentar dokumentasi basi,
  dikoreksi ke `.admin-stat-card-value` (tidak perlu perubahan markup — ia
  sudah merender primitif itu sejak gelombang 2).
- **Berkas dimigrasikan (konsumen `.status-badge`/`.status-dot` terakhir):**
  empat bagian tersisa `src/pages/admin/reporting.astro` (kesehatan antrean
  email, kesegaran proyeksi, konfigurasi ekspor terjadwal, run ekspor
  terjadwal) — satu-satunya layar yang sengaja ditinggalkan gelombang 3/4
  pada pill legacy (cakupan kepemilikan berkas kedua gelombang itu sendiri,
  dicatat di atas). Dipindah ke `.admin-status-pill`/`.admin-status-pill-dot`
  dengan `data-variant` -> `data-tone`.
  `src/layouts/AdminLayout.astro` diperiksa dan dikonfirmasi tidak pernah
  menjadi konsumen kedua keluarga kelas ini (`.admin-sidebar-status-dot`
  adalah nama kelas tak-berkaitan yang sudah ada sebelumnya).
- **CSS legacy dipensiunkan:** blok aturan `.stat-card`/`.stat-grid`/
  `.stat-head`/`.stat-delta`/`.stat-label`/`.stat-value`/`.stat-hint`
  dihapus dari `src/styles/admin-screens.css`, dan blok aturan
  `.status-badge`/`.status-dot` dihapus dari `src/styles/admin.css`
  (deklarasi dasar) dan `src/styles/admin-screens.css` (tambahan varian
  tinted `info`/`danger`). Daftar selector ganda `src/styles/omes-control-center.css`
  (`.stat-card X, .admin-stat-card X { … }`, catatan Bersama gelombang 2 di
  atas) melepas separuh `.stat-card`-nya sekarang setiap layar OMES
  merender `.admin-stat-card` saja.
- **Gerbang regresi ditambahkan:** `tests/admin-legacy-classes-retired.test.ts`
  menyusuri setiap berkas `.astro`/`.ts`/`.tsx`/`.css` di bawah `src/` dan
  gagal bila salah satu dari sembilan token kelas yang dipensiunkan muncul
  lagi sebagai konsumen nyata (atribut class, literal string
  `classList`/`querySelector`, atau selector CSS) — komentar (termasuk
  narasi historis dokumen ini sendiri dan catatan provenance "ported from
  the legacy `.stat-grid`" yang tertinggal di `admin.css`) dilucuti lebih
  dulu lewat `stripComments` bersama `scripts/lib/source-text.ts`, sehingga
  sejarah tak pernah keliru dianggap konsumen hidup. Ketiga test khusus
  gelombang (`admin-stat-card-wave2.test.ts`, `admin-status-pill-wave3.test.ts`,
  `admin-timeline-wave4.test.ts`) yang dulu memastikan CSS legacy tetap
  terdefinisi ("#866 retires it") dibalik menjadi memastikan absennya.
- **Anggaran aset menyusut** — gelombang pertama epik ini yang menyusutkan
  anggaran, bukan menaikkannya, karena mempensiunkan seluruh keluarga
  komponen legacy menghapus CSS tanpa biaya pengganti. Mendarat di atas
  [Issue #872](https://github.com/ahliweb/awcms/issues/872) (yang menaikkan
  `APP_BUDGET_BYTES` ke 250.566 untuk adopsi `.admin-media-grid` picker
  media bersama), `scripts/client-asset-budget.ts`'s `APP_BUDGET_BYTES`
  diturunkan dari 250.566 menjadi 248.033 dan `PER_FILE_CSS_BUDGET_BYTES`
  dari 57.300 menjadi 56.800 (keduanya nilai aktual terukur — lihat komentar
  ledger berkas itu sendiri).
- **Sapuan responsive/E2E:** `tests/e2e/responsive-360.e2e.ts` (360px/1024px
  pada saat issue ini; sejak #884 ia menyapu 360px, 640×360 = zoom browser
  200% pada desktop 1280×720, 768px tablet potret, dan 1024px — tanpa scroll
  menyamping di semuanya) dan `tests/e2e/admin-screens-render.e2e.ts`
  (setiap layar admin merender) dijalankan ulang terhadap Postgres 18.4
  segar + migrasi penuh + tenant yang di-seed — keduanya hijau, plus suite
  penuh `bun run test:e2e` (33 lulus, 8 dilewati untuk spec yang digerbangi
  env di luar cakupan issue ini — `admin-deny-path`/`admin-read-only-access`
  butuh pengguna kedua yang di-seed, `cwv-lab` butuh `E2E_CWV_LAB=1`). Repo
  ini tidak punya harness `@axe-core/playwright` di bawah `tests/e2e/` pada
  saat issue ini — kriteria akseptansi smoke aksesibilitasnya adalah
  `responsive-360`/`admin-screens-render` plus aturan komposisi manual di
  doc 14, bukan spec axe khusus. **Ditutup oleh [Issue
  #877](https://github.com/ahliweb/awcms/issues/877):** `tests/e2e/a11y-axe.e2e.ts`
  kini menjalankan `@axe-core/playwright` (tag WCAG 2.0/2.1 A+AA) terhadap
  delapan rute representatif yang diubah epik ini — `/admin`,
  `/admin/comments`, `/admin/users`, `/admin/approvals`, `/admin/media`,
  `/admin/omes`, `/admin/omes/jobs`, `/admin/site-profile` — dalam tema
  terang MAUPUN gelap, pada 360px dan desktop, plus `ConfirmDialog`/
  `ReasonPanel` ADR-0125 dibuka (lalu dibatalkan). Dijalankan sungguhan
  terhadap Postgres 18.4 segar + migrasi penuh + tenant ter-seed saat
  mengerjakan issue ini, ia menemukan dan repo ini memperbaiki lima
  pelanggaran `critical`/`serious` nyata yang sudah terlanjur dikirim
  gelombang-gelombang epik ini: wordmark `.admin-brand` kehilangan nama
  aksesibelnya di bawah 768px (`display: none` menghapus elemen dari
  komputasi nama aksesibel, bukan cuma dari tata letak — `link-name`,
  serious), `<label>` alasan `ReasonPanel` yang tidak pernah menjadi `<label
for>` sungguhan (`label`, critical), `.reason-panel { display: flex }`
  yang berlaku tanpa syarat alih-alih di-scope ke `[open]` (CSS asal-penulis
  mengalahkan `dialog:not([open]) { display: none }` bawaan user-agent
  terlepas dari `!important`, sehingga panel yang dibatalkan tetap bertata
  letak dan tampil di layar setelah `.close()`), `.admin-logout` memakai
  `--color-text-muted` yang theme-aware pada latar sidebar yang selalu gelap
  alih-alih `--color-sidebar-text` (`color-contrast`, serious, terukur
  3,07:1 terhadap ambang 4,5:1), dan dashboard `.dd-alert` menggunakan
  `--color-danger-strong` sebagai teks pada `--color-surface` (`color-contrast`,
  serious, tema gelap saja: 3,81:1 terhadap ambang 4,5:1), diperbaiki dengan
  bertukar ke `--color-danger` (5,81:1 gelap; terang tidak berubah di 4,83:1
  karena kedua token adalah `#dc2626` di sana). Lihat komentar header
  `tests/e2e/a11y-axe.e2e.ts` sendiri untuk alasan sapuan ini juga berjalan
  di bawah `reducedMotion: "reduce"` — animasi masuk 240ms `.fade-in-up`
  benar-benar menurunkan kontras terender di tengah transisi, yang disampel
  axe sebagai warna piksel alih-alih mempercayai computed style, dan
  penurunan sesaat itu bukan subjek kriteria ini.
- **Docs:** dokumen ini (semua gelombang ditandai SELESAI, §6.6 dikoreksi
  di bawah), `docs/awcms/14_ui_ux_design_system.md`, dan skill
  `awcms-ui-screen` — semuanya dimutakhirkan untuk menyatakan aturan
  komposisi sebagai fakta, bukan keputusan tertunda. `docs/PROJECT_STATE.md`
  §4 tidak melacak epik #858 sebagai putaran rekomendasi (ia dibuka dan
  dikerjakan sebagai rantai issue GitHub, bukan putaran §4), sehingga tidak
  ada entri ditambahkan di sana.

## 8. Apa yang TIDAK dilakukan Gelombang 1 (historis — diselesaikan gelombang berikutnya)

Pada akhir Gelombang 1 (audit docs-only), bagian ini mencatat tiga
pertanyaan terbuka yang disengaja. Ketiganya kini terselesaikan:

- Gelombang 1 sendiri tidak mengubah berkas `.astro`/`.ts`/`.css` mana pun —
  gelombang 2–7 mengubahnya, sesuai paket di §7, semuanya kini **SELESAI**.
- Pertanyaan afordansi delta/head `.stat-card` vs `.admin-stat-card` (§4)
  diselesaikan gelombang 2: di-port sebagai `.admin-stat-card-head`/
  `.admin-stat-card-delta`. Pertanyaan two-pane `approvals.astro` (§6.4)
  diselesaikan gelombang 4: mempertahankan drill-in query-param, tanpa
  perubahan routing `.admin-two-pane`.
- `docs/awcms/14_ui_ux_design_system.md` kini menyatakan aturan komposisi
  yang ditetapkan epik ini sebagai fakta (§9) — aturan itu tidak lagi
  sekadar disurvei.

## 9. Tautan dokumentasi

- [`docs/awcms/14_ui_ux_design_system.md`](14_ui_ux_design_system.md) §
  Component library mendokumentasikan `.admin-status-pill`/`.admin-stat-card`
  dan aturan komposisi lain yang ditetapkan epik ini (segmented sebagai nav
  - aria-current, bulk bar hanya di atas endpoint bulk yang sudah ada,
    timeline sebagai `<ol>`+`<time>`) sebagai kosakata admin SAAT INI —
    kelas legacy `.status-badge`/`.stat-card` yang dulu juga
    didokumentasikannya dipensiunkan Issue #866 (gelombang 7) dan tidak lagi
    ada di `src/styles/`.
- [`docs/awcms/README.md`](README.md) mendaftar dokumen ini di tabel indeks,
  di sebelah `family-compatibility.md`.
