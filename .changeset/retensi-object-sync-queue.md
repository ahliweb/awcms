---
"awcms": minor
---

feat(sync): antrean upload objek keluar dari ledger utang retensi — dan tabel di sebelahnya ternyata tak punya produsen

`awcms_object_sync_queue` mendapat deskriptor `dataLifecycle`, job
`bun run sync:objects:purge`, dan barisnya dihapus dari
`TABLES_PREDATING_THE_RULE`.

`delegated`, bukan `generic`, dengan alasan yang sama seperti dua antrean
sebelumnya: `HighVolumeTableDescriptor` tak punya predikat status, jadi executor
generik menghapus murni berdasarkan umur. Diarahkan ke antrean ini ia menghapus
**upload yang belum terjadi** — termasuk baris `sending`, yang diklaim satu pass
dispatcher dan lease-nya (`next_retry_at`) satu-satunya yang memulihkannya bila
pass itu mati.

## Kursornya `created_at`, dan itu dipaksa skema bukan dipilih

Antrean email dan push menyapu pada `updated_at` — saat baris berhenti bergerak.
Tabel ini tidak punya kolom itu. `uploaded_at` terlihat seperti pengganti yang
tepat dan justru salah: ia **NULL untuk setiap baris `failed`**, jadi kursor di
atasnya membuat kegagalan abadi — satu kelas baris yang paling ingin dibatasi
operator. Konsekuensinya ditulis, bukan dibiarkan disangka kelalaian: baris yang
retry seminggu diukur dari sebelum percobaan terakhirnya.

## Tanpa index baru, dan itu kebalikan kasus email

`awcms_object_sync_queue_tenant_status_created_idx` (`sql/012`) sudah persis
bentuk jalur purge. Ia dideklarasikan DESC, yang tak berbiaya — PostgreSQL
membaca btree mundur, jadi scan menaik tak butuh sort. Bandingkan dengan
`sql/095`, di mana index dispatcher menutupi himpunan status **berlawanan** dan
index baru memang harus ditambah.

## Temuan: `awcms_sync_outbox` punya NOL produsen

Tabel kedua modul ini di ledger **tetap di sana**, dan itu keputusan, bukan
kelalaian. Tak ada yang meng-INSERT ke dalamnya — bukan kode aplikasi, bukan
trigger, bukan migrasi mana pun. Satu-satunya rujukannya adalah
`POST /api/v1/sync/pull`, yang hanya SELECT; artinya endpoint itu **tak pernah
bisa mengembalikan apa pun selain daftar event kosong**, sementara README modul
menggambarkannya sebagai "local events available to be pulled by other nodes".

Deskriptor retensi untuknya akan menjadi fiksi dua kali: predikat status
terminal yang tak akan pernah cocok (tak ada yang menyetel status karena tak ada
yang menulis baris), pada tabel yang tak bisa tumbuh. Dan lebih buruk — ia akan
mengeluarkan tabel itu dari ledger, yaitu dari pandangan siapa pun.

Ketiadaan itu **diasersikan**, bukan dikomentari: test memindai seluruh `src/`
dan `sql/` untuk INSERT/UPDATE ke tabel itu. Kalau seseorang memasang
produsennya, test merah — dan merahnya adalah sinyal bahwa tabel itu sudah
menjadi antrean sungguhan dan butuh deskriptor sungguhan.
