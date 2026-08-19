🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0101-client-asset-budget-splits-by-audience.md)

<!-- i18n-source-hash: sha256:7322f56dc38f929ea4fc9cafb40c42d563e89c9153aad01ec58de83d538805d6 -->

# ADR-0101 — Anggaran aset klien dipisah menurut audiens

- **Status:** Accepted
- **Tanggal:** 2026-08-20
- **Pengambil keputusan:** ahliweb
- **Terkait:** Issue #590; `scripts/client-asset-budget.ts`; ADR-0070 (awcms-astro memikul permukaan publik); ADR-0083 (akar domain berhenti menjadi 404); Issue #552 (biaya per-layar diturunkan alih-alih plafon dinaikkan)

## Konteks

`build:asset-budget:check` menggerbangi satu angka sejak 2026-08-05: total byte `dist/client`, terhadap satu plafon. Premisnya tertulis di pesan kegagalannya sendiri — gejala yang ia cegah datang sebagai **"halaman publik terasa lambat"**.

Issue #590 menanyakan dari mana 42 kB pertumbuhan berasal, dan apakah gerbang ini perlu membedakan aset yang diunduh pembaca publik dari aset yang hanya dimuat layar admin. Menjawabnya menuntut atribusi yang belum pernah dikerjakan siapa pun.

### Yang ditemukan pengukuran

Atribusi diambil dari manifest rute SSR milik Astro sendiri (`dist/server/entry.mjs`), yang memetakan tiap rute ke aset yang ditautkannya — bukan dari nama berkas, yang justru menyesatkan di sini (chunk CSS terbesar bernama `error-log.*.css` padahal ia `admin.css` yang dipakai bersama).

Diukur pada `main` @ `05b55b32`, build bersih:

| audiens                                                           |                                             byte | aset                                                           |
| ----------------------------------------------------------------- | -----------------------------------------------: | -------------------------------------------------------------- |
| **Pembaca** — halaman konten publik                               |                                       **21.415** | `css/public-content.css` (16.800) + `js/news-share.js` (4.615) |
| Halaman aplikasi anonim — `/`, lima halaman auth, preview theming |                                       19.460 CSS | `auth.css`, `index.css`, `_token_.css`, `motion.css`           |
| **Admin** — pasca-login                                           | **47.157 CSS** plus hampir seluruh skrip halaman | 8 berkas CSS, 40.587 B di antaranya admin-saja                 |
| Service worker push                                               |                                            6.245 | `push-sw.js`, didaftarkan dari konsol admin                    |

Fakta struktural yang menentukan: **halaman konten publik memuat nol aset `_astro`.** Halaman-halaman itu bukan komponen Astro. `src/pages/blog/`, `[...path].ts`, feed, dan sitemap adalah rute `.ts` yang memancarkan shell HTML-nya sendiri lewat `blog-content/domain/public-page-rendering.ts`, yang menautkan dua path absolut dari `public/`. Satu-satunya rute non-admin yang punya `styles` di manifest adalah `/`, kelima halaman auth, dan `/theming/preview/[token]`.

Jadi berat pembaca adalah 21.415 B — **11% dari total 186.689 B yang didominasi admin.**

### Kenapa itu membuat plafon tunggal tidak layak bagi premisnya sendiri

Anggaran mengukur apa yang bisa ia lihat bergerak. Berat pembaca tidak bisa menggerakkannya:

```
regresi pembaca +5.000 B  ->  total 191.689 B  <=  plafon 192.000 B  ->  LOLOS
```

Diverifikasi dengan menanam persis regresi itu. Lima ribu byte adalah **kenaikan 23% atas apa yang diunduh pengunjung sebuah artikel** — persis kegagalan "halaman publik terasa lambat" yang menjadi alasan gerbang ini dibangun — dan gerbangnya meloloskannya, karena 5.000 B hanyalah 2,6% dari angka yang didominasi admin.

Kebalikannya juga berlaku: pertumbuhan admin memakan kelonggaran yang secara nominal melindungi pembaca, sehingga kedua permukaan diam-diam berebut satu jatah padahal hanya satu di antaranya yang menjadi pokok premisnya.

### Cacat kedua yang tersingkap oleh investigasi yang sama

`src/lib/security/security-headers.ts` memuat kalimat "`public/` holds exactly two files (`js/news-share.js`, `css/public-content.css`)" sebagai bagian dari penalaran `Cross-Origin-Resource-Policy: same-origin`. `public/` berisi **tiga** — `push-sw.js` ditambahkan 2026-08-10 dan tidak ada pemeriksaan yang membaca ulang klaim itu. Penalaran CORP-nya selamat dari koreksi ini (service worker same-origin tidak terpengaruh), tetapi enumerasi yang tidak diverifikasi ulang oleh apa pun akan lapuk, dan yang ini sudah lapuk.

## Keputusan

**Kami memutuskan memisah anggaran aset klien menjadi satu anggaran per audiens, dan menjadikan klasifikasinya sebuah gerbang, bukan komentar.**

- `READER_BUDGET_BYTES` = **24.000** — yang diunduh pengunjung artikel publik. Terukur 21.415 B. Sengaja ketat: ~2.585 B kelonggaran, kira-kira satu skrip kecil lagi.
- `APP_BUDGET_BYTES` = **172.000** — admin, auth, landing, preview theming. Terukur 165.274 B, kelonggaran ~4%. Mewarisi tugas plafon lama menangkap akresi satu layar demi satu layar.
- `PER_FILE_BUDGET_BYTES` = 27.000, tidak berubah.

Klasifikasi **diturunkan, bukan didaftar**, di mana pun struktur memungkinkannya: segala sesuatu di bawah `_astro/` adalah keluaran Vite untuk halaman `.astro` dan karenanya `app`, tanpa daftar yang perlu dirawat. `public/` disalin utuh dan tidak punya struktur semacam itu, jadi berkasnya dideklarasikan di `PUBLIC_ASSET_AUDIENCE` — dan registri itu ditegakkan dua arah:

- berkas dalam build yang tidak dideklarasikan entri mana pun **menggagalkan** pemeriksaan;
- entri yang menyebut berkas yang tidak dipancarkan build **juga menggagalkannya**.

Itulah yang menghentikan pelapukan ala `security-headers.ts` terulang: enumerasinya tidak bisa basi diam-diam, karena build memeriksanya ulang setiap kali.

## Konsekuensi

- **Positif:** berat yang menghadap pembaca kini terukur sebagai besaran tersendiri, sehingga regresinya gagal atas dasarnya sendiri alih-alih bersembunyi di dalam total yang didominasi admin. Pesan kegagalan menyebut permukaan mana yang jebol dan apa yang harus dilakukan.
- **Positif:** berkas baru di `public/` tidak bisa masuk build tanpa seseorang memutuskan siapa yang mengunduhnya. Pertanyaan "apakah ini menghadap pembaca?" ditanyakan pada saat jawabannya masih diketahui.
- **Negatif / imbal-balik:** anggaran pembaca cukup ketat sehingga fitur sah yang menghadap pembaca akan menuntut kenaikan yang ditinjau. Itu biaya yang disengaja — kenaikan adalah diff tempat justifikasinya tertulis, persis seperti yang ditetapkan Issue #552 untuk plafon lama.
- **Negatif / imbal-balik:** `TOTAL_BUDGET_BYTES` hilang, jadi tidak ada satu angka untuk dikutip. Sebagai gantinya kedua angka permukaan dicetak pada setiap kelulusan.
- **Netral:** plafon per-berkas (27.000) berada di atas anggaran pembaca (24.000), jadi pada permukaan pembaca anggaran permukaanlah yang selalu menyala lebih dulu dan aturan per-berkas menjadi inert di sana. Ini disengaja — aturan yang lebih ketat yang seharusnya menyala — dan ditegaskan oleh sebuah test agar tidak berubah menjadi kebetulan yang tak disadari siapa pun.
- **Netral:** jumlah kedua anggaran (196.000) melampaui plafon tunggal lama (192.000). Ini bukan pelonggaran ke arah yang berarti: tidak ada permukaan yang bisa memakai jatah permukaan lain, dan justru itulah seluruh maksudnya.

## Alternatif yang dipertimbangkan

- **Tetap satu plafon, dinaikkan atau diturunkan.** Ditolak: pengukuran menunjukkan angka itu tidak bisa melihat hal yang menjadi pokok premisnya. Menurunkannya akan memblokir layar admin berikutnya karena alasan yang tak ada hubungannya dengan pembaca; menaikkannya memperlebar titik butanya. Tabel atribusi di Issue #590 tidak menemukan pelaku tunggal untuk dipangkas — 26 commit pertumbuhan, satu pemulihan sengaja −22.700 B, tanpa lemak — jadi tidak ada yang akan diperbaiki oleh satu angka yang disetel ulang.
- **Memisah menurut direktori (`_astro/` vs sisanya).** Ditolak sebagai aturan _utuh_: ia benar untuk `_astro/` dan salah untuk `public/`, yang memuat aset pembaca DAN `push-sw.js` yang didaftarkan admin. Memakainya sendirian akan menghitung service worker sebagai berat pembaca dan diam-diam melebih-lebihkan anggaran paling ketat di repo ini.
- **Mengatribusi setiap aset dari manifest rute SSR saat pemeriksaan.** Ditolak karena terlalu rapuh untuk sebuah gerbang. Ia alat yang tepat untuk investigasi sekali jalan (ia menghasilkan tabel di atas), tetapi ia bergantung pada bentuk privat keluaran build Astro, yang tidak dijaga kontrak apa pun — gerbang yang patah saat Astro di-upgrade mengajari orang untuk mematikan gerbang. Aturan struktural `_astro/` plus registri yang ditegakkan dua arah memberi jawaban yang sama dari fakta yang tidak bergerak.
- **Mengeluarkan aset admin dari anggaran sepenuhnya.** Ditolak: berat admin adalah berat nyata bagi redaktur yang memakainya seharian di atas koneksi yang dimiliki ruang redaksi daerah. Ia butuh anggaran; ia butuh anggarannya sendiri.
