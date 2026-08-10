---
"awcms": minor
---

feat(auth): ganti password sendiri — dan step-up hanya diminta dari orang yang punya faktor kedua

Gelombang 2 PR 2.4 dari #423. `POST /api/v1/auth/password/change`: pasangan dari
`password/reset` — yang itu melayani orang yang **tidak bisa** masuk dan
membuktikan penguasaan kotak surat; yang ini melayani orang yang **sudah** masuk
dan membuktikan penguasaan kredensialnya. Self-service, nol izin baru.

**Rencana program menulis "step-up aal2 + password lama". Bagian aal2-nya
mendarat BERSYARAT, dan itu koreksi terhadap rencana, bukan penyederhanaan.**
`requireStepUp` menolak setiap sesi yang tidak sedang `aal2`, dan orang tanpa
faktor terdaftar **tidak akan pernah** bisa mencapai `aal2`. Mengirimkannya
tanpa syarat berarti setiap pengguna tanpa MFA permanen tak bisa mengganti
passwordnya — dan yang paling mungkin butuh justru mereka yang baru saja tahu
passwordnya bocor. Itu jebakan ADR-0058 §E dengan baju berbeda: gerbang yang
terbaca benar sambil menolak semua orang.

Jadi aturannya bersyarat dan tiap bagian menanggung bebannya sendiri: **password
lama adalah re-autentikasi untuk semua orang**, dan **faktor kedua yang segar
diminta tambahan dari siapa pun yang punya**. Tak ada yang diminta kurang dari
yang bisa ia berikan, dan tak ada yang diminta sesuatu yang tak bisa ia berikan.

Step-up dievaluasi **sebelum** verifikasi argon2id: jauh lebih murah, dan menjaga
penolakan step-up basi tidak sekalian menjadi jawaban apakah `currentPassword`
yang dikirim benar.

**Kebijakan SSO-only diperiksa ulang di sini**, tidak dipercaya dari waktu login:
tenant bisa saja berpindah ke SSO-only sejak sesi ini terbit, dan seluruh maksud
kebijakan itu adalah password tidak bisa dipakai masuk. Menulis password baru
berarti menulis kredensial yang menurut kebijakan tak boleh bekerja. → `409`.

**Sesi pemanggil selamat, sisanya mati.** Ganti password yang mengeluarkan Anda
dari tab tempat Anda menggantinya terbaca sebagai kegagalan, sementara properti
keamanannya tidak berubah — sesi pencuri termasuk yang mati. Penghitung lockout
dibersihkan, alasan yang sama dipakai jalur reset: siapa pun yang menyerahkan
password saat ini sudah membuktikan penguasaan kredensial, sinyal yang lebih kuat
dari penghitung yang menguncinya; penyerang yang bisa sampai ke cabang itu sudah
tahu passwordnya.

**Dibatasi laju meski sudah terautentikasi.** `currentPassword` adalah rahasia
yang bisa ditebak, jadi ini permukaan tebak-kredensial bahkan di balik sesi —
kasus yang penting adalah sesi pinjaman atau curian dipakai memburu password yang
tidak ikut terbawa. Di-key ke **sumber**, bukan ke akun: bucket ber-key identifier
di sini memberi siapa pun yang bisa menjangkau endpoint tuas menahan ganti
password satu orang — keberatan yang persis sama sudah tercatat menolak bucket
login ber-key identifier.

Sukses **dan** gagal sama-sama diaudit: `currentPassword` yang salah dikirim lewat
sesi hidup adalah sinyal bahwa sebuah sesi dipakai orang yang tak tahu kredensial
di belakangnya. Atributnya membawa bentuk perangkat dan pseudonim IP, dan **tak
membawa password — bahkan panjangnya**. Asersinya berjalan terhadap nilai
`attributes:` itu sendiri, bukan terhadap seluruh berkas: docblock menyebut kedua
field, dan prosa tak boleh memutuskan test tentang perilaku.

Password yang tidak berubah ditolak sebagai **validation error**, bukan dijawab
sukses no-op: "berhasil diganti" dibaca orang sebagai "password lama saya sudah
tidak berlaku", dan itu tidak akan benar.
