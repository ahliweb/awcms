🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](0169-integration-hub-admission-is-unimplemented-and-the-provider-boundary-already-lives-in-domain-owned-ports-and-outboxes.md)

<!-- i18n-source-hash: sha256:b948c93b4a977770ba9b35bf3f640b9414d935c86670e4f15d5f57bbce39eae6 -->

# ADR-0169 — Admisi `integration_hub` belum diimplementasikan, dan batas provider sudah hidup di port dan outbox milik domain

- **Status:** Diterima (Accepted)
- **Catatan status (2026-11-22):** pemilik mendelegasikan Q1–Q3 ke orchestrator, yang memutuskannya seperti tercatat di bagian "Keputusan" di bawah (prioritas: skalabilitas, performa, keamanan).
- **Tanggal:** 2026-11-22
- **Pengambil keputusan:** ahliweb (pemilik), didelegasikan ke orchestrator pada 2026-11-22. ADR-0019 hanya berubah status (menjadi Deferred); teksnya dipertahankan sebagai sejarah.
- **Menyelesaikan (usulan):** Issue #1408
- **Mengamendemen (usulan):** [ADR-0019](0019-integration-hub-module-admission.md) (`integration_hub`, `Accepted (belum diimplementasikan)`)
- **Terkait:** [ADR-0006](0006-offline-first-sync-outbox.md), [ADR-0011](0011-capability-ports-for-cross-module-collaboration.md), [ADR-0013](0013-extension-layers-and-boundary-model.md) §6, [ADR-0034](0034-awcms-family-direct-use-templates-and-derived-pathway-removal.md), [ADR-0055](0055-development-confined-to-awcms-and-awcms-astro.md), [ADR-0074](0074-push-delivery-is-a-second-outbox.md), [ADR-0133](0133-generic-delivery-capability-whatsapp-promotion.md), [ADR-0148](0148-omnichannel-foundation-is-five-gated-capabilities-with-fail-closed-per-account-capability.md), [ADR-0150](0150-inbound-omnichannel-events-enter-as-verified-redacted-envelopes-with-no-generic-interactions-store.md), [ADR-0151](0151-mailketing-v2-and-multi-account-email-reuse-the-single-email-queue-and-never-trust-an-unauthenticated-callback.md), [ADR-0152](0152-customer-telegram-engagement-is-a-separate-admitted-context-telegram-delivery-stays-staff-only.md), [ADR-0154](0154-realtime-progress-is-sse-first-on-the-existing-bun-process-reading-durable-state-websocket-not-admitted.md); aturan template konsumen di `ahliweb/awcms-one` ADR-0017 (provider eksternal adalah port milik commerce dengan kredensial env dan webhook beralamat token)

## Konteks

ADR-0019 meng-admisi `integration_hub` sebagai modul System Foundation (webhook masuk bertanda tangan generik, langganan event keluar, kesehatan adapter). Audit `main@f80bf0e5` (2026-11-22):

1. **Belum diimplementasikan.** `src/modules/index.ts` tidak mendaftarkan `integration_hub`; tidak ada `src/modules/integration-hub/`, tabel `awcms_integration_hub_*`, maupun permission `integration_hub.*`. `tests/adr-admission-implementation-status.test.ts` sudah mengunci ADR ini sebagai "belum diimplementasikan".
2. **Provenance rusak.** ADR-0019 (EN dan ID) dan skill `awcms-integration-hub` menyebut "Issue #754" sebagai tracker implementasi. #754 ternyata **PR newsletter yang sudah di-merge** ("fix(newsletter): the subscribe endpoint would mail-bomb any address, one IP at a time"). Nomor itu diwarisi dari tracker `awcms-mini` yang diarsipkan (ADR-0055: arsip, bukan sumber port) dan bermakna lain di repo ini. Jadi #754 **bukan** tracker integration-hub, dan tidak ada isu di repo ini yang melacak hub.
3. **Kebutuhan dipenuhi sepotong-sepotong oleh pemilik domain.** Sejak ADR-0019 ditulis (2026-07-14), setiap batas provider yang nyata dibangun di tempat datanya hidup:

| Batas provider                 | Modul pemilik                              | Port / antrean                                                                | Masuk (inbound)                                                                                       |
| ------------------------------ | ------------------------------------------ | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Email (Mailketing, multi-akun) | `email`                                    | satu outbox email + dispatcher berlease (ADR-0151, ADR-0164)                  | callback tak pernah dipercaya tanpa autentikasi (ADR-0151)                                            |
| WhatsApp (Meta, StarSender)    | `whatsapp_delivery` + `channel_accounts`   | `WhatsAppDeliveryPort`, satu antrean per kanal (ADR-0133, ADR-0148)           | token buram per akun `wcb1.*` (`_shared/channel-webhook-token.ts`); payload tak pernah memilih tenant |
| Telegram                       | `telegram_delivery`, `telegram_engagement` | `TelegramDeliveryPort`, antrean sendiri (ADR-0140, ADR-0152)                  | secret timing-safe; hanya `/start` dan `/stop`                                                        |
| Web Push                       | `push_delivery`                            | outbox kedua (ADR-0074)                                                       | tidak berlaku                                                                                         |
| Object storage (R2)            | `sync_storage`, `media_library`            | antrean objek R2 (ADR-0006)                                                   | tidak berlaku                                                                                         |
| Social publishing              | `social_publishing`                        | `social-publishing-port`                                                      | tidak berlaku                                                                                         |
| Commerce / OMES                | `omes_control` dan template konsumen       | port milik commerce (`awcms-one` ADR-0017)                                    | webhook beralamat token                                                                               |
| Normalisasi omnichannel masuk  | `omnichannel_inbox`                        | envelope terverifikasi dan teredaksi, tanpa toko interaksi generik (ADR-0150) | lewat adapter pemiliknya                                                                              |

Masing-masing punya port, redaksi, semantik kegagalan per provider (`retry_after`, jalur tertahan, `NO_BINDING` tidak pernah jatuh ke kanal lain) dan gerbang CI. ADR-0133 dan ADR-0148 sengaja memilih **satu antrean per kanal**, dan ADR-0150 menolak toko interaksi generik: hub yang memusatkan kembali envelope bertentangan dengan keputusan setelah ADR-0019. 4. **Tabrakan nama itu nyata.** "Gateway" dan "hub" kini menamai beberapa hal berbeda (kosakata di bawah). Membangun runtime bernama `integration_hub` tanpa keputusan mengundang persis inferensi senyap yang diperingatkan Issue #1408.

## Kosakata (untuk menghentikan tabrakan)

| Istilah                                                                                  | Makna di repo ini                                                                                                                                                                                                 | Ada?                                                     | Pemilik                                    |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------ |
| **Abstraksi provider keluar**                                                            | Port milik domain (`WhatsAppDeliveryPort`, registri kategori email, push) beserta outbox/dispatcher domain itu; panggilan provider terjadi di worker berlease, **tidak pernah di dalam transaksi DB**             | Ya, per domain                                           | modul domain                               |
| **Ingress webhook masuk**                                                                | Rute publik yang memverifikasi secret/token/tanda tangan **sebelum kerja apa pun**, menurunkan tenant dari token (bukan payload), dedup lewat kunci unik DB, lalu menyerahkan envelope teredaksi ke modul pemilik | Ya, per domain (`wcb1.*`, secret Telegram, Mailketing)   | modul domain (helper bersama di `_shared`) |
| **API gateway** (rate limit, routing edge, WAF, ketahanan pihak ketiga di tepi jaringan) | Infrastruktur di depan aplikasi (edge cache, reverse proxy), bukan modul aplikasi                                                                                                                                 | Urusan deployment (`awcms-deploy`, edge cache)           | operasi, bukan modul                       |
| **Gateway realtime**                                                                     | Aliran SSE Bun yang membaca state durable dan mengotorisasi ulang tiap tick (ADR-0154, ADR-0075, #1168/#1171); WebSocket belum diadmisi                                                                           | Ya (`whatsapp.sender.progress`, `inbox.status.progress`) | modul pemilik topik lewat `_shared/sse-*`  |
| **`integration_hub` (ADR-0019)**                                                         | Modul **envelope ingress + langganan keluar** generik, netral-provider, dengan kesehatan adapter                                                                                                                  | **Tidak**                                                | belum diputuskan (ADR ini)                 |

Dua yang pertama ada sebagai **pola**, bukan modul. Hanya baris terakhir yang dipertanyakan, dan ia bukan gateway maupun abstraksi provider.

## Opsi

### A. Pakai ulang port dan outbox milik domain (default yang direkomendasikan)

Tanpa modul baru. Setiap provider baru adalah port milik domain, antrean sendiri dan ingress beralamat token, mengikuti tabel di atas dan helper bersama (`channel-webhook-token.ts`, `redaction.ts`, penjaga SSRF yang sudah dipakai `tenant_domain` dan `seo_distribution`). Kebutuhan lintas-domain (konsumen kedua dari mekanisme yang sama) dipenuhi dengan mempromosikan helper ke `_shared` beserta gerbang CI, seperti ADR-0133 untuk WhatsApp, bukan dengan modul runtime.

### B. Hub generik opsional: registri ingress dan envelope langganan keluar (ADR-0019, dipersempit)

Bangun `integration_hub` hanya untuk yang tidak dicakup pemilik domain mana pun: **langganan event keluar yang dikonfigurasi tenant** (tenant atau sistem eksternal diberi tahu saat event domain terjadi, ke `target_url` yang diberikan tenant) dan **endpoint masuk bertanda tangan generik untuk sistem yang bukan provider sebuah domain** (misalnya sistem LAN yang mengirim fakta). Ia hanya memiliki status pengiriman dan payload mentah berumur pendek, tidak pernah data bisnis final (ADR-0013 §6), dan tidak boleh menggantikan antrean mana pun di tabel di atas.

### C. Layanan terpisah (di luar base)

Deployable terpisah (control plane SaaS atau produk manajemen API) di depan provider. Bukan opsi base: menambah runtime kedua, database kedua atau kopling DB bersama, dan bertentangan dengan sikap Bun-only satu-proses serta ADR-0034 pakai-langsung. Tetap sah bagi konsumen hilir yang sudah menjalankan layanan semacam itu, sebagai klien kontrak OpenAPI/AsyncAPI publik base (ADR-0013 §6, baris SaaS Control Plane).

## Matriks keputusan

| Dimensi                             | A. Pakai ulang port/outbox domain                                         | B. Hub generik opsional                                                                                                                                                                                  | C. Layanan terpisah                                   |
| ----------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| **Pemilik**                         | tiap modul domain (CODEOWNERS: ahliweb)                                   | modul `integration_hub` baru                                                                                                                                                                             | operator hilir                                        |
| **Kontrak API**                     | OpenAPI per domain yang ada; tanpa permukaan baru                         | `/api/v1/integration-hub/*` baru (endpoint, langganan, pengiriman, kesehatan) ditambah satu rute masuk publik; sinkron OpenAPI wajib                                                                     | kontrak publik base, dipakai sebagai klien            |
| **Kontrak event**                   | AsyncAPI per domain seperti sekarang                                      | event `integration_hub.*` baru; langganan menyebar dari `domain_event_runtime` SETELAH commit                                                                                                            | tidak ada di dalam base                               |
| **Offline/LAN**                     | tak berubah: tiap domain menurun menurut aturannya sendiri                | inti offline-lan-safe (ADR-0019 §5); keluar hanya butuh tujuan terjangkau; tujuan mati tidak pernah memblokir transaksi sumber                                                                           | tidak berlaku offline                                 |
| **Tenancy**                         | sudah tenant-scoped, FORCE RLS per domain                                 | tiap tabel `tenant_id` + FORCE RLS; ingress publik menurunkan tenant hanya dari token buram lewat fungsi `SECURITY DEFINER` sempit (preseden: `sql/033`, `sql/217`)                                      | tidak ada; isolasi lintas-tenant jadi urusan operator |
| **Secret / SSRF**                   | referensi env per provider; penjaga dipakai ulang                         | `secret_reference` hanya `env:VAR`, tidak pernah secret mentah; `target_url` keluar lolos penjaga daftar-blokir di **setiap lompatan redirect** dan pada IP hasil resolusi; tak ada rahasia di log/audit | di luar cakupan                                       |
| **Semantik kegagalan**              | per provider (`retry_after`, jalur tertahan, tanpa fallback lintas kanal) | retry/backoff/dead-letter/circuit-breaker generik; replay aman lewat keunikan `(tenant_id, endpoint_id, replay_key)`; tidak pernah panggilan provider di dalam transaksi (ADR-0006)                      | milik layanan itu                                     |
| **Biaya / risiko**                  | terendah; paling buruk menduplikasi helper                                | permukaan keamanan tertinggi di modul base mana pun; satu registri lagi di `modules:dag:check`                                                                                                           | runtime dan beban operasional baru                    |
| **Risiko tabrakan nama**            | tidak ada                                                                 | tinggi kecuali dinamai sesuai kosakata di atas                                                                                                                                                           | tidak berlaku                                         |
| **Cocok dengan ADR-0133/0148/0150** | ya                                                                        | hanya bila tidak pernah memiliki antrean provider                                                                                                                                                        | ya                                                    |

## Rekomendasi

**Opsi A adalah default.** Rekonsiliasi ADR-0019 sebagai berikut (sudah diputuskan, lihat "Keputusan"): statusnya berpindah dari `Accepted (belum diimplementasikan)` ke keadaan ditangguhkan, dan hub generik diadmisi **kembali** (ADR admisi baru) hanya bila Definition of Ready di bawah terpenuhi. Opsi B dipertahankan sebagai bentuk admisi mendatang itu, dipersempit ke langganan keluar dan ingress non-provider. Opsi C bukan opsi base.

Soal apakah hub masih dibenarkan: pada bukti hari ini, **tidak**. Tidak ada konsumen bernama, tidak ada tracker yang valid, dan domain yang butuh batas provider membangunnya tanpa hub.

### Definition of Ready untuk `integration_hub` mendatang (Opsi B)

1. Isu tracker **di repo ini** (bukan #754) yang menyebut sekurangnya **dua konsumen konkret** yang tidak bisa dilayani port milik domain mana pun, beserta tipe event dan sistem tujuan.
2. ADR admisi baru (ADR-0055 §3: ADR wajib, review keamanan, `bun run check` penuh) yang memeriksa ulang matriks ini dan menyatakan apa yang tetap milik domain.
3. Jawaban atas Q3 di atas untuk konsumen itu (modul base atau template konsumen).
4. Review keamanan sebelum merge (verifikasi masuk, SSRF termasuk redirect dan DNS rebinding, referensi secret, keunikan replay).
5. Deskriptor `domain_event_runtime` dan `data_lifecycle` untuk payload mentah dan riwayat pengiriman.
6. Saklar nonaktif fail-closed (mati secara default; mati berarti `404`), seperti ADR-0148 dan ADR-0154.

### Kriteria rollout (bila pernah dibangun)

Dikirim inert di balik saklar; hanya skema fixture (tanpa provider nyata); dispatch keluar sebagai worker berlease terpisah dengan batch terbatas dan entri anggaran query; satu tenant pilot dengan konsumen nyata; dipromosikan hanya setelah probe SSRF dan replay ada di CI dan decision log tidak menunjukkan baca lintas-tenant; tidak ada pemindahan antrean domain yang ada ke hub tanpa ADR terpisah.

## Keputusan (2026-11-22, didelegasikan pemilik ke orchestrator)

- **Q1 — ADR-0019 menjadi `Deferred` (Ditangguhkan)** (bukan dicabut); ADR ini menjadi `Accepted`. Keputusan lama tetap terbaca sebagai sejarah dan opsinya tetap terbuka tanpa biaya.
- **Q2 — Tidak ada konsumen bernama hari ini, jadi hub tidak dibangun.** Tidak ada tracker, modul, migrasi, permission, atau layanan yang dibuat.
- **Q3 — Bila kelak ada konsumen,** hub dinilai lewat ADR admisi baru (Opsi B di atas, atau dimiliki template konsumen, seperti `awcms-one` ADR-0017 untuk commerce). Pilihan itu **tidak diambil sekarang**.

Alasan yang dicatat (prioritas: skalabilitas, performa, keamanan):

- Port dan outbox milik domain dapat diskalakan dan dibatasi **per provider secara independen**; hub adalah satu titik antrean.
- Hub menambah satu lompatan dan serialisasi di setiap panggilan provider.
- Hub memusatkan secret dan permukaan SSRF lintas provider (radius dampak besar).
- Menangguhkan menjaga opsi tanpa biaya.

## Koreksi provenance (sejarah dipertahankan, tidak dihapus)

- ADR-0019 EN/ID dan `.claude/skills/awcms-integration-hub/SKILL.md`/`.id.md`: "Issue #754" adalah nomor tracker `awcms-mini` yang diarsipkan; di repo ini #754 adalah PR newsletter yang tak terkait dan sudah di-merge. Dokumen-dokumen itu membawa catatan provenance bertanda (PR ini) dan selebihnya tetap dibaca sebagai spesifikasi arsip.
- Bila ADR-0019 menyebut "Wave A" dari `absorb-awcms-mini-backbone-roadmap.md`, roadmap itu historis (ADR-0055); ia bukan antrean kerja.

## Konsekuensi

- **Positif:** Tidak ada runtime yang disimpulkan dari label status; tracker palsu tidak lagi terbaca sebagai pekerjaan aktif; batas provider tetap pada pemilik data; satu tabel memisahkan beberapa makna "gateway/hub".
- **Negatif/trade-off:** Bila kebutuhan langganan lintas-domain yang nyata muncul, ia menunggu ADR admisi baru.
- **Netral:** Tanpa perubahan kode, migrasi, layanan atau database. ADR-0019 berpindah ke Deferred; teksnya tidak disentuh.

## Alternatif yang dipertimbangkan

Lihat Opsi A–C di atas.
