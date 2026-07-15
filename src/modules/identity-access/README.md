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

## Auth flow

`POST /api/v1/auth/login` — header `X-AWCMS-Tenant-ID` wajib, rate limit per `clientIp:tenantId` (backstop di luar lockout per-identity), verifikasi password, set cookie httpOnly (`awcms_session`/`awcms_tenant_id`) + kembalikan token untuk klien API. `POST /api/v1/auth/logout` merevoke sesi. `GET /api/v1/auth/me` hanya menerima bearer token.

## RBAC/ABAC

`domain/access-control.ts` — `evaluateAccess()`: default deny, deny overrides allow, permission diidentifikasi `module_key.activity_code.action`. `application/access-guard.ts` — `authorizeInTransaction()` adalah satu-satunya chokepoint yang dipanggil setiap route terproteksi.

## Belum tersedia (Sprint 3+)

Evaluator ABAC penuh (business-scope/office hierarchy, segregation-of-duties), module-management (enable/disable modul per tenant — `authorizeInTransaction` belum mengecek status modul), endpoint manajemen user/role (`/users`, `/roles`), MFA/OIDC/SSO/Turnstile.
