---
"awcms": minor
---

feat(email): outbox email keluar dari ledger utang retensi

Dua dari enam tabel yang issue #468 sebut — `awcms_email_messages` dan
`awcms_email_delivery_attempts` — mendapat deskriptor `dataLifecycle`, sebuah
job purge, dan barisnya dihapus dari `TABLES_PREDATING_THE_RULE`. Ledger itu
jujur tentang apa yang tak bisa dilakukannya: *"tell you that an EXISTING table
on that ledger is quietly eating the disk"*.

Angkanya nyata: `awcms_email_delivery_attempts` menulis satu baris **per
percobaan**, jadi satu pesan yang gagal berharga hingga enam baris permanen.

## Keduanya `delegated`, dan itu seluruh argumen keamanannya

`HighVolumeTableDescriptor` membawa `cursorColumn` dan **tidak** membawa
predikat status, jadi executor generik menghapus murni berdasarkan umur.
Diarahkan ke antrean ini, ia menghapus surat yang **belum terkirim** — pesan
yang tersangkut di balik gangguan provider lebih lama dari jendela retensi akan
lenyap, dan lenyapnya terlihat persis seperti housekeeping yang berhasil.

Dua status paling mudah terbalik, dan keduanya disebut eksplisit:
`suppressed` **terminal** (alamatnya ada di daftar suppression saat dispatch —
jawaban final), `sending` **tidak** (ia diklaim satu pass dispatcher yang
mungkin sedang di tengah kirim, dan lease-nya yang memulihkannya bila pass itu
mati).

Daftar status terminal diturunkan dari CHECK constraint `sql/014`, bukan
ditebak: status yang ditambahkan ke skema dan tidak ke sini akan menumpuk
selamanya tanpa error di mana pun.

## `--dry-run` ada di sini, dan sengaja tidak ada di `push:queue:purge`

Bukan inkonsistensi. Tabel push dibuat oleh PR yang sama dengan job-nya, jadi
run pertamanya punya paling banyak satu jendela retensi di belakangnya. Dua
tabel ini menumpuk sejak `sql/014` **tanpa retensi sama sekali**, jadi run
pertama di deployment hidup adalah delete terbesar yang akan pernah dilakukan
job ini, terhadap baris yang belum pernah dihitung siapa pun.

## Worker mendapat verb yang dulu sengaja ditolak

`sql/022` memberi worker persis yang dibutuhkan **dispatcher** — SELECT/UPDATE
pada messages, INSERT pada attempts — dan tidak lebih. Itu benar: dispatcher
yang bisa DELETE adalah dispatcher yang bisa menghilangkan antrean karena satu
bug. Purge adalah entrypoint worker kedua dengan pekerjaan berbeda, jadi
`sql/095` memberinya DELETE, dan peta hak di `security-readiness.ts` ikut
diperbarui — grant di SQL yang tak diketahui peta itu adalah privilege yang tak
direview apa pun.

Index-nya milik purge sendiri: `awcms_email_messages_dispatch_idx` menutupi
himpunan status yang **berlawanan** (`queued`/`retry_wait`) dan berkunci pada
`next_attempt_at`.
