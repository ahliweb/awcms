🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0066-shared-rate-limiting-and-full-auth-surface-coverage.id.md)

# ADR-0066 — Rate limits shared across instances, and the whole auth surface covered

- **Status:** Accepted
- **Date:** 2026-08-04
- **Decision makers:** @ahliweb
- **Related:** [`../awcms/repo-assessment-2026-08-04.md`](../awcms/repo-assessment-2026-08-04.md) §3 (the finding), [ADR-0050](0050-bff-session-handoff-code.md) (session handoff), [ADR-0049](0049-machine-credentials-and-session-introspection.md) (session introspection)

## Context

### 1. The limit weakens linearly with the number of replicas

`src/lib/security/rate-limit.ts` counts in an **in-process `Map`**. The file
itself already records that as a known limitation — so this is not a hidden
defect, it is **debt that comes due the moment the deployment is scaled
horizontally**.

The arithmetic: with **N** replicas behind a load balancer, the effective limit
becomes **N × the configured limit**. For `POST /api/v1/auth/login` that means
anti-brute-force weakens exactly in proportion to the replica count — so the
deployments that most need the protection (high traffic → many replicas) are
precisely the weakest ones.

Redis **already exists in the repo** (`src/lib/redis/`), so this is wiring, not a
new capability.

### 2. Three authentication surfaces with no limiter at all

`auth/session-handoff/issue`, `auth/session-handoff/redeem`, and
`auth/sso/{providerKey}/callback`. All three have other mitigations (the handoff
code is ≤60 seconds + single-use + `redeem` demands a client secret; the SSO
callback is bound to state), so this is **completeness, not a hole** — but
ASVS V11.2 demands anti-automation across the **entire** authentication surface,
not part of it.

## Decision

### §A — `checkSharedRateLimit`, with the window inside the KEY

A fixed window in Redis: `INCR` on the window key, `PEXPIRE` once on the first
hit.

**The window number is part of the KEY, not a stored timestamp.** That is what
makes it correct where the `Map` is not: two instances incrementing the same
window agree **without read-modify-write**, so there is no race for anyone to
win.

`PEXPIRE` only on the first hit. Resetting it on every hit would slide the window
and let a steady attacker keep the key alive indefinitely.

**Without Redis configured it falls back to the in-process `Map`.** That is not a
compromise: a single-instance deployment has nothing to share, and demanding
Redis for it would make the limiter a new hard dependency for the smallest
topology.

### §B — FAIL-OPEN, and only here

If Redis is configured but unreachable, the limiter **ALLOWS**. This is the
opposite of this repo's default posture, so it is stated out loud:

A rate limiter is an **availability** tool on the authentication path.
Failing closed would turn a Redis outage into _"nobody can log in"_ — a total
denial of service over the control plane, which **an attacker can trigger**.

What keeps that honest: **it is not the only control.** The per-identity lockout
owned by `identity-access` (`login-policy.ts`) is enforced **in PostgreSQL,
atomically**, and is unaffected by a Redis outage. This limiter is a
SOURCE-scoped backstop on top of it — the catcher of an attacker rotating
`loginIdentifier` — not the last line. Its command timeout is 250 ms so that a
slow Redis degrades to "allowed" quickly instead of adding latency to every
attempt, and `security:readiness` reports Redis configured-but-dead so the
degraded state is visible, not silent.

### §C — Eleven surfaces, not eight

The three endpoints without a limiter get one. The coverage is now: `login`,
`register`, `mfa/totp/verify`, `mfa/step-up`, `password/reset`,
`password/forgot`, `session`, `session-handoff/issue`, `session-handoff/redeem`,
`sso/{providerKey}/start`, `sso/{providerKey}/callback` — **eleven**, guarded by
a test that also enforces that no route still uses the per-instance limiter
directly.

> **Updated (ADR-0082, Wave 4 PR 4.2):** eleven becomes **thirteen**.
> `auth/invitations/{token}` and `auth/invitations/{token}/accept` are both
> unauthenticated and token-bearing, and the second one MINTS AN ACCOUNT — the
> most consequential unauthenticated write surface in this module. That number
> lives in `tests/shared-rate-limit.test.ts`, not in `scripts/`, so it is the
> easiest one to forget; this sentence exists so the prose does not age alone.

## Consequences

**What we get.** The rate limit becomes a property of the deployment, not a
property of a single process. The authentication surface is fully covered.

**What we pay.** The login path gets one Redis round-trip (capped at 250 ms,
fail-open). The call sites become `await` — fifteen files, mechanical.

**What does NOT change.** The limiter stays fixed-window, not
sliding/token-bucket. A fixed window allows a 2× burst at the window boundary;
accepted because the control that actually binds brute-force is the per-identity
lockout in the DB, and swapping the algorithm without changing that only moves
the number around.

**Zero migrations, zero permissions, zero OpenAPI changes.**
