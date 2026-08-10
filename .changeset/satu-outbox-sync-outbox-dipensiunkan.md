---
"awcms": minor
---

feat(sync): satu outbox — `awcms_sync_outbox` dipensiunkan, dan `/sync/pull` membaca `awcms_domain_events`

Issue #477 menanyakan bagaimana mengisi tabel yang tak pernah punya produsen.
Jawabannya: jangan. Repo ini sudah punya outbox transaksional yang bekerja —
`awcms_domain_events`, lengkap dengan dispatcher, DLQ, dan replay — dan outbox
kedua yang tak pernah tersambung sebaiknya tidak mendapatkan produsen,
melainkan dihapus (ADR-0077, `sql/099`).

**Perilaku tidak berubah:** `/sync/pull` tetap menjawab `200` dengan daftar
kosong. Yang berubah adalah **kenapa** ia kosong. Sebelumnya karena tak ada
jalur; sekarang karena `SYNC_REPLICABLE_EVENT_TYPES` kosong — kebijakan yang
tertulis di satu tempat dan bisa direview.

**Kenapa allow-list-nya kosong, bukan diisi satu untuk "membuktikan
mekanismenya".** Karena mekanismenya belum benar, dan menemukan itu adalah
hasil paling berharga dari issue ini:

- **visibilitas commit.** `event_sequence` diberikan saat `INSERT` tetapi
  terlihat saat `COMMIT`. Dua transaksi bisnis yang tumpang tindih bisa commit
  tidak berurutan, dan pembaca ber-cursor `event_sequence > checkpoint` yang
  berjalan di antaranya akan melihat 101, memajukan checkpoint, dan **tak pernah
  melihat 100** — kehilangan senyap dan permanen, pada protokol yang tugasnya
  justru tidak kehilangan apa pun. Dorman di tabel lama (nol penulis), **nyata**
  di `awcms_domain_events` (tujuh call site produksi di dua modul);
- **proyeksi payload.** Node ber-HMAC bukan sesi. `redactEventPayloadForResponse`
  **tidak bisa** dipakai ulang: ia menutupi `email`/`phone`/`nik`/`npwp` —
  persis field yang perlu direplikasi — dan dipasang di permukaan admin.

Repo ini sudah punya jawaban benar untuk yang pertama, dan bukan cursor:
`appendDomainEvent` menulis satu baris `awcms_domain_event_deliveries` **per
consumer di transaksi yang sama** dengan event-nya, jadi tak ada cursor untuk
dilompati. Replikasi node yang sungguhan harus menumpang mekanisme itu.

**Kenapa sekarang.** `last_pull_sequence` setiap node terbukti bernilai `0` —
query lama tak pernah bisa memajukannya. Memindahkan sumber cursor hari ini
berharga satu `DROP TABLE`; setelah ada produsen, ia berharga pemetaan sequence
lintas-tabel per node.

**Migrasinya MENOLAK, bukan menghancurkan:** ia menghitung baris lebih dulu dan
`RAISE EXCEPTION` bila menemukan satu pun — dibuktikan terhadap Postgres nyata
(`ERROR: awcms_sync_outbox holds 1 row(s)`). Diterapkan dua kali untuk
membuktikan idempotensi; index cursor `(tenant_id, event_sequence)` ikut
mendarat bersama endpoint yang akan memakainya, bukan nanti bersama entri
allow-list pertama — perubahan satu baris yang diam-diam mengubah bounded scan
menjadi full scan adalah jenis yang mendarat tanpa diukur siapa pun.

`BOUNDED_BY_DESIGN` kembali **kosong**: tabelnya tidak ada lagi, jadi tak ada
pertanyaan retensi untuk dijawab.

Menutup #477.
