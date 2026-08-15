🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0065-awcms-astro-consumer-contract-is-frozen.md)

<!-- i18n-source-hash: sha256:622f8b9424a2ffa807c3b75076229acf74f63c235e5c87a0cda3e87f5f18eed8 -->

# ADR-0065 — Kontrak yang dipakai `awcms-astro` dibekukan dan digerbangi di sini

- **Status:** Accepted
- **Tanggal:** 2026-08-04
- **Pengambil keputusan:** @ahliweb
- **Terkait:** [ADR-0045](0045-jualanku-porting-awcms-system-of-record-astro-bff.md) (`awcms` system of record, `awcms-astro` experience layer + BFF), [ADR-0049](0049-machine-credentials-and-session-introspection.md) (kredensial mesin + introspeksi sesi), [`../awcms/repo-assessment-2026-08-04.md`](../awcms/repo-assessment-2026-08-04.md) §4 (temuannya), ADR-0027 di `awcms-astro` (penahanan ADR-0021 selesai)

## Konteks

### 1. Snapshot beku yang ada tidak mencakupnya

`tests/fixtures/openapi-pre-migration-snapshot.openapi.yaml` adalah monolit
**PRA-migrasi #182**. Tugasnya membuktikan fragmentasi tidak pernah memutasi
kontrak yang sudah ada SEBELUM pemecahan — dan ia mengerjakan tugas itu dengan
baik.

Tetapi **setiap permukaan yang `awcms-astro` benar-benar panggil mendarat
SESUDAHNYA**: `/auth/session` dan `/access/machine-credentials` (ADR-0049),
`/media/objects` (#318), `/media/public-origin` (#370), traversal cursor
`/blog/posts` (#317). Diverifikasi: pencarian keempat path itu di berkas
snapshot mengembalikan **nol**.

Akibatnya: **mengubah bentuk respons salah satunya HIJAU di CI repo ini dan
merusak build repo sebelah** — kegagalan yang muncul di tempat orang yang
menyebabkannya tidak melihat.

### 2. Kenapa snapshot KEDUA, bukan memperluas yang pertama

Keduanya menjawab pertanyaan berbeda. Yang pra-migrasi harus tetap beku **pada
momennya sendiri** untuk terus menjawab pertanyaannya ("apakah fragmentasi
mengubah kontrak lama?"). Memperluasnya berarti membandingkan bundel dengan
salinan dirinya sendiri untuk bagian baru — persis kesalahan yang header berkas
itu peringatkan.

### 3. Closure `$ref` adalah intinya

Membekukan enam objek path saja nyaris tak berguna. `GET /api/v1/blog/posts`
hanya beberapa baris yang mem-`$ref` schema `BlogPost`, dan **kerusakan yang
menarik terjadi di SCHEMA** — field diganti nama, tipe dipersempit, nullable
dicabut. Jadi gerbang ini menelusuri setiap `$ref` yang terjangkau dari keenam
path dan membekukan komponennya juga: **6 path, 16 komponen**.

Dibuktikan lewat mutasi: mengganti nama `publicUrl` di dalam
`ResolvedMediaReference` — sebuah komponen, bukan objek path — **memerahkan**
gerbang, sementara menambah field opsional di komponen yang sama **lolos**.

## Keputusan

`bun run api:consumer-contract:check` masuk rantai `bun run check`, dengan
fixture `tests/fixtures/awcms-astro-consumer-contract.openapi.yaml` yang
di-generate `:generate`.

**Aturannya subset aditif, bukan kesetaraan.** Menambah field opsional tidak
merusak konsumen; menghapus atau mengubah tipe merusak. Jadi kontrak beku wajib
tetap TERKANDUNG di bundel saat ini — aturan yang sama dengan test pra-migrasi.

**Daftar `CONSUMER_PATHS` diturunkan dengan mem-grep repo sebelah**, bukan dari
ingatan dan bukan dari asumsi repo ini tentang apa yang "mungkin dibutuhkan"
sebuah build situs statis. Tiap entri membawa alasan pemanggilannya.

**Regenerasi adalah tindakan sengaja.** Ia berarti "kontrak ini berubah dan
konsumennya harus ikut berubah" — dan sisi `awcms-astro` wajib diperbarui dalam
napas yang sama. Header fixture menyatakan itu, dan pesan kegagalan gerbang
mengulanginya, karena orang yang membacanya sedang berada di repo yang salah
untuk menyadarinya sendiri.

**Path konsumen yang HILANG melempar, bukan menyusutkan kontrak diam-diam.**
Membiarkannya lolos akan mengubah "endpoint yang dipakai `awcms-astro` dihapus"
menjadi pemeriksaan yang lulus — persis kegagalan yang gerbang ini ada untuk
mencegah.

## Konsekuensi

**Yang didapat.** Batas antar-repo punya penjaga di sisi yang mengubahnya. Enam
permukaan plus enam belas komponen tidak bisa lagi berubah non-aditif tanpa CI
di sini merah lebih dulu.

**Yang dibayar.** Satu fixture 1.000+ baris yang harus di-regenerate saat kontrak
memang berubah. Diterima: alternatifnya adalah menemukannya lewat build repo lain
yang gagal, berhari-hari kemudian.

**Yang TIDAK dijamin.** Ini kontrak SKEMA, bukan kontrak perilaku. Ia tidak
menangkap perubahan makna dengan bentuk sama (mis. `publicUrl` yang mulai
mengembalikan URL relatif), dan tidak menggantikan test integrasi. Dinyatakan
supaya tak dibaca sebagai jaminan yang lebih besar dari sebenarnya.

**Nol migrasi, nol permission, nol perubahan runtime.** Bundel OpenAPI tidak
berubah — hanya dibekukan sebagian.
