🇮🇩 Bahasa Indonesia · 🇬🇧 [English (source)](README.md)

<!-- i18n-source-hash: sha256:3af3aaac12fcfafcf33b567a31f4b48655e28dccea571d0985e64d282ec8b8ee -->

# visitor_analytics

Statistik pengunjung manusia yang mengutamakan privasi untuk rute admin dan
publik, baik pada konfigurasi online maupun offline/LAN. Diport dari
**awcms-micro** (epik #617-#624) sebagai modul mandiri yang aditif.

`type: "system"` — seperti `reporting`/`logging`, telemetri pengunjung manusia
adalah infrastruktur platform/observabilitas yang mekanismenya dipakai bersama
oleh setiap tenant, bukan fitur bisnis yang menghadap tenant. Volumenya yang lebih
tinggi dan kebutuhan retensi/privasinya yang berbeda dari `reporting`/`logging`
justru itulah sebabnya ia menjadi modul tersendiri.

## Postur privasi (seluruh alasan modul ini ada)

- **Mati secara default.** Instalasi baru tidak mengumpulkan apa pun sampai
  operator menyetel `VISITOR_ANALYTICS_ENABLED=true`. Saklar perangkat lunak itu
  tidak pernah menjadi keputusan dasar hukum/persetujuan yang dituntut UU PDP —
  ia hanya mengaktifkan mekanismenya.
- **Identifier di-hash bergaram per-tenant, tidak pernah mentah.** Cookie
  kunci-pengunjung anonim, alamat IP, dan user-agent hanya disimpan sebagai
  `HMAC-SHA256` (`domain/visitor-key.ts`), berkunci `VISITOR_ANALYTICS_HASH_SALT`
  **dan diikat ke id tenant** (pemisah domain `\0` melipat `tenantId` ke dalam
  HMAC-nya). Dua sifat lahir darinya: ketahanan rainbow-table lintas-DEPLOYMENT
  (garamnya), dan ketidakterhubungan lintas-TENANT (pengikatan tenant) —
  peramban/IP/user-agent yang sama menghasilkan hash BERBEDA di antara tenant yang
  berbagi satu origin, sehingga kolom hash mentah dua tenant tidak dapat
  dikorelasikan di lapisan penyimpanan. Garam sungguhan sepanjang
  **≥ 16 karakter** **wajib** ketika modul ini aktif (`scripts/validate-env.ts`
  menegakkan keduanya: bukan placeholder dan panjang minimumnya).
- **Detail mentah adalah opt-in eksplisit dan independen, digerbangi lewat ABAC.**
  `ip_address` (mentah) dan `login_identifier_snapshot` hanya pernah diisi
  ketika `VISITOR_ANALYTICS_RAW_IP_ENABLED=true` / untuk sesi terautentikasi;
  jalur ingest publik di sini tidak pernah mengisi keduanya (hanya anonim).
  Membaca detail mentah lewat API / dasbor menuntut izin terpisah
  `visitor_analytics.raw_detail.read`, dan keputusan field itu dilewatkan
  **evaluator ABAC** (`evaluateFieldAccessInTransaction`), bukan sekadar
  pemeriksaan keanggotaan permission-set — sehingga kebijakan DSL `deny` atas
  `raw_detail.read` dihormati (deny-overrides-allow). Diterapkan seragam di
  `GET /sessions`, `GET /events`, dan `/admin/analytics`; penghilangan field yang
  sebenarnya terjadi satu kali, di sisi server, di
  `domain/analytics-response-shaping.ts`.
- **Tidak ada yang sensitif pernah dipersistenkan.** `domain/path-sanitizer.ts`
  membuang parameter kueri token/secret (fail-safe: path yang tidak dapat diurai
  membuang seluruh query string-nya) sebelum sebuah path mencapai
  `path_sanitized`; `domain/referrer.ts` hanya menyimpan hostname telanjang. Tidak
  ada body request, cookie, header Authorization, atau secret di query string yang
  disimpan, termasuk dua `jsonb` serba-guna (`user_agent_parsed`, `geo`) yang
  hanya memuat nilai turunan/terurai.
- **Siklus hidup berbasis retensi.** Ini adalah baris bervolume tinggi yang mirip
  log (tanpa soft delete). Purge retensi (`application/retention-purge.ts`)
  menghapus event yang melewati `eventRetentionDays`, membersihkan detail mentah
  sesi yang melewati `rawDetailRetentionDays`, menghapus sesi yatim, dan menghapus
  rollup yang melewati `rollupRetentionDays`.

## Skema (migrasi 049 / 050 / 051)

- `049` — seed katalog izin (8 izin).
- `050` — `awcms_visitor_sessions`, `awcms_visit_events`,
  `awcms_visitor_daily_rollups`. Semuanya `ENABLE`+`FORCE ROW LEVEL SECURITY`
  dengan kebijakan `tenant_isolation`, indeks komposit ber-tenant_id-pertama, dan
  grant `awcms_worker` berhak-minimum untuk job terjadwal. `awcms_visit_events`
  membawa **FK komposit yang aman lintas-tenant** `(tenant_id, visitor_session_id)`
  → `awcms_visitor_sessions (tenant_id, id)` (FK `id` polos akan diam-diam
  melintasi tenant). `identity_id` tetap FK nullable biasa — ingest publik tidak
  pernah mengisinya.
- `051` — indeks lookup find-or-create sesi
  `(tenant_id, visitor_key_hash, area, last_seen_at)` (sengaja TIDAK unik: satu
  pengunjung mengumpulkan banyak sesi seiring waktu).

## Pengumpulan: endpoint ingest PUBLIK (bukan middleware)

**Adaptasi port.** awcms-micro mengumpulkan telemetri dari `src/middleware.ts`
(mengamati setiap request server). Base ini membiarkan `src/middleware.ts`
**tak tersentuh** (jaminan login/Turnstile/CSP-nya tidak berubah) dan memaparkan
logika collector yang sama sebagai **beacon publik** yang aditif dan opt-in:

`POST /api/v1/analytics/collect` (anonim, tanpa auth) — klien mem-post
`{ tenantCode, path, referrer? }`. Endpoint ini meresolusi tenant dari
`tenantCode` terhadap akar `awcms_tenants` yang **bebas RLS** (ADR-0009, persis
seperti rute publik `/blog/{tenantCode}` — sehingga **tidak perlu SECURITY
DEFINER**), lalu mencatat page view yang menjaga privasi lewat
`application/collector.ts`. IP/user-agent datang dari header request itu sendiri
(tidak pernah dari body). Ia bersifat fire-and-forget (selalu `202`) dan mencatat
**hanya page view area publik** — beacon anonim tidak bisa membuktikan sebuah
request admin/API, jadi ia tidak diizinkan mengotori analitik admin/api.

**Penahan penyalahgunaan.** Karena ia adalah tulis DB tanpa autentikasi, beacon
ini didahului **rate limit per-IP** (limiter fixed-window in-process
`checkRateLimit` bersama, yang sama dipakai `auth/login.ts` dan
`setup/initialize.ts`) sebelum pekerjaan basis data apa pun — sehingga klien yang
memegang `tenantCode` publik tidak bisa membanjiri baris sesi/event tanpa batas
atau meracuni agregat sebuah tenant. Kuncinya hanya IP klien (tidak pernah
tenant), jadi `429` tidak membocorkan apa pun tentang keberadaan tenant; `path`
yang melebihi `MAX_PATH_LENGTH` (2048) ditolak sebelum penyimpanan. Dapat disetel
lewat `VISITOR_ANALYTICS_COLLECT_RATE_LIMIT_MAX` /
`_WINDOW_SEC` (default 120 req / 60 s per IP).

## API (terautentikasi, digerbangi ABAC)

Semuanya di bawah `/api/v1/analytics`, digerbangi di chokepoint identity-access
(`authorizeInTransaction`):

| Endpoint                                            | Izin                                                                       |
| --------------------------------------------------- | -------------------------------------------------------------------------- |
| `GET /summary\|pages\|devices\|locations\|security` | `visitor_analytics.dashboard.read`                                         |
| `GET /realtime`                                     | `visitor_analytics.realtime.read`                                          |
| `GET /sessions`                                     | `visitor_analytics.sessions.read` (+ `raw_detail.read` untuk field mentah) |
| `GET /events`                                       | `visitor_analytics.events.read` (+ `raw_detail.read` untuk field mentah)   |
| `GET\|PATCH /settings`                              | `visitor_analytics.settings.read` / `.update`                              |
| `POST /retention/purge`                             | `visitor_analytics.retention.purge` (Idempotency-Key, audit `critical`)    |

Endpoint daftar memakai cursor keyset teks presisi-penuh milik base ini
(`_shared/keyset-pagination.ts`) — direktorinya membangun cursor dari teks
mikrodetik `to_char(... US ...)` milik barisnya sendiri, tidak pernah dari `Date`
JS yang dibulatkan ke bawah.

## Job

- `bun run analytics:rollup` (`scripts/visitor-analytics-rollup.ts`) —
  menghitung ulang secara idempoten `awcms_visitor_daily_rollups` untuk hari UTC
  sebelumnya per tenant aktif.
- `bun run analytics:purge` (`scripts/visitor-analytics-purge.ts`) — menegakkan
  retensi per tenant aktif.

Keduanya berjalan di job runner bersama (advisory lock, timeout, pembatalan,
telemetri JSON) sebagai role berhak-minimum `awcms_worker`; PostgreSQL murni, aman
di offline/LAN. Pakai `--dry-run` lebih dulu untuk purge-nya.

## Layar admin

`/admin/analytics` (`visitor_analytics.dashboard.read`). **Adaptasi port:**
dasbor SPA ber-`fetch`-klien milik awcms-micro dirender **di sisi server** di sini
(pola baca-SSR-lalu-render yang sama seperti `admin/offices.astro`) — base ini
tidak punya framework i18n maupun pustaka `components/ui/`. Tanpa skrip klien,
tanpa permukaan CSP.

## Yang dibuang / ditunda saat port (terdokumentasi, bukan senyap)

- **Kopling data_lifecycle DIRANGKAI ULANG (ADR-0037).** Modul `data_lifecycle`
  kini sudah diport ke base ini, sehingga deskriptor `dataLifecycle`
  (`visitor_analytics.visit_events`, terdelegasi) dan gerbang `LegalHoldGuardPort`
  DITAMBAHKAN KEMBALI. Legal hold aktif yang mencakup
  `visitor_analytics.visit_events` (ber-scope deskriptor atau se-tenant)
  melewatkan **seluruh** purge — event DAN langkah 2-4 (pembersihan detail mentah
  sesi, penghapusan sesi, penghapusan rollup) — mempertahankan semua data
  analitik. Ini sengaja lebih luas dari awcms-micro (yang hanya menggerbangi
  DELETE event): langkah 2-4 juga menghancurkan data yang relevan untuk litigasi
  (IP/snapshot login, agregat), jadi terlalu-mempertahankan di bawah sebuah hold
  adalah default yang aman. Adapter konkretnya disuntikkan di dua composition root
  (`POST /api/v1/analytics/retention/purge` dan `scripts/visitor-analytics-purge.ts`).
- **Perangkaian preset news_portal DITUNDA.** Preset
  `news_portal_full_online_r2` milik awcms-micro mengaktifkan modul ini.
  `news_portal` di base ini diport tanpa perangkaian itu dan **tidak dimodifikasi**
  di sini; modul ini dirilis mandiri.
- **Geolokasi** hanya sebatas negara dari `CF-IPCountry` milik Cloudflare
  (`domain/geo-enrichment.ts`), hanya ketika `VISITOR_ANALYTICS_GEO_ENABLED`
  dan `VISITOR_ANALYTICS_TRUST_CLOUDFLARE` keduanya true; region/kota/zona waktu
  selalu null (tidak ada sumber GeoIP berbayar/lokal). Tidak pernah melakukan
  panggilan jaringan eksternal.

## Konfigurasi

Lihat `domain/visitor-analytics-config.ts` dan blok `# Visitor Analytics` di
`.env.example`. Semua var berawalan `VISITOR_ANALYTICS_*`, opsional, mengutamakan
privasi dan mati secara default.
