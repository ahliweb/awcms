---
name: awcms-social-publishing
description: Kerjakan bagian mana pun dari epic social_publishing AWCMS (Issue #643-#647). Gunakan saat menambah/mengubah account connector, publish rule/template, outbox job/attempt, approval, retry/backoff, dispatcher, atau provider adapter (Meta/LinkedIn/Telegram) untuk auto-posting berita ke platform sosial. Merangkum keputusan arsitektur yang sudah dibuat di Issue #643 (fondasi) supaya issue adapter lanjutan (#644-#646) dan issue dokumentasi (#647) tidak mengulang/kontradiksi.
---

# AWCMS — Social Publishing (auto-posting outbox foundation)

Epic `social_publishing` (#643-#647) menambah lapisan auto-posting
provider-neutral di atas `blog_content` (base module, sudah `active`) dan
`news_portal` (epic `news_portal` #631-#642/#649, sumber gambar R2
terverifikasi) — khusus deployment **full-online** yang mengaktifkan flag
`SOCIAL_PUBLISHING_ENABLED`/`SOCIAL_PUBLISHING_PROFILE`. Issue #643
(fondasi) selesai lebih dulu; #644 (Meta/Facebook+Instagram), #645
(LinkedIn), #646 (Telegram) masing-masing menambah SATU provider adapter
NYATA di atas fondasi ini; #647 (dokumentasi/SOP) butuh semua issue
sebelumnya sudah ada. **Seluruh epic (#643-#647) kini selesai** — lihat
§647 di bawah untuk lima dokumen yang ditambahkan issue penutup ini.

## Kapan pakai skill ini vs skill generik

Skill ini melengkapi (bukan menggantikan) `awcms-new-endpoint`,
`awcms-new-migration`, `awcms-integration` (pola outbox/circuit
breaker eksternal, ADR-0006), `awcms-idempotency` (mutation
connect/disconnect/approve/cancel/retry), `awcms-abac-guard`,
`awcms-audit-log`, dan `awcms-sensitive-data` (token
reference). Skill ini menyediakan konteks **cross-cutting epic
spesifik** — terutama keputusan "provider-neutral foundation dulu, tidak
ada adapter nyata sampai #644/#645/#646" yang wajib dipertahankan setiap
issue lanjutan.

## Status per issue (jangan bangun ulang yang sudah ada)

| Issue | Scope                                                                                                                         | Status                            |
| ----- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| #643  | Fondasi: schema 6 tabel, outbox/dispatcher, approval, retry/backoff, provider-adapter interface (kosong), admin UI, readiness | **Selesai** — lihat §643 di bawah |
| #644  | Adapter Meta (Facebook Page + Instagram Business)                                                                             | **Selesai** — lihat §644 di bawah |
| #645  | Adapter LinkedIn (organization page)                                                                                          | **Selesai** — lihat §645 di bawah |
| #646  | Adapter Telegram (channel, bot token)                                                                                         | **Selesai** — lihat §646 di bawah |
| #647  | Dokumentasi/SOP lintas provider, butuh #643-#646 semua ada                                                                    | **Selesai** — lihat §647 di bawah |

Urutan dependency (dari objective masing-masing issue): 643 -> {644, 645,
646 independen satu sama lain, masing-masing hanya butuh #643} -> 647
(butuh semuanya — seluruh prasyarat sudah terpenuhi, epic tuntas).

## §643 — Fondasi outbox/connector (Selesai)

### Keputusan kunci #1 — full-online-only lewat gate DUA-flag env, BUKAN reuse `NEWS_PORTAL_ENABLED`

`SOCIAL_PUBLISHING_ENABLED` (master switch) + `SOCIAL_PUBLISHING_PROFILE`
(wajib `"full_online"` bila enabled) — persis pola
`AUTH_ONLINE_SECURITY_ENABLED`/`_PROFILE`
(`src/lib/auth/online-security-config.ts`), BUKAN reuse
`NEWS_PORTAL_ENABLED`/`_PROFILE` milik epic `news_portal` (fitur
berbeda, keputusan deployment berbeda — tenant bisa full-online
news_portal tanpa pernah mau auto-posting sosial). Resolver:
`src/modules/social-publishing/domain/social-publishing-config.ts`'s
`isSocialPublishingDeploymentActive(env)`. Ditegakkan
`config:validate` (`checkSocialPublishingProfileConfig`,
`scripts/validate-env.ts`) dan `security:readiness`
(`checkSocialPublishingProviderReadiness`, critical,
`scripts/security-readiness.ts`).

Ini HANYA setengah dari acceptance criterion "Auto-posting can be
disabled globally and per tenant" — setengah lain (per-tenant) adalah
`awcms_social_publishing_settings` (Keputusan kunci #2 di bawah).

### Keputusan kunci #2 — tabel settings per-tenant BOLEH tenant-writable (BUKAN pengulangan anti-pattern #636)

`awcms_social_publishing_settings` (`tenant_id` PK,
`auto_publishing_enabled`) adalah tabel keenam, di luar 5 "Core entities"
literal body issue #643. Sengaja **tenant-writable** lewat endpoint
ABAC-gated (`GET/PATCH /api/v1/social-publishing/settings`, permission
`rules.configure`) — ini **BUKAN** pengulangan anti-pattern Issue #636
(`.claude/skills/awcms-news-portal/SKILL.md` §636): #636 butuh
sinyal yang TIDAK BOLEH tenant defeat sendiri (enforcement keamanan R2-
only). Toggle auto-posting per-tenant di sini justru MEMANG dimaksudkan
bisa diubah tenant sendiri (preferensi bisnis biasa, bukan kontrol
keamanan) — jadi tabel dedicated + RLS + ABAC endpoint biasa sudah
cukup, TIDAK perlu pola "zero generic write surface" #636. Jangan
disalahartikan sebagai kemunduran keamanan bila membaca kode ini setelah
membaca §636 — keduanya sengaja berbeda karena ancaman modelnya berbeda.

### Keputusan kunci #3 — `token_reference` adalah REFERENSI, bukan token nyata; ada heuristic penolakan

`awcms_social_accounts.token_reference` adalah string buram (mis.
`"secretsmanager:social/fb-page-42"`, `"env:SOCIAL_TOKEN_X"`) yang
menunjuk ke secret storage eksternal — repo ini **belum** punya integrasi
secret-manager nyata (dicatat sebagai residual/follow-up, bukan
diselesaikan issue ini). `social-account-validation.ts`'s
`looksLikeRawSecretToken` menolak (400) nilai yang BERBENTUK token asli
(JWT 3-segmen, prefix `EAA`/`ya29.`/`1//`/`ghp_`, token Bot API Telegram
`<bot_id>:<35-char secret>`, blob base64/hex panjang tanpa
prefix-referensi dikenal) — best-effort, BUKAN jaminan sempurna
(didokumentasikan eksplisit di komentar fungsi). `token_reference`
**tidak pernah** diselect kembali oleh query mana pun kecuali SATU fungsi
`fetchSocialAccountTokenReferenceForDispatch` (INTERNAL ONLY, dipanggil
dispatcher, tidak pernah dari route HTTP) — sama pola
`tenant-domain-directory.ts`'s `verification_token_hash`. Disconnect
membersihkan `token_reference` ke `NULL` (bukan sekadar flip status).

**Temuan security-auditor round 1 (PR #731, High, DITUTUP)**: cek
awal hanya punya 4 pola (JWT/EAA/ya29./gh[a-z]_) plus satu catch-all blob
64+ karakter yang mengecualikan SEMUA string berisi titik dua — token Bot
API Telegram (bentuk `123456789:AAExampleFakeTelegramBotToken0000`, ~44
karakter) lolos: terlalu pendek untuk catch-all, dan bentuknya tidak cocok
4 pola lain. Ini gap nyata untuk provider BERIKUTNYA di epic ini (#646),
bukan hipotetis. Diperbaiki dengan (1) pola penolakan eksplisit
`^\d{6,10}:[A-Za-z0-9_-]{30,45}$` sebelum pengecualian referensi, DAN (2)
`KNOWN_SECRET_REFERENCE_PREFIX_PATTERN` (allow-list prefix
`secretsmanager`/`env`/`ref`/`vault`/`kms`/`ssm`) menggantikan "string
apa pun berisi titik dua dikecualikan" — charset catch-all blob juga
diperluas mencakup `:` supaya pengecualian prefix ini benar-benar
teruji/reachable, bukan dead code. **Wajib untuk #644/#645/#646**: bila
provider kalian punya bentuk token yang juga bisa lolos dari 5 pola yang
ada sekarang, tambah pola penolakan eksplisit baru — jangan andalkan
catch-all blob generik saja untuk token yang PENDEK.

**Wajib untuk #644/#645/#646**: adapter nyata TIDAK boleh menyimpan
token/secret client-nya sendiri di kolom lain manapun — resolusi
`tokenReference` -> kredensial nyata adalah tanggung jawab adapter
sendiri (mis. baca env var bernama sesuai reference, atau panggil secret
manager beneran), bukan tanggung jawab fondasi ini.

### Keputusan kunci #4 — provider-adapter interface, registry KOSONG, `provider_key` BUKAN enum tetap

`domain/social-provider-adapter.ts` mendefinisikan `SocialProviderAdapter`
(providerKey, requiredEnvVars, `publish()`, `verifyCredentials()`).
`infrastructure/social-provider-registry.ts` adalah singleton Map yang
KOSONG di issue ini — TIDAK ADA satu pun panggilan HTTP nyata ke Meta/
LinkedIn/Telegram di seluruh modul ini. `provider_key` (kolom
`awcms_social_accounts`/`..._social_publish_jobs`) sengaja HANYA
divalidasi FORMAT (`^[a-z][a-z0-9_]{1,49}$`), bukan `CHECK` enum tetap
seperti `awcms_news_portal_ad_placements.placement_key` — supaya
#644/#645/#646 bisa mendaftarkan provider key baru tanpa migration baru.

**Wajib untuk #644/#645/#646**: panggil
`registerSocialProviderAdapter(adapter)` dari COMPOSITION ROOT milik
adapter itu sendiri (mis. sebuah file/script/module-init baru, BUKAN
dari dalam `social-publishing/application`/`domain`) — sama pola
`setLogSink`/`setAuditExportHook`'s "registration adalah composition-
root concern". Gunakan `providerKey` yang konsisten dengan nama yang
tersirat body issue kalian sendiri (mis. `facebook_page`,
`instagram_business`, `linkedin_organization`, `telegram_channel`) —
tidak ada daftar resmi yang mengikat, tapi jaga konsistensi lintas ketiga
issue itu sendiri.

### Keputusan kunci #5 — outbox: job CREATION di dalam transaksi, provider CALL di luar (ADR-0006)

`application/create-social-publish-jobs.ts`'s
`createSocialPublishJobsForArticle` HANYA melakukan INSERT baris job
(plain DB write, tanpa panggilan eksternal apa pun) — dipanggil DI DALAM
transaksi yang sama dengan transisi `blog_content` post ke `published`
(via `SocialPublishingPort`, lihat Keputusan kunci #6). Ini BENAR sesuai
pola outbox (menulis event/outbox row atomis dengan business event yang
memicunya) — bukan pelanggaran ADR-0006, karena ADR-0006 melarang
panggilan PROVIDER (bukan penulisan baris outbox) di dalam transaksi.
Panggilan provider NYATA hanya terjadi di
`application/social-publish-dispatch.ts`'s `dispatchSocialPublishQueue`
(dipanggil `bun run social-publishing:dispatch`,
`scripts/social-publish-dispatch.ts`), 3-fase CLAIM/CALL/FINALIZE persis
`sync-storage/application/object-dispatch.ts`.

**Wajib untuk #644/#645/#646**: JANGAN pernah memanggil `adapter.publish()`
dari dalam kode yang juga menulis ke `awcms_blog_posts` atau berjalan
di dalam transaksi manapun — hanya dispatcher yang boleh memanggilnya,
dan HARUS dibungkus `withTimeout` + circuit breaker per-provider
(`getProviderCircuitBreaker(`social-publishing:${providerKey}`)`), sudah
disiapkan generik di `social-publish-dispatch.ts` — adapter baru TIDAK
perlu menambah circuit breaker sendiri.

### Keputusan kunci #6 — dua port lintas modul: `SocialPublishingPort` (blog_content konsumsi) dan `NewsMediaPort` (social_publishing konsumsi)

Sama pola Issue #681 (`_shared/ports/`, `news_media`/`public_content`):
`_shared/ports/social-publishing-port.ts` (BARU, issue ini) adalah
capability yang `blog_content` KONSUMSI dari `social_publishing`
(`onArticlePublished`, dipanggil dari `pages/api/v1/blog/posts/[id]/
publish.ts` dan `blog-content/application/blog-scheduled-publish.ts` via
parameter `socialPublishingPort` opsional, diwire di
`scripts/blog-scheduled-publish.ts`). `social_publishing` sendiri
KONSUMSI `news_portal`'s `news_media` capability (untuk resolusi URL
gambar R2 terverifikasi) — TIDAK mengimpor `news-portal/application/
news-media-port-adapter.ts` secara langsung dari dalam
`social-publishing/application` (itu justru anti-pattern yang sama
persis #681 perbaiki); factory
`social-publishing-port-adapter.ts`'s `createSocialPublishingPortAdapter(mediaPort)`
menerima `NewsMediaPort` sebagai PARAMETER, hanya composition root
(route/script) yang mengimpor kedua adapter konkret dan merangkainya.

**Catatan khusus**: `social-publishing-port-adapter.ts` JUGA mengimpor
`blog-content/application/public-route-settings.ts`'s
`fetchEffectivePublicRouteSettings` secara langsung (untuk
`publicBasePath`) — ini BUKAN pelanggaran boundary yang sama:
`tests/unit/module-boundary.test.ts` (Issue #681) HANYA mengatur pasangan
`blog_content`<->`news_portal`, tidak ada boundary setara antara
`social_publishing` dan `blog_content` hari ini. Arah ini jauh lebih
rendah risiko (satu fungsi getter read-only, bukan re-impor seluruh
domain modul lain) — didokumentasikan sengaja, bukan kelalaian.

### Keputusan kunci #7 — canonical URL dari domain tenant terverifikasi, BUKAN `url.origin`

Setiap konstruksi canonical URL lain di repo ini (`/news/[slug].ts`,
`sitemap-news.xml.ts`) memakai `url.origin` dari REQUEST langsung — tidak
tersedia di sini karena job creation bisa dipicu dari worker terjadwal
tanpa request masuk sama sekali. `application/article-canonical-url.ts`'s
`resolvePrimaryVerifiedDomainHostname` query LANGSUNG (raw SQL, tanpa
import TS) ke `awcms_tenant_domains` (`is_primary = true AND status
= 'active'`) — pola yang SAMA `blog-content/application/public-news-
tenant-resolution.ts` sudah pakai untuk tabel yang sama, jadi bukan
pelanggaran boundary baru. Bila tenant belum punya domain utama
terverifikasi, job creation SKIP dengan alasan terdokumentasi
(`no_verified_domain`) — TIDAK pernah menebak/fallback ke URL yang salah.

### Keputusan kunci #8 — idempotensi job: unique index DB, bukan hanya disiplin aplikasi

`awcms_social_publish_jobs_idempotency_key` (UNIQUE
`(tenant_id, idempotency_key)`) + `INSERT ... ON CONFLICT DO NOTHING` —
`idempotency_key` dihitung deterministik dari
`(tenantId, articleId, socialAccountId, providerKey, action)` via
`domain/social-publish-idempotency.ts`'s
`buildSocialPublishIdempotencyKey`. Ini terpisah dari `_shared/
idempotency.ts`'s tabel HTTP `Idempotency-Key` generik (dipakai endpoint
connect/disconnect/approve/cancel/retry) — job creation dipicu event
internal, bukan request HTTP client, jadi butuh mekanisme idempotensi
sendiri di level baris DB.

### Keputusan kunci #9 — `PATCH /accounts/{id}` (toggle auto-publish) digerbang `rules.configure`, BUKAN permission `accounts.*` baru

DISENGAJA (temuan security-auditor M2, PR #731 review round 1): role yang
punya `rules.configure` tapi TIDAK punya `accounts.connect`/`.disconnect`
tetap bisa mengubah `autoPublishEnabled` sebuah akun yang bukan ia
hubungkan sendiri. Ini reuse dari 10 permission tetap yang sudah
disarankan issue #643 sendiri (lihat header migration 050) — bukan
menambah permission ke-11 (`accounts.configure` misalnya) hanya untuk satu
field boolean. Blast radius dibatasi pada "boleh menyalakan/mematikan
auto-publish akun yang SUDAH terhubung", tidak pernah menyentuh
kredensial/token (itu tetap di belakang `accounts.connect`/`.disconnect`).
Dicatat di sini SUPAYA terbaca sebagai tradeoff yang disadari, bukan
kelalaian, bila ditinjau ulang nanti — lihat juga komentar header
`pages/api/v1/social-publishing/accounts/[id].ts`'s `PATCH` handler.

### Retry/backoff — `evaluateSocialPublishRetry`/`evaluateSocialPublishRateLimitRetry`

Formula sama `sync-storage/domain/object-queue.ts`'s
`evaluateObjectRetry` (`2^attemptCount` menit, capped
`SOCIAL_PUBLISH_MAX_RETRY_DELAY_MINUTES=240`), TIDAK di-reuse langsung
(constants beda: job punya `max_attempts` per-baris, bukan konstanta
modul tetap). Rate-limit retry mempertimbangkan
`retryAfterSeconds` dari provider, tidak pernah lebih pendek dari lantai
eksponensial (mencegah provider memaksa retry loop rapat).

### Status job pasca-dispatch

- `published`: sukses, `externalPostId`/`externalPostUrl` terisi.
- retryable gagal & budget tersisa: kembali ke `pending`/`approved`
  (tergantung `requires_approval` snapshot) dengan `next_attempt_at`
  backoff — TIDAK pernah balik ke `requires_approval` (approval tidak
  perlu diulang).
- retry budget habis: `failed` (terminal, TIDAK bisa retry manual lagi —
  `retrySocialPublishJob` menolak `attempt_count >= max_attempts`).
- `rate_limited`: backoff dari `retryAfterSeconds`, tetap bisa habis
  budget -> `failed` terminal juga.
- `needs_reauth`: TIDAK auto-retry, DAN `awcms_social_accounts`
  milik job itu ikut di-flip ke `needs_reauth`
  (`markSocialAccountNeedsReauth`) — reconnect via `POST .../accounts`
  (upsert) adalah SATU-SATUNYA jalur reauthorization, tidak ada endpoint
  "reauthorize" terpisah.
- Provider tanpa adapter terdaftar (`getSocialProviderAdapter` return
  `undefined`): `failed` terminal SEGERA (errorCode
  `provider_not_registered`, `retryable: false`) — tidak masuk siklus
  retry sama sekali (menambah adapter tidak akan pernah membuat retry
  otomatis berhasil sebelum ada yang mem-retry manual).

### File yang dibuat/diubah (referensi cepat)

- `sql/053_awcms_social_publishing_schema.sql` (6 tabel + 10
  permission seed).
- `src/modules/identity-access/domain/access-control.ts` (`connect`/
  `disconnect` ditambah ke `AccessAction` + `HIGH_RISK_ACTIONS`).
- `src/modules/social-publishing/domain/`: `social-publishing-config.ts`,
  `social-provider-adapter.ts`, `social-publish-retry.ts`,
  `social-publish-idempotency.ts`, `social-account-validation.ts`,
  `social-publish-rule-validation.ts`,
  `social-publish-template-validation.ts`.
- `src/modules/social-publishing/application/`:
  `article-canonical-url.ts`, `social-account-directory.ts`,
  `social-publish-rule-directory.ts`,
  `social-publish-template-directory.ts`,
  `social-publishing-settings-directory.ts`,
  `create-social-publish-jobs.ts`, `social-publish-job-directory.ts`,
  `social-publish-dispatch.ts`, `social-publishing-port-adapter.ts`.
- `src/modules/social-publishing/infrastructure/social-provider-registry.ts`.
- `src/modules/social-publishing/module.ts`; registered in
  `src/modules/index.ts`.
- `src/modules/_shared/ports/social-publishing-port.ts` (baru);
  `src/modules/blog-content/module.ts` (`capabilities.consumes` +
  `social_publishing`, optional).
- `src/modules/blog-content/application/blog-scheduled-publish.ts`
  (parameter `socialPublishingPort` opsional).
- `src/pages/api/v1/blog/posts/[id]/publish.ts` (composition root,
  memanggil `socialPublishingPort.onArticlePublished`).
- `scripts/blog-scheduled-publish.ts` (composition root, wiring port).
- `src/pages/api/v1/social-publishing/{accounts,rules,templates,jobs,settings}/**`.
- `scripts/social-publish-dispatch.ts`
  (`bun run social-publishing:dispatch`).
- `src/pages/admin/social-publishing/{accounts,rules,jobs}.astro`.
- `openapi/modules/social-publishing.openapi.yaml`.
- `asyncapi/awcms-domain-events.asyncapi.yaml` (15 channel/operation
  baru, `awcms.social-publishing.*`).
- `scripts/validate-env.ts` (`checkSocialPublishingProfileConfig`),
  `scripts/security-readiness.ts`
  (`checkSocialPublishingProviderReadiness`), `src/lib/config/registry.ts`,
  `.env.example`, `18_configuration_env_reference.md`.
- `i18n/en.po`, `i18n/id.po`, `i18n/messages.pot` (69 key baru,
  `admin.social_publishing.*`/`admin.layout.nav_social_publishing_*`).
- Test: `tests/unit/social-publishing-config.test.ts`,
  `tests/unit/social-publish-retry.test.ts`,
  `tests/unit/social-publish-idempotency.test.ts`,
  `tests/unit/social-account-validation.test.ts`,
  `tests/unit/social-publish-template-validation.test.ts`,
  `tests/modules/social-publishing-module.test.ts`,
  `tests/integration/social-publishing.integration.test.ts`; diperbarui:
  `tests/foundation.test.ts` (migration list 050).
- Changeset: `.changeset/social-publishing-outbox-foundation-issue-643.md`.

### Belum/di luar cakupan issue ini (untuk #644/#645/#646/#647)

- Provider adapter nyata Meta/Instagram (#644), LinkedIn (#645), Telegram
  (#646) — nol panggilan HTTP eksternal hari ini.
- Integrasi secret-manager nyata untuk resolusi `token_reference` ->
  kredensial — hari ini murni konvensi/heuristic, bukan kode yang benar-
  benar memanggil secret storage.
- Endpoint/UI "manual editor action" nyata untuk trigger
  `manual_editor_action` (dimodelkan penuh di `awcms_social_publish_rules.trigger_event`,
  tapi belum ada tombol "Post to X now" di editor artikel) — issue
  lanjutan yang menambah UI itu harus tetap memakai
  `createSocialPublishJobsForArticle`/`SocialPublishingPort` yang sudah
  ada, bukan jalur baru.
- Auto-requeue job `needs_reauth` begitu akun reconnect — hari ini job
  yang sudah `needs_reauth` harus di-retry manual via `POST
.../jobs/{id}/retry` setelah akun reconnect, tidak otomatis.
- Admin UI khusus untuk `awcms_social_publish_templates` sebagai
  halaman terpisah — digabung ke halaman rules (`/admin/social-
publishing/rules`), bukan halaman sendiri (sama pola "cukup di satu
  halaman config" beberapa modul lain di repo ini).
- Full keyset pagination untuk `GET /api/v1/social-publishing/jobs` —
  hari ini bounded `LIMIT` sederhana (maks 200), didokumentasikan sebagai
  follow-up bila volume job jadi besar.

## §644 — Adapter Meta: Facebook Page + Instagram Business (Selesai)

Adapter provider NYATA pertama di epic ini. Registrasi TIDAK BERSYARAT
(selalu dipanggil saat `social-provider-registry.ts` di-import — lihat
Keputusan kunci di bawah), independen dari `META_PROVIDER_ENABLED` (yang
hanya menggerbang PERILAKU adapter saat dipanggil, bukan apakah ia
terdaftar).

### Keputusan kunci #644-1 — DUA provider key terpisah, satu row akun = satu tujuan publish

`meta_facebook_page` (Facebook Page, link post ke `/{page-id}/feed`) dan
`meta_instagram` (Instagram Business, 2-call media container -> publish
ke `/{ig-user-id}/media` lalu `.../media_publish`) adalah DUA adapter
terpisah, masing-masing `providerKey` sendiri. TIDAK ada satu row
`awcms_social_accounts` yang mewakili "koneksi Meta" gabungan —
tenant menghubungkan SATU row per tujuan publish (satu untuk Page, satu
lagi untuk IG bila keduanya diinginkan), `providerAccountId` untuk
`meta_facebook_page` adalah Facebook Page ID, untuk `meta_instagram`
adalah Instagram Business Account ID. **Sengaja TIDAK menambah migration
baru** untuk field metadata "account.metadata" yang disebut body issue
(`facebook_page_id`, `facebook_page_name`, `instagram_business_account_id`,
`instagram_username`, `permissions_json`, `token_expires_at`,
`last_verified_at`) — SEMUA field itu sudah punya padanan 1:1 di kolom
generik #643 (`provider_account_id`/`_name` untuk dua field pertama tiap
providerKey, `scopes_json` untuk `permissions_json`, `expires_at`/
`last_verified_at` untuk dua field terakhir). Jangan menambah kolom
metadata baru untuk ini kecuali benar-benar menemukan kebutuhan yang
TIDAK bisa dipetakan ke skema #643 yang sudah ada.

`provider_account_type` untuk KEDUA provider key ini selalu `"page"` —
lihat `SocialProviderAdapter.supportedAccountTypes` di bawah untuk
alasannya (IG Business tetap dipublish lewat Page access token, tidak
ada tipe akun IG standalone di real Meta API).

### Keputusan kunci #644-2 — `SocialProviderAdapter.supportedAccountTypes` (field BARU, opsional, additive) ditegakkan di TIGA titik, bukan cuma satu

Interface `domain/social-provider-adapter.ts` (foundation #643) tidak
punya cara bagi pemanggil untuk tahu tipe akun apa yang didukung suatu
adapter. Ditambah field opsional `supportedAccountTypes?:
readonly SocialAccountType[]` — `undefined` berarti "tidak ada
pembatasan tipe" (bukan "tidak ada tipe yang didukung").

**Temuan reviewer round 1 (BLOCKING, PR #644 diperbaiki sebelum merge)**:
versi pertama HANYA memeriksa field ini di endpoint verify (opt-in,
diagnostik) — jalur nyata connect -> dispatch -> publish yang benar-benar
memposting ke Meta TIDAK PERNAH memeriksanya. Operator bisa connect
`providerKey: "meta_facebook_page"` dengan `providerAccountType:
"profile"` dan itu SUKSES; dispatcher akan tetap memanggil
`adapter.publish()`. Ini bertentangan langsung dengan acceptance
criterion issue ("Instagram publishing validates account eligibility ...
before job execution") dan daftar out-of-scope-nya (tidak ada personal
profile/personal Instagram posting).

**Diperbaiki di DUA lapis, bukan satu**:

1. `application/social-publish-dispatch.ts` — SETELAH
   `fetchSocialAccountTokenReferenceForDispatch` (sekarang juga
   mengembalikan `providerAccountType`) dan SEBELUM `adapter.publish()`
   dipanggil, cek `adapter.supportedAccountTypes` — job gagal terminal
   `unsupported_account_type`, `retryable: false` (tipe akun tidak pernah
   berubah sendiri, harus reconnect manual). Ini satu-satunya titik yang
   benar-benar menutup celah acceptance criterion di ATAS, karena INI yang
   dilewati SETIAP job nyata, bukan hanya yang pernah di-verify.
2. `pages/api/v1/social-publishing/accounts/index.ts`'s `POST` (connect) —
   defense-in-depth kedua, menolak `422 SOCIAL_ACCOUNT_UNSUPPORTED_TYPE`
   di titik paling awal (feedback langsung ke operator, bukan menunggu job
   gagal nanti).

Field ini JUGA dibaca `scripts/security-readiness.ts`'s
`checkMetaSocialPublishingAccountReadiness` (readiness, bukan enforcement
runtime). **Bila #645 juga menambah field yang sama** (kemungkinan besar,
LinkedIn punya batasan tipe akun serupa) — field itu sendiri ADDITIVE
murni, tapi **wajib tegakkan di dispatcher JUGA**, bukan cuma endpoint
verify/connect — itulah pelajaran nyata dari temuan round 1 ini.

### Keputusan kunci #644-3 — resolusi `token_reference` LOKAL per-adapter, skema `env:VAR_NAME` SATU-SATUNYA yang diimplementasikan

`infrastructure/meta/meta-token-reference-resolver.ts`'s
`resolveMetaTokenReference` HANYA mendukung skema `env:VAR_NAME` (baca
`process.env[VAR_NAME]`) — skema lain yang lolos validasi FORMAT di
`looksLikeRawSecretToken` (`secretsmanager:`, `vault:`, `kms:`, `ssm:`)
diterima sebagai bentuk REFERENSI yang sah tapi TIDAK bisa diresolusi
deployment ini (return `null`, fail closed -> `needs_reauth`, bukan
throw). Ini SENGAJA tidak dipromosikan ke file bersama meskipun logikanya
generik — Keputusan kunci #3 §643 eksplisit bilang resolusi token adalah
tanggung jawab MASING-MASING adapter. **Wajib untuk #645/#646**: bila
kalian butuh resolusi serupa, salin pola ini (fungsi lokal per-modul),
JANGAN mengimpor fungsi ini dari modul Meta — itu akan membuat
`social_publishing` bergantung pada implementasi provider tertentu.

Fungsi yang SAMA dipakai untuk `META_APP_SECRET_REFERENCE` (dibutuhkan
untuk membangun app access token `{appId}|{appSecret}` saat memanggil
`debug_token`).

### Keputusan kunci #644-4 — `POST .../accounts/{id}/verify` dibangun di PR #644 lalu DIGANTI oleh desain kanonik #646 (tabrakan paralel, diselesaikan oleh orkestrator)

PR #644 (Meta) dan PR #646 (Telegram) SAMA-SAMA membangun
`POST /api/v1/social-publishing/accounts/{id}/verify` secara independen
dan paralel — keduanya lolos review sendiri-sendiri, tapi begitu #646
merge duluan ke `main`, orkestrator memutuskan desain #646 sebagai
KANONIK (permission `accounts.verify` khusus — bukan reuse
`accounts.connect`; wajib `Idempotency-Key`; `200` informasional yang
TIDAK PERNAH memaksa transisi state pada kegagalan — bukan `409`
`needs_reauth` seperti desain awal #644) dan #644's implementasi sendiri
(`application/social-account-verification.ts`,
`fetchSocialAccountTokenReferenceForVerification`,
`recordSocialAccountVerificationSuccess`, route `verify.ts` versi awal)
**DIHAPUS SELURUHNYA** saat #644 merge `origin/main` yang sudah membawa
#646. Lihat §646 di bawah untuk desain kanonik yang sebenarnya jalan.

**Pelajaran untuk #645 (LinkedIn, masih berjalan paralel)**: JANGAN
membangun ulang endpoint verify sendiri — route ini SEKARANG generik/
shared, sudah menangani provider apa pun via `getSocialProviderAdapter`.
Yang perlu #645 sentuh HANYA: implementasi `verifyCredentials()` di
adapter LinkedIn sendiri (dipanggil generik oleh route yang sudah ada),
dan environment/readiness check khusus LinkedIn — bukan route HTTP-nya.

Satu hal yang TETAP relevan dari desain awal #644 dan masih dipertahankan
di versi kanonik: `verifyCredentials`'s docstring (#643) sudah eksplisit
bilang ini dipanggil dari "readiness gate atau manual verify connection
admin action" dan endpoint kanonik tetap memanggil provider strictly DI
LUAR transaksi DB (3-fase fetch/call/persist) — jadi disiplin desain
awal #644 ITU SENDIRI bukan yang salah, hanya detail response shape/
permission/idempotency-nya yang kalah terhadap #646.

### Keputusan kunci #644-5 — Graph API client injectable, mirror pola `mailketing-provider.ts`

`infrastructure/meta/meta-graph-client.ts`'s `createMetaGraphClient`
menerima `fetchImpl`/`baseUrl` opsional (default `fetch` global +
`https://graph.facebook.com`) — TEPAT pola yang sudah ada
`email/infrastructure/mailketing-provider.ts`'s `MailketingProviderConfig`
pakai (bukan pola baru). Kedua adapter (`meta-facebook-page-adapter.ts`,
`meta-instagram-adapter.ts`) menerima `graphClientFactory` opsional di
constructor-nya sendiri (`createMetaFacebookPageAdapter(options)`) —
test mengganti factory ini dengan fake yang mengimplementasikan
`MetaGraphClient.call()`, TIDAK PERNAH melakukan panggilan `fetch` asli.
**Wajib untuk #645/#646**: pakai pola yang SAMA (client/provider object
injectable via constructor option adapter kalian sendiri) — jangan
memanggil `fetch`/library HTTP langsung dari dalam `publish()`/
`verifyCredentials()` tanpa lapisan yang bisa diganti saat test.

### Keputusan kunci #644-6 — normalisasi error TIDAK PERNAH meneruskan teks/fbtrace_id asli dari Meta

`domain/meta-error-normalization.ts`'s `normalizeMetaGraphApiError`
memetakan `error.code`/`error.type` Meta ke katalog TETAP pesan aman
(`meta_oauth_exception_190`, `meta_permission_error_10`,
`meta_rate_limited_32`, dst.) — `error.message`/`fbtrace_id` Meta yang
asli TIDAK PERNAH masuk ke `errorMessage`/log/response manapun, walau
teks itu biasanya aman (issue security notes eksplisit minta "jangan log
identifier pengguna/halaman di luar yang dibutuhkan"). **Wajib untuk
#645/#646**: bila platform kalian juga mengembalikan pesan error
berformat bebas, JANGAN meneruskannya verbatim — buat katalog pesan
tetap sendiri seperti ini.

### Keputusan kunci #644-7 — R2 image re-validation di titik penggunaan (defense-in-depth, bukan re-implementasi enforcement #636)

`domain/meta-publish-content.ts`'s `isAcceptableProviderMediaUrl`
membandingkan `new URL(url).host` PERSIS terhadap
`new URL(env.NEWS_MEDIA_R2_PUBLIC_BASE_URL).host` — BUKAN
substring/prefix check (pelajaran Issue #635: trailing-dot FQDN bisa
membypass prefix check). Ini murni defense-in-depth: `content.imageUrl`
pada job SUDAH dijamin verified oleh `create-social-publish-jobs.ts`
(foundation #643) via `NewsMediaPort.resolveMediaReferences` — adapter
ini TIDAK pernah menerima URL gambar dari sumber lain (caption custom
editor hanya berupa TEKS, bukan URL). Re-check ini hanya jaring pengaman
titik-terakhir sebelum panggilan eksternal, bukan mekanisme enforcement
baru — jangan disalahartikan sebagai pengulangan pola tenant-state Issue
#636 (itu soal SIAPA yang boleh menulis sinyal keamanan; ini soal
validasi ulang nilai yang sudah dipercaya sebelum keluar sistem).

### Keputusan kunci #644-8 — idempotensi: tanggung jawab adapter berhenti di meneruskan `idempotencyKey`, dedup NYATA tetap di dispatcher

Meta Graph API TIDAK punya parameter idempotency-key nyata untuk
`/feed`/`/media`/`/media_publish` — adapter ini TIDAK mengimplementasikan
dedup sendiri. Dicatat eksplisit di test
(`tests/unit/meta-instagram-adapter.test.ts`'s "idempotency" describe
block): memanggil `publish()` dua kali dengan `idempotencyKey` yang sama
tetap menghasilkan dua panggilan Graph API independen — pencegahan
duplikat NYATA adalah transisi status job (`pending`/`approved` ->
`publishing` -> `published`, tidak pernah diklaim ulang) yang SUDAH ada
di `social-publish-dispatch.ts` (foundation #643, teruji di
`tests/integration/social-publishing.integration.test.ts` dan
`tests/unit/social-publish-idempotency.test.ts`). **Wajib untuk
#645/#646**: jangan berpura-pura mengimplementasikan idempotency-level-
adapter kalau platform kalian juga tidak punya mekanisme itu — dokumentasikan
residual ini secara jujur seperti di sini.

### Alur koneksi (tidak ada route OAuth baru)

Endpoint connect/disconnect generik #643 (`POST/POST .../accounts`,
`.../accounts/{id}/disconnect`) dipakai APA ADANYA untuk Meta — tidak
ada endpoint/redirect OAuth baru di issue ini. Operator menyelesaikan
alur OAuth Meta di luar aplikasi (atau proses operasional lain yang
menghasilkan Page Access Token jangka panjang), lalu mengisi form
connect manual dengan `providerAccountId`/`Name`/`tokenReference`.
`META_OAUTH_REDIRECT_URI` didokumentasikan untuk keperluan pendaftaran
app review/dashboard Meta saja — BUKAN endpoint yang benar-benar ada di
repo ini. `POST .../accounts/{id}/verify` (BARU, endpoint provider-
netral tapi baru benar-benar melakukan sesuatu untuk Meta hari ini)
memanggil `debug_token` secara live untuk memeriksa validitas/scope/
kedaluwarsa.

### File yang dibuat/diubah (referensi cepat, status FINAL setelah tabrakan dengan #646)

- `src/modules/social-publishing/domain/`: `meta-provider-config.ts`,
  `meta-publish-content.ts`, `meta-error-normalization.ts`;
  `social-provider-adapter.ts` (+`supportedAccountTypes` opsional,
  +param `providerAccountId` di `verifyCredentials` — perubahan
  TERAKHIR ini datang dari #646, bukan #644, lihat §646).
- `src/modules/social-publishing/infrastructure/meta/`:
  `meta-graph-client.ts`, `meta-token-reference-resolver.ts`,
  `meta-credential-verification.ts` (`verifyMetaCredentials` sekarang
  JUGA memanggil `GET /{providerAccountId}?fields=id` pakai token yang
  diperiksa, mengonfirmasi token benar-benar bisa akses target
  spesifik — bukan cuma valid secara umum), `meta-facebook-page-adapter.ts`,
  `meta-instagram-adapter.ts`.
- `src/modules/social-publishing/infrastructure/social-provider-registry.ts`
  (blok registrasi additive di akhir file — TIDAK bentrok dengan #646,
  yang pakai pola registrasi berbeda, lihat §646 Keputusan #x).
- `src/modules/social-publishing/application/social-account-directory.ts`
  (+`providerAccountType` di `fetchSocialAccountTokenReferenceForDispatch`
  — dipakai `social-publish-dispatch.ts`'s enforcement baru, Keputusan
  kunci #644-2).
- `src/modules/social-publishing/application/social-publish-dispatch.ts`
  (+enforcement `supportedAccountTypes` sebelum `adapter.publish()` —
  Keputusan kunci #644-2, BLOKING finding reviewer round 1).
- `src/pages/api/v1/social-publishing/accounts/index.ts`'s `POST`
  (+enforcement `supportedAccountTypes` di connect time, defense-in-depth
  kedua, `422 SOCIAL_ACCOUNT_UNSUPPORTED_TYPE`).
- **DIHAPUS SELURUHNYA** (kalah terhadap desain kanonik #646, lihat
  Keputusan kunci #644-4): `application/social-account-verification.ts`,
  route `verify.ts` versi awal #644,
  `tests/integration/social-publishing-meta-adapter.integration.test.ts`
  (seluruhnya tentang route verify yang sudah diganti).
- `src/pages/admin/social-publishing/accounts.astro` — tombol "Verify
  connection" versi #644 juga DIHAPUS, digantikan tombol/script versi
  #646 (permission `accounts.verify`, wajib `Idempotency-Key`).
- `scripts/validate-env.ts` (`checkMetaSocialPublishingProviderConfig`),
  `scripts/security-readiness.ts`
  (`checkMetaSocialPublishingAccountReadiness`),
  `src/lib/config/registry.ts`, `.env.example`,
  `18_configuration_env_reference.md`.
- `src/lib/i18n/error-messages.ts` (+`SOCIAL_ACCOUNT_UNSUPPORTED_TYPE`
  saja — `SOCIAL_ACCOUNT_NEEDS_REAUTH`/`PROVIDER_NOT_REGISTERED` versi
  awal #644 dihapus lagi bersama route verify awalnya, sudah tidak
  dipakai di mana pun).
- `openapi/modules/social-publishing.openapi.yaml` (`.../verify` versi
  KANONIK #646, bukan versi awal #644; `+422` di `POST .../accounts`
  untuk connect-time enforcement), `asyncapi/...` (+`account.verified`
  dari #644, +`account.verification-failed` dari #646), `module.ts`
  (+2 event, deskripsi diperbarui menyebut kedua adapter).
- `i18n/en.po`, `i18n/id.po`, `i18n/messages.pot` — hasil akhir gabungan
  string #644+#646 (versi UI/pesan #646 yang menang untuk key yang
  sama).
- Test: `tests/unit/meta-provider-config.test.ts`,
  `tests/unit/meta-publish-content.test.ts`,
  `tests/unit/meta-error-normalization.test.ts`,
  `tests/unit/meta-token-reference-resolver.test.ts`,
  `tests/unit/meta-facebook-page-adapter.test.ts` (+`verifyCredentials`
  test dengan param `providerAccountId` baru),
  `tests/unit/meta-instagram-adapter.test.ts` (+`verifyCredentials`
  describe block baru); diperbarui:
  `tests/modules/social-publishing-module.test.ts` (17 event, bukan
  16 — §646 juga menambah `account.verification-failed`),
  `tests/integration/social-publishing.integration.test.ts` (+2 test
  Keputusan kunci #644-2: dispatcher menolak tipe tidak didukung SEBELUM
  publish() dipanggil; connect menolak `422` untuk kombinasi providerKey/
  providerAccountType yang tidak didukung — plus SATU fix ketidaksengajaan
  di test #646 yang sudah ada: `resetSocialProviderRegistryForTests()`
  tidak pernah dipulihkan setelah test-nya sendiri, membocorkan registry
  KOSONG ke SEMUA test berikutnya dalam file yang sama karena `bun test`
  menjalankan semua file test dalam satu proses bersama — sekarang
  dibungkus `try/finally` yang meregistrasi ulang ketiga adapter).
- Changeset: `.changeset/social-publishing-meta-adapter-issue-644.md`.
- TIDAK ada migration baru dari #644 sendiri — lihat Keputusan kunci
  #644-1 (#646 menambah migration 055 untuk permission `accounts.verify`,
  independen dari keputusan ini).

### Belum/di luar cakupan issue ini (untuk #645/#646/#647)

- Route OAuth authorization-code exchange nyata untuk Meta — akun
  dihubungkan manual lewat form generik #643 hari ini.
- Integrasi secret-manager nyata — `env:VAR_NAME` tetap satu-satunya
  skema `token_reference`/`META_APP_SECRET_REFERENCE` yang benar-benar
  bisa diresolusi.
- Stories/Reels, WhatsApp auto posting, sinkronisasi metrik sosial,
  moderasi komentar sosial — eksplisit di luar cakupan body issue #644.
- Auto-requeue job `needs_reauth` setelah reconnect — masih warisan
  #643, belum berubah.

## §645 — Adapter LinkedIn organization page (Selesai)

Provider `provider_key: "linkedin_organization"` — adapter NYATA pertama di
modul ini (`src/modules/social-publishing/infrastructure/
linkedin-provider-adapter.ts`). `providerAccountId` diasumsikan SUDAH berupa
full URN (`urn:li:organization:{id}`), sesuai nama field `organization_urn`
di body issue — adapter ini tidak pernah mem-parsing/membangun URN sendiri.

### Round 1 reviewer + security-auditor findings (PR #737) — read before touching secret-resolution/redaction code here again

Empat temuan, semua diperbaiki sebelum merge:

1. **Critical** — `resolveLinkedInSecretReference` (`linkedin-provider-config.ts`)
   me-re-validasi nilai HASIL RESOLVE terhadap `looksLikeRawSecretToken`
   (bukan hanya reference-nya SEBELUM diresolusi). Bug ini FATAL, bukan
   sekadar redundan: token akses LinkedIn asli (150-1000+ karakter opaque)
   PERSIS berbentuk blob high-entropy 64+ karakter yang memang dirancang
   ditolak heuristic itu — versi lama menolak SETIAP resolusi token asli
   sebagai `"unresolvable"`, membuat `publish()`/`verifyCredentials()`
   TIDAK PERNAH bisa berhasil untuk akun yang benar-benar terkonfigurasi.
   Test suite sendiri tidak menangkap ini karena `TEST_TOKEN` fixture
   sengaja pendek (~35 char), di bawah ambang 64 karakter. Diperbaiki:
   hapus pengecekan kedua pada nilai hasil resolve — heuristic HANYA
   berjalan pada reference string mentah (caller-supplied), sama pola
   adapter Meta (`resolveMetaTokenReference`, PR sibling #644) yang hanya
   cek bentuk `env:` + nilai hasil resolve non-empty. Regression test:
   `tests/unit/linkedin-provider-config.test.ts`'s dua test token
   realistis (>64 char, salah satu >200 char) — JANGAN biarkan hanya
   fixture token pendek jadi satu-satunya kasus "resolusi berhasil" yang
   diuji.
2. **Critical** — tiga titik panggilan di `linkedin-provider-adapter.ts`
   memanggil `redact(truncate(message, 500), token)` — urutan TERBALIK.
   `redact()` hanya cocok pada kemunculan LENGKAP token via
   `.split(token)`; bila token mentah terpotong tepat di titik 500
   karakter, HANYA fragmen token yang tersisa (tidak sama dengan token
   penuh), sehingga `.split()` gagal cocok dan fragmen itu (terbukti:
   belasan karakter awal token asli) tersimpan APA ADANYA ke
   `awcms_social_publish_jobs.last_error_message`/
   `..._social_publish_attempts.error_message` — keduanya admin-readable.
   Diperbaiki: balik urutan jadi `truncate(redact(message, token), 500)`
   di ketiga titik (organizationAcls http_error, post-creation http_error,
   exception catch). Regression test WAJIB memposisikan token agar
   BENAR-BENAR straddle batas 500 karakter (bukan body pendek yang tidak
   pernah menyentuh titik potong) — lihat
   `tests/unit/linkedin-provider-adapter.test.ts`'s test "never leaks a
   partial token fragment when the token straddles the truncation
   boundary", yang menghitung margin secara eksplisit dan mem-verifikasi
   (`guaranteedLeakLengthUnderOldBug >= FRAGMENT_CHECK_LENGTH`) bahwa
   fixture-nya BENAR-benar akan gagal terhadap urutan lama sebelum
   mengklaim fix-nya benar.
3. **Medium** — `LINKEDIN_CLIENT_SECRET_REFERENCE` diklaim (changeset, doc
   18, deskripsi `registry.ts`) divalidasi `looksLikeRawSecretToken`,
   padahal `findMissingOrInvalidLinkedInConfig` hanya cek presence, tidak
   pernah benar-benar memanggil heuristic itu untuk var ini. Diperbaiki
   dengan MEWUJUDKAN klaim tersebut (menambah pengecekan bentuk langsung
   di `findMissingOrInvalidLinkedInConfig`, reuse `looksLikeRawSecretToken`
   pada reference string-nya, TANPA melalui `resolveLinkedInSecretReference`
   karena var ini tidak pernah benar-benar diresolusi oleh kode apa pun) —
   bukan melemahkan dokumentasi, karena pengecekan murah dan menangkap
   kesalahan operator nyata (menempel client secret asli di var ini).
4. **Low** — deskripsi `providerKey` yang ditambahkan issue ini terpotong
   di tengah kalimat pada bundle OpenAPI/`api-reference.md` hasil generate
   (berhenti persis di "...(Issue"). Akar masalah: `# ` (spasi lalu hash)
   di dalam PLAIN SCALAR YAML tanpa tanda kutip memulai KOMENTAR YAML —
   parser `yaml` package memang benar secara spek, bukan bug bundler.
   `"(Issue #645, ..."` punya spasi sebelum `#645`; pola AMAN yang sudah
   dipakai di baris yang SAMA adalah `"(#644/#645/#646)"` (hash langsung
   menempel tanda kurung buka, tanpa spasi). Diperbaiki dengan mengikuti
   pola aman itu: `"(#645, LinkedIn organization pages; ...)"`. **Catatan
   untuk seluruh repo**: pola " #NNN" (spasi + hash + angka) di manapun
   dalam string YAML PLAIN SCALAR tanpa tanda kutip berisiko silently
   truncate — belum diaudit lintas file lain di `openapi/`/`asyncapi/`,
   dicatat sebagai temuan baru untuk kewaspadaan, bukan diperbaiki di luar
   scope issue ini.

### CONFLICT RISK dengan #644/#646 (dikerjakan paralel)

Tiga agen mengerjakan #644 (Meta), #645 (LinkedIn ini), #646 (Telegram)
BERSAMAAN di worktree terpisah. Titik sentuh bersama:

- `social-provider-registry.ts` — HANYA disentuh secara aditif: tidak ada
  panggilan `registerSocialProviderAdapter` DI DALAM file ini (tetap
  kosong sesuai desain #643), tidak direstrukturisasi.
- `scripts/social-publish-dispatch.ts` dan `scripts/security-readiness.ts`
  — masing-masing mendapat SATU import + SATU baris pemanggilan fungsi
  registrasi milik provider ini (`registerLinkedInProviderAdapterIfEnabled`)
  di dalam `main()`. #644/#646 diharapkan menambah pola yang SAMA (import +
  panggilan fungsi registrasi MEREKA sendiri) — bukan mengubah baris punya
  provider lain. Lihat komentar di titik pemanggilan masing-masing script
  untuk konvensi ini.
- `src/lib/config/registry.ts`, `.env.example`, doc 18, `scripts/
validate-env.ts`'s `runEnvValidation`, `scripts/security-readiness.ts`'s
  `runSecurityReadinessChecks` — setiap provider menambah entri/baris
  SENDIRI, tidak menyentuh baris provider lain.
- `SKILL.md` ini sendiri (tabel status + section baru per provider) dan
  `docs/awcms/repo-inventory.md`/i18n hasil generate — pola merge-
  conflict standar epic ini (lihat
  [[news-portal-social-publishing-epic-progress]]): resolusi dengan
  MENGGABUNGKAN kedua sisi, jangan pilih salah satu.

Tidak ada migration baru untuk issue ini (lihat alasan desain di bawah) —
mengurangi satu titik konflik lagi dibanding perkiraan awal.

### Kenapa TIDAK ada migration baru

Field "Account metadata" di body issue (`organization_urn`,
`organization_name`, `member_role`, `permissions_json`, `token_expires_at`,
`last_verified_at`) dipetakan SELURUHNYA ke kolom generik yang sudah ada di
`awcms_social_accounts` (Issue #643) TANPA kolom baru:

- `organization_urn` -> `provider_account_id` (sudah ada).
- `organization_name` -> `provider_account_name` (sudah ada).
- `token_expires_at` -> `expires_at` (sudah ada).
- `last_verified_at` -> sudah ada, tidak disentuh field baru.
- `member_role` dan `permissions_json` **SENGAJA TIDAK DIPERSISTEN** —
  role organisasi LinkedIn seorang member bisa berubah/dicabut di sisi
  LinkedIn tanpa notifikasi ke aplikasi ini; menyimpan snapshot lama bisa
  memberi rasa aman palsu. Adapter ini mengecek role LIVE (dipanggil
  `organizationAcls`, di-mock di test) pada SETIAP percobaan publish
  (`publish()`) — bukan hanya sekali saat connect — persis menegakkan
  requirement "require supported permission and organization role" issue
  ini secara literal. `verifyCredentials()` juga melakukan pengecekan
  scope (dari `scopesJson`, parameter yang SUDAH ada di interface) dan
  validitas token (panggilan live ke `/v2/userinfo`, endpoint OpenID
  Connect LinkedIn), terpisah dari pengecekan role (yang butuh URN
  organisasi — parameter yang TIDAK ada di signature `verifyCredentials`,
  sehingga jadi tanggung jawab `publish()`, bukan `verifyCredentials()`).

### Kenapa TIDAK ada alur OAuth authorize/callback interaktif

Berbeda dari `google-oauth-client.ts` (redirect flow nyata, ada route
`/callback`), adapter ini TIDAK membangun redirect OAuth LinkedIn. Dua
alasan: (1) `token_reference` tidak boleh pernah berupa token mentah
(`looksLikeRawSecretToken` menolaknya) — sebuah callback OAuth nyata akan
menerima token asli dari LinkedIn, dan repo ini belum punya integrasi
secret-manager nyata untuk mengubahnya jadi referensi aman; (2) alur
connect fondasi (`POST /api/v1/social-publishing/accounts`) sudah generik
dan manual/operator-driven untuk SEMUA provider — LinkedIn tidak
dikecualikan. `LINKEDIN_CLIENT_ID`/`LINKEDIN_CLIENT_SECRET_REFERENCE`/
`LINKEDIN_OAUTH_REDIRECT_URI` tetap konfigurasi NYATA dan wajib
(divalidasi `config:validate`/`security:readiness`) — mendeskripsikan
LinkedIn App yang didaftarkan operator secara manual di LinkedIn Developer
portal (syarat app-review LinkedIn), bukan dipakai untuk redirect nyata di
kode ini. Detail penuh di `linkedin-provider-config.ts`'s header comment.

### Reuse `looksLikeRawSecretToken` — TIDAK ada heuristic baru

Sesuai instruksi security issue ini: `resolveLinkedInSecretReference`
(`linkedin-provider-config.ts`) memanggil `looksLikeRawSecretToken` DARI
`social-account-validation.ts` secara verbatim (bukan menduplikasi
heuristic-nya) untuk memvalidasi BAIK `LINKEDIN_CLIENT_SECRET_REFERENCE`
maupun setiap `token_reference` akun sebelum diresolusi. Resolusi sendiri
hanya memahami konvensi `env:VAR_NAME` (satu-satunya yang benar-benar bisa
diresolusi tanpa integrasi secret-manager nyata) — prefix lain
(`secretsmanager:`/`vault:`/dst.) lolos pengecekan bentuk tapi dilaporkan
`"unresolvable"`, jujur soal keterbatasan repo ini.

### Header API versi + protokol Rest.li

Setiap panggilan HTTP ke LinkedIn (`checkOrganizationRole`,
`uploadOrganizationImage`, pembuatan post, `verifyCredentials`) mengirim
`LinkedIn-Version` (dari `LINKEDIN_API_VERSION`, format "YYYYMM", divalidasi
`isValidLinkedInApiVersion`) dan `X-Restli-Protocol-Version: 2.0.0`
(konstanta tetap, bukan config — ini versi protokol wire Rest.li, beda
konsep dari versi API).

### Gambar — Images API asli LinkedIn, digerbang cek kepercayaan R2

`content.imageUrl` (sudah dijamin berasal dari objek R2 terverifikasi oleh
`create-social-publish-jobs.ts`'s `NewsMediaPort.resolveMediaReferences`)
diperiksa ULANG (defense-in-depth, `isTrustedR2MediaUrl`, membandingkan
terhadap `NEWS_MEDIA_R2_PUBLIC_BASE_URL` — import lintas modul yang
sengaja dan sempit, sama pola Keputusan kunci #6's "Catatan khusus" di
atas) sebelum adapter melakukan alur upload gambar LinkedIn asli
(`initializeUpload` -> fetch bytes -> `PUT`) dan memposting sebagai
`content.media`. Gambar tidak-terpercaya/tidak ada, atau kegagalan APA PUN
selama upload, terdegradasi dengan baik ke post link-share
(`content.article`, `source: canonicalUrl`) — gambar bersifat non-esensial
dan tidak boleh pernah memblokir publish yang sah.

### Idempotensi & redaksi

`idempotencyKey` (dari `job.id`, sudah dijamin idempoten di level DB oleh
Keputusan kunci #8) diteruskan sebagai header `X-Idempotency-Key` ke
LinkedIn (best-effort — LinkedIn tidak mendokumentasikan mekanisme
idempotency resmi untuk Posts API sejauh yang diketahui; jaminan idempotensi
NYATA tetap dari mekanisme outbox #643 sendiri: job yang sudah `published`
tidak pernah di-dispatch ulang). Setiap pesan error yang mungkin
menyertakan token diredaksi via substring-replacement literal (`redact()`,
bukan heuristic bentuk) menggunakan token bearer yang SUDAH diketahui
persis dalam scope panggilan tersebut — lebih andal daripada heuristic
karena nilai rahasianya sudah pasti diketahui, bukan ditebak.

### Tidak ada endpoint admin "verify connection" baru

`verify_linkedin_connection` (salah satu dari 3 "Supported initial
actions" di body issue) diimplementasikan penuh sebagai fungsi
`verifyCredentials()` (diuji langsung via unit test), TAPI TIDAK digerbang
ke endpoint HTTP baru — acceptance criteria issue ini tidak pernah meminta
tenant admin bisa MEMICU verifikasi secara manual (hanya connect/disconnect
yang eksplisit diminta, sudah dipenuhi endpoint generik yang ada sejak
#643). Mengurangi satu titik registrasi tambahan (SSR request path) yang
kalau tidak akan butuh wiring registrasi adapter ke proses server SSR juga
selain 2 script yang sudah ada — dicatat sebagai keputusan scope yang
disengaja, bukan kelalaian, bila endpoint ini dibutuhkan issue lanjutan.

### File yang dibuat/diubah

- `src/modules/social-publishing/domain/linkedin-provider-config.ts`
  (baru).
- `src/modules/social-publishing/infrastructure/linkedin-provider-adapter.ts`
  (baru) — `createLinkedInProviderAdapter`,
  `registerLinkedInProviderAdapterIfEnabled`, `isTrustedR2MediaUrl`.
- `scripts/social-publish-dispatch.ts`,
  `scripts/security-readiness.ts` (registrasi + `checkLinkedInProviderReadiness`),
  `scripts/validate-env.ts` (`checkLinkedInProviderConfig`).
- `src/lib/config/registry.ts`, `.env.example`, doc 18 (6 var baru
  `LINKEDIN_*`).
- `openapi/modules/social-publishing.openapi.yaml` (contoh
  `linkedin_organization` di skema akun, bukan endpoint baru — tidak ada
  endpoint HTTP baru diperkenalkan issue ini).
- Tidak ada migration baru, tidak ada perubahan AsyncAPI (tidak ada domain
  event baru — event outbox generik dari #643 sudah mencakup publish/fail/
  retry/reauth untuk provider apa pun termasuk LinkedIn).
- Test: `tests/unit/linkedin-provider-config.test.ts`,
  `tests/unit/linkedin-provider-adapter.test.ts`.
- Changeset: `.changeset/social-publishing-linkedin-adapter-issue-645.md`.

## §646 — Adapter Telegram channel (Selesai)

Adapter provider NYATA pertama di epic ini. `provider_key`
`telegram_channel`. Registrasi via
`infrastructure/telegram-provider-registration.ts` (side-effect import,
composition root — TIDAK mengubah isi `social-provider-registry.ts` sama
sekali, hanya memanggil `registerSocialProviderAdapter` yang sudah
diekspor).

### Keputusan kunci #1 — `verifyCredentials` interface diperluas dengan `providerAccountId`

Interface #643 (`domain/social-provider-adapter.ts`) awalnya
`verifyCredentials(tokenReference, scopesJson, env?)` — tidak cukup untuk
Telegram (dan kemungkinan besar Meta/LinkedIn juga): sebuah bot token bisa
VALID tapi tidak punya akses ke CHANNEL SPESIFIK yang mau diverifikasi.
Diperluas jadi `verifyCredentials(tokenReference, providerAccountId,
scopesJson, env?)` — perubahan aman/tidak breaking karena TIDAK ADA satu
pun caller nyata sebelum issue ini (foundation #643 sengaja nol adapter
nyata). `SocialProviderCredentialCheck` juga ditambah field opsional
`details?: Record<string, unknown>` (provider-specific display info,
mis. `botUsername`/`permissions` Telegram) — additive, tidak breaking.
**Perhatian untuk #644/#645**: bila kalian sudah mulai dari snapshot
sebelum PR ini merge, rebase dan sesuaikan signature `verifyCredentials`
kalian sendiri ke bentuk baru ini.

### Keputusan kunci #2 — endpoint `POST /accounts/{id}/verify` BARU, provider-neutral, bukan Telegram-khusus

Foundation #643 sendiri sudah mengantisipasi ini di komentar
`verifyCredentials` ("a manual 'verify connection' admin action") tapi
belum ada endpoint HTTP-nya. Ditambahkan di sini
(`pages/api/v1/social-publishing/accounts/[id]/verify.ts`) sebagai
kapabilitas GENERIK — memanggil `adapter.verifyCredentials(...)` milik
provider apa pun yang terdaftar, bukan route Telegram-spesifik. Permission
baru `social_publishing.accounts.verify` (migration 054) — reuse action
`verify` yang SUDAH ADA di `AccessAction` union (`identity-access/domain/
access-control.ts`, dari `tenant_domain.domains.verify` migration 032),
BUKAN action baru. Tidak masuk `HIGH_RISK_ACTIONS` (sama alasan
`domains.verify`: hanya mengubah `lastVerifiedAt`/`scopes_json`, tidak
pernah `tokenReference`) TAPI tetap wajib `Idempotency-Key` (real outbound
call ke provider, sama kelas risiko `accounts.connect`/`.disconnect`).

Endpoint ini 3-fase (CLAIM-like) meniru persis pola dispatcher
`social-publish-dispatch.ts`: (1) transaksi — authorize + idempotency
check + fetch account/credentials; (2) DI LUAR transaksi — panggilan
provider nyata (`adapter.verifyCredentials`); (3) transaksi — catat hasil

- simpan idempotency record. **Wajib dipertahankan pola ini** bila
  menambah endpoint lain yang memanggil provider (ADR-0006) — jangan
  gabungkan fase 2 ke dalam `withTenant` manapun.

Verifikasi GAGAL tetap `200 { valid: false, reason }` — bukan error HTTP,
dan TIDAK mengubah `connectionStatus`/`autoPublishEnabled` (informational,
supaya admin bisa perbaiki izin channel lalu coba lagi). Hanya percobaan
publish NYATA via dispatcher yang bisa memicu `needs_reauth` (mekanisme
#643 yang sudah ada, terpisah).

**Verifikasi TIDAK di-hardgate** ke endpoint connect/enable auto-publish
yang sudah ada (`POST /accounts`, `PATCH /accounts/{id}`) — akan
mengubah perilaku SEMUA provider (bukan cuma Telegram) dan berisiko
merusak test #643 yang sudah ada (connect-lalu-langsung-enable tanpa
verify). Sebagai gantinya, "verifies bot can post to channel before
enabling auto posting" ditegakkan sebagai READINESS SIGNAL
(`checkTelegramProviderReadiness`, §4 di bawah) — operator harus verify
manual dulu sebelum go-live, bukan gate runtime yang memblokir API.

### Keputusan kunci #3 — parse-mode sanitization: default plain text, escape single-pass

`domain/telegram-message-formatting.ts`. Default `TELEGRAM_DEFAULT_PARSE_MODE`
unset → TIDAK PERNAH mengirim `parse_mode` sama sekali → Telegram
memperlakukan SELURUH teks sebagai literal, nol kemungkinan interpretasi
formatting apa pun (title/excerpt user-authored boleh berisi tanda bintang
ganda `**`, garis bawah `_..._`, atau notasi tautan Markdown berkurung
siku-lalu-kurung — semuanya tetap literal). Bila operator secara eksplisit
set `MarkdownV2`/`HTML` (legacy `Markdown` SENGAJA tidak didukung), setiap
field yang diinterpolasi (title, excerpt, canonical URL) di-escape via
`escapeTelegramMarkdownV2`/`escapeTelegramHtml` — **satu pass regex
tunggal atas string asli**, BUKAN beberapa `.replace()` berurutan. Ini
penting: escaper MarkdownV2 memasukkan karakter backslash itu sendiri ke
dalam character class yang di-escape (bukan cuma `_*[]()~\`>#+-=|{}.!`) —
kalau tidak, backslash asli dalam input bisa "menguncinya" dengan
backslash yang BARU kita sisipkan sehingga karakter sesudahnya lolos
ter-escape (persis pola bug `mdescape-backslash-bug-recurs` yang sudah 3x
muncul di repo lain — lihat memory pribadi terkait). TIDAK PERNAH
membangun tautan inline bergaya Markdown dari data pengguna — URL kanonik
selalu baris teks polos yang di-escape, dibiarkan Telegram auto-link-detect
sendiri; ini menghilangkan seluruh permukaan "constructed unexpected
inline link" yang disebut security notes issue.

Hashtag dari tag artikel (`buildTelegramHashtags`) diimplementasikan dan
diuji standalone TAPI **belum dipakai nyata** — snapshot job outbox
(`awcms_social_publish_jobs`, migration 053) tidak punya kolom nama
tag sama sekali; menambahkannya berarti mengubah snapshot generik lintas
provider, di luar scope atomic issue adapter ini. `publish()` memanggil
`buildTelegramMessageText(content, [], parseMode)` — array hashtag selalu
kosong hari ini, didokumentasikan sebagai follow-up.

### Keputusan kunci #4 — bot-token-in-URL: SATU tempat, tidak pernah dibaca `response.url`

Bot API Telegram menaruh token di PATH URL (`.../bot<TOKEN>/<method>`) —
tidak ada alternatif transport lain dari Telegram sendiri. Mitigasi di
`infrastructure/telegram-provider-adapter.ts`:

- URL bertoken hanya pernah ada di satu scope lokal (`callTelegramApi`),
  dipakai untuk SATU panggilan `fetch()`, tidak pernah di-log/dikembalikan.
- `response.url` (properti bawaan `fetch()`, merefleksikan URL akhir
  termasuk token) TIDAK PERNAH dibaca di file ini — jebakan nyata yang
  gampang lolos code review biasa.
- Parameter dikirim sebagai JSON POST body, bukan query string.
- Error dari `error.message` hasil `fetch()`/timeout TIDAK PERNAH
  diinterpolasi mentah ke return value — hanya `description`/`error_code`
  hasil PARSING JSON respons Telegram sendiri (aman, Telegram tidak pernah
  echo token di body error) yang dipakai untuk pesan error/audit.

### Keputusan kunci #5 — readiness check baru: `checkTelegramProviderReadiness`

`scripts/security-readiness.ts`, critical, no-op saat
`TELEGRAM_PROVIDER_ENABLED` bukan `"true"` — **independen** dari
`SOCIAL_PUBLISHING_ENABLED`/`checkSocialPublishingProviderReadiness`
(deployment bisa full-online untuk Meta/LinkedIn tanpa pernah menyalakan
Telegram). Saat enabled, gagal bila ada akun `telegram_channel`
`connected` dengan `autoPublishEnabled=true` yang `lastVerifiedAt IS
NULL` — sinyal operasional untuk "Adapter verifies bot can post to
channel before enabling auto posting" (lihat Keputusan #2 di atas kenapa
ini bukan hard gate runtime). `checkTelegramProviderConfig`
(`scripts/validate-env.ts`) memvalidasi
`TELEGRAM_BOT_TOKEN_SECRET_REFERENCE` (reuse `looksLikeRawSecretToken` —
**JANGAN buat heuristic baru**, lihat riwayat 3-ronde PR #731),
`TELEGRAM_DEFAULT_PARSE_MODE`, `TELEGRAM_REQUEST_TIMEOUT_MS`.

### Izin bot/channel Telegram yang dibutuhkan

Bot harus ditambahkan sebagai **administrator** channel target dengan izin
"Post Messages" (`can_post_messages`). `verifyCredentials` memanggil
`getMe` (identitas bot) lalu `getChatMember` (status bot di channel
target) — gagal dengan reason `missing_channel_permission` bila status
bukan `administrator`/`creator`, atau `missing_post_permission` bila
administrator tapi `can_post_messages: false`.

### File yang dibuat/diubah (referensi cepat)

- `sql/055_awcms_social_publishing_verify_permission.sql` (satu
  permission `accounts.verify`).
- `src/modules/social-publishing/domain/social-provider-adapter.ts`
  (`verifyCredentials` +`providerAccountId`, `SocialProviderCredentialCheck` +`details`).
- `src/modules/social-publishing/domain/telegram-config.ts`,
  `telegram-message-formatting.ts` (baru).
- `src/modules/social-publishing/infrastructure/telegram-provider-adapter.ts`,
  `telegram-provider-registration.ts` (baru).
- `src/modules/social-publishing/application/social-account-directory.ts`
  (`fetchSocialAccountCredentialsForVerification`,
  `recordSocialAccountVerification`).
- `src/pages/api/v1/social-publishing/accounts/[id]/verify.ts` (baru).
- `src/modules/social-publishing/module.ts` (`accounts.verify` permission +
  2 event publishes baru).
- `scripts/social-publish-dispatch.ts`, `scripts/security-readiness.ts`
  (side-effect import registrasi adapter).
- `scripts/validate-env.ts` (`checkTelegramProviderConfig`),
  `scripts/security-readiness.ts` (`checkTelegramProviderReadiness`),
  `src/lib/config/registry.ts`, `.env.example`,
  `18_configuration_env_reference.md`.
- `openapi/modules/social-publishing.openapi.yaml` (`POST
.../accounts/{id}/verify` + `SocialAccountVerifyResult`).
- `asyncapi/awcms-domain-events.asyncapi.yaml`
  (`account.verified`/`account.verification-failed`).
- `src/pages/admin/social-publishing/accounts.astro` (tombol Verify +
  tampilan `lastVerifiedAt`).
- `i18n/en.po`, `i18n/id.po`, `i18n/messages.pot` (key baru
  `admin.social_publishing.accounts.{field_last_verified,not_verified,
verify_button,verify_success,verify_failed_prefix}`).
- Test: `tests/unit/telegram-message-formatting.test.ts`,
  `tests/unit/telegram-config.test.ts`,
  `tests/unit/telegram-provider-adapter.test.ts` (Bun.serve() fake
  `api.telegram.org` — TIDAK PERNAH panggilan jaringan nyata); diperbarui
  `tests/integration/social-publishing.integration.test.ts` (blok "account
  verify (Issue #646)", fake adapter ter-registrasi, TIDAK pernah menguji
  jalur HTTP Telegram nyata di level ini).
- Changeset: `.changeset/social-publishing-telegram-adapter-issue-646.md`.

### Belum/di luar cakupan issue ini (untuk #647 atau follow-up)

- Hashtag dari tag artikel — fungsi ada (`buildTelegramHashtags`), belum
  dipakai nyata (snapshot job tidak punya kolom tag).
- `sendPhoto`/preview gambar R2 — issue sendiri eksplisit izinkan
  "initial scope can use safe link post through sendMessage".
- Integrasi secret-manager nyata (`resolveTelegramBotToken` hanya
  mendukung indirection `env:VAR_NAME`) — residual yang sama dari #643.
- Auto-requeue/hard-gate verifikasi sebelum enable auto-publish — sengaja
  readiness signal, bukan runtime gate (lihat Keputusan #2).

## §647 — Dokumentasi/SOP (Selesai)

Issue dokumentasi murni — tidak ada kode/migration/endpoint baru. PR #756
(merged 2026-07-13) menambah lima dokumen baru di
`docs/awcms/news-portal/` plus pembaruan index
`docs/awcms/README.md`, menutup epic `social_publishing` (#643-#647)
seluruhnya dengan dokumentasi arsitektur, operasional, batasan provider,
dan keamanan yang sebelumnya hanya tersebar di komentar kode/skill ini.

### Lima dokumen yang ditambahkan

- **`social-sharing.md`** — mendokumentasikan fitur **social sharing
  manual** (Issue #642, tombol share milik PEMBACA, tanpa kredensial atau
  panggilan API eksternal) dan secara eksplisit membedakannya dari
  **social publishing / auto-posting** — tabel perbandingan §1 mencegah
  pembaca mengira keduanya sistem yang sama (modul, kredensial, dan
  persistence-nya sepenuhnya berbeda).
- **`social-publishing-architecture.md`** — arsitektur sistem auto-posting
  itu sendiri: gerbang dua-flag `SOCIAL_PUBLISHING_ENABLED`/
  `SOCIAL_PUBLISHING_PROFILE` (§1), model data 6 tabel (§2), dan alur
  outbox/dispatcher/approval/retry — ringkasan arsitektur yang melengkapi
  (bukan menggantikan) keputusan kunci #643-#646 yang sudah didetailkan
  di skill ini.
- **`social-publishing-sop.md`** — panduan **operator/redaksi** (bukan
  panduan kode): prasyarat sebelum mengaktifkan auto-posting, checklist
  setup per provider (Meta/LinkedIn/Telegram) termasuk langkah OAuth di
  luar aplikasi, dan permission yang dibutuhkan tiap peran.
- **`social-provider-limitations.md`** — batasan NYATA yang benar-benar
  terimplementasi per provider (bukan rencana/aspirasi): tipe akun yang
  didukung/ditolak, jenis post, ketiadaan idempotency-key native di Graph
  API, pemetaan pesan error, dan skema `token_reference` yang benar-benar
  bisa diresolusi (`env:VAR_NAME` saja).
- **`social-publishing-security-checklist.md`** — checklist keamanan dan
  incident response: token storage (referensi, bukan token nyata), scope
  query yang boleh mengembalikan `token_reference`, dan penegasan bahwa
  seluruh nilai contoh di dokumen ini sengaja placeholder palsu (mis.
  `"env:META_APP_SECRET_EXAMPLE"`) — jangan pernah menempelkan kredensial
  nyata di dokumentasi/tiket/log.

### File yang dibuat/diubah (referensi cepat)

- `docs/awcms/news-portal/social-sharing.md` (baru).
- `docs/awcms/news-portal/social-publishing-architecture.md` (baru).
- `docs/awcms/news-portal/social-publishing-sop.md` (baru).
- `docs/awcms/news-portal/social-provider-limitations.md` (baru).
- `docs/awcms/news-portal/social-publishing-security-checklist.md`
  (baru).
- `docs/awcms/README.md` (index, tautan ke lima dokumen di atas).

Epic `social_publishing` (#643-#647) sekarang **selesai seluruhnya** —
lihat §Status per issue di atas.
