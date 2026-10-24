🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](bun-delivery-realtime-runtime.md)

<!-- i18n-source-hash: sha256:dca82705a2f681c3ccd6daf859b087a0fae91567668584b27d6b4ababeaf5d11 -->

# Standar runtime pengiriman dan real-time AWCMS — Bun-only (usulan)

> Standar implementasi rancangan, **bukan** bukti fitur WebSocket sudah berjalan. [Issue #1167](https://github.com/ahliweb/awcms/issues/1167) · keputusan desain [#1168](https://github.com/ahliweb/awcms/issues/1168) · 24 Oktober 2026.

## Otoritas, runtime dan transport

[ADR-0002](../adr/0002-bun-only-runtime.id.md) **sudah Accepted**. `package.json` menetapkan `bun@1.4.4`. Seluruh HTTP service, dispatcher pengiriman, job terjadwal/outbox serta gateway event real-time yang **dimiliki AWCMS** **WAJIB memakai Bun versi repo**. Jangan menjalankan proses Node.js, server npm/pnpm/yarn, layanan `ws`/Socket.IO yang mensyaratkan Node, dispatcher bahasa lain atau sidecar broadcast baru tanpa ADR yang disetujui. Import `node:*` kompatibel Bun dan adapter `@astrojs/node` **yang dijalankan di Bun** tetap diperbolehkan.

**Bedakan transport:** email = antrean `email` → worker Bun `email:dispatch` → adapter Mailketing/transport yang diizinkan; WhatsApp = antrean `whatsapp_delivery` → worker Bun `whatsapp:dispatch` → API HTTPS Meta/Fonnte dan StarSender yang masih direncanakan; Web Push = antrean `push_delivery` → worker Bun `push:dispatch` → layanan push/FCM. Telegram saat ini untuk notifikasi staf; dukungan pelanggan/publikasi masih direncanakan. **WebSocket bukan cara mengirim email/WhatsApp ke provider.** Webhook provider yang diautentikasi masuk melalui HTTPS dan disimpan secara tahan lama sebelum diproyeksikan ke dashboard.

| Area                              | Kondisi upstream `main` yang terverifikasi                                       | Standar target                                                                                                                 |
| --------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `email`, Mailketing v1            | Antrean/dispatcher Bun, template dan kontrol suppression tersedia                | Tetap satu antrean email; integrasi marketing CRM wajib memakai Bun; Mailketing v2 masih direncanakan                          |
| `whatsapp_delivery`               | Antrean Bun, provider `log/fonnte/meta`, token masih per deployment              | Tetap satu antrean/worker Bun; multi-nomor/StarSender direncanakan [#1141–#1143](https://github.com/ahliweb/awcms/issues/1141) |
| `push_delivery`                   | Antrean/dispatcher Bun dan Web Push/FCM tersedia                                 | Server job memakai Bun; Service Worker browser bukan proses Node                                                               |
| `telegram_delivery`               | Notifikasi staf terkontrol sudah ada                                             | Multi-bot/pelanggan akan diimplementasikan terpisah di Bun                                                                     |
| Kampanye CRM dan publikasi sosial | Kampanye commerce sudah ada; adapter sosial dan registry multi-akun direncanakan | Outbox/dispatcher Bun, tidak memanggil provider dari transaksi database                                                        |
| Real-time unified inbox/status    | **Gateway WebSocket Bun generik belum terbukti ada**                             | Butuh ADR [#1168](https://github.com/ahliweb/awcms/issues/1168) sebelum implementasi                                           |

## Pemilihan protokol real-time Bun (menunggu ADR)

1. **Utamakan SSE Bun** yang diautentikasi untuk status satu arah: progres kampanye, pesan baru, pekerjaan/notifikasi dan peringatan. Rekoneksi memakai cursor/`Last-Event-ID` atau snapshot REST terotorisasi.
2. Pilih **WebSocket native `Bun.serve`** hanya untuk kebutuhan dua arah yang jelas, setelah kompatibilitas dengan server Astro/Bun standalone dibuktikan. API `WebSocket` di browser adalah klien dan boleh dipakai.
3. Polling HTTPS tetap fallback yang valid. Aliran event tidak otoritatif; PostgreSQL outbox dan audit tetap sumber kebenaran. Pub/sub WebSocket in-memory Bun hanya berlaku di proses itu; beberapa instance memerlukan fan-out terkoordinasi/terbukti. Event WS tidak boleh membuat email dianggap delivered.
4. Uji TLS/proxy HTTP/1.1 untuk upgrade WS; tidak mengklaim dukungan WS HTTP/2. Verifikasi Origin dan aktor; topik harus dibatasi tenant/akun/kampanye/role. Browser tidak bisa mengirim header Authorization sembarang saat handshake WS, sehingga gunakan tiket singkat sekali pakai atau mekanisme session yang telah disetujui; jangan taruh bearer jangka panjang pada URL/log. Cabut langganan ketika izin dicabut.
5. `tenant_id`/sender bersumber dari server, bukan pilihan nama topik browser. Envelope berversi, berukuran terbatas, reda PII (tanpa daftar penerima, API key, OTP atau isi percakapan privat), memiliki correlation/sequence dan replay/snapshot berizin.
6. Terapkan batas koneksi, kuota tenant, heartbeat, payload limit, backpressure serta pemutusan klien lambat. Uji proxy, rekoneksi, tab baru, iOS background/browser ditutup; **SSE/WS tidak menjadi Web Push saat browser ditutup**.
7. Observabilitas: agregat koneksi per tenant tanpa PII, event hilang, replay/queue lag, penolakan auth, diterima provider vs benar-benar delivered, restart dan stale/unknown.
8. **Jangan jadikan gateway realtime sebagai runtime agent kedua atau privileged listener OMES.** Worker host OMES tetap memakai HTTPS polling keluar dengan tanda tangan (ADR-0027); Hermes memiliki runtime sendiri.

## Acceptance test dan issue terkait

- Validasi `process.execPath` Bun pada tes worker, audit manifest launch/Docker untuk mencegah Node/npm/pnpm/yarn; `node:crypto` atau adapter Astro yang berjalan di Bun **bukan pelanggaran**.
- Dua tenant banyak sender: pesan masuk antrean sekali, consent/izin diperiksa lagi sebelum kirim, provider dipanggil di luar transaksi, idempotensi, batas frekuensi dan tanpa fallback provider diam-diam.
- SSE/WS mendatang: akses beda tenant/peran, tiket kadaluarsa, Origin tidak sah, izin dicabut, klien lambat, iOS background, restart broker, multi-instance, status unknown dan replay terotorisasi.
- Update OpenAPI/AsyncAPI dan dokumen EN/ID saat fitur nyata masuk. Jalankan `bun test`, `bun run check`, tes DB/integrasi, dan audit runtime sesuai repo; jangan tulis ulang migrasi atau edit manual `bun.lock`.
- Pelacakan upstream [#1139](https://github.com/ahliweb/awcms/issues/1139), [#1140](https://github.com/ahliweb/awcms/issues/1140), [#1141](https://github.com/ahliweb/awcms/issues/1141), [#1142](https://github.com/ahliweb/awcms/issues/1142), [#1143](https://github.com/ahliweb/awcms/issues/1143), [#1144](https://github.com/ahliweb/awcms/issues/1144), [#1155](https://github.com/ahliweb/awcms/issues/1155), [#1158](https://github.com/ahliweb/awcms/issues/1158), [#1164](https://github.com/ahliweb/awcms/issues/1164), [#1165](https://github.com/ahliweb/awcms/issues/1165). Konsumen [AWCMS-One #458](https://github.com/ahliweb/awcms-one/issues/458), [#459](https://github.com/ahliweb/awcms-one/issues/459), [#460](https://github.com/ahliweb/awcms-one/issues/460), [#461](https://github.com/ahliweb/awcms-one/issues/461), [#430–#432](https://github.com/ahliweb/awcms-one/issues/430).

**Referensi Bun:** [WebSocket](https://bun.com/docs/runtime/http/websockets), [SSE](https://bun.com/guides/http/sse), [HTTP server](https://bun.com/docs/runtime/http/server). Saat implementasi, validasi kompatibilitas fitur dengan Bun 1.4.4 yang dipin.

## Issue implementasi konkret (2026-10-24)

- [#1170](https://github.com/ahliweb/awcms/issues/1170): audit dan tes manifest/job/kontainer memakai binary Bun yang dipin, tanpa salah menolak import `node:*` yang dijalankan Bun.
- [#1171](https://github.com/ahliweb/awcms/issues/1171): implementasi SSE-first/WebSocket native Bun **setelah** ADR [#1168](https://github.com/ahliweb/awcms/issues/1168) disetujui; jangan mengklaim gateway sudah berjalan.
- [AWCMS-One #469](https://github.com/ahliweb/awcms-one/issues/469): pengujian runtime template/deployment/commerce, tanpa fork `apps/cms` upstream.
