🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0166-public-pages-carry-a-native-reading-preferences-panel-not-a-third-party-accessibility-overlay.md)

<!-- i18n-source-hash: sha256:739f8cf754145c6a5ec9369119d6404e6efcce6323c5e2332ef7334301eefee3 -->

# ADR-0166 — Halaman publik memuat panel preferensi baca bawaan, bukan overlay aksesibilitas pihak ketiga

- **Status:** Accepted
- **Tanggal:** 2026-11-18
- **Pengambil keputusan:** ahliweb (pemilik; gerbang Definition of Ready untuk irisan ini lolos pada 2026-11-18)
- **Terkait:** Issue #1369; ADR-0095 (antarmuka berbicara dalam bahasa pembaca); ADR-0098 (locale di path); ADR-0101 (anggaran aset klien dipisah menurut audiens, diamandemen di bawah); `src/lib/security/security-headers.ts`; `tests/security-headers-csp.test.ts`

## Konteks

Halaman publik (`/blog/**`, `/{locale}/blog/**`, `/search`, pratinjau tema) adalah cangkang HTML yang dirender tangan. Pembaca bisa mengubah apa yang ditawarkan peramban — zoom, `prefers-color-scheme`, `prefers-contrast`, `prefers-reduced-motion` — tetapi halaman sendiri tidak memberi cara untuk berkata "teks lebih besar", "kontras lebih kuat", "hentikan animasi" atau "buat tautan jelas" sekali lalu diingat.

Sebuah produk meminta panel aksesibilitas mengambang di situs bergaya berita. Jawaban pasar adalah **widget overlay**: satu `<script>` dari vendor yang menyuntikkan toolbar dan menulis ulang halaman. Jalur itu bermasalah di sini karena tiga hal:

- **Privasi dan CSP.** Ia memuat kode jarak jauh di setiap halaman, dan kebanyakan produk semacam itu melaporkan pemakaian. Kebijakan repo ini `default-src 'self'`, tanpa `'unsafe-inline'`, satu hash, nol origin pihak ketiga di permukaan publik. Widget butuh minimal satu origin `script-src` baru, biasanya juga `connect-src` dan `img-src`.
- **Klaim yang tidak bisa dibuktikan.** Overlay mengiklankan kesesuaian. Kesesuaian adalah sifat markup, bukan sifat skrip yang menambalnya kemudian. Pernyataan publik yang ditandatangani praktisi aksesibilitas (Overlay Fact Sheet) mencatat bahwa overlay tidak membuat situs sesuai dan sering mengganggu teknologi bantu.
- **Kendali.** Widget yang menentukan apa yang dilakukan halaman, dan gangguan atau perubahan vendor adalah perubahan pada halaman publik kita yang tidak pernah kita tinjau.

## Keputusan

**Halaman publik memuat panel preferensi baca bawaan, satu origin. Ia adalah sekumpulan preferensi tampilan yang dipilih pembaca, disimpan hanya di perangkat pembaca. Ia bukan overlay.**

1. **Bukan overlay.** Panel tidak pernah menulis ulang konten, tidak menyuntikkan ARIA, tidak memuat kode pihak ketiga, dan tidak mengklaim kesesuaian. Halaman harus memenuhi WCAG 2.2 AA lewat markup-nya sendiri; panel bersifat pelengkap, dan tidak ada teks di dalamnya yang mengutip undang-undang atau standar.
2. **Tanpa server, tanpa pelacakan.** Preferensi tinggal di `localStorage` pengunjung dengan kunci `awcms-a11y` dan tidak di tempat lain: tanpa cookie, tanpa request, tanpa event analitik, tanpa tabel, tanpa endpoint. Panel menyatakannya ("tersimpan hanya di perangkat ini, tidak dikirim ke server").
3. **Preferensi OS adalah bawaan.** Bila tidak ada yang tersimpan, `prefers-reduced-motion: reduce` dan `prefers-contrast: more` menentukan dua pengaturan itu. Di bawah `forced-colors: active` palet kontras tinggi tidak mengatur warna sama sekali.
4. **Peningkatan progresif.** HTML panel dirender server dalam bahasa halaman, dengan tombol mengambang `hidden`. Hanya skrip yang menampilkannya, sehingga tanpa JavaScript tidak ada kontrol yang tidak berfungsi, dan media query OS tetap berlaku lewat CSS.
5. **CSP ketat tidak disentuh.** Dua skrip dan satu stylesheet satu origin di bawah `public/`; tanpa skrip inline, tanpa `style=""` inline, tanpa origin baru, tanpa hash baru.

### Yang ditawarkan panel

Ukuran teks (normal, besar 120 %, sangat besar 140 % dari ukuran root), dan enam saklar: kontras tinggi, monokrom, teks ramah disleksia, garis bawah semua tautan, sorot tautan, kurangi gerakan. Ditambah "reset ke standar" dan catatan hanya-di-perangkat.

| Preferensi           | Atribut pada `<html>`             | Efek                                                                                                                                                                |
| -------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ukuran teks          | `data-a11y-text="large\|x-large"` | ukuran font root 120 % / 140 %; semua teks berbasis `rem`                                                                                                           |
| Kontras tinggi       | `data-a11y-contrast`              | token warna ditimpa palet dengan kontras teks minimal 7:1 (terang: hitam di atas putih; skema gelap: putih di atas hitam); tidak diterapkan di bawah forced colours |
| Monokrom             | `data-a11y-mono`                  | `filter: grayscale(1)` hanya pada **elemen root**, karena filter pada `body` merusak `position: fixed`                                                              |
| Teks ramah disleksia | `data-a11y-dyslexia`              | tumpukan sans sistem, spasi WCAG 1.4.12 (huruf 0,12em, kata 0,16em, baris minimal 1,5, paragraf 2em), teks rata awal; **tanpa "font disleksia" yang dibundel**      |
| Garis bawah tautan   | `data-a11y-underline`             | setiap `a[href]` bergaris bawah                                                                                                                                     |
| Sorot tautan         | `data-a11y-highlight`             | latar kuning `#ffeb3b` dengan teks `#111` (15,5:1)                                                                                                                  |
| Kurangi gerakan      | `data-a11y-motion="reduce"`       | `animation`, `transition`, dan gulir halus dimatikan                                                                                                                |

Nilai penyimpanan: `{"v":1,"text":"normal|large|x-large","contrast":bool,"mono":bool,"dyslexia":bool,"underline":bool,"highlight":bool,"motion":bool}`, dengan `motion: true` berarti _kurangi_. Apa pun yang tidak terbaca — penyimpanan diblokir, JSON tidak valid, versi lain, nilai tak dikenal — dianggap "tidak ada yang tersimpan". Setiap perubahan mengirim `awcms-a11y-change` pada `document` agar ticker atau carousel di kemudian hari dapat berhenti sendiri.

### Letak kodenya

| Bagian                                                                                                                      | Berkas                                                                         |
| --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Skrip terap-awal (klasik, memblokir, di `<head>`; **satu-satunya pemilik kontrak penyimpanan**, membuka `window.awcmsA11y`) | `public/js/a11y-early.js`                                                      |
| Skrip panel (ditunda; menyambungkan dialog, tanpa kode penyimpanan sendiri)                                                 | `public/js/a11y-panel.js`                                                      |
| Gaya preferensi dan panel                                                                                                   | `public/css/public-a11y.css`                                                   |
| Markup + tag head, Indonesia secara bawaan dan Inggris untuk `en`                                                           | `src/lib/ui/reading-preferences-panel.ts`                                      |
| Pemanggil                                                                                                                   | `renderPublicPageShell`, `renderSearchPageDocument`, `PublicThemeLayout.astro` |

Skrip terap-awal sengaja berupa skrip klasik yang **memblokir**: preferensi tersimpan harus sudah ada di `<html>` sebelum cat pertama, dan skrip tertunda akan mengedipkan tampilan bawaan lalu menata ulang. Modul bersama berada di `lib/ui`, bukan di `domain/` sebuah modul, karena tiga modul memerlukannya dan tidak satu pun boleh mengimpor domain modul lain.

## Konsekuensi

- **Positif:** pembaca mendapat ukuran teks, kontras, penekanan tautan, dan kendali gerakan yang persisten tanpa data meninggalkan perangkat; tidak ada pihak ketiga di permukaan publik; CSP, kunci cache, dan model data tidak berubah. Panel dirender server dan identik untuk semua orang, sehingga ia secepat-cache halaman di sekelilingnya.
- **Dampak CSP: tidak ada.** `security-headers.ts` tidak diedit. Skrip baru tercakup `script-src 'self'`, stylesheet oleh `default-src 'self'`, dan `tests/reading-preferences.test.ts` memastikan tidak ada `<script>` yang dipancarkan tanpa `src` dan tidak ada aset yang menyebut origin.
- **Dampak data dan keamanan: tidak ada di luar peramban.** Tanpa tabel, endpoint, permission, atau RLS. Karena tidak ada status di server, langkah model data, matriks akses, domain, dan kontrak API pada alur produk tidak berlaku untuk irisan ini.
- **Bobot pembaca naik, dan anggaran dinaikkan berdasarkan pengukuran.** Tiga berkas itu berbiaya 16.973 B di permukaan pembaca (21.415 B menjadi 38.388 B; sekitar 5,2 kB setelah gzip). `READER_BUDGET_BYTES` naik dari 24.000 ke 39.000 dan `APP_BUDGET_BYTES` dari 384.870 ke 385.460 (layout pratinjau tema, 493 B), masing-masing dengan pengukuran ditulis di samping konstanta, sebagaimana diminta ADR-0101. Ini **mengamandemen** konsekuensi netral ADR-0101 bahwa anggaran pembaca tetap di bawah batas per-berkas: aturan per-berkas (27.000 B) kini dapat tercapai juga di permukaan pembaca, yaitu arah yang lebih ketat, dan tes urutan diganti dengan tes yang menegaskan kedua aturan itu independen.
- **Ukuran teks membutuhkan `rem`.** `public-content.css` mengekspresikan token `--fs-*` dalam `px`, yang tidak diskalakan ukuran font root. Kini token itu `rem` (14, 16, 18, 20, 24, 32, 40 px pada root 16 px bawaan: identik piksel bagi siapa pun yang tidak memakai panel). Tema tenant yang ukuran dasarnya `px` ditangani `max(1rem, var(--_font-size))` pada `body` setelah pembaca memilih ukuran lebih besar.
- **Negatif / trade-off:** preferensi berlaku per peramban dan origin, bukan per akun, dan hilang bila pembaca menghapus data situs. Itu harga dari tidak menyimpan apa pun di server, dan harga yang benar.
- **Negatif / trade-off:** `awcms-astro` merender halaman publiknya sendiri dan tidak mendapat panel ini dari perubahan ini. Kontraknya adalah kunci penyimpanan dan atribut `data-a11y-*`, sehingga panel yang sama dapat diadopsi di sana tanpa ketergantungan server; itu keputusan repo tersebut.

## Alternatif yang dipertimbangkan

- **Widget overlay pihak ketiga.** Ditolak karena tiga alasan di Konteks: privasi dan CSP, klaim yang tidak bisa dibuktikan, hilangnya kendali atas apa yang dilakukan halaman publik.
- **Mengandalkan peramban saja (zoom, pengaturan OS).** Dipertahankan sebagai dasar, dan panel menghormatinya. Ditolak sebagai jawaban utuh: pembaca tidak mendapat pilihan persisten per situs dan tidak bisa menyalakan tautan, spasi, atau gerakan tanpa mengubah perilaku semua situs sekaligus.
- **Menyimpan pilihan di sisi server (cookie atau akun).** Ditolak: menambah request, cookie, dan varian cache pada halaman yang dipakai bersama semua orang, untuk preferensi yang tidak perlu meninggalkan perangkat.
- **"Font disleksia" yang dibundel.** Ditolak: studi terkontrol tidak menemukan manfaat laju atau akurasi membaca dari font disleksia khusus (Wery dan Diliberto, _Annals of Dyslexia_, terbit daring 2016). Ukuran yang membantu dan dapat diuji adalah spasi, yang sudah ditetapkan WCAG 1.4.12.
- **Membangun panel dengan framework JavaScript halaman atau membundelnya.** Halaman publik tidak punya framework klien (ADR-0101). Skrip klasik tulisan tangan berbentuk sama dengan `js/news-share.js`. Meminifikasi tiga berkas lewat bundel yang dihasilkan dan terpatok versi (pola `blog-preview-overlay.js`) akan mengembalikan sebagian bobot, dan dicatat sebagai tindak lanjut, bukan dikerjakan di sini, karena menambah gerbang build.

## Catatan gerbang

Gerbang Definition of Ready untuk irisan ini diloloskan pemilik pada **2026-11-18**. Uji kegunaan dengan pembaca nyata (termasuk pengguna teknologi bantu) **ditunda ke UAT** sebelum kesiapan rilis; cakupan otomatis di sini bukan penggantinya.

## Tindak lanjut

- Uji kegunaan dengan pembaca nyata saat UAT, sebelum gerbang kesiapan rilis.
- Minifikasi opsional tiga berkas (bundel yang dihasilkan) bila anggaran pembaca menjadi kendala.
- Nama situs pada eyebrow: halaman daftar tidak meneruskan nama situs ke cangkang, sehingga eyebrow panel hanya menampilkan "Ramah baca" di sana dan "Situs · Ramah baca" di artikel.
- String lain pada cangkang publik ("Skip to content", "Previous") masih berupa bahasa Inggris literal; memindahkannya dan panel ini ke katalog gettext adalah perubahan terpisah.
- Tidak ada reaksi langsung bila preferensi OS berubah saat halaman terbuka; muat ulang menerapkannya.
- Adopsi di `awcms-astro` adalah keputusan repo itu.

## Amandemen (2026-11-19: uji kegunaan pindah ke repo implementasi)

Keputusan pemilik **2026-11-19**: repo upstream (`awcms`, `awcms-astro`, `awcms-one`) tidak menjalankan UAT; UAT (langkah 14 alur pengembangan) dijalankan di repo implementasi atau proyek turunan. Ini selaras dengan [`docs/awcms/alur-pengembangan.md`](../awcms/alur-pengembangan.md) §14 dan `docs/PROJECT_STATE.md` (langkah 13-14 TIDAK BERLAKU untuk repo ini, keputusan pemilik 13 Agustus 2026).

Pernyataan di atas yang menunda uji kegunaan dengan pembaca nyata ke UAT sebelum gerbang kesiapan rilis ("Catatan gerbang" dan butir "Tindak lanjut" pertama) **diganti** oleh ini: uji kegunaan panel preferensi baca dengan pembaca nyata, termasuk pengguna teknologi bantu, **bukan prasyarat gerbang kesiapan rilis repo ini**. Itu tanggung jawab tiap repo implementasi yang mengadopsi fitur ini, dalam UAT-nya sendiri. Cakupan otomatis di sini tetap bukan penggantinya. Keputusan intinya (panel bawaan, bukan overlay) tidak berubah.
