---
name: awcms-workflow-approval
description: Kerjakan bagian mana pun dari modul workflow_approval AWCMS (Issue 11.1 linear engine, evolved Issue #747 epic platform-evolution #738 Wave 2 jadi graph-based managed engine). Gunakan saat menambah node graph baru, delegation/escalation/administrative-recovery, atau condition/action resolver. PR #778 memperbaiki 4 security finding sebelum merge — merangkum invariant yang wajib dipertahankan supaya tidak diregresi.
---

🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](SKILL.md)

<!-- i18n-source-hash: sha256:6ade5d7005ea7e694e820dbb5d82f7026f7d719e334c53c977314239dd293c6b -->

# AWCMS — Workflow Approval Module

`workflow_approval` (`src/modules/workflow-approval`, Issue 11.1 lalu
evolved Issue #747 epic `platform-evolution` #738 Wave 2) adalah **managed,
versioned, graph-based** enterprise workflow minimum — tetap menjaga
guardrail asli base: tidak ada term/aksi bisnis domain-spesifik (base tidak
mengirim POS cancel/Coretax export/warehouse transfer), tidak ada BPMN
engine eksternal, dan tidak ada eksekusi kode runtime di condition/action
(doc 21 §3 decision tree, node Q5). Baca
`src/modules/workflow-approval/README.md` untuk detail lengkap; skill ini
merangkum invariant keamanan yang WAJIB dipertahankan (4 finding PR #778
sudah pernah diregresi sekali, jangan diulang).

## Kapan pakai skill ini vs skill generik

Melengkapi `awcms-abac-guard` (self-approval-deny check yang dipakai
ulang di sini), `awcms-idempotency`, `awcms-audit-log`. Skill ini
menyediakan konteks graph-engine dan invariant keamanan spesifik modul ini.

## Evolusi dari Issue 11.1 (linear) ke Issue #747 (graph-based managed)

| Issue 11.1 (linear)                         | Issue #747 (managed, graph-based)                                          |
| ------------------------------------------- | -------------------------------------------------------------------------- |
| Satu `status: active/inactive` per definisi | `version` + `lifecycle_status: draft/active/retired`, versi immutable      |
| `steps` (jsonb list terurut)                | `graph` (nodes/transitions — approval/condition/parallel/join/notify/end)  |
| Tidak ada endpoint create-definition publik | `POST/PUT/DELETE /workflows/definitions`, `.../publish`, `.../retire`, dst |
| `current_step_order` (satu int)             | `awcms_workflow_tasks` (satu baris per node aktif — multi-node aktif)      |
| Satu assignee implisit                      | `_task_assignments` — quorum/any/all, delegation-resolved deciders         |
| Tidak ada delegation                        | `_delegations` — effective-dated, scoped, reason, audited, revocable       |
| Tidak ada escalation/timeout                | Per-node `escalation` config + `workflow:escalations:dispatch`             |
| Tidak ada administrative recovery           | Reassign/cancel/force-approve/force-reject, permission-gated+audited       |

## Graph model (`domain/workflow-graph.ts`) — set node type TERTUTUP, bukan scripting engine

- **`approval`** — 1+ `assigneeTenantUserIds`; `quorumRule` (`all`/`any`/
  `quorum` + `quorumThreshold`) menentukan kapan node selesai. Satu
  `reject` SELALU menyelesaikan node sebagai rejected, apa pun rule-nya
  (default konservatif yang disengaja, `domain/workflow-quorum.ts`).
  `escalation` config opsional (`timeoutMinutes`,
  `escalateToTenantUserId`, `maxEscalations`).
- **`condition`** — SALAH SATU: perbandingan bounded (`factKey`/
  `operator`/`value`, operator `eq|neq|gt|gte|lt|lte|in`) atas fact yang
  dideklarasikan di `factsSchema` definisi, ATAU referensi ke
  `WorkflowConditionResolver` yang terdaftar statis (`resolverName`).
  Tidak pernah keduanya, tidak pernah tidak ada satu pun.
- **`parallel`**/**`join`** — fan-out 2+ cabang konkuren, fan-in setelah
  SEMUA cabang tiba di join (`awcms_workflow_join_arrivals`). Nested
  parallel/join **TIDAK didukung** (lihat §Deferred).
- **`notify`** — memicu notifikasi lewat capability port
  `WorkflowNotificationPort` (ADR-0011; adapter di `email`, wraps
  `enqueueAnnouncement`) dan langsung lanjut; tidak pernah blocking.
- **`end`** — terminal; set outcome instance.

`validateWorkflowGraph` memvalidasi struktural setiap referensi node,
batas quorum threshold, kecocokan branch-set parallel/join, dan menolak
cycle (DFS) — jalan di SETIAP write definisi DAN lagi saat publish
(defense in depth).

## Version pinning

`awcms_workflow_instances.workflow_definition_id` (FK, immutable
setelah published) + `workflow_definition_version` terdenormalisasi
mem-pin setiap instance ke baris definisi PERSIS yang aktif saat
`startWorkflowInstance` berjalan. Karena baris published/active/retired
tidak pernah diedit di tempat (`application/workflow-definition-directory.ts`
menegakkan editing hanya untuk `draft`), setiap baca/advance instance itu
nanti selalu re-fetch graph yang identik terlepas dari versi baru yang
dipublikasikan setelahnya.

## Delegation (`domain/workflow-delegation.ts`)

Delegation HANYA membiarkan delegate bertindak memakai standing MILIK
delegator — TIDAK PERNAH permission grant, tidak pernah lebih luas dari
`workflowKey`/`resourceType`/window efektif yang dideklarasikan baris
delegation itu sendiri. Self-approval denial (`identity-access/domain/
access-control.ts`, tidak berubah) tetap membandingkan tenant user yang
BERTINDAK terhadap `requested_by_tenant_user_id` instance — delegate TIDAK
BISA dipakai untuk approve request yang delegatornya sendiri ajukan.
Create (`POST /workflows/delegations`) dan revoke
(`POST /workflows/delegations/{id}/revoke`) WAJIB `Idempotency-Key` dan
tercatat lewat `recordAuditEvent` (TAMBAHAN dari domain event
`workflow.delegation.created`/`.revoked` yang sudah dipublikasikan lewat
outbox `domain_event_runtime` — audit log dan domain event adalah DUA
record berbeda, dikonsumsi independen, bukan hal yang sama). Revoke
di-gate pada permission `workflow.delegation.revoke` (Owner/Manager per
doc 17) — ownership check `revokeWorkflowDelegation` (hanya delegator
asli boleh revoke) tetap sebagai defense-in-depth DI ATAS permission gate
itu, bukan pengganti (lihat §Security finding di bawah — ini pernah bug).

## Escalation/timeout (`application/workflow-escalation.ts`)

Dibangun di atas shared worker runner (`src/lib/jobs/job-runner.ts`) —
bounded batch, advisory lock, `--dry-run`. **Idempotency guard**: `UPDATE`
escalation dikondisikan `WHERE status = 'pending' AND escalation_step =
<value dibaca pass ini>` — race yang kalah (run konkuren, atau pass yang
di-retry) mempengaruhi nol baris dan diam-diam di-skip, tidak pernah
escalate dobel. **Role DB-nya**: job ini berjalan sebagai role
least-privilege `awcms_worker`.

> **KOREKSI 15 Agustus 2026 — versi sebelumnya SALAH, dan salahnya ke arah
> yang berbahaya.** Ia menyatakan repo ini "tidak punya role `awcms_worker`",
> bahwa `WORKER_DATABASE_URL` jatuh kembali ke `DATABASE_URL` sehingga
> "pemisahan privilege BELUM ada di sini", dan melarang menulis
> `GRANT ... TO awcms_worker` karena "akan gagal jalan". Keempatnya keliru:
>
> - `awcms_worker` DIBUAT di `sql/022_awcms_db_worker_setup_roles.sql`
>   (Issue #163), bukan tidak ada.
> - Migrasi repo ini memuat **78** pernyataan `GRANT ... TO awcms_worker`
>   yang sudah lama berjalan — larangan itu akan menolak pekerjaan yang benar.
> - Produksi terverifikasi memakai pemisahan itu: `WORKER_DATABASE_URL`
>   menunjuk `awcms_worker`, `DATABASE_URL` menunjuk `awcms_app`.
> - `sql/022` sudah memberi `awcms_workflow_instances` **`SELECT` saja** —
>   yakni persis perbaikan finding #4 PR #778, sudah terpasang di sini.
>
> Arah kesalahannya yang membuatnya mahal: agen yang mempercayainya akan
> MENOLAK menulis GRANT worker dan menjalankan job sebagai role pemilik,
> sehingga menghapus pemisahan privilege yang sudah ada — regresi keamanan
> yang lahir dari dokumentasi, bukan dari kode. Skill `awcms-deploy` sudah
> dikoreksi untuk klaim yang sama; berkas ini terlewat.

Grant worker untuk modul ini hidup di `sql/022` dan `sql/127`, dan
**dijaga gerbang**: `WORKER_ROLE_GRANTS` di `scripts/security-readiness.ts`
menyatakan set yang diharapkan (`awcms_workflow_tasks` `SELECT,UPDATE`;
`awcms_workflow_instances` `SELECT`; `awcms_workflow_definitions` `SELECT`;
`awcms_workflow_task_assignments` `INSERT,SELECT`). Menambah grant tanpa
menambahkannya ke daftar itu akan memerahkan `security:readiness`.

## Administrative recovery (`application/workflow-recovery.ts`)

Reassign (`POST /workflows/tasks/{id}/reassign`), cancel
(`POST /workflows/instances/{id}/cancel`), force-approve/force-reject
(`POST /workflows/tasks/{id}/force-decision`) — masing-masing
permission-gated (`workflow.recovery.reassign`/`.cancel`/`.force_decide`),
reason-required, `Idempotency-Key`, fully audited. Tidak pernah menimpa/
menghapus baris decision/task/assignment sebelumnya — selalu append baris
baru atau transisi status ter-guard.

## CRITICAL — 4 security finding PR #778 (fixed before merge, jangan diregresi)

1. **`force-decision` self-approval bypass (High)** — route mengotorisasi
   lewat `workflow.recovery.force_decide` TANPA mengisi
   `resourceAttributes.requestedByTenantUserId`, dan self-approval-deny
   check `access-control.ts` di-hardwire hanya untuk action `"approve"` —
   sehingga caller yang mengajukan instance-nya SENDIRI dan punya
   `force_decide` bisa force-approve permintaannya sendiri, bypass quorum
   sepenuhnya. Fix: lookup task/instance SEBELUM guard (pola sama
   `decisions.ts`), dan self-approval-deny check diperluas mencakup
   `"force_decide"` juga (blok force-approve DAN force-reject instance
   milik sendiri). **Endpoint recovery baru wajib lookup requester
   SEBELUM guard, mengikuti pola ini.**
2. **Audit log entry hilang (High)** — `publish`, `retire`, handler
   `DELETE` definitions, dan delegation create/revoke tidak memanggil
   `recordAuditEvent` meski mutation high-risk; kelima sekarang
   memanggilnya. `DELETE .../definitions/{id}` dan kedua endpoint
   delegation juga sempat kehilangan enforcement `Idempotency-Key` —
   sekarang ditambahkan.
3. **Permission `workflow.delegation.revoke` tidak ditegakkan (Low)** —
   route revoke di-gate pada `workflow.delegation.read` dan HANYA
   mengandalkan ownership check; permission `revoke` yang sudah diseed
   (doc 17: Owner/Manager `RCV`) jadi dead code. Fix: gate pada
   `workflow.delegation.revoke`.
4. **Worker role escalation-job over-grant (Low)** — di mini, migrasi 060
   memberi `SELECT, UPDATE` di `awcms_workflow_instances` ke
   `awcms_worker`, padahal escalation job hanya pernah `SELECT` dari
   tabel itu. Dipangkas jadi `SELECT`-only.

   **KOREKSI 15 Agustus 2026:** versi sebelumnya menyebut temuan ini
   "vacuous di repo ini" karena katanya role dan migrasinya tidak ada.
   Justru sebaliknya — dan itu kabar baik: `sql/022:145` sudah memberi
   `awcms_workflow_instances` **`SELECT` saja**, jadi bentuk yang benar
   SUDAH terpasang, dan `WORKER_ROLE_GRANTS` di `security-readiness.ts`
   MENJAGANYA tetap begitu. Pelajarannya karena itu berlaku penuh di sini,
   bukan menunggu port: tiap grant worker baru wajib sebesar query yang
   benar-benar dijalankan, dan gerbangnya akan menuntut daftar itu ikut
   diperbarui.

**Pelajaran generik dari keempatnya**: endpoint action baru pada resource
yang punya konsep "pemilik/requester" WAJIB (a) lookup requester SEBELUM
guard supaya self-approval-deny bisa membandingkan, (b) selalu panggil
`recordAuditEvent` untuk mutation high-risk meski "cuma" administrative
action, (c) gate pada permission SPESIFIK-nya sendiri (jangan reuse
permission `.read` yang lebih lemah), (d) worker role grant SELALU
diverifikasi hanya sebesar yang benar-benar dipakai query nyata.

## Deferred (sengaja di luar scope #747, jangan asumsikan sudah ada)

- **Nested `parallel`/`join`** — branch yang punya `parallel` node sendiri
  TIDAK didukung; `awcms_workflow_join_arrivals` asumsikan satu level
  nesting.
- **`any`-join** — hanya `all`-join yang diimplementasikan.
- **Node type `action`** yang memanggil `WorkflowActionHandler` terdaftar
  — registry/port sudah ada dan teruji, tapi belum ada node type yang
  memanggilnya.
- **SoD hooks dari Issue #746** — self-approval/delegation authorization
  di sini didesain supaya hook SoD masa depan bisa plug-in ke
  `findEligibleAssignment`/`evaluateAccess` tanpa rewrite, tapi belum ada
  yang SoD-specific dibangun di sini.
- **Visual definition/graph editor** — `POST/PUT /workflows/definitions/**`
  hanya via API, tidak ada UI authoring graph.

## Idempotency

Setiap mutation high-risk (`decisions`, `reassign`, `force-decision`,
`publish`, `retire`, `DELETE .../definitions/{id}`,
`.../instances/{id}/cancel`, `.../delegations` create,
`.../delegations/{id}/revoke`) wajib `Idempotency-Key`, memakai store
generik `awcms_idempotency_keys` yang sama.

## Pitfall umum

1. Endpoint recovery/decision baru wajib lookup requester/owner SEBELUM
   memanggil `evaluateAccess` — kalau tidak, self-approval-deny check
   tidak punya nilai untuk dibandingkan (lihat finding #1 di atas).
2. Jangan lupa `recordAuditEvent` untuk mutation baru — domain event lewat
   `appendDomainEvent` BUKAN pengganti audit log, keduanya wajib ada.
3. Jangan reuse permission `.read` sebagai gate mutation — selalu bikin
   permission spesifik-aksi (`.revoke`, `.reassign`, dst.).
4. Jangan tambah nested `parallel`/`join` tanpa redesign
   `awcms_workflow_join_arrivals`'s skema fan-in — asumsi satu-level
   nesting tertanam di situ.
5. Jangan tambah kode/expression evaluation ke `condition` node — hanya
   perbandingan bounded atau resolver terdaftar statis, tidak pernah
   `eval`/scripting.

## Verifikasi

Cari `tests/**/workflow*.test.ts` dan `tests/integration/workflow*.integration.test.ts`
untuk test self-approval-deny, quorum, delegation, escalation idempotency,
dan recovery action. Jalankan `bun test` dengan `DATABASE_URL` — `bun run
check` tanpa `DATABASE_URL` melewatkan test integration secara diam-diam.
