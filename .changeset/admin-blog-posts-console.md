---
"awcms": minor
---

Add the `/admin/blog` post lifecycle console and put `blog_content` in the admin sidebar.

`blog_content` is the largest module in this repo — 43 permissions across 15 activity codes and ~30 route files — and until now it had no screen at all. Under ADR-0051 the screens belong here; this is the first, and it covers the surface an editor uses every day.

The console lists posts with the module's own admin search/status filters and page-number pagination, and drives eleven permissions: `posts.read`/`create`/`update`/`publish`/`schedule`/`archive`/`delete`/`restore`/`purge` plus `revisions.read`/`restore`. Reads go through `listBlogPostsForAdmin` and `listBlogRevisions` inside one `withTenantOrThrow`, awaited sequentially; revisions are fetched only when `?post=` names one. Every mutation posts to the guarded endpoint.

Pagination is page-number rather than keyset, which is the opposite of `/admin/approvals` — deliberately. `listBlogPostsForAdmin` is LIMIT/OFFSET by design for a human-browsed table with "page 2, 3" controls, and its own header comment records that choice.

The other 32 permissions belong to sibling screens that are not in this change (pages, taxonomy, templates/menus/widgets, settings/seo/theme, internal links, homepage sections, ad placements). Two absences are different in kind, and `tests/admin-blog-page-contract.test.ts` asserts both rather than leaving them to look like gaps:

- **`posts.export` is declared and seeded by `sql/036`, and no endpoint anywhere enforces it.** The test proves this by scanning every route under `src/pages/api/v1/blog/`, so a future export endpoint fails it and forces the screen question to be answered instead of missed.
- **`search.read` has a route and the page still does not use it.** The admin list already searches by title `ILIKE`, which tolerates the empty query that the `websearch_to_tsquery` surface behind `search.read` rejects.

There is also no body/content editor: authoring a post body needs a rich-text surface plus SEO fields, terms and featured media. `posts.update` is still driven, through "submit for review".

The module-specific trap the contract test pins: `submit-review` is gated on `posts.update`, not a `posts.submit` or `posts.review` — neither is seeded anywhere — and that route builds its guard in two pieces, so a regex over guard triples cannot see it and the test asserts it directly. Idempotency splits too: six lifecycle mutations require an `Idempotency-Key`, while `POST /api/v1/blog/posts` requires none by documented design, because a retry duplicating a create is caught by the `(tenant_id, locale, slug)` partial unique index.

`MAX_TITLE_LENGTH`/`MAX_EXCERPT_LENGTH` are now exported from `content-validation.ts` so the form's `maxlength` comes from the same constants the validator enforces.

Also corrects `blog-content/README.md`, whose §Admin UI described a fifteen-screen `/admin/blog/*` tree that never existed in this repo. It is kept, clearly marked as the awcms-mini specification, because it is a useful target for the sibling screens.
