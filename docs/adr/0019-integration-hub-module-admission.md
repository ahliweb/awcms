# ADR-0019 — Admission of `integration_hub` as a System Foundation module

- **Status:** Accepted
- **Tanggal:** 2026-07-14
- **Pengambil keputusan:** @ahliweb
- **Terkait:** Issue #754 (epic #738 `platform-evolution`, Wave 3), Issue #742/#745 (`domain_event_runtime`, `data_lifecycle` — keduanya dependency), Issue #739/ADR-0013 §1/§6 (pre-klasifikasi `integration_hub` sebagai System Foundation kandidat + data-ownership matrix), `docs/awcms/21_module_admission_governance.md`, `docs/awcms/templates/module-proposal-template.md`

## Konteks

ADR-0013 §1 sudah mem-pre-klasifikasikan `integration_hub` sebagai kandidat **System Foundation** untuk epic #738, dan §6 (data-ownership matrix) sudah menyatakan batasnya secara eksplisit: modul ini memiliki **status pengiriman envelope inbound/outbound (staging/inbox/outbox) — bukan data bisnis final**, berkolaborasi dengan modul pemilik data lewat capability port/API publik-internal. Issue #754 sendiri secara eksplisit mensyaratkan sebagai acceptance criterion pertama: "Admission decision/ADR confirms category, owner, dependencies, offline behavior, and adapter ownership rules" — ADR ini memenuhi syarat itu dengan mengisi format `module-proposal-template.md` inline, mengikuti preseden ADR-0016 (`organization_structure`, Issue #749) yang juga menulis ADR admission tersendiri karena issue-nya secara eksplisit memintanya (berbeda dari #742/#743 yang mengandalkan pre-klasifikasi ADR-0013 saja, tanpa ADR/doc 21 §8 terpisah).

Modul ini bergantung pada dua modul System Foundation lain yang sudah _merged_ di epic yang sama: **#742 `domain_event_runtime`** (normalisasi pesan inbound terverifikasi menjadi domain event versi, dan fan-out pengiriman outbound dipicu SETELAH commit sumber lewat mekanisme outbox/dispatcher yang sama) dan **#745 `data_lifecycle`** (kebijakan retensi/minimisasi/legal-hold untuk payload mentah inbound dan riwayat pengiriman outbound).

## Keputusan

Kami memutuskan untuk mengadmisi `integration_hub` sebagai modul baru di registry base ini dengan parameter berikut:

### 1. Nama & key modul

- Nama: **Integration Hub**
- `key`: `integration_hub`
- Kategori: **System** (= lapisan ADR-0013 "System Foundation")

### 2. Masalah/kebutuhan

AWCMS sudah punya integrasi provider spesifik di dalam modul pemiliknya masing-masing (Mailketing di `email`, R2 di `sync_storage`/`news_portal`, Cloudflare DNS di `tenant_domain`, Telegram/Meta di `social_publishing`) dan beberapa pola outbox/worker yang andal. Yang belum ada adalah **batas integrasi generik, provider-netral**: webhook inbound bertanda tangan (signature verification + replay protection), penerjemahan payload provider-spesifik menjadi bentuk domain-event repo ini sendiri (lewat #742), langganan event outbound (sistem/tenant lain diberi tahu ketika sebuah event terjadi, dengan pengiriman andal), kesehatan adapter (up/down/degraded), dan retry/replay operator yang aman dari duplikasi. Ini kebutuhan lintas-modul (setiap modul yang punya provider eksternal butuh mekanisme sinyal inbound dan langganan outbound yang sama), bukan fitur produk tenant yang berdiri sendiri — persis definisi §2 doc 21 untuk kategori System.

### 3. Mengapa ini System, bukan Official Optional Module atau Derived Application

Lolos pohon keputusan §3 doc 21: Q1 (wajib boot?) → Tidak. Q2 (infrastruktur/reusable lintas-modul, bukan fitur produk berdiri sendiri?) → **Ya** — webhook signature verification, replay protection, dan pengiriman outbound andal adalah mekanisme generik yang SETIAP modul dengan provider eksternal butuh, bukan nilai bisnis langsung untuk end-user tenant (beda dari `blog_content`/`news_portal`/`organization_structure` yang punya nilai produk langsung). Ini konsisten dengan ADR-0013 §1's pre-klasifikasi eksplisit dan §6's batas data ("status pengiriman envelope ... bukan data bisnis", sama seperti `domain_event_runtime`/`data_lifecycle`).

### 4. Dependency

- **Lifecycle dependency** (`ModuleDescriptor.dependencies`, wajib aktif duluan): `["tenant_admin", "identity_access", "domain_event_runtime"]`. `tenant_admin` untuk batas tenant (`awcms_tenants`), `identity_access` untuk RBAC/ABAC + audit actor, `domain_event_runtime` karena modul ini adalah REAL producer (menerjemahkan pesan inbound terverifikasi menjadi event via `appendDomainEvent`) DAN real consumer (fan-out langganan outbound dipicu oleh dispatcher #742) — pola yang sama seperti `workflow_approval` (#747) dan `organization_structure` (#749), bukan pola Core `profile_identity` (#748) yang sengaja tidak mengimpor konstanta lintas-modul.
- **Data lifecycle contract** (`ModuleDescriptor.dataLifecycle`, #745): modul ini mendaftarkan deskriptor untuk payload inbound mentah (retensi pendek, `retentionClass: "communication_log"`) dan riwayat pengiriman outbound — **bukan** lifecycle dependency (tidak butuh `data_lifecycle` enabled lebih dulu; mesin `data_lifecycle` membaca deskriptor lewat `listModules()` kapan saja, sama seperti `logging`/`visitor_analytics`/`form_drafts` mendaftarkan deskriptor tanpa menambah `data_lifecycle` ke `dependencies`).
- **Capability dependency** (`ModuleDescriptor.capabilities`, ADR-0011): `integration_hub` **PROVIDES** `integration_adapter_registration` — sebuah capability port (`_shared/ports/integration-adapter-port.ts`) yang modul pemilik provider di masa depan (mis. `email` ingin memproses bounce webhook, `social_publishing` ingin memverifikasi webhook Meta) bisa implementasikan untuk mendaftarkan skema verifikasi/normalisasi provider mereka sendiri — **hub ini sendiri tidak pernah mengimpor internal modul adapter manapun**, hanya port yang didefinisikan di `_shared`. Modul ini tidak mendaftarkan `capabilities.consumes` apa pun — modul adapter masa depan yang akan consume port ini, bukan sebaliknya.

### 5. Kompatibilitas offline/LAN vs full-online-only

- Kelas kompatibilitas: **offline-lan-safe** untuk mekanisme intinya (endpoint registry, penerimaan+verifikasi webhook, replay protection, penyimpanan langganan, worker dispatch outbound berbasis PostgreSQL) — tidak ada dependency provider eksternal WAJIB. Endpoint inbound `POST /api/v1/integration-hub/inbound/{endpointToken}` hanya bermakna bila ADA pemanggil eksternal yang mengirim webhook (LAN tanpa internet tetap bisa menerima webhook dari sistem LAN lain), dan dispatch outbound ke `target_url` tenant-terkonfigurasi memerlukan konektivitas jaringan HANYA ke tujuan itu sendiri (bukan dependency wajib platform) — provider/tujuan mati tidak pernah memblokir transaksi sumber (item #4 checklist keamanan issue ini, ADR-0006).
- Dua skema signature fixture yang dikirim modul ini (`fixture_hmac_sha256`, `fixture_shared_secret_nonce`) adalah referensi self-contained (mengikuti preseden "foundation issue ships zero real business integrations" — #643, #742) — bukan integrasi provider nyata, sehingga tidak memerlukan kredensial/koneksi eksternal apa pun untuk berfungsi/diuji.

### 6. Provider eksternal

Tidak ada provider eksternal SPESIFIK yang dipanggil langsung oleh modul ini (di luar scope, lihat issue). Modul ini menyediakan MEKANISME generik (adapter/signature-scheme registry, port kapabilitas, klien HTTP outbound dengan proteksi SSRF) yang modul pemilik provider spesifik masa depan akan gunakan — modul ini sendiri tidak pernah memanggil API provider bisnis spesifik manapun (Meta, Telegram, Mailketing, dst.) secara langsung, hanya `fetch()` generik ke `target_url` yang dikonfigurasi tenant untuk langganan outbound, dan hanya menerima (bukan memanggil keluar) untuk webhook inbound.

### 7. Security & data governance

- Data yang disentuh: metadata pengiriman webhook (status verifikasi, hash/ukuran payload, snippet payload TERBATAS dan hanya untuk pengiriman yang lolos verifikasi tanda tangan), konfigurasi langganan outbound (URL tujuan, filter, tanpa menyimpan secret mentah — hanya `secret_reference` berupa pointer `env:VAR_NAME`), status kesehatan adapter.
- ABAC: default-deny, permission key baru per resource (`integration_hub.endpoints.*`, `.subscriptions.*`, `.deliveries.*`, `.health.*`) — lihat migration permission seed.
- High-risk action yang wajib audit + `Idempotency-Key`: membuat/menghapus endpoint inbound, rotasi secret, membuat/menghapus langganan outbound, replay pengiriman outbound yang gagal, pause/resume adapter.
- Endpoint inbound webhook itu sendiri diamankan lewat signature verification + replay protection (item #2/#3 checklist keamanan issue ini), BUKAN `Idempotency-Key` header konvensional (provider eksternal yang mengontrol request itu, bukan konsumen API kita) — dedup dilakukan lewat DB unique constraint `(tenant_id, endpoint_id, replay_key)`.
- RLS predicate setiap tabel baru modul ini selalu dan hanya `tenant_id`.
- Payload/secret mentah tidak pernah masuk log/audit mentah (redaction wajib, mengikuti `_shared/redaction.ts`).

### 8. Ownership

`@ahliweb` (mengikuti `.github/CODEOWNERS`, sama seperti seluruh modul lain).

### 9. Rencana deprecation

Tidak relevan — modul baru, tidak menggantikan modul/fitur lain yang ada.

### 10. Alternatif yang dipertimbangkan

- **Membangun webhook/langganan sebagai bagian dari `domain_event_runtime` itu sendiri** — ditolak: #742 sengaja dibatasi ke mekanisme outbox/dispatcher SAMA-PROSES/DB-only generik tanpa I/O eksternal (lihat README #742 §"Execution model" — CALL di luar transaksi butuh shape lease-based 3-fase yang BERBEDA dari model #742 hari ini). Memisahkan `integration_hub` sebagai modul sendiri menjaga #742 tetap sederhana dan menghindari mencampur "mekanisme outbox generik" dengan "keamanan batas jaringan eksternal" (signature verification, SSRF, secret rotation) — dua concern yang berbeda.
- **Setiap modul adapter (email/social_publishing/dst.) membangun webhook/replay protection sendiri-sendiri** — ditolak: menduplikasi HMAC timing-safe verification, replay-key DB uniqueness, dan retry/backoff/DLQ/circuit-breaker di setiap modul provider adalah persis masalah yang mendorong #742/#745 dibangun sebagai fondasi bersama — pola yang sama berlaku di sini.
- **Menjadikan `integration_hub` Official Optional Module (opt-in per tenant, seperti `blog_content`)** — ditolak: ini infrastruktur reusable lintas-modul murni (§2 doc 21), bukan fitur bisnis end-user berdiri sendiri — kriteria yang sama yang menempatkan `domain_event_runtime`/`data_lifecycle` di kategori System, bukan Official Optional Module.
- **Modul ini langsung memanggil API provider bisnis spesifik (mis. verifikasi langsung ke Meta Graph API)** — ditolak secara eksplisit oleh scope issue #754 ("Provider-specific business adapters implemented in the generic hub" = out of scope) dan oleh ADR-0013 §6 (data final tetap dimiliki modul bisnis pemiliknya) — modul ini hanya menyediakan port + mekanisme generik, dua skema fixture self-contained untuk membuktikan mekanismenya bekerja end-to-end.

## Konsekuensi

- **Positif:** Modul provider masa depan (email bounce webhook, social_publishing inbound webhook Meta/Telegram, dsb.) punya mekanisme signature-verification/replay-protection/outbound-subscription siap pakai lewat capability port, tanpa membangun ulang HMAC/replay/circuit-breaker sendiri-sendiri.
- **Positif:** Batas "envelope staging vs data bisnis final" ADR-0013 §6 sekarang punya implementasi konkret pertama yang membuktikan aturan itu bisa ditegakkan (hub ini tidak pernah memiliki data bisnis final, hanya status pengiriman + payload mentah bertenggat pendek).
- **Negatif/trade-off:** Modul ke-18 di registry menambah permukaan yang harus lolos `modules:dag:check`/`modules:compose:check` setiap kali registry berubah — mitigasi: dependency dideklarasikan minimal (`tenant_admin`, `identity_access`, `domain_event_runtime`), tidak ada capability `consumes` yang bisa menciptakan cycle (hanya `provides`).
- **Netral:** `docs/awcms/21_module_admission_governance.md` §8 diperbarui menambah baris ke-18 (lihat PR ini).

## Alternatif yang dipertimbangkan

Lihat §10 di atas (digabung ke dalam format proposal template inline, bukan diulang di sini).
