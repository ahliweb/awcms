---
"awcms": patch
---

fix(blog-content): booking an ad, rearranging the front page and renaming a category now reach the reader (#628)

Issue #623 derived the real population of the ADR-0042 §Rule 21 obligation —
every mutating API route owned by a module that owns a cacheable surface — and
found twenty-eight handlers whose answer nobody had decided. It fixed five and
left the rest on a shrink-only ledger rather than burying a bug fix under
twenty-eight more.

That ledger is now **empty**. Eleven handlers were real staleness and purge;
twenty carry a reason a reader can check.

### The eleven

- **Ad placements** (create/update/delete). Since #621 ad slots render on five
  public routes. A booked placement that does not appear until TTL is impressions
  an advertiser paid for and did not get; a withdrawn one still being served is a
  campaign running past its end date.
- **Homepage sections** (create/update/delete). Since #619 `/blog/{code}` renders
  `composeHomepage`. An editor rearranging the front page while the edge serves
  the old arrangement is the arrangement not having happened.
- **Terms** (create/update/delete). The category and tag archives resolve through
  `fetchPublicTermBySlug`, and a deleted category kept answering 200 from cache.
- **Blog settings.** `rssEnabled`/`sitemapEnabled` decide whether `feed.xml` and
  `sitemap-blog.xml` answer **at all**, and both are the `blog-discovery` surface.
- **Internal tag-link settings.** Applied at render time to every published
  article's body, so changing the policy rewrites pages already cached.

### The twenty, and why an exemption is now checkable

Thirteen are exempt because nothing public renders what they write — menus,
widgets, templates, the blog theme row, institutions (#614 stores them and no
reader shows them), and the legacy ad tables that `composeAdSlots` does not read.

That reason used to be the kind that goes stale in silence. It no longer can: the
suite walks the **transitive import closure** of every file under
`src/pages/blog/` and fails if any of those directories becomes reachable. The
day a public surface starts rendering a menu, the exemption that says nothing
does turns red.

Seven are `seo_distribution` handlers. `buildRobotsPayload`,
`buildSitemapPagePayload` and `buildFeedPayload` are the only producers of the
three `seo-*` surfaces and none of them reads a redirect or a not-found record.

**One residual risk is stated rather than hidden:** a redirect whose *source*
path is itself a cacheable surface stays inert until that object's TTL, because
Varnish answers a cached hit without reaching the middleware. A purge here cannot
fix it — `enqueueModuleContentPurge` bans a MODULE scope, the stale object is
tagged `m:blog_content`, and an `m:seo_distribution` ban matches nothing.
Expressing it needs a path-scoped ban, a different mechanism. The common case is
already covered from the other side: a slug change purges through the post's own
PATCH before `capture-url-change` records the redirect.

Proven by removing one purge and watching both the enumerated count and the
derived population go red.
