---
"awcms": minor
---

Tutup dua celah keamanan yang asesmen 4 Agustus 2026 (§9.1, §9.2) temukan, keduanya
di lapisan yang tak punya pemeriksa sendiri.

**`AUTH_COOKIE_SECURE` tidak lagi gagal-terbuka saat tidak diset.** Aturan produksi
`scripts/validate-env.ts` dulu hanya menolak string literal `"false"`, sementara
runtime menyetel `secure: process.env.AUTH_COOKIE_SECURE === "true"`. Ejaan salah
(`"1"`/`"TRUE"`/`"yes"`) memang sudah ditolak aturan tipe `bool` — diverifikasi
dengan menjalankan validator, bukan membacanya — sehingga yang benar-benar lolos
tepat satu keadaan, dan ia justru keadaan **bawaan**: variabel tidak diset sama
sekali. Produksi seperti itu mengirim cookie sesi tanpa atribut `Secure` sambil
`bun run config:validate` melaporkan konfigurasi bersih. Aturannya kini `!== "true"`
dengan pesan yang menyebutkan nilai terbaca. Non-produksi sengaja tidak dituntut:
dev berjalan di `http://`, dan `environments.md` sudah mencatat itu sebagai selisih
per-environment yang disengaja.

**`Cross-Origin-Opener-Policy` dan `Cross-Origin-Resource-Policy` kini dikirim**
(`same-origin`, keduanya tanpa gerbang produksi — tidak seperti HSTS, keduanya tidak
menunggu TLS). Keduanya "dianjurkan" OWASP Secure Headers Project dan berlaku di sini
justru karena repo ini punya sesi manusia dan 42 halaman ber-render: COOP memutus
tautan browsing-context-group ke window mana pun yang membuka kita, dan CORP menutup
jalur penyematan `no-cors` yang CORS sendiri tidak tutup. Tidak ada kapabilitas yang
hilang — repo ini tak pernah memancarkan `Access-Control-Allow-Origin`, gambar artikel
disajikan origin R2 yang berbeda, dan Turnstile berjalan di frame anak yang tidak
diatur COOP.

Kedua perbaikan mutation-proven: mengembalikan aturan lama membuat test keadaan-ABSEN
merah, dan asersi header menyasar NILAI-nya, bukan sekadar keberadaannya.
