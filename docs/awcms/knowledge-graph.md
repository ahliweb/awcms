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
| `.graphify_labels.json`                                                   | nama komunitas + signature-nya                     | ✅                                                      |
| `graph.html`                                                              | visualisasi                                        | ❌ (lihat `.gitignore` — alasannya panjang dan sengaja) |
| `cache/`, `.graphify_root`, `.graphify_python`, `.graphify_analysis.json` | cache/marker/intermediate                          | ❌                                                      |

Perbarui dengan `/graphify . --update` (inkremental; hanya berkas berubah yang
diekstrak ulang). Angka per 2026-07-27: **8159 node, 21470 edge, 485 komunitas**.

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
terbesar (`Tenant Transaction & Authorization Core`, 264 node, cohesion
**0.031**) tampak seperti kandidat utama. Ia bukan.

Isinya **242 route handler dari 83 berkas berbeda**, plus `withTenant` dan
`authorizeInTransaction`. Itu bukan subsistem yang membengkak — itu bentuk
fan-out dari sebuah **chokepoint yang memang disengaja** (ADR-0003/ADR-0004:
setiap rute terproteksi WAJIB lewat keduanya). Topologi bintang memang
menghasilkan cohesion mendekati nol; algoritma clustering tidak bisa membedakan
"hub" dari "klaster longgar". Memecahnya berarti merusak properti keamanan yang
paling ingin dipertahankan repo ini.

**Aturan:** sebelum menindaklanjuti cohesion rendah, lihat **komposisi**
komunitasnya. Bila mayoritas anggotanya berasal dari puluhan berkas berbeda yang
hanya berbagi satu hub, itu artefak — bukan utang desain.

## Gap yang memang noise

§Knowledge Gaps melaporkan ~3400 node "terisolasi" (≤1 koneksi). Sebagian besar
adalah kunci `package.json`, `$schema`, entri katalog, dan simbol daun — **bukan**
komponen tak terdokumentasi. Jangan perlakukan angka itu sebagai backlog.
