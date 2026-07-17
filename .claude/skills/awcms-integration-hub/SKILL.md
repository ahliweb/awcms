---
name: awcms-integration-hub
description: BACAAN SAJA — modul integration_hub BELUM di-port ke repo ini (ada di awcms-mini; `ls src/modules` tidak memuat `integration-hub`, tidak ada migration-nya di `sql/`). Rujukan modul/tabel/adapter di dalamnya adalah artefak awcms-mini. Pakai sebagai spesifikasi target saat MEM-PORT (via `awcms-port-from-mini`), bukan panduan implementasi kode yang bisa dipanggil — verifikasi `ls src/modules` dulu. Konteks port (Issue #754, epic platform-evolution #738 Wave 3). Gunakan saat menambah inbound webhook endpoint, outbound event subscription, adapter provider baru, atau mengubah SSRF guard/replay protection/circuit-breaker/secret-reference validation. Modul ini punya security surface tinggi (2 findings PR #784 sebelum merge) — merangkum invariant yang wajib dipertahankan supaya tidak diregresi.
---

# AWCMS — Integration Hub Module

> **STATUS — BACAAN SAJA: modul ini BELUM di-port ke repo ini.**
> `integration_hub` ada di **awcms-mini**, bukan di sini: `ls src/modules`
> TIDAK memuat `integration-hub`, dan `sql/` tidak memuat migration-nya.
> Semua rujukan `src/modules/integration-hub/...`, tabel
> `awcms_integration_hub_*`, dan ADR-0019 di bawah adalah artefak
> awcms-mini — **jangan `import`/`SELECT`/mengklaim ada** di repo ini. Pakai
> skill ini sebagai spesifikasi target port (via `awcms-port-from-mini`),
> bukan peta kode yang bisa dipanggil. Verifikasi `ls src/modules` sebelum
> mengklaim apa pun ada.

`integration_hub` (`src/modules/integration-hub`, Issue #754, epic
`platform-evolution` #738 Wave 3, `type: "system"` — ADR-0013 §1/§6, admission
decision `docs/adr/0019-integration-hub-module-admission.md`) adalah
**generic, provider-neutral integration boundary**: signed inbound webhook
(HMAC + replay protection lewat DB uniqueness constraint nyata), normalized
event (via `domain_event_runtime`), outbound event subscription (delivery
reliable dengan retry/dead-letter), dan provider health tracking — mekanisme
yang HARUSNYA sudah dipakai ulang tiap modul provider-owning baru
(Mailketing/`email`, R2/`sync_storage`+`news_portal`, Cloudflare DNS/
`tenant_domain`, Telegram/Meta/`social_publishing`) daripada masing-masing
reinvent. Baca `src/modules/integration-hub/README.md` untuk detail lengkap.

## Kapan pakai skill ini vs skill generik

Melengkapi (bukan menggantikan) `awcms-integration` (ADR-0006 outbox
generik), `awcms-sync-hmac` (pola HMAC/timing-safe compare yang
sudah ada duluan di `sync_storage`), `awcms-idempotency`,
`awcms-abac-guard`. Skill ini menyediakan konteks security-invariant
spesifik modul ini — terutama SSRF guard yang sudah ketemu bug redirect
bypass sebelum merge, jadi jangan re-derive validasinya dari nol.

## Apa yang modul ini TIDAK PERNAH lakukan

- **Tidak** memanggil API provider bisnis spesifik apa pun — tidak ada
  panggilan HTTP Meta/Telegram/Mailketing di modul ini, hanya `fetch()`
  generik ke `target_url` yang dikonfigurasi tenant (outbound) dan
  penerimaan pasif webhook (inbound). Mapping/credential provider-spesifik
  tetap dimiliki modul yang punya kapabilitas itu, lewat
  `_shared/ports/integration-adapter-port.ts`.
- **Tidak** mengirim adapter bisnis nyata — hanya dua skema signature
  fixture self-contained (`fixture_hmac_sha256`,
  `fixture_shared_secret_nonce`) dan satu adapter outbound HTTP generik
  (`generic_http_webhook`) — pola "foundation issue kirim nol integrasi
  bisnis nyata" yang sama dengan #643/#742.
- **Tidak** memanggil provider di dalam transaksi database — verifikasi
  inbound murni/lokal (HMAC compare saja). Delivery outbound adalah worker
  step terpisah, timeout-bounded, retriable
  (`bun run integration-hub:outbound:dispatch`), TEGAS di luar transaksi
  mana pun (ADR-0006).

## Alur inbound

1. Operator mendaftarkan **endpoint**
   (`POST /api/v1/integration-hub/endpoints`) — `endpointToken` opaque
   server-generated (segmen URL yang di-POST provider) + pointer
   `secretReference` (`env:VAR_NAME`, TIDAK PERNAH nilai secret mentah).
2. Provider POST ke `POST /api/v1/integration-hub/inbound/{endpointToken}`
   — endpoint PUBLIK (tanpa tenant JWT). Tenant di-resolve dari token
   opaque lewat fungsi bootstrap `SECURITY DEFINER` sempit
   (`awcms_resolve_integration_endpoint_lookup`, migration 071 — pola
   sama `awcms_resolve_tenant_domain_lookup`, migration 033) SEBELUM
   transaksi `withTenant(...)` mana pun jalan.
3. `application/inbound-webhook-intake.ts`'s `processInboundWebhook`
   menjalankan gate chain lengkap (status endpoint/tenant, content type,
   ukuran body, verifikasi signature) dan — untuk delivery yang
   TERVERIFIKASI — INSERT baris inbound delivery dengan
   `ON CONFLICT (tenant_id, endpoint_id, replay_key) DO NOTHING`. Hasil
   nol baris = delivery ini SUDAH pernah diproses (replay), tidak ada
   efek lanjutan. Baris baru = genuinely baru: payload dinormalisasi dan
   `appendDomainEvent` dipanggil (event type
   `awcms.integration-hub.inbound-message.normalized`) — semua
   dalam transaksi YANG SAMA.

## Alur outbound

1. Operator mendaftarkan **subscription**
   (`POST /api/v1/integration-hub/subscriptions`) — event type internal
   yang didengar, `targetUrl` (SSRF-validated saat write), `filter`
   deklaratif bounded opsional.
2. Consumer statis `integration_hub` sendiri
   (`integrationHubOutboundFanoutConsumer`,
   `application/outbound-fanout-consumer.ts`) terdaftar di
   `domain-event-runtime/infrastructure/consumer-registry.ts`'s array —
   titik ekstensi additive yang sama dipakai `workflow_approval`/
   `organization_structure` untuk jadi PRODUCER event nyata; modul ini
   adalah CONSUMER pihak-ketiga nyata pertama. Berjalan dalam transaksi
   YANG SAMA dengan commit event sumbernya — handler same-process, DB-only
   (nol network call) yang membuat baris `pending`
   `awcms_integration_outbound_deliveries` untuk tiap subscription
   aktif yang cocok.
3. `bun run integration-hub:outbound:dispatch`
   (`application/outbound-dispatch.ts`) claim baris due, resolve
   target/secret subscription, panggil
   `infrastructure/outbound-http-client.ts`'s `deliverOutboundWebhook`
   (SSRF-guarded) DI LUAR transaksi mana pun, lalu finalisasi
   (`delivered` / `retry_wait` exponential backoff / `dead_letter`).
   `dead_letter` bisa di-replay lewat admin action permission-gated,
   reason-required, `Idempotency-Key`-required, teraudit
   (`application/delivery-replay.ts`) — membuat baris delivery BARU yang
   mereferensikan yang lama, TIDAK PERNAH memutasi/re-queue baris lama.

## Security invariant — WAJIB dipertahankan (jangan regresi)

- **Timing-safe signature verification**: `domain/signature-primitives.ts`'s
  `timingSafeEqualHex` pakai `node:crypto`'s `timingSafeEqual` (TIDAK
  PERNAH `===` untuk membandingkan signature) — pola sama
  `sync-storage/domain/sync-hmac.ts`.
- **Replay protection = constraint DB nyata**:
  `UNIQUE (tenant_id, endpoint_id, replay_key)` di
  `awcms_integration_inbound_deliveries` — bukan in-memory check,
  survive restart/multi-instance deployment.
- **Key rotation dengan overlap**: `secretReferencePrevious`/
  `previousSecretExpiresAt` biarkan request yang ditandatangani secret
  LAMA tetap terverifikasi sampai overlap window habis
  (`application/secret-resolver.ts`'s `resolvePreviousSecretIfInOverlap`).
- **SSRF protection — DUA lapis, keduanya wajib**: `domain/ssrf-guard.ts`
  memblokir literal IP private/link-local/metadata/reserved dan hostname
  metadata dikenal saat WRITE-TIME subscription;
  `infrastructure/outbound-http-client.ts` re-validasi LAGI DAN mengecek
  setiap address hasil resolusi DNS saat DISPATCH-TIME — DAN, kritis,
  `fetch()` dipanggil dengan `redirect: "manual"`, SETIAP header
  `Location` redirect di-re-validasi lewat cek YANG SAMA sebelum diikuti
  (dibatasi `MAX_REDIRECT_HOPS`, saat ini 2; melebihi itu = hard failure
  non-retryable). **Versi sebelumnya** mengandalkan default redirect-follow
  `fetch()` dan hanya pernah memvalidasi `target_url` ASLI — subscription
  target bisa 302/303/307 ke `169.254.169.254` (cloud IMDS) atau IP
  private mana pun dan worker akan mengikutinya tanpa syarat, bypass
  100%-reliable tanpa timing race (reviewer finding, PR #784, DIPERBAIKI
  sebelum merge — **jangan hapus `redirect: "manual"` + re-validation
  loop-nya untuk alasan apa pun**). Body respons juga byte-capped
  (`MAX_RESPONSE_BODY_READ_BYTES`, 8 KiB) dalam window timeout YANG SAMA
  dengan fetch itu sendiri. Opt-out deployment-wide untuk LAN-first:
  `INTEGRATION_HUB_ALLOW_PRIVATE_TARGETS=true` (doc 18).
  **Limitasi residual terdokumentasi**: TIDAK pin resolved IP untuk
  panggilan `fetch()` sesungguhnya, jadi race TOCTOU DNS-rebinding (DNS
  record tujuan berubah antara validasi dan koneksi sesungguhnya) belum
  tertutup penuh — lihat header comment `ssrf-guard.ts`. Gap ini SEMPIT
  dan timing-dependent, BEDA dari (dan sudah tidak tercampur dengan) bug
  redirect di atas yang sudah tertutup penuh.
- **Secret reference naming dibatasi saat write-time**:
  `domain/secret-reference-validation.ts` mewajibkan setiap
  `secretReference` (endpoint create/rotate-secret, subscription create)
  menunjuk env var yang namanya diawali `INTEGRATION_HUB_` — menutup gap
  confused-deputy equality-oracle (security-auditor finding, PR #784) di
  mana `env:<ANY_VAR_NAME>` tanpa batas mengizinkan tenant yang HANYA
  punya permission `endpoints.create`/`.configure`/`subscriptions.create`
  biasa mereferensikan secret proses-wide yang TIDAK TERKAIT dan memakai
  percobaan signed-webhook berulang (200 vs 401) sebagai boolean equality
  oracle terhadapnya. **Endpoint/subscription create/rotate baru wajib
  lewat validator ini** — jangan terima `secretReference` mentah tanpa
  prefix check.
- **Data minimization**: `raw_body_snippet` (dibatasi 2000 char,
  secret-pattern-redacted) HANYA diisi untuk delivery signature-VALID;
  attempt ditolak/invalid hanya simpan hash+size. Body JSON ternormalisasi
  yang di-relay ke subscriber juga kena PII-key redaction
  (`_shared/redaction.ts`'s `redactSensitiveAttributes`) di ATAS
  secret-pattern redaction raw snippet (security-auditor Low finding, PR
  #784).
- **Tidak pernah log/simpan nilai secret mentah** — field
  `secret_reference` hanya pointer (`env:VAR_NAME`); nilai ter-resolve
  dipakai in-memory untuk TEPAT SATU komputasi HMAC, tidak pernah
  dikembalikan/di-log.
- **Stale `sending` lease di-reclaim**:
  `application/outbound-dispatch.ts`'s claim query juga me-reclaim
  delivery yang macet di `sending` yang lease 2 menitnya sudah expired
  (`OR (status = 'sending' AND next_attempt_at <= now)`), pola sama
  `sync-storage/application/object-dispatch.ts` — worker crash/kill
  di tengah `fetch()` tidak lagi men-strand delivery selamanya (reviewer
  finding, PR #784, diperbaiki sebelum merge).

## Tabel (migration `073`)

`awcms_integration_endpoints` (soft-deletable), `_inbound_deliveries`
(append-only, replay-protected), `_subscriptions` (soft-deletable),
`_outbound_deliveries` (state per subscription+source event),
`_delivery_attempts` (append-only), `_adapter_health` (per
tenant+adapter+direction up/degraded/down). Semua `ENABLE`+`FORCE ROW
LEVEL SECURITY`, `tenant_id` filter eksplisit di setiap query (defense in
depth) selain RLS.

## Jobs

`bun run integration-hub:outbound:dispatch`
(`scripts/integration-hub-outbound-dispatch.ts`) — rekomendasi tiap 1-2
menit via cron/systemd timer, dibangun di atas shared worker runner
(`src/lib/jobs/job-runner.ts`).

## 4 known limitations terdokumentasi (README §Known limitations) — jangan asumsikan sudah diperbaiki

1. `_outbound_deliveries`/`_delivery_attempts` BELUM terdaftar di
   `data_lifecycle` — engine generik `data_lifecycle` mengeluarkan
   `DELETE FROM <tableName>` per descriptor TANPA cross-descriptor
   FK-aware ordering; `_delivery_attempts.delivery_id` FK ke
   `_outbound_deliveries.id`, dan `_outbound_deliveries.replay_of_delivery_id`
   self-reference — registrasi tanpa ordering/`ON DELETE` semantics
   lebih dulu berisiko purge failure FK-violation nyata. Follow-up issue
   terpisah, jangan daftarkan begitu saja tanpa fix ordering-nya.
2. **SSRF DNS-rebinding TOCTOU gap** — lihat §Security invariant di atas,
   lebih sempit dari bug redirect yang sudah ditutup.
3. **Tidak ada circuit-breaker persistence lintas restart**:
   `getProviderCircuitBreaker` in-memory (fail-fast gate) reset saat
   worker restart; `awcms_integration_adapter_health` (sinyal
   persisted, visible lintas-restart) HANYA observability, TIDAK
   men-gate percobaan dispatch itu sendiri.
4. **Fan-out subscription outbound baru scoped ke event type
   `integration_hub` sendiri** (`awcms.integration-hub.inbound-message.
normalized`) — modul producer masa depan yang ingin fan-out webhook
   outbound untuk event type-nya SENDIRI menambahkannya ke
   `integrationHubOutboundFanoutConsumer`'s `eventTypes` array
   (`domain-event-runtime/infrastructure/consumer-registry.ts`) DAN ke
   allowlist check `subscription-directory.ts` — pola registrasi
   reviewed-source-code yang sama dipakai producer/consumer lain.

## Pitfall umum

1. Jangan hapus/lemahkan `redirect: "manual"` + re-validation loop di
   `outbound-http-client.ts` — itu menutup bug SSRF redirect-bypass nyata
   yang ditemukan sebelum merge (PR #784).
2. Jangan terima `secretReference` tanpa validasi prefix
   `INTEGRATION_HUB_` — confused-deputy oracle nyata.
3. Jangan panggil provider/`fetch()` di dalam transaksi database (ADR-0006).
4. Jangan daftarkan `_outbound_deliveries`/`_delivery_attempts` ke
   `data_lifecycle` tanpa fix FK-ordering purge dulu.
5. Jangan copy pola HMAC compare modul ini tanpa `timingSafeEqualHex` —
   `===` pada signature adalah timing side-channel.

## Verifikasi

Lihat `tests/integration/integration-hub*.integration.test.ts` (bila ada)
untuk test replay-protection, SSRF guard (redirect bypass + private-IP),
dan stale-lease reclaim. Jalankan `bun test` dengan `DATABASE_URL` —
`bun run check` tanpa `DATABASE_URL` melewatkan test integration secara
diam-diam.
