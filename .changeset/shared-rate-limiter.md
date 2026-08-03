---
"awcms": minor
---

Rate limiting becomes a property of the deployment, and covers the whole
authentication surface (ADR-0066).

The limiter counted in an in-process `Map`, so with N replicas the effective
limit was N × the configured one — anti-brute-force weakening in direct
proportion to replica count, leaving the deployments that most need protection
the weakest.

`checkSharedRateLimit` counts in Redis, which the repo already had. The window
number is part of the KEY rather than a stored timestamp, which is what makes it
correct where the `Map` is not: two instances agree without a read-modify-write,
so there is no race to win. `PEXPIRE` fires only on a window's first hit —
re-setting it every hit would slide the window and let a steady attacker hold
the key alive indefinitely. With no Redis configured it falls back to the map,
since a single-instance deployment has nothing to share.

**It fails OPEN when Redis is unreachable.** That is the opposite of this repo's
default posture, so: a rate limiter is availability tooling on the login path,
and failing closed would turn a Redis outage into "nobody can log in" — an
attacker-triggerable denial of the whole control plane. The per-identity lockout
is enforced atomically in PostgreSQL and is unaffected, so this is the
source-scoped backstop rather than the last line.

Coverage rises from eight surfaces to eleven: `session-handoff/issue`,
`session-handoff/redeem` and `sso/{providerKey}/callback` had none. Each had
other mitigations, so this is completeness rather than a hole — but ASVS V11.2
wants anti-automation across the whole authentication surface.

No migrations, no permissions, no OpenAPI change.
