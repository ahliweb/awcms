---
"awcms": patch
---

Perbaiki dua bug modul email yang diwarisi dari awcms-mini (Issue #143, #153).

**#143 — lease dispatcher email tidak lagi write-only.** `claimEligibleEntries`
menulis `next_attempt_at = leaseExpiry` sebagai lease klaim, tapi predikat
klaimnya hanya menyaring `status IN ('queued', 'retry_wait')` — baris `sending`
tidak pernah diklaim ulang. Dispatcher yang mati di antara CLAIM dan FINALIZE
meninggalkan pesan `sending` selamanya: semua finalize bersyarat
`status = 'sending'` dan `cancelEmailMessage` menolak status `sending`, jadi
pesan itu tak terkirim, tak bisa dibatalkan, tak bisa di-retry. Predikat klaim
kini menyertakan `OR (status = 'sending' AND next_attempt_at <= now)`, sama
persis dengan dispatcher saudaranya `sync-storage/application/object-dispatch.ts`,
sehingga `EMAIL_DISPATCH_LEASE_MINUTES` benar-benar dibaca. Insert
`awcms_email_delivery_attempts` diberi `ON CONFLICT ... DO NOTHING` pada
constraint `UNIQUE (message_id, attempt_no)`: pass yang mengklaim ulang
menghitung `attempt_no` yang sama, dan `23505` yang tak tertangani akan
membatalkan seluruh batch dispatch.

**#153 — N+1 INSERT pada enqueue announcement.** `enqueueAnnouncement` kini
memakai multi-row INSERT via `unnest` per 500 baris (pola sama dengan batch
insert `awcms_object_sync_queue` di `src/pages/api/v1/sync/objects/index.ts`),
bukan satu INSERT per recipient di dalam satu transaksi HTTP. Target
`tenant`/`role` yang sebelumnya tanpa `LIMIT` kini dibatasi
`ANNOUNCEMENT_MAX_RECIPIENTS` (5000) dengan urutan deterministik; saat cap
tercapai, `enqueueAnnouncement` mengembalikan `truncated: true` dan mencatat log
`warning` `email.announcement.recipients_truncated`. Dispatcher juga men-cache
template per `template_key` dalam satu pass — satu batch 25 pesan announcement
dengan `template_key` sama sebelumnya membuat 25 transaksi berisi 25 query
identik.

Response endpoint announcement bertambah field `truncated` (additive), begitu
juga endpoint preview-nya — keduanya beserta OpenAPI-nya diperbarui. Tanpa itu
pemanggil menerima `200 OK` berisi `recipientCount: 5000` dan tidak punya cara
tahu bahwa sisa audiensnya tidak pernah di-enqueue; `matchedCount` di preview
pun akan diam-diam berarti "maksimal 5000", padahal preview justru dipakai
admin untuk menjawab "berapa yang akan terjangkau?" sebelum mengirim.

Panggilan provider tetap di luar transaksi (ADR-0006), satu panggilan per pesan
— cache template tidak menggabungkan pengiriman.
