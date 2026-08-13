---
"awcms": patch
---

fix(email): `ON CONFLICT` butuh SELECT — dispatcher mengirim email lalu gagal mencatatnya

Ditemukan dengan MENGIRIM email sungguhan di produksi, bukan dengan membaca apa pun.
`bun run email:dispatch` mengklaim satu pesan, memanggil Mailketing (surat itu SAMPAI),
lalu mati saat mencatat percobaannya: `permission denied for table
awcms_email_delivery_attempts`.

Kegagalannya lebih buruk dari sekadar error, karena panggilan provider berada DI LUAR
transaksi yang mencatat percobaan: pesannya tetap `sending`, dan re-claim saat lease
kedaluwarsa mengirimnya LAGI. Under-grant di sini adalah loop pengiriman ganda, bukan
antrean yang macet.

`awcms_worker` memegang persis `INSERT` (`sql/022`) + `DELETE` (`sql/095`), sementara
statementnya membawa `ON CONFLICT ON CONSTRAINT … DO NOTHING` — dan PostgreSQL menuntut
**SELECT** pada tabel yang arbiternya harus ia baca. `INSERT` saja adalah privilege yang
benar untuk INSERT biasa dan SALAH untuk statement ini; perbedaan yang tidak terlihat
dari membaca daftar grant, karena daftarnya berkata "worker menulis di sini", dan itu benar.

Tiga tabel worker lain punya bentuk persis sama dan diperbaiki bersamaan sebelum
workload pertamanya tiba: `awcms_domain_event_activity_daily`,
`awcms_reporting_projection_state`, `awcms_workflow_task_assignments`.
`awcms_business_scope_assignment_events` sengaja TIDAK diberi SELECT — tulisannya INSERT
polos tanpa `ON CONFLICT`.

Gerbangnya tidak melihat ini karena `WORKER_ROLE_GRANTS` diuji-drift dua arah terhadap
migrasi: KEDUA sisi berkata `INSERT, DELETE`, jadi keduanya konsisten dan keduanya salah.
Matriks itu menjawab "apakah grant cocok dengan yang kita tulis", tidak pernah "apakah
statement yang benar-benar dikirim kode bisa dieksekusi".
