🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0112-astro-frontmatter-is-type-checked-by-extraction.md)

<!-- i18n-source-hash: sha256:88b8866dc964d7e25a57677d16737dc83a7c5a3871708a46aca48b4bbbf37019 -->

# ADR-0112 — Frontmatter `.astro` ditype-check lewat EKSTRAKSI, karena `astro check` tak bisa jalan di sini

- **Status:** Accepted
- **Tanggal:** 2026-08-23
- **Pengambil keputusan:** ahliweb
- **Terkait:** temuan standar C4; [ADR-0068](0068-family-standards-posture-editions-and-recorded-divergences.md) §C (selisih yang dipersempit ini); Issue #552 (`check:astro-scripts:check`, teknik yang sama untuk blok `<script>`); `awcms-family-compatibility.yaml` → `astro-files-not-type-checked`

## Konteks

`bun run typecheck` adalah `tsc --noEmit`, dan `tsc` tidak bisa mem-parse `.astro`. Jawaban bakunya adalah `astro check`, dan repo ini TIDAK BISA menjalankannya. Diverifikasi dengan memasang `@astrojs/check@0.9.10` lalu menjalankannya, bukan dengan membaca rentang peer-nya:

> The TypeScript module loaded (found 7.0.2) does not expose the programmatic API that `astro check` relies on. TypeScript's native compiler (7.0 and later) does not ship this API yet.

Tidak ada versi yang memperbaikinya. Repo ini sengaja berada di TypeScript `^7.0.2`, dan menurunkannya ke 6.x demi satu pemeriksa akan meregresi toolchain di bawah 33 gerbang dan ~156.000 baris yang hari ini dijaga bersih `tsc`.

Jadi **61 berkas `.astro` — sekitar 34.760 baris — tidak diperiksa apa pun.** ADR-0068 §C mencatatnya sebagai selisih sengaja dengan tanggal tinjau, dan mitigasinya eksplisit: `awcms-testing` dan `awcms-pr-review` menginstruksikan setiap diff `.astro` dibaca tipenya DENGAN MATA.

### Membaca dengan mata TIDAK berhasil, dan buktinya sebuah layar yang tak pernah merender

`/admin/seo` menghitung:

```ts
const showRedirectActions = canUpdateRedirect || canDeleteRedirect;
```

sebagai pernyataan KETIGA frontmatter-nya, dari tiga `const` yang dideklarasikan **130 baris di bawahnya** dalam scope yang sama. Itu temporal dead zone: fungsi komponen terkompilasi melempar `ReferenceError: Cannot access 'canUpdateRedirect' before initialization` sebelum merender apa pun.

**Layar itu menjawab 500 pada setiap permintaan dan tidak pernah sekali pun bekerja.** Ia lolos review, `bun run check`, build, dan CI. Chunk produksi terkompilasi menunjukkan urutannya terjaga — pernyataan 3 membaca apa yang dideklarasikan pernyataan 120 — jadi ini bukan bahaya teoretis.

Layar operator yang selalu 500 adalah mode kegagalan yang paling sulit disadari repo ini: tidak ada yang mem-poll `/admin/seo`, dan deskriptor modulnya mendaftarkannya di sidebar, jadi ia TAMPAK terkirim.

## Keputusan

**Setiap frontmatter `.astro` diekstrak ke `*.astro-frontmatter-check.ts` bersebelahan dan ditype-check dengan `tsc` milik repo ini sendiri, sebagai `check:astro-frontmatter:check` di rantai `check`.**

Ini teknik yang sudah dipakai `check:astro-scripts:check` untuk blok `<script>` (Issue #552, yang menemukan dua cacat dengan cara sama), diterapkan pada separuh berkas yang lain. Berkas ter-generate mendarat di DIREKTORI YANG SAMA dengan halamannya dan dihapus di `finally`: impor frontmatter bersifat relatif, jadi pohon tercermin di tempat lain akan menuntut setiap specifier ditulis ulang — transformasi yang bisa salah sendiri, lalu melaporkan galat yang TIDAK ADA di halamannya.

### Empat kompromi, semuanya disengaja dan didokumentasikan di tempatnya

Frontmatter terekstrak bukan modul mandiri yang sah. Empat penyesuaian membuatnya kompilasi, dan masing-masing melepaskan sesuatu:

1. **`declare module "*.astro"`** — `tsc` tak bisa meresolusi impor komponen. **Harganya:** `Props` sebuah komponen TIDAK diperiksa di call site-nya; prop salah eja atau yang hilang tetap kompilasi.
2. **`declare const Astro`** — kompiler menyuntikkan global ini di `.astro` sungguhan. `App.Locals` tetap berlaku, jadi `Astro.locals.ssrContext` dan `Astro.locals.locale` TETAP diperiksa. **Harganya:** `Astro.props` menjadi record generik alih-alih `Props` milik halamannya.
3. **`export {}` ditambahkan** — frontmatter tanpa impor adalah SCRIPT bagi TypeScript, jadi `const` tingkat-atasnya mendarat di scope GLOBAL. Dua komponen di sini sama-sama mendeklarasikan `ariaLabel`, dan tanpa ini keduanya bertabrakan dengan galat yang bukan milik berkas mana pun.
4. **`noUnusedLocals` / `noUnusedParameters` dimatikan, hanya untuk proyek ini** — hampir setiap binding frontmatter dikonsumsi TEMPLATE, yang tidak diekstrak. Membiarkannya menyala menghasilkan 658 diagnostik "dideklarasikan tapi tak pernah dibaca" yang palsu dan mengubur sinyalnya. Const frontmatter yang tak terpakai juga kelas cacat termurah yang ada; use-before-declaration tidak.

Bersama-sama keempatnya menurunkan keluaran mentah dari **920 diagnostik menjadi 6** — dan keenamnya adalah cacat yang nyata.

### Shim-nya DIKECUALIKAN dari `tsconfig.json` root

`declare module "*.astro"` tidak boleh mencapai typecheck utama, atau ia mulai menjawab untuk impor sungguhan di sana dan menyembunyikan galat asli. Berkas shim juga tidak membawa `import`/`export` tingkat atas, karena `.d.ts` dengan salah satunya menjadi MODUL — dan `declare module "*.astro"` di dalam modul dibaca sebagai _augmentation_ alih-alih wildcard, sehingga setiap impor `.astro` tetap gagal resolusi. Kesalahan itu benar-benar terjadi saat membangun ini dan berharga 53 galat palsu; sebuah tes kini menjaganya.

## Konsekuensi

- Variabel tak terdefinisi, tipe salah lintas setiap impor `src/`, penanganan null, kekeliruan `await`/async, dan urutan pernyataan kini diperiksa di seluruh 61 berkas.
- Selisih `astro-files-not-type-checked` **DIPERSEMPIT, bukan dihapus**. Yang kini dicakupnya persis satu hal: props komponen di call site-nya. Instruksi membaca-dengan-mata di `awcms-testing` dan `awcms-pr-review` tetap ada untuk kelas itu.
- Gerbangnya MENOLAK mulai bila ada berkas ter-generate tersisa dari jalannya yang terputus. Berkas itu gitignored, jadi yatim piatu tak terlihat git dan kalau tidak akan ditype-check menggantikan halaman yang tak lagi cocok dengannya.
- Nomor baris yang dilaporkan relatif terhadap blok; pesan kegagalannya menyuruh menambah 1 untuk `---` pembuka halaman.

## Alternatif yang dipertimbangkan

**Turunkan TypeScript ke 6.x supaya `astro check` jalan.** Ditolak: ia membeli pemeriksaan props di 61 berkas dengan harga meregresi kompiler di bawah ~156.000 baris dan 33 gerbang. Rasionya terbalik, dan ADR-0068 sudah menalar ini.

**Tunggu `astro check` mendukung TypeScript 7.** Itu status quo yang dicatat selisihnya, dan itulah yang membiarkan sebuah layar 500 berminggu-minggu. Menunggu tetap benar untuk separuh pemeriksaan props — itulah sebabnya entrinya bertahan — tetapi TIDAK benar untuk keseluruhannya.

**Periksa seluruh berkas `.astro` dengan parser sendiri.** Ditolak: parser yang berbeda pendapat dengan parser Astro adalah sumber galat yang tidak ada di halaman, dan sumber kebisuan di tempat yang ada. Mengekstrak sebuah region apa adanya lalu menyerahkannya ke kompiler SUNGGUHAN tidak punya kedua mode kegagalan itu.
