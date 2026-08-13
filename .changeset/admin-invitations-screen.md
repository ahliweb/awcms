---
"awcms": minor
---

feat(admin): layar Invitations — undangan berhenti menjadi kumpulan endpoint (#541)

Permukaannya mendarat lengkap di Gelombang 4 (ADR-0082) dan tanpa halaman. Empat
kuncinya duduk di `NOT_YET_SCREENED` dengan alasan yang ledger itu tulis sendiri:
endpoint-nya ADA dan ditegakkan, yang hilang halamannya.

MEMBUAT SATU UNDANGAN MENJALANKAN SAMPAI TIGA GERBANG, dan formnya mengatakan yang
mana. `invitations.create`, lalu `access_control.assign` begitu peran disebut, lalu
`invitations.configure` ber-scope platform untuk `skipEmailConfirmation` pada alamat
tanpa akun terbukti. Masing-masing otorisasi penuh dengan baris decision log sendiri.
Form yang menggerbangi semuanya pada `create` saja menawarkan dua kontrol yang 403
saat submit; yang ini menyembunyikan pemilih peran dan kotak skip-confirmation
kecuali kuncinya sendiri dipegang.

`delivery: "unavailable"` DITAMPILKAN, TIDAK DITELAN — dan ini temuan, bukan sekadar
penanganan error. Respons pembuatan menyebut apakah surelnya DIANTREKAN, dan tidak
ada endpoint yang mengembalikan tautan undangan. Jadi undangan yang dibuat saat
pengiriman email belum dikonfigurasi itu ADA, VALID, dan tidak bisa diserahkan kepada
siapa pun — mengirim ulang gagal dengan cara yang sama. Halaman ini melaporkannya apa
adanya alih-alih menampilkan sukses yang bukan sukses. Membuat tautannya bisa diambil
adalah keputusan tentang di mana token undangan boleh muncul, dan itu bukan keputusan
layar ini.

`Idempotency-Key` DIKIRIM TEPAT SEKALI. Endpoint pembuatan MEWAJIBKANNYA (400 tanpa
itu); `resend` justru MENOLAKNYA, dan dokumentasinya menjelaskan kenapa: memutar ulang
sebuah resend harus mengembalikan token yang sudah dirotasinya pergi, atau
mempersistenkan plaintext-nya di `awcms_idempotency_keys`. Ia dibatasi dengan cara
lain — UPDATE-nya membawa `resend_count < 5`, sama dengan CHECK basis datanya.

Role sistem tidak ditawarkan: `createInvitation` menolaknya, dan mengetahuinya setelah
menyusun seluruh undangan adalah saat terburuk untuk mengetahuinya.

DIVERIFIKASI DENGAN MENJALANKAN. `bun run check` penuh hijau. Lima mutasi memerahkan
test yang tepat: `Idempotency-Key` ikut dikirim pada resend, `delivery: unavailable`
di-reload menjadi sukses palsu, gerbang kedua tidak diperiksa halaman, role sistem
ikut ditawarkan, dan satu kunci ditinggal di ledger.

`NOT_YET_SCREENED` **menyusut 55 → 51**.
