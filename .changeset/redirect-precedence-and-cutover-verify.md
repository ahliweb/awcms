---
"awcms": minor
---

fix(seo-distribution): 23,906 legacy redirects were written, and not one of them could ever fire (#599)

Issue #599's pipeline was complete and correct in every part, and produced a redirect map that could not work. `blog:legacy:redirects:import` derives one exact rule per imported article, checks that none chains, and carries ADR-0098's locale prefix so the hop is the last one. `isRedirectEligiblePath` accepts `/news/**`, so all 23,906 rules were written and sat in the table looking right.

`resolvePublicRedirect` consulted the retired-`/news` family rewrite **first** and returned on its hit. That rewrite claims every `/news/**` path, so no tenant rule was ever read — and its answer was a 301 to `/blog/{tenantCode}/{legacyId}_{slug}.html`, a path no post has, because the legacy id and the `.html` suffix belong to the shape being migrated *from*.

Every one of those URLs would have redirected into a 404: the precise outcome #599's Definition of Done forbids, produced by the code written to satisfy it.

### Why no test failed

The precedence existed only as the order of two `await`s inside a `try` block — unreachable without a database, so nobody wrote the cheap test. The two strategies belong to different concerns, so neither module's suite had reason to look at the other, and both stayed green while being individually correct.

### [ADR-0111](../docs/adr/0111-a-tenants-exact-redirect-beats-a-retired-family-rewrite.md): most specific wins

A tenant-authored exact rule now resolves before the family rewrite, which becomes the fallback. Outside `/news/**` the change is unobservable — the retired handler returns `null` for every other path. For the URLs the rewrite was built for, nothing changes.

The decision moved into `domain/redirect-precedence.ts` as a pure function, which is the load-bearing half rather than tidying: a rule shaped as statement order is a rule nobody can test cheaply, and that is exactly how this survived. `tests/redirect-precedence.test.ts` covers both directions and asserts against the service source that the function is called and that no early `return retired` has crept back above it — all three of those wiring assertions fail when the old order is restored.

Requests answered by a tenant rule now do one *fewer* transaction, since the retired handler no longer opens one first to discover it has nothing to say.

### `blog:legacy:cutover:verify` — Issue #599 scope item 4

The other two jobs reason only about articles that were imported, so neither can see a legacy URL that was **not** — a deleted article, a paginated index, a tag page. Those produce no rule, and nobody finds out until a crawler does.

This one starts from the legacy site's own sitemap and reports, per URL: resolves in one hop to a live page; no rule (a 404 after cutover); a chain longer than one hop (PRD §9.2); a loop; or a 301 into a path this deployment does not serve. It drives the real resolution path — `resolveRedirectChain` with `findActiveRedirectByPath`, and `fetchPublicBlogPostBySlug` for liveness — rather than reimplementing it, and applies ADR-0111's precedence so its prediction matches what a crawler will actually get.

It writes nothing; there is no `--commit` because there is nothing to commit.

**A sitemap INDEX is refused rather than flattened.** Its `<loc>` entries are child sitemaps, so checking them as pages would verify that a handful of `.xml` files redirect and then report success having read no page URL at all. The same refusal covers an empty document, an oversized one, and any `<loc>` that is not an http(s) URL — an unusable entry is counted and named, never silently skipped.
