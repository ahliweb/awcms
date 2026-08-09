---
"awcms": minor
---

feat(sse): koneksi SSE meng-otorisasi ulang setiap tick — ADR-0075, dan konsol push jadi pemakai pertamanya

SSE mendarat dengan satu keputusan yang ditulis lebih dulu: **berapa lama sebuah
keputusan otorisasi boleh dipakai.**

`defineTenantRoute` mengembalikan koneksi ke pool dan melepas slot work-class
**sebelum** satu byte pun sampai ke klien. Untuk request JSON itu benar dan
hemat. Untuk koneksi tiga puluh menit ia mengubah keputusan sesaat menjadi
**izin berdiri**: peran yang dicabut di menit kedua tetap dilayani sampai klien
memutus sendiri. Itu persis postur yang baru saja dihapus #450 dari 32 layar
admin.

Yang membuatnya layak ADR bukan bahwa SSE berbahaya, melainkan bahwa
**default-nya diam**: tak ada gerbang yang bisa melihat "keputusan ini berumur
30 menit" — `access:chokepoint:check` menghitung handler yang memutuskan, bukan
berapa lama keputusannya dipakai. Endpoint SSE yang benar menurut setiap aturan
repo hari ini tetap menghasilkan izin berdiri, dan tak ada yang akan memberi
tahu.

**Keputusan (ADR-0075):** tiap tick membuka transaksi sendiri, memanggil
`authorizeInTransaction` lagi, dan membaca snapshot hanya setelah ia
mengizinkan. Deny bersifat terminal — tak dilewati, tak di-retry.

**Ditolak:** TTL koneksi pendek + reconnect. Ia memindahkan pertanyaannya alih-
alih menjawabnya (pencabutan masih terlambat sebesar TTL) dan menukar satu angka
yang harus dijaga konsisten dengan dua.

## Dua nama event terminal, dan perbedaannya menanggung beban

`authorization-revoked` versus `stream-error`. Memberi tahu klien bahwa aksesnya
dicabut padahal basis data sekadar sibuk adalah kebohongan ke arah yang
diselidiki sebagai bug perizinan — **dan** ia menyuruh klien yang taat untuk
tidak pernah reconnect atas gangguan sementara. `EventSource` reconnect sendiri;
klien menutupnya pada `authorization-revoked` supaya sesi yang dicabut tidak
menggedor endpoint yang akan menolaknya tiap lima detik.

## Byte pertama ditulis segera, dan komentarnya menjelaskan kenapa

`writeResponse` Astro memanggil `writeHead()` **tanpa** `flushHeaders()`, dan Bun
menahan header sampai `write()` pertama. Terukur dengan `Bun.serve` nyata: header
tiba di **+3013 ms** ketika byte pertama ditunda, **+1 ms** ketika langsung
ditulis. Sampai itu `EventSource.onopen` tak pernah menyala dan klien menganggap
koneksinya menggantung. Perbaikannya satu baris — dan justru karena sepele ia
akan "dirapikan" orang berikutnya kalau alasannya tidak ditulis di sebelahnya.

## Satu bug yang ditangkap kompiler dan berarti lebih dari kompilasi

`withTenant` — bukan `withTenantOrThrow` — **mengembalikan** `Response` saat pool
atau circuit breaker menolak, bukan melempar. `catch` saja karena itu akan
melewatkan jalur penolakan utama, dan sebuah `Response` akan mengalir ke klien
sebagai kalau-kalau snapshot. Kini dipetakan eksplisit ke `stream-error`.

## Loop-nya fungsi, dan itu sebabnya bisa dibuktikan

`runSseLoop` menerima efeknya sebagai parameter, jadi properti yang #467 minta —
*"aliran BERHENTI ketika grant dicabut"* — dibuktikan dengan memanggil sebuah
fungsi, bukan dengan basis data, sesi, dan detik jam dinding. Test-nya
mengasersikan bahwa deny mengakhiri loop, bahwa **tak ada** yang ditulis
sesudahnya, dan bahwa otorisasi ditanya **tepat sekali lagi** — yang terakhir
itulah bukti bahwa "tidak" pertama bersifat final.

## Pemakai pertamanya nyata

`GET /api/v1/push/stream` mengalirkan ringkasan antrean ke konsol push, tiap 5
detik, dengan plafon koneksi 10 menit. Operator yang menunggu backlog terkuras
adalah kasus SSE paling kanonik yang ada, dan konsolnya baru saja dibangun.
Daftar pesan dan percobaan **tidak** dialirkan: keduanya dibatasi 50 baris dan
berubah bentuk bukan nilai.

Fan-out multi-instance **belum ada, dan itu ditulis alih-alih didiamkan** — tiap
koneksi mem-poll sendiri, yang bekerja pada default satu instance dan tidak akan
pecah saat replika dinaikkan, hanya tidak menjadi lebih murah. Jebakan penerusnya
ikut dicatat: `RedisClient` Bun yang sudah `subscribe` memblokir hampir semua
perintah lain, jadi subscriber wajib koneksi terpisah.

## Dan satu gerbang yang buta terhadap dokumen baru

`check:docs` membaca `git ls-files`, yaitu **index**, bukan working tree. Berkas
`.md` yang baru dibuat dan belum di-stage karena itu tak terlihat olehnya —
padahal dokumen baru justru yang paling mungkin membawa tautan salah.

Ditemukan dengan cara paling mahal: ADR-0075 lolos `check:docs` **lokal** dengan
tautan rusak ke berkas ADR yang tidak ada, lalu memerahkan CI setelah di-commit.
Hijau lokal lalu merah di CI adalah kegagalan gerbang, bukan sekadar
ketidaknyamanan — ia melatih orang untuk tidak mempercayai run lokalnya.

Diperbaiki dengan `--others --exclude-standard`, dan dibuktikan: berkas
tak-ter-track dengan tautan rusak kini **merah** di mesin lokal.
