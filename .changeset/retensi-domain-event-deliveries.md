---
"awcms": minor
---

feat(domain-events): buku pengiriman keluar dari ledger retensi — tiga predikat, dan `dead_letter` bukan salah satunya

`awcms_domain_event_deliveries` mendapat deskriptor `dataLifecycle`, job
`bun run domain-events:deliveries:purge`, dan barisnya dihapus dari
`TABLES_PREDATING_THE_RULE`. Ini purge terdelegasi ketiga di repo ini, dan
satu-satunya yang butuh lebih dari satu predikat di luar cutoff.

## `dead_letter` dikecualikan, dan itu jebakannya

Ia **terlihat** terminal — dispatcher tak akan pernah mencobanya lagi sendiri —
dan ia justru baris yang dibuka operator di `/admin/domain-events` untuk
di-replay. Jendela retensi yang menyapunya akan menghapus **pekerjaan beserta
buktinya**, dan penghapusannya tak bisa dibedakan dari antrean yang terkuras
bersih. Hanya `delivered` dan `skipped` yang settled.

## Dua predikat lagi, dan keduanya soal foreign key

`awcms_domain_event_replays` membawa **dua** FK NOT NULL ke tabel ini —
`original_delivery_id` dan `replay_delivery_id`. Menghapus salah satu sisinya
gagal pada constraint, dan purge yang setengah berhasil tiap malam lebih buruk
daripada yang tak pernah jalan: error-nya intermiten dan backlog tetap tumbuh.
Baris replay itu sendiri adalah catatan audit tindakan manual operator, jadi
jawabannya adalah **melewati** delivery-nya, bukan melebarkan delete.

`replay_of_delivery_id` adalah **self-FK**: satu percobaan replay adalah baris
baru yang menunjuk balik ke aslinya. Constraint yang sama, perlakuan yang sama.

Keduanya `NOT EXISTS` di dalam statement yang sama, bukan join dengan round-trip
kedua — baris yang menjadi tereferensi antara SELECT dan DELETE tidak terhapus,
karena tak ada jendela di antara keduanya.

## Index-nya parsial, dan index terdekat yang ada tidak berguna

`awcms_domain_event_deliveries_tenant_status_idx` adalah `(tenant_id, status)`
**tanpa kolom waktu sama sekali**. Pada tabel yang seluruh masalahnya adalah
baris `delivered` menumpuk, itu berarti membaca setiap baris delivered di tenant
untuk menemukan yang lama. `sql/097` menambah `(tenant_id, updated_at)` PARSIAL
pada dua status yang bisa dipurge — jalur panas dispatcher adalah
`status = 'pending'`, yang tak punya alasan menumpang index ini.

## Yang sengaja TIDAK dicakup

`awcms_domain_events` — induknya, yang menyimpan payload — **tetap di ledger**.
Menghapus delivery tidak mengecilkannya, dan berapa lama sebuah PAYLOAD layak
disimpan adalah pertanyaan berbeda dari berapa lama sebuah TANDA TERIMA layak
disimpan: yang pertama catatan bisnis yang di-replay hal lain, yang kedua
pembukuan transport. Mengklaim keduanya dalam satu PR berarti menjawab yang
mudah dan mengubur yang sulit.
