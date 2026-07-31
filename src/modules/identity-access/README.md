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

## Dynamic ABAC policy evaluator (Issue #179)

Sampai Issue #179, `evaluateAccess` tidak pernah membaca baris `awcms_abac_policies` — otorisasi hanya RBAC + guard bawaan (dan CRUD flat #171 di `/api/v1/abac/policies` menulis tabel yang tak pernah dievaluasi). Issue ini menghubungkan **kebijakan tersimpan** ke chokepoint `authorizeInTransaction` secara **default-deny** tanpa melemahkan guard yang ada. Keputusan penuh (DSL, precedence, cache, dua permukaan) ada di **[ADR-0033](../../../docs/adr/0033-abac-dynamic-policy-evaluator.md)**; ringkasannya:

- **DSL (`domain/abac-policy.ts`).** `conditions` = AST jsonb terbatas: node `allOf`/`anyOf`/`not` dan leaf `{attr, op, value}` atau `{attr, op, valueAttr}` (attr-ke-attr untuk cek kepemilikan). Attribute dari **allow-list server-side** (`subject.*` dari context terautentikasi — bukan body klien; `resource.*` dari `request.resourceAttributes` yang wajib diisi endpoint dari resource nyata; `action`; `env.*` server-derived, `env.ipTrusted` default `false`). Operator: `eq/ne/in/nin/lt/lte/gt/gte/exists` (perbandingan hanya numeric/date). `dsl_version` mulai 1. Parser/validator **fail-closed**; keanggotaan allow-list **own-property saja** (`hasOwnProperty`) agar key prototype (`__proto__`/`constructor`/…) tak lolos.
- **Evaluator (`domain/abac-evaluator.ts`).** Interpreter **murni** atas AST — tanpa `eval`/`new Function`/dynamic import/SQL. `evaluateAccess` memperoleh param opsional ke-5 `abac?: { policies, env }` (setelah `businessScopeFacts` param ke-4); bila absen/kosong → ABAC no-op (semua call site lama ≤4 argumen tak terpengaruh).
- **Precedence (fail-closed).** Setelah guard bawaan (tenant isolation, self-approval, force-decision, business-scope #180) dan filter applicability (nullable = wildcard): (1) **DENY eksplisit menang** — `deny` terpenuhi, kebijakan aktif invalid, atau error evaluasi apa pun → DENY, **sebelum** cek RBAC; (2) **permission RBAC tetap wajib** — `allow` tak pernah menciptakan permission; (3) `allow` sebagai **constraint** — bila ada yang applicable, minimal satu harus terpenuhi, jika tidak → DENY (`abac_allow_unsatisfied`). Enforcement SoD #181 tetap additif setelah keputusan ini.
- **Cache (`application/policy-cache.ts`).** Kebijakan aktif **DSL-managed** dikompilasi sekali per tenant, di-cache in-process **tenant-keyed**, di-invalidasi **deterministik** oleh setiap create/update/enable/disable **dari kedua permukaan** (`invalidatePolicyCache` **setelah commit**). `queryAndCompile` memfilter `is_active AND is_dsl_managed` — hanya kebijakan DSL yang dievaluasi. Load selalu di `withTenant` (RLS + `awcms_app`). Batasan: invalidasi per-proses (multi-instance butuh LISTEN/NOTIFY/TTL).
- **Dua permukaan authoring — hanya DSL yang dikonsumsi.** Baru (DSL, #179): `GET/POST /api/v1/access/policies`, `GET/PUT /api/v1/access/policies/{id}`, `POST /api/v1/access/policies/{id}/{enable,disable}` (guard `identity_access.abac_policies.{read,configure}`, DSL penuh, audited) + `POST /api/v1/access/policies/simulate` (guard `.analyze`, read-only, audit tanpa decision log; subjek asing juga butuh `access_control.read`) + `POST /api/v1/access/evaluate` (mencerminkan keputusan nyata). Permission di-seed `sql/032`, kolom DSL `sql/031`. Lama (#171): `/api/v1/abac/policies` flat — hanya `effect`/`description`/`is_active`, **tak bisa** di-scope/dikondisikan. **Diskriminator `is_dsl_managed`** (`sql/031`, default `false`): baris flat **tidak pernah dibaca evaluator** (kalau tidak, sebuah `deny` flat = wildcard + selalu-benar = men-deny SETIAP request = brick tenant tanpa pemulihan in-band); **hanya** permukaan DSL menyetel `is_dsl_managed = true` (INSERT + UPDATE). Baris flat tetap inert (perilaku pra-#179); invalidasi cache-nya kini no-op defensif; migrasi `sql/031` deploy-safe. **Part B**: validator DSL (`validateAbacPolicyInput`) menolak `deny` yang unscoped + unconditional (`{allOf:[]}`) — footgun deny-semua ditutup di kedua permukaan. Lihat [ADR-0033](../../../docs/adr/0033-abac-dynamic-policy-evaluator.md) §3.
- **Contoh (bukan base).** Base **tidak** menyertakan kebijakan domain. Lima contoh ERP ada di `fixtures/abac-example-policies.json` untuk di-author lewat API.

## Business-scope hierarchy (Issue #180)

Lapis authorization organisasi **generik** di atas tenant + role — membatasi akses berdasarkan hierarki organisasi (legal entity, branch, office, department, cost center, project) tanpa memasukkan entitas domain ERP nyata ke base. Diport dari awcms-mini (Issue #746), **dilucuti** dari segregation-of-duties (SoD, itu Issue #181). Detail penuh: [ADR-0030](../../../docs/adr/0030-business-scope-hierarchy-generic-authorization-layer.md).

- **Referensi generik + capability port.** `scope_type`/`scope_id` adalah referensi generik (bukan FK ke tabel organisasi). Validitas/ancestry di-resolve lewat `BusinessScopeHierarchyPort` (`_shared/ports/business-scope-hierarchy-port.ts`, ADR-0011) yang disediakan sebuah **modul penyedia** capability tersebut. Base mengirim resolver **no-op** (`business-scope-hierarchy-port-adapter.ts`, `resolved: false` untuk semua scope type) — jadi di base-murni tanpa provider, create assignment selalu menolak `scope_unresolved` dan aksi high-risk bergerbang-scope selalu ditolak (fail-closed by design). `identity_access` mendeklarasikan `capabilities.consumes` `business_scope_hierarchy` (`optional: true`); fixture test-support `tests/fixtures/example-domain-modules/` mengirim resolver dummy untuk uji.
- **Skema (`sql/027`, seed `sql/028`)** — dua tabel tenant-scoped RLS `FORCE`: `awcms_business_scope_assignments` (subject→scope, role opsional, effective dating, `is_temporary`, status active/expired/revoked, grantor/approver/revoker) + `awcms_business_scope_assignment_events` (lifecycle **append-only**). Setiap FK subject/role/actor adalah **FK komposit `(tenant_id, …)`** — RI check PostgreSQL melewati RLS (GHSA-r7cx-c4jh-cvvw/sql/020), jadi FK single-column bisa lintas-tenant walau FORCE aktif; komposit + RLS menutupnya (dibuktikan `tests/integration/business-scope.integration.test.ts` di bawah `awcms_app`).
- **Integrasi `evaluateAccess`.** Parameter ke-4 opsional `businessScopeFacts` (backward-compatible — call site lama tak berubah). Request opt-in lewat `resourceAttributes.requiredScopeType`/`.requiredScopeId` (+ `requiredScopeRelations`, subset `exact`/`descendant`/`ancestor`, default `["exact"]`). Relasi didukung: **exact, descendant, ancestor, tenant-wide** (`scopeType === "tenant"`). Fakta subjek di-resolve dulu (`business-scope-facts.ts`) agar evaluator tetap murni. `authorizeInTransaction` menerima `options.hierarchyPort` opsional untuk me-resolve + thread fakta.
- **Fail-closed.** Unknown scope type / unresolved / stale hierarchy → default-**DENY** untuk aksi high-risk. `resolved: false` ≠ "resolved dengan ancestor kosong": coverage descendant/ancestor hanya dari fakta `resolved`, dan exact-match aksi high-risk butuh `resolved: true` (predikat mutation-tested RED).
- **Effective dating & revocation segera.** `isBusinessScopeAssignmentCurrentlyActive(row, now)` adalah gerbang otoritatif (status = cache). Revoke/expiry berdampak pada keputusan authz berikutnya **tanpa** menunggu job. Job terjadwal `identity-access:business-scope:expiry` (worker) membalik `status` + tulis event/audit sebagai housekeeping.
- **Endpoint** — `GET`/`POST /api/v1/identity/business-scope/assignments` (list/create; create high-risk, `Idempotency-Key` wajib, self-grant ditolak), `POST …/{id}/revoke`. Guard `identity_access.business_scope_assignments.{read,create,revoke}` default-deny; create/revoke/expire diaudit.

## Segregation of duties (SoD, Issue #181)

Lapis pembatas SoD **generik** di atas business-scope hierarchy #180 — deteksi konflik pasangan/kelompok permission + exception/override, default-deny, audit-ready. Diport dari awcms-mini (Issue #746), mengisi seam yang #180 tinggalkan. Detail penuh: [ADR-0031](../../../docs/adr/0031-segregation-of-duties-conflict-enforcement.md).

- **Rule descriptor code-only (#178/#181).** `SoDRuleDescriptor` (`_shared/module-contract.ts`) dideklarasikan `module.ts` modul pemilik (`sodRules`) — pasangan `conflictingPermissionKeys` (≥2), `scopeApplicability` (`same_scope_only`/`global_within_tenant`/`any`), `severity`, `exceptionPolicy`. **Base tidak men-hardcode rule domain**; rule mengalir lewat `listModules()` dari modul domain. Contoh ilustratif (≥5) hidup di fixture test-support `tests/fixtures/example-domain-modules/`, **bukan** modul base. Gate `bun run identity-access:sod-registry:check` (`domain/sod-rule-registry.ts`) memvalidasi registry; drift (duplicate ruleKey/owner mismatch) → CI merah.
- **Matcher murni + dua sumber fakta.** `domain/sod-conflict-evaluation.ts` (tanpa I/O) mendeteksi konflik; fakta subjek di-resolve `business-scope-facts.ts` (`resolveSoDAssignmentFacts`), **menggabung** permission dari assignment business-scope **dan** grant RBAC biasa (`awcms_access_assignments`). `same_scope_only` hierarchy-aware (fakta di ancestor/descendant scope dihitung match); tanpa `requestedScope` → INDETERMINATE (default-deny).
- **Enforcement dua titik.** Assignment-time: `createBusinessScopeAssignment` menolak `sod_conflict`. Action-time (**fail-closed**): `high-risk-sod-guard.ts` di-wire ke `authorizeInTransaction` untuk setiap aksi high-risk (deny-overrides-allow) — konflik diperiksa saat **eksekusi**, bukan hanya assignment.
- **Exception = administrative override tersanksi (`sql/029`).** `awcms_sod_conflict_exceptions` (RLS FORCE): scope-bound, time-bound (`effective_to` NOT NULL), revocable, audit `critical`. **Tidak boleh self-approved** (approver ≠ requester, dicek-ulang dari baris; permission approve khusus). Expired/revoked **segera** tak berlaku (`isSoDConflictExceptionCurrentlyValid`: `effective_to` vs `now`, status hanya cache). FK komposit `(tenant_id, …)` + RLS → exception tenant A tak bisa dipakai tenant B (dibuktikan di bawah `awcms_app`).
- **Decision log append-only.** `awcms_sod_conflict_evaluations` merekam setiap cek (proyeksi aman, tanpa payload). Evaluasi bounded/non-N+1 (query count tetap terhadap ukuran subjek). Job expiry membalik exception `approved` yang lewat menjadi `expired`.
- **Endpoint** — `GET /api/v1/identity/business-scope/conflicts` (preview/log, keyset), `GET`/`POST …/exceptions` (list/request; create `Idempotency-Key` wajib), `POST …/exceptions/{id}/approve|reject|revoke`. Guard `identity_access.business_scope_conflicts.read` + `business_scope_exceptions.{read,create,approve,reject,revoke}` default-deny (seed `sql/030`).

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
- **Break-glass, sisi kedua (drift setelah save).** Jaminan di atas adalah jaminan **saat simpan**, dan eligibility bukan properti policy — ia properti `awcms_identities`/`awcms_tenant_users`. Menonaktifkan identity itu lewat `PATCH /api/v1/users/{id}` (atau mencabut membership-nya) membuat policy yang tersimpan menjadi salah **tanpa policy-nya pernah disentuh**, lewat aksi administrasi user biasa yang tak terlihat berkaitan dengan SSO. `scripts/security-readiness.ts` `checkSsoBreakGlassReady` (critical) menutup itu: menurunkan ULANG eligibility tiap tenant aktif dengan `fetchEligibleBreakGlassIdentityIds` + `evaluateBreakGlassRequirement` yang **sama** (bukan salinan aturan), satu `withTenant` per tenant karena tabel policy FORCE RLS, tanpa cap. Terbukti lewat mutasi: mengganti hitungan eligible dengan `breakGlassIdentityIds.length` memerahkan 4 test integrasi. Lihat [`docs/awcms/oidc-sso.md`](../../../docs/awcms/oidc-sso.md) §4.
- **Admin & audit** — provider CRUD (`sso_providers.{read,create,update,delete}`) & policy (`sso_policy.{read,update}`), soft delete, audit high severity (link/unlink/provider/policy/JIT/login outcome) tanpa token/claim/secret mentah.

Detail lengkap (auth flow, setup provider, break-glass SOP, privacy mapping, threat model): [`docs/awcms/oidc-sso.md`](../../../docs/awcms/oidc-sso.md) dan [ADR-0028](../../../docs/adr/0028-oidc-sso-tenant-aware-account-linking-break-glass.md).

## Password reset lewat email (Gelombang 2 delta auth)

Diadaptasi dari awcms-micro Issue #496. Dua endpoint publik + dua halaman:
`POST /api/v1/auth/password/forgot`, `POST /api/v1/auth/password/reset`,
`/forgot-password`, `/reset-password`.

- **Skema (`sql/073`)** — satu tabel tenant-scoped RLS `ENABLE`+`FORCE`:
  `awcms_password_reset_tokens` (`token_hash` sha256 dari 32 byte CSPRNG —
  token mentah TIDAK PERNAH disimpan, `expires_at`, `used_at` untuk single-use).
  Grant `awcms_worker` hanya `SELECT, DELETE` (mesin purge `data_lifecycle`
  `generic`; worker tak pernah menerbitkan maupun menebus token).
- **Aman terhadap enumerasi akun, secara konstruksi** — `requestPasswordReset`
  mengembalikan `outcome: "ineligible"` yang **identik** untuk identifier tak
  dikenal, identity/tenant-user non-aktif, tenant non-aktif, identity SSO-only,
  dan identifier yang bukan alamat email; route selalu membalas 200 dengan body
  yang sama. Perbedaannya hanya hidup di audit log (tenant-scoped, RLS,
  tak pernah jadi bagian response). `login.ts` sudah memakai prinsip yang sama
  untuk 401-nya.
- **Sisi gagal juga generik** — `PASSWORD_RESET_INVALID` untuk not-found,
  expired, already-used, identity dinonaktifkan setelah token terbit, dan
  password-login dimatikan setelah token terbit. Endpoint ini karena itu bukan
  oracle status token.
- **Single-use di DATABASE, bukan di JS** — pembacaan token memakai
  `FOR UPDATE`. Tanpa row lock, dua penebusan link yang sama sama-sama membaca
  `used_at IS NULL` dan **keduanya** berhasil me-reset password (terbukti merah
  saat mutasi di `tests/integration/password-reset.integration.test.ts`). Pola
  yang sama dengan counter anti-replay MFA (#184).
- **Menghormati policy SSO-only** — `isPasswordLoginDisabledForIdentity`
  dicek di JALUR PERMINTAAN **dan** dibaca ULANG saat penebusan, jadi link yang
  masih hidup tidak selamat dari tenant yang mematikan password login. Tanpa
  ini, reset password adalah cara resmi tanpa autentikasi untuk membuat password
  yang berfungsi pada tenant yang sengaja mematikannya.
- **Reset mencabut SEMUA sesi** — `revokeAllSessionsForIdentity`; sesi `aal2`
  ikut mati karena `mfa-session-assurance.ts` memperlakukan `revoked_at` sebagai
  hilang. Lockout (`failed_login_count`/`locked_until`) dibersihkan: pemegang
  link sudah membuktikan kendali atas mailbox.
- **Pengiriman lewat capability port** — `identity_access` TIDAK menulis ke
  `awcms_email_messages` (tabel milik `email`, ADR-0013 §6; original micro
  menulis langsung). Port `auth_notification`
  (`_shared/ports/auth-notification-port.ts`), adapter dimiliki `email`, di-wire
  di composition root (route). Bukan `dependencies`: `email` sudah bergantung
  pada `identity_access`, jadi arah sebaliknya akan menutup siklus.
  Tenant tanpa template `auth.password_reset` aktif → `delivery_unavailable`
  (warning di log + audit), response tetap generik.
- **Link** — `${APP_URL}/reset-password?token=…&tenantId=…`, atau satu `?p=`
  opaque AES-256-GCM bila `AUTH_URL_PARAM_ENCRYPTION_KEY` diset
  (`lib/security/secure-url-params.ts`). Fallback plain bukan kelemahan: token
  sudah 256-bit CSPRNG dan tenant id bukan rahasia.
- **Rate limit + Turnstile** — per `clientIp:tenantId` pada KEDUA endpoint,
  dicek sebelum menyentuh DB; Turnstile memakai action `password_reset` sendiri
  (token dari form login tidak bisa di-replay ke sini).

## Self-registration ber-persetujuan admin (Gelombang 2 delta auth)

Diadaptasi dari awcms-micro. `POST /api/v1/auth/register` (publik) +
`/register`, antrean `/admin/registrations`, dan tiga endpoint admin
(`GET /api/v1/registration-requests`, `.../{id}/approve`, `.../{id}/reject`).

- **MATI secara default** (`AUTH_SELF_REGISTRATION_ENABLED`, `sql/074`–`075`).
  Endpoint publik yang selalu hidup dan menulis baris adalah permukaan spam yang
  akan diwarisi SETIAP deployment. Saat mati endpoint menjawab `404` — jawaban
  yang sama dengan rute yang tidak ada, jadi saklarnya tak bisa ditemukan lewat
  probing. Ini gerbang tingkat DEPLOYMENT (seperti `AUTH_MFA_ENABLED`), jadi
  menyalakannya membuka registrasi untuk SEMUA tenant; granularitas per-tenant
  adalah follow-up yang dicatat, bukan yang dipura-purakan ada.
- **Tidak pernah membuat akun.** Submit publik hanya menulis baris `pending` di
  `awcms_registration_requests`; ia menolak field privilese apa pun (`roleIds`,
  `status`, `tenantUserId`) dan TIDAK menerima password sama sekali.
  Validator mengembalikan tepat dua field, dan itu ditegakkan dua arah (runtime
  key-set + struktural "field apa saja yang dibaca dari body").
- **TIDAK menyimpan kredensial — menyimpang dari micro secara sengaja.** Versi
  micro menyimpan hash argon2id yang dipilih penyubmit anonim tak terverifikasi
  untuk akun yang mungkin tak pernah ada. Di sini approval membuat identity
  dengan **password tak terpakai** (hash dari 32 byte CSPRNG yang langsung
  dibuang) lalu menerbitkan link password-reset lewat jalur `requestPasswordReset`
  yang sama dengan `/forgot-password`. Pelamar membuktikan kendali mailbox
  sebelum bisa masuk; request yang ditolak/terbengkalai tak meninggalkan
  kredensial apa pun; dan banjir spam tak lagi berarti banjir hash argon2id.
- **Aman terhadap enumerasi.** Alamat yang sudah punya akun, request yang sudah
  pending, tenant non-aktif, dan request baru semuanya membalas 200 identik.
  "Alamat ini sudah terdaftar" adalah kalimat paling berguna yang bisa didapat
  penyerang di sini — justru itu tak pernah diucapkan. Audit mencatat mana yang
  terjadi (TANPA alamatnya, untuk submit yang gagal).
- **`approve` dan `reject` permission TERPISAH** (`registration_requests.*`,
  activity baru — `access_control` adalah katalog RBAC, bukan otoritas menerima
  orang; `/api/v1/users` di repo ini read-only, jadi approval adalah jalur admin
  PERTAMA yang memunculkan identity). Hanya salah satunya membuat akun.
- **Approval anti-balapan.** Baris dikunci `FOR UPDATE` dengan predikat
  `status = 'pending'`. Tanpa lock, dua reviewer bersamaan memicu 23505 di
  tengah transaksi → 500 bagi reviewer yang tak salah apa-apa; dengan lock yang
  kedua dapat `not_found` → 404 yang bersih. Terbukti lewat mutasi.
- **`roleIds` opsional dan default kosong** — approval tak pernah memberi role
  diam-diam. Role tak dikenal menolak SELURUH approval, bukan memberi subset.
- **Reject tak memberi tahu siapa pun** — email penolakan mengonfirmasi ke
  penyubmit anonim bahwa tenant ini ada dan me-review mereka, yaitu justru
  pengungkapan yang ditolak endpoint publiknya.
- Baris ter-review dipurge mesin `data_lifecycle` GENERIC (default 90 hari,
  lantai 7 hari agar audit `registration_approved` masih menunjuk sesuatu);
  grant worker `SELECT, DELETE` saja.

## Layar admin `/admin/security` (Gelombang 2 delta auth)

Endpoint policy autentikasi sudah ada sejak #184/#185; **layarnya belum**, jadi
sampai sekarang satu-satunya cara mengubah policy tenant adalah `curl` tangan.

- **Tidak menambah enforcement apa pun.** Setiap mutasi mem-POST ke endpoint
  asli (`PATCH /api/v1/auth/sso-policy`, `PUT /api/v1/auth/mfa/policy`) dan
  mewarisi guard ABAC, aturan break-glass, serta baris auditnya. Pengecekan
  permission di halaman itu UX belaka.
- **Gate memakai kunci permission PERSIS milik endpoint**, termasuk
  `mfa_admin.reset` sebagai gate BACA MFA — terlihat seperti salah tapi memang
  itu yang diminta `GET /api/v1/auth/mfa/policy`. Mengarang `mfa_admin.read`
  yang tak di-seed migrasi mana pun = jebakan latent-authz yang sudah dua kali
  menggigit repo ini; `tests/admin-security-page-contract.test.ts` memerahkan
  3 test bila kunci halaman menyimpang dari kunci endpoint.
- **Postur deployment ditampilkan read-only** (profil online-security,
  Turnstile, saklar MFA/SSO). Tanpa itu, policy tenant tak bisa dinilai:
  `ssoRequired` saat `AUTH_SSO_ENABLED=false` menghasilkan tenant yang tak bisa
  login sama sekali — kontradiksi yang sekarang muncul sebagai peringatan,
  bukan diam. Tak ada nilai secret yang dirender.
- **Picker break-glass memakai IDENTITY id**, bukan tenant_user id (kolom
  policy menyimpan identity id; keduanya uuid, jadi salah pilih akan diterima
  endpoint lalu disaring jadi daftar kosong — no-op senyap tepat di tempat
  operator berusaha menjaga dirinya tetap bisa masuk). `listBreakGlassCandidates`
  memakai predikat yang identik dengan `fetchEligibleBreakGlassIdentityIds`;
  `tests/integration/admin-security-policy.integration.test.ts` mengikat
  keduanya (identity non-aktif, membership non-aktif, identity locked, lintas
  tenant).
- **`409 BREAK_GLASS_REQUIRED` ditampilkan spesifik**, bukan dikolaps jadi
  "gagal menyimpan": pemanggilnya admin terautentikasi yang sudah memegang
  `sso_policy.update`, jadi tak ada yang bocor — sementara pesan generik akan
  membuatnya mencoba ulang perubahan yang tak akan pernah diterima server.
- CRUD provider OIDC tetap API-only (daftar read-only di layar). Form yang
  mem-POST client secret layak jadi perubahan tersendiri.

## Kredensial mesin + introspeksi sesi (ADR-0049)

Fitur fondasi PERTAMA yang dirintis langsung di repo ini di bawah pembekuan
[ADR-0047](../../../docs/adr/0047-mini-micro-frozen-foundation-built-here.md) —
dan karenanya tercatat sebagai divergence di `awcms-family-compatibility.yaml`.
Skema: `sql/082` (tabel + kolom `machine_credential_id` pada decision log),
`sql/083` (permission).

**Masalah yang ditutupnya.** Satu-satunya bearer yang diterima repo ini adalah
token **sesi** ber-hash. Sebuah build tidak bisa memegangnya: sesi kedaluwarsa,
dicabut seluruhnya saat password reset (`sql/073`), dan dirotasi step-up MFA
(`sql/024`). Akibatnya `awcms-astro` tidak bisa menarik kontennya sendiri.

**Bentuknya.**

- `awcms_machine_credentials` — tenant-scoped, `FORCE` RLS, terikat komposit
  `(tenant_id, tenant_user_id)` ke satu **service account** yang sudah ada.
- Token: `awcmsm_<tenantIdHex32>_<rahasia>`; **membawa tenant-nya sendiri**,
  jadi klien build cukup satu env var dan header tenant tidak relevan untuknya
  (header yang berbeda diabaikan — token yang menang).
- Hash disimpan di ruang nama `mc-sha256:`. `hashSessionToken()`
  **men-dispatch** berdasarkan prefix token, sehingga 183 rute yang sudah
  memanggilnya di antara `resolveAuthInputs` dan `authorizeInTransaction`
  mendapat perilaku ini tanpa perubahan tanda tangan.
- **MENGAUTENTIKASI, tidak pernah MENGOTORISASI**: setelah prinsipal resolve,
  rantai module-enabled → RBAC → ABAC → decision log → SoD berjalan apa adanya.
- **Baca-saja**, ditegakkan SEBELUM izin dilihat: hanya action `read`. Token
  yang bocor tak bisa mengubah apa pun walau service account-nya `owner`.
- **Menyempitkan, tak pernah melebarkan**: izin efektif = irisan
  `allowed_permission_keys` dengan izin service account.
- `expires_at` wajib (maks 365 hari), pencabutan berlaku di permintaan
  berikutnya, `last_used_at` disegarkan paling sering sekali per jam.
- Decision log mencatat **kredensial mana** yang bertindak, bukan hanya akunnya.

**Endpoint.** `GET`/`POST /api/v1/access/machine-credentials`,
`POST /api/v1/access/machine-credentials/{id}/revoke` (permission
`identity_access.machine_credentials.read`/`create`/`revoke`). Plaintext token
hanya muncul **sekali** saat penerbitan; tidak ada endpoint yang bisa
mengembalikannya lagi — dan penerbitan sengaja **tidak** ber-`Idempotency-Key`,
karena me-replay-nya berarti menyimpan token plaintext di
`awcms_idempotency_keys`.

**`GET /api/v1/auth/session`** — introspeksi sesi untuk BFF lintas-origin
(ADR-0045). Klaim aman saja (`identityId`, `tenantId`, `displayName`, `roles`,
`assuranceLevel`, `expiresAt`, `scopes`), **tanpa** identifier mentah yang
`GET /auth/me` kembalikan. Satu bentuk 401 untuk semua kegagalan — termasuk
saat kredensial mesin yang disodorkan, supaya endpoint ini tak bisa dipakai
mengklasifikasi bearer. `private, no-store` di setiap jalur, dibatasi laju
per sumber.

**Jebakan yang ditemukan saat membangunnya.** `Bun.SQL` **tidak** mem-bind array
JS sebagai array Postgres: `${["a","b"]}` sampai ke server sebagai teks `a,b`
(22P02 "malformed array literal"), dan bentuk satu elemen paling berbahaya
karena tiba sebagai `a` yang terlihat seperti string biasa. Pakai
`toPostgresTextArray(...)::text[]`.

## Belum tersedia (Sprint 3+)

Endpoint manajemen user/role lanjutan. Follow-up yang dicatat:
self-registration masih gerbang tingkat deployment (belum per-tenant), dan CRUD
provider OIDC masih API-only (daftar read-only saja di `/admin/security`).
