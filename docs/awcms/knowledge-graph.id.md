🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](knowledge-graph.md)

<!-- i18n-source-hash: sha256:f48d12ed4ab8e9faa6d9e2ad89d7c809f6a48b302cf878d24b52b7b8d1e9f851 -->

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
