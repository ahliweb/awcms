---
"awcms": patch
---

ADR-0050 — BFF `awcms-astro` memperoleh sesi manusia lewat **kode handoff
sekali-pakai**, bukan dengan mem-proksi password.

ADR-0048 sengaja meninggalkan "bagaimana layar internal login". ADR-0049
menyelesaikan setengahnya (BFF yang sudah memegang token bisa mengintrospeksinya);
yang belum dijawab adalah dari mana token itu datang.

Keputusannya: `awcms` tetap satu-satunya tempat kredensial diterima. Pengguna
login DI `awcms` — password, MFA, OIDC, Turnstile, semuanya alur yang sudah ada —
lalu dialihkan balik membawa `code` berumur ≤60 detik yang ditukar BFF
**server-ke-server**. Token sesi tidak pernah sampai ke browser.

Alternatif "BFF mem-proksi password" ditolak, dan alasan yang menentukan BUKAN
bahwa password melintasi repo lain: **login di sini bukan satu langkah**. Ia bisa
berbalas `401 MFA_REQUIRED` + `mfaChallengeToken`, bisa dialihkan ke OIDC provider
tenant, dan bisa mensyaratkan Turnstile. Mem-proksinya berarti mengimplementasi
ulang ketiganya di repo kedua — salinan kedua dari alur MFA adalah tempat paling
mahal untuk membuat kesalahan pertama.

Dokumen, belum kode. Yang harus dibangun berikutnya dicatat eksplisit di
§Konsekuensi, termasuk yang paling mudah salah: allow-list `redirect_uri` yang
ketat (open-redirect di sini berarti menyerahkan kode ke penyerang) dan
penukaran kode yang atomik di bawah kunci baris.
