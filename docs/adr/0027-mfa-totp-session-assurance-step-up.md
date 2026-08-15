🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0027-mfa-totp-session-assurance-step-up.id.md)

# ADR-0027 — MFA TOTP, session assurance, and step-up authentication

- **Status:** Accepted
- **Date:** 2026-07-19
- **Decision maker:** maintainer
- **Related:** Issue #184, epic #177 (derived ERP foundation readiness); ADR-0026 (modular OpenAPI); doc `docs/awcms/mfa-totp-step-up.md`; port from awcms-mini Issue #589.

## Context

AWCMS already has opaque sessions, password login + lockout + rate limit + login audit (Issue #145/#147), and default-deny authorization. But highly privileged accounts still rely on a single factor, and a session cannot yet **state** an assurance level that can be required for high-risk actions (role/policy/tenant configuration changes, administrative overrides). Derived ERPs need MFA and step-up.

The MFA/TOTP/recovery/challenge slice is already mature in awcms-mini (Issue #589). But mini does **not** model session assurance, step-up, admin reset, or a policy enum, and mini gates MFA behind the "full-online security" gate (#587) which is not ported into this base. On top of that, this base's login path is **harder** than mini's (anti-timing dummy hash, collapsed deny reasons, `TRUSTED_PROXY_ENABLED`, `parsePositiveIntEnv`) — a naive port could regress it.

## Decision

We decide to **port the MFA/TOTP/recovery/challenge slice from mini and build on top of it** session assurance + step-up + policy + admin reset, with the following adaptations:

1. **The feature switch is `AUTH_MFA_ENABLED` only** (no full-online gate). This flag gates **only** enrollment; login/disable/step-up challenges are driven by DB state (an `active` factor row) so they are fail-closed — turning the flag off must never let an enrolled identity bypass the second factor.
2. **The TOTP secret is encrypted with AES-256-GCM using `AUTH_MFA_SECRET_ENCRYPTION_KEY`, with no default key.** A missing/invalid key → `null` → every path fails closed with `MFA_MISCONFIGURED`. Recovery codes are one-way hashed (sha256), single-use, consumed via a compare-and-swap UPDATE.
3. **Concurrency-safe anti-replay** via `last_used_step` advanced with a CAS (`WHERE last_used_step < ${matchedStep}`); two concurrent requests on the same timestep → only one wins. The drift window is bounded (`AUTH_MFA_TOTP_WINDOW_STEPS`, max 10).
4. **Two-stage login challenge with no enumeration oracle**: the MFA branch is only reached after the password is valid; every challenge deny path collapses to a single code. A session produced by a challenge is born at `aal2` (rotation is inherent — there is no prior aal1 session).
5. **Session assurance `aal1`/`aal2`** as a column on `awcms_sessions` (the opaque-session model is unchanged). `requireStepUp` is the reusable gate for high-risk actions, called after `authorizeInTransaction`. The step-up TTL is short & server-controlled (`AUTH_MFA_STEPUP_TTL_SEC`). Rising aal1→aal2 rotates the session (anti-fixation).
6. **Tenant policy** enum `optional` (default) / `required_for_privileged` / `required_for_all`.
7. **Admin reset** with a dedicated permission (`identity_access.mfa_admin.reset`), a mandatory reason, a `critical` audit, and a ban on self-reset.
8. **The base's harder login path is kept intact** — MFA only inserts a branch between the deny block and session creation; `resolveLoginPolicyConfig`/`resolveLoginDenyResponse`/`verifyPasswordOrDummy` are untouched, none of mini's `Number(process.env...)` comes in, and mini's SSO/Turnstile are **not** ported along.
9. **Real policy enforcement via an enrollment grant** — after a valid password, an identity that is `required` but has no factor does NOT receive a full session; it is given an _enrollment grant_ (a challenge row with `purpose='enrollment'`, reusing `awcms_mfa_challenges`) that authorizes only the enroll endpoint, then rises to an `aal2` session once enrollment completes. Fail-closed but self-recoverable (no admin lockout). Gated by `isMfaFeatureEnabled()` — if enrollment is off, the policy is inert (it is impossible to create the MFA that is being required).
10. **Step-up is wired into every high-risk action owned by this module** — `requireStepUp` guards self-service disable, recovery code regeneration, admin reset, and policy changes.
11. **Per-factor cumulative failed-verify lockout** (`AUTH_MFA_MAX_VERIFY_ATTEMPTS`/`AUTH_MFA_LOCKOUT_MINUTES`) — independent of source IP and of challenge rotation; reset on a successful verify. The counter is incremented **atomically in the DB** (`SET failed_verify_count = CASE …`) under a `SELECT … FOR UPDATE` row lock on the factor row, the same as the replay/recovery compare-and-swap — not a read-modify-write from a JS snapshot, so concurrent verifies across challenges/IPs cannot lost-update their way past the threshold (audit HIGH-1).
12. **The recovery code unique index is scoped `(tenant_id, code_hash)`** — preventing a 40-bit cross-tenant collision from turning into 23505→500.

## Consequences

- **Positive:** a second factor for privileged accounts; tenant policy genuinely enforced; sessions can state their assurance and be required to by high-risk actions; a DB backup is not enough to obtain the secret; replay (including concurrent) is rejected; per-factor brute force is bounded by an IP-independent lockout; no new enumeration oracle; the already-hard login path stays hard.
- **Negative / trade-off:** a successful `login.ts` now performs one extra factor SELECT (indexed, only on a valid password login), plus — when a `required_for_*` policy is active and the user has no factor — one policy read (+ a permission read for `required_for_privileged`). That is the price of fail-closed. **`required_for_privileged` classifies "privileged" broadly**: holding any non-read permission. This is deliberate (fail-closed: forcing MFA on more people, not fewer) and documented. Wiring `requireStepUp` into the high-risk actions owned by a **derived ERP application** (posting, override, SoD exception) remains the derived application's job (#179/#181) — the base provides a ready-to-use `requireStepUp` gate and has already installed it on every high-risk action owned by the MFA module itself.
- **Neutral:** `AccessAction` gains `reset`. One new public operation (`postAuthMfaVerify`) enters the `api:spec:check` allow-list. Enroll accepts the `X-AWCMS-MFA-Enrollment-Token` header in addition to a session. WebAuthn/passkeys and SMS/WA/email OTP remain out of scope.
- **Operational caveat (fail-open on misconfiguration, audit INFO-1):** `required_*` policy enforcement for users **without** a factor is gated by `AUTH_MFA_ENABLED` (point 9) — if an operator sets a tenant policy to `required_*` **while** the flag is off, users with no factor receive an `aal1` session (users who HAVE enrolled are still challenged, because the challenge path is driven by DB state, not the flag). This is deliberate so that policy-on + feature-off does not lock enrollment out, but operators MUST NOT enable a `required_*` policy while `AUTH_MFA_ENABLED != true`. The runbook `docs/awcms/mfa-totp-step-up.md` records this.

## Alternatives considered

- **Storing assurance in a separate store / changing the session model** — rejected: a column on `awcms_sessions` keeps the opaque-session model exactly as it is (the issue's criterion: "without changing the opaque-session model").
- **Refusing login entirely for a `required` user with no factor** — rejected: it locks the user out of the ability to enroll (lockout), and if the response depended on factor status before the password is proven, it opens an oracle. Chosen instead: a post-password _enrollment grant_ that authorizes only enroll, so policy is enforced (no full session) while the user can always recover themselves.
- **A blind `SET last_used_step`** — rejected: not safe against two concurrent requests; CAS is mandatory.
- **Only a per-challenge cap + per-IP rate limit** — rejected: an attacker holding the password can mint a new challenge and rotate IPs; a cumulative per-factor lockout is needed.
- **Porting mini's full-online gate** — rejected: that epic does not exist in this base; `AUTH_MFA_ENABLED` + DB state is already sufficient and simpler.
