🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](README.md)

<!-- i18n-source-hash: sha256:35da87798e2d1df8c69c68b0c2dc422dd1f9dd17c90080677eddc6aeaad8eb97 -->

# `omnichannel_inbox`

Antrean kerja staf per tenant di atas envelope inbound terverifikasi (Issue
#1164, [ADR-0160](../../../docs/adr/0160-omnichannel-inbox-is-a-rebuildable-body-free-staff-work-projection-over-verified-envelopes.id.md),
**Proposed** — butuh penerimaan pemilik karena menyempurnakan ADR-0150 §1).

Dikirim **`experimental` dan mati** (`OMNICHANNEL_INBOX_ENABLED`): setiap rute
menjawab `404`, konsumen proyektor tidak melakukan apa pun dan `bun run
omnichannel-inbox:sla` inert.

## Apa ini

- **Proyeksi.** Konsumen `omnichannel_inbox.conversation_projector` membaca
  `awcms.telegram_engagement.interaction.received` / `consent.changed` dan
  `awcms.website_engagement.submission.received` / `withdrawn` dan menyimpan
  satu baris percakapan per (jenis sumber, referensi opak): id kontak ber-scope
  akun atau id submission, akun kanal dan business scope-nya (brand), waktu
  inbound pertama/terakhir, dan state pelanggan. **Tanpa isi pesan, tanpa
  referensi konten, tanpa alamat pengirim, tanpa id eksternal, tanpa nama,
  tanpa media.**
- **Idempoten berdasarkan nilai.** Inbound pertama/terakhir adalah
  LEAST/GREATEST; inbound dihitung belum dijawab hanya bila diterima setelah
  `answered_through`; perubahan state pelanggan hanya diterapkan dengan
  `event_sequence` yang lebih baru; `withdrawn` terminal (`sql/384`). Pengiriman
  ganda, replay, dan rebuild berujung pada baris yang sama. Event consent yang
  tiba sebelum percakapan ada diterapkan saat percakapan dibuat (dibaca ulang
  dari log).
- **Rebuild.** `POST /projection/rebuild` memutar ulang keempat jenis event di
  dalam jendela (maksimal 365 hari) per batch 2000. State kerja staf tidak
  pernah direset.
- **State kerja staf.** Status (`open`, `pending`, `resolved`, `closed`; inbound
  BARU yang belum dijawab membuka kembali percakapan yang sudah selesai),
  penugasan dengan riwayat append-only, tag (≤ 20, katalog per tenant), respons,
  SLA.
- **SLA.** Per tenant atau per business scope: zona IANA, jendela per hari,
  hari libur, anggaran first/next response dalam menit kerja. Jam mulai pada
  waktu terima server atas inbound pertama yang belum dijawab. Inbox tidak
  mengirim apa pun, jadi respons dicatat staf (`POST …/responses`) setelah
  membalas lewat rute kanal itu sendiri.
- **Job SLA** (`omnichannel-inbox:sla`, tiap 5 menit, `awcms_app`, satu
  transaksi per tenant, tenant yang gagal tidak menghentikan yang lain):
  melepas penanggung jawab yang kehilangan kelayakan (`assignee_revoked` dengan
  alasan), menandai pelanggaran sekali dan memberi tahu **hanya penanggung
  jawab** lewat port `workflow_notification` yang ada (template
  `omnichannel_inbox.sla_breached`, variabel hanya `breachedCount`; template
  yang tidak ada adalah no-op senyap).

## Akses

Permission default-deny (di-seed `sql/383`): `conversations.read`,
`conversations.update`, `conversations.assign` (berisiko tinggi,
`Idempotency-Key`), `tags.configure`, `sla_policies.read`,
`sla_policies.configure`, `projection.configure` (berisiko tinggi). Visibilitas
memakai aturan `channel_accounts`: pemanggil **terkurung scope** (penugasan
non-tenant aktif yang belum berakhir, **termasuk yang belum mulai**, #1270)
hanya melihat business scope yang ia cakup dan **tidak pernah percakapan
tenant-wide** (setiap submission situs web tenant-wide). Penanggung jawab harus
pengguna aktif yang memegang `conversations.update` lewat grant tenant-wide dan,
bila terkurung, punya penugasan aktif pada scope percakapan atau leluhurnya.
Setiap penulisan dijaga `expectedVersion`; penulis bersamaan mendapat satu
sukses dan satu `409`.

## Keputusan terbuka (dicatat, gagal-tertutup sementara)

- ADR-0160 itu sendiri (Q1) dan apakah visibilitas juga butuh penugasan akun
  kanal (Q2; hari ini tidak).
- Pelanggaran yang belum ditugaskan tidak memberi tahu siapa pun (Q3); catatan
  internal belum dibangun (Q4).
- Kebijakan ABAC deny milik penanggung jawab tidak dapat dievaluasi untuknya;
  chokepoint menerapkannya pada setiap permintaannya.
- Tenant yang memperpendek retensi percakapan di bawah 365 hari harus memberi
  `windowDays` lebih kecil pada rebuild, atau rebuild dapat memulihkan
  percakapan yang sudah dihapus purge-nya (keterbatasan yang diketahui).

## Tindak lanjut

- Layar operator (`/admin/*`); 7 permission-nya ada di `NOT_YET_SCREENED`.
- Topik realtime "inbox hint" (registry ADR-0154), event outbound "balasan
  diantrekan" dari modul kanal untuk menggantikan pencatatan respons manual,
  dan inbound WhatsApp setelah tersedia.
