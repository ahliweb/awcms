# ADR-0075 — Koneksi SSE meng-otorisasi ulang setiap tick

- **Status:** Accepted
- **Tanggal:** 2026-08-10
- **Pengambil keputusan:** @ahliweb
- **Terkait:** Issue #467 (epic #463), [ADR-0063](0063-authorization-chokepoint-per-handler.md) (chokepoint per-handler), [ADR-0049](0049-machine-credentials-and-session-introspection.md) (seam rute selain `defineTenantRoute`), [ADR-0072](0072-decision-log-retention-and-projection-authority.md) (retensi decision log, yang membuat volume per-tick terbatas), [ADR-0074](0074-push-delivery-is-a-second-outbox.md) (konsol yang menjadi pemakai pertamanya)

## Konteks

SSE bisa berjalan di repo ini: adapter Node mendukung streaming, middleware tidak menyentuh body, tidak ada kompresi yang menahan buffer, dan edge cache tidak merusaknya. Yang belum diputuskan adalah **berapa lama sebuah keputusan otorisasi boleh dipakai**.

`defineTenantRoute` mengembalikan koneksi ke pool dan melepas slot work-class **sebelum** satu byte pun mengalir ke klien. Untuk sebuah request JSON itu benar dan hemat. Untuk sebuah koneksi yang hidup tiga puluh menit, ia mengubah keputusan sesaat menjadi **izin berdiri**: peran yang dicabut di menit kedua tidak menghentikan aliran sampai klien memutus sendiri.

Itu kebalikan dari postur yang baru saja ditegakkan menutup R3 (#450), ketika ke-32 layar admin dipindahkan supaya memutuskan di `authorizeInTransaction` dan bukan dari himpunan grant yang sudah dibaca.

Yang membuatnya layak ADR bukan bahwa SSE berbahaya, melainkan bahwa **default-nya diam**. Tidak ada gerbang yang bisa melihat "keputusan ini berumur 30 menit": `access:chokepoint:check` menghitung handler yang memutuskan, bukan berapa lama keputusannya dipakai. Sebuah endpoint SSE yang benar menurut setiap aturan repo hari ini tetap menghasilkan izin berdiri, dan tidak ada yang akan memberi tahu.

## Keputusan

**Setiap tick membuka transaksi baru dan memanggil `authorizeInTransaction` lagi.** Snapshot data hanya dibaca setelah keputusan itu, di dalam transaksi yang sama. Deny mengakhiri koneksi — ia tidak dilewati, tidak di-retry, dan tidak di-log sebagai kesalahan sementara.

Biayanya satu rantai guard per tick per koneksi. Itu memang harga dari tidak punya izin berdiri, dan ia dibayar dengan mata terbuka: interval tick adalah parameter yang wajib ditulis di setiap rute, jadi biaya itu selalu terlihat di tempat ia dipilih.

Yang **ditolak** sebagai alternatif: TTL koneksi pendek dengan reconnect. Ia memindahkan pertanyaannya, tidak menjawabnya — dengan TTL 60 detik, pencabutan peran masih berlaku hingga 60 detik terlambat, dan sekarang ada dua angka yang harus dijaga konsisten (TTL dan interval tick) alih-alih satu. Ia juga menukar satu query per tick dengan satu handshake TLS + satu rantai guard penuh per TTL, yang belum tentu lebih murah dan pasti lebih berisik di log.

### Empat konsekuensi yang mengikat implementasinya

**1. Byte pertama ditulis segera, dan komentarnya menjelaskan kenapa.** `writeResponse` Astro memanggil `writeHead()` tanpa `flushHeaders()` (`node_modules/astro/dist/core/app/node.js`), dan Bun menahan header sampai `write()` pertama. Terukur dengan `Bun.serve` nyata: header tiba di **+3013 ms** ketika byte pertama ditunda, **+1 ms** ketika langsung ditulis. Artinya `EventSource.onopen` tidak pernah menyala dan klien menganggap koneksinya menggantung. Perbaikannya sepele — tulis komentar SSE (`: ok`) segera — dan justru karena sepele ia akan "dirapikan" orang berikutnya kalau alasannya tidak ditulis di sebelahnya.

**2. `tx` tidak boleh masuk closure stream.** Koneksinya sudah dikembalikan ke pool saat stream dimulai; memegangnya berarti memakai koneksi yang sudah diberikan ke request lain. Setiap tick membuka dan menutup transaksinya sendiri, dan `tx` tidak pernah hidup lebih lama dari satu tick.

**3. Loop tick tinggal di `src/modules/_shared/`, bukan di `src/pages/api`.** `api:tenant-route:check` menolak `withTenant` langsung di rute, dan aturan itu tidak dilonggarkan untuk SSE: yang mendarat adalah seam keempat di `tenant-route.ts`, sejajar dengan `defineTenantRoute`, `defineSelfServiceTenantRoute`, dan `defineClientCredentialTenantRoute`.

**4. Fan-out multi-instance BELUM ADA, dan itu ditulis alih-alih didiamkan.** Produksi default satu instance (`capacity-config.ts`), jadi setiap koneksi mem-poll basis data sendiri dan itu bekerja hari ini. Ia tidak akan pecah saat replika dinaikkan — polling per-koneksi tetap benar — tetapi ia juga tidak akan menjadi lebih murah, dan pola pub/sub yang akan menggantikannya punya jebakan tersendiri: `RedisClient` Bun yang sudah `subscribe` memblokir hampir semua perintah lain, jadi subscriber-nya **wajib** koneksi terpisah, bukan singleton yang dipakai rate limiter. Dicatat di sini supaya orang yang menaikkan replika menemukannya sebelum, bukan sesudah.

## Konsekuensi

Sebuah rute SSE di repo ini tidak bisa lagi ditulis tanpa menjawab "berapa sering ini memutuskan ulang" — parameternya wajib. Deny di tengah koneksi menutup aliran dengan sebuah event terminal bernama, jadi klien bisa membedakan "izin dicabut" dari "jaringan putus" dan tidak reconnect selamanya ke endpoint yang akan menolaknya.

Setiap keputusan per tick menulis barisnya sendiri di `awcms_abac_decision_logs`, karena ia benar-benar melewati chokepoint. Itu volume yang nyata dan disebut di muka: satu koneksi lima menit dengan tick lima detik menulis 60 baris. ADR-0072 sudah memberi tabel itu retensi, jadi konsekuensinya terbatas — tapi interval tick yang agresif pada endpoint yang ramai adalah keputusan kapasitas, bukan hanya keputusan UX.
