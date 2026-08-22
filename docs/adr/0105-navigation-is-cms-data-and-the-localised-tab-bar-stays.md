🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0105-navigation-is-cms-data-and-the-localised-tab-bar-stays.id.md)

# ADR-0105 — Navigation and widgets are CMS data, and the localised tab bar stays

- **Status:** Accepted
- **Date:** 2026-08-22
- **Decision maker:** ahliweb
- **Related:** Issue #597 item 6; PRD LenteraKalteng §8.3, §8.4, §25; ADR-0104 (the taxonomy read, same shape); ADR-0102 (nothing anonymous; the refusal/failure split); ADR-0065 (the consumer contract); Issue #652

## Context

`blog_content` has held navigation menus and widgets since Issue #542: a menu with a stable `key`, a name, and a sorted item tree of `post`/`page`/`url` links; a widget with a position, a title, plain-text body, an active flag and a sort order. There is an admin screen for both.

**Nothing renders either of them.** `ahliweb/awcms-astro`'s navigation is `siteConfig.tabs` — a list written in that repo's source — and widgets appear nowhere at all. That is Issue #597 item 6, and it is the same shape as item 1 was: an editor configures something, the CMS stores it, and no reader ever sees it.

Issue #652 removed the first obstacle. Both list endpoints declared their payload as an array of bare `object`, which is not a wrong shape but **no** shape: nothing can fail against it, so freezing it in the consumer contract would have frozen a promise with no content.

What is left is a decision, and the interesting part of it is not "read the menus".

## Decision

**The build reads menus and widgets from the existing admin surfaces, renders them as ADDITIONAL regions, and does not replace the localised tab bar.**

### The tab bar is not the menu, and replacing it would be a regression

The obvious reading of item 6 is that `siteConfig.tabs` should become a CMS menu. It must not, for a reason that only shows up in the second language.

The tab bar renders its labels through the PO catalogue (`t(locale, tabTitleKey(tab), …)`). `src/config/site.ts` records why in its own comment: an earlier version rendered a hard-coded uppercase name, which made the site's main navigation _"the one piece of interface that never translated — in a template whose whole point is being multilingual."_

**An `awcms` menu item carries ONE label.** There is no per-locale label anywhere in the schema. So a CMS-driven main navigation would put the newsroom's primary interface back into a single language on a multilingual site — reintroducing, through a feature, exactly the defect that comment was written about.

The tabs are also load-bearing beyond labels: they define the route structure (`/[tab]/`), the section ordering (`urutanSeksi`, ADR-0033 there), and the section an article belongs to. A menu is a list of links; it is not any of that.

So: the tab bar stays, the CMS menu renders as a **secondary navigation region** (the footer, where a link list is ordinary and where no localised structure is being displaced), and widgets render in their declared positions. Both are additive, and a tenant that configures neither gets the site it has today.

### What a menu item resolves to, and what it does not

- **`url`** — used as given. `awcms` already refuses anything but an absolute http(s) URL at write time.
- **`post`** — resolved through the feed the build already holds: `targetId` is a post id, and the build knows that post's slug and section. No extra request.
- **`page`** — **dropped, with a warning naming the item.** `awcms` pages are a real resource there and `awcms-astro` has no page concept at all: there is no route a page id could resolve to. Rendering it as a dead link would be worse, and rendering nothing without saying so is how an editor concludes the menu is broken and re-adds the item.

A `post` target that resolves to nothing is dropped the same way. `awcms` deliberately does **not** check `targetId` against the posts table at write time — a menu may point at something not published yet — so an unresolvable target is a normal state on this surface, not an error, and the consumer must treat it as one.

### `bodyText` is escaped, always

A widget body is plain text. The write path REFUSES unsafe HTML rather than sanitizing it, which means the stored value has never been treated as markup by anything. A consumer that renders it as HTML would be introducing the trust the write path declined to grant. It is escaped and rendered as text.

### A refusal is not a failed build; a failure is

The same split as ADR-0102 and ADR-0104:

- **403 or 404** — the build credential lacks `blog_content.menus.read` / `blog_content.widgets.read`, or the instance is older than these surfaces. The build warns, naming the permission, and renders no secondary navigation and no widgets — which is the site as it stands today.
- **Anything else** throws.

The two permissions are read as one decision but requested separately, because a tenant may hold one and not the other and a build must not lose both because of one 403.

### The freeze order stands

`/api/v1/blog/menus` and `/api/v1/blog/widgets` enter `COMMITTED_PATHS` here and move to `CONSUMED_PATHS` when `awcms-astro` calls them, proved by that repo's own gate.

## Consequences

- **Positive:** a newsroom can add a footer link or a sidebar note without a frontend deploy — PRD §25's "no source edit" applied to navigation.
- **Positive:** the localised tab bar is untouched, so nothing about the multilingual surface regresses.
- **Negative / trade-off:** the site now has two navigations with different rules — one localised and structural, one editorial and single-language. That is honest but it is a thing to explain to an operator, and the admin screen does not say it.
- **Negative / trade-off:** **menu labels are not localisable.** On a multilingual site the secondary navigation appears in whatever language the editor typed. This is stated rather than worked around; a per-locale label would be a schema change to `awcms_blog_menu_items` and belongs in its own decision.
- **Negative / trade-off:** two more permissions on the build credential.
- **Neutral:** `page` link types are inert for this consumer. They remain valid for any consumer that has pages.

## Alternatives considered

- **Replacing `siteConfig.tabs` with a CMS menu.** Rejected — see above. It would un-translate the primary navigation and would not carry the route structure or section ordering that tabs also decide.
- **A per-locale label on `awcms_blog_menu_items`.** Not rejected on merit; deferred. It is a migration, an admin-screen change and a write-path change, and it should not be smuggled into the change that first renders a menu. Until it exists, the constraint is written down.
- **Rendering `page` links as dead links so the editor sees them.** Rejected: a published dead link is a reader's problem, and the editor is the one who can fix it. The warning goes where the person who can act on it is looking.
- **Rendering `bodyText` as HTML.** Rejected outright. The write path refuses markup; granting it at render time makes the refusal decorative.
