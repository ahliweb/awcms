---
"awcms": minor
---

MFA TOTP, recovery codes, and step-up authentication (Issue #184, epic #177).
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
