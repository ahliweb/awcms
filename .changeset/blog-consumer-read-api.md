---
"awcms": minor
---

feat(blog-content): a build client can read the homepage, the ad inventory and the static pages

Four read endpoints close the last half of #594: `awcms-astro` renders its own
templates, and until now it had no way to ask this repo what belongs on them.

- `GET /api/v1/news-portal/homepage-sections/composed` — the RESOLVED homepage,
  not its configuration. A consumer resolving the configuration itself would
  re-implement the publication predicate in a second repository on a second
  deploy cadence, and the first disagreement is a draft article on somebody's
  front page.
- `GET /api/v1/news-portal/ad-placements/active` — every slot's runnable
  creatives, already rotated and capped. All twelve slots, including the three
  this repo's own templates do not draw: the sidebar exists in the consuming
  front end, and an endpoint shaped around what this repo renders would withhold
  the inventory a consumer exists to show. An invalid or unpaired `targetType`
  is refused rather than falling back to `global`, because silently widening an
  ad query is how a placement booked against one article appears on all of them.
- `GET /api/v1/blog/pages/public` and `/{slug}` — the pages a reader can
  actually reach, sharing their predicates with `sitemap-blog.xml` and with
  `/blog/{tenantCode}/pages/{slug}` respectively. Deliberately not
  `/api/v1/blog/pages?status=published`: the admin list is an editor's view and
  returns private and unlisted pages too, so a consumer reaching for it would
  publish every private page the newsroom has with nothing reporting an error.
  The detail ships the body as both `contentJson` and the canonical
  `bodyPortableText`, which is what lets a consumer move to the canonical shape
  on its own schedule.

All four are **guarded, not anonymous** — the same decision ADR-0102 made for
`GET /api/v1/site-profile/composed`: "public read" means the public site's
builder can read it. A curated homepage names the articles an editor considers
most important before they are on any page, and there is no reason to hand that
to callers who are not building the site. A test pins that none of the four ever
appears in `ALLOWED_PUBLIC_OPERATIONS`.

No permission and no migration.

Closes the awcms half of #594.
