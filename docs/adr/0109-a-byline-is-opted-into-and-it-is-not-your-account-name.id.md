🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0109-a-byline-is-opted-into-and-it-is-not-your-account-name.md)

<!-- i18n-source-hash: sha256:912f8536fafdb695b20a7462f4fd88d944b3c7430db6ee4ade7a75dbff01dc9d -->

# ADR-0109 — Byline itu DIPILIH sendiri, dan ia bukan nama akun Anda

- **Status:** Accepted
- **Tanggal:** 2026-08-23
- **Pengambil keputusan:** ahliweb
- **Terkait:** Issue #597 butir 4; Issue #649 (yang menolak byline individual dan mencatat alasannya); ADR-0102 (identitas tingkat-organisasi); ADR-0096 (akun Anda sendiri bukan permukaan administratif); ADR-0094 / ADR-0108 (hak subjek data); PRD LenteraKalteng §8

## Konteks

`awcms_blog_posts.author_tenant_user_id` sudah mencatat siapa penulis setiap artikel sejak `sql/035`. **Tidak ada apa pun di sisi publik yang pernah meresolusinya.** `structured-data-rendering.ts` menyebut alasannya di komentarnya sendiri: memancarkan identitas editor perorangan akan menjadi _"permukaan PII baru"_, jadi `author` di JSON-LD adalah ORGANISASI.

Itu keputusan yang tepat untuk #649, dan ia meninggalkan platform berita yang artikelnya diatribusikan kepada masthead dan tidak pernah kepada wartawannya — Issue #597 butir 4, yang tetap terbuka karena ini bukan sekadar field yang kurang. Dua pertanyaan harus dijawab lebih dulu, dan keduanya tarik-menarik:

- byline sebuah ruang redaksi itu menopang banyak hal (pembaca mengikuti penulis, dan atribusi adalah bagian dari apa yang membuat liputan bisa dipertanggungjawabkan);
- nama akun internal BUKAN byline, dan menerbitkannya karena seseorang kebetulan menulis artikel adalah persis pengungkapan yang ditolak #649.

## Keputusan

**Byline adalah field terpisah, nullable, OPT-IN pada baris keanggotaan penulisnya, dan `NULL` — keadaan setiap baris yang sudah ada — berarti atribusi tingkat-organisasi yang sudah dikirim ADR-0102.**

`sql/146` menambahkan `awcms_tenant_users.public_byline_name`. Tidak ada apa pun pada artikel mana pun yang berubah sampai seseorang mengisinya.

### Bukan `awcms_profiles.display_name`, dan inilah inti keputusannya

Menerbitkan display name cukup satu baris tanpa migrasi. Ia mengubah setiap nama akun internal menjadi data publik begitu sebuah artikel terbit, untuk setiap penulis, tanpa ada yang memilihnya — dan di ruang redaksi byline sering BUKAN nama akun: nama pena, bentuk berinisial, nama dalam aksara lain.

Opt-in juga membuat mode kegagalannya jinak. Cara fitur ini rusak adalah "byline seorang penulis hilang", yang bisa dilihat dan diperbaiki penulisnya. Cara versi display-name rusak adalah "nama seorang staf ada di internet", yang tidak bisa mereka batalkan.

### Di `awcms_tenant_users`, bukan di profil

`awcms_profiles` memuat setiap pihak yang dikenal tenant — pelanggan dan organisasi termasuk — dan byline pada catatan pelanggan tidak bermakna. `awcms_tenant_users` justru persis populasi yang bisa menulis. Ia juga membuat byline bersifat **per-tenant**, yang tepat untuk principal yang menulis di dua ruang redaksi dengan dua nama, dan menaruh resolusinya satu join dari post, bukan dua.

### Hanya layanan-mandiri, tanpa saudara administratif

Ditulis lewat `PATCH /api/v1/auth/profile` — rute ADR-0096 yang tidak menerima id, sehingga baris yang ditulisnya adalah baris di balik sesi pemanggil dan tidak ada yang bisa diarahkan ke tempat lain. Sengaja **tidak ada endpoint ber-permission untuk menyetel byline orang lain**: editor yang bisa melakukan itu bisa menerbitkan artikel atas nama rekannya.

Field-nya OPSIONAL di body dan tiga keadaannya berbeda: absen berarti tidak berubah, `null` (atau string kosong) menghapusnya, string menyetelnya. Absen tidak boleh berarti "hapus", atau menyimpan display name akan menghapus byline setiap kali.

### Node `Person` membawa nama dan tidak lebih

Ketika byline disetel, `author` di JSON-LD menjadi `{ "@type": "Person", "name": … }`. Tanpa `url`, tanpa `sameAs`, tanpa pengenal. Byline adalah nama yang seseorang pilih untuk diterbitkan; profil bertaut adalah direktori staf yang tak diminta siapa pun dan yang tak bisa ditarik orangnya artikel per artikel. Node `publisher` tidak disentuh — ruang redaksi tetap penerbitnya.

### Satu query per halaman, bukan per post

Feed `?view=full` meresolusi byline untuk seluruh halaman dalam SATU lookup batch, berdampingan dengan lookup term dan institusi yang sudah ada. Ini bentuk yang dibela #649 saat feed belum membawa kategori artikel: _"mengambilnya per post berarti satu query tambahan tiap post"_ itu benar, dan kesimpulannya tidak mengikuti, karena satu halaman berisi lima puluh post butuh satu query berisi lima puluh id. Uji integrasinya menegakkan PLAFON query atas 32 post, dan plafon itu gagal ketika lookup-nya dibuat per-post (diverifikasi dengan membuatnya begitu).

### Penghapusan menghancurkannya

`awcms_tenant_users` mendapat kolom pribadi pertamanya, jadi deskriptor subject-data-nya kembali ke `anonymize` yang menamai persis kolom ini (ADR-0108). Byline yang selamat dari penghapusan akan meninggalkan nama orang itu di bawah setiap artikel yang ia tulis — tempat paling terlihat di mana sebuah nama bisa bertahan.

## Konsekuensi

- **Positif:** Issue #597 butir 4 tertutup di sisi ini, dan ruang redaksi bisa mengatribusikan liputan kepada orang yang mengerjakannya.
- **Positif:** atribusi artikel yang sudah ada tidak berubah, dan tidak ada nama staf yang menjadi publik tanpa tindakan yang disengaja.
- **Positif:** nilainya per-tenant, jadi deployment bersama tidak bisa membocorkan byline satu ruang redaksi ke situs yang lain.
- **Negatif / kompromi:** kini ada dua nama untuk satu orang — display name internal dan byline publik — dan operator harus paham mana yang mana. Petunjuk di layar akun menyatakannya dalam satu kalimat; tidak ada permukaan lain yang memunculkan perbedaan itu.
- **Negatif / kompromi:** byline adalah teks bebas, jadi ia bisa keliru, basi, atau nama orang lain. Itu melekat pada byline; mitigasinya adalah hanya pemiliknya yang bisa menyetelnya, dan setiap artikel yang ia tulis menampilkannya.
- **Netral:** kontributor tamu yang tidak punya akun tidak bisa diberi byline. Itu menuntut field teks bebas per-post, yang merupakan tempat sebuah nama bisa selamat dari penghapusan — sengaja tidak dibangun di sini.

## Alternatif yang dipertimbangkan

- **Menerbitkan `awcms_profiles.display_name`.** Ditolak — lihat di atas. Nol field baru, dan ia menjadikan publik sebuah nama yang tak dipilih siapa pun untuk diterbitkan.
- **Kolom `byline` teks bebas pada post.** Ditolak untuk putaran ini. Ia menangani kontributor tamu dan nama pena tanpa akun, dan ia menaruh nama seseorang di baris artikel di mana penghapusan yang berkunci pada tautan penulis tidak menjangkaunya: ia butuh jawaban hak-subjeknya sendiri, atau ia menjadi tempat sebuah nama melampaui permintaan penghapusan. Layak ditinjau ulang sebagai keputusan tersendiri, dengan jawaban itu ditulis lebih dulu.
- **Override per-post di atas byline tingkat-akun.** Ditolak sebagai prematur: ia adalah kolom teks bebas dengan satu cabang tambahan, dan ia melipatgandakan keadaan yang harus dipikirkan editor sebelum ada yang memintanya.
- **Mempertahankan atribusi tingkat-organisasi saja.** Ditolak: batasan yang menghasilkannya ("tidak ada konsep nama penulis yang aman-publik" pada #649) justru itulah yang dihapus ADR ini.
