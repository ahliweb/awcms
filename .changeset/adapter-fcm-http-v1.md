---
"awcms": minor
---

feat(push): adapter FCM HTTP v1 — tanpa dependensi, tanpa satu pun origin CSP baru

`PUSH_PROVIDER=fcm` mengaktifkan pengiriman ke klien **native** Android/iOS.
Server → Google, jadi ia tidak menyentuh browser: nol byte di anggaran aset
klien dan nol origin CSP baru. Itulah pembagian yang ADR-0074 tetapkan —
FCM HTTP v1 ditahan, SDK FCM Web ditolak.

**Tanpa menambah dependensi.** `google-auth-library` dan `firebase-admin`
sama-sama melakukan ini, dan keduanya akan jadi dependensi runtime baru di repo
yang hidup dengan dua. Presedennya sudah tertulis: `src/lib/auth/jwt-verify.ts`
melakukan verifikasi JWT tanpa `jose`. Assertion service-account (RFC 7523)
ditandatangani RS256 lewat `crypto.subtle`, tak pernah implementasi RSA
tangan-sendiri.

Test yang paling menanggung beban bukan percabangan status — itu mudah benar dan
mudah diuji. Yang bisa salah secara halus dan senyap adalah assertion-nya: JWT
yang ditolak Google terlihat persis seperti masalah kredensial, dan "tambahkan
`google-auth-library`" adalah kesimpulan yang akan diambil siapa pun setelah
satu jam begitu. Jadi assertion-nya tidak sekadar dihasilkan — ia
**diverifikasi**, dengan kunci publik pasangannya, lewat `crypto.subtle`.
Pasangan kunci RSA nyata dibangkitkan di dalam test, diekspor ke bentuk PEM
PKCS#8 yang sama dengan terbitan Google, dan dilewatkan parser sungguhan.

**Kredensial wajib base64.** `config:validate` mem-parse `.env` baris demi
baris, dan `private_key` adalah blok PEM multi-baris — ditempel mentah ia
terpotong diam-diam dan kegagalannya muncul saat kirim pertama, bukan saat boot.
Parser-nya pure dan dipakai **kedua** sisi, jadi validator tak bisa berbeda
pendapat dengan benda yang ia validasi. Pesan kegagalannya menyebut **nama
field**, tak pernah nilai: ada test yang meng-assert `private_key` tak muncul.

**Tiga keputusan yang halus:**

- **Token mati tidak memicu circuit breaker.** Antrean normal membawa ribuan
  token basi; kalau itu dihitung sebagai kegagalan provider, satu batch
  registrasi lama menghentikan pengiriman ke setiap perangkat sehat — dan
  gejalanya menunjuk ke FCM. Diuji dua arah: sepuluh `UNREGISTERED` berturut
  meninggalkan breaker `closed`, lima `UNAVAILABLE` membukanya.
- **Kode error dibaca SEBELUM status.** Versi pertama memeriksa `status === 401`
  lebih dulu, dan **test menangkapnya**: `THIRD_PARTY_AUTH_ERROR` (juga HTTP
  401) dilaporkan sebagai "token kadaluwarsa", sehingga adapter mencetak token
  baru dan mengulang — menghabiskan satu round-trip untuk ditolak dengan alasan
  sama, dan melabeli kesalahan konfigurasi permanen sebagai kedaluwarsa.
- **401 disegarkan tepat sekali.** Token yang mati di tengah batch berharga satu
  panggilan tambahan, bukan seluruh sisa batch; token baru yang tetap ditolak
  adalah masalah kredensial dan berhenti di situ (non-retryable).

Setiap panggilan keluar lewat `ssrfSafeFetch`, bukan `fetch` telanjang: tujuannya
diturunkan dari `token_uri` sebuah kredensial dan dari baris langganan — nilai
yang datang dari luar kode ini. Seam-nya sebuah TIPE, bukan pembungkus `fetch`,
supaya test menggerakkan adapter tanpa jaringan **dan tanpa harus mematikan
guard-nya** — test yang harus mematikan guard sedang menguji jalur berbeda dari
yang dijalankan produksi.

`healthCheck` membuktikan kredensialnya, bukan jalur kirim: mengirim notifikasi
nyata butuh token perangkat nyata, dan mengarang satu akan dijawab
`UNREGISTERED` — FCM sehat yang melapor gagal.

`web_push` masih **belum** diterima `PUSH_PROVIDER`. Test yang dulu meng-assert
`fcm` ditolak kini meng-assert `fcm` diterima dan `web_push` tidak — itulah guna
meng-assert yang negatif: daftarnya tak bisa tumbuh mendahului kodenya tanpa
test itu ikut disunting di perubahan yang sama.
