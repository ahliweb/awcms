---
"awcms": patch
---

Catatan rilis dipotong ke batas body GitHub alih-alih menjatuhkan penerbitan

`release.yml` menyalin satu seksi `CHANGELOG.md` mentah-mentah menjadi body GitHub Release. GitHub menolak body di atas 125.000 karakter dengan `HTTP 422: body is too long` — dan penolakan itu datang **setelah** penandatanganan, attestation, dan push image semuanya berhasil. Hasilnya run yang mati dengan image tertandatangani dan ter-attest di registry, tetapi tanpa rilis yang menunjuk kepadanya.

v7.0.0 gagal persis di sini: seksinya 186.449 karakter, 49% di atas batas. Ini juga bukan kejutan mendadak — v6.0.0 sudah 103.262 karakter, jadi langit-langitnya sudah didekati beberapa rilis tanpa ada apa pun yang melaporkan jaraknya.

Sekarang langkah ekstraksi mengukur hasilnya dan memotong bila perlu, menyisipkan pemisah plus tautan ke `CHANGELOG.md` pada tag itu supaya teks utuhnya selalu satu klik jauhnya. Anggarannya dihitung dalam **byte** melawan langit-langit **karakter**: untuk UTF-8 byte selalu lebih besar atau sama dengan karakter, jadi anggaran byte hanya bisa terlalu berhati-hati, tidak pernah melampaui. Pemotongan mundur ke batas baris terakhir supaya body tak pernah berakhir di tengah karakter atau di tengah markdown.

Diuji terhadap seksi v7.0.0 yang sesungguhnya: 186.449 byte turun menjadi 117.351 karakter, UTF-8 utuh, berakhir rapi. Seksi berukuran normal (v6.4.0, v6.3.0, v6.0.0) melewatinya tanpa disentuh.
