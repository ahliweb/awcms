🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](18_configuration_env_reference.id.md)

# Part 18 — Configuration and Environment Reference

> **Status (2026-07-14):** the `awcms` repo is only at the re-foundation stage
> (see [ADR-0001](../adr/0001-rebuild-on-awcms-foundation-erp-scope.md)) —
> **no ERP module has been implemented yet**. This document is the
> **target standard/pattern** for foundation configuration (runtime, database,
> auth, sync, storage) that will apply once implementation starts — adapted
> from the [awcms-mini](https://github.com/ahliweb/awcms-mini) base which is
> already fully implemented, MINUS every env var specific to CMS features
> (blog/news portal, social publishing, public visitor analytics, news media
> R2) that is irrelevant to this repo's ERP scope. Env vars specific to ERP
> modules (finance, inventory, procurement, manufacturing, HR/payroll) and
> business integrations (payment gateway, marketplace, Coretax, logistics) DO
> NOT exist yet — they will be documented incrementally once those modules are
> actually built (see §ERP & business integrations — placeholder below), not
> written up front.

## Purpose

This document will complete the AWCMS foundation configuration reference: every
environment variable, optional feature flag, configuration precedence,
per-environment profiles, secret handling, and the offline/LAN-first deployment
topology that is the baseline of this ERP platform.

## Configuration principles

1. Every secret comes only from the **environment**, never from code/commits.
2. `.env` is ignored; `.env.example` holds placeholders only.
3. External providers (payment gateway, marketplace, tax/logistics, etc.) are
   **optional** behind a feature flag; off by default.
4. Core operations (e.g. transactions/bookkeeping) must not fail because a
   provider is off — graceful degradation (queue/pending), not hard failure.
5. Configuration is validated at boot; a missing required value stops the start
   with a clear message.
6. Soft delete is mandatory platform behaviour, not a feature flag;
   retention/purge is controlled by policy and workflow.
7. Runtime, build, and all tooling must be **Bun** (Bun-only); there is no
   `node` binary anywhere in the dev/build/deploy path.

## Runtime & tooling (Bun-only)

- **Runtime & package manager**: Bun (`packageManager: bun@x.y.z` pins the
  version). Every `package.json` script is invoked via `bun`/`bun run`; there is
  no `node`/`npm`/`npx`/`pnpm`/`yarn`.
- **Build/dev**: bins with a node shebang (astro/vite) are run with
  `bun --bun …` so they do not fall back to the `node` binary. Do not provide a
  `build:node` script variant.
- **Server**: native `Bun.serve`; if `@astrojs/node` (standalone) is used for
  SSR, the entry is run with `bun ./dist/standalone-entry.mjs` (the runtime is
  still Bun).
- **Database**: `Bun.sql` or `postgres` (postgres.js).
- **Deployment**: `deploy/systemd` `ExecStart` uses the `bun` path; the
  container image is based on `oven/bun` (not `node`). CI is Bun-only
  (setup-bun, `bun install --frozen-lockfile`, `bun test`,
  `bun --bun astro build`).
- **Allowed** (not a violation): importing `node:*` (Bun's built-in API) and
  `@types/*` in devDependencies — neither pulls in a Node.js runtime.

## Precedence

```mermaid
flowchart LR
  Def[Code default] --> Env[Environment variable] --> Set[awcms_tenant_settings - per tenant/entity] --> Eff[Effective configuration]
```

- Runtime/secrets (DB, auth, sync HMAC, provider key): from the
  **environment**.
- Tenant/entity preferences (locale, timezone, theme): from **`awcms_tenants`**;
  display feature flags: from **`awcms_tenant_settings`**. Managed through
  `GET/PATCH /api/v1/settings` and the `/admin/settings` screen (target plan).
- Soft delete/purge retention may become a tenant policy, but it must never
  disable audit, RLS, or the default `deleted_at IS NULL` filter.

## Environment variable reference

Legend: Required = needed to boot; Sensitive = must not leak into
logs/responses.

> **Status note**: the table below is the target standard for foundation
> configuration. `src/lib/config/registry.ts`, `scripts/validate-env.ts`, and
> `scripts/config-docs-check.ts` (structured config registry + three-way parity
> check between the registry/`.env.example`/this document) **have not been
> implemented** in this repo — they will be built following the same pattern as
> awcms-mini once foundation implementation starts.

### Application core

| Var                         | Required | Default                 | Sensitive | Purpose                                                                   |
| --------------------------- | -------- | ----------------------- | --------- | ------------------------------------------------------------------------- |
| `APP_ENV`                   | Yes      | `development`           | –         | development/test/production (`staging` REMOVED — ADR-0083)                |
| `APP_URL`                   | Yes      | `http://localhost:4321` | –         | Application base URL                                                      |
| `LOG_LEVEL`                 | –        | `info`                  | –         | debug/info/warn/error                                                     |
| `AUDIT_LOG_RETENTION_DAYS`  | –        | `730`                   | –         | Retention of `awcms_audit_events` (days), used by the audit log purge job |
| `FORM_DRAFT_RETENTION_DAYS` | –        | `30`                    | –         | Retention of `expired`/`abandoned` form drafts (days)                     |

The default timezone/locale per tenant/entity is planned to come from data
(`awcms_tenants`/`awcms_tenant_settings`), not env vars — following the
awcms-mini pattern that deprecated `APP_TIMEZONE`/`APP_DEFAULT_LOCALE` as env
vars because their effective value always comes from the DB per tenant.

### Database & pool

| Var                             | Required | Default                           | Sensitive | Purpose                                                                                                                     |
| ------------------------------- | -------- | --------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                  | Yes      | –                                 | Yes       | Runtime PostgreSQL connection; point it at the `awcms_app` role (see §Database role model)                                  |
| `AWCMS_APP_DB_PASSWORD`         | –        | –                                 | Yes       | Password of the `awcms_app` role used by the container init script; must match the password in `DATABASE_URL`               |
| `DATABASE_POOL_MAX`             | –        | `20`                              | –         | Max pool connections (kind `app`; also the default for `worker`/`setup` unless overridden)                                  |
| `DATABASE_POOL_MAX_WORKER`      | –        | falls back to `DATABASE_POOL_MAX` | –         | Override for max pool connections of kind `worker`                                                                          |
| `DATABASE_POOL_MAX_SETUP`       | –        | falls back to `DATABASE_POOL_MAX` | –         | Override for max pool connections of kind `setup`                                                                           |
| `DATABASE_STATEMENT_TIMEOUT_MS` | –        | `15000`                           | –         | Statement timeout                                                                                                           |
| `DATABASE_PGBOUNCER`            | –        | `false`                           | –         | PgBouncer mode (transaction)                                                                                                |
| `WORKER_DATABASE_URL`           | –        | falls back to `DATABASE_URL`      | Yes       | Separate connection + pool for background jobs/cron. Opt-in to the `awcms_worker` role (sql/022) — see §Database role model |
| `SETUP_DATABASE_URL`            | –        | falls back to `DATABASE_URL`      | Yes       | Separate connection + pool for `POST /api/v1/setup/initialize`. Opt-in to the `awcms_setup` role (sql/022)                  |

#### Database role model

What **actually exists** in this repo (Issue #141, #160, #163) is **four**
roles: the migration owner, `awcms_app`, and — opt-in —
`awcms_worker`/`awcms_setup`.

1. **Migration owner** (superuser/owner) — used by `bun run db:migrate` only.
   The only role that can `ALTER`/`DROP`/`CREATE`/`GRANT`. The runner reads the
   **same** env var (`DATABASE_URL`), so run migrations with that var overridden
   to the owner's connection string, not `awcms_app`.
2. **`awcms_app`** ("web runtime", `DATABASE_URL`) — serves every HTTP request
   and every background job. Created by
   `sql/019_awcms_db_role_separation.sql`: not a superuser, not BYPASSRLS, not
   a table owner, DML only (no DDL). That is where RLS finally becomes a real
   security boundary: `FORCE ROW LEVEL SECURITY` (migration 017) closes the
   table-owner bypass, but SUPERUSER/BYPASSRLS walks past RLS regardless of
   FORCE — so both halves must be present, and before 019 that was **not** the
   case.
   It is created NOLOGIN without a password; a deployment activates it once with
   `ALTER ROLE awcms_app LOGIN PASSWORD '<secret>';` (the password never enters
   a migration).
   The fail-closed default GUC `app.current_tenant_id =
'00000000-0000-0000-0000-000000000000'` is set on this role as well:
   a query touching an RLS table outside `withTenant()` gets **zero rows**, not
   an `unrecognized configuration parameter` error and not another tenant's
   data.

Narrowing of global table grants (Issue #160,
`sql/021_awcms_db_role_grants_narrow.sql`): on **global tables without RLS**,
`awcms_app` **no longer** holds the excess DML that was residual #159 — it is
now **read-only** on `awcms_permissions` (the permission catalogue, seeded only
by migrations) and `awcms_schema_migrations` (the migration ledger, written only
by `db:migrate` as owner), and it **cannot `DELETE`** from `awcms_tenants` or
`awcms_setup_state`. What is **deliberately kept** because the `awcms_app` code
path genuinely uses it: `INSERT`/`UPDATE`/`SELECT` on `awcms_tenants` (INSERT
through the setup wizard that falls back to the `awcms_app` connection; UPDATE
through the tenant-settings screen) and `awcms_setup_state` (singleton lock via
the setup path), plus full DML on the module-registry tables (`awcms_modules` +
its descendants) written at request time by module-management. Regressions (a
new global table swept up in blanket DML from default privileges, or a new
tenant-scoped table that is RLS-forced but **ungranted** → `permission denied`)
are caught by the `security:readiness` check "Runtime role table grants match
least-privilege matrix".

3. **`awcms_worker`** ("background worker", `WORKER_DATABASE_URL`) and
4. **`awcms_setup`** ("bootstrap/setup", `SETUP_DATABASE_URL`) — created by
   `sql/022_awcms_db_worker_setup_roles.sql` (Issue #163, the second half of the
   mini-045 role split; the first half = narrowing `awcms_app` in sql/021).
   `awcms_worker` serves seven cron workers (audit purge, object/email/
   domain-event/workflow/reporting dispatch), `awcms_setup` serves the
   `POST /api/v1/setup/initialize` bootstrap. Each holds only the
   per-write-path GRANTs its code actually uses (traced per script in THIS
   repo, not copied from mini — mini's visitor-analytics/blog/form-drafts
   worker set does not exist here), with **zero** access to the global
   catalogues it does not touch (`awcms_permissions`,
   `awcms_schema_migrations`, `awcms_setup_state`, the module registry).
   Neither is superuser/BYPASSRLS/owner, both carry the same fail-closed default
   GUC as `awcms_app`, and both are NOLOGIN without a password until a
   deployment activates them.

**OPT-IN, not breaking.** `getWorkerDatabaseClient`/`getSetupDatabaseClient`
(`src/lib/database/client.ts`) still fall back to `DATABASE_URL` (the
`awcms_app` connection) when `WORKER_DATABASE_URL`/`SETUP_DATABASE_URL` are
empty — a deployment that manages a single connection string keeps working
unchanged, and the roles simply sit there unused until a URL is pointed at them.
The benefit of opting in: **pool isolation** (a slow job does not exhaust the
connections serving HTTP,
`DATABASE_POOL_MAX_WORKER`/`DATABASE_POOL_MAX_SETUP`) **plus real
least-privilege role isolation**. The honest consequence of this optional
design: isolating `awcms_app` from `awcms_tenants`/`awcms_setup_state` is only
**complete** once `SETUP_DATABASE_URL` points at `awcms_setup` — until then the
setup wizard still runs its INSERT/UPDATE as `awcms_app` through the fallback
path (exactly why sql/021 kept `awcms_app`'s INSERT/UPDATE on both of those
tables).

Grant regressions for BOTH role layers are caught by the `security:readiness`
check: a new global table swept into blanket DML or a new tenant-scoped table
ungranted on `awcms_app` by "Runtime role table grants match least-privilege
matrix"; and `awcms_worker`/`awcms_setup` that — when provisioned — are
under/over-granted relative to their matrix by "Worker/setup least-privilege
role grants match matrix" (non-blocking when the role is not yet provisioned:
the default fallback). Compared with the state before 019 (everything through a
superuser), this is a firm layered improvement.

#### Deployment-aware capacity (target)

The plan is the same cross-instance connection capacity model as awcms-mini —
per-process pool/work-class versus the PostgreSQL/PgBouncer capacity approved
for the whole fleet of instances, validated through the
`database:capacity:check` command before go-live.

| Var                                             | Required | Default | Sensitive | Purpose                                                                                                              |
| ----------------------------------------------- | -------- | ------- | --------- | -------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_WORK_CLASS_QUEUE_MULTIPLIER`          | –        | `4`     | –         | FIFO queue depth per work class = max concurrency x this number; when full -> immediate reject (503 + `Retry-After`) |
| `DATABASE_CAPACITY_APP_INSTANCES_MIN`           | –        | `1`     | –         | Minimum `app` (web/SSR) instances expected to run concurrently                                                       |
| `DATABASE_CAPACITY_APP_INSTANCES_EXPECTED`      | –        | `1`     | –         | Expected steady-state `app` instances                                                                                |
| `DATABASE_CAPACITY_APP_INSTANCES_MAX`           | –        | `1`     | –         | Horizontal upper bound of `app` instances                                                                            |
| `DATABASE_CAPACITY_WORKER_INSTANCES_MIN`        | –        | `0`     | –         | Minimum `worker` instances (periodic scripts, not always-on daemons)                                                 |
| `DATABASE_CAPACITY_WORKER_INSTANCES_EXPECTED`   | –        | `1`     | –         | Expected steady-state `worker` instances                                                                             |
| `DATABASE_CAPACITY_WORKER_INSTANCES_MAX`        | –        | `1`     | –         | Horizontal upper bound of `worker` instances                                                                         |
| `DATABASE_CAPACITY_SETUP_INSTANCES_MIN`         | –        | `0`     | –         | Minimum `setup` instances                                                                                            |
| `DATABASE_CAPACITY_SETUP_INSTANCES_EXPECTED`    | –        | `0`     | –         | Expected steady-state `setup` instances                                                                              |
| `DATABASE_CAPACITY_SETUP_INSTANCES_MAX`         | –        | `1`     | –         | Horizontal upper bound of `setup` instances                                                                          |
| `DATABASE_CAPACITY_PGBOUNCER_MAX_CLIENT_CONN`   | –        | `200`   | –         | Expected `max_client_conn` from `pgbouncer.ini` (when `DATABASE_PGBOUNCER=true`)                                     |
| `DATABASE_CAPACITY_PGBOUNCER_DEFAULT_POOL_SIZE` | –        | `20`    | –         | Expected `default_pool_size` from `pgbouncer.ini` (when `DATABASE_PGBOUNCER=true`)                                   |
| `DATABASE_CAPACITY_APPROVED_CONNECTIONS`        | –        | `100`   | –         | PostgreSQL/PgBouncer connection budget approved for this deployment                                                  |
| `DATABASE_CAPACITY_RESERVED_ADMIN_CONNECTIONS`  | –        | `5`     | –         | Connections reserved for admin/migration/backup-restore — never used by app/worker/setup runtime sizing              |

The defaults above are meant to be safe for a single-instance LAN-first
topology without PgBouncer. Raise the instance MAX vars only when you genuinely
scale out horizontally.

### Auth & security

| Var                                         | Required         | Default                                  | Sensitive | Purpose                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------- | ---------------- | ---------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AUTH_SESSION_TTL_MIN`                      | –                | `120`                                    | –         | Session lifetime (opaque token, stored as `token_hash` — not a JWT)                                                                                                                                                                                                                                                                                                                                            |
| `AUTH_COOKIE_SECURE`                        | Yes (production) | –                                        | –         | The runtime sets the session cookie's `Secure` attribute **only** when the value is exactly `"true"` — a variable that is **not set means a cookie WITHOUT `Secure`**, which is why the rule is inverted: in production `config:validate` rejects any value other than `"true"`, including the unset state (fail-closed, `scripts/validate-env.ts`; the absent state is gated by `tests/validate-env.test.ts`) |
| `AUTH_LOGIN_MAX_ATTEMPTS`                   | –                | `5`                                      | –         | Login lockout — **per principal**, one counter per human across every tenant (ADR-0086)                                                                                                                                                                                                                                                                                                                        |
| `AUTH_LOGIN_RATE_LIMIT_MAX`                 | –                | `20`                                     | –         | Login rate limit per source+tenant                                                                                                                                                                                                                                                                                                                                                                             |
| `AUTH_LOGIN_RATE_LIMIT_WINDOW_SEC`          | –                | `60`                                     | –         | Login rate limit time window (seconds)                                                                                                                                                                                                                                                                                                                                                                         |
| `TRUSTED_PROXY_ENABLED`                     | Yes (production) | `false`                                  | –         | Must be explicit in production. `true` when behind a trusted proxy (the nginx profile); `false` when directly exposed. Choosing wrong breaks the login rate limit in both directions — see the note below                                                                                                                                                                                                      |
| `TRUSTED_PROXY_HOP_COUNT`                   | –                | `1`                                      | –         | Number of trusted hops in front of this process. The client entry is counted from the RIGHT by this number; entries to its left can be written by an attacker and are never read (#438). Rejected by `config:validate` when `TRUSTED_PROXY_ENABLED` is not `true`                                                                                                                                              |
| `AUTH_IP_HASH_SECRET`                       | –                | –                                        | secret    | HMAC key for the login audit `ipHash`; empty → a random per-process key (hashes are not comparable across restarts)                                                                                                                                                                                                                                                                                            |
| `AUTH_PASSWORD_RESET_TOKEN_TTL_MIN`         | –                | `30`                                     | –         | Password reset token lifetime                                                                                                                                                                                                                                                                                                                                                                                  |
| `AUTH_PASSWORD_RESET_RATE_LIMIT_MAX`        | –                | `5`                                      | –         | Forgot/reset rate limit per source+tenant                                                                                                                                                                                                                                                                                                                                                                      |
| `AUTH_PASSWORD_RESET_RATE_LIMIT_WINDOW_SEC` | –                | `900`                                    | –         | Password reset rate limit time window (seconds)                                                                                                                                                                                                                                                                                                                                                                |
| `AUTH_INVITATION_TOKEN_TTL_HOURS`           | –                | `168`                                    | –         | Invitation link lifetime, in HOURS (ADR-0082). Resend rotates the token so the TTL is recomputed from the resend; the database limits resends to 5 per row                                                                                                                                                                                                                                                     |
| `AUTH_INVITATION_RATE_LIMIT_MAX`            | –                | `5`                                      | –         | Invitation preview/accept rate limit per source+tenant                                                                                                                                                                                                                                                                                                                                                         |
| `AUTH_INVITATION_RATE_LIMIT_WINDOW_SEC`     | –                | `900`                                    | –         | Invitation rate limit time window (seconds)                                                                                                                                                                                                                                                                                                                                                                    |
| `AUTH_ONLINE_SECURITY_ENABLED`              | –                | `false`                                  | –         | Gate for full-online-only auth hardening — see §Full-online auth security hardening below                                                                                                                                                                                                                                                                                                                      |
| `AUTH_ONLINE_SECURITY_PROFILE`              | –                | `disabled`                               | –         | `disabled` (default) or `full_online`; must be `full_online` when `AUTH_ONLINE_SECURITY_ENABLED=true`                                                                                                                                                                                                                                                                                                          |
| `TURNSTILE_ENABLED`                         | –                | `false`                                  | –         | Cloudflare Turnstile bot protection                                                                                                                                                                                                                                                                                                                                                                            |
| `TURNSTILE_SITE_KEY`                        | if Turnstile     | –                                        | –         | Public site key (not a secret) — rendered in the `/login` widget                                                                                                                                                                                                                                                                                                                                               |
| `TURNSTILE_SECRET_KEY`                      | if Turnstile     | –                                        | Yes       | Secret key — server-side verification only                                                                                                                                                                                                                                                                                                                                                                     |
| `TURNSTILE_VERIFY_TIMEOUT_MS`               | –                | `5000`                                   | –         | Timeout for the Cloudflare siteverify call (ms)                                                                                                                                                                                                                                                                                                                                                                |
| `AUTH_MFA_ENABLED`                          | –                | `false`                                  | –         | MFA/TOTP login challenge                                                                                                                                                                                                                                                                                                                                                                                       |
| `AUTH_MFA_SECRET_ENCRYPTION_KEY`            | if MFA           | –                                        | Yes       | AES-256-GCM key (base64, 32 bytes) for encryption-at-rest of the TOTP secret                                                                                                                                                                                                                                                                                                                                   |
| `AUTH_MFA_TOTP_ISSUER`                      | –                | `AWCMS`                                  | –         | Issuer name shown in the authenticator app                                                                                                                                                                                                                                                                                                                                                                     |
| `AUTH_MFA_TOTP_PERIOD_SEC`                  | –                | `30`                                     | –         | TOTP time-step length (seconds)                                                                                                                                                                                                                                                                                                                                                                                |
| `AUTH_MFA_TOTP_DIGITS`                      | –                | `6`                                      | –         | Number of TOTP code digits (`6` or `8`)                                                                                                                                                                                                                                                                                                                                                                        |
| `AUTH_MFA_CHALLENGE_TTL_SEC`                | –                | `300`                                    | –         | MFA login challenge lifetime (seconds)                                                                                                                                                                                                                                                                                                                                                                         |
| `AUTH_MFA_RATE_LIMIT_MAX`                   | –                | `5`                                      | –         | MFA verification rate limit per source+tenant                                                                                                                                                                                                                                                                                                                                                                  |
| `AUTH_MFA_RATE_LIMIT_WINDOW_SEC`            | –                | `300`                                    | –         | MFA verification rate limit time window (seconds)                                                                                                                                                                                                                                                                                                                                                              |
| `AUTH_GOOGLE_LOGIN_ENABLED`                 | –                | `false`                                  | –         | Google OIDC login                                                                                                                                                                                                                                                                                                                                                                                              |
| `AUTH_GOOGLE_CLIENT_ID`                     | if Google        | –                                        | –         | OAuth client ID from the Google Cloud Console                                                                                                                                                                                                                                                                                                                                                                  |
| `AUTH_GOOGLE_CLIENT_SECRET`                 | if Google        | –                                        | Yes       | OAuth client secret — server-side token exchange only                                                                                                                                                                                                                                                                                                                                                          |
| `AUTH_GOOGLE_ALLOWED_DOMAINS`               | –                | –                                        | –         | Comma-separated list of email domains allowed to auto-link; empty = auto-link is always refused                                                                                                                                                                                                                                                                                                                |
| `AUTH_GOOGLE_REDIRECT_PATH`                 | –                | `/api/v1/auth/providers/google/callback` | –         | OAuth callback path under `APP_URL`                                                                                                                                                                                                                                                                                                                                                                            |
| `AUTH_SSO_ENABLED`                          | –                | `false`                                  | –         | Generic tenant OIDC SSO                                                                                                                                                                                                                                                                                                                                                                                        |
| `AUTH_SSO_CREDENTIAL_ENCRYPTION_KEY`        | if SSO           | –                                        | Yes       | AES-256-GCM key (base64, 32 bytes) for encryption-at-rest of a provider's client secret — different from the MFA key                                                                                                                                                                                                                                                                                           |
| `AUTH_SSO_CLIENT_SECRET_<SUFFIX>`           | –                | –                                        | Yes       | The ONLY variable names a tenant SSO provider may name in `clientSecretEnvVar` (`^AUTH_SSO_CLIENT_SECRET_[A-Z0-9_]{1,48}$`). None exists by default; create one per provider. Any other name is refused at write time AND re-refused when the secret is read, so a row written before the rule cannot keep working                                                                                             |
| `AUTH_SSO_DISCOVERY_TIMEOUT_MS`             | –                | `5000`                                   | –         | Timeout for tenant OIDC provider discovery/JWKS/token-exchange (ms)                                                                                                                                                                                                                                                                                                                                            |
| `AUTH_SSO_MAX_PROVIDERS_PER_TENANT`         | –                | `20`                                     | –         | Limit on the number of active provider rows per tenant                                                                                                                                                                                                                                                                                                                                                         |

### Full-online auth security hardening (optional, target)

A shared gate for online-only features: Cloudflare Turnstile, MFA/TOTP, Google
OIDC login, generic tenant OIDC SSO, and the admin policy UI. It is **not** a
replacement for the `APP_ENV=production` deployment model — an offline/LAN
deployment is planned to be operationally production-grade without ever needing
these online-only features.

- `AUTH_ONLINE_SECURITY_ENABLED` unset (or not `"true"`) → every online-only
  hardening feature is considered off; no provider credential of any kind is
  required. This is the default for every offline/LAN deployment.
- `AUTH_ONLINE_SECURITY_ENABLED=true` requires
  `AUTH_ONLINE_SECURITY_PROFILE=full_online` — any other value (including an
  explicitly contradictory `"disabled"`) is planned to fail `config:validate`.
- The plan is one centralised helper (the `isFullOnlineSecurityActive(env)`
  pattern) that every online/provider-related feature must call before doing
  anything online/provider-related — do not re-derive the "both must agree"
  rule anywhere else.
- **Cloudflare Turnstile** — planned to be validated independently of the gate
  above, but runtime activation requires BOTH (gate ∧ `TURNSTILE_ENABLED=true`).
  It applies to `POST /auth/login`, `/auth/password/forgot`,
  `/auth/password/reset`, `/setup/initialize` — the token is verified
  server-side against Cloudflare siteverify BEFORE the expensive password/DB
  work. Verification is fail-closed by design; only a genuine transport failure
  to Cloudflare opens its circuit breaker — a normal `success:false` response
  (the client token really is wrong) does not trip the breaker.
- **MFA/TOTP** — `AUTH_MFA_ENABLED` is planned to be validated independently of
  the gate above, but runtime activation requires BOTH. MFA is **opt-in per
  identity**, not mandatory tenant-wide. The TOTP secret is encrypted at rest
  (AES-256-GCM, `AUTH_MFA_SECRET_ENCRYPTION_KEY`) — the only application secret
  that is reversibly encrypted rather than hashed, because it must be
  recomputable to verify a code. Recovery codes are stored hash-only. A
  password reset does NOT disable MFA.
- **Google OIDC login** — the provider account is linked via `sub` (the OIDC
  subject), NEVER via email — auto-link by email only happens when
  `email_verified` is true AND its domain is in `AUTH_GOOGLE_ALLOWED_DOMAINS`
  (empty = auto-link is always refused, fail-closed). The ID token is fully
  cryptographically verified (signature, issuer, audience, expiry, nonce).
- **Generic tenant OIDC SSO** — a PARALLEL path for tenant-configured providers
  (Okta, Azure AD, Keycloak, etc.), separate from Google OIDC login. The
  provider's client secret is either AES-256-GCM encrypted OR an env-var
  reference — exactly one, never both, and never plaintext in any API response.
  **Break-glass enforcement**: `sso_required=true` or
  `password_login_enabled=false` cannot be saved unless at least one break-glass
  identity is currently active — re-checked from the DB at SAVE time and at
  readiness/go-live time.
- **Admin policy UI** — shows a status summary of every feature above; in every
  offline/LAN/local deployment (the default) the page only shows read-only
  information, without any form or table.

### Request body size limits (target)

Planned as code constants (not env vars) — deliberately not made configurable
so that no deployment can silently loosen the hard ceiling without a code
review. Every `/api/*` handler that accepts a body reads through the
`readJsonBody`/`readTextBody`/`readFormBody` helpers (replacing direct
`request.json()`/`.text()`/`.formData()`) — enforcing the declared
`Content-Length` BEFORE any byte is read, plus streaming byte counting for
chunked bodies/bodies without a `Content-Length`. The planned tiers:
`default` (128 KiB, the majority of CRUD/settings/auth endpoints),
`large` (5 MiB, content-heavy/batch endpoints — e.g. finance/inventory data
import, `sync/push`/`sync/objects` batches). The hard ceiling is 10 MiB — no
tier may exceed it. An oversized body is always `413 PAYLOAD_TOO_LARGE`.

### Sync & node

| Var                       | Required | Default | Sensitive | Purpose                                                                                                        |
| ------------------------- | -------- | ------- | --------- | -------------------------------------------------------------------------------------------------------------- |
| `AWCMS_SYNC_ENABLED`      | –        | `false` | –         | Enable hybrid sync (offline-first outbox)                                                                      |
| `AWCMS_SYNC_HMAC_SECRET`  | if sync  | –       | Yes       | HMAC signature                                                                                                 |
| `AWCMS_SYNC_MAX_SKEW_SEC` | –        | `300`   | –         | Anti-replay tolerance                                                                                          |
| `SYNC_HMAC_ALLOW_LEGACY`  | –        | `true`  | –         | Accept v1 signatures (not bound to tenant/node, vulnerable to GHSA-c972); set `false` once every node sends v2 |

Node identity is planned to come from the `awcms_sync_nodes` table (DB),
registered automatically through the header/HMAC on the first sync request —
not a separate env var (following the awcms-mini finding that deprecated
`AWCMS_MINI_NODE_ID` because no code ever read it).

### Storage

| Var                             | Required | Default | Sensitive | Purpose                                                                             |
| ------------------------------- | -------- | ------- | --------- | ----------------------------------------------------------------------------------- |
| `R2_ENABLED`                    | –        | `false` | –         | Enable R2 object storage (e.g. finance document attachments, inventory item photos) |
| `R2_ACCOUNT_ID`                 | if R2    | –       | –         | R2 account (an identifier, not a credential)                                        |
| `R2_ACCESS_KEY_ID`              | if R2    | –       | Yes       | R2 credential                                                                       |
| `R2_SECRET_ACCESS_KEY`          | if R2    | –       | Yes       | R2 credential                                                                       |
| `R2_BUCKET`                     | if R2    | –       | –         | Bucket                                                                              |
| `OBJECT_SYNC_UPLOAD_TIMEOUT_MS` | –        | `10000` | –         | Dispatcher upload timeout                                                           |

Local filesystem storage (`STORAGE_DRIVER`/`LOCAL_STORAGE_PATH`) is
deliberately not made a separate env var — following the awcms-mini finding
that the local/R2 switch really only needs one flag (`R2_ENABLED`).

### Edge cache / Varnish (ADR-0042)

An OPTIONAL cache tier in front of the application
(`src/lib/edge-cache/config.ts`,
[`edge-cache-architecture.md`](edge-cache-architecture.md)). None of these
variables is set by default, and not being set means the subsystem is
**genuinely inert** — no surrogate header, no invalidation, no behavioural
change. Turning it on is a two-sided change: the application is configured here
AND a Varnish container is put in front
(`infra/varnish/docker-compose.varnish.yml`).

| Var                                         | Required    | Default | Sensitive | Purpose                                                                                                                                                                                                                                                                                       |
| ------------------------------------------- | ----------- | ------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EDGE_CACHE_MODE`                           | –           | `off`   | –         | `off` (inert) \| `auto` (TTL ramps up only when the origin is under pressure — recommended) \| `on` (always advertise the declared TTL). The mode NEVER changes WHAT may be cached — that is a fail-closed allow-list                                                                         |
| `EDGE_CACHE_PURGE_ENDPOINT`                 | if enabled  | –       | –         | The Varnish listener that receives `BAN` (invalidation) requests, e.g. `http://varnish:80`. Without it, edited content keeps being served until the TTL expires. Note: purge reaches **Varnish only** — see §Purge reach limits in `edge-cache-architecture.md`                               |
| `EDGE_CACHE_PURGE_TOKEN`                    | if endpoint | –       | Yes       | Shared secret for the `X-Edge-Purge-Token` header, must match the Varnish container's. An endpoint WITHOUT a token = a CRITICAL `security:readiness` finding: the VCL rejects unauthenticated BANs, every invalidation fails silently and the site serves stale content while looking healthy |
| `EDGE_CACHE_MAX_TTL_SECONDS`                | –           | `300`   | –         | Hard ceiling on the advertised edge TTL; it clamps any surface declaring something longer. A value of `0` while the cache is active = nothing is ever cached (reported by the validator)                                                                                                      |
| `EDGE_CACHE_STALE_WHILE_REVALIDATE_SECONDS` | –           | `600`   | –         | How long the edge may serve a stale copy while revalidating in the background — the main thundering-herd protection for the database                                                                                                                                                          |
| `EDGE_CACHE_AUTO_REQUEST_RATE_THRESHOLD`    | –           | `5`     | –         | The sustained requests/second threshold that starts the `auto` mode TTL ramp (full TTL is reached at 2× the threshold)                                                                                                                                                                        |
| `EDGE_CACHE_AUTO_LATENCY_THRESHOLD_MS`      | –           | `250`   | –         | The rolling-average origin latency threshold (ms) that starts the `auto` mode TTL ramp                                                                                                                                                                                                        |
| `EDGE_CACHE_AUTO_WINDOW_SECONDS`            | –           | `60`    | –         | The measurement window for the `auto` mode thresholds (seconds)                                                                                                                                                                                                                               |
| `EDGE_CACHE_PURGE_BATCH_SIZE`               | –           | `200`   | –         | Purge queue rows drained per tenant per `bun run edge-cache:purge` pass                                                                                                                                                                                                                       |

The most expensive misconfiguration is not the one that turns boot red: an
endpoint without a token (invalidation fails silently, stale content forever)
and a `MAX_TTL` raised without noticing (one careless declaration pins stale
content at the edge) — both are checked by
`config:validate`/`security:readiness`, not guessed at.

### Email (notifications — target)

Planned as a reusable base module for password reset, system announcements, and
workflow notifications (e.g. finance/procurement approvals needing multi-level
sign-off) — provider-neutral.

| Var                      | Required   | Default | Sensitive | Purpose                                                    |
| ------------------------ | ---------- | ------- | --------- | ---------------------------------------------------------- |
| `EMAIL_ENABLED`          | –          | `false` | –         | Enable the email module                                    |
| `EMAIL_PROVIDER`         | if enabled | –       | –         | Email provider adapter (`log` for dev without credentials) |
| `EMAIL_FROM_ADDRESS`     | if enabled | –       | –         | Default sender address                                     |
| `EMAIL_FROM_NAME`        | –          | `AWCMS` | –         | Default sender name                                        |
| `EMAIL_SEND_TIMEOUT_MS`  | –          | `10000` | –         | Timeout for a single send attempt (dispatcher)             |
| `EMAIL_SEND_MAX_RETRIES` | –          | `5`     | –         | Retry attempt limit before a final `failed`                |

Concrete email provider credentials (e.g. `EMAIL_<PROVIDER>_API_TOKEN`) are
added once that provider adapter is actually implemented — they are not
registered up front.

### Data lifecycle (target)

Planned as a System Foundation module for a cross-module registry of
high-volume tables and a lifecycle engine (retention/partitioning/archive/legal
hold/safe purge) — relevant for high-volume ERP finance/transaction data with
long-term retention/audit obligations.

| Var                                | Required | Default                        | Sensitive | Purpose                                                                      |
| ---------------------------------- | -------- | ------------------------------ | --------- | ---------------------------------------------------------------------------- |
| `DATA_LIFECYCLE_ARCHIVE_ROOT_PATH` | –        | `./var/data-lifecycle-archive` | –         | Filesystem root where the local/offline archive adapter writes its artifacts |

### ERP & business integrations — placeholder

There are no env vars specific to ERP modules (finance/accounting, inventory/
warehouse, procurement, manufacturing, HR/payroll) or to external business
integrations (payment gateway, marketplace, tax/Coretax, logistics provider) in
this repo — **no module has been implemented yet** (see the status above).

As those modules start being built, their env vars will be documented here
following the same pattern as every other section above: an `*_ENABLED` flag
defaulting to `false`, credentials only from the environment/a secret manager
(never a tenant-controlled DB column unless there is an explicitly documented
accepted risk), a circuit breaker + timeout per provider, graceful degradation
when a provider is off (the transaction is still recorded, synchronisation to
the provider is deferred — not a total failure), and cross-field validation
through `config:validate`/`security:readiness`. See
[`templates/module-proposal-template.md`](templates/module-proposal-template.md)
and
[`templates/module-admission-decision-checklist.md`](templates/module-admission-decision-checklist.md)
for the admission process for a new module, including the checklist specific to
external providers.

## Feature flag

```mermaid
flowchart LR
  Boot[Boot] --> Val[Env validation]
  Val --> Flags{Feature flags}
  Flags -->|R2 off| L[Local storage]
  Flags -->|EMAIL_ENABLED off| Q0[Email module - outbox waits, dispatcher does not run]
  Flags -->|Sync off| LanOnly[LAN-only]
  Flags -->|External ERP provider off| Q1[Transaction still recorded - synchronisation to the provider deferred]
```

Rule: a feature being off does not stop core operations (recording
transactions); messages/objects/documents still enter the queue and wait for
the feature to be enabled.

## Complete `.env.example` (recommended, target)

```env
# Core
APP_ENV=development
APP_URL=http://localhost:4321
LOG_LEVEL=info
AUDIT_LOG_RETENTION_DAYS=730
FORM_DRAFT_RETENTION_DAYS=30

# Database
DATABASE_URL=postgres://awcms:awcms_password@localhost:5432/awcms
DATABASE_POOL_MAX=20
DATABASE_STATEMENT_TIMEOUT_MS=15000
DATABASE_PGBOUNCER=false

# Auth
AUTH_SESSION_TTL_MIN=120
AUTH_COOKIE_SECURE=true
AUTH_LOGIN_MAX_ATTEMPTS=5
AUTH_LOGIN_RATE_LIMIT_MAX=20
AUTH_LOGIN_RATE_LIMIT_WINDOW_SEC=60
AUTH_PASSWORD_RESET_TOKEN_TTL_MIN=30
AUTH_PASSWORD_RESET_RATE_LIMIT_MAX=5
AUTH_PASSWORD_RESET_RATE_LIMIT_WINDOW_SEC=900
AUTH_ONLINE_SECURITY_ENABLED=false
AUTH_ONLINE_SECURITY_PROFILE=disabled
TURNSTILE_ENABLED=false
TURNSTILE_VERIFY_TIMEOUT_MS=5000
AUTH_MFA_ENABLED=false
AUTH_MFA_TOTP_ISSUER=AWCMS
AUTH_MFA_TOTP_PERIOD_SEC=30
AUTH_MFA_TOTP_DIGITS=6
AUTH_MFA_CHALLENGE_TTL_SEC=300
AUTH_MFA_RATE_LIMIT_MAX=5
AUTH_MFA_RATE_LIMIT_WINDOW_SEC=300
AUTH_GOOGLE_LOGIN_ENABLED=false
AUTH_GOOGLE_REDIRECT_PATH=/api/v1/auth/providers/google/callback
AUTH_SSO_ENABLED=false
AUTH_SSO_DISCOVERY_TIMEOUT_MS=5000
AUTH_SSO_MAX_PROVIDERS_PER_TENANT=20

# Sync
AWCMS_SYNC_ENABLED=false
AWCMS_SYNC_HMAC_SECRET=change-me
AWCMS_SYNC_MAX_SKEW_SEC=300
SYNC_HMAC_ALLOW_LEGACY=true

# Storage
OBJECT_SYNC_UPLOAD_TIMEOUT_MS=10000
R2_ENABLED=false

# Email (notifications)
EMAIL_ENABLED=false
EMAIL_FROM_NAME=AWCMS
EMAIL_SEND_TIMEOUT_MS=10000
EMAIL_SEND_MAX_RETRIES=5

# ERP & business integrations (not present yet — see §ERP & business integrations above)
```

## Per-environment profiles

| Environment         | Characteristics                                                                                            |
| ------------------- | ---------------------------------------------------------------------------------------------------------- |
| development         | All providers off, local DB, cookie not secure                                                             |
| production (online) | HTTPS, secret manager, tested backup+restore, sync optional                                                |
| **offline/LAN**     | No internet; sync/R2/external providers off or deferred; core operations still fully running; local backup |

Three, not four: `staging` was removed from the deployment profile vocabulary
([ADR-0083](../adr/0083-this-template-deploys-to-one-environment.md)
as amended). Its isolation contract did not disappear with it — it applies to
any second environment someone stands up, and is written down in
[`environments.md`](environments.md) §Second-environment isolation contract.
`test` is still an accepted `APP_ENV` value for automated test execution; that
is not a deployment profile.

## LAN-first deployment topology

```mermaid
flowchart TB
  subgraph LAN["Office / Warehouse / LAN"]
    P1[Operational Application 1]
    P2[Operational Application 2]
    A1[Admin]
    Srv[AWCMS - Bun/Astro]
    DB[(PostgreSQL)]
    Bak[Local backup]
    Srv --- DB
    Srv --- Bak
    P1 --- Srv
    P2 --- Srv
    A1 --- Srv
  end
  Srv -. when online .-> Cloud[(Central server / R2 / external ERP provider)]
```

- One LAN server runs the application + PostgreSQL; clients connect over the
  local network.
- External providers & sync only when online; core operations do not depend on
  them.
- Deployment: `deploy/systemd`, `deploy/nginx`, `deploy/pgbouncer`,
  `deploy/backup` (planned, following the awcms-mini pattern).

## Configuration validation at boot

- A missing required var → fail to start with a clear message (without leaking
  the value).
- A flag enabled without credentials (e.g. `R2_ENABLED=true` without a key) →
  fail to start.
- Secrets never enter logs (redaction).

## Acceptance criteria (target)

- Boot validates the env; a missing required var stops the start with a safe message.
- A provider being off does not stop core operations; messages/objects/documents enter the queue.
- Secrets come only from the env; none in code/commits/logs/responses.
- Tenant preferences (locale/theme) come from `awcms_tenants`, not hardcoded.
- The offline/LAN profile runs fully without internet.
