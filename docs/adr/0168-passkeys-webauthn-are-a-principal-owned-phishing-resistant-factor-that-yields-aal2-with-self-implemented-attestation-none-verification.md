🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0168-passkeys-webauthn-are-a-principal-owned-phishing-resistant-factor-that-yields-aal2-with-self-implemented-attestation-none-verification.id.md)

# ADR-0168 — Passkeys (WebAuthn) are a principal-owned, phishing-resistant factor that yields `aal2`, with self-implemented `attestation: none` verification

- **Status:** Proposed
- **Review:** needs the owner's decision on the questions in §Open questions. Document only: no code, no migration, no OpenAPI is written before this ADR is Accepted and split into issues.
- **Date:** 2026-11-22
- **Decision maker:** @ahliweb (proposed, not decided)
- **Related:** Issue [#1405](https://github.com/ahliweb/awcms/issues/1405) (this ADR is its step 1); dependents [#1406](https://github.com/ahliweb/awcms/issues/1406) (native-client auth) and [#1407](https://github.com/ahliweb/awcms/issues/1407) (action-hash-bound step-up), both of which wait on this ADR. [ADR-0027](0027-mfa-totp-session-assurance-step-up.md) (TOTP, `assurance_level`, step-up), [ADR-0028](0028-oidc-sso-tenant-aware-account-linking-break-glass.md) (break-glass), [ADR-0085](0085-one-human-one-credential-many-tenants.md) (principals), [ADR-0087](0087-mfa-moves-to-the-principal.md) (MFA belongs to the principal), [ADR-0050](0050-bff-session-handoff-code.md) (BFF handoff), [ADR-0106](0106-domain-verification-proves-control-of-the-zone.md) (domain control), [`docs/awcms/mfa-totp-step-up.md`](../awcms/mfa-totp-step-up.md). Specification: W3C WebAuthn Level 3.

## Context

`identity-access` has exactly one second factor: TOTP, plus hash-only recovery codes. Both belong to the **principal** since ADR-0087 (`awcms_principal_mfa_factors`, `awcms_principal_mfa_recovery_codes`, `sql/114`). A session carries `assurance_level IN ('aal1','aal2')` (`sql/024`), and `requireStepUp` refreshes `stepped_up_at` after a TOTP or recovery-code check (`evaluateStepUp` in `src/modules/identity-access/domain/mfa-policy.ts` returns `not_stepped_up` unless the session is `aal2` and fresh).

ADR-0027 and `sql/024` (line 43) both state that WebAuthn is **out of scope**. Searching `src/`, `sql/` and `docs/` for "webauthn" and "passkey" finds only those two statements and one further 'out of scope' mention for SSO provider types in `docs/awcms/program-model-keanggotaan-2026-08-09.md`: nothing is built.

TOTP has a structural weakness that more rate-limiting cannot remove: a six-digit code typed into a look-alike page is valid on the real site for up to the TOTP window (`AUTH_MFA_TOTP_WINDOW_STEPS=1`, 30 s period). It is **phishable**. Downstream applications that handle sensitive data need a factor that (a) is bound to the site's origin by the authenticator, so a look-alike page gets nothing usable, and (b) is bound to a device. #1407 additionally needs an assertion that signs a hash of the action being approved; that is only possible with WebAuthn, which is why this ADR is its prerequisite.

Constraints already in force that shape the design:

- **Bun-only, two runtime dependencies** (`astro`, `@astrojs/node`); TOTP, session tokens, reset tokens and OAuth state are all built on `node:crypto` with no auth library. Adding a runtime dependency passes `deps:audit:check`, `deps:license:check` and `deps:provider-changelog:check`.
- **Multi-tenant host routing.** `awcms_tenant_domains` (`sql/046`) maps hostnames, including customer custom domains, to tenants. A WebAuthn credential is bound to one **RP ID** (a registrable-domain suffix of the page's host). Custom domains therefore cannot all share one credential.
- **`APP_URL` is required** and builds the OIDC callback URL (`.env.example`); the admin surface lives there.
- **The `awcms-astro` BFF** reaches awcms through a one-time handoff code ([ADR-0050](0050-bff-session-handoff-code.md)); the BFF's origin is not the admin origin.
- **FORCE RLS and global tables.** ADR-0085/0087 set the precedent for a GLOBAL principal-keyed table with four substitute controls (narrowed privileges, a per-call-site read-shape gate, a projection invariant, an authorization boundary that does not move) next to tenant-scoped ephemeral challenge rows.

## Options for the verification library

| Option                                                                     | What it is                                                                                             | Summary                                                                                                                                                                                                                                                          |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Own implementation on Bun WebCrypto and `node:crypto`** (recommended) | Parse `clientDataJSON`, `authenticatorData`, a CBOR subset and COSE keys; verify with `crypto.subtle`. | No dependency; matches how TOTP and tokens are done here. Scope is kept small by **supporting `attestation: none` only**, which removes X.509 chain, FIDO MDS and every attestation format. We own the correctness burden, so the spike gate below is mandatory. |
| B. `@simplewebauthn/server`                                                | A widely used server library for the same job.                                                         | Less code to own and it tracks spec changes. Adds a runtime dependency plus its transitive set (CBOR and ASN.1 parsers); its supply chain, license, and Bun compatibility must be verified at adoption. Not verified by this ADR.                                |
| C. Delegate to an external identity provider                               | Let the IdP perform WebAuthn and consume the result through OIDC (`docs/awcms/oidc-sso.md`).           | Zero WebAuthn code here. But the credential then lives outside the system of record, step-up bound to an action hash (#1407) is not reachable, and local accounts, break-glass and offline/LAN profiles would have no passkey.                                   |

Claims about option B (license, maintenance cadence, Bun compatibility, transitive dependencies) are **deliberately not asserted here**: this ADR was written without running it. If the spike (S1 below) falls back to B, that PR carries the evidence, the `deps:*` gates, and its own ADR amendment for the new runtime dependency (the issue requires a separate ADR with this same 11-criteria assessment before any dependency is added). Option B is the named fallback, not the preference.

## Decision (proposed)

### 1. Credential model: the principal owns the passkey

A passkey is a credential of the **human**, exactly as the TOTP factor became in ADR-0087. It is stored in a new GLOBAL table keyed by `principal_id`, not per tenant identity. The tenant keeps the **obligation** (policy), never the factor: "the factor belongs to the human; the obligation belongs to the tenant."

Consequence stated up front, because it is the same one ADR-0087 stated: an administrative reset of a passkey now reaches outside the acting tenant. It is handled the same way (own permission, step-up, mandatory reason, `crossTenantReach` in the audit row, trace kept on the global row), not as a side effect.

### 2. Relying party ID and origin

- **One RP ID for the whole authentication surface**, derived from `APP_URL`, never from the request `Host` header. Verification compares `clientDataJSON.origin` against an **exact allow-list** (the `APP_URL` origin; extra origins only through explicit configuration) and `authenticatorData.rpIdHash` against `SHA-256(rpId)`.
- **Tenant custom domains are not authentication origins.** Login, registration and step-up happen on the admin origin. A passkey registered there is not offered on `{custom-domain}`; public tenant sites do not authenticate staff. This must be confirmed against the actual routes in S1 (no login surface is currently assumed on custom domains, but the claim has to be checked, not trusted).
- Whether `rpId` is the exact `APP_URL` host or its parent registrable domain is an **owner question (Q2)**: the parent domain lets sibling subdomains share credentials but widens the blast radius of a subdomain takeover (ADR-0106 is about proving zone control, not about subdomain hygiene). **Recommendation: exact host.** Changing it later invalidates every enrolled passkey, so the value is stored per credential (`rp_id`) and a mismatch is a hard failure, not a fallback.
- `awcms-astro` and native clients (#1406) must run the ceremony **on the awcms origin** (browser) or through a platform association (Digital Asset Links, `webcredentials` for Apple). Native association is **out of scope here** and recorded as an input to #1406. For BFF sites, the ceremony happens on the admin origin and the session is delivered by the existing handoff code; the BFF never sees or relays the assertion.

### 3. User verification, attestation, resident keys

- **`userVerification: "required"`** for registration, login and step-up. The server rejects any assertion whose `UV` flag is clear (`UP` must also be set). This is what lets a single gesture count as two factors and therefore justify `aal2`; without UV a stolen unlocked key would equal a stolen password.
- **`attestation: "none"`.** We do not need to know which authenticator model a user has: synced passkeys (iCloud Keychain, Google Password Manager, password managers) deliberately return no usable attestation, and demanding `direct` would exclude them, reduce adoption, and import a certificate-trust (FIDO MDS) operations burden we cannot staff. The server stores the AAGUID for audit only. **Recommendation: `none`.** If a downstream customer later needs hardware-model policy, that is a separate ADR (it would reintroduce attestation-format verification, which is precisely the code §Options keeps out).
- **Resident (discoverable) key: `"preferred"`.** It enables conditional-UI autofill and, later, usernameless login, but a non-discoverable credential (many hardware keys at capacity) is still accepted for second-factor and step-up use. Usernameless login is Q3.
- **Algorithms:** advertise ES256 (-7) and EdDSA (-8) and RS256 (-257) only; refuse others at registration. Backup flags: store `backup_eligible` and `backup_state`; whether a **synced** passkey may satisfy the higher level of #1407 (passkey plus TOTP) is Q4.

### 4. Relationship to `assurance_level`, step-up and TOTP

- A successful assertion with `UV` set produces a session at `assurance_level = 'aal2'`. Rising from `aal1` rotates the session token, reusing the existing anti-fixation rule in `mfa-session-assurance.ts`; nothing about `aal2` changes shape.
- **Three uses, one assurance model:** (a) _second factor_ after password (or SSO) in place of TOTP, (b) _login_ with a passkey alone (Q3), and (c) _step-up_ for the existing `requireStepUp` gate, refreshing `stepped_up_at`. TOTP keeps working unchanged: `requireStepUp`, `POST /auth/mfa/step-up` and tenant MFA policy are **not modified** by this ADR (regression test in the implementation slice).
- `awcms_sessions.origin_auth` has a CHECK of five values (`sql/117`: `password, sso, handoff, switch, delegated`). A passkey login needs either a sixth value `passkey` (a CHECK change, same shape as `sql/117` did for `delegated`) or reuse of `password`. **Recommendation: add `passkey`**, because #1004's "what counts as re-authentication" reads `originAuth`, and a silent reuse would make it lie.
- The action-hash-bound variant is #1407; this ADR only guarantees the primitive it needs (a challenge the server fully controls, and UV enforced).

### 5. The ceremonies

Common rules, enforced in the verification code and by tests:

1. **Challenge:** 32 random bytes from the CSPRNG, **single use**, stored server-side as a SHA-256 digest with `purpose`, `principal_id` or `session_id` (nullable for usernameless), `expires_at` and `consumed_at`. Consumption is one atomic `UPDATE ... WHERE consumed_at IS NULL AND expires_at > now() RETURNING`; two concurrent verifications of the same challenge cannot both win. Default TTL **120 s** (configurable, with a floor and ceiling), not the 300 s of `AUTH_MFA_CHALLENGE_TTL_SEC`, because there is no human typing a code.
2. **Time:** server clock only; the database is the clock for TTL, per the repo-wide rule about app-versus-DB clocks. The client never sends or extends a time.
3. **Checks, in this order, all fail-closed with one uniform error to the client:** `clientDataJSON.type` (`webauthn.create` or `webauthn.get`), challenge match (constant-time, against the stored digest), `origin` in the allow-list, `crossOrigin` absent or false, `rpIdHash`, `UP`, `UV`, credential belongs to the expected principal (for authentication with a known user) or resolves to a principal (discoverable), credential not revoked, signature over `authenticatorData || SHA-256(clientDataJSON)` with the stored COSE key, sign counter.
4. **Sign counter.** Many synced passkeys always report 0. Rule: if both stored and presented counters are 0, accept; otherwise the presented counter **must be greater** than the stored one. A counter that does not advance is treated as a possible clone: the assertion is rejected, the credential gets `clone_suspected_at`, the principal is notified, and a `critical` audit row is written. A suspected credential cannot satisfy `aal2` until the user re-registers it (or an admin clears it with step-up and a reason).
5. **Registration** additionally: reject a `credentialId` already present anywhere (global uniqueness, so one authenticator cannot be attached to two principals), set `excludeCredentials` to the principal's existing credentials, require `attestationObject.fmt = "none"`, and require an authenticated session that was **recently stepped up** for adding a credential (adding a factor is a privilege act).
6. **Rate limits** per principal and per IP use the existing limiter pattern (`AUTH_MFA_RATE_LIMIT_*`); new `AUTH_PASSKEY_*` variables must be covered by `config:env:coverage:check`.

### 6. Storage (descriptive, not a migration)

| Table                      | Scope                                   | Columns (intent)                                                                                                                                                                                                                                                                                                                                         |
| -------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `awcms_principal_passkeys` | GLOBAL, no RLS, keyed by `principal_id` | `id`, `principal_id` FK, `credential_id` bytea **globally unique**, `public_key` bytea (COSE), `cose_alg`, `sign_count` bigint, `transports` text[], `aaguid`, `backup_eligible`, `backup_state`, `rp_id`, `label`, `created_at`, `last_used_at`, `revoked_at`, `revoked_reason`, `clone_suspected_at`, `disabled_by_tenant_id` (no FK, as in `sql/114`) |
| `awcms_passkey_challenges` | Tenant-scoped, **FORCE RLS**            | `id`, `tenant_id`, `principal_id` nullable, `session_id` nullable, `purpose` (`register`, `authenticate`, `step_up`), `challenge_digest`, `created_at`, `expires_at`, `consumed_at`                                                                                                                                                                      |

Why split this way: the credential survives across tenants like the person (ADR-0087), while a challenge is one attempt in one tenant and must not be exchangeable for a session in another (the same argument ADR-0087 made for `awcms_mfa_challenges`). The four substitute controls are applied unchanged: narrowed GRANTs, a call-site read-shape gate (`identity:principal-access:check` extended), a projection invariant so `public_key` never leaves the store module, and no authorization from merely holding a credential. The public key is **not a secret**, but it is not logged and is not returned by any API; there is **no private key anywhere in the system**, so "no secret stored" holds structurally. Retention of consumed or expired challenges joins the data-lifecycle registry (`data-lifecycle:registry:check`, `data-lifecycle:table-coverage:check`); the new tables join `subject-data:coverage:check`. The migration number is assigned when the slice is written.

### 7. Device binding, limits, revocation, audit

- A principal lists, **renames** and **revokes** their passkeys; the list shows label, transports, backup flag, created and last used, never key material.
- **Limit:** at most 10 active credentials per principal (configurable); the floor of useful security is **two**, so the UI nudges a second registration (Q5 asks whether policy may _require_ two).
- Revocation is a soft state (`revoked_at`, `revoked_reason`): the row stays for audit and so a revoked `credential_id` can never be re-attached. Revoking a credential also revokes sessions it created if the principal chooses "sign out everywhere"; it never silently signs out others.
- Removing the **last** passkey of a principal whose tenant policy requires one is refused unless a recovery path is armed (§8).
- **Audit** (all with redaction; credential IDs appear only as a short digest): `passkey_registered`, `passkey_authenticated`, `passkey_stepped_up`, `passkey_renamed`, `passkey_revoked`, `passkey_rejected` (with a **coarse** reason code, never the failing byte), `passkey_clone_suspected` (critical), `passkey_admin_reset` (critical, with `crossTenantReach`), `passkey_recovery_used`. Registration, revoke and reset are high-risk and carry `Idempotency-Key`.

### 8. Recovery must not degrade to password-only or TOTP-only

- **Primary protection is redundancy:** multiple credentials (§7) including a synced passkey.
- **Recovery codes:** the existing hash-only recovery codes (principal-owned) remain, but a recovery code is **phishable** and therefore **cannot satisfy** a gate that requires a passkey (policy `passkey_required`, or #1407 level 2). Its only power is to open a **recovery session** that can do one thing: enrol a new passkey, after the cool-down below.
- **Enrolment after recovery has a delay.** Using a recovery code, or an admin reset, starts a configurable cool-down (proposal: 24 h) before the newly enrolled passkey can satisfy passkey-required gates, with an out-of-band notice (e-mail through the existing e-mail module) to the principal at start. This is what stops "phish the recovery code, enrol an attacker key, act immediately".
- **Admin reset** `identity_access.passkey_admin.reset`: default-deny, `requireStepUp`, mandatory `reason`, maker/checker (Q6: required or optional), `critical` audit with `crossTenantReach`, same cool-down. It is **not** seeded into tenant roles by default and must be seeded by migration if enforced (the repo has been bitten twice by permissions that were never seeded).
- **Break-glass (ADR-0028).** A break-glass identity keeps the local password plus TOTP or recovery-code path even if the tenant policy is `passkey_required`; this is the same exemption ADR-0028 §9 grants against SSO outage, and it stays audited. A tenant therefore cannot lock itself out of recovery by turning the policy on, and policy save time enforces "at least one active break-glass identity" the way `saveTenantAuthPolicy` already does for SSO.
- The tenant obligation is a new policy column or table following `awcms_tenant_mfa_policies`; making passkeys **mandatory** is a tenant product decision and defaults to off.

## Evaluation against the 11 criteria

Evaluated for the whole decision: **adopt passkeys, principal-owned, self-implemented `attestation: none` verification** (option A), against doing nothing (TOTP only).

| #   | Criterion                    | Assessment                                                                                                                                                                                                                                                                                                                                                     |
| --- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Advantages and disadvantages | **+** Phishing-resistant, device-bound, one gesture for two factors, enables #1407 and #1406. **−** Recovery design is hard, synced passkeys move trust to the platform vendor, we own correctness of the verifier.                                                                                                                                            |
| 2   | Security                     | Origin-bound by the authenticator; no shared secret on our side; no private key exists to leak. Risks: verifier bugs (mitigated by spike gate, official vectors, negative tests), RP-ID choice (Q2), recovery as the weakest path (§8 cool-down, recovery code cannot satisfy passkey-required).                                                               |
| 3   | Performance                  | Verification is one ECDSA/EdDSA verify and two indexed lookups; challenge consume is one indexed UPDATE. Negligible against password hashing, which is deliberately slow. Ceremony latency is dominated by the user's gesture.                                                                                                                                 |
| 4   | Maintenance                  | Own code is ~a few hundred lines plus vectors, in `identity-access/domain`, pure and unit-testable. The WebAuthn spec evolves slowly; the cost is re-reading Level 3 changes. A library (option B) would reduce this and add a dependency to watch.                                                                                                            |
| 5   | Scalability                  | Rows are per human, not per request; challenge rows are short-lived and covered by retention. No cross-tenant fan-out. Cost grows with users, not traffic.                                                                                                                                                                                                     |
| 6   | Accessibility                | Passkeys remove the transcription and cognitive-test steps that WCAG 2.2 SC 3.3.8 (Accessible Authentication, Minimum) is concerned with, and rely on platform authenticators that screen readers already drive. Requirements: no short hard time pressure on the page, conditional-UI autofill, a clear non-passkey alternative path, status via `aria-live`. |
| 7   | SEO                          | Not applicable: authentication screens are `noindex` admin surfaces; no public page changes.                                                                                                                                                                                                                                                                   |
| 8   | UI/UX                        | Familiar OS prompt, fewer typed codes. Needs new screens under `/admin/account` (list, add, rename, revoke, recovery) and login choices; failure messages must be uniform, and the UI must explain "lost device" before it happens.                                                                                                                            |
| 9   | Compatibility                | WebAuthn is supported by current mainstream browsers and platforms; older or locked-down environments, some kiosk/LAN profiles, and non-secure origins (needs HTTPS or `localhost`) fall back to TOTP, so TOTP is **not removed**. Bun WebCrypto covers P-256, Ed25519 and RSA verification (to be confirmed by the spike).                                    |
| 10  | Operational complexity       | New: env variables, an RP-ID that is effectively immutable once users enrol, a recovery SOP, `security:readiness` checks, admin runbook. Offline/LAN profile: works only where the admin origin is a secure context.                                                                                                                                           |
| 11  | Long-term implications       | Enrolled credentials make the RP ID a long-lived commitment; hence Q2. Positions the repo for native passkeys (#1406 association) and signed-action approvals (#1407). Related Origin Requests (Level 3) could later widen RP scope without re-enrolling, but is not relied on now.                                                                            |

Doing nothing keeps TOTP phishable and blocks #1406/#1407; option B trades criterion 4 (less code) for criteria 2 and 10 (a new supply chain to audit); option C fails criteria 1 and 11 for the reasons in the options table.

## Open questions for the owner

1. **Q1 — Library.** Approve option A (own, `attestation: none` only) with the spike gate, option B as named fallback, or require B now?
2. **Q2 — RP ID.** Exact `APP_URL` host (recommended) or its registrable parent domain? This is effectively irreversible after enrolment.
3. **Q3 — Passkey-only login.** Is a discoverable-credential, usernameless login (no password first) in scope for the first release, or second factor and step-up only?
4. **Q4 — Synced passkeys.** May a backup-eligible (synced) passkey satisfy level 3 of #1407, or only hardware-bound credentials?
5. **Q5 — Two credentials.** Nudge only, or may a tenant policy require at least two?
6. **Q6 — Admin reset.** Maker/checker mandatory or optional? And is the cool-down 24 h, or tenant-configurable?
7. **Q7 — `origin_auth`.** Add `passkey` to the `sql/117` CHECK (recommended) or reuse `password`?
8. **Q8 — Obligation default.** Confirm the tenant "passkey required" policy defaults to off and that break-glass identities are exempt.
9. **Q9 — Native association.** Confirm Digital Asset Links / `webcredentials` association is handled inside #1406 rather than here.

## Consequences

- **Positive:** a phishing-resistant, device-bound factor; the prerequisite for #1407 is unblocked; TOTP and recovery codes keep working, with no migration of existing factors.
- **Negative:** a verifier we must prove correct; an effectively permanent RP-ID choice; recovery is a new attack surface that needs its own SOP and readiness checks; one more global principal-keyed table whose controls must be kept in step with ADR-0087's.
- **Neutral:** `awcms_sessions.origin_auth` CHECK widens by one value (Q7); `AccessAction` gains `passkey_admin.reset` style permissions; `security:readiness`, `config:env:coverage:check`, `data-lifecycle:*` and `subject-data:*` gates each gain entries.
- **Blast radius of the ADR itself:** none. No code, migration, OpenAPI or dependency changes with this ADR.

## Implementation outline (after acceptance; written here, not opened as issues)

Each slice is S or M and independently reviewable. The ADR must be Accepted first, and the Definition-of-Ready gate passed.

| Slice | Size | Content                                                                                                                                                                                                                                                                                                  |
| ----- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1    | M    | **Verifier spike and pure domain module**: CBOR subset, COSE parse, authData parse, signature verify, counter rule, run against official WebAuthn test vectors and a cross-check against a real authenticator and one reference implementation **outside the repo**. Gate: go/no-go for option A. No DB. |
| S2    | S    | `sql/NNN` for `awcms_principal_passkeys` and `awcms_passkey_challenges`, grants, FORCE RLS on challenges, `origin_auth` CHECK (Q7), lifecycle and subject-data registrations, RLS/probe tests.                                                                                                           |
| S3    | M    | Registration and management endpoints (options, verify, list, rename, revoke), audit, idempotency, permissions seeded, OpenAPI, negative tests (replay, wrong origin, wrong rpId, UV absent, other principal's credential, cross-tenant).                                                                |
| S4    | M    | Authentication ceremony: second factor, step-up, and (if Q3) discoverable login; session `aal2` with rotation; regression tests proving `requireStepUp` and TOTP are unchanged.                                                                                                                          |
| S5    | M    | Recovery: recovery-session rule, cool-down and notice, admin reset with step-up and reason (maker/checker per Q6), tenant policy with break-glass guard, last-credential protection, SOP in `docs/awcms/`.                                                                                               |
| S6    | S/M  | Admin screens under `/admin/account` and the login choice, i18n catalogs, a11y (conditional UI, `aria-live`, no short timers), navigation entry in the same change as the screen.                                                                                                                        |
| S7    | S    | `docs/awcms/passkey-webauthn.md` (EN and ID), `security:readiness` checks, env coverage, runbook, changeset.                                                                                                                                                                                             |

#1407 starts after S4 lands. #1406 reads §2 for the native association input and does not block on S5 to S7.

## References

[#1405](https://github.com/ahliweb/awcms/issues/1405), [#1406](https://github.com/ahliweb/awcms/issues/1406), [#1407](https://github.com/ahliweb/awcms/issues/1407); [ADR-0027](0027-mfa-totp-session-assurance-step-up.md); [ADR-0028](0028-oidc-sso-tenant-aware-account-linking-break-glass.md); [ADR-0050](0050-bff-session-handoff-code.md); [ADR-0085](0085-one-human-one-credential-many-tenants.md); [ADR-0087](0087-mfa-moves-to-the-principal.md); [ADR-0106](0106-domain-verification-proves-control-of-the-zone.md); `sql/024_awcms_mfa_totp_schema.sql`, `sql/046_awcms_tenant_domain_schema.sql`, `sql/114_awcms_principal_mfa.sql`, `sql/117_awcms_delegated_access.sql` (origin_auth CHECK); `src/modules/identity-access/domain/mfa-policy.ts`; `src/modules/identity-access/application/mfa-session-assurance.ts`; `docs/awcms/mfa-totp-step-up.md`; W3C Web Authentication Level 3.
