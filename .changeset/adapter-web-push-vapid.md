---
"awcms": minor
---

feat(push): adapter Web Push (VAPID) — nol byte klien, nol origin CSP, diverifikasi terhadap vektor RFC 8291

`PUSH_PROVIDER=web_push` mengaktifkan pengiriman ke **browser** lewat RFC 8030 +
8291 + 8292. Inilah yang ADR-0074 pilih sebagai ganti SDK FCM Web, dan alasannya
terukur: SDK itu **45.041 B** melawan plafon **21.000 B** per berkas, dan
menuntut `www.gstatic.com` di `script-src` plus dua origin `googleapis.com` di
`connect-src` — melawan CSP yang punya enam direktif, **tidak punya
`connect-src` sama sekali**, dan sebuah test yang mengunci nol origin pihak
ketiga (ADR-0029).

`PushManager.subscribe()` adalah API browser, bukan `fetch` dari skrip halaman.
Jadi jalur ini berharga **nol byte klien dan nol origin CSP**. Anggaran aset
tetap 140.008 / 180.000 B, tak bergerak satu byte pun.

## Kenapa buktinya vektor RFC, bukan round-trip

Ini kode paling berisiko di seluruh program push, dan alasannya perlu disebut
lebih dulu: **push service tidak memvalidasi payload.** Ia meneruskan ciphertext
ke browser, dan browser yang tak bisa mendekripsinya membuang notifikasi itu
**diam-diam**. Key schedule yang salah menghasilkan sistem yang menerima setiap
pesan, mencatat setiap kirim sebagai **sukses**, dan tidak mengantarkan apa pun
— tanpa satu error pun di mana pun dalam rantai.

Test round-trip tidak bisa menangkap itu: ia membuktikan encryptor dan decryptor
sepakat, bukan bahwa keduanya cocok dengan spesifikasi. Keduanya bisa salah baca
spec dengan cara yang sama, yang persis mode kegagalan di atas.

Jadi implementasinya mereproduksi **contoh kerja RFC 8291 sendiri** (§5 dan
Lampiran A):

| Nilai | Cocok |
| --- | --- |
| `ecdh_secret` | ya |
| `PRK_key` | ya |
| `IKM` | ya |
| `PRK` | ya |
| `CEK` | ya |
| `NONCE` | ya |
| **body terenkripsi lengkap** | **ya, 144 byte, byte per byte** |

Angka-angka itu datang dari pihak ketiga; mereproduksinya adalah bukti
interoperabilitas, bukan konsistensi diri. Masing-masing di-assert terpisah agar
kegagalan menyebut **langkah mana** yang menyimpang, bukan sekadar melaporkan
ciphertext-nya tak cocok lagi.

HKDF ditulis di atas HMAC `crypto.subtle` alih-alih memakai
`deriveBits({name:"HKDF"})` — justru supaya nilai-nilai antara itu **bisa
diamati**; `deriveBits` melakukan extract-then-expand sebagai satu operasi buram.
Dua puluh baris RFC 5869, nol kriptografi yang diciptakan sendiri.

## Detail yang halus dan diuji

- **Pasangan kunci ECDH server ephemeral per pesan** — desain RFC, bukan
  optimasi yang belum dikerjakan: satu pasangan yang dipakai ulang membuat setiap
  notifikasi ke satu pelanggan berbagi key schedule, sehingga memulihkan satu
  plaintext memulihkan semuanya. Diuji: dua kirim dengan payload identik
  menghasilkan salt DAN keyid berbeda.
- **`aud` VAPID adalah ORIGIN endpoint**, bukan endpoint-nya. Menandatangani
  endpoint penuh adalah kesalahan klasik yang gejalanya 401 dan terbaca seperti
  masalah kunci. Pemanggil menyerahkan endpoint dan tak pernah audience.
- **Tanda tangan ES256 adalah r||s mentah 64 byte**, bukan DER — bentuk DER
  ditolak setiap push service dan didiagnosis oleh tak satu pun dari mereka.
- **Langganan mati tidak memicu circuit breaker** (sepuluh `410` berturut
  meninggalkan breaker `closed`), konsisten dengan adapter FCM.
- Token VAPID di-cache per **origin**: satu batch 500 pelanggan Firefox berharga
  satu tanda tangan, bukan 500.

## Operasional

`bun run push:vapid:generate` mencetak satu pasangan kunci dalam bentuk persis
yang `.env` inginkan. Ia ada alih-alih "pakai openssl" karena formatnya spesifik
dan mudah salah secara halus: publik = **titik P-256 tak-terkompres 65 byte**,
privat = **skalar mentah 32 byte**, keduanya base64url tanpa padding —
sementara `openssl ecparam` mengeluarkan PEM, dan tiap resep konversinya
berpeluang menyerahkan bentuk terbungkus DER, yang **berhasil diimpor di sini**
lalu ditolak setiap push service sebagai 401.

Perintah itu juga mencetak peringatan bersama kuncinya, bukan menyimpannya di
dokumen: **merotasi pasangan kunci tidak me-re-key langganan yang ada** — ia
membuat semuanya permanen tak-terkirimi sampai penggunanya berlangganan ulang,
karena kunci publik dipanggang ke dalam tiap langganan saat `subscribe()`.

`SsrfFetchOptions.body` melebar menerima `Uint8Array`: body Web Push adalah
ciphertext `aes128gcm`, dan tak ada penyandian teks yang selamat melewati
`string`. `fetch` selalu menerima keduanya; hanya tipenya yang lebih sempit dari
benda yang ia teruskan.
