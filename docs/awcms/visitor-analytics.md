# Visitor Analytics — panduan operasional dan kepatuhan

Dokumen ini melengkapi epic visitor analytics (Issue #617-#624) dengan
panduan operasional level-praktis: mode deployment, privacy-first
default, retensi data per kolom/tabel, dan pemetaan kontrol yang sudah
diimplementasikan ke kerangka kepatuhan yang relevan (UU PDP, PP PSTE,
ISO/IEC 27001/27002/27005/27701, OWASP ASVS, OWASP Logging Cheat Sheet).

Referensi terkait:

- `src/modules/visitor-analytics/README.md` — detail implementasi per
  issue (schema, collector, API, dashboard, geo enrichment, rollup/purge).
- `.claude/skills/awcms-visitor-analytics/SKILL.md` — konteks
  cross-issue, keputusan yang sudah dibuat, apa yang tidak boleh
  di-re-derive.
- `18_configuration_env_reference.md` §Visitor analytics — referensi
  penuh 17 env var.
- `20_threat_model_security_architecture.md` §Standar tambahan dipicu
  epic visitor analytics — model ancaman.
- `04_erd_data_dictionary.md` §Visitor Analytics dan §Retention awal —
  skema tabel dan tabel retensi ringkas.

## Ringkasan modul

Modul `visitor_analytics` (`type: "system"`) mengumpulkan statistik
pengunjung manusia **privacy-first** untuk rute admin dan publik —
jumlah pengunjung unik, pageview, breakdown browser/device/negara,
traffic bot — tanpa menyimpan data pribadi mentah kecuali operator
secara eksplisit mengaktifkannya. Tiga tabel tenant-scoped
(`awcms_visitor_sessions`, `awcms_visit_events`,
`awcms_visitor_daily_rollups`), semua `ENABLE`+`FORCE ROW LEVEL
SECURITY`.

Prinsip inti yang mengikat setiap mode operasi di bawah:

1. **Default MATI tanpa konfigurasi apa pun (Issue #624 audit addendum,
   2026-07-11).** Instalasi baru tidak mengumpulkan telemetry apa pun
   sampai operator secara eksplisit men-set
   `VISITOR_ANALYTICS_ENABLED=true` — lihat §Default opt-in dan upgrade
   path di bawah. Begitu diaktifkan, tiga sub-fitur paling sensitif —
   raw IP, raw user-agent, geolokasi — tetap mati secara default dan
   independen satu sama lain. `bun run config:validate` selalu lulus
   tanpa satu pun `VISITOR_ANALYTICS_*` di-set.
2. **Retensi lebih pendek untuk data lebih sensitif.** Raw detail (30
   hari default) < event (90 hari default) < rollup agregat (730 hari
   default). Cookie anonim `awcms_visitor_key` juga jauh lebih
   pendek dari sebelumnya (30 hari default, dulu ~2 tahun) — lihat
   §Cookie anonim di bawah. Lihat §Retensi untuk detail per kolom.
3. **`raw_detail.read` terpisah dari `dashboard.read`.** Operator bisa
   memberi akses dashboard agregat tanpa memberi akses IP/user-agent
   mentah.
4. **Tidak pernah panggilan jaringan eksternal.** Geolokasi berasal dari
   header Cloudflare (`CF-IPCountry`) yang sudah ada di request, bukan
   API pihak ketiga — konsisten dengan modul yang berjalan penuh
   offline/LAN.
5. **Software setting bukan dasar hukum.** Men-set
   `VISITOR_ANALYTICS_ENABLED=true` adalah switch teknis, bukan
   pengganti keputusan dasar hukum/tujuan pemrosesan yang wajib diambil
   operator sendiri di bawah UU PDP sebelum mengaktifkan koleksi apa
   pun.

## Default opt-in dan upgrade path (Issue #624 audit addendum, 2026-07-11)

`VISITOR_ANALYTICS_ENABLED` defaultnya sekarang `false` (sebelumnya
`true` di Issue #617). Ringkasan dampak:

- **Instalasi baru**: tidak mengumpulkan apa pun secara default. Operator
  harus secara sadar men-set `VISITOR_ANALYTICS_ENABLED=true`, idealnya
  setelah menetapkan dasar hukum/tujuan pemrosesan (statistik operasional
  internal) yang sesuai UU PDP — software ini tidak dan tidak bisa
  menjadi dasar hukum itu sendiri.
- **Deployment existing yang sudah men-set `VISITOR_ANALYTICS_ENABLED=true`
  secara eksplisit** di environment mereka sendiri: **tidak terdampak
  sama sekali**. Nilai eksplisit selalu menang atas default —
  `resolveVisitorAnalyticsConfig` (`src/modules/visitor-analytics/domain/visitor-analytics-config.ts`)
  hanya jatuh ke default ketika var benar-benar tidak di-set.
- **Deployment existing yang mengandalkan default implisit lama** (tidak
  pernah men-set var ini, mengandalkan default `true` Issue #617): akan
  KEHILANGAN koleksi setelah upgrade ke versi ini. Tambahkan
  `VISITOR_ANALYTICS_ENABLED=true` secara eksplisit di environment untuk
  mempertahankan perilaku sebelumnya — data historis yang sudah tersimpan
  (`awcms_visitor_sessions`/`awcms_visit_events`/
  `awcms_visitor_daily_rollups`) tidak dihapus/dimodifikasi oleh
  perubahan default ini; hanya koleksi ke depan yang berhenti sampai
  var di-set eksplisit.
- **Tidak ada migration data untuk perubahan ini** — perubahan default
  murni di layer konfigurasi (`.env.example`/`src/lib/config/registry.ts`),
  tidak menyentuh skema/tabel apa pun.

## Cookie anonim: umur, rotation, dan revocation (Issue #624 audit addendum)

Cookie `awcms_visitor_key` (anonim, `httpOnly`+`sameSite=lax`,
dipakai untuk dedup sesi pengunjung tanpa identitas nyata):

- **Umur configurable, jauh lebih pendek dari sebelumnya** —
  `VISITOR_ANALYTICS_VISITOR_KEY_COOKIE_TTL_DAYS` (default 30 hari,
  sebelumnya hardcoded ~2 tahun/`63_072_000` detik). Operator bisa
  memperpendek lebih lanjut sesuai kebutuhan; `bun run security:readiness`'s
  `checkVisitorAnalyticsVisitorKeyCookieTtlReady` (warning) menandai
  nilai yang melebihi 400 hari (kira-kira mengikuti orde besaran
  panduan umum masa berlaku cookie consent, mis. ~13 bulan pada
  EU ePrivacy Directive) sebagai konfigurasi yang sebaiknya dipersempit.
- **Rotation alami** — begitu cookie expired di browser, kunjungan
  berikutnya tidak membawa nilai lama sama sekali; `resolveVisitorKey`
  (Issue #619) melihat "tidak ada nilai existing" dan mencetak identifier
  anonim baru. Tidak ada bookkeeping server tambahan untuk ini — TTL
  cookie itu sendiri yang mengatur siklus rotasi.
- **Revocation saat modul dinonaktifkan** — `shouldRevokeVisitorKeyCookie`
  (`domain/visitor-key-cookie.ts`), dipanggil `src/middleware.ts` SEBELUM
  gate path/area, secara aktif menghapus cookie yang masih ada begitu
  `VISITOR_ANALYTICS_ENABLED` bukan `"true"` — baik karena operator
  menonaktifkan modul secara sadar, maupun karena upgrade ke default-off
  baru ini (lihat §Default opt-in dan upgrade path). Browser yang sudah
  membawa identifier lama tidak menyimpannya tanpa batas waktu hanya
  karena tidak ada lagi yang memperbaruinya.
- **Tidak ada cookie/write sama sekali saat modul mati** — `shouldCollectRequest`
  (dipanggil setelah revocation check) dan gate `config.enabled` di
  `src/middleware.ts`'s `collectRequestAnalytics` memastikan tidak ada
  `Set-Cookie` baru DAN tidak ada baris session/event yang pernah ditulis
  selama modul nonaktif — diverifikasi
  `tests/unit/visitor-analytics-visitor-key-cookie.test.ts` dan
  `tests/unit/visitor-analytics-collector.test.ts`.

## Mode operasi

### Mode offline/LAN

Deployment yang tidak pernah tersambung internet publik — atau memang
sengaja LAN-only — bisa menjalankan modul ini dengan hanya menyalakan
satu var (`VISITOR_ANALYTICS_ENABLED=true`) di atas default privacy-first
lainnya. Statistik dasar (dashboard `/admin/analytics`: pengunjung unik,
pageview, top paths/browsers/devices, traffic bot) berfungsi penuh:

- `VISITOR_ANALYTICS_ENABLED=true` — **wajib di-set eksplisit sejak
  Issue #624** (defaultnya sekarang `false`, lihat §Default opt-in dan
  upgrade path di atas) — koleksi murni operasi database lokal (INSERT
  ke `awcms_visit_events` lewat middleware, tidak pernah keluar
  proses) setelah diaktifkan.
- `VISITOR_ANALYTICS_RAW_IP_ENABLED=false`,
  `_RAW_USER_AGENT_ENABLED=false`, `_GEO_ENABLED=false` (semua default)
  — tidak ada IP mentah, user-agent mentah, atau negara pengunjung yang
  pernah tersimpan. Kolom `ip_address` di `awcms_visitor_sessions`
  tetap `NULL` selamanya di mode ini.
- `VISITOR_ANALYTICS_TRUST_PROXY`/`_TRUST_CLOUDFLARE=false` (default) —
  IP klien di-resolve dari `clientAddress` koneksi langsung saja, tidak
  pernah dari header yang bisa dipalsukan klien LAN.
- Job terjadwal (`analytics:rollup`, `analytics:purge`) aman dijalankan
  di sini — keduanya operasi database murni tanpa dependency provider
  eksternal apa pun (lihat §Rollup dan §Purge di bawah).

### Mode full online (tanpa proxy tepercaya)

Deployment online publik yang **tidak** menempatkan origin di belakang
proxy/CDN tepercaya harus membiarkan `VISITOR_ANALYTICS_TRUST_PROXY`/
`_TRUST_CLOUDFLARE` tetap `false` — mempercayai header
`X-Forwarded-For`/`CF-Connecting-IP` tanpa proxy tepercaya nyata berarti
klien mana pun bisa memalsukan IP-nya sendiri di data analytics
(spoofing, bukan sekadar noise). Statistik dasar tetap berfungsi sama
seperti mode offline/LAN; hanya resolusi IP klien yang kurang akurat di
balik load balancer/reverse-proxy generik (`clientAddress` adalah IP
proxy, bukan IP klien asli) — trade-off yang diterima demi tidak
mempercayai header yang bisa dipalsukan.

### Mode trusted proxy / Cloudflare

Hanya bila origin **benar-benar** hanya bisa dijangkau lewat proxy/CDN
tepercaya (mis. firewall origin ke rentang IP Cloudflare saja):

- `VISITOR_ANALYTICS_TRUST_PROXY=true` — percaya `X-Forwarded-For` untuk
  resolusi IP klien di belakang reverse-proxy generik.
- `VISITOR_ANALYTICS_TRUST_CLOUDFLARE=true` — percaya `CF-Connecting-IP`
  (IP klien) **dan** `CF-IPCountry` (negara) sekaligus, khusus di
  belakang edge Cloudflare.
- `VISITOR_ANALYTICS_GEO_ENABLED=true` **dan**
  `VISITOR_ANALYTICS_TRUST_CLOUDFLARE=true` (keduanya wajib) untuk
  mengaktifkan breakdown negara pengunjung di dashboard. Salah satu saja
  aktif menghasilkan semua field geo `null` (fail-safe) —
  `bun run security:readiness`'s `checkVisitorAnalyticsGeoTrustedSourceReady`
  (Issue #624, critical) menolak kombinasi "geo aktif tanpa trust
  Cloudflare" sebelum go-live, supaya operator tidak mengira fitur aktif
  padahal diam-diam kosong.

**Kontrak operasional wajib**: proxy tepercaya harus MENIMPA (overwrite)
header `X-Forwarded-For`/`CF-Connecting-IP`/`CF-IPCountry` di setiap
request, tidak pernah meneruskan (append) nilai dari klien apa adanya.
`resolveAnalyticsClientIp` menolak header yang membawa >1 nilai
comma-separated (anomali, fallback ke sumber berikutnya + log warning) —
proxy yang dikonfigurasi benar tidak pernah menghasilkan itu.

### Raw IP / raw user-agent (opsional, semua mode)

Independen dari mode di atas — hanya nyalakan bila benar-benar
dibutuhkan (mis. investigasi keamanan jangka pendek, debugging abuse):

- `VISITOR_ANALYTICS_RAW_IP_ENABLED=true` — mengisi
  `awcms_visitor_sessions.ip_address` (kolom `inet`). Wajib disertai
  `VISITOR_ANALYTICS_RAW_DETAIL_RETENTION_DAYS` yang pendek (default 30
  hari, tidak boleh melebihi `VISITOR_ANALYTICS_EVENT_RETENTION_DAYS`) —
  `bun run security:readiness`'s `checkVisitorAnalyticsRawIpRetentionReady`
  (critical) menggagalkan go-live bila urutan ini dilanggar.
- `VISITOR_ANALYTICS_RAW_USER_AGENT_ENABLED=true` — **saat ini no-op**:
  belum ada kolom raw-user-agent (hanya `user_agent_hash` +
  `user_agent_parsed` hasil parse yang tersimpan). Tetap divalidasi
  (`checkVisitorAnalyticsRawUserAgentRetentionReady`, warning) untuk
  kesiapan retensi hari flag ini benar-benar diwire ke kolom nyata.

## Retensi data (per tabel/kolom)

| Data                                                                      | Retensi default                                    | Env var                                         | Mekanisme purge                                                                                |
| ------------------------------------------------------------------------- | -------------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `awcms_visit_events` (seluruh baris)                                      | 90 hari                                            | `VISITOR_ANALYTICS_EVENT_RETENTION_DAYS`        | Hard delete (`bun run analytics:purge`)                                                        |
| `awcms_visitor_sessions.ip_address`/`login_identifier_snapshot`           | 30 hari (dari `last_seen_at`)                      | `VISITOR_ANALYTICS_RAW_DETAIL_RETENTION_DAYS`   | Cleared in place (row tetap ada)                                                               |
| `awcms_visitor_sessions` (seluruh baris)                                  | 90 hari (dari `last_seen_at`, sama dengan event)   | `VISITOR_ANALYTICS_EVENT_RETENTION_DAYS`        | Hard delete, hanya bila tanpa event tersisa (`NOT EXISTS`)                                     |
| `awcms_visitor_daily_rollups` (seluruh baris)                             | 730 hari                                           | `VISITOR_ANALYTICS_ROLLUP_RETENTION_DAYS`       | Hard delete (`bun run analytics:purge`)                                                        |
| Cookie anonim `awcms_visitor_key` (di browser pengunjung, bukan tabel DB) | 30 hari (Issue #624 audit addendum, dulu ~2 tahun) | `VISITOR_ANALYTICS_VISITOR_KEY_COOKIE_TTL_DAYS` | Expiry browser (natural rotation) + revocation aktif saat modul dinonaktifkan (§Cookie anonim) |

Urutan retensi (raw detail ≤ event ≤ rollup) adalah invarian yang
ditegakkan `bun run security:readiness`'s
`checkVisitorAnalyticsRetentionOrderingReady` (warning — hygiene
konfigurasi, bukan pelanggaran keamanan langsung) dan
`checkVisitorAnalyticsRawIpRetentionReady` (critical — spesifik untuk
raw IP yang benar-benar aktif). "Unless explicitly justified" (kata-kata
issue asli): operator yang punya alasan sah membalik urutan ini (mis.
kebutuhan investigasi jangka panjang) bisa menerima warning tersebut
secara sadar — `security:readiness` tidak memblokir go-live untuk
pelanggaran severity `warning`, hanya `critical`.

## Rollup (`bun run analytics:rollup`, Issue #624)

`scripts/visitor-analytics-rollup.ts` mengagregasi
`awcms_visit_events` mentah menjadi
`awcms_visitor_daily_rollups`, satu baris per `(tenant, date,
area)`, untuk setiap tenant `active`:

- **Idempotent by construction** — setiap run merekomputasi total penuh
  dari event mentah dan UPSERT (`ON CONFLICT (tenant_id, date, area) DO
UPDATE SET ... = EXCLUDED...`), tidak pernah menambah ke nilai lama.
  Menjalankan ulang tanggal yang sama menghasilkan baris identik,
  diverifikasi `tests/integration/visitor-analytics-rollup.integration.test.ts`.
- **Kolom yang diisi**: `human_unique_visitors`, `human_pageviews`,
  `bot_pageviews`, `authenticated_unique_users`,
  `public_unique_visitors` (khusus baris `area='public'`),
  `admin_unique_users` (khusus baris `area='admin'`), dan empat array
  top-10 (`top_paths`/`top_browsers`/`top_devices`/`top_countries`,
  `jsonb`).
- **Area tanpa event pada tanggal itu tidak mendapat baris** — bukan
  baris bernilai nol; sama seperti tabel `awcms_visit_events`
  sumbernya sendiri.
- **Argumen CLI**: `--date=YYYY-MM-DD` (satu tanggal), atau
  `--start-date=.../--end-date=...` (rentang inklusif, untuk backfill).
  Tanpa argumen, default merangkum "kemarin" (UTC) — cocok dijalankan
  cron harian setelah tengah malam UTC, saat hari sebelumnya sudah
  final/tidak berubah lagi.
- **Tidak menyentuh data raw sensitif** — rollup hanya menghitung dan
  meringkas (count, top-N by name), tidak pernah menyalin
  `ip_address`/`login_identifier_snapshot`/nilai raw lain ke tabel
  agregat.

## Purge (`bun run analytics:purge`, Issue #624)

`scripts/visitor-analytics-purge.ts` memanggil
`purgeVisitorAnalyticsData` (`src/modules/visitor-analytics/application/retention-purge.ts`)
langsung untuk setiap tenant `active` — fungsi yang SAMA dipakai
`POST /api/v1/analytics/retention/purge` (Issue #621) untuk purge
on-demand. Job terjadwal ini tidak pernah men-derive ulang aturan
purge-nya sendiri secara terpisah.

Empat cutoff independen per run (detail lengkap di
`application/retention-purge.ts`'s doc comment):

1. `awcms_visit_events` lebih tua dari `eventRetentionDays` — hard
   delete.
2. `ip_address`/`login_identifier_snapshot` di
   `awcms_visitor_sessions` lebih tua dari `rawDetailRetentionDays`
   — dikosongkan di tempat, baris tetap ada (field
   browser/device/OS agregat tetap berguna lama setelah raw detail
   seharusnya hilang).
3. `awcms_visitor_sessions` lebih tua dari `eventRetentionDays` —
   hard delete, hanya bila tidak ada `awcms_visit_events` yang
   masih mereferensikannya (`NOT EXISTS`, mencegah pelanggaran FK dari
   write-throttle collector).
4. `awcms_visitor_daily_rollups` lebih tua dari
   `rollupRetentionDays` — hard delete.

**Audit**: hanya tenant yang benar-benar memiliki baris
terhapus/terbersihkan yang mendapat audit event baru
(`module_key='visitor_analytics'`, `action='retention_purged'`,
`severity='critical'`, `resourceType='visitor_analytics_data'`) —
attributes hanya berisi empat angka ringkasan (`eventsDeleted`,
`sessionsRawDetailCleared`, `sessionsDeleted`, `rollupsDeleted`), tidak
pernah data mentah/daftar baris yang terhapus. Tenant tanpa data
kedaluwarsa tidak menghasilkan audit noise.

**Tidak ada lapisan batching tambahan** di atas apa yang
`purgeVisitorAnalyticsData` sudah lakukan (satu set statement per tenant
per run, sudah direview+diuji di Issue #621) — menambah skema batching
kedua yang berbeda akan menjadi bentuk re-derivation yang justru
dilarang doc comment fungsi tersebut.

**Rekomendasi jadwal**: jalankan `analytics:purge` setelah
`analytics:rollup` (lihat `deployment-profiles.md` §Job registry
lainnya) — supaya data yang akan dipurge sudah teragregasi ke rollup
lebih dulu.

## Config dan readiness checks (Issue #624)

Dua lapis validasi, konsisten dengan pola setiap fitur bergerbang
lainnya di repo ini (`checkOnlineAuthSecurityConfig`/`Ready`,
`checkTurnstileConfig`/`Ready`, dst.):

- **`bun run config:validate`** (`scripts/validate-env.ts`'s
  `checkVisitorAnalyticsConfig`, Issue #617) — validasi SHAPE saja:
  `VISITOR_ANALYTICS_MODE` enum dikenal, lima var retensi/jendela/TTL
  (termasuk `VISITOR_ANALYTICS_VISITOR_KEY_COOKIE_TTL_DAYS`, audit
  addendum) integer positif bila diisi. Tidak ada aturan cross-field di
  sini (dan sengaja tidak ditambah di Issue #624 — lihat keputusan desain
  di bawah).
- **`bun run security:readiness`** (`scripts/security-readiness.ts`,
  Issue #624) — enam check cross-field baru, semua reuse
  `resolveVisitorAnalyticsConfig` (tidak pernah baca `process.env`
  langsung):

  | Check                                             | Severity | Kondisi fail                                                                                |
  | ------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------- |
  | `checkVisitorAnalyticsRawIpRetentionReady`        | critical | Raw IP aktif dan retensi raw detail > retensi event                                         |
  | `checkVisitorAnalyticsRawUserAgentRetentionReady` | warning  | Raw user-agent aktif dan retensi raw detail > retensi event (flag ini sendiri masih no-op)  |
  | `checkVisitorAnalyticsGeoTrustedSourceReady`      | critical | Geo aktif tanpa `VISITOR_ANALYTICS_TRUST_CLOUDFLARE`                                        |
  | `checkVisitorAnalyticsRetentionOrderingReady`     | warning  | Retensi raw detail > event, ATAU retensi rollup < event                                     |
  | `checkVisitorAnalyticsHashSaltReady`              | warning  | Modul aktif dan `VISITOR_ANALYTICS_HASH_SALT` kosong                                        |
  | `checkVisitorAnalyticsVisitorKeyCookieTtlReady`   | warning  | Modul aktif dan `VISITOR_ANALYTICS_VISITOR_KEY_COOKIE_TTL_DAYS` > 400 hari (audit addendum) |

  Hanya `critical` yang memblokir go-live (exit non-zero); `warning`
  dilaporkan tapi tidak memblokir — default privacy-first (semua var
  tidak di-set) selalu lulus BERSIH tanpa satu pun finding dari keenam
  check ini.

**Keputusan desain — kenapa cross-field rule ada di `security-readiness.ts`,
bukan `validate-env.ts`'s `checkVisitorAnalyticsConfig`**: pola yang
sudah mapan di repo ini (`checkOnlineAuthSecurityConfig` vs
`checkOnlineAuthSecurityReady`, dst.) memisahkan "apakah SHAPE var ini
valid" (`validate-env.ts`, tidak butuh judgment call keamanan) dari
"apakah KOMBINASI var ini aman untuk go-live" (`security-readiness.ts`,
punya `CheckSeverity` critical/warning/info dan `OUT_OF_SCOPE_ITEMS`
untuk kejujuran cakupan). Enam aturan Issue #624 di atas semuanya
judgment call keamanan lintas-field (raw IP + retensi, geo + trust,
retensi rollup vs event, salt + status aktif, umur cookie anonim) —
bukan validasi bentuk satu var — jadi mengikuti pola yang sama
menghindari duplikasi konsep `CheckSeverity` di `validate-env.ts` yang
tidak pernah punya itu.

## Pemetaan kepatuhan

Tabel di bawah memetakan kontrol yang **sudah diimplementasikan**
(bukan daftar aspirasional) ke pasal/kontrol praktik dari masing-masing
kerangka. Level praktis — merujuk fungsi/file konkret, bukan pernyataan
umum.

### UU PDP (Undang-Undang Pelindungan Data Pribadi, UU No. 27/2022)

| Prinsip UU PDP                                                                                   | Implementasi                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Minimisasi data** (Pasal 16 — pemrosesan sesuai tujuan, tidak berlebih)                        | Raw IP/user-agent/geolokasi (kelas data yang paling mudah mengidentifikasi individu) semuanya mati secara default; hanya hash (`ip_hash`/`user_agent_hash`, HMAC-SHA256 keyed salt deployment) dan field agregat (browser/device/negara) yang tersimpan default.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Batasan penyimpanan** (Pasal 16 — data disimpan sepanjang perlu saja)                          | Retensi bertingkat (raw detail 30 hari < event 90 hari < rollup 730 hari), ditegakkan job terjadwal `analytics:purge` + diverifikasi ulang tiap `security:readiness` (§Retensi di atas).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Keamanan pemrosesan** (Pasal 39 — langkah teknis melindungi data)                              | RLS `ENABLE`+`FORCE` per tenant (isolasi lintas-tenant di level database, bukan hanya filter aplikasi), ABAC default-deny untuk setiap endpoint baca (`authorizeInTransaction`), permission `raw_detail.read` terpisah dari `dashboard.read`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Hak subjek data — akses terbatas ke pihak berwenang saja**                                     | Dashboard `/admin/analytics` dan endpoint `GET /api/v1/analytics/*` (Issue #621) hanya untuk actor dengan permission eksplisit; pengunjung publik tidak punya antarmuka untuk melihat data mereka sendiri (di luar cakupan — modul ini observability internal).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Hak subjek data — penghapusan/anonymisasi** (Pasal 16/26 — hak untuk memusnahkan data pribadi) | Data pengunjung anonim tidak punya identitas yang bisa diminta dihapus secara individual (tidak ada login/email/nomor telepon yang terhubung ke pengunjung publik) — penghapusan bekerja lewat retensi bertingkat otomatis (`analytics:purge`, §Retensi di atas), bukan permintaan per-individu. Untuk pengunjung yang KEBETULAN terautentikasi (`/admin/*`), `identity_id` hanya dihapus bersamaan dengan baris event/session induknya lewat retensi yang sama — tidak ada tabel/kolom analytics terpisah yang bertahan lebih lama dari identitas induknya. Cookie anonim itu sendiri bisa "dihapus" secara efektif oleh pengunjung kapan pun (hapus cookie browser) atau oleh operator (nonaktifkan modul → `shouldRevokeVisitorKeyCookie` menghapusnya otomatis, lihat §Cookie anonim). |
| **Akuntabilitas pemrosesan** (Pasal 44 — dokumentasi pemrosesan)                                 | Dokumen ini + `src/modules/visitor-analytics/README.md` + skill mendokumentasikan seluruh alur data: apa yang dikumpulkan, kapan, berapa lama disimpan, siapa yang bisa akses.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Dasar hukum bukan pengaturan software** (Pasal 20 — persetujuan/dasar sah lain)                | `VISITOR_ANALYTICS_ENABLED=true` adalah switch teknis operator, bukan pengganti penetapan dasar hukum/tujuan pemrosesan yang wajib dilakukan operator sendiri sebelum mengaktifkan koleksi apa pun — didokumentasikan eksplisit di §Default opt-in dan upgrade path.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

**Kontrol tenant-admin**: setiap tenant hanya melihat/mengelola data
pengunjungnya sendiri (RLS `FORCE` per `tenant_id`, tidak ada view
lintas-tenant). Permission `visitor_analytics.retention.purge` memberi
tenant-admin kontrol eksplisit untuk memicu purge on-demand
(`POST /api/v1/analytics/retention/purge`, Issue #621) di luar jadwal
otomatis `analytics:purge` — mis. untuk merespons permintaan penghapusan
yang lebih cepat dari siklus retensi terjadwal. Tidak ada tenant-admin
yang bisa memperpanjang retensi lebih dari yang diizinkan
`security:readiness`'s check `critical` (raw IP) tanpa mengubah env var
deployment (bukan lewat UI runtime) — mencegah satu tenant diam-diam
melonggarkan kontrol privasi seluruh deployment.

### PP PSTE (Penyelenggaraan Sistem dan Transaksi Elektronik, PP No. 71/2019 + turunannya)

Kewajiban umum penyelenggara sistem elektronik yang relevan sudah
tercakup lewat kontrol teknis yang sama dipakai modul lain (RLS, ABAC,
audit, secret hygiene — lihat `20_threat_model_security_architecture.md`)
— tidak ada kewajiban PSTE spesifik-analytics tambahan yang
teridentifikasi di luar itu untuk base generik ini:

- **Keandalan sistem elektronik**: koleksi telemetry fail-open (tidak
  pernah menggagalkan request admin/publik yang sebenarnya — error
  koleksi hanya dicatat sebagai `log("warning", ...)`, tidak pernah
  dilempar ke response).
- **Perlindungan data pengguna sistem**: sama dengan kontrol UU PDP di
  atas (minimisasi, retensi, RLS, ABAC).
- Kewajiban sertifikasi/pendaftaran PSE (bila berlaku untuk skala
  operator tertentu) tetap tanggung jawab lapisan operasional aplikasi
  turunan, bukan sesuatu yang bisa dibuktikan dari kode.

### ISO/IEC 27001:2022 Annex A (kontrol relevan-kode)

| Kontrol Annex A                         | Implementasi                                                                                                                                                                        |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A.5.12 Klasifikasi informasi**        | IP/user-agent/geolokasi diperlakukan sebagai kelas data sensitif terpisah dari data agregat — permission `raw_detail.read` sendiri.                                                 |
| **A.8.10 Penghapusan informasi**        | `analytics:purge` (hard delete + in-place clear) sesuai retensi terkonfigurasi; tidak ada baris raw yang bertahan tanpa batas waktu.                                                |
| **A.8.15 Logging**                      | Purge itu sendiri diaudit (`retention_purged`, critical) — aksi penghapusan data bukan operasi senyap.                                                                              |
| **A.8.16 Aktivitas pemantauan**         | Dashboard/API menyediakan visibility pengunjung/traffic bot untuk tenant sendiri; tidak ada integrasi SIEM eksternal (out of scope).                                                |
| **A.8.24 Penggunaan kriptografi**       | `ip_hash`/`user_agent_hash`/`visitor_key_hash` = HMAC-SHA256 keyed `VISITOR_ANALYTICS_HASH_SALT` (bukan SHA256 polos) — mencegah korelasi lintas-deployment lewat tabel precompute. |
| **A.5.34 Privasi dan perlindungan PII** | Prinsip privacy-first default menyeluruh (§Ringkasan modul di atas) adalah implementasi langsung kontrol ini.                                                                       |

### ISO/IEC 27002:2022 (panduan implementasi kontrol di atas)

Panduan 27002 untuk kontrol Annex A yang sama di atas sudah tercermin
langsung di level kode, bukan hanya kebijakan tertulis: kontrol 8.10
(penghapusan) diimplementasikan sebagai job otomatis terjadwal (bukan
proses manual yang bisa terlewat), kontrol 5.12 (klasifikasi) sebagai
constraint permission yang ditegakkan database (bukan konvensi
penamaan), dan kontrol 8.24 (kriptografi) sebagai fungsi hash bersama
yang dipakai ulang di semua titik penulisan (`hashIpAddress`/
`hashUserAgent`/`hashVisitorKey`, satu implementasi, bukan tersebar).

### ISO/IEC 27005:2023 (manajemen risiko)

Pendekatan risk-treatment yang dipakai epic ini: setiap sub-fitur
berisiko tinggi (raw IP, raw user-agent, geolokasi) di-treat dengan
**avoidance-by-default** (mati kecuali eksplisit diaktifkan) ketimbang
mitigasi setelah aktif — pilihan yang lebih kuat dari sekadar
"mitigasi risiko" karena risiko tidak pernah terealisasi kecuali
operator secara sadar memilih trade-off-nya. Risiko residual yang
diterima secara eksplisit (bukan diabaikan diam-diam):

- Region/city/timezone selalu `null` (belum ada GeoIP lokal) — risiko
  "data lokasi tidak lengkap", diterima karena alternatifnya (GeoIP
  database pihak ketiga) memperkenalkan dependency baru di luar
  cakupan epic ini.
- `VISITOR_ANALYTICS_HASH_SALT` kosong tetap lulus `security:readiness`
  (warning, bukan critical) — risiko "korelasi hash lintas-deployment
  lewat precompute table", diterima karena menaikkan ke critical akan
  menggagalkan setiap deployment default yang sudah ada tanpa manfaat
  proporsional (lihat tabel severity di §Config dan readiness checks).

### ISO/IEC 27701:2025 (ekstensi privasi untuk ISO 27001, PIMS)

Catatan versi: dokumen ini sebelumnya merujuk ISO/IEC 27701:2019; audit
repositori 2026-07-11 (Issue #624 addendum) memutakhirkan referensi ke
edisi 2025 yang lebih baru — pemetaan kontrol di bawah tetap berlaku
karena prinsip inti (PIMS di atas ISMS, privacy by design/default,
kontrol pengunjung/subjek data) tidak berubah antar edisi untuk cakupan
praktis modul ini.

Modul ini beroperasi sebagai **PII controller** untuk data pengunjung
tenant sendiri (bukan PII processor pihak ketiga — tidak ada data
dikirim ke provider eksternal manapun):

- **6.2 Kondisi pengumpulan dan pemrosesan** — koleksi dibatasi tujuan
  (statistik operasional), tidak pernah dipakai untuk profiling
  individu di luar cakupan modul (tidak ada targeting/personalisasi).
  Sejak Issue #624 addendum, koleksi juga tidak pernah mulai sama sekali
  tanpa keputusan opt-in eksplisit operator (§Default opt-in dan upgrade
  path) — memperkuat syarat "kondisi pengumpulan" ini di titik paling
  awal siklus data (sebelum baris pertama pernah ditulis).
- **7.4 Minimisasi PII (privasi berdasarkan desain)** — privacy-first
  default adalah penerapan langsung "privacy by design and by default"
  yang menjadi inti 27701 — bukan opt-out, tapi opt-in eksplisit per
  flag sensitif, termasuk flag master (`VISITOR_ANALYTICS_ENABLED`)
  sendiri sejak audit addendum ini.
- **7.9 Penghapusan PII** — job purge terjadwal + retensi bertingkat
  (§Retensi/§Purge di atas), plus revocation cookie anonim otomatis saat
  modul dinonaktifkan (§Cookie anonim) — identifier pengunjung berhenti
  bertahan begitu tujuan pengumpulannya berakhir, bukan hanya datanya di
  server.
- **7.3.9/7.2.8 Kontrol subjek data (hak akses/koreksi/penghapusan
  praktis)** — untuk pengunjung anonim, kontrol praktis yang setara
  adalah: (a) menghapus cookie browser sendiri kapan pun, (b) retensi
  bertingkat otomatis yang membatasi seberapa lama data bertahan tanpa
  perlu permintaan eksplisit. Untuk tenant sebagai controller, kontrol
  administratif tersedia lewat `visitor_analytics.retention.purge`
  (purge on-demand) — lihat §Pemetaan kepatuhan UU PDP di atas untuk
  detail kontrol tenant-admin.

### OWASP ASVS (Application Security Verification Standard, level L1/L2 relevan)

| Kontrol ASVS                                                            | Implementasi                                                                                                                                                                               |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **V1.8 (klasifikasi data), V8.3 (data sensitif tidak di-cache/di-log)** | Query-string sensitif (`token`/`password`/`secret`/dst., 11 parameter) dibuang oleh `sanitizePath` sebelum path pernah masuk `path_sanitized` — fail-safe untuk input yang gagal di-parse. |
| **V4.1/V4.2 (kontrol akses fungsi/data)**                               | ABAC default-deny per endpoint, `raw_detail.read` terpisah dari `dashboard.read`, RLS `FORCE` per tenant.                                                                                  |
| **V7.4 (error handling tidak membocorkan info sensitif)**               | Koleksi telemetry fail-open — kegagalan hanya di-log `warning`, tidak pernah bocor ke response client.                                                                                     |
| **V9.1/V9.2 (komunikasi, validasi header terpercaya)**                  | `resolveAnalyticsClientIp` hanya mempercayai header forwarded saat trust flag eksplisit `true`; header ambigu (>1 nilai) ditolak.                                                          |
| **V14.3 (konfigurasi aman by default)**                                 | Setiap sub-fitur sensitif default `false`; `config:validate`/`security:readiness` menegakkan kombinasi aman sebelum go-live.                                                               |

### OWASP Logging Cheat Sheet

| Rekomendasi                                                                                                                                                | Implementasi                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Jangan log data sensitif mentah**                                                                                                                        | Query-string sensitif disaring (`sanitizePath`); dua kolom `jsonb` catch-all (`user_agent_parsed`/`geo`) hanya berisi nilai hasil parse, tidak pernah raw request body/header/cookie/Authorization.                                              |
| **Log aksi administratif/berisiko tinggi**                                                                                                                 | Purge (hard delete data) selalu diaudit (`retention_purged`, critical) dengan ringkasan angka, correlation ID untuk pelacakan lintas-hop.                                                                                                        |
| **Retensi log yang wajar, bukan tak terbatas**                                                                                                             | §Retensi di atas — bertingkat sesuai sensitivitas, ditegakkan job terjadwal, bukan manual.                                                                                                                                                       |
| **Integritas log — tidak bisa diubah sembarangan aktor**                                                                                                   | Semua tabel `ENABLE`+`FORCE ROW LEVEL SECURITY`; hanya server-side code (bukan client) yang pernah menulis, lewat collector/rollup/purge terpusat.                                                                                               |
| **Fail-safe, bukan fail-open untuk keputusan keamanan** (catatan: koleksi telemetry sendiri sengaja fail-OPEN, bukan fail-closed — lihat catatan di bawah) | Koleksi (bukan keputusan otorisasi) fail-open by design supaya kegagalan logging tidak pernah memblokir request bisnis nyata — trade-off yang eksplisit, bukan kelalaian; kontras dengan ABAC/RLS yang selalu fail-closed untuk keputusan akses. |

## Batasan yang dicatat, bukan diabaikan

- **Rollup tidak menyertakan parameter area/visitor-type di endpoint
  agregat** — di luar cakupan Issue #624 (perubahan API, bukan job),
  konsisten dengan batasan yang sudah dicatat Issue #622.
- **Tidak ada integrasi SIEM eksternal** — out of scope epic ini;
  extension point `AuditExportHook` (`src/modules/logging/application/audit-log.ts`)
  sudah tersedia untuk aplikasi turunan yang ingin memasangnya sendiri.
- **Tidak ada GeoIP lokal/offline** — region/city/timezone selalu
  `null`; hanya country code dari header Cloudflare yang pernah terisi.
- **`VISITOR_ANALYTICS_RAW_USER_AGENT_ENABLED` masih no-op** — lihat
  §Raw IP / raw user-agent di atas.
