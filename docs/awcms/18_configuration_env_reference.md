# Bagian 18 — Configuration dan Environment Reference

> **Status (2026-07-14):** Repo `awcms` baru pada tahap fondasi ulang
> (lihat [ADR-0001](../adr/0001-rebuild-on-awcms-foundation-erp-scope.md)) —
> **belum ada modul ERP yang diimplementasikan**. Dokumen ini adalah
> **standar/pola target** untuk konfigurasi fondasi (runtime, database, auth,
> sync, storage) yang akan berlaku begitu implementasi dimulai — diadaptasi
> dari base [awcms-mini](https://github.com/ahliweb/awcms-mini) yang sudah
> fully implemented, DIKURANGI seluruh env var yang spesifik untuk fitur CMS
> (blog/news portal, social publishing, visitor analytics publik, R2 media
> berita) yang tidak relevan untuk skop ERP repo ini. Env var spesifik modul
> ERP (finance, inventory, procurement, manufacturing, HR/payroll) dan
> integrasi bisnis (payment gateway, marketplace, Coretax, logistik) BELUM
> ada — akan didokumentasikan bertahap begitu modul itu benar-benar dibangun
> (lihat §ERP & integrasi bisnis — placeholder di bawah), bukan ditulis di
> muka.

## Tujuan

Dokumen ini akan melengkapi referensi konfigurasi fondasi AWCMS: seluruh
environment variable, feature flag opsional, presedensi konfigurasi, profil
per-environment, penanganan secret, dan topologi deployment offline/LAN-first
yang menjadi baseline platform ERP ini.

## Prinsip konfigurasi

1. Semua secret hanya dari **environment**, tidak pernah di kode/commit.
2. `.env` di-ignore; `.env.example` hanya placeholder.
3. Provider eksternal (payment gateway, marketplace, tax/logistik, dst.)
   **opsional** via feature flag; default off.
4. Operasional inti (mis. transaksi/pencatatan) tidak boleh gagal karena
   provider off — degradasi anggun (queue/pending), bukan hard failure.
5. Konfigurasi tervalidasi saat boot; nilai wajib yang hilang menghentikan
   start dengan pesan jelas.
6. Soft delete adalah perilaku platform wajib, bukan feature flag;
   retention/purge dikontrol policy dan workflow.
7. Runtime, build, dan seluruh tooling wajib **Bun** (Bun-only); tidak ada
   binary `node` di jalur dev/build/deploy.

## Runtime & tooling (Bun-only)

- **Runtime & package manager**: Bun (`packageManager: bun@x.y.z` mengunci
  versi). Semua script `package.json` dipanggil via `bun`/`bun run`; tidak
  ada `node`/`npm`/`npx`/`pnpm`/`yarn`.
- **Build/dev**: bin dengan shebang node (astro/vite) dijalankan
  `bun --bun …` agar tidak jatuh ke binary `node`. Jangan sediakan varian
  script `build:node`.
- **Server**: `Bun.serve` native; jika memakai `@astrojs/node` (standalone)
  untuk SSR, entry dijalankan `bun ./dist/server/entry.mjs` (runtime tetap
  Bun).
- **Database**: `Bun.sql` atau `postgres` (postgres.js).
- **Deployment**: `deploy/systemd` `ExecStart` memakai path `bun`; image
  container memakai basis `oven/bun` (bukan `node`). CI Bun-only
  (setup-bun, `bun install --frozen-lockfile`, `bun test`,
  `bun --bun astro build`).
- **Diizinkan** (bukan pelanggaran): import `node:*` (API bawaan Bun) dan
  `@types/*` di devDependencies — keduanya tidak menarik runtime Node.js.

## Presedensi

```mermaid
flowchart LR
  Def[Default kode] --> Env[Environment variable] --> Set[awcms_tenant_settings - per tenant/entitas] --> Eff[Konfigurasi efektif]
```

- Runtime/secret (DB, auth, HMAC sync, provider key): dari **environment**.
- Preferensi tenant/entitas (locale, timezone, theme): dari **`awcms_tenants`**;
  flag fitur tampilan: dari **`awcms_tenant_settings`**. Dikelola lewat
  `GET/PATCH /api/v1/settings` dan layar `/admin/settings` (rencana target).
- Retention soft delete/purge dapat menjadi tenant policy, tetapi tidak boleh
  menonaktifkan audit, RLS, atau default filter `deleted_at IS NULL`.

## Referensi environment variable

Legenda: Wajib = perlu untuk boot; Sensitif = jangan bocor ke log/response.

> **Catatan status**: tabel di bawah adalah target standar konfigurasi
> fondasi. `src/lib/config/registry.ts`, `scripts/validate-env.ts`, dan
> `scripts/config-docs-check.ts` (config registry terstruktur + parity check
> tiga arah registry/`.env.example`/dokumen ini) **belum diimplementasikan**
> di repo ini — akan dibangun mengikuti pola yang sama seperti awcms-mini
> begitu implementasi fondasi dimulai.

### Inti aplikasi

| Var                         | Wajib | Default                 | Sensitif | Fungsi                                                                       |
| --------------------------- | ----- | ----------------------- | -------- | ------------------------------------------------------------------------------ |
| `APP_ENV`                   | Ya    | `development`           | –        | development/staging/production                                                |
| `APP_URL`                   | Ya    | `http://localhost:4321` | –        | Base URL aplikasi                                                              |
| `LOG_LEVEL`                 | –     | `info`                  | –        | debug/info/warn/error                                                          |
| `AUDIT_LOG_RETENTION_DAYS`  | –     | `730`                   | –        | Retensi `awcms_audit_events` (hari), dipakai job purge audit log               |
| `FORM_DRAFT_RETENTION_DAYS` | –     | `30`                    | –        | Retensi draft form `expired`/`abandoned` (hari)                                |

Timezone/locale default per tenant/entitas direncanakan dari data
(`awcms_tenants`/`awcms_tenant_settings`), bukan env var — mengikuti pola
awcms-mini yang men-deprecate `APP_TIMEZONE`/`APP_DEFAULT_LOCALE` sebagai env
var karena nilai efektifnya selalu berasal dari DB per tenant.

### Database & pool

| Var                             | Wajib | Default                         | Sensitif | Fungsi                                                                                                   |
| -------------------------------- | ----- | ------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                  | Ya    | –                               | Ya       | Koneksi PostgreSQL (role `awcms_app`)                                                                     |
| `AWCMS_APP_DB_PASSWORD`         | –     | –                                | Ya       | Password role `awcms_app` dipakai script init container; harus sama dengan password di `DATABASE_URL`     |
| `DATABASE_POOL_MAX`             | –     | `20`                             | –        | Maks koneksi pool (role `app`; default untuk `worker`/`setup` juga, kecuali di-override)                   |
| `DATABASE_POOL_MAX_WORKER`      | –     | fallback ke `DATABASE_POOL_MAX` | –        | Override maks koneksi pool khusus role `awcms_worker`                                                     |
| `DATABASE_POOL_MAX_SETUP`       | –     | fallback ke `DATABASE_POOL_MAX` | –        | Override maks koneksi pool khusus role `awcms_setup`                                                      |
| `DATABASE_STATEMENT_TIMEOUT_MS` | –     | `15000`                         | –        | Timeout statement                                                                                          |
| `DATABASE_PGBOUNCER`            | –     | `false`                         | –        | Mode PgBouncer (transaction)                                                                                |
| `WORKER_DATABASE_URL`           | –     | fallback ke `DATABASE_URL`      | Ya       | Koneksi role `awcms_worker` (background job/cron)                                                          |
| `SETUP_DATABASE_URL`            | –     | fallback ke `DATABASE_URL`      | Ya       | Koneksi role `awcms_setup` (`POST /api/v1/setup/initialize`)                                               |

#### Model role database (target)

Direncanakan mengikuti pola **empat role** Postgres yang sama seperti
awcms-mini:

1. **Migration owner** (superuser/owner) — dipakai `bun run db:migrate` saja.
   Satu-satunya role yang bisa `ALTER`/`DROP`/`CREATE`/`GRANT`.
2. **`awcms_app`** ("web runtime", `DATABASE_URL`) — melayani setiap HTTP
   request biasa. DML penuh di tabel tenant-scoped (RLS FORCE'd — batas
   keamanan sesungguhnya). Di tabel global (non-RLS: permissions, schema
   migrations, setup state, tenants, modules) hanya diberi hak yang
   benar-benar dipakai jalur request.
3. **`awcms_worker`** ("background worker", `WORKER_DATABASE_URL`) — script
   cron/systemd-timer tanpa endpoint HTTP (retensi/purge, dispatch sync,
   dispatch notifikasi, rekonsiliasi, dst.). Nol akses ke tabel global
   kecuali `SELECT` di `awcms_tenants` (untuk iterasi tenant aktif).
4. **`awcms_setup`** ("bootstrap/setup", `SETUP_DATABASE_URL`) — hanya
   `POST /api/v1/setup/initialize` (wizard setup sekali-jalan).

`WORKER_DATABASE_URL`/`SETUP_DATABASE_URL` direncanakan **opsional**
(fallback ke `DATABASE_URL`/role `awcms_app`) — deployment kecil/offline yang
tidak ingin mengelola banyak connection string tetap bisa jalan lewat satu
role, dengan konsekuensi kehilangan lapisan defense-in-depth tambahan.

#### Kapasitas deployment-aware (target)

Direncanakan model kapasitas koneksi lintas-instance yang sama seperti
awcms-mini — pool/work-class per proses vs kapasitas PostgreSQL/PgBouncer
yang disetujui untuk seluruh armada instance, divalidasi lewat perintah
`database:capacity:check` sebelum go-live.

| Var                                             | Wajib | Default | Sensitif | Fungsi                                                                                                                                       |
| ------------------------------------------------ | ----- | ------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_WORK_CLASS_QUEUE_MULTIPLIER`          | –     | `4`     | –        | Kedalaman antrean FIFO per work class = max konkurensi x angka ini; penuh -> reject langsung (503 + `Retry-After`)                          |
| `DATABASE_CAPACITY_APP_INSTANCES_MIN`           | –     | `1`     | –        | Instance `app` (web/SSR) minimum yang diharapkan berjalan bersamaan                                                                          |
| `DATABASE_CAPACITY_APP_INSTANCES_EXPECTED`      | –     | `1`     | –        | Instance `app` steady-state yang diharapkan                                                                                                 |
| `DATABASE_CAPACITY_APP_INSTANCES_MAX`           | –     | `1`     | –        | Batas atas horizontal instance `app`                                                                                                         |
| `DATABASE_CAPACITY_WORKER_INSTANCES_MIN`        | –     | `0`     | –        | Instance `worker` minimum (script periodik, bukan daemon selalu-jalan)                                                                       |
| `DATABASE_CAPACITY_WORKER_INSTANCES_EXPECTED`   | –     | `1`     | –        | Instance `worker` steady-state yang diharapkan                                                                                              |
| `DATABASE_CAPACITY_WORKER_INSTANCES_MAX`        | –     | `1`     | –        | Batas atas horizontal instance `worker`                                                                                                      |
| `DATABASE_CAPACITY_SETUP_INSTANCES_MIN`         | –     | `0`     | –        | Instance `setup` minimum                                                                                                                     |
| `DATABASE_CAPACITY_SETUP_INSTANCES_EXPECTED`    | –     | `0`     | –        | Instance `setup` steady-state yang diharapkan                                                                                               |
| `DATABASE_CAPACITY_SETUP_INSTANCES_MAX`         | –     | `1`     | –        | Batas atas horizontal instance `setup`                                                                                                       |
| `DATABASE_CAPACITY_PGBOUNCER_MAX_CLIENT_CONN`   | –     | `200`   | –        | `pgbouncer.ini`'s `max_client_conn` yang diharapkan (bila `DATABASE_PGBOUNCER=true`)                                                          |
| `DATABASE_CAPACITY_PGBOUNCER_DEFAULT_POOL_SIZE` | –     | `20`    | –        | `pgbouncer.ini`'s `default_pool_size` yang diharapkan (bila `DATABASE_PGBOUNCER=true`)                                                        |
| `DATABASE_CAPACITY_APPROVED_CONNECTIONS`        | –     | `100`   | –        | Budget koneksi PostgreSQL/PgBouncer yang disetujui untuk deployment ini                                                                      |
| `DATABASE_CAPACITY_RESERVED_ADMIN_CONNECTIONS`  | –     | `5`     | –        | Koneksi dicadangkan untuk admin/migration/backup-restore — tidak pernah dipakai sizing runtime app/worker/setup                             |

Default di atas ditujukan aman untuk topologi LAN-first satu-instance tanpa
PgBouncer. Naikkan var instance MAX hanya saat benar-benar scale-out
horizontal.

### Auth & keamanan

| Var                                         | Wajib          | Default | Sensitif | Fungsi                                                                                             |
| -------------------------------------------- | -------------- | ------- | -------- | ----------------------------------------------------------------------------------------------------- |
| `AUTH_SESSION_TTL_MIN`                      | –              | `120`   | –        | Umur sesi (token opaque, disimpan sebagai `token_hash` — bukan JWT)                                |
| `AUTH_COOKIE_SECURE`                        | –              | `true`  | –        | Cookie hanya HTTPS di prod                                                                          |
| `AUTH_LOGIN_MAX_ATTEMPTS`                   | –              | `5`     | –        | Lockout login (per identitas)                                                                       |
| `AUTH_LOGIN_RATE_LIMIT_MAX`                 | –              | `20`    | –        | Rate limit login per sumber+tenant                                                                  |
| `AUTH_LOGIN_RATE_LIMIT_WINDOW_SEC`          | –              | `60`    | –        | Jendela waktu rate limit login (detik)                                                              |
| `AUTH_PASSWORD_RESET_TOKEN_TTL_MIN`         | –              | `30`    | –        | Umur token reset password                                                                            |
| `AUTH_PASSWORD_RESET_RATE_LIMIT_MAX`        | –              | `5`     | –        | Rate limit forgot/reset per sumber+tenant                                                           |
| `AUTH_PASSWORD_RESET_RATE_LIMIT_WINDOW_SEC` | –              | `900`   | –        | Jendela waktu rate limit reset password (detik)                                                     |
| `AUTH_ONLINE_SECURITY_ENABLED`              | –              | `false` | –        | Gate full-online-only auth hardening — lihat §Full-online auth security hardening di bawah          |
| `AUTH_ONLINE_SECURITY_PROFILE`              | –              | `disabled` | –     | `disabled` (default) atau `full_online`; wajib `full_online` bila `AUTH_ONLINE_SECURITY_ENABLED=true` |
| `TURNSTILE_ENABLED`                         | –              | `false` | –        | Cloudflare Turnstile bot protection                                                                  |
| `TURNSTILE_SITE_KEY`                        | bila Turnstile | –       | –        | Site key publik (bukan secret) — dirender di widget `/login`                                        |
| `TURNSTILE_SECRET_KEY`                      | bila Turnstile | –       | Ya       | Secret key — hanya untuk verifikasi server-side                                                     |
| `TURNSTILE_VERIFY_TIMEOUT_MS`               | –              | `5000`  | –        | Timeout panggilan siteverify Cloudflare (ms)                                                        |
| `AUTH_MFA_ENABLED`                          | –              | `false` | –        | MFA/TOTP login challenge                                                                             |
| `AUTH_MFA_SECRET_ENCRYPTION_KEY`            | bila MFA       | –       | Ya       | Key AES-256-GCM (base64, 32 byte) untuk enkripsi-at-rest TOTP secret                                 |
| `AUTH_MFA_TOTP_ISSUER`                      | –              | `AWCMS` | –        | Nama issuer yang tampil di aplikasi authenticator                                                    |
| `AUTH_MFA_TOTP_PERIOD_SEC`                  | –              | `30`    | –        | Panjang time-step TOTP (detik)                                                                       |
| `AUTH_MFA_TOTP_DIGITS`                      | –              | `6`     | –        | Jumlah digit kode TOTP (`6` atau `8`)                                                                |
| `AUTH_MFA_CHALLENGE_TTL_SEC`                | –              | `300`   | –        | Umur challenge MFA login (detik)                                                                     |
| `AUTH_MFA_RATE_LIMIT_MAX`                   | –              | `5`     | –        | Rate limit verifikasi MFA per sumber+tenant                                                          |
| `AUTH_MFA_RATE_LIMIT_WINDOW_SEC`            | –              | `300`   | –        | Jendela waktu rate limit verifikasi MFA (detik)                                                      |
| `AUTH_GOOGLE_LOGIN_ENABLED`                 | –              | `false` | –        | Google OIDC login                                                                                    |
| `AUTH_GOOGLE_CLIENT_ID`                     | bila Google    | –       | –        | OAuth client ID dari Google Cloud Console                                                            |
| `AUTH_GOOGLE_CLIENT_SECRET`                 | bila Google    | –       | Ya       | OAuth client secret — hanya untuk token exchange server-side                                        |
| `AUTH_GOOGLE_ALLOWED_DOMAINS`               | –              | –       | –        | Daftar domain email (dipisah koma) yang boleh auto-link; kosong = auto-link selalu ditolak          |
| `AUTH_GOOGLE_REDIRECT_PATH`                 | –              | `/api/v1/auth/providers/google/callback` | – | Path callback OAuth di bawah `APP_URL`                                            |
| `AUTH_SSO_ENABLED`                          | –              | `false` | –        | Generic tenant OIDC SSO                                                                              |
| `AUTH_SSO_CREDENTIAL_ENCRYPTION_KEY`        | bila SSO       | –       | Ya       | Key AES-256-GCM (base64, 32 byte) untuk enkripsi-at-rest client secret provider — beda dari key MFA |
| `AUTH_SSO_DISCOVERY_TIMEOUT_MS`             | –              | `5000`  | –        | Timeout discovery/JWKS/token-exchange OIDC provider tenant (ms)                                     |
| `AUTH_SSO_MAX_PROVIDERS_PER_TENANT`         | –              | `20`    | –        | Batas jumlah baris provider aktif per tenant                                                         |

### Full-online auth security hardening (opsional, target)

Gate bersama untuk fitur online-only: Cloudflare Turnstile, MFA/TOTP, Google
OIDC login, generic tenant OIDC SSO, dan admin policy UI. **Bukan** pengganti
model deployment `APP_ENV=production` — deployment offline/LAN direncanakan
bisa production-grade secara operasional tanpa pernah butuh fitur
online-only ini.

- `AUTH_ONLINE_SECURITY_ENABLED` tidak di-set (atau bukan `"true"`) → seluruh
  fitur hardening online-only dianggap nonaktif; tidak ada credential
  provider apa pun yang dibutuhkan. Ini default setiap deployment
  offline/LAN.
- `AUTH_ONLINE_SECURITY_ENABLED=true` mewajibkan
  `AUTH_ONLINE_SECURITY_PROFILE=full_online` — nilai lain (termasuk
  `"disabled"` yang eksplisit kontradiktif) direncanakan gagal
  `config:validate`.
- Direncanakan satu helper terpusat (pola `isFullOnlineSecurityActive(env)`)
  yang wajib dipanggil setiap fitur online/provider-terkait sebelum
  melakukan apa pun yang online/provider-terkait — jangan re-derive aturan
  "keduanya harus setuju" di tempat lain.
- **Cloudflare Turnstile** — direncanakan divalidasi independen dari gate di
  atas, tapi aktivasi runtime butuh KEDUANYA (gate ∧ `TURNSTILE_ENABLED=true`).
  Berlaku di `POST /auth/login`, `/auth/password/forgot`,
  `/auth/password/reset`, `/setup/initialize` — token diverifikasi
  server-side ke Cloudflare siteverify SEBELUM proses password/DB yang
  mahal. Verifikasi fail-closed by design; hanya kegagalan transport genuine
  ke Cloudflare yang membuka circuit breaker-nya — respons `success:false`
  yang normal (token client memang salah) tidak memicu breaker.
- **MFA/TOTP** — `AUTH_MFA_ENABLED` direncanakan divalidasi independen dari
  gate di atas, tapi aktivasi runtime butuh KEDUANYA. MFA **opt-in per
  identity**, bukan mandatory tenant-wide. TOTP secret dienkripsi at rest
  (AES-256-GCM, `AUTH_MFA_SECRET_ENCRYPTION_KEY`) — satu-satunya secret
  aplikasi yang dienkripsi reversibel, bukan di-hash, karena harus bisa
  dihitung ulang untuk verifikasi kode. Recovery code disimpan hash-only.
  Reset password TIDAK menonaktifkan MFA.
- **Google OIDC login** — provider account ditautkan via `sub` (subject
  OIDC), TIDAK PERNAH via email — auto-link by email hanya terjadi bila
  `email_verified` DAN domain-nya ada di `AUTH_GOOGLE_ALLOWED_DOMAINS`
  (kosong = auto-link selalu ditolak, fail-closed). ID token diverifikasi
  kriptografis penuh (signature, issuer, audience, expiry, nonce).
- **Generic tenant OIDC SSO** — jalur PARALEL untuk provider
  tenant-configured (Okta, Azure AD, Keycloak, dst.), terpisah dari Google
  OIDC login. Client secret provider terenkripsi AES-256-GCM ATAU env-var
  reference — persis salah satu, tidak pernah keduanya, dan tidak pernah
  plaintext di response API manapun. **Break-glass enforcement**:
  `sso_required=true` atau `password_login_enabled=false` tidak bisa
  disimpan kecuali minimal satu identity break-glass yang saat ini aktif —
  dicek ulang dari DB di titik SAVE dan di titik readiness/go-live.
- **Admin policy UI** — menampilkan ringkasan status seluruh fitur di atas;
  di setiap deployment offline/LAN/local (default), halaman hanya
  menampilkan informasi read-only, tanpa form/tabel apa pun.

### Batas ukuran request body (target)

Direncanakan sebagai konstanta kode (bukan env var) — sengaja tidak dibuat
configurable agar tidak ada deployment yang bisa diam-diam melonggarkan
plafon keras tanpa review kode. Setiap handler `/api/*` yang menerima body
membaca lewat helper `readJsonBody`/`readTextBody`/`readFormBody` (pengganti
`request.json()`/`.text()`/`.formData()` langsung) — menegakkan
`Content-Length` yang dideklarasikan SEBELUM byte apa pun dibaca, dan
penghitungan byte streaming untuk body chunked/tanpa `Content-Length`. Tier
direncanakan: `default` (128 KiB, mayoritas endpoint CRUD/settings/auth),
`large` (5 MiB, endpoint konten-berat/batch — mis. import data
finance/inventory, `sync/push`/`sync/objects` batch). Plafon keras 10 MiB —
tidak ada tier yang boleh melebihinya. Body yang terlalu besar selalu `413
PAYLOAD_TOO_LARGE`.

### Sync & node

| Var                       | Wajib     | Default          | Sensitif | Fungsi                                    |
| -------------------------- | --------- | ---------------- | -------- | -------------------------------------------- |
| `AWCMS_SYNC_ENABLED`      | –         | `false`          | –        | Aktifkan sync hybrid (offline-first outbox) |
| `AWCMS_SYNC_HMAC_SECRET`  | bila sync | –                | Ya       | Signature HMAC                              |
| `AWCMS_SYNC_MAX_SKEW_SEC` | –         | `300`            | –        | Toleransi anti-replay                       |

Identitas node direncanakan berasal dari tabel `awcms_sync_nodes` (DB),
teregistrasi otomatis lewat header/HMAC saat request sync pertama — bukan
env var terpisah (mengikuti temuan awcms-mini yang men-deprecate
`AWCMS_MINI_NODE_ID` karena tidak pernah dibaca kode).

### Storage

| Var                             | Wajib   | Default | Sensitif | Fungsi                                                                       |
| --------------------------------- | ------- | ------- | -------- | -------------------------------------------------------------------------------- |
| `R2_ENABLED`                    | –       | `false` | –        | Aktifkan object storage R2 (mis. lampiran dokumen finance, foto barang inventory) |
| `R2_ACCOUNT_ID`                 | bila R2 | –       | –        | Akun R2 (identifier, bukan kredensial)                                          |
| `R2_ACCESS_KEY_ID`              | bila R2 | –       | Ya       | Kredensial R2                                                                    |
| `R2_SECRET_ACCESS_KEY`          | bila R2 | –       | Ya       | Kredensial R2                                                                    |
| `R2_BUCKET`                     | bila R2 | –       | –        | Bucket                                                                            |
| `OBJECT_SYNC_UPLOAD_TIMEOUT_MS` | –       | `10000` | –        | Timeout upload dispatcher                                                        |

Storage lokal filesystem (`STORAGE_DRIVER`/`LOCAL_STORAGE_PATH`) sengaja
tidak dijadikan env var terpisah — mengikuti temuan awcms-mini bahwa
switch lokal/R2 sesungguhnya cukup satu flag (`R2_ENABLED`).

### Email (notifikasi — target)

Direncanakan sebagai modul base reusable untuk password reset, system
announcement, dan notifikasi workflow (mis. approval finance/procurement
yang butuh persetujuan berjenjang) — provider-neutral.

| Var                             | Wajib           | Default | Sensitif | Fungsi                                                |
| ---------------------------------- | ---------------- | ------- | -------- | -------------------------------------------------------- |
| `EMAIL_ENABLED`                 | –               | `false` | –        | Aktifkan modul email                                    |
| `EMAIL_PROVIDER`                | bila aktif      | –       | –        | Adapter provider email (`log` untuk dev tanpa kredensial) |
| `EMAIL_FROM_ADDRESS`            | bila aktif      | –       | –        | Alamat pengirim default                                 |
| `EMAIL_FROM_NAME`               | –               | `AWCMS` | –        | Nama pengirim default                                   |
| `EMAIL_SEND_TIMEOUT_MS`         | –               | `10000` | –        | Timeout satu percobaan kirim (dispatcher)               |
| `EMAIL_SEND_MAX_RETRIES`        | –               | `5`     | –        | Batas percobaan retry sebelum `failed` final            |

Kredensial provider email konkret (mis. `EMAIL_<PROVIDER>_API_TOKEN`)
ditambahkan begitu adapter provider tersebut benar-benar diimplementasikan —
tidak didaftarkan di muka.

### Data lifecycle (target)

Direncanakan modul System Foundation untuk registry tabel bervolume tinggi
lintas modul dan mesin lifecycle (retensi/partisi/arsip/legal
hold/purge aman) — relevan untuk data finance/transaksi ERP yang bervolume
tinggi dan punya kewajiban retensi/audit jangka panjang.

| Var                                | Wajib | Default                        | Sensitif | Fungsi                                                                         |
| ------------------------------------ | ----- | ------------------------------- | -------- | ---------------------------------------------------------------------------------- |
| `DATA_LIFECYCLE_ARCHIVE_ROOT_PATH` | –     | `./var/data-lifecycle-archive` | –        | Root filesystem tempat local/offline archive adapter menulis artefak arsip        |

### ERP & integrasi bisnis — placeholder

Belum ada env var spesifik modul ERP (finance/accounting, inventory/
warehouse, procurement, manufacturing, HR/payroll) maupun integrasi bisnis
eksternal (payment gateway, marketplace, tax/Coretax, logistics provider) di
repo ini — **belum ada modul yang diimplementasikan** (lihat status di atas).

Saat modul-modul tersebut mulai dibangun, env var-nya akan didokumentasikan
di sini mengikuti pola yang sama seperti section lain di atas: flag
`*_ENABLED` default `false`, kredensial hanya dari environment/secret
manager (tidak pernah kolom DB tenant-controlled kecuali accepted-risk yang
didokumentasikan eksplisit), circuit breaker + timeout per provider,
degradasi anggun saat provider off (transaksi tetap tercatat, sinkronisasi
ke provider tertunda — bukan gagal total), dan cross-field validation lewat
`config:validate`/`security:readiness`. Lihat
[`templates/module-proposal-template.md`](templates/module-proposal-template.md)
dan
[`templates/module-admission-decision-checklist.md`](templates/module-admission-decision-checklist.md)
untuk proses admission modul baru, termasuk checklist khusus provider
eksternal.

## Feature flag

```mermaid
flowchart LR
  Boot[Boot] --> Val[Validasi env]
  Val --> Flags{Feature flags}
  Flags -->|R2 off| L[Storage lokal]
  Flags -->|EMAIL_ENABLED off| Q0[Email module - outbox menunggu, dispatcher tidak jalan]
  Flags -->|Sync off| LanOnly[LAN-only]
  Flags -->|Provider ERP eksternal off| Q1[Transaksi tetap tercatat - sinkronisasi ke provider tertunda]
```

Aturan: fitur off tidak menghentikan operasional inti (pencatatan transaksi);
pesan/objek/dokumen tetap masuk queue dan menunggu fitur diaktifkan.

## `.env.example` lengkap (rekomendasi, target)

```env
# Inti
APP_ENV=development
APP_URL=http://localhost:4321
LOG_LEVEL=info
AUDIT_LOG_RETENTION_DAYS=730
FORM_DRAFT_RETENTION_DAYS=30

# Database
DATABASE_URL=postgres://awcms:awcms_password@localhost:5432/awcms
DATABASE_POOL_MAX=20
DATABASE_STATEMENT_TIMEOUT_MS=15000
DATABASE_PGBOUNCER=false

# Auth
AUTH_SESSION_TTL_MIN=120
AUTH_COOKIE_SECURE=true
AUTH_LOGIN_MAX_ATTEMPTS=5
AUTH_LOGIN_RATE_LIMIT_MAX=20
AUTH_LOGIN_RATE_LIMIT_WINDOW_SEC=60
AUTH_PASSWORD_RESET_TOKEN_TTL_MIN=30
AUTH_PASSWORD_RESET_RATE_LIMIT_MAX=5
AUTH_PASSWORD_RESET_RATE_LIMIT_WINDOW_SEC=900
AUTH_ONLINE_SECURITY_ENABLED=false
AUTH_ONLINE_SECURITY_PROFILE=disabled
TURNSTILE_ENABLED=false
TURNSTILE_VERIFY_TIMEOUT_MS=5000
AUTH_MFA_ENABLED=false
AUTH_MFA_TOTP_ISSUER=AWCMS
AUTH_MFA_TOTP_PERIOD_SEC=30
AUTH_MFA_TOTP_DIGITS=6
AUTH_MFA_CHALLENGE_TTL_SEC=300
AUTH_MFA_RATE_LIMIT_MAX=5
AUTH_MFA_RATE_LIMIT_WINDOW_SEC=300
AUTH_GOOGLE_LOGIN_ENABLED=false
AUTH_GOOGLE_REDIRECT_PATH=/api/v1/auth/providers/google/callback
AUTH_SSO_ENABLED=false
AUTH_SSO_DISCOVERY_TIMEOUT_MS=5000
AUTH_SSO_MAX_PROVIDERS_PER_TENANT=20

# Sync
AWCMS_SYNC_ENABLED=false
AWCMS_SYNC_HMAC_SECRET=change-me
AWCMS_SYNC_MAX_SKEW_SEC=300

# Storage
OBJECT_SYNC_UPLOAD_TIMEOUT_MS=10000
R2_ENABLED=false

# Email (notifikasi)
EMAIL_ENABLED=false
EMAIL_FROM_NAME=AWCMS
EMAIL_SEND_TIMEOUT_MS=10000
EMAIL_SEND_MAX_RETRIES=5

# ERP & integrasi bisnis (belum ada — lihat §ERP & integrasi bisnis di atas)
```

## Profil per-environment

| Environment         | Karakteristik                                                                     |
| -------------------- | ----------------------------------------------------------------------------------- |
| development         | Semua provider off, DB lokal, cookie tidak secure                                 |
| staging             | Meniru prod, data uji, backup aktif                                               |
| production (online) | HTTPS, secret manager, backup+restore teruji, sync opsional                       |
| **offline/LAN**     | Tanpa internet; sync/R2/provider eksternal off atau tertunda; operasional inti tetap penuh jalan; backup lokal |

## Topologi deployment LAN-first

```mermaid
flowchart TB
  subgraph LAN["Kantor / Gudang / LAN"]
    P1[Aplikasi Operasional 1]
    P2[Aplikasi Operasional 2]
    A1[Admin]
    Srv[AWCMS - Bun/Astro]
    DB[(PostgreSQL)]
    Bak[Backup lokal]
    Srv --- DB
    Srv --- Bak
    P1 --- Srv
    P2 --- Srv
    A1 --- Srv
  end
  Srv -. saat online .-> Cloud[(Server pusat / R2 / provider ERP eksternal)]
```

- Satu server LAN menjalankan aplikasi + PostgreSQL; klien via jaringan lokal.
- Provider eksternal & sync hanya saat online; operasional inti tidak
  bergantung padanya.
- Deployment: `deploy/systemd`, `deploy/nginx`, `deploy/pgbouncer`,
  `deploy/backup` (rencana, mengikuti pola awcms-mini).

## Validasi konfigurasi saat boot

- Var wajib hilang → gagal start dengan pesan jelas (tanpa membocorkan nilai).
- Flag aktif tanpa kredensial (mis. `R2_ENABLED=true` tanpa key) → gagal start.
- Secret tidak pernah masuk log (redaction).

## Acceptance criteria (target)

- Boot memvalidasi env; var wajib hilang menghentikan start dengan pesan aman.
- Provider off tidak menghentikan operasional inti; pesan/objek/dokumen masuk queue.
- Secret hanya dari env; tidak ada di kode/commit/log/response.
- Preferensi tenant (locale/theme) dari `awcms_tenants`, bukan hardcode.
- Profil offline/LAN berjalan penuh tanpa internet.
