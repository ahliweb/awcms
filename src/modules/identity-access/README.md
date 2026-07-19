# Identity & Access

Login identity, sesi, tenant user membership, dan RBAC/ABAC dasar.

## Schema

- `awcms_identities` — `login_identifier` unik per tenant, `password_hash` (Bun native argon2id, tidak pernah diekspos), lockout (`failed_login_count`/`locked_until`).
- `awcms_tenant_users` — membership identity di tenant, `status` (active/inactive).
- `awcms_sessions` — token buram: hanya `token_hash` (SHA-256) yang disimpan; token mentah dikembalikan sekali saat login.
- `awcms_permissions` — katalog `(module_key, activity_code, action)`, diseed lewat migration.
- `awcms_roles`/`awcms_role_permissions`/`awcms_access_assignments` — role per tenant + permission per role + assignment tenant_user->role.
- `awcms_abac_policies` — belum dipakai evaluator (evaluator generik di `domain/access-control.ts`); disiapkan untuk Sprint 3.
- `awcms_abac_decision_logs` — setiap keputusan allow/deny tercatat.

Skema: `sql/004_awcms_identity_login_schema.sql`, `sql/005_awcms_abac_access_control_schema.sql`.

## Access-management reads (admin, read-only — Issue #166)

`application/access-directory.ts` mengekspos tiga list bertenant, semua di-gate
`identity_access.access_control.read` dan dipakai oleh endpoint JSON **dan**
layar admin SSR (`src/pages/admin/{users,roles,abac-policies}.astro`):

- `listTenantUsers` → `GET /api/v1/users` — user tenant + kode role yang
  di-assign. `login_identifier` **selalu ter-mask** via `maskIdentifierValue`
  (PII tak pernah dikembalikan mentah di list).
- `listRoles` → `GET /api/v1/roles` — role tenant non-deleted + jumlah permission.
- `listAbacPolicies` → `GET /api/v1/abac/policies` — policy ABAC tenant
  (default seeded-kosong; evaluator generik memakai aturan built-in).

Semua bounded `LIMIT 100` (config low-cardinality, tanpa cursor), tenant-filtered,
dan berjalan di dalam `withTenant` (RLS FORCE batas nyata).

## Access-management writes (admin — Issue #171)

Layar admin `roles`/`abac-policies`/`users` kini punya aksi tulis, masing-masing
di-gate default-deny oleh `authorizeInTransaction` di dalam `withTenant`; gate
UI hanya UX, endpoint-lah otoritasnya. Setiap tulis adalah high-risk →
menulis audit event (severity `warning`) SETELAH tulis sukses (tak ada audit
di jalur 409/404).

**Catatan permission (penting).** Katalog `awcms_permissions` (`sql/005`)
menyemai aktivitas `identity_access.access_control` HANYA dengan
`read`/`assign`/`configure` — TIDAK ada `create`/`update`/`delete`. Owner
di-grant seluruh baris katalog saat bootstrap, jadi guard pada action
tak-ter-seed akan men-deny bahkan owner. Karena itu semua tulis di sini memakai
action ter-seed:

- `POST /api/v1/roles`, `PATCH`/`DELETE /api/v1/roles/{id}`,
  `POST /api/v1/roles/{id}/restore`, `POST`/`DELETE /api/v1/roles/{id}/permissions`
  (`application/role-admin.ts`) — buat/rename/soft-delete/restore role + grant/
  revoke permission. Gate **`configure`** ("Manage roles and role permissions").
  Role sistem (`is_system`) tak bisa di-soft-delete (409). Duplikat role code /
  duplikat grant → 409 di dalam `withTenant`.
- `POST /api/v1/abac/policies`, `PATCH /api/v1/abac/policies/{id}`
  (`application/abac-admin.ts`) — author + edit + enable/disable policy. Gate
  **`configure`** (administrasi access-control). Duplikat `policyCode` → 409.
- `PATCH /api/v1/users/{id}` (`application/user-admin.ts` `setTenantUserStatus`)
  — activate/deactivate (tak ada `deleted_at`; `status` `active`/`inactive`).
  Gate **`configure`**.
- `POST`/`DELETE /api/v1/access/assignments` (`application/user-admin.ts`
  `assignRole`/`unassignRole`) — assign/unassign role↔user. Gate **`assign`**.
  Assign idempotent di unique index `(tenant_id, tenant_user_id, role_id)`
  (23505→409); target tak ada → 404 sebelum tulis (anti existence-oracle).

Klien admin memakai helper `sendJson(method, url, body?)`
(`src/lib/ui/admin-form-client.ts`) untuk PATCH/DELETE — script eksternal
(CSP-safe).

## Auth flow

`POST /api/v1/auth/login` — header `X-AWCMS-Tenant-ID` wajib, rate limit per `clientIp:tenantId` (backstop di luar lockout per-identity), verifikasi password, set cookie httpOnly (`awcms_session`/`awcms_tenant_id`) + kembalikan token untuk klien API. `POST /api/v1/auth/logout` merevoke sesi. `GET /api/v1/auth/me` hanya menerima bearer token.

Pembagian layer login: `domain/login-policy.ts` murni fungsi keputusan (`evaluateLoginAttempt`); `application/login-policy.ts` memegang bagian yang bergantung environment/infra — ambang dari env (`resolveLoginPolicyConfig`), argon2id verify (`verifyPasswordOrDummy`), dan bentuk response tiap deny reason (`resolveLoginDenyResponse`) — sehingga route tetap tipis dan aturannya bisa diuji tanpa database.

### Audit & pengerasan login (Issue #145, #147)

- **Audit** — login menulis `login_succeeded`/`login_failed` ke `awcms_audit_events` (`module_key: identity_access`, `resource_type: identity`). Baris `login_failed` ditulis di transaksi yang sama dengan UPDATE `failed_login_count` sehingga ikut commit; bila transaksi rollback, recorder out-of-band menulis ulang `reason: internal_error` di transaksi baru lalu error asli tetap dilempar. Ini yang membuat reset `failed_login_count = 0` saat login sukses tidak lagi menghapus jejak brute-force yang mendahuluinya.
- **Atribut audit** — hanya `method`, `reason`, `ipHash`, `userAgent`. **Tidak pernah** IP mentah (`redactSensitiveAttributes` akan mengubahnya jadi `[REDACTED]` — kolom kosong permanen) dan **tidak pernah** `loginIdentifier` (umumnya email/PII, dan menyimpan string dari penyerang pada percobaan gagal justru menciptakan kebocoran enumerasi). `ipHash` = HMAC-SHA256 ber-key dari `src/lib/security/client-fingerprint.ts`: stabil untuk pengelompokan per sumber, tapi tidak reversible.
- **Anti-enumerasi** — identifier tak dikenal tetap membayar satu argon2id verify melawan dummy hash konstan (menghapus oracle timing ~75 ms vs ~0 ms), dan deny reason `locked` menjawab persis sama dengan `invalid_credentials`. `tenant_inactive` sengaja tetap dibedakan (tenant disebut caller di header, jadi tidak membocorkan identity mana yang ada).
- **Ambang env** — dibaca lewat `parsePositiveIntEnv`: nilai non-numerik/nol/negatif jatuh ke default disertai `log("warning", ...)`, bukan `NaN` yang membuat `failedLoginCount >= NaN` selalu false dan mematikan lockout secara diam-diam.
- **Env baru** — `TRUSTED_PROXY_ENABLED` (default `false`): `X-Forwarded-For` hanya dipercaya sebagai kunci rate limit bila di-set `true`; selain itu `clientAddress` yang dipakai, supaya penyerang pada topologi terekspos-langsung tak bisa memalsukan header per request untuk selalu dapat bucket baru. `AUTH_IP_HASH_SECRET` (opsional) meng-key HMAC `ipHash`; bila kosong/placeholder, kunci acak per proses dipakai (tetap non-reversible, tapi `ipHash` tak bisa dibandingkan lintas restart/instance) dan satu warning ditulis.

## RBAC/ABAC

`domain/access-control.ts` — `evaluateAccess()`: default deny, deny overrides allow, permission diidentifikasi `module_key.activity_code.action`. `application/access-guard.ts` — `authorizeInTransaction()` adalah satu-satunya chokepoint yang dipanggil setiap route terproteksi.

Status disabled sebuah modul bukan sekadar sinyal UI: `authorizeInTransaction` mengecek `resolveModuleEnabled(tx, tenantId, guard.moduleKey)` (`auth-context.ts`) **sebelum** permission di-lookup, sehingga modul yang dinonaktifkan untuk sebuah tenant ditolak `403 MODULE_DISABLED` apa pun permission yang dipegang aktor, dan penolakannya tetap tercatat di decision log (`matchedPolicy: "module_disabled"`). Karena guard ini dipakai setiap endpoint terproteksi, satu cek ini menutup seluruh endpoint milik modul nonaktif tanpa menyentuh tiap route. `module_management` sendiri `isCore` (tidak bisa dinonaktifkan), jadi tenant tak pernah terkunci dari mengaktifkannya kembali.

## Business-scope hierarchy (Issue #180)

Lapis authorization organisasi **generik** di atas tenant + role — membatasi akses berdasarkan hierarki organisasi (legal entity, branch, office, department, cost center, project) tanpa memasukkan entitas domain ERP nyata ke base. Diport dari awcms-mini (Issue #746), **dilucuti** dari segregation-of-duties (SoD, itu Issue #181). Detail penuh: [ADR-0030](../../../docs/adr/0030-business-scope-hierarchy-generic-authorization-layer.md).

- **Referensi generik + capability port.** `scope_type`/`scope_id` adalah referensi generik (bukan FK ke tabel organisasi). Validitas/ancestry di-resolve lewat `BusinessScopeHierarchyPort` (`_shared/ports/business-scope-hierarchy-port.ts`, ADR-0011) yang disediakan **aplikasi turunan**. Base mengirim resolver **no-op** (`business-scope-hierarchy-port-adapter.ts`, `resolved: false` untuk semua scope type) — jadi di base-murni tanpa provider, create assignment selalu menolak `scope_unresolved` dan aksi high-risk bergerbang-scope selalu ditolak (fail-closed by design). `identity_access` mendeklarasikan `capabilities.consumes` `business_scope_hierarchy` (`optional: true`); fixture `tests/fixtures/derived-application-example/` mengirim resolver dummy untuk uji.
- **Skema (`sql/027`, seed `sql/028`)** — dua tabel tenant-scoped RLS `FORCE`: `awcms_business_scope_assignments` (subject→scope, role opsional, effective dating, `is_temporary`, status active/expired/revoked, grantor/approver/revoker) + `awcms_business_scope_assignment_events` (lifecycle **append-only**). Setiap FK subject/role/actor adalah **FK komposit `(tenant_id, …)`** — RI check PostgreSQL melewati RLS (GHSA-r7cx-c4jh-cvvw/sql/020), jadi FK single-column bisa lintas-tenant walau FORCE aktif; komposit + RLS menutupnya (dibuktikan `tests/integration/business-scope.integration.test.ts` di bawah `awcms_app`).
- **Integrasi `evaluateAccess`.** Parameter ke-4 opsional `businessScopeFacts` (backward-compatible — call site lama tak berubah). Request opt-in lewat `resourceAttributes.requiredScopeType`/`.requiredScopeId` (+ `requiredScopeRelations`, subset `exact`/`descendant`/`ancestor`, default `["exact"]`). Relasi didukung: **exact, descendant, ancestor, tenant-wide** (`scopeType === "tenant"`). Fakta subjek di-resolve dulu (`business-scope-facts.ts`) agar evaluator tetap murni. `authorizeInTransaction` menerima `options.hierarchyPort` opsional untuk me-resolve + thread fakta.
- **Fail-closed.** Unknown scope type / unresolved / stale hierarchy → default-**DENY** untuk aksi high-risk. `resolved: false` ≠ "resolved dengan ancestor kosong": coverage descendant/ancestor hanya dari fakta `resolved`, dan exact-match aksi high-risk butuh `resolved: true` (predikat mutation-tested RED).
- **Effective dating & revocation segera.** `isBusinessScopeAssignmentCurrentlyActive(row, now)` adalah gerbang otoritatif (status = cache). Revoke/expiry berdampak pada keputusan authz berikutnya **tanpa** menunggu job. Job terjadwal `identity-access:business-scope:expiry` (worker) membalik `status` + tulis event/audit sebagai housekeeping.
- **Endpoint** — `GET`/`POST /api/v1/identity/business-scope/assignments` (list/create; create high-risk, `Idempotency-Key` wajib, self-grant ditolak), `POST …/{id}/revoke`. Guard `identity_access.business_scope_assignments.{read,create,revoke}` default-deny; create/revoke/expire diaudit.

## MFA TOTP, recovery codes, dan step-up (Issue #184)

Diport dari awcms-mini, diadaptasi: mini menggerbangi MFA di balik gate "full-online" (#587) yang **tidak ada** di base ini, jadi feature switch di sini adalah `AUTH_MFA_ENABLED` saja — dan itu hanya menggerbangi permukaan **enrollment**. Challenge login, disable, dan step-up digerakkan **state database** (baris factor `active`), bukan flag, sehingga mematikan flag tak pernah bisa membuat identity yang sudah enroll melewati faktor kedua (fail-closed).

- **Skema (`sql/024`)** — tiga tabel tenant-scoped RLS `FORCE`: `awcms_identity_mfa_factors` (secret TOTP terenkripsi AES-256-GCM, `status` pending/active/disabled, `last_used_step` untuk anti-replay), `awcms_identity_mfa_recovery_codes` (hash sha256, single-use), `awcms_mfa_challenges` (jembatan efemeral password→sesi). Plus kolom assurance di `awcms_sessions` (`assurance_level` aal1/aal2, `last_authenticated_at`, `stepped_up_at`) dan tabel `awcms_tenant_mfa_policies`.
- **Enkripsi secret** — `AUTH_MFA_SECRET_ENCRYPTION_KEY` (32 byte base64), **tanpa default key**: `resolveMfaEncryptionKey` mengembalikan `null` bila hilang/invalid → semua path fail-closed `MFA_MISCONFIGURED`. Backup DB saja tak cukup untuk memperoleh secret. Recovery code di-hash satu arah, verify constant-time (via UPDATE CAS), single-use, regenerable, ditampilkan sekali.
- **Anti-replay concurrency-safe** — `verifyTotpCode` mengembalikan step absolut; hanya diterima bila `step > last_used_step` DAN advance-nya compare-and-swap (`WHERE ... AND last_used_step < ${step}`). Dua request konkuren pada timestep sama: yang kalah meng-UPDATE nol baris → ditolak sebagai replay. Recovery code dikonsumsi dengan CAS `used_at IS NULL` yang sama. Window drift dibatasi (`AUTH_MFA_TOTP_WINDOW_STEPS`, maks 10).
- **Challenge login dua tahap** — di `login.ts`, cabang MFA hanya tercapai **setelah** password valid (blok deny sudah `return`), jadi tak ada oracle enumerasi baru: penyerang tanpa password tak pernah sampai. Password valid + factor aktif → `401 MFA_REQUIRED` + `mfaChallengeToken` (bukan sesi). `POST /auth/mfa/totp/verify` (publik, diautentikasi kepemilikan token challenge) menyelesaikannya → sesi **aal2**. Semua jalur deny challenge kolaps ke `MFA_CHALLENGE_INVALID`.
- **Enforcement policy tenant (nyata)** — `optional` (default) / `required_for_privileged` (memegang permission non-read apa pun) / `required_for_all` via `PUT /api/v1/auth/mfa/policy` (guard `configure`). Bila policy mewajibkan MFA untuk user yang password-nya valid tapi **belum punya factor**, login tidak menerbitkan sesi penuh: ia mengembalikan `401 MFA_ENROLLMENT_REQUIRED` + `mfaEnrollmentToken` (grant `awcms_mfa_challenges` `purpose='enrollment'`) yang **hanya** mengotorisasi `enroll/start`/`enroll/verify` (header `X-AWCMS-MFA-Enrollment-Token`); enrollment selesai → grant dikonsumsi + sesi `aal2`. Fail-closed tapi self-recoverable (tak ada lockout admin); digerbangi `isMfaFeatureEnabled()`.
- **Assurance & step-up** — sesi punya `assurance_level`. `requireStepUp` adalah gate reusable, dipanggil **setelah** `authorizeInTransaction`. `AUTH_MFA_STEPUP_TTL_SEC` pendek & server-controlled. Kenaikan aal1→aal2 **merotasi** sesi (anti-fixation). **Sudah di-wire** ke seluruh aksi high-risk modul ini: self-service `disable`, `recovery-codes/regenerate`, `admin/reset`, dan `PUT policy` (aplikasi ERP turunan memasang `requireStepUp` pada aksi sensitifnya sendiri, #179/#181).
- **Lockout per-factor** — `failed_verify_count`/`locked_until` kumulatif (independen source IP & rotasi challenge; `AUTH_MFA_MAX_VERIFY_ATTEMPTS`/`AUTH_MFA_LOCKOUT_MINUTES`), reset saat verify sukses. Factor terkunci kolaps ke `MFA_CHALLENGE_INVALID` (login) / `MFA_LOCKED` (step-up).
- **Admin reset** — `POST /api/v1/auth/mfa/admin/reset` guard `identity_access.mfa_admin.reset`, `reason` wajib, **step-up segar wajib**, audit `critical`, **self-reset dilarang**.

Detail lengkap (auth flow, referensi env, SOP recovery admin, threat model, mapping OWASP ASVS/ISO): [`docs/awcms/mfa-totp-step-up.md`](../../../docs/awcms/mfa-totp-step-up.md) dan [ADR-0027](../../../docs/adr/0027-mfa-totp-session-assurance-step-up.md).

## OIDC/SSO tenant-aware, account linking, dan break-glass (Issue #185)

Diport dari awcms-mini (Issue #590/#591), diadaptasi + dikeraskan. Feature switch `AUTH_SSO_ENABLED` menggerbangi flow login/callback/link/unlink (admin provider/policy CRUD selalu bisa). Konfigurasi provider adalah DATA per tenant, bukan env. Sukses OIDC mencetak **opaque session AWCMS** (bukan ID token sebagai session); authorization tetap lewat RBAC/ABAC/RLS.

- **Skema (`sql/025`)** — empat tabel tenant-scoped RLS `FORCE`: `awcms_auth_providers` (config provider; client secret ciphertext AES-256-GCM ATAU referensi env, tak pernah plaintext), `awcms_tenant_auth_policies` (password/SSO/JIT/break-glass, satu baris per tenant), `awcms_external_identities` (linking di-key `(tenant_id, provider_id, issuer, subject)` — immutable `sub`, tak pernah email; FK komposit terikat-tenant), `awcms_oidc_auth_requests` (jembatan efemeral: `state_hash` bearer, `nonce` + PKCE `code_verifier` plaintext single-use, `redirect_after` tervalidasi). Seed permission `sql/026`.
- **SSRF guard (`lib/auth/ssrf-guard.ts`)** — risiko #1: semua fetch discovery/JWKS/token HTTPS-only, blok private/loopback/link-local/ULA/CGNAT/metadata IPv4+IPv6 (termasuk IPv4-mapped/NAT64), validasi semua hasil DNS sebelum connect, redirect manual + re-validasi tiap hop, timeout + response-size cap. Escape hatch loopback hanya via `AUTH_SSO_ALLOW_INSECURE_HOSTS` (ditolak di produksi). Kebalikan keputusan risk-acceptance mini.
- **Auth Code + PKCE + state + nonce** — `state` bearer di-hash, single-use (`FOR UPDATE` + CAS), TTL pendek, terikat tenant sejak `start`. `code_challenge` S256; `code_verifier` server-side.
- **Validasi ID token fail-closed** (`domain/oidc-policy.ts` + `lib/auth/jwt-verify.ts`) — algorithm allow-list `{RS256, ES256}` yang cocok dengan tipe key (tolak `none` + alg-confusion), signature WebCrypto native (tanpa dependency `jose`), issuer + audience + `azp` + expiry + `iat` + nonce.
- **JWKS/discovery cache** — TTL terbatas + negative-TTL + circuit-breaker keyed `${tenantId}:${providerKey}`, **di luar** transaksi DB. Breaker hanya trip pada kegagalan transport/SSRF.
- **Account linking eksplisit + step-up** — `POST /sso/{providerKey}/link` & `unlink` butuh sesi valid **dan** `requireStepUp` (#184). Identity diambil server-side dari sesi ter-step-up. Tak auto-link hanya karena email sama.
- **Auto-link & JIT default OFF** — auto-link butuh master switch tenant + email verified + domain provider (dan domain policy bila diset). JIT membuat identity baru pada **privilege minimum** (tanpa role).
- **Break-glass** — di-enforce saat SAVE policy (`saveTenantAuthPolicy`): `sso_required`/`password_login_disabled` butuh ≥1 owner break-glass aktif, else `409 BREAK_GLASS_REQUIRED`. Login-time `isPasswordLoginDisabledForIdentity` (digerbangi `isSsoEnabled`, dijalankan **sebelum** cabang MFA) menolak password-login non-break-glass. Outage IdP tak memblok break-glass.
- **Admin & audit** — provider CRUD (`sso_providers.{read,create,update,delete}`) & policy (`sso_policy.{read,update}`), soft delete, audit high severity (link/unlink/provider/policy/JIT/login outcome) tanpa token/claim/secret mentah.

Detail lengkap (auth flow, setup provider, break-glass SOP, privacy mapping, threat model): [`docs/awcms/oidc-sso.md`](../../../docs/awcms/oidc-sso.md) dan [ADR-0028](../../../docs/adr/0028-oidc-sso-tenant-aware-account-linking-break-glass.md).

## Belum tersedia (Sprint 3+)

Endpoint manajemen user/role lanjutan dan Turnstile (#186).
