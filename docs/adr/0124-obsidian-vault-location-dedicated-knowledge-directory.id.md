🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0124-obsidian-vault-location-dedicated-knowledge-directory.md)

<!-- i18n-source-hash: sha256:6c8f5fdac0d412bcbdf7fc4daec5c0265349a2a19715ce88e5e6adcf1517b78c -->

# ADR-0124 — Obsidian membuka vault `knowledge/` khusus, bukan root repository

- **Status:** Accepted
- **Tanggal:** 2026-09-24
- **Pengambil keputusan:** ahliweb
- **Terkait:** Issue #805; [`docs/awcms/knowledge-graph.md`](../awcms/knowledge-graph.id.md); `.graphifyignore`; `scripts/graph-artifacts-check.ts`; `scripts/knowledge-obsidian-sync.ts`; `tests/knowledge-obsidian-sync.test.ts`; `tests/graph-artifacts-check.test.ts`

## Konteks

Issue #805 meminta AWCMS menambahkan alur navigasi pengetahuan Obsidian yang
aman dan opsional di atas knowledge graph `graphify-out/` yang sudah
digerbangi, tanpa menjadikan Obsidian sistem catatan kedua. Graphify dapat
mengekspor sebuah vault Obsidian (satu catatan Markdown per node graf,
ditambah folder konfigurasi `.obsidian/`); pertanyaan yang diselesaikan ADR
ini adalah **di mana vault itu, dan catatan hasil kurasi manusia, hidup
relatif terhadap repository**, dinilai terhadap: kelebihan/kekurangan,
keamanan, performa, maintainability, skalabilitas, kompleksitas operasional,
kompatibilitas/perilaku lintas-platform, UI/UX developer, duplikasi, dan
seberapa banyak state pribadi yang bisa bocor ke Git.

Dua opsi disebutkan di issue, ditambah opsi ketiga yang dipertimbangkan di
sini.

### Opsi A — buka root repository sebagai vault Obsidian, dengan exclusion ketat

Obsidian memperlakukan `awcms-wt-805/` (root repo) itu sendiri sebagai vault,
mengandalkan `.obsidian/` + exclusion file-type/folder milik Obsidian sendiri
untuk menyembunyikan semua yang bukan konten pengetahuan.

- **Kelebihan:** nol duplikasi path — setiap ADR, dokumen, dan berkas SQL
  sudah "ada" di vault pada path aslinya; tidak perlu langkah export/sync
  bagi developer yang sekadar membaca; referensi silang antar catatan vault
  dan berkas kanonik memakai path relatif yang sama dengan yang sudah dipakai
  Git.
- **Kekurangan/keamanan:** root repo menyimpan `.env.example`, migrasi
  `sql/`, dan pada akhirnya berkas lokal developer (state IDE, `.env`,
  catatan coretan) yang bisa saja diindeks atau diunggah oleh plugin
  Obsidian yang ceroboh (thumbnail graph view, indeks full-text search,
  community plugin yang menghubungi luar) tanpa seorang pun meninjau daftar
  exclusion baris demi baris. Daftar exclusion harus **dipelihara aktif
  selamanya** — setiap direktori top-level baru yang ditambahkan monorepo
  besar dan cepat-bergerak ini (sudah 25+ modul, `sql/`, `openapi/`,
  `asyncapi/`, `.claude/`, `graphify-out/`) otomatis masuk vault sampai ada
  yang ingat mengecualikannya. Itu kebalikan dari postur default-deny repo
  ini (ADR-0004) diterapkan pada permukaan filesystem, bukan API.
- **Performa:** indexer Obsidian sendiri (search, graph view, backlink) harus
  menjelajahi seluruh pohon repository — ratusan ribu berkas termasuk output
  build sekitar `node_modules/`, `dist/`, `.astro/`, `graphify-out/graph.json`
  yang ~19 MB — setiap kali vault dibuka, padahal hampir tidak ada yang bisa
  dirender berguna sebagai catatan oleh Obsidian.
  Ia juga bertabrakan langsung dengan `graphify-out/` (direktori bernama sama
  yang harus diberi tahu ke Obsidian agar diabaikan) dan, lebih buruk, dengan
  tooling berbentuk `.obsidian/` apa pun yang mungkin ditambahkan agen lain
  di ekosistem repo ini di masa depan.
- **Lintas-platform:** kontributor yang tidak pernah menginstal Obsidian tetap
  melihat aturan exclusion sebesar vault hidup di root repo, mengikat
  konfigurasi tool developer opsional ke path yang juga dijelajahi editor,
  linter, dan job CI setiap kontributor.
- **State pribadi di Git:** karena root vault **adalah** root repo, berkas
  workspace Obsidian pribadi mana pun yang lolos dari `.gitignore` (plugin
  menulis di luar `.obsidian/`, catatan yang taruh di top level karena
  kebiasaan) mendarat di pohon yang sama dengan kode sumber, tinggal satu
  `git add -A` untuk ter-commit.

### Opsi B — vault `knowledge/` khusus (dipilih)

Obsidian hanya membuka `knowledge/` sebagai vault-nya. Catatan hasil-generate
Graphify disinkronkan ke `knowledge/generated/graphify/` melalui wrapper yang
eksplisit, berbasis allowlist, dan fail-closed
(`scripts/knowledge-obsidian-sync.ts`); catatan indeks hasil kurasi manusia
yang kecil hidup di `knowledge/curated/`; tidak ada bagian lain repository
yang berada di dalam batas vault.

- **Kelebihan:** batas vault **adalah** batas direktori — tidak ada daftar
  exclusion yang harus dipelihara, karena semua di luar `knowledge/` secara
  struktural berada di luar vault apa pun yang ditambahkan ke repo
  berikutnya. Penyempitan gaya `.gitignore`/`.graphifyignore` bersifat lokal
  pada satu pohon kecil, bukan seluruh monorepo. Duplikasi minimal:
  `knowledge/` hanya memuat overlay yang menunjuk balik ke berkas kanonik
  (`docs/adr/`, `docs/awcms/`, `sql/`), tidak pernah salinan isinya.
- **Keamanan:** radius ledakan "plugin Obsidian mengindeks sesuatu yang tidak
  seharusnya" dibatasi pada `knowledge/` — direktori yang, secara konstruksi
  (aturan ADR ini sendiri), tidak pernah menerima `.env`, kredensial, atau
  konten SQL/sumber. Ini permukaan yang lebih kecil dan bisa ditinjau,
  konsisten dengan default-deny.
- **Performa:** Obsidian mengindeks beberapa lusin berkas Markdown/Canvas
  kecil, bukan graf ~19 MB dan seluruh pohon sumber; pembukaan vault,
  pencarian, dan komputasi backlink tetap cepat terlepas dari ukuran
  repository.
- **Maintainability/skalabilitas:** vault tidak membesar saat repo membesar
  (modul baru, migrasi SQL baru, ADR baru tidak masuk `knowledge/`); ia
  hanya membesar saat `knowledge:obsidian:export` dijalankan, dan pembesaran
  itu dibatasi oleh konten ber-allowlist di `graphify-out/obsidian-staging/`.
- **Kompleksitas operasional:** satu langkah tambahan
  (`knowledge:obsidian:export`) dibanding nol langkah Opsi A, tetapi langkah
  itu di-script, diuji, dan fail-closed — kompleksitas dibayar sekali di
  kode, bukan berulang kali sebagai pemeliharaan daftar exclusion manual.
- **Kompatibilitas/lintas-platform:** direktori vault adalah folder biasa
  yang dibuka Obsidian identik di macOS/Linux/Windows; tidak ada tooling
  repo ini sendiri yang perlu tahu Obsidian ada, karena `knowledge/` tidak
  membawa makna build-time di luar dirinya sendiri.
- **UI/UX bagi developer:** developer yang ingin graf sebagai catatan membuka
  `knowledge/`; developer yang tidak memakai Obsidian tidak pernah melihat
  konfigurasi `.obsidian/` atau noise vault di dekat kode yang sedang
  diedit.
- **State pribadi di Git:** terbatas pada `knowledge/.obsidian/` (di-gitignore
  kecuali allowlist terdokumentasi dan ditinjau — lihat keputusan higiene Git
  pendamping di bawah), tidak pernah bercampur dengan sumber.

### Opsi C (dipertimbangkan, ditolak) — tanpa vault ter-commit; tiap developer mengarahkan Obsidian ke salinan lokal tak-ter-commit

Ekspor Obsidian Graphify menulis ke path sembarang di luar repo (mis.
`~/vaults/awcms`) yang dikelola tiap developer secara independen; tidak ada
yang terkait Obsidian ter-commit sama sekali.

- Ditolak karena kembali memunculkan persis duplikasi dan drift yang ingin
  dihilangkan issue ini: setiap developer meng-ekspor ulang secara
  independen, catatan indeks kurasi (`project-map.md`, `decisions-index.md`,
  …) yang seharusnya menjadi konteks navigasi **bersama** tidak punya rumah
  kanonik, dan tidak ada cara meninjau atau menggerbangi isi vault yang
  dihasilkan (kriteria penerimaan mensyaratkan tes atas allowlist ekspor,
  penanganan collision, dan proteksi traversal — semuanya mustahil dijalankan
  terhadap path di luar repository). Ini meniadakan biaya koordinasi kecil
  dan nyata yang dibayar Opsi B sekali di `knowledge/curated/`.

## Dua keputusan scope tambahan yang digabung ke ADR ini

Issue #805 meminta dua keputusan tata kelola lagi di samping lokasi vault,
keduanya cukup sempit untuk dicatat di sini alih-alih sebagai ADR terpisah.

### Baseline versi/toolchain Graphify

Baseline yang teruji adalah **`graphify 0.9.35`** (paket PyPI `graphifyy`,
diinstal via `uv tool install graphifyy`), Python 3.12. CI dan automation
tidak boleh bergantung pada `latest` yang mengambang —
`scripts/knowledge-obsidian-sync.ts` mencatat string persis ini
(`GRAPHIFY_VERSION_BASELINE`) ke setiap `PROVENANCE.md` yang ditulisnya,
alih-alih membaca apa pun yang dilaporkan `graphify --version` di mesin yang
menjalankan ekspor — sehingga provenance menyatakan apa yang DIJAMIN
repository ini, bukan apa yang kebetulan terinstal lokal. Perintah yang
disetujui repo ini untuk pemakaian interaktif terdaftar di
`docs/awcms/knowledge-graph.md` §Baseline; `graphify install --project`
dievaluasi dan **ditolak** — lihat bagian itu untuk alasannya.

### `cost.json` tetap di-track

`graphify-out/cost.json` (sudah menjadi artefak ter-track, tak diubah ADR
ini) hanya menyimpan counter agregat per-run: tanggal ISO, `input_tokens`,
`output_tokens`, jumlah berkas, dan string `mode` opsional. Ia tidak membawa
nama provider, API key, rincian per-berkas, teks query, atau path di luar
`graphify-out/` itu sendiri. Ditinjau terhadap kekhawatiran issue bahwa ia
"mungkin memuat informasi lokal/biaya/provider": tidak, dan tidak perlu —
angka token agregat itu persis informasi yang dibutuhkan reviewer untuk
menilai biaya sebuah rebuild, dan menghapusnya dari Git hanya akan membuat
angka itu tak tersedia bagi siapa pun selain operator yang menjalankan
rebuild-nya. Ia tetap di-track, tidak berubah.

## Keputusan

1. **Root vault Obsidian adalah `knowledge/`, tidak pernah root repository.**
   Tidak ada yang di luar `knowledge/` diekspos ke Obsidian oleh alur kerja
   repo ini.
2. **`knowledge/curated/`** hanya memuat catatan indeks/overlay kecil hasil
   kurasi manusia (`project-map.md`, `architecture-index.md`,
   `security-index.md`, `decisions-index.md`, `lessons-learned.md`). Mereka
   menunjuk balik ke berkas kanonik; tidak pernah menyalin atau memigrasikan
   konten ADR/PRD/kontrak/dokumen teknis.
3. **`knowledge/generated/graphify/`** hanya memuat berkas yang ditulis oleh
   `scripts/knowledge-obsidian-sync.ts` dari
   `graphify-out/obsidian-staging/`. Isinya disposable dan bisa dibangun
   ulang dari artefak graphify; mereka dikecualikan dari Git (lihat catatan
   higiene Git Obsidian di `docs/awcms/knowledge-graph.md`) justru karena
   ekspor satu-berkas-per-node pada ukuran graf repo ini (12000+ node) akan
   melipatgandakan jumlah berkas ter-track repository berkali-kali lipat
   untuk konten yang sudah ada, dapat dibaca mesin, di `graphify-out/graph.json`
   yang ter-track.
4. Graphify TIDAK BOLEH menulis langsung ke `knowledge/` secara default.
   Target ekspor Obsidian-nya adalah `graphify-out/obsidian-staging/`
   (direktori build-intermediate terisolasi, di-gitignore, digerbangi dengan
   cara yang sama seperti ekspor regenerable lain di `graphify-out/`). Hanya
   wrapper sync yang boleh memindahkan konten dari staging ke
   `knowledge/generated/graphify/`, dan hanya setelah memvalidasi kondisi
   fail-closed di `scripts/knowledge-obsidian-sync.ts` (path traversal, tipe
   berkas tak terduga, collision nama berkas dengan `knowledge/curated/`, dan
   output exporter yang keluar dari staging root).
5. `knowledge/curated/` tidak pernah menjadi target tulis bagi tool otomatis
   apa pun.

## Konsekuensi

- **Positif:** batas vault ditegakkan secara struktural (sebuah direktori),
  bukan oleh daftar exclusion yang harus dipelihara selamanya; performa
  indexing Obsidian independen dari ukuran repository; radius ledakan plugin
  Obsidian yang berulah adalah satu direktori kecil yang tidak sensitif;
  catatan navigasi kurasi punya satu rumah kanonik yang bisa ditinjau.
- **Negatif / trade-off:** developer yang ingin konten graf sebagai catatan
  Obsidian harus menjalankan satu langkah sync eksplisit, bukan vault yang
  "langsung berfungsi" di root repo; `knowledge/generated/graphify/`
  memerlukan kontrak disposability sendiri (bisa dibangun ulang, tidak
  disunting tangan) agar tidak diam-diam menjadi sumber kebenaran kedua.
- **Netral:** keputusan ini tidak mengubah cara `graphify-out/` sendiri
  digerbangi (itu tetap seperti terdokumentasi di
  `docs/awcms/knowledge-graph.md` dan digerbangi `graph:artifacts:check`); ia
  hanya memutuskan ke mana Obsidian, UI opsional di atas graf itu, boleh
  diarahkan.

## Alternatif yang dipertimbangkan

- **Opsi A — root repository sebagai vault** — ditolak: pemeliharaan daftar
  exclusion tak terbatas seiring monorepo membesar, biaya performa indexing
  seluruh repo, dan permukaan yang jauh lebih besar bagi state
  pribadi/lokal untuk bocor di dekat kode sumber. Lihat analisis di atas.
- **Opsi C — path vault tak-ter-commit per-developer** — ditolak: menghapus
  rumah bersama untuk catatan navigasi kurasi dan membuat tes allowlist
  ekspor / collision / traversal yang disyaratkan issue mustahil dijalankan
  terhadap path di luar repository. Lihat analisis di atas.
