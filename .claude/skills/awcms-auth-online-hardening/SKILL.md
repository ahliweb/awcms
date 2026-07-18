---
name: awcms-auth-online-hardening
description: BACAAN SAJA (SPEKULATIF) — seluruh epic "full-online auth security hardening" (Issue #587-#593) yang dirujuk di skill ini TIDAK ADA. Diverifikasi 2026-07-18 lewat `gh issue view 587` (GraphQL "could not resolve to an issue or pull request") dan pencarian kode menyeluruh (`online-security-config.ts`, `AUTH_ONLINE_SECURITY_*`, TOTP, OIDC — nol hasil di `src/`; hanya penyebutan Turnstile *insidental* di `login.astro`/`security-headers.ts` yang tak berkaitan dengan epic ini). Isi skill ini menandai semua 7 item sebagai "Selesai" — klaim itu SEPENUHNYA KELIRU: tak ada issue-nya di GitHub, tak ada baris kode. Jangan gunakan tabel status atau klaim "sudah ada" di bawah sebagai fakta. Bila epic ini benar-benar ingin dikerjakan, ajukan issue GitHub baru dan bangun dari nol — isi di bawah HANYA layak dibaca sebagai draft spesifikasi/ide desain yang belum diverifikasi, bukan rujukan implementasi.
---

# AWCMS — Full-Online Auth Security Hardening

> **PERINGATAN ISI DOKUMEN INI FIKTIF (diverifikasi 2026-07-18).** Setiap
> "Issue #587"–"#593" yang disebut di bawah TIDAK ADA di GitHub repo ini
> (`gh issue view 587` → `GraphQL: Could not resolve to an issue or pull
request`). Setiap file/fungsi/endpoint yang disebut "sudah ada" di bawah
> (`online-security-config.ts`, `auth-security-status.ts`,
> `src/pages/admin/security.astro`, endpoint `/api/v1/identity/sso/*`,
> `AUTH_ONLINE_SECURITY_ENABLED`/`_PROFILE`, TOTP, Google OIDC, generic
> tenant OIDC SSO) **TIDAK DITEMUKAN** di manapun dalam `src/`, `sql/`,
> `scripts/`, atau `.env.example` saat diverifikasi ulang secara menyeluruh.
> Satu-satunya kecocokan nyata adalah penyebutan "Turnstile" di
> `src/pages/login.astro`/`src/lib/security/security-headers.ts` — namun itu
> pun tidak berkaitan dengan epic bertanda "Selesai" di bawah. **Jangan
> pernah bangun di atas asumsi apa pun dari isi skill ini seolah-olah sudah
> ada** — cek kode secara langsung dulu (`find src -iname "*online-security*"`,
> `gh issue list --search "..."`) sebelum mempercayai satu klaim pun di sini.
> Konten teknis di bawah dipertahankan HANYA sebagai draft ide desain yang
> belum diverifikasi/belum diajukan sebagai issue nyata, bukan sebagai
> catatan pekerjaan yang sudah selesai. Sebelum mengerjakan fitur ini,
> ajukan issue GitHub yang sebenarnya dan verifikasi ulang setiap bagian di
> bawah dari nol.
>
> **Satu-satunya rujukan yang JUJUR soal status ini** adalah
> [`docs/awcms/18_configuration_env_reference.md`](../../../docs/awcms/18_configuration_env_reference.md)
> §"Full-online auth security hardening (opsional, target)" — ditulis
> konsisten dalam bentuk "direncanakan"/"target", TIDAK mengklaim sudah
> dibangun. Rujukan skill ini ke bagian senama di `deployment-profiles.md`
> dan `identity-access/README.md` JUGA fiktif — kedua file itu tidak
> punya section tersebut sama sekali (diverifikasi `grep`).

Epic (BELUM DIAJUKAN, BELUM DIKERJAKAN) yang MENARGETKAN enam fitur hardening
auth **online-only** (Cloudflare Turnstile, MFA/TOTP, Google OIDC login,
generic tenant OIDC SSO, admin policy UI, plus penutup docs/kontrak) di atas
login lokal/password + session opaque yang sudah ada, tanpa mengubah perilaku
default offline/LAN/local sama sekali. Model yang DITARGETKAN (belum
diimplementasikan):

```txt
AUTH_ONLINE_SECURITY_ENABLED + AUTH_ONLINE_SECURITY_PROFILE=full_online
  -> isFullOnlineSecurityActive(env) === true
    -> Turnstile / MFA / Google OIDC / generic SSO boleh aktif
```

## Kapan pakai skill ini vs skill generik

Skill ini melengkapi (bukan menggantikan) `awcms-new-endpoint`,
`awcms-new-migration`, `awcms-idempotency`,
`awcms-abac-guard`, `awcms-audit-log`, dan
`awcms-sensitive-data` (kredensial provider, TOTP seed, recovery
code semua data sensitif). Skill ini menyediakan konteks **cross-cutting
epic ini spesifik**: gate bersama yang wajib dicek setiap fitur, dan
keputusan desain yang mengikat semua issue di epic ini sekaligus.

## Status per issue (jangan bangun ulang yang sudah ada)

| Issue | Scope                                                  | Status                                                                                                                                 |
| ----- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| #587  | Gate bersama `AUTH_ONLINE_SECURITY_ENABLED`/`_PROFILE` | **FIKTIF (issue tidak ada, kode tidak ada)** — draft ide, lihat §Gate bersama sebagai spesifikasi belum dikerjakan                     |
| #588  | Cloudflare Turnstile untuk form auth publik            | **FIKTIF (issue tidak ada, kode tidak ada)** — draft ide, lihat §Cloudflare Turnstile sebagai spesifikasi belum dikerjakan             |
| #589  | MFA/TOTP login challenge                               | **FIKTIF (issue tidak ada, kode tidak ada)** — draft ide, lihat §MFA/TOTP sebagai spesifikasi belum dikerjakan                         |
| #590  | Google OIDC login                                      | **FIKTIF (issue tidak ada, kode tidak ada)** — draft ide, lihat §Google OIDC login sebagai spesifikasi belum dikerjakan                |
| #591  | Generic tenant OIDC SSO provider                       | **FIKTIF (issue tidak ada, kode tidak ada)** — draft ide, lihat §Generic tenant OIDC SSO provider sebagai spesifikasi belum dikerjakan |
| #592  | Admin UI kebijakan auth security online                | **FIKTIF (issue tidak ada, kode tidak ada)** — draft ide, lihat §Admin policy UI sebagai spesifikasi belum dikerjakan                  |
| #593  | Docs/kontrak/readiness penutup epic                    | **FIKTIF (issue tidak ada, kode tidak ada)** — draft ide, bukan penutup epic nyata                                                     |

## Yang sudah ada — pakai ulang, jangan re-derive

### Gate bersama (Issue #587, `src/lib/auth/online-security-config.ts`)

Dua env var, **keduanya opsional/backward-compatible** — tidak di-set
sama sekali (default setiap deployment offline/LAN/local), `config:validate`
tetap PASS dan tidak ada perubahan perilaku login sama sekali:

- `AUTH_ONLINE_SECURITY_ENABLED` — `"true"` mengaktifkan gate,
  nilai lain (termasuk unset) berarti nonaktif.
- `AUTH_ONLINE_SECURITY_PROFILE` — `"disabled"` (default) atau
  `"full_online"`. **Wajib** `"full_online"` kalau `AUTH_ONLINE_SECURITY_ENABLED=true`
  — kombinasi lain gagal `bun run config:validate`
  (`checkOnlineAuthSecurityConfig`, `scripts/validate-env.ts`).

Tiga fungsi diekspor:

- `isOnlineSecurityEnabled(env)` — cek flag saja.
- `resolveOnlineSecurityProfile(env)` — selalu jatuh ke `"disabled"`
  untuk nilai kosong/tidak dikenal, tidak pernah throw.
- **`isFullOnlineSecurityActive(env)` — satu-satunya fungsi yang WAJIB
  dipanggil setiap fitur #588-#592 sebelum melakukan apa pun yang
  online/provider-terkait.** Jangan re-derive aturan "keduanya harus
  setuju" di modul lain — impor fungsi ini langsung.

`scripts/security-readiness.ts`'s `checkOnlineAuthSecurityReady`
melaporkan status gate ini (severity `critical` supaya misconfiguration
sungguhan tetap blokir go-live, tapi `status: pass` untuk kondisi
disabled — informational, bukan kegagalan, sesuai acceptance criteria
#587). Detail env var lengkap: `docs/awcms/18_configuration_env_reference.md`
§Full-online auth security hardening,
`docs/awcms/deployment-profiles.md` §Full-online auth security
hardening, `src/modules/identity-access/README.md` §Full-online-only
auth security feature gate.

### Cloudflare Turnstile (Issue #588, `src/lib/security/turnstile.ts`)

Fitur konkret **pertama** yang dibangun di atas gate #587 — pola
referensi untuk #589-#592 berikutnya. Gate gabungan:

```txt
isTurnstileRequired(env)
  = isFullOnlineSecurityActive(env) AND isTurnstileEnabled(env)
  (isTurnstileEnabled = TURNSTILE_ENABLED === "true")
```

- **Satu fungsi enforcement dipanggil dari 4 endpoint**:
  `enforceTurnstileIfRequired(turnstileToken, remoteIp, env)` — dipanggil
  di `POST /api/v1/auth/login`, `/auth/password/forgot`, `/auth/password/reset`,
  dan `/setup/initialize`, tepat setelah body divalidasi tapi **sebelum**
  DB/password hashing (issue's security note: verifikasi Turnstile lebih
  murah, jangan buang kerja mahal untuk request yang bahkan tidak lolos
  bot-check). Mengembalikan `{ok:true}` atau `{ok:false, code:
"TURNSTILE_REQUIRED" | "TURNSTILE_INVALID"}` — **fail closed**:
  misconfiguration (`resolveTurnstileConfig` → `null`) diperlakukan sama
  seperti token invalid, bukan dilewati.
- **Verifikasi env var independen dari gate #587**: `TURNSTILE_ENABLED=true`
  sendiri sudah mewajibkan `TURNSTILE_SITE_KEY`+`TURNSTILE_SECRET_KEY`
  di `config:validate`/`security-readiness` (`checkTurnstileConfig`,
  `scripts/validate-env.ts`) — operator boleh isi kredensial ini lebih
  dulu tanpa menyalakan `AUTH_ONLINE_SECURITY_ENABLED`; aktivasi runtime
  tetap butuh KEDUA gate setuju.
- **`verifyTurnstileToken`** memanggil Cloudflare siteverify server-side
  (issue's security note: "client widget alone is not security"),
  timeout-bounded (`withTimeout`) + circuit breaker
  (`getProviderCircuitBreaker("turnstile")`), pola sama seperti
  `cloudflare-dns-adapter.ts`/`mailketing-provider.ts` — **dengan satu
  perbedaan penting yang wajib dipertahankan**: `breaker.recordFailure()`
  HANYA dipanggil untuk kegagalan transport genuine ke Cloudflare (HTTP
  non-2xx, body tak terparse, network error/timeout), TIDAK PERNAH untuk
  respons 2xx yang sah dengan `success:false` (itu Cloudflare menjawab
  dengan benar bahwa token client-nya salah — hasil normal yang bisa
  dipicu siapa pun tanpa autentikasi). PR #596 security review menemukan
  versi awal menyamakan keduanya: breaker ini shared/cross-tenant, dan
  `enforceTurnstileIfRequired` fail-closed saat breaker terbuka, jadi
  penyerang bisa mengunci login/password-reset/setup SEMUA tenant hanya
  dengan mengirim segelintir token sampah setiap ~30 detik. Jangan
  regresi pola ini di fitur online lain (#589-#592) yang menambah
  circuit breaker provider baru — bedakan selalu "provider tidak sehat"
  dari "input client ditolak provider dengan benar". Log
  `turnstile.circuit_breaker_open`/`turnstile.provider_call_failed`/
  `turnstile.provider_call_errored` (severity `warning`,
  `src/lib/logging/logger.ts`) memberi visibilitas operasional untuk
  keduanya.
- **CSP** (`astro.config.mjs`): `script-src`/`frame-src` mengizinkan
  `https://challenges.cloudflare.com` **tanpa syarat** (tidak digerbangi
  `TURNSTILE_ENABLED` di build time) — alasannya didokumentasikan
  langsung di file itu: CSP Astro cuma bisa di-bake saat build,
  sedangkan `TURNSTILE_ENABLED` didesain runtime-toggleable seperti flag
  lain; widget sendiri tetap runtime-gated lewat `isTurnstileRequired()`
  di `login.astro`.
- **Widget UI** hanya di-render di `login.astro` (form publik lain —
  forgot/reset/setup — belum punya halaman UI di repo ini, baru endpoint
  API-nya) saat `isTurnstileRequired()` true; token dikirim sebagai field
  opsional `turnstileToken` di body JSON, dibaca dari hidden field
  `cf-turnstile-response` yang otomatis diisi widget.
- Error code i18n: `error.turnstile_required`/`error.turnstile_invalid`
  (`src/lib/i18n/error-messages.ts`, `i18n/en.po`+`id.po`).

### MFA/TOTP (Issue #589, `src/modules/identity-access/application/mfa.ts`)

Gate gabungan sama persis polanya dengan Turnstile:

```txt
isMfaRequired(env)
  = isFullOnlineSecurityActive(env) AND isMfaEnabled(env)
  (isMfaEnabled = AUTH_MFA_ENABLED === "true")
```

- **MFA opt-in per identity, bukan mandatory tenant-wide** — bahkan
  dengan gate aktif, identity yang belum pernah enroll tetap login
  normal (`login.ts` mengecek `findActiveMfaFactor` per identity SETELAH
  password valid, bukan hanya gate env). Jangan asumsikan mengaktifkan
  `AUTH_MFA_ENABLED=true` otomatis mewajibkan MFA untuk semua user.
- **Login yang dijeda, bukan ditolak**: password valid + factor `active`
  → `login.ts` TIDAK membuat session, malah insert row
  `awcms_mfa_challenges` dan balas `401 MFA_REQUIRED` berisi
  `error.details.mfaChallengeToken` (bentuk `details` di sini SENGAJA
  bukan `ErrorDetail[]` seperti endpoint lain — lihat OpenAPI schema
  `LoginMfaRequiredResponse` — karena payload asli (token) harus
  dikembalikan, bukan sekadar array pesan validasi).
  `POST /auth/mfa/totp/verify` adalah **satu-satunya endpoint MFA yang
  TIDAK butuh session** — diautentikasi lewat possession token
  challenge, pola sama seperti `password/reset` diautentikasi lewat
  possession token reset. Kode/recovery code valid → session dibuat
  identik dengan `login.ts` (token, cookie, response shape sama), supaya
  client tidak perlu logic berbeda untuk step kedua.
- **Enkripsi-at-rest, bukan hash, untuk TOTP secret** —
  `src/lib/auth/mfa-secret-crypto.ts` (AES-256-GCM,
  `AUTH_MFA_SECRET_ENCRYPTION_KEY`, base64 32-byte, divalidasi
  `checkMfaConfig`) — satu-satunya secret di aplikasi ini yang
  reversibel, karena verifikasi TOTP butuh menghitung ulang kode dari
  secret asli setiap request, tidak seperti password/token yang cukup
  dibandingkan hash-nya. Recovery code (`mfa-recovery-code.ts`) dan
  challenge token (`mfa-challenge-token.ts`) tetap hash-only (sha256,
  pola sama `session-token.ts`/`password-reset-token.ts`) — TIDAK
  reversibel, karena keduanya tidak pernah perlu ditampilkan ulang
  setelah reveal sekali di awal.
- **Replay prevention, dan WAJIB atomik, bukan read-then-write** —
  `awcms_identity_mfa_factors.last_used_step` menyimpan step
  time-counter TOTP tertinggi yang pernah diterima; verifikasi hanya
  diterima kalau step yang cocok STRICTLY LEBIH BESAR dari nilai ini
  (`src/lib/auth/totp.ts`'s `verifyTotpCode`, default ±1 step window).
  **PR #597 security review menemukan `verifyMfaChallenge` awalnya
  melakukan SELECT lalu UPDATE terpisah** (untuk `last_used_step`,
  `awcms_identity_mfa_recovery_codes.used_at`, DAN
  `awcms_mfa_challenges.failed_attempts`) — di bawah READ COMMITTED
  (default Postgres, `withTenant` tidak mengubah isolation level), request
  verifikasi konkuren semuanya membaca state lama sebelum salah satu
  commit, sehingga replay guard maupun batas `failed_attempts` bisa
  dilewati sepenuhnya oleh penyerang yang mengirim tebakan paralel.
  Diperbaiki dengan: (a) `SELECT ... FOR UPDATE` pada baris challenge di
  awal `verifyMfaChallenge` (mengunci baris itu untuk sisa transaksi,
  men-serialize semua request verifikasi terhadap challenge yang sama),
  (b) compare-and-swap untuk `last_used_step`
  (`UPDATE ... WHERE last_used_step < $step RETURNING id`, 0 baris = gagal
  — melindungi replay lintas-challenge yang FOR UPDATE saja tidak
  jangkau, mis. dua login attempt berbeda membuat dua challenge terpisah
  untuk identity yang sama), (c) compare-and-swap yang sama untuk
  recovery code (`UPDATE ... WHERE used_at IS NULL RETURNING id`). Fitur
  online lain yang menambah state single-use/counter yang bisa
  diverifikasi berkali-kali (kode OTP lain, dsb.) WAJIB pola atomik yang
  sama — jangan pernah SELECT untuk mengevaluasi kondisi lalu UPDATE
  terpisah untuk menandainya terpakai/gagal; regression test-nya:
  `mfa-flow.integration.test.ts` §"concurrent verification attempts..."
  dan §"concurrent wrong-code attempts...".
- **Reset password BUKAN bypass MFA** — `completePasswordReset` tidak
  menyentuh tabel `awcms_identity_mfa_factors` sama sekali;
  diverifikasi test integrasi eksplisit (`mfa-flow.integration.test.ts`
  §"password reset does not disable MFA").
- **Re-enroll ditolak selagi factor aktif** (`409 MFA_ALREADY_ACTIVE`,
  `POST /auth/mfa/totp/enroll/start`) — sesi yang di-hijack tidak bisa
  diam-diam mengganti secret TOTP tanpa lebih dulu `disable`.
- **Disable & regenerate recovery code = high-risk, diaudit**
  (`mfa_disabled`/`mfa_recovery_codes_regenerated`,
  severity `warning`) — pola sama `awcms-audit-log`. **Catatan
  desain yang belum ditutup** (PR #597 review, tidak blocking): kedua
  endpoint ini hanya mensyaratkan sesi valid, tanpa re-autentikasi
  tambahan (password saat ini/kode TOTP saat ini) — sesi yang dibajak
  (bukan hanya dicuri sebelum MFA aktif) cukup untuk mematikan MFA korban
  atau membuang recovery code lama. Diterima sebagai trade-off untuk
  scope issue #589 saat ini; fitur online lanjutan (mis. #592 admin
  policy UI) yang menyentuh area ini sebaiknya mempertimbangkan
  step-up re-auth di titik ini.
- Error code i18n: `error.mfa_required`/`_disabled`/`_already_active`/
  `_not_active`/`_enrollment_not_found`/`_invalid_code`/
  `_challenge_invalid`/`_misconfigured` (`error-messages.ts`,
  `i18n/en.po`+`id.po`).

### Google OIDC login (Issue #590, `src/modules/identity-access/application/google-oidc.ts`)

Gate gabungan sama persis polanya dengan Turnstile/MFA:

```txt
isGoogleLoginRequired(env)
  = isFullOnlineSecurityActive(env) AND isGoogleLoginEnabled(env)
  (isGoogleLoginEnabled = AUTH_GOOGLE_LOGIN_ENABLED === "true")
```

- **Tenant id lewat `state`, bukan header** — `GET .../callback` adalah
  redirect target Google (navigasi browser murni), yang TIDAK BISA
  membawa header `X-AWCMS-Tenant-ID` seperti endpoint lain. `state`
  yang dikirim ke Google berbentuk `${tenantId}.${rawToken}`
  (`src/lib/auth/oauth-state-token.ts`'s `buildOAuthStateParam`/
  `parseOAuthStateParam`) — tenant id BUKAN secret, jadi aman muncul di
  URL; bagian token (pertahanan CSRF/replay sesungguhnya, ≥32 byte
  random) tetap di-hash at rest seperti `state`/session/reset/challenge
  token lain di aplikasi ini. Fitur online lain yang butuh redirect ke
  provider eksternal (mis. #591 generic SSO) WAJIB pola yang sama untuk
  membawa tenant id — jangan asumsikan header selalu tersedia di
  endpoint redirect-target.
- **Dua flow berbeda dari satu orkestrator**: `GET .../start`
  (unauthenticated, dari tombol "Continue with Google" di `/login`)
  selalu `purpose='login'`. `POST .../link` (BUTUH session — identity
  diambil server-side dari session yang sedang login, TIDAK PERNAH
  dipercaya dari request callback) mengembalikan `authorizationUrl`
  sebagai JSON (bukan redirect 302), karena dipanggil lewat `fetch()`
  dari konteks yang sudah authenticated — client men-`window.location`
  sendiri. `GET .../callback` (satu-satunya redirect target Google)
  menangani KEDUA purpose lewat satu orkestrator
  `completeGoogleOAuthCallback` (application layer) berdasarkan kolom
  `purpose`/`identity_id` di baris `awcms_oidc_auth_requests` yang
  tersimpan saat start/link — BUKAN dua implementasi terpisah yang bisa
  divergen soal keamanan.
- **Verifikasi ID token kriptografis PENUH, bukan sekadar decode JSON**
  (issue's security note: "Do not trust query parameters alone; validate
  ID token cryptographically") — signature RS256 lewat WebCrypto
  `crypto.subtle` (`src/lib/auth/jwt-verify.ts`, TIDAK ada library JWT
  eksternal), lalu issuer/audience/expiry/nonce
  (`google-oidc-policy.ts`'s `validateIdTokenClaims`, pure/testable).
  Setiap kegagalan collapse ke `GOOGLE_ID_TOKEN_INVALID` generik
  (anti-enumeration, pola sama `MFA_CHALLENGE_INVALID`) — JANGAN
  bocorkan alasan spesifik (issuer salah vs audience salah vs signature
  invalid) ke response.
- **Provider account ditautkan via `sub`, TIDAK PERNAH via email**
  (issue's security note: "Use `sub` as the stable provider key") —
  `awcms_identity_provider_accounts`, unique per
  (tenant, provider, subject) DAN per (tenant, identity, provider).
  Auto-link by email HANYA aktif bila `email_verified=true` DAN domain
  email ada di `AUTH_GOOGLE_ALLOWED_DOMAINS` (`isEmailDomainAllowed` —
  **fail-closed**: list kosong/tidak di-set = auto-link SELALU ditolak,
  bukan "izinkan semua domain"). Kalau tidak ada provider account yang
  cocok dan auto-link tidak berlaku → `401 GOOGLE_ACCOUNT_NOT_LINKED`,
  TIDAK PERNAH provisioning identity baru (self-service registration via
  Google eksplisit out-of-scope issue ini).
- **Google login TIDAK PERNAH bypass MFA** (issue's acceptance
  criterion: "If #589 is implemented and MFA is required, Google login
  still proceeds through MFA challenge before session creation") —
  `completeGoogleOAuthCallback` memanggil `findActiveMfaFactor`/
  `createMfaChallenge` yang SAMA persis dengan `login.ts` (bukan jalur
  MFA terpisah yang bisa lupa di-wire). Endpoint `callback.ts`
  mengembalikan `401 MFA_REQUIRED` dengan `mfaChallengeToken` yang sama
  bentuknya seperti dari `login.ts` — client menyelesaikan lewat
  `POST /auth/mfa/totp/verify` yang sudah ada, tidak perlu endpoint MFA
  baru untuk provider OIDC lain.
- **Circuit breaker HANYA trip pada kegagalan transport genuine** —
  pelajaran langsung dari bug Turnstile (PR #596 security review, lihat
  §Cloudflare Turnstile di atas): token exchange yang menjawab `400
invalid_grant` untuk `code` yang salah/bekas/kedaluwarsa adalah Google
  BENAR menolak input attacker-controlled, bukan tanda Google unhealthy
  — `google-oauth-client.ts`'s `exchangeAuthorizationCode` HANYA
  `recordFailure` pada 5xx/network error/timeout, tidak pernah pada
  respons 4xx yang valid. JWKS di-cache 1 jam (`fetchGoogleJwks`) —
  jangan fetch JWKS setiap request.
- **JANGAN pernah INSERT/UPDATE dengan `tenantId` yang belum divalidasi
  SEBELUM `SELECT` yang aman** — security review PR #598 menemukan
  `GET .../start` awalnya langsung `INSERT INTO
awcms_oidc_auth_requests` dengan `tenantId` dari query param
  tak terautentikasi TANPA mengecek tenant itu benar-benar ada lebih
  dulu. `tenant_id` punya FK ke `awcms_tenants` — tenant palsu
  memicu foreign-key violation, dan exception itu ditangkap
  `withTenant`'s catch-all lalu di-record ke
  **`getDatabaseCircuitBreaker()`, breaker tunggal APLIKASI-LEBAR**
  (beda dari breaker per-provider seperti punya Turnstile/Google
  sendiri — breaker ini dipakai SEMUA endpoint, SEMUA tenant). Lima
  request dengan `tenantId` acak dari penyerang tak terautentikasi bisa
  membuka breaker ini dan menjatuhkan SELURUH aplikasi 30 detik,
  diulang tanpa henti — blast radius lebih besar dari bug Turnstile
  PR #596. Diperbaiki dengan `SELECT status FROM awcms_tenants
WHERE id = tenantId` (aman, tidak pernah throw untuk baris kosong)
  SEBELUM memanggil `createOAuthRequest`, plus rate limiting
  (`checkRateLimit`, pola sama `login.ts`) sebagai lapis kedua. Fitur
  online lain (mis. #591 generic SSO) yang punya endpoint tak
  terautentikasi dengan INSERT/UPDATE ber-FK ke tabel tenant-scoped
  WAJIB pola yang sama — cek keberadaan/status via SELECT dulu, jangan
  pernah biarkan sebuah write yang bisa gagal FK constraint jadi baris
  pertama yang menyentuh DB untuk input tak terautentikasi.
  Regression test: `google-oidc-flow.integration.test.ts` §"start
  rejects a nonexistent tenant WITHOUT tripping the shared database
  circuit breaker".
- `POST .../link`/`.../unlink`: high-risk, diaudit
  (`google_account_linked`/`google_account_unlinked`); `callback.ts`
  login sukses diaudit `google_login_succeeded`.
- Error code i18n: `error.google_login_disabled`/
  `_oauth_state_invalid`/`_token_exchange_failed`/`_id_token_invalid`/
  `_account_not_linked`/`_already_linked`/`_not_linked`/`_misconfigured`
  (`error-messages.ts`, `i18n/en.po`+`id.po`).

### Generic tenant OIDC SSO provider (Issue #591, `src/modules/identity-access/application/tenant-sso.ts`)

Generalizes #590's Google-specific login into a tenant-CONFIGURED
provider model, WITHOUT touching Google's own code/tables — a deliberate
PARALLEL implementation, not a refactor of `google-oidc.ts`:

- **Reuses `awcms_oidc_auth_requests`/`awcms_identity_provider_accounts`
  (migration 035) as-is** — both were already generic (`provider text`,
  no CHECK constraining it to `'google'`) specifically so this issue
  wouldn't need a schema change to them. Generic SSO stores
  `provider = <providerKey>` in the exact same rows Google's own flow
  stores `provider = 'google'` in. New tables (migration 036) are only
  `awcms_auth_providers` (tenant-configured provider config: `provider_key`,
  `issuer_url`, `client_id`, client secret — encrypted at rest
  (`AUTH_SSO_CREDENTIAL_ENCRYPTION_KEY`, AES-256-GCM, SEPARATE key from
  MFA's own `AUTH_MFA_SECRET_ENCRYPTION_KEY`) OR an env-var-name
  reference, exactly one via CHECK constraint, NEVER returned plaintext
  by any endpoint; `scopes`, `allowed_email_domains` jsonb, `enabled`,
  soft delete) and `awcms_tenant_auth_policies` (one row per
  tenant: `password_login_enabled`, `sso_enabled`, `sso_required`,
  `auto_link_verified_email`, `allowed_email_domains` jsonb,
  `break_glass_identity_ids` jsonb, `mfa_required` reserved for future
  #589 compatibility, not yet enforced). Both RLS `ENABLE`+`FORCE`.
- Gate gabungan `isSsoRequired(env)` (`src/lib/auth/sso-config.ts`) =
  `isFullOnlineSecurityActive(env)` (#587) ∧ `AUTH_SSO_ENABLED=true` —
  same shape as every other feature's gate in this epic.
- **OIDC discovery is unavoidable here** (unlike Google's hardcoded
  endpoint constants) — `discoverOidcConfiguration`/`fetchProviderJwks`
  (`src/lib/auth/generic-oidc-client.ts`) fetch
  `.well-known/openid-configuration` + JWKS from each provider's own
  `issuer_url`, cached 1h, bounded by `AUTH_SSO_DISCOVERY_TIMEOUT_MS`
  (issue's own acceptance criterion: "OIDC discovery and JWKS fetches
  have bounded timeout"). Circuit breakers are keyed PER PROVIDER
  (`sso-oidc-discovery:<providerKey>`/`sso-oidc-jwks:<providerKey>`/
  `sso-oidc-token:<providerKey>`) — a slow/unhealthy provider on one
  tenant must never affect another tenant's or provider's login. Same
  PR #596/#598 rule applied from day one: only a genuine transport
  failure (5xx/network/timeout) trips the breaker, never a well-formed
  4xx (bad/reused/expired `code`) — the provider correctly rejecting
  attacker-controlled input is a healthy-provider signal.
- **Endpoints mirror Google's own shape exactly**: `GET
/auth/sso/{providerKey}/start` (unauthenticated, tenant resolved from
  header/cookie/`?tenantId=`, tenant existence/status `SELECT`ed BEFORE
  any INSERT into the reused `awcms_oidc_auth_requests` — applying
  PR #598's fix from the very first version of this endpoint, not as an
  afterthought), `GET .../callback` (re-checks `provider.enabled` again
  at callback time — an admin may have disabled the provider between
  `start` and the user completing the flow at the external provider),
  `POST .../link`/`.../unlink` (identical session/audit shape to
  Google's).
- **Admin CRUD is IN SCOPE for #591** (unlike #590 which had none) —
  `identity_access.sso_providers.{read,create,update,delete}` and
  `identity_access.sso_policy.{read,update}` (migration 037 permission
  seed) protect `/api/v1/identity/sso/providers`(`/{id}`) and
  `/api/v1/identity/sso/policy`. Deliberately NOT gated by
  `isSsoRequired()` — an admin may configure a provider ahead of
  flipping the deployment-level gate on, same allowance
  `checkGoogleOidcConfig`/`checkTurnstileConfig` already grant for their
  own credentials; no network/provider call happens in the CRUD path
  itself. Admin UI pages for this API are Issue #592, not this issue —
  "minimal UI... unless needed for verification" in the issue's own
  scope note was read as "API only", since the API itself IS the
  verification surface (curl/fetch), full UI is explicitly tracked
  separately.
- **Break-glass enforcement is at POLICY-SAVE time, not just login
  time** (issue's own acceptance criterion) — `saveTenantAuthPolicy`
  (`tenant-auth-policy.ts`) re-reads `break_glass_identity_ids` from the
  request against a FRESH DB query (`countEligibleBreakGlassIdentities`)
  confirming each id is a currently `active` identity with an `active`
  `awcms_tenant_users` membership — a request that would leave
  `sso_required=true` or `password_login_enabled=false` with zero
  eligible break-glass identities is rejected `409
BREAK_GLASS_REQUIRED` and never persisted. `login.ts` itself only
  enforces `password_login_enabled=false` when `isSsoRequired(env)` is
  ALSO active (`isPasswordLoginDisabledForIdentity`) — every
  local/offline/LAN deployment that never flips the #591 gate on runs
  zero extra queries and has zero behavior change, exactly like every
  other feature in this epic.
- **Auto-link by email, two independent fail-closed layers** (domain:
  `tenant-sso-policy.ts`'s `isAutoLinkAllowedForProvider`): the
  PROVIDER's own `allowed_email_domains` (mirrors
  `AUTH_GOOGLE_ALLOWED_DOMAINS`, per-tenant-per-provider instead of a
  deployment env var) AND the tenant POLICY's `auto_link_verified_email`
  master switch, which must be explicitly `true` — unlike Google (whose
  auto-link only needed the domain allow-list to be non-empty), generic
  SSO requires the tenant to opt in twice: enable the provider's own
  domain list AND flip the policy's master switch.
- `google-oidc-policy.ts`'s `evaluateOAuthRequest`/`validateIdTokenClaims`
  are reused VERBATIM here (imported directly, not copied) — both were
  already pure and provider-agnostic. `oauth-state-token.ts`'s
  `buildOAuthStateParam`/`parseOAuthStateParam`/`generateOAuthState`/
  `hashOAuthState`/`generateOidcNonce` are reused the same way. What is
  NOT reused: `google-oidc.ts`'s own `createOAuthRequest`/
  `consumeOAuthRequest`/`findIdentityByProviderSubject`/
  `linkProviderAccount`/`unlinkProviderAccount` all hardcode
  `provider = 'google'` in their SQL — `tenant-sso.ts` has its own small
  parameterized duplicates of these instead of refactoring Google's
  (keeps the already-tested Google flow untouched).
- Error code i18n: `error.sso_disabled`/`_provider_not_found`/
  `_provider_disabled`/`_provider_unavailable`/`_oauth_state_invalid`/
  `_token_exchange_failed`/`_id_token_invalid`/`_account_not_linked`/
  `_already_linked`/`_not_linked`/`_misconfigured`/
  `_provider_key_conflict`, plus `break_glass_required`/
  `password_login_disabled` (`error-messages.ts`, `i18n/en.po`+`id.po`).

### Admin policy UI (Issue #592)

`src/pages/admin/security.astro` + `src/lib/auth/auth-security-status.ts`
(pure env-only status aggregator, no DB/network I/O). Consumes #591's
existing admin CRUD API as-is — **no new API endpoint was added for this
issue**, and none was needed:

- SSR reads `getTenantAuthPolicy`/`listAuthProviders` (#591's own
  application-layer functions) directly inside the page's own
  `withTenant` transaction, same "call the application layer directly
  instead of round-tripping through this app's own HTTP API" convention
  `admin/settings.astro`/`admin/blog/settings.astro` already use.
  Mutations (policy save, provider create/update/delete) go through the
  REAL `PATCH /api/v1/identity/sso/policy` /
  `POST|PATCH|DELETE /api/v1/identity/sso/providers[/{id}]` endpoints via
  `sendJson`/`postJson` (`src/lib/ui/admin-form-client.ts`) — every mutation still runs
  through those endpoints' own ABAC + break-glass + audit logic; this
  page never writes to the database directly.
- **Two independent gates control what renders** (issue's own acceptance
  criteria): (1) the deployment gate `isFullOnlineSecurityActive(env)`
  (#587) — inactive on every local/offline/LAN deployment (the default),
  the page renders ONLY an informational hand-rolled `<p class="state-notice"
role="status">` notice (same inline pattern `offices.astro`/`roles.astro`
  use for their denied/error states) and nothing else, checked server-side
  in the page's own frontmatter BEFORE any of the status/policy/provider
  markup is generated — never just hidden with CSS; (2) ABAC
  (`identity_access.sso_policy.*`/`sso_providers.*`, migration 037, already
  seeded by #591) — gate active but neither permission held renders an
  access-denied `<p class="state-notice">` instead. Each section (policy
  form, provider table) additionally checks
  its OWN specific permission independently, same per-fieldset-permission
  convention `admin/access-users.astro` established.
- **Status summary never re-derives each feature's own gate** —
  `resolveAuthSecurityStatusSummary(env)` imports `isTurnstileEnabled`/
  `isMfaEnabled`/`isGoogleLoginEnabled`/`isSsoEnabled` plus each feature's
  own `*_REQUIRED_WHEN_ENABLED` env var name list
  (`TURNSTILE_REQUIRED_WHEN_ENABLED`, `AUTH_MFA_REQUIRED_WHEN_ENABLED`,
  `GOOGLE_OIDC_REQUIRED_WHEN_ENABLED`, `SSO_REQUIRED_WHEN_ENABLED`)
  directly from those features' own config modules rather than
  re-listing var names here — `configured: boolean` only ever reflects
  whether the required var(s) are PRESENT, never a value (issue's own
  security note: "Avoid leaking whether a provider credential exists
  beyond safe status flags such as `configured: true`").
- **Break-glass UX does not re-implement the eligibility check** — the
  form always shows the requirement inline next to `sso_required`/
  "disable password login", blocks an obviously-doomed submit
  client-side (zero break-glass identities selected at all) as a fast UX
  nicety, and always surfaces the server's authoritative
  `409 BREAK_GLASS_REQUIRED` rejection through the same translated
  error-message banner (`error.break_glass_required`, already in
  `error-messages.ts` since #591) every other mutation on the page uses.
  The break-glass identity picker itself needs `identity_access.user_management.read`
  (reused from `admin/access-users.astro`'s own guard) to render a
  checkbox list of tenant users; without it, the page falls back to a
  plain comma-separated-UUID text input so the form stays usable under
  least privilege rather than disappearing entirely.
- **Client secret fields are write-only** — never pre-filled or
  round-tripped from the API on the provider edit form, matching #591's
  own `AuthProviderView` never exposing `client_secret_ciphertext`.
- `identity_access`'s module descriptor (`module.ts`) now declares a
  `navigation` entry (`/admin/security`, `requiredPermission:
"identity_access.sso_policy.read"`) — the existing module-navigation
  registry (#518) renders it in the admin sidebar automatically; no
  `AdminLayout.astro` hardcoding needed, same pattern
  `tenant_domain`/`module_management`'s own descriptors already use.
- Playwright E2E specs (`tests/e2e/admin-security-disabled.e2e.ts`/
  `admin-security-enabled.e2e.ts`) log in through the REAL `/login` form
  (fill + submit + wait for the `/admin` redirect), not
  `page.request.post("/api/v1/auth/login")` — empirically, in this
  environment, a SUCCESSFUL login's `Set-Cookie` response headers going
  through Playwright's `page.request` API (as opposed to a real
  navigation/form submit) intermittently broke every subsequent
  `page.request`/`page.goto` call with an unrelated-looking `TypeError:
"<path>" cannot be parsed as a URL.` — reproduces even with a fully
  qualified absolute URL string, only after a 200 response carrying
  `Set-Cookie`; a failed login attempt (401/403, no cookie) never
  reproduces it. Root cause not fully isolated (did not reproduce from
  `Bun.spawn`, `Bun.SQL`, or `Bun.password.hash` in isolation, only their
  combination through a specific call path) — logged here so a future
  issue that needs `page.request` for an authenticated flow in this repo
  doesn't have to re-discover it from scratch; driving the real login
  form sidesteps the whole class of that bug and is arguably the more
  faithful "browser E2E" exercise anyway. Both specs seed an isolated
  owner/tenant fixture directly via SQL (`tests/e2e/helpers/seed-owner-tenant.ts`,
  run in a SEPARATE `bun` subprocess via `seed-owner-tenant-cli.ts` —
  keeping the argon2/Postgres work out of the same process that drives
  Playwright regardless of the exact trigger above) rather than
  `POST /api/v1/setup/initialize`, which is a once-only singleton-locked
  endpoint (`awcms_setup_state`) almost always already claimed on
  any long-lived dev database.

## Aturan lintas-issue yang wajib diikuti (#588-#593)

1. **Setiap fitur (#588-#592) WAJIB memanggil `isFullOnlineSecurityActive(env)`
   sebelum melakukan apa pun online/provider-terkait** — jangan cek
   `AUTH_ONLINE_SECURITY_ENABLED`/`_PROFILE` langsung atau bikin gate
   sendiri. Tidak aktifnya gate ini harus berarti: tidak ada panggilan
   Cloudflare/Google/OIDC apa pun, tidak ada MFA challenge, form login
   tetap seperti hari ini persis.
2. **`AUTH_ONLINE_SECURITY_ENABLED=false`/unset tidak boleh pernah
   mewajibkan credential provider apa pun** — `.env.example` default dan
   setiap deployment offline/LAN yang tidak pernah menyentuh var
   `AUTH_ONLINE_SECURITY_*`/`AUTH_SSO_*`/`AUTH_MFA_*`/`AUTH_GOOGLE_*`/
   `TURNSTILE_*` harus tetap `config:validate` PASS dan berperilaku
   identik dengan sebelum epic ini ada.
3. **`APP_ENV=production` BUKAN setara dengan full-online** — deployment
   offline/LAN bisa production-grade secara operasional (lihat
   `deployment-profiles.md`) tanpa pernah mengaktifkan gate ini. Jangan
   pernah menjadikan `APP_ENV=production` sebagai proxy untuk
   `isFullOnlineSecurityActive`.
4. **Login password lokal tidak pernah dihapus/dinonaktifkan secara
   default** oleh fitur mana pun di epic ini — `sso_required`/
   `password_login_enabled=false` (#591, `awcms_tenant_auth_policies`)
   hanya boleh aktif kalau ada break-glass local owner/account valid,
   dicek server-side (`saveTenantAuthPolicy`) sebelum kebijakan itu bisa
   disimpan — sudah diimplementasikan konkret, lihat §Generic tenant
   OIDC SSO provider di atas.
5. **Kredensial provider (Google client secret, OIDC client secret,
   Turnstile secret key, TOTP seed, recovery code) tidak pernah
   disimpan plaintext** — dari environment variable/secret manager, atau
   dienkripsi at-rest dengan key dari environment (`AUTH_SSO_CREDENTIAL_ENCRYPTION_KEY`/
   `AUTH_MFA_SECRET_ENCRYPTION_KEY`, dsb.) — tidak pernah muncul di
   response API, log, atau audit attributes (`awcms-sensitive-data`).
6. **Link/unlink provider account, perubahan kebijakan auth, enroll/disable
   MFA, dan regenerate recovery code semuanya high-risk actions** — wajib
   diaudit (`awcms-audit-log`) dan idempotent kalau mutation
   (`awcms-idempotency`).
7. **Provider identifier stabil adalah `sub` (subject OIDC), bukan
   email** — auto-link by email wajib mensyaratkan email terverifikasi +
   kebijakan allowed-domain eksplisit, tidak pernah linking implisit
   murni dari kecocokan string email. Sudah diimplementasikan konkret di
   #590 (`isEmailDomainAllowed`, fail-closed) DAN #591 (generic tenant
   OIDC SSO, `isAutoLinkAllowedForProvider` — dua lapis: domain allow-list
   PER PROVIDER ditambah master switch `auto_link_verified_email` per
   tenant policy).
8. **Semua panggilan provider eksternal (OIDC discovery/JWKS, Turnstile
   siteverify, Google token exchange) wajib timeout-bounded DAN circuit
   breaker-nya hanya boleh trip pada kegagalan transport genuine** — pola
   sama seperti `cloudflare-dns-adapter.ts`/`mailketing-provider.ts`/
   `turnstile.ts`/`google-oauth-client.ts` (`withTimeout`, circuit
   breaker `getProviderCircuitBreaker`), dan tidak pernah dipanggil di
   dalam DB transaction (ADR-0006). JANGAN treat respons 4xx yang valid
   (input attacker-controlled ditolak provider dengan benar) sebagai
   provider-failure — pelajaran dari bug Turnstile PR #596, diulang
   benar di #590's `exchangeAuthorizationCode`. **Aturan yang sama
   berlaku untuk breaker DATABASE bawaan** (`getDatabaseCircuitBreaker()`,
   dipakai `withTenant` untuk SEMUA endpoint/tenant, bukan sekadar satu
   provider) — endpoint tak terautentikasi TIDAK BOLEH melakukan
   INSERT/UPDATE ber-FK ke tabel tenant-scoped dengan `tenantId` yang
   belum divalidasi keberadaannya; exception (mis. foreign-key
   violation) dari input attacker-controlled akan ditangkap
   `withTenant`'s catch-all dan mentrip breaker aplikasi-lebar ini —
   blast radius JAUH lebih besar dari breaker per-provider mana pun
   (pelajaran PR #598, lihat §Google OIDC login di atas). Selalu
   `SELECT` (aman, tidak throw untuk baris kosong) sebelum write
   ber-FK di endpoint yang bisa dijangkau tanpa autentikasi.
9. **Tabel baru yang tenant-scoped (`awcms_identity_provider_accounts`,
   `awcms_oidc_auth_requests` — #590; `awcms_auth_providers`,
   `awcms_tenant_auth_policies` — #591; `awcms_identity_mfa_factors`
   dkk. — #589) wajib RLS `ENABLE` + `FORCE`** — pola sama seperti setiap
   migration sejak 013 (`awcms-new-migration`).
10. **MFA reset password tidak boleh jadi bypass MFA** — reset password
    yang berhasil tidak otomatis menonaktifkan MFA milik identity itu.

## Epic #587-#593 selesai

**Epic #587-#593 sekarang 100% selesai** (ditutup 2026-07-10) — gate
bersama (#587), Cloudflare Turnstile (#588), MFA/TOTP (#589), Google OIDC
login (#590), generic tenant OIDC SSO provider (#591, termasuk admin CRUD
API-nya), admin policy UI (#592, `/admin/security`), DAN dokumentasi/
kontrak/readiness penutup epic (#593) semuanya sudah ada di repo ini —
jangan bangun ulang, jangan re-derive keputusan yang sudah dijelaskan di
atas. `awcms_auth_providers`/`awcms_tenant_auth_policies`
(migration 036), endpoint `/api/v1/auth/sso/*`, admin CRUD API
`/api/v1/identity/sso/providers`/`/api/v1/identity/sso/policy`, DAN
halaman admin `/admin/security` yang mengonsumsinya SUDAH ada.
`/api/v1/auth/providers/google/*` SUDAH ada (#590) — jangan bangun ulang,
dan #591 sengaja TIDAK mengubah/menggantinya (lihat §Generic tenant OIDC
SSO provider di atas).

Issue #593 sendiri menutup loop dokumentasi/kontrak/readiness lintas
#587-#592 (audit, bukan fitur baru) — konfirmasi/perbaikan konkret yang
dihasilkan:

- `docs/awcms/18_configuration_env_reference.md` dan
  `deployment-profiles.md` sebelumnya masih menulis "#592-#593 masih
  backlog" walau #592 (admin policy UI) sudah merge — diperbaiki (stale
  doc, ditemukan oleh audit #593 ini, bukan hipotetis).
- `docs/awcms/20_threat_model_security_architecture.md` sebelumnya
  NOL menyebut Turnstile/MFA/Google OIDC/SSO/break-glass sama sekali —
  ditambah §Standar tambahan dipicu epic full-online auth security
  hardening (Issue #587-#593) memetakan tujuh kategori risiko yang
  diminta eksplisit issue ini (credential stuffing, bot abuse, OIDC
  callback abuse, provider outage, MFA recovery abuse, SSO lockout,
  offline dependency breakage) ke bukti konkret yang sudah ada.
- `scripts/security-readiness.ts` menambah `checkSsoBreakGlassReady`
  (critical) — celah residual yang sudah dicatat di atas (§Generic
  tenant OIDC SSO provider): `saveTenantAuthPolicy` hanya memvalidasi
  break-glass eligibility di titik SAVE; sebuah break-glass identity bisa
  dinonaktifkan (atau tenant membership-nya dicabut) OLEH AKSI LAIN
  setelahnya tanpa kebijakan itu sendiri pernah disimpan ulang. Check baru
  ini mem-verifikasi ULANG eligibility setiap tenant aktif dari DB di
  waktu readiness/go-live, memakai ulang `countEligibleBreakGlassIdentities`
  (kini diekspor dari `tenant-auth-policy.ts`) — bukan aturan kedua yang
  bisa divergen. Berbeda dari Issue #605 (break-glass picker/data-hygiene
  UX di admin form) yang tetap dibiarkan terbuka sebagai issue terpisah —
  check readiness ini mengaudit DB, bukan UX form.
- `.env.example`, `scripts/validate-env.ts`, OpenAPI
  (`openapi/awcms-public-api.openapi.yaml`), dan
  `src/modules/identity-access/README.md` sudah akurat sejak #587-#591
  masing-masing — dikonfirmasi ulang oleh #593, tidak diubah.

Issue #601 (SQLSTATE class 22 circuit-breaker exclusion), #605 (break-glass
picker/data-hygiene UX admin), #603 (SSRF hardening untuk `issuer_url`
OIDC tenant-configured), dan #610 (hardening tambahan atas keputusan
#603 — rate limit agregat per-`providerKey` + negative-TTL cache) sudah
**selesai** sebagai follow-up terpisah setelah #593 (lihat §Break-glass
picker/data-hygiene di bawah untuk #605, dan §SSRF/`issuer_url` —
keputusan accepted risk untuk #603, termasuk hardening #610 di
sub-bagian yang sama).

### SSRF/`issuer_url` — keputusan accepted risk (Issue #603, selesai)

**Diputuskan TIDAK menambah IP-range denylist** (resolve hostname, tolak
private/loopback/link-local/metadata-endpoint) untuk `issuer_url` OIDC
tenant-configured (#591). Ini SATU-SATUNYA outbound URL di base ini yang
berasal dari data tenant-configured, bukan env server tepercaya (beda dari
setiap provider lain — R2, Mailketing, Cloudflare DNS/Turnstile — yang
semuanya SSRF-safe by convention: URL selalu dari `process.env`).

**Kenapa TIDAK diblok — dikoreksi setelah audit keamanan PR #609** (versi
awal keputusan ini salah menyebut LAN-first/offline sebagai alasan;
faktanya fitur generic SSO ini HANYA aktif di profil `full_online`
(`isFullOnlineSecurityActive`) — KEBALIKAN dari LAN-first/offline, yang
tidak pernah memuat kode ini sama sekali karena gate-nya tidak aktif).
Alasan yang benar: deployment `full_online` (cloud/registry) tetap sering
perlu terhubung ke IdP enterprise milik tenant yang di-host on-prem dan
hanya reachable lewat VPN/tunnel privat — pola "bring-your-own-IdP" yang
umum di produk SaaS multi-tenant (WorkOS, Auth0 Enterprise Connections,
dst. — BUKAN Okta/Auth0/Azure AD sendiri sebagai IdP, yang bukan analogi
yang tepat karena AWCMS di sini berperan sebagai relying party yang
memanggil issuer pihak ketiga, bukan sebagai IdP). Blanket private-IP
block akan mematahkan skenario enterprise-IdP-via-VPN ini.

**Batas mitigasi yang sebenarnya (dikoreksi)** — PENTING, jangan anggap
sudah menutup risiko eksploitasi: gate ABAC
(`identity_access.sso_providers.create`/`update`) dan audit log HANYA
membatasi siapa yang bisa MENGONFIGURASI `issuer_url` jahat. Keduanya
TIDAK membatasi siapa yang bisa MEMICU fetch keluar setelah provider
dikonfigurasi — `GET /api/v1/auth/sso/{providerKey}/start` yang memicu
`discoverOidcConfiguration` bersifat tanpa autentikasi, hanya rate-limit
per-sumber+tenant (bukan per-`providerKey`), dan discovery cache hanya
terisi pada request SUKSES — target internal yang tak pernah membalas
JSON OIDC valid tak pernah ter-cache, sehingga endpoint publik ini bisa
dipakai probe berulang tanpa batas nyata. Ini risiko residual yang
diterima BERSAMA keputusan utama, bukan celah yang sudah tertutup oleh
ABAC — segmentasi jaringan level operator untuk service internal yang
sungguh sensitif tetap jadi lapis pertahanan yang sebenarnya, bukan ABAC.

**Follow-up — selesai (Issue #610)**, revisi setelah DUA putaran security
review:

- **Fix Critical, sebenarnya bug pre-existing sejak #591**: SEMUA
  cache/circuit-breaker di `generic-oidc-client.ts`
  (`discoveryCache`/`jwksCache`, breaker discovery/jwks/token) sebelumnya
  di-key HANYA oleh `providerKey`. `provider_key` cuma unik PER TENANT
  (unique index migration 036 adalah `(tenant_id, provider_key)`), jadi
  dua tenant berbeda yang sama-sama menamai provider mereka `"okta"`
  (sangat umum) BERBAGI entry cache/breaker yang sama — tenant admin jahat
  bisa mendaftarkan provider dengan slug vendor umum yang `issuer_url`-nya
  menunjuk server attacker, memicu satu fetch, dan `authorization_endpoint`/
  `jwks_uri` attacker itu ter-serve ke tenant LAIN yang punya provider
  `"okta"` sungguhan — bukan sekadar kebocoran ketersediaan, tapi primitif
  pengambilalihan SSO lintas-tenant (redirect ke phishing + ID token palsu
  yang lolos verifikasi JWKS attacker sendiri). Diperbaiki:
  `discoverOidcConfiguration`/`fetchProviderJwks`/`exchangeAuthorizationCode`
  kini menerima `tenantId` dan meng-key semua cache/breaker dengan
  `${tenantId}:${providerKey}` (`scopedProviderKey`). Test:
  `tests/unit/generic-oidc-client.test.ts`'s "CRITICAL: two DIFFERENT
  tenants using the SAME providerKey..." dan
  `tests/integration/tenant-sso-flow.integration.test.ts`'s "CRITICAL: two
  DIFFERENT tenants both naming their provider 'okta'...".
- **Koreksi desain — draft awal PR ini menambah bug baru**: draft awal
  menambah rate limit AGREGAT (bukan per-sumber) di `start.ts`, di-key
  `${tenantId}:${providerKey}`, untuk membatasi prober yang merotasi
  source IP. Putaran security-auditor KEDUA menemukan budget BERSAMA ini
  sendiri adalah vektor DoS tanpa privilege apa pun: siapa pun, dari
  sesedikit 3 source IP, bisa menghabiskan seluruh budget dan mengunci
  SEMUA user sah tenant itu dari login SSO selama jendela rate limit,
  berulang — test yang ditambahkan draft awal untuk membuktikan mekanisme
  ini justru secara tidak sengaja MEMBUKTIKAN DoS tersebut. Rate limit
  agregat ini **dihapus total**. Pertahanan sebenarnya terhadap probing
  berkelanjutan adalah circuit breaker (kini benar-benar di-scope
  tenant+provider) + negative-TTL cache di bawah — keduanya HANYA
  membatasi percobaan yang GAGAL, jadi tidak pernah bisa memblokir login
  sah ke provider yang sehat, beda dari rate limit HTTP-level bersama yang
  memblokir semua request regardless hasil.
- Negative/short-TTL cache (`NEGATIVE_CACHE_TTL_MS = 30s`,
  `discoveryFailureCache`/`jwksFailureCache` di `generic-oidc-client.ts`,
  kini di-key `${tenantId}:${providerKey}`) untuk percobaan discovery/JWKS
  yang GAGAL — target yang tak pernah membalas JSON valid tidak lagi
  memicu fetch baru di setiap hit, hanya sekali per jendela 30 detik.
- Rekomendasi infra-layer blokir egress ke `169.254.169.254` (metadata
  endpoint cloud) khusus deployment `full_online` didokumentasikan di
  `deployment-profiles.md` §Generic tenant OIDC SSO (residual yang tetap
  di luar cakupan aplikasi — tanggung jawab operator, bukan kode).
  **Follow-up — selesai (Issue #612)**: tanpa cap, tenant admin jahat bisa
  mendaftarkan banyak baris `awcms_auth_providers` (masing-masing dapat
  budget cache/breaker independen sendiri-sendiri, sudah benar di-scope sejak
  #610) untuk melipatgandakan volume probing total secara linear dengan
  jumlah baris. Diperbaiki dengan cap `AUTH_SSO_MAX_PROVIDERS_PER_TENANT`
  (default 20) di `createAuthProvider` (`auth-provider-directory.ts`) —
  `POST /api/v1/identity/sso/providers` menolak dengan
  `409 SSO_PROVIDER_LIMIT_EXCEEDED` begitu jumlah baris aktif (non-soft-
  deleted) tenant mencapai batas. Hitung-lalu-insert, BUKAN atomik
  (`SELECT ... FOR UPDATE`) dengan sengaja — ini bound probing budget, bukan
  invariant keamanan seperti replay MFA (§MFA/TOTP di atas), jadi overshoot
  kecil akibat create konkuren tidak berbahaya untuk apa yang mekanisme ini
  cegah.

**Kalau butuh SSRF hardening lebih ketat di masa depan** (mis. operator
`full_online` murni SaaS yang tidak butuh IdP on-prem sama sekali): jangan
blanket-block — tambahkan sebagai opt-in per-deployment (env var terpisah,
default off) supaya skenario enterprise-IdP-via-VPN tidak pernah terkena
regresi diam-diam. Jangan reimplementasi keputusan ini tanpa membaca
rasional di atas dulu.

### Break-glass picker/data-hygiene (Issue #605, selesai)

Follow-up dari security-auditor review PR #604 (#592) — dua celah UX
non-blocking (bukan bypass keamanan; `saveTenantAuthPolicy` selalu tetap
jadi kontrol otoritatif) diperbaiki:

- **Picker checkbox `admin/security.astro` sekarang memfilter kandidat ke
  `tenant_user.status === 'active' && identity.status === 'active'`**
  sebelum dirender — sebelumnya menampilkan SEMUA tenant user (termasuk
  yang suspended/inactive) sebagai pilihan break-glass, sehingga admin
  bisa memilih identity yang jelas akan ditolak server baru diketahui
  setelah submit. `fetchTenantUsersWithRoles` (dipakai bersama
  `admin/access-users.astro`) sendiri TIDAK diubah — filternya di titik
  pemakaian (`security.astro`), bukan di query yang dipakai bersama.
- **`saveTenantAuthPolicy` sekarang memfilter `break_glass_identity_ids`
  yang DIPERSIST ke hanya id yang dikonfirmasi eligible** oleh
  `fetchEligibleBreakGlassIdentityIds` (fungsi baru — `countEligibleBreakGlassIdentities`
  kini wrapper tipis di atasnya, `scripts/security-readiness.ts`'s
  `checkSsoBreakGlassReady` tidak berubah karena signature count-nya
  sama), bukan menyimpan list yang disubmit apa adanya. Sebelumnya,
  submit "1 id valid + N id sampah/salah ketik" (mis. lewat manual
  free-text fallback picker untuk admin tanpa `user_management.read`,
  atau panggilan API langsung) akan menyimpan SEMUA id termasuk yang
  sampah, walau hanya satu yang pernah menentukan hasil save. Regression
  test: `tests/integration/tenant-sso-flow.integration.test.ts`'s
  "break-glass hygiene: saving policy with 1 valid + N garbage/ineligible
  ids persists ONLY the valid one".
