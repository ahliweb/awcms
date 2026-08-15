🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](repo-assessment-2026-08-04.id.md)

# `awcms` repo assessment — 4 August 2026

> **What this document is for.** A full assessment of the repo at a single point
> in time, measured against **four axes**: AWCMS's own development standards
> ([`../../AGENTS.md`](../../AGENTS.md) + `docs/adr/`), its relationship with
> [`ahliweb/awcms-astro`](https://github.com/ahliweb/awcms-astro), international
> performance standards, and international security standards.
>
> **Every finding below is verified against the CODE**, not against documents.
> This repo has a long history of findings written from guesswork that were then
> copied into decisions (ADR-0058 §1, ADR-0059, ADR-0060) — so every claim
> carries its file and line, and claims that cannot be proven are not written.

## 1. Measured scale

| Dimension                          | Number    |
| ---------------------------------- | --------- |
| Registered modules                 | 21        |
| `sql/` migrations                  | 90        |
| Tables (`CREATE TABLE`)            | 130       |
| RLS `ENABLE` / `FORCE` statements  | 118 / 141 |
| `/api/v1` API routes               | 255 files |
| Admin screens                      | 31        |
| Test files                         | 292       |
| `src/` lines (ts + astro)          | ~156,000  |
| Gates in the `bun run check` chain | 29        |
| ADR                                | 65        |
| Database indexes                   | 266       |

> **Correction.** The first version of this table wrote **22** modules — that
> counted `src/modules/_shared/`, which is not a module. `listModules()` returns
> **21**. The migration/gate/ADR/index numbers have been updated after
> ADR-0063/0064 landed.

This is not a young repo. Its gate density (29) is high for its size, and that is
important context for everything that follows: **the findings below are not
things that slipped through because nobody was checking — they are things that
had no checker at all.**

## 2. P0 finding — THREE handlers bypass the authorization chokepoint

> **CORRECTION 4 August 2026 (the ADR-0063 PR).** The first version of this
> section wrote the finding as **one** deviating route, and named
> `PATCH /api/v1/blog/posts/{id}` as **an example of the CORRECT pattern**. That
> was wrong. The file `blog/posts/[id].ts` calls `authorizeInTransaction` in
> `GET` (line 83) and `DELETE` (line 431), while `PATCH` in the same file does
> **not at all** — a FILE-level reading merged them into a single flow and
> concluded a compliance that does not exist. A per-HANDLER analysis of 331
> handlers found **three** violators, not one, and a fourth "violator"
> (`access/evaluate.ts`) turned out to be legitimate. This is the class of
> mistake this very document warns about in its opening; it is recorded in full
> because the correction is the reason the ADR-0063 §B gate slices per handler.
> **Already FIXED** — see ADR-0063.

### What was found

Three handlers **do not call `authorizeInTransaction` at all** —
`PATCH /api/v1/blog/posts/{id}`, `POST /api/v1/blog/posts/{id}/submit-review`, and
`PATCH /api/v1/blog/pages/{id}`. All three assemble their own authorization:

```
resolveTenantContext → resolveModuleEnabled → fetchGrantedPermissionKeys
  → evaluatePostUpdateAccess → recordDecisionLog
```

And all three are NOT an oversight: they enforce the product rule (#538) that
**an author may edit their own unpublished content even without holding the
permission for it** — an authorization axis the permission catalogue cannot
express. `authorizeInTransaction` returns `denied` before any domain rule is
consulted, so putting it in front of that rule would REMOVE the author path. The
defect is in the chokepoint seam, not in the route authors' discipline.

### What is missing on that path

`authorizeInTransaction`
([`src/modules/identity-access/application/access-guard.ts`](../../src/modules/identity-access/application/access-guard.ts))
is where the following live — all of them bypassed by the routes above:

| Layer                           | ADR                                                                          | Effect of bypassing                                                                                                 |
| ------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `evaluateAccess` (ABAC DSL)     | #179                                                                         | **An explicit ABAC `deny` policy over `blog_content.posts.update` IS HONOURED in `PATCH`, NOT in `submit-review`.** |
| `isPlatformScopedPermissionKey` | [ADR-0053](../adr/0053-platform-scoped-permissions.md)                       | The cross-tenant gate is not evaluated                                                                              |
| `resolveBusinessScopeFacts`     | [ADR-0060](../adr/0060-business-scope-hierarchy-provided-by-tenant-admin.md) | Business scope does not take part in the decision                                                                   |
| `isHighRiskAction` + SoD        | #181                                                                         | Segregation-of-duties conflicts are not checked                                                                     |

`evaluatePostUpdateAccess` itself states in its docblock that it is **not** the
shared `evaluateAccess` — it is a domain ownership rule, not a policy evaluator.

### Why no gate caught it

`bun run access:permissions:enforcement:check` ([ADR-0057](../adr/0057-blog-page-lifecycle.md) §F,
[ADR-0058](../adr/0058-unenforced-permissions-disposition.md)) asks
**"does this permission have an enforcer?"** — and `blog_content.posts.update`
does: `PATCH /{id}`. That gate does **not** ask "does EVERY enforcement site use
the chokepoint". This is an exact repeat of the PR #351 lesson: _a permission
coverage gate and enforcement-site correctness answer two different questions,
and a control can pass the first while being wrong on the second._

### Standards mapping

- **OWASP Top 10 2021 — A01 Broken Access Control** (a weaker parallel
  authorization path), **A04 Insecure Design** (two evaluators for one
  permission).
- **OWASP API Security Top 10 2023 — API5 Broken Function Level Authorization.**
- **OWASP ASVS v4.0.3 — V4.1.3** (least privilege enforced consistently),
  **V1.4.4** (a single centralized access mechanism, not bypassed).
- **ISO/IEC 27001:2022 Annex A — A.8.3** (information access restriction),
  **A.8.26** (application security requirements).

### Honest severity

**Moderate, not critical.** The blast radius of those routes is narrow — the
`draft` → `review` transition on a single post, and RBAC + the ownership rule
STILL apply. What leaks is not data but **policy consistency**: a tenant who
writes an ABAC policy to hold back `posts.update` will find their policy honoured
on one route and silently ignored on another. It is the class that is serious,
not the instance.

### Recommendation

**DONE — [ADR-0063](../adr/0063-ownership-grants-run-through-the-authorization-chokepoint.md).**

1. `authorizeInTransaction` gained an `ownershipGrant`, which **WIDENS** the set
   of permissions evaluated instead of short-circuiting the decision. The
   ownership rule becomes an input to the chokepoint, not a replacement — so
   ABAC (including an explicit `deny`), platform-scope, business-scope, and SoD
   can still deny. Machine credentials are excluded (ADR-0049 §3), and the
   decision log marks an ownership-based allow as `ownership_grant:<reason>`.
2. The gate `bun run access:chokepoint:check`, **sliced per HANDLER** — not per
   file, because per-file reading is precisely what produced the correction
   above. Exceptions are keyed `<file>#<METHOD>` so they cannot widen to a
   neighbouring handler. Two entries: `auth/login.ts#POST` (pre-authentication)
   and `access/evaluate.ts#POST` (self-introspection that actually CALLS
   `evaluateAccess`). Score: **331 handlers, 6 decide permissions, 0 bypasses.**

## 3. ~~P1 finding — the rate limiter does not hold across more than one instance~~ — DONE

> **[ADR-0066](../adr/0066-shared-rate-limiting-and-full-auth-surface-coverage.md) (4 August 2026).**
> `checkSharedRateLimit` counts in Redis with the window number as part of the
> KEY, so two instances agree without read-modify-write. It FAILS OPEN when Redis
> is down — stated bluntly because it is the opposite of this repo's default
> posture, and honestly because the per-identity lockout in PostgreSQL is
> unaffected. Coverage rose from eight to **eleven** surfaces. The text below is
> kept as the finding's context.

### What was found

[`src/lib/security/rate-limit.ts`](../../src/lib/security/rate-limit.ts)
keeps counters in an **in-process `Map`** (line 21). The file itself records this
as a known limitation — so this is not a hidden defect but **debt that is not due
until the deployment is scaled horizontally**.

Its arithmetic consequence: with **N** application instances behind a load
balancer, the effective limit becomes **N × the configured limit**. For
`POST /api/v1/auth/login` that means anti-brute-force weakens linearly with the
replica count — and it is exactly the deployments that need protection most
(high traffic → many replicas) that are the weakest.

**Redis is already in the repo** (`src/lib/redis/client.ts`, `cache.ts`, `config.ts`),
so this is not a new capability — only wiring.

### The limiter's coverage today

| Endpoint                          | `checkRateLimit` |
| --------------------------------- | ---------------- |
| `auth/login`                      | present          |
| `auth/register`                   | present          |
| `auth/mfa/totp/verify`            | present          |
| `auth/password/forgot`            | present          |
| `auth/password/reset`             | present          |
| `auth/session-handoff/issue`      | **absent**       |
| `auth/session-handoff/redeem`     | **absent**       |
| `auth/sso/{providerKey}/callback` | **absent**       |

The three empty ones have other mitigations (a handoff code ≤60 seconds +
single-use + `redeem` demands a client secret; the SSO callback is bound to
state), so this is **completeness, not a hole**. But ASVS demands anti-automation
across the whole authentication surface, not part of it.

### Standards mapping

- **OWASP API Security Top 10 2023 — API4 Unrestricted Resource Consumption.**
- **OWASP ASVS v4.0.3 — V11.2.1/V11.2.2** (anti-automation), **V2.2.1**
  (anti-brute-force controls on authentication).
- **ISO/IEC 27001:2022 Annex A — A.8.5** (secure authentication), **A.8.6**
  (capacity management).

### Recommendation

Move counter storage to Redis **if and only if** the deployment is
multi-instance, with an explicit fail-open: Redis being down **must not** close
login (availability wins over tightening on this path), but it must report itself
through `security:readiness`. Then complete the three empty endpoints.

## 4. ~~P1 finding — the contract `awcms-astro` uses is guarded by no test at all~~ — DONE

> **[ADR-0065](../adr/0065-awcms-astro-consumer-contract-is-frozen.md) (4 August 2026).**
> `bun run api:consumer-contract:check` freezes **6 paths + 16 components** — a
> full `$ref` closure, because freezing the path objects alone is nearly useless
> when the interesting breakage happens in the schemas. The rule is an additive
> subset; mutation-proven in both directions (rename a field inside a component →
> red; add an optional field → passes). The text below is kept as the finding's
> context.

### The two repos' relationship today

`awcms-astro` is **no longer held back**: ADR-0027 over there closes the ADR-0021
hold because both of its indicators are met. That repo calls **six surfaces** of
this repo:

| Surface                                                              | Landed in |
| -------------------------------------------------------------------- | --------- |
| `GET /api/v1/blog/posts` (`view=full` traversal, cursor, `?locale=`) | #317      |
| `GET /api/v1/blog/posts/{id}`                                        | —         |
| `GET /api/v1/media/objects`                                          | #318      |
| `GET /api/v1/media/public-origin`                                    | #370      |
| `GET /api/v1/auth/session`                                           | ADR-0049  |
| `POST /api/v1/access/machine-credentials`                            | ADR-0049  |

### The defect

The frozen OpenAPI snapshot
([`tests/fixtures/openapi-pre-migration-snapshot.openapi.yaml`](../../tests/fixtures/openapi-pre-migration-snapshot.openapi.yaml),
enforced by `tests/openapi-bundle.test.ts`) is a **PRE-migration-#182** snapshot.
It guarantees the _add-only_ property against that baseline — and **all five
surfaces that `awcms-astro` actually consumes landed AFTERWARDS**, so not one of
them is in it. Verified: searching for `/auth/session`, `/media/objects`,
`/media/public-origin`, `/access/machine-credentials` in the snapshot file
returns **zero**.

Which means: **changing the response shape of any one of those five surfaces is
green in this repo's CI, and breaks the `awcms-astro` build.** Not a single gate
asks about it, and the failure shows up in ANOTHER repo — where the person who
changed it does not look.

This is exactly the shape of defect that [ADR-0062](../adr/0062-skills-are-gated-against-the-code-they-describe.md)
has just closed for skills: a checkable claim, in a layer nobody checks.

### Standards mapping

- **ISO/IEC 25010 — Compatibility / Interoperability.**
- **OWASP ASVS v4.0.3 — V13.1.1** (API contract defined & enforced).
- Consumer-driven contract testing as an industry norm for service boundaries.

### Recommendation

Add a **second consumer-contract snapshot** — not by widening the pre-migration
snapshot (it has a different job and must stay frozen). Its contents are ONLY the
six surfaces above, with the same add-only rule, and a comment naming
`awcms-astro` as the owner of its rationale. The cost is small; what it buys is
that this repo's CI answers a question that today can only be answered by the
other repo's build failing.

## 5. Performance — the posture is strong, two honest gaps

### What is already right

- **Varnish edge cache** ([ADR-0042](../adr/0042-varnish-edge-cache-auto-activation.md),
  [ADR-0061](../adr/0061-host-resolved-public-surfaces-are-edge-cacheable.md)):
  11 declared surfaces, a fail-closed allow-list, automatically ramping TTL,
  invalidation via surrogate key + a durable queue. Conforms to **RFC 9111**
  (HTTP caching) and **RFC 5861** (`stale-while-revalidate`).
- **Conditional validators** ETag/`Last-Modified` → 304 across all discovery
  routes.
- **Keyset pagination** used by 26 files, with microsecond-precision text cursors
  (trap #158 is closed and tested).
- **Offset pagination** used by 10 files BUT **bounded** (`MAX_PAGE_NUMBER`
  10,000, clamped on both sides) — so not an amplification attack surface.
- **253 indexes** and `bun run db:work-class:check` for pool work-class
  separation.
- **Redis** cache-aside available with fail-open.

### ~~Gap 1 — no performance gate at all~~ — PARTLY CLOSED

> **[ADR-0064](../adr/0064-foreign-key-columns-must-be-index-reachable.md) (4 August 2026)**
> gives this repo its FIRST performance gate: `bun run db:fk-index:check`.
> 182 FK columns measured, **14 not index-reachable**; `sql/090` indexes thirteen
> and one is excluded with a reason (`awcms_setup_state` is a hard singleton).
> The rule is tenant-aware (`(tenant_id, fk)` counts as reachable) because the
> literal "must lead" rule is violated by 40 out of 182 — and a gate that demands
> 40 migrations on the day it lands is an exception list waiting to be written.
> Per-endpoint query budgets and Core Web Vitals REMAIN open. The text below is
> kept as the original finding's context.

There is no `*:check` for index coverage, query budget, or bundle size budget.
This repo gates 28 things; **zero** of them are performance. The practical
consequence: an N+1 query or an unindexed FK column can land with all of CI
green.

`scripts/README.md` §Deferred does record `performance:*` as tooling that does
not exist yet — so this is a **known gap**, not a forgotten one.

- **ISO/IEC 25010 — Performance efficiency** (time behaviour, resource
  utilization) has no automated evidence.

### Gap 2 — Core Web Vitals are never measured

This repo serves real HTML (`/news/**`, `/blog/{tenantCode}/**`, 31 admin
screens) but there is no **LCP / INP / CLS** measurement anywhere, and no asset
size budget. `visitor_analytics` collects visits, not vitals.

For the public pages that are the very reason the edge cache was built, not
measuring them means the cache's benefit is never proven against user experience
— only against origin load.

### Performance recommendations

1. **FK-index gate** (pure, no DB): every FK column in `sql/` must have an index,
   or be listed as a reasoned exception. This is the cheapest gate with the
   biggest return and it fits the repo's patterns.
2. ~~**Per-endpoint query budget**~~ **DONE** — `tests/integration/query-budget.ts`
   extracts the Proxy-apply-trap pattern from the SoD tests (#181) into a
   `countQueries` helper, and `query-budget.integration.test.ts` binds the
   hottest public read paths (listing, paging, feed) to a ceiling of **3
   queries** over a 40-post fixture. The fixture is deliberately larger than the
   ceiling: a ceiling over a single row proves nothing, because an N+1 and a
   constant implementation both emit about one query. Mutation-proven by
   injecting a REAL N+1 into `listPublicBlogPosts` — two tests went red
   immediately. One test guards the instrument itself (a Proxy that stops
   counting would make every ceiling pass vacuously).
3. Core Web Vitals: a product decision, not a defect — and now **written down as
   a pending decision**, [ADR-0067](../adr/0067-core-web-vitals-collection.md)
   (`Proposed`). It is the only one of the seven recommendations that did not
   land, deliberately: it does not fix a defect but ADDS collection of data about
   real visitors, and that collides with the privacy-first posture
   `visitor_analytics` already states (its purge is a DELETE with no archive,
   with a written reason). That ADR gives three options with their real
   trade-offs and recommends **aggregates-only** — no raw rows — if it is taken
   at all. **Not taking it is a legitimate answer**, and it is better recorded as
   a decision than left as an open gap.

## 6. Security — the baseline posture is strong

Verified present and correct, not assumed:

| Control                                | Evidence                                                                                                                                                                                                 |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Complete security headers              | [`src/lib/security/security-headers.ts`](../../src/lib/security/security-headers.ts) — CSP, HSTS (TLS-gated), `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy` |
| RLS `FORCE` + non-owner role           | 141 `FORCE` statements; tested as `awcms_app` LOGIN, not superuser                                                                                                                                       |
| ABAC default-deny + decision log       | `evaluateAccess`, `recordDecisionLog`                                                                                                                                                                    |
| MFA/TOTP, OIDC, Turnstile, SoD         | #184/#185/#186/#181                                                                                                                                                                                      |
| Read-only machine credentials          | [ADR-0049](../adr/0049-machine-credentials-and-session-introspection.md)                                                                                                                                 |
| Single-use session handoff ≤60 seconds | [ADR-0050](../adr/0050-bff-session-handoff-code.md)                                                                                                                                                      |
| Platform-scoped permissions            | [ADR-0053](../adr/0053-platform-scoped-permissions.md)                                                                                                                                                   |
| Permission enforcement coverage        | 203/203, **zero** exceptions ([ADR-0058](../adr/0058-unenforced-permissions-disposition.md))                                                                                                             |

Mapping to **OWASP Top 10 2021**: A01 is covered except for the §2 finding; A02
(crypto) via session hashing + MFA secret encryption; A03 via Bun.SQL tagged
templates (no SQL concatenation); A05 via `validate-env` + `security:readiness`;
A07 via MFA/atomic-in-DB lockout; A09 via audit log + decision log + correlation
ID.

### One dependency finding

`bun audit`: **1 moderate** — `postcss <=8.5.22` transitively via
`astro › vite › postcss` (GHSA-fxqj-rqcc-2cmp, reads an arbitrary `.map` when
`from` is unset). A build path, not production runtime. Recommendation:
`overrides` to `postcss ^8.5.23`, the same pattern `awcms-astro` uses for
`fast-uri`.

## 7. Ranked recommendations

| #   | Recommendation                                                              | Axis                            | Needs an ADR?                      |
| --- | --------------------------------------------------------------------------- | ------------------------------- | ---------------------------------- |
| 1   | Route `submit-review` through `authorizeInTransaction` **+ its class gate** | Security (A01/API5/ASVS V1.4.4) | Yes — a gate is a standards change |
| 2   | A consumer contract snapshot for the six `awcms-astro` surfaces             | Interop (ASVS V13.1.1)          | Yes                                |
| 3   | Shared rate limiter (Redis) + complete the 3 endpoints                      | Security (API4/ASVS V11.2)      | Yes                                |
| 4   | FK-index gate                                                               | Performance (ISO 25010)         | No — a pure gate                   |
| 5   | postcss `overrides`                                                         | Supply chain                    | No                                 |
| 6   | Per-endpoint query budget                                                   | Performance                     | No                                 |
| 7   | Core Web Vitals in `visitor_analytics`                                      | Performance/product             | Yes                                |

**Suggested order: 1 → 2 → 5 → 4 → 3 → 6 → 7.** Number 1 first because it is the
only one that concerns the correctness of a security control; number 2 second
because its failure shows up in another repo, where the person who caused it does
not see it; number 5 is slipped in early only because it costs one line.

## 8. What is NOT recommended, and why

- **Raising test coverage for the number's sake.** 292 test files with a
  consistent mutation-proven pattern are already worth more than a percentage.
- **Gating `docs/awcms/`** the way `.claude/skills/` is gated. Its contents are
  deliberately a mix of history + specification, and are not executed as
  instructions — ADR-0062 §3 already states that boundary.
- **Turning `EDGE_CACHE_MODE` on by default.** OFF by default is an ADR-0042
  decision and it remains correct: a shared cache in front of a multi-tenant
  application is a leak machine if it is misconfigured.
- **Building `newsletter`/`social-publishing` now.** Both need an admission ADR,
  and neither blocks `awcms-astro` — that is both repos' conclusion, not a
  unilateral judgement.

## 9. Second round — 4 August 2026, after six recommendations landed

> **Why there is a second round on the same day.** Six of the seven §7
> recommendations landed back to back (ADR-0063 → #380, postcss → #381,
> ADR-0064 → #382, ADR-0065 → #383, ADR-0066 → #384, query budget → #385,
> ADR-0067 → #386). This round re-assesses the repo **after** all of them went
> in, and found thirteen things the first round did not see — partly because it
> measures a different surface, partly because the neighbouring repo finished the
> same exercise and its result contradicts one number here.
>
> From this round on, control status **no longer lives in this document**. It
> moves to [`standar-performa-dan-keamanan.md`](standar-performa-dan-keamanan.md),
> which is designed to be **kept up to date**. This document stays a snapshot: it
> must not age into a task list.

### 9.0 Measured scale, updated

| Dimension                          | Round 1 | Now                   | Command that produced it                      |
| ---------------------------------- | ------- | --------------------- | --------------------------------------------- |
| Registered modules                 | 21      | 21                    | `listModules()`                               |
| `sql/` migrations                  | 90      | 90                    | `ls sql/*.sql \| wc -l`                       |
| Gates in the `bun run check` chain | 29      | **33**                | split `scripts.check` on `&&`                 |
| ADR                                | 65      | **68**                | `ls docs/adr/0*.md \| wc -l`                  |
| Test files                         | 292     | **293**               | `find tests -name '*.test.ts' \| wc -l`       |
| Database indexes                   | 266     | **268**               | `grep -h 'CREATE .*INDEX' sql/*.sql \| wc -l` |
| Pending changesets                 | 68      | **100**               | `ls .changeset/*.md \| wc -l`                 |
| `.astro` files                     | —       | **42** (22,328 lines) | `find src -name '*.astro'`                    |

Today's gate scores, run rather than quoted: **331 handlers / 6 decide
permissions / 0 bypasses**, **203/203 permissions gated / 0 exceptions**,
**182 FK columns / all index-reachable / 1 exception**, **11 edge cache surfaces
/ 3 purge-emitting modules**, `bun audit` **clean**.

### 9.1 Security — `AUTH_COOKIE_SECURE` fails open when it is not set

`scripts/validate-env.ts` line 510:

```ts
if (isProduction && env.AUTH_COOKIE_SECURE === "false") {
```

The runtime reads it as `process.env.AUTH_COOKIE_SECURE === "true"`
(`auth/login.ts:583`, `mfa-session-assurance.ts:217`, `analytics/collect.ts:194`).
Both sides use strict string comparison, and both lean in opposite directions:

Run, not read — `validateEnv` with `APP_ENV=production`:

| Value     | Validator result                 |
| --------- | -------------------------------- |
| **unset** | **ACCEPTED** ← the only hole     |
| `"false"` | rejected (production cross-rule) |
| `"1"`     | rejected (`bool` type rule)      |
| `"TRUE"`  | rejected (`bool` type rule)      |
| `"yes"`   | rejected (`bool` type rule)      |
| `"true"`  | accepted                         |

> **A correction to this section's first draft**, which wrote that
> `1`/`TRUE`/`yes` slipped through as well. That was **wrong**: `BOOL_VALUES`
> already rejects all three in any environment. Running the validator gave an
> answer that reading the file did not — and narrowed this finding from four
> states to one. That one is still the most likely to occur, because it is the
> **default** state: `required: false` allows the variable to be absent.

So `bun run config:validate` reports a clean production configuration while
session cookies are sent without `Secure`. HSTS mitigates it **after** the first
visit; it is the first visit that it does not protect.

**This is not a design choice in that file.** Two other production rules in the
same file do treat "not set" as a violation — `TRUSTED_PROXY_ENABLED` (line 622)
goes red when empty. This one is consistent with its runtime, not with its
neighbours.

- **ASVS 4.0.3 V3.4.1** (session cookie with `Secure`), **OWASP Top 10 A05**,
  **API8**, **ISO 27001 A.8.9**.
- **DONE.** The rule was flipped to `!== "true"` and its message names the value
  that is actually read. Two tests guard both directions: production WITHOUT that
  variable is rejected (mutation-proven — restore `=== "false"` and it goes red),
  and non-production still does NOT demand it, because dev runs on `http://` and
  `environments.md` records that difference as a per-environment decision.
  Testing only the `"false"` value would stay green on top of the original defect
  — which is why the assertion targets the ABSENT state.

### 9.2 Security — two recommended headers are not sent

`buildSecurityHeaders` sends six headers and does **not** send
`Cross-Origin-Opener-Policy` or `Cross-Origin-Resource-Policy`. Both fall into
the OWASP Secure Headers Project's _recommended_ category.

For this repo COOP `same-origin` is not a formality: this application has **human
sessions** and 42 rendered pages, so cross-origin browsing-context isolation is a
control that genuinely applies — unlike a static site with no sessions. The cost
is one line and one assertion.

### 9.3 Performance — the repo compresses nothing, and that is not the same as "uncompressed responses"

> **CORRECTION 4 August 2026, probed against staging AND production.** This
> section's original title read _"there is no response compression anywhere"_ and
> that was **wrong on the part that matters most**. Both deployed environments
> return `content-encoding: gzip`:
>
> ```
> $ curl -sSI -H 'Accept-Encoding: gzip, br' https://awcms.ahlikoding.com/api/v1/health
> content-encoding: gzip
> server: cloudflare
> ```
>
> Cloudflare sits in front of Traefik and compresses. And that topology is
> **already written down** — [`environments.md`](environments.md) §Edge cache
> draws `Cloudflare (proxied) -> Traefik :443 -> varnish:80 -> app` — so even the
> first draft of this correction nearly reported "an undocumented CDN tier", a
> second finding that would also have been wrong, because it was read from the
> first 180 lines of a 330-line file.
>
> **Twice in one round, reading part of a source produced a confident and
> mistaken finding** — exactly the class this document's opening warns about, and
> exactly why the ADR-0063 gate slices per handler.
>
> What **remains true** and is therefore still recorded, at a far lower severity:
> this repo does not compress anything it owns, so a deployment of this template
> that is not behind a compressing CDN gets no compression at all — and not one
> gate, `config:validate`, or `security:readiness` says so. It moves from "a
> performance defect" to "an unrecorded dependency on an outer layer".
>
> What was **born** out of the same probe is far sharper: see §9.3b.

Verified against three layers of the repo, and still accurate:

| Layer                                    | Search result                                              |
| ---------------------------------------- | ---------------------------------------------------------- |
| Application (`src/`, `astro.config.mjs`) | zero compression middleware                                |
| `infra/varnish/default.vcl` (209 lines)  | **zero** occurrences of `gzip`/`do_gzip`/`Accept-Encoding` |
| `deploy/`                                | zero declared `compress` middleware                        |

Varnish does not compress on its own initiative: without
`beresp.do_gzip = true` it stores what the backend sends, and the backend never
sends compressed. Traefik likewise does not compress without a declared
middleware — the same argument `awcms-astro` uses to refute "HSTS is the business
of the layer in front".

What makes it more than an oversight: `src/lib/edge-cache/response-headers.ts`
**already** emits `Vary: Accept-Encoding` on cacheable responses, with a comment
explaining compression negotiation. That header is a promise with nothing behind
it — it multiplies the cache key space for a negotiation that never happens, and
it reads as though compression were already handled.

Measured, not estimated — today's `dist/client` text assets:

```
raw = 139,048 B    gzip -9 = 49,679 B    ratio 2.79× (saves 64%)
```

And the client assets are the **smallest** part: the genuinely large ones are the
HTML of 42 pages, the `/api/v1` JSON responses, and the `sitemap.xml`/`feed.xml`
that exist to be crawled repeatedly. All three compress better than 2.79×.

- **ISO/IEC 25010 — performance efficiency (resource utilization)**; standard
  transport practice (RFC 9110 §8.4 content coding).
- Fix (optional, low priority): compression in the application (the
  `awcms-astro` pattern, which negotiates Brotli) **or** `beresp.do_gzip` in the
  VCL. What must not happen: two places deciding the same thing — and with
  Cloudflare already compressing, adding a second layer here creates exactly that
  problem. Cheaper and more honest: one line in `security:readiness` stating that
  compression is inherited from an outer layer.

### 9.3b Performance — purge reaches Varnish, not the tier that serves readers

The probe that corrected §9.3 also exposed something that is invisible from any
code, because it only appears when all three layers run together.

On one and the same request to staging:

```
$ curl -sSI https://awcms-staging.ahlikoding.com/robots.txt
cache-control: public, max-age=300, s-maxage=300, stale-while-revalidate=600
x-edge-cache-skip: surface_not_declared     <- application: Varnish does not cache this
age: 182
cf-cache-status: HIT                        <- Cloudflare: I am the one answering
```

Two tiers, two different answers, and the one answering the reader is the tier
the purge queue does **not** reach. `EDGE_CACHE_PURGE_ENDPOINT` points at
`http://awcms-staging-varnish:80` ([`environments.md`](environments.md) §Edge
cache), so `bun run edge-cache:purge` bans surrogate keys **in Varnish only**.
There is no Cloudflare zone API call anywhere in `src/` — zero occurrences.

The consequence: publishing content invalidates the tier that does not serve, and
leaves the tier that does serve stale.

**Severity: low, and it is its bounds that make it low.** The staleness is
bounded by `s-maxage` (`EDGE_CACHE_MAX_TTL_SECONDS=300`, so ≤5 minutes),
tenant-specific responses are keyed per host by Cloudflare's cache key, and
anything the application marks `private, no-store` is not cached by CF
(`cf-cache-status: DYNAMIC`, verified). So this is a **lag, not a leak**.

What makes it worth recording is not its size but that **no test can see it**:
the acceptance test table in `environments.md` measures `X-Cache` from Varnish —
the tier that is not the one answering. A layer that genuinely serves readers
while every instrument points at another layer is the same shape as the three
bugs that enabling Varnish itself uncovered: reporting success while not working.

Fix: purge Cloudflare in the same worker (the zone API accepts a list of URLs or
tags), **or** — legitimate and cheaper — a written statement in ADR-0042 that
`s-maxage` is the accepted staleness bound, so the CF tier is deliberately not
purged and its acceptance test stops measuring the wrong tier.

### 9.3c Operations — staging runs a build that has fallen behind

Found while using staging as a verification target, and it limits what staging
can prove today:

| Probe                             | Staging                                            | What it means                       |
| --------------------------------- | -------------------------------------------------- | ----------------------------------- |
| `GET /api/v1/media/public-origin` | **404**                                            | #370 not deployed yet               |
| `GET /news`                       | **404**                                            | #372 (ADR-0059) not deployed yet    |
| `GET /robots.txt`                 | 200, but `x-edge-cache-skip: surface_not_declared` | #376 (ADR-0061 §B) not deployed yet |

The consequence is not merely "a deploy is needed": the claim **"the edge cache
is ACTIVE on staging"** in [`environments.md`](environments.md) is true for
Varnish as a process, and **not** true for the surfaces ADR-0061 declares — in
the running build, all six discovery routes are not declared at all. The
acceptance evidence that document quotes predates its PR.

### 9.4 Standards — 22,328 lines of `.astro` are never type-checked

`bun run typecheck` is `tsc --noEmit`. `tsc` **cannot parse `.astro`** — it skips
it silently, even though `tsconfig.json` writes `"include": ["src/**/*"]`.
`@astrojs/check` is not installed, and `astro build` does not type-check.

The result is that **42 files / 22,328 lines** — all 31 admin screens, the login
page, and the public pages — have no type checker at all, while 33 other gates
run on top of them.

The defect class this misses is not hypothetical. `withTenant` returns
`T | Response`; `withTenantOrThrow` throws. An `.astro` page that uses the first
form and then treats the result as data will **compile** and render a broken page
without a single red gate.

> **Checked, and the result is clean today.** All eleven occurrences of
> `withTenant` in `src/pages/**/*.astro` turned out to be **entirely inside
> comments** explaining why `withTenantOrThrow` is used instead (78 occurrences).
> The authors' discipline is right. What is missing is **whatever keeps it that
> way** — and that is exactly what keeps being found in this repo: a truth that
> holds today without a checker is a truth waiting to be changed.

`awcms-astro` runs `astro check` in its own `check` chain. The repo with 42
`.astro` files does not; the repo with fewer does.

### 9.5 Interop — the consumer contract freezes six surfaces; its consumer calls three

[ADR-0065](../adr/0065-awcms-astro-consumer-contract-is-frozen.md) states that
`CONSUMER_PATHS` was "derived by grepping the neighbouring repo". The
neighbouring repo now has a **gated** answer, and its number is different.

`tests/kontrak-awcms.test.mjs` in `awcms-astro` (ADR-0030 in that repo) enforces
**"the source code calls exactly three surfaces"**, with comments **stripped
first** — its own docblock states the reason: files over there DESCRIBE surfaces
that are not called, so a gate that counts docblocks would report the wrong
surfaces.

Verified directly against that repo's `src/`:

| Surface                                   | In `CONSUMER_PATHS` | Actually called in `src/`                                                 |
| ----------------------------------------- | ------------------- | ------------------------------------------------------------------------- |
| `GET /api/v1/blog/posts`                  | yes                 | **yes** — `src/lib/content.ts`                                            |
| `GET /api/v1/media/objects`               | yes                 | **yes** — `src/lib/awcms/media.ts`, `src/lib/article-images.ts`           |
| `GET /api/v1/media/public-origin`         | yes                 | **yes** — `scripts/asal-media.mjs`, `src/lib/awcms/media.ts`              |
| `GET /api/v1/blog/posts/{id}`             | yes                 | **no** — type comments only; ADR-0018 over there removed the per-id fetch |
| `GET /api/v1/auth/session`                | yes                 | **no** — a comment explaining why the build does NOT call it              |
| `POST /api/v1/access/machine-credentials` | yes                 | **no** — appears in an error message; issuing a token is a HUMAN action   |

The written reason for one entry even states something that does not happen:
`/blog/posts/{id}` is given the reason `"single-post rendering"`, while that repo
renders posts from the `view=full` traversal.

**Why this is harmful, not merely excess thoroughness.** A frozen contract that
contains unused surfaces (a) binds this repo to a shape nobody needs, and (b)
makes "the contract is guarded" feel more complete than it is. The neighbouring
repo wrote this objection down before this round did.

The right fix is **not** to trim it to three: `/auth/session` and
`/access/machine-credentials` are contracts genuinely promised to the ADR-0050
BFF that has not been built. The right fix is to **split the two lists** —
`CONSUMED` (derived from a marked block in the neighbouring repo, so it cannot
drift silently) and `COMMITTED` (promised, not yet called, with the ADR that
promises it) — then freeze both with an honest reason on each.

> **An irony worth recording.** This defect was born from grepping without
> stripping comments. This round nearly reported a twin defect in THIS repo in
> exactly the same way (§9.4): eleven `withTenant`s in `.astro` that turned out
> to be entirely comments. The only difference is that the second one was checked
> before it was written.

### 9.6 Standards — skill exemptions are per-SKILL and total

`skills-check.ts` guards `.claude/skills/` with three rules, and an
`ASPIRATIONAL_SKILLS` list (18 entries) that **exempts a skill entirely** from
the path rule (1) and the command rule (4).

`awcms-performance` is on that list with the reason
`"cross-cutting: names deferred performance tooling"`. The reason names
**commands**; its exemption covers **paths too**. The result, inside the same
skill body:

- Near the top: _"WARNING — the commands on this page DO NOT EXIST YET in this
  repo."_
- Sixty lines below it: _"use the existing suite in `src/lib/performance/`, do
  not build new ad hoc tooling"_ — a directory that **does not exist**.

A skill that contradicts itself is worse than a skill that is wrong, because its
reader will pick whichever sentence best fits their work. And skills are
**FOLLOWED** — that is the premise of ADR-0062.

Measured across the whole directory: **16 of 55 skills** contain at least one
`src/…` or `bun run …` claim that does not resolve. Most are legitimate
(target-spec and historical). The illegitimate ones cannot be told apart from the
legitimate ones by any gate, because the exemption is all-or-nothing.

**A second hole, mechanical, and easier to close.** That gate's path extractor
only looks at backticked paths **on a single line**. Prettier wraps long lines in
markdown, so a path can end up as:

```
… driven by `src/lib/config/
registry.ts`'s field `deprecated`.
```

— and become **invisible to the gate**. There are **three** such paths in
`.claude/skills/` today. Two of them are in skills that are exempt anyway; one is
not: `awcms-production-preflight` claims `src/lib/config/registry.ts`, a file
that does not exist (there is no `src/lib/config/` directory at all) in a skill
that is **not** exempt. It passes purely because of where the line wrapped.

That means rule 1 today is not "a path that is named must exist" but "a path that
is named **and happens to fit on one line** must exist" — and that difference is
not written down anywhere.

> **Proven, not postulated.** When the correction for that skill was written, its
> path was joined back onto a single line — and `bun run skills:check`, which had
> previously been `OK`, **went red immediately**, naming that exact file. The
> hole is mechanical, and its mutation proof was free.

**A third hole, and it explains why the first two exist.** That gate has no way
to tell _"this path exists"_ from _"this path does NOT exist, and that is the
point of the sentence"_. A correction that writes a missing file name in
backticks will **turn the gate red precisely because it is right**. That is the
pressure that produced the all-or-nothing exemption list: when the only way to
write the truth is to exempt the whole skill, people will exempt the whole skill.

Fix: (a) narrow the exemption to a **marked block** inside the skill (the marker
pattern is already used by `repo-inventory.md` here and
`<!-- permukaan:dipanggil:mulai -->` in the neighbouring repo) — that block also
becomes the legitimate place to name files that genuinely do not exist; and (b)
normalize whitespace inside backticks before matching paths. The second is one
line of code, and it found a real defect on the day it landed.

### 9.7 Standards — six `Accepted` ADRs without a single line of code

| ADR      | States                                         | In code                                                                               |
| -------- | ---------------------------------------------- | ------------------------------------------------------------------------------------- |
| ADR-0016 | `organization_structure` module admission      | `src/modules/organization-structure` **does not exist**                               |
| ADR-0017 | `document_infrastructure` module admission     | **does not exist**                                                                    |
| ADR-0018 | `data_exchange` module admission               | **does not exist**                                                                    |
| ADR-0019 | `integration_hub` module admission             | **does not exist**                                                                    |
| ADR-0021 | `reference_data` module admission              | **does not exist**                                                                    |
| ADR-0020 | ERP extension readiness contracts in `_shared` | all three of its files were **deleted** by ADR-0034; `_shared/` does not contain them |

ADR-0020 is the worst case: its status is `Accepted` while the artifacts it
decided have already been **revoked by another ADR** that did not mark it
`Superseded`.

This is exactly the same class ADR-0062 closed for skills: `Accepted` reads as
"present in the code", and nobody checks it. The difference is that ADRs cannot
be gated as tightly as skills — an admission ADR does legitimately precede its
implementation. What is missing is not the gate but the **vocabulary**: the
status `Accepted` packs two different states ("decided, not built yet" and
"decided, running") into one word.

### 9.8 Standards — release debt

`v6.4.0` was tagged 26 July 2026. Since then: **108 commits, 100 pending
changesets**, one of them `major` — so the next release is `v7.0.0`.

The number in `PROJECT_STATE.md` read 68 nine days ago; that document even
carries a note about how that number went stale before. It is stale again, on the
same line.

What makes this more than tidiness: one release with 100 changesets produces a
CHANGELOG nobody reads, and a `major` buried in the middle of it. Small frequent
releases are a quality control, not a process.

### 9.9 Performance — ADR-0067 has not weighed lab measurement

ADR-0067 offers three options: **A** do not collect, **B** aggregates-only,
**C** raw rows (rejected). All three are forms of **RUM** — collecting data from
real visitors — and that is why the ADR collides with the privacy posture of
`visitor_analytics` and ended up waiting on a product owner's decision.

What is not in that ADR: **lab measurement**. Lighthouse/Playwright against your
own build collects **zero** visitor data, does not touch `visitor_analytics`,
needs no table, needs no public endpoint — and this repo **already has Playwright
installed plus an env-gated E2E suite**.

The two answer different questions, and that is precisely why both can live
together: lab answers _"does this change make the page slower"_, RUM answers
_"what do visitors experience"_. Waiting on a decision about the second does not
block the first.

Recommendation: add **Option D — lab measurement** to ADR-0067 as an orthogonal
option (it can be taken alongside A), with its limitation stated: lab measures
pages, not visitors.

### 9.10 Second-round ranked recommendations

| #   | Recommendation                                                               | Axis        | Needs an ADR?                         |
| --- | ---------------------------------------------------------------------------- | ----------- | ------------------------------------- |
| 1   | `AUTH_COOKIE_SECURE` fails closed when it is not set (§9.1)                  | Security    | No — a defect fix                     |
| 2   | `astro check` in the `check` chain (§9.4)                                    | Standards   | No — a pure gate                      |
| 3   | COOP + CORP (§9.2)                                                           | Security    | No                                    |
| 4   | Split `CONSUMED` from `COMMITTED` in the consumer contract (§9.5)            | Interop     | Yes — changes ADR-0065                |
| 5   | Record the HSTS divergence in the family manifest                            | Standards   | No                                    |
| 6   | Deploy staging to `main` (§9.3c) — a prerequisite for any verification there | Operations  | No                                    |
| 7   | Decide Cloudflare purge vs `s-maxage` as the staleness bound (§9.3b)         | Performance | Yes — changes ADR-0042                |
| 8   | Query budget for admin screens + asset size budget (§9.0)                    | Performance | No                                    |
| 9   | Narrow the `ASPIRATIONAL_SKILLS` exemption to a marked block (§9.6)          | Standards   | Yes — changes ADR-0062                |
| 10  | Option D (lab) in ADR-0067 (§9.9)                                            | Performance | Yes — changes ADR-0067                |
| 11  | ADR status vocabulary for "decided, not built yet" (§9.7)                    | Standards   | Yes                                   |
| 12  | A family-level ADR to pin the OWASP editions                                 | Security    | Yes                                   |
| 13  | Release `v7.0.0` (§9.8)                                                      | Standards   | No                                    |
| —   | ~~Response compression in a layer the repo owns~~ (§9.3)                     | Performance | **REVOKED** — Cloudflare already does |

**Suggested order: as numbered.** Number 1 first because it is the only active
security-control defect; 2–5 follow because each costs one line plus one
assertion. Number 6 precedes the rest not because it is important but because it
is a **prerequisite**: until staging runs `main`, it cannot prove anything about
these changes.

> **Note 11 August 2026 — recommendation 6 LAPSES, it is not deferred.**
> [ADR-0083](../adr/0083-this-template-deploys-to-one-environment.md) decides
> that this repo deploys to **one** environment (production) and does not
> maintain a staging of its own, so "deploy staging to `main`" stops being a
> prerequisite waiting to be done — it is a prerequisite for an environment that
> deliberately does not exist. The dated findings in §9.3b/§9.3c are left exactly
> as they are: they are a record of what was true on 4 August 2026, and changing
> them to fit today would falsify them.

The compression recommendation is **revoked, not deferred.** The probes against
staging and production proved that responses really are compressed (by
Cloudflare), so adding a second layer would create exactly two places deciding
the same thing — precisely what the original recommendation forbids. What remains
of §9.3 is only to record that dependency, and that goes in as a line in
[`standar-performa-dan-keamanan.md`](standar-performa-dan-keamanan.md) §9, not as
work.
