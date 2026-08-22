---
"awcms": patch
---

chore(api): navigation menus and widgets join the frozen consumer contract (ADR-0105)

Issue #597 item 6: menus and widgets have been configurable since Issue #542,
with an admin screen for both, and nothing has ever rendered either of them.
Issue #652 cleared the first obstacle by giving both list responses an actual
schema. What was left was a decision, and the interesting part is not "read the
menus".

**The obvious move is refused.** Replacing `siteConfig.tabs` with a CMS menu
looks like exactly what the issue asks for, and it only fails in the second
language: the tab bar renders its labels through the PO catalogue, and that
repo's own comment records that an earlier hard-coded version made the site's
main navigation "the one piece of interface that never translated — in a
template whose whole point is being multilingual". An `awcms` menu item carries
**one** label; there is no per-locale label anywhere in the schema. So a
CMS-driven primary navigation would reintroduce that exact defect through a
feature — and tabs also decide the route structure, the section ordering and an
article's section, none of which a list of links carries.

So the tab bar stays and the CMS menu renders as a secondary region, with
widgets in their declared positions. Both additive: a tenant that configures
neither gets the site it has today.

The rest of ADR-0105 is about what a menu item resolves to. `url` is used as
given; `post` resolves through the feed the build already holds; **`page` is
dropped with a warning naming the item**, because this consumer has no page
concept — a published dead link is a reader's problem, while a warning reaches
the editor who can fix it. `bodyText` is escaped, because the write path refuses
markup and granting it at render time would make that refusal decorative.

Written down rather than worked around: **menu labels are not localisable**. A
per-locale label is a migration, an admin-screen change and a write-path change,
and it should not be smuggled into the change that first renders a menu.

Both paths enter `COMMITTED_PATHS`, not `CONSUMED_PATHS` — nothing calls them
yet.
