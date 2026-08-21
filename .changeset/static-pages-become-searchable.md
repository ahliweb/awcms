---
"awcms": patch
---

feat(blog-content): a reader can finally search for the Pedoman Media Siber (#625)

Static pages got a public route in #617 and a place in `sitemap-blog.xml`, and
stayed invisible to site search. The reason had quietly changed underneath: the
old one — "no public route, so an indexed page would produce a hit that 404s" —
stopped being true, and the real blocker became a GRANT.

`bun run site-search:reconcile` runs as `awcms_worker` and issues one `SELECT`
per registered descriptor. `sql/035` gave that role `SELECT, UPDATE` on
`awcms_blog_posts` and deliberately nothing on `awcms_blog_pages`, because at the
time nothing read them. Registering a descriptor without the grant would have
passed every gate in the repository — the registry check is pure and never opens
a database — and then failed at 03:00 with `permission denied for table
awcms_blog_pages`, in a job nobody is watching.

`sql/136` grants SELECT only. The index engine reads sources and writes solely to
its own `awcms_site_search_*` tables, and an unused UPDATE on the table holding
the Pedoman Media Siber is not a harmless extra. RLS still does the isolating —
the grant is the table privilege the FORCE-RLS policy then narrows, the same
two-layer posture the worker's existing post reads have.

### The predicate is the LISTING one

`visibility = 'public'`, matching `listPublicBlogPagesForSitemap` rather than the
detail route, which also serves `unlisted`. That tier means reachable by direct
link and absent from every listing — and a search result is a listing. Indexing
on the detail predicate would surface exactly the pages an editor marked as
not-to-be-listed.

`weight: 0.6`: someone searching a news site is usually looking for coverage, so
the disclaimer should not rank beside it. The weight scales the score rather than
capping it, so a page still wins when the query is genuinely about it.

### Pages are searchable, deliberately not commentable

A comment thread under a published editorial standard reads as qualifying it.
Recorded in `module.ts` so a future symmetry pass finds a decision rather than an
oversight; adding one later is a single descriptor.

### The gate

`site-search:sources:check` now derives the read privilege from the descriptors
themselves and checks it against `sql/`, reusing the scanner
`data-lifecycle:worker-grants:check` already uses for the retention engine
(`grantsPrivilegeToRole` moved into `sql-grants.ts` so there is one
implementation). Proven by removing the migration and watching it fail with the
exact message. It reads migration text, so it proves the grant was WRITTEN, not
applied.

**After deploying:** existing tenants have no page documents until
`bun run site-search:reconcile` runs. It is idempotent and picks them up on its
next pass; run it by hand for them sooner. No DML in the migration — the table is
FORCE RLS, and a migration that writes to one is green on an empty CI database
and breaks in production.
