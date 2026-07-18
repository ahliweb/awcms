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

## Belum tersedia (Sprint 3+)

Evaluator ABAC penuh (business-scope/office hierarchy, segregation-of-duties), endpoint manajemen user/role (`/users`, `/roles`), MFA/OIDC/SSO/Turnstile.
