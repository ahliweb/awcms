---
"awcms": patch
---

fix(i18n,blog-content): v10.0.0 served the entire public blog as 404, and no test at any level had ever fetched the URL it broke

ADR-0098 moved the locale into the PATH and served the prefixed URL by rewriting
it back to the bare route. Shipped in v10.0.0, that meant `/blog/{tenant}` `307`d
to `/id/blog/{tenant}`, and `/id/blog/{tenant}` answered **404** — the index and
every article, plus a feed whose `<link>` elements all pointed at those 404s.
`/`, `/login` and `/search` were unaffected, which is why the site looked alive.

### The mechanism, measured rather than reasoned about

A rewrite whose TARGET is a parameterised route resolves the route and computes
its params correctly and then never executes it; the catch-all answers instead.
Verified against the production image in an isolated container, on the same
route:

| rewrite target                              | reached directly | reached by rewrite |
| ------------------------------------------- | ---------------- | ------------------ |
| `/login`, `/search`, `/robots.txt` (static)  | 200              | 200                |
| `/blog/{tenant}/search` (parameterised)      | 200              | **404**            |

Every `/blog/{tenantCode}` surface is parameterised, so every one of them fell.
`context.rewrite()` re-runs middleware and loops (`307`); passing a `URL` or a
`Request` to `next()` changes nothing. There is no one-line spelling of the
original mechanism that works, which is why the mechanism changed and ADR-0098
was amended rather than re-argued.

(Deliberately not a markdown link. A changeset is validated by `check:docs`
while it sits in `.changeset/`, and then `changeset version` inlines it into
`CHANGELOG.md` at the repo ROOT — so `../docs/…` is broken in the first place
and `docs/…` is broken in the second. There is no relative spelling that is
correct in both, and the v10.0.0 release found that out the hard way: two
changesets carried `../docs/adr/…` and turned the release commit red.)

### What replaces it

Real routes at `src/pages/[locale]/blog/[tenantCode]/…` — five files that are
**registration only**: each re-exports the bare route's `GET` through
`localisedPublicRoute()`. ADR-0098's objection to a `[locale]` tree was
duplicated LOGIC, and re-export does not duplicate logic — a change to the bare
route is a change to the prefixed one by construction.

`localisedPublicRoute()` exists because `[locale]` is a dynamic segment, so
`/anything/blog/acme` matches the pattern too. Without the check a bogus prefix
would SERVE the tenant's content under an unbounded number of addresses, each
its own cache key. It 404s with the same generic response an unknown tenant
gets, so "no such locale" and "no such tenant" stay indistinguishable.

`src/middleware.ts` no longer rewrites. It still sets `locals.locale` from the
path, still resolves `seo_distribution` rules against the bare path, and still
`307`s a bare URL to its prefixed spelling. **The URL shape a reader sees is
unchanged** — this fix is invisible from outside the server.

### The coverage gap is the finding

Not one test, at any level, ever fetched a locale-prefixed public URL. ADR-0098
made the prefixed spelling canonical for every reader-facing blog surface and
the suite went on exercising only the bare ones, which redirect — so a fully
green CI was consistent with a fully 404 blog.

`tests/localised-public-routes.test.ts` derives the required prefixed routes
from the filesystem rather than a hand-written list, so a new prefixed surface
cannot be added without its route. It is mutation-proven against both real
defects: deleting a prefixed route and restoring the rewrite each turn it red,
and it is green again once restored. It also pins the converse — `feed.xml`,
`sitemap-blog.xml` and `search` must have NO prefixed twin, because a second
address for one inventory document is its own defect.
