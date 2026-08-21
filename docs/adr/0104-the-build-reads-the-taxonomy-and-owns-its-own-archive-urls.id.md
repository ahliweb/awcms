🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0104-the-build-reads-the-taxonomy-and-owns-its-own-archive-urls.md)

<!-- i18n-source-hash: sha256:30740b21df8f134f6303bb69a9ad6b4b8e44d2219cfc8fbe21fbd6cd38a33804 -->

# ADR-0104 — Build statis membaca taksonominya, dan memiliki URL arsipnya sendiri

- **Status:** Accepted
- **Tanggal:** 2026-08-22
- **Pengambil keputusan:** ahliweb
- **Terkait:** Issue #597 butir 1; PRD LenteraKalteng §8.5, §12.4, FR-DSC-006; ADR-0102 (tidak ada yang anonim; pemisahan penolakan/kegagalan); ADR-0065 (kontrak konsumen); ADR-0009 (rute tenant publik berbasis path); Issue #647, #649

## Konteks

`ahliweb/awcms-astro` tidak punya arsip kategori maupun arsip tag. Sebuah artikel termasuk salah satu tab yang dikonfigurasi di source repo itu, dan tidak ada halaman mana pun yang mengagregasi "semua yang berada di Politik". Itu butir pertama yang didaftar Issue #597, dan sampai dua perubahan bulan ini mendarat ia memang tidak bisa dibangun sama sekali:

- **Feed build tidak membawa klasifikasi.** `GET /api/v1/blog/posts?view=full` mengembalikan setiap kolom sebuah post kecuali `termIds`, jadi traversal yang dipakai membangun situs statis tidak pernah menyebut kategori sebuah artikel (diperbaiki di Issue #649).
- **Kosakatanya tidak bisa dibaca sampai habis.** `GET /api/v1/blog/terms` mengembalikan seratus entri pertama menurut abjad tanpa cursor dan tanpa isyarat bahwa masih ada lagi — untuk kosakata tag yang tumbuh di atas arsip 23.906 artikel itu berarti situs yang membangun seratus halaman arsip dari ribuan dan tampak sehat (diperbaiki di Issue #647).

Keduanya kini benar, sehingga permukaan keempat masuk ke kontrak konsumen beku ADR-0065. Permukaan apa itu seharusnya, dan apa yang tinggal di sisi mana batasnya, itulah yang dicatat di sini.

## Keputusan

**Build statis membaca taksonomi tenant dari permukaan admin yang sudah ada dengan kredensial build-nya, dan menghitung sendiri URL arsipnya.**

### Permukaannya `GET /api/v1/blog/terms`, bukan permukaan anonim baru

ADR-0102 sudah menetapkan posturnya dan pilihan katanya penting: "baca publik" pada issue-issue ini berarti PEMBANGUN situs publik dapat membacanya. Sebuah situs menerbitkan taksonominya sendiri lewat templatenya sendiri — itu keputusan situs, bukan keputusan yang diambil API ini atas namanya dengan menyajikan kosakata itu kepada siapa pun yang bertanya. `GET /api/v1/media/public-origin` dan feed post itu sendiri sudah bekerja begini.

Konsekuensinya nyata dan dinyatakan di sini alih-alih ditemukan di log build: role kredensial build butuh `blog_content.taxonomies.read`. Kredensial yang dicetak sebelum ADR ini memilikinya hanya bila role-nya memang sudah memberikannya — celah seed permission yang sama yang ditemui ADR-0102 dengan `site_profile.profile.read`, dan alasan konsumennya memperingatkan dengan menyebut nama permission-nya.

### Konsumen memakai TRAVERSAL-nya, tidak pernah list default

`?order=created_at` beserta `nextCursor` itulah yang dibekukan kontrak untuk konsumen ini. Membekukan list default menurut abjad justru akan membekukan pemotongannya — kontrak yang perilaku terjaminnya "mengembalikan sebagian term" lebih buruk daripada tanpa kontrak, karena ia meresmikan hal yang salah.

### Bentuk URL arsip milik KONSUMEN

`awcms` sudah merender arsip kategori dan tag untuk keluarga rute publiknya sendiri di `/blog/{tenantCode}/category/{slug}` (ADR-0009), dan `internal-tag-linking` menyusun `${basePath}/tag/${slug}` untuk badan artikel yang ia render. Situs yang dibangun `awcms-astro` punya origin berbeda, base path berbeda, dan boleh memakai kata segmen yang sama sekali lain.

**`awcms` tidak mendapat setting untuk URL arsip konsumennya.** Field per-tenant "arsip Anda berada di template ini" akan menaruh keputusan itu di repo yang tidak menyajikan halamannya, dan begitu keduanya berselisih, tautannya dirusak oleh pihak yang tidak bisa melihatnya. Konsumen memegang `slug` term dan routing-nya sendiri; ia menyusun URL-nya.

Satu konsekuensi mengikuti, dan disebut alih-alih dibiarkan ditemukan: penautan tag internal otomatis (Issue #641) menulis ulang badan artikel dengan URL tag berbentuk `awcms`. Ia tidak menjangkau `awcms-astro` hari ini, karena repo itu merender badan artikel sendiri dari `bodyPortableText` alih-alih mengonsumsi HTML jadi — jadi transform itu memang tidak berjalan di jalur tersebut. Bila suatu saat sebuah konsumen memang membaca HTML jadi, di sinilah sambungan tempat URL-nya akan salah, dan jawabannya adalah memberi transform itu base milik konsumen, bukan memberi `awcms` sebuah template URL.

### Penolakan bukan build gagal; kegagalan iya

Pemisahan yang sama seperti ADR-0102, dengan satu perbedaan yang layak disebut.

- **403 atau 404** — kredensialnya tidak memegang `blog_content.taxonomies.read`, atau instansnya lebih tua dari traversal ini. Build memperingatkan dengan menyebut nama permission-nya dan tidak membangkitkan halaman arsip apa pun.
- **Selain itu** — 500, timeout, host tak terjangkau — melempar, karena membangun menembusnya menerbitkan situs yang diam-diam kehilangan setiap arsip yang dimilikinya kemarin.

Bedanya dengan identitas situs: **kosakata kosong adalah keadaan yang sah**. Redaksi yang tidak memfilekan apa pun ke sebuah kategori tidak sedang rusak, dan fallback maupun jawaban kosong yang jujur menghasilkan halaman yang sama. Justru itulah sebabnya cabang kegagalan harus tetap terpisah — dengan `catch` menyeluruh, "CMS Anda mati" dan "redaksi ini tidak memakai kategori" menjadi peristiwa yang sama, padahal hanya satu di antaranya yang boleh terbit.

### Urutan pembekuannya tetap berlaku

`/api/v1/blog/terms` ditambahkan ke `COMMITTED_PATHS` di sini, pindah ke `CONSUMED_PATHS` ketika `awcms-astro` benar-benar memanggilnya, dan gerbang milik repo tetangga itulah yang membuktikan panggilannya nyata. Pembedaan antara dijanjikan dan dikonsumsi hanya berharga bila entri benar-benar berpindah; tiga bukan-panggilan pernah duduk di `CONSUMED_PATHS` sambil menggambarkan panggilan yang tidak pernah ada.

## Konsekuensi

- **Positif:** arsip kategori dan tag menjadi mungkin di konsumen tanpa endpoint baru, tanpa permukaan anonim baru, dan tanpa tabel baru.
- **Positif:** kosakatanya punya persis satu rumah. Kategori yang diganti namanya diganti sekali dan setiap konsumen melihatnya pada build berikutnya.
- **Negatif / imbal-balik:** build kini melakukan satu kelas permintaan lagi, dan butuh satu permission lagi. Deployment yang memutakhirkan `awcms-astro` tanpa memberikannya akan mendapat peringatan dan tidak ada arsip alih-alih error — itu kegagalan yang benar, dan tetap kegagalan yang harus dibaca seseorang.
- **Negatif / imbal-balik:** kini dua repo menyusun URL arsip untuk term yang sama, dalam dua bentuk. Itu disengaja (keduanya melayani situs berbeda) dan artinya URL sebuah term bukan satu fakta yang bisa dicari siapa pun.
- **Netral:** `institutionIds` ikut di feed yang sama tetapi tidak punya arsip di ADR ini. Halaman landing institusi adalah pekerjaan PRD §12.2 dan keputusannya sendiri.

## Alternatif yang dipertimbangkan

- **`GET /api/v1/blog/public-terms` anonim yang baru.** Ditolak atas dasar postur ADR-0102, dan atas biaya: endpoint kedua yang mengembalikan baris yang sama adalah satu hal lagi yang harus dijaga selaras dengan yang pertama, sedangkan yang pertama sudah ada.
- **Menanamkan `name` dan `slug` tiap term di payload setiap post.** Ditolak. Ia mengulang belasan nama kategori di 23.906 post, dan yang lebih buruk, ia menjadikan kosakatanya salinan per-baris — dua post di halaman yang sama bisa membawa ejaan berbeda untuk kategori yang sama setelah penggantian nama, dan tak ada yang cukup salah untuk menggagalkan apa pun.
- **Template URL arsip per-tenant di `awcms`.** Ditolak — lihat di atas. Pihak yang merender tautan bukan pihak yang menyajikannya.
- **Membekukan list default menurut abjad alih-alih traversal.** Ditolak: itu akan menjadikan "mengembalikan sebagian term" sebagai perilaku terjamin.
