---
"awcms": minor
---

feat(access): tangga langganan hanya berjalan TURUN, dan tak pernah menyentuh `awcms_tenants` (ADR-0084, #423)

Gelombang 5 PR 5.2. `evaluateSubscriptionTransition(now, snapshot, policy)` —
murni, tanpa basis data, tanpa jamnya sendiri — plus job
`bun run identity-access:subscription-lifecycle` yang menerapkan apa pun yang
dikembalikannya dan tidak lebih.

**Hanya turun.** `past_due -> active` dan `trialing -> active` adalah peristiwa
PEMBAYARAN, bukan peristiwa jam, jadi keduanya sengaja tak-terwakilkan. Fungsi
yang bisa memulihkan layanan lewat timer adalah fungsi yang memulihkannya saat
timer-nya salah. Diuji sebagai pencarian menyeluruh: nol input yang bisa
dijangkau menghasilkan langkah ke atas.

**Idempoten.** Jangkarnya `current_period_end` — tanggal yang dimiliki SIKLUS
TAGIHAN — bukan "kapan baris ini masuk `past_due`". Job yang terlambat, atau
berjalan dua kali, karena itu tidak bisa memperpanjang tangga dengan menyatakan
ulang awalnya sendiri.

**Rencana TIDAK diikuti di satu tempat, dan alasannya sebuah HAK, bukan
preferensi.** Rencana menutup gelombang ini dengan `suspendTenant` (ADR-0073).
Itu menuntut `UPDATE` pada `awcms_tenants` untuk `awcms_worker`, sementara
`WORKER_ROLE_GRANTS` menuliskan aturan yang akan dilanggarnya — dan
`awcms_tenants` adalah tabel akar TANPA RLS, jadi tak ada policy di antara satu
UPDATE keliru dan setiap tenant di instalasi. Job tagihan yang memegang verba itu
berjarak satu kesalahan aritmetika dari menghentikan seluruh platform, tanpa
pengawasan, tengah malam.

Konsekuensinya tetap tiba lewat gerbang yang dibangun gelombang ini: `suspended`
dan `cancelled` di luar `ENTITLING_SUBSCRIPTION_STATUSES`, jadi plan berhenti
memberi dan setiap modul ber-entitlement menolak di chokepoint. Itu juga jawaban
yang PROPORSIONAL — tagihan tak terbayar merenggut fitur yang berhenti dibayar,
bukan situs publik, login, dan akses data pelanggan.

**Batas blast-radius.** Satu run yang akan memindahkan lebih dari
`MAX_ENTITLEMENT_LOSSES_PER_RUN` tenant KELUAR dari status ber-entitlement tidak
menerapkan satu pun, dan melaporkannya. Ia bukan rate limit melainkan detektor
"ini bug, bukan hari Selasa": atrisi nyata menetes karena periode tagihan
tersebar sepanjang bulan, sementara setiap mode kegagalan yang penting — backfill
buruk, kolom periode disetel massal, skew jam di host worker — tiba sebagai
tebing. Semua-atau-tidak-sama-sekali: menerapkan "25 pertama" dari sebuah cacat
tetaplah menerapkan cacat.

`sql/110` memberi worker persis SELECT dan UPDATE pada
`awcms_tenant_subscriptions`, dan tidak lebih.
