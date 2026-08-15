🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0076-infrastructure-tables-may-hold-lifecycle-descriptors.md)

<!-- i18n-source-hash: sha256:bab86fe87b79246242f45b838b981808232820614a59c1c2cb269cb9921a7e5f -->

# ADR-0076 — Tabel milik infrastruktur boleh memegang deskriptor retensi, dan klasifikator kepemilikan-tulis yang memutuskan siapa boleh

- **Status:** Accepted
- **Tanggal:** 2026-08-10
- **Pengambil keputusan:** @ahliweb
- **Terkait:** Issue #479 (pemblokir #468), [ADR-0037](0037-data-lifecycle-module-admission.md) (registry retensi), [ADR-0042](0042-varnish-edge-cache-auto-activation.md) (antrean invalidasi yang menjadi kasus pertamanya), [ADR-0072](0072-decision-log-retention-and-projection-authority.md) (kerangka retensi yang dipakai ulang di sini), [ADR-0013](0013-extension-layers-and-boundary-model.md) §6 (no shared-table write)

## Konteks

`HighVolumeTableDescriptor` dideklarasikan oleh **modul pemilik tabel**, dan `lifecycle-registry.ts` menegakkan bahwa `ownerModuleKey` sama dengan key modul yang mendeklarasikannya. Aturan itu benar dan tidak dilonggarkan ADR ini: tanpanya sebuah modul bisa menuliskan kebijakan retensi untuk tabel milik modul lain, dan pemilik sebenarnya tidak akan pernah tahu.

Yang tidak diantisipasi aturan itu adalah tabel yang **tidak punya modul pemilik sama sekali**.

`awcms_edge_cache_purges` adalah contohnya, dan bukan kecelakaan: ia hidup di `src/lib/edge-cache/`, yang **sengaja** bukan modul — sama seperti subsistem database, rate limit, dan SSRF guard. Ia ditulis oleh tiga modul (`blog_content`, `theming`, `seo_distribution`) lewat satu fungsi infrastruktur, dan `scripts/table-write-ownership-check.ts` sudah mengklasifikasikannya sebagai `"(src/lib infrastructure)"` sejak lama. Kepemilikan-nol di sana adalah keputusan yang tercatat, bukan celah.

Akibatnya tabel itu duduk di `TABLES_PREDATING_THE_RULE` bukan karena belum sempat, melainkan karena kontraknya tidak bisa menyatakannya. Dan **perbedaan itu tidak terlihat dari ledger**: sebuah tabel yang tak mungkin dideskripsikan terlihat persis seperti tabel yang belum dideskripsikan. Itu masalah sebenarnya — bukan satu tabel yang lolos, melainkan sebuah ledger yang berhenti bisa dibaca sebagai hitungan utang.

### Satu koreksi terhadap premis Issue #479

Issue-nya menulis bahwa "tak ada satu pun yang menghapusnya hari ini". Itu **tidak benar**, dan kesalahannya mengubah bentuk keputusan ini. `bun run edge-cache:purge` sudah memanggil `pruneCompletedEdgeCachePurges`, yang menghapus baris `done` yang lebih tua dari tujuh hari — mekanisme retensi tangan yang sudah bekerja sejak ADR-0042.

Artinya yang dibutuhkan tabel ini **bukan** purge baru. Yang dibutuhkannya adalah cara untuk **menyatakan purge yang sudah ada** dalam kontrak yang bisa dibaca gerbang — persis definisi `executionMode: "delegated"`, yang sudah ada di kontrak dan berbunyi: _"the owning module already has its own hand-rolled purge/retention function"_. Satu-satunya kata yang menghalanginya adalah **module**.

Yang memang tidak dibatasi apa pun: baris `failed`. Docblock-nya menulis bahwa mereka disimpan selamanya dengan sengaja, dan alasannya benar — baris itu satu-satunya jejak bahwa sebuah invalidasi tidak pernah mendarat. "Selamanya" tetap tak berbatas, dan sebuah deskriptor yang menyebut jendela retensi sambil membiarkan satu kelas status kekal akan menjadi klaim palsu jenis yang persis dilarang ledger ini.

## Keputusan

**Tabel yang dimiliki infrastruktur boleh memegang deskriptor retensi, lewat registry keduanya sendiri — dan yang menentukan sebuah tabel boleh ada di sana adalah klasifikator kepemilikan-tulis yang sudah dipakai `modules:table-writes:check`, bukan penilaian penulis deskriptor.**

Tiga bagian, dan bagian ketiga yang menanggung beban.

### 1. Registry kedua, bukan `ownerModuleKey` yang dilonggarkan

`INFRASTRUCTURE_LIFECYCLE_DESCRIPTORS` tinggal di `data-lifecycle/domain/infrastructure-lifecycle-registry.ts`. Bentuknya `HighVolumeTableDescriptor` **tanpa** `ownerModuleKey`, **plus** `ownerPath` (direktori `src/lib/` yang memiliki skemanya).

Alternatif yang ditolak: membuat `ownerModuleKey` opsional. Ia menghemat satu berkas dan membayarnya dengan setiap deskriptor modul kehilangan penjagaan wajib-nya — sebuah deskriptor yang lupa menyebut pemilik akan berhenti menjadi kesalahan dan mulai berarti "infrastruktur". Kesalahan ketik menjadi klaim kepemilikan, diam-diam. Dua registry membuat pilihan itu eksplisit di tempat ia diambil.

### 2. `delegated` saja — infrastruktur tidak bisa memakai engine generik

Engine generik `data_lifecycle` menghapus **atas nama modul pemilik**. Tanpa modul, tidak ada atas-nama siapa. Deskriptor infrastruktur karena itu wajib `executionMode: "delegated"` dan wajib membawa `existingAdopter` yang menyebut fungsi dan perintah job-nya. Ini bukan pembatasan sementara: sebuah tabel infrastruktur yang belum punya purge tidak boleh menyelesaikan kewajibannya dengan menunjuk engine — ia harus menulis purge-nya, seperti setiap modul.

### 3. Klasifikator yang memutuskan, bukan penulisnya

Bahaya sebenarnya dari registry kedua adalah ia menjadi tempat parkir: sebuah tabel milik modul dipindahkan ke sana karena menulis deskriptornya di modul itu merepotkan. Yang mencegahnya bukan aturan tertulis, melainkan `ownerOfFile()` — fungsi yang sudah dipakai `modules:table-writes:check` untuk menjawab "siapa menulis tabel ini".

`data-lifecycle:registry:check` kini memindai `src/` dengan scanner yang sama dan menolak:

- deskriptor infrastruktur untuk tabel yang penulisnya sebuah **modul** → tabelnya milik modul itu, deklarasikan di sana;
- deskriptor infrastruktur untuk tabel yang **tidak ditulis siapa pun** di `src/` → tidak ada bukti ia infrastruktur, dan tabel tanpa penulis punya pertanyaan yang lebih mendesak;
- tabel yang muncul di **kedua** registry.

Konsekuensinya: kepemilikan yang salah tidak bisa dinyatakan, di kedua arah, dan tidak ada satu pun kalimat sopan yang bisa menghindarinya. Ini menutup kekhawatiran eksplisit Issue #479 — _"deskriptor yang menyebut pemilik yang salah adalah klaim palsu yang terbaca sebagai keputusan"_ — dengan sebuah gerbang alih-alih sebuah paragraf.

Gerbangnya karena itu berhenti murni: ia membaca `src/`. Itu harga yang dibayar sadar, dan ia dibayar sekali — `data-lifecycle:table-coverage:check` di sebelahnya sudah membaca `sql/`.

### Baris `failed` mendapat batas, dan legal hold masuk

Dua perubahan perilaku mendarat bersama deskriptornya, karena tanpa keduanya deskriptor itu tidak benar:

- **`failed` dihapus setelah 180 hari.** Umur berguna sebuah catatan invalidasi-gagal dibatasi TTL objek yang gagal diinvalidasi; setelah enam bulan konten itu sudah kedaluwarsa ribuan kali dan barisnya menjadi arkeologi. Visibilitas operator yang menjadi alasan aslinya tetap utuh — enam bulan jauh melampaui setiap jendela di mana seseorang akan bertindak.
- **Purge-nya kini menghormati legal hold**, lewat `LegalHoldGuardPort` yang sama persis dengan ketujuh purge terdelegasi lain. Tanpa ini `legalHold.applicable: true` akan menjadi deklarasi tanpa penegak — dan `applicable: false` akan menjadi cara sebuah tabel mengecualikan diri dari legal hold dengan menyatakannya, yang dilarang ADR-0037.

## Konsekuensi

`TABLES_PREDATING_THE_RULE` menyusut satu, dan kali ini karena utangnya dibayar, bukan karena entrinya dipindahkan. Tabel infrastruktur berikutnya yang lahir punya jalur untuk menjawab pertanyaan retensi tanpa berpura-pura menjadi modul, dan tidak punya jalur untuk mengaku infrastruktur kalau ia bukan.

Yang **tidak** diputuskan di sini: apakah `src/lib/edge-cache/` sebaiknya menjadi modul. Issue #479 menawarkannya sebagai opsi kedua, dan ia tetap terbuka — ADR ini hanya menghilangkan alasan paling lemah untuk melakukannya, yaitu "supaya gerbangnya hijau". Kalau edge cache kelak menjadi modul karena alasan arsitektural yang sebenarnya, deskriptornya pindah ke `module.ts`-nya dan registry infrastruktur menyusut; gerbangnya akan menuntut perpindahan itu sendiri, karena penulisnya berubah dari `src/lib` menjadi modul.
