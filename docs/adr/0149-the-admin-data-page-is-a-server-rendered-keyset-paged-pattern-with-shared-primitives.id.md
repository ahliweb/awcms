🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0149-the-admin-data-page-is-a-server-rendered-keyset-paged-pattern-with-shared-primitives.md)

<!-- i18n-source-hash: sha256:f79a90b9783d687cdcffdfb974d58df12c191565d02caaca8a5efd961e03a380 -->

# ADR-0149 — Halaman data admin adalah pola yang dirender server dan dipaging keyset dengan empat primitif bersama

- **Status:** Diusulkan
- **Tinjauan:** menjadi Diterima setelah ditinjau maintainer. Primitif dan pengguna pertamanya (`/admin/users`) mendarat dalam perubahan yang sama dengan catatan ini karena standar yang tidak dipakai satu layar pun hanyalah klaim, bukan standar; pola ini baru mengikat layar baru setelah diterima.
- **Tanggal:** 2026-10-26
- **Pengambil keputusan:** ahliweb (menunggu tinjauan maintainer)
- **Menyelesaikan:** Issue #1196 (mengadopsi pola halaman data dari proposal redesain admin Oktober 2026).
- **Memperluas, tidak men-supersede:** [ADR-0120](0120-the-admin-redesign-splits-one-hue-into-three-roles.id.md) (token, shell, gerbang kontras) dan [`docs/awcms/14_ui_ux_design_system.id.md`](../awcms/14_ui_ux_design_system.id.md) §Pustaka komponen (baris Table, Pagination, dan `FilterBar`). Ia **tidak mengubah nama token maupun nilai yang diukur kontrasnya**.
- **Terkait:** [ADR-0095](0095-the-interface-speaks-the-readers-language.id.md) (katalog gettext), [ADR-0125](0125-admin-v2-primitives-confirm-dialog-save-bar-reason-panel.id.md) (keputusan komponen saudaranya), [`design/redesain-ui-ux-2026-10/`](../../design/redesain-ui-ux-2026-10/README.md) (`PolaData.dc.html`, `AwcmsUsers.dc.html`, `AwcmsAudit.dc.html` — hanya referensi), `src/modules/_shared/keyset-pagination.ts`, `src/lib/ui/admin-data-page.ts`, `src/components/admin/`.

## Konteks

Terverifikasi di `main` pada 26 Oktober 2026:

- Dok. 14 menyatakan daftar memakai paginasi **keyset** "bukan offset besar", dan mencantumkan komponen `Pagination` serta `FilterBar`. Keduanya tidak ada: `src/components/` tidak punya pager, filter bar, maupun `src/components/ui`. Kalimat itu janji tanpa implementasi bersama di belakangnya.
- Karena itu tiap layar daftar membangunnya sendiri. `audit-trail.astro` punya form GET `role="search"` tetapi "TANPA cursor" (docblock-nya sendiri: menampilkan N terbaru sampai 100 dan menyatakannya). `users.astro` merender semua pengguna yang dikembalikan loader — `listTenantUsers` ber-`LIMIT 100`, diurutkan menurut login identifier — tanpa pencarian, sort, atau paging, dan dengan empty state yang tidak bisa membedakan "tidak ada yang ada" dari "tidak ada yang cocok".
- Proposal redesain di `design/redesain-ui-ux-2026-10/` menetapkan anatominya sekali (`PolaData.dc.html`): pencarian berlabel, chip filter yang bisa dihapus, ringkasan hasil, judul kolom yang bisa diurutkan, dan footer keyset dengan Sebelumnya/Berikutnya serta ukuran halaman. Ia hanya referensi dan menyatakan bahwa perubahan shell atau standar memerlukan issue sendiri dan, bila mengubah standar, ADR. Inilah ADR itu.
- Batasan repo atas komponen semacam ini sudah ditetapkan keputusan sebelumnya: `default-src 'self'` tanpa `'unsafe-inline'` (`<script>` tanpa import di-inline lalu diblokir diam-diam), halaman Astro yang dirender server, katalog gettext dengan kalimat Inggris sebagai msgid, token warna tiga peran, dan anggaran aset klien per permukaan.

## Keputusan

### 1. Pola halaman data

Layar daftar di `/admin/*` yang menampilkan baris untuk dicari, dipersempit, atau di-paging mengikuti anatomi ini. Butir 1–6 adalah permukaan normatifnya; masing-masing adalah primitif di §2.

1. **Pencarian** — satu kotak teks berlabel di dalam `<form method="get" role="search">` yang punya nama aksesibel. Label adalah teks yang terlihat, terikat ke input dengan `for`/`id`. Form ini form GET biasa: berfungsi dengan JavaScript mati.
2. **Filter** — satu `<select>` berlabel per filter, di form yang sama. Kunci dan arah urutan juga ditawarkan sebagai select, karena tabel bertumpuk menyembunyikan baris judulnya di ponsel.
3. **Filter aktif sebagai chip** — bila ada yang diterapkan, satu chip yang bisa dihapus per filter aktif (tautan nyata ke "halaman ini tanpa filter itu", dinamai menurut apa yang dihapusnya), ditambah tautan "Hapus filter" dan ringkasan jumlah hasil di live region yang sopan (polite).
4. **Empty state yang menyebut kueri** — "Tidak ada hasil untuk “rina”" dengan saran dan satu klik untuk menghapus, berbeda dari daftar yang benar-benar kosong ("Belum ada pengguna"). Yang pertama tidak boleh terbaca sebagai yang kedua.
5. **Judul yang bisa diurutkan** — `<th scope="col">` berisi tautan; `aria-sort="ascending|descending"` hanya pada kolom yang sedang diurutkan; arah juga dikodekan dengan bentuk (▲/▼), tidak pernah warna saja. Aktivasi pertama mengurutkan naik; mengaktifkan kolom terurut membaliknya. Tidak ada keadaan tak-terurut, karena kursor keyset butuh urutan total.
6. **Footer keyset** — `<nav aria-label>` berisi rentang ("Menampilkan 1–25 dari 80"), grup ukuran halaman (**10 / 25 / 50**, bawaan 25, `aria-current` pada yang aktif) dan **Sebelumnya / Berikutnya**. Arah yang tidak tersedia tetap di tata letak dan membawa `aria-disabled="true"`; ia bukan perhentian Tab. **Tanpa nomor halaman dan tanpa "lompat ke halaman N".**

### 2. Empat primitif bersama di `src/components/admin/`

| Komponen                | Merender                                                                                                                                                                         |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DataListToolbar.astro` | butir 1–3: form `role="search"` (pencarian, select filter, select sort opsional, `limit` tersembunyi), daftar chip dengan tautan hapus dan "Hapus filter", ringkasan live-region |
| `DataEmptyState.astro`  | butir 4: empty state yang menyebut/menghapus kueri, sebagai baris tabel (`colspan`) atau mandiri; halaman memasok teks untuk kasus benar-benar kosong                            |
| `SortableHeader.astro`  | butir 5: `<th aria-sort>` dengan tautan sort, panah aria-hidden, dan "(urutkan turun)" tersembunyi secara visual yang menyatakan apa yang dilakukan aktivasi                     |
| `KeysetPager.astro`     | butir 6: footer                                                                                                                                                                  |

Semuanya **komponen `.astro` yang dirender server dan tidak mengirim skrip**. Seluruh state ada di URL: `?q=&<filter>=&sort=&dir=&cursor=&limit=`. Aturan murninya — mengurai URL, membangun tautan "halaman ini dengan satu hal berubah", penghapusan chip, dan irisan keyset — ada di `src/lib/ui/admin-data-page.ts` dan diuji unit tanpa merender. Setiap string yang terlihat melewati `t()`/`tn()` dengan entri `en` dan `id`; string yang berbeda per layar datang sebagai prop yang sudah diterjemahkan, string yang sama di setiap halaman data dimiliki komponen.

### 3. Kontrak URL

- Parameter: `q` (≤ 100 karakter), kunci filter yang dideklarasikan halaman, `sort` dan `dir` (dari kunci sort yang dideklarasikan halaman), `cursor` (buram/opaque), `limit` ∈ {10, 25, 50}.
- Apa pun yang tidak dideklarasikan atau cacat **kembali ke bawaannya**; halaman data tidak pernah menjawab URL yang diedit tangan dengan error.
- Nilai bawaan **dihilangkan**, sehingga alamat halaman tanpa filter adalah path polos.
- **Setiap perubahan selain paging membuang `cursor`.** Kursor adalah posisi dalam satu urutan dari satu himpunan hasil; membawanya melewati kueri, filter, sort, atau ukuran yang berubah menempatkan pembaca di tengah daftar yang lain.

### 4. Apa itu kursor, dan apa yang bukan

Kursor mengodekan `(nilai sort, id)` baris jangkar dan satu arah (sesudah / sebelum) dan **tidak ada yang lain**. Urutan selalu berakhir pada `id`, sehingga nilai sort yang sama tidak mengulang maupun melewati baris di antara halaman. Ia _posisi_, bukan _otorisasi_: server mengotorisasi setiap permintaan dan menjalankannya di dalam `withTenant`; row-level security yang menentukan baris mana yang ada. Memalsukan atau memutar ulang kursor hanya bisa menggeser pembaca di dalam data yang memang boleh ia baca; ia tidak melebarkan apa yang boleh dibaca. Di halaman SSR, kursor yang tak terbaca berarti **halaman pertama, bukan error**; API JSON di `_shared/keyset-pagination.ts` mempertahankan `400` yang lebih ketat (klien mesin perlu diberi tahu). Daftar berbasis SQL mengikat nilai kursor sebagai parameter dan tidak pernah menginterpolasinya; kursor tidak perlu ditandatangani agar aman, dan menandatanganinya menambah kunci untuk dirotasi tanpa mengubah apa yang dapat dijangkau penyerang.

### 5. Total

Footer menampilkan "dari N" **hanya bila N tepat dan murah**: daftar yang sudah ada di memori, atau hitungan beriindeks. `totalIsApproximate` mengubah redaksi menjadi "dari sekitar N". Selain itu rentang berdiri sendiri. `COUNT(*)` tidak pernah dijalankan hanya untuk menghiasi footer, dan layar berbentuk log (jejak audit) tidak menampilkan total.

### 6. Peningkatan progresif, dan CSP

Dasarnya **tanpa JavaScript**: pencarian, filter, sort, ukuran halaman, dan paging adalah tautan dan form GET. Itu bukan fallback untuk kasus lambat; itulah implementasinya, dan alasan primitif ini menambah **nol byte skrip** pada anggaran klien. Peningkatan (pencarian langsung ber-debounce, pemulihan fokus) boleh ditambahkan nanti **hanya** sebagai skrip yang mengimpor modul dari `src/lib/ui/` agar Astro memancarkannya sebagai aset eksternal di bawah `default-src 'self'` (aturan yang didokumentasikan `admin-form-client.ts`), dan hanya bila halaman tetap sepenuhnya bisa dipakai tanpanya.

### 7. Cakupan perubahan ini

- Menambah empat primitif, `src/lib/ui/admin-data-page.ts`, blok stylesheet di `admin.css`, dan entri katalog.
- Memindahkan `/admin/users` ke primitif itu sebagai pengguna pertama. **Tanpa perubahan API, OpenAPI, migrasi, izin, atau audit.** `GET /api/v1/users` dan `listTenantUsers` tidak menerima kueri, sort, atau kursor; halaman karena itu menerapkan pencarian, filter, sort, dan paging **pada daftar yang sudah dimuat, sudah diotorisasi, ber-`LIMIT 100`**, lewat kontrak URL dan bentuk kursor yang sama. Dua konsekuensi diterima dan dinyatakan: pencarian mencocokkan apa yang _ditampilkan_ halaman — login identifier yang disamarkan dan kode peran — tidak pernah identifier mentah (PII yang tidak dimuat halaman ini); dan total tepat untuk baris yang dimuat, bukan untuk tenant dengan lebih dari 100 pengguna. Memindahkan kueri ke SQL adalah tindak lanjut yang mengubah sumber data dan tidak ada yang terlihat oleh pembaca atau bookmark.
- Tidak menambah token, tidak mengganti nama apa pun, dan tidak mengubah nilai yang diukur kontrasnya. Aturan baru hanya memakai pasangan yang sudah diukur registry di `scripts/design-token-contrast-check.ts`.

## Konsekuensi

### Positif

- Satu implementasi untuk bagian layar daftar yang selama ini dibangun ulang per layar, dengan perilaku aksesibilitas diputuskan sekali.
- URL adalah state: muat ulang, bagikan, Back, dan bookmark berfungsi, dan halaman bisa diuji dengan mengambil sebuah URL.
- Paging keyset menjadi bawaan untuk daftar baru, seperti yang sudah dinyatakan dok. 14.

### Negatif / pertukaran

- **Keyset vs offset di bawah FORCE RLS.** `OFFSET n` mengevaluasi predikat row-level-security dan pengurutan untuk setiap baris yang lalu dibuangnya, sehingga biaya tumbuh dengan nomor halaman, dan ia menampilkan baris dua kali atau melewatinya bila data berubah di antara halaman. Predikat keyset pada `(tenant_id, kunci sort, id)` mencari lewat indeks dan berbiaya sama di setiap halaman; urutan stabil dijamin tiebreak `id`. Harganya nyata dan diterima: **tanpa akses acak** ("halaman 37") dan tanpa total yang murah. Layar yang benar-benar butuh halaman bernomor — proposal menyebut arsip kanal dan kategori publik — adalah pola lain dan di luar cakupan di sini.
- **Aksesibilitas.** Tautan untuk sort dan paging menjaga halaman lengkap bagi keyboard dan pembaca layar tanpa skrip, dan `aria-disabled` menjaga geometri footer tetap stabil. Biayanya: setiap sort atau filter adalah navigasi (muat halaman penuh, dan fokus kembali ke awal dokumen), admin yang mengutamakan mouse tidak mendapat umpan balik instan, dan `aria-disabled` pada non-tautan adalah konvensi yang diumumkan pembaca layar tetapi tidak ditegakkan peramban — sebab itu kontrol yang tidak tersedia dirender tanpa `href`, bukan tautan yang tampak nonaktif. Ukuran target: ADR-0120 mempertahankan kontrol pointer-first di 36–38px (WCAG 2.2 AA 2.5.8 meminta 24px); kontrol baru mencapai **44px di bawah pointer kasar** dan mempertahankan metrik ringkas untuk mouse. Bila maintainer ingin 44px di mana-mana, itu amendemen ADR-0120, bukan perubahan diam-diam di sini.
- **Peningkatan progresif SSR-dahulu.** Tidak ada yang hilang saat skrip gagal dimuat, tetapi "cari saat mengetik" ber-debounce adalah lapisan opsional berikutnya, bukan bagian dari yang ini. Pilihan ukuran adalah tiga tautan, bukan `<select>`, karena select butuh skrip untuk mengirim saat berubah.
- **i18n.** String yang sama di setiap halaman data hidup di komponen, jadi perubahan redaksi adalah satu suntingan katalog; string khusus layar adalah prop, dan layar yang lupa mendapat bahasa Inggris dari fallback msgid. Teks chip adalah kalimat terjemahan yang dirakit di server ("Status: Aktif"), sehingga tidak bisa dibangun ulang di klien tanpa mengirim katalog (ADR-0095). Batas pencarian 100 karakter dihitung dalam karakter, bukan byte.
- **Pengirisan di memori sementara.** Mengiris daftar yang sudah dimuat tepat untuk daftar konfigurasi terbatas dan keliru untuk tabel tak terbatas. `sliceKeyset` mendokumentasikan bahwa ia bukan izin untuk memuat tabel besar lalu mem-paging-nya di halaman.

### Netral

- Tabel bertumpuk seluler menyembunyikan `<thead>`-nya; tautan sort di dalamnya dikeluarkan dari urutan Tab (`visibility: hidden`) dan select Sort di toolbar menjadi kontrolnya pada lebar itu.
- Anggaran aset klien audiens aplikasi naik sebesar pertumbuhan stylesheet yang terukur (lihat `scripts/client-asset-budget.ts`); tidak ada skrip yang ditambahkan.

## Alternatif yang dipertimbangkan

- **Halaman bernomor (offset).** Akrab, dan memberi "halaman 37", tetapi gagal tepat di tempat daftar tumbuh dan di bawah penulisan serentak (§Konsekuensi). Ditolak untuk daftar admin; kasus arsip publik tetap terbuka.
- **Island data grid sisi klien.** Sort dan filter instan, tetapi bundel di setiap layar daftar, sumber kebenaran kedua di samping URL, dan skrip terikat CSP yang harus berjalan sebelum halaman bisa dipakai. Ditolak sebagai dasar; tidak dilarang sebagai peningkatan (§6).
- **Membiarkan tiap layar membangunnya sendiri.** Itulah sebab beberapa form filter buatan tangan dan tanpa pager bersama ada hari ini. Ditolak.
- **Kursor bertanda tangan.** Kursor membawa posisi, bukan hak; menandatangani tidak memberi otorisasi dan menambah rahasia untuk dirotasi. Ditolak (§4).
- **Mengadopsi seluruh kanvas proposal (judul 11px→12px, seksi sidebar yang diciutkan, "Simpan tampilan").** Di luar cakupan: itu mengubah keputusan shell yang dicatat ADR-0120, dan satu perhatian per ADR.
