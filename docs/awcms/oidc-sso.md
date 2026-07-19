# OIDC/SSO tenant-aware, account linking, dan break-glass

Referensi implementasi Issue #185 (epic #177). Modul: `identity-access`. ADR: [ADR-0028](../adr/0028-oidc-sso-tenant-aware-account-linking-break-glass.md). Skema: `sql/025_awcms_oidc_sso_schema.sql`, seed permission: `sql/026_awcms_seed_sso_permissions.sql`. Integrasi step-up/MFA: [MFA/step-up](mfa-totp-step-up.md).

Fitur aktif hanya saat `AUTH_SSO_ENABLED=true`. Deployment lokal/offline/LAN yang tak mengaktifkannya tak pernah memanggil IdP dan berperilaku persis seperti sebelum fitur ini ada.

## 1. Arsitektur & trust boundary

- IdP eksternal adalah **authenticator**, bukan authority. Setelah OIDC sukses, AWCMS mencetak **opaque session** sendiri; authorization tetap lewat RBAC/ABAC/RLS. ID token tidak pernah dipakai sebagai session aplikasi.
- Konfigurasi provider adalah **DATA per tenant** (`awcms_auth_providers`): issuer/discovery, client id, secret reference, scope, allowed domains, enabled. Satu deployment melayani banyak tenant dengan issuer/policy berbeda.
- Semua tabel baru tenant-scoped + RLS `ENABLE`+`FORCE`.

## 2. Alur (auth flow)

### 2.1 Login

```
GET /api/v1/auth/sso/{providerKey}/start            (unauthenticated; AUTH_SSO_ENABLED=true)
  -> resolve tenant (header/cookie/?tenantId), cek tenant aktif + provider enabled
  -> buat awcms_oidc_auth_requests: state(hash), nonce, code_verifier (PKCE), purpose='login'
  -> discovery (SSRF-guarded) -> 302 ke authorization_endpoint
     (client_id, redirect_uri milik-app, response_type=code, scope, state=tenantId.token,
      nonce, code_challenge S256)

GET /api/v1/auth/sso/{providerKey}/callback         (redirect IdP; unauthenticated)
  -> parse state -> tenantId + token; resolve provider; consume state (FOR UPDATE + CAS, single-use)
  -> token exchange (SSRF-guarded, PKCE code_verifier + client secret)
  -> verifikasi ID token: alg allow-list {RS256,ES256} + JWKS signature (WebCrypto)
     + issuer + audience + azp + expiry + iat + nonce  (semua fail-closed)
  -> cari external identity (tenant_id, provider_id, issuer, subject)
     |  ada          -> lanjut
     |  tidak + auto-link ON + email verified + domain allowed -> link ke identity existing
     |  tidak + JIT ON + email verified + domain allowed + tak tabrakan -> provision identity (privilege minimum)
     |  selain itu   -> 401 SSO_ACCOUNT_NOT_LINKED
  -> bila ada factor MFA aktif -> 401 MFA_REQUIRED { mfaChallengeToken }  (selesaikan via /auth/mfa/totp/verify -> aal2)
  -> selain itu -> mint opaque session aal1, set cookie, 302 ke returnTo (default /admin)
```

### 2.2 Account linking (eksplisit + step-up)

```
POST /api/v1/auth/sso/{providerKey}/link            (sesi valid + requireStepUp aal2)
  -> buat oidc_auth_request purpose='link', identity_id = identity sesi (server-side)
  -> balas { authorizationUrl }  (browser navigasi; callback purpose='link' membuat external identity)

POST /api/v1/auth/sso/{providerKey}/unlink          (sesi valid + requireStepUp aal2)
  -> hapus external identity; audit high severity
```

Linking **tidak pernah** otomatis hanya karena email sama; butuh sesi authenticated + step-up MFA baru.

### 2.3 Admin lifecycle (ABAC-guarded, audited)

```
GET/POST      /api/v1/auth/sso-providers            (sso_providers.read / .create)
GET/PATCH/DELETE /api/v1/auth/sso-providers/{id}    (.read / .update / .delete; soft delete)
GET/PATCH     /api/v1/auth/sso-policy               (sso_policy.read / .update)
```

Client secret tak pernah dikembalikan; response hanya `secretSource` (`encrypted`/`env`) dan (untuk env) nama variabelnya.

## 3. Panduan setup provider

1. Sediakan key enkripsi: `AUTH_SSO_CREDENTIAL_ENCRYPTION_KEY=$(openssl rand -base64 32)`; set `AUTH_SSO_ENABLED=true`.
2. Di IdP (Google/Entra/Keycloak/…): daftarkan aplikasi OIDC, redirect URI = `${APP_URL}/api/v1/auth/sso/{providerKey}/callback` (strict match), scope minimal `openid email profile`.
3. Buat provider via `POST /api/v1/auth/sso-providers`:
   - `providerKey` slug stabil (`^[a-z0-9][a-z0-9_-]*$`), dipakai di URL & sebagai kunci link.
   - `issuerUrl` HTTPS (base `.well-known/openid-configuration` di-derive otomatis).
   - `clientId`.
   - **Secret**: pilih salah satu — `clientSecret` (dienkripsi at-rest) ATAU `clientSecretEnvVar` (nama env; secret nyata di secrets manager, tak pernah persist).
   - `allowedEmailDomains` (opsional; syarat auto-link/JIT).
   - `enabled: true`.
4. Atur policy tenant via `PATCH /api/v1/auth/sso-policy` (opsional): `ssoEnabled`, `ssoRequired`, `autoLinkVerifiedEmail`, `jitProvisioningEnabled`, `allowedEmailDomains`, `breakGlassIdentityIds`.

> **PERINGATAN auto-link (account takeover):** `autoLinkVerifiedEmail`/`jitProvisioningEnabled` (default OFF) menautkan/membuat identity berdasarkan `email` + `email_verified:true` dari IdP. Ini **hanya aman** untuk domain yang **Anda kontrol sepenuhnya** dan IdP yang **Anda percaya** untuk klaim `email_verified`-nya. **JANGAN** aktifkan terhadap IdP konsumen/publik atau domain bersama (mis. `gmail.com`, atau tenant Entra multi-organisasi) di mana pihak lain dapat memiliki `email_verified:true` untuk alamat yang bertabrakan dengan `login_identifier` lokal — itu menjadi primitive takeover. Aman-default: biarkan OFF dan wajibkan **linking eksplisit** (butuh sesi + step-up). `allowedEmailDomains` (provider + policy) wajib diisi dengan domain milik-sendiri saat fitur ini dinyalakan.

> **Catatan `sso_required`:** `sso_required=true` bersifat **advisory** — ia mendorong pengguna ke SSO tetapi **tidak** mematikan login password kecuali Anda juga menyetel `password_login_enabled=false`. Untuk benar-benar mewajibkan SSO, set keduanya (dan itu memicu syarat break-glass di §4). `sso_required=true` sendirian berguna untuk UX/redirect, bukan enforcement.

Preflight: `bun run config:validate` menolak `AUTH_SSO_ENABLED=true` tanpa key 32-byte valid, dan `AUTH_SSO_ALLOW_INSECURE_HOSTS` non-kosong di produksi. `bun run security:readiness` menegakkan hal yang sama (severity critical).

## 4. Break-glass SOP

**Tujuan:** menjamin pemilik/owner lokal selalu bisa masuk meski SSO diwajibkan atau IdP down.

- **Prasyarat kebijakan:** `sso_required=true` (atau `password_login_enabled=false`) hanya boleh disimpan bila `breakGlassIdentityIds` memuat ≥1 identity yang **saat ini** aktif (identity + tenant_user `active`). Jika tidak → `409 BREAK_GLASS_REQUIRED`. `saveTenantAuthPolicy` menyimpan hanya id yang lolos verifikasi (buang id garbage).
- **Wajib MFA:** owner break-glass tetap melewati enforcement MFA tenant (`awcms_tenant_mfa_policies`, `required_for_all`/`required_for_privileged`) — set policy MFA agar break-glass memakai faktor kedua.
- **Saat IdP outage:** login SSO gagal cepat (`SSO_PROVIDER_UNAVAILABLE`, circuit breaker); login password break-glass **tetap jalan** (jalur terpisah, tidak menyentuh provider). Ini terbukti di `tests/oidc-integration.test.ts`.
- **Drift kontrol:** identity break-glass bisa jadi tidak-eligible (dinonaktifkan) tanpa policy di-save ulang; `fetchEligibleBreakGlassIdentityIds` diekspor agar readiness/go-live memverifikasi ulang. Prosedur incident: verifikasi minimal satu owner break-glass aktif + ter-MFA sebelum mengaktifkan `sso_required`.
- **Rotasi:** simpan kredensial break-glass di brankas offline; uji login break-glass berkala; audit setiap `login_blocked_password_disabled` dan `login_succeeded` break-glass.

## 5. Privacy / data-minimization (UU PDP, ISO/IEC 27701)

| Data                    | Sumber             | Disimpan?                                | Catatan                                                                    |
| ----------------------- | ------------------ | ---------------------------------------- | -------------------------------------------------------------------------- |
| `sub` (subject)         | ID token           | Ya (`awcms_external_identities.subject`) | Identitas pseudonim stabil; kunci linking. Bukan PII langsung.             |
| `issuer`                | discovery/ID token | Ya                                       | Bagian kunci external identity.                                            |
| email                   | ID token           | Hanya bila auto-link/JIT                 | Dipakai untuk mencocokkan/JIT identity; tak dipakai sebagai kunci linking. |
| `email_verified`        | ID token           | Tidak                                    | Hanya dievaluasi runtime (syarat auto-link/JIT).                           |
| ID token / access token | token endpoint     | **Tidak**                                | Tak pernah dipersist; hanya diverifikasi in-memory.                        |
| client secret           | admin input/env    | Ciphertext atau referensi env            | Tak pernah plaintext di DB/log/response/audit.                             |
| audit                   | server             | Ya, ter-redaksi                          | `providerKey` + counts; tak ada token/secret/claim mentah.                 |

Minimisasi: hanya `sub`+`issuer` (dan email bila fitur linking mensyaratkan) yang persist. Data subject linking dihapus saat unlink (`DELETE`). Retensi audit mengikuti kebijakan audit umum.

## 6. Threat model

| Ancaman                                           | Mitigasi                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **SSRF** (issuer/JWKS/token URL dari data tenant) | HTTPS-only; blok private/loopback/link-local/ULA/CGNAT/metadata IPv4+IPv6 (termasuk IPv4-mapped/NAT64); validasi semua hasil DNS sebelum connect; redirect manual + re-validasi; timeout + size cap; breaker per-`${tenant}:${provider}`. Escape hatch loopback hanya via `AUTH_SSO_ALLOW_INSECURE_HOSTS` (ditolak di produksi). **Sisa:** DNS rebinding flip pasca-validasi tak tertutup tanpa pin connect-time (dibatasi BUKAN oleh TTL cache positif 1 jam, melainkan negative-cache 30 detik + circuit breaker per-`${tenant}:${provider}`; residual diterima, ADR-0028). |
| **Token substitution / alg confusion / `none`**   | Allow-list algoritma {RS256, ES256} yang cocok dengan tipe key; signature via WebCrypto; issuer/audience/azp/expiry/iat/nonce fail-closed; `sub` immutable (bukan email).                                                                                                                                                                                                                                                                                                                                                                                                     |
| **CSRF / replay callback**                        | `state` bearer di-hash, single-use (FOR UPDATE + CAS), TTL pendek; `nonce` diikat ke ID token; PKCE `code_verifier` single-use server-side.                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Open redirect**                                 | `redirect_uri` selalu milik-app (bukan client-supplied); `returnTo` pasca-login disanitasi ke path same-origin (default `/admin`).                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Tenant confusion / cross-tenant**               | Tenant di-resolve sebelum flow, diikat ke `state`, di-derive ulang di callback; state di-scope `(tenant_id, provider_id, state_hash)`; RLS FORCE + FK komposit terikat-tenant. Substitusi state lintas tenant ditolak (`SSO_OAUTH_STATE_INVALID`).                                                                                                                                                                                                                                                                                                                            |
| **Account takeover via linking**                  | Linking eksplisit + sesi authenticated + step-up MFA; tak auto-link email tak terverifikasi; kunci `sub` bukan email. Residual (opt-in): `autoLinkVerifiedEmail`/`jitProvisioningEnabled` mengandalkan klaim `email_verified` IdP — jika dinyalakan terhadap IdP konsumen/domain bersama yang memancarkan `email_verified:true` untuk alamat bertabrakan dengan `login_identifier` lokal, ini jadi primitive takeover. Default OFF; hanya untuk domain milik-penuh + IdP tepercaya (§3). JIT tak pernah menimpa identity existing (tabrakan → not-linked).                    |
| **IdP outage lockout**                            | Break-glass password lokal terpisah dari jalur provider; breaker gagal-cepat; save policy menolak konfigurasi yang mengunci semua orang.                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Kebocoran secret**                              | AES-256-GCM tanpa default key / referensi env; tak pernah di response/log/audit; readiness gate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Enumeration oracle**                            | Provider tak dikenal → `404` generik setelah gate; gate break-glass hanya tercapai pasca-password valid; error callback generik.                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **DoS probing internal**                          | Breaker + negative-cache hanya melempar attempt yang GAGAL (tak pernah blok login sah); cap provider per tenant; rate-limit per source+tenant di `/start`.                                                                                                                                                                                                                                                                                                                                                                                                                    |

## 7. Konfigurasi (env)

Lihat `.env.example` bagian OIDC/SSO. Ringkas: `AUTH_SSO_ENABLED`, `AUTH_SSO_CREDENTIAL_ENCRYPTION_KEY` (wajib bila enabled, 32-byte base64), `AUTH_SSO_DISCOVERY_TIMEOUT_MS`, `AUTH_SSO_MAX_RESPONSE_BYTES`, `AUTH_SSO_MAX_PROVIDERS_PER_TENANT`, `AUTH_SSO_OAUTH_REQUEST_TTL_SEC`, `AUTH_SSO_ALLOW_INSECURE_HOSTS` (test-only, kosong di produksi).
