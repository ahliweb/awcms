🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](README.id.md)

# Identity & Access

Login identity, sessions, tenant user membership, and basic RBAC/ABAC.

## Schema

- `awcms_identities` — `login_identifier` unique per tenant, `password_hash` (Bun native argon2id, never exposed), lockout (`failed_login_count`/`locked_until`).
- `awcms_tenant_users` — identity membership in a tenant, `status` (active/inactive).
- `awcms_sessions` — opaque tokens: only the `token_hash` (SHA-256) is stored; the raw token is returned once at login.
- `awcms_permissions` — catalogue of `(module_key, activity_code, action)`, seeded through a migration.
- `awcms_roles`/`awcms_role_permissions`/`awcms_access_assignments` — roles per tenant + permissions per role + tenant_user->role assignment.
- `awcms_abac_policies` — not yet used by the evaluator (generic evaluator in `domain/access-control.ts`); prepared for Sprint 3.
- `awcms_abac_decision_logs` — every allow/deny decision is recorded.

Schema: `sql/004_awcms_identity_login_schema.sql`, `sql/005_awcms_abac_access_control_schema.sql`.

## Access-management reads (admin, read-only — Issue #166)

`application/access-directory.ts` exposes three tenant-scoped lists, all gated by
`identity_access.access_control.read` and used by the JSON endpoints **and**
the SSR admin screens (`src/pages/admin/{users,roles,abac-policies}.astro`):

- `listTenantUsers` → `GET /api/v1/users` — tenant users + the role codes
  assigned to them. `login_identifier` is **always masked** via `maskIdentifierValue`
  (PII is never returned raw in a list).
- `listRoles` → `GET /api/v1/roles` — non-deleted tenant roles + permission count.
- `listAbacPolicies` → `GET /api/v1/abac/policies` — tenant ABAC policies
  (seeded empty by default; the generic evaluator uses built-in rules).

All are bounded by `LIMIT 100` (low-cardinality config, no cursor), tenant-filtered,
and run inside `withTenant` (RLS FORCE is the real boundary).

## Access-management writes (admin — Issue #171)

The `roles`/`abac-policies`/`users` admin screens now have write actions, each
gated default-deny by `authorizeInTransaction` inside `withTenant`; the UI gate
is only UX, the endpoint is the authority. Every write is high-risk →
it writes an audit event (severity `warning`) AFTER the write succeeds (no audit
on the 409/404 paths).

**Permission note (important).** The `awcms_permissions` catalogue (`sql/005`)
seeds the `identity_access.access_control` activity with ONLY
`read`/`assign`/`configure` — there is NO `create`/`update`/`delete`. The owner
is granted every catalogue row at bootstrap, so a guard on an un-seeded action
will deny even the owner. That is why every write here uses a seeded
action:

- `POST /api/v1/roles`, `PATCH`/`DELETE /api/v1/roles/{id}`,
  `POST /api/v1/roles/{id}/restore`, `POST`/`DELETE /api/v1/roles/{id}/permissions`
  (`application/role-admin.ts`) — create/rename/soft-delete/restore role + grant/
  revoke permission. Gate **`configure`** ("Manage roles and role permissions").
  System roles (`is_system`) cannot be soft-deleted (409). Duplicate role code /
  duplicate grant → 409 inside `withTenant`.
- `POST /api/v1/abac/policies`, `PATCH /api/v1/abac/policies/{id}`
  (`application/abac-admin.ts`) — author + edit + enable/disable a policy. Gate
  **`configure`** (access-control administration). Duplicate `policyCode` → 409.
- `PATCH /api/v1/users/{id}` (`application/user-admin.ts` `setTenantUserStatus`)
  — activate/deactivate (there is no `deleted_at`; `status` is `active`/`inactive`).
  Gate **`configure`**.
- `POST`/`DELETE /api/v1/access/assignments` (`application/user-admin.ts`
  `assignRole`/`unassignRole`) — assign/unassign role↔user. Gate **`assign`**.
  Assign is idempotent on the unique index `(tenant_id, tenant_user_id, role_id)`
  (23505→409); a missing target → 404 before the write (anti existence-oracle).

The admin client uses the `sendJson(method, url, body?)` helper
(`src/lib/ui/admin-form-client.ts`) for PATCH/DELETE — an external script
(CSP-safe).

## Auth flow

`POST /api/v1/auth/login` — the `X-AWCMS-Tenant-ID` header is mandatory, rate limit per `clientIp:tenantId` (a backstop outside the per-identity lockout), password verification, sets httpOnly cookies (`awcms_session`/`awcms_tenant_id`) + returns a token for API clients. `POST /api/v1/auth/logout` revokes the session. `GET /api/v1/auth/me` only accepts a bearer token.

Login layer split: `domain/login-policy.ts` is a pure decision function (`evaluateLoginAttempt`); `application/login-policy.ts` holds the environment/infra-dependent parts — thresholds from env (`resolveLoginPolicyConfig`), argon2id verify (`verifyPasswordOrDummy`), and the response shape for each deny reason (`resolveLoginDenyResponse`) — so the route stays thin and the rules can be tested without a database.

### Login audit & hardening (Issue #145, #147)

- **Audit** — login writes `login_succeeded`/`login_failed` to `awcms_audit_events` (`module_key: identity_access`, `resource_type: identity`). The `login_failed` row is written in the same transaction as the `failed_login_count` UPDATE so it commits with it; if the transaction rolls back, an out-of-band recorder rewrites it with `reason: internal_error` in a new transaction and the original error is still thrown. This is what makes resetting `failed_login_count = 0` on a successful login no longer erase the brute-force trail that preceded it.
- **Audit attributes** — only `method`, `reason`, `ipHash`, `userAgent`. **Never** the raw IP (`redactSensitiveAttributes` would turn it into `[REDACTED]` — a permanently empty column) and **never** `loginIdentifier` (usually email/PII, and storing an attacker-supplied string on failed attempts actually creates an enumeration leak). `ipHash` = keyed HMAC-SHA256 from `src/lib/security/client-fingerprint.ts`: stable for grouping per source, but not reversible.
- **Anti-enumeration** — an unknown identifier still pays for one argon2id verify against a constant dummy hash (removing the ~75 ms vs ~0 ms timing oracle), and the `locked` deny reason answers exactly the same as `invalid_credentials`. `tenant_inactive` is deliberately kept distinct (the tenant is named by the caller in the header, so it does not leak which identities exist).
- **Env thresholds** — read via `parsePositiveIntEnv`: non-numeric/zero/negative values fall back to the default with a `log("warning", ...)`, rather than a `NaN` that would make `failedLoginCount >= NaN` always false and silently disable lockout.
- **New env** — `TRUSTED_PROXY_ENABLED` (default `false`): `X-Forwarded-For` is only trusted as a rate-limit key when set to `true`; otherwise `clientAddress` is used, so an attacker on a directly-exposed topology cannot forge the header per request to always get a fresh bucket. `TRUSTED_PROXY_HOP_COUNT` (default `1`) determines which entry is read: counted **from the right** by that number, because the entries to the left of your trusted hop are written by something you do not control (#438) — previously the leftmost entry was read, and behind a proxy that APPENDS (rather than overwrites) that header an attacker could pick their own bucket again. `AUTH_IP_HASH_SECRET` (optional) keys the `ipHash` HMAC; if empty/placeholder, a per-process random key is used (still non-reversible, but `ipHash` cannot be compared across restarts/instances) and one warning is written.

## RBAC/ABAC

`domain/access-control.ts` — `evaluateAccess()`: default deny, deny overrides allow, a permission is identified as `module_key.activity_code.action`. `application/access-guard.ts` — `authorizeInTransaction()` is the single chokepoint called by every protected route.

A module's disabled status is not merely a UI signal: `authorizeInTransaction` checks `resolveModuleEnabled(tx, tenantId, guard.moduleKey)` (`auth-context.ts`) **before** the permission is looked up, so a module disabled for a tenant is denied `403 MODULE_DISABLED` whatever permissions the actor holds, and the denial is still recorded in the decision log (`matchedPolicy: "module_disabled"`). Because this guard is used by every protected endpoint, this single check closes every endpoint of a disabled module without touching any individual route. `module_management` itself is `isCore` (cannot be disabled), so a tenant is never locked out of re-enabling it.

## Dynamic ABAC policy evaluator (Issue #179)

Until Issue #179, `evaluateAccess` never read `awcms_abac_policies` rows — authorization was RBAC + built-in guards only (and the flat #171 CRUD at `/api/v1/abac/policies` wrote to a table that was never evaluated). This issue connects **stored policies** to the `authorizeInTransaction` chokepoint in a **default-deny** way without weakening the existing guards. The full decision (DSL, precedence, cache, two surfaces) is in **[ADR-0033](../../../docs/adr/0033-abac-dynamic-policy-evaluator.md)**; a summary:

- **DSL (`domain/abac-policy.ts`).** `conditions` = a restricted jsonb AST: `allOf`/`anyOf`/`not` nodes and `{attr, op, value}` or `{attr, op, valueAttr}` leaves (attr-to-attr for ownership checks). Attributes come from a **server-side allow-list** (`subject.*` from the authenticated context — not the client body; `resource.*` from `request.resourceAttributes`, which the endpoint must fill from the real resource; `action`; `env.*` server-derived, `env.ipTrusted` default `false`). Operators: `eq/ne/in/nin/lt/lte/gt/gte/exists` (comparisons numeric/date only). `dsl_version` starts at 1. The parser/validator is **fail-closed**; allow-list membership is **own-property only** (`hasOwnProperty`) so prototype keys (`__proto__`/`constructor`/…) do not slip through.
- **Evaluator (`domain/abac-evaluator.ts`).** A **pure** interpreter over the AST — no `eval`/`new Function`/dynamic import/SQL. `evaluateAccess` gains an optional 5th param `abac?: { policies, env }` (after `businessScopeFacts` as the 4th param); if absent/empty → ABAC is a no-op (every old call site with ≤4 arguments is unaffected).
- **Precedence (fail-closed).** After the built-in guards (tenant isolation, self-approval, force-decision, business-scope #180) and the applicability filter (nullable = wildcard): (1) **explicit DENY wins** — a satisfied `deny`, an invalid active policy, or any evaluation error → DENY, **before** the RBAC check; (2) **the RBAC permission is still required** — `allow` never creates a permission; (3) `allow` acts as a **constraint** — if any are applicable, at least one must be satisfied, otherwise → DENY (`abac_allow_unsatisfied`). SoD enforcement #181 remains additive after this decision.
- **Cache (`application/policy-cache.ts`).** Active **DSL-managed** policies are compiled once per tenant, cached in-process **tenant-keyed**, and invalidated **deterministically** by every create/update/enable/disable **from both surfaces** (`invalidatePolicyCache` **after commit**). `queryAndCompile` filters `is_active AND is_dsl_managed` — only DSL policies are evaluated. Loading always happens in `withTenant` (RLS + `awcms_app`). Limitation: invalidation is per-process (multi-instance needs LISTEN/NOTIFY/TTL).
- **Two authoring surfaces — only the DSL one is consumed.** New (DSL, #179): `GET/POST /api/v1/access/policies`, `GET/PUT /api/v1/access/policies/{id}`, `POST /api/v1/access/policies/{id}/{enable,disable}` (guard `identity_access.abac_policies.{read,configure}`, full DSL, audited) + `POST /api/v1/access/policies/simulate` (guard `.analyze`, read-only, audited without a decision log; a foreign subject also needs `access_control.read`) + `POST /api/v1/access/evaluate` (mirrors the real decision). Permissions are seeded by `sql/032`, the DSL columns by `sql/031`. Old (#171): `/api/v1/abac/policies` flat — only `effect`/`description`/`is_active`, it **cannot** be scoped/conditioned. **The `is_dsl_managed` discriminator** (`sql/031`, default `false`): flat rows are **never read by the evaluator** (otherwise a flat `deny` = wildcard + always-true = denying EVERY request = bricking the tenant with no in-band recovery); **only** the DSL surface sets `is_dsl_managed = true` (INSERT + UPDATE). Flat rows stay inert (pre-#179 behaviour); their cache invalidation is now a defensive no-op; the `sql/031` migration is deploy-safe. **Part B**: the DSL validator (`validateAbacPolicyInput`) rejects a `deny` that is unscoped + unconditional (`{allOf:[]}`) — the deny-everything footgun is closed on both surfaces. See [ADR-0033](../../../docs/adr/0033-abac-dynamic-policy-evaluator.md) §3.
- **Examples (not base).** The base does **not** ship domain policies. Five ERP examples live in `fixtures/abac-example-policies.json` to be authored through the API.

## Business-scope hierarchy (Issue #180)

A **generic** organisational authorization layer on top of tenant + role — restricting access by organisational hierarchy (legal entity, branch, office, department, cost center, project) without pulling real ERP domain entities into the base. Ported from awcms-mini (Issue #746), **stripped** of segregation-of-duties (SoD, that is Issue #181). Full detail: [ADR-0030](../../../docs/adr/0030-business-scope-hierarchy-generic-authorization-layer.md).

- **Generic references + capability port.** `scope_type`/`scope_id` are generic references (not FKs to an organisation table). Validity/ancestry is resolved through `BusinessScopeHierarchyPort` (`_shared/ports/business-scope-hierarchy-port.ts`, ADR-0011), which is supplied by a **provider module** for that capability. Since [ADR-0060](../../../docs/adr/0060-business-scope-hierarchy-provided-by-tenant-admin.md) the provider is **`tenant_admin`** (`office-scope-hierarchy-port-adapter.ts`): the `office` scope type resolves against `awcms_offices` (only live rows — not soft-deleted, not `inactive` — belonging to the tenant itself; depth/count bounded and cycle-safe), other scope types stay `resolved: false`. Previously the base shipped a **no-op** resolver waiting for a derived application; ADR-0034 removed that pathway, so creating an assignment rejects `scope_unresolved` for ALL inputs in ALL deployments. The tenant-wide scope type (`tenant`) never touches the port: the service resolves it intrinsically and **requires `scope_id` = the tenant's own id**. `identity_access` still declares `capabilities.consumes` `business_scope_hierarchy` (`optional: true` — a tenant without offices still works, fail-closed); the `tests/fixtures/example-domain-modules/` fixture ships a dummy resolver for heterogeneous ancestry.
- **Schema (`sql/027`, seed `sql/028`)** — two tenant-scoped RLS `FORCE` tables: `awcms_business_scope_assignments` (subject→scope, optional role, effective dating, `is_temporary`, status active/expired/revoked, grantor/approver/revoker) + `awcms_business_scope_assignment_events` (**append-only** lifecycle). Every subject/role/actor FK is a **composite FK `(tenant_id, …)`** — PostgreSQL RI checks bypass RLS (GHSA-r7cx-c4jh-cvvw/sql/020), so a single-column FK can point across tenants even with FORCE on; composite + RLS closes that (proven by `tests/integration/business-scope.integration.test.ts` running as `awcms_app`).
- **`evaluateAccess` integration.** An optional 4th parameter `businessScopeFacts` (backward-compatible — old call sites unchanged). Requests opt in through `resourceAttributes.requiredScopeType`/`.requiredScopeId` (+ `requiredScopeRelations`, a subset of `exact`/`descendant`/`ancestor`, default `["exact"]`). Supported relations: **exact, descendant, ancestor, tenant-wide** (`scopeType === "tenant"`). Subject facts are resolved first (`business-scope-facts.ts`) so the evaluator stays pure. `authorizeInTransaction` accepts an optional `options.hierarchyPort` to resolve + thread the facts.
- **Fail-closed.** Unknown scope type / unresolved / stale hierarchy → default-**DENY** for high-risk actions. `resolved: false` ≠ "resolved with an empty ancestor set": descendant/ancestor coverage comes only from `resolved` facts, and exact-match on high-risk actions requires `resolved: true` (a mutation-tested RED predicate).
- **Effective dating & immediate revocation.** `isBusinessScopeAssignmentCurrentlyActive(row, now)` is the authoritative gate (status = cache). Revoke/expiry affects the very next authz decision **without** waiting for a job. The scheduled job `identity-access:business-scope:expiry` (worker) flips `status` + writes events/audit as housekeeping.
- **Endpoints** — `GET`/`POST /api/v1/identity/business-scope/assignments` (list/create; create is high-risk, `Idempotency-Key` mandatory, self-grant rejected), `POST …/{id}/revoke`. Guard `identity_access.business_scope_assignments.{read,create,revoke}` default-deny; create/revoke/expire are audited.

## Segregation of duties (SoD, Issue #181)

A **generic** SoD restriction layer on top of the #180 business-scope hierarchy — detection of conflicting permission pairs/groups + exception/override, default-deny, audit-ready. Ported from awcms-mini (Issue #746), filling the seam #180 left behind. Full detail: [ADR-0031](../../../docs/adr/0031-segregation-of-duties-conflict-enforcement.md).

- **Code-only rule descriptors (#178/#181).** `SoDRuleDescriptor` (`_shared/module-contract.ts`) is declared in the owning module's `module.ts` (`sodRules`) — a pair of `conflictingPermissionKeys` (≥2), `scopeApplicability` (`same_scope_only`/`global_within_tenant`/`any`), `severity`, `exceptionPolicy`. **The base does not hardcode domain rules**; rules flow in through `listModules()` from domain modules. The illustrative examples (≥5) live in the test-support fixture `tests/fixtures/example-domain-modules/`, **not** in a base module. The gate `bun run identity-access:sod-registry:check` (`domain/sod-rule-registry.ts`) validates the registry; drift (duplicate ruleKey/owner mismatch) → CI red.
- **A pure matcher + two fact sources.** `domain/sod-conflict-evaluation.ts` (no I/O) detects conflicts; subject facts are resolved by `business-scope-facts.ts` (`resolveSoDAssignmentFacts`), **merging** permissions from business-scope assignments **and** ordinary RBAC grants (`awcms_access_assignments`). `same_scope_only` is hierarchy-aware (facts in an ancestor/descendant scope count as a match); without a `requestedScope` → INDETERMINATE (default-deny).
- **Enforcement at two points.** Assignment-time: `createBusinessScopeAssignment` rejects `sod_conflict`. Action-time (**fail-closed**): `high-risk-sod-guard.ts` is wired into `authorizeInTransaction` for every high-risk action (deny-overrides-allow) — conflicts are checked at **execution**, not only at assignment.
- **An exception is a sanctioned administrative override (`sql/029`).** `awcms_sod_conflict_exceptions` (RLS FORCE): scope-bound, time-bound (`effective_to` NOT NULL), revocable, audit `critical`. It **must not be self-approved** (approver ≠ requester, re-checked from the row; a dedicated approve permission). Expired/revoked stops applying **immediately** (`isSoDConflictExceptionCurrentlyValid`: `effective_to` vs `now`, status is only a cache). Composite FK `(tenant_id, …)` + RLS → tenant A's exception cannot be used by tenant B (proven as `awcms_app`).
- **Append-only decision log.** `awcms_sod_conflict_evaluations` records every check (a safe projection, no payload). Evaluation is bounded/non-N+1 (query count is constant with respect to subject size). The expiry job flips lapsed `approved` exceptions to `expired`.
- **Endpoints** — `GET /api/v1/identity/business-scope/conflicts` (preview/log, keyset), `GET`/`POST …/exceptions` (list/request; create requires `Idempotency-Key`), `POST …/exceptions/{id}/approve|reject|revoke`. Guard `identity_access.business_scope_conflicts.read` + `business_scope_exceptions.{read,create,approve,reject,revoke}` default-deny (seed `sql/030`).

## MFA TOTP, recovery codes, and step-up (Issue #184)

Ported from awcms-mini, adapted: mini gated MFA behind a "full-online" gate (#587) that **does not exist** in this base, so the feature switch here is `AUTH_MFA_ENABLED` alone — and it only gates the **enrollment** surface. Login challenge, disable, and step-up are driven by **database state** (an `active` factor row), not the flag, so turning the flag off can never let an already-enrolled identity skip the second factor (fail-closed).

- **Schema (`sql/024`, moved by `sql/114`)** — since [ADR-0087](../../../docs/adr/0087-mfa-moves-to-the-principal.md) factors and recovery codes belong to the **human**: `awcms_principal_mfa_factors` (AES-256-GCM encrypted TOTP secret — the `sql/024` construction is used as-is, `status` pending/active/disabled, `last_used_step` for anti-replay, `disabled_by_tenant_id` for the administrative reset trail) and `awcms_principal_mfa_recovery_codes` (sha256 hash, single-use), both **GLOBAL without RLS** keyed by `principal_id`, standing on ADR-0085's four substitute controls and the gate `bun run identity:principal-access:check`. Still tenant-scoped RLS `FORCE`: `awcms_mfa_challenges` (the ephemeral password→session bridge — one login attempt in one tenant) and `awcms_tenant_mfa_policies` (a tenant's product decision). Both old `awcms_identity_mfa_*` tables are kept as history, with `awcms_app` privileges reduced to `SELECT`. Plus the assurance columns on `awcms_sessions` (`assurance_level` aal1/aal2, `last_authenticated_at`, `stepped_up_at`).

  The HTTP surface and every function exported by `application/mfa.ts` **still** take `(tenantId, identityId)`: what moved is the storage, not the model — you act as a member of a tenant. The identity→principal hop is keyed by `(tenant_id, id)`, so an identity id from another tenant resolves to nothing.

- **Secret encryption** — `AUTH_MFA_SECRET_ENCRYPTION_KEY` (32 bytes base64), with **no default key**: `resolveMfaEncryptionKey` returns `null` when missing/invalid → every path fails closed with `MFA_MISCONFIGURED`. A DB backup alone is not enough to obtain a secret. Recovery codes are hashed one-way, verified constant-time (via an UPDATE CAS), single-use, regenerable, and shown once.
- **Concurrency-safe anti-replay** — `verifyTotpCode` returns the absolute step; it is only accepted when `step > last_used_step` AND the advance is a compare-and-swap (`WHERE ... AND last_used_step < ${step}`). Two concurrent requests on the same timestep: the loser UPDATEs zero rows → rejected as a replay. Recovery codes are consumed with the same `used_at IS NULL` CAS. Drift window is bounded (`AUTH_MFA_TOTP_WINDOW_STEPS`, max 10).
- **Two-stage login challenge** — in `login.ts`, the MFA branch is only reached **after** the password is valid (the deny block has already `return`ed), so there is no new enumeration oracle: an attacker without the password never gets there. Valid password + active factor → `401 MFA_REQUIRED` + `mfaChallengeToken` (not a session). `POST /auth/mfa/totp/verify` (public, authenticated by possession of the challenge token) completes it → an **aal2** session. Every challenge deny path collapses to `MFA_CHALLENGE_INVALID`.
- **Real tenant policy enforcement** — `optional` (default) / `required_for_privileged` (holding any non-read permission) / `required_for_all` via `PUT /api/v1/auth/mfa/policy` (guard `configure`). When the policy requires MFA for a user whose password is valid but who has **no factor yet**, login does not issue a full session: it returns `401 MFA_ENROLLMENT_REQUIRED` + an `mfaEnrollmentToken` (an `awcms_mfa_challenges` grant with `purpose='enrollment'`) that **only** authorizes `enroll/start`/`enroll/verify` (header `X-AWCMS-MFA-Enrollment-Token`); once enrollment completes → the grant is consumed + an `aal2` session. Fail-closed but self-recoverable (no admin lockout); gated by `isMfaFeatureEnabled()`.
- **Assurance & step-up** — sessions carry an `assurance_level`. `requireStepUp` is a reusable gate, called **after** `authorizeInTransaction`. `AUTH_MFA_STEPUP_TTL_SEC` is short & server-controlled. Raising aal1→aal2 **rotates** the session (anti-fixation). It is **already wired** into every high-risk action of this module: self-service `disable`, `recovery-codes/regenerate`, `admin/reset`, and `PUT policy` (a derived ERP application installs `requireStepUp` on its own sensitive actions, #179/#181).
- **Per-factor lockout** — `failed_verify_count`/`locked_until` are cumulative (independent of source IP & challenge rotation; `AUTH_MFA_MAX_VERIFY_ATTEMPTS`/`AUTH_MFA_LOCKOUT_MINUTES`), reset on a successful verify. A locked factor collapses to `MFA_CHALLENGE_INVALID` (login) / `MFA_LOCKED` (step-up).
- **Tenant selection & switching** ([ADR-0088](../../../docs/adr/0088-tenant-selection-and-switching.md), `sql/115`) — a login **without** `x-awcms-tenant-id` answers `409 MEMBERSHIP_SELECTION_REQUIRED` + a **selection token** (≤120 seconds, single-use, two columns on `awcms_principals`), exchanged at `POST /api/v1/auth/session/tenant` for a session on the tenant **named by the caller** — with no membership list, because reading one demands a cross-tenant scan that FORCE RLS refuses. `POST /api/v1/auth/session/switch` moves a live session; sessions with `origin_auth` `sso`/`handoff` are **rejected** (`SESSION_NOT_SWITCHABLE`), otherwise tenant B's IdP administrator could assert an address and then switch into tenant A. Both go through `evaluateTenantEntry`, which re-applies serviceability, membership, auth policy, and **the destination tenant's MFA policy** — without that, tenant switching is an MFA bypass. Assurance does not travel (a new session is always `aal1`).
  - **Invariant that must be preserved:** a selection token NEVER authenticates `authorizeInTransaction`. Its kind is carried by the hash namespace (`pt-sha256:`) and rejected as the FIRST statement in the gate, without a single query — `tests/principal-selection-token.test.ts` goes red if that rejection is moved further down.

- **Admin reset** — `POST /api/v1/auth/mfa/admin/reset` guard `identity_access.mfa_admin.reset`, `reason` mandatory, **a fresh step-up mandatory**, audit `critical`, **self-reset forbidden**. **Since ADR-0087 it reaches OUTSIDE the acting tenant** (the only such action in this repo): the factor belongs to the human, so a reset in tenant A revokes the same authenticator in tenant B. This is recorded as `crossTenantReach: true` on its audit row and `disabled_by_tenant_id` on the factor row — stating THAT it reached outward, not where to. The list of tenants on the other side is deliberately not built: it is impossible to read under FORCE RLS, and it is a cross-tenant membership oracle.

Full detail (auth flow, env reference, admin recovery SOP, threat model, OWASP ASVS/ISO mapping): [`docs/awcms/mfa-totp-step-up.md`](../../../docs/awcms/mfa-totp-step-up.md), [ADR-0027](../../../docs/adr/0027-mfa-totp-session-assurance-step-up.md), and [ADR-0087](../../../docs/adr/0087-mfa-moves-to-the-principal.md). Before the `sql/114` deploy window: `bun run identity:mfa-collisions:preflight` reports every human holding more than one live factor, along with which one is kept.

## Tenant-aware OIDC/SSO, account linking, and break-glass (Issue #185)

Ported from awcms-mini (Issue #590/#591), adapted + hardened. The feature switch `AUTH_SSO_ENABLED` gates the login/callback/link/unlink flow (admin provider/policy CRUD is always available). Provider configuration is per-tenant DATA, not env. A successful OIDC flow mints an **opaque AWCMS session** (not the ID token as the session); authorization still goes through RBAC/ABAC/RLS.

- **Schema (`sql/025`)** — four tenant-scoped RLS `FORCE` tables: `awcms_auth_providers` (provider config; the client secret is AES-256-GCM ciphertext OR an env reference, never plaintext), `awcms_tenant_auth_policies` (password/SSO/JIT/break-glass, one row per tenant), `awcms_external_identities` (linking keyed by `(tenant_id, provider_id, issuer, subject)` — the immutable `sub`, never email; tenant-bound composite FK), `awcms_oidc_auth_requests` (the ephemeral bridge: `state_hash` bearer, `nonce` + PKCE `code_verifier` plaintext single-use, a validated `redirect_after`). Permission seed `sql/026`.
- **SSRF guard (`lib/auth/ssrf-guard.ts`)** — risk #1: every discovery/JWKS/token fetch is HTTPS-only, blocking private/loopback/link-local/ULA/CGNAT/metadata IPv4+IPv6 (including IPv4-mapped/NAT64), validating every DNS result before connecting, manual redirects + re-validation on every hop, timeout + response-size cap. The loopback escape hatch only exists via `AUTH_SSO_ALLOW_INSECURE_HOSTS` (refused in production). The opposite of mini's risk-acceptance decision.
- **Auth Code + PKCE + state + nonce** — the `state` bearer is hashed, single-use (`FOR UPDATE` + CAS), short TTL, tenant-bound since `start`. `code_challenge` S256; `code_verifier` server-side.
- **Fail-closed ID token validation** (`domain/oidc-policy.ts` + `lib/auth/jwt-verify.ts`) — an algorithm allow-list `{RS256, ES256}` that must match the key type (rejecting `none` + alg-confusion), signatures via native WebCrypto (without a `jose` dependency), issuer + audience + `azp` + expiry + `iat` + nonce.
- **JWKS/discovery cache** — bounded TTL + negative-TTL + a circuit-breaker keyed `${tenantId}:${providerKey}`, **outside** the DB transaction. The breaker only trips on transport/SSRF failures.
- **Explicit account linking + step-up** — `POST /sso/{providerKey}/link` & `unlink` require a valid session **and** `requireStepUp` (#184). The identity is taken server-side from the stepped-up session. No auto-linking just because the email matches.
- **Auto-link & JIT default OFF** — auto-link requires the tenant master switch + a verified email + the provider domain (and the policy domain when set). JIT creates a new identity at **minimum privilege** (no roles).
- **Break-glass** — enforced when the policy is SAVED (`saveTenantAuthPolicy`): `sso_required`/`password_login_disabled` requires ≥1 active break-glass owner, else `409 BREAK_GLASS_REQUIRED`. At login time `isPasswordLoginDisabledForIdentity` (gated by `isSsoEnabled`, run **before** the MFA branch) rejects non-break-glass password login. An IdP outage does not block break-glass.
- **Break-glass, the second half (drift after save).** The guarantee above is a guarantee **at save time**, and eligibility is not a property of the policy — it is a property of `awcms_identities`/`awcms_tenant_users`. Deactivating that identity through `PATCH /api/v1/users/{id}` (or revoking its membership) makes the stored policy wrong **without the policy ever being touched**, through an ordinary user administration action that looks unrelated to SSO. `scripts/security-readiness.ts` `checkSsoBreakGlassReady` (critical) closes that: it RE-derives eligibility for every active tenant using the **same** `fetchEligibleBreakGlassIdentityIds` + `evaluateBreakGlassRequirement` (not a copy of the rules), one `withTenant` per tenant because the policy table is FORCE RLS, with no cap. Proven by mutation: replacing the eligible count with `breakGlassIdentityIds.length` turns 4 integration tests red. See [`docs/awcms/oidc-sso.md`](../../../docs/awcms/oidc-sso.md) §4.
- **Admin & audit** — provider CRUD (`sso_providers.{read,create,update,delete}`) & policy (`sso_policy.{read,update}`), soft delete, high-severity audit (link/unlink/provider/policy/JIT/login outcome) without raw tokens/claims/secrets.

Full detail (auth flow, provider setup, break-glass SOP, privacy mapping, threat model): [`docs/awcms/oidc-sso.md`](../../../docs/awcms/oidc-sso.md) and [ADR-0028](../../../docs/adr/0028-oidc-sso-tenant-aware-account-linking-break-glass.md).

## Password reset via email (Wave 2 auth delta)

Adapted from awcms-micro Issue #496. Two public endpoints + two pages:
`POST /api/v1/auth/password/forgot`, `POST /api/v1/auth/password/reset`,
`/forgot-password`, `/reset-password`.

- **Schema (`sql/073`)** — one tenant-scoped RLS `ENABLE`+`FORCE` table:
  `awcms_password_reset_tokens` (`token_hash` sha256 of 32 CSPRNG bytes —
  the raw token is NEVER stored, `expires_at`, `used_at` for single-use).
  `awcms_worker` is granted only `SELECT, DELETE` (the `data_lifecycle`
  `generic` purge engine; the worker never issues nor redeems a token).
- **Safe against account enumeration by construction** — `requestPasswordReset`
  returns an **identical** `outcome: "ineligible"` for an unknown identifier,
  an inactive identity/tenant-user, an inactive tenant, an SSO-only identity,
  and an identifier that is not an email address; the route always replies 200 with
  the same body. The difference only lives in the audit log (tenant-scoped, RLS,
  never part of the response). `login.ts` already uses the same principle
  for its 401.
- **The failure side is generic too** — `PASSWORD_RESET_INVALID` for not-found,
  expired, already-used, an identity deactivated after the token was issued, and
  password login being disabled after the token was issued. This endpoint is
  therefore not a token-status oracle.
- **Single-use in the DATABASE, not in JS** — reading the token uses
  `FOR UPDATE`. Without the row lock, two redemptions of the same link both read
  `used_at IS NULL` and **both** succeed in resetting the password (proven red
  by mutation in `tests/integration/password-reset.integration.test.ts`). The same
  pattern as the MFA anti-replay counter (#184).
- **Honouring the SSO-only policy** — `isPasswordLoginDisabledForIdentity`
  is checked on the REQUEST PATH **and** RE-read at redemption, so a still-live link
  does not survive a tenant turning password login off. Without
  this, password reset is the official unauthenticated way to create a working
  password on a tenant that deliberately disabled it.
- **A reset revokes ALL sessions** — `revokeAllSessionsForIdentity`; `aal2` sessions
  die too because `mfa-session-assurance.ts` treats `revoked_at` as
  gone. The lockout (`failed_login_count`/`locked_until`) is cleared: whoever holds
  the link has already proven control of the mailbox.
- **Delivery through a capability port** — `identity_access` does NOT write to
  `awcms_email_messages` (a table owned by `email`, ADR-0013 §6; the original micro
  wrote to it directly). The `auth_notification` port
  (`_shared/ports/auth-notification-port.ts`), with the adapter owned by `email`, is wired
  at the composition root (the route). Not a `dependencies` entry: `email` already depends
  on `identity_access`, so the reverse direction would close a cycle.
  A tenant without an active `auth.password_reset` template → `delivery_unavailable`
  (a warning in the log + audit), the response stays generic.
- **The link** — `${APP_URL}/reset-password?token=…&tenantId=…`, or a single opaque
  AES-256-GCM `?p=` when `AUTH_URL_PARAM_ENCRYPTION_KEY` is set
  (`lib/security/secure-url-params.ts`). The plain fallback is not a weakness: the token
  is already 256-bit CSPRNG and the tenant id is not a secret.
- **Rate limit + Turnstile** — per `clientIp:tenantId` on BOTH endpoints,
  checked before touching the DB; Turnstile uses its own `password_reset` action
  (a token from the login form cannot be replayed here).

## Self-registration with admin approval (Wave 2 auth delta)

Adapted from awcms-micro. `POST /api/v1/auth/register` (public) +
`/register`, the `/admin/registrations` queue, and three admin endpoints
(`GET /api/v1/registration-requests`, `.../{id}/approve`, `.../{id}/reject`).

- **OFF by default** (`AUTH_SELF_REGISTRATION_ENABLED`, `sql/074`–`075`).
  A public endpoint that is always live and writes rows is a spam surface that
  EVERY deployment would inherit. When off, the endpoint answers `404` — the same
  answer as a route that does not exist, so the switch cannot be discovered by
  probing. This is a DEPLOYMENT-level gate (like `AUTH_MFA_ENABLED`), so
  turning it on opens registration for ALL tenants; per-tenant
  granularity is a recorded follow-up, not something pretended to exist.
- **It never creates an account.** A public submit only writes a `pending` row in
  `awcms_registration_requests`; it rejects any privileged field (`roleIds`,
  `status`, `tenantUserId`) and does NOT accept a password at all.
  The validator returns exactly two fields, and that is enforced in both directions (a runtime
  key-set + a structural "which fields are read from the body").
- **It does NOT store credentials — a deliberate divergence from micro.** The
  micro version stored an argon2id hash chosen by an unverified anonymous submitter
  for an account that might never exist. Here approval creates the identity
  with an **unusable password** (a hash of 32 CSPRNG bytes that are immediately
  discarded) and then issues a password-reset link through the same `requestPasswordReset`
  path as `/forgot-password`. The applicant proves mailbox control
  before they can get in; rejected/abandoned requests leave behind no
  credential at all; and a spam flood no longer means a flood of argon2id hashes.
- **Safe against enumeration.** An address that already has an account, an already
  pending request, an inactive tenant, and a brand-new request all reply with an identical 200.
  "This address is already registered" is the most useful sentence an attacker
  could obtain here — which is exactly why it is never spoken. The audit records which one
  happened (WITHOUT the address, for failed submits).
- **`approve` and `reject` are SEPARATE permissions** (`registration_requests.*`,
  a new activity — `access_control` is the RBAC catalogue, not the authority to admit
  people; `/api/v1/users` in this repo is read-only, so approval is the FIRST
  admin path that brings an identity into existence). Only one of them creates an account.
- **Race-proof approval.** The row is locked `FOR UPDATE` with the predicate
  `status = 'pending'`. Without the lock, two simultaneous reviewers trigger a 23505 in
  the middle of the transaction → a 500 for the reviewer who did nothing wrong; with the lock the
  second gets `not_found` → a clean 404. Proven by mutation.
- **`roleIds` is optional and defaults to empty** — approval never silently grants a
  role. An unknown role rejects the WHOLE approval rather than granting a subset.
- **Reject tells nobody** — a rejection email confirms to the
  anonymous submitter that this tenant exists and reviewed them, which is precisely the
  disclosure its public endpoint refuses.
- Reviewed rows are purged by the GENERIC `data_lifecycle` engine (default 90 days,
  with a 7-day floor so the `registration_approved` audit still points at something);
  the worker is granted `SELECT, DELETE` only.

## The `/admin/security` screen (Wave 2 auth delta)

The authentication policy endpoints have existed since #184/#185; **the screen has not**, so
until now the only way to change a tenant's policy was a hand-written `curl`.

- **It adds no enforcement whatsoever.** Every mutation POSTs to the original
  endpoint (`PATCH /api/v1/auth/sso-policy`, `PUT /api/v1/auth/mfa/policy`) and
  inherits its ABAC guard, break-glass rules, and audit rows. The permission
  checks on the page are pure UX.
- **The gate uses the endpoint's EXACT permission keys**, including
  `mfa_admin.reset` as the MFA READ gate — it looks wrong but that is genuinely
  what `GET /api/v1/auth/mfa/policy` demands. Inventing an `mfa_admin.read`
  that no migration seeds = the latent-authz trap that has already bitten this
  repo twice; `tests/admin-security-page-contract.test.ts` turns 3 tests red
  if the page's keys diverge from the endpoint's.
- **Deployment posture is shown read-only** (online-security profile,
  Turnstile, the MFA/SSO switches). Without it, a tenant policy cannot be judged:
  `ssoRequired` while `AUTH_SSO_ENABLED=false` produces a tenant that cannot
  log in at all — a contradiction that now surfaces as a warning
  rather than silence. No secret values are rendered.
- **The break-glass picker uses IDENTITY ids**, not tenant_user ids (the policy
  column stores identity ids; both are uuids, so picking wrong would be accepted by the
  endpoint and then filtered down to an empty list — a silent no-op exactly where the
  operator is trying to keep themselves able to log in). `listBreakGlassCandidates`
  uses a predicate identical to `fetchEligibleBreakGlassIdentityIds`;
  `tests/integration/admin-security-policy.integration.test.ts` binds
  the two (inactive identity, inactive membership, locked identity, cross
  tenant).
- **`409 BREAK_GLASS_REQUIRED` is shown specifically**, not collapsed into
  "save failed": the caller is an authenticated admin who already holds
  `sso_policy.update`, so nothing leaks — whereas a generic message would
  make them retry a change the server will never accept.
- OIDC provider CRUD stays API-only (a read-only list on the screen). A form that
  POSTs a client secret deserves to be its own change.

## Machine credentials + session introspection (ADR-0049)

The FIRST foundation feature broken ground on directly in this repo under the
[ADR-0047](../../../docs/adr/0047-mini-micro-frozen-foundation-built-here.md) freeze —
and therefore recorded as a divergence in `awcms-family-compatibility.yaml`.
Schema: `sql/082` (the table + a `machine_credential_id` column on the decision log),
`sql/083` (permissions).

**The problem it closes.** The only bearer this repo accepts is a hashed
**session** token. A build cannot hold one: sessions expire, are
revoked wholesale on password reset (`sql/073`), and are rotated by MFA step-up
(`sql/024`). As a result `awcms-astro` could not fetch its own content.

**Its shape.**

- `awcms_machine_credentials` — tenant-scoped, `FORCE` RLS, bound by composite
  `(tenant_id, tenant_user_id)` to one existing **service account**.
- Token: `awcmsm_<tenantIdHex32>_<secret>`; it **carries its own tenant**,
  so a build client needs a single env var and the tenant header is irrelevant to it
  (a differing header is ignored — the token wins).
- The hash is stored in the `mc-sha256:` namespace. `hashSessionToken()`
  **dispatches** on the token prefix, so the 183 routes that already
  call it between `resolveAuthInputs` and `authorizeInTransaction`
  get this behaviour without a signature change.
- **It AUTHENTICATES, never AUTHORIZES**: once the principal resolves,
  the module-enabled → RBAC → ABAC → decision log → SoD chain runs as-is.
- **Read-only**, enforced BEFORE permissions are consulted: the `read` action only. A
  leaked token cannot change anything even if its service account is an `owner`.
- **It narrows, never widens**: effective permissions = the intersection of
  `allowed_permission_keys` with the service account's permissions.
- `expires_at` is mandatory (max 365 days), revocation takes effect on the very next
  request, `last_used_at` is refreshed at most once per hour.
- **Deactivating the service account immediately kills its credentials** — the machine
  path requires `awcms_tenant_users.status` AND `awcms_identities.status` to be active,
  deliberately stricter than the session path (which checks neither, but
  is bounded by the session lifetime). Without it, "deactivate this account" would silently
  leave a key that keeps working for months, because nothing
  revokes credentials when an account is deactivated.
- The decision log records **which credential** acted, not just the account.

**Endpoints.** `GET`/`POST /api/v1/access/machine-credentials`,
`POST /api/v1/access/machine-credentials/{id}/revoke` (permissions
`identity_access.machine_credentials.read`/`create`/`revoke`). The plaintext token
appears **once only**, at issuance (its 201 response is `private, no-store` —
the only response in this system whose body carries a live credential);
no endpoint can return it again — and issuance deliberately does **not** take an `Idempotency-Key`,
because replaying it would mean storing the plaintext token in
`awcms_idempotency_keys`.

**`GET /api/v1/auth/session`** — session introspection for the cross-origin BFF
(ADR-0045). Safe claims only (`identityId`, `tenantId`, `displayName`, `roles`,
`assuranceLevel`, `expiresAt`, `scopes`), **without** the raw identifier that
`GET /auth/me` returns. A single 401 shape for every failure — including
when a machine credential is presented, so this endpoint cannot be used
to classify bearers. `private, no-store` on every path, rate-limited
per source.

**A trap found while building it.** `Bun.SQL` does **not** bind a JS
array as a Postgres array: `${["a","b"]}` reaches the server as the text `a,b`
(22P02 "malformed array literal"), and the single-element shape is the most dangerous
because it arrives as `a`, which looks like an ordinary string. Use
`toPostgresTextArray(...)::text[]`.

## Session handoff for the BFF (ADR-0050)

Schema: `sql/088` (`awcms_bff_clients` + `awcms_session_handoff_codes`).

**The problem it closes.** ADR-0049 answered half the question: a BFF
that ALREADY holds a session token can ask "whose session is this". What
remained unanswered is where that token came from. The `awcms_session` cookie belongs to
the `awcms` origin; a browser on the `awcms-astro` origin will never send it,
and must not — that is an origin boundary working, not a hole that needs
patching.

The obvious shortcut (a login form in `awcms-astro` proxying
`POST /api/v1/auth/login`) was rejected twice over: the password crosses a repo that is not the
identity store, and **login here is not one step** — it can reply
`401 MFA_REQUIRED`, redirect to the tenant's OIDC provider, or demand a
Turnstile token. Proxying it means a second copy of the MFA flow, the OIDC callback, and the
Turnstile widget in a second repo.

**Its shape.** Two endpoints, two different principals:

- `POST /api/v1/auth/session-handoff/issue` — **an already logged-in human**
  requests a single-use code (≤60 seconds). Self-service, not permission-based:
  the identity and assurance are taken from the SESSION, never from the body, so a caller
  can only mint a code for themselves. Inventing a permission here
  is the latent-authz trap this repo has already shipped twice.
- `POST /api/v1/auth/session-handoff/redeem` — **a registered client**, server-to-server,
  with a client secret. The only endpoint in this repo authenticated
  that way (`defineClientCredentialTenantRoute`): it is the request that
  OBTAINS a session, so there is no session yet to present. Not a machine credential
  either — those are read-only by construction, and a read-only principal that can
  mint a human session is an escalation path.

**What binds its security.**

- **An exact-match `redirect_uri` allow-list.** ADR-0050 names open-redirect
  here as the way this design fails. Not a prefix (`https://app.example.com`
  shares a prefix with `https://app.example.com.evil.test`), and not an
  origin either (an attacker who can choose a path on an allowed origin is already
  enough). Query and fragment are REJECTED, not stripped.
- **The code carries no token.** Its row stores the `identity_id` + the assurance
  the login actually REACHED; redeem mints a new session through
  `createSessionWithAssurance`. No live credential is stored other than
  the one-way hash of the code itself — and assurance never rises, so an
  `aal1` login cannot be laundered into an `aal2` session.
- **Single-use under concurrency.** The claim is `UPDATE … WHERE redeemed_at IS
NULL RETURNING …`, this table's mutual-exclusion primitive. A
  read-then-write version lets two simultaneous redemptions both succeed —
  proven RED in `tests/integration/session-handoff.integration.test.ts`.
- **Used rows are KEPT, not deleted.** A replay is answered from evidence, not
  from the absence of evidence: a deleted row and a code that never existed cannot
  be told apart.
- **One answer for every failure** (`401 HANDOFF_REJECTED`), including a malformed
  body. The difference is recorded in the audit trail; giving it to the caller tells
  whoever holds a stolen code whether that code was ever valid.
- The ≤60 second TTL is enforced by a **database CHECK**, not just a TypeScript constant.

**A trap found while building it.** `created_at` DEFAULT `now()`
is the TRANSACTION START instant, whereas `expires_at` is derived from the application
clock — two different clocks, so the CHECK `expires_at <= created_at + 60 seconds`
rejects a perfectly normal code as soon as the transaction has been open for a moment.
The application writes BOTH from one clock. Found by an integration test, not
by reading.

**What still belongs to `awcms-astro`:** the `/internal/login` route, server-side
BFF session storage, the portal cookie, CSRF, and calling introspection per request.
The `awcms` side is complete.

## Invitations (Wave 4, ADR-0082)

The opposite direction from self-registration: registration is **pull**
(a stranger asks, an admin decides), an invitation is **push** (an admin
offers, a stranger decides). Both remain, each with its own
permissions and its own audit story.

- **Schema (`sql/106`, permissions `sql/107`)** — `awcms_invitations` (tenant-scoped,
  RLS `ENABLE`+`FORCE`) stores a `token_hash` sha256 of 32 CSPRNG bytes —
  the raw token is NEVER stored — plus `status`, `expires_at`,
  `resend_count` (CHECK `<= 5`), and `skip_email_confirmation`.
  `awcms_invitation_policies` are the grants that offer carries.
- **An offer is NOT a grant.** `activeRoleGrants` does not read this table and
  must not be taught to — a subject holding a role because some row states
  they were once invited is the SECOND grant path that ADR-0079 collapsed.
  Acceptance calls `grantRolePolicy`, and the `awcms_access_policies` row
  it produces is the only thing any reader sees.
- **Inviting and GRANTING A ROLE are two authorities.** An invitation carrying a role demands
  `invitations.create` AND `access_control.assign` (the ADR-0081 separation, with
  higher stakes: a grant via invitation reaches a person who does not exist yet).
  The `is_system` rejection is checked at creation AND again at acceptance — a role
  can change between those two moments.
- **Scope is pinned tenant-wide** by a database CHECK. The column exists so that
  widening later is a single `DROP`/`ADD CONSTRAINT`; the CHECK exists because ADR-0080
  forbids shipping a scoped grant writer before the routes declare their required
  scope.
- **`skip_email_confirmation` is PLATFORM-scoped** (`invitations.configure`,
  this module's only platform permission) unless the address already holds an
  active identity in this tenant. It removes the only proof of mailbox
  control, and after Wave 7 the object it mints is a GLOBAL
  principal.
- **Resend ROTATES the token** and is gated by `create`, not by a separate action.
  Without rotation, "send again" is a token-multiplication surface: one invitation
  grows N live links and revoking it means revoking N secrets that
  nobody counted.
- **Admin endpoints** — `GET`/`POST /api/v1/invitations` (keyset list + create,
  `Idempotency-Key` mandatory), `POST /api/v1/invitations/{id}/revoke`,
  `POST /api/v1/invitations/{id}/resend`. Addresses are ALWAYS masked in the list.
- **Public endpoints** — `GET /api/v1/auth/invitations/{token}` (preview:
  tenant name + inviter name, **never** their address) and
  `POST …/accept`. Both `checkAuthRateLimit`; accept has its own Turnstile
  action. Unknown / revoked / already accepted / expired / wrong tenant
  are all **404** — not 410, which would tell whoever holds the token that
  it was once valid.
- **Acceptance does not issue a session.** A session from here would step over the tenant's
  MFA policy, `isPasswordLoginDisabledForIdentity` on an SSO-only tenant, and the login rate
  limit. An invitation mints an ACCOUNT; `/login` decides the session.
- **`materializeMembership()`** (`application/membership-materialization.ts`)
  is ONE function with one caller, deliberately: Wave 7 needs exactly
  one place to redirect when identities become global principals.
- **The row lock is load-bearing** — `acceptInvitation` reads `FOR UPDATE`.
  Without it two acceptances of the same link both pass the status check and the
  loser hits `awcms_identities_tenant_login_key` mid-transaction
  (proven RED by mutation in
  `tests/integration/invitations.integration.test.ts`).
- **Delivery through a capability port** — `identity_access` does not write
  `awcms_email_*` (ADR-0013 §6). `AuthNotificationPort` gains a SECOND operation
  (`enqueueAuthAddressNotification`) because an invitation has no
  `awcms_tenant_users` row to be addressed by yet. A tenant without an active
  `auth.invitation` template → `delivery: "unavailable"` in the response (the caller is an
  authenticated admin; hiding it would only leave them waiting for a link that
  will never arrive).
- **There is no admin screen yet** for invitations — its four permissions sit in the
  `NOT_YET_SCREENED` ledger, the same order as ADR-0056 (`media_library`
  got its API surface first, its screen followed). The path is deliberately not
  written here: `skills:check` demands that every backticked `/admin/…` URL
  resolves to a real page, and naming it now would be exactly the
  confident lie that gate exists to prevent.

## Not yet available (Sprint 3+)

Advanced user/role management endpoints. Recorded follow-ups:
self-registration is still a deployment-level gate (not yet per-tenant), and OIDC
provider CRUD is still API-only (a read-only list only, on `/admin/security`).
