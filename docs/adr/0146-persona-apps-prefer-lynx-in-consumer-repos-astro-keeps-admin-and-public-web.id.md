🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0146-persona-apps-prefer-lynx-in-consumer-repos-astro-keeps-admin-and-public-web.md)

<!-- i18n-source-hash: sha256:138e7e4bb479ec015a9779759c75182a5fc0be0e38596e6febddd177681b0902 -->

# ADR-0146 — Aplikasi persona memilih Lynx di repo konsumennya sendiri; Astro tetap memegang setiap permukaan admin dan web publik

- **Status:** Diusulkan
- **Tinjauan:** menjadi Diterima setelah ditinjau maintainer. Sampai saat itu ia adalah rekomendasi, dan gerbang struktural di §7 sudah berlaku karena hanya melarang apa yang belum diterima oleh keputusan mana pun.
- **Tanggal:** 2026-10-20
- **Pengambil keputusan:** @ahliweb (menunggu tinjauan maintainer)
- **Menyempurnakan:** [ADR-0055](0055-development-confined-to-awcms-and-awcms-astro.id.md) (keluarga tetap dua repo; aplikasi persona adalah **konsumen** di repo produknya sendiri, bukan repo keluarga ketiga) dan [ADR-0070](0070-peran-keluarga-awcms-astro-memikul-publik-dan-admin-user.id.md) (batas kepemilikan admin adalah APA YANG DIKELOLA; ADR ini menambahkan teknologi web mana yang dipakai tiap permukaan). Tidak ada yang di-supersede, dan badan keduanya tidak ditulis ulang (Aturan 2 indeks ADR).
- **Terkait:** [ADR-0051](0051-admin-screens-consolidated-in-awcms.id.md) (setiap layar admin SISTEM dibangun di sini), [ADR-0045](0045-jualanku-porting-awcms-system-of-record-astro-bff.id.md) (`awcms` system of record, `awcms-astro` experience layer + BFF), [ADR-0065](0065-awcms-astro-consumer-contract-is-frozen.id.md) (kontrak konsumen beku), [ADR-0002](0002-bun-only-runtime.id.md) (Bun-only), [ADR-0071](0071-kosakata-url-publik-dibelah-blog-di-sini-news-di-awcms-astro.id.md) (kosakata URL publik), Issue #1133; pasangan sisi konsumen `ahliweb/awcms-one` #445

**Hanya dokumen dan tata kelola.** ADR ini tidak menambah modul, migrasi, path OpenAPI, kanal AsyncAPI, dependensi, maupun **kode Lynx**. Ia mencatat kebijakan pemilihan teknologi per permukaan produk, dan menyertakan satu gerbang struktural (§7) agar kebijakan itu tidak terkikis diam-diam.

## Konteks

Dua hal sama-sama benar pada `main` (20 Oktober 2026), dan risikonya adalah pembaca menyatukannya:

1. **Setiap permukaan admin dan web publik saat ini adalah Astro, berdasarkan keputusan.** [ADR-0051](0051-admin-screens-consolidated-in-awcms.id.md) menaruh setiap layar admin SISTEM di repo ini di bawah satu shell `/admin/*`; [ADR-0070](0070-peran-keluarga-awcms-astro-memikul-publik-dan-admin-user.id.md) membolehkan `awcms-astro` memikul halaman publik dan, bila situs menyatakannya, permukaan admin USER. Astro mendukung generasi statis dan **rendering on-demand per rute** ([Astro on-demand rendering](https://docs.astro.build/en/guides/on-demand-rendering/)), yang dibutuhkan admin terautentikasi-dinamis dan situs publik yang dapat dirayapi.
2. **Tim produk kini menginginkan aplikasi khusus persona** (pelanggan, pengemudi, kurir, mitra/agen, petugas gudang dan lapangan). Ini berat transaksi, intensif interaksi, atau terikat kemampuan native (kamera, lokasi, push, barcode, offline), yang adalah masalah berbeda dari konsol admin atau halaman publik. [ADR-0055](0055-development-confined-to-awcms-and-awcms-astro.id.md) sudah memutuskan di mana aplikasi seperti itu tinggal: keluarga tetap dua repo, dan aplikasi untuk sebuah persona adalah **konsumen** di repo produknya sendiri, bukan repo inti ketiga dan bukan salinan backend.

Lynx (LynxJS, dengan ReactLynx sebagai binding React-nya) adalah kandidat untuk kelompok kedua. Dokumentasinya sendiri mencantumkan dukungan Android, iOS, HarmonyOS, dan Web, **dengan kompatibilitas API yang berbeda per platform dan per versi**, serta output bundle web yang terpisah ([compatibility](https://lynxjs.org/next/guide/compatibility.html), [build](https://lynxjs.org/next/guide/build/index.html), [integrasi dengan aplikasi yang ada, termasuk Web](https://lynxjs.org/next/guide/start/integrate-with-existing-apps)). Dua konsekuensi mengikuti, dan yang pertama membentuk seluruh keputusan: **paritas fitur lintas target itu tidak boleh dijanjikan sebelum proof of concept**, dan tidak ada hal pada Lynx yang menjadi alasan menyentuh admin atau situs publik.

Pencarian issue repo ini untuk `lynx` tidak menemukan apa pun yang spesifik saat ini direncanakan (Issue #1133), sehingga tidak ada keputusan terdahulu untuk dilanjutkan dan tidak ada kode untuk dimigrasikan. Tanpa aturan tertulis, kegagalan yang paling mungkin bukan aplikasi Lynx yang buruk; melainkan PR bermaksud baik yang menambahkan workspace `@lynx-js/*` ke repo backend, atau "memodernkan" layar admin menjadi Lynx karena bisa dipasang di ponsel.

### Kata "aplikasi" adalah jebakannya

"Aplikasi" dipakai untuk tiga hal berbeda: ikon yang dapat dipasang, tampilan seukuran ponsel, dan alur kerja persona. Hanya yang ketiga yang menjadi alasan memilih teknologi UI berbeda. URL `/app`, tata letak seukuran ponsel, atau manifest Add-to-Home-Screen **tidak** menjadikan konsol admin sebagai aplikasi; konsol admin yang dapat dipasang sebagai PWA tetaplah konsol admin. ADR ini mendefinisikan "aplikasi persona" menurut **fungsi**, bukan URL, perangkat, atau kemampuan dipasang.

## Keputusan

### 1. Permukaan ke teknologi

| Permukaan                                                                          | ID jenis             | Teknologi                                    | Rumah                                | Aturan                                                                                                   |
| ---------------------------------------------------------------------------------- | -------------------- | -------------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| Admin SISTEM (layar tenant, owner, dan platform)                                   | `system-admin`       | Astro SSR (SSG only where viable)            | ahliweb/awcms                        | Tetap di sini di bawah shell admin; tidak pernah dimigrasikan ke Lynx.                                   |
| Admin USER sebuah situs                                                            | `user-admin`         | Astro SSR when authenticated (SSG per route) | ahliweb/awcms-astro                  | Tetap di awcms-astro, hanya bila situs menyatakan permukaanAdmin (ADR-0070); owner ditolak di sana.      |
| Halaman publik: blog dan berita, profil, katalog publik, landing, SEO              | `public-web`         | Astro SSG/SSR per route                      | ahliweb/awcms or ahliweb/awcms-astro | URL publik, metadata SEO, sitemap, canonical, aksesibilitas, dan crawlability dipertahankan; bukan Lynx. |
| Aplikasi persona (pelanggan, kurir, pengemudi, mitra, petugas gudang dan lapangan) | `persona-app-native` | LynxJS + ReactLynx (preferred candidate)     | a separate consumer product repo     | Repo sendiri; hanya kontrak API resmi; tanpa Lynx di shell admin atau publik.                            |
| Web mobile berkarakter aplikasi yang bukan publik, SEO, atau admin                 | `persona-app-web`    | Lynx for Web (only if the PoC passes)        | a separate consumer product repo     | Hanya setelah gerbang PoC lulus; fallback atau alternatif memerlukan ADR sendiri.                        |
| Admin yang dapat dipasang atau direncanakan sebagai PWA                            | `pwa-admin`          | Astro web app / PWA                          | the repo of the admin it packages    | PWA bukan alasan mengganti UI admin dengan Lynx.                                                         |

Kolom Teknologi dan Rumah sengaja dibiarkan dalam bahasa Inggris dan identik dengan sumber: keduanya dibandingkan kata demi kata dengan modul kebijakan. Teks aturan dalam tabel sumber (Inggris) adalah yang otoritatif. [`scripts/lib/product-surface-policy.ts`](../../scripts/lib/product-surface-policy.ts) membawa enam baris yang sama sebagai data beserta pengklasifikasi dari deskriptor skenario ke jenis; [`tests/product-surface-policy.test.ts`](../../tests/product-surface-policy.test.ts) gagal bila tabel di sini dan modul itu berbeda (§7).

**Prioritas bila sebuah permukaan cocok dengan lebih dari satu baris** (inilah catatan semantik yang dijadikan dapat dieksekusi):

1. **Apa pun yang mengelola sistem atau mengelola bagian milik seseorang di sebuah situs adalah permukaan admin dan tetap Astro**, apa pun perangkat, URL, atau kemampuan dipasangnya. Yang dapat dipasang adalah `pwa-admin`; selain itu `system-admin` atau `user-admin`.
2. Selain itu, halaman yang dimaksudkan untuk dirayapi dan dibagikan adalah `public-web`.
3. Selain itu, alur kerja persona adalah `persona-app-native` (kanal native) atau `persona-app-web` (kanal browser).
4. Selain itu permukaan itu **tidak terklasifikasi**, dan Definition of Ready (§6) belum terpenuhi: seseorang harus memutuskan apa itu sebelum apa pun dibangun.

"Preferred candidate" adalah kata yang disengaja. Lynx adalah teknologi yang dievaluasi lebih dulu untuk aplikasi persona; ia **bukan** penerimaan. Ia menjadi pilihan yang diadopsi untuk sebuah produk hanya ketika gerbang PoC produk itu (§5) lulus dan repo konsumennya mencatat hasilnya.

### 2. Batas yang tidak dapat ditawar

Berlaku untuk setiap aplikasi persona, apa pun teknologi UI-nya.

1. **Backend AWCMS tetap system of record**: Bun, Astro untuk permukaan webnya, PostgreSQL, RLS `FORCE`, RBAC/ABAC default-deny, audit, idempotency, domain event dan outbox. Aplikasi Lynx adalah **klien**. Ia bukan backend kedua, dan tidak pernah membaca database atau internal modul secara langsung.
2. **Aplikasi persona hanya memakai kontrak publik yang sesuai aktornya** (OpenAPI, DTO, kontrak event). Ia tidak mengimpor `src/modules/`, berbagi secret, memakai role database superuser, atau menjangkau endpoint admin secara implisit. API baru ditambahkan hanya untuk use case yang dinyatakan dan dengan otorisasi per resource (menjaga dari BOLA/IDOR), lewat alur endpoint biasa ([`awcms-new-endpoint`](../../.claude/skills/awcms-new-endpoint/SKILL.id.md)).
3. **Autentikasi dan sesi dirancang per jenis klien** dan tidak menduplikasi atau melemahkan kebijakan keamanan: OAuth/OIDC dengan PKCE, atau desain kredensial aplikasi yang disetujui ADR bila relevan; penyimpanan token aman di native (tidak pernah `localStorage` untuk rahasia native); CSRF, CORS, dan kontrol per-origin di Web; rotasi dan pencabutan; device binding bila dibutuhkan.
4. **Cache, offline, dan sync tidak pernah mem-bypass hak akses.** Rancangan aplikasi persona menyatakan penanganan konflik, replay, idempotency, tenant context, logout dan remote revoke, serta minimisasi data. Notifikasi push memerlukan adapter yang sesuai tiap platform (APNs, FCM, Web Push); kompatibilitas tidak pernah diasumsikan.
5. **Integrasi Lynx hidup di repo konsumennya sendiri.** `awcms-astro` tidak menjadi repo Lynx, dan tidak ada workspace UI Lynx ditambahkan ke repo ini, tanpa ADR terpisah (§7 membuatnya mekanis).
6. **Bun-first dan Bun-only tetap berlaku di sini.** Tooling Lynx dan RSBuild punya prasyarat sendiri (quick-start-nya menyebut Node), sehingga dukungan Bun diverifikasi dulu di repo PoC. Node, npm, pnpm, atau yarn tidak ditambahkan ke repo ini hanya karena quick-start Lynx menyebutnya ([ADR-0002](0002-bun-only-runtime.id.md); pengecualian memerlukan izin maintainer dan catatan tertulis).
7. **Perbedaan platform mengikuti matriks kompatibilitas resmi.** Aplikasi persona diuji di Android, iOS, HarmonyOS, dan Web (plus browser yang didukung), untuk aksesibilitas (WCAG 2.2), lokalisasi, performa di perangkat kelas bawah, telemetri, dan pelaporan crash. "Write once" adalah kemudahan pengembangan, bukan janji bahwa semua API berperilaku identik.
8. **Kepatuhan keamanan dan privasi berlaku:** ISO/IEC 27001/27002/27005/27701, ISO/IEC 27034, OWASP MASVS/ASVS, UU 27/2022 tentang Pelindungan Data Pribadi, dan PP 71/2019; model ancaman dan DPIA bila data sensitif diproses ([`privacy-analysis.md`](../awcms/privacy-analysis.id.md)).

### 3. Opsi yang dipertimbangkan

| Kriteria                 | Astro SSR/SSG (status quo)                          | Lynx native (ReactLynx)                                                                  | Lynx for Web                                                                 | Astro PWA                                                          |
| ------------------------ | --------------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Keamanan                 | Matang di sini: CSP single-owner, sesi, chokepoint  | Penyimpanan aman sisi klien dan PKCE harus dirancang per OS; permukaan klien lebih besar | Model browser plus bundle terpisah; kerja CSRF/CORS/per-origin ada pada kita | Postur sama dengan admin saat ini; cakupan Service Worker dikelola |
| Aksesibilitas            | WCAG AA diuji untuk admin (axe di CI)               | A11y per platform; diverifikasi oleh PoC                                                 | Bergantung pada renderer web; diverifikasi oleh PoC                          | HTML semantik, dapat diuji langsung                                |
| SEO                      | Terbaik: dirender server, dapat dirayapi, canonical | Tidak berlaku (bukan web)                                                                | Tidak cocok: tidak dibuat untuk dokumen yang dirayapi                        | Mungkin, tetapi shell PWA tidak menambah apa pun untuk SEO         |
| Performa                 | Paint pertama cepat; island klien berat dihindari   | Interaksi mirip native; perangkat kelas bawah harus diukur                               | Belum terukur; bundle web adalah output terpisah                             | Baik setelah dipasang; muat pertama bergantung jaringan            |
| Maintainability          | Satu stack, satu shell, digerbangi di repo ini      | Stack kedua, di repo terpisah, dimiliki tim produk                                       | Stack kedua dan output build kedua yang harus dijaga konsisten               | Satu stack, dipakai bersama admin                                  |
| Tooling Bun              | Terverifikasi (Bun-only ditegakkan di sini)         | Belum terverifikasi; PoC harus menunjukkan Bun bekerja atau pengecualian dicatat         | Belum terverifikasi; sama                                                    | Terverifikasi                                                      |
| Upgrade / kompatibilitas | Astro 7 selaras dengan gerbang repo                 | Perbedaan API per platform dan per versi (matriks resmi); biaya upgrade nyata            | Matriks sama plus dukungan browser                                           | Dukungan PWA browser bervariasi, tetapi basis kode tidak berubah   |
| Biaya                    | Terendah: tanpa stack baru                          | Keahlian tim baru dan CI per platform                                                    | Sama, ditambah target web untuk diuji                                        | Rendah                                                             |
| Migrasi                  | Tidak ada                                           | Tidak ada (hanya aplikasi persona baru; tidak ada UI yang berpindah)                     | Tidak ada                                                                    | Tidak ada                                                          |
| Kompleksitas operasional | Satu permukaan deployment                           | Rilis app store, armada perangkat, pelaporan crash, adapter push                         | Permukaan deployment dan cache tambahan                                      | Satu permukaan deployment plus pembaruan Service Worker            |

Cara membaca tabel:

- **Astro SSR/SSG adalah jawaban untuk admin dan web publik**, karena keduanya butuh otorisasi sisi server, crawlability, dan gerbang yang sudah ada di repo ini. Tidak ada dalam cakupan Lynx yang terdokumentasi yang membenarkan penggantinya.
- **Lynx native adalah kandidat untuk aplikasi persona** karena fungsi persona (kamera, lokasi, push, barcode, sync offline, alur kerja intensif interaksi) adalah alasan keberadaan klien native, dan ia menjaga permukaan web tetap sederhana. Ia kandidat, bukan adopsi: tooling Bun, kompatibilitas per platform, dan sifat keamanannya terbuka sampai PoC.
- **Lynx for Web sengaja menjadi baris yang paling bersyarat.** Ia hanya boleh untuk pengalaman web mobile berkarakter aplikasi yang bukan publik, bukan SEO, dan bukan admin, dan hanya setelah PoC mencakup dukungan browser, rendering, history dan deep link, offline, dan Web Push.
- **Astro PWA adalah jawaban untuk admin yang dapat dipasang.** Ia tidak butuh Lynx untuk dapat dipasang, sehingga kemampuan dipasang tidak pernah menjadi argumen untuk Lynx.

### 4. Tujuh skenario

Dikunci di sini dan di tes regresi, sehingga matriks keputusan dan kode mengklasifikasikannya sama.

| #   | Skenario                                                     | Klasifikasi (ID jenis)                                | Apa tetap di mana                                                      |
| --- | ------------------------------------------------------------ | ----------------------------------------------------- | ---------------------------------------------------------------------- |
| 1   | Aplikasi pelanggan di Android/iOS dan web-app privat         | `persona-app-native`, `persona-app-web`, `public-web` | Konsumen Lynx + API commerce terotorisasi; **katalog SEO** tetap Astro |
| 2   | Aplikasi driver/pengemudi dengan lokasi dan notifikasi       | `persona-app-native`                                  | Konsumen Lynx; tidak pernah memanggil endpoint admin sistem            |
| 3   | Aplikasi kurir dengan proof-of-delivery dan kamera           | `persona-app-native`                                  | Konsumen Lynx; permission kamera dan lokasi diuji per OS               |
| 4   | Aplikasi mitra atau agen dengan order dan komisi             | `persona-app-native`                                  | Konsumen Lynx; akses aktor dan tenant terisolasi                       |
| 5   | Aplikasi petugas gudang atau lapangan: scan barcode dan sync | `persona-app-native`                                  | Konsumen Lynx; kebijakan offline plus idempotency                      |
| 6   | Pengelolaan modul, pengguna, izin, audit, dan tenant         | `system-admin`                                        | Astro di bawah shell admin di repo ini                                 |
| 7   | Portal berita, blog, dan landing                             | `public-web`                                          | Astro SSG/SSR, bukan Lynx                                              |

Judul Issue #1133 berbunyi "lima skenario" padahal mendaftar tujuh; daftarnya yang otoritatif, dan ketujuhnya dikunci.

### 5. Gerbang proof-of-concept Lynx

Tidak ada aplikasi persona berbasis Lynx yang masuk produksi, dan `persona-app-web` tidak dipakai sama sekali, sampai PoC lulus. PoC berjalan **di luar repo ini** (repo PoC sekali pakai atau repo konsumen itu sendiri), dan **Lynx tidak dibawa ke AWCMS untuk menjalankannya**.

PoC harus menunjukkan, dengan tautan ke bukti yang dicatat di repo konsumen:

| Area               | Harus ditunjukkan                                                                                                                                               |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Target             | Build dan berjalan di Android, iOS, HarmonyOS (bila produk menargetkannya), dan Web, terhadap matriks kompatibilitas resmi untuk versi yang dipakai             |
| Kemampuan          | Setiap kemampuan yang dibutuhkan persona bekerja di setiap target yang diklaim: kamera, lokasi, barcode, push (APNs/FCM/Web Push), penyimpanan lokal, deep link |
| Web (bila diklaim) | Browser yang didukung, rendering, history dan deep link, offline, Web Push                                                                                      |
| Keamanan           | Login PKCE, penyimpanan token aman di native, logout dan remote revoke, tanpa secret di penyimpanan klien; pemeriksaan relevan MASVS                            |
| Offline dan sync   | Konflik, replay, idempotency (`Idempotency-Key`), tenant context, minimisasi data pada sesi yang dicabut                                                        |
| Kualitas           | Aksesibilitas (WCAG 2.2), lokalisasi (id dan en), performa perangkat kelas bawah, telemetri dan pelaporan crash                                                 |
| **Bun**            | Alur install, dev, dan build berjalan di bawah Bun, **atau** celahnya ditulis dengan izin maintainer untuk sebuah pengecualian                                  |

**Bila PoC gagal** pada dukungan, UX, atau keamanan, hasilnya bukan angkat bahu: ADR konsumen mencatat pengecualian (apa yang gagal, alternatif mana yang dipakai, untuk permukaan mana). Fallback atau alternatif untuk `persona-app-web` juga memerlukan ADR sendiri. Hasil PoC dicatat **sebelum** aplikasi Lynx dirilis ke produksi.

### 6. Definition of Ready untuk permukaan produk baru

Dijawab pada langkah 9 [`alur-pengembangan.md`](../awcms/alur-pengembangan.id.md), sebelum kode apa pun. Layar atau aplikasi baru tidak dimulai sebelum tiap jawaban ada.

1. **Apa yang dikelolanya, dan untuk siapa?** Bila ia mengelola sistem atau bagian milik seseorang di sebuah situs, itu admin: berhenti, itu Astro (`system-admin`, `user-admin`, atau `pwa-admin`).
2. **Apakah publik dan dimaksudkan untuk dirayapi?** Maka `public-web`: Astro.
3. **Apakah alur kerja persona** (transaksional, intensif interaksi, terikat kemampuan native)? Maka `persona-app-native` atau `persona-app-web`. Catat ID jenis yang dikembalikan pengklasifikasi; bila ia melempar error, permukaan itu tidak terklasifikasi dan belum siap.
4. **Repo mana?** Aplikasi persona adalah repo konsumen dengan issue-nya sendiri. Issue konsumen itu ada, dan repo ini tidak mendapat fitur UI untuknya.
5. **Kontrak publik mana yang dipanggilnya**, dan apakah setiap endpoint sudah ada dengan otorisasi per resource untuk aktor ini? Endpoint yang belum ada adalah issue API biasa di sini (OpenAPI, ABAC, tenant context), diajukan atas use case-nya sendiri.
6. **Autentikasi dan sesi** untuk jenis klien ini, menurut §2.3.
7. **Kebijakan offline, cache, dan sync**, menurut §2.4, bila bekerja offline.
8. **Adapter push** per platform, bila mengirim notifikasi.
9. **Hasil PoC** (§5) ditautkan, atau PoC adalah tugas pertama dan tidak ada yang dibangun sebelumnya.
10. **Model ancaman, MASVS/ASVS, dan DPIA** bila data sensitif diproses (§2.8).

### 7. Penegakan: gerbang struktural, bukan pendeteksi kata

[`tests/product-surface-policy.test.ts`](../../tests/product-surface-policy.test.ts) melakukan tiga hal:

- **Mengunci tujuh skenario** pada klasifikasi di atas, dan mengunci kasus tepi yang disebut catatan semantik (admin yang dapat dipasang adalah `pwa-admin`; admin dalam pembungkus native tetap `system-admin`; halaman publik yang dapat dipasang tetap `public-web`; permukaan yang tak terklasifikasi melempar error).
- **Memeriksa paritas** antara tabel §1 (dan cermin Indonesia ADR ini) dan modul kebijakan, dan gagal dengan pesan yang menyebut baris yang menyimpang. Tabel tidak dapat diubah tanpa modul, ataupun sebaliknya.
- **Menjaga Lynx tetap di luar repo ini secara struktural**: gagal bila `package.json` mendeklarasikan paket `@lynx-js/*` di bagian mana pun, bila berkas di bawah `src/` mengimpor dari `@lynx-js/`, atau bila berkas `lynx.config.*` ada di mana pun dalam repositori (kecuali `node_modules`, `dist`, `.git`, dan `.claude/worktrees`). Pesan kegagalan menunjuk ADR ini, menyatakan bahwa Lynx tempatnya di repo konsumen, dan menyatakan bahwa mengubahnya memerlukan ADR yang menggantikan.

Gerbang ini sengaja tidak memindai dokumentasi untuk kata "lynx": ADR ini, `AGENTS.md`, dan skill harus bebas membahasnya. Ia hanya melihat apa yang akan memasukkan Lynx ke system of record: dependensi, impor, konfigurasi build.

## Konsekuensi

- **Positif:** aturannya eksplisit dan terbaca agen: aplikasi persona memilih Lynx di repo konsumen; setiap admin dan setiap permukaan web publik tetap Astro. Kata "aplikasi" tidak bisa lagi dipakai untuk berargumen memindahkan admin ke Lynx. Backend tidak pernah menjadi host Lynx. Tim produk mendapat jalur jelas (Definition of Ready, gerbang PoC) alih-alih debat per proyek.
- **Negatif / trade-off:** gerbang PoC menunda aplikasi persona Lynx mana pun sampai selesai, dan Lynx for Web tidak dapat dipakai sampai saat itu. Sebuah produk mungkin butuh stack UI kedua dan keahlian tim kedua. Gerbang struktural memerlukan ADR yang menggantikan sebelum ada pengecualian, yang memang gesekan yang disengaja.
- **Netral:** tidak ada perubahan kode, skema, atau kontrak di sini, sehingga tidak ada migrasi, sinkronisasi OpenAPI, atau AsyncAPI. Pekerjaan khusus konsumen (matriks keputusannya, PoC-nya, permintaan API-nya) hidup di repo konsumen, misalnya `ahliweb/awcms-one` #445, dan tidak dilacak sebagai fitur di repo ini. ADR-0055 dan ADR-0070 disempurnakan, tidak diubah: badannya tidak disentuh dan tetap memutuskan pembagian repo dan kepemilikan admin.
- **Meninjau ADR ini:** ia beralih dari Diusulkan ke Diterima setelah tinjauan maintainer. Tinjauan arsitektur dan keamanan yang diminta issue adalah bagian dari tinjauan itu; hasil PoC adalah catatan terpisah yang datang kemudian dan harus ada sebelum aplikasi Lynx mencapai produksi.

## Alternatif yang dipertimbangkan

- **Mewajibkan Lynx untuk semua UI baru, termasuk admin.** Ditolak: membuang admin yang digerbangi, aksesibel, dan dirender server tanpa keuntungan, kehilangan crawlability pada halaman publik, dan menjanjikan paritas lintas platform yang tidak dijanjikan halaman kompatibilitas Lynx sendiri.
- **Melarang Lynx sepenuhnya.** Ditolak: aplikasi persona adalah kebutuhan nyata, dan kemampuan native adalah alasan klien native ada. Biaya kebijakan ini adalah gerbang PoC, bukan larangan.
- **Menaruh aplikasi Lynx di `awcms-astro` atau sebagai workspace di repo ini.** Ditolak: ADR-0055 menjaga keluarga di dua repo, ADR-0045 menjaga `awcms-astro` sebagai experience layer dan BFF, dan workspace Lynx di sini akan memasukkan stack kedua, dan kemungkinan tooling Node, ke system of record.
- **Gerbang pendeteksi kata yang menandai "lynx" di dokumentasi.** Ditolak: ia akan menghukum tepat dokumentasi yang diminta ADR ini dan tetap melewatkan dependensi nyata yang ditulis berbeda. Gerbang struktural di §7 melihat dependensi, impor, dan konfigurasi build.
- **Memutuskan Lynx for Web sekarang.** Ditolak: dukungan, history dan deep link, offline, dan perilaku Web Push-nya belum terbukti di sini, dan keputusan prematur akan menjadi janji paritas.

## Referensi

- Issue #1133 (ADR ini); sisi konsumen: `ahliweb/awcms-one` #445
- Lynx: <https://lynxjs.org/next/>, [compatibility](https://lynxjs.org/next/guide/compatibility.html), [build](https://lynxjs.org/next/guide/build/index.html), [integrasi dengan aplikasi yang ada (termasuk Web)](https://lynxjs.org/next/guide/start/integrate-with-existing-apps)
- Astro: [on-demand rendering](https://docs.astro.build/en/guides/on-demand-rendering/)
- [`docs/awcms/alur-pengembangan.md`](../awcms/alur-pengembangan.id.md), [`docs/awcms/templates/definition-of-ready.md`](../awcms/templates/definition-of-ready.id.md), [`docs/awcms/15_frontend_architecture_integration.md`](../awcms/15_frontend_architecture_integration.id.md)
