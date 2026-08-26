---
"awcms": minor
---

fix(blog): the legacy importer produced 25,029 articles that the repo which SERVES them builds no page for (#599, #711)

`importLegacyBlogPost` wrote `content_json` as a hard-coded `{ blocks: [] }`,
under a docblock claiming it was "the same lossy projection every other write
path produces". It was not: `blog-post-directory.ts` and `blog-page-directory.ts`
both call `withProjectedBlocks`, and this file called nothing. **A comment is not
a call.**

That single literal decides two things in `ahliweb/awcms-astro`, the repo that
renders this archive. `renderContentBlocks` reads `contentJson.blocks` and
returns `""` for an empty array — every imported article a blank page. And
`getArticles` keeps a post only when `readBlock(post).kategori === tab`, reading
`contentJson.awcmsAstro` — with no such key, **no article page is built at all**,
and no category archive either, because those are assembled from the same
tab-filtered set.

Measured against that repo's real adapter: a post carrying the sidecar builds 1
article; a post written as this importer wrote it builds **0**, in every
configured tab. So ADR-0113's 63 rubrik rules and ADR-0114's id-keyed article map
would each have redirected onto a page that was never generated — the one outcome
both issues' Definition of Done forbids. No gate here could see it, because
`/blog/{code}/{slug}` renders from `body_portable_text` and looks perfect.

**What changed**

- `content_json.blocks` is now the derived projection, and
  `content_json.awcmsAstro.kategori` carries the section, supplied by a new
  `blog:legacy:import --section-map=<path>`. A missing map WARNS (a tenant this
  repo serves needs no sidecar); a row that map cannot place is REFUSED.
- **ADR-0115** — the migrated archive lands on ONE origin. ADR-0114 left the
  id→path table's destination unstated while the repo's only article derivation
  hard-coded `/blog/{tenantCode}/{slug}`, so the two committed halves of one
  cutover pointed at two different origins. Both now land on `awcms-astro` at
  `/{section}/{slug}/`.
- `bun run blog:legacy:article-paths` — ADR-0114's missing id→path artefact,
  derived from the tenant with provenance, preview by default, refusing to emit
  while any row lacks a section. `--default-locale` is required rather than
  defaulted: the consuming site serves its default locale unprefixed and this
  repo's `withPublicLocalePrefix` prefixes every locale, and all 25,029 articles
  are in the default locale.
- `bun run blog:legacy:edge:verify` — the HTTP-level verifier
  `blog:legacy:cutover:verify`'s own docstring says is "a different tool, and this
  is not it". It requests each legacy URL with `redirect: "manual"`, counts the
  hops a reader actually takes, and reuses `classifyCutoverOutcome`. It is the
  replay that falsified ADR-0113, made repeatable — an operator command, not a
  CI gate: it only means anything once the edge is wired.
- `listLegacyRedirectMappings` now applies the serving route's full predicate. It
  promised "only PUBLISHED, non-deleted posts: a redirect pointing at a draft
  sends a search engine to a 404" over exactly those two conditions, while the
  route requires four — so a `private` post and a future-dated one each got a rule
  whose destination 404s.
- New `unreachable` verdict. A DNS failure, a refused connection, a timeout and a
  502 all arrive with zero hops, and `hops === 0` was the only thing `no_rule`
  read — whose reason text was the confident "this URL will answer 404 after
  cutover, and its ranking is lost". That reason text is rewritten too: run
  against a real built server, a legacy URL answering **200** with no redirect
  got the same sentence.

**An adversarial review found three real defects in the above, all now fixed and
gated.**

- **The edge verifier followed a hostile `Location` anywhere.** `probeUrlFor`
  screened the CORPUS to `http:`/`https:` and the walker then dropped that
  decision for every hop it actually issued: `file:///etc/hostname` and
  `data:text/plain,hi` were both resolved and recorded as a 200, a redirect to a
  loopback port reached the server listening on it, and all of them classified
  **`ok`**. `hopRefusalFor` now runs before every request — the first one
  included, because a corpus file can carry a `file://` line as easily as a
  hostile origin can — refusing non-HTTP schemes and credentialed URLs outright
  and private/loopback/link-local literals unless `--allow-private` is passed.
  New verdict `unsafe_redirect`, which OUTRANKS `loop` and `chain_too_long`
  because a hostile origin can produce either. It reuses `isBlockedAddress` from
  `ssrf-guard.ts` rather than restating the rule; `validateOutboundUrl` could not
  be used as-is because it refuses `http:`, which is the shape a crawler holds,
  and `ssrfSafeFetch` follows redirects internally, which destroys the hop-by-hop
  visibility this job exists to produce. Not resolving hostnames is a stated
  boundary, not an omission.
- **`buildArticlePaths` validated two of the three segments it builds.** The
  locale was interpolated raw under a comment reading "Both halves become URL
  segments, and both are checked" — a comment asserting a binding no call makes,
  in a file added to fix an instance of exactly that. `awcms_blog_posts.locale`
  has no CHECK constraint, so that line was the only thing between it and a path.
- **The symbol correction broke itself.** The `validateLegacyPostImportRecord` →
  `parseLegacyImportRecord` fix was applied as a blanket rename across all four
  files, including the one occurrence that had to stay wrong for the sentence to
  mean anything — leaving both PROJECT_STATE copies asserting that the CORRECT
  name does not exist. A search-and-replace over prose does not know which
  occurrences are the quotation and which are the claim.

**A second review pass found four more, three of them in the fixes above.**

- **The SSRF guard let every IPv6 literal through.** `new URL("http://[::1]/").hostname`
  keeps the BRACKETS, and `node:net`'s `isIP("[::1]")` answers 0 — so the
  reachability test in front of `isBlockedAddress` short-circuited to "allowed"
  and the rule the module says it reuses was never consulted. `[::1]`,
  `[fd00::1]` and `[::ffff:127.0.0.1]` were all fetched with the guard ON, the
  last being a one-token bypass of the `127.0.0.1` case the tests did cover.
  Brackets are stripped before both calls now — and not passed through, because
  `isBlockedAddress` fails closed on a non-literal and would have refused every
  PUBLIC IPv6 host too.
- **Three CLI properties were gated by nothing**, each with the DB-free suite
  green: `process.exitCode = 1` deletable from `usage()` in both new scripts;
  `signal: AbortSignal.timeout(...)` deletable from the probe's fetch, making
  `--timeout` a flag that parses and does nothing; and the artefact generator's
  refusal-to-emit — ADR-0115's headline consequence — deletable, because nothing
  invoked `main()`. `tests/blog-legacy-cutover-cli-contracts.test.ts` spawns the
  real processes for the first two, and the third is proven against a real
  Postgres.
- **The timeout assertion's first form proved nothing.** Deleting the signal
  still finished the run — in 12.04s rather than 1.54s, on Bun's own ~10s idle
  timeout — so a 20s ceiling passed the mutation. The window now sits between
  the two measurements.

Also from the review: the two hand-written verdict arrays in
`tests/cutover-verification.test.ts` listed seven members where the union had
eight, so they claimed a completeness they no longer had. They are now DERIVED
from `CUTOVER_VERDICT_REASON`'s keys — which `Record<CutoverVerdict, string>`
makes exhaustive by construction — and that change immediately earned itself by
going red when `unsafe_redirect` was added.

Nine mutations were applied and run rather than reasoned about. The one worth
recording: leave the envelope builder correct and exported and change only the
INSERT so it stops calling it — the DB-free suite is 13 pass / 0 fail, green over
a builder nothing calls, which is exactly the state that shipped, while the
integration test goes red on the column it reads back out of Postgres.

ADR-0114 and both PROJECT_STATE copies named the slug validator
`validateLegacyPostImportRecord`, which does not exist (it is
`parseLegacyImportRecord`) — in the paragraph that says "name that symbol
precisely, because the wrong name sends an agent to the wrong file". Corrected in
all four.

This repo still cannot close the cutover: the ten destination categories,
~25,031 media uploads, the edge wiring and an `awcms-astro` rebuild remain
operational steps outside both repositories.
