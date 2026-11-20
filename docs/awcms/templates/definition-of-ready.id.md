🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](definition-of-ready.md)

<!-- i18n-source-hash: sha256:9be97b70c57f133707ee7d6a835164db8943f7793e85e992cfa31cec7110edad -->

# Definition of Ready (langkah 9 alur pengembangan)

> **Dijawab SEBELUM ada yang menulis kode**, dan itulah seluruh gunanya.
> [`../../../CONTRIBUTING.md`](../../../CONTRIBUTING.md) memuat Definition of **Done**,
> yang diperiksa di ujung. Daftar ini diperiksa di pangkal.

- **Langkah alur:** 9 ([`../alur-pengembangan.md`](../alur-pengembangan.md)).
- **Versi alur:** v2.0.0. Pemeriksaan gerbang 9 v2 ada di §Pemeriksaan gerbang 9
  yang ditambahkan alur v2 di bawah; sumbernya
  [ADR-0156](../../adr/0156-adopt-development-flow-v2-validated-ux-before-data-model-frontend-backend-integration-per-slice.id.md) §4.
- **Untuk modul BARU**, daftar ini tidak menggantikan
  [`module-admission-decision-checklist.md`](module-admission-decision-checklist.md)
  — ia mendahuluinya.

## Kenapa daftar ini ada, dengan bukti dari repo ini sendiri

**Dua gelombang berturut-turut menulis rencana yang mengasumsikan pembacaan
lintas-tenant yang FORCE RLS larang.** ADR-0087 memintanya sebagai "baris audit
di setiap tenant terjangkau"; ADR-0088 memintanya sebagai daftar keanggotaan di
respons 409. Keduanya masuk akal di atas kertas, keduanya lolos perencanaan, dan
keduanya baru ketahuan **saat implementasi** — setelah kode ditulis di atas
premis yang salah.

Satu pertanyaan akan menemukan keduanya di langkah 9, dan ia yang pertama di
bawah.

## Pertanyaan yang berlaku untuk SETIAP perubahan

1. **Apakah policy mengizinkan setiap pembacaan dan penulisan yang rencana ini
   butuhkan?** Bukan "apakah ada permission-nya" — apakah **RLS** mengizinkannya.
   Sebuah rencana yang membaca lintas tenant, atau menulis ke tenant lain,
   hampir selalu salah, dan yang tidak salah menuntut ADR.
   **Cara memverifikasi**: jalankan query-nya sebagai `awcms_app` di konteks
   tenant yang relevan terhadap basis data berisi data yang mirip. Nol baris
   adalah jawaban, bukan kegagalan setup.
2. **Kelas perubahannya apa?** (tabel di dokumen alur). Ia yang menentukan
   langkah 1–8 mana yang wajib, dan menebaknya di tengah jalan adalah bagaimana
   sebuah PR menjadi dua PR.
3. **Apa kriteria diterimanya, dalam kalimat yang bisa gagal?** "Bekerja dengan
   baik" tidak bisa gagal. "Pencabutan grant mematikan sesi hidup di transaksi
   yang sama" bisa.
4. **Apa yang akan MEMBUKTIKANNYA, dan mutasi apa yang memerahkannya?** Sebuah
   cek yang hijau tidak membuktikan apa pun sampai ia dibuktikan gagal pada
   kondisi yang seharusnya. Bila jawabannya belum terpikir di langkah 9, biasanya
   berarti kriteria di nomor 3 belum cukup tajam.

## Pertanyaan bersyarat

| Bila perubahan menyentuh…       | Yang harus sudah dijawab                                                                     |
| ------------------------------- | -------------------------------------------------------------------------------------------- |
| skema                           | tabel/kolomnya, RLS-nya, index FK-nya, **dan jawaban retensinya** (gerbangnya akan menuntut) |
| akses (RBAC/ABAC/RLS)           | permission mana, deny-only atau tidak, dan di mana urutannya dalam rantai chokepoint         |
| kontrak API/event               | fragmen OpenAPI/AsyncAPI-nya, dan apakah perubahannya aditif                                 |
| data pribadi                    | tiga pertanyaan di [`../privacy-analysis.md`](../privacy-analysis.md) §3                     |
| sesuatu yang mendarat **inert** | apa yang membuatnya inert, dan PR mana yang menghidupkannya                                  |
| lapisan fondasi                 | **ADR-nya**, bukan niat menulis ADR                                                          |

## Pemeriksaan gerbang 9 yang ditambahkan alur v2 (ADR-0156 §4)

Alur v2 menambahkan lima pemeriksaan ke gerbang ini dan satu cacat blocking.
Kotak yang dijawab "ya" tanpa sesuatu yang bisa dibuka reviewer **bukan**
jawaban: tiap baris menyebut buktinya, dan menyatakan jujur di mana buktinya
**belum ada**. Bila perkakas sebuah pemeriksaan belum ada, pemeriksaan itu
dijawab "belum siap" (atau "tidak berlaku" dengan alasan), tidak pernah
dicentang.

| #   | Pemeriksaan                                                                                                       | Bukti yang bisa dibuka reviewer                                                                                                                                                                                                                                                                                                                                                                                                | N/A hanya bila                                                                                       |
| --- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| V1  | Setiap layar punya sumber data yang **terpetakan ke operasi kontrak** (`operationId` OpenAPI atau kanal AsyncAPI) | Inventaris data per layar di langkah 4 (**template-nya belum ada**, lihat [`../alur-pengembangan.md`](../alur-pengembangan.md) §4, jadi tautkan inventaris yang dibawa issue) dengan tiap barisnya menunjuk fragmen di [`../../../openapi/modules/`](../../../openapi/modules/) atau [`../../../asyncapi/`](../../../asyncapi/). `bun run api:spec:check` membuktikan fragmen itu valid, bukan bahwa layarnya terpetakan       | perubahan tidak menambah atau mengubah **layar apa pun** (hanya backend, hanya dokumen, chore)       |
| V2  | Temuan usabilitas berprioritas tinggi (`UXT-*`) **tuntas, atau diterima oleh orang yang disebut namanya**         | Laporan uji usabilitas langkah 4. **Template laporan, skema ID, dan putaran uji yang tercatat belum ada** (celah alur §4): sampai ada, tulis "tidak ada putaran uji" beserta **orang yang disebut namanya** yang menerima pengiriman layar yang belum diuji                                                                                                                                                                    | tidak ada layar atau alur yang terlihat pengguna berubah                                             |
| V3  | Desain diperiksa terhadap **WCAG 2.2 AA**                                                                         | Review desain terhadap 2.2 AA, dicatat di issue atau PR. `bun run design:token-contrast:check` dan `tests/e2e/a11y-axe.e2e.ts` bekerja **belakangan dan pada hasil build**; keduanya tidak menggantikan pemeriksaan desain. [`../14_ui_ux_design_system.md`](../14_ui_ux_design_system.md) masih menyebut 2.1 AA (celah alur §4): tetap review terhadap 2.2 AA                                                                 | tidak ada UI yang terlihat pengguna berubah                                                          |
| V4  | Mock **dihasilkan dari kontrak** dan **menjalankan contoh kontrak**                                               | Hasil jalan generator dan keluarannya. **Belum ada generator terpasang** (celah [`../alur-pengembangan.md`](../alur-pengembangan.md) §8), sehingga untuk slice yang punya 11.1 pemeriksaan ini saat ini tidak bisa dipenuhi: jawab "belum siap untuk 11.1 terhadap mock" atau catat di issue alternatif yang dipakai (lihat §11.1 untuk kasus admin SSR). Mock tulis tangan adalah spesifikasi kedua dan tidak pernah dihitung | slice **tidak punya 11.1** (tidak ada layar atau klien yang mengonsumsi kontrak)                     |
| V5  | Pass **kedua** atas keamanan dan privasi langkah 3, setelah UI, data, dan API punya bentuk                        | Tiga pertanyaan [`../privacy-analysis.md`](../privacy-analysis.md) §3 dijawab ulang terhadap layar, tabel, dan operasi final; permission setiap operasi dan jawaban RLS pertanyaan 1 di atas; masking pada setiap layar yang menampilkan data terklasifikasi. Catat di issue atau PR                                                                                                                                           | **tidak pernah N/A seluruhnya**: perubahan tanpa efek data, endpoint, atau akses menulis kalimat itu |

### Cacat blocking

Cacat di bawah mengembalikan pekerjaan **ke langkah yang memegangnya, lalu
melewati gerbang ini lagi**. Ia tidak bisa diloloskan dengan catatan.

| Cacat                                       | Tempat memeriksa                                                                                                                                                    | Cek otomatis yang ada                                                                                                                            |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| layar **tanpa sumber data di kontrak** (v2) | V1 di atas                                                                                                                                                          | tidak ada (`admin:screen-coverage:check` memetakan permission ke layar, itu pertanyaan lain)                                                     |
| endpoint **tanpa permission**               | descriptor `permissions` di `src/modules/*/module.ts` dan fragmen keamanan operasinya                                                                               | `access:permissions:enforcement:check`, `access:chokepoint:check`, `api:spec:check`                                                              |
| tabel **tanpa klasifikasi**                 | tingkat sensitivitas di [`../04_erd_data_dictionary.md`](../04_erd_data_dictionary.md) §Sensitive data classification, ditambah jawaban RLS dan jawaban subjek data | RLS: `security:readiness`; subjek data: `subject-data:coverage:check`. **Tidak ditemukan gerbang yang memeriksa tingkat klasifikasinya sendiri** |
| kolom PII **tanpa kebijakan retensi**       | descriptor `dataLifecycle` tabel itu ([`../data-lifecycle.md`](../data-lifecycle.md))                                                                               | `data-lifecycle:table-coverage:check`                                                                                                            |

### Perubahan yang tidak punya layar

Perubahan hanya-backend, hanya-dokumen, chore, dan pembaruan dependensi **tidak**
memerlukan prototipe UI, uji usabilitas, review WCAG, atau mock. V1–V4 lalu
ditulis "N/A" **beserta alasannya** (misalnya "tanpa layar: hanya menambah
`GET /api/v1/...`"), dan reviewer boleh tidak setuju dengan alasannya. Yang tidak
pernah menjadi N/A: permission setiap operasi, jawaban RLS, jawaban privasi, dan
V5. Tabel kelas perubahan di [`../alur-pengembangan.md`](../alur-pengembangan.md)
menentukan langkah 1–8 mana yang wajib; bagian ini hanya menyatakan bagaimana
pemeriksaan baru berlaku setelah itu ditentukan.

### Konsumen frontend dan aplikasi persona

Untuk slice yang layarnya ada di repo konsumen (`awcms-astro`, aplikasi persona),
V1–V4 dijawab di sana terhadap **kontrak repo ini**, dan issue di sini hanya
menautkan buktinya. Repo ini tidak memiliki uji usabilitas konsumen, tetapi
memiliki operasi kontrak yang dipetakan V1.

## Permukaan produk baru (layar atau aplikasi)

Berlaku bila perubahan menambah **layar, aplikasi, atau klien baru**, bukan
mengubah yang sudah ada. Sumber: [ADR-0146](../../adr/0146-persona-apps-prefer-lynx-in-consumer-repos-astro-keeps-admin-and-public-web.id.md) §6;
pengklasifikasinya adalah `classifySurface` di
[`scripts/lib/product-surface-policy.ts`](../../../scripts/lib/product-surface-policy.ts).

Bagian ini **mengikat setelah ADR-0146 berstatus Accepted**; selama masih
Proposed, pakai sebagai panduan. Pemeriksaan struktural tanpa-Lynx di
`tests/product-surface-policy.test.ts` sudah berjalan, apa pun status ADR-nya.

1. **Apa yang dikelolanya, dan untuk siapa?** Sistem, atau bagian milik seseorang
   di sebuah situs, menjadikannya permukaan **admin**: berhenti, itu Astro
   (`system-admin` di sini, `user-admin` di `awcms-astro` hanya bila situs
   menyatakannya, atau `pwa-admin`).
2. **Apakah publik dan dimaksudkan untuk dirayapi?** Maka `public-web`: Astro.
3. **Apakah alur kerja persona** (transaksional, intensif interaksi, terikat
   kemampuan native)? Maka `persona-app-native` atau `persona-app-web`. Catat
   jenis yang dikembalikan pengklasifikasi; bila ia melempar error, permukaan itu
   tidak terklasifikasi dan **belum siap**. "Aplikasi" bukan URL `/app`, tampilan
   seukuran ponsel, atau manifest yang dapat dipasang.
4. **Repo mana?** Aplikasi persona adalah repo konsumen dengan issue-nya sendiri;
   repo ini tidak mendapat fitur UI untuknya, dan tidak ada dependensi
   `@lynx-js/*`, impor, atau `lynx.config.*` (tes gagal bila ada).
5. **Kontrak publik mana yang dipanggilnya**, dengan otorisasi per resource untuk
   aktor ini? Endpoint yang belum ada adalah issue API biasa di sini.
6. **Autentikasi dan sesi** untuk jenis klien ini (PKCE, penyimpanan aman di
   native, CSRF/CORS di Web); **kebijakan offline, cache, dan sync** (konflik,
   replay, idempotency, tenant context, remote revoke, minimisasi data); adapter
   **push** per platform.
7. **Hasil PoC ditautkan** (Android, iOS, HarmonyOS, Web, dan tooling Bun,
   dijalankan di luar repo ini), atau PoC adalah tugas pertama.
8. **Model ancaman, MASVS/ASVS, dan DPIA** bila data sensitif diproses.

## Dua hal yang BUKAN bagian dari daftar ini

- **Estimasi.** Tidak ada di alur ini dan tidak ditambahkan di sini.
- **Desain lengkap.** Langkah 9 menanyakan apakah rencananya bisa dikerjakan dan
  apakah spesifikasinya saling setuju — bukan menuntut jawaban akhir untuk
  pertanyaan yang justru paling murah dijawab dengan menulis kode.
