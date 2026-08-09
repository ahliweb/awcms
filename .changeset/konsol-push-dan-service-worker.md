---
"awcms": minor
---

feat(push): service worker + konsol `/admin/push-notifications` — modul jadi `active`

Modul `push_delivery` mendapat permukaan operatornya, dan dengan itu berpindah
dari `experimental` ke **`active`**. Perpindahan itu bukan pernyataan: ADR-0021
kriteria 1 menolak modul `active` tanpa layar admin, **tanpa pengecualian**, dan
modul ini memilih status jujur selama tiga PR daripada menulis carve-out —
komentar test itu sendiri mencatat apa yang terjadi terakhir kali seseorang
menulis carve-out: alasannya menua dan justru akan membiarkan sebuah modul
**kehilangan** layarnya tanpa ketahuan.

Tiga baris `NOT_YET_SCREENED` yang ditambahkan PR sebelumnya dihapus. Ledger itu
hanya boleh **menyusut**: meninggalkannya setelah layar dibangun akan
memerahkan `admin:screen-coverage:check`, dan itulah yang menjaga angkanya
jujur.

## Dua audiens dalam satu halaman, dengan sengaja

Separuh atas **self-service** — "notifikasi di perangkat ini" — dan tidak
memerlukan permission apa pun: subjeknya adalah orang yang sedang melihatnya.
Separuh bawah adalah antrean tenant dan butuh `diagnostics.read`.

Keduanya berbagi halaman karena bersama-sama menjawab satu pertanyaan. "Saya
sudah mengaktifkan notifikasi dan tidak ada yang datang" dijawab oleh panel
perangkat (browser ini berlangganan?) **dan** panel antrean (ada yang masuk
antrean, dan apa kata push service?) — dan operator yang harus mengorelasikan
dua layar akan mengorelasikan dua momen waktu.

## Service worker: dua perilaku yang terlihat opsional dan tidak

**Push tanpa payload tetap menampilkan notifikasi.** Beberapa push service
mengirim "tickle" tanpa isi, dan payload yang gagal didekripsi tak terpakai.
Diam bukan default yang aman: browser **mewajibkan** notifikasi terlihat untuk
setiap push, menjawab yang senyap dengan "situs ini diperbarui di latar
belakang" miliknya sendiri, dan bila berulang **mencabut izinnya**.

**Target klik di-resolve terhadap origin ini lalu dibandingkan.**
`push-target-path.ts` sudah memvalidasi sebelum baris ditulis, jadi ini tembok
kedua — tapi inilah kode yang benar-benar menavigasi, dan notifikasi yang
membawa nama serta ikon situs ini adalah kendaraan open-redirect paling
meyakinkan yang ada. `new URL(path, origin)` yang membuatnya bisa diputuskan:
`//evil.example/x` protocol-relative me-resolve ke origin lain dan tertangkap,
sementara uji string "diawali `/`" akan meloloskannya.

Ikon **tidak** diambil dari payload: ia akan di-fetch saat ditampilkan,
menyerahkan alamat IP penerima dan fakta bahwa ia sedang online kepada siapa pun
yang memilih URL-nya.

Berkasnya ada di `public/` pada path **tetap**, dan itu bukan kemalasan:
registrasi dikunci pada URL skrip, jadi nama ber-hash-konten akan berganti
setiap build lalu meninggalkan setiap langganan yang dibuat build sebelumnya.

## Konversi kunci VAPID adalah tempat ini diam-diam rusak

`atob` **menolak** alfabet base64url, jadi kunci yang mengandung `-` atau `_`
melempar `InvalidCharacterError` saat `subscribe()` — dan kira-kira tiga
perempat kunci nyata mengandung salah satunya, karena masing-masing dari 65 byte
punya peluang menghasilkannya. Kunci yang kebetulan tidak mengandungnya bekerja,
yang persis cara hal ini rilis hijau lalu gagal untuk sebagian besar deployment.
Konversinya ditulis sendiri dan diuji dengan kunci yang **dipastikan**
mengandung keduanya.

## Angka klien, disebut ulang supaya perbandingan ADR-0074 tetap jujur

"Nol byte SDK" tetap benar dan itu memang klaimnya. Sisi klien tidak gratis:

| | Byte |
| --- | --- |
| `push-sw.js` (disalin apa adanya dari `public/`, tak diminifikasi) | 5.515 |
| skrip halaman (terbundel + terminifikasi) | 4.659 |
| **total** | **10.174** |
| SDK FCM Web yang DITOLAK (halaman + service worker) | **91.333** |

Selisihnya 9×, kedua berkas SDK itu menembus plafon per-berkas 21.000 B, dan
janji CSP ADR-0029 tetap utuh: `worker-src` jatuh ke `default-src 'self'`,
service worker-nya same-origin, dan **tidak ada satu pun direktif yang berubah**.

Anggaran aset: 150.182 / 180.000 B.

## `enqueuePushToRecipients` akhirnya punya pemanggil produksi

`POST /api/v1/push/test`. Kesenjangan yang ADR-0074 catat di §Konsekuensi
alih-alih dibiarkan ditemukan, kini ditutup dan ADR-nya diperbarui.
