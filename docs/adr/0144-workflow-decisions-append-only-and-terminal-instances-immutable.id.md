🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0144-workflow-decisions-append-only-and-terminal-instances-immutable.md)

<!-- i18n-source-hash: sha256:b4125138b99427d1f1d4a2d458429e9ae44fc984fd6c32455e5442352533fa35 -->

<!-- i18n-source-hash: sha256:pending -->

# ADR-0144 — Keputusan workflow bersifat append-only dan instance terminal tak dapat diubah, di database

- **Status:** Diterima
- **Tanggal:** 2026-10-15
- **Pengambil keputusan:** @ahliweb
- **Terkait:** Issue #999 (temuan audit keamanan F2 dari #990); [ADR-0132](0132-hr-payroll-module-family-admission.id.md) (koreksi absensi HR, #947, yang pemisahan tugasnya membaca tabel-tabel ini); `sql/252_awcms_workflow_approval_immutability.sql`; `src/modules/workflow-approval/README.id.md`.

## Konteks

`sql/013` menyebut `awcms_workflow_decisions` "append-only / immutable" tetapi tidak menerbitkan `REVOKE` maupun trigger, jadi klaim itu hanya konvensi. Kode yang berjalan sebagai `awcms_app` di dalam tenant dapat menulis ulang `decided_by_tenant_user_id` atau `on_behalf_of_tenant_user_id` dan mengubah settle yang disetujui-sendiri menjadi bersih, menggagalkan pemisahan tugas tingkat database yang diandalkan koreksi absensi HR dan persetujuan payroll nanti. Audit membuktikannya pada skema nyata.

## Keputusan

1. **Keputusan bersifat append-only.** `awcms_app` kehilangan `UPDATE`, `DELETE`, `TRUNCATE` pada `awcms_workflow_decisions`; trigger `BEFORE UPDATE OR DELETE` menolak keduanya bagi role mana pun yang masih memegang hak itu. `TRUNCATE` dihentikan oleh `REVOKE` saja, bukan trigger: harness tes dan tooling operator men-truncate semua tabel `awcms_` sebagai role berprivilege, seperti di `sql/169`.
2. **Instance tak pernah dihapus dan instance terminal final.** `awcms_app` kehilangan `DELETE`/`TRUNCATE` pada `awcms_workflow_instances`; trigger menolak `DELETE`, menolak setiap `UPDATE` pada baris `approved`/`rejected`/`cancelled`, dan untuk baris pending membekukan identitas, pemohon, resource, versi terpaku, snapshot fakta, dan hanya mengizinkan stempel pembatalan bersama `status = 'cancelled'`. Satu-satunya perpindahan sah adalah dua yang sudah dilakukan engine: `pending -> approved|rejected` (node `end`) dan `pending -> cancelled` (recovery), masing-masing sudah dijaga `AND status = 'pending'`, yang pada instance selesai cocok dengan nol baris, bukan error.
3. **Task final tetap final.** Pemisahan tugas mencapai keputusan sebuah instance lewat `awcms_workflow_tasks.workflow_instance_id`, jadi trigger membekukan kolom instance, node, dan quorum task serta menolak `UPDATE` task `completed`/`skipped`/`cancelled`. Penulisan task yang sah (keputusan menyelesaikan, recovery membatalkan, eskalasi mengubah `escalation_step`/`escalated_at`/`due_at`) semuanya terjadi pada task pending.
4. **Dideklarasikan, bukan diasumsikan.** Verb yang dipersempit didaftarkan di `scripts/security-readiness.ts` agar `checkRuntimeRoleGrants` dapat membedakan "sengaja dipersempit" dari "rusak".
5. **Jalur pemeliharaan.** Sesi superuser boleh keluar dari trigger dengan `SET LOCAL session_replication_role = replica` (purge tenant, fixture tes). Role runtime tidak bisa.

## Konsekuensi

- Tanpa perubahan aplikasi: grep `src/` tidak menemukan `UPDATE`/`DELETE` keputusan maupun `DELETE` instance.
- **Yang tidak ditegakkan (dilacak di #1032):** bahwa instance mencapai `approved`/`rejected` hanya bila keputusannya membenarkan, dan bahwa INSERT keputusan terikat pada task, assignee, dan tenant user yang diklaimnya. ADR ini menutup pengubahan dan penghapusan riwayat, bukan penambahan palsu; "menggagalkan pemisahan tugas" di Konteks tertutup hanya untuk penulisan ulang keputusan yang ada.
- Assignment dan join arrival di luar cakupan (assignment dipensiunkan lewat status).
- Tes yang memalsukan keputusan atau memundurkan tanggal instance kini memakai jalur pemeliharaan.
