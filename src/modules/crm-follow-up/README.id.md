🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](README.md)

<!-- i18n-source-hash: sha256:d22aa4b1127456f2337ea01b6d08029934600b4734b3167199e7c3ff534faee3 -->

# `crm_follow_up`

**Tugas tindak lanjut untuk staf** berbasis aturan berversi, dipicu event `crm_leads` (Issue #1165, [ADR-0159](../../../docs/adr/0159-crm-follow-up-is-a-rule-versioned-staff-task-cadence-that-stops-on-lead-signals-and-notifies-only-through-the-existing-email-port.id.md), **Diterima** 2026-11-11, memperluas [ADR-0153](../../../docs/adr/0153-reusable-lead-prospect-pipeline-is-a-pre-customer-context-that-never-owns-the-customer.id.md) N5). Modul ini mengubah event lead menjadi daftar kerja, mengeskalasi yang terlambat, memberi tahu staf lewat e-mail, dan menghentikan semuanya begitu lead berkonversi, hilang, digabung, membalas, menarik consent, atau memblokir pengirim.

Ia **tidak pernah mengirim apa pun ke lead**, **tidak menyimpan salinan lead** (tugas hanya membawa id lead yang opak), **bukan engine workflow kedua** (tanpa graf, persetujuan, atau bahasa ekspresi), dan **tidak punya facade lintas kanal** (ADR-0139): notifikasi staf hanya lewat `WorkflowNotificationPort` yang sudah ada (adapter `email`).

## Status

`experimental`, **mati di tiga tingkat**: `CRM_FOLLOW_UP_ENABLED=true` (deployment; bila tidak, setiap rute menjawab `503 CRM_FOLLOW_UP_DISABLED` setelah otorisasi, consumer mengabaikan setiap event, dan job tidak mengunjungi tenant mana pun), enable per tenant di Module Management, dan saklar tenant milik modul (`PATCH /api/v1/crm-follow-up/settings`, bawaan mati). `active` dengan tiga layar admin (di bawah); bila saklar deployment mati, layar menjelaskannya, tidak gagal.

## Layar admin

Admin SISTEM ([ADR-0051](../../../docs/adr/0051-admin-screens-consolidated-in-awcms.md)), halaman data server-rendered ([ADR-0149](../../../docs/adr/0149-the-admin-data-page-is-a-server-rendered-keyset-paged-pattern-with-shared-primitives.md)). Tiap halaman membaca lewat `application/screen-loaders.ts`, yang memanggil fungsi direktori YANG SAMA dengan rute API, sehingga yang ditampilkan layar adalah yang ditampilkan API; tes integrasi perilaku menjalankan loader itu lewat chokepoint `loadAdminScreen` sungguhan dengan sesi sungguhan.

| Layar                        | Permission   | Fungsinya                                                                                                                                                                                                                                                       |
| ---------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/admin/crm-follow-up`       | `tasks.read` | Daftar kerja. Tampilan bawaan adalah pekerjaan yang masih hidup (terbuka dan dieskalasi, digabung menurut urutan tenggat); filter status, "ditugaskan kepada saya" (daftar harian, diselesaikan dari sesi), dan terlambat; keyset, muatan terbatas              |
| `/admin/crm-follow-up/{id}`  | `tasks.read` | Satu tugas: ringkasan, riwayat append-only, pemberitahuan staf beserta penyelesaiannya yang tertutup, sinyal penghentian prospek. `tasks.update` menambah selesaikan (hasil tertutup) dan batalkan; `stop_signals.create` menambah "hentikan untuk prospek ini" |
| `/admin/crm-follow-up/rules` | `rules.read` | Katalog aturan dan, dengan `?rule=`, definisi satu aturan beserta riwayat revisinya yang tak dapat diubah. `rules.configure` menambah saklar tenant (diaudit pada level warning, `Idempotency-Key`, konfirmasi)                                                 |

Setiap penulisan membawa `Idempotency-Key`; penulisan tugas membawa `expectedVersion` (staf kedua mendapat `VERSION_CONFLICT`, bukan penimpaan diam-diam). Selama saklar tenant mati, kontrol dinonaktifkan beserta alasannya. "Tugaskan ulang" ditampilkan nonaktif: tak ada endpoint yang memindahkan tugas secara manual. Staf tampil sebagai "Anda" atau "Staf lain", bukan nama, dan tak ada data prospek yang dirender (memang tak disimpan). Tidak ada dimensi business scope untuk dibatasi: tugas hanya memuat id prospek buram, persis seperti `GET /tasks` mendaftar antrean tenant. Satu penyimpangan yang disengaja dari "apa yang ditampilkan API": status saklar tenant ditampilkan kepada pemegang `tasks.read` meski `GET /settings` menuntut `rules.read`; ia hanya satu boolean yang menjelaskan mengapa penulisan ditolak, dan pemegang `tasks.update` mengetahuinya dari `409 CRM_FOLLOW_UP_TENANT_DISABLED`.

## Cara kerja

| Bagian                                     | Fungsinya                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Aturan + revisi immutable (`sql/369`)      | Pemicu tertutup (`lead_created`, `stage_entered`, `lead_assigned`) dengan filter opsional pipeline / kategori tahap / kunci tahap, judul tugas, offset jatuh tempo dan eskalasi dalam **menit kerja**, mode penanggung jawab (`lead_owner` / `fixed_user`), notifikasi staf (`onAssign`, `onDue`), batas per lead, dan kalender |
| Kalender kerja (`domain/working-calendar`) | Zona IANA, hari kerja ISO, jendela harian, tanggal libur; konversi lokal ke UTC per hari, tidak pernah memakai zona host                                                                                                                                                                                                        |
| Simulasi (`POST /rules/simulate`)          | Baca-saja: pencocokan dan perencanaan yang sama dengan consumer, ditambah sinyal berhenti dan tugas hidup lead; tidak menulis apa pun                                                                                                                                                                                           |
| Consumer `crm_follow_up.lead_signals`      | `lead.created` / `lead.stage_changed` / `lead.assigned` membuat tugas (satu per aturan dan event sumber); `lead.assigned` memindahkan tugas `lead_owner` yang hidup; `lead.converted` / `lead.lost` / `lead.merged` mencatat sinyal berhenti                                                                                    |
| Sinyal berhenti                            | Append-only; membatalkan tugas terbuka/tereskalasi lead dan notifikasi tertundanya; tidak ada tugas yang dibuat untuk lead yang dihentikan (advisory lock per lead + trigger database)                                                                                                                                          |
| `bun run crm-follow-up:dispatch`           | Mengeskalasi tugas terlambat; memeriksa ulang tiap notifikasi jatuh tempo (tugas hidup, tanpa sinyal berhenti, penerima masih penanggung jawab dan AKTIF, jam kerja, batas per jam) lalu menyerahkannya ke outbox e-mail, atau membatalkan, menekan, atau menundanya                                                            |

`lead.created` kini membawa `ownerTenantUserId` (field aditif kontrak `crm_leads`): intake dengan owner menulis baris penugasan tetapi tidak menerbitkan `lead.assigned`.

## Keamanan

- Default-deny: `crm_follow_up.rules.read`, `.rules.configure` (berisiko tinggi, diaudit pada warning), `.tasks.read`, `.tasks.update` (diaudit), `.stop_signals.create` (berisiko tinggi, diaudit pada warning); di-seed `sql/370`, masing-masing ditegakkan rutenya. Setiap mutasi butuh `Idempotency-Key` dan orang yang sedang masuk; penulisan tugas dan aturan memakai `expectedVersion`.
- RLS `FORCE` pada ketujuh tabel dengan foreign key tenant komposit; `awcms_app` tidak memegang `DELETE` dan tidak memegang `UPDATE` pada revisi, aksi, atau sinyal berhenti; `awcms_worker` tidak pernah menulis aturan atau revisi dan tidak pernah menghapus. Trigger menjaga revisi, aksi, dan sinyal berhenti tetap append-only, identitas tugas tetap, transisinya di graf yang diizinkan, tugas tertutup dibekukan, dan notifikasi yang selesai dibekukan.
- Allow-list kategori e-mail worker (`sql/302`) dilebarkan tepat `crm.follow_up_assigned`, `crm.follow_up_due`, `crm.follow_up_escalated` (`sql/371`), dengan variabel `userName`, `taskTitle`, `dueAt`, `taskReference`: tidak ada slot untuk apa pun tentang lead.
- Atribut audit dan variabel notifikasi hanya membawa id, kode tertutup, hitungan, dan judul tugas yang ditulis tenant.

## Keputusan terbuka (pemilik)

- ADR-0159 **Diterima** (2026-11-11); pertanyaan terbukanya tetap terbuka: O1 (pesan keluar otomatis ke lead), O2 (port sinyal berhenti untuk #1144/#1164 dan consent kanal), O3 (apakah pembalikan mencabut sinyal berhenti), O4 (retensi tugas tertutup dan notifikasi selesai), O5 (mempersempit `tasks.read` ke tugas sendiri).
- Event PEMICU untuk tenant yang modulnya tidak aktif diabaikan dan **tidak diputar ulang** saat diaktifkan (gagal-tertutup: tidak ada lonjakan tugas basi). Event BERHENTI (`converted`, `lost`, `merged`) dicatat selama saklar deployment menyala, bahkan saat Module Management atau saklar tenant mati, sehingga sinyal berhenti tetap menang setelah modul dinyalakan kembali.
- `tasks.update` tidak dibatasi kepemilikan: pemegangnya dapat menyelesaikan atau membatalkan tugas mana pun di tenant (O5 mencakup penyempitannya bersama `tasks.read`).
- Notifikasi yang dibatalkan sebagai `recipient_changed` tidak dijadwalkan ulang bila lead kemudian dikembalikan ke orang yang sama (kunci `(task, kind, recipient)` sudah ada); tugasnya tetap ada di daftar kerja orang itu.
- Pengerasan keamanan dari audit PR #1266: zona waktu disimpan kanonik dan cache formatter dibatasi (`src/lib/time/zoned-formatter.ts` bersama, juga dipakai `booking` dan `hr_workforce`); kalender yang tidak dapat menampung offset ditolak; satu aturan atau tenant yang bermasalah tidak pernah menggagalkan yang lain; notifikasi tanpa template menjadi `suppressed` (`not_queued`) dan tidak memakai kuota; batas per jam dihitung di bawah lock per penerima; sinyal berhenti staf butuh lead yang nyata dan dicatat sekali per (lead, jenis); worker hanya boleh mengantrekan tiga kategori `crm.follow_up_*` ke alamat staf aktif tenant itu dan hanya dengan variabel yang ada di allow-list (`sql/371`).
- Notifikasi yang sudah diserahkan ke outbox e-mail sebelum sinyal berhenti dilaporkan oleh sinyal berhenti (`alreadyEnqueuedNotifications`) dan tidak ditarik kembali.

## Tindak lanjut tercatat

- Editor aturan di `/admin/crm-follow-up/rules`: membuat aturan, menerbitkan revisi, mengarsipkan, dan formulir simulasi. Endpoint-nya ada (`POST /rules`, `/rules/{id}/revisions`, `/rules/{id}/archive`, `POST /rules/simulate`); layar saat ini hanya baca untuk aturan dan menyatakannya.
- Penyapuan retensi yang sadar status (ADR-0159 O4); sampai saat itu ketujuh tabel tercatat di `BOUNDED_BY_DESIGN`.
- Sinyal berhenti karena balasan dan penarikan consent dari batas inbound (#1144/#1164) dan modul consent kanal, lewat port (O2); saat ini staf mencatatnya lewat API.
