🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](mfa-totp-step-up.id.md)

# MFA TOTP, recovery codes, and step-up authentication

Implementation reference for Issue #184 (epic #177). Module: `identity-access`. ADRs: [ADR-0027](../adr/0027-mfa-totp-session-assurance-step-up.md) and [ADR-0087](../adr/0087-mfa-moves-to-the-principal.md). Schema: `sql/024_awcms_mfa_totp_schema.sql` + `sql/114_awcms_principal_mfa.sql`.

> **Since `sql/114` (ADR-0087) the factor belongs to the HUMAN, not to a per-tenant identity.**
> `awcms_principal_mfa_factors` and `awcms_principal_mfa_recovery_codes` are keyed by
> `principal_id`, GLOBAL and without RLS — one enrolment authenticates every tenant
> that person belongs to. The `sql/024` encryption is **unchanged**. What stays tenant-scoped
> under FORCE RLS: `awcms_mfa_challenges` (one login attempt in one tenant) and
> `awcms_tenant_mfa_policies` (a tenant's product decision). **The factor belongs to the
> human; the obligation belongs to the tenant.** The old `awcms_identity_mfa_*` tables are kept
> as history, with the `awcms_app` privileges downgraded to `SELECT`. None of the flows below
> change shape — the HTTP surface stays `(tenant, identity)`; only the storage
> is global.

## 1. Flow summary (auth flow)

### 1.1 Enrollment

```
POST /api/v1/auth/mfa/totp/enroll/start   (valid session; AUTH_MFA_ENABLED=true)
  -> generate a 20-byte secret (CSPRNG), store a `pending` factor (encrypted secret)
  -> respond { secret (base32), otpauthUri }   # shown ONCE
POST /api/v1/auth/mfa/totp/enroll/verify  { code }
  -> verifyTotpCode; if valid -> factor `active`, last_used_step = matchedStep
  -> generate 10 recovery codes, store hash-only
  -> respond { activated, recoveryCodes }       # shown ONCE
```

Restarting `enroll/start` before verify discards the previous pending secret — only the last QR is valid once confirmed. `enroll/start` refuses when an `active` factor already exists (`409 MFA_ALREADY_ACTIVE`).

### 1.2 Two-stage login

```
POST /api/v1/auth/login  { loginIdentifier, password }
  -> password valid + an active factor:
       reset failed_login_count, create a challenge (TTL AUTH_MFA_CHALLENGE_TTL_SEC),
       audit mfa_challenge_issued, respond 401 MFA_REQUIRED + { mfaChallengeToken, expiresAt }
  -> password valid + no factor + policy REQUIRED (see 1.5):
       respond 401 MFA_ENROLLMENT_REQUIRED + { mfaEnrollmentToken, expiresAt } — NO session
  -> password valid + no factor + policy optional: an aal1 session as usual
POST /api/v1/auth/mfa/totp/verify  { mfaChallengeToken, code | recoveryCode }   # PUBLIC
  -> verifyMfaChallenge (replay-safe), create an aal2 session, audit mfa_challenge_verified
  -> respond { token, expiresAt, assuranceLevel: "aal2" } + cookie
```

The MFA branch in `login.ts` is only reached **after** the password is valid → there is no new enumeration oracle (an unknown identifier / locked account / wrong password have already collapsed into a single response before this point). The verify endpoint is authenticated by possession of the `mfaChallengeToken` (there is no session yet), just like a password reset. Every challenge deny path collapses to `MFA_CHALLENGE_INVALID` (identical response & timing for an unknown / expired / already-used challenge, a wrong code, a locked factor, or a disabled factor).

### 1.3 Step-up (high-risk actions)

```
POST /api/v1/auth/mfa/step-up  { code | recoveryCode }   (valid session)
  -> verifyStepUpFactor (replay-safe)
  -> aal1 session: revoke the old one + create a new aal2 session (rotation, anti-fixation), respond with the new token
  -> aal2 session: refresh stepped_up_at in place
```

High-risk endpoints call `requireStepUp(tx, tenantId, tokenHash, now)` **after** `authorizeInTransaction`. The gate returns `403 STEP_UP_REQUIRED` when the session is not aal2 or the step-up is stale (> `AUTH_MFA_STEPUP_TTL_SEC`). Usage example:

```ts
const auth = await authorizeInTransaction(tx, tenantId, tokenHash, now, GUARD);
if (!auth.allowed) return auth.denied;
const stepUp = await requireStepUp(tx, tenantId, tokenHash, now);
if (!stepUp.ok) return stepUp.denied;
// ... high-risk action ...
```

The MFA module's own high-risk actions that are **already** guarded by `requireStepUp`: self-service `disable`, `recovery-codes/regenerate`, `admin/reset`, and `PUT policy`. For a derived ERP application, call `requireStepUp` on its own sensitive actions (posting, override, SoD exception) — the #179/#181 integration pattern.

### 1.4 Self-service & admin

- `GET /api/v1/auth/mfa/status` — the enrollment status of your own identity.
- `POST /api/v1/auth/mfa/totp/disable` — turn off your own MFA (audit `warning`; **requires a fresh step-up** — re-authenticate the factor).
- `POST /api/v1/auth/mfa/recovery-codes/regenerate` — invalidate every old recovery code and issue 10 new ones shown once (**requires a fresh step-up**).
- `POST /api/v1/auth/mfa/admin/reset` `{ identityId, reason }` — reset another user's MFA; guarded by `identity_access.mfa_admin.reset`, **requires a fresh step-up**, audit `critical`, self-reset forbidden. **Since ADR-0087 this action REACHES OUTSIDE the acting tenant**: the factor belongs to the human, so resetting it in tenant A also revokes the authenticator that person uses in tenant B. This is the only place in the repo where a tenant admin action changes state that another tenant relies on, and it is recorded as `crossTenantReach: true` on the `critical` audit row plus `disabled_by_tenant_id` on the factor row — **stating that it reaches outside, without saying where to**. A tenant list is deliberately not produced: it would become a cross-tenant membership oracle for anyone holding the reset permission, and FORCE RLS also makes writing an audit row in the other tenant impossible.
- `GET`/`PUT /api/v1/auth/mfa/policy` — read/set the tenant's enforcement level (`PUT` guarded by `identity_access.mfa_admin.configure` + **a fresh step-up**).

### 1.5 Tenant enforcement policy (F1)

The tenant policy (`awcms_tenant_mfa_policies`, default `optional`) is genuinely enforced at login:

- `optional` — MFA is available, never forced.
- `required_for_all` — every user of the tenant must use MFA.
- `required_for_privileged` — mandatory for a user holding any **non-read** permission (`isPrivilegedFromPermissionKeys`; a broad classification = fail-closed).

When the policy requires MFA for a user whose password is valid but who **has no factor yet**, login does **not** issue a full session. Instead it returns `401 MFA_ENROLLMENT_REQUIRED` + an `mfaEnrollmentToken` (an `awcms_mfa_challenges` row with `purpose='enrollment'`). That token authorises **only** `enroll/start`/`enroll/verify` (sent via the header `X-AWCMS-MFA-Enrollment-Token`, not as a general session); once enrollment finishes, the grant is consumed and an `aal2` session is issued. Fail-closed but **self-recoverable** — there is no admin lockout. Enforcement is gated by `isMfaFeatureEnabled()`: if enrollment is turned off, the policy is inert (it is impossible to create the MFA it demands).

### 1.5b Entering a tenant by selection or switching (ADR-0088)

Since `sql/115` there are two other ways into a tenant: exchanging a selection token
(`POST /api/v1/auth/session/tenant`, after logging in without a tenant header) and
switching (`POST /api/v1/auth/session/switch`). **Both run the §1.5 policy gate
in full** via `evaluateTenantEntry` — `MFA_REQUIRED` +
a challenge if the person has a factor, `MFA_ENROLLMENT_REQUIRED` + a grant if
the destination tenant requires MFA and they do not have one yet.

That is not excessive caution: without that gate, someone who logs in
to a lax tenant A could switch into a tenant B that requires MFA and
land as an `aal1` session — tenant switching becomes an **MFA bypass**, and
the tenant with the strictest posture is the one harmed most. Since ADR-0087
the factor belongs to the human, so the same authenticator satisfies tenant B's demand
without re-enrolling.

**Assurance does not travel**: a session produced by selection/switching is always born
`aal1`, even from an `aal2` session. Step-up is fresh proof for ONE tenant.

### 1.6 Per-factor lockout (F4)

Besides the per-source rate limit and the per-challenge `failed_attempts` cap, each factor has a cumulative `failed_verify_count`/`locked_until` (independent of the source IP and of challenge rotation, mirroring the password lockout). After `AUTH_MFA_MAX_VERIFY_ATTEMPTS` failed verifies, the factor is locked for `AUTH_MFA_LOCKOUT_MINUTES` minutes; a successful verify resets it. On a login challenge, a locked factor collapses to `MFA_CHALLENGE_INVALID`; on step-up, it returns `MFA_LOCKED` (429).

**Since ADR-0087 that lockout is GLOBAL**, because the counter is attached to the factor and the factor moved — the same consequence ADR-0086 took for passwords: an attacker who knows someone's password can lock that person's authenticator across every tenant at once. The ADR-0086 rule applies in full, so that trade-off is taken together with **all three** of its recovery levers, which are now global too: recovery codes, self-service `disable` + re-enrolment, and an administrative reset. Previously a factor lockout in tenant A could not be undone by an admin of tenant B; afterwards any of those three paths fully restores the person — recovery is better than before, not worse.

## 2. Configuration / environment reference

| Variable                         | Default                 | Description                                                                                            |
| -------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------ |
| `AUTH_MFA_ENABLED`               | `false`                 | Gates the **enrollment** surface only. Challenge/disable/step-up are driven by DB state (fail-closed). |
| `AUTH_MFA_SECRET_ENCRYPTION_KEY` | — (required if enabled) | 32 bytes base64 (`openssl rand -base64 32`). **There is no default key.**                              |
| `AUTH_MFA_TOTP_ISSUER`           | `AWCMS`                 | The issuer label in `otpauth://`.                                                                      |
| `AUTH_MFA_TOTP_PERIOD_SEC`       | `30`                    | Timestep length.                                                                                       |
| `AUTH_MFA_TOTP_DIGITS`           | `6`                     | 6 or 8.                                                                                                |
| `AUTH_MFA_TOTP_WINDOW_STEPS`     | `1`                     | Drift tolerance ± timesteps; clamped to `[0, 10]`.                                                     |
| `AUTH_MFA_CHALLENGE_TTL_SEC`     | `300`                   | Lifetime of a login challenge.                                                                         |
| `AUTH_MFA_STEPUP_TTL_SEC`        | `300`                   | Step-up freshness; short & server-controlled.                                                          |
| `AUTH_MFA_MAX_VERIFY_ATTEMPTS`   | `5`                     | Per-factor lockout: lock after N failed verifies (independent of source IP & challenge).               |
| `AUTH_MFA_LOCKOUT_MINUTES`       | `15`                    | How long the factor stays locked once the lockout is reached.                                          |
| `AUTH_MFA_RATE_LIMIT_MAX`        | `5`                     | Verification limit per source; also caps `failed_attempts` per challenge.                              |
| `AUTH_MFA_RATE_LIMIT_WINDOW_SEC` | `300`                   | Verification rate limit window.                                                                        |

`config:validate` and `security:readiness` reject a deployment with `AUTH_MFA_ENABLED=true` but an empty/placeholder/non-32-byte key.

## 3. Encryption key rotation runbook

The ciphertext format is versioned (`v1:iv:tag:ct`). A zero-downtime rotation scheme needs multi-key support (which does not exist yet); the current procedure:

1. **Preparation** — generate a new key with `openssl rand -base64 32`.
2. **Scheduled rotation (maintenance window)** — because only one key is active, replacing the key **invalidates** every stored secret (TOTP verification will fail with `MFA_MISCONFIGURED`). The safe procedure: (a) announce the window, (b) set the new key, (c) ask every MFA user to **re-enroll** (old factors automatically cannot be verified; an admin can do a mass `admin/reset` if needed), or (d) run a controlled mass disable before rotating. For large deployments, wait for multi-key support (roadmap) before making rotation routine.
3. **Verification** — `bun run security:readiness` must PASS the key check; sample one end-to-end MFA login.

Never commit a key. Store it in a secrets manager / the deployment env, not the repo.

## 4. Admin recovery SOP

**When:** the user has lost their TOTP device and run out of recovery codes.

1. **Verify identity out of band** (not through the application) according to organisational policy — confirm this really is that user.
2. An admin holding `identity_access.mfa_admin.reset`, with a session that **already** has MFA of its own (the self-reset prohibition enforces that an admin cannot reset themselves), calls `POST /api/v1/auth/mfa/admin/reset` `{ identityId, reason }`. `reason` is **mandatory** and is recorded in the `critical` audit.
3. The user's factor is disabled + their recovery codes are deleted. The user can now log in with their password (an aal1 session) and **re-enroll** MFA. **The effect is global** (ADR-0087): because the factor belongs to the human, this reset also revokes that person's MFA in every other tenant they work in. Say so during the out-of-band verification — the person needs to re-enroll once, and that enrolment applies again to all of their tenants.
4. **Break-glass:** keep at least one admin identity with active MFA per tenant so a reset can always be performed; document who holds it. Never disable MFA for all admins at once.
5. Review the `mfa_admin_reset` audit periodically (severity `critical`) to detect reset abuse.

## 5. Threat model

| Threat                         | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Stolen password**            | A second factor (TOTP) is required before a full session; a valid password login with an active factor only issues a challenge, not a session.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Session fixation**           | The aal1→aal2 rise (login challenge & step-up) rotates the session: a new token is issued and the old session is revoked.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **TOTP code replay**           | `last_used_step` is strictly monotonic; it advances via compare-and-swap so that of two concurrent requests on the same timestep only one wins. The drift window is bounded.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Recovery code replay**       | Consumption via `UPDATE ... AND used_at IS NULL RETURNING` — of two concurrent requests with the same code only one succeeds; hash-only, single-use.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Leaked DB backup**           | The TOTP secret is encrypted with AES-256-GCM using a key held outside the DB; without the key, a backup yields no secret. Recovery codes are hashes only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Account enumeration**        | The MFA branch is reached only after the password is valid; every challenge deny collapses to one code/message; the login path keeps its anti-timing dummy hash and its collapsed deny reasons.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Reset abuse**                | An admin reset needs a dedicated permission (default-deny), a mandatory reason, a `critical` audit, the self-reset prohibition, and documented break-glass.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Challenge brute-force**      | Three layers: a per-source rate limit (`AUTH_MFA_RATE_LIMIT_*`), a per-challenge `failed_attempts` cap, and a cumulative per-factor lockout (`AUTH_MFA_MAX_VERIFY_ATTEMPTS`/`AUTH_MFA_LOCKOUT_MINUTES`) that locks out a password-holding attacker who mints new challenges + rotates IPs.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Cross-tenant factor access** | The MFA tables that are **tenant-scoped** (`awcms_mfa_challenges`, `awcms_tenant_mfa_policies`, plus the two `awcms_identity_mfa_*` tables that are now history) have RLS `ENABLE`+`FORCE` with the policy `tenant_id = current_setting('app.current_tenant_id')`; the app connects as `awcms_app` (non-superuser). Both **principal** tables deliberately have no RLS (ADR-0087) — there is no `tenant_id` to compare against, because one human really is one factor for all of their tenants. The replacement: the four ADR-0085 controls (narrowed privileges, a per-call-site read-shape gate `bun run identity:principal-access:check`, `secret_ciphertext` never leaving the store module, and the authorization boundary not moving), plus an identity→principal hop keyed by `(tenant_id, id)` so that an identity id from another tenant resolves to nothing. |
| **MFA silently disabled**      | `security:readiness` fails `critical` if `AUTH_MFA_ENABLED=true` without a valid key.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

## 6. Standards mapping

**OWASP ASVS v4 (Authentication):**

- V2.1 (password) — carried over from #147 (argon2id, lockout, anti-timing).
- V2.2.1 (anti-enumeration) — uniform response/timing; collapsed challenges.
- V2.8 (OTP verifier) — RFC 6238 TOTP, HMAC-SHA1, single-use per timestep (anti-replay), bounded window, constant-time compare.
- V2.10 (service auth secrets) — the encryption key comes from the env/a secrets manager, with no default.
- V3 (session) — opaque token, rotation on privilege rise (anti-fixation), assurance level.
- V6.2 (cryptography) — AES-256-GCM (authenticated), a random IV per operation.

**ISO/IEC 27001/27002 (Annex A / controls):**

- A.5.17 / A.9.4 (authentication information & access) — MFA for privileged accounts, step-up on sensitive actions.
- A.8.5 (secure authentication) — a second factor, assurance levels.
- A.8.24 (cryptography) — secret encryption at rest, key management.
- A.8.15 / A.5.28 (logging & evidence) — `mfa_*` audits including `critical` for an admin reset.
