---
"awcms": patch
---

docs(sync): outbox sisi server berhenti dijanjikan bekerja — dan keluar dari ledger utang ke daftar pengecualian ber-alasan

`awcms_sync_outbox` tidak ditulis apa pun: nol `INSERT` di kode aplikasi, di
trigger, dan di migrasi mana pun. `POST /api/v1/sync/pull`, satu-satunya
pembacanya, karena itu hanya bisa menjawab `events: []` — selamanya. Sebuah node
yang mengintegrasikan protokol ini menerima `200 OK` dengan `hasMore: false` dan
menyimpulkan server memang tak punya perubahan, bukan bahwa jalurnya tak pernah
tersambung. Kegagalan senyap dengan status sukses.

Sementara itu README modul menggambarkannya tanpa kualifikasi apa pun — *"local
events available to be pulled by other nodes"* — dan mendaftarkan endpoint-nya
bersebelahan dengan saudaranya yang bekerja.

**Dinyatakan di tiga tempat yang benar-benar dibaca:** README modul (klaimnya
diperbaiki, dan §"Belum tersedia" mendapat entri pertamanya soal ini), deskripsi
tag OpenAPI — yang **ter-render ke `docs/awcms/api-reference.md`** — dan komentar
tabelnya.

Deskripsi operasi `/sync/pull` sendiri **tidak** diubah, dan alasannya ditulis di
tempat gantinya: `tests/fixtures/openapi-pre-migration-snapshot.openapi.yaml`
beku, dan `tests/openapi-bundle.test.ts` mewajibkan tiap path pra-migrasi
byte-identical. Deskripsi tag tidak ikut dibekukan (hanya nama tag yang
dibandingkan), jadi itulah permukaan yang tersedia — dan kebetulan permukaan
yang lebih baik, karena ia muncul di dokumen yang dibaca manusia.

**Tabelnya pindah dari `TABLES_PREDATING_THE_RULE` ke `BOUNDED_BY_DESIGN`.**
Ledger utang membawa tepat satu alasan — *"nobody asked the retention question of
these"* — dan alasan itu **sudah tidak benar** untuk tabel ini: pertanyaannya
diajukan di #468 dan dijawab. Selama ia duduk di sana, sebuah tabel yang **tak
bisa** dideskripsikan terlihat persis seperti tabel yang **belum**, yaitu
kebingungan yang melahirkan #477 dan #479.

Entri ini juga yang pertama di `BOUNDED_BY_DESIGN` — daftar yang sengaja dimulai
kosong — dan satu-satunya yang premisnya **diperiksa mesin** alih-alih
diperdebatkan: `tests/object-queue-purge.test.ts` memindai tiap `.ts` dan `.sql`
di `src/` dan `sql/`, dan gagal begitu sebuah produsen muncul. Dibuktikan dengan
menanam `INSERT INTO awcms_sync_outbox` palsu → **merah**. Test yang sama kini
juga meng-assert entri pengecualiannya, sehingga keduanya bergerak bersama: hari
seseorang menyambungkan produsennya, satu run mengatakan sekaligus bahwa
klaimnya batal dan entri mana yang harus pergi.

**Yang TIDAK diputuskan:** apakah tabel dan endpoint-nya disambungkan atau
dipensiunkan. Itu keputusan produk, bukan teknis — repo ini sudah punya outbox
transaksional yang bekerja (`awcms_domain_events`, lengkap dengan dispatcher,
DLQ, dan replay), jadi pertanyaan pertamanya bukan "bagaimana mengisinya"
melainkan **apakah ia perlu ada**, dan yang kedua adalah event mana yang boleh
diterima sebuah node — pelebaran akses, bukan penyambungan kabel. Menghapusnya
juga bukan langkah bebas: snapshot kontrak beku mewajibkan tiap path pra-migrasi
tetap ADA, tanpa allow-list untuk penghapusan.

#477 tetap terbuka untuk keputusan itu, kini dengan pertanyaan yang sudah
dipersempit dan tanpa dokumen yang menjanjikan sesuatu yang tak ada.
