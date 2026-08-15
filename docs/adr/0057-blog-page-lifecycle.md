🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0057-blog-page-lifecycle.id.md)

# ADR-0057 — `blog_content` page lifecycle: the page that could never be published

- **Status:** Accepted
- **Date:** 2026-08-02
- **Decision maker:** @ahliweb
- **Related:** [ADR-0051](0051-admin-screens-consolidated-in-awcms.md) (every admin screen is built here), [ADR-0056](0056-media-library-admin-surface.md) (precedent: surface first, screen later), [ADR-0044](0044-merge-news-portal-into-blog-content.md) (`blog_content` absorbs `news_portal`; the admin screen is named as the largest remaining work)

## Context

[ADR-0044](0044-merge-news-portal-into-blog-content.md) closes with the sentence
that the `blog_content` admin screens "land one issue per screen". `/admin/blog`
(#340) took the post lifecycle — eleven of 43 permissions — and the
module descriptor records five sibling screens to follow: **pages**, taxonomy,
presentation, settings, homepage composition.

Auditing the `pages.*` surface before writing that screen found the same thing
ADR-0056 found on `media_library`, and sharper.

### 1. Four of the eight `pages.*` permissions are gated by nothing

`sql/036` seeds eight `pages.*` permissions into the global catalogue, and the
descriptor declares all eight. Four have real enforcers:

| Permission     | Enforcer                                                     |
| -------------- | ------------------------------------------------------------ |
| `pages.read`   | `GET /api/v1/blog/pages`, `/{id}`, `/{id}/quality-checklist` |
| `pages.create` | `POST /api/v1/blog/pages`                                    |
| `pages.update` | `PATCH /api/v1/blog/pages/{id}`                              |
| `pages.delete` | `DELETE /api/v1/blog/pages/{id}`                             |

**Four have none at all:** `pages.publish`, `pages.archive`,
`pages.restore`, `pages.purge`. There is no route, no application function,
no job that checks them. All four are granted to the `owner` role of every new
tenant and no code path reads them.

### 2. The hole is deeper than the routes — the application layer does not have it either

On `media_library` three lifecycle functions were already written and merely not
called. Here the functions **do not exist**. `application/blog-page-directory.ts`
exports `createBlogPage`, `fetchBlogPageById`, `listBlogPages`,
`listBlogPagesForAdmin`, `updateBlogPage`, and `softDeleteBlogPage` — that is all.
The file's own header records why:

> Pages get plain CRUD only (no publish/schedule/archive/restore/purge lifecycle
> actions … those permissions are already seeded (#537) for a future issue to
> wire up, not this one).

That follow-up issue never came. What is left behind is a permission catalogue
promising a lifecycle and code that has not a single one of its
steps.

### 3. The consequence: every page is permanently `draft`, and the public page is permanently empty

This is the part that turns the finding from "idle permissions" into a
functional defect, and it can be proven from three lines of code:

- `createBlogPage` writes `status` as the literal `'draft'`;
- `updateBlogPage` touches neither `status` nor `published_at`, and
  `UpdateBlogPageInput` has no field for them;
- `blog-scheduled-publish.ts` only touches `awcms_blog_posts`.

There is no other writer of `awcms_blog_pages.status` in the whole repo. **A
page therefore can never leave `draft`.**

The consequence is already live on the public surface today:
`blog-search.ts` filters the page branch with
`status = 'published' AND visibility = 'public' AND published_at IS NOT NULL`,
so **public search results for pages are always zero rows**, no matter how
many pages a tenant creates. `sql/035` even builds the index
`awcms_blog_pages_tenant_status_published_idx` on `(tenant_id, status,
published_at DESC)` — an index for a published-content query that can never
return anything.

### 4. No gate catches this class of defect

`tests/admin-navigation-registry.test.ts` catches navigation entries whose
path has no page. `tests/admin-*-page-contract.test.ts` bind page keys
to what the routes enforce. Not one of them asks **"does every
seeded permission have an enforcer"** — a question that, had it been asked, would
have reddened `media_library` (five) and `blog_content` (four) at once, long
before either became a manual audit finding.

## Decision

### A. Pages get a lifecycle, not a revocation

Those four ungated permissions are **given a surface**, not revoked.
The reason is not symmetry with posts but that the alternative decides
something nobody meant to decide: revoking `pages.publish`
means declaring that pages really are drafts forever — that is, blessing defect
number 3 as design, while the index, the columns, the CHECK constraint, and the
public search filter were all written on the opposite assumption.

This is the inverse of ADR-0056 §A's ruling for `attach`/`detach`, and the
difference is meaningful: attach/detach are obsolete because another ADR moved
their ownership somewhere else that works. There is no other place that
publishes a page.

### B. Its lifecycle is narrower than posts': no `scheduled`, no `review`

Posts have five statuses and a `posts.schedule` permission of their own. Pages
**have no `pages.schedule`** — and that is a decision `sql/036` already made, not
an oversight that needs patching. The transitions allowed for pages:

```
draft ──────► published ──────► archived
  ▲               │                 │
  └───────────────┴─────────────────┘
```

`review` and `scheduled` are **not** used for pages, even though the CHECK
`awcms_blog_pages_status_check` accepts them (that column was created identical
to posts' in `sql/035`). The transition rules live in `domain/`, separate from
posts' `ALLOWED_STATUS_TRANSITIONS`, because the two now **really are** different
rules — sharing them means one table that is correct for one caller and
too loose for the other.

The substantive reason: a page is structural site content (about, contact,
privacy policy). The "submit for review" editorial flow and scheduled publishing
are newsroom needs, and `blog_content` already has both in the right place —
on posts. Copying both onto pages means
adding two permissions that must be seeded, gated, and navigated for a workflow
nobody has asked for.

### C. Page `purge` uses the same precondition as posts

`canPurgePost` demands the row already be soft-deleted **or** have status
`archived` — "purge is forbidden for published content unless archived or soft
deleted first". That rule applies to pages unchanged, and is reused instead of
being rewritten.

**Dangling ad placement references do NOT block purge**, and that is not
leniency but the contract this module has already set.
`awcms_news_portal_ad_placements` targets a page through the pair
`target_type = 'page'` and a polymorphic `target_id` which, because no FK can
reach three tables, is only checked **at write time** by
`application/ad-placement-reference-validation.ts`. That file's header already
decided what it means when the target disappears later:

> A target deleted LATER is not an error and never becomes one. The render
> query joins nothing on `target_id`, so the ad simply stops matching —
> degrade, don't error.

And it is true right down to the query: `listActiveAdPlacementsForRendering`
matches `p.target_id = ${targetId}` against the id of the **page being
rendered**. A purged page is never rendered, so its placements are never
matched — they become inert, not broken. Soft delete, which exists today
and is gated by nothing in this respect, has **exactly the same** render effect.
Purge therefore introduces no new failure mode.

> **Correction to the first draft of this ADR.** That draft decided purge would
> **refuse with a 409** as long as an ad placement targeted the page.
> That is wrong, and the wrongness is not a matter of taste: it refuses an
> operation in order to prevent a condition this module has already declared
> harmless, and it would leave an operator blocked from deleting a page by an ad
> that had stopped showing anyway. Found by reading
> `ad-placement-reference-validation.ts` and its render query, not by reasoning
> from the shape of the schema — the same lesson §4 records about scanning
> routes only.

What purge **must** do is make that change visible: its response carries the
number of ad placements now targeting a page that no longer exists. A row that
silently becomes inert is exactly the "disappearing without a record" that
ADR-0044 §4 rejected for ads that could not be migrated. Report, don't
refuse — the operator sees the consequence without being blocked by it.

### D. Zero migrations

There is no migration in this change, and that is not lucky coincidence but a
consequence of the shape of the defect:

- the eight permissions are already seeded (`sql/036`) — nothing is added or
  revoked;
- `awcms_blog_pages` already has `status`, `published_at`, `scheduled_at`,
  `deleted_at`/`deleted_by`/`delete_reason`, `restored_at`/`restored_by`, and
  `version` (`sql/035`);
- the required CHECK and indexes already exist.

What has been missing all along is purely the application and route layer. A
migration here would in fact be a sign that something was misread.

### E. Order: surface first, screen later

Following ADR-0056 exactly:

1. **This ADR.**
2. **The surface** — `transitionBlogPageStatus`, `restoreBlogPage`,
   `purgeBlogPage` in `blog-page-directory.ts`, plus
   `POST /api/v1/blog/pages/{id}/publish`, `/archive`, `/restore`, `/purge`,
   guarded, audited, carrying an `Idempotency-Key`, with OpenAPI in sync.
3. **The screen** `/admin/blog/pages` driving **all eight** permissions, with the
   `navigation` entry landing in the same PR and a mutation-proven per-page
   contract test.

The screen does not precede the surface. A console that can create and edit pages
but can never publish them is a dead end that looks like a feature.

### F. A gate for the class of defect, not just for its instance

Two modules have now shipped seeded permissions with no enforcer, and both were
found only because someone was about to build their screen. The surface change
(step 2) brings with it a gate that is **not** specific to `blog_content`:
every permission declared by **any** module descriptor must have an
`authorizeInTransaction` call site, or be listed as a reasoned exception.
It runs as part of `bun run check` and does not touch the
database — its questions can be answered entirely from the module registry and
the `src/` sources.

Two known exceptions that will be listed from the outset, both already recorded
in `/admin/blog`:

- `blog_content.posts.export` — declared and seeded, with no endpoint
  anywhere enforcing it (a revocation candidate, its own ADR);
- gates that live inside an application function instead of a route file
  (`media.verify` in `media-finalize-upload-session.ts`) — not an exception
  but the reason the gate must scan all of `src/`, not just `src/pages/api/`.

## Consequences

- **No authorization change.** The catalogue does not move; four permissions
  that have gone unchecked start being checked. Tenants that already hold them
  gain the capability their role has been promising all along.
- **A user-visible behaviour change:** pages can be published. Public
  search results for pages stop being always-empty, and `seo_facts`/sitemap
  consumers will start seeing published pages — which is correct, and which must
  be called `minor` in the changeset, not `patch`.
- **`purge` reports, it does not refuse.** Its response carries the number of ad
  placements now targeting a page that no longer exists — a new field that must
  be in OpenAPI. There is no new error code for that case, and that is exactly
  the decision.
- **Four sibling screens remain** after this one (taxonomy, presentation,
  settings, homepage composition). As far as this audit goes, all four surfaces
  are complete — all of them `read`/`configure` pairs that have routes. The §F
  gate will turn "as far as this audit goes" into a guarded claim.

## Rejected alternatives

- **Build the CRUD screen now, lifecycle later.** Fastest, and it
  ships a console where every button works except the only one that
  makes a page useful. It also leaves four permissions idle
  in the catalogue — the raw material of the latent-authz defect this repo has
  already shipped twice.
- **Revoke all four permissions, declare pages CRUD-only.** Tidy and wrong, in
  an expensive way: it blesses permanently empty public page search
  as design, and throws away the columns, CHECK, and index `sql/035` already
  paid for.
- **Give pages the full post lifecycle (review + scheduled).** That means
  adding two new permissions for a workflow nobody has asked for, and
  dragging `blog-scheduled-publish.ts` onto a second resource for the sake of
  scheduled publishing of the "about us" page.
- **Have purge also delete ad placements targeting the page.** Deleting rows
  owned by another surface as a side effect — ownership that ADR-0044 has just
  tidied up, and exactly the silent deletion ADR-0044 §4 forbids for
  ads that cannot be migrated.
- **Have purge refuse (409) while an ad placement targets that page.** This was
  this ADR's first-draft ruling, and it was rejected after reading the code
  rather than reasoning from the schema: `ad-placement-reference-validation.ts`
  already states that a target lost later "is not an error and never becomes
  one", the render query never matches placements belonging to an unrendered
  page, and soft delete — which exists and is gated by nothing — has exactly the
  same effect. Refusing means blocking an operator in order to prevent a
  condition that damages nothing.
- **Have purge say nothing about placements that go inert.** Technically safe
  and operationally bad: an ad slot stops being filled without a single
  trace connecting it to a page deleted three weeks ago.
