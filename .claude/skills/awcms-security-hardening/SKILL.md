---
name: awcms-security-hardening
description: Standards-based security audit (OWASP Top 10, OWASP ASVS, ISO/IEC 27001 Annex A) for AWCMS. Use when asked for "security hardening", an OWASP/ASVS/ISO audit, a compliance assessment, or hardening ahead of go-live/an external audit. Different from awcms-security-review (the per-module DoD checklist) — this skill maps controls onto industry standard frameworks.
---

🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](SKILL.id.md)

> **READ THIS FIRST — the control ↔ standard map lives in
> [`docs/awcms/standar-performa-dan-keamanan.md`](../../../docs/awcms/standar-performa-dan-keamanan.md).**
> That document is **living** (updated when a control changes) and contains: the pinned
> edition of each standard, the OWASP Top 10 2021 / API Security Top 10 2023 /
> ASVS 4.0.3 / ISO 27001:2022 Annex A / NIST SSDF matrices **with per-row file
> evidence**, the response header table side by side with `awcms-astro`, the list of gaps
> with their checkers (C1–C15, some already CLOSED — that document is the status map
> that applies), and the list of controls that were **deliberately rejected**. This page
> is how the work is done; that document is the state.
>
> **The baseline posture is STRONG, verified against the code** (run, not quoted):
> `access:chokepoint:check` **331 handlers / 6 deciding a permission / 0 bypasses**;
> `access:permissions:enforcement:check` **203/203 / 0 exceptions**;
> 143 RLS `FORCE` statements tested as `awcms_app` LOGIN; `bun audit` clean;
> argon2id; the lockout increment happens in the DB (a single statement); MFA/OIDC/Turnstile/SoD; machine credentials
> read-only.
>
> **What is ALREADY CLOSED** (do not report it again as a finding):
>
> - ~~A01/API5 — routes bypassing the authorization chokepoint.~~ **CLOSED
>   ([ADR-0063](../../../docs/adr/0063-ownership-grants-run-through-the-authorization-chokepoint.md)):**
>   THREE handlers (not one — the FILE-level reading in the first round
>   merged `GET`/`PATCH` in one file and concluded a compliance that did
>   not exist). `authorizeInTransaction` now accepts an `ownershipGrant` that
>   **WIDENS** the permission set instead of short-circuiting the decision, so ABAC/
>   platform-scope/business-scope/SoD can still deny. Its gate is sliced
>   **per HANDLER**.
> - ~~API4/ASVS V11.2 — an in-process `Map` rate limiter.~~ **CLOSED
>   ([ADR-0066](../../../docs/adr/0066-shared-rate-limiting-and-full-auth-surface-coverage.md)):**
>   `checkSharedRateLimit` shares through Redis (the window number is in the KEY, so
>   there is no read-modify-write). It **FAILS OPEN** when Redis is down — deliberately,
>   because failing closed turns a Redis outage into a total login denial that
>   an attacker can trigger; the **per-principal** lockout in PostgreSQL
>   ([ADR-0086](../../../docs/adr/0086-the-lockout-counter-is-global.md)) is the
>   binding control and is unaffected.
> - ~~Supply chain — 1 moderate `postcss`.~~ **CLOSED** (`overrides` `^8.5.23`).
> - ~~The `awcms-astro` contract was not guarded by tests.~~ **CLOSED**
>   ([ADR-0065](../../../docs/adr/0065-awcms-astro-consumer-contract-is-frozen.md)) —
>   with the coverage caveat in finding 3 below.
>
> **SECOND-ROUND assessment FINDINGS (§9) — status as of 5 August 2026 (all four
> CLOSED; the lessons are kept):**
>
> 1. ~~ASVS V3.4.1 / A05 — `AUTH_COOKIE_SECURE` failed open when unset.~~
>    **CLOSED 4 August 2026.** The production rule in `scripts/validate-env.ts` is now
>    `!== "true"`, aligned with the runtime comparisons (`auth/login.ts`,
>    `mfa-session-assurance.ts`, `analytics/collect.ts`). Non-production is deliberately
>    not required to set it — dev runs on `http://`. **The lesson that still
>    applies when auditing anything shaped like this:** the defect was only
>    visible in the **ABSENT** state; wrong spellings (`1`/`TRUE`/`yes`) were already
>    rejected by the `bool` type rule, so testing the value `"false"` — or any wrong
>    value at all — stays green on top of the real defect. The first draft of this finding
>    claimed all four states passed; **running the validator** refuted that and
>    narrowed it to one. Run it, do not read it.
> 2. ~~OWASP Secure Headers — `Cross-Origin-Opener-Policy` and
>    `Cross-Origin-Resource-Policy` were not sent.~~ **CLOSED 4 August 2026**
>    (commit 769292d7): both are now sent as `same-origin` **unconditionally** —
>    with no production gate — from `src/lib/security/security-headers.ts`.
>    Its test assertions target the header **VALUE**, not merely its presence,
>    so a silent loosening (e.g. `same-origin-allow-popups`) still goes red.
> 3. ~~Interop — the consumer contract freezes six surfaces; `awcms-astro`
>    calls three.~~ **CLOSED
>    ([ADR-0068](../../../docs/adr/0068-family-standards-posture-editions-and-recorded-divergences.md)):**
>    the `CONSUMED` vs `COMMITTED` split has landed in
>    `scripts/api-consumer-contract.ts` — `CONSUMED_PATHS` (3 paths) is pinned to a
>    marked block in the `awcms-astro` repo, `COMMITTED_PATHS` (2 paths) requires an ADR;
>    its gate is `bun run api:consumer-contract:check`.
> 4. ~~The OWASP edition pins (Top 10 2021, ASVS 4.0.3) were never a written
>    decision.~~ **CLOSED:** it is now a written decision with a `reviewDate` in
>    [ADR-0068](../../../docs/adr/0068-family-standards-posture-editions-and-recorded-divergences.md) §A.
>    Raising an edition = a **family-level ADR revision**, not a table edit;
>    `awcms-astro` follows this repo and does not run ahead of it.

# AWCMS — Security Hardening (OWASP / ASVS / ISO)

Source of truth: **`docs/awcms/20_threat_model_security_architecture.md`** (STRIDE, layered controls, trust boundaries, **§OWASP/ASVS/ISO 27001 compliance matrix** — the real matrix with per-row evidence was written in Issue #437, use it as the template/precedent when re-auditing or adding a new control), **`docs/awcms/10_template_kode_coding_standard.md`** (guardrails), and **`docs/awcms/13_final_master_index_traceability.md`** (control matrix). This skill **maps** the project's controls onto standard frameworks; use it together with `awcms-security-review` (the per-module checklist) and the `awcms-security-auditor` subagent.

## OWASP Top 10 (2021) → controls in the base

| #   | Category                       | Main checks in AWCMS                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A01 | Broken Access Control          | ABAC default-deny + deny-overrides (ADR-0004); RLS `ENABLE`+`FORCE` (ADR-0003); non-superuser DB role; explicit `WHERE id=<tenant>` on RLS-free tables (`awcms_tenants`); IDOR — check that every resource is filtered by tenant/ownership                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| A02 | Cryptographic Failures         | argon2id passwords (`Bun.password`); opaque session tokens (only the hash is stored); sensitive identifiers `value_hash`+`masked_value`; HTTPS in production; `HttpOnly` + `SameSite=Lax` cookies **unconditionally**; `Secure` enforced by the validator in production (**fail-closed** — `scripts/validate-env.ts` rejects `AUTH_COOKIE_SECURE !== "true"`, including when it is unset); still verify the response (`Set-Cookie … Secure`), not just the configuration                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| A03 | Injection                      | Queries only through parametric `Bun.SQL` tagged templates (no SQL string concatenation); `tx.unsafe`/`SET LOCAL` only for validated values (`assertUuid`); input validation on every endpoint; output encoding (Astro auto-escape)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| A04 | Insecure Design                | Threat model doc 20; posted immutability; idempotency; self-approval rejected; fail-closed defaults (zero-UUID tenant GUC)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| A05 | Security Misconfiguration      | Secrets only from env; `.env` gitignored; CI rejects `.env`; `security:readiness` blocks go-live (RLS FORCE, role not superuser); errors without stack traces; the **only** owner of the security headers is `src/lib/security/security-headers.ts` installed by `src/middleware.ts` onto EVERY response — CSP, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy`, prod-gated HSTS. **`astro.config.mjs` DELIBERATELY DOES NOT carry a `security.csp` block** (Issue #148, upheld in #166): enabling it creates TWO CSP sources that overwrite each other at page render, and pages break with no visible cause. An older version of this page wrote the opposite — do not follow it                                                                                                                                                                                                                                                                                                 |
| A06 | Vulnerable Components          | Bun-only (ADR-0002); Dependabot; locked lockfile; minimal dependencies                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| A07 | Identification & Auth Failures | Login lockout **per-principal — one counter per human, across every tenant** ([ADR-0086](../../../docs/adr/0086-the-lockout-counter-is-global.md), `sql/113`, closing #430; the counter lives in `awcms_principals`, and `awcms_identities.failed_login_count`/`locked_until` are now HISTORY — reading them to decide a login brings defect #430 back), **incremented in the DB in a single statement** — `failed_login_count = failed_login_count + 1` with `CASE WHEN … >= max` (`src/modules/identity-access/application/principal-store.ts`), not a JS read-modify-write; until #483 this line promised a property the password path did not actually satisfy, so inspect the mechanism, not the sentence; generic anti-enumeration messages; session TTL; revoke on logout; deactivation revokes sessions immediately; MFA TOTP + aal1→aal2 rotation against fixation; rate limiting **shared through Redis** `checkSharedRateLimit` (`src/lib/security/rate-limit.ts`, ADR-0066) across 18 route files — reuse it for other public/expensive endpoints via `awcms-integration` |
| A08 | Software & Data Integrity      | Checksums for sync files/objects/backups; append-only audit; CodeQL; migration checksums                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| A09 | Logging & Monitoring Failures  | High-risk audit + decision log + correlation ID (automatic in `meta.correlationId` for all `/api/*` endpoints since Issue #447, see `awcms-observability`); structured logs; **redaction** of secrets/PII mandatory before logging; audit event retention/purge (730 days by default) + an extension point for export to an external SIEM (Issue #447)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| A10 | SSRF                           | Provider URLs come from trusted env, not from user input; providers are called outside the transaction (ADR-0006)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

## OWASP ASVS (relevant L1/L2)

- [ ] **V2 Auth** — modern hashing, lockout, session fixation prevented (a new token at login), logout revokes the session.
- [ ] **V3 Session** — opaque server-side tokens; expiry; rotation when assurance is raised; logout & deactivation revoke. `HttpOnly`+`SameSite=Lax` cookies unconditionally; `Secure` **fails closed in production** since 4 August 2026 (the validator rejects `AUTH_COOKIE_SECURE !== "true"`; the absent-state test is in `tests/validate-env.test.ts`). The lesson that still applies: test with the variable **REMOVED**, not set to `"false"`.
- [ ] **V4 Access Control** — default deny, checked per request (not once), RLS defense-in-depth, no IDOR.
- [ ] **V5 Validation/Encoding** — validate every input, output encoding, CSRF via Astro `checkOrigin` (`Content-Type` mandatory on mutations).
- [ ] **V7 Error/Logging** — safe errors with no internal detail; logs without sensitive data.
- [ ] **V9 Communications** — TLS in production (HSTS `Strict-Transport-Security` prod-gated, Issue #437); HMAC for machine-to-machine channels (sync).
- [ ] **V12 Files** — checksums verified; paths/objects never taken from untrusted input.
- [ ] **V14 HTTP Security Configuration** — CSP, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy` `same-origin`, `Cross-Origin-Resource-Policy` `same-origin` (both since commit 769292d7), plus prod-gated HSTS — **eight headers (seven unconditional + production HSTS), one owner**: `src/lib/security/security-headers.ts` installed by `src/middleware.ts`. `astro.config.mjs` does **not** carry `security.csp`, and must not (two CSP sources overwriting each other). **A real CSP gotcha**: the per-request nonce is silently stripped by the Astro compiler from `is:inline` attributes; a manual SHA-256 hash for one known script can miss other scripts/styles that Astro inlines per component without being asked — **CSP verification must use a real browser** (headless-Chrome/CDP), curl cannot detect a CSP violation because it does not execute JS/CSS.

## OWASP API Security Top 10 (2023)

This repo **serves** 255 `/api/v1` route files, so this category applies in
full — and it has no counterpart in `awcms-astro`, which serves no API.
The complete API1–API10 matrix with per-row evidence is in
[`docs/awcms/standar-performa-dan-keamanan.md`](../../../docs/awcms/standar-performa-dan-keamanan.md) §4.
What is most often misjudged during a re-audit:

- **API5** — do not judge per FILE. One route file can call the
  chokepoint in `GET` and not in `PATCH`; that is exactly how the ADR-0063 finding
  was missed once. Run `bun run access:chokepoint:check`.
- **API9** — inventory does not mean "the OpenAPI exists", it means "every operation has a
  declared tag AND every declared tag is used". Run
  `bun run api:spec:check`.

## ISO/IEC 27001:2022 Annex A (the controls relevant to code)

A.5.15 access control · A.5.17 authentication info · A.8.2 privileged access (least-privilege DB role) · A.8.5 secure authentication · A.8.12 data leakage prevention (masking/redaction) · A.8.15 logging · A.8.16 monitoring (structured logs + the `setLogSink`/`setAuditExportHook` extension points since Issue #447 — an attachment point for an external SIEM, NOT a real SIEM implementation, which remains outside the scope of this generic base, see `awcms-observability`) · A.8.24 cryptography · A.8.28 secure coding (doc 10 guardrails) · A.8.31 separation of environments. The rest (policy, personnel, physical) is outside the scope of the base code.

## How to work

1. Map every item to real evidence in the repo (DB queries, domain function calls, file greps) — **not** assumptions; the same pattern as `scripts/security-readiness.ts`.
2. Mark it: satisfied / gap / out of base scope. A **critical** finding blocks go-live.
3. Prioritise gaps by impact (STRIDE/EoP & Info-disclosure highest).

## Output

A compliance matrix (category → status → evidence/location → remediation) + a list of findings ranked critical→low + suggested patches. Run `bun run security:readiness` as the objective gate.

**Then update
[`docs/awcms/standar-performa-dan-keamanan.md`](../../../docs/awcms/standar-performa-dan-keamanan.md).**
That is not extra work, it is the deliverable: an audit whose result only
lives in a chat answer will be redone from scratch six months later, and a gap that
was already rejected with a reason will be proposed again as a new finding. That
document's rule: a row without a **checker** is a claim, not a control — so every
gap moved to `CLOSED` must name the gate/test that landed with it.

## Related skills

`awcms-security-review` (the per-module DoD checklist), `awcms-abac-guard`, `awcms-audit-log`, `awcms-observability` (correlation ID, retention, the A.8.16 extension point), `awcms-integration` (rate limiting reuse), `awcms-sensitive-data`, `awcms-sync-hmac`, `awcms-production-preflight`; the `awcms-security-auditor` subagent.
