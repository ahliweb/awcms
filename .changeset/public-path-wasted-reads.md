---
"awcms": patch
---

perf(blog-content): three round trips the request path paid for and threw away

Findings **B2**, **B3** and **B4** of the 17 August 2026 audit round. One PR
because they are one habit: a caller re-derives something the caller above it
already had.

**B2 — a read taken and discarded on every anonymous page view, and it was worse
than the finding said.** `isLegacyTenantRouteEnabled` went through the merged
settings reader, which also reads `awcms_blog_settings` and then throws that row
away. One wasted round trip on all seven `/blog/{tenantCode}/*` routes — 100% of
page views on a default deployment, where the edge cache is off.

**Two of the seven were paying for it twice.** `feed.xml.ts` and
`sitemap-blog.xml.ts` call `isLegacyTenantRouteEnabled` and then call
`fetchBlogSettings` themselves for `rssEnabled`/`sitemapEnabled` — so
`awcms_blog_settings` was read, discarded, and read again. The gate is now one
query; the merged reader still reads both, because it uses both, and a test pins
each so the saving cannot come from quietly dropping a field.

**B3 — the tenant id the route resolved and dropped.** All eight `/blog/*` routes
now publish `locals.edgeCacheTenantId`, so middleware stops repeating the
`awcms_tenants` lookup on every cache MISS. `discovery-route.ts:145` was the
working precedent.

Placement is the whole of it, and the test asserts placement rather than
behaviour: `publish-tenant.ts`'s standing rule is *resolve, gate, produce,
publish last*. A 404 is a cacheable status, so publishing before the
missing-resource branch would annotate a "no such post" 404 differently from an
"unknown tenant" 404 and answer, from one request, the question the routes'
generic-404 shape exists to withhold. Every `return notFound…` stays above the
publish; the one response that serves the resource is below it.

**B4 — a third transaction whose first read was a column nobody fetched.**
`AdminLayout` ran `SELECT tenant_name FROM awcms_tenants` on every `/admin/*`
render, against the row `readTenantDisplayDefaults` already had open one
transaction earlier for `default_locale`/`default_theme`. The name now rides
along on that primary-key read.

The layout's circuit-open shape check moved with it: it keyed on `tenantName`,
which is no longer in that block's return, so leaving it would have tested for a
field that is never there and silently skipped **every** assignment below it —
the sync indicator, the disabled-module set and the sidebar arrangement. It keys
on `syncActive` now, and a test pins that.

*Both B4 assertions failed on their first run by matching the corrective comment
explaining the removal rather than any code — finding D2 in miniature, caught by
the shared comment stripper D2 landed one PR earlier. They strip first now.*
