# ADR-0077 — Satu outbox: `awcms_sync_outbox` dipensiunkan, dan `/sync/pull` membaca `awcms_domain_events`

- **Status:** Accepted
- **Tanggal:** 2026-08-10
- **Pengambil keputusan:** @ahliweb
- **Terkait:** Issue #477, [ADR-0006](0006-offline-first-sync-outbox.md) (pola outbox), [ADR-0034](0034-awcms-family-direct-use-templates-and-derived-pathway-removal.md) (jalur aplikasi turunan dihapus), [ADR-0074](0074-push-delivery-is-a-second-outbox.md) (kapan outbox KEDUA memang dibenarkan)

## Konteks

`awcms_sync_outbox` lahir di `sql/010` dan **tidak pernah ditulis apa pun** — bukan kode aplikasi, bukan trigger, bukan migrasi. `POST /api/v1/sync/pull`, satu-satunya pembacanya, karena itu tidak pernah bisa mengembalikan apa pun selain daftar kosong. Arah sebaliknya (`/sync/push` → `awcms_sync_inbox`) bekerja penuh.

Issue #477 menyimpulkan pertanyaannya bukan _"bagaimana mengisinya"_ melainkan **apakah ia perlu ada**, mengingat repo ini sudah punya outbox transaksional yang bekerja: `awcms_domain_events`, lengkap dengan dispatcher, DLQ, dan replay.

Jawabannya tidak.

## Keputusan

**Tabelnya dipensiunkan.** `awcms_sync_outbox` di-`DROP`, dan `POST /api/v1/sync/pull` membaca `awcms_domain_events` — outbox yang sudah ada, sudah diuji, dan sudah punya dispatcher.

**Replikasi adalah properti EVENT TYPE, bukan properti tabel.** `SYNC_REPLICABLE_EVENT_TYPES` (`sync-storage/domain/sync-replication.ts`) adalah allow-list eksplisit, dan ia **mendarat KOSONG**. Sebuah node ber-HMAC yang menerima seluruh isi `awcms_domain_events` adalah pelebaran akses, bukan penyambungan kabel: payload-nya milik modul mana pun, dan `redactEventPayloadForResponse` yang ada **tidak bisa dipakai ulang** untuk ini — ia menutupi `email`/`phone`/`nik`/`npwp`, yaitu justru field yang sebuah replika butuhkan, dan ia dipasang di permukaan admin ber-sesi, bukan di jalur ini.

Jadi perilaku hari ini tidak berubah: `/sync/pull` tetap menjawab `200` dengan daftar kosong. Yang berubah adalah **kenapa** ia kosong. Sebelumnya karena tidak ada jalur; sekarang karena ada kebijakan, kebijakan itu tertulis di satu tempat, dan mengubahnya adalah perubahan yang bisa direview.

### Kenapa allow-list-nya kosong dan bukan "diisi satu untuk membuktikan mekanismenya"

Karena mekanismenya **belum benar**, dan menemukan itu adalah hasil paling berharga dari issue ini.

`event_sequence` adalah `bigint GENERATED ALWAYS AS IDENTITY`: nilainya diberikan saat `INSERT`, tetapi barisnya baru terlihat saat `COMMIT`. Dua transaksi bisnis yang tumpang tindih karena itu bisa commit **tidak berurutan** terhadap sequence-nya. Sebuah pembaca ber-cursor `event_sequence > checkpoint` yang berjalan di antara keduanya akan melihat 101, memajukan checkpoint ke 101, dan **tidak akan pernah melihat 100** — kehilangan data yang senyap dan permanen, pada protokol yang tugasnya justru tidak kehilangan apa pun.

Bahaya itu **dorman** pada `awcms_sync_outbox` karena nol penulis. Ia menjadi **nyata** pada `awcms_domain_events`, yang ditulis tujuh call site produksi di dua modul, masing-masing di dalam transaksi bisnisnya sendiri.

Repo ini sudah punya jawaban yang benar untuk masalah itu, dan bukan cursor: `appendDomainEvent` menulis satu baris `awcms_domain_event_deliveries` **per consumer, di dalam transaksi yang sama dengan event-nya**. Baris pengiriman menjadi terlihat bersama event-nya, jadi pengklaim tidak pernah bisa melewati apa pun — tidak ada cursor untuk dilompati. Itulah yang membuat dispatcher-nya benar.

Replikasi sisi-node yang sungguh-sungguh karena itu harus menumpang mekanisme itu, bukan mengulang cursor. Rancangannya belum ditulis, dan ADR ini **tidak** berpura-pura menulisnya. Yang ia lakukan: menghapus tabel keduanya sehingga rancangan itu tidak lahir di atas fondasi yang salah, dan **menuliskan dua jebakan yang sudah ditemukan** supaya tidak ditemukan lagi:

1. **visibilitas commit** — sebuah cursor `event_sequence` tidak aman terhadap penulis konkuren; jendela lag berbasis waktu hanya memindahkan taruhannya ke `statement_timeout`, yang membatasi satu statement dan bukan satu transaksi;
2. **proyeksi payload** — replikasi butuh proyeksi per-event-type yang dideklarasikan modul pemiliknya, bukan redaksi generik: yang ada menutupi persis field yang perlu dikirim.

### Kenapa sekarang, dan kenapa gratis hari ini

Karena `last_pull_sequence` **setiap node di setiap deployment terbukti bernilai 0**: `pull.ts` menulis balik `newCheckpoint = sinceSequence` pada tiap panggilan, dan `events` selalu kosong. Tidak ada satu pun checkpoint yang perlu dimigrasi ketika sumber cursor berpindah tabel.

Itu berhenti benar pada hari pertama sebuah produsen menyala. Memindahkannya hari ini berharga satu `DROP TABLE`; memindahkannya nanti berharga pemetaan sequence lintas-tabel per node.

## Konsekuensi

Repo ini punya **satu** outbox transaksional untuk domain event, dan pengecualian yang dibenarkan tetap dicatat sebagai pengecualian ([ADR-0074](0074-push-delivery-is-a-second-outbox.md) menjelaskan kenapa `push_delivery` boleh punya miliknya sendiri — dispatcher-nya memanggil jaringan, yang dilarang di dalam transaksi klaim).

`awcms_sync_outbox` keluar dari `BOUNDED_BY_DESIGN` karena tabelnya tidak ada lagi; daftar itu kembali kosong, sebagaimana ia dirancang.

Migrasinya **menolak** alih-alih menghancurkan: ia menghitung baris lebih dulu dan `RAISE EXCEPTION` bila menemukan satu pun. Tabelnya terbukti kosong di repo ini, tetapi sebuah deployment yang entah bagaimana punya baris berhak dihentikan, bukan dibersihkan diam-diam.
