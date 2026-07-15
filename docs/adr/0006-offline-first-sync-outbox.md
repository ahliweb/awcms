# ADR-0006 — Offline-first + transactional outbox + sync HMAC

- **Status:** Accepted
- **Tanggal:** 2026-07-05
- **Terkait:** `docs/awcms/15_frontend_architecture_integration.md`, `docs/awcms/16_backend_data_access_integration.md`, `docs/awcms/10_template_kode_coding_standard.md` (§Sync HMAC)

## Konteks

Aplikasi turunan dapat berjalan di lingkungan LAN/offline. Alur operasional kritikal tidak boleh bergantung pada koneksi internet atau provider eksternal. Sinkronisasi antar-node dan pemanggilan provider harus andal tanpa mengorbankan konsistensi database.

## Keputusan

Kami memutuskan pola **offline-first**:

- **Transactional outbox** — domain event, pesan provider, dan payload sync ditulis dalam transaksi yang sama dengan perubahan data, lalu dikirim worker terpisah. Provider eksternal **tidak pernah** dipanggil di dalam DB transaction.
- **Sync HMAC** — push/pull antar-node ditandatangani `HMAC(timestamp.body)` dengan anti-replay (skew maks default 300 detik, timing-safe compare) dan idempotency (event duplikat aman).
- **Conflict manual** — konflik tidak diselesaikan otomatis; ditandai untuk resolusi manual + audit.

## Konsekuensi

- **Positif:** alur kritikal tahan gangguan koneksi; konsistensi DB terjaga; sync aman dari replay/duplikasi.
- **Trade-off:** perlu worker dispatcher, tabel outbox, dan mekanisme resolusi konflik.
- **Netral:** provider (R2, pesan) bersifat opsional via feature flag; fitur off tidak menghentikan aplikasi.

## Alternatif yang dipertimbangkan

- **Pemanggilan provider langsung di request/transaction** — ditolak: menautkan alur kritikal ke ketersediaan eksternal dan berisiko partial commit.
- **Auto-merge konflik** — ditolak: berisiko kehilangan/menimpa data tanpa jejak.
