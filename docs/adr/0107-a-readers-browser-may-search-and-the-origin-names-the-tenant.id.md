🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0107-a-readers-browser-may-search-and-the-origin-names-the-tenant.md)

<!-- i18n-source-hash: sha256:e65de257c17678ae1b92b3e0c762205df32594923f6bc2b3e1cb9a264e079aa9 -->

# ADR-0107 — Peramban pembaca boleh mencari, dan `Origin` yang menyebut tenant-nya

- **Status:** Accepted
- **Tanggal:** 2026-08-23
- **Pengambil keputusan:** ahliweb
- **Terkait:** Issue #597 butir 3; Issue #607; ADR-0040 §5 (permukaan pencarian publik); Issue #637 (kebijakan lintas-origin beacon, yang parser-nya dipakai ulang di sini); ADR-0065 (kontrak konsumen); ADR-0009 / epik #555 (resolusi tenant publik); PRD LenteraKalteng §27.1, FR-DSC-002

## Konteks

`site_search` sudah lengkap sejak berbulan-bulan: pengindeksan `tsvector` berbobot di belakang index GIN, pengurutan `ts_rank`, snippet ter-escape, paginasi keyset, facet tipe konten (#632) dan facet term (#633), typeahead trigram berbatas, semuanya di dalam batas RLS yang sama dengan datanya. Dua endpoint anonim melayaninya — `GET /api/v1/site-search/query` dan `GET /api/v1/site-search/suggest`.

**Tidak ada pembaca yang bisa menjangkaunya.** Permukaan pembaca tinggal di `ahliweb/awcms-astro`, yang merupakan build STATIS di origin-nya sendiri, dan tabel status Issue #597 sendiri mencatat mengapa butir 3 tetap terhalang sementara butir 1, 2, 5, 6 dan 7 sudah mendarat: "situs statis itu tidak pernah bicara ke `awcms` saat runtime, dan kotak pencarian berarti peramban PEMBACA memanggilnya. Itu CORS, `connect-src`, dan sebuah ADR."

Separuh CORS-nya adalah masalah yang lebih kecil. Yang lebih besar baru terlihat kalau permintaannya diikuti:

`withSiteSearchTenant` meresolusi tenant dari **host permintaan**. Pembaca di `https://news.example` mengirim permintaan ke `https://cms.example`, jadi host-nya adalah milik CMS sendiri. Resolusi host lalu jatuh melalui rantai yang terdokumentasi — `PUBLIC_DEFAULT_TENANT_ID` -> `PUBLIC_DEFAULT_TENANT_CODE` -> `awcms_setup_state.tenant_id` — dan mendarat di **tenant bawaan** deployment. Pada deployment LAN satu-tenant, fallback itu justru benar; diterapkan pada pemanggil lintas-origin, artinya situs publik satu tenant menampilkan artikel tenant lain sebagai hasil pencariannya sendiri, dengan 200, daftar terisi, dan tidak ada apa pun yang melaporkan masalah.

Jadi "tambahkan header CORS" bukan keputusannya. Keputusannya adalah: tenant sebuah permintaan lintas-origin itu APA.

## Keputusan

**Permintaan pencarian lintas-origin meresolusi tenant-nya dari header `Origin`, terhadap `awcms_tenant_domains`, dan dari tidak ada yang lain. Permintaan same-origin tidak disentuh.**

### `Origin` adalah tenant-nya, dan rantai fallback TIDAK dijalankan

`resolvePublicTenantByHost` adalah satu-satunya resolver di jalur lintas-origin. Tanpa default env, tanpa default setup-state. Origin yang tidak dilayani deployment ini tidak meresolusi apa pun dan permintaannya dijawab dengan payload kosong netral — tidak pernah dengan konten tenant bawaan.

Ini bukan kesantunan CORS. Pemanggil yang mengabaikan CORS sama sekali (`curl`, perayap, proxy) mendapat jawaban kosong yang sama, karena penolakannya terjadi di resolusi tenant, bukan di sebuah header. Andai dikerjakan dengan header saja, artikel tenant bawaan tetap ada di badan respons; peramban hanya menolak menampilkannya.

`Origin` aman dijadikan sumber resolusi justru karena peramban yang menyetelnya dan sebuah halaman tidak bisa memalsukannya. Dan yang dibandingkan dengannya — domain `active` milik tenant `active`, lewat lookup SECURITY DEFINER yang sama dengan router host publik — adalah predikat yang sama yang memutuskan apakah deployment ini menjawab untuk hostname itu sama sekali. **Mendaftarkan dan memverifikasi domain ITULAH opt-in-nya**, jadi tidak ada sakelar kedua yang bisa berselisih dengan yang pertama, dan kerja ADR-0106-lah yang membuat predikat itu bermakna.

### CORS bukan otorisasi, sekali lagi

Pemberian izin memutuskan apakah peramban boleh MEMBACA jawaban kita. Ia tidak memutuskan isi jawabannya — itu resolusi tenant, di atas. Keduanya dipisahkan di sini dengan alasan yang sama seperti beacon Issue #637 memisahkannya, dan kegagalan menggabungkannya bersifat konkret: desain yang hanya-header membocorkan badan respons ke apa pun yang bukan peramban.

### Tanpa kredensial, dan tanpa handler preflight

`Access-Control-Allow-Credentials` **tidak ada**. Pencarian tidak membawa sesi dan tidak butuh cookie, dan respons tanpa header itu tidak bisa dibaca oleh permintaan ber-kredensial sama sekali — sehingga permukaan ini tidak akan pernah bisa menjadi jalur confused-deputy ke sesuatu yang dibuka oleh cookie pembaca.

Sengaja **tidak ada handler `OPTIONS`**. Sebuah `GET` yang hanya membawa header CORS-safelisted adalah permintaan sederhana: peramban mengirimnya langsung dan tidak ada preflight. Menjawab preflight tidak memberi keuntungan apa pun bagi konsumen yang benar dan diam-diam mengubah ini menjadi API lintas-origin serbaguna; konsumen yang menambahkan header khusus justru langsung tahu.

### Penolakannya senyap, metriknya tidak

Origin yang ditolak mendapat payload netral yang sama dengan tenant yang dinonaktifkan, bita demi bita — aturan "jangan pernah bocorkan MENGAPA" yang sudah ada, tidak berubah. Ia juga membayar `padUnresolvedSearchTenantLatency`, sehingga "origin ini tenant di sini" juga tidak terbaca dari waktu respons.

Operator tetap perlu bisa membedakan "kotak pencarian situs diarahkan ke domain yang tidak terdaftar" dari "tenant ini mematikan pencarian", jadi keduanya menjadi nilai terpisah pada counter `site_search_queries_total` yang sudah ada (`origin_refused` vs `disabled`). Counter sisi-server bukan pengungkapan kepada pemanggil.

### `Vary: Origin` di setiap jawaban, termasuk 429

Badan respons identik untuk pemberian izin maupun penolakan; HEADER-lah yang berbeda, jadi cache yang tidak tahu bahwa respons bergantung pada `Origin` akan menyajikan izin satu origin kepada origin lain. Endpoint ini tidak di-edge-cache hari ini. Header itu menyatakan ketergantungannya sekarang, bukan setelah suatu perubahan cache di masa depan membuatnya penting — dan ia juga dipasang pada 429 rate-limit, yang dijawab sebelum origin pernah diklasifikasikan.

### Parser `Origin` dipakai bersama, bukan disalin

`parseRequestOrigin` / `isCrossOriginRequest` pindah dari `visitor-analytics/domain/beacon-cors.ts` ke `lib/security/request-origin.ts`, tanpa perubahan dan dengan alasannya. Dua salinan parser keamanan yang dikeraskan adalah susunan di mana salinan yang tidak dikeraskan siapa pun adalah yang ditemukan penyerang; repo ini sudah membayar bentuk itu empat kali lewat `stripComments`.

### Urutan pembekuan tetap berlaku

`/api/v1/site-search/query` dan `/api/v1/site-search/suggest` masuk `COMMITTED_PATHS` di sini dan pindah ke `CONSUMED_PATHS` ketika `ahliweb/awcms-astro` memanggilnya, dibuktikan oleh gerbang repo sana — urutan tiga langkah yang sama yang diikuti ADR-0102, ADR-0104 dan ADR-0105.

## Konsekuensi

- **Positif:** Issue #597 butir 3 dan sisa separuh #607 terbuka di sisi ini; pembaca mendapat pencarian, facet dan typeahead dari situs yang dibangun statis tanpa BFF di antaranya.
- **Positif:** fallback lintas-tenant ditutup secara KONSTRUKSI, bukan oleh sebuah header, jadi ia berlaku juga untuk pemanggil non-peramban.
- **Positif:** satu parser origin, bukan dua.
- **Negatif / kompromi:** konsumen harus mengirim permintaannya dengan `fetch` dan **tanpa header khusus**. Menambahkan satu saja mengubah permintaan sederhana menjadi ber-preflight, yang tidak dijawab siapa pun, dan kegagalannya berupa galat CORS di sisi peramban, bukan entri log server.
- **Negatif / kompromi:** tenant yang origin situs statisnya bukan domain terdaftar dan terverifikasi mendapat kotak pencarian kosong yang tidak melaporkan apa pun. Itu postur fail-closed yang sama dengan sisa resolusi publik, dan itulah sebabnya penolakannya punya counter sendiri.
- **Negatif / kompromi:** jalur lintas-origin memakan satu query tambahan (lookup domain) per permintaan pencarian. Ia hanya mendarat pada permintaan lintas-origin, setelah rate limiter per-IP, dan ia adalah lookup yang sama yang sudah dibayar preflight beacon.
- **Netral:** halaman HTML `/search` tetap memakai jalur resolusi-host yang tidak berubah. Navigasi tingkat-atas tidak mengirim `Origin`.

## Alternatif yang dipertimbangkan

- **Parameter `?tenantCode=` eksplisit, mengikuti bentuk beacon.** Ditolak. Beacon membutuhkannya karena preflight tidak membawa badan dan tenant sebuah POST harus diputuskan oleh penulisnya; permintaan pencarian punya `Origin` yang sudah menyebut tenant-nya secara tak-terpalsukan. Menambahkan parameter itu akan menaruh pengenal publik di setiap query string dan membiarkan pemanggil mana pun mencari indeks tenant mana pun dengan menyebutnya — fallback dengan permukaan lebih lebar, dipilih demi simetri dengan endpoint yang batasannya tidak berlaku di sini.
- **Mengizinkan `*`.** Ditolak mentah-mentah. Jawabannya per-tenant; `*` berarti setiap halaman di internet membaca tenant mana pun yang diresolusi permintaan itu, dan ia menghapus satu-satunya mekanisme yang mengikat jawaban ke domain terdaftar.
- **Allow-list origin tersendiri lewat env.** Ditolak: daftar kedua yang bisa berselisih dengan `awcms_tenant_domains`, perlu disunting setiap kali tenant ditambahkan, di berkas yang tidak bisa dijangkau administrator tenant mana pun.
- **BFF di `awcms-astro` yang mem-proxy pencarian di sisi server.** Ditolak untuk issue ini, bukan atas dasar mutu — build repo itu statis dan tidak punya server saat runtime (BFF ADR-0050 belum dibangun). Meraihnya berarti memblokir mesin yang sudah jadi di belakang komponen yang belum dibangun.
- **Membiarkan rantai host apa adanya dan hanya menambahkan header.** Ditolak: ia menjawab pertanyaan CORS dan membiarkan pertanyaan lintas-tenant terbuka, ke arah di mana badan respons sudah berada di kabel.
