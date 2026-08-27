🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0098-the-cache-key-carries-the-locale-in-the-path.md)

<!-- i18n-source-hash: sha256:712c211f16d52b1d7ba059b4a99f1d1ad44d600c1344c12793b5a95e9d1d7bbf -->

# ADR-0098 — Kunci cache membawa locale, dan ia membawanya di PATH

- **Status:** Accepted
- **Tanggal:** 2026-08-15
- **Pengambil keputusan:** @ahliweb
- **Terkait:** [ADR-0042](0042-varnish-edge-cache-auto-activation.id.md) (URL adalah kunci cache), [ADR-0095](0095-the-interface-speaks-the-readers-language.id.md) §"Keputusan 5" (mencatat ini sebagai prasyarat), `infra/varnish/default.vcl`, `src/middleware.ts`

## Konteks

ADR-0095 memberi setiap request sebuah `locals.locale` lalu **tidak melokalkan satu pun permukaan publik**. Itu bukan kehati-hatian demi kehati-hatian; itu satu kalimat aritmetika:

> Satu URL publik yang badannya bervariasi menurut cookie adalah mesin salah-saji: Varnish akan menyajikan halaman Indonesia kepada pembaca Inggris.

`vcl_hash` mem-hash `req.http.host`, dan builtin mem-hash `req.url`. Tidak ada yang lain. Jadi hari ini dua pembaca `https://example.test/blog/acme` berbagi satu objek cache, dan yang pertama miss menentukan apa yang dilihat yang kedua. Melokalkan badan itu tanpa menyentuh kuncinya bukan bug yang muncul saat review — ia bug yang muncul sebagai _bahasa yang salah bagi orang asing_, beberapa menit kemudian, di halaman yang tak bisa dirender ulang oleh keduanya.

Prasyaratnya dicatat alih-alih diimplementasikan, dengan sengaja, dan ADR ini adalah keputusan yang ditunggunya. Briefnya eksplisit: **performa terbaik dan paling aman.**

Tiga mekanisme bisa membuat badan ter-cache benar secara locale.

**A — `Vary: Cookie`.** Benar, dan malapetaka. Jumlah objek cache berlipat menurut banyaknya _string cookie yang berbeda_, bukan banyaknya locale: id sesi, id analitik, dan token CSRF semuanya tinggal di `Cookie`, jadi hampir setiap pembaca mendapat salinan pribadi sebuah halaman publik. Hit rate runtuh mendekati nol, yang lebih buruk daripada tidak punya cache — origin kini membayar juga untuk miss milik cache. Ia juga memasukkan header pembawa kredensial ke dalam kunci cache, sehingga tabrakan kunci atau kekeliruan normalisasi menjadi kebocoran berdekatan-sesi, bukan sekadar kosmetik.

**B — `Vary: Accept-Language`, dinormalisasi di VCL.** Lebih baik: menormalisasi `Accept-Language` menjadi `en`/`id` di `vcl_recv` membatasi fan-out pada dua. Tetapi ia salah pada sumbu yang paling penting di sini — ia tidak bisa melihat _pilihan eksplisit_ pembacanya. Orang yang mengklik saklar Indonesia pada peramban berkonfigurasi Inggris akan mendapat bahasa Inggris selamanya, dan saklarnya tampak rusak sambil berperilaku persis seperti yang dispesifikasikan. Ia juga memusatkan kebenaran pada satu langkah normalisasi VCL: salah sedikit dan kegagalannya adalah salah-saji senyap, yaitu kegagalan yang sama dengan A, dicapai dengan cara yang lebih pintar.

**C — locale di path URL.** `/en/blog/acme` dan `/id/blog/acme` adalah URL berbeda, jadi keduanya sudah menjadi objek cache berbeda di bawah kunci yang ada hari ini.

## Keputusan

1. **Locale tinggal di path URL, dan kunci cache sama sekali tidak diubah.** `vcl_hash` tetap mem-hash `(host, url)`. Tidak ada header `Vary` yang ditambahkan ke respons publik mana pun. Inilah seluruh mekanismenya: dua locale adalah dua URL, dan cache tidak bisa salah-saji di antara keduanya karena ia tidak pernah punya alasan menganggapnya objek yang sama.

   Argumen performanya bukan "cukup cepat" melainkan _tidak berubah_: hit rate situs ber-prefiks locale identik dengan hit rate situs hari ini, dan jumlah objek tumbuh linear terhadap jumlah locale (2), bukan terhadap jumlah pembaca (A) atau jumlah permutasi header (B).

   Argumen keamanannya: **tidak ada header request yang masuk ke kunci cache**. Serangan cache-poisoning dan cache-splitting di kelas ini semuanya bekerja dengan membuat kunci tidak sepakat dengan badan; tidak ada ketidaksepakatan yang tersedia ketika kuncinya adalah path dan path itulah yang memilih badannya.

2. **`Vary: Cookie` dan `Vary: Accept-Language` DILARANG pada respons publik yang cacheable mana pun**, dan ini ditegakkan, bukan didokumentasikan. Cek header terlarang itu tempatnya bersama probe `edge-cache:surfaces:check` yang sudah ada: permukaan yang menyatakan dirinya cacheable dan memancarkan salah satunya gagal di gerbang. Tanpa itu, keputusan 1 hanyalah konvensi, dan orang berikutnya yang butuh variasi publik per-pembaca akan meraih alat yang sudah ada di kotaknya.

3. **Pemilihan locale terjadi lewat REDIRECT, tidak pernah lewat variasi.** Request ke URL publik tanpa prefiks dijawab `307` ke yang ber-prefiks, memilih locale dari urutan ADR-0095 (cookie → preferensi principal → default tenant → `Accept-Language` → `en`).

   Redirect itu membaca cookie, jadi **redirect-nya sendiri `private, no-store`** dan tidak pernah masuk cache. Hanya tujuan ber-prefiks yang cacheable. Inilah baris yang menjaga cookie tetap di luar cache sambil tetap menghormati pilihan eksplisit pembacanya — properti yang tidak bisa dimiliki opsi B.

4. **Locale default tenant mendapat path telanjang sebagai alias permanen, bukan badan cacheable kedua.** `/blog/acme` tidak merender; ia me-redirect. Satu URL kanonik per (sumber daya, locale), yang juga membuat `hreflang` bisa dinyatakan: `src/middleware.ts` saat ini meneruskan `locale: null` ke resolusi redirect dengan komentar bahwa itu penolakan sengaja sambil menunggu ADR ini, dan penolakan itu berakhir di sini.

5. **`x-default` menunjuk ke URL ber-prefiks milik default tenant**, bukan ke alias telanjang. Crawler yang mengikuti `x-default` harus mendarat pada dokumen kanonik yang cacheable, bukan pada redirect yang bervariasi menurut `Accept-Language` crawler itu sendiri.

6. **Admin tetap persis seperti sekarang.** `/admin` adalah `private, no-store` secara konstruksi ADR-0042 dan melokalkan dari cookie serta preferensi tersimpan. Tidak ada di atas yang berlaku padanya, dan tidak ada di atas yang boleh dibaca sebagai izin meng-cache-nya.

## Konsekuensi

- **Positif:** cache berperilaku identik dengan hari ini, tanpa header baru, tanpa suntingan VCL pada `vcl_hash`, dan tanpa mode kegagalan baru di lapisan yang paling sulit diamati. Menambah locale ketiga menambah URL, bukan dimensi cache.

- **Positif:** setiap locale dari setiap sumber daya publik punya URL kanoniknya sendiri, sehingga `hreflang`, sitemap, dan feed bisa dinyatakan tanpa mengarang konvensi parameter kueri yang lalu harus diajarkan kepada Varnish.

- **Trade-off, dan inilah yang sesungguhnya:** bentuk URL publik berubah. Tautan ke `/blog/acme` tetap berfungsi lewat redirect di keputusan 3, tetapi ia berhenti menjadi kanonik, dan sistem luar mana pun yang mencatat URL telanjang kini mencatat URL yang menjawab `307`. PROJECT_STATE §4 butir 6 sudah menyebut bentuk URL publik sebagai keputusan terbuka — ini menyelesaikan separuhnya.

- **Trade-off:** sebuah redirect memakan satu putaran bagi pembaca yang datang di URL telanjang. Ia dibayar sekali per pembaca per sumber daya, bukan per request, karena tujuan redirect-nya cacheable dan peramban mengikutinya; dan ia membeli properti bahwa cookie tidak pernah mencapai cache.

- **Netral:** `seo_distribution` sudah membangun URL absolut lewat `site-origin.ts` (putaran ADR-0097, #573), jadi prefiksnya masuk lewat satu pembangun origin yang sudah ada, bukan yang kedua.

- **Ditolak: `Vary` pada header yang dinormalisasi.** Ia mekanisme yang dipakai kebanyakan situs dan ia yang salah di sini, karena alasan khas produk ini: pengalih bahasa adalah kendali yang sudah pernah dikirim, dirusak, dan diperbaiki dua kali oleh repo ini (v9.1.1, v9.1.2). Desain yang membuat klik eksplisit tidak bisa mengalahkan header peramban akan menjadikan kendali itu dekoratif tepat pada permukaan yang dilihat paling banyak pembaca.

## Amandemen (2026-08-27, v10.0.1) — URL ber-prefix disajikan RUTE, bukan rewrite

**Yang berubah:** mekanisme penyajian di dalam keputusan 3, dan tidak ada yang lain.

Keputusan 3 menyatakan URL ber-prefix disajikan dengan me-_rewrite_-nya kembali ke rute telanjang (`next("/blog/acme")`), dan bagian Konsekuensi ADR ini membenarkannya dengan alasan "tanpa pohon `[locale]` ganda". **Mekanisme itu tidak berfungsi di build ini.** Rewrite yang sasarannya rute BERPARAMETER meresolusi rutenya dan menghitung params-nya dengan benar, lalu tidak pernah mengeksekusinya — yang menjawab justru catch-all.

Diukur terhadap image produksi, di container terisolasi, pada rute yang sama:

| sasaran rewrite                             | diakses langsung | lewat rewrite |
| ------------------------------------------- | ---------------- | ------------- |
| `/login`, `/search`, `/robots.txt` (statis) | 200              | 200           |
| `/blog/{tenant}/search` (berparameter)      | 200              | **404**       |
| `/blog/{tenant}`, `/blog/{tenant}/{slug}`   | —                | **404**       |

Karena setiap permukaan `/blog/{tenantCode}` berparameter, v10.0.0 merilis blog publik yang URL telanjangnya `307` ke URL ber-prefix yang menjawab 404 — indeks dan setiap artikel. `context.rewrite()` menjalankan ulang middleware sehingga berputar; memberi `URL` atau `Request` ke `next()` tidak mengubah apa pun. Tidak ada ejaan satu-baris dari mekanisme asli yang berhasil.

**Mekanisme baru:** keempat permukaan yang dibaca manusia punya rute nyata di `src/pages/[locale]/blog/[tenantCode]/…`. Masing-masing **hanya pendaftaran** — ia me-re-export handler rute telanjangnya lewat `localisedPublicRoute()`, yang mem-404-kan segmen yang bukan locale yang didukung. Keberatan ADR ini terhadap pohon `[locale]` adalah duplikasi LOGIKA, dan re-export tidak menduplikasi logika: perubahan pada rute telanjang otomatis menjadi perubahan pada rute ber-prefix.

`src/middleware.ts` tidak lagi me-rewrite. Ia tetap menyetel `locals.locale` dari path, tetap meresolusi aturan `seo_distribution` terhadap path telanjang, dan tetap me-`307` URL telanjang ke ejaan ber-prefix-nya.

**Yang TIDAK berubah:** keputusan 1, 2, 4, 5 dan 6 berlaku tanpa perubahan, begitu pula seluruh keputusan 3 kecuali mekanisme penyajiannya. Kunci cache tetap `(host, url)`, tidak ada `Vary` ditambahkan, pemilihan locale tetap `307` ber-`private, no-store`, path telanjang tetap alias yang tidak me-render, dan `/admin` tetap tak tersentuh. **Bentuk URL yang dilihat pembaca identik** — amandemen ini tak terlihat dari luar server.

**Kenapa ia sampai ke produksi dalam keadaan hijau.** Tak satu pun tes di level mana pun pernah mengambil URL publik ber-prefix locale. ADR ini menjadikan ejaan ber-prefix sebagai kanonik untuk setiap permukaan blog yang dibaca manusia, sementara suite terus menguji hanya ejaan telanjang, yang me-redirect. `tests/localised-public-routes.test.ts` menutupnya: ia menurunkan rute ber-prefix yang diwajibkan dari sistem berkas, sehingga permukaan ber-prefix baru tak bisa ditambahkan tanpa rutenya, dan ia terbukti lewat mutasi terhadap kedua cacat asli — menghapus satu rute ber-prefix dan mengembalikan rewrite masing-masing memerahkannya.
