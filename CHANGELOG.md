# awcms

## 6.0.0

### Major Changes

- 0f39650: refactor(module-composition)!: hapus penuh jalur aplikasi-turunan (ADR-0034 §3, Fase 2)

  Menghapus permukaan yang khusus jalur aplikasi-turunan sesuai keputusan ADR-0034 §3 (awcms = template dipakai-langsung, tidak ada repo derivatif): seam `src/modules/application-registry.ts`, gerbang `bun run extension:check` (`scripts/extension-check.ts`, dari script `check` + ci.yml), konsep migration namespace turunan 900-999, dan tipe komposisi `ApplicationModuleRegistry`/`ModuleMigrationNamespace`.

  `src/modules/module-management/domain/module-composition.ts` kini memvalidasi satu registry base (`validateComposedModuleRegistry(registry)`/`composeModuleRegistry(registry)`/`buildComposedModuleInventory(registry)` menerima `readonly ModuleDescriptor[]`, bukan `{ base, application }`); check turunan-only (`prohibited_base_override`, `invalid_module_type`, `migration_namespace_overlap`) dan `mergeModuleRegistries` dihapus. Check base-load-bearing (DAG, duplicate module key, capability binding, deployment profile, navigation, job descriptor) dipertahankan. `MODULE_CONTRACT_VERSION` naik `1.3.0` → `2.0.0` (MAJOR: tipe diekspor dihapus); manifest keluarga disesuaikan.

  Fixture `tests/fixtures/derived-application-example/` direlokasi jadi test-support non-derived `tests/fixtures/example-domain-modules/` (mengekspor `exampleDomainModules`) — cakupan test #178/#180/#181/#182 dipertahankan setara. Gate `modules:compose:check` + `modules:composition:inventory:check` tetap ada (validasi registry base); `docs/awcms/module-composition-inventory.json` diregenerasi. Tanpa migration.

### Minor Changes

- f7d15bf: Dynamic ABAC policy evaluator (Issue #179, epic #177) — the stored
  `awcms_abac_policies` rows are now CONSUMED at the `authorizeInTransaction`
  chokepoint (default-deny), instead of authorization resting on RBAC + built-in
  guards alone. Ported from awcms-mini (ADR-0033).

  - **Bounded condition DSL (`domain/abac-policy.ts`).** `conditions` is a
    versioned jsonb AST (`sql/031` adds `dsl_version`/`conditions`/`priority` +
    nullable applicability columns): `allOf`/`anyOf`/`not` composition and
    `{attr, op, value|valueAttr}` leaves over a closed, server-side attribute
    allow-list (`subject.*` from the authenticated context — never the request
    body; `resource.*` from the endpoint-populated verified resource; `action`;
    `env.*` server-derived, `env.ipTrusted` fail-closed `false`) and a fixed
    operator set (`eq/ne/in/nin/lt/lte/gt/gte/exists`). No `eval`, no `new
Function`, no dynamic import, no templated SQL. The parser/validator is
    fail-closed and allow-list membership is **own-property only**
    (`hasOwnProperty`) so prototype-chain keys (`__proto__`/`constructor`/…)
    cannot slip past the unknown-attribute check (fail-OPEN closed at both the
    authoring validator and the eval-time backstop).
  - **Pure evaluator (`domain/abac-evaluator.ts`) + precedence.**
    `evaluateAccess` gains an optional 5th param `abac?: { policies, env }` (after
    `businessScopeFacts`); omitted/empty = ABAC no-op, so every pre-existing ≤4-arg
    call site is behavior-identical. Precedence after the built-in guards
    (tenant isolation, self-approval, force-decision, business-scope #180): explicit
    DENY wins (and an invalid/error policy fails closed) BEFORE the RBAC check; the
    RBAC permission is still required (an allow-policy never creates one); applicable
    ALLOW policies act as a constraint (≥1 must be satisfied). The #181 SoD
    high-risk guard remains additive after the decision.
  - **Tenant-keyed cache (`application/policy-cache.ts`)** compiled once per tenant,
    invalidated deterministically after commit by EVERY policy mutation — both the
    new DSL surface AND the pre-existing flat `/api/v1/abac/policies` CRUD (#171),
    which now also invalidates so it can never bypass the evaluator. Per-process
    invalidation is a documented limitation.
  - **Two surfaces, one table — but the evaluator consumes ONLY DSL-managed
    policies.** A new `is_dsl_managed` discriminator (`sql/031`, default `false`)
    separates the two authoring surfaces: the flat #171 CRUD (which can set neither
    applicability nor a condition) leaves rows `is_dsl_managed = false`, and the
    cache loads ONLY `is_active AND is_dsl_managed` rows — so a flat row is NEVER
    evaluated and stays inert (its exact pre-#179 behavior). This closes a
    full-tenant lockout: a flat `deny` used to present as a wildcard, always-true
    DENY that bricked every request (including the operator's own
    `access_control.configure` — no in-band recovery); the migration is now
    deploy-safe (a pre-existing inert flat `deny` is not activated on migrate).
    Only the DSL surface sets `is_dsl_managed = true` (INSERT + UPDATE).
    Defense-in-depth: the DSL validator additionally REJECTS an unscoped +
    unconditional (`{allOf:[]}`) deny. See ADR-0033 §3.
  - **Admin API.** New `GET/POST /api/v1/access/policies`,
    `GET/PUT /api/v1/access/policies/{id}`,
    `POST /api/v1/access/policies/{id}/{enable,disable}` (guarded
    `identity_access.abac_policies.{read,configure}`, audited, only valid DSL is
    stored), `POST /api/v1/access/policies/simulate` (read-only, guarded `.analyze`,
    audited without a decision-log write), and `POST /api/v1/access/evaluate`.
    Permissions seeded in `sql/032`.
  - **Simulation foreign-subject authority gate.** Simulating a DIFFERENT existing
    tenant user resolves that user's real grants — an enumeration oracle — so it
    additionally requires `identity_access.access_control.read` (AWCMS has no
    `user_management` module; reading a user record is guarded by
    `access_control.read`); the probed subject id is recorded in the audit event.
  - **Decision log** records policy code + `dsl_version` + a static reason, never
    raw attribute values. Five illustrative ERP example policies ship in
    `fixtures/abac-example-policies.json` (not seeded into the base).

- 9db1da6: Implement audit log retention — `AUDIT_LOG_RETENTION_DAYS` is no longer a
  silent no-op (Issue #146).

  The variable was documented in `.env.example`, validated as an integer >= 1 by
  `scripts/validate-env.ts`, and described in doc 18 as being "dipakai job purge
  audit log". No such job existed. An operator who set it got unbounded growth of
  `awcms_audit_events` plus false confidence — worse than having no knob at all.
  Login now writes audit events without authentication (PR #157), so the table
  grows from unauthenticated traffic too.

  New `bun run logs:audit:purge` (`scripts/audit-log-purge.ts` +
  `src/modules/logging/application/audit-purge.ts`, ported from awcms-mini):

  - Deletes `awcms_audit_events` rows past the retention cutoff for every active
    tenant, in bounded batches (`DELETE ... LIMIT 5000`, oldest first) so a large
    backlog never holds one transaction open or locks the table unpredictably.
  - **Self-auditing**: each non-empty batch records its own purge as a new audit
    event in the same transaction (counts and cutoff only) — the table can never
    be emptied to "no evidence a purge happened".
  - Retention resolves as `--retention-days=<n>` > `AUDIT_LOG_RETENTION_DAYS` >
    730 days (2 years, the midpoint of doc 04's "1-5 tahun" range).
  - `--dry-run` counts what would be purged without deleting anything, sharing
    the cutoff computation with the real path so the preview cannot drift.
  - Runs through the shared job runner: advisory lock (no two concurrent runs on
    the same backlog), timeout, correlation id threaded into each purge event,
    structured telemetry, and `status: "partial"` when a tenant's backlog was not
    fully drained.
  - Registered as a `logging` module job descriptor; recommended daily, off-peak.

  Scope: `awcms_audit_events` only. `awcms_abac_decision_logs` (~8.6M rows/day at
  100 req/s) is deliberately untouched — it needs its own retention decision, and
  quietly bundling a delete policy for it here would be the wrong way to make it.

  Unlike mini's version, `purgeExpiredAuditEvents` takes no `LegalHoldGuardPort`:
  this base has no `data_lifecycle` module or legal-hold registry, and a guard
  with nothing behind it would always answer "not held" — a fake gate is worse
  than an honest absence. When a legal-hold registry lands, this function is the
  enforcement point and the parameter should be required, not optional.

- 9af1789: Deterministic build-time module composition seam for derived ERP applications
  (Issue #178, epic #177, ADR-0025 — implementing the design in ADR-0014). A
  derived repository can now contribute its own domain modules by editing only
  `src/modules/application-registry.ts` (default `undefined` in the base), without
  ever touching `src/modules/index.ts`. The base's effective `listModules()`
  registry is byte-identical (same order + object identity) to before this change.

  - `src/modules/index.ts` refactored to `baseModules` + `listBaseModules()` +
    `modules = mergeModuleRegistries(baseModules, applicationModuleRegistry)`;
    `listModules()`/`getModuleByKey()` behavior unchanged and the array reference
    stays stable (`descriptor-sync.ts` identity check preserved).
  - `src/modules/module-management/domain/module-composition.ts` — the pure
    validation engine (`composeModuleRegistry`/`validateComposedModuleRegistry`/
    `buildComposedModuleInventory`), reusing the existing DAG validator
    (`_shared/module-dependency-graph.ts`) and job validator
    (`module-management/domain/job-registry.ts`). Rejects: duplicate module key,
    prohibited base override, `type: base/system` from an application module,
    missing/cyclic dependency, capability provider conflict/missing,
    migration-namespace overlap (base reserves `1-899`), deployment-profile
    incompatibility, navigation path conflict, and invalid job descriptor.
  - `_shared/module-contract.ts` extended additively (`MODULE_CONTRACT_VERSION`
    1.1.0 → 1.2.0): `ModuleCapabilityContract`, `ModuleDescriptor.capabilities`,
    `ModuleCompatibilityContract.deploymentProfiles`, `ModuleMigrationNamespace`,
    and `ApplicationModuleRegistry`.
  - New gates wired into `bun run check` AND `.github/workflows/ci.yml`:
    `modules:compose:check`, `modules:composition:inventory:generate`/`:check`
    (deterministic `docs/awcms/module-composition-inventory.json`, no wall-clock),
    and `extension:check` (extension-seam health).

  No SQL migration, no API/event change. Full derived-application compatibility
  manifest validation (SemVer/checksum, ADR-0015) remains scheduled for Issue
  #183; `extension:check` currently validates the composition seam only.

- cad4ccb: Business-scope hierarchy generic authorization layer (Issue #180, epic #177
  Wave 2). Ports the generic business-scope FOUNDATION from awcms-mini (SoD
  enforcement #181 and the organization-structure domain module are deliberately
  excluded, with clean seams).

  - **Schema** (`sql/027` + seed `sql/028`) — two tenant-scoped, RLS
    `ENABLE`+`FORCE` tables: `awcms_business_scope_assignments` (subject→scope
    grant with effective dating, temporary expiry, revocation) and its
    append-only `awcms_business_scope_assignment_events` lifecycle history.
    Subject/role/actor FKs are COMPOSITE `(tenant_id, …)` (with new
    `UNIQUE (tenant_id, id)` on `awcms_tenant_users`/`awcms_roles`) so a
    cross-tenant subject/role cannot be referenced even though PostgreSQL RI
    checks bypass RLS (GHSA-r7cx-c4jh-cvvw / sql/020).
  - **Capability port** — `BusinessScopeHierarchyPort` (`_shared/ports/`, ADR-0011):
    `scope_type`/`scope_id` are GENERIC references; validity/ancestry come from a
    resolver a DERIVED app provides. The base ships a default NO-OP resolver
    (`resolved: false` for every scope type), so a pure-base deployment fails
    closed (assignment create denies `scope_unresolved`; scope-gated high-risk
    actions deny). `identity_access` declares `capabilities.consumes`
    (`business_scope_hierarchy`, optional); the in-repo fixture derived module
    provides a working dummy resolver.
  - **`evaluateAccess` integration** — new optional `businessScopeFacts` parameter
    (fully backward-compatible) with exact/descendant/ancestor/tenant-wide
    coverage. Unknown/unresolved/stale scope → default-DENY for high-risk actions
    (`resolved: false` is never treated as "no restriction"). Revocation/expiry
    takes effect immediately at the next decision (effective dating is the
    authoritative gate, not `status`).
  - **API** — `GET`/`POST /api/v1/identity/business-scope/assignments` and
    `POST …/{id}/revoke` (create/revoke high-risk, `Idempotency-Key` required,
    self-grant denied, audited). New permissions
    `identity_access.business_scope_assignments.{read,create,revoke}`.
  - **Job** — `identity-access:business-scope:expiry` transitions elapsed
    assignments to `expired` (append-only events + aggregate audit per tenant).
  - Docs: ADR-0030, ERD/data-dictionary, threat model (privilege expansion,
    stale cache, hierarchy cycle, scope spoofing), identity-access README, and
    derived-application guide (how a derived app provides the hierarchy resolver).

- 296b7e3: Narrow the `awcms_app` runtime DB role's blanket DML on the global, RLS-free
  tables (Issue #160, `sql/021_awcms_db_role_grants_narrow.sql`). Closes the
  residual documented by `sql/019`: `awcms_app` can no longer `DELETE`
  `awcms_tenants`, `DELETE` `awcms_schema_migrations`, or write `awcms_permissions`
  (now read-only), and loses `DELETE` on `awcms_setup_state`. The
  `INSERT`/`UPDATE`/`SELECT` that real code paths use (setup-wizard fallback,
  tenant-settings screen, module-registry sync) are kept.

  Deployment-affecting: apply the new migration with the migration-owner
  connection string, as usual. The worker/setup role split (mini's migration 045)
  remains deferred.

  Adds a `security:readiness` grant check ("Runtime role table grants match
  least-privilege matrix") that fails when `awcms_app` is over-granted on a global
  table or, critically, when a tenant-scoped table is RLS-forced but ungranted
  (`permission denied` at runtime) — the executing-role-bound `ALTER DEFAULT
PRIVILEGES` gap that the RLS-flag check cannot see.

- 9db1da6: Tambah role runtime least-privilege `awcms_app` (`sql/019_awcms_db_role_separation.sql`) — RLS akhirnya jadi batas keamanan nyata, bukan deklarasi kosong.

  Migration 017 (PR #139) menutup bypass **pemilik tabel** lewat `FORCE ROW LEVEL SECURITY` di 23 tabel, tapi PostgreSQL melewati RLS **tanpa syarat** untuk SUPERUSER/BYPASSRLS — dan `DATABASE_URL` selama ini adalah role migration owner (biasanya superuser). Artinya setiap policy `awcms_*_tenant_isolation` di repo ini masih inert saat runtime: isolasi tenant sepenuhnya bergantung pada klausa `WHERE tenant_id` di aplikasi. Migration 019 memport bagian ke-2 migration 013 (`enforce_rls_least_privilege`) dari awcms-mini:

  - `CREATE ROLE awcms_app NOLOGIN` (idempoten, tanpa password — password itu secret, diaktifkan operator lewat `ALTER ROLE awcms_app LOGIN PASSWORD '<secret>'`), bukan superuser, bukan BYPASSRLS, bukan pemilik tabel, hanya DML.
  - Default GUC fail-closed `app.current_tenant_id = '00000000-0000-0000-0000-000000000000'`: query yang menyentuh tabel RLS di luar `withTenant()` mendapat **nol baris**, bukan error `unrecognized configuration parameter` dan bukan data tenant lain.
  - `GRANT` minimal + `ALTER DEFAULT PRIVILEGES` supaya tabel baru tidak perlu boilerplate GRANT.

  **Aksi operator (deployment-affecting):** setelah `bun run db:migrate`, aktifkan LOGIN + password untuk `awcms_app` lalu arahkan `DATABASE_URL` runtime ke role itu, dan jalankan migrasi berikutnya dengan `DATABASE_URL` ditimpa ke connection string owner. Tanpa langkah ini aplikasi tetap jalan seperti sebelumnya (sebagai owner) — tapi tanpa lapisan RLS. Lihat doc 18 §Model role database.

  Sekaligus memperbaiki artefak fiktif yang menegaskan properti keamanan yang tidak dimiliki sistem (Issue #155): `client.ts` merujuk sebuah migration `045_awcms_db_role_separation` yang tidak pernah ada di repo ini, header `sql/014` mengklaim konvensi `FORCE` "sejak migration 002" (tidak benar sampai 017), `reporting/README.md` menyebut header `X-AWCMS-Mini-Tenant-ID` (sebenarnya `X-AWCMS-Tenant-ID`), `_shared/idempotency.ts` menyebut migration 012 (di sini 009), serta doc 13/18 yang mendaftarkan migration fiktif. `WORKER_DATABASE_URL`/`SETUP_DATABASE_URL` kini didokumentasikan jujur sebagai seam pool — **bukan** role `awcms_worker`/`awcms_setup` (itu migration 045 di awcms-mini, belum diport); operator yang mengikuti klaim lama akan mendapat `permission denied` di setiap job.

- 988aaae: Add the domain-event-runtime module: a transactional, versioned domain-event
  outbox and dispatcher ported from awcms-mini. Provider-neutral, generic,
  multi-consumer infrastructure — one published event fans out to many
  registered consumers with explicit per-aggregate/order-key ordering,
  exponential backoff, dead-letter handling, and operator-safe replay.

  - New migration `009_awcms_domain_event_runtime_schema.sql`: adds
    `awcms_domain_events` (append-only outbox), `awcms_domain_event_deliveries`
    (per-(event, consumer) retry/DLQ state), `awcms_domain_event_consumer_effects`
    (generic per-consumer idempotency marker),
    `awcms_domain_event_consumer_state` (pause/resume),
    `awcms_domain_event_replays` (append-only replay audit trail), and
    `awcms_domain_event_activity_daily` (reference read-model rollup). Also
    introduces the generic `awcms_idempotency_keys` store (first high-risk
    mutation to need `Idempotency-Key`). All tenant-scoped tables have RLS
    tenant-isolation policies with FORCE.
  - New REST endpoints under `/api/v1/domain-events` (events, deliveries,
    consumers, plus reason-required audited replay/pause/resume), all guarded
    by default-deny ABAC; replay is `Idempotency-Key`-guarded.
  - New AsyncAPI channel `awcms.domain-event-runtime.sample.recorded` with
    publish/subscribe operations.
  - New worker job `bun run domain-events:dispatch` (built on the shared job
    runner), safe in offline/LAN deployments.
  - Ships one self-contained reference event type and two representative
    consumers (a cross-module audit projector and a self-contained read-model
    activity-rollup projection). Registered in `src/modules/index.ts`.

- 66ee934: Add the email module: a reusable, provider-neutral transactional email
  service ported from awcms-mini (epic #492). Generic infrastructure —
  analogous to `sync_storage`'s object-storage port — for password reset,
  system announcements, and workflow notifications; Mailketing is one adapter,
  not a domain-specific feature.

  - New migration `014_awcms_email_schema.sql`: adds `awcms_email_templates`
    (per-locale `jsonb` bodies, soft-delete/restore), `awcms_email_messages`
    (outbox delivery queue, one row per recipient), `awcms_email_delivery_attempts`,
    and `awcms_email_suppression_list`. All tenant-scoped tables have RLS
    tenant-isolation policies with FORCE and FK indexes. Seeds the
    `email.{template,message,suppression,notification,announcement}.*` ABAC
    permissions.
  - New `EmailProvider` port with a real Mailketing adapter and a safe `log`
    adapter, resolved at one edge; provider calls happen strictly outside any
    DB transaction (ADR-0006), via an outbox + claim/send/finalize dispatcher
    (`bun run email:dispatch`) with retry/backoff, circuit breaker, and
    dispatch-time suppression re-check.
  - New REST endpoints under `/api/v1/email`: template CRUD + restore + preview
    (`/templates`), bulk announcement/notification enqueue + dry-run preview
    (`/announcements`, two-tier ABAC, `Idempotency-Key`-guarded), delivery-queue
    diagnostics + cancel (`/messages`), and suppression-list CRUD
    (`/suppressions`). All guarded by default-deny ABAC and audited.
  - Template management with per-category variable allowlists (fail-closed),
    i18n locale variants, and XSS-safe rendering (allowlist filtering +
    HTML-escaping).
  - New AsyncAPI channels `awcms.email.message.{queued,sent,failed,suppressed,cancelled}`
    (contract-only; the structured logger is the producer).
  - New worker jobs `bun run email:dispatch`, `bun run email:provider:health`,
    and `bun run email:templates:seed-defaults`. Registered in
    `src/modules/index.ts`.

  The password-reset flow, the `reporting` email-health endpoint, and the
  `security:readiness` provider-config gate from awcms-mini are intentionally
  out of scope for this port (their host modules/scripts do not exist in this
  repo yet).

- 87b0e38: Enforce two tenant-isolation controls that were declared but never actually
  applied. Both are ports of code already proven in awcms-mini.

  **Disabling a module now blocks its endpoints.** `authorizeInTransaction` did
  not check tenant module status, so `POST /api/v1/tenant/modules/{key}/disable`
  was cosmetic: the navigation hid the module and the audit event was recorded,
  but any actor still holding the module's permissions could call its API
  directly and keep working. `resolveModuleEnabled` is now checked before
  permissions are even looked up, so a disabled module is refused with
  `403 MODULE_DISABLED` regardless of what the actor was granted, and the denial
  is recorded to the decision log as `matchedPolicy: "module_disabled"`. This
  covers all 70 guarded endpoints at once. `module_management` is `isCore` and
  cannot be disabled, so a tenant can never lock itself out of re-enabling.

  **New migration `017_awcms_enforce_rls_force.sql`** adds `FORCE ROW LEVEL
SECURITY` to the 23 tenant-scoped tables that only `ENABLE`d it (migrations
  002-008, 010-012), including `awcms_identities`, `awcms_sessions`,
  `awcms_access_assignments` and `awcms_profiles`. PostgreSQL bypasses RLS for a
  table's owner unless `FORCE`, and the app connects as the migration owner via
  `DATABASE_URL` — so those tenant-isolation policies were never evaluated, and
  isolation rested entirely on application-level `WHERE tenant_id` clauses with
  RLS as a non-functioning backstop. Every one of the 23 tables already had
  `tenant_id` and a policy, so this only starts enforcing what was declared; all
  access paths already go through `withTenant()`.

  This closes the table-owner bypass only. A SUPERUSER/BYPASSRLS connection still
  bypasses RLS regardless of `FORCE`; closing that needs the least-privilege
  `awcms_app` role, which is deployment-affecting and tracked separately.

- d58cd7b: feat(foundation): family compatibility manifest + CI conformance gate against the AWCMS-Mini standard (Issue #183)

  Adds `awcms-family-compatibility.yaml` (machine-readable, versioned, schema-validated) declaring AWCMS's conformance to the AWCMS-Mini family standard: family/module/capability/API/tenant-context/audit/idempotency/migration contract versions, validated stack versions (Bun/Astro/@astrojs/node/TypeScript/PostgreSQL), and an explicit intentional-divergence allow-list (reason/owner/reviewDate/ADR). New `bun run family:conformance:check` gate (wired into `bun run check` + ci.yml, parity-tested) cross-references every declared version against the real source and fails on drift or an unreviewed/unbacked divergence, emitting a secret-free pass/fail evidence report. Semantic, mutation-provable contract tests pin the reusable controls (tenant-context fail-closed under FORCE RLS, response envelope, redaction, idempotency, migration immutability/checksum, module composition) so any weakening of default-deny/RLS/redaction/audit/idempotency turns conformance RED. No migration (tooling/docs only); ADR-0032; `docs/awcms/family-compatibility.md`.

- 13813bb: Audit trail dan pengerasan jalur login (Issue #145, #147).

  **Audit (#145)** — `POST /api/v1/auth/login` sebelumnya tidak menulis satu baris audit pun, sukses maupun gagal, padahal infra `recordAuditEvent` sudah dipakai 20+ endpoint lain dan `awcms_abac_decision_logs` tidak menutupi login (guard tak pernah jalan di jalur pre-auth). Post-incident, `awcms_audit_events` kosong dan `awcms_sessions` tidak menyimpan IP/UA — lebih buruk, reset `failed_login_count = 0` saat login sukses menghapus jejak brute-force yang mendahuluinya. Login kini menulis `login_succeeded`/`login_failed`, plus recorder out-of-band untuk kasus transaksi rollback (baris audit di dalamnya ikut hilang).

  Atribut audit dibatasi ke `method`/`reason`/`ipHash`/`userAgent` lewat `src/lib/security/client-fingerprint.ts` (port dari awcms-mini): `ipHash` adalah HMAC-SHA256 ber-key — stabil untuk mengelompokkan percobaan per sumber, tapi tidak reversible (sha256 tanpa key atas ruang IPv4 2^32 habis dibrute dalam hitungan detik). IP mentah tidak bisa dipersist (`redactSensitiveAttributes` menjadikannya `[REDACTED]`), dan `loginIdentifier` sengaja tidak diaudit: umumnya email/PII, dan menyimpan string dari penyerang pada percobaan gagal justru menciptakan kebocoran enumerasi.

  **Pengerasan (#147)** — empat lubang yang diwarisi dari awcms-mini:

  1. **Oracle timing** — identifier tak dikenal melewati argon2id (~0 ms) sementara yang dikenal membayar m=64MB (~75 ms), sehingga penyerang bisa memetakan akun mana yang eksis tanpa pernah menyentuh `failed_login_count` (lockout tak pernah menyala). Kini identifier tak dikenal tetap diverifikasi melawan dummy argon2id hash konstan.
  2. **Oracle pesan** — `locked` menjawab `"Account is temporarily locked."`, yang hanya mungkin muncul bila identifier eksis. Kini identik dengan `invalid_credentials`. `tenant_inactive` tetap dibedakan (tenant disebut caller di header; tidak membocorkan identity).
  3. **`X-Forwarded-For` dipercaya tanpa syarat** sebagai kunci rate limit. Pada topologi terekspos-langsung yang justru didokumentasikan repo ini, header itu dikendalikan penyerang: kirim nilai acak per request → bucket baru tiap kali → limit 20/60 detik tak pernah menyala. Kini hanya dipercaya bila `TRUSTED_PROXY_ENABLED=true` (default `false`).
  4. **Ambang env NaN mematikan kontrol secara diam-diam** — `Number(process.env.AUTH_LOGIN_MAX_ATTEMPTS ?? 5)` dengan nilai `5x` menghasilkan `NaN`, `failedLoginCount >= NaN` selalu `false`, lockout mati total tanpa peringatan. Helper `parsePositiveIntEnv` kini menolak non-finite/non-integer/`<= 0`, jatuh ke default, dan menulis `log("warning", ...)`.

  **Env baru (opsional, keduanya aman secara default):** `TRUSTED_PROXY_ENABLED` (default `false`) dan `AUTH_IP_HASH_SECRET` (meng-key HMAC `ipHash`; bila kosong/placeholder dipakai kunci acak per proses — tetap non-reversible, tapi `ipHash` tidak sebanding lintas restart/instance, dan satu warning ditulis).

  **Wajib saat upgrade:** deployment produksi harus menyetel `TRUSTED_PROXY_ENABLED`
  secara eksplisit — `bun scripts/validate-env.ts` kini menolak produksi yang
  membiarkannya kosong. Tidak ada default yang aman untuk dua topologi sekaligus:
  pada profil production repo ini (nginx TLS-termination) `false` membuat setiap
  request terlihat berasal dari IP nginx, sehingga bucket rate limit login runtuh
  jadi satu per tenant dan 20 login gagal per menit cukup untuk mengunci seluruh
  pengguna tenant tersebut; sebaliknya `true` pada app yang terekspos langsung
  membuat rate limit bisa dilucuti dengan merotasi header `X-Forwarded-For`.

- c9cef95: MFA TOTP, recovery codes, and step-up authentication (Issue #184, epic #177).
  Ported and adapted from awcms-mini. Adds encrypted-at-rest TOTP factors
  (AES-256-GCM, `AUTH_MFA_SECRET_ENCRYPTION_KEY`, no default key), single-use
  hashed recovery codes shown once, and a two-step login challenge with no
  account-enumeration oracle (the challenge branch is reached only after a valid
  password). Replay is prevented by a strictly-monotonic `last_used_step` advanced
  with a concurrency-safe compare-and-swap; recovery codes are consumed with the
  same CAS.

  Tenant enforcement policy (`optional` / `required_for_privileged` /
  `required_for_all`) is genuinely enforced at login: a valid-password identity
  that a policy requires MFA for but has no factor is issued an enrollment-scoped
  grant (never a full session) that authorizes only the enroll endpoints, then
  completes to an `aal2` session on enrollment — fail-closed but self-recoverable
  (no admin lockout).

  New: session assurance levels (`aal1`/`aal2`) on `awcms_sessions`, a
  server-controlled step-up gate (`requireStepUp`, `AUTH_MFA_STEPUP_TTL_SEC`) now
  wired to every high-risk MFA action (self-service disable, recovery-code
  regenerate, admin reset, and policy change); session rotation on an aal1→aal2
  rise (anti-fixation); a per-factor cumulative failed-verify lockout
  (`AUTH_MFA_MAX_VERIFY_ATTEMPTS`/`AUTH_MFA_LOCKOUT_MINUTES`) independent of source
  IP and challenge rotation; and an admin reset workflow gated on
  `identity_access.mfa_admin.reset` with a mandatory reason, `critical` audit, and
  no self-reset.

  New endpoints under `/api/v1/auth/mfa/*` (status, enroll start/verify, TOTP
  verify — public login-challenge completion, disable, recovery-codes regenerate,
  step-up, admin reset, policy get/set). Migration `sql/024` adds four
  tenant-scoped RLS-FORCE tables (factors, recovery codes, challenges, tenant
  policy) plus session-assurance columns and seeds the MFA admin permissions;
  recovery-code uniqueness is scoped per tenant. `config:validate` and
  `security:readiness` now require a valid 32-byte encryption key when
  `AUTH_MFA_ENABLED=true`. Existing login hardening is preserved unchanged.
  OIDC/SSO (#185) and Turnstile (#186) are intentionally out of scope.

- 9af1789: Modular OpenAPI contract per module + deterministic bundler and API docs
  (Issue #182, epic #177, ADR-0026).

  The monolithic `openapi/awcms-public-api.openapi.yaml` is split into source
  fragments — a root fragment (`openapi/awcms-public-api.src.yaml`: info/servers/
  tags/security + shared securitySchemes/parameters/responses + the `ApiError`/
  `ApiMeta` shared schemas) and one `openapi/modules/<module>.openapi.yaml` per
  base module (plus a `foundation` fragment for `/api/v1/health` and
  `/api/v1/database/pool`). Each module points at its fragment via
  `ModuleDescriptor.api.openApiPath`. The published bundle
  `openapi/awcms-public-api.openapi.yaml` is now GENERATED by `bun run openapi:bundle`
  (deterministic/idempotent — sorted keys, no timestamps) and stays
  CONTRACT-EQUIVALENT to the pre-migration monolith; no URL, security, request/
  response, or schema changed. The only documented, additive difference is the
  now-declared `Domain Event Runtime` tag (previously used by
  `/api/v1/domain-events/*` operations but never declared).

  New scripts wired into `bun run check` and CI: `openapi:bundle`,
  `api:docs:generate`/`api:docs:check` (generates the readable
  `docs/awcms/api-reference.md` from the bundle + AsyncAPI, with a read-only
  freshness gate), and an extended `api:spec:check` that now also enforces bundle
  freshness (committed bundle == freshly generated from fragments), the standard
  `ApiError` error envelope on every 4xx/5xx response, and that every
  `ALLOWED_PUBLIC_OPERATIONS` entry is actually used — on top of the existing
  route↔contract parity, unique `operationId`, explicit security, and
  path-parameter checks. A derived application can contribute its own module
  fragment through the `buildBundledDocument({ extraFragmentFiles })` composition
  seam (#178) without editing any base fragment; a fragment redefining a base
  path/operation/schema is rejected with `BundleConflictError`.

  No runtime behavior, database schema, or public endpoint changed; the API
  contract version (`info.version`, ADR-0008) is unchanged.

- fb602fb: Add the module-management module: a database-backed, tenant-aware module
  registry ported from awcms-mini. Provides descriptor sync into the DB
  registry, per-tenant module enable/disable with dependency validation,
  non-secret module settings (secret-shaped key/value rejection), read-only
  permission sync/status, an admin navigation registry, a documentation-only
  job/command registry, and passive/explicit module health-readiness signals.

  - New migration `008_awcms_module_management_schema.sql`: extends
    `awcms_modules` and adds `awcms_tenant_modules`, `awcms_module_dependencies`,
    `awcms_module_settings`, `awcms_module_navigation`, `awcms_module_jobs`, and
    `awcms_module_health_checks`, plus the `module_management` permission catalog.
    Tenant-scoped tables have RLS tenant-isolation policies.
  - New REST endpoints under `/api/v1/modules`, `/api/v1/tenant/modules`, and
    `/api/v1/access/modules`, all guarded by default-deny ABAC and audited.
  - Extends `_shared/redaction.ts` with `findSensitiveKeys` and
    `findSecretShapedValues` for module settings validation.

- b11cfca: Add tenant-aware OIDC/SSO with account linking fail-closed and break-glass (Issue #185, epic #177) — ported from awcms-mini (#590/#591) and hardened. Generic, provider-agnostic OIDC (Google/Entra/Keycloak) that mints an awcms opaque session, never uses the ID token as the app session, and keeps authorization on RBAC/ABAC/RLS. ADR-0028, doc `docs/awcms/oidc-sso.md`, migrations `sql/025` + `sql/026`.

  - **Schema (`sql/025`, `sql/026`)** — four tenant-scoped RLS `FORCE` tables: `awcms_auth_providers` (provider config; client secret AES-256-GCM ciphertext OR env-var reference, never plaintext), `awcms_tenant_auth_policies` (password/SSO/JIT/break-glass, one row per tenant), `awcms_external_identities` (linking keyed `(tenant_id, provider_id, issuer, subject)` — immutable `sub`, never email; tenant-bound composite FK), `awcms_oidc_auth_requests` (ephemeral: `state_hash` bearer, `nonce` + PKCE `code_verifier` plaintext single-use, validated `redirect_after`). Permission seed for `sso_providers.{read,create,update,delete}` and `sso_policy.{read,update}`.
  - **SSRF guard (`lib/auth/ssrf-guard.ts`, new)** — the issue's top risk: all discovery/JWKS/token fetches are HTTPS-only, block private/loopback/link-local/ULA/CGNAT/metadata IPv4+IPv6 (including IPv4-mapped/NAT64), validate every resolved DNS address before connecting, follow redirects manually with per-hop re-validation, and enforce a bounded timeout + response-size cap. A reviewed loopback escape hatch (`AUTH_SSO_ALLOW_INSECURE_HOSTS`) exists only for a local fake IdP in tests and is rejected in production. This reverses mini's deliberate no-IP-block decision.
  - **Auth Code + PKCE + state + nonce** — `code_verifier` server-side single-use, `code_challenge` S256; `state` hashed, single-use (`FOR UPDATE` + CAS), tenant-bound; strict redirect-URI matching; sanitized same-origin post-login redirect (no open redirect).
  - **ID-token validation fail-closed** (`domain/oidc-policy.ts` + `lib/auth/jwt-verify.ts`) — algorithm allow-list `{RS256, ES256}` matched to key type (rejects `none` and alg-confusion), WebCrypto-native signature (no `jose` dependency added — Bun-only), issuer + audience + `azp` + expiry + `iat` + nonce.
  - **JWKS/discovery cache** — bounded TTL + negative-TTL + circuit breaker keyed `${tenantId}:${providerKey}`, all OUTSIDE any DB transaction.
  - **Account linking explicit + step-up** — `POST /api/v1/auth/sso/{providerKey}/link` and `/unlink` require a valid session AND `requireStepUp` (#184); identity is taken server-side from the stepped-up session. Never auto-links by email. Auto-link and JIT provisioning are default OFF; JIT provisions at minimum privilege (no roles).
  - **Break-glass** — `saveTenantAuthPolicy` refuses `sso_required=true` / `password_login_enabled=false` without a currently-eligible break-glass owner (`409 BREAK_GLASS_REQUIRED`); login-time `isPasswordLoginDisabledForIdentity` (gated by `isSsoEnabled`, run before the MFA branch) blocks non-break-glass password login; a provider outage never locks break-glass out (separate path).
  - **Routes** — public `GET /sso/{providerKey}/start` + `/callback` (added to the reviewed `ALLOWED_PUBLIC_OPERATIONS`), authenticated `/link` + `/unlink`, admin `GET/POST /auth/sso-providers`, `GET/PATCH/DELETE /auth/sso-providers/{id}`, `GET/PATCH /auth/sso-policy` — all guarded, audited (high severity), client secret never returned.
  - **Config/readiness** — new `AUTH_SSO_*` env vars; `config:validate` requires a 32-byte key when SSO is enabled and forbids the insecure-host escape hatch in production; `security:readiness` adds `checkSsoCredentialEncryptionKeyConfigured` (critical).
  - **Tests** — unit (JWT RS256/ES256 + alg-confusion/`none`, state/nonce/PKCE/redirect allow-list, claim mapping, SSRF IP ranges + oversized/redirect/timeout) and DB integration against a fake in-process OIDC provider (config → link → login → session; cross-tenant state substitution denied; account-link collision; JWKS rotation/cache; SSRF private/metadata issuer refused; break-glass save + IdP-outage; RLS FORCE cross-tenant under the non-superuser `awcms_app` role). Mutation-proven (dropping the issuer check turns a test RED). All test secrets/keys are generated at runtime.

- 15a3721: feat(redis): add optional Bun-native Redis readiness foundation (#197)

  Adds an opt-in, fail-open Redis capability for scalable AWCMS-derived applications without changing PostgreSQL as the authoritative transactional store. The additive foundation includes typed configuration, tenant-aware key namespacing, JSON cache-aside helpers with mandatory TTL, a credential-safe Redis health CLI, unit tests without a live Redis dependency, a hardened standalone Compose deployment, and operational/security guidance for LAN and Coolify deployments.

  Redis remains disabled by default. No session, audit, workflow, durable outbox, authorization boundary, or authoritative ERP/domain state is migrated to Redis, and no third-party runtime dependency is added.

- f69ad2c: Add the reporting module: management reporting views plus a module-contributed
  read-model projection mechanism, ported from awcms-mini.

  - Five generic live read-aggregation views under `/api/v1/reports/*` (tenant
    activity, access/audit summary, sync health, module usage, email queue
    health), each gated by `reporting.dashboard.read`. The access/audit view
    counts this repo's real cross-module audit trail (`awcms_audit_events`)
    rather than the mini base's `profile_audit_logs` proxy.
  - A module-contributed read-model projection extension: modules declare
    `reportingProjections` descriptors in their own `module.ts`, and reporting's
    engine maintains them via incremental cursor-table scans or a registered
    `domain_event_runtime` consumer, with idempotent crash-safe rebuild,
    live-computed freshness/staleness signals, on-demand source reconciliation,
    and scheduled CSV/JSON exports (manifest/checksum/expiry, secure
    tenant-scoped checksum-verified download). Three projections are registered
    (access-audit summary, module-activity summary, and an event-driven
    event-activity demonstration).
  - New migration `015_awcms_reporting_projections_schema.sql`: seven
    tenant-scoped tables (projection state/cursors/metrics, rebuild runs,
    reconciliation runs, scheduled exports, export runs), all with FORCE row
    level security tenant-isolation policies, indexed foreign keys, a partial
    unique index guaranteeing at most one running rebuild per (tenant,
    projection), `timestamptz`, and `bigint` counters. Migration
    `016_awcms_reporting_permissions.sql` seeds the `reporting.dashboard.read`,
    `reporting.projections.{read,rebuild,analyze}`, and
    `reporting.exports.{read,configure,export}` permissions.
  - New REST endpoints under `/api/v1/reports/projections` and
    `/api/v1/reports/exports` (list/detail/rebuild/cancel/reconcile, scheduled
    export create/disable/trigger, run history/download). Every mutation is
    ABAC-guarded, and rebuild/cancel/create/disable/trigger require an
    `Idempotency-Key` and write an audit event.
  - New scheduled worker scripts `reporting:projections:refresh` and
    `reporting:exports:dispatch` (pure PostgreSQL / local filesystem, safe in
    offline/LAN deployments) plus the pure-code
    `reporting:projections:registry:check` gate.
  - The `_shared/module-contract` gains the optional `reportingProjections`
    field and the `ProjectionDescriptor` type family (contract version bumped to
    `1.1.0`), the domain-event-runtime consumer registry gains the reporting
    event-activity projector consumer (the one deliberate
    `domain_event_runtime -> reporting` edge), and the identity-access
    `AccessAction` union gains `rebuild`/`analyze`/`export`.

- 9db1da6: Add `bun run security:readiness` — a go-live gate that catches inert RLS and
  RLS-bypassing DB roles (Issue #142), ported from awcms-mini and adapted to
  this base.

  Nothing in this repo detected RLS regressions. Migrations 002-008 and 010-012
  shipped 23 tenant-scoped tables with `ENABLE ROW LEVEL SECURITY` but no
  `FORCE`, which PostgreSQL ignores for the table owner — the role this app
  connects as. The isolation policies were never evaluated, and every check
  stayed green for the entire time (found by manual audit, fixed by `sql/017`).

  `scripts/security-readiness.ts` runs 13 named checks, each backed by a real
  signal (a DB query, a grep over tracked files, or a call into a real domain
  function — none hardcoded to pass). Any `critical` failure exits non-zero and
  blocks go-live; `warning`/`info` findings print without blocking. The two the
  issue exists for:

  - **RLS enabled AND forced on tenant-scoped tables** (critical) — requires
    `relforcerowsecurity`, not just `relrowsecurity`. Every `awcms_%` table not
    in a documented, per-table-justified RLS-free allowlist must have both, so a
    future migration reintroducing the bug fails without anyone remembering to
    register anything.
  - **App DB connection role does not bypass RLS** (critical) — `FORCE` still
    does nothing against `rolsuper`/`rolbypassrls`, so the app's own connection
    role is inspected.

  Also: no hardcoded secret, `.env` not tracked, argon2id hashing, login
  lockout, ABAC default-deny, audit table reachable, env config valid, sync HMAC
  secret rotated, login rate limiting, and security response headers. Items that
  genuinely cannot be automated from this repo (deployment/network/backup
  concerns, per-table grant matrices) are printed as documented out-of-scope
  entries with a reason rather than dropped.

  Not wired into `bun run check`: the DB-backed checks need a migrated database
  and `ci.yml` has no Postgres service. Run it against the target deployment,
  using the app's own `DATABASE_URL` — a privileged/superuser URL makes the
  result meaningless, which the role check reports outright.

- dd86ab6: Add segregation-of-duties (SoD) conflict detection and enforcement for ERP (Issue #181, epic #177 Wave 2 authorization), ported from awcms-mini (#746) on top of the #180 business-scope hierarchy.

  - **Contract:** additive `SoDRuleDescriptor` family + `ModuleDescriptor.sodRules` (`MODULE_CONTRACT_VERSION` 1.2.0 → 1.3.0). The base ships NO domain SoD rules; a derived application contributes them through the composition seam (the in-repo fixture carries ≥5 illustrative examples).
  - **Registry gate:** `bun run identity-access:sod-registry:check` validates the composed registry (owner match, unique ruleKey, ≥2 keys, valid enums, exception-policy consistency), wired into `bun run check` and CI — SoD registry drift makes CI red.
  - **Domain/application:** a pure conflict matcher (`sod-conflict-evaluation.ts`), assignment-time evaluation re-inserted at the #180 seam, action-time fail-closed enforcement wired into `authorizeInTransaction` for high-risk actions (deny-overrides-allow), an append-only decision log, and a scope-bound/time-bound/revocable/audited exception (override) flow that can never be self-approved.
  - **Schema:** `sql/029` (`awcms_sod_conflict_exceptions` + `awcms_sod_conflict_evaluations`, tenant-scoped RLS `ENABLE`+`FORCE`, composite `(tenant_id, …)` FKs) + `sql/030` permission seed. The scheduled expiry job now also expires elapsed approved exceptions.
  - **API:** six new endpoints under `/api/v1/identity/business-scope/` — `GET conflicts`, `GET`/`POST exceptions`, and `POST exceptions/{id}/approve|reject|revoke` (OpenAPI fragment + regenerated bundle/docs).

- 296b7e3: Sync HMAC: versioned signatures + inactive-by-default node registration (security advisory GHSA-c972-3q5p-g3h4, cross-tenant sync forgery).

  - **Signature v2 binds tenant + node.** New `computeSyncSignatureV2` /
    `verifySyncSignatureV2` sign `"v2:<tenantId>:<nodeCode>:<timestamp>:<body>"`,
    so a signature minted for one tenant no longer verifies when
    `X-AWCMS-Tenant-ID` is swapped to another tenant. Nodes send
    `X-AWCMS-Signature-Version: 2`. Timing-safe compare is preserved for both
    versions.
  - **Backward-compatible with an off-switch.** `verifySyncHeaders` verifies v2
    when the version header is `2`; requests without the header fall back to the
    legacy v1 scheme (`"<timestamp>.<body>"`) — which remains **cross-tenant
    forgeable** — only while the new env `SYNC_HMAC_ALLOW_LEGACY` is not `false`
    (default allow). Setting `SYNC_HMAC_ALLOW_LEGACY=false` rejects v1 entirely.
  - **Nodes auto-register `inactive`.** First-contact sync nodes are quarantined
    `inactive` (code-only change, no migration) and require admin approval via
    `PATCH /api/v1/sync/nodes/{id}` before they can push/pull. Nodes already
    `active` are unaffected. This closes the "new node id" path independently of
    the signature.

  Not a complete close on its own: the advisory is fully closed only when
  `SYNC_HMAC_ALLOW_LEGACY=false` **and** every node has migrated to v2. This is a
  cross-repo change — the v2 material is canonical here, but **awcms-mini** and
  the node spec/skill must be updated to emit v2 before legacy is disabled in any
  deployment. v1 is deprecated-transitional. New env var `SYNC_HMAC_ALLOW_LEGACY`
  (default `true`) must be wired into shared env docs/validation.

- cd772a3: Add the sync-storage module: offline-first synchronization ported from
  awcms-mini. HMAC-authenticated node-to-node event exchange (outbox/inbox),
  optimistic-concurrency conflict tracking, and an object sync upload queue with
  an internal dispatcher.

  - New migrations `010_awcms_sync_storage_outbox_inbox_schema.sql`,
    `011_awcms_sync_storage_conflict_schema.sql`, and
    `012_awcms_object_sync_queue_schema.sql`: add `awcms_sync_nodes`,
    `awcms_sync_outbox`, `awcms_sync_inbox`, `awcms_sync_push_batches`
    (idempotency ledger keyed `(tenant_id, node_id, batch_id)`),
    `awcms_sync_aggregate_versions`, `awcms_sync_conflicts` (immutable), and
    `awcms_object_sync_queue`. All tenant-scoped tables have RLS tenant-isolation
    policies, FK-covering indexes, and the performance/listing indexes. Seeds the
    `sync_storage` permissions (node_management, conflict_resolution,
    object_queue).
  - Node-to-node endpoints (`POST /sync/push`, `POST /sync/pull`,
    `GET /sync/status`, `POST /sync/objects`, `GET /sync/objects/status`)
    authenticate via HMAC (`X-AWCMS-Node-ID`/`Timestamp`/`Signature`,
    `HMAC-SHA256("<timestamp>.<body>")`, timing-safe compare, skew-bounded
    anti-replay), gated by `AWCMS_SYNC_ENABLED`, rejecting inactive nodes with 403. Push is idempotent per batch; conflicts are recorded immutably.
  - Admin surfaces (`GET/PATCH /sync/nodes`, `GET /sync/conflicts` +
    `/{id}/resolve`, `GET /sync/object-queue` + `/{id}/retry`) are
    session-authenticated, ABAC-guarded, and audited.
  - Object storage defaults to the local driver (`STORAGE_DRIVER=local`); R2 is
    optional (`R2_ENABLED`). The internal dispatcher `bun run sync:objects:dispatch`
    drains the object queue per tenant with a claim-lease, backoff, circuit
    breaker, and timeout — provider calls happen strictly outside transactions
    (ADR-0006).
  - Adds `readTextBody` to the shared request-body reader (raw-body read for HMAC
    verification) and the `retry` action to the identity-access `AccessAction`
    union (not high-risk).

- 9db1da6: Tenant-scope the office hierarchy FK (GHSA-r7cx-c4jh-cvvw) and fix three
  correctness gaps in the office directory (Issue #149).

  **Cross-tenant hierarchy (security).** `awcms_offices.parent_office_id` was
  declared `REFERENCES awcms_offices (id)` — a FK on the primary key alone, which
  says nothing about tenancy — and `POST /api/v1/offices` passed the caller's
  `parentOfficeId` straight to the INSERT with no lookup. An admin of tenant A
  could therefore name an office id belonging to tenant B and get `200 OK`,
  grafting their tree onto another tenant's. It doubled as an existence oracle:
  a real id from another tenant returned 200 while a random uuid returned an FK
  violation (500), so the field could be used to probe whether any given office
  id existed platform-wide.

  RLS did not cover this and could not: PostgreSQL runs referential integrity
  checks as the referenced table's owner with row-level security bypassed, so the
  FK's parent lookup saw the other tenant's row even from a session pinned to
  tenant A — verified still exploitable after `FORCE ROW LEVEL SECURITY` landed
  in `sql/017`. `sql/020_awcms_offices_tenant_scoped_fk.sql` makes tenancy part
  of the constraint instead: `UNIQUE (tenant_id, id)` gives the FK a target, and
  the FK becomes `(tenant_id, parent_office_id) REFERENCES (tenant_id, id)`, so
  the referenced office must sit in the same tenant as the referencing one — an
  invariant no privilege level can talk its way around. `createOffice` now also
  resolves the parent through `fetchOfficeById(tx, tenantId, ...)` before its
  first write, turning a bad parent into a `400` instead of an FK violation
  (500), and making the unknown / other-tenant / soft-deleted cases fail
  identically so the oracle closes.

  Existing cross-tenant parent links are detached to NULL by the migration
  (making those offices roots) rather than deleted: the office rows are the
  tenant's own legitimate data, only the edge into the other tenant is not.

  **`GET /api/v1/offices` is now keyset-paginated** — previously it returned
  every office of the tenant with no `LIMIT` at all, unbounded for a retail
  tenant with thousands of outlets. It now returns at most 100 per page plus an
  opaque `nextCursor`, via the shared `_shared/keyset-pagination.ts` helper.
  **Breaking read-order change:** results are now newest-first
  (`created_at DESC`) rather than oldest-first, matching the direction the shared
  cursor encodes and every other paginated list in this base. A malformed
  `cursor` is rejected with `400` rather than silently serving page 1.

  `listOffices` compares its keyset on `date_trunc('milliseconds', created_at)`
  rather than bare `created_at`. This is load-bearing, not cosmetic: cursors
  carry a JS `Date` (milliseconds) while `timestamptz` stores microseconds, and
  the driver floors them on the way out — so a bare comparison excludes every row
  sharing the boundary row's millisecond, including rows never shown, which no
  later cursor can reach either. Measured before the guard: 105 offices, page 1
  returned 100, page 2 returned 4 — one office permanently unreachable.

  **Duplicate `officeCode` now returns `409 OFFICE_CODE_ALREADY_EXISTS`** instead
  of 500. The unique index (`awcms_offices_tenant_code_key`) already existed; the
  `23505` is now translated to a `DuplicateOfficeCodeError` and caught inside
  `withTenant`, so it neither surfaces as an unhandled `PostgresError` nor counts
  against the shared database circuit breaker. Reusing the code of a
  soft-deleted office still works — the index is partial.

  **A soft-deleted parent office is now rejected.** No FK can express this (a
  soft-deleted row is still physically present), so it rests on the application
  check; previously `parentOfficeId` could point at a soft-deleted office and
  leave a dangling hierarchy.

  Covered by `tests/office-directory-postgres.test.ts` against real PostgreSQL
  (gated on `DATABASE_URL`), including a test that asserts the constraint
  directly at the database rather than through the application — the FK has to
  hold when no application code runs at all.

- ab24355: Theming module (ADR-0034 Fase 3) — the FIRST website module implemented directly
  in the awcms base, proving ADR-0034's decision that content/website modules may
  now live in `src/modules/` here ("template dipakai-langsung"). Adapted from
  awcms-micro's `theming` (Issue #269 / awcms-micro ADR-0029). Bumps the base
  registry 10 → 11 modules.

  - **Data-only tenant theming, no uploaded code.** A THEME is trusted, reviewed,
    BUILD-TIME source (a `ThemeDescriptor` composed by `theme-registry.ts` from the
    reviewed in-repo base themes — never a database row or an uploaded artifact).
    Only a tenant's DATA configuration of a theme lives in the database
    (`awcms_theming_config_versions` draft + immutable published versions, and
    `awcms_theming_tenant_state` active pointer; sql/033, all three tables
    `ENABLE`+`FORCE ROW LEVEL SECURITY` with the standard `tenant_isolation` policy).
  - **Security spine — reject, never sanitize (`domain/css-value-validation.ts`).**
    Every design-token value is validated by REJECTION against strict, bounded,
    linear (no-ReDoS) grammars (hex/rgb/hsl colors, dimensions with an allowed-unit
    list, bounded numbers, font families from a per-theme allow-list whose emitted
    stack is descriptor-owned). `url(...)`, `expression()`, `@import`, `javascript:`,
    comment breakouts, `;{}<>`, backslash, and unbalanced tokens can never reach the
    emitted CSS. Token values ship as an EXTERNAL same-origin `text/css` stylesheet
    (`/theming/{tenantCode}/tokens.css`), so `style-src 'self'` is never weakened.
  - **Immutable published versions + audited lifecycle.** draft → validate → preview
    → publish → rollback/retire. Published versions are IMMUTABLE (INSERT-only engine
    - a sql/033 `BEFORE UPDATE/DELETE` trigger); rollback/retire move the active
      pointer while history stays intact. `PUT /api/v1/theming/draft`,
      `POST /api/v1/theming/{validate,preview,publish,rollback,retire}` +
      `GET /api/v1/theming` — ABAC-gated (`theming.config.*`/`theming.version.*`/
      `theming.preview.create`, seeded in sql/034), idempotency-keyed on high-risk
      mutations, and audited. Adds the `archive` action to the `AccessAction`
      union/high-risk set.
  - **Non-indexable, hashed, short-lived previews.** `awcms_theming_preview_sessions`
    stores only the SHA-256 hash of the raw preview token; every read filters
    `expires_at >= now()`; the preview surfaces are `X-Robots-Tag: noindex` +
    `private, no-store` on a URL namespace distinct from the public stylesheet.
  - **Port adaptations.** No derived-repo theme seam (the derived-application pathway
    was removed in ADR-0034 Fase 2 — themes live in the base registry). `media_library`
    is dropped (not in this base): asset-URL resolution is a documented no-op and
    assets are omitted from render, degrading safely. The `data_lifecycle` purge
    descriptor is dropped (no purge engine/worker role here); preview retention rides
    the `expires_at` read filter. Public tenant resolution is `tenantCode`-based
    (ADR-0009), not Host-based. Revokes the `no-content-website-modules` divergence
    in `awcms-family-compatibility.yaml`.

- fb1848d: Add deployment-profile-aware Cloudflare Turnstile bot protection (Issue #186,
  epic #177), ported and hardened from awcms-mini. A new full-online deployment
  gate (`AUTH_ONLINE_SECURITY_ENABLED`/`AUTH_ONLINE_SECURITY_PROFILE`) plus
  `TURNSTILE_ENABLED` activate a server-side Turnstile challenge on
  `POST /api/v1/auth/login` and `POST /api/v1/setup/initialize`. The verifier runs
  after request-shape/rate-limit checks and before password verification, outside
  any DB transaction, and validates success, action (per endpoint), hostname, and
  challenge freshness with a timeout, response-size cap, and secret/token
  redaction (the token is never logged or audited). On the full-online profile it
  fails closed with a single generic error (no account-enumeration oracle); rate
  limit and lockout keep working independently.

  Every LAN/offline deployment (the default) is unchanged: no widget, no iframe,
  no CSP origin, and no outbound verification call — `isTurnstileRequired()`
  returns false there, and `TURNSTILE_ENABLED=true` alone (without the full-online
  profile) is still fully off. When enabled, the middleware CSP opens exactly the
  one `challenges.cloudflare.com` origin in `script-src`/`frame-src`, the login
  page renders the widget, and `config:validate` + `security:readiness` +
  production preflight validate the site key, secret key, and expected hostname
  consistently while distinguishing "disabled intentionally" from "misconfigured".
  The login/setup request contract gains an optional `turnstileToken` field.

  No database migration is added — Turnstile is configuration/env only; the secret
  key lives in the environment and never touches the database, logs, audit,
  responses, or health output. MFA (#184) and OIDC break-glass (#185) login
  branches are preserved intact.

- e92c579: Add the workflow-approval module: a managed, versioned, graph-based approval
  engine ported from awcms-mini's proven `workflow-approval` module. Draft/
  publish/retire definition lifecycle with immutable published/retired versions
  and per-instance version pinning; generic nodes/transitions (sequential
  approval, bounded conditional routing, parallel/join fan-out/fan-in, notify);
  quorum/any/all approval rules; effective-dated delegation/substitution;
  escalation/timeout policies processed by a scheduled worker job; and
  administrative recovery (reassign/cancel/force-decision).

  - New migration `013_awcms_workflow_approval_schema.sql`: adds
    `awcms_workflow_definitions`, `awcms_workflow_instances`,
    `awcms_workflow_tasks`, `awcms_workflow_task_assignments`,
    `awcms_workflow_join_arrivals`, `awcms_workflow_decisions` (append-only),
    and `awcms_workflow_delegations`. All tenant-scoped tables have RLS
    tenant-isolation policies with FORCE, FK indexes, `timestamptz`, and the 14
    workflow permission rows. The upstream `GRANT ... TO <worker-role>`
    least-privilege blocks are intentionally omitted (this base has no separate
    worker/app database roles).
  - Registers 8 domain event types (`awcms.workflow.instance.*`,
    `awcms.workflow.task.escalated`, `awcms.workflow.delegation.*`) in the
    domain-event-runtime registry, with matching AsyncAPI channels/operations,
    published via `appendDomainEvent` inside the same transaction as each state
    change.
  - Public REST surface under `/api/v1/workflows/**` (definitions CRUD +
    lifecycle, approval inbox + decisions, delegations, instance history +
    cancel, administrative recovery) with default-deny ABAC, tenant/RLS,
    `Idempotency-Key` + audit on every high-risk mutation, and OpenAPI paths.
  - New scheduled worker `bun run workflow:escalations:dispatch` (registered in
    the module job registry).
  - Extends `identity_access`'s ABAC evaluator with the self-approval /
    self-administered-force-decision denial the workflow decision endpoints rely
    on (inert for every endpoint that does not supply
    `requestedByTenantUserId`).

  The `notify` graph node's concrete notification adapter (owned by the `email`
  module in awcms-mini) is not wired yet — `notify` nodes silently no-op and
  advance until the `email` module is ported.

- 13813bb: Workflow approval: close concurrency and quorum-bypass holes

  - **Issue #140 — concurrent approvals no longer corrupt a task.**
    `fetchTaskWithInstanceForDecision` now takes `SELECT ... FOR UPDATE OF t` on
    the task row, serialising quorum evaluation per task. Previously two
    approvers deciding at the same instant each evaluated quorum against a READ
    COMMITTED snapshot blind to the other's uncommitted decision:
    `quorumRule: "all"` stranded the task `pending` forever with every assignment
    `decided` (everyone then got a 403 and the escalation worker re-escalated
    indefinitely), while `quorumRule: "any"` advanced the graph twice, producing
    duplicate downstream tasks and doubled `workflow.instance.advanced` events.

  - **Issue #152 — a cancelled instance can no longer be resurrected.** The
    `end`-node status UPDATE in `workflow-graph-engine.ts` now carries
    `AND status = 'pending'` (matching `cancelWorkflowInstance`) and rolls the
    transaction back if it matches nothing, instead of silently overwriting a
    cancellation with `approved`/`rejected`.

  - **GHSA-9qwq-cmr5-6wfc — one person can no longer satisfy a multi-person
    quorum alone.** A user who was both an original assignee and a node's
    escalation target used to accumulate two live assignment rows on one task and
    could vote twice. Migration `018` adds a partial unique index over
    `(workflow_task_id, tenant_user_id) WHERE status IN ('pending','decided')`
    (de-duplicating any existing rows first), both assignment INSERT paths became
    `ON CONFLICT DO NOTHING`, and quorum now counts
    `COUNT(DISTINCT tenant_user_id)` — people — rather than `COUNT(*)` rows.

  Behaviour change: reassigning a task to someone who has already decided it now
  fails with a `WorkflowRecoveryError` instead of granting them a second vote.

### Patch Changes

- 9da3a8c: Admin UI: author and manage ABAC policies (Issue #171). Adds
  `POST /api/v1/abac/policies` (create) and `PATCH /api/v1/abac/policies/{id}`
  (update effect/description and enable/disable toggle), both gated default-deny on
  `identity_access.access_control.configure` (the access-control administration
  permission — that activity seeds only `read`/`assign`/`configure`, and the owner
  holds only seeded permissions) and audit-logged as high-risk access-control
  changes. A duplicate `policyCode` returns 409. The
  `/admin/abac-policies` screen gains a create-policy form plus per-row Edit and
  Enable/Disable controls (UX-only gating; the endpoint ABAC guard is the
  authority).
- 7f54e83: Add admin management screens for profiles, modules, and email templates (Issue #166) — extending the admin UI to more of the requested management surface, each following the offices screen's SSR-read-then-render pattern backed by an existing awcms API.

  - **`admin/profiles.astro`** — the tenant's central profiles/parties via `listParties` (gated `profile_identity.profile_management.read`). Identifiers (masked PII) are deliberately not bulk-listed.
  - **`admin/modules.astro`** — the module catalog via `fetchModuleCatalog` (gated `module_management.modules.read`).
  - **`admin/email-templates.astro`** — tenant email templates via `listEmailTemplates` (gated `email.template.read`), including inactive.

  All three are permission-gated (clean "no access" notice otherwise), degrade to an error notice on a DB circuit-breaker `Response`, and are linked from the `AdminLayout` sidebar. The authenticated E2E (`admin-offices.e2e.ts`) now also navigates through them and asserts their tables render for the seeded owner (the module catalog assertion is data-seed-free — it lists the code-registered core modules).

  Read-only for this slice. NOTE: the other requested domains — user management, RBAC (roles/assignments), and ABAC (policies) — have no read API in awcms yet (the tables exist but no `listTenantUsers`/`listRoles`/`listAbacPolicies` application function or route is ported), so their admin screens depend on porting those backend reads from awcms-mini first, per the mini-first flow.

- 04c331f: Add module enable/disable toggle and email-template create form to the admin UI (Issue #171) — the next slice of admin write actions, each riding an EXISTING awcms endpoint (no new backend), following the create-office form's permission-gated + CSP-safe pattern.

  - **`admin/modules.astro`** — now reads the tenant's per-module ENABLEMENT state (`fetchTenantModuleEntries`, gated `module_management.tenant_modules.read`) instead of the global module catalog, so the rendered enabled/disabled column is exactly the `awcms_tenant_modules.enabled` state the toggle mutates. A per-row enable/disable toggle, shown to users holding the matching `module_management.tenant_modules.{enable,disable}` permission, posts to the existing `POST /api/v1/tenant/modules/{key}/{enable,disable}` (cookie auth). Core modules get no disable button (the endpoint 409s that); a non-core module can still fail to disable if another ENABLED module depends on it — the endpoint enforces that (409) and the UI shows a generic error. The disable endpoint requires a non-empty `reason` (recorded in the audit event), so the toggle prompts for one. The endpoints' ABAC guard + dependency/core validation remain the real authority — the button gate is UX-only.
  - **`admin/email-templates.astro`** — a create form shown to users holding `email.template.create`, posting to the existing `POST /api/v1/email/templates` (cookie auth). `templateKey` is a fixed select of the base categories (`BASE_EMAIL_TEMPLATE_CATEGORIES`); subject/body are captured for the `en` locale and sent as the `{ locale: text }` map the endpoint expects. `validateCreateEmailTemplateInput` (restricted category, localized-text shape, unsafe-HTML rejection) stays the authority.

  Both scripts are bundled EXTERNAL (they import from `admin-form-client`) so the `default-src 'self'` CSP allows them; both surface only a single generic error on failure (never internal detail, Issue #540) and guard double-submit via `lockElement`. Authed E2E added for each (`admin-modules-toggle.e2e.ts` toggles then reverts — self-reversing and retry-safe; `admin-email-templates-create.e2e.ts` is idempotent on the fixed `templateKey`). Both run in the CI `e2e-smoke` job.

  Remaining #171 scope (RBAC assign/unassign + role-permission mutation, ABAC policy authoring, edit/soft-delete/restore) needs newly-ported backend endpoints and is left to a focused follow-up cycle.

- 511fd0e: Add a create-office form to the admin offices screen (Issue #166), permission-gated on `tenant_admin.office_management.create`, posting to the existing `POST /api/v1/offices` via cookie auth; CSP-safe (external bundled script). Authed E2E covers create → row appears.

  - **`admin/offices.astro`** — renders `#office-create-form` above the existing table only when the SSR context holds `tenant_admin.office_management.create`. On submit the bundled `<script>` (imports `lockElement`/`postJson` from `admin-form-client`, forcing Astro to emit it external per the `default-src 'self'` CSP) reads `officeCode`/`officeName`/`officeType`, `POST`s to `/api/v1/offices` (cookie auth — no tenant header), reloads on success, and shows a single generic error otherwise (never internal detail, Issue #540). Double-submit is guarded via `lockElement`.
  - **E2E** — new `tests/e2e/admin-offices-create.e2e.ts`, env-gated like `admin-offices.e2e.ts`: the seeded owner fills the form with a per-run unique code and the new row appears in `#offices-table` after reload.

  The endpoint, validation, ABAC guard, and duplicate/parent handling already existed; this slice is additive UI + coverage.

- 9da3a8c: Admin offices lifecycle: soft-delete + restore (Issue #171). Adds
  `DELETE /api/v1/offices/{id}` (audited soft-delete; optional/bodyless reason)
  and `POST /api/v1/offices/{id}/restore` (audited restore, 409 when a live
  office has retaken the code). The `/admin/offices` screen gains permission-gated
  per-row inline edit (name + status via the existing PATCH), soft-delete, and a
  deleted-offices section with restore controls. Seeds the new
  `tenant_admin.office_management.delete` permission via migration
  `sql/023_awcms_seed_office_management_delete_permission.sql` (so the owner,
  granted only catalogued permissions at bootstrap, can actually delete); restore
  reuses `office_management.update`.
- 511fd0e: Add a create-profile form to the admin profiles screen (Issue #166), permission-gated on profile_identity.profile_management.create, posting to POST /api/v1/profiles via cookie auth; CSP-safe external script. Authed E2E covers create → row appears.
- b3e5145: Add user (tenant-users), RBAC (roles), and ABAC (policies) read APIs + admin management screens (Issue #166, Stage 3b) — porting awcms-mini's access-management reads, adapted to awcms's schema/scope. Completes the requested management surface (auth, user, profile, rbac, abac, module, template) as read-only admin screens.

  - **Read layer** — `src/modules/identity-access/application/access-directory.ts`: `listTenantUsers` (users + assigned role codes, `login_identifier` **masked** via `maskIdentifierValue`), `listRoles` (non-deleted roles + permission count), `listAbacPolicies` (policies; seeded-empty by default — built-in rules apply). All bounded `LIMIT 100`, tenant-filtered, inside `withTenant`.
  - **Endpoints** — `GET /api/v1/users`, `GET /api/v1/roles`, `GET /api/v1/abac/policies`, all gated on the existing `identity_access.access_control.read` permission (no new permission migration needed; mini's `user_management` activity code does not exist in awcms, so `access_control.read` is used as the gate). OpenAPI updated with matching paths + `TenantUserMasked`/`Role`/`AbacPolicy` schemas.
  - **Screens** — `admin/users.astro`, `admin/roles.astro`, `admin/abac-policies.astro`, permission-gated, linked from `AdminLayout`. The authenticated E2E now navigates all three and asserts the users table shows the owner's **masked** login identifier (never the raw address).

  Docs synced: doc 07, `identity-access/README.md`, `ARCHITECTURE.md`. Read-only for this slice; assign/create/edit (RBAC write) is a follow-up.

- 9da3a8c: Admin roles CRUD + role↔permission management (Issue #171). Adds
  `POST /api/v1/roles` (create), `PATCH`/`DELETE /api/v1/roles/{id}` (rename /
  soft-delete), `POST /api/v1/roles/{id}/restore`, and `POST`/`DELETE
/api/v1/roles/{id}/permissions` (grant / revoke), plus write controls on the
  `/admin/roles` screen (create form, per-row rename / soft-delete, restore, and
  a manage-permissions panel). All writes are HIGH-RISK: authorized on the
  existing `identity_access.access_control.configure` permission and audited.
  System roles (e.g. `owner`) cannot be soft-deleted (409). Duplicate role code
  (409) and duplicate permission grant (409) are caught inside the tenant
  transaction.
- 4e2c804: Add awcms's first admin management UI — login + admin shell + offices screen — with full E2E coverage (Issue #166, Stage 2). Ports awcms-mini's admin UI pattern, adapted to awcms's fondasi scope; the auth/session/middleware plumbing (`/admin` guard, `resolveSsrContext`, login/logout endpoints) already existed, so this is additive UI.

  - **Pages**: `login.astro` (posts to `POST /api/v1/auth/login` with `X-AWCMS-Tenant-ID`, redirects to `/admin`), `admin/index.astro` (dashboard rendered purely from `ssrContext`), `admin/offices.astro` (management screen — SSR-reads the tenant's offices via the same `listOffices` the JSON endpoint uses, permission-gated on `tenant_admin.office_management.read`, renders an accessible table + status badges). A stripped `AdminLayout` and the doc-14 design tokens (`src/styles/tokens.css`) + `admin.css` back them.
  - **CSP handled correctly** (Issue #148): the middleware stays the single CSP owner (`default-src 'self'`, covering JSON + HTML + pages). `astro.config.mjs` sets `build.inlineStylesheets: "never"` (external stylesheets) and every page `<script>` imports from `src/lib/ui/admin-form-client.ts` — which forces Astro to bundle it to an external file rather than inline it (an inline script would be CSP-blocked, silently breaking the page). Verified: the login page ships zero inline script/style.
  - **E2E**: `login.e2e.ts` (form render + the CSP "no inline script" property) validated live locally; `admin-offices.e2e.ts` drives the full authenticated loop (login → session → `/admin` → offices table + wrong-password generic-error path). The CI `e2e-smoke` job now provisions `postgres:18.4`, runs `db:migrate`, and seeds a tenant+owner through the real `POST /api/v1/setup/initialize` bootstrap.

  Read-only offices for this first slice; create/edit stays on `POST /api/v1/offices` and lands later.

- 9da3a8c: Add tenant-user activate/deactivate + role assign/unassign to the admin UI (Issue #171) — the next slice of admin write actions, backed by new guarded, audited endpoints in the identity-access module.

  - **`user-admin.ts`** (new application layer) — `setTenantUserStatus` (activate/deactivate; `awcms_tenant_users` has no `deleted_at`, so deactivate = `status='inactive'` / reactivate = `status='active'`), `assignRole` (DB-idempotent via the `(tenant_id, tenant_user_id, role_id)` unique index; a repeat assign raises 23505 → 409), and `unassignRole`. Each writes a high-risk audit event; login identifiers (PII) are never logged — the audit row references the stable `tenant_user_id`.
  - **`PATCH /api/v1/users/{id}`** (new) — set a tenant user's status. Guarded on `identity_access.access_control.configure`.
  - **`POST` / `DELETE /api/v1/access/assignments`** (new) — assign / revoke a role. Guarded on `identity_access.access_control.assign`. 23505 → 409 is caught INSIDE `withTenant`; target-not-found → 404 is raised before any write.
  - **`admin/users.astro`** — now renders per-user activate/deactivate and assign-role (with per-role remove) controls, each UX-gated on the same permission its endpoint enforces (the endpoint guard is the authority). Login identifiers stay masked in the render. The client script is external (CSP-safe) and uses the shared `sendJson` PATCH/DELETE helper.

  GUARD NOTE (no migration): the seed (`sql/005`) provides `identity_access.access_control.{read,assign,configure}` but no `.update`, and the owner role is granted only SEEDED permissions — so guarding on `update` would deny even the owner. Role assignment therefore uses the exactly-named `assign` permission; user activate/deactivate uses `configure` (the broadest identity-access admin permission), since deactivating revokes all of a user's access. A future migration adding a dedicated `access_control.update` (or a `user_management` activity) would let user-status be gated independently of role/permission administration.

- 9da3a8c: Harden the admin access-control write surface against privilege-escalation and
  lockout foot-guns (Issue #171 review follow-up):

  - **System-role permission set is immutable via the API.** `POST`/`DELETE
/api/v1/roles/{id}/permissions` now refuse `is_system` roles (409
    `ROLE_SYSTEM_PROTECTED`) — a delegated `configure` holder can no longer strip
    the seeded `owner` role's grants and lock the tenant out (parity with
    `softDeleteRole`, which already blocked system roles).
  - **System roles cannot be hand-assigned/unassigned.** `POST`/`DELETE
/api/v1/access/assignments` refuse `is_system` roles (409
    `ROLE_SYSTEM_PROTECTED`) — the `assign` permission can no longer be used to
    self-assign `owner` (escalation) or strip it from the sole owner (lockout).
  - **Deactivation lockout guards.** `PATCH /api/v1/users/{id}` refuses to
    deactivate the actor's own account (409 `CANNOT_DEACTIVATE_SELF`) or the last
    active member of a system role (409 `USER_LAST_ADMIN_PROTECTED`), so a tenant
    can never be left with no active administrator and no in-app recovery.

  All guards are checked before any write, audited on the success path only, and
  scoped to the tenant (no cross-tenant existence oracle).

- e407ffe: docs(governance): reposisi README/AGENTS & indeks ADR ke ADR-0034 (keluarga = template dipakai-langsung)

  Menyelaraskan dokumen pintu-depan dengan ADR-0034 (Fase 4a, item d + audit rujukan ADR ERP):

  - README (`.md`/`.id.md`) & AGENTS.md: narasi "repo ekstensi/turunan terpisah" → "template dipakai-langsung, modul domain (termasuk ERP) hidup langsung di `src/modules/`"; menghapus posisi jalur-turunan sebagai jalur aktif dan menandai panduan lama `derived-application-guide.md` DEPRECATED.
  - Header status ADR yang di-supersede ADR-0034: 0015 & 0022 → Superseded; 0013, 0014, 0025 → Accepted dengan catatan "jalur aplikasi-turunan di-supersede oleh ADR-0034" (bagian load-bearing base tetap berlaku).
  - Indeks ADR (`docs/adr/README.md`/`.id.md`): kolom Status kelima ADR itu diperbarui + framing folder direposisi dari ADR-0022 ke ADR-0034; regenerasi i18n-source-hash EN.

  ADR-0020 (kontrak kesiapan ERP) sengaja tidak disentuh — tetap load-bearing dan tidak di-supersede.

- fba69f8: chore(deps): bump `astro` from 7.0.9 to 7.1.1. Runtime framework patch. The
  family-compatibility manifest's `stack.astro.declared` pin is updated to `^7.1.1`
  in the same change so `family:conformance:check` stays green (declared value must
  equal the real `package.json` dependency).
- 320e8c6: chore(deps-dev): bump `@changesets/cli` from 2.31.0 to 2.31.1 (dev-only release
  tooling patch; no runtime behavior change).
- 50a7d76: chore(ci): bump `github/codeql-action` (`init` + `analyze`) from 4.37.0 to
  4.37.1. Both steps are bumped together in the same workflow — CodeQL requires
  every `github/codeql-action/*` step to run the identical version, so a split bump
  (dependabot opened `init` and `analyze` as separate PRs) fails the Analyze job
  with a version-mismatch error. This supersedes the separate `init`-only PR.
- 13813bb: Add a Content-Security-Policy to every response (Issue #148). This base
  previously set none at all.

  `src/lib/security/security-headers.ts` now emits `default-src 'self'`,
  `object-src 'none'`, `base-uri 'none'`, `form-action 'self'`, and
  `frame-ancestors 'none'` — the directive set awcms-mini uses, minus its
  `frame-src` and the Turnstile/YouTube origins it allowlists, neither of which
  has any subject in this base. `src/middleware.ts` already applies this
  builder's output to every response, so no route or middleware change was
  needed. `X-Frame-Options: DENY` stays as an independent older-browser layer.

  Set here rather than via Astro's built-in `security.csp` (the mechanism mini
  uses): Astro emits the CSP only from its page render path, and this base has
  no pages — `src/pages/` contains only API endpoints, and its two HTML
  responses (`src/lib/html/error-responses.ts`) are plain `Response`s returned
  from endpoints. A `security.csp` block in `astro.config.mjs` would therefore
  set zero headers here; `astro.config.mjs` now carries a comment recording
  that, and `security-headers.ts` documents what must be reconciled if this
  base ever gains real `.astro` pages (Astro's own header and this one do not
  compose — middleware's `headers.set` would replace Astro's).

  Rules out the "strict CSP breaks the UI" hazard rather than assuming it away:
  this base ships no `.astro` component, no inline script or style, no inline
  event handler, and no external origin, so `'self'` has nothing to break.

  Session cookies were already `httpOnly`, which stops XSS from reading a
  token; this closes the layer above it — XSS riding the session via a
  same-origin `fetch()`, and `<base href>` injection hijacking a relative form
  POST to an attacker origin.

- ad216ec: Add opt-in least-privilege `awcms_worker`/`awcms_setup` database roles (Issue #163) — the second half of the mini-045 role split; the first half (narrowing `awcms_app`) shipped as sql/021.

  `sql/022_awcms_db_worker_setup_roles.sql` creates two purpose-specific runtime roles alongside `awcms_app`:

  - **`awcms_worker`** — the seven unattended cron workers (`logs:audit:purge`, `sync:objects:dispatch`, `email:dispatch`, `domain-events:dispatch`, `workflow:escalations:dispatch`, `reporting:projections:refresh`, `reporting:exports:dispatch`). Granted exactly the per-write-path verbs each script uses across 25 tables — traced from THIS repo's actual SQL, not copied from mini (mini's worker set is visitor-analytics/blog/form-drafts, none of which exist here) — and zero access to the crown-jewel global catalogs (`awcms_permissions`, `awcms_schema_migrations`, `awcms_setup_state`, the module registry).
  - **`awcms_setup`** — the one-time `POST /api/v1/setup/initialize` bootstrap only. Granted exactly what `bootstrapPlatformTenant` writes across 11 tables, with SELECT accompanying INSERT on every `RETURNING id` (Postgres requires SELECT for a column to appear in RETURNING), `awcms_permissions` read-only, and no DELETE anywhere.

  Both are NOLOGIN + passwordless (a deployment activates LOGIN and a secret, exactly like `awcms_app`), non-superuser/non-BYPASSRLS/non-owner (so FORCE RLS applies), and carry the same fail-closed all-zero `app.current_tenant_id` default.

  **Opt-in, NOT breaking.** `getWorkerDatabaseClient`/`getSetupDatabaseClient` still fall back to `DATABASE_URL` (the `awcms_app` connection) when `WORKER_DATABASE_URL`/`SETUP_DATABASE_URL` are unset — a deployment that manages one connection string keeps working unchanged; the roles simply sit unused until an operator points a URL at one.

  A new `security:readiness` check ("Worker/setup least-privilege role grants match matrix") verifies each provisioned role holds exactly its matrix and nothing more (non-blocking when the roles are absent, i.e. on the fallback). The grant matrix, the migration's GRANTs, and the readiness check are pinned to one another by contract tests; the full matrix was validated empirically against PostgreSQL 18. Also corrects several stale comments/docs that referenced these roles as belonging to nonexistent migrations (mini's numbering 045/060/069).

  Migration only — no schema/data change, no API/event change.

- a805b2e: Add the browser E2E harness (Playwright + Bun) and a real catch-all 404 page — the first slice of porting awcms-mini's E2E layer, following the mini-first flow.

  - **Harness** (`playwright.config.ts`, `test:e2e`/`test:e2e:install` scripts, `@playwright/test` devDep) ported from awcms-mini and adapted: specs live in `tests/e2e/*.e2e.ts` (the `.e2e.ts` suffix keeps `bun test` from ever picking them up), run via `bun --bun playwright test` (Bun-only, AGENTS.md #14), against an already-running app (Playwright's `webServer` can't provision the Postgres this app boots against). See skill `awcms-browser-test`.
  - **Catch-all 404** (`src/pages/[...path].ts`) wires the previously-dormant public HTML error responses (`src/lib/html/error-responses.ts`): an unknown browser path now gets a clean, generic 404 HTML page that leaks nothing internal (Issue #540), and an unknown `/api/*` path gets the standard JSON error envelope instead of framework-default chrome. Astro ranks rest params lowest, so every real route still wins.
  - **First E2E spec** (`tests/e2e/not-found.e2e.ts`) drives a real Chromium at the 404 page and asserts the clean render + no internal-detail leak. Validated live locally (system Chrome) and wired into a new CI `e2e-smoke` job (`.github/workflows/ci.yml`) — no Postgres needed since the 404 route touches no DB.

  Foundation for the admin/management screens (login, offices, …) whose specs land with the first `.astro` pages.

- 13813bb: Perbaiki dua bug modul email yang diwarisi dari awcms-mini (Issue #143, #153).

  **#143 — lease dispatcher email tidak lagi write-only.** `claimEligibleEntries`
  menulis `next_attempt_at = leaseExpiry` sebagai lease klaim, tapi predikat
  klaimnya hanya menyaring `status IN ('queued', 'retry_wait')` — baris `sending`
  tidak pernah diklaim ulang. Dispatcher yang mati di antara CLAIM dan FINALIZE
  meninggalkan pesan `sending` selamanya: semua finalize bersyarat
  `status = 'sending'` dan `cancelEmailMessage` menolak status `sending`, jadi
  pesan itu tak terkirim, tak bisa dibatalkan, tak bisa di-retry. Predikat klaim
  kini menyertakan `OR (status = 'sending' AND next_attempt_at <= now)`, sama
  persis dengan dispatcher saudaranya `sync-storage/application/object-dispatch.ts`,
  sehingga `EMAIL_DISPATCH_LEASE_MINUTES` benar-benar dibaca. Insert
  `awcms_email_delivery_attempts` diberi `ON CONFLICT ... DO NOTHING` pada
  constraint `UNIQUE (message_id, attempt_no)`: pass yang mengklaim ulang
  menghitung `attempt_no` yang sama, dan `23505` yang tak tertangani akan
  membatalkan seluruh batch dispatch.

  **#153 — N+1 INSERT pada enqueue announcement.** `enqueueAnnouncement` kini
  memakai multi-row INSERT via `unnest` per 500 baris (pola sama dengan batch
  insert `awcms_object_sync_queue` di `src/pages/api/v1/sync/objects/index.ts`),
  bukan satu INSERT per recipient di dalam satu transaksi HTTP. Target
  `tenant`/`role` yang sebelumnya tanpa `LIMIT` kini dibatasi
  `ANNOUNCEMENT_MAX_RECIPIENTS` (5000) dengan urutan deterministik; saat cap
  tercapai, `enqueueAnnouncement` mengembalikan `truncated: true` dan mencatat log
  `warning` `email.announcement.recipients_truncated`. Dispatcher juga men-cache
  template per `template_key` dalam satu pass — satu batch 25 pesan announcement
  dengan `template_key` sama sebelumnya membuat 25 transaksi berisi 25 query
  identik.

  Response endpoint announcement bertambah field `truncated` (additive), begitu
  juga endpoint preview-nya — keduanya beserta OpenAPI-nya diperbarui. Tanpa itu
  pemanggil menerima `200 OK` berisi `recipientCount: 5000` dan tidak punya cara
  tahu bahwa sisa audiensnya tidak pernah di-enqueue; `matchedCount` di preview
  pun akan diam-diam berarti "maksimal 5000", padahal preview justru dipakai
  admin untuk menjawab "berapa yang akan terjangkau?" sebelum mengirim.

  Panggilan provider tetap di luar transaksi (ADR-0006), satu panggilan per pesan
  — cache template tidak menggabungkan pengiriman.

- 13813bb: Fix profile identifier masking and duplicate handling (Issue #144, Issue #150),
  both ported from awcms-mini.

  - `maskIdentifierValue` now masks email-shaped values the way awcms-mini's
    `maskIdentifier` does: the domain and the local part's first character stay
    readable (`budi.santoso@example.com` -> `b***********@example.com`) instead
    of collapsing every address into an identical star run ending in `.com`. The
    masked columns exist so an admin can tell recipients apart in the email
    outbox and suppression lists; the generic tail mask made
    `to_address_masked`/`recipient_masked` useless for that. The email branch is
    detected from the value itself, so the `maskIdentifierValue(value)` signature
    and every existing call site are unchanged.
  - `maskIdentifierValue` no longer leaks the last character of a short value:
    `"7788"` now masks to `****` (was `***8`) and `"12"` to `**` (was `*2`).
    A value of four characters or fewer has no non-leaking tail to show.
  - `POST /api/v1/profiles/{id}/identifiers` now answers `409
IDENTIFIER_ALREADY_EXISTS` when the identifier already exists for the tenant,
    instead of surfacing the unique-index violation as an unhandled `500`.
    `addIdentifierToProfile` translates Postgres `23505` into a new
    `DuplicateIdentifierError`; any other Postgres error is rethrown untouched.
    The route catches it inside `withTenant` so the translated error cannot count
    against the shared database circuit breaker.

- 9db1da6: Add the first `tests/integration/` suite — a real-PostgreSQL harness plus the
  priority tests ported from awcms-mini (Issue #154).

  Until now every one of this repo's `tests/*.test.ts` was a pure-unit test or a
  migration-shape assertion; nothing exercised RLS, FK, unique constraints,
  locking, or a real request path. That is the root reason several DB-layer bugs
  reached the tree undetected (RLS inert on 23 tables, PR #139). awcms-mini has
  101 integration tests; awcms had none.

  New `tests/integration/harness.ts` provisions, from the CI-supplied superuser
  `DATABASE_URL`, a throwaway database owned by a purpose-built non-superuser
  role, runs the REAL migration runner (`bun scripts/db-migrate.ts`) as that
  role, demotes it, and activates migration 019's least-privilege `awcms_app`
  role — reproducing production's exact connection posture (non-superuser,
  NOBYPASSRLS, `FORCE` RLS live). It repoints `DATABASE_URL` at the app role so
  every route handler and `getDatabaseClient()` call runs least-privilege, and
  tears the database down afterwards. Ref-counted so multiple files share one
  database within a `bun test` process.

  New tests (all gated on `DATABASE_URL`, so `bun test` without a database — as
  in `ci.yml` — skips cleanly, and they execute in `release.yml`, which provides
  a `postgres:18.4` service):

  - `db-role-separation.integration.test.ts` — pins PR #139/#141: all 23 tables
    are `ENABLE`+`FORCE`, cross-tenant SELECT/UPDATE/DELETE/INSERT are blocked
    for the owner posture, a live-catalog check catches any future table shipped
    with `ENABLE` but no `FORCE`, and the `awcms_app` grant matrix + fail-closed
    all-zero `app.current_tenant_id` default. `awcms_app` assertions skip cleanly
    and informatively if migration 019 is ever absent.
  - `module-tenant-lifecycle.integration.test.ts` — pins the PR #139 invariant
    that disabling a module actually returns `403 MODULE_DISABLED` from its own
    endpoints (not just flips a flag), plus enable/disable rules, audit, and
    cross-tenant isolation, through the real route handlers.
  - `reporting-projections.integration.test.ts` — pins the incremental
    cursor-table worker's bounded-pass/resume correctness and the event-activity
    watermark comparison, making the source references in
    `event-activity-projection.ts` and `reporting/README.md` true.
  - `object-storage-uploader.integration.test.ts` — the ADR-0006 provider path
    (checksum-mismatch pre-check, provider 5xx, timeout, circuit breaker) over a
    real loopback S3 round trip. Not database-gated — runs everywhere.

  Tests-only: no runtime code, migration, schema, or API surface changes.

- 296b7e3: Fix silent row loss in keyset pagination: the shared cursor now carries
  `created_at` at full microsecond precision instead of flooring it to
  milliseconds (Issue #158).

  `encodeKeysetCursor` used to serialise a row's `created_at` as a JS `Date`
  (`.toISOString()`), which holds only milliseconds — but `timestamptz` holds
  microseconds, and the driver had already floored them on the way out
  (`...:00.029058+00` arrives as `...:00.029Z`). A cursor built from that `Date`
  denoted an instant strictly EARLIER than the row it came from, so
  `(created_at, id) < (cursor)` skipped every row that shared that millisecond
  across a page boundary — rows that no later cursor could reach either. Measured
  against a batch of rows sharing one millisecond, page 2 came back empty.

  The fix carries the value through the cursor as full-precision UTC ISO-8601
  text (`_shared/keyset-pagination.ts`, `KEYSET_CURSOR_CREATED_AT_SQL`), keeping
  `ORDER BY (created_at, id)` on the bare column so the existing
  `(tenant_id, created_at DESC)` indexes still serve the query. `KeysetCursor.createdAt`
  is now a string, not a `Date`; the cursor stays opaque to clients and remains
  backward-compatible with any millisecond cursor already in flight.

  Endpoints corrected: `GET /api/v1/workflows/tasks`, `GET /api/v1/email/messages`,
  `GET /api/v1/sync/object-queue`, and `GET /api/v1/offices` (whose earlier local
  `date_trunc('milliseconds', …)` guard is removed now that the fix is central).
  The `GET /api/v1/email/messages` and `GET /api/v1/sync/object-queue` response
  bodies are unchanged (`{ …, nextCursor }`); only the value of `nextCursor` is
  now correct.

- 8a78ffd: Harden `checkRuntimeRoleGrants` (`bun run security:readiness`) to fail CLOSED
  for undeclared global RLS-free tables (Issue #162 / L2, from the PR #161
  security audit).

  The runtime-role grant check kept two independent structures: an
  `RLS_FREE_TABLES` set (read by `checkRlsEnabled`) and a separate
  forbidden-privilege map (read by `checkRuntimeRoleGrants`). A future global,
  RLS-free table added to the SET to make `checkRlsEnabled` pass but forgotten in
  the MAP was `continue`d as "full DML kept by design" and passed silently — the
  exact "a new global table inherits blanket DML from `ALTER DEFAULT PRIVILEGES`"
  regression this check exists to catch. Non-exploitable today (the 9 tables are
  curated correctly) but a latent trap for the next migration.

  - The two structures are merged into ONE source of truth
    (`GLOBAL_TABLE_FORBIDDEN_PRIVILEGES`, keyed by table name; `RLS_FREE_TABLES`
    is now derived from its keys). You can no longer register a table in one
    place without the other — every RLS-free table carries an explicit
    privilege declaration. The five module-registry tables that legitimately
    keep full DML get an explicit empty (`[]`) forbidden list — a visible
    "allow", not an implicit default.
  - The over-granted direction is now fail-closed: any table treated as RLS-free
    but missing an explicit declaration is asserted to hold ZERO writes. A
    forgotten registration that still holds INSERT/UPDATE/DELETE now FAILS
    `critical` with a "register the privileges awcms_app may hold" message
    instead of passing.

  Behaviour on the current, correctly-curated database is unchanged (still PASS).
  No schema, API, or event changes. Verified against a fully-migrated PostgreSQL
  18 database (sql/001..021): the 9-table default policy still passes, and a
  simulated undeclared global table holding blanket DML now fails the check.

- 1877d19: Close three gaps in `redactSecretsInText` where secret-shaped substrings
  passed through free text (error messages, stack traces) unredacted. Each shape
  was already covered by the anchored `SECRET_VALUE_PATTERNS` list in the same
  file, but was missing from the free-text `TEXT_SECRET_PATTERNS` list — so
  object values were masked while the identical secret in an error string was
  not.

  - Connection-string credentials (`scheme://user:password@host`). This is the
    highest-impact of the three: `DATABASE_URL`/`WORKER_DATABASE_URL` are DSNs,
    so the app's own database password reached `sanitizeErrorForLog` unredacted
    and was persisted to `awcms_domain_event_deliveries.last_error_message` /
    `dead_letter_reason`, then served verbatim by
    `GET /api/v1/domain-events/deliveries` — whose read path documented (and
    relied on) the invariant that write-time redaction had already run.
  - PEM private-key blocks truncated before their `-----END-----` marker (a log
    line cut off by a buffer limit). The existing paired pattern cannot match an
    unterminated block, so the raw base64 key body was emitted in full. The new
    fallback is ordered after the paired pattern, which has already consumed
    every well-formed block.
  - AWS access key ids (`AKIA…`) embedded in prose.

  Adds `tests/redaction.test.ts` pinning all three shapes plus the pattern
  ordering; the module previously had no test coverage, which is why the gaps
  went unnoticed.

- 13813bb: Fix a TOCTOU between a reporting projection rebuild and the steady-state
  incremental worker that could double-count a projection's metrics (Issue
  #151).

  `projection-incremental-worker.ts`'s rebuild guard (`isRebuildRunning`) ran
  in a `withTenant` transaction of its own, committed, and only then opened a
  separate transaction per pass. A rebuild triggered in that window reset the
  projection's cursors to NULL and its metrics to 0 _after_ the guard had
  already reported "no rebuild is running", so the incremental pass re-scanned
  the source table from the beginning while the rebuild's own passes did the
  same — both applying the same delta to the same metric row (they serialize
  on that row lock and therefore sum). The file's own header claimed the
  opposite invariant ("idempotent rebuild must never double-count").

  - New `reporting/application/projection-lock.ts`: a per-(tenant, projection)
    `pg_advisory_xact_lock`, taken as the FIRST statement of every transaction
    that writes a projection's cursor/metric rows — `runCursorStreamPass`,
    `triggerOrResumeRebuild`, `runRebuildStreamPass`, and
    `applyEventActivityProjectionIncrement`. Held by the database for the whole
    transaction and released automatically at COMMIT/ROLLBACK.
  - `runCursorStreamPass` now also re-checks `findRunningRebuild` inside that
    same locked transaction, and reports the skip as a pass result
    (`CursorStreamPassResult.skippedRebuildInProgress`) instead of the caller
    pre-checking it in an earlier, separate transaction.

  Relocating the check alone would not have been sufficient: these transactions
  run at READ COMMITTED, where every statement takes a fresh snapshot, so a
  check and an act are not atomic with respect to a concurrently committing
  writer even within one transaction. The lock is also the only mechanism that
  works across processes — the rebuild trigger runs in a web request while the
  incremental worker runs in a separate `reporting:projections:refresh`
  process, which no in-process gate can serialize.

  No migration, no API change, no event change: `pg_advisory_xact_lock` needs
  no schema. `runIncrementalUpdateForTenant`'s observable outcome shape is
  unchanged; a skipped run still reports `skippedRebuildInProgress: true` with
  `rowsProcessed: 0`.

  Also corrects stale references to
  `tests/integration/reporting-projections.integration.test.ts`
  (`projection-incremental-worker.ts`, `event-activity-projection.ts`, and the
  module README) — that file exists in awcms-mini, not here, and this
  repository has no `tests/integration/` suite at all.

- d04c96c: Fix `POST /api/v1/roles` and `POST /api/v1/offices` to return `201 Created` on success instead of `200 OK`, matching the `created()` helper already used by `POST /api/v1/abac/policies` and the REST convention for resource-creation endpoints. Updates the corresponding OpenAPI response codes to `201`.
- 9db1da6: Sapu realitas warisan awcms-mini dari `.claude/skills/` (yang DIIKUTI agen,
  sehingga skill yang salah aktif melahirkan bug) dan tambah gate otomatis yang
  menangkap kelas bug ini sekali jalan.

  - **Rujukan migration `sql/NNN` hantu** — 34 rujukan (penomoran awcms-mini yang
    terbawa saat adaptasi) dibetulkan: yang punya padanan awcms diperbaiki ke
    nomor yang benar (mis. email — migrasi mini 020/021/024 → `sql/014`), yang
    merujuk modul yang belum di-port dinyatakan tegas sebagai artefak awcms-mini
    lewat banner status per-file.
  - **Skill untuk modul yang belum di-port ditandai BACAAN SAJA** — 10 skill
    (`blog-content`, `data-lifecycle`, `document-infrastructure`, `form-drafts`,
    `idn-admin-regions`, `integration-hub`, `news-portal`, `social-publishing`,
    `visitor-analytics`, `tenant-domain-routing`) mendapat prefiks status di
    `description` + banner "BELUM di-port; ada di awcms-mini" di body, mengikuti
    pola `awcms-legacy-migration`. `awcms-profile-identity` ditandai SEBAGIAN
    (fondasi ada, lapis Issue #748 belum di-port).
  - **Rujukan role/script disetel ke realitas terkini** — `awcms_app` +
    `scripts/security-readiness.ts` kini ADA (Issue #141/#142); skill dinaikkan
    dari "belum ada" ke status akurat (mis. `awcms-new-migration` aturan 11/12,
    `awcms-port-from-mini`, `awcms-deploy`, `awcms-workflow-approval`). Role
    `awcms_worker`/`awcms_setup` dinyatakan tetap tidak ada.
  - **Gate baru `checkSqlMigrationReferences`** di `scripts/lib/docs-checks.mjs`
    (dijalankan `bun run check:docs`) menolak setiap rujukan `sql/NNN` di
    dokumentasi (termasuk `.claude/skills/`) yang berkasnya tidak ada di `sql/`.
    Escape hatch berbasis konten (penanda inline `<!-- sql-refs: awcms-mini -->`
    - daftar path), bukan nomor baris.
  - **`NAMING_EXEMPTIONS` diperbaiki dari `file:line` ke `file::identifier`**
    (berbasis konten) supaya kebal terhadap pergeseran baris — desain lama patah
    saat agen paralel menyisipkan baris di dokumen yang sama.

  Tidak ada perubahan pada kode runtime, schema, atau API.

- 911738a: docs: sinkronkan dokumentasi & skill dengan kode/DB (aftermath ADR-0034) + dokumen kontinuasi

  Menyelaraskan docs non-gate dan skill dengan realita repo (11 modul, 34 migrasi, jalur aplikasi-turunan dihapus, port #179–186 landing):

  - **docs/ARCHITECTURE.md**: 10→11 modul (+theming), sql/023→034, §Komposisi ditulis ulang tanpa jalur turunan (`application-registry.ts`/`extension:check`/namespace 900); fakta diperbarui — MFA/OIDC/SSO/Turnstile & ABAC-dinamis/business-scope/SoD dari "belum ada" → "sudah live"; OpenAPI bundler & theming dipindah dari gap.
  - **docs/awcms & docs/adr** (12 file): repo-inventory & doc 13 (angka modul/migrasi), extension-compatibility-policy (banner DEPRECATED), api-contribution-guide & 09_roadmap & release-process (framing/tooling turunan dicabut), collision slot `sql/033` (kini theming) di ADR-0003/0010, path fixture `derived-application-example`→`example-domain-modules`.
  - **.claude/skills** (7 diedit + 1 baru): new-module (buang jalur turunan + ModuleType `derived`), erp-extension-readiness (BACAAN SAJA/HISTORIS), release & production-preflight (buang `extension:check`), codeql-triage (FP #6 historis), observability/integration (reframe "aplikasi turunan"), **skill baru `awcms-theming`**.
  - **docs/PROJECT_STATE.md** (BARU): dokumen kontinuasi/handoff ter-versioning (model tata kelola, inventori, backlog, jebakan) + pointer dari AGENTS.md.

  Tidak ada perubahan kode/sql/kontrak; `bun run check` penuh hijau.

- 8a78ffd: Harden sync HMAC v2 signature material against delimiter ambiguity (audit finding L1, GHSA-c972-3q5p-g3h4).

  The v2 material `v2:<tenantId>:<nodeCode>:<timestamp>:<body>` was cryptographically ambiguous at the tenant/node boundary because `nodeCode` may contain `:` (schema `node_code text`, no format constraint): `(tenantId="A", nodeCode="x:y")` and `(tenantId="A:x", nodeCode="y")` produced byte-identical material and mutually-accepted signatures. This was confirmed NOT cross-tenant exploitable (a request's `tenantId` must be a valid UUID to reach tenant data via `withTenant`), but was a latent weakness in security-signature code.

  `computeSyncSignatureV2`/`verifySyncSignatureV2` now require `tenantId` to be a UUID before the material is built — a UUID is a fixed 36 chars with no `:`, so the tenant field boundary is unambiguous. `computeSyncSignatureV2` throws on a non-UUID tenantId; `verifySyncSignatureV2` fails closed (returns `false`). Only `tenantId` is constrained — `nodeCode` is untouched, and the v2 material format is unchanged, so already-deployed v1/v2 nodes (whose tenant ids are UUIDs) are unaffected. v1 signatures (`computeSyncSignature`/`verifySyncSignature`) are not changed. Timing-safe comparison is preserved.

## 5.1.1

### Patch Changes

- 2008905: Perbaiki `release.yml`'s job `sign-attest-publish`: `actions/attest-build-provenance` dan `actions/attest-sbom` menolak `subject-name` yang menyertakan tag (`ghcr.io/ahliweb/awcms:dryrun-<sha>@sha256:...` → `Invalid image name`) — ditemukan lewat rehearsal pertama (`workflow_dispatch`, run 29477950931) sebelum tag rilis nyata pertama di-push. Tambah output job `build`'s `image-repo` (repo tanpa tag) dan pakai itu untuk `subject-name` kedua step attest, sambil tetap memakai `image-ref` (dengan tag) untuk `cosign sign`.

## 5.1.0

### Minor Changes

- a53e6e2: Implementasikan pipeline release nyata (docs/awcms/release-process.md): `Dockerfile.production` (multi-stage, non-root, health check), `.dockerignore`, `scripts/release-verify.ts` (+ `scripts/lib/release-verify-checks.ts`, tag == package.json version, CHANGELOG punya section, tak ada changeset pending), dan `.github/workflows/release.yml` (validate → build image + SBOM ganda → keyless cosign sign + provenance/SBOM attest → publish GitHub Release, dengan jalur rehearsal via `workflow_dispatch`). Belum pernah dieksekusi terhadap tag nyata — rehearsal pertama masih perlu dijalankan sebelum tag `v5.0.0` sungguhan di-push.

### Patch Changes

- d83805c: Perbaiki `package.json`'s `description` agar konsisten dengan ADR-0022/ADR-0023: AWCMS adalah basis/fondasi untuk ERP, bukan sebuah "Platform ERP" itu sendiri.

## 5.0.0

**Deliberate manual version jump — not a tool-computed SemVer increment.** Bumped directly from `0.2.0` to `5.0.0` per maintainer decision to continue this product's pre-rebuild release numbering (last legacy tag: `v4.6.0`) rather than resetting to `1.0.0`, so version comparisons never look like a downgrade across the rebuild. See [ADR-0024](docs/adr/0024-semver-numbering-continues-legacy-major-line.md) for the full rationale and an explicit compatibility note: despite continuing the number line, **`5.0.0` is not backward-compatible with any `v2.x`–`v4.x` legacy release** — the entire codebase was rewritten from scratch on a new foundation (Bun/Astro/PostgreSQL modular monolith, see [ADR-0001](docs/adr/0001-rebuild-on-awcms-foundation-erp-scope.md)/[ADR-0022](docs/adr/0022-erp-modules-live-in-extension-repos.md)). No git tag or GitHub Release accompanies this changelog entry yet — `.github/workflows/release.yml` (the SBOM/signing/provenance publish pipeline, see [`docs/awcms/release-process.md`](docs/awcms/release-process.md)) has not been implemented yet, so there is no real release for this version to attach to until that pipeline exists.

## 0.2.0

### Minor Changes

- f306b38: Tambah workflow GitHub Actions (CI, CodeQL, Changesets policy) yang mencerminkan `bun run check`, gate `check:docs` (mermaid/tautan/penamaan) beserta logika murninya, script `changesets:policy:check`, template issue/PR, dependabot, dan CODEOWNERS — diadaptasi dari awcms-mini dan dipangkas ke infrastruktur yang benar-benar ada di repo ini (belum ada job E2E/Postgres-integrasi/release image, didokumentasikan sebagai deferred di `docs/awcms/branch-protection.md` dan `scripts/README.md`).
- 5d1cf54: Tambah dukungan dokumentasi dwibahasa (ADR-0023): Bahasa Indonesia sebagai sumber otoritatif (`<nama>.id.md`), Inggris sebagai default yang tampil (`<nama>.md`). Diterapkan pada tiga dokumen pintu depan (`README.md` root, `docs/awcms/README.md`, `docs/adr/README.md`) plus `scripts/check-docs-translation.mjs` (gate staleness berbasis hash, masuk `bun run check` dan CI) yang mendeteksi saat sumber ID berubah tanpa terjemahan EN diregenerasi.

### Patch Changes

- ffdcd99: Bump `actions/upload-artifact` dari v4.6.2 ke v7.0.1 di workflow CI (dependency bump, tidak ada perubahan perilaku pipeline).
