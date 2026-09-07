🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0121-tenant-route-authorize-any-of-array-form.md)

<!-- i18n-source-hash: sha256:55ec0221921152bbaa06a453a60d509c2281d013beb4e04758b823d43342f445 -->

# ADR-0121 — `authorize` mendapat bentuk array any-of, tetap di dalam chokepoint

- **Status:** Accepted
- **Tanggal:** 2026-09-07
- **Pengambil keputusan:** ahliweb
- **Men-extend:** [ADR-0063](0063-ownership-grants-run-through-the-authorization-chokepoint.md) — chokepoint yang sama, aturan "tanpa keputusan ad-hoc" yang sama; ADR ini menambah BENTUK ketiga untuk `TenantRouteConfig["authorize"]`, bukan jalur keputusan kedua.
- **Terkait:** Issue #794 / PR #797 (`PATCH /api/v1/media/objects/{id}`, rute yang membutuhkan ini); `src/modules/_shared/tenant-route.ts` (`selectAnyAllowed`); `src/lib/auth/admin-screen.ts` (`selectEntryOutcome`, saudara yang ditiru); `tests/tenant-route-any-of.test.ts`; `tests/tenant-route-factory.test.ts`

## Konteks

`authorize` milik `defineTenantRoute` punya dua bentuk: satu `AccessRequest`
tunggal (kasus umum — satu permission menggerbangi seluruh rute), atau fungsi
dari `prepared` untuk rute langka yang permission wajibnya bergantung pada isi
body. Bentuk fungsi punya carve-out yang terdokumentasi dan menanggung beban:
saat `prepare` sendiri menolak (body buruk, header hilang), `heldPrepareRefusal`
mengembalikan penolakan itu TANPA pernah memanggil `authorizeInTransaction` —
karena guard berbentuk fungsi belum punya `prepared` untuk dibaca, tidak ada
yang bisa dievaluasi. Carve-out itu di-scope, berdasarkan nama, ke persis dua
rute yang benar-benar tak bisa menunda (`POST /api/v1/partners/:id/status`,
`POST /api/v1/access/machine-credentials`).

PR #797 butuh hal ketiga: `PATCH /api/v1/media/objects/{id}` tidak punya
permission yang sama untuk semua bentuk body yang diterimanya (seorang
reviewer status-only memegang `media.adjudicate_rights` tapi tak pernah
`media.update`; seorang editor rutin memegang sebaliknya). Versi pertamanya
memilih `media.update` vs `media.adjudicate_rights` dengan fungsi dari body —
yang kebetulan cocok dengan `typeof config.authorize === "function"`, bukan
karena properti yang menjadi alasan carve-out itu ada. Konsekuensinya nyata dan
terukur: body yang TIDAK VALID (kehilangan `Idempotency-Key`) membuat rute
mengembalikan penolakan `400` yang ditahannya untuk SETIAP pemanggil, termasuk
yang tanpa permission sama sekali, sebelum `authorizeInTransaction` pernah
berjalan — tak ada token yang dicek, tak ada baris
`awcms_access_decision_log` yang ditulis. `tests/e2e/api-authorization-first.e2e.ts`
menangkapnya, dan review keamanan langsung mereproduksinya.

Permission yang dibutuhkan rute ini BUKAN fungsi dari body — "apakah pemanggil
memegang setidaknya satu dari dua permission ini" punya jawaban yang tidak
bergantung pada body. Pertanyaan itu sudah punya implementasi: guard entry
any-of milik `loadAdminScreen` (`selectEntryOutcome`), dibangun untuk delapan
konsol admin yang panel-panelnya bisa dibaca independen. ADR ini memindahkan
bentuk itu ke `defineTenantRoute`.

## Keputusan

**`authorize` menerima `AccessRequest | readonly AccessRequest[] | (context) => AccessRequest`.** Bentuk tengah yang baru adalah any-of: rute bisa dijangkau begitu pemanggil memegang SETIDAKNYA SATU dari request yang terdaftar.

### Kapan memakai bentuk yang mana

- **Objek tunggal** (tak berubah, tetap default): satu permission menggerbangi
  seluruh rute.
- **Array (ADR ini):** rute tidak punya permission yang sama untuk semua
  pemanggil yang harus diterimanya, dan permission mana yang berlaku TIDAK
  bergantung pada body request — hanya pada permission apa yang kebetulan
  dipegang pemanggil. `handler` rute tetap membuat panggilan
  `authorizeInTransaction` yang sesungguhnya dan spesifik-bentuk-body
  sesudahnya; array ini hanya menjawab "apakah layak membuka handler sama
  sekali".
- **Fungsi:** disediakan untuk kasus lebih sempit yang tak bisa dicakup array —
  permission itu sendiri dihitung dari `prepared`, dan tak ada pertanyaan
  any-of yang tak bergantung body punya jawaban berguna. Bentuk ini TAK BISA
  menunda melewati `heldPrepareRefusal` (lihat di bawah), itulah kenapa ia
  tetap jadi carve-out, bukan kasus umum, dan kenapa perbaikan PR #797 pindah
  MENINGGALKAN bentuk ini alih-alih melebarkan carve-out ke rute ketiga.

### Invarian yang membuat bentuk array ini aman

1. **Any-of, bukan all-of.** Diizinkan saat setidaknya satu `AccessRequest`
   yang terdaftar mengizinkan; ditolak hanya saat SEMUA yang dievaluasi
   menolak. Diimplementasikan di `selectAnyAllowed`, meniru
   `selectEntryOutcome`.
2. **Setiap kandidat yang dievaluasi lewat chokepoint sungguhan** —
   `authorizeInTransaction`, berbagi satu read cache
   (`createAuthorizationReadCache`) supaya pembacaan sesi/status-tenant tidak
   berulang per kandidat — tak pernah perbandingan ad-hoc. Ini BUKAN klaim
   yang sama dengan "setiap kandidat yang terdaftar selalu menghasilkan baris
   decision-log": loop berhenti pada ALLOW pertama, jadi kandidat yang
   terdaftar setelah satu yang sudah mengizinkan tak pernah dievaluasi dan tak
   menulis baris apa pun. Setiap kandidat yang DIEVALUASI menulis satu baris —
   khususnya, setiap PENOLAKAN di sepanjang jalan menulisnya, dan jika semua
   kandidat menolak, semuanya menulis. Ini sengaja berbeda dari
   `selectEntryOutcome`, yang mengevaluasi setiap kandidat karena sebuah layar
   punya bacaan `entry` per-panel yang harus diisi; sebuah rute tidak punya
   bacaan semacam itu, dan mencatat permission yang tak pernah ditanyakan ke
   pemanggil hanya akan menambah baris decision-log yang terbaca salah sebagai
   "ini dicek dan ditolak" untuk permintaan yang tak pernah membutuhkannya.
3. **Array kosong menolak.** `selectAnyAllowed([])` mengembalikan `403`, tak
   pernah mengizinkan — "tak ada request yang mengotorisasi rute ini" tak
   boleh pernah terbaca sebagai "request apa pun mengotorisasi". **Diverifikasi
   pada implementasi saat ini** (bukan sekadar diasumsikan):
   `tests/tenant-route-any-of.test.ts` memanggil `selectAnyAllowed([])`
   langsung dan mengasersikan `allowed === false`. **Catatan/batasan yang
   diketahui:** ini adalah invarian RUNTIME, bukan invarian sistem tipe —
   `readonly AccessRequest[]` tidak melarang penulis rute menulis
   `authorize: []`, dan TypeScript tidak akan menandainya. Tak ada kode hari
   ini yang membuat array kosong (`api:tenant-route:check` perlu aturannya
   sendiri untuk melarangnya di level situs-panggil, yang tidak ditambahkan
   ADR ini), jadi jaring pengamannya adalah jalur deny runtime, yang diuji
   dengan unit test sungguhan, bukan dibiarkan sebagai asumsi tak tertegakkan.
4. **Penolakan yang dilaporkan adalah milik kandidat PERTAMA**, bukan yang
   terakhir — rute mendaftarkan permission utamanya lebih dulu, jadi respons
   menjelaskan penolakan yang paling mungkin ditanyakan pemanggil, dan tidak
   bergeser tergantung permission mana yang kebetulan tak dipegang pemanggil
   tertentu.

### Kenapa bentuk array tidak jatuh ke carve-out `heldPrepareRefusal`

Kondisi carve-out itu adalah `typeof config.authorize === "function"`. `typeof`
sebuah array literal adalah `"object"`, jadi bentuk array tak pernah
mencocokkannya — karena konstruksi, bukan karena disiplin penulis rute. Secara
konkret: ia sama sekali tidak membaca `prepared`, jadi tak ada apa pun
tentangnya yang bisa dibatalkan oleh `prepare` yang gagal, dan ia tetap bisa
dievaluasi bahkan saat `prepare` menolak. Inilah properti persis yang hilang
dari bug PR #797: guard yang tak butuh body seharusnya tak pernah digerbangi
oleh keberhasilan parsing body. `tests/tenant-route-factory.test.ts`
menegakkan perilaku ini: `authorize` bertipe array yang dipasangkan dengan
`prepare` yang mengembalikan `400` tetap mencapai `withTenant` (dibuktikan
lewat circuit breaker yang dibuka paksa, mengubah upaya itu jadi `503`, bukan
`400` yang akan dikembalikan lebih awal oleh carve-out bentuk-fungsi).

## Konsekuensi

- **Positif:** rute tanpa satu permission yang sama untuk semua tak lagi harus
  memakai bentuk fungsi (beserta risiko carve-outnya) untuk menyatakan "salah
  satu dari ini sudah cukup". `PATCH /api/v1/media/objects/{id}` adalah
  pemanggil pertama, dan satu-satunya, hari ini.
- **Positif:** properti yang menjadi alasan ADR ini ada — otorisasi menjawab
  sebelum validasi body — kini punya baik cakupan e2e ber-DB yang sudah ada
  maupun jaring pengaman regresi unit-level yang cepat dan bebas-DB untuk
  mekanisme spesifiknya (array vs `typeof` fungsi).
- **Negatif / trade-off:** kini ada dua implementasi any-of (`selectAnyAllowed`
  di samping `selectEntryOutcome`), dibiarkan terpisah alih-alih dibagi karena
  sebuah rute butuh `Response` penolakan asli (body `code`/`message`) sementara
  sebuah layar hanya pernah butuh angka status.
- **Netral:** nol migrasi, nol perubahan permission, nol perubahan OpenAPI.
  Satu-satunya perubahan perilaku adalah guard `PATCH /api/v1/media/objects/{id}`
  sendiri, dicakup oleh integration test PR #797 yang sudah ada.

## Alternatif yang dipertimbangkan

- **Melebarkan carve-out `heldPrepareRefusal` ke rute ketiga.** Ditolak —
  itulah persis cacat yang ingin dicegah ADR ini agar tak terulang: rute yang
  guard-nya HANYA TERLIHAT butuh body, padahal pertanyaan sesungguhnya
  ("memegang setidaknya satu dari N permission") tidak.
- **Memberi rute satu permission yang lebih kasar** (mis. mewajibkan
  `media.update` untuk semuanya, membuang `adjudicate_rights`). Ditolak
  sebelum ADR ini, oleh PR #797 sendiri — itu justru kerentanan yang ingin
  ditutup oleh pemisahan ini: siapa pun yang bisa menyunting credit line juga
  bisa mengklaim sendiri bahwa itu lolos untuk dipublikasikan.
- **Mengevaluasi setiap kandidat terdaftar tanpa syarat, seperti
  `selectEntryOutcome`.** Ditolak — `handler` sebuah rute tak punya bacaan
  per-kandidat yang harus diisi, jadi panggilan chokepoint ekstra hanya akan
  menambah derau decision-log untuk permission yang tak pernah dibutuhkan
  permintaan itu.
