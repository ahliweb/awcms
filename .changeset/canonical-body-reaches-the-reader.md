---
"awcms": patch
---

fix(blog-content): a phrase an editor bolded now reaches the reader bold (#624)

ADR-0100 made Portable Text the canonical body, and #605/#606 gave editors an
editor that produces **bold**, _italic_, code and inline links.
`domain/portable-text-rendering.ts` renders every one of them correctly, and had
**zero production callers** — `grep` found only its own definition.

What the public routes rendered was `content_json.blocks`, the projection that
`portable-text-conversion.ts` itself calls lossy by construction: "ContentBlock
has no marks. So bold, italic, code and links flatten to their plain text on the
way back." A journalist bolded a phrase, saved, opened the article, and read it
plain. No error, no log, no red gate — the failure was silent on both sides.

### Why this is a fallback and not a swap

`sql/134` gives `body_portable_text` a `'[]'::jsonb` DEFAULT and leaves the
conversion to `bun run blog:portable-text:backfill`, a deployment job that
deliberately does not run from the migration. On a deployment that has not run
it, the canonical column is empty for every pre-existing row, so switching the
renderer unconditionally would render **every article blank** — and blank is
indistinguishable from "the editor wrote nothing".

`renderBlogBodyHtml` renders the canonical body when it holds content and the
projection when it does not. That is byte-identical to the previous output on a
deployment that has not backfilled, needs no release coordination, and heals per
row as the backfill progresses. Every write since #605 populates both columns in
one statement, so the two shapes are consistent by construction and an empty
canonical body means either "predates the backfill" or "the editor cleared it" —
both served correctly by falling back.

Applied to the public post route, the public static-page route (which had
documented that the two must move together or not at all) and the internal-link
preview, so an editor previews what a reader will actually get.

### Media follows the body that renders

Gallery and video-thumbnail ids are now collected from **both** stored shapes and
ordered by the one that renders, because the social-preview fallback takes the
first image in the content and "first" must mean first as the reader sees it.
`fetchPublicBlogPostBySlug` and `listPublicBlogPostsForFeed` select the canonical
column, without which the fallback would be permanent and look correct.

### The gate

A renderer with no callers is invisible to every gate that checks shape rather
than reach, and this repo has recorded that defect class before. A test now fails
when any production file outside `blog-body-rendering.ts` names either low-level
renderer, and when the reader-facing routes stop calling the deciding one.

RSS, the sitemap, `seo_facts` and the `site_search` index were checked and are
unaffected: all four read `content_text`, the derived plain-text column, which
carries no marks either way.
