---
"awcms": minor
---

Port modul `visitor_analytics` dari awcms-micro (epic #617-#624) sebagai modul standalone `type: "system"` (ADR-0035 Wave 1). Menambah statistik pengunjung manusia **privacy-first** untuk rute admin & publik, online maupun offline/LAN.

- **Skema** (migrasi 049 permission, 050 schema, 051 session-lookup index): `awcms_visitor_sessions`/`awcms_visit_events`/`awcms_visitor_daily_rollups`, semua `FORCE ROW LEVEL SECURITY` + policy `tenant_isolation`, index tenant_id-first, composite FK `(tenant_id, visitor_session_id)` lintas-tenant, dan GRANT `awcms_worker` least-privilege untuk job terjadwal.
- **Privasi:** off by default (`VISITOR_ANALYTICS_ENABLED=false`); visitor-key/IP/user-agent disimpan hanya sebagai HMAC-SHA256 bersalt (salt wajib saat enabled — ditegakkan `validate-env`); raw IP & login snapshot opt-in terpisah; query string sensitif di-strip fail-safe.
- **Koleksi = endpoint ingest PUBLIK** `POST /api/v1/analytics/collect` (anonim, resolve tenant dari `tenantCode` tabel `awcms_tenants` yang RLS-free — TANPA SECURITY DEFINER), **bukan** middleware: `src/middleware.ts` tidak disentuh (jaminan login/Turnstile/CSP tetap).
- **API terautentikasi ABAC:** `GET /api/v1/analytics/{summary,realtime,sessions,events,pages,devices,locations,security,settings}`, `PATCH .../settings`, dan `POST .../retention/purge` (Idempotency-Key + audit `critical`). Raw-detail digerbangi `visitor_analytics.raw_detail.read`.
- **Job:** `bun run analytics:rollup` & `bun run analytics:purge` (worker role, offline-safe).
- **Dashboard** `/admin/analytics` (SSR-render).

Adaptasi port terdokumentasi: kopling `data_lifecycle`/`LegalHoldGuardPort` DI-DROP (modul belum ada di base — purge tanpa gerbang legal-hold), dan wiring preset `news_portal_full_online_r2` DEFERRED (modul `news_portal` tidak disentuh).

**Security hardening (DoD + security review atas port ini):**

- **Rate-limit backstop pada beacon publik.** `POST /api/v1/analytics/collect` (unauth DB write) kini digerbangi rate limit per-IP (`checkRateLimit` yang sama dengan login/setup) SEBELUM tulis DB — mencegah flooding baris/pencemaran agregat oleh pemegang `tenantCode` publik. Kunci berbasis IP saja (tak membocorkan eksistensi tenant); `path` dibatasi panjang sebelum disimpan. Tunable `VISITOR_ANALYTICS_COLLECT_RATE_LIMIT_MAX`/`_WINDOW_SEC` (default 120/60s).
- **Salt HMAC per-tenant (privacy-by-design).** `visitor_key_hash`/`ip_hash`/`user_agent_hash` kini di-key dengan salt deployment DAN `tenantId` (domain-separator `\0`), sehingga browser/IP/user-agent yang sama menghasilkan hash BERBEDA lintas tenant satu origin — menutup korelasi lintas-tenant di lapisan penyimpanan. Diterapkan mumpung belum ada data. `VISITOR_ANALYTICS_HASH_SALT` kini wajib ≥ 16 karakter saat modul aktif.
- **raw_detail lewat ABAC, bukan hanya keanggotaan RBAC.** Field de-anonimisasi (`ipHash`/`ipAddress`/`userAgentHash`/`loginIdentifierSnapshot`) di `GET /sessions`, `GET /events`, dan `/admin/analytics` kini diputuskan lewat evaluator ABAC (`evaluateFieldAccessInTransaction`) sehingga kebijakan DSL `deny` atas `raw_detail.read` dihormati (deny-overrides-allow).
- Log fragmen IP mentah pada header forwarded multi-nilai dihapus (`client-ip.ts` hanya mencatat `valueCount`, bukan nilai).
