🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](definition-of-ready.md)

<!-- i18n-source-hash: sha256:c5ba4696d2ced890a6014c53ceeba63cd2df0088fbb211b52bee973a9f3e4edf -->

# Definition of Ready (langkah 9 alur pengembangan)

> **Dijawab SEBELUM ada yang menulis kode**, dan itulah seluruh gunanya.
> [`../../../CONTRIBUTING.md`](../../../CONTRIBUTING.md) memuat Definition of **Done**,
> yang diperiksa di ujung. Daftar ini diperiksa di pangkal.

- **Langkah alur:** 9 ([`../alur-pengembangan.md`](../alur-pengembangan.md)).
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
