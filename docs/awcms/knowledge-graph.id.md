🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](knowledge-graph.md)

<!-- i18n-source-hash: sha256:5f8a2ea0ebf9921a4887788d2d9894d6403e3a98cfd57569655a591b4c0eb0a9 -->

# Knowledge graph (`graphify-out/`)

`graphify-out/` adalah artefak **ter-commit** hasil skill `graphify`: satu graf
pengetahuan atas seluruh repo (kode via AST, dokumen/kontrak via ekstraksi
semantik). Dokumen ini menjelaskan cara membacanya — dan lebih penting, **apa
yang TIDAK boleh disimpulkan darinya**, karena dua kesalahan baca di bawah
menghasilkan temuan yang terdengar meyakinkan dan salah.

| Berkas                                                                    | Isi                                                | Ter-track?                                              |
| ------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------- |
| `graph.json`                                                              | graf mentah (~12 MB) — sumber yang di-query        | ✅                                                      |
| `GRAPH_REPORT.md`                                                         | laporan audit: god node, komunitas, hyperedge, gap | ✅                                                      |
| `manifest.json`, `cost.json`                                              | state inkremental + akumulasi token                | ✅                                                      |
| `.graphify_labels.json`                                                   | nama komunitas + signature-nya                     | ❌ (aturan borongan `graphify-out/.*`)                  |
| `graph.html`                                                              | visualisasi                                        | ❌ (lihat `.gitignore` — alasannya panjang dan sengaja) |
| `cache/`, `.graphify_root`, `.graphify_python`, `.graphify_analysis.json` | cache/marker/intermediate                          | ❌                                                      |

Perbarui dengan `/graphify . --update` (inkremental; hanya berkas berubah yang
diekstrak ulang). Angka untuk artefak yang saat ini ter-commit:
**12700 node, 32735 edge, 749 komunitas**.

`bun run graph:artifacts:check` mengikat dokumen ini pada angka tersebut, dan
pada kolom ter-track/tidak di atas — keduanya ditulis benar lalu menjadi salah
sebelum gerbang itu ada (tabelnya mengaku `.graphify_labels.json` ter-track;
angkanya tertinggal satu rebuild). Sesudah tiap rebuild, perbarui baris di atas.

Apa yang diindeks dipersempit `.graphifyignore`, yang memuat pengukuran di balik
tiap entri — terutama bahwa cermin terjemahan `*.id.md` (ADR-0097) dikecualikan
karena sebuah cermin menceritakan ulang sumbernya kata demi kata.

## Yang bagus dijawab graf ini

Menemukan **pola lintas-modul yang tidak punya import sama sekali** — di situlah
nilainya, karena itu justru yang tak bisa ditemukan `grep` maupun
`modules:dag:check`. Contoh nyata dari run terakhir: graf mengelompokkan sendiri
disiplin _"permukaan anonim menjawab seragam, tak ada oracle"_ di `comments`,
self-registration, dan password-reset — tiga modul tanpa satu pun edge struktural
di antara mereka. Begitu juga seam `listModules()` (`searchSources`,
`commentableResources`, `dataLifecycle`, `api.routes`) yang semuanya gerakan
arsitektural yang sama.

## Dua cara salah baca (keduanya sudah terjadi)

### 1. Graf mencampur "pernah benar" dengan "sekarang benar"

Node dan edge diekstrak dari **teks**, termasuk `CHANGELOG.md` dan changeset.
Entri changelog yang mendeskripsikan bug yang **sudah diperbaiki** tetap menjadi
node, dan bisa muncul di §Surprising Connections seolah temuan hidup. Pada audit
2026-07-27, tiga dari lima "surprising connection" teratas seperti itu — mis.
"ghost env var `AUTH_JWT_SECRET`/`APP_TIMEZONE` terdokumentasi tapi tak dibaca",
yang sudah beres (nol kemunculan di `.env.example`).

**Aturan:** jangan pernah pakai graf untuk menjawab _"apakah X masih benar"_.
Setiap temuan wajib diverifikasi ke kode/`sql/`/`bun run check` dulu. Sumber
kebenaran state tetap kode — graf adalah peta, bukan wilayahnya.

### 2. Cohesion rendah ≠ modul yang perlu dipecah

`GRAPH_REPORT.md` menyarankan memecah komunitas ber-cohesion rendah. Komunitas
terbesar (`Tenant Authorization Chokepoint`, 422 node di `graph.json`, cohesion
**0.02**) tampak seperti kandidat utama. Ia bukan.

Isinya **371 node dari `src/pages/api/` di 110 berkas rute** (138 berkas sumber
berbeda seluruhnya), plus `withTenant`, `authorizeInTransaction`, `fail`, dan
`ok`. Itu bukan subsistem yang membengkak — itu bentuk fan-out dari sebuah
**chokepoint yang memang disengaja** (ADR-0003/ADR-0004: setiap rute terproteksi
WAJIB lewat keduanya). Topologi bintang memang menghasilkan cohesion mendekati
nol; algoritma clustering tidak bisa membedakan "hub" dari "klaster longgar".
Memecahnya berarti merusak properti keamanan yang paling ingin dipertahankan repo
ini.

> **Baca ukuran per-komunitas dari `graph.json`, bukan dari laporan.** Baris
> `Nodes (N)` di laporan berbeda dengan `graph.json` pada 340 dari 510 komunitas
> yang dirender, selalu ke bawah (komunitas 0: 322 di laporan, 422 di graf).
> Angka Summary-nya MEMANG sepakat, dan `graph:artifacts:check` mengikat keduanya
> — tetapi angka per-komunitas adalah render dari pandangan tersaring laporan itu
> sendiri, sedangkan `graph.json` yang benar-benar dibaca `graphify query` dan
> setiap konsumen GraphRAG.

**Aturan:** sebelum menindaklanjuti cohesion rendah, lihat **komposisi**
komunitasnya. Bila mayoritas anggotanya berasal dari puluhan berkas berbeda yang
hanya berbagi satu hub, itu artefak — bukan utang desain.

## Gap yang memang noise

§Knowledge Gaps melaporkan 4189 node "terisolasi" (≤1 koneksi). Sebagian besar
adalah kunci `package.json`, `$schema`, entri katalog, dan simbol daun — **bukan**
komponen tak terdokumentasi. Jangan perlakukan angka itu sebagai backlog.

## Baseline (Issue #805, ADR-0124)

Baseline Graphify yang teruji dan dipatok repo ini adalah **`graphify
0.9.35`** (paket PyPI `graphifyy`, diinstal dengan `uv tool install
graphifyy`), Python 3.12. Automation dan CI tidak boleh pernah bergantung
pada `latest` yang mengambang — di tempat versi tool berarti (provenance pada
catatan Obsidian hasil generate), itu konstanta literal
(`GRAPHIFY_VERSION_BASELINE` di `scripts/knowledge-obsidian-sync.ts`), bukan
dibaca dari apa pun yang kebetulan terinstal di mesin yang menjalankan
perintahnya.

Extra yang dibutuhkan corpus repo ini (lihat riwayat pelajaran
`awcms-graphify-svg-export-needs-matplotlib.md`): berkas `.sql` menghasilkan
nol node tanpa extra `sql`, dan ekspor SVG butuh `matplotlib` DAN `scipy`:

```bash
uv tool install "graphifyy[sql,svg]" --with scipy
```

**Perintah yang disetujui untuk pemakaian interaktif di repo ini:**

| Perintah                                                       | Tujuan                                                                                                                      |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `graphify . --update`                                          | rebuild inkremental (via skill `/graphify`, semantic extraction bisa dispatch subagent)                                     |
| `graphify update .`                                            | rebuild inkremental hanya-kode, tanpa LLM, headless — `bun run knowledge:graph:update`                                      |
| `graphify query "<pertanyaan>"`                                | traversal BFS untuk sebuah pertanyaan                                                                                       |
| `graphify path "A" "B"`                                        | jalur terpendek antara dua konsep                                                                                           |
| `graphify explain "X"`                                         | penjelasan bahasa natural untuk satu node                                                                                   |
| `graphify --code-only`                                         | indeks kode saja, lewati semantic extraction doc/paper/image                                                                |
| `graphify export obsidian --dir graphify-out/obsidian-staging` | ekspor ke path staging terisolasi — `bun run knowledge:obsidian:pull` — **jangan pernah** tanpa `--dir` menunjuk ke staging |

**`graphify install --project` dievaluasi dan ditolak.** Repo ini sudah
mengirimkan 55+ skill ber-scope proyek di bawah `.claude/skills/` (ADR-0062
menggerbanginya terhadap kode yang dideskripsikannya) dan kebijakan
`AGENTS.md`-nya sendiri; menambah set instruksi agent kedua yang bersaing
lewat `graphify install --project` (yang menulis hook/skill proyek Claude
Code) akan menduplikasi permukaan kebijakan itu tanpa gerbang CI yang
menjaga keduanya tetap sinkron. Graphify tetap berjalan dari skill global
kontributor sendiri (`~/.claude/skills/graphify/SKILL.md`), didokumentasikan
di sini alih-alih diinstal ulang per proyek.

## Alur kerja Obsidian (Issue #805, ADR-0124)

Obsidian adalah **UI pengetahuan developer yang opsional**, tidak pernah
sistem catatan. ADR-0124 memutuskan Obsidian membuka **vault `knowledge/`
khusus**, tidak pernah root repository — baca ADR itu untuk analisis lokasi
lengkapnya (vault root-repo vs. vault khusus vs. path per-developer
tak-ter-commit).

```text
graphify export obsidian --dir graphify-out/obsidian-staging   # graphify -> staging terisolasi (digitignore)
bun run knowledge:obsidian:export                              # staging -> knowledge/generated/graphify/, fail-closed
```

Graphify **tidak pernah** menulis langsung ke `knowledge/`. Target ekspor
Obsidian-nya selalu path staging terisolasi dan digitignore
`graphify-out/obsidian-staging/`. Satu-satunya yang boleh memindahkan konten
keluar dari staging adalah `scripts/knowledge-obsidian-sync.ts` (`bun run
knowledge:obsidian:export`), yang memvalidasi seluruh tree staged sebelum
menulis satu byte pun dan fail-closed — exit bukan-nol, tanpa apa pun
tertulis, `knowledge/curated/` tak pernah tersentuh — pada salah satu dari:

- **path traversal** — nama entri berbentuk `..`, atau path asli (setelah
  symlink diresolve) yang tak berada di bawah staging root;
- **tipe berkas tak terduga** — apa pun berekstensi selain `.md`/`.canvas`
  (inilah yang menjaga folder konfigurasi `.obsidian/` hasil generate atau
  byproduct exporter lain keluar dari area sync, tanpa perlu meng-special-case
  nama direktorinya);
- **collision nama berkas dengan konten kurasi** — berkas staged yang
  basename-nya sudah ada di mana pun di bawah `knowledge/curated/`;
- **entri yang escape** — symlink, device file, atau apa pun yang targetnya
  bukan berkas/direktori biasa di bawah staging root.

Setiap sync yang berhasil menulis ulang `knowledge/generated/graphify/` dari
nol (rebuild bersih, bukan merge inkremental) dan menulis satu
`PROVENANCE.md` yang menyebutkan versi tool yang dipatok, `built_at_commit`
graf sumbernya, dan timestamp ekspor — lihat
`tests/knowledge-obsidian-sync.test.ts` untuk bukti perilaku ini sesuai
klaimnya, termasuk terhadap masing-masing dari empat kondisi fail-closed di
atas menggunakan bentuk cacat sungguhan (symlink sungguhan, byproduct
`.obsidian/` sungguhan, collision basename sungguhan), bukan sekadar tree
yang sehat.

`knowledge/curated/` hanya memuat catatan indeks/overlay kecil hasil kurasi
manusia yang menunjuk balik ke berkas kanonik — tidak pernah salinan konten
ADR/PRD/kontrak/dokumen. Lihat `knowledge/README.md` untuk aturan operasi
vault itu sendiri.

## Higiene Git Obsidian

Tidak ada konfigurasi `knowledge/.obsidian/` yang di-commit sama sekali —
`.gitignore` mengecualikan seluruh direktori, bukan allowlist berlubang.
Setting yang berguna untuk tim bisa diusulkan nanti lewat perubahan
ter-review sendiri (dan harus berupa allowlist terdokumentasi per issue #805
§4, tidak pernah state workspace/sesi, hotkey, atau cache plugin); sampai
saat itu, baseline paling aman dan paling sederhana adalah tidak ada yang
di-commit. `knowledge/generated/` dikecualikan dari Git dengan cara yang sama
(`knowledge/generated/*` dengan `!knowledge/generated/README.md` tetap
ter-track supaya direktorinya tidak diam-diam hilang pada checkout baru).
Tidak ada community plugin pihak ketiga yang dibutuhkan untuk alur kerja
baseline, dan Obsidian tidak pernah menjadi dependensi CI — `bun run
knowledge:check` memvalidasi perilaku fail-closed sync wrapper dengan nol
Obsidian, nol Graphify, dan nol network yang terlibat.

## Keamanan dan privasi (Issue #805 §7)

- **Secret/PII terindeks dari berkas ignored atau lokal:** `.graphifyignore`
  hanya pernah mempersempit apa yang sudah dikecualikan `.gitignore`
  (graphify membaca file ini SETELAH `.gitignore`), sehingga secret yang
  dikecualikan dari Git tak bisa baru masuk ke graf lewat berkas ini.
- **Semantic extraction mengirim dokumen sensitif ke provider eksternal:**
  Graphify tidak butuh API key untuk corpus hanya-kode (AST struktural, tanpa
  LLM). Semantic extraction (doc/paper/image) memakai Gemini hanya jika
  `GEMINI_API_KEY`/`GOOGLE_API_KEY` sudah diset; jika tidak, host agent
  sendiri yang melakukannya. Tidak ada API key provider lain yang pernah
  dibaca.
- **Query log/cache membocorkan konteks repository:** `graphify-out/cache/`,
  setiap intermediate berawalan titik di bawah `graphify-out/`, dan
  `graphify-out/memory/` (feedback loop `save-result`/`reflect`) semuanya
  digitignore — lihat tabel di awal dokumen ini dan `.gitignore`.
- **Ekspor Obsidian hasil generate menimpa catatan/config hasil kurasi
  manusia:** sync wrapper fail-closed di atas adalah kontrolnya;
  `tests/knowledge-obsidian-sync.test.ts` membuktikan `knowledge/curated/`
  selamat byte-demi-byte tanpa perubahan setelah ekspor penuh, termasuk pada
  setiap run yang ditolak.
- **Output graf basi diperlakukan sebagai kebenaran kini:** aturan "peta,
  bukan wilayahnya" di awal dokumen ini, ditambah catatan freshness
  `graph:artifacts:check` dan `PROVENANCE.md` setiap catatan Obsidian hasil
  generate.
- **Teks repository tak terpercaya sebagai konten prompt-injection untuk
  agent yang mengonsumsi graf:** sebuah temuan graf adalah bukti untuk
  diverifikasi, tidak pernah instruksi untuk diikuti — `knowledge/README.md`
  §Aturan untuk agent menyatakan ini secara eksplisit, selaras dengan aturan
  yang sudah ada di dokumen ini.
- **Artefak hasil generate menyebabkan footprint repository berlebihan:**
  aturan `.gitignore` `graphify-out/` sendiri (lihat tabel di atas) sudah
  mengecualikan permukaan render/export (`graph.html`, `graph.svg`,
  `graph.graphml`, …) persis untuk alasan ini; `graphify-out/obsidian/`,
  `graphify-out/obsidian-staging/`, dan `knowledge/generated/` mengikuti
  postur yang sama — tidak ada satu pun yang di-track di Git.

Kontrol-kontrol ini selaras dengan postur keamanan repo ini yang sudah ada
(default-deny, akses teraudit, tanpa secret di histori) dan, bila berlaku,
dengan prinsip ISO/IEC 27001/27002/27005/27034/27701 tentang klasifikasi
informasi, pengembangan aman, dan privacy by design. Dokumen ini tidak
mengklaim sertifikasi atau kepatuhan.
