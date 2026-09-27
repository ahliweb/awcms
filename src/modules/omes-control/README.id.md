🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](README.md)

<!-- i18n-source-hash: sha256:a1eef93738f8c733b066811b1add27d6c1e2d5a947256c8bdcada9ff8ed6dfda -->

# `omes_control`

API owner/operator AWCMS untuk proyeksi dan operasi aman OMES (ADR-0122, Issue ahliweb/omes#196 dan ahliweb/omes#198). Menyediakan inventori armada server host multi-tenant, tantangan enrollment worker, proyeksi deployment desired-vs-observed, pengajuan operasi aman ber-allowlist, antrean job worker, snapshot health/backup, dan proyeksi audit eksekusi host.

Modul ini **hanya mencatat intent dan merefleksikan evidence**. Ia tidak pernah mengeksekusi apa pun di host: `POST /api/v1/omes/operations` dan `POST /api/v1/omes/backups/{id}/restore` hanya menulis baris `awcms_omes_operation_requests`. Satu-satunya pembaca yang mengubah baris berstatus `approved` menjadi pekerjaan host nyata adalah pull worker milik OMES sendiri (ahliweb/omes#199, di luar cakupan di sini) — AWCMS tidak punya kanal ke host, tidak ada shell, tidak ada SSH, dan tidak pernah membaca state privat Hermes.

## Endpoint dan permission

Setiap endpoint memakai `defineTenantRoute` (`withTenant` + `authorizeInTransaction` + amplop respons kanonik). Default-deny: pemanggil tanpa grant role yang cocok ditolak terlepas dari kepemilikan tenant.

| Endpoint                                               | Permission                   | Catatan                                                                                                                                                                                                                             |
| ------------------------------------------------------ | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/omes/overview`                            | `servers.read`               | Rollup tenant-wide, dihitung langsung — tidak pernah bersumber dari modul `reporting`.                                                                                                                                              |
| `GET /api/v1/omes/servers`                             | `servers.read`               | Keyset-paginated.                                                                                                                                                                                                                   |
| `POST /api/v1/omes/servers`                            | `servers.register`           | Idempotency-Key wajib, rate-limited per aktor, diaudit.                                                                                                                                                                             |
| `GET /api/v1/omes/servers/{id}`                        | `servers.read`               | Termasuk evidence enrollment berupa fingerprint saja, tidak pernah materi kunci mentah.                                                                                                                                             |
| `DELETE /api/v1/omes/servers/{id}`                     | `servers.delete`             | Soft delete (`status = 'decommissioned'`). Idempotency-Key wajib, diaudit.                                                                                                                                                          |
| `POST /api/v1/omes/servers/{id}/enrollment-challenges` | `enrollments.manage`         | Mencetak challenge sekali pakai; nilai mentahnya dikembalikan tepat sekali dan tidak pernah disimpan (sql/158 hanya menyimpan hash sha256-nya). Idempotency-Key wajib, rate-limited, diaudit.                                       |
| `POST .../enrollment-challenges/{workerId}/revoke`     | `enrollments.manage`         | Idempotency-Key wajib, diaudit.                                                                                                                                                                                                     |
| `GET /api/v1/omes/deployments`                         | `deployments.read`           | State desired dan observed adalah field TERPISAH, tidak pernah digabung.                                                                                                                                                            |
| `GET /api/v1/omes/deployments/{id}`                    | `deployments.read`           |                                                                                                                                                                                                                                     |
| `GET /api/v1/omes/operations`                          | `deployments.read`           |                                                                                                                                                                                                                                     |
| `POST /api/v1/omes/operations`                         | Per-operasi — lihat di bawah | Idempotency-Key wajib, rate-limited, diaudit.                                                                                                                                                                                       |
| `GET /api/v1/omes/operations/{id}`                     | `deployments.read`           |                                                                                                                                                                                                                                     |
| `GET /api/v1/omes/jobs`                                | `jobs.read`                  | `target`/`payload`/`result` diredaksi sebagai defense-in-depth.                                                                                                                                                                     |
| `GET /api/v1/omes/jobs/{id}`                           | `jobs.read`                  |                                                                                                                                                                                                                                     |
| `POST /api/v1/omes/jobs/{id}/cancel`                   | `jobs.cancel`                | Hanya job berstatus `queued` yang bisa dibatalkan. Idempotency-Key wajib, diaudit.                                                                                                                                                  |
| `POST /api/v1/omes/jobs/{id}/approve`                  | `jobs.approve`               | Mengantrekan ulang job `failed` untuk dicoba lagi — BUKAN otoritas persetujuan kedua yang independen (operation request yang mendasarinya sudah lolos gerbang operasi-aman atau workflow-approval). Idempotency-Key wajib, diaudit. |
| `GET /api/v1/omes/health`                              | `servers.read`               | Snapshot terbaru per server, atau riwayat keyset-paginated untuk satu `serverId`.                                                                                                                                                   |
| `GET /api/v1/omes/backups`                             | `backups.read`               |                                                                                                                                                                                                                                     |
| `GET /api/v1/omes/backups/{id}`                        | `backups.read`               |                                                                                                                                                                                                                                     |
| `POST /api/v1/omes/backups/{id}/restore`               | `backups.restore`            | Selalu destruktif; lihat di bawah. Idempotency-Key wajib, rate-limited, diaudit critical.                                                                                                                                           |
| `GET /api/v1/omes/audit`                               | `audit.read`                 | Proyeksi evidence eksekusi/rekonsiliasi OMES jarak jauh — berbeda dari `awcms_audit_events` milik API ini sendiri.                                                                                                                  |

## Allowlist operasi aman

`domain/operations.ts`'s `OMES_OPERATION_CODES` (`status`, `preflight`, `start`, `stop`, `restart`, `update`, `backup`, `rollback`) disalin **byte-demi-byte** dari kontrak milik OMES `contracts/control-center/v1/operation-request.schema.json`'s enum `operation` — subset tertutup dari enum `deployment.request` yang lebih luas, yang juga mengizinkan `install`/`configure`/`restore` **hanya untuk pemakaian job-runner langsung**. Modul ini tidak pernah menciptakan nama operasi baru dan tidak pernah memperluas enum tanpa memperbarui fixture kontrak itu terlebih dahulu.

Setiap operasi digerbangi permission-nya sendiri (`OMES_OPERATION_GUARD`, guard sebagai fungsi-dari-body-request sesuai pola yang didokumentasikan `tenant-route.ts`):

- `status`/`preflight` → `deployments.read` (bersifat baca/diagnostik, tidak mengubah state host).
- `start`/`stop`/`restart`/`update`/`backup` → `deployments.operate`.
- `rollback` → `backups.rollback` (permission yang lebih spesifik).

## Operasi destruktif melewati `workflow-approval`, tidak pernah approver kedua

`stop` dan `rollback` (serta `POST .../backups/{id}/restore`, yang sengaja **bukan** bagian dari enum operasi-aman — kontrak OMES mengecualikan `restore` dari pengajuan yang menghadap Control Center) bersifat destruktif. Mengajukan salah satunya memanggil `startWorkflowInstance` terhadap definisi `workflow` (workflow-approval) milik tenant sendiri yang sudah dipublikasikan di bawah kunci `omes_control.destructive_operation`. Tenant tanpa definisi aktif di bawah kunci itu mendapat `409 APPROVAL_WORKFLOW_NOT_CONFIGURED` dan **tidak ada yang disimpan** — tidak pernah jatuh diam-diam ke auto-approval. Keputusan workflow itu sendiri adalah satu-satunya otoritas persetujuan manusia; `omes_control` tidak pernah mengimplementasikan yang kedua.

## Idempotency, rate limiting, redaksi

Setiap mutasi mewajibkan `Idempotency-Key` dan me-replay respons tersimpan pada percobaan ulang dengan key+payload yang sama (penyimpanan bersama `awcms_idempotency_keys`, `modules/_shared/idempotency.ts`) — `409 IDEMPOTENCY_CONFLICT` untuk key yang sama dengan payload berbeda. Registrasi, penerbitan enrollment-challenge, pengajuan operasi, dan restore backup tambahan di-rate-limit per aktor terautentikasi (`checkSharedRateLimit`). Setiap field evidence jsonb (`target`/`payload`/`result`/`parameters`/`desiredState`/`observedState`/`checks`/`manifest`/`evidence`) dilewatkan melalui `redactSensitiveAttributes` sebelum meninggalkan modul ini, sebagai defense-in-depth di atas apa pun yang menulisnya. Setiap endpoint mutasi juga mencatat baris `awcms_audit_events` pada REPLAY (tidak hanya pada mutasi yang benar-benar berjalan), ditandai `idempotencyReplay: true` pada attributes-nya, sehingga percobaan replay oleh aktor kedua tidak pernah tak-terlihat.

**Keterbatasan cakupan yang diketahui**: `awcms_idempotency_keys` di-key dengan `(tenant_id, request_scope, idempotency_key)` — tenant-scoped, bukan actor-scoped. Pengguna tenant mana pun yang mengetahui nilai `Idempotency-Key` pengguna lain untuk key yang masih hidup dapat memicu jalur replay (tidak pernah mutasi kedua, hanya respons tersimpan) dan kini akan muncul di jejak audit sebagai aktor yang me-replay, berbeda dari aktor asli. Apakah idempotency key sebaiknya juga di-scope per-aktor adalah keputusan produk untuk issue lanjutan, tidak diputuskan oleh issue ini — modul ini mewarisi kontrak penyimpanan bersama apa adanya.

## Postur privasi AI dan owner-approval egress (`ahliweb/omes#232`, OMES issue #217)

Mengonsumsi kontrak `ai-privacy-posture-view`/`ai-egress-approval.request`/`.response` milik OMES (`omes:docs/control-center-contracts.md` §2.10, ADR-0029) sehingga sebuah tenant dapat melihat evidence postur privasi AI dan mengatur owner-approval untuk keputusan egress AI `approval_required` — tidak pernah menjadi runtime Hermes/OMES kedua, dan tidak pernah menjadi tempat prompt, transkrip, atau kredensial provider mentah dapat mendarat.

| Endpoint                                        | Permission                   | Catatan                                                                                                             |
| ----------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/omes/ai-privacy/posture`           | `ai_privacy.read`            | Proyeksi postur lintas-armada plus riwayat egress-approval. Freshness/status efektif dihitung ulang saat pembacaan. |
| `POST /api/v1/omes/ai-privacy/egress-approvals` | `ai_privacy.approve`         | Mencatat keputusan approve/deny pemilik. Idempotency-Key wajib, rate-limited, diaudit critical.                     |
| `POST /api/v1/omes/worker/ai-privacy-posture`   | tidak ada (identitas worker) | Session-unauthenticated; autentikasi worker-envelope Ed25519 yang sama dengan `poll`/`result`/`heartbeat`.          |

**Ingestion memakai transport worker yang sudah ada, bukan listener baru.** Worker pull OMES yang terdaftar mengirimkan proyeksi `ai-privacy-posture-view`-nya ke `POST /api/v1/omes/worker/ai-privacy-posture`, diautentikasi oleh chokepoint `verifyWorkerEnvelope` yang sama (`domain/worker-identity.ts`'s `WorkerRoute`, kini termasuk `"ai-privacy-posture"`) yang menjaga `poll`/`result`/`heartbeat`. `tenant_id`/`server_id` terautentikasi milik envelope harus cocok dengan `tenant_id`/`target.server_id` milik proyeksi postur itu sendiri, sehingga worker yang terautentikasi untuk satu tenant/server tidak pernah dapat mengirimkan proyeksi berlabel tenant/server lain. Objek `posture` masuk divalidasi terhadap `ai-privacy-posture-view.schema.json` yang di-vendor sebelum apa pun disimpan; pemeriksaan envelope atau schema yang gagal menjawab `{"status":"rejected"}` netral yang sama (tidak pernah error yang membedakan), sesuai disiplin yang didokumentasikan `worker-envelope-guard.ts`. Satu baris terkini per target `(tenant_id, server_id, deployment_id)` disimpan (`awcms_omes_ai_privacy_posture`, sql/160) — proyeksi baru menggantikan yang sebelumnya, sesuai kerangka kontrak itu sendiri sebagai proyeksi baca, bukan riwayat append-only.

**Freshness dan status dihitung ulang saat pembacaan, tidak pernah dipercaya dari penyimpanan.** `domain/ai-privacy.ts`'s `projectAiPrivacyPosture` mengklasifikasikan ulang `evidenceFreshness` (`fresh`/`stale`/`unknown`) dari `lastVerifiedAt` terhadap `now` pada setiap pembacaan, dan menurunkan `effectiveStatus` menjadi `BLOCKED` setiap kali evidence bukan `fresh`, atau nilai status/destination/classification tidak dikenali lolos, atau `reasonCodes` kosong — evidence usang atau tidak diketahui tidak pernah dirender sebagai sehat, dan armada kosong dilaporkan sebagai "tidak diketahui", tidak pernah "sehat" (`fleetHealthy` milik `fetchAiPrivacyPosture`).

**Klasifikasi RESTRICTED yang mengarah ke tujuan `cloud_sanitized` TIDAK memiliki jalur persetujuan, secara struktural, pada tiga lapisan independen**: (1) `authorizeAiEgressApproval` milik `domain/ai-privacy.ts` menolaknya tanpa syarat berdasarkan nilai, sebelum pernah menyentuh mesin workflow; (2) CHECK constraint milik `awcms_omes_ai_egress_approvals` sendiri (sql/160) membuat penyimpanan kombinasi itu sebagai approvable/approved menjadi tidak mungkin bahkan jika kedua pemeriksaan application-layer entah bagaimana dilewati; (3) layar admin tidak pernah merender kontrol approve untuk pasangan itu. Setiap keputusan `approval_required` lainnya (tiga reason code `AI_EGRESS_APPROVAL_REQUIRED_*` yang sama yang sudah dibatasi persetujuannya oleh `egress_policy.py` milik OMES) dicatat melalui mesin `workflow-approval` yang SAMA yang dipakai setiap aksi destruktif `omes_control` lainnya (`startWorkflowInstance` di bawah workflow key `omes_control.ai_egress_approval`) — tidak pernah menjadi otoritas persetujuan kedua yang paralel. Tenant tanpa definisi workflow aktif di bawah key itu mendapat `409 APPROVAL_WORKFLOW_NOT_CONFIGURED` dan tidak ada yang disimpan sebagai approved/denied-by-workflow; penolakan eksplisit (`approve: false`) atau permintaan yang ditolak secara struktural tetap dicatat (`decision: "denied"`) tanpa pernah memanggil mesin workflow, karena penolakan tidak memerlukan otoritas persetujuan apa pun.

**Tidak ada field prompt/transkrip/kredensial mentah yang dapat mencapai modul ini, secara struktural.** Schema `ai-privacy-posture-view`/`ai-egress-approval.request`/`.response` yang di-vendor bersifat `additionalProperties: false` di semua bagian; `findDisallowedEvidenceKeys` milik `domain/ai-privacy.ts` adalah pemindaian runtime kedua yang independen (atas `latest_decision` saat ingestion) untuk nama field berbentuk konten mentah (`prompt`, `transcript`, `response_text`, `chain_of_thought`, `raw_provider_response`, `credential`, `secret`, `password`, `token`), belt-and-suspenders terhadap kemungkinan pelonggaran schema di masa depan. `justification` pada pengajuan approval adalah catatan operator singkat berbatas (500 karakter), diredaksi sama seperti attribute teks bebas lainnya — batas panjang itu mencegah penempelan transkrip, bukan filter konten itu sendiri.

## Observabilitas orkestrasi Hermes (`ahliweb/omes#246` bagian 2, OMES issue #183, ADR-0028)

Mengonsumsi kontrak v1 milik OMES `hermes-orchestration-tree`/`hermes-orchestration-event` (sudah divendor oleh re-vendor `ahliweb/omes#232`, commit PIN `f200c2012273de4a0e0598c5bf144a5b0ce33eaa` — tidak perlu re-vendor untuk issue ini) agar tenant dapat mengamati status orkestrasi tugas-delegasi/subagent Hermes. Batas ADR-0017, diulang: Hermes memiliki orkestrasi; ini adalah proyeksi observabilitas BACA-SAJA yang dilaporkan oleh worker pull OMES yang terdaftar — tidak ada aksi kontrol di sini yang pernah mencapai agen Hermes, dan tidak ada mesin orkestrasi kedua.

| Endpoint                                              | Permission                   | Catatan                                                                                                  |
| ----------------------------------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/omes/hermes-orchestration/tree`          | `hermes_orchestration.read`  | Snapshot pohon orkestrasi terkini milik tenant. Freshness/rollup status dihitung ulang saat baca.        |
| `GET /api/v1/omes/hermes-orchestration/events`        | `hermes_orchestration.read`  | Peristiwa aliran aktivitas terbaru milik tenant, opsional dipersempit dengan `?session_id=`.             |
| `POST /api/v1/omes/worker/hermes-orchestration-tree`  | tidak ada (identitas worker) | Tidak terautentikasi sesi; autentikasi worker-envelope Ed25519 sama seperti `poll`/`result`/`heartbeat`. |
| `POST /api/v1/omes/worker/hermes-orchestration-event` | tidak ada (identitas worker) | Autentikasi worker-envelope sama; append-only, dideduplikasi dengan kunci idempotensi alami.             |

**Satu snapshot pohon terkini per sesi; log peristiwa append-only yang dideduplikasi.** `awcms_omes_hermes_orchestration_trees` (sql/163) menyimpan SATU baris per `(tenant_id, server_id, session_id)` — snapshot baru untuk sesi yang sama MENGGANTIKAN yang sebelumnya, sesuai kerangka kontrak kabelnya sendiri sebagai proyeksi langsung, bukan riwayat. `awcms_omes_hermes_orchestration_events` bersifat append-only, dideduplikasi pada `(tenant_id, server_id, session_id, subagent_id, event_type, step_number)` sehingga peristiwa yang dikirim ulang (transport outbox worker pull bersifat at-least-once) menjadi no-op, tidak pernah menjadi baris aliran-aktivitas duplikat.

**Freshness dan rollup status-node dihitung ulang saat baca, tidak pernah dipercaya dari penyimpanan** — disiplin yang sama yang didokumentasikan `domain/ai-privacy.ts`. `domain/hermes-orchestration.ts`'s `projectOrchestrationTree` mengklasifikasi ulang `freshness` (`live`/`stale`/`unknown`) dari `generatedAt` terhadap `now` (jendela 120 detik — jauh lebih pendek dari jendela evidence 24 jam AI-privacy, karena ini mencerminkan delegasi yang sedang berjalan, bukan evidence kepatuhan yang tahan lama) dan menghitung ulang `activeCount`/`completedCount`/`failedCount`/depth dari status node yang SEBENARNYA, tidak pernah dari hitungan tersimpan yang dikirim produser. Koneksi yang macet atau peristiwa terminal yang hilang karenanya direkonsiliasi menjadi stale, tidak pernah menjadi penyelesaian yang direkayasa (persyaratan eksplisit issue #183 sendiri).

**Tidak ada bidang prompt/transkrip/argumen-tool mentah yang bisa mencapai modul ini, secara struktural.** Kedua skema yang divendor bersifat `additionalProperties: false` di seluruh bagiannya; `findDisallowedEvidenceKeys` (dipakai ulang apa adanya dari `domain/ai-privacy.ts`) adalah pemindaian runtime independen kedua saat ingest.

**Celah kontrak yang diketahui dan dilaporkan: tidak ada bidang `planner`/`budget` langkah.** Layar "Hermes" pada referensi redesign menampilkan identitas planner/model yang ditugaskan dan batas jumlah langkah di samping goal/status/mulai/jumlah-langkah. Tak satu pun ada di kedua kontrak v1 yang divendor. Berdasarkan keputusan koordinator eksplisit (bukan modul ini merekayasa bentuk), layar Hermes dikirim hanya memakai bidang yang sudah dibawa kontrak dan merender planner/budget-langkah sebagai status eksplisit "tidak dilaporkan" — lihat komentar header `src/pages/admin/omes/hermes.astro` sendiri.

**"Progres Hermes" kini memakai proyeksi progres repositori GitHub yang nyata dan di-poll (`ahliweb/omes#249`, ADR-0030).** Lihat bagian khusus di bawah.

## Progres repositori (`ahliweb/omes#249`, dipecah dari `#246` bagian 2, ADR-0030 di `ahliweb/omes`)

Memakai kontrak v1 `repository-progress-view` milik OMES (divendor pada commit `ahliweb/omes` `7ce1e40937dae990f59a35f0e2a00401f1a19a71`). Sesuai keputusan ADR-0030, **AWCMS sendiri yang melakukan polling ke GitHub REST API** secara terjadwal — bukan worker host OMES, bukan pula daftar statis/manual. GitHub tetap menjadi otoritas tunggal untuk state repositori/issue/milestone; modul ini hanya menyimpan sebuah observasi yang diberi cap `observed_at`.

| Endpoint                                         | Izin                                      | Catatan                                                                                          |
| ------------------------------------------------ | ----------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `GET /api/v1/omes/repository-progress`           | `hermes_orchestration.read` (pakai ulang) | Proyeksi milik tenant, atau status `unconfigured` eksplisit. Freshness dihitung ulang saat baca. |
| `GET /api/v1/omes/repository-progress/config`    | `hermes_orchestration.read` (pakai ulang) | owner/name/`usesToken` tenant saat ini — tak pernah nilai token yang telah diresolusi.           |
| `PUT /api/v1/omes/repository-progress/config`    | `repository_progress.configure` (BARU)    | Mengatur/mengganti repositori yang diobservasi. Wajib `Idempotency-Key`, diaudit.                |
| `DELETE /api/v1/omes/repository-progress/config` | `repository_progress.configure` (BARU)    | Menghapus konfigurasi beserta proyeksi yang ada. Wajib `Idempotency-Key`, diaudit.               |

**Mengapa baca memakai ulang `hermes_orchestration.read` tapi configure adalah izin baru.** Proyeksinya berada di layar yang sama, dan melihatnya adalah preseden "satu izin baca untuk keluarga proyeksi baca-saja yang berkaitan" yang sama dengan `servers.read`/`health` dan ketiga layar bagian 2 `#246` (lihat header `sql/167`). Mengatur repositori MANA yang diobservasi tenant adalah kapabilitas tulis baru yang sungguh-sungguh tanpa preseden untuk dipakai ulang, sehingga mendapat `repository_progress.configure` (sql/167) — operator dengan akses baca saja tetap melihat proyeksinya tapi tidak pernah melihat formulir konfigurasi.

**Konfigurasi dan secret (`sql/166`, `application/repository-progress-config.ts`).** `awcms_omes_repository_progress_config` adalah tabel per-tenant (unik pada `tenant_id`) dengan `FORCE ROW LEVEL SECURITY`, menyimpan `owner`/`name` (divalidasi terhadap charset identifier GitHub, baik di sisi klien maupun server) dan `secret_ref` yang OPSIONAL. `secret_ref` TIDAK PERNAH menyimpan token mentah — untuk v1 satu-satunya bentuk yang diterima (ditegakkan oleh constraint `CHECK` database, bukan sekadar kode aplikasi) adalah `{"store": "env", "key": "OMES_REPOSITORY_PROGRESS_GITHUB_TOKEN"}`, satu nama env var yang tetap dan dapat dipindai secara statis (konvensi yang sama dengan `TENANT_DOMAIN_CLOUDFLARE_*` milik `tenant-domain`), diwajibkan oleh analisis statis `scripts/jobs-env-allowlist.ts` atas pembacaan literal `process.env.NAME` — nama env var pilihan tenant yang dinamis tidak dapat ditemukan dengan cara itu. Repositori publik tidak memerlukan token sama sekali. Ini adalah penyederhanaan v1 yang disengaja: setiap tenant yang memilih polling berautentikasi token berbagi satu token yang disediakan operator, bukan kredensial berbeda per tenant; issue mendatang dapat menambah penyimpanan kredensial per-tenant yang sesungguhnya bila diperlukan.

**Poller (`scripts/omes-repository-progress-poll.ts`, `bun run omes:repository-progress:poll`, setiap 15 menit secara default).** Untuk setiap tenant aktif yang memiliki konfigurasi, membaca konfigurasi tersebut beserta ETag/data proyeksi sebelumnya dalam satu transaksi baca-saja yang singkat, lalu — DI LUAR transaksi database mana pun (aturan repo ini sendiri "jangan pernah memanggil provider eksternal di dalam transaksi") — memanggil GitHub REST API (`milestones?state=all`, `issues?state=all`, pull request dikecualikan) lewat `application/repository-progress-poller.ts`, kemudian menulis hasilnya dalam transaksi singkat kedua (`application/repository-progress-ingestion.ts`). Setiap panggilan HTTP melalui `ssrfSafeFetch` (timeout terbatas, batas ukuran respons, header `User-Agent` yang diwajibkan GitHub) meski host-nya selalu literal `api.github.com`. Conditional request (`If-None-Match` pada halaman pertama tiap resource) berarti polling repositori yang tak berubah tidak menghabiskan kuota rate-limit GitHub tambahan; `403`/`429` dengan header rate-limit mencatat status error `rate_limited` eksplisit, bukan mencoba ulang dalam loop rapat. Kegagalan poll TIDAK PERNAH membuang observasi sukses terakhir — hanya `status`/`last_error_class`/`last_error_at` yang berubah.

**Penurunan `kind` (`domain/repository-progress.ts`'s `deriveIssueKind`)** mencerminkan ADR-0030 persis: `type:epic` → `epic`; `type:feature`/`enhancement` → `feature`; `bug`/`type:bug` → `bug`; `documentation`/`type:documentation` → `docs`; selain itu → `other`. Hanya label, diperiksa dalam urutan prioritas tetap itu — tak pernah disimpulkan dari teks judul/isi.

**Tidak ada isi issue, komentar, atau PII assignee/author, secara struktural.** Fungsi pemetaan `domain/repository-progress.ts` hanya pernah membaca `number`/`title`/`state`/NAMA label/nomor milestone/`html_url`/`updated_at` dari respons GitHub mentah; setiap proyeksi yang dirakit divalidasi terhadap skema `repository-progress-view` yang divendor, `additionalProperties: false` (`assertOmesContract`, fail-closed) sebelum pernah disimpan.

**Ditunda, belum diimplementasikan oleh issue ini:** nilai enum `source: "github_webhook"` yang dicadangkan (ADR-0030 secara eksplisit mencadangkannya untuk optimisasi freshness tambahan di kemudian hari — polling tetap wajib untuk backfill terlepas dari itu); kredensial GitHub yang berbeda per tenant (lihat di atas); token instalasi GitHub App (untuk v1 hanya token bergaya personal-access-token yang didukung, meski jalur kodenya tidak peduli jenis string token yang diberikan).

## Layar admin (`/admin/omes/*`)

Issue ahliweb/omes#200 mengirimkan lima layar pertama (Overview, Servers, Deployments, Operations, Jobs); issue ahliweb/omes#201 (induk #195) menambahkan Health, Backups, dan Audit; issue ahliweb/omes#233 menambahkan yang kesembilan, Enrollments. `status` modul ini adalah `active` (kriteria 1 ADR-0021, preseden `push_delivery` yang sama). Setiap layar adalah lapisan baca/ajukan tipis di atas endpoint-endpoint di atas — tidak ada layar yang mengeksekusi SQL langsung, dan menyembunyikan tombol hanyalah UX: permission setiap layar persis sama dengan permission yang ditegakkan secara independen oleh endpoint-nya.

- **Overview** (`servers.read`/`deployments.read`/`jobs.read`/`backups.read`/`audit.read`, any-of) — rollup armada plus quick-link ke setiap layar lain yang bisa dibaca aktor.
- **Servers** (`servers.read`, `servers.register`, `servers.delete`) — inventori armada dan evidence enrollment/trust per server (hanya fingerprint kunci publik).
- **Deployments** (`deployments.read`) — state desired vs observed, selalu di kolom terpisah.
- **Operations** (per-operation guard) — mengajukan allowlist operasi aman; operasi destruktif tertaut ke `/admin/approvals`.
- **Jobs** (`jobs.read`, `jobs.approve`, `jobs.cancel`) — antrean dispatch worker dengan retry/cancel.
- **Health** (`servers.read`) — snapshot kesehatan terbaru per server, plus riwayat per server. Setiap snapshot beratribusi `omes-host` (laporan pull worker itu sendiri); entri `checks` individual boleh mendeklarasikan `source`-nya sendiri (mis. `hermes`, provider eksternal), ditampilkan sebagai lencananya sendiri. Flag `stale` (dihitung dari `captured_at` milik snapshot itu sendiri, `STALE_HEARTBEAT_THRESHOLD_MS`) ditampilkan BERSAMA `overallStatus`, tidak pernah menggantikannya dengan varian sukses.
- **Backups** (`backups.read`, `backups.restore`) — metadata artefak (kelas pemulihan dari manifest, checksum sha256, ukuran, flag `fresh` terhitung) dan manifest itu sendiri, di-escape, tidak pernah konten backup mentah. Restore adalah satu-satunya mutasi: selalu destruktif, dikecualikan dari allowlist operasi aman, dan melalui mesin `workflow-approval` yang SAMA seperti `stop`/`rollback` — layar ini tidak pernah menjalankan keputusan persetujuan kedua, hanya mengajukan dan menautkan `workflowInstanceId` hasilnya ke `/admin/approvals`.
- **Audit** (`audit.read`) — DUA bagian terpisah berlabel sumber, tidak pernah digabung: peristiwa aktor/aksi control-plane kanonis (`awcms_audit_events` via `listAuditEvents`, dipersempit ke `moduleKey: "omes_control"`) dan proyeksi eksekusi/rekonsiliasi OMES jarak jauh (`awcms_omes_audit_projections` via `fetchAuditProjections`). `/admin/audit-trail` milik `logging.audit_trail.read` tetap menjadi tampilan lintas-modul dari tabel pertama; layar ini adalah pembacaan yang lebih sempit dan bercakupan OMES dari data yang sama, bukan penulis kedua.
- **Enrollments** (`enrollments.manage`) — menerbitkan dan mencabut token enrollment worker, menutup celah yang sengaja dibiarkan terbuka oleh #201. Tidak menambah jalur tulis baru — kedua aksi memanggil endpoint `POST /api/v1/omes/servers/{id}/enrollment-challenges` dan `.../revoke` yang SAMA yang sudah dikirim oleh #198, tidak diubah oleh issue ini. Sisi baca adalah kueri baru lintas-armada, `application/enrollment-directory.ts`'s `fetchEnrollments` — `fetchServerDetail` (Servers) hanya pernah melihat enrollment satu server pada satu waktu. Token yang diterbitkan ditampilkan tepat satu kali, dirender via `show()` milik helper `messageBox` bersama yang hanya memakai `textContent` (tidak pernah `innerHTML`), tidak pernah ditulis ke `localStorage`/`sessionStorage`, tidak pernah dicatat log, dan hilang begitu halaman ditinggalkan atau dimuat ulang. Lihat komentar header layar itu sendiri untuk analisis trade-off lengkap modal-sekali-tampil vs tombol-clipboard vs unduh, termasuk mengapa tombol salin-ke-clipboard sempat dibuat lalu dihapus (mendorong layar tunggal ini melampaui anggaran aset klien repo) demi reveal dalam-halaman biasa yang sudah mapan di `machine-credentials.astro`.
- **AI privacy** (`ai_privacy.read`, `ai_privacy.approve`) — issue ahliweb/omes#232, layar kesepuluh. Dua bagian, tidak pernah digabung: tabel evidence postur (`evidenceFreshness`/`effectiveStatus` selalu ditampilkan, evidence usang/tidak diketahui dirender dengan lencana eksplisit, tidak pernah lencana sehat) dan tabel permintaan persetujuan pemilik untuk egress. Form approve/deny tidak pernah menawarkan kontrol untuk klasifikasi RESTRICTED yang mengarah ke tujuan `cloud_sanitized` — penyembunyian UI di sini hanyalah kesopanan di atas tiga penolakan independen server-side/database yang dijelaskan di atas, bukan batas penegakan itu sendiri. Layar ini tidak memperkenalkan CSS baru miliknya sendiri — ia memakai ulang kelas `styles/admin-screens.css` yang SAMA yang sudah dipakai setiap layar `omes_control` lain (`data-table`, `status-badge`, `admin-section`, …), plus sistem desain terlingkup `.omes-cc` (`styles/omes-control-center.css`, ahliweb/omes#246) yang kini dibungkus oleh setiap layar `/admin/omes/*` lain. Ia tidak mengedit salah satu stylesheet bersama itu.
- **Orkestrasi langsung** (`hermes_orchestration.read`) — issue ahliweb/omes#246 bagian 2, layar kesebelas. Merender pohon manajer → agen → subagent Hermes secara langsung (kedalaman dihitung BFS dari root yang dideklarasikan, dengan filter kedalaman sisi-klien — sekadar tampil/sembunyi DOM, tanpa permintaan tambahan) plus aliran aktivitas yang melakukan polling `GET /api/v1/omes/hermes-orchestration/events` setiap 8 detik dan merender ulang dari daftar otoritatif terkini server (tidak pernah menambal di tempat), mentolerir satu tick yang terlewat atau gangguan transport dengan membiarkan daftar terakhir-diketahui tetap dirender alih-alih mengosongkannya.
- **Hermes** (`hermes_orchestration.read`) — issue ahliweb/omes#246 bagian 2, layar kedua belas. Ringkasan tugas delegasi Hermes yang sedang aktif milik tenant (atau, jika tak ada, yang terakhir dilaporkan): sesi, tujuan, status, waktu mulai, jumlah langkah, dan log terbaru terbatas. Planner/anggaran-langkah dirender sebagai status eksplisit "tidak dilaporkan" — lihat bagian orkestrasi Hermes di atas untuk alasannya.
- **Progres Hermes** (`hermes_orchestration.read`; formulir konfigurasi digerbangi izin BARU `repository_progress.configure`) — issue ahliweb/omes#246 bagian 2, layar ketiga belas; issue ahliweb/omes#249 (ADR-0030) mengganti status kosong "belum diimplementasikan" sebelumnya dengan proyeksi nyata. Merender salah satu dari empat status eksplisit — belum dikonfigurasi, dikonfigurasi-menunggu-poll-pertama, dikonfigurasi-segar, dikonfigurasi-usang/error (data sukses terakhir tetap dipertahankan, tak pernah dibuang) — beserta milestone dengan bar `<progress>` yang aksesibel dan tabel issue (nomor/judul/status/kind/milestone, masing-masing menaut ke GitHub). Lihat bagian Progres repositori di atas.
- **Arsitektur** (`architecture.read`) — issue ahliweb/omes#246 bagian 3, layar keempat belas dan terakhir. Merender plane sebagai lane dan kapabilitas sebagai kartu (lencana implementation-status per kartu), bersumber dari kontrak v1 `architecture-capabilities-view` yang divendorkan — sebuah cuplikan rilis YANG DIPATOK (`contracts/v1/fixtures/architecture-capabilities-view/valid-01-generated.json`, divendorkan ulang dari commit OMES via `bun run contracts:omes:sync`, bukan proyeksi host langsung). Layar ini menyatakan hal itu secara eksplisit dalam id/en dan merender `omes_version`/`omes_commit`/`generated_at` milik cuplikan itu sendiri alih-alih membiarkan pembaca mengasumsikan data langsung. Sebuah izin BARU, `architecture.read` (`sql/165`), menggerbanginya — sengaja bukan pemakaian ulang `hermes_orchestration.read`, karena subjek layar ini (registri arsitektur berlapis lintas-batas OMES/Hermes/Omarchy/AWCMS/penyedia, ADR-0017) tidak tumpang tindih audiens dengan keluarga tugas-delegasi Hermes yang dipakai bersama oleh tiga layar #246 lainnya. Berbeda dari setiap layar `/admin/omes/*` lain, layar ini tidak memiliki tabel database dan tidak memiliki kueri terlingkup-tenant — setiap tenant melihat payload vendor yang identik.

## Sistem desain (`ahliweb/omes#246` bagian 1/3)

9 layar di atas dirender di dalam wrapper `.omes-cc` yang di-scope
(`src/styles/omes-control-center.css`) yang membawanya setara secara visual
dengan referensi redesign OMES Control Panel (`ahliweb/omes`
`omes:redesign/redesign-omes.zip`, `omes:docs/ui-ux-design-system.md`) — palet gelap,
kartu KPI dengan angka monospace dan titik status, serta strip siklus
Bootstrap → Check → Diff → Apply → Verify → Rollback di layar overview. Tidak
ada yang di luar `/admin/omes/*` yang tersentuh: wrapper ini adalah class yang
ditambahkan masing-masing dari 9 halaman di sekitar konten slot
`<AdminLayout>`-nya sendiri, bukan pernah perubahan pada `AdminLayout.astro`,
`tokens.css`, atau komponen bersama mana pun.

**Bagaimana ia menyusun, bukan mengganti.** Setiap class komponen yang sudah
dipakai 9 layar itu — `.stat-card`, `.status-badge`, `.data-table`,
`.admin-panel`, `.quick-link`, `.empty-state`, `.btn*` (semua dari
`admin.css`/`admin-screens.css`) — dipakai ulang tanpa perubahan. `.omes-cc`
meng-override custom property YANG SAMA yang sudah dikonsumsi berkas-berkas
itu (`--color-bg`, `--color-surface`, `--color-text*`, keluarga
`--color-primary`/`-success`/`-warning`/`-danger`/`-info`, `--color-border*`),
di-scope di bawah `.omes-cc` sehingga tidak ada layar admin lain yang
terpengaruh. Public Sans dan JetBrains Mono sudah di-host sendiri untuk
seluruh admin (aturan `@font-face` `tokens.css` ADR-0120) — penambahan ini
TIDAK mengirim berkas font baru dan tidak melebarkan CSP satu origin pun.

**Kontras** — setiap pasangan teks/latar dan aksen/latar di bawah diukur
terhadap luminansi relatif WCAG 2.1 (metode yang sama yang dipakai
`scripts/design-token-contrast-check.ts` untuk tema dasar):

| Pasangan                                                                      | Rasio                | Hasil                                                                                  |
| ----------------------------------------------------------------------------- | -------------------- | -------------------------------------------------------------------------------------- |
| teks `#E6EDF3` di atas canvas `#0B0F13`                                       | 16.28:1              | lolos                                                                                  |
| teks `#E6EDF3` di atas panel `#151A20`                                        | 14.80:1              | lolos                                                                                  |
| teks-muted `#C6D1DA` di atas canvas `#0B0F13`                                 | 12.39:1              | lolos                                                                                  |
| teks-muted `#C6D1DA` di atas panel `#151A20`                                  | 11.27:1              | lolos                                                                                  |
| teks-faint `#8B99A6` di atas canvas `#0B0F13`                                 | 6.60:1               | lolos                                                                                  |
| teks-faint `#8B99A6` di atas panel `#151A20`                                  | 6.00:1               | lolos                                                                                  |
| teks-faint `#8B99A6` di atas surface-2 `#191F26`                              | 5.69:1               | lolos                                                                                  |
| caption dim `#7A8894` di atas panel `#151A20`                                 | 4.81:1               | lolos (pasangan teks paling ketat)                                                     |
| caption dim `#7A8894` di atas surface-2 `#191F26`                             | 4.57:1               | lolos                                                                                  |
| cyan `#5FC8D6` (primary) di atas canvas/panel                                 | 9.82 / 8.93:1        | lolos                                                                                  |
| hijau `#6FD08C` (success) di atas canvas/panel                                | 10.14 / 9.23:1       | lolos                                                                                  |
| amber `#E8B44A` (warning) di atas canvas/panel                                | 10.13 / 9.21:1       | lolos                                                                                  |
| rose `#E9A9A0` (danger) di atas canvas/panel                                  | 9.75 / 8.87:1        | lolos                                                                                  |
| violet `#8B9CF7` (info) di atas canvas/panel                                  | 7.51 / 6.83:1        | lolos                                                                                  |
| canvas `#0B0F13` di atas isian solid cyan/hijau/amber/rose                    | 9.75–10.14:1         | lolos (gelap-di-atas-isian-terang, bukan putih-di-atas-isian)                          |
| border-strong `#6A7683` di atas canvas/panel/surface-2 (WCAG 1.4.11, kontrol) | 4.15 / 3.78 / 3.58:1 | lolos (≥3:1)                                                                           |
| border `#242C35` (hairline dekoratif kartu/tabel)                             | 1.24–1.36:1          | bukan 3:1 — disengaja, mengikuti pembedaan dekoratif-vs-kontrol milik ADR-0120 sendiri |

Derivasi lengkapnya (termasuk mengapa hue aksen memakai foreground gelap,
bukan putih, di atas isian solid) ada di komentar header
`omes-control-center.css` sendiri.

**Anggaran aset.** `APP_BUDGET_BYTES` milik `scripts/client-asset-budget.ts`
naik dari 226.000 → 229.500 B — terukur, +3.171 B untuk
`src/styles/omes-control-center.css` (satu-satunya berkas baru), diimpor
hanya oleh 9 layar ini. Lihat docblock konstanta itu sendiri untuk
pengukuran before/after lengkap. Tidak ada perubahan anggaran font: tidak ada
`@font-face` baru, tidak ada `.woff2` baru.

**Catatan cakupan.** Ini mengirimkan bagian 1 dari `ahliweb/omes#246` (hanya
sistem desain). 4 layar yang belum ada (Hermes, Orkestrasi langsung,
Arsitektur, Progres Hermes) dan proyeksi baru apa pun yang dibutuhkannya
adalah PR lanjutan yang terpisah — perubahan ini tidak menambah layar baru,
endpoint baru, atau perubahan skema/kontrak.

### Penghalusan sistem desain (`ahliweb/omes#246` bagian 1b)

Tinjauan tangkapan layar atas bagian 1 menemukan 5 cacat, semuanya diperbaiki
dalam satu PR di 9 layar yang sama:

1. **Tile bernilai-jamak.** 4 tile ringkasan di layar overview (distribusi
   kesehatan server, ringkasan status job, kesegaran backup, drift deployment)
   me-render setiap bagian lewat gaya `.stat-value` mono 32px yang sama
   seperti KPI satu-angka sungguhan, melipat jadi 2-3 baris pada 1440px dan
   lebih buruk di bawahnya. Kini keduanya di-render sebagai
   `.omes-stat-breakdown`, daftar chip nilai+label yang melipat dan ringkas
   pada ukuran teks isi. `.stat-value` lain mana pun di 9 layar tetap satu
   angka dan tidak terpengaruh.
2. **Kontrol form.** 8 form filter/create (daftarkan-server, dan bilah filter
   tiap layar daftar) memakai `.admin-toolbar` polos dengan markup sibling
   `<label>`/`<input>` — tanpa kartu, tanpa gaya input/select, popup
   `<select>` bawaan terang berbenturan dengan halaman gelap ini, dan label
   duduk terpisah dari kontrolnya. Kini keduanya memakai `.admin-create-form`,
   kosakata yang SAMA dipakai ~18 layar daftar admin lain (`admin.css`), yang
   sudah mengonsumsi token yang di-override `.omes-cc` — jadi ini perbaikan
   markup, bukan komponen baru, dan tidak memperkenalkan **pasangan warna
   baru** (lihat tabel kontras di atas; pasangannya adalah yang sudah diukur
   di sana). `omes-control-center.css` hanya menambah state yang belum
   didefinisikan `.admin-create-form` sendiri: cincin fokus yang lebih kuat
   (WCAG 1.4.11), warna placeholder, dan state disabled — semuanya memakai
   token yang sudah ada.
3. **Lipatan strip lifecycle.** Pemisah `→` antar pil lifecycle dulu adalah
   `::before` berposisi absolut pada pil BERIKUTNYA, sehingga lipatan baris
   flex-wrap memindahkan pil tapi menyisakan panah sebatang kara di awal baris
   baru. Diperbaiki dengan menjadikan tiap pil + panah pengekornya satu item
   flex atomik, dengan panah sebagai `::after` polos di dalamnya — pasangan
   itu selalu melipat bersama. Diverifikasi pada 360/390/1440px.
4. **Tepi/gutter panel pada 1440px.** Margin negatif `.omes-cc` (yang
   membocorkan latar gelap ke padding `.admin-page-body`) punya dua bug: (a)
   `clamp()` horizontalnya dinegasikan dengan batas min/maks dalam urutan
   yang salah, yang meresolusi ke konstanta −16px alih-alih mengikuti
   viewport, menyisakan strip terang 18px di tepi kanan di atas ~1133px
   lebar; (b) `min-height: 100%` meresolusi terhadap content box parent
   (tanpa padding-nya), jadi pada layar pendek panel jatuh 66px lebih pendek
   dari tepi bawah sungguhan parent, menyisakan strip terang di bawahnya.
   Keduanya diperbaiki — lihat komentar `omes-control-center.css` sendiri
   untuk matematika lengkapnya. Judul/deskripsi halaman tetap di admin shell
   terang alih-alih dipindah ke panel gelap: itu adalah chrome bersama
   (bilah breadcrumb/judul milik `AdminLayout`) yang dipakai setiap layar
   admin, dan menduplikasi render itu per-layar akan memecah pola untuk
   perbaikan yang sebenarnya soal tepi panel, bukan penempatan header.
5. **Kliping sidebar pada 1440px**, diangkat tinjauan yang sama: tidak
   diperbaiki di sini. `.omes-cc` secara arsitektural tidak mungkin jadi
   penyebabnya — ia adalah kelas yang di-scope ke sebuah `<div>` di dalam
   `.admin-page-body`, subtree sibling dari `.admin-sidebar`; override
   token-nya adalah custom property, yang hanya mengalir ke descendant-nya
   sendiri, tidak pernah menyamping ke sidebar, dan ia tidak menyentuh
   berkas mana pun tempat CSS sidebar sendiri (`admin.css`) atau markup-nya
   (`AdminLayout.astro`) didefinisikan. Percobaan reproduksi interaktif
   terhadap `0d6c0dfe` (komit tepat sebelum bagian 1) maupun branch ini —
   men-toggle kontrol collapse pada beberapa titik progres transisi, dan
   men-screenshot segera setelah navigasi sebelum font/CSS menetap —
   me-render sidebar sepenuhnya terbuka dan terbaca pada keduanya; state
   terklip persis dari tangkapan layar tinjauan tidak bisa direproduksi
   lewat interaksi normal di lingkungan ini. Diajukan sebagai issue
   `ahliweb/awcms` tersendiri dengan bukti asli dan percobaan reproduksinya,
   alih-alih ditebak atau dilipat ke PR terlingkup ini (lihat deskripsi PR
   itu untuk nomor issue-nya).

`APP_BUDGET_BYTES` naik 229.500 → 230.400 B untuk CSS yang ditambahkan
penghalusan ini (daftar chip tile bernilai-jamak, perbaikan lipatan
lifecycle, dan state kontrol form di atas) — terukur +1.109 B setelah
dipangkas. Lihat docblock `scripts/client-asset-budget.ts` sendiri untuk
pembukuan before/after lengkap.

## Enrollment, poll, result, dan heartbeat worker (`ahliweb/omes#199`)

Empat rute melengkapi perjalanan pulang-pergi yang sudah disebut di header #198 sendiri: `POST /api/v1/omes/worker/{enroll,poll,result,heartbeat}`. Keempatnya **tidak terautentikasi sesi** — pemanggilnya adalah pull worker host OMES (arsitektur outbound-pull ADR-0027), bukan pengguna AWCMS, jadi tidak ada cookie/token sesi untuk diperiksa. Ini adalah permukaan berisiko tertinggi yang diterbitkan modul ini, dan diautentikasi dengan identitas Ed25519 asimetris sebagai gantinya:

- **Enroll** menukarkan challenge sekali pakai berumur pendek yang dicetak `POST .../enrollment-challenges` milik #198, mewajibkan pemanggil membuktikan kepemilikan private key yang cocok dengan public key yang disajikan (signature atas challenge mentah, `X-Omes-Enrollment-Signature`) sebelum baris challenge itu tersentuh sama sekali. Penukaran adalah compare-and-set level-DB sungguhan (`SELECT ... FOR UPDATE` lalu `UPDATE` pada baris terkunci yang sama di transaksi yang sama, di `application/worker-enrollment-exchange.ts`) — bukan race baca-lalu-tulis di kode aplikasi.
- **Poll**/**result**/**heartbeat** memverifikasi signature atas string kanonik yang mengikat method/path/tenant/server/worker/timestamp/nonce/hash-body (`domain/worker-identity.ts`) terhadap public key tersimpan milik worker yang sudah enrolled, dengan penyimpanan nonce/replay yang atomik dan persisten (`awcms_omes_worker_nonces`, sql/159) serta jendela timestamp terbatas. `application/worker-envelope-guard.ts`'s `verifyWorkerEnvelope` adalah satu-satunya chokepoint yang dipanggil ketiganya sebelum pekerjaan ber-efek-samping lain (disiplin ADR-0063 "otorisasi harus berjalan sebelum handler bekerja", diterapkan pada model identitas yang tidak punya sesi untuk digerbangi).
- **Poll** juga mempromosikan paling banyak satu baris `awcms_omes_operation_requests` berstatus `approved` per tenant/server menjadi baris `awcms_omes_jobs` yang diantrekan (`application/worker-job-queue.ts`, `FOR UPDATE SKIP LOCKED`) — #198 meninggalkan operation request di `approved` dan tidak pernah membuat baris job sendiri — lalu menyewakan job terlama yang diantrekan kepada worker yang polling, juga lewat `FOR UPDATE SKIP LOCKED` sehingga dua poller konkuren untuk server yang sama tidak pernah menyewakan ganda.
- **Result** ingestion bersifat idempotent berdasarkan `(tenant_id, server_id, idempotency_key)`. `worker-result.request` sama sekali tidak punya field `job_id` (issue ahliweb/omes#221) — id job-store lokal ciptaan worker tidak berhubungan dengan apa pun yang ditetapkan AWCMS, dan `additionalProperties: false` pada skema yang di-pin kini menolak request yang masih mengirimkannya. `job_id` pada respons (masih wajib) sebaliknya adalah `awcms_omes_jobs.id` milik SERVER sendiri yang sudah di-resolve pada `recorded`/`duplicate_ignored`; jalur `rejected` (termasuk job yang tak ter-resolve, dilipat ke jawaban netral yang sama) memancarkan literal tetap `"unknown"`, bukan mengonfirmasi apakah job yang cocok ada. Respons 2xx **tidak pernah** berarti "job berhasil": setiap baris yang ditulis `application/worker-result-ingestion.ts` diberi cap `source = 'worker_reported'` / `reconciled = false` — rekonsiliasi terhadap evidence OMES yang diamati secara independen di luar cakupan issue ini dan dibiarkan `false`, bukan diam-diam diasumsikan.
- **Heartbeat** memperbarui `last_heartbeat_at` dan telemetri terredaksi yang diatribusikan ke `omes-host`, dan tidak pernah menghidupkan kembali status server `decommissioned` apa pun yang dilaporkannya. Staleness sendiri tetap fungsi murni dari `now` yang dihitung saat baca (`domain/staleness.ts`, #198) — evidence yang hilang tidak pernah berarti sehat.

Pemeriksaan identitas/replay/versi yang gagal pada poll/heartbeat menjawab dengan status `re-enroll_required` milik kontrak yang di-pin sendiri (tidak pernah error HTTP), identik terlepas dari penyebab sebenarnya — tenant salah, jendela signature kedaluwarsa, replay, identitas dicabut, dan worker tak dikenal semuanya melebur menjadi respons yang sama, sehingga permukaan ini tidak pernah mengonfirmasi atau menyangkal yang mana dari itu semua.

**Kesenjangan lintas-repositori yang ditandai secara eksplisit**, bukan disiasati diam-diam: pull worker referensi sisi-OMES sebagaimana di-merge untuk `ahliweb/omes#192` (`lib/omes/py/jobs/worker.py`) belum membangkitkan keypair Ed25519 sungguhan atau mengirim header signature/nonce/timestamp apa pun — "public key"-nya adalah string placeholder turunan hash SHA-256. Modul ini tidak melonggarkan verifikasi agar cocok dengan stub itu; membawa worker sisi-OMES ke bentuk wire ini adalah pekerjaan lanjutan yang diperlukan, dicatat di PR yang mendaratkan issue ini, bukan ditebak di sini.

`domain/contracts/` milik `ahliweb/omes#197` (`validateOmesContract`/`validateOmesContractText`, `scanForRawSecrets`, `getOmesStateMachine`, `OMES_CONTRACT_PIN`) adalah yang divalidasi keempat rute terhadap setiap amplop masuk sebelum melakukan apa pun — titik pemasangan yang sudah diantisipasi headernya sendiri.
