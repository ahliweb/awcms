🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0165-public-site-search-cannot-use-its-gin-index-under-force-rls-without-a-security-definer-read-path-or-a-leakproof-decision.md)

<!-- i18n-source-hash: sha256:5fa4800f59dd129f94bd92a1a2bd63b12b0c3c6d5807f7b9c2c6db6f529cc4c2 -->

<!-- i18n-source-hash: sha256:0 -->

# ADR-0165 — Pencarian situs publik tidak bisa memakai indeks GIN-nya di bawah FORCE RLS tanpa jalur baca SECURITY DEFINER atau keputusan LEAKPROOF

- **Status:** Diusulkan (menunggu keputusan pemilik, pertanyaan Q1)
- **Tanggal:** 2026-11-15
- **Pengambil keputusan:** ahliweb (pemilik)
- **Menyelesaikan (bila diterima):** Issue #1321.
- **Terkait:** amandemen [ADR-0040](0040-site-search-module-admission.id.md) (pencocokan prefiks, #1305), [ADR-0063](0063-ownership-grants-run-through-the-authorization-chokepoint.id.md) (gerbang otorisasi). Tes: `tests/integration/site-search-prefix-plan.integration.test.ts`.

**ADR ini tidak mengimplementasikan apa pun.** Tanpa migrasi, rute, atau perubahan perilaku. Ia mencatat pengukuran dan analisis keamanan agar pemilik dapat memilih.

## Konteks

`searchSiteContent` menyaring `awcms_site_search_documents` dengan `search_vector @@ to_tsquery('simple', $q)`. Tabel punya indeks GIN pada `search_vector` dan `FORCE ROW LEVEL SECURITY` dengan policy `tenant_id = current_setting('app.current_tenant_id')::uuid`.

PostgreSQL memperlakukan policy RLS sebagai **security barrier**: qual buatan pengguna baru boleh dievaluasi sebelum qual policy (sehingga boleh menjadi kondisi indeks) hanya bila fungsinya `LEAKPROOF`. `ts_match_vq`, fungsi di balik `@@`, bukan (`pg_proc.proleakproof = false`; begitu pula `arrayoverlap`, `arraycontains`, dan fungsi dukung GIN; di antara kandidat hanya `texteq`). Di bawah role runtime, planner karena itu tidak bisa memakai indeks GIN dan membaca baris tenant lewat indeks btree tenant lalu menyaringnya dengan pengecekan `@@` per baris. Koneksi superuser melewati RLS dan memakai indeks GIN, itulah mengapa ini mudah terlewat.

## Pengukuran

PostgreSQL 18.7, 4 tenant x 50.000 dokumen (200.000 baris), satu kueri prefiks selektif (`sungai & kapu:*`, 100 hasil per tenant), sudah `VACUUM ANALYZE`, `enable_seqscan` dibiarkan menyala, role runtime `NOLOGIN` non-pemilik dengan RLS `FORCE` dan teks policy produksi. `EXPLAIN (ANALYZE)` bentuk kueri produksi (`ORDER BY ts_rank DESC, id LIMIT 20`):

| Varian                                                              | Rencana                                                           | Waktu eksekusi  |
| ------------------------------------------------------------------- | ----------------------------------------------------------------- | --------------- |
| A. Status quo, role runtime                                         | Bitmap scan indeks btree tenant, `Rows Removed by Filter: 49.900` | 13 sampai 24 ms |
| B. Fungsi baca `SECURITY DEFINER`, tenant diambil dari GUC          | Function scan; di dalamnya indeks GIN                             | 0,8 ms          |
| C. `ts_match_vq` ditandai `LEAKPROOF` (hanya database sekali pakai) | Bitmap Index Scan pada indeks GIN, `Rows Removed by Filter: 300`  | 7,7 ms          |
| (acuan) superuser, RLS dilewati                                     | Bitmap Index Scan pada indeks GIN                                 | 0,8 ms          |

Varian A **linear terhadap ukuran korpus satu tenant**, bukan tabel: tenant dengan dokumen sepuluh kali lipat berbiaya sekitar sepuluh kali lipat. Pada 50.000 dokumen per tenant ia puluhan milidetik, dibatasi rate limit publik dan `statement_timeout`. Ini batas skalabilitas, bukan cacat kebenaran atau keamanan hari ini.

## Opsi

### 0. Tidak melakukan apa pun, pertahankan rencana yang dipatok

Terima A. Tes integrasi yang ada mematok bahwa indeks GIN tidak terpakai di bawah role runtime. Biaya: pertumbuhan linear per tenant; endpoint publik adalah satu-satunya tempat pemanggil tanpa autentikasi menggerakkannya (dibatasi rate).

### 1. Bentuk kueri yang bisa diindeks planner di bawah barrier

**Tidak ada.** Semua yang bisa melayani predikat full-text dari indeks (`@@`, `&&`/`@>` pada array leksem, urutan `ts_rank`) non-leakproof; hanya `texteq` yang leakproof dan ia tak bisa mengungkapkan pencocokan stem atau prefiks. CTE, `OFFSET 0`, subquery, atau LATERAL tidak mengubah level keamanan qual pengguna relatif terhadap qual policy. Tabel pencarian terpisah tanpa RLS akan menyimpan data tenant di luar RLS dan itu perubahan batas, bukan bentuk kueri. Opsi ini sudah diselidiki dan **tidak tersedia** tanpa mengubah batas.

### 2. Fungsi baca `SECURITY DEFINER` (varian B)

Fungsi milik pemilik tabel yang mengambil tenant dari `current_setting('app.current_tenant_id')`, menyaring sendiri, dan mengembalikan baris. Sekitar 20 sampai 30 kali lebih cepat dari A, dan tidak bergantung pada status `LEAKPROOF` katalog.

Analisis keamanan: fungsi berjalan **dengan hak pemilik sehingga melewati RLS pada tabel itu**. Isolasi tenant lalu bergantung pada badan fungsi saja (predikat `tenant_id` dan `search_path` yang dipatok), bukan pada policy yang ditegakkan PostgreSQL pada setiap pernyataan. Ini pelemahan nyata pertahanan berlapis; `awcms_app` hanya butuh `EXECUTE` pada fungsi itu, dan perlu gerbang yang membuktikan badannya memuat predikat tenant dan `search_path` dipatok (probe RLS repositori harus belajar pengecualian ini). ADR-0063 mewajibkan otorisasi lewat `authorizeInTransaction` di handler; itu tetap, fungsi hanya menggantikan pembacaan data.

### 3. Tandai `ts_match_vq` `LEAKPROOF` (varian C)

Sekitar 2 sampai 3 kali lebih cepat dari A dalam tes (indeks dipakai untuk predikat full-text, tenant disaring sesudahnya). Ini perubahan pada **fungsi katalog sistem** yang butuh superuser, tidak ikut tereproduksi oleh restore atau upgrade versi mayor, dan harus diterapkan ulang oleh prosedur deploy. Leakproof berarti fungsi tidak pernah membocorkan argumennya lewat galat atau efek samping; `ts_match_vq` dapat melempar galat bergantung data, sehingga menandainya adalah klaim tentang implementasi PostgreSQL yang tak dapat diverifikasi proyek. Di bawah RLS inti barrier justru bahwa fungsi semacam itu tidak boleh melihat baris tenant lain lebih dulu. **Tidak direkomendasikan**, dan tidak boleh dilakukan tanpa ADR ini.

## Rekomendasi

Opsi 0 sekarang (dibatasi rate limit dan timeout) dan, bila korpus satu tenant tumbuh hingga puluhan milidetik per pencarian publik berarti, **opsi 2** dengan gerbang di atas, karena lokal pada satu fungsi, hasil ukur terbaik, dan menjaga batas tetap dapat ditinjau di satu tempat. Opsi 3 ditolak. Ini rekomendasi, bukan keputusan.

## Pertanyaan terbuka

- **Q1 (pemilik):** terima opsi 0 sebagai keputusan tetap (tutup #1321 sebagai "diterima, terukur, dipatok"), atau izinkan opsi 2 beserta gerbangnya (migrasi dan tes lanjutan)? Opsi 3 tidak ditawarkan.

## Konsekuensi

Bila diterima sebagai opsi 0: `tests/integration/site-search-prefix-plan.integration.test.ts` tetap menjadi patok dan ADR ini alasan tercatatnya. Bila opsi 2: migrasi menambah fungsi dan grant, service pencarian memanggilnya, probe RLS dan tes rencana diperbarui dalam perubahan yang sama, dan ADR menjadi Diterima dengan tinjauan keamanannya sendiri.
