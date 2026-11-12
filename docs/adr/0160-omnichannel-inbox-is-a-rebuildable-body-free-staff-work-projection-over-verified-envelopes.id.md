🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0160-omnichannel-inbox-is-a-rebuildable-body-free-staff-work-projection-over-verified-envelopes.md)

<!-- i18n-source-hash: sha256:83d660709576bd3f8f746eaf2fd0bf69f8accb47035a51cd853db6be6fbfc510 -->

# ADR-0160 — Inbox omnichannel adalah proyeksi kerja staf yang dapat dibangun ulang, tanpa isi pesan, di atas envelope terverifikasi

- **Status:** Diterima
- **Tanggal:** 2026-11-11
- **Pengambil keputusan:** ahliweb (pemilik), **diterima 2026-11-11** (Q1 di bawah). ADR ini mencatat apa yang dibutuhkan Issue #1164 tetapi tidak diizinkan [ADR-0150](0150-inbound-omnichannel-events-enter-as-verified-redacted-envelopes-with-no-generic-interactions-store.id.md) §1 sebagaimana tertulis ("unified inbox adalah proyeksi khusus presentasi … tidak pernah menulis"). Q2 sampai Q4 tetap **terbuka**, dan kode mempertahankan jawaban gagal-tertutupnya sampai pemilik memutuskannya. Implementasi Issue #1164 tetap `experimental` dan mati secara bawaan.
- **Menyempurnakan:** ADR-0150 §1 dan N6, hanya sejauh §2 di bawah; setiap invarian ADR-0150 lainnya (N1 sampai N5, N7 sampai N10) dan setiap invarian ADR-0148 (I1 sampai I13) tetap mengikat.
- **Terkait:** Issue #1164; [ADR-0148](0148-omnichannel-foundation-is-five-gated-capabilities-with-fail-closed-per-account-capability.id.md) (akun, business scope sebagai brand), [ADR-0152](0152-customer-telegram-engagement-is-a-separate-admitted-context-telegram-delivery-stays-staff-only.id.md) (envelope Telegram), [ADR-0155](0155-website-engagement-is-an-intake-only-system-module-with-token-and-origin-provenance.id.md) (envelope situs web), [ADR-0134](0134-descriptor-declared-domain-event-consumers.id.md) (konsumen), [ADR-0154](0154-realtime-progress-is-sse-first-on-the-existing-bun-process-reading-durable-state-websocket-not-admitted.id.md) (topik realtime), [ADR-0094](0094-a-data-subject-is-answered-per-tenant.id.md).

## Dikirim dalam keadaan mati

Modul yang dijelaskan ADR ini dikirim **`experimental` dan dimatikan** (`OMNICHANNEL_INBOX_ENABLED` tidak diisi): setiap rute menjawab `404`, konsumen proyektor tidak melakukan apa pun, dan job SLA keluar tanpa menyentuh tenant mana pun. Merge kode tidak mengubah perilaku deployment mana pun. Penerimaan ADR ini membuat menyalakannya sah; menyalakannya tetap keputusan per deployment.

## Konteks

Diverifikasi di `main` pada 11 November 2026:

- Ada dua envelope inbound terverifikasi: `awcms.telegram_engagement.interaction.received` / `consent.changed` (ADR-0152; id, jenis, dan kelas, tidak pernah id Telegram atau teks) dan `awcms.website_engagement.submission.received` / `withdrawn` (ADR-0155; id submission opak dan fakta tentangnya, tidak pernah data pengunjung). Belum ada rute inbound WhatsApp; `whatsapp_delivery` hanya outbound.
- ADR-0150 §1 tidak mengadmisi store percakapan, thread, atau pesan di upstream dan menyebut unified inbox "khusus presentasi … tidak pernah menulis". Pemicu pembukaan ulangnya: dua konsumen di repositori ini membutuhkan state percakapan tersimpan yang sama; platform membutuhkan thread di server untuk membalas; atau inbox commerce berhenti menjadi otoritas.
- Issue #1164 meminta **penugasan ke staf, riwayat penugasan, tag, status percakapan, SLA first-response dan next-response dengan kalender kerja dan hari libur, serta notifikasi SLA ke staf**. Tidak satu pun ada di envelope: itu **state kerja staf**, ditulis orang di tenant ini, dan harus bertahan di antara dua pemuatan halaman. Proyeksi yang tidak pernah menulis tidak bisa menyimpan "percakapan ini milik Ani".
- AWCMS dipakai langsung sebagai template (ADR-0034). Deployment tanpa `awcms-one` tidak punya inbox commerce sama sekali; baginya "otoritas downstream" yang diandalkan ADR-0150 §8 tidak ada.

Jadi bacaan yang jujur: pemicu pembukaan ulang **tidak** terpenuhi secara harfiah (hanya ada satu konsumen, bukan dua), tetapi premis di balik §1 ("inbox tidak butuh jalur tulis") tidak benar untuk kebutuhan yang kini ditulis pemilik di #1164. Itu keputusan pemilik, sehingga ADR ini ditulis sebagai `Proposed`; pemilik menerimanya pada 2026-11-11.

## Keputusan

### 1. Modul sempit, `omnichannel_inbox`

Modul `system`, `experimental`, mati secara bawaan di tingkat deployment (`OMNICHANNEL_INBOX_ENABLED`), modul, dan tenant. Ia bergantung pada `channel_accounts` (aturan scope dan visibilitas) dan `domain_event_runtime` (konsumen), dan **tidak mengimpor apa pun** dari `telegram_engagement` atau `website_engagement`: ia hanya membaca envelope yang mereka terbitkan.

### 2. Apa yang disimpan, dan apa yang tidak pernah disimpan

| Disimpan                                                                                                                                                                                                                                       | Tidak pernah disimpan                                                                                                                                                               |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Baris percakapan** berkunci `(jenis sumber, referensi sumber opak)`: id kontak ber-scope akun atau id submission dari envelope, akun kanal dan business scope-nya, waktu inbound pertama/terakhir, state pelanggan (aktif, opt-out, ditarik) | Isi pesan, `content_ref`, alamat pengirim, nomor telepon, alamat e-mail, id Telegram, nama, username, media                                                                         |
| **State kerja staf**: status (`open`, `pending`, `resolved`, `closed`), penanggung jawab, tag, waktu respons pertama/terakhir, waktu jatuh tempo SLA dan cap pelanggarannya                                                                    | Catatan internal teks bebas (ditunda: itu teks bebas tentang pelanggan dan butuh keputusan retensi sendiri)                                                                         |
| **Ledger aktivitas append-only** atas aksi staf dan sistem (ditugaskan, dilepas, penugasan dicabut, status berubah, respons dicatat, tag ditambah/dihapus, SLA terlanggar), hanya id dan kode tertutup                                         | Balasan apa pun. Inbox **tidak mengirim apa pun** dan tidak punya `send(channel, payload)`: balasan lewat antrean, consent, dan cek kapabilitas kanal asalnya sendiri (ADR-0150 §7) |
| Katalog tag dan kebijakan SLA per tenant (zona waktu, jam kerja per hari, hari libur, menit first/next response), opsional per business scope                                                                                                  | Customer master, penggabungan kontak, identitas lintas kanal (ADR-0148 I7)                                                                                                          |

Kolom turunan envelope adalah **proyeksi**: hanya ditulis konsumen (yang dijalankan dispatcher event domain sebagai `awcms_worker`, dengan grant tingkat kolom yang mengecualikan penanggung jawab dan cap waktu respons), idempoten berdasarkan nilai (waktu inbound pertama paling awal, waktu inbound terakhir paling akhir, perubahan state pelanggan hanya diterapkan bila sequence event-nya lebih baru), dan dapat **dibangun ulang** dari `awcms_domain_events` dengan memutar ulang keempat jenis event. State kerja staf ditulis manusia dan tidak dibangun ulang; rebuild tidak pernah menyentuhnya.

### 3. Akses (default-deny, aturan pengurungan channel-accounts)

- Permission: `conversations.read`, `conversations.update` (status, tag, mencatat respons), `conversations.assign` (berisiko tinggi: idempoten, diaudit), `tags.configure`, `sla_policies.read`, `sla_policies.configure`, `projection.configure` (rebuild; berisiko tinggi).
- **Tenant-wide** berarti tidak terkurung scope **dan** memegang permission rute lewat grant tenant-wide (ADR-0080 membiarkan kunci grant ber-scope tetap tingkat tenant di chokepoint, jadi kunci saja tidak menjadikan siapa pun tenant-wide). Hanya pemanggil tenant-wide yang melihat semua percakapan, dan hanya ia yang mengonfigurasi katalog tag, kebijakan SLA default tenant, dan rebuild.
- Percakapan membawa business scope akun kanalnya (sebuah brand). Pemanggil yang **terkurung scope** (punya penugasan scope non-tenant aktif yang belum berakhir, **termasuk yang belum mulai**, aturan fail-closed #1171 / #1270) hanya melihat percakapan yang scope-nya dinyatakan tercakup oleh chokepoint; percakapan **tenant-wide** (akun tenant-wide, setiap submission situs web) disembunyikan darinya. Tidak dikenal, milik tenant lain, dan tidak terlihat adalah satu `404`.
- **Penanggung jawab** harus pengguna tenant aktif yang memegang `conversations.update` lewat grant tenant-wide, dan bila ia terkurung scope, punya penugasan aktif yang sudah mulai pada scope percakapan atau leluhurnya. Percakapan tenant-wide hanya dapat ditugaskan ke orang yang tidak terkurung. Predikat yang sama dicek ulang oleh job SLA: penanggung jawab yang kehilangannya **dilepas** dengan baris aktivitas `assignee_revoked`, sehingga orang yang dicabut berhenti menerima e-mail SLA.
- RLS `FORCE` pada setiap tabel; ledger aktivitas append-only bagi role runtime.

### 4. SLA

- Kebijakan punya anggaran first-response dan next-response dalam **menit kerja**, zona waktu IANA, jam kerja per hari dan daftar hari libur. Waktu jatuh tempo dihitung dengan menelusuri jendela kerja di zona kebijakan (aman DST), melewati hari libur dan hari tutup, dibatasi 400 hari; kebijakan tanpa jendela kerja ditolak saat ditulis.
- Jam mulai berjalan pada **waktu terima server** atas envelope inbound pertama yang belum dijawab (`receivedAt`), tidak pernah waktu dari penyedia. Karena inbox tidak mengirim apa pun, "respons" adalah aksi staf, `POST …/responses`, dicatat setelah membalas lewat rute kanal itu sendiri. Mengonsumsi event outbound "balasan diantrekan" adalah tindak lanjut bagi modul kanal (belum ada yang menerbitkannya hari ini).
- Job SLA (`omnichannel-inbox:sla`, Bun ter-pin, `awcms_app`, satu transaksi per tenant, kegagalan satu tenant tidak menghentikan tenant lain) lebih dulu menerapkan event state pelanggan 48 jam terakhir yang belum diterapkan proyeksi: consent Telegram, yang tidak boleh di-subscribe konsumen mana pun karena role penerbitnya tidak menulis baris delivery (sql/374), dan penarikan situs web, sebagai jaring pengaman di belakang konsumen. Ia memeriksa ulang penanggung jawab mulai dari yang paling lama tidak diperiksa, sehingga setiap pasangan (penanggung jawab, scope) tercapai melewati batas satu putaran. Lalu ia menandai pelanggaran sekali dan memberi tahu **hanya penanggung jawab**, lewat port `workflow_notification` yang sudah ada (outbox e-mail); template yang tidak ada adalah no-op senyap. Tidak ada yang dikirim ke pelanggan.

### 5. Retensi, data subjek

Baris percakapan hanya memuat referensi opak dan dihapus `data_lifecycle` berdasarkan `last_inbound_at` (bawaan 365 hari, 30 sampai 1095; purge tidak punya override per tenant, dan jendela rebuild dibatasi pada angka yang sama); aktivitas dan tautan tag ikut terhapus. Submission situs web yang ditarik langsung menandai percakapan `withdrawn`. Rebuild hanya memutar ulang event di dalam jendela retensi, sehingga tidak menghidupkan kembali percakapan yang sudah dihapus. Pelanggan tidak terjangkau sebagai subjek (ia tidak punya tenant user); cap staf diputus bersama baris subjeknya (ADR-0094).

### 6. Realtime

Tidak ada topik realtime yang ditambahkan. Registry ADR-0154 menyebut "inbox hint" sebagai entri yang ditambahkan inbox; melakukannya butuh rute snapshot, rute SSE, dan permission topik, dan menjadi tindak lanjut.

## Opsi yang dipertimbangkan

| Kriteria         | **A. Proyeksi kerja staf yang sempit (dipilih)**          | B. ADR-0150 sebagaimana tertulis (tanpa tulis) | C. Store `interactions` generik                             |
| ---------------- | --------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------- |
| Memenuhi #1164   | Penugasan, tag, status, SLA, riwayat                      | Tidak: tidak ada tempat menyimpan penugasan    | Ya, dan jauh lebih banyak                                   |
| Minimisasi data  | Hanya id opak dan kode tertutup; tanpa isi                | Terbaik                                        | Menyimpan isi dan identitas setiap kanal (ditolak ADR-0150) |
| Otoritas         | Bukan otoritas pelanggan atau pesan; dapat dibangun ulang | n/a                                            | Tanpa sengaja menjadi system of record                      |
| Dapat dibatalkan | Hapus modul; tidak ada yang bergantung padanya            | n/a                                            | Sulit                                                       |

## Konsekuensi

- **Positif:** deployment tanpa inbox downstream mendapat antrean kerja staf tanpa menyimpan satu pun isi pesan; proyeksinya dapat dibuang dan dibangun ulang.
- **Negatif:** "respons" adalah pernyataan staf sampai modul kanal menerbitkan event outbound; submission situs web bersifat tenant-wide, sehingga agen yang terkurung brand tidak melihat satu pun.
- **Persetujuan manusia yang masih diperlukan:** controller, untuk retensi bawaan; teks template e-mail untuk pemberitahuan SLA; pemilik, untuk Q2 sampai Q4. (Pemilik menerima ADR ini pada 2026-11-11.)

## Pertanyaan terbuka bagi pemilik

Setiap pertanyaan terbuka mempertahankan jawaban "Usulan" (gagal-tertutup) di kode sampai diputuskan.

- **Q1. Diputuskan 2026-11-11:** penyempurnaan ADR-0150 §1 hanya untuk state kerja staf diterima.
- **Q2.** Apakah visibilitas juga harus mensyaratkan penugasan akun kanal pemanggil (owner/operator/viewer), di atas permission inbox dan business scope? Usulan: tidak; permission inbox ditambah scope adalah batasnya, dan penugasan akun mengatur pengoperasian akun.
- **Q3.** Haruskah pelanggaran yang belum ditugaskan memberi tahu seseorang (misalnya pemegang `conversations.assign`)? Usulan: tidak pada fase ini; daftar dapat difilter untuk pelanggaran yang belum ditugaskan.
- **Q4.** Catatan internal: diadmisi kelak dengan retensi dan redaksinya sendiri, atau tidak pernah?
