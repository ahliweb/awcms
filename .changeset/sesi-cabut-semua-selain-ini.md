---
"awcms": minor
---

feat(auth): "keluarkan saya dari semua perangkat lain" — tanpa flag yang nilai satunya adalah logout yang lebih buruk

Gelombang 2 PR 2.3 dari #423. `POST /api/v1/auth/sessions/revoke-all` mengakhiri
setiap sesi hidup milik identitas pemanggil **kecuali** yang sedang dipakai.
Self-service, nol izin baru, sejalan dengan dua endpoint di sebelahnya.

**Flag `?exceptCurrent=true` dari rencana program tidak ikut mendarat.** Boolean
itu hanya punya satu nilai yang jujur di sini: nilai satunya juga mengakhiri sesi
yang sedang meminta, dan itu `POST /api/v1/auth/logout` — yang **juga**
membersihkan cookie yang tak bisa dilihat rute ini. Jadi menerima flag-nya berarti
mengirimkan logout kedua yang lebih buruk, yang satu-satunya ciri khasnya adalah
meninggalkan pemanggil memegang cookie mati. Default yang tak boleh dibalik lebih
jujur ditulis sebagai tiadanya parameter.

Ini endpoint yang dicari orang setelah "sepertinya password saya bocor". Ia harus
bekerja **sementara** mereka masih masuk, atau mereka memakainya lalu menemukan
tak bisa mengganti password sesudahnya.

**Ia tidak menyentuh kredensial dan tidak menyentuh penghitung lockout.**
`completePasswordReset` mencabut sesi sebagai **akibat** perubahan kredensial; yang
ini kebalikannya dan tetap begitu. Orang yang membereskan sesi liar belum
membuktikan apa pun yang baru tentang kredensialnya, jadi tak ada yang
membersihkan `failed_login_count` atau `locked_until` di sini — menyatukan keduanya
akan menjadikan kebersihan sesi sebuah oracle reset lockout. Ada test yang
meng-assert nol query menyebut `awcms_identities`.

**Tidak diaudit, sengaja.** `awcms_audit_events` mencatat apa yang dilakukan
**administrator terhadap orang lain**; endjoint admin pasangannya
(`POST /api/v1/users/{id}/sessions/revoke-all`, PR 2.2) menulis entrinya. Orang
yang merapikan sesinya sendiri bukan tindakan administratif atas siapa pun, dan
mencatat tiap pembersihan self-service akan memenuhi jejak yang dibaca investigator
dengan entri tentang orang yang bertindak atas dirinya sendiri.

Jawabannya `200` dengan **angka**, bukan `204` kosong: "katanya berhasil, tapi
apakah saya masih masuk di ponsel" adalah pertanyaan berikutnya, dan nol adalah
jawaban nyata (memang tak ada yang lain) alih-alih kegagalan.

Asersi "tanpa flag" dijalankan terhadap **kode dengan komentar dibuang** — docblock
menyebut penolakannya dengan nama, dan sebutan dalam prosa tak boleh bisa
memerahkan test tentang perilaku, maupun menghijaukannya.
