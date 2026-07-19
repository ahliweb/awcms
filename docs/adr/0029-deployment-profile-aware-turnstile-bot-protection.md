# ADR-0029 — Cloudflare Turnstile bot protection yang sadar deployment-profile

- **Status:** Accepted
- **Tanggal:** 2026-07-19
- **Pengambil keputusan:** maintainer
- **Terkait:** Issue #186, epic #177 (kesiapan fondasi ERP turunan); ADR-0027 (MFA/step-up), ADR-0028 (OIDC/SSO) — kompatibel & berurutan sebelumnya di jalur login; ADR-0026 (modular OpenAPI); doc `docs/awcms/turnstile-bot-protection.md`; port dari awcms-mini Issue #587/#588 (diadaptasi & dikeraskan, bukan disalin).

## Konteks

AWCMS mendukung deployment LAN/offline-first sekaligus dapat dijalankan full-online. Login publik dan endpoint setup pada profil full-online butuh mitigasi bot tambahan (bot mengelola argon2id verify mahal, credential-stuffing, dan race terhadap bootstrap tenant), tetapi ketergantungan Cloudflare **tidak boleh** memblokir instalasi LAN, setup lokal, atau alur operasional saat fitur dinonaktifkan.

Turnstile harus menjadi kontrol **berlapis di atas** rate limiting, lockout, audit, dan generic authentication error — bukan pengganti. awcms-mini sudah punya slice Turnstile (Issue #588), tetapi (1) mini hanya memeriksa `success` dari siteverify (tidak memvalidasi `action`/`hostname`/freshness), dan (2) membaca body respons di luar timer timeout (body slow-drip bisa melewati deadline). Jalur login base ini juga **lebih keras** dari mini (dummy argon2id, deny reason kolaps, `TRUSTED_PROXY_ENABLED`, cabang MFA #184 + break-glass OIDC #185) — port naif bisa meregresinya.

## Keputusan

Kami memutuskan **mem-port Turnstile dari mini dan mengeraskannya**, digerbangi profil deployment:

1. **Gerbang profil deployment (`src/lib/auth/online-security-config.ts`).** Berbeda dari MFA (#184) dan OIDC (#185) yang di base ini menjatuhkan konsep profil dan hanya bergantung flag masing-masing, Turnstile adalah kontrol yang menjangkau Cloudflare sehingga **wajib** inert di LAN/offline. `isFullOnlineSecurityActive(env)` true hanya bila `AUTH_ONLINE_SECURITY_ENABLED=true` **dan** `AUTH_ONLINE_SECURITY_PROFILE=full_online`. Ini yang membedakan "disabled intentionally" (flag mati — LAN sah) dari "misconfigured" (flag hidup tapi profil bukan `full_online`) di preflight.
2. **Satu fungsi gerbang: `isTurnstileRequired(env) = isFullOnlineSecurityActive(env) && TURNSTILE_ENABLED==="true"`.** Widget, origin CSP, dan panggilan verifikasi outbound SEMUA digerbangi fungsi ini. Konsekuensi krusial: `TURNSTILE_ENABLED=true` pada profil LAN → **tetap OFF total** (tak ada widget/iframe/CSP origin/outbound call).
3. **Verifikasi server-side via adapter terpisah (`src/lib/security/turnstile.ts`).** `verifyTurnstileToken` memanggil siteverify Cloudflare, memvalidasi `success`, **`action`** (per-endpoint: `login` vs `setup` — satu token tak bisa dipakai lintas action), **`hostname`** (anti hostname-confusion), dan **freshness `challenge_ts`** (anti replay basi). Timeout + response-size cap dijalankan oleh **satu `AbortController`** yang mspan fetch **dan** baca body (menutup celah slow-drip mini). Zero akses DB, tak pernah di dalam transaksi — dipanggil sebelum `withTenant`, sebelum password verify.
4. **Fail-closed generik pada profil yang mewajibkannya.** Token hilang → `TURNSTILE_REQUIRED`. Misconfig (enabled tanpa secret/hostname), provider outage/timeout, malformed, hostname/action mismatch, atau stale → SEMUA kolaps ke satu kode `TURNSTILE_INVALID`. Karena verifikasi berjalan **sebelum** lookup identity apa pun, tidak ada oracle enumerasi akun. Rate limit + lockout tetap bekerja **independen** dari Turnstile.
5. **Circuit breaker bersama (`getProviderCircuitBreaker("turnstile")`).** Hanya kegagalan transport (non-2xx, unparseable, timeout, error jaringan) yang men-trip breaker; `success:false` dan mismatch hostname/action/freshness dihitung sebagai **sukses provider** (outcome yang bisa diulang attacker tak boleh mengunci login lintas-tenant — pelajaran mini PR #596).
6. **Integrasi CSP sempit & hanya saat aktif (`src/lib/security/security-headers.ts`).** Saat `isTurnstileRequired()`, middleware membuka **satu** origin `https://challenges.cloudflare.com` di `script-src` (plus `'self'`) dan `frame-src`. Saat nonaktif, CSP byte-identik dengan sebelum issue ini (tak ada `script-src`/`frame-src`, tak ada origin pihak ketiga). Builder tetap satu-satunya pemilik CSP (ADR jalur reporting: middleware, bukan `astro.config`).
7. **Widget kondisional (`src/pages/login.astro`).** `<div class="cf-turnstile">` + loader `<script is:inline src="…cloudflare…api.js">` dirender HANYA saat `isTurnstileRequired()`. Loader adalah script eksternal eksplisit (bukan modul Astro-bundled yang hanya dari `'self'`). `TURNSTILE_SITE_KEY` publik (Cloudflare menaruhnya di widget); `TURNSTILE_SECRET_KEY` server-side saja, tak pernah sampai halaman.
8. **Endpoint yang di-wire:** `POST /api/v1/auth/login` (action `login`) dan `POST /api/v1/setup/initialize` (action `setup`). Base ini tak punya route password reset/forgot, jadi hanya dua form publik ini yang di-wire. Field request opsional `turnstileToken` didokumentasikan di OpenAPI (`api:spec:check`/`api:docs:check` hijau).
9. **Preflight konsisten & tanpa bocor secret.** `config:validate` (cross-rule profil + `TURNSTILE_*` required-when-enabled), `security:readiness` (`checkOnlineAuthSecurityReady` + `checkTurnstileReady`, keduanya membedakan disabled-intentionally dari misconfigured dan tak pernah mencetak nilai secret), dan `.env.example` selaras. Secret dari env, tak pernah di DB/source/log/audit.
10. **Fake verifier untuk test.** `config.verifyUrl` (dari konfigurasi, bukan input request — SSRF-safe) memungkinkan fake siteverify lokal (`Bun.serve`) di unit/integration test tanpa memanggil Cloudflare nyata.
11. **Jalur login yang lebih keras dipertahankan utuh.** Enforcement Turnstile disisipkan SETELAH cek request-shape + rate-limit dan SEBELUM `withTenant`/password — di depan cabang MFA (#184) dan break-glass OIDC (#185). `resolveLoginPolicyConfig`/`verifyPasswordOrDummy` tak disentuh; tak ada `Number(process.env…)` mini yang masuk.

## Konsekuensi

- **Tanpa migration.** Turnstile murni config/env (identik keputusan mini) — tak ada tabel/kolom baru; secret tak pernah menyentuh DB.
- **LAN/offline tak berubah sama sekali.** Default `AUTH_ONLINE_SECURITY_ENABLED=false` → `isTurnstileRequired()` false → nol perilaku baru, nol origin CSP, nol outbound call (dibuktikan test spy `globalThis.fetch` count 0).
- **Snapshot OpenAPI beku** (`tests/fixtures/openapi-pre-migration-snapshot.openapi.yaml`) TETAP TIDAK DISENTUH — snapshot pre-#182 harus tetap beku. Field opsional `turnstileToken` pada dua path pre-migration (`/auth/login`, `/setup/initialize`) diakui lewat allow-list `INTENTIONALLY_EVOLVED_PATHS` di test contract-equivalence (`tests/openapi-bundle.test.ts`): path yang terdaftar tidak wajib byte-identik, tetapi kontrak beku-nya harus tetap **strict subset** dari kontrak sekarang (cek `isAdditiveSuperset` — setiap field lama dipertahankan, hanya penambahan yang diizinkan). Penghapusan field ATAU sebuah field opsional menjadi `required` tetap MEMERAHKAN test. Mengedit snapshot dilarang (akan membuat test membandingkan bundle dengan salinan dirinya sendiri).
- **Residual (diterima, didokumentasi di threat model):** verifikasi hostname bergantung pada satu `TURNSTILE_EXPECTED_HOSTNAME` (deployment multi-hostname perlu penyesuaian); freshness bergantung jam server; DNS-rebinding ke siteverify tidak relevan (URL tetap milik Cloudflare, bukan input). Token single-use ditegakkan Cloudflare (verify kedua → `success:false`), jadi tak bisa mem-bypass idempotency (Turnstile berjalan sebelum lapisan idempotency dan tak menyentuh store-nya).

## Alternatif yang ditolak

- **Menyamakan pola MFA/OIDC (flag saja, tanpa profil).** Ditolak: kontrol yang menjangkau Cloudflare harus benar-benar mati di LAN; profil deployment adalah inti permintaan issue #186 ("deployment profile applicability", "fully OFF on LAN").
- **Menyalin verifier mini apa adanya.** Ditolak: mini tak memvalidasi action/hostname/freshness dan membaca body di luar timer — tidak memenuhi ketentuan keamanan #186.
- **Mempercayai respons widget klien sebagai hasil final.** Ditolak eksplisit oleh issue — verifikasi wajib server-side.
- **Menaruh Turnstile di dalam transaksi DB / setelah password verify.** Ditolak: provider eksternal di luar transaksi (ADR-0006), dan gerbang bot harus mendahului kerja mahal.
- **Kode error berbeda untuk misconfig/mismatch/outage.** Ditolak: akan jadi oracle bagi caller tak terautentikasi — semua kolaps ke `TURNSTILE_INVALID`.
