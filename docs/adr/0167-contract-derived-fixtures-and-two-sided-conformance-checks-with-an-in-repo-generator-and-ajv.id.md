🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0167-contract-derived-fixtures-and-two-sided-conformance-checks-with-an-in-repo-generator-and-ajv.md)

<!-- i18n-source-hash: sha256:3eedc33e5e19097042b99b65ab503e7b7fa26f32d213b8f6b60ed5e63c3a1815 -->

# ADR-0167 — Fixture turunan kontrak dan pemeriksaan konformitas dua sisi, dengan generator di dalam repo dan `ajv`

- **Status:** Accepted
- **Tanggal:** 2026-11-20
- **Pengambil keputusan:** ahliweb (pemilik; dipilih dari sejumlah opsi pada 2026-11-20)
- **Terkait:** Issue #1386 (ADR ini), #1379 (riset), #1377 (audit), #1385 (429 dan idempotency di kontrak); ADR-0156 (alur pengembangan v2); ADR-0166 (WCAG 2.2 AA di halaman publik); `docs/awcms/research-openapi-mock-and-two-way-contract-tests-2026-11-20.md`; `docs/awcms/audit-alur-v2-adr-0156-2026-11-20.md`; `docs/awcms/alur-pengembangan.md` langkah 8 dan 11.1

## Konteks

Langkah 8 alur pengembangan mewajibkan mock yang **dihasilkan dari kontrak**, dan langkah 11.1 membangun frontend terhadapnya. Riset #1379 (diverifikasi ulang terhadap repo pada 2026-11-20) menemukan mengapa keduanya belum bisa dijalankan:

- Hanya **1 dari 742** operasi yang membawa contoh respons, tidak ada `204` di mana pun, dan izin sebuah operasi tidak tercatat di kontrak (R1).
- Kontrak memuat cacat yang terungkap oleh klien bertipe atau validator: `BookingPolicy.policy` tidak mendeklarasikan properti apa pun (R2), dan `nullable: true` dipakai 869 kali pada dokumen ber-`openapi: 3.1.0`, tempat ia bukan lagi kata kunci; 19 lokasi memakainya tanpa `type` (R3).
- Skema hanya sekuat daftar `required`-nya: 267 dari 460 skema objek komponen tidak mendeklarasikannya, sehingga properti `Office` yang diganti nama tidak tertangkap (R4).
- Drift antara spesifikasi dan handler ada dan gerbang tidak melihatnya: `api:spec:check` hanya membandingkan himpunan templat path (R5). Uji respons sisi penyedia hanya ada untuk segelintir endpoint, ditulis tangan (R6).
- Setiap konsumen membawa spesifikasi kedua API yang ditulis tangan (R7). Generator layak dibangun di atas dependensi `yaml` yang ada (R9).

Riset menilai pembangkitan tipe saja, server mock (Prism), alat replay, Mock Service Worker, generator di dalam repo tanpa dependensi baru (C), generator yang sama ditambah `ajv` (C′), dan pact berbasis konsumen. Angka dan uji coba ada di laporan dan merupakan satu kali jalan pada satu mesin; itu bukti untuk pilihan ini, bukan klaim konformitas.

## Keputusan

**Opsi C′: kit konformitas kontrak Bun-native di dalam repo, dengan `ajv` sebagai satu-satunya dependensi dev baru, dan tanpa server mock.** Pemilik memilihnya pada 2026-11-20 bersama kebijakan kontrak di bawah.

1. **Generator di dalam repo.** Skrip Bun di atas dependensi `yaml` yang ada membaca kontrak hasil bundel dan menghasilkan contoh serta paket fixture. Kontrak tetap satu-satunya sumber; tidak ada yang menuliskannya ulang dengan tangan.
2. **`ajv` satu-satunya dependensi baru, khusus dev.** Ia memvalidasi skema (lint kontrak yang mengompilasi setiap skema), respons penyedia nyata, dan fixture konsumen. Versi persisnya dipin dan masuk lewat aturan tata kelola dependensi seperti yang lain.
3. **Diff kontrak di samping validasi instans.** Ia mengklasifikasikan perubahan sebagai breaking atau additive, karena validasi instans tidak bisa menangkap apa yang tidak di-`require` kontrak (R4). Mekanisme `api:consumer-contract` yang ada adalah presedennya.
4. **Tanpa server mock.** Paket fixture adalah data, bukan layanan. Konsumen memin-nya dan tidak pernah mengimpor kode repo ini.
5. **Kebijakan kontrak untuk operasi BARU** (operasi yang ditambahkan setelah ADR ini diterima):
   - **contoh respons wajib**;
   - **daftar `required` wajib** pada skema objek yang dideklarasikannya;
   - nilai null ditulis **`type: [X, "null"]`** (gaya OpenAPI 3.1), bukan `nullable`;
   - **`429` wajib** bila endpoint ber-rate-limit (Issue #1385 menerapkannya pada operasi storefront yang ada dan tidak diduplikasi di sini).
6. **Operasi lama diperbaiki bertahap, tanpa retrofit massal.** Berkas yang disentuh karena alasan lain dibawa ke kebijakan; 869 pemakaian `nullable` tidak ditulis ulang dalam satu perubahan. Dua cacat yang diketahui (R2 dan 19 lokasi `nullable` tanpa `type`) diperbaiki lebih dulu karena lint tidak bisa hijau tanpanya.
7. **Paket fixture diterbitkan sebagai artefak terpatok untuk konsumen.** Konsumen (repo lain keluarga dan proyek implementasi mana pun) mengikuti ADR ini: mereka mengganti tiruan tulisan tangan dengan paket itu atau memvalidasi tiruannya terhadapnya, dipin dengan SHA atau tag.

### Yang tidak diputuskan ADR ini

- Klien bertipe (`openapi-typescript` dan sejenisnya) adalah keputusan terpisah dan belakangan (keselamatan saat kompilasi di konsumen, satu dependensi dev per konsumen).
- Apakah setiap operasi wajib mendeklarasikan `5xx` tidak diputuskan; yang diputuskan hanya `429` untuk endpoint ber-rate-limit.
- Tidak ada implementasi yang disetujui di sini. Setiap irisan melewati langkah 8 dan gerbang 9 di issue-nya sendiri.

## Konsekuensi

- **Positif:** kontrak tetap satu-satunya sumber; cacat muncul pada hari lint mendarat (46 dari 734 skema sukses gagal terkompilasi hari ini, menurut uji coba); drift status dan bentuk menjadi tes merah, bukan kejutan; konsumen berhenti memelihara spesifikasi kedua; generator berjalan di atas yang sudah dijalankan repo (Bun).
- **Cacat kontrak harus diperbaiki bersama gerbangnya.** Lint yang merah pada kontrak hari ini tidak bisa mendarat sendirian; issue higiene kontrak mendarat lebih dulu.
- **Contoh dan `required` menjadi aturan mutu kontrak** untuk operasi baru, ditegakkan oleh pemeriksaan yang hanya melihat operasi baru, sehingga operasi lama tidak merahkan CI.
- **Satu dependensi dev lagi untuk ditata** (`ajv`: MIT, empat dependensi langsung pada uji coba; versi dan ukuran seperti terbaca pada 2026-11-20 di laporan). Ia masuk lockfile dan tercakup tata kelola rantai pasok.
- **Mock bukan bukti keamanan saat berjalan.** Ia menunjukkan klien menangani `403`, bukan bahwa server mengembalikannya. Izin, RBAC dan ABAC, FORCE RLS, dan waktu respons anti-enumerasi tetap diuji terhadap sistem nyata. Fixture hanya sintetis (domain cadangan seperti `example.test`, tanpa data nyata).
- **Negatif / trade-off:** repo memiliki generator kecil beserta perawatannya (laporan memperkirakan rendah sampai menengah). Bentuk bersyarat (`oneOf`, misalnya `view=full` pada daftar blog) dan skema siklik butuh aturan atau laporan eksplisit; operasi yang tak bisa ditangani generator harus dilaporkan beserta alasannya, tidak dilewati diam-diam.
- **Negatif / trade-off:** validasi instans tetap hanya sekuat `required`; diff dan kebijakan operasi baru menyempitkan celah itu, dan operasi lama tetap lemah sampai disentuh.

## Alternatif yang dipertimbangkan

- **C, generator yang sama tanpa dependensi baru.** Dipertahankan sebagai cadangan. Ditolak sebagai pilihan karena berarti menulis dan merawat subset validator, dan validator respons tulisan tangan yang sudah ada di repo menunjukkan hasilnya (ia mengabaikan `required` dan properti tambahan).
- **Tipe saja (`openapi-typescript`).** Berharga dan berjalan di Bun, tetapi tidak memberi mock maupun contoh; keputusan terpisah dan belakangan.
- **Prism (server mock).** Ditolak: butuh Node 24 (repo ini hanya Bun), akan kelaparan karena kekurangan contoh, dan menambah layanan.
- **Dredd atau Schemathesis (replay atau fuzz terhadap server hidup).** Ditolak untuk saat ini: satu tidak punya rilis sejak 2021, yang lain di luar toolchain Bun, dan keduanya butuh backend berjalan yang tidak disediakan CI selain Postgres.
- **Mock Service Worker.** Ditolak untuk saat ini: satu uji coba di Bun 1.4.4 tidak mencegat request. Satu uji coba; dapat ditinjau ulang.
- **Pact (kontrak berbasis konsumen).** Ditolak: sumber kebenaran kedua, yang oleh alur hendak dihindari.
- **Tidak berbuat apa-apa.** Ditolak: langkah 8 dan langkah 11.1 tidak bisa dijalankan, dan tiga konsumen terus memegang salinan API masing-masing.

## Catatan gerbang

ADR ini hanya mencatat keputusan pemilik. Ia tidak menyatakan gerbang 9 lolos untuk implementasi apa pun, dan tidak menambah kode, dependensi, route, objek basis data, atau perubahan kontrak. Setiap tindak lanjut adalah issue backlog yang menunggu gerbang 9 dan Definition of Ready-nya.

## Tindak lanjut

Issue backlog, belum diimplementasikan, semuanya menunggu gerbang 9 dan Definition of Ready (epik #1396):

- Higiene kontrak: `BookingPolicy.policy` dan `nullable` tanpa `type` (#1389).
- Gerbang lint kontrak dengan `ajv` (#1390).
- Contoh respons untuk tiga operasi representatif (#1391).
- Generator dan paket fixture dengan gerbang kesegaran (#1392).
- Uji kesesuaian respons sisi penyedia (#1393).
- Terbitkan paket fixture sebagai artefak terpatok (#1394).
- Cek kebijakan kontrak untuk operasi baru (#1395).
- `429` terdeklarasi dan header idempotency opsional untuk operasi storefront (#1385, sudah ada).
- Repo konsumen mengadopsi paket di issue masing-masing, mengikuti ADR ini.
