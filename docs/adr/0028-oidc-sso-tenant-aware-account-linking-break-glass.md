# ADR-0028 — OIDC/SSO tenant-aware, account linking fail-closed, dan break-glass

- **Status:** Accepted
- **Tanggal:** 2026-07-19
- **Pengambil keputusan:** maintainer
- **Terkait:** Issue #185, epic #177 (kesiapan fondasi ERP turunan); ADR-0027 (MFA/step-up, integrasi break-glass); ADR-0026 (modular OpenAPI); doc `docs/awcms/oidc-sso.md`; port dari awcms-mini Issue #590/#591 (diadaptasi, bukan disalin).

## Konteks

AWCMS memakai login password lokal + opaque session. Untuk ERP organisasi besar dibutuhkan federated identity melalui OpenID Connect agar dapat terhubung ke Google Workspace, Microsoft Entra ID, Keycloak, atau IdP lain — tanpa menjadikan provider eksternal sebagai sumber authorization final. Implementasi harus tenant-aware: satu deployment melayani banyak tenant dengan issuer/client policy berbeda; kesalahan linking atau tenant resolution dapat menyebabkan account takeover atau akses lintas tenant.

Slice OIDC generik sudah matang di awcms-mini (Issue #591), tetapi mini mengambil dua keputusan yang **tidak** cocok untuk base ini: (1) mini sengaja **tidak** mem-block private/loopback/metadata IP pada `issuer_url` (asumsi profil full-online yang menjangkau IdP on-prem lewat VPN), dan (2) mini menggerbangi SSO di balik gate "full-online" (#587) yang tidak diport. Selain itu jalur login base ini **lebih keras** dari mini (anti-timing dummy hash, deny reason kolaps, `TRUSTED_PROXY_ENABLED`) — port naif bisa meregresinya.

## Keputusan

Kami memutuskan **mem-port framework OIDC generik dari mini dan mengeraskannya** untuk base ini, dengan adaptasi berikut:

1. **Feature switch = `AUTH_SSO_ENABLED` saja** (tanpa gate full-online). Flag ini menggerbangi flow login/callback/link/unlink; admin provider/policy CRUD selalu bisa (provision provider sebelum flag di-flip). Konfigurasi provider (issuer/client id/secret/scope/domain) adalah **DATA per tenant** (`awcms_auth_providers`), bukan env.
2. **SSRF guard dedikasi (`src/lib/auth/ssrf-guard.ts`) — risiko #1 issue.** Semua fetch discovery/JWKS/token wajib HTTPS (kecuali host yang di-allow-list eksplisit untuk fake IdP lokal saat test), memblok private/loopback/link-local/ULA/CGNAT/metadata/multicast/reserved IPv4+IPv6 (termasuk IPv4-mapped/NAT64 yang menyisipkan v4), memvalidasi **semua** hasil resolusi DNS sebelum connect (pertahanan bentuk-DNS rebinding), memfollow redirect secara **manual + re-validasi tiap hop**, plus timeout + response-size cap. Ini kebalikan keputusan risk-acceptance mini.
3. **Auth Code Flow + PKCE + `state` + `nonce`.** `code_verifier` disimpan server-side single-use (`awcms_oidc_auth_requests`), `code_challenge` S256 dikirim ke IdP. `state` bearer credential (di-hash sha256 at rest); `nonce`/`code_verifier` plaintext (bukan bearer sendiri). State single-use concurrency-safe (`SELECT … FOR UPDATE` + compare-and-swap), terikat tenant sejak `start` hingga `callback`.
4. **Validasi ID token fail-closed** (`oidc-policy.ts` + `jwt-verify.ts`): issuer, audience, signature via JWKS, expiry, `iat` sanity, nonce, `azp` (wajib bila audience jamak), dan **algorithm allow-list {RS256, ES256}** yang cocok dengan tipe key (tolak `none` dan alg-confusion). Signature diverifikasi WebCrypto native (Bun-only, tanpa dependency `jose`).
5. **External identity di-key `(tenant_id, provider_id, issuer, subject)`** (`awcms_external_identities`) — immutable `sub`, tidak pernah email. Berbeda dari mini yang memakai `(tenant_id, provider, subject)`; `issuer` ditambahkan ke kunci, `provider_id` jadi FK komposit terikat-tenant.
6. **JWKS/discovery cache** TTL terbatas + negative-TTL + circuit-breaker (reuse `getProviderCircuitBreaker`), keyed `${tenantId}:${providerKey}` — **di luar** transaksi DB (ADR-0006). Breaker hanya trip pada kegagalan transport/SSRF, bukan 4xx yang digerakkan input attacker.
7. **Account linking eksplisit + step-up (#184).** `POST /sso/{providerKey}/link` butuh sesi valid **dan** `requireStepUp` (aal2 segar) — identity diambil server-side dari sesi yang sudah step-up, tidak pernah dari callback. TIDAK auto-link hanya karena email sama.
8. **Auto-link & JIT provisioning default OFF.** Auto-link butuh master switch tenant + email verified + domain provider (dan domain policy bila diset). JIT (default off) membuat identity baru pada **privilege minimum** (tanpa role — authorization default-deny) hanya untuk email verified beralamat domain yang di-allow-list dan tanpa tabrakan `login_identifier`.
9. **Break-glass di-enforce saat SAVE policy** (`saveTenantAuthPolicy`): `sso_required=true` atau `password_login_enabled=false` hanya boleh disimpan bila ≥1 identity break-glass masih aktif (identity + tenant_user `active`). Login-time (`isPasswordLoginDisabledForIdentity`, digerbangi `isSsoEnabled`) menolak password-login identity non-break-glass **sebelum** cabang MFA — sehingga tak bisa di-bypass lewat challenge. Outage IdP tak pernah memblok break-glass (jalur password lokal terpisah dari jalur provider).
10. **Hasil OIDC = opaque session AWCMS**, bukan ID token sebagai session. Sukses tanpa faktor MFA aktif → sesi `aal1` (`createSessionWithAssurance`, reuse kolom assurance #184); ada faktor aktif → challenge → route MFA existing mencetak `aal2`. Redirect pasca-login = `returnTo` same-origin tervalidasi (default `/admin`) — anti open-redirect.
11. **Client secret tak pernah plaintext di DB/log/response/audit.** Disimpan `client_secret_ciphertext` (AES-256-GCM, `AUTH_SSO_CREDENTIAL_ENCRYPTION_KEY`, tanpa default key) ATAU `client_secret_env_var` (nama env, di-resolve saat token-exchange). Response admin hanya mengekspos `secretSource`.
12. **Jalur login base yang lebih keras dipertahankan utuh** — gate break-glass hanya menyisipkan satu cabang di antara blok deny (yang sudah `return`) dan cabang MFA; `resolveLoginPolicyConfig`/`verifyPasswordOrDummy` tidak disentuh, tak ada `Number(process.env…)` mini yang masuk.

## Konsekuensi

- Tabel baru RLS `ENABLE`+`FORCE` (`awcms_auth_providers`, `awcms_tenant_auth_policies`, `awcms_external_identities`, `awcms_oidc_auth_requests`) — cross-tenant denial dibuktikan di bawah role non-superuser `awcms_app` (`tests/oidc-integration.test.ts`).
- SSRF guard adalah port/adapter kecil yang diuji unit tersendiri (`tests/oidc-ssrf.test.ts`); DNS-rebinding sisa (flip IP setelah validasi, sebelum connect) tak bisa ditutup tanpa pin socket connect-time yang tak diekspos `fetch` Bun — didokumentasikan di threat model. Bound sebenarnya **bukan** TTL cache positif (1 jam, tak terisi saat rebind), melainkan negative-cache 30 detik + circuit breaker per-`${tenant}:${provider}`.
- **Residual auto-link (opt-in, diterima):** `autoLinkVerifiedEmail`/`jitProvisioningEnabled` (default OFF) mengandalkan `email_verified` IdP; jika tenant menyalakannya terhadap IdP konsumen/domain bersama, alamat `email_verified:true` yang bertabrakan dengan `login_identifier` lokal jadi primitive takeover. Sesuai AC (hanya auto-link email tak-terverifikasi/default-on yang dilarang), fitur DIPERTAHANKAN tetapi doc memperingatkan keras: hanya untuk domain milik-penuh + IdP tepercaya. JIT tak pernah menimpa identity existing (tabrakan → not-linked).
- `mfa_required` mini di `tenant_auth_policies` **di-drop** (base sudah punya `awcms_tenant_mfa_policies`, sql/024) agar tak ada dua sumber kebenaran.
- Dua operasi publik baru (`getAuthSsoStart`, `getAuthSsoCallback`) masuk allow-list `ALLOWED_PUBLIC_OPERATIONS` yang direview.

## Alternatif yang ditolak

- **Ikut keputusan mini "tidak block private IP"** — ditolak; issue #185 menjadikan SSRF sebagai syarat keamanan utama.
- **SAML / SCIM penuh** — out of scope issue.
- **ID token sebagai session** — ditolak; authorization tetap lewat RBAC/ABAC AWCMS atas opaque session.
- **Menambah dependency `jose`/`jsonwebtoken`** — ditolak (Bun-only); WebCrypto native cukup untuk RS256/ES256.
