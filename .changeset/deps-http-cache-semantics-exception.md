---
"awcms": patch
---

fix(deps): accept http-cache-semantics GHSA-ch52-4w7c-c8xp with a time-boxed audit exception (no patched release)

`deps:audit:check` started failing on `main` without any dependency change once
GHSA-ch52-4w7c-c8xp (high, `http-cache-semantics` <=4.2.0, `max-stale` handling
can disclose cross-user cached responses) was published. Unlike #879 it cannot
be closed through `overrides`: the advisory lists no patched version, the
registry's latest release is still 4.2.0, and `astro@7.3.5` (latest) and
`astro@7.4.0-beta.1` both declare `^4.2.0`.

It is accepted as the single entry in `scripts/dependency-audit-exceptions.ts`
(owner: ahliweb/awcms maintainers, review by 2026-11-03) because it is not
reachable here: Astro is the only consumer and only calls `CachePolicy`'s
`storable()`/`timeToLive()` at build time on a request it synthesises itself —
never `evaluateRequest()`/`satisfiesWithoutRevalidation()`, which is where the
client `max-stale` header is evaluated — and this repo has no remote images and
no shared cache keyed by the package. `tests/dependency-audit-check.test.ts` now
pins the exact exception set instead of requiring it to be empty, so a second
entry still cannot be added without a visible test edit. When upstream ships a
fix, the entry is replaced by an `overrides` pin (the gate fails on a stale
entry, so it cannot linger).
