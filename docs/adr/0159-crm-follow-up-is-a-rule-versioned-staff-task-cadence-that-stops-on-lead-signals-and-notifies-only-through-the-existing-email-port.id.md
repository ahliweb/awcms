🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0159-crm-follow-up-is-a-rule-versioned-staff-task-cadence-that-stops-on-lead-signals-and-notifies-only-through-the-existing-email-port.md)

<!-- i18n-source-hash: sha256:440b1bb5bca5ad369fa82e0dc409c4117af0a906fd3aefdd56229f5833c24c44 -->

# ADR-0159 — `crm_follow_up` adalah kadens tugas STAF berbasis aturan berversi yang dipicu event lead; berhenti pada sinyal lead, tidak mengirim apa pun ke lead, dan memberi notifikasi staf hanya lewat port e-mail yang sudah ada

- **Status:** Diusulkan
- **Tanggal:** 2026-11-11
- **Pengambil keputusan:** ahliweb (pemilik). **Belum diputuskan.** Implementasi Issue #1165 dikirim bersama ADR ini, mati secara bawaan di setiap tingkat, agar pemilik meninjau desain yang konkret, bukan sketsa; merge kode tidak berarti ADR diterima.
- **Menyelesaikan (bila diterima):** Issue #1165 (tugas tindak lanjut yang dapat dikonfigurasi, aturan berhenti kadens, dan pemicu notifikasi)
- **Memperluas:** [ADR-0153](0153-reusable-lead-prospect-pipeline-is-a-pre-customer-context-that-never-owns-the-customer.id.md) (N5 dan baris #1165 di tabel hilirnya: "berlangganan event lead sebagai sinyal berhenti; kunci tugas dengan id lead; jangan menyimpan salinan lead; jangan mengirim tanpa memeriksa ulang consent saat dispatch; jangan membangun engine persetujuan kedua"), [ADR-0134](0134-descriptor-declared-domain-event-consumers.md), [ADR-0011](0011-capability-ports-for-cross-module-collaboration.md), [ADR-0139](0139-cross-channel-notification-orchestration-not-admitted.md) (tanpa facade, tanpa fallback), [ADR-0148](0148-omnichannel-foundation-is-five-gated-capabilities-with-fail-closed-per-account-capability.md) (I1 sampai I13), [ADR-0063](0063-ownership-grants-run-through-the-authorization-chokepoint.md)
- **Terkait:** Issue #1163, #1166 (`crm_leads`), #1144 (batas inbound), #1164 (proyeksi percakapan), hilir `ahliweb/awcms-one` #462

## Konteks

Diverifikasi pada `main` tanggal 11 November 2026:

- `crm_leads` sudah ada (#1166, `sql/342`-`344`), `experimental`, mati di tiga tingkat. Ia menerbitkan delapan event berisi id saja (`lead.created`, `lead.stage_changed`, `lead.assigned`, `lead.merged`, `lead.merge_reverted`, `lead.converted`, `lead.conversion_reversed`, `lead.lost`). Ia **belum** menerbitkan `lead.consent_changed`, dan belum ada apa pun di repo yang menautkan pesan masuk ("orangnya membalas") ke sebuah lead: itu #1144 dan #1164.
- ADR-0153 N5 menyatakan tugas tindak lanjut dan kadens "adalah #1165, dibangun di atas `workflow_approval`, job yang ada, dan port notifikasi", serta mengikat apa yang tidak boleh dilakukan #1165. Ia **tidak** mengadmisi modul, tabel, versi aturan, permukaan simulasi, kalender, atau jalur notifikasi. Semua itu butuh admisi sendiri, yaitu ADR ini.
- Sambungan notifikasi yang sudah ada adalah `WorkflowNotificationPort` (`_shared/ports/workflow-notification-port.ts`): `email` mengimplementasikannya dengan memasukkan pengumuman ke outbox e-mail untuk **pengguna tenant**, dengan allow-list variabel per kategori dan trigger allow-list kategori sisi worker (`sql/302`). `hr_workforce` sudah memanggilnya dari consumer yang dideklarasikan descriptor dan berjalan sebagai `awcms_worker`. `push_delivery`, `whatsapp_delivery`, dan `telegram_delivery` adalah port khusus kanal untuk tujuan lain; ADR-0139 melarang facade lintas kanal dan fallback.
- `workflow_approval` adalah engine persetujuan (graf, keputusan, eskalasi). Tugas tindak lanjut bukan persetujuan: tidak ada yang disetujui atau ditolak, dan engine itu tidak mengenal lead.

Kebutuhannya (issue #1165, dari SRS pemangku kepentingan lewat `awcms-one` #462): pengingat, antrean terlambat, daftar kerja harian, eskalasi, berhenti ketika orangnya membalas, mendaftar atau berkonversi, menarik consent atau memblokir pengirim, batas frekuensi dan jam tenang, dengan idempotensi, keamanan balapan, dan akses default-deny.

## Keputusan

### 1. Modul System baru `crm_follow_up`, mati secara bawaan

Mengadmisi `crm_follow_up` (`experimental`): namespace permission sendiri, saklar deployment `CRM_FOLLOW_UP_ENABLED` (bawaan mati), enable per tenant di Module Management, dan saklar tenant sendiri (bawaan mati). Ia **bergantung** pada `crm_leads` hanya lewat event dan **tidak menyimpan salinan lead**: sebuah tugas membawa id lead yang opak dan tidak ada hal lain tentang lead (tanpa nama, titik kontak, atau nama tahap).

### 2. Apa ini: tugas staf, bukan pesan ke lead

- **v1 tidak mengirim apa pun ke lead.** Setiap tindak lanjut adalah **tugas manual untuk staf** ("tugas manual adalah bawaan" menurut issue). Pesan keluar ke lead (langkah WhatsApp atau e-mail otomatis dalam kadens) **tidak diadmisi**: ia butuh pemeriksaan consent saat penjadwalan **dan** saat dispatch lewat consent milik tiap kanal (ADR-0153 L11), batas laju per kanal, dan pemeriksaan tujuan hukum, dan merupakan ADR terpisah (O1).
- **Notifikasi hanya ke staf**, lewat `WorkflowNotificationPort` yang sudah ada (e-mail). Tiga kategori e-mail dasar yang tetap — `crm.follow_up_assigned`, `crm.follow_up_due`, `crm.follow_up_escalated` — dengan allow-list variabel `userName`, `taskTitle`, `dueAt`, dan `taskReference` saja: **nama lead, nilai kontak, atau catatan** tidak mungkin sampai ke template. Tanpa facade, tanpa pilihan kanal, tanpa fallback (ADR-0139). Allow-list kategori e-mail worker (`sql/302`) dilebarkan tepat tiga kategori ini.
- **Bukan engine workflow kedua.** Tidak ada graf, persetujuan, atau bahasa ekspresi. `workflow_approval` tidak diimplementasikan ulang dan tidak dibutuhkan; eskalasi adalah status tugas ditambah notifikasi staf.

### 3. Aturan adalah data tenant dengan revisi immutable

- Sebuah **aturan** (tenant, kode, nama, `active`/`archived`) punya **revisi**; revisi **immutable setelah diterbitkan** (trigger ditambah tanpa grant `UPDATE`), dan setiap tugas mencatat revisi yang membuatnya.
- Revisi adalah catatan deklaratif yang tertutup: **pemicu** dari daftar tertutup (`lead_created`, `stage_entered`, `lead_assigned`) dengan filter opsional (id pipeline, kategori tahap dari daftar tertutup ADR-0153, kunci tahap); judul tugas (dipilih tenant, terbatas, bukan data pribadi); offset jatuh tempo dalam **menit kerja**; offset dan penerima eskalasi opsional; mode penanggung jawab (`lead_owner` atau `fixed_user`); notifikasi staf mana yang dikirim; batas tugas terbuka per lead; dan **kalender kerja**: zona IANA, hari kerja, jendela harian, serta daftar tanggal libur yang terbatas. Tidak ada ekspresi, skrip, atau callback.
- **Simulasi** adalah evaluasi baca-saja atas draf revisi terhadap contoh pemicu (dan, opsional, id lead nyata untuk memeriksa sinyal berhenti dan batas tugas terbukanya) yang mengembalikan apakah tugas akan dibuat, waktu jatuh tempo dan eskalasinya, serta penanggung jawabnya. Ia tidak menulis apa pun.

### 4. Tugas, transisinya, dan idempotensi

- Tugas berstatus `open`, `escalated`, `completed`, atau `cancelled`. Perpindahan yang diizinkan: `open -> escalated | completed | cancelled`, `escalated -> completed | cancelled`; tugas tertutup dibekukan (trigger database). Penyelesaian mencatat **hasil** dari daftar tertutup (`reached`, `no_answer`, `rescheduled`, `not_interested`, `other`) dan tanpa teks bebas. Setiap perubahan menambahkan baris **aksi** yang immutable.
- **Idempotensi event.** Tugas unik pada `(tenant, aturan, id event sumber)`: event yang diputar ulang atau dikirim ulang menghasilkan satu tugas yang sama (di atas ledger efek per consumer milik runtime).
- **Konkurensi optimistis** pada setiap transisi oleh staf (`expectedVersion`, `409` saat konflik) dan `Idempotency-Key` pada setiap mutasi.

### 5. Sinyal berhenti selalu menang

- **Sinyal berhenti** adalah fakta append-only tentang sebuah lead: `converted`, `lost`, `merged` (lead yang diserap), `reply_received`, `consent_withdrawn`, `sender_blocked`, atau `manual`. Tiga yang pertama datang dari event `crm_leads`; empat yang terakhir dicatat staf berwenang lewat API saat ini, dan oleh batas inbound (#1144/#1164) serta modul consent kanal lewat port setelah keduanya ada (O2).
- Mencatat sinyal berhenti membatalkan setiap tugas lead yang terbuka atau tereskalasi dan setiap notifikasi tertunda dari tugas tersebut, dan **tidak ada tugas baru yang pernah dibuat** untuk lead yang sudah dihentikan. Pembuatan tugas dan pencatatan sinyal berhenti diserialkan dengan advisory lock transaksi per (tenant, lead), dan trigger database menolak insert tugas untuk lead yang punya sinyal berhenti, sehingga sinyal berhenti **menang** atas pemicu yang bersamaan, apa pun urutannya.
- Sinyal berhenti permanen di v1: merge yang dibatalkan atau konversi yang dibalik tidak memulai ulang kadens (O3).

### 6. Waktu, kalender, dan pemeriksaan ulang saat dispatch

- Semua instan adalah `timestamptz`. Waktu jatuh tempo dan eskalasi dihitung di zona revisi atas hari dan jam kerja, melewati hari libur, sehingga aturan yang sama memberi jawaban yang sama apa pun zona server, melintasi pergantian waktu musim panas.
- Job terjadwal (`bun run crm-follow-up:dispatch`, `awcms_worker`) mengeskalasi tugas yang terlambat dan menyerahkan notifikasi jatuh tempo ke port. **Saat dispatch** ia memeriksa ulang, di bawah lock per lead yang sama: tugas masih terbuka (atau tereskalasi, untuk notifikasi eskalasi), lead tidak punya sinyal berhenti, penerima masih pengguna tenant yang **aktif** (penanggung jawab yang dicabut tidak pernah diberi notifikasi), notifikasi berada dalam jam kerja (jam tenang: bila tidak, ditunda ke instan kerja berikutnya) dan di bawah batas per penerima per jam milik tenant (bila tidak, ditunda). Notifikasi yang sudah diserahkan ke outbox e-mail sebelum sinyal berhenti tiba dilaporkan sebagai terkirim; sinyal berhenti tidak mengaku menariknya kembali.

### 7. Akses, data, dan retensi

- Permission: `crm_follow_up.rules.read`, `crm_follow_up.rules.configure` (berisiko tinggi, diaudit pada warning: membuat, menerbitkan, mengarsipkan, saklar tenant), `crm_follow_up.tasks.read`, `crm_follow_up.tasks.update` (menyelesaikan, membatalkan; diaudit), `crm_follow_up.stop_signals.create` (berisiko tinggi, diaudit pada warning). Masing-masing di-seed migrasi dan ditegakkan rutenya. Setiap tabel `FORCE` RLS dengan foreign key tenant komposit; runtime tidak memegang `DELETE`.
- Data pribadi: tugas, aksi, sinyal berhenti, dan notifikasi hanya membawa id opak, id staf, kode tertutup, dan instan. Nama aturan dan judul tugas yang ditulis tenant adalah konfigurasi, bukan data pribadi. `subjectData` mencantumkan setiap kolom id staf.
- Retensi: tabel modul tumbuh seiring event lead dan untuk sementara dicatat sebagai terbatas-oleh-desain; penyapuan retensi yang sadar status (notifikasi yang selesai, tugas tertutup setelah suatu jendela) adalah tindak lanjut tercatat bersama milik `crm_leads` (ADR-0153 O4).

## Opsi yang dipertimbangkan

| Kriteria        | **A. Modul sendiri berisi tugas staf di atas event lead (dipilih)** | B. Memodelkan tiap tindak lanjut sebagai instans `workflow_approval` | C. Kadens keluar otomatis ke lead sekarang | D. Memperluas `crm_leads` dengan tugas |
| --------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------ | -------------------------------------- |
| Keamanan        | Tidak mengirim apa pun ke lead; notifikasi staf berkategori tetap   | Semantik persetujuan salah pakai; tanpa konsep berhenti per lead     | Consent saat jadwal dan dispatch per kanal | Mengaburkan ADR-0153 N5                |
| Privasi         | Tanpa salinan lead; hanya id                                        | Sama                                                                 | Nilai kontak harus dibaca dan dikirim      | Sama dengan A                          |
| Keterpeliharaan | Satu modul sempit, dapat dilepas sendiri                            | Membengkokkan engine persetujuan menjadi daftar tugas                | Permukaan besar (batas, consent, template) | Modul dengan dua tugas                 |
| Kompatibilitas  | Aditif, mati secara bawaan                                          | Mengubah semantik engine                                             | Butuh ADR kanal lebih dulu                 | Mengubah ADR yang sudah Diterima       |

## Konsekuensi

- **Positif:** pengingat, antrean terlambat, eskalasi, dan penghentian tersedia tanpa engine kedua, facade, atau pesan apa pun ke orangnya; aturan yang sama memberi tanggal jatuh tempo yang dapat direproduksi; pemutaran ulang dan balapan aman secara konstruksi.
- **Negatif:** kadens yang menulis ke lead menunggu O1; penghentian karena balasan dan penarikan consent masih manual sampai #1144/#1164 dan event consent kanal tersedia; penanggung jawab tugas dapat menjadi tidak aktif dan tetap terlihat di antrean sampai dialihkan.
- **Netral:** tidak ada yang berubah bagi deployment mana pun sampai modul diaktifkan.

## Pertanyaan terbuka untuk pemilik

- **O1.** Apakah langkah keluar otomatis ke lead diadmisi kelak, dan lewat ADR kanal yang mana (pemeriksaan ulang consent saat jadwal dan dispatch, batas per kanal, template yang disetujui)? Rekomendasi: ADR terpisah per kanal setelah #1144.
- **O2.** Port sinyal berhenti untuk #1144/#1164 dan modul consent kanal: bentuknya dan event mana yang mengisinya. Rekomendasi: `CrmFollowUpStopPort` diadmisi bersama produsen pertamanya.
- **O3.** Haruskah konversi yang dibalik atau merge yang dibatalkan mencabut sinyal berhenti? Rekomendasi: tidak di v1; staf memulai ulang pekerjaan secara manual.
- **O4.** Jendela retensi untuk tugas tertutup dan notifikasi yang selesai (bersama ADR-0153 O4).
- **O5.** Haruskah `tasks.read` dipersempit menjadi "tugas saya sendiri" lewat ownership grant (ADR-0063) bagi agen yang tidak boleh melihat seluruh antrean? Pertanyaan yang sama berlaku untuk `tasks.update`, yang saat ini membolehkan pemegangnya menyelesaikan atau membatalkan tugas mana pun di tenant.
- **O6.** Notifikasi yang dibatalkan sebagai `recipient_changed` tidak dijadwalkan ulang ketika lead dikembalikan ke orang yang sama (kunci `(task, kind, recipient)` sudah ada). Apakah itu dapat diterima, atau pengembalian harus mengaktifkan ulang notifikasi?
