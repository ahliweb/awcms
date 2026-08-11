---
"awcms": patch
---

fix(db): purge retensi undangan mendapat GRANT yang tak pernah dibuat `sql/106`

`identity-access/module.ts` mendaftarkan `awcms_invitations` sebagai deskriptor
`dataLifecycle` ber-`executionMode: 'generic'` (retensi 90 hari), sementara
`sql/106` membuat tabelnya dan memberi `awcms_worker` **nol** hak — satu-satunya
kemunculan kata GRANT di berkas itu adalah prosa. Deployment ini menjalankan
peran worker terpisah (`WORKER_DATABASE_URL` menunjuk `awcms_worker`,
`docs/awcms/environments.md`), jadi `sql/108` memberi `SELECT, DELETE`, dan
`WORKER_ROLE_GRANTS` diperbarui di perubahan yang sama supaya matriksnya tidak
menyimpang dari migrasinya.

**Kenapa ini bukan sekadar "purge menghapus nol baris".** `sql/091` mencatat
versi lunak dari kegagalan ini: DELETE yang hilang membuat purge berjalan,
melapor sukses, dan tidak menghapus apa pun. Di sini bahkan BACAnya hilang, dan
`archive-purge-job.ts` tidak punya satu pun blok `catch` — `permission denied`
yang pertama keluar dari loop tenant dan membatalkan SELURUH invocation,
sehingga setiap deskriptor sesudahnya tidak pernah dijangkau. Yang membuatnya
tidur hari ini hanyalah job-nya belum dijadwalkan; penjadwalan pertama adalah
saat ia ditemukan.

Verb-nya diturunkan dari mesinnya, bukan dari analogi: `SELECT` karena subquery
DELETE dan `RETURNING created_at`-nya sama-sama menuntutnya (dan
`planLifecycleDryRun` menghitung baris), `DELETE` karena purge menghapus. Tanpa
INSERT dan UPDATE — worker yang bisa menulis di sini bisa mengalamatkan tawaran
keanggotaan ke mailbox mana pun atau merotasi `token_hash` ke nilai pilihannya.
`awcms_invitation_policies` sengaja tidak diberi apa-apa: barisnya ikut induknya
lewat `ON DELETE CASCADE`, dan aksi referensial dijalankan dengan hak pemilik
constraint, bukan hak peran yang menghapus.

**Test yang MEMATOK cacat ini dibalik.** `tests/invitation-contract.test.ts`
menyatakan "no GRANT to awcms_worker or awcms_setup" di bawah komentar "neither
the worker nor the setup wizard touches these tables" — keliru secara faktual
sejak hari ia ditulis. Kini berkas itu menuntut grant-nya ADA (di `sql/108`,
karena migrasi terapan tidak boleh disunting), menuntut deskriptornya memang
`generic`/`hard_delete`, dan menuntut worker TIDAK mendapat INSERT/UPDATE.

**Plus: `bun run security:readiness` berhenti gagal pada deployment sehat.**
Detektor hardcoded-secret melaporkan **11 false positive** (exit 1) dalam tiga
bentuk — tipe union literal string, konstanta ber-akhiran
`_PREFIX`/`_HEADER`/`_ACTION` yang menamai label wire alih-alih memegang
kredensial, dan template literal ber-interpolasi. Ketiganya dikecualikan secara
sempit dan terpisah: union dikenali dari `|` + literal berikutnya (yang tidak
punya arti sebagai NILAI), dua lainnya menuntut NAMA dan NILAI sama-sama
cocok, mengikuti bentuk pengecualian `_ENV` yang sudah ada. Dibuktikan tetap
tajam dengan menanam kredensial sungguhan lalu mencabutnya: `sk_live_...`,
`AKIAIOSFODNN7EXAMPLE` di dalam backtick tanpa interpolasi, JWT di balik nama
ber-akhiran `_HEADER`, dan base64 di balik `_ACTION` semuanya tetap memerah.
Klaim komentar "no such case exists in this repo today" diperbaiki, karena
sebelas kasusnya ada.
