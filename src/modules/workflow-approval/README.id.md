🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](README.md)

<!-- i18n-source-hash: sha256:041170d005a7b2432a53a62b6dbe894fa00314e9ead901e1c0aa8c9b716c25d1 -->

# Workflow Approval

Implementasi Issue 11.1 (`docs/awcms/06_github_issues_detail.md` §Issue 11.1), yang dikembangkan oleh **Issue #747** (epic `platform-evolution` #738, Gelombang 2) menjadi minimum alur kerja enterprise yang terkelola, berversi, dan berbasis graf — sambil mempertahankan pagar pengaman asli basis: tanpa istilah/aksi bisnis spesifik-domain (basis tidak mengirim cancel POS/ekspor Coretax/transfer gudang), tanpa mesin BPMN eksternal, dan tanpa eksekusi kode runtime di dalam kondisi/aksi (doc 21 §3 pohon keputusan, simpul Q5).

## Apa yang berubah dari Issue 11.1

| Issue 11.1 (linear)                                               | Issue #747 (terkelola, berbasis graf)                                                                                       |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Satu `status: active/inactive` per definisi                       | `version` + `lifecycle_status: draft/active/retired`, riwayat versi penuh, baris published/retired yang immutable           |
| `steps` (daftar jsonb terurut)                                    | `graph` (node/transisi — approval/condition/parallel/join/notify/end)                                                       |
| Tidak ada endpoint publik untuk membuat definisi                  | `POST/PUT/DELETE /workflows/definitions`, `.../publish`, `.../retire`, `.../new-version`, `.../validate`                    |
| `current_step_order` (satu int)                                   | Baris `awcms_workflow_tasks` (satu per node yang diaktifkan) — mendukung banyak node aktif serentak                         |
| Satu penerima tugas implisit (siapa pun yang memanggil keputusan) | `awcms_workflow_task_assignments` — penerima tugas eksplisit, quorum/any/all, pengambil keputusan hasil resolusi delegasi   |
| Tanpa delegasi                                                    | `awcms_workflow_delegations` — bertanggal berlaku, ber-cakupan, beralasan, diaudit, bisa dicabut                            |
| Tanpa eskalasi/timeout                                            | Konfigurasi `escalation` per-node + `bun run workflow:escalations:dispatch`, idempoten lewat konkurensi optimistik          |
| Tanpa pemulihan administratif                                     | Reassign / cancel / force-approve / force-reject, digerbangi izin + `Idempotency-Key` + audit                               |
| `GET /workflows/tasks` (tanpa offset, tanpa filter)               | Berpaginasi keyset, bisa disaring (kunci workflow/tipe sumber daya/status/terlambat), pencarian aman, tampilan riwayat aksi |

## Skema (migrasi `012` + `060`)

Tetap 4 tabel inti yang sama (`awcms_workflow_definitions`/`_instances`/`_tasks`/`_decisions`), dikembangkan di tempat (migrasi `060`), plus 3 tabel baru:

- `awcms_workflow_task_assignments` — pengambil keputusan yang berhak per tugas (penghitungan quorum/any/all, resolusi delegasi, riwayat penugasan ulang — tidak pernah dihapus, hanya `reassigned`).
- `awcms_workflow_delegations` — penugasan pengganti yang bertanggal berlaku.
- `awcms_workflow_join_arrivals` — pembukuan fan-in untuk node `parallel`/`join` (hanya-tambah, idempoten lewat unique constraint).

`awcms_idempotency_keys` (dari migrasi `012`) dipakai ulang tanpa perubahan untuk setiap aksi berisiko-tinggi yang baru di sini.

## Model graf (`domain/workflow-graph.ts`)

Sekumpulan kecil dan tertutup dari tipe node — tidak pernah mesin skrip/ekspresi:

- **`approval`** — satu atau lebih `assigneeTenantUserIds`; `quorumRule` (`all`/`any`/`quorum` dengan `quorumThreshold`) menentukan kapan node selesai. Satu `reject` selalu menyelesaikan node sebagai ditolak, terlepas dari aturannya (nilai bawaan konservatif yang disengaja dan terdokumentasi — lihat `domain/workflow-quorum.ts`). Konfigurasi `escalation` opsional (`timeoutMinutes`, `escalateToTenantUserId`, `maxEscalations`).
- **`condition`** — ATAU sebuah perbandingan terbatas (`factKey`/`operator`/`value`, operator `eq|neq|gt|gte|lt|lte|in`) atas sebuah fakta yang dideklarasikan di `factsSchema` milik definisinya, ATAU sebuah rujukan ke `WorkflowConditionResolver` yang terdaftar secara statis (`resolverName` — lihat di bawah). Tidak pernah keduanya, tidak pernah tak satu pun.
- **`parallel`**/**`join`** — fan-out menjadi 2+ cabang serentak, fan back in setelah setiap cabang tiba di join (`awcms_workflow_join_arrivals`). Parallel/join bersarang **tidak didukung** pada issue ini (lihat §Ditunda).
- **`notify`** — memicu notifikasi lewat capability port `WorkflowNotificationPort` (ADR-0011; adapter di `email`, membungkus `enqueueAnnouncement` tanpa perubahan) dan langsung melanjutkan; tidak pernah memblokir.
- **`end`** — terminal; menetapkan hasil (outcome) instance.

`validateWorkflowGraph` memvalidasi secara struktural setiap rujukan node, batas ambang quorum, kecocokan himpunan cabang parallel/join, dan menolak siklus (DFS) — dijalankan pada setiap penulisan definisi dan lagi saat publish (pertahanan berlapis).

## Resolver/aksi kondisi yang dikontribusikan modul (`_shared/ports/workflow-condition-port.ts`, `infrastructure/condition-action-registry.ts`)

Sebuah registry kode-sumber statis yang sudah ditinjau — mencerminkan `DOMAIN_EVENT_CONSUMERS` milik `domain-event-runtime` secara persis. Mengirimkan satu resolver referensi yang mandiri (`workflow_approval.reference.always_true`) dan satu handler aksi referensi (`workflow_approval.reference.noop`), membuktikan mekanismenya dari ujung ke ujung tanpa mengarang logika bisnis nyata pada issue yang berdampingan dengan fondasi ini (sesuai preseden yang diterima "issue fondasi mengirim nol integrasi bisnis nyata", #643/#742). **Ditunda**: tipe node `action` yang akan memanggil `WorkflowActionHandler` terdaftar di tengah graf belum ada dalam skema node issue ini — registry handler-nya ada dan sudah diuji, tetapi belum ada yang memanggilnya; issue lanjutan akan mengaitkan tipe node nyata kepadanya begitu ada konsumen nyata yang membutuhkannya.

## Penguncian versi

`awcms_workflow_instances.workflow_definition_id` (FK, immutable setelah dipublikasikan) + `workflow_definition_version` yang didenormalisasi mengunci setiap instance ke baris definisi PERSIS yang aktif saat `startWorkflowInstance` berjalan. Karena baris published/active/retired tidak pernah disunting di tempat (`application/workflow-definition-directory.ts` menegakkan penyuntingan hanya-`draft`), setiap pembacaan/kemajuan berikutnya atas instance itu mengambil ulang graf yang identik terlepas dari versi lebih baru yang dipublikasikan sesudahnya.

## Konkurensi & integritas quorum

**Serialisasi keputusan tugas (Issue #140)** — `fetchTaskWithInstanceForDecision` membaca baris tugas dengan `FOR UPDATE OF t`, sehingga semua keputusan serentak pada satu tugas diserialkan dan quorum tidak pernah dievaluasi pada snapshot yang tak bisa melihat keputusan saudaranya yang sedang berlangsung. Pihak yang kalah balapan memblokir pada pengambilan itu lalu membaca ulang baris pemenang yang sudah di-commit, dan itulah yang membuat pemeriksaan `task.status !== 'pending'` yang sudah ada di rutenya menjadi gerbang 409 yang benar. Dipilih ketimbang `pg_advisory_xact_lock` karena kuncinya duduk tepat pada baris yang statusnya adalah invarian itu sendiri, dan karena ia juga saling mengunci dengan penulis-penulis lain baris tersebut (cancel/reassign/force-decision/eskalasi), yang tidak akan dilakukan advisory lock. `OF t` disengaja — `FOR UPDATE` telanjang akan ikut mengunci baris definisi yang di-join dan menyerialkan setiap instance yang berbagi definisi itu.

**Satu kursi hidup per orang per tugas (GHSA-9qwq-cmr5-6wfc)** — partial unique index milik migrasi `018` pada `(workflow_task_id, tenant_user_id) WHERE status IN ('pending','decided')` adalah invarian yang tahan lama; kedua jalur INSERT penugasan (`createApprovalTask`, eskalasi) bersifat `ON CONFLICT DO NOTHING`, dan quorum menghitung `COUNT(DISTINCT tenant_user_id)` (orang), tidak pernah `COUNT(*)` (baris). Tanpa ini, seorang pengguna yang sekaligus penerima tugas dan target eskalasi node itu memegang dua kursi dan bisa memenuhi quorum 2-orang seorang diri. Karena itu menugaskan ulang sebuah tugas kepada orang yang sudah memutuskannya ditolak (`WorkflowRecoveryError`) alih-alih memberinya suara kedua. Baris `reassigned`/`skipped` berada di luar predikat index, sehingga riwayat yang hanya-tambah tidak terpengaruh.

**Gerbang status terminal (Issue #152)** — UPDATE node `end` dikondisikan dengan `AND status = 'pending'` (gerbang yang sama dipakai `cancelWorkflowInstance`) dan di-rollback bila tidak mencocokkan apa pun, sehingga keputusan yang sedang berlangsung tidak pernah bisa menghidupkan kembali instance yang telah dibatalkan.

Tercakup oleh `tests/workflow-approval-concurrency.test.ts`, yang menggerakkan transaksi bertumpang tindih sungguhan terhadap PostgreSQL sungguhan (opt-in lewat `WORKFLOW_TEST_DATABASE_URL`; dilewati bila tidak).

## Delegasi (`domain/workflow-delegation.ts`)

Sebuah delegasi hanya pernah membiarkan penerima delegasi bertindak memakai kedudukan MILIK pemberi delegasi — tidak pernah pemberian izin, tidak pernah lebih lebar dari `workflowKey`/`resourceType`/jendela berlaku yang dideklarasikan baris delegasi itu sendiri. Penolakan persetujuan-diri (`identity-access/domain/access-control.ts`, tanpa perubahan) tetap membandingkan pengguna tenant yang BERTINDAK dengan pemohon asli instance itu — seorang penerima delegasi tidak bisa dipakai untuk menyetujui permintaan yang diajukan pemberi delegasi itu sendiri. Baik pembuatan (`POST /workflows/delegations`) maupun pencabutan (`POST /workflows/delegations/{id}/revoke`) mensyaratkan `Idempotency-Key` dan dicatat lewat `recordAuditEvent` (di samping event domain `workflow.delegation.created`/`.revoked` yang sudah diterbitkan melalui outbox milik `domain_event_runtime` — entri log audit dan event domain adalah dua rekaman berbeda yang dikonsumsi secara independen, bukan hal yang sama). Pencabutan digerbangi izin `workflow.delegation.revoke` (Owner/Manager sesuai matriks RBAC doc 17) — pemeriksaan kepemilikan milik `revokeWorkflowDelegation` (hanya pemberi delegasi asli yang boleh mencabut) tetap ada sebagai pertahanan berlapis di atas gerbang izin itu, bukan sebagai penggantinya (temuan security-auditor, PR #778: izin itu sebelumnya disemai tetapi tidak pernah ditegakkan oleh guard mana pun).

## Eskalasi/timeout (`application/workflow-escalation.ts`, `scripts/workflow-escalations-dispatch.ts`)

Dibangun di atas runner worker bersama (`src/lib/jobs/job-runner.ts`) — batch terbatas, advisory lock, `--dry-run`. **Gerbang idempotensi**: `UPDATE` eskalasi dikondisikan dengan `WHERE status = 'pending' AND escalation_step = <value read this pass>` — balapan yang kalah (jalannya bersamaan, atau lintasan yang diulang) memengaruhi nol baris dan dilewati diam-diam, tidak pernah mengeskalasi ganda. INSERT penugasan target-eskalasi bersifat `ON CONFLICT DO NOTHING` — bila target sudah memegang kursi hidup pada tugas itu (lazimnya: ia juga penerima tugas asli) tak ada yang perlu ditambahkan, dan menambahkan satu akan memberinya suara quorum kedua (lihat §Konkurensi & integritas quorum). Berjalan sebagai role `awcms_worker` dengan privilege terkecil (grant `sql/022`) bila `WORKER_DATABASE_URL` terkonfigurasi, jika tidak memakai fallback `DATABASE_URL` (opt-in).

## Pemulihan administratif (`application/workflow-recovery.ts`)

Reassign (`POST /workflows/tasks/{id}/reassign`), cancel (`POST /workflows/instances/{id}/cancel`), dan force-approve/force-reject (`POST /workflows/tasks/{id}/force-decision`) — masing-masing digerbangi izin (`workflow.recovery.reassign`/`.cancel`/`.force_decide`), wajib beralasan, `Idempotency-Key`, diaudit sepenuhnya (`recordAuditEvent`). Tidak pernah menimpa/menghapus baris keputusan/tugas/penugasan sebelumnya — selalu menambahkan baris baru atau transisi status yang digerbangi.

## Kotak masuk persetujuan terkonsolidasi (`application/workflow-inbox-directory.ts`)

`GET /workflows/tasks` — paginasi keyset (`(created_at, id)`, doc 16 §Pagination keyset), filter (`workflowKey`/`resourceType`/`status`/`overdue`), pencarian terparameter yang aman (ILIKE dengan wildcard yang di-escape, tidak pernah konkatenasi string). `GET /workflows/instances/{id}` — detail instance + riwayat aksi yang immutable, dibangun dengan MEMAKAI ULANG `awcms_workflow_decisions` + `awcms_audit_events` (tanpa tabel riwayat baru).

## Gerbang persetujuan-diri — tetap dipakai ulang, bukan mekanisme baru

`evaluateAccess` (`src/modules/identity-access/domain/access-control.ts`, Issue 2.4) dipanggil tanpa perubahan; rute keputusan tetap mencari `requested_by_tenant_user_id` milik instance SEBELUM guard-nya sehingga perbandingannya memakai nilai yang benar.

**Hubungan dengan pemisahan tugas (Issue #181).** Gerbang persetujuan-diri modul ini adalah maker/checker spesifik yang dirakit tangan atas pemohon instance workflow itu sendiri. Issue #181 menambahkan lapisan SoD GENERIK (`identity-access`, ADR-0031): pasangan izin yang berkonflik `SoDRuleDescriptor` yang terdaftar, ditegakkan fail-closed di `authorizeInTransaction` untuk setiap aksi berisiko-tinggi (termasuk `approve`/`force_decide`/`reassign` milik modul ini), plus alur pengecualian (override) yang terikat cakupan, terikat waktu, dan diaudit. Keduanya saling melengkapi: gerbang persetujuan-diri workflow tetap apa adanya (pemeriksaan pembuat≠penyetuju pada instance yang sama, yang tidak diduplikasi lapisan SoD), sementara aplikasi turunan dapat tambahan mendaftarkan aturan SoD lintas-izin yang ditegakkan chokepoint ini tanpa perubahan apa pun di sini. Catatan (dibawa dari header `high-risk-sod-guard.ts` sendiri): `workflows/tasks/{id}/decisions.ts` (approve) saat ini memanggil `evaluateAccess`/guard-nya sendiri secara langsung alih-alih melewati `authorizeInTransaction`, jadi aturan SoD MASA DEPAN yang menyasar izin workflow akan menuntut pemanggil itu dimigrasikan ke chokepoint bersama — tidak ada celah aktif hari ini (tidak ada aturan basis yang merujuk izin workflow; basis sama sekali tidak mengirim aturan SoD).

## Metrik (`src/lib/observability/metrics-port.ts`)

`workflow_instances_active_total`/`workflow_tasks_overdue_total` (gauge, disampel per lintasan job eskalasi), `workflow_task_decision_duration_ms` (histogram), `workflow_escalation_total`/`workflow_recovery_action_total` (counter) — semuanya tanpa label atau berlabel hanya enum tetap yang didefinisikan di kode (tidak pernah id tenant/sumber daya).

## Admin UI (`/admin/approvals`)

`src/pages/admin/approvals.astro` (ADR-0051) — kotak masuk persetujuan terkonsolidasi: filter (status/kunci workflow/tipe sumber daya/terlambat), pencarian aman, paginasi keyset, approve/reject/reassign/force-decide per-baris, panel riwayat per-instance (`?instance=<id>`) yang membawa aksi cancel, dan buku besar delegasi dengan create/revoke. Setiap kontrol digerbangi izinnya sendiri dan berupa `fetch` sisi-klien sungguhan terhadap endpoint di atas — UI tidak pernah menjadi titik penegakan, hanya lapisan kemudahan kedua yang ketat-lebih-membatasi di atas ABAC sisi-server yang sudah dijaga. Dipakukan oleh `tests/admin-approvals-page-contract.test.ts`.

Cancel tinggal di panel instance alih-alih di baris tugas secara sengaja: membatalkan mengakhiri seluruh instance dan setiap tugas tertunda di bawahnya, jadi menawarkannya di samping satu tugas akan memberi gambaran keliru tentang radius ledakannya.

Sengaja TIDAK dibangun di sini: editor definisi/graf. `POST/PUT /workflows/definitions/**` dilatih oleh pengujian dan bisa dipakai langsung, tetapi menyusun graf node/transisi butuh editor sungguhan — sebuah textarea JSON mentah yang menerima graf cacat sampai panggilan publish menolaknya adalah afordansi yang lebih buruk daripada tidak ada sama sekali. Karena itu keenam izin `definition.*` belum diklaim layar mana pun, dan uji kontraknya menegaskan bahwa izin-izin itu tetap tidak aktif pada layar ini sehingga pemisahan itu tetap menjadi keputusan alih-alih celah.

<!-- historis:mulai -->

> Bagian ini sebelumnya menjelaskan `/admin/workflows` dan `src/pages/admin/workflows/index.astro`. Keduanya tidak pernah ada di repo ini — teksnya ikut terbawa saat port. Karena modulnya tidak mendeklarasikan `navigation`, gerbang registry yang menangkap path menggantung tidak punya apa pun untuk diperiksa; dokumen tidak digerbangi sebagaimana deskriptor digerbangi.

<!-- historis:selesai -->

## Ditunda (secara eksplisit di luar cakupan Issue #747, bukan dibuang diam-diam)

- **`parallel`/`join` bersarang** — sebuah cabang yang memuat node `parallel`-nya sendiri tidak didukung; pelacakan fan-in (`awcms_workflow_join_arrivals`) mengasumsikan satu tingkat bersarang. Kebutuhan nyata akan menuntut disambiguasi id-cabang lintas tingkat bersarang.
- **`any`-join** (melanjutkan begitu SALAH SATU cabang, bukan semua, tiba) — hanya `all`-join yang diimplementasikan; `any`-join hari ini lebih alami dimodelkan dengan mengarahkan tiap cabang secara independen ke node berikutnya yang sama tanpa join sama sekali.
- **Tipe node `action` pada graf** yang memanggil `WorkflowActionHandler` terdaftar — registry/port statisnya ada dan sudah diuji, belum ada tipe node yang memanggilnya.
- **Kait SoD (pemisahan tugas) dari Issue #746** — issue itu (`identity-access` business-scope + SoD) belum di-merge; otorisasi persetujuan-diri/delegasi di sini dirancang agar kait SoD di masa depan bisa dipasang ke `findEligibleAssignment`/`evaluateAccess` tanpa penulisan ulang, tetapi tidak ada yang spesifik-SoD dibangun di sini.
- **Penyetelan kardinalitas metrik penuh per workflowKey/nodeId** — sengaja dijaga tanpa label/berkardinalitas rendah sesuai pagar pengaman Issue #747 sendiri; dasbor masa depan yang menginginkan pemecahan per-workflow akan menuntut tindak lanjut berkardinalitas terbatas (mis. membatasi ke N kunci workflow teratas milik tenant), bukan label tanpa batas.

## Idempotensi

Setiap mutasi berisiko-tinggi di sini (`decisions`, `reassign`, `force-decision`, `publish`, `retire`, `DELETE .../definitions/{id}`, `.../instances/{id}/cancel`, pembuatan `.../delegations`, `.../delegations/{id}/revoke`) mensyaratkan `Idempotency-Key`, memakai penyimpanan generik `awcms_idempotency_keys` yang sama (migrasi `012`) — kunci sama + hash permintaan sama memutar ulang respons tersimpan; kunci sama + hash berbeda -> `409 IDEMPOTENCY_CONFLICT`.

## Temuan security-auditor yang diperbaiki (PR #778, sebelum merge)

- **Pelewatan persetujuan-diri pada `force-decision` (High)** — rutenya mengotorisasi lewat `workflow.recovery.force_decide` tanpa mengisi `resourceAttributes.requestedByTenantUserId`, dan pemeriksaan tolak-persetujuan-diri di `access-control.ts` dipatri hanya untuk aksi `"approve"` — sehingga pemanggil yang mengajukan instance-nya sendiri dan memegang `force_decide` bisa memaksa menyetujui permintaannya sendiri, melewati quorum sepenuhnya. Diperbaiki dengan mencari tugas/instance sebelum guard (pola yang sama dipakai `decisions.ts`) dan memperluas pemeriksaan tolak-persetujuan-diri agar juga mencakup `"force_decide"` (memblokir baik force-approve maupun force-reject atas instance milik sendiri).
- **Entri log audit yang hilang (High)** — `publish`, `retire`, handler `DELETE` definisi, serta pembuatan/pencabutan delegasi tidak memanggil `recordAuditEvent` padahal merupakan mutasi berisiko-tinggi; kelimanya kini memanggilnya. `DELETE .../definitions/{id}` dan kedua endpoint delegasi juga belum menegakkan `Idempotency-Key`; kini ditambahkan.
- **Izin `workflow.delegation.revoke` yang tidak ditegakkan (Low)** — rute pencabutan digerbangi `workflow.delegation.read` dan bersandar semata pada pemeriksaan kepemilikan; izin `revoke` yang disemai (doc 17: Owner/Manager `RCV`) mati. Diperbaiki agar digerbangi `workflow.delegation.revoke`.
- **Grant role worker untuk job eskalasi (privilege terkecil)** — `sql/022` milik basis ini (Issue #163) memberikan `awcms_worker` hanya `SELECT` pada `awcms_workflow_instances` (job eskalasi hanya membacanya; ia menulis `awcms_workflow_tasks`), diverifikasi per-jalur-tulis alih-alih disalin dari mini — menghindari kelebihan-grant `SELECT, UPDATE` yang dikirim migrasi mini sebelumnya sebelum dipangkas.
