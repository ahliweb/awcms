---
"awcms": minor
---

feat(logging): atribusi dua sisi, dan catatan kelahiran yang akhirnya bisa ditulis (ADR-0091, #423)

Gelombang 8 PR 8.3, `sql/118`.

KEPUTUSAN ADR-0090 YANG MEMBUAT SEGALANYA BEKERJA TANPA PERUBAHAN JUGA MEMBUAT
SATU HAL BERHENTI BEKERJA. Aktor terdelegasi adalah tenant user sungguhan —
itulah yang membuat RLS, SoD, dan business-scope facts tidak perlu diubah — dan
akibatnya `actor_tenant_user_id` pada baris audit menunjuk keanggotaan yang
sempurna biasa. Tidak ada apa pun padanya yang mengatakan orang di baliknya
bekerja untuk organisasi lain, sehingga pertanyaan "apa saja yang dilakukan
vendor kami di dalam sistem kami" tidak punya query: setiap barisnya tampak
seperti baris karyawan. Tiga kolom menutupnya —
`awcms_audit_events.actor_tenant_id`, `awcms_audit_events.delegated_grant_id`,
dan `awcms_abac_decision_logs.delegated_grant_id`.

NULL BERARTI "DARI DALAM", BUKAN "TIDAK DIKETAHUI". Menulis `actor_tenant_id`
pada setiap baris akan menduplikasi `tenant_id` pada 99,9% baris, dan kolom yang
hampir selalu sama dengan tetangganya berhenti dibaca — yang justru saat itulah
satu baris tempat ia berbeda lewat tanpa terlihat. Bentuknya bukan penemuan
baru: `awcms_tenant_status_transitions.actor_tenant_id` (`sql/092`) memakainya
sejak ADR-0054. TIDAK ADA BACKFILL, dan itu keputusan: baris lama ditulis
sebelum akses terdelegasi ada, jadi NULL pada semuanya sudah BENAR, dan
mengisinya dengan `tenant_id` akan mengubah setiap baris lama menjadi klaim yang
kebetulan benar sekaligus menghapus perbedaan yang menjadi seluruh guna kolom
ini.

FK GRANT-NYA KOMPOSIT, DAN ITU BUKAN GAYA. FK sederhana pada `id` saja melewati
RLS — seperti setiap FK — dan akan menerima id grant milik tenant lain: sebuah
baris audit yang menyebut grant yang tidak pernah menjangkau tenant ini.
Tuntutan yang sama menghasilkan FK komposit office di #149. CHECK pasangannya
menutup setengah-jawaban: sebuah baris tidak boleh menyebut grant tanpa menyebut
tenant asalnya.

DECISION LOG SENGAJA TIDAK MENDAPAT `actor_tenant_id`. Ia ditulis chokepoint
pada jalur panas SETIAP request atas tabel terbesar di repo ini (ADR-0072), dan
tenant asal dapat diturunkan dari grant lewat satu join yang hanya dijalankan
investigasi. Menyimpan keduanya berarti menulis dua kolom per request untuk
menghindari satu join yang dijalankan beberapa kali setahun. Alasan yang sama
membuat ketiga index-nya PARSIAL: kolomnya NULL pada hampir setiap baris.

GRANT ID DIRESOLUSI QUERY KEDUA, BUKAN JOIN. `resolveDelegatedGrantId` berhenti
lebih awal bila `principal_kind` bukan `delegated`; menjoinkan tabel grant ke
query autentikasi akan membuat setiap request BIASA membayar index probe supaya
request yang jarang menghemat satu round trip. Resolusinya fail-quiet, dan itu
aman justru karena sifat kolomnya: id grant adalah ATRIBUSI, bukan input
otorisasi. Tidak ada yang diizinkan atau ditolak karenanya, jadi yang hilang
bila ia tidak ketemu adalah satu kolom pada baris audit — tidak pernah sebuah
keputusan.

TINDAK LANJUT TERBUKA ADR-0054 DITUTUP: "tenant yang dibuat tidak melihat
catatan kelahirannya sendiri". Ia terbuka karena TAMPAK mustahil, dan tampak
mustahil karena alasan yang benar — `awcms_audit_events` FORCE RLS, jadi tenant
platform tidak bisa menyisipkan baris ber-`tenant_id` tenant lain, dinding yang
sama yang menjatuhkan rencana ADR-0087 dan ADR-0088. Yang membuatnya bisa adalah
sesuatu yang sudah ada dan tidak diperhatikan siapa pun: `createTenantWithOwner`
SUDAH BERDIRI di dalam konteks tenant baru — ia `SET LOCAL` di awal dan
memulihkannya di akhir. Barisnya ditulis dari DALAM, di jendela yang sudah ada,
tanpa satu pun penulisan lintas-tenant. Yang membedakan kasus ini dari tiga PR
sebelumnya bukan aturan baru melainkan DI MANA kodenya kebetulan berdiri, dan
itulah kenapa ia masuk ADR alih-alih commit diam-diam. `actor_tenant_user_id`
operator sengaja tidak ikut menyeberang: ia uuid buram yang pelanggan tidak bisa
resolusi (RLS menghalangi mereka membaca `awcms_tenant_users` platform)
sekaligus tetap identifier yang diserahkan ke pihak ketiga.

DIVERIFIKASI DENGAN MENJALANKAN. 118 migrasi dari nol pada Postgres 16 nyata; 10
asersi, termasuk satu yang benar-benar MEM-PROVISION tenant lalu membaca log
tenant itu sendiri dan menemukan tepat satu baris `create` ber-`actor_tenant_id`
platform dan `actor_tenant_user_id` NULL. Dua mutasi memerahkan test yang tepat:
menghilangkan atribusi dari satu panggilan `recordDecisionLog`, dan memindahkan
catatan kelahiran ke SESUDAH pemulihan konteks tenant.

Inert bagi deployment yang belum memakai akses terdelegasi: NULL di mana-mana,
tidak ada perilaku yang berubah, dan satu baris audit baru saat provisioning.
