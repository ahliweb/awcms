🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](README.md)

<!-- i18n-source-hash: sha256:e8977b61cff80f2cd8fe3bc5ef94e15985500c13cf3b6139b1531200ba00554b -->

# `omnichannel_inbox`

Antrean kerja staf per tenant di atas envelope inbound terverifikasi (Issue
#1164, [ADR-0160](../../../docs/adr/0160-omnichannel-inbox-is-a-rebuildable-body-free-staff-work-projection-over-verified-envelopes.id.md),
**Diterima** 2026-11-11; menyempurnakan ADR-0150 §1 hanya untuk state kerja
staf).

Dikirim **`active` dan mati** (`OMNICHANNEL_INBOX_ENABLED`): layar menyatakan inbox dimatikan, setiap rute
menjawab `404`, konsumen proyektor tidak melakukan apa pun dan `bun run
omnichannel-inbox:sla` inert.

## Apa ini

- **Proyeksi.** Konsumen `omnichannel_inbox.conversation_projector`
  berlangganan `awcms.telegram_engagement.interaction.received` dan
  `awcms.website_engagement.submission.received` / `withdrawn`. Ia menyimpan
  satu baris percakapan per (jenis sumber, referensi opak): id kontak ber-scope
  akun atau id submission, akun kanal dan business scope-nya (brand), waktu
  inbound pertama/terakhir, dan state pelanggan. **Tanpa isi pesan, tanpa
  referensi konten, tanpa alamat pengirim, tanpa id eksternal, tanpa nama,
  tanpa media.** `awcms.telegram_engagement.consent.changed` juga
  diproyeksikan, tetapi **tidak di-subscribe** (lihat di bawah).
- **Berjalan sebagai `awcms_worker`.** Dispatcher (`bun run
domain-events:dispatch`) menjalankan konsumen di `WORKER_DATABASE_URL`.
  `sql/382` memberi role itu INSERT/UPDATE tingkat kolom tepat pada kolom yang
  ditulis proyektor, INSERT append-only pada riwayat aktivitas, dan baca atas
  ketentuan kebijakan SLA. Ia tidak dapat membaca atau menulis penanggung jawab
  maupun cap waktu respons. Trigger di `sql/384` juga mempersempit NILAINYA,
  sehingga kredensial worker yang bocor hanya dapat menulis apa yang ditulis
  proyektor: business scope wajib sama dengan scope akun kanal; status hanya
  berpindah ke `open` (membuka kembali pekerjaan aktif yang sudah selesai) atau
  ke `closed` bersama penarikan; penantian hanya dikosongkan bila tidak ada yang
  terutang; pelanggaran hanya dapat dihapus, tidak pernah dicap; dan riwayat
  satu-satunya yang boleh ditambahkannya adalah baris pembukaan kembali. Untuk
  setiap role, state pelanggan wajib menunjuk event nyata dan berlaku yang
  menetapkannya, dan percakapan yang ditarik tertutup dan tidak berutang apa
  pun (sebuah CHECK).
- **Idempoten berdasarkan nilai.** Inbound pertama/terakhir adalah
  LEAST/GREATEST; inbound dihitung belum dijawab hanya bila diterima setelah
  `answered_through`; perubahan state pelanggan hanya diterapkan dengan
  `event_sequence` yang lebih baru; `withdrawn` terminal (`sql/384`). Pengiriman
  ganda, replay, dan rebuild berujung pada baris yang sama. Event state
  pelanggan yang tiba sebelum percakapan ada diterapkan saat percakapan dibuat
  (dibaca ulang dari log, terbaru lebih dulu).
- **Sapuan state pelanggan.** Dispatcher bot pelanggan menerbitkan
  `consent.changed` di bawah role-nya sendiri, yang oleh `sql/374` dilarang
  menulis baris delivery, sehingga tidak ada konsumen yang boleh berlangganan
  (`tests/domain-event-delivery-forbidden-subscriptions.test.ts` menguncinya
  untuk setiap modul). Job SLA menerapkan perubahan consent dan penarikan
  situs web 48 jam terakhir yang belum diterapkan proyeksi. Ia hanya membaca
  event yang dapat mengubah state (consent support, penarikan, dari agregat
  percakapan itu sendiri), sehingga banjir consent marketing tidak dapat
  memenuhi batch-nya dan menyembunyikan opt-out. Untuk penarikan ini
  adalah jaring pengaman di belakang konsumen: penarikan yang delivery-nya
  dead-letter tetap diterapkan.
- **Rebuild.** `POST /projection/rebuild` memutar ulang keempat jenis event di
  dalam jendela (maksimal 365 hari) per batch 2000. State kerja staf tidak
  pernah direset. Hanya pemanggil yang bertindak tenant-wide yang boleh
  menjalankannya.
- **State kerja staf.** Status (`open`, `pending`, `resolved`, `closed`; inbound
  BARU yang belum dijawab membuka kembali percakapan yang sudah selesai),
  penugasan dengan riwayat append-only, tag (≤ 20, katalog per tenant), respons,
  SLA. Menghapus tag katalog melepasnya di mana-mana, mencatat `tag_removed`,
  dan menaikkan versi setiap percakapan yang terdampak.
- **SLA.** Per tenant atau per business scope: zona IANA, jendela per hari,
  hari libur, anggaran first/next response dalam menit kerja. Jam mulai pada
  waktu terima server atas inbound pertama yang belum dijawab. Inbox tidak
  mengirim apa pun, jadi respons dicatat staf (`POST …/responses`) setelah
  membalas lewat rute kanal itu sendiri.
- **Job SLA** (`omnichannel-inbox:sla`, tiap 5 menit, `awcms_app`, satu
  transaksi per tenant, tenant yang gagal tidak menghentikan yang lain): sapuan
  state pelanggan; lalu pemeriksaan ulang paling banyak 500 pasangan
  (penanggung jawab, scope), yang paling lama tidak diperiksa lebih dulu,
  sehingga setiap pasangan tercapai dalam beberapa putaran; penanggung jawab
  yang kehilangan kelayakan dilepas (`assignee_revoked` dengan alasan); lalu
  pelanggaran ditandai sekali dan **hanya penanggung jawab** diberi tahu lewat
  port `workflow_notification` yang ada (template
  `omnichannel_inbox.sla_breached`, variabel hanya `breachedCount`; template
  yang tidak ada adalah no-op senyap).

## Akses

Permission default-deny (di-seed `sql/383`): `conversations.read`,
`conversations.update`, `conversations.assign` (berisiko tinggi,
`Idempotency-Key`), `tags.configure`, `sla_policies.read`,
`sla_policies.configure`, `projection.configure` (berisiko tinggi).

- **Tenant-wide** berarti: tidak terkurung scope **dan** memegang permission
  rute lewat grant tenant-wide (ADR-0080 membiarkan kunci grant ber-scope tetap
  tingkat tenant di chokepoint, jadi kunci saja tidak cukup). Pemanggil seperti
  itu melihat semua percakapan dan boleh mengonfigurasi tag, kebijakan SLA
  default tenant, dan rebuild.
- **Selain itu** hanya melihat business scope yang ia cakup, lewat aturan
  `channel_accounts`, dan **tidak pernah percakapan tenant-wide** (setiap
  submission situs web tenant-wide). Pemanggil terkurung scope adalah yang
  punya penugasan non-tenant aktif yang belum berakhir, **termasuk yang belum
  mulai** (#1270). Pemanggil tanpa keduanya tidak melihat apa pun. Daftar
  kebijakan SLA menampilkan default tenant ditambah kebijakan scope-nya.
- **Penanggung jawab.** Pengguna aktif yang memegang `conversations.update`
  lewat grant tenant-wide dan, bila terkurung, punya penugasan aktif yang sudah
  mulai pada scope percakapan atau leluhurnya. Penolakan adalah satu `422
ASSIGNEE_NOT_ELIGIBLE` tanpa alasan, sehingga rute ini bukan orakel atas akun
  rekan kerja.
- Setiap penulisan dijaga `expectedVersion`; penulis bersamaan mendapat satu
  sukses dan satu `409`.

## Retensi

Percakapan di-purge `data_lifecycle` berdasarkan `last_inbound_at` setelah
`defaultRetentionDays` deskriptor (365). Purge **tidak punya override per
tenant** hari ini, dan jendela rebuild dibatasi pada angka yang sama
(`MAX_REBUILD_WINDOW_DAYS`, diikat ke deskriptor oleh
`tests/omnichannel-inbox-domain.test.ts`), sehingga rebuild tidak dapat
menghidupkan kembali percakapan yang sudah di-purge.

## Keputusan terbuka (dicatat, gagal-tertutup sementara)

- Q2: apakah visibilitas juga butuh penugasan akun kanal? Hari ini tidak.
- Q3: pelanggaran yang belum ditugaskan tidak memberi tahu siapa pun.
- Q4: catatan internal belum dibangun.
- Kebijakan ABAC deny milik penanggung jawab tidak dapat dievaluasi untuknya;
  chokepoint menerapkannya pada setiap permintaannya.
- Yang masih dapat dilakukan kredensial `awcms_worker` yang bocor di inbox:
  memulai penantian dan waktu jatuh tempo pada percakapan aktif, membuka kembali
  pekerjaan aktif yang sudah selesai, dan menaikkan `version`. Masing-masing
  persis yang dilakukan envelope inbound sungguhan, dan membedakan tulisan palsu
  dari yang asli butuh event-nya sendiri, yang tidak dapat dilihat grant maupun
  trigger baris tanpa menjalankan ulang proyektor di SQL. Diterima sebagai
  sisa risiko; kredensial worker adalah rahasia operator.

## Layar (Issue #1164, UP-14)

Halaman Astro server-rendered di `/admin/omnichannel-inbox`, satu entri sidebar
(`omnichannel_inbox.conversations.read`), seluruhnya membaca lewat fungsi milik
rute sendiri (`visibilityFor`, `listConversations`, `getConversation`,
`listSlaPolicies`), sehingga pembatasan lingkup bisnis dan isolasi tenant adalah
milik API, bukan salinan. Tidak menampilkan isi pesan, nama, alamat, atau id
Telegram: staf disebut "Anda" atau "staf lain".

- `/admin/omnichannel-inbox` — antrean (halaman data ADR-0149): filter status,
  penerima tugas (saya / belum ditugaskan), terlambat, sumber, dan label
  didorong ke SQL; pencarian dan urutan atas baris yang dimuat (maksimal 200,
  dengan pemberitahuan bila lebih banyak dan tanpa total yang tak bisa
  dipertanggungjawabkan).
- `/admin/omnichannel-inbox/{id}` — status, label, tenggat, dan riwayat
  append-only; ubah status, atur label, catat respons (`conversations.update`),
  tugaskan ke saya / batalkan penugasan (`conversations.assign`,
  `Idempotency-Key`). Setiap tulis membawa `expectedVersion`. **"Tugaskan ke
  orang lain" ditampilkan nonaktif**: belum ada endpoint yang mendaftar calon
  penerima tugas.
- `/admin/omnichannel-inbox/settings` — kebijakan SLA (daftar; buat bawaan
  tenant, pensiunkan), katalog label (buat, hapus), dan bangun ulang proyeksi.
  Kebijakan untuk satu lingkup bisnis ditulis lewat API; pemilih lingkup adalah
  tindak lanjut.

## Keputusan terbuka

- Q2/Q3/Q4 ADR-0160 tetap terbuka dan gagal-tertutup; layar tidak menambah
  keputusan.
- Inbox commerce di hilir (utas milik embedder) **tidak** diproyeksikan ke inbox
  ini. Perlu-tidaknya adalah keputusan manusia; tidak ada yang membacanya di sini.
- Sengaja belum dibangun: tampilan utas split-pane, catatan internal dan balasan
  cepat (inbox tidak menyimpan teks, ADR-0160 bagian 1), dan toolbar aksi massal
  (tidak ada API massal).

## Tindak lanjut

- Pemilih orang untuk "tugaskan ke orang lain" butuh endpoint yang mendaftar
  calon penerima tugas; pemilih lingkup bisnis untuk kebijakan SLA per lingkup.
- Topik realtime "inbox hint" (registry ADR-0154), event outbound "balasan
  diantrekan" dari modul kanal untuk menggantikan pencatatan respons manual,
  dan inbound WhatsApp setelah tersedia.
- Bila `data_lifecycle` kelak punya override retensi per tenant, jendela
  rebuild wajib mengikutinya.
