🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0044-merge-news-portal-into-blog-content.id.md)

# ADR-0044 — Merge `news_portal` into `blog_content`: one content module, no feature loss

- Status: Accepted
- Date: 2026-07-28
- Related: ADR-0036 (media ownership inversion — the precedent this follows for
  NOT renaming tables when ownership moves), ADR-0009 (public
  `/blog/{tenantCode}` routes), ADR-0026 (modular OpenAPI ownership), ADR-0034
  (family direct-use templates), ADR-0035 (awcms absorbs the awcms-micro
  website cluster)

## Context

`news_portal` no longer carries its own weight, and the two modules now
duplicate a feature in a way that actively undermines a security control.

**`news_portal` is a thin shim over `blog_content`.** Measured at the time of
this decision:

|                       | `blog_content`                | `news_portal` |
| --------------------- | ----------------------------- | ------------- |
| Source files          | 59                            | 11            |
| Module version        | 0.9.0                         | 0.4.0         |
| Tenant tables         | 18                            | 3 (one inert) |
| Capabilities provided | `public_content`, `seo_facts` | none          |
| Public routes         | all of `/blog/{tenantCode}/*` | none          |

`news_portal`'s own descriptor records why: its host-resolved `/news/**` route
family, its two admin screens, and its module-preset activation path were all
dropped at port time. What survived is two features — the editorial homepage
section composer and R2-backed ad placements — plus
`awcms_news_portal_tenant_state`, a marker table the same descriptor documents
as having no writer. It is inert.

The module is also a _required_ consumer of `blog_content`'s `public_content`
capability: every homepage section type is built on `blog_content` data. The
capability seam exists to describe a relationship between two modules that
could plausibly vary independently. These two cannot.

**The duplication is not cosmetic.** Both modules ship an advertisement system,
and they store the image differently:

```
awcms_blog_ads.image_url                       text          -- any URL, unverified
awcms_news_portal_ad_placements.media_object_id uuid NOT NULL -- FK to a verified R2 object
```

`awcms_blog_ads` is exactly the unmanaged-media hole that `media_library` and
its per-tenant enforcement switch (ADR-0036) exist to close. Leaving both in
place means a tenant can have managed-media enforcement ON and still publish an
arbitrary remote image through the other table.

They are not, however, the same feature with two spellings. Each has a
capability the other lacks:

|              | `awcms_blog_ad_placements`                                     | `awcms_news_portal_ad_placements` |
| ------------ | -------------------------------------------------------------- | --------------------------------- |
| Image source | raw `image_url`                                                | verified `media_object_id` FK     |
| Targeting    | `placement_type` global/widget/**post**/**page** + `target_id` | —                                 |
| Slots        | —                                                              | 12 fixed `placement_key` values   |
| Rotation     | —                                                              | `rotation_mode` + `priority`      |

Replacing either one with the other silently deletes a capability. That is the
trap this ADR is written to avoid.

**Neither module has an admin screen.** Both descriptors deliberately declare no
`navigation`, because the port brought the API and the public routes but not the
authoring screens, and `tests/admin-navigation-registry.test.ts` fails on a menu
entry pointing at a 404. `src/pages/admin/` holds 14 screens; none of them is for
content, media, or advertising.

**The public frontend is moving out, into a named repo.** The public reading
experience is not built here. It lives in **`ahliweb/awcms-astro`** — a new
repo that is the reference implementation of the `awcms-astro` family template
(the fourth template alongside `awcms`, `awcms-mini`, and `awcms-micro`),
integrated with this one over `/api/v1`. Its design standard already exists and
is already running: `web-lalulintasmelayani.com` proved it in production —
six locales with no lame page, a JavaScript-free component set, a content audit
as a release gate — and carries the standard's own documents
(`docs/awcms-astro/`, its ADR-0012). `awcms-astro` inherits that standard and
adds the awcms integration.

`awcms`'s job on that axis is to be the **admin backend and the content API**,
not to grow a second public site. The existing hand-rendered
`/blog/{tenantCode}/*` routes stay exactly as they are — they remain a built-in
fallback surface, not the product.

## Decision

1. **`blog_content` is the single content module.** `news_portal` is retired as
   a module: removed from the registry, its descriptor deleted, its
   `domain/`+`application/` files relocated under `src/modules/blog-content/`.

2. **The merge is a union of features, never a reduction.** Every capability
   reachable through either module before this ADR is reachable after it. This
   is a constraint on the work, enforced by test, not an aspiration. Concretely
   preserved: homepage section composer (6 section types), ad placements,
   per-post/per-page ad targeting, 12 placement slots, 4 rotation modes,
   templates, hierarchical menus, position widgets, per-tenant theme override,
   redirects, internal tag linking, revisions, quality checklist, scheduling,
   translation groups, and blog settings.

3. **Table names do not change.** `awcms_news_portal_homepage_sections` and
   `awcms_news_portal_ad_placements` keep their names under new ownership. This
   follows ADR-0036, which moved the media registry into `media_library` and
   deliberately left `awcms_news_media_objects` named as it was: a rename buys
   nothing and costs every foreign key, policy, index, and grant that references
   it. Ownership is recorded in the module descriptor and the inventory, which
   is where a reader looks anyway.

4. **The two advertisement systems unify into the media-backed one, widened
   first.** `awcms_news_portal_ad_placements` gains the targeting columns
   (`target_type`, `target_id`) it lacks, so it can express everything
   `awcms_blog_ad_placements` could. Only then are `awcms_blog_ads` and
   `awcms_blog_ad_placements` migrated and dropped. Rows whose `image_url`
   cannot be ingested into `media_library` are **reported as residue by a
   dry-runnable migration job**, never dropped silently — an ad that vanishes
   from a live site with no record is worse than one that fails to migrate
   loudly.

5. **`awcms_news_portal_tenant_state` is dropped.** It has no writer, and
   managed-media enforcement is turned on per tenant by `media_library`'s own
   `POST /api/v1/media/enforcement` switch instead. Dropping an inert table is
   not a feature loss; keeping a FORCE-RLS table with no owner is a standing
   lie to the inventory gate.

6. **API paths are not renamed in the same change as the merge.**
   `/api/v1/news-portal/homepage-sections` and `/ad-placements` keep working
   under `blog_content` ownership. Consolidating them under `/api/v1/blog/*` is
   a separate, redirect-carrying decision; folding it into an ownership move
   would make one change that is impossible to review as either.

7. **Permissions are repointed, not re-seeded.** The four absorbed permissions
   (`homepage_sections`/`ad_placements` × `read`/`configure`) are already
   seeded under `news_portal` by `sql/044`/`sql/045`. `sql/076` inserts the
   `blog_content`-keyed rows, moves every existing grant onto them, and only
   then deletes the old rows — the exact ordering `sql/052` used for the media
   permissions under ADR-0036. Order is the whole point: a migration that
   seeded new rows without moving the grants would leave every existing tenant
   holding a grant on a row about to be deleted, revoking access with every
   gate still green. Because `awcms_role_permissions.permission_id` is a
   foreign key to `awcms_permissions(id)`, moving the grant IS the backfill —
   no separate backfill step exists or is needed.

## Consequences

**What gets better.** One module owns content. The capability seam between
`blog_content` and `news_portal` disappears along with the module, so
`public_content` becomes an internal call rather than a contract two modules
must agree on. There is exactly one advertisement system, and every ad image is
a verified media object — the enforcement switch stops having a bypass. The
module count drops by one without any endpoint disappearing.

**What this costs.** `awcms_blog_ads`/`awcms_blog_ad_placements` are dropped,
which is irreversible in-band; the migration must run its dry-run first and its
residue report must be read, not skipped. `blog_content` grows: it was already
the largest module, and it absorbs nine more files. That is the honest price of
the merge, and it is the reason the admin UI (below) is scoped as a screen at a
time rather than one change.

**What this does not decide.** The admin screens themselves. They are the
largest remaining piece of work and they land one issue per screen, each
returning its own `navigation` descriptor entry in the same change that adds the
page — the ordering `tests/admin-navigation-registry.test.ts` already enforces.
Nor does it decide the content-model extensions `ahliweb/awcms-astro` will need
(structured block types beyond the current six, `FAQPage` JSON-LD, the
locale-fallback resolver, and the domain validation rules that must move into
the quality checklist **before** any content migrates — a content model that
moves first spends a period where articles can be created with nothing guarding
them, and that period is never as short as planned). Those are downstream of
this merge, not part of it.

**What the counterpart repo owes this one.** `awcms-astro` consumes a contract
this repo must keep stable: the slug set is decided by the default locale and
paired through `translation_group_id` (never queried per locale, which would
produce a different page count per language and revive cross-language 404s),
`isFallback` is computed server-side, and only `status = 'published'` is ever
served to a build. That contract is written down in the consuming repo and is
the reason the merge above must not disturb `translation_group_id`,
`public_content`, or `seo_facts`.
