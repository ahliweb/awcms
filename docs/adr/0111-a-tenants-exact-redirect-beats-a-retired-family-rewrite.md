🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0111-a-tenants-exact-redirect-beats-a-retired-family-rewrite.id.md)

# ADR-0111 — A tenant's exact redirect beats the retired-`/news` family rewrite

- **Status:** Accepted
- **Date:** 2026-08-23
- **Decision maker:** ahliweb
- **Related:** Issue #599 (the legacy archive migration this defeated); ADR-0039 (redirect governance, chain/loop prevention); ADR-0059 / ADR-0071 §4 (the retired `/news/**` family and its inversion); ADR-0098 (locale-prefixed public blog paths); PRD §9.2 (no chain longer than one hop)

## Context

`seo_distribution` resolves a public redirect with two strategies. Strategy 1 is the retirement rewrite for the `/news/**` family: ADR-0071 removed those four routes from this repo and 301s the whole family to `/blog/{tenantCode}/**`, because the URLs were live and advertised in sitemaps this repo published. Strategy 2 is tenant-authored exact-path rules from `awcms_seo_redirects`, resolved through the bounded chain walker.

`resolvePublicRedirect` ran strategy 1 first and returned on its hit.

For every path outside `/news/**` that order is unobservable — `parseRetiredNewsPath` returns `null`, and strategy 2 answers. Inside `/news/**` it decided everything, and it decided it wrong.

### What the order cost, concretely

Issue #599 migrates 23,906 indexed articles whose legacy URLs are shaped `/news/{id_ber}_{slug}.html`. The pipeline built for it works: `sql/138` stores provenance, `blog:legacy:import` writes it, and `blog:legacy:redirects:import` derives one exact rule per published article, checks that no rule chains, and carries ADR-0098's locale prefix so the hop is the last one.

`isRedirectEligiblePath` accepts `/news/**`, so those rules were written and sat in the table looking correct.

Not one of them could ever fire. `parseRetiredNewsPath` claims every path in the family, so strategy 1 answered first — and what it answered was a 301 to `/blog/{tenantCode}/{id_ber}_{slug}.html`, a path no post has, because the legacy id and the `.html` suffix are part of the _legacy_ shape and not of any slug.

Every one of 23,906 URLs would have redirected into a 404. That is the exact outcome #599's Definition of Done exists to forbid, produced by the code written to satisfy it, with a redirect table that read as though the migration had worked.

### Why nothing caught it

The precedence existed only as the order of two `await`s inside a `try` block. That shape is unreachable without a database, so no test addressed it, and the two strategies are owned by different concerns — one by the route retirement, one by tenant authoring — so neither module's own tests had reason to look at the other. `tests/retired-news-redirect.test.ts` and `tests/legacy-redirect-map.test.ts` both passed throughout, because each was right about its own half.

## Decision

**A tenant-authored exact-path rule is resolved BEFORE the retired-`/news` family rewrite. The rewrite becomes the fallback for paths no rule claims.**

Most specific wins. A tenant rule names one path and was written on purpose; the family rewrite is a blanket prefix substitution standing in for routes that no longer exist. When both claim a path, the deliberate instruction is the right answer — the same precedence any router applies to a literal segment over a wildcard.

The rewrite is not weakened. For the URLs it was built for — this repo's own removed `/news/**` routes, which no tenant has authored a rule for — nothing changes: strategy 2 finds no rule, and strategy 1 answers exactly as before.

### The decision is a value, not an order of statements

`domain/redirect-precedence.ts` holds `chooseRedirectOutcome`, a pure function. This is the load-bearing half of the ADR, not tidying: a rule expressed as statement order is a rule that cannot be tested without standing up a database, and the reason this defect survived is precisely that nobody could write the cheap test. As a function it is unit-tested in both directions, and `tests/redirect-precedence.test.ts` additionally asserts against the service source that the function is actually called and that no early `return retired` has crept back above it.

### The fallback returns strategy 2's own `passthrough`

Not a fresh one. That value carries the 404-capture context feeding not-found telemetry; substituting an empty one would silently retire `/news`-family 404 observation, which surfaces later as an empty dashboard nobody can put a date on.

## Consequences

- A tenant can now intercept a path in the retired family by authoring a rule for it. That is the point, and it is bounded by `isRedirectEligiblePath` (no admin/API/auth/asset/discovery path is reachable) and by `assertSafeRedirectTarget` on both write and resolve.
- One extra transaction on `/news/**` requests that fall through to the rewrite. Requests that a tenant rule answers now do _fewer_ round trips than before, because the retired handler is no longer consulted first — it opened its own transaction to discover it had nothing to say.
- `blog:legacy:cutover:verify` (Issue #599 item 4) applies this same precedence when it predicts what a crawler will see. A verifier that modelled the old order would have reported the archive clean while production sent every URL to a 404.

## Alternatives considered

**Keep the order; have the retired handler check for an exact rule and stand aside.** Behaviourally identical on every path, and it was the tempting minimal diff. Rejected because it states the rule backwards: it reads as "the family rewrite decides, with exceptions", when the truth is that a specific instruction outranks a general one. It also leaves the precedence distributed across two files instead of named in one.

**Exclude `/news/**` paths that do not match this repo's former route shapes.** Rejected as unmaintainable guesswork — the shapes belong to the system being migrated _from_, and a new archive brings new ones, so the rule would need editing per migration and would fail silently when it was not.

**Report the collision from the verifier and change nothing.** Rejected: the verifier would correctly report all 23,906 URLs as broken, and the only available fix would still be this one.
