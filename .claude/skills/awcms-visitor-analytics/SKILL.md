---
name: awcms-visitor-analytics
description: Modul visitor_analytics SUDAH di-port ke repo ini (dari awcms-micro epic #617-#624) sebagai modul standalone `type:"system"`. Gunakan saat menambah/mengubah `/api/v1/analytics/*`, skema session/event/rollup (`awcms_visitor_sessions`/`awcms_visit_events`/`awcms_visitor_daily_rollups`, migrasi 049/050/051), helper klasifikasi identity/UA/bot + sanitasi path, endpoint ingest publik `POST /api/v1/analytics/collect`, dashboard `/admin/analytics`, enrichment geolokasi, atau job `analytics:rollup`/`analytics:purge`. Merangkum keputusan port (kopling data_lifecycle DI-DROP, wiring news_portal preset DEFERRED, koleksi = endpoint ingest publik BUKAN middleware, TIDAK ada SECURITY DEFINER) supaya perubahan lanjutan tidak meregresi privasi/RLS.
---

# AWCMS — Visitor Analytics (code guide)

Modul **SUDAH ADA** di repo ini: `src/modules/visitor-analytics/`,
migrasi `sql/049`–`sql/051`, terdaftar di `src/modules/index.ts`. Ini panduan
kode yang bisa dipanggil — bukan spesifikasi target. Baca juga
`src/modules/visitor-analytics/README.md`.

## Bentuk modul (apa yang ada di kode)

- **Descriptor** `module.ts`: `key: "visitor_analytics"`, `type: "system"`,
  `dependencies: [tenant_admin, identity_access, logging, reporting]`, 8
  permission, `navigation` `/admin/analytics`, `jobs` (rollup+purge),
  `settings.schemaVersion:1`. TIDAK ada field `dataLifecycle` (di-drop, lihat
  §Port).
- **domain/** (murni, unit-tested tanpa DB): `visitor-analytics-config.ts`
  (env resolver privacy-first), `visitor-key.ts` (HMAC-SHA256 bersalt +
  visitor-key anonim), `user-agent.ts`, `human-classifier.ts`,
  `path-sanitizer.ts`, `referrer.ts`, `request-area.ts`, `client-ip.ts`,
  `geo-enrichment.ts`, `analytics-range.ts`, `analytics-response-shaping.ts`
  (gerbang raw-detail), `dashboard-view.ts`, `visitor-key-cookie.ts`.
- **application/**: `collector.ts` (satu-satunya penulis session/event, fail-open,
  `workClass:"background_sync"` `queueTimeoutMs:200`), `analytics-queries.ts`,
  `rollup.ts`, `retention-purge.ts`, `event-directory.ts`, `session-directory.ts`.
- **api**: `src/pages/api/v1/analytics/{collect,summary,realtime,sessions,events,pages,devices,locations,security,settings}.ts`
  - `retention/purge.ts`.
- **admin**: `src/pages/admin/analytics.astro` (SSR-render).
- **jobs**: `scripts/visitor-analytics-rollup.ts` (`bun run analytics:rollup`),
  `scripts/visitor-analytics-purge.ts` (`bun run analytics:purge`).

## Invarian privasi (JANGAN regresi)

1. **Off by default.** `VISITOR_ANALYTICS_ENABLED=false`. `collector` &
   endpoint ingest tidak menulis apa pun saat disabled.
2. **Identifier di-hash bersalt, tidak pernah mentah.** visitor-key/IP/UA →
   `hashVisitorKey/hashIpAddress/hashUserAgent` (`domain/visitor-key.ts`),
   di-key oleh `VISITOR_ANALYTICS_HASH_SALT`. `scripts/validate-env.ts`
   MEWAJIBKAN salt nyata saat modul enabled (cross-rule) — jangan longgarkan.
3. **Raw detail opt-in ganda.** `ip_address` mentah hanya saat
   `rawIpEnabled`; `login_identifier_snapshot` tak pernah untuk anonim.
   API menutup raw field via `shapeVisitorSession/shapeVisitEvent(row,
canSeeRawDetail)` — `canSeeRawDetail = grantedPermissionKeys.has(
"visitor_analytics.raw_detail.read")`. Gerbang server-side SATU kali;
   dashboard TIDAK boleh jadi gerbang kedua.
4. **`sanitizePath` fail-safe** (path tak-terparse → buang seluruh query),
   `extractReferrerDomain` hanya hostname. Jangan simpan raw path/query/referrer.
5. **jsonb** `user_agent_parsed`/`geo` diisi OBJEK JS (bukan
   `${JSON.stringify}::jsonb`) supaya SELECT balik jadi objek, bukan string.

## Koleksi = endpoint ingest publik (BUKAN middleware)

`POST /api/v1/analytics/collect` publik/anonim: body `{tenantCode, path, referrer?}`.
Resolve tenant via `resolvePublicTenantByCode` (tabel `awcms_tenants` **RLS-free**,
ADR-0009 — sama seperti rute `/blog/{tenantCode}`), lalu `collectVisitorTelemetry`.
**`src/middleware.ts` sengaja TIDAK disentuh** (jaminan login/Turnstile/CSP tetap).
IP/UA dari header request (bukan body). Fire-and-forget selalu `202`; hanya
rekam area `public` (anonim tak bisa buktikan admin/api). **TIDAK ada SECURITY
DEFINER** — karena `awcms_tenants` RLS-free (lain dari `tenant_domain` yang
butuh sql/048). `operationId analyticsCollect` ada di `ALLOWED_PUBLIC_OPERATIONS`
(`scripts/api-spec-check.ts`).

## RLS & FK (migrasi 050)

- Tiga tabel `ENABLE`+`FORCE RLS` + policy `tenant_isolation`. `awcms_worker`
  DIBERI GRANT eksplisit (default privileges hanya `awcms_app`) — job jalan
  sebagai worker; jangan hapus grant itu.
- `awcms_visit_events` pakai **composite FK** `(tenant_id, visitor_session_id)`
  → `awcms_visitor_sessions(tenant_id, id)` (ada `UNIQUE(tenant_id,id)`).
  `identity_id` FK polos (selalu null di ingest).

## Keyset (konvensi base ini, bukan micro)

`event-directory.ts`/`session-directory.ts` mengembalikan `{rows, nextCursor}`
dengan cursor teks presisi-penuh dari `to_char(occurred_at/last_seen_at ... US
...)` — JANGAN pakai `encodeKeysetCursor(row.date_as_JS_Date, id)` (micro
begitu; `encodeKeysetCursor` di sini menerima TEKS, dan `Date` JS membuang
mikrodetik → lewatkan baris di batas halaman, Issue #158).

## Port (keputusan yang sudah diambil)

- **DROP** descriptor `dataLifecycle` + `LegalHoldGuardPort` (modul
  `data_lifecycle` belum di-port). `purgeVisitorAnalyticsData(tx, tenantId,
config, now)` — 4 langkah tanpa gerbang legal-hold. Kembalikan bila
  `data_lifecycle` di-port.
- **DEFER** wiring preset `news_portal_full_online_r2` → JANGAN sentuh modul
  `news_portal`. Modul ini standalone.
- **Admin** = SSR-render (`admin/offices.astro` pattern), bukan client-fetch
  SPA micro (base ini tak punya i18n framework / `components/ui`).

## Gate saat mengubah modul ini

`bun run check` penuh. Yang paling relevan: `api:spec:check` (route-parity —
setiap route file WAJIB punya path OpenAPI di
`openapi/modules/visitor-analytics.openapi.yaml`, lalu `bun run openapi:bundle`

- commit bundle); `modules:composition:inventory:check` (regen
  `bun run modules:composition:inventory:generate`); `logging:lint:check` (log
  pakai field terstruktur + `moduleKey`); `typecheck`; `test`. Fragment OpenAPI
  hanya boleh menyumbang `paths` + `components.schemas` (parameter di-inline;
  `ModuleSettingsView` di-`$ref` ke milik module-management, jangan didefinisikan
  ulang). Tes: unit `tests/visitor-analytics-*.test.ts` + integrasi DB-gated
  `tests/integration/visitor-analytics.integration.test.ts` (RLS bawah
  `awcms_app`, composite FK, purge).
