---
name: awcms-visitor-analytics
description: Kerjakan bagian mana pun dari epic visitor analytics AWCMS (Issue #617-#624). Gunakan saat menambah/mengubah VISITOR_ANALYTICS_* env config, skema session/event/rollup, helper identity/UA/bot classification, middleware collector, API/dashboard `/admin/analytics`, enrichment geolokasi, atau job rollup/retention purge. Merangkum keputusan yang sudah dibuat supaya issue lanjutan tidak mengulang/kontradiksi.
---

# AWCMS — Visitor Analytics

Epic visitor analytics (#617-#624) menambah **statistik pengunjung manusia
privacy-first** untuk rute admin dan publik, di konfigurasi online maupun
offline/LAN. Modul baru `visitor_analytics` (`type: "system"`) — bukan
diperluas dari `reporting`/`logging` yang sudah ada, karena volume,
retensi, dan kontrol privasi visitor telemetry berbeda dari keduanya
(lihat `src/modules/visitor-analytics/README.md` §Why a separate module).

## Kapan pakai skill ini vs skill generik

Skill ini melengkapi (bukan menggantikan) `awcms-new-endpoint`,
`awcms-new-migration`, `awcms-new-module`,
`awcms-abac-guard`, `awcms-sensitive-data` (IP/user-agent/geo
adalah data sensitif), `awcms-ui-screen` (dashboard #622), dan
`awcms-observability` (retensi/purge, korelasi dengan audit log yang
sudah ada). Skill ini menyediakan konteks **cross-cutting epic
spesifik** yang menjembatani beberapa issue sekaligus.

## Status per issue (jangan bangun ulang yang sudah ada)

| Issue | Scope                                                                                                                                             | Status                                                                                                                            |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| #617  | Module descriptor, permission catalog, config gate                                                                                                | **Selesai** — lihat §Config di bawah                                                                                              |
| #618  | Visitor session/event/rollup schema + RLS                                                                                                         | **Selesai** — lihat §Schema di bawah                                                                                              |
| #619  | Visitor identity, user-agent, human/bot classification helpers                                                                                    | **Selesai** — lihat §Domain helpers di bawah                                                                                      |
| #620  | Middleware telemetry collection (admin + public)                                                                                                  | **Selesai** — lihat §Collector di bawah                                                                                           |
| #621  | Analytics API + OpenAPI contract (`/api/v1/analytics`)                                                                                            | **Selesai** — lihat §API di bawah                                                                                                 |
| #623  | Trusted online geolocation enrichment                                                                                                             | **Selesai** — lihat §Geo enrichment di bawah                                                                                      |
| #622  | Admin visitor analytics dashboard UI (`/admin/analytics`)                                                                                         | **Selesai** — lihat §Dashboard UI di bawah                                                                                        |
| #624  | Rollup job, retention purge job, readiness checks, docs pass; REOPENED 2026-07-11 dengan repository audit addendum (default-off, cookie lifetime) | **Selesai** (termasuk addendum) — lihat §Rollup job, §Retention purge job, §Readiness checks, §Repository audit addendum di bawah |

Urutan dependency (dari body issue masing-masing): 617 → 618 → 619 → 620 →
621 → 622; 623 boleh setelah 620 (paralel dengan 621/622); 624 butuh
617+618+620+621 dan melengkapi 622/623. **Epic #617-#624 selesai penuh**,
termasuk repository audit addendum #624 (2026-07-11, epic
platform-hardening #679) — lihat §Repository audit addendum di bawah
sebelum menganggap default lama (`ENABLED=true`, cookie 2 tahun) masih
berlaku.

## Yang sudah ada — pakai ulang, jangan re-derive

### Config (Issue #617, `src/modules/visitor-analytics/domain/visitor-analytics-config.ts`)

Tujuh belas env var, semuanya **opsional** dan privacy-first — kalau tidak
di-set sama sekali, `config:validate` tetap PASS, modul TIDAK aktif
(§Repository audit addendum), dan tidak ada raw IP/raw user-agent/
geolokasi yang tersimpan:

- `VISITOR_ANALYTICS_ENABLED` (default `false` sejak Issue #624
  repository audit addendum, 2026-07-11 — sebelumnya `true` di rilis
  awal Issue #617) — master switch. Deployment existing yang sudah
  men-set var ini `true` eksplisit tidak terdampak; lihat §Repository
  audit addendum untuk migration note lengkap.
- `VISITOR_ANALYTICS_MODE` (default `basic`) — enum `basic | detailed`
  (`VISITOR_ANALYTICS_MODES`, `isKnownVisitorAnalyticsMode`). Nilai tak
  dikenal jatuh ke `basic`, tidak pernah throw.
- `VISITOR_ANALYTICS_COLLECT_ADMIN` / `_COLLECT_PUBLIC` / `_COLLECT_API` —
  toggle per permukaan (default `true`/`true`/`false`).
- `VISITOR_ANALYTICS_DETAILED_ENABLED` — cadangan mode `detailed` (default
  `false`, belum dikonsumsi apa pun).
- `VISITOR_ANALYTICS_RAW_IP_ENABLED` / `_RAW_USER_AGENT_ENABLED` /
  `_GEO_ENABLED` — **default `false` semuanya**, ini inti privacy-first
  gate-nya. Independen dari `VISITOR_ANALYTICS_MODE` — mode tidak pernah
  menyalakan ketiganya secara implisit.
- `VISITOR_ANALYTICS_TRUST_PROXY` / `_TRUST_CLOUDFLARE` — default `false`;
  sama prinsip keamanan dengan `PUBLIC_TRUST_PROXY` (skill
  `awcms-tenant-domain-routing`) — hanya `true` di belakang proxy
  tepercaya yang benar-benar mengisi ulang header, bukan meneruskan nilai
  klien.
- Lima var retensi/jendela/TTL — `VISITOR_ANALYTICS_ONLINE_WINDOW_SECONDS`
  (300), `_EVENT_RETENTION_DAYS` (90), `_RAW_DETAIL_RETENTION_DAYS` (30),
  `_ROLLUP_RETENTION_DAYS` (730), `_VISITOR_KEY_COOKIE_TTL_DAYS` (30,
  Issue #624 repository audit addendum — sebelumnya hardcoded
  ~2 tahun/`63_072_000` detik di `src/middleware.ts`, bukan env var sama
  sekali) — divalidasi `parsePositiveInt`, wajib integer positif **bila
  diisi**; tak diisi → default di atas, tidak pernah gagal validasi.
- `VISITOR_ANALYTICS_HASH_SALT` (default `""`) — salt untuk fingerprint
  visitor pseudonymous, dikonsumsi `domain/visitor-key.ts`'s
  `hashVisitorKey`/`hashIpAddress`/`hashUserAgent` (Issue #619) — lihat
  §Domain helpers di bawah. Belum ada caller yang benar-benar memanggil
  fungsi hashing ini dengan nilai request nyata sampai middleware #620.

Entry point: `resolveVisitorAnalyticsConfig(env)` — SATU fungsi yang
harus dipanggil issue lanjutan (#619 helper, #620 middleware), jangan
re-derive baca `process.env.VISITOR_ANALYTICS_*` langsung. Gate boolean
tunggal: `isVisitorAnalyticsEnabled(env)`.

Validasi: `checkVisitorAnalyticsConfig()` (`scripts/validate-env.ts`),
dipanggil dari `runEnvValidation()`. Didokumentasikan di
`docs/awcms/18_configuration_env_reference.md` §Visitor analytics.
Test: `tests/unit/visitor-analytics-config.test.ts`,
`tests/validate-env.test.ts`'s `describe("checkVisitorAnalyticsConfig", ...)`.

### Module descriptor (Issue #617, `src/modules/visitor-analytics/module.ts`)

Modul `visitor_analytics` terdaftar di `src/modules/index.ts`'s
`listModules()`. **Hanya descriptor + config** — tidak ada tabel/API/UI/
middleware di sini, itu semua issue lanjutan.

- `key: "visitor_analytics"`, `type: "system"` (bukan `"domain"`) —
  observability infrastructure yang dipakai bersama semua tenant, sama
  alasan dengan `reporting`/`logging`/`tenant_domain`.
- `dependencies: ["tenant_admin", "identity_access", "logging", "reporting"]`
  (persis daftar di body issue #617).
- `api: { basePath: "/api/v1/analytics", openApiPath:
"openapi/awcms-public-api.openapi.yaml" }` dan `navigation: [{
path: "/admin/analytics", requiredPermission:
"visitor_analytics.dashboard.read", order: 70 }]` **dideklarasikan sejak
  Issue #617** meski saat itu API (#621)/dashboard (#622) belum ada —
  konvensi sama dengan `tenant_domain`'s descriptor sebelum #562. Kedua
  issue itu sekarang sudah selesai (lihat §API dan §Dashboard UI di
  bawah), jadi `navigation`/`api` di atas bukan lagi janji ke depan.
- `permissions`: 8 entry (`dashboard.read`, `realtime.read`,
  `sessions.read`, `events.read`, `raw_detail.read`, `settings.read`,
  `settings.update`, `retention.purge`), match persis seed migration 038
  — divalidasi `tests/modules/visitor-analytics-module.test.ts`.
  `raw_detail.read` **sengaja terpisah** dari `dashboard.read` — operator
  bisa memberi akses dashboard agregat tanpa memberi akses PII mentah
  (IP/user-agent).
- Tidak ada field `settings`/`jobs`/`health` — belum ada
  settings-API/job/health-check nyata untuk didokumentasikan (konsisten
  konvensi `module_management/README.md`, lihat juga precedent
  `tenant_domain` Issue #558).
- Tidak ada folder `application/`/`infrastructure`/`api` yang dibuat di
  Issue #617 — hanya `module.ts` + `domain/visitor-analytics-config.ts` +
  `README.md`. Folder lain menyusul issue yang benar-benar butuh
  (#618 schema, #619 helpers, #620 middleware, #621 API).

Permission migration: `sql/038_awcms_visitor_analytics_permissions.sql`
— pola sama `sql/032_awcms_tenant_domain_permissions.sql` (`INSERT ...
ON CONFLICT (module_key, activity_code, action) DO NOTHING`), belum ada
role/access assignment yang memakainya.

### Schema (Issue #618, `sql/039_awcms_visitor_analytics_schema.sql`)

Tiga tabel tenant-scoped, semua `ENABLE`+`FORCE ROW LEVEL SECURITY` dengan
policy standar `tenant_id = current_setting('app.current_tenant_id')::uuid`.
**Schema saja — belum ada writer**: middleware (#620) belum menulis apa
pun ke sini.

- `awcms_visitor_sessions` — satu baris per sesi presence. `area IN
('admin','public','api','auth','setup','unknown')`, `device_type IN
('desktop','mobile','tablet','bot','unknown')` (nullable). `ip_address`
  (raw `inet`) nullable, hanya diisi kalau
  `VISITOR_ANALYTICS_RAW_IP_ENABLED=true`. `login_identifier_snapshot`
  nullable, **tidak boleh** diisi untuk pengunjung publik anonim.
- `awcms_visit_events` — satu baris per page-view/API call.
  `human_status IN ('human','bot','unknown')`, `status_code` (nullable)
  wajib 100-599 bila diisi. Dua kolom `jsonb` catch-all
  (`user_agent_parsed`, `geo`) default `'{}'::jsonb` — hanya untuk nilai
  hasil parse (Issue #619/#623), tidak pernah raw request data.
- `awcms_visitor_daily_rollups` — `PRIMARY KEY (tenant_id, date,
area)`, sekaligus target upsert job rollup (#624). Tidak ada index
  terpisah `(tenant_id, date, area)` — PK sudah menyediakannya, index
  redundan yang diminta issue sengaja tidak dibuat.

Tidak ada `deleted_at`/soft delete di tiga tabel ini (bukan master/config
data) — lifecycle-nya purge berbasis retensi (job Issue #624), pola sama
`awcms_audit_events` (migration 011).

Test: `tests/integration/visitor-analytics-schema.integration.test.ts` —
constraint check per tabel, RLS isolation lintas tenant, fail-closed tanpa
GUC, dan scan kolom memastikan tidak ada kolom berbentuk secret (password/
token/cookie/authorization/request_body).

Docs: `docs/awcms/04_erd_data_dictionary.md` §Visitor Analytics
(ERD ringkas) dan §Retention awal (dua baris retensi baru).

**Temuan security-auditor Issue #618 (Medium, DITUTUP di Issue #620 — lihat
§Collector di bawah):** FK biasa
(`identity_id uuid REFERENCES awcms_identities (id)`,
`visitor_session_id uuid REFERENCES awcms_visitor_sessions (id)`)
**tidak dilindungi RLS** — constraint-check FK PostgreSQL berjalan dengan
privilege owner tabel, bukan role pemanggil (dokumentasi resmi
`CREATE POLICY`: "foreign key references are not restricted by row
security"). Kalau nilai `identity_id`/`visitor_session_id` yang ditulis
Issue #620 pernah berasal dari input yang dikontrol client (bukan
di-derive dari session/tenant context di server), ini jadi **existence
oracle lintas tenant** (attacker bisa binary-search UUID buat tahu
"row ini ada di suatu tenant" vs "row ini tidak ada sama sekali", lepas
dari RLS). **Wajib dipertahankan Issue #620**: `identity_id` selalu
di-derive dari identity sesi terautentikasi milik request itu sendiri
(tidak pernah dari field yang bisa diisi client), `visitor_session_id`
selalu di-resolve server-side dari cookie/token opaque yang di-lookup di
dalam tenant context pemanggil sendiri (tidak pernah dari raw UUID
client yang langsung dicocokkan ke FK). Tambahkan test integrasi di #620
yang membuktikan UUID palsu/lintas-tenant di salah satu field ditolak
sebelum sempat menyentuh FK.

### Domain helpers (Issue #619, `src/modules/visitor-analytics/domain/`)

Lima file, semua pure/hampir-pure. `application/collector.ts` (Issue
#620) adalah caller pertama — jangan re-derive logic ini di issue
lanjutan mana pun; import langsung.

- `visitor-key.ts` — `generateVisitorKey`/`isValidVisitorKey`/
  `resolveVisitorKey` (cookie anonim, tolak nilai forged/non-UUID) dan
  `hashVisitorKey`/`hashIpAddress`/`hashUserAgent` (HMAC-SHA256 di-key
  dengan `VISITOR_ANALYTICS_HASH_SALT` — beda dari `hashIdentifier`
  profile-identity yang sengaja unsalted, lihat file ini untuk alasan
  lengkap).
- `user-agent.ts` — `parseUserAgent`/`isBotUserAgent`. Tabel regex
  ringkas (bukan dependency npm) untuk browser (Chrome/Firefox/Safari/
  Edge/Opera/Samsung Internet/IE), OS (Windows/macOS/iOS/Android/Chrome
  OS/Linux — **urutan cek OS penting**: iOS/Android/CrOS dicek sebelum
  Windows/macOS/Linux karena UA iPhone/iPad selalu membawa token
  kompatibilitas "like Mac OS X" dan UA Android/CrOS dibangun di atas
  string kernel Linux — cek yang lebih spesifik dulu mencegah salah
  klasifikasi), device type, dan ~30 signature bot/crawler/social-preview/
  automation-client. **Bukan titik keputusan otorisasi/keamanan** — UA
  bisa dipalsukan trivial.
- `human-classifier.ts` — `classifyHumanStatus` (tri-state
  human/bot/unknown untuk `visit_events.human_status`: bot UA selalu
  menang; sesi terautentikasi + UA apa pun non-bot = human; request
  anonim + UA tak dikenal = **unknown**, tidak pernah default human) dan
  `classifySessionHumanity` (boolean `is_human`/`bot_reason` untuk
  `visitor_sessions`, yang tidak punya kolom tri-state).
- `path-sanitizer.ts` — `sanitizePath` (buang 11 query param sensitif
  minimum issue: token/code/password/secret/email/phone/authorization/
  access_token/refresh_token/reset_token/mfaChallengeToken, case-
  insensitive) dan `isTrackablePath` (exclude static asset, `/_astro/*`,
  favicon, endpoint health, path spec OpenAPI/AsyncAPI dari hitungan
  pageview). **Fail SAFE, bukan fail open** (post-review fix PR #627):
  input yang gagal di-parse `URL()` membuang seluruh query string
  (`rawPath.split("?")[0]`), bukan echo raw input — versi awal echo raw
  input, yang bisa membocorkan query param sensitif yang justru gagal
  di-parse (mis. IPv6 literal rusak).
- `referrer.ts` — `extractReferrerDomain` (hostname saja, tidak pernah
  path/query/fragment, `null` untuk scheme non-http(s)).

Test: `tests/unit/visitor-analytics-{visitor-key,user-agent,human-classifier,path-sanitizer,referrer}.test.ts`
— `user-agent.test.ts` mencakup 20+ contoh UA nyata (desktop/mobile/
tablet/13 signature bot/unknown).

### Collector (Issue #620, `application/collector.ts` + `src/middleware.ts`)

Satu-satunya writer `awcms_visitor_sessions`/`awcms_visit_events`.
`src/middleware.ts` memanggilnya setelah `next()` resolve (di kedua
cabang pre-admin dan `/admin/*`), jadi `response.status` sudah diketahui.

- **Gate**: `shouldCollectRequest` (pure, unit-tested) — cek
  `config.enabled` → `isTrackablePath` → flag per-area
  (`COLLECT_ADMIN`/`COLLECT_API`/`COLLECT_PUBLIC`). `/login` diklasifikasi
  `public` (page render), bukan `auth` — `auth`/`setup` khusus untuk
  `/api/v1/auth/*`/`/api/v1/setup/*`, sama-sama digerbangi `COLLECT_API`
  (`domain/request-area.ts`'s `determineArea`).
- **Resolusi tenant**: `/admin/*` pakai `ssrContext.tenantId` yang sudah
  ada (redirect guard sudah jalan lebih dulu). Area lain pakai
  `resolvePublicTenantFromRequest` (#559) — best-effort, tenant tidak
  resolve = tidak dikoleksi, bukan hard failure.
- **Cookie visitor**: `awcms_visitor_key`, `httpOnly`+`sameSite=lax`,
  di-set hanya saat request benar-benar dikoleksi. **Diubah Issue #624
  repository audit addendum**: maxAge sekarang configurable
  (`VISITOR_ANALYTICS_VISITOR_KEY_COOKIE_TTL_DAYS`, 30 hari default —
  bukan lagi hardcoded 2 tahun), dan `src/middleware.ts` memanggil
  `shouldRevokeVisitorKeyCookie`/`planVisitorKeyCookie`
  (`domain/visitor-key-cookie.ts`, fungsi pure baru) SEBELUM gate
  path/area: cookie yang sudah ada dihapus aktif begitu
  `VISITOR_ANALYTICS_ENABLED` bukan `"true"`, dan tidak ada cookie/event
  baru yang pernah ditulis selama modul nonaktif. Jangan re-derive logic
  set/delete cookie langsung di `src/middleware.ts` lagi — kedua fungsi
  pure itu satu-satunya tempat keputusannya.
- **Session find-or-create**: lookup `(tenant_id, visitor_key_hash,
area)` (index baru migration 040). Dalam window
  `VISITOR_ANALYTICS_ONLINE_WINDOW_SECONDS` → reuse row, tapi UPDATE
  hanya jika tulisan terakhir ≥30 detik lalu (write-throttle). Di luar
  window → session baru. Event **tidak pernah** di-throttle — selalu satu
  baris per request yang dikoleksi. `login_identifier_snapshot` sengaja
  selalu `null` (deferred, bukan regresi — lihat README modul).
- **Fail-open**: `collectVisitorTelemetry` tidak pernah throw — semua
  error ditangkap, dicatat `log("warning", "visitor_analytics.collector.failed", ...)`
  dengan `correlationId`, tidak pernah membocorkan data sensitif.
  `withTenant` dipanggil dengan `workClass: "background_sync"` (prioritas
  DB terendah, doc 16).
- **FK-oracle DITUTUP** (temuan security-auditor #618 di atas):
  `identityId` selalu dari `ssrContext.identityId` (server-derived,
  hanya ada setelah redirect guard `/admin/*` lolos) atau `null` untuk
  publik — tidak pernah dari input client. `visitor_session_id` selalu
  dari row yang baru saja ditemukan/dibuat fungsi ini sendiri di dalam
  transaksi tenant-scoped-nya sendiri — tidak pernah dari UUID mentah
  client.
- **Client IP**: `domain/client-ip.ts`'s `resolveAnalyticsClientIp` —
  saudara `lib/security/rate-limit.ts`'s `resolveClientIp` yang lebih
  konservatif; hanya percaya `CF-Connecting-IP`/`X-Forwarded-For` saat
  `VISITOR_ANALYTICS_TRUST_CLOUDFLARE`/`_TRUST_PROXY` eksplisit `true`.

Test: `tests/unit/visitor-analytics-collector.test.ts` (`shouldCollectRequest`),
`tests/unit/visitor-analytics-request-area.test.ts`,
`tests/unit/visitor-analytics-client-ip.test.ts`,
`tests/integration/visitor-analytics-collector.integration.test.ts` (9
test: create, sanitize, bot classify, raw-IP opt-in, throttle+reuse,
session rollover, non-trackable no-op, fail-open invalid tenant,
authenticated admin). Juga smoke-test manual lewat dev server + Postgres
nyata (setup wizard → login → `/admin` → row session/event benar; `/` →
session publik; asset statis dan `/api/v1/health` default-off → nihil).

### API (Issue #621, `src/pages/api/v1/analytics/*`)

11 endpoint. Semua wajib bearer session + tenant context + `authorizeInTransaction`
(ABAC default-deny) — deny selalu `403 ACCESS_DENIED`, tidak pernah data
analytics kosong/nol diam-diam.

- `GET /realtime` (`realtime.read`), `GET /summary|pages|devices|locations|security`
  (`dashboard.read`, `range=24h|7d|30d|12m` divalidasi ketat →
  `400 VALIDATION_ERROR` untuk nilai lain).
- `GET /sessions` (`sessions.read`), `GET /events` (`events.read`) — keyset
  pagination (limit 50), field raw detail (`ipHash`/`ipAddress`/
  `userAgentHash`/`loginIdentifierSnapshot`) `null` kecuali caller **juga**
  punya `raw_detail.read` (dicek via `auth.grantedPermissionKeys.has(...)`
  setelah guard utama lolos — `domain/analytics-response-shaping.ts`).
- `GET/PATCH /settings` (`settings.read`/`.update`) — **reuse langsung**
  storage generik Module Management (`awcms_module_settings`, Issue
  #516) via `fetchModuleSettingsView`/`updateModuleSettings`, tapi
  di-gate permission `visitor_analytics.*` sendiri (bukan
  `module_management.settings.*` yang dipakai endpoint generiknya). Jangan
  bangun storage settings kedua untuk modul ini.
- `POST /retention/purge` (`retention.purge`) — wajib `Idempotency-Key`,
  audit `critical`. Logic nyata (bukan stub) di
  `application/retention-purge.ts`: hapus event > `EVENT_RETENTION_DAYS`,
  clear `ip_address`/`login_identifier_snapshot` sesi > `RAW_DETAIL_RETENTION_DAYS`
  (row tetap), hapus sesi > `EVENT_RETENTION_DAYS` (aman dijalankan
  setelah hapus event — `last_seen_at` sesi selalu >= `occurred_at`
  event-nya sendiri, jadi FK `visit_events.visitor_session_id` sudah
  bersih), hapus rollup > `ROLLUP_RETENTION_DAYS`. Issue #624's scheduled
  job **selesai** — `bun run analytics:purge`
  (`scripts/visitor-analytics-purge.ts`, via `purgeVisitorAnalyticsForAllTenants`)
  memanggil `purgeVisitorAnalyticsData` ini langsung untuk setiap tenant
  `active`, tidak re-derive. Lihat §Rollup job/§Retention purge job di
  bawah untuk detail penuh.
- Query agregat (`application/analytics-queries.ts`) baca langsung dari
  `visit_events`/`visitor_sessions` mentah, **bukan** `visitor_daily_rollups`
  — tetap begitu setelah #624: rollup job (di bawah) kini mengisi tabel
  itu, tapi switch `fetchAnalyticsSummary` membaca rollup untuk rentang
  lama tetap open future work (optimisasi performa, bukan bagian
  acceptance criteria #624).

Test: `tests/unit/visitor-analytics-{range,response-shaping}.test.ts`,
`tests/integration/visitor-analytics-api.integration.test.ts` (13 test:
auth guard, ABAC deny lintas endpoint, realtime, summary+range validation,
raw-detail gating dua arah, keyset pagination 55-row, FK-straddle purge,
geo/jsonb object shape lewat API nyata, settings GET/PATCH + secret-key
rejection, retention purge idempotency+delete+audit).

### Geo enrichment (Issue #623, `domain/geo-enrichment.ts`)

Country code saja, dari header Cloudflare `CF-IPCountry` — **tidak
pernah** external network call. Gate ganda: `VISITOR_ANALYTICS_GEO_ENABLED`
**dan** `VISITOR_ANALYTICS_TRUST_CLOUDFLARE` harus `true` keduanya;
salah satu `false` → semua field `null`. Region/city/timezone selalu
`null` di issue ini (belum ada local GeoIP DB, out of scope).

`src/middleware.ts` panggil `resolveGeoEnrichment` di samping
`resolveAnalyticsClientIp`, hasilnya masuk `collectVisitorTelemetry`'s
field baru `geo` (Issue #620's `collector.ts` di-extend, bukan file
baru) — ditulis ke `visitor_sessions.country_code/region/city/timezone`
DAN `visit_events.geo` (shape sama yang sudah dibaca
`fetchTopCountries`, Issue #621 — `GET /api/v1/analytics/locations`
otomatis dapat data nyata begitu geo enrichment aktif, tanpa ubah sisi
API).

**Hardening ambiguous-header** (`domain/client-ip.ts`, issue ini juga):
`resolveAnalyticsClientIp` sekarang menolak `X-Forwarded-For`/
`CF-Connecting-IP` yang punya >1 nilai comma-separated (anomali, log
warning, fallback ke sumber berikutnya — sama persis pola
`X-Forwarded-Host` di `public-host-tenant-resolver.ts`, epic
tenant-domain-routing). Proxy tepercaya yang benar wajib **overwrite**,
bukan **append**, header ini (kontrak sama `PUBLIC_TRUST_PROXY`, doc 18)
— jadi proxy yang dikonfigurasi benar tidak pernah menghasilkan >1 nilai
di sini juga.

**Temuan post-review issue ini — bug jsonb laten sejak #620**:
`collector.ts`'s `user_agent_parsed`/`geo` sebelumnya ditulis via
`JSON.stringify(...)::jsonb` — bytes yang tersimpan identik dengan
`${object}::jsonb`, TAPI Bun.SQL men-decode SELECT berikutnya dari
kolom itu sebagai raw JSON **string**, bukan object ter-parse (lihat
memory `bun-sql-jsonb-stringify-trap` untuk bukti empiris lengkap).
Ini diam-diam memengaruhi response `GET /api/v1/analytics/events`'s
`userAgentParsed`/`geo` sejak #621 rilis. **Wajib dipertahankan issue
lanjutan**: selalu bind object JS polos sebagai parameter query untuk
kolom jsonb (`${plainObject}::jsonb`), jangan pernah
`JSON.stringify()` dulu — cek `grep -rn "JSON.stringify.*::jsonb"` di
modul manapun yang disentuh sebelum menganggap kolom jsonb "sudah
benar".

Test: `tests/unit/visitor-analytics-{client-ip,geo-enrichment}.test.ts`,
`tests/integration/visitor-analytics-collector.integration.test.ts`
(geo tertulis ke session+event, geo kosong tetap null),
`tests/integration/visitor-analytics-api.integration.test.ts` (geo/
userAgentParsed object nyata lewat `/events` dan `/locations`).

### Dashboard UI (Issue #622, `src/pages/admin/analytics.astro`)

`/admin/analytics`, gate `visitor_analytics.dashboard.read`. **UI-only** —
tidak menambah endpoint/permission baru, tidak pernah query
`awcms_visitor_sessions`/`awcms_visit_events` langsung. Semua
angka/tabel dimuat client-side dari `GET /api/v1/analytics/*` (#621) lewat
helper baru `fetchJson` (`src/lib/ui/admin-form-client.ts`) — SENGAJA
bukan konvensi SSR-panggil-application-layer-langsung yang dipakai
`admin/security.astro`/`admin/sync.astro`, supaya ABAC server-side
(`authorizeInTransaction`) tetap satu-satunya enforcement point nyata.

- **Raw-detail gating tidak di-derive ulang** — dashboard render persis
  apa yang API kembalikan (`domain/analytics-response-shaping.ts` sudah
  men-null-kan `ipAddress`/`ipHash`/`userAgentHash`/
  `loginIdentifierSnapshot` untuk caller tanpa `raw_detail.read`); logic
  UI baru (`domain/dashboard-view.ts`'s `displayOrPlaceholder`/
  `buildSessionRowCells`) cuma menerjemahkan `null` jadi placeholder
  aman, tidak pernah membuat keputusan izin sendiri. `showRawDetailColumns`
  cuma menyembunyikan 4 kolom tabel sebagai kosmetik (biar caller yang
  memang tidak akan pernah lihat nilai asli tidak melihat tembok tanda
  strip) — tidak bisa bocor karena nilai yang ditampilkan selalu berasal
  dari respons API apa adanya.
- **Filter area/visitor-type TIDAK menyentuh endpoint agregat** — tidak
  ada endpoint #621 yang menerima parameter `area`/tipe pengunjung, jadi
  kedua filter ini cuma menyaring baris tabel active-sessions yang sudah
  ter-fetch (client-side, `matchesAreaFilter`/`matchesVisitorTypeFilter`).
  Hanya `range` (`24h|7d|30d|12m`) yang benar-benar query parameter API
  nyata (`/summary`, `/pages`, `/devices`, `/locations`, `/security`).
  Jangan bangun ulang asumsi "semua filter berlaku ke semua section" di
  issue lanjutan manapun tanpa lebih dulu menambah parameter itu ke API
  (perubahan API, di luar scope #622).
- **Geo gate** — Location section tampil sebagai `StateNotice` disabled
  kalau `resolveVisitorAnalyticsConfig().geoEnabled &&
.trustCloudflare` tidak keduanya `true` (baca config env langsung,
  bukan akses DB, bukan gerbang keamanan kedua — cuma keputusan render).

Test: `tests/unit/visitor-analytics-dashboard-view.test.ts` (raw-detail-
null formatting, section-state loading/empty/error, filter predicate —
semua pure), `tests/e2e/admin-analytics-access-denied.e2e.ts`,
`tests/e2e/admin-analytics-dashboard.e2e.ts` (raw-detail gating end-to-end
lewat render browser sungguhan — caller tanpa `raw_detail.read` melihat
baris sesi tenant yang sama tanpa kolom raw-detail maupun nilai
`sha256:`-prefixed apa pun).

### Rollup job (Issue #624, `application/rollup.ts` + `scripts/visitor-analytics-rollup.ts`)

`bun run analytics:rollup` — mengagregasi `awcms_visit_events`
mentah menjadi `awcms_visitor_daily_rollups`, satu baris per
`(tenant, date, area)`, untuk setiap tenant `active`.

- **Idempotent by construction**: `rollupVisitorAnalyticsForDate`
  merekomputasi PENUH dari event mentah untuk tanggal yang diminta dan
  UPSERT (`ON CONFLICT (tenant_id, date, area) DO UPDATE SET ... =
EXCLUDED...`) — rerun tanggal yang sama berkali-kali selalu konvergen
  ke baris yang sama, tidak pernah menambah ke nilai lama. Jangan ubah
  ini jadi logic increment/append apa pun.
- **SENGAJA tidak reuse `application/analytics-queries.ts`'s top-N
  helper verbatim** — fungsi-fungsi itu cumulative-since-`start` (tanpa
  batas atas) dan tenant-wide (tanpa filter `area`), bentuk yang dipakai
  dashboard live (#621). Rollup butuh jendela `[dayStart, dayEnd)`
  tertutup DAN split per `area` (PK tabel rollup), jadi
  `application/rollup.ts` mengimplementasikan query top-N sendiri yang
  di-scope hari+area, mengikuti pola keamanan SQL yang sama
  (allow-list kolom/key jsonb sebelum `tx.unsafe`).
- Area tanpa event pada tanggal itu **tidak** mendapat baris rollup
  (bukan baris bernilai nol).
- CLI: `--date=YYYY-MM-DD` | `--start-date=.../--end-date=...` | default
  "kemarin" (UTC).

Test: `tests/integration/visitor-analytics-rollup.integration.test.ts`.

### Retention purge job (Issue #624, `scripts/visitor-analytics-purge.ts`)

`bun run analytics:purge` — mengiterasi setiap tenant `active` dan
memanggil `purgeVisitorAnalyticsData` (§API di atas) LANGSUNG lewat
fungsi yang diekspor `purgeVisitorAnalyticsForAllTenants`, TIDAK PERNAH
re-derive empat cutoff-nya. Hanya tenant yang benar-benar ada
baris terhapus/terbersihkan yang mendapat audit `critical`
`retention_purged` (attributes: empat angka ringkasan saja) — tenant
tanpa data kedaluwarsa tidak menghasilkan audit noise. Tidak ada lapisan
batching tambahan di atas apa yang `purgeVisitorAnalyticsData` sudah
lakukan.

Test: `tests/integration/visitor-analytics-purge.integration.test.ts` —
SENGAJA tidak menguji ulang empat aturan retensi (sudah dicakup
`tests/integration/visitor-analytics-api.integration.test.ts` lewat
`POST .../retention/purge`, fungsi yang sama persis); hanya menguji apa
yang ditambahkan script ini — iterasi multi-tenant, jumlah total lintas
tenant, dan audit hanya untuk tenant yang punya efek nyata.

### Readiness checks (Issue #624, `scripts/security-readiness.ts`)

`scripts/validate-env.ts`'s `checkVisitorAnalyticsConfig` (#617) TETAP
shape-only (enum/positive-int). Lima check SAFETY cross-field baru ada
di `security-readiness.ts` (bukan `validate-env.ts`) — pola yang sama
`checkOnlineAuthSecurityConfig`/`Ready` dkk. sudah pakai (shape vs
safety/severity). Semua reuse `resolveVisitorAnalyticsConfig`:

| Check                                             | Severity | Gagal saat                                                                                                      |
| ------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------- |
| `checkVisitorAnalyticsRawIpRetentionReady`        | critical | Raw IP aktif + retensi raw detail > retensi event                                                               |
| `checkVisitorAnalyticsRawUserAgentRetentionReady` | warning  | Raw user-agent aktif (masih no-op) + retensi sama tidak aman                                                    |
| `checkVisitorAnalyticsGeoTrustedSourceReady`      | critical | Geo aktif tanpa `VISITOR_ANALYTICS_TRUST_CLOUDFLARE`                                                            |
| `checkVisitorAnalyticsRetentionOrderingReady`     | warning  | Retensi raw detail > event, ATAU rollup < event                                                                 |
| `checkVisitorAnalyticsHashSaltReady`              | warning  | Modul aktif + `VISITOR_ANALYTICS_HASH_SALT` kosong                                                              |
| `checkVisitorAnalyticsVisitorKeyCookieTtlReady`   | warning  | Modul aktif + `VISITOR_ANALYTICS_VISITOR_KEY_COOKIE_TTL_DAYS` > 400 hari (Issue #624 repository audit addendum) |

Default privacy-first (semua var tidak di-set) lulus BERSIH keenam
check ini. Hanya `critical` yang memblokir go-live. Jangan re-derive
aturan ini di `validate-env.ts` — kalau butuh dipakai script lain,
import dari `security-readiness.ts` seperti check lain sudah lakukan.

Test: `tests/security-readiness.test.ts`.

### Repository audit addendum (Issue #624, reopened 2026-07-11, epic platform-hardening #679)

Setelah Issue #624's scope asli (rollup/purge/readiness/docs) selesai,
audit repositori 2026-07-11 menemukan dua celah default privasi dan
menambah scope ke issue yang SAMA (bukan issue baru):

1. **`.env.example` mengaktifkan analytics secara default** — DITUTUP:
   `VISITOR_ANALYTICS_ENABLED` sekarang default `false` di
   `VISITOR_ANALYTICS_DEFAULTS` (`domain/visitor-analytics-config.ts`),
   `.env.example`, dan `src/lib/config/registry.ts` sekaligus (ketiganya
   harus tetap sinkron — `tests/unit/config-docs-check.test.ts`'s
   `runConfigDocsCheck` menegakkan kehadiran var yang sama di ketiganya,
   BUKAN kesamaan nilai default). Deployment existing yang sudah men-set
   var ini `true` eksplisit tidak terdampak — hanya deployment yang
   mengandalkan default implisit lama yang perlu menambahkan var ini
   secara eksplisit setelah upgrade. Tidak ada migration data — perubahan
   murni di layer config.
2. **Cookie visitor-key berumur ~2 tahun** — DITUTUP: field baru
   `visitorKeyCookieTtlDays` (default 30, env
   `VISITOR_ANALYTICS_VISITOR_KEY_COOKIE_TTL_DAYS`) di
   `VisitorAnalyticsConfig`, dikonsumsi
   `resolveVisitorKeyCookieMaxAgeSeconds`. Dua fungsi pure baru di
   `domain/visitor-key-cookie.ts` — `shouldRevokeVisitorKeyCookie`
   (dipanggil SEBELUM gate `shouldCollectRequest`, true hanya saat modul
   nonaktif DAN cookie valid masih ada → middleware menghapusnya) dan
   `planVisitorKeyCookie` (dipanggil SESUDAH gate lolos, HANYA saat modul
   aktif — selalu resolve nilai + tandai perlu `Set-Cookie` atau tidak,
   mempertahankan invarian lama "cookie di-set hanya saat request
   benar-benar dikoleksi", bukan di setiap request).
3. **"Jangan set cookie / tulis event saat disabled"** — sudah otomatis
   benar secara struktural: `collectRequestAnalytics`
   (`src/middleware.ts`) mengecek `config.enabled` SEBELUM apa pun lain
   (setelah revocation check di atas) dan `return` langsung bila mati —
   tidak ada jalur kode yang bisa sampai ke `context.cookies.set`/
   `collectVisitorTelemetry` saat modul nonaktif. Diverifikasi
   `tests/unit/visitor-analytics-visitor-key-cookie.test.ts` dan
   `tests/unit/visitor-analytics-collector.test.ts` (kasus
   `VISITOR_ANALYTICS_DEFAULTS` disabled-by-default).
4. **Dokumentasi data-subject deletion/anonymization + UU PDP/ISO
   27701:2025** — ditambahkan ke
   `docs/awcms/visitor-analytics.md` (§Default opt-in dan upgrade
   path, §Cookie anonim, baris baru tabel UU PDP, bagian ISO/IEC
   27701:2025 dimutakhirkan dari referensi 2019 sebelumnya).

**Yang TIDAK berubah** (di luar scope addendum, jangan disentuh issue
lanjutan tanpa alasan baru): raw IP/raw user-agent/geo tetap default
mati (sudah begitu sejak #617, addendum hanya menegaskan ulang), tidak
ada perubahan skema/tabel (migration baru TIDAK dibutuhkan — perubahan
ini murni config + middleware), tidak ada endpoint API baru.

Test baru: `tests/unit/visitor-analytics-visitor-key-cookie.test.ts`
(pure, `shouldRevokeVisitorKeyCookie`/`planVisitorKeyCookie`). Test yang
diperbarui (bukan baru) untuk mencerminkan default baru:
`tests/unit/visitor-analytics-config.test.ts`,
`tests/unit/visitor-analytics-collector.test.ts`,
`tests/security-readiness.test.ts`.

## Prinsip yang wajib dipertahankan di setiap issue lanjutan

1. **Privacy-first default** — raw IP, raw user-agent, geolokasi selalu
   default mati. Jangan pernah membuat issue lanjutan menyalakannya secara
   implisit lewat `VISITOR_ANALYTICS_MODE=detailed` atau flag lain; wajib
   opt-in eksplisit per flag masing-masing.
2. **`raw_detail.read` terpisah dari `dashboard.read`** — endpoint/UI yang
   menampilkan IP/user-agent mentah wajib cek permission `raw_detail.read`
   secara eksplisit, bukan cukup `dashboard.read`.
3. **Tenant isolation** — skema (#618, sudah selesai) tenant-scoped + RLS
   `ENABLE`+`FORCE`, sama pola semua tabel tenant-scoped lain di repo ini
   (lihat `docs/adr/0003-postgresql-rls-multi-tenant.md`). Issue
   lanjutan yang menulis ke tabel ini (mis. #620) tetap wajib lewat
   `withTenant`, tidak pernah query langsung tanpa tenant context.
4. **Bukan dependency operasional** — koleksi telemetry tidak boleh
   memblokir/memperlambat request admin/publik yang sebenarnya (mis. tulis
   event lewat outbox/fire-and-forget, bukan inline blocking DB write di
   jalur request kritis) — prinsip sama ADR-0006 untuk provider eksternal.
5. **Retensi lebih pendek untuk data lebih sensitif** — raw detail (30
   hari default) < event (90 hari default) < rollup agregat (730 hari
   default). Jangan balik urutan ini di issue lanjutan tanpa alasan eksplisit.
6. **`VISITOR_ANALYTICS_HASH_SALT` bukan credential provider** — dipakai
   untuk fingerprint pseudonymous (dedup visitor tanpa cookie persisten),
   bukan untuk autentikasi apa pun. Jangan expose di response/log/audit.
7. **Default-off untuk instalasi baru** (Issue #624 repository audit
   addendum) — `VISITOR_ANALYTICS_ENABLED` default `false`. Jangan
   pernah membalik ini kembali ke `true` tanpa keputusan sadar yang
   didokumentasikan ulang — ini adalah keputusan privasi/kepatuhan
   eksplisit, bukan preferensi teknis.
8. **Cookie visitor-key pendek + revocable** — jangan pernah
   memperpanjang default `VISITOR_ANALYTICS_VISITOR_KEY_COOKIE_TTL_DAYS`
   kembali ke orde tahun tanpa justifikasi eksplisit, dan jangan
   menghapus logic `shouldRevokeVisitorKeyCookie` (revocation saat modul
   nonaktif) — keduanya bagian dari keputusan privasi addendum ini, bukan
   detail implementasi yang bebas diubah.

## Referensi

- `src/modules/visitor-analytics/README.md` — detail per-issue di dalam modul.
- `docs/awcms/visitor-analytics.md` — panduan operasional lengkap
  (mode offline/LAN vs online vs trusted-proxy/Cloudflare, retensi,
  rollup/purge, dan pemetaan kepatuhan UU PDP/PP PSTE/ISO
  27001-27002-27005-27701/OWASP ASVS/Logging Cheat Sheet).
- `docs/awcms/18_configuration_env_reference.md` §Visitor analytics.
- `docs/awcms/20_threat_model_security_architecture.md` §Standar
  tambahan dipicu epic visitor analytics.
- `AGENTS.md` skill table.
