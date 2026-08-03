---
"awcms": patch
---

Repo-wide assessment against four axes, and the skill corrections it produced.

[`docs/awcms/repo-assessment-2026-08-04.md`](../docs/awcms/repo-assessment-2026-08-04.md)
measures the repo against AWCMS's own development standards, its relationship
with `ahliweb/awcms-astro`, international performance standards (ISO/IEC 25010,
RFC 9111/5861, Core Web Vitals) and international security standards (OWASP Top
10 2021, OWASP API Security Top 10 2023, OWASP ASVS 4.0, ISO/IEC 27001:2022
Annex A). Every finding is verified against code, with file and line.

Three findings change the backlog:

- **P0 — one route bypasses the authorization chokepoint.**
  `POST /api/v1/blog/posts/{id}/submit-review` never calls
  `authorizeInTransaction`, so ABAC policy evaluation, the platform-scope gate,
  business-scope facts and SoD are all skipped for a permission that
  `PATCH /{id}` evaluates in full. An explicit ABAC `deny` on
  `blog_content.posts.update` is honoured on one route and silently ignored on
  the other. `access:permissions:enforcement:check` cannot see it: it asks
  whether a permission has an enforcer, not whether every enforcement site uses
  the chokepoint.
- **P1 — nothing tests the contract `awcms-astro` consumes.** The frozen
  OpenAPI snapshot is the pre-#182-migration baseline; all five surfaces that
  repo actually calls landed after it. Changing any response shape is green here
  and breaks the build there.
- **P1 — the rate limiter is an in-process `Map`**, so with N replicas the
  effective limit is N × configured. Redis is already in the repo.

Also: zero of the 28 `check` gates measure performance, and `bun audit` reports
one moderate transitive advisory (postcss via astro › vite).

`skills:check` gains **rule 4**: every `bun run <target>` a skill names must
exist in `package.json` or be declared deferred in `scripts/README.md` §Ditunda.
Deliberately narrow — that section explicitly permits skills to name deferred
reference targets, so the rule only catches targets that are neither. It found
two, one of which told readers to run a refresh command that never existed while
the real `gh` invocations sat on the same page.

Skills corrected: `awcms-abac-guard` now leads with the chokepoint rule that the
P0 finding shows was never written down; `awcms-performance` warns that its
commands do not exist yet; `awcms-security-hardening` carries the three open
findings; `awcms-github-snapshot` and `awcms-data-lifecycle` lose their ghost
commands.

No migrations, no permissions, no runtime change.
