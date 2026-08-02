---
"awcms": minor
---

Add `?locale=` to `GET /api/v1/blog/posts`.

This closes item 2 of `awcms-astro`'s ADR-0021 hold list, which recorded on 2 August 2026 that the filter was still absent and that the build therefore had to pull **every** locale and pair them up client-side — correct, and wasteful for a single-language site.

Exact match, not a prefix: `en` does not sweep in `en-GB`. A `LIKE 'en%'` implementation would look right until someone published a regional variant they did not want served.

Absent means every locale, which stays the correct default for the admin table — hiding a translation because the operator did not name its language would be the surprising answer. An **empty** `?locale=` is a 400 rather than being read as absent: a caller that meant to filter and silently got the unfiltered feed builds a site containing every translation of every article, and nothing anywhere fails.

The shape is deliberately **not** validated beyond non-empty and a 35-character bound. `awcms_blog_posts.locale` is plain `text NOT NULL DEFAULT 'id'` and the write path accepts any non-empty string, so a read filter stricter than the write path would make a stored locale unreachable — a row that exists, that the admin table shows, and that no query can select.

All three list functions take it (`listBlogPosts`, `listBlogPostsPage`, `listBlogPostsFullPage`), because the route branches between them on `view`/`order` and a filter wired into two of the three would stay invisible until someone changed a query string. `listBlogPosts` collapses its two-branch `status ? … : …` into the single `${param}::text IS NULL` statement its paged siblings already use — two optional filters written the old way is four copies of one SELECT, and a third would make it eight.

Verified against a real database (`tests/integration/blog-post-locale-filter.integration.test.ts`, six tests) because the failure mode of a parsed-but-unapplied parameter is a 200 with the wrong rows — the same shape as the `view=full` defect this endpoint already shipped once. Mutation-proven: dropping the SQL predicate turns all six red, and dropping the parameter at one of the three route call sites turns the pure contract test red.
