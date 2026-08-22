🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0105-navigation-is-cms-data-and-the-localised-tab-bar-stays.md)

<!-- i18n-source-hash: sha256:dab07fbba96a8b4aa96a2da20fbdde5248c1377af4156c5cd9cbdc4cc200b9d8 -->

# ADR-0105 — Navigasi dan widget adalah data CMS, dan bilah tab yang terlokalkan tetap tinggal

- **Status:** Accepted
- **Tanggal:** 2026-08-22
- **Pengambil keputusan:** ahliweb
- **Terkait:** Issue #597 butir 6; PRD LenteraKalteng §8.3, §8.4, §25; ADR-0104 (pembacaan taksonomi, bentuk yang sama); ADR-0102 (tidak ada yang anonim; pemisahan penolakan/kegagalan); ADR-0065 (kontrak konsumen); Issue #652

## Konteks

`blog_content` sudah memegang menu navigasi dan widget sejak Issue #542: sebuah menu dengan `key` stabil, sebuah nama, dan pohon item terurut berisi tautan `post`/`page`/`url`; sebuah widget dengan posisi, judul, badan teks biasa, flag aktif, dan urutan. Ada layar admin untuk keduanya.

**Tidak ada yang merender keduanya.** Navigasi `ahliweb/awcms-astro` adalah `siteConfig.tabs` — sebuah daftar yang ditulis di source repo itu — dan widget tidak muncul di mana pun. Itu Issue #597 butir 6, dan bentuknya sama seperti butir 1 dulu: seorang editor mengonfigurasi sesuatu, CMS menyimpannya, dan tidak ada pembaca yang pernah melihatnya.

Issue #652 menyingkirkan penghalang pertama. Kedua endpoint list mendeklarasikan payload-nya sebagai array `object` telanjang, yang bukan bentuk yang salah melainkan **tanpa** bentuk: tidak ada yang bisa gagal terhadapnya, jadi membekukannya di kontrak konsumen sama dengan membekukan janji tanpa isi.

Yang tersisa adalah sebuah keputusan, dan bagian menariknya bukan "baca menunya".

## Keputusan

**Build membaca menu dan widget dari permukaan admin yang sudah ada, merendernya sebagai wilayah TAMBAHAN, dan tidak menggantikan bilah tab yang terlokalkan.**

### Bilah tab bukan menunya, dan menggantikannya adalah regresi

Pembacaan paling wajar atas butir 6 adalah bahwa `siteConfig.tabs` seharusnya menjadi sebuah menu CMS. Ia tidak boleh, karena alasan yang hanya muncul di bahasa kedua.

Bilah tab merender labelnya lewat katalog PO (`t(locale, tabTitleKey(tab), …)`). `src/config/site.ts` mencatat sebabnya di komentarnya sendiri: versi sebelumnya merender nama huruf-besar yang ditulis di kode, yang membuat navigasi utama situs menjadi _"satu-satunya bagian antarmuka yang tidak pernah diterjemahkan — di sebuah template yang seluruh maksudnya multibahasa."_

**Sebuah item menu `awcms` membawa SATU label.** Tidak ada label per-locale di mana pun dalam skemanya. Jadi navigasi utama yang digerakkan CMS akan mengembalikan antarmuka primer redaksi ke satu bahasa di situs multibahasa — memperkenalkan kembali, lewat sebuah fitur, persis cacat yang menjadi alasan komentar itu ditulis.

Tab juga load-bearing di luar label: ia menentukan struktur rute (`/[tab]/`), urutan seksi (`urutanSeksi`, ADR-0033 di sana), dan seksi tempat sebuah artikel berada. Sebuah menu adalah daftar tautan; ia bukan satu pun dari itu.

Maka: bilah tab tetap tinggal, menu CMS dirender sebagai **wilayah navigasi sekunder** (footer, tempat daftar tautan adalah hal biasa dan tempat tidak ada struktur terlokalkan yang tergusur), dan widget dirender di posisi yang dinyatakannya. Keduanya aditif, dan tenant yang tidak mengonfigurasi keduanya mendapat situs yang ia punya hari ini.

### Sebuah item menu meresolusi ke apa, dan ke apa yang tidak

- **`url`** — dipakai apa adanya. `awcms` sudah menolak apa pun selain URL http(s) absolut saat tulis.
- **`post`** — diresolusi lewat feed yang sudah dipegang build: `targetId` adalah id post, dan build tahu slug serta seksi post itu. Tanpa permintaan tambahan.
- **`page`** — **dibuang, dengan peringatan yang menyebut itemnya.** Page `awcms` adalah resource nyata di sana dan `awcms-astro` sama sekali tidak punya konsep page: tidak ada rute yang bisa dituju sebuah id page. Merendernya sebagai tautan mati lebih buruk, dan tidak merender apa pun tanpa mengatakannya adalah cara seorang editor menyimpulkan menunya rusak lalu menambahkan itemnya lagi.

Target `post` yang tidak meresolusi dibuang dengan cara yang sama. `awcms` sengaja **tidak** memeriksa `targetId` terhadap tabel post saat tulis — sebuah menu boleh menunjuk sesuatu yang belum terbit — jadi target yang tidak meresolusi adalah keadaan normal di permukaan ini, bukan error, dan konsumen wajib memperlakukannya begitu.

### `bodyText` di-escape, selalu

Badan widget adalah teks biasa. Jalur tulis MENOLAK HTML tidak aman alih-alih menyanitasinya, yang berarti nilai tersimpannya tidak pernah diperlakukan sebagai markup oleh apa pun. Konsumen yang merendernya sebagai HTML akan memberikan kepercayaan yang justru ditolak jalur tulis. Ia di-escape dan dirender sebagai teks.

### Penolakan bukan build gagal; kegagalan iya

Pemisahan yang sama seperti ADR-0102 dan ADR-0104:

- **403 atau 404** — kredensial build tidak memegang `blog_content.menus.read` / `blog_content.widgets.read`, atau instansnya lebih tua dari permukaan ini. Build memperingatkan dengan menyebut permission-nya, dan tidak merender navigasi sekunder maupun widget — yaitu situs sebagaimana adanya hari ini.
- **Selain itu** melempar.

Kedua permission dibaca sebagai satu keputusan tetapi diminta terpisah, karena sebuah tenant bisa memegang salah satunya dan build tidak boleh kehilangan keduanya gara-gara satu 403.

### Urutan pembekuannya tetap berlaku

`/api/v1/blog/menus` dan `/api/v1/blog/widgets` masuk ke `COMMITTED_PATHS` di sini dan pindah ke `CONSUMED_PATHS` ketika `awcms-astro` memanggilnya, dibuktikan gerbang milik repo itu sendiri.

## Konsekuensi

- **Positif:** sebuah redaksi bisa menambahkan tautan footer atau catatan sidebar tanpa deploy frontend — PRD §25 "tanpa edit source" diterapkan pada navigasi.
- **Positif:** bilah tab yang terlokalkan tidak tersentuh, jadi tidak ada yang meregresi pada permukaan multibahasa.
- **Negatif / imbal-balik:** situs kini punya dua navigasi dengan aturan berbeda — satu terlokalkan dan struktural, satu editorial dan berbahasa tunggal. Itu jujur, tetapi ia hal yang harus dijelaskan kepada operator, dan layar admin tidak mengatakannya.
- **Negatif / imbal-balik:** **label menu tidak dapat dilokalkan.** Di situs multibahasa, navigasi sekunder tampil dalam bahasa apa pun yang diketik editor. Ini dinyatakan alih-alih diakali; label per-locale adalah perubahan skema pada `awcms_blog_menu_items` dan menjadi keputusannya sendiri.
- **Negatif / imbal-balik:** dua permission lagi pada kredensial build.
- **Netral:** tipe tautan `page` inert bagi konsumen ini. Ia tetap sah bagi konsumen mana pun yang punya page.

## Alternatif yang dipertimbangkan

- **Mengganti `siteConfig.tabs` dengan menu CMS.** Ditolak — lihat di atas. Ia akan meng-untranslate navigasi primer dan tidak akan membawa struktur rute maupun urutan seksi yang juga ditentukan tab.
- **Label per-locale pada `awcms_blog_menu_items`.** Tidak ditolak atas dasar isinya; ditunda. Ia sebuah migrasi, perubahan layar admin, dan perubahan jalur tulis, dan tidak boleh diselundupkan ke dalam perubahan yang pertama kali merender sebuah menu. Sampai ia ada, batasannya ditulis.
- **Merender tautan `page` sebagai tautan mati supaya editornya melihat.** Ditolak: tautan mati yang terbit adalah masalah pembaca, dan editorlah yang bisa memperbaikinya. Peringatannya diletakkan di tempat orang yang bisa bertindak sedang melihat.
- **Merender `bodyText` sebagai HTML.** Ditolak mentah-mentah. Jalur tulis menolak markup; memberikannya saat render membuat penolakan itu sekadar hiasan.
