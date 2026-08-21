---
"awcms": patch
---

chore(api): the tenant's vocabulary joins the frozen consumer contract (ADR-0104)

`ahliweb/awcms-astro` has no category archive and no tag archive — Issue #597
item 1. Two changes this month made one buildable: the feed now carries
`termIds` (#649) and the term list can now be walked to the end (#647). What was
left was the decision about what the consumer reads and who owns what.

ADR-0104 records it, and the parts worth arguing about are:

- **The surface is the existing admin `GET /api/v1/blog/terms`, not a new
  anonymous one.** ADR-0102's posture: "public read" means the BUILDER of the
  public site can read it. The consequence is stated in the ADR rather than
  discovered in a build log — the build credential's role needs
  `blog_content.taxonomies.read`, the same permission-seed gap
  `site_profile.profile.read` hit.
- **The contract freezes the `?order=created_at` traversal, never the default
  alphabetical list.** Freezing the list would make "returns some of the terms"
  the guaranteed behaviour.
- **The archive URL shape belongs to the consumer.** `awcms` serves its own at
  `/blog/{tenantCode}/category/{slug}` and gains no per-tenant archive-URL
  template: that would put the decision in the repo that does not serve the
  page, and the first disagreement would break links from the side that cannot
  see them.

`/api/v1/blog/terms` is added to `COMMITTED_PATHS`, not `CONSUMED_PATHS` — the
call is not real yet. It moves when `awcms-astro` makes it, which is the order
that repo's Definition of Done requires and the only thing that keeps the
promised/consumed distinction from decaying into a label.
