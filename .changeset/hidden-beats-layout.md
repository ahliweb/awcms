---
"awcms": patch
---

fix(ui): `hidden` kalah dari `display` — form auth tetap tampil dengan tombol terkunci

Setelah reset password berhasil, halaman menampilkan notifikasi "Your password has been
changed" SEKALIGUS formulir yang masih berdiri di bawahnya, lengkap dengan tombol submit
yang membeku pada "Please wait…".

Halamannya tidak salah: ia memang memanggil `form.hidden = true`. Yang membatalkannya
adalah stylesheet. `[hidden] { display: none }` bawaan browser adalah aturan ATRIBUT,
sehingga aturan kelas mana pun yang menyetel `display` mengalahkannya —
`.auth-form { display: flex }` membuat `hidden` tidak berpengaruh apa pun.

Berlaku di EMPAT halaman publik yang memakai pola sama: `reset-password`,
`forgot-password`, `register`, `accept-invitation`.

Diperbaiki di akarnya dengan `[hidden] { display: none !important }` global di
`tokens.css`. `!important` di sini adalah intinya, bukan jalan pintas: `hidden` adalah
pernyataan bahwa elemen itu tidak relevan, dan tidak ada aturan tata letak yang boleh
menganulirnya.
