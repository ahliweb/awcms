---
"awcms": patch
---

fix(blog): editing a post through `/admin/blog` destroyed `content_json.awcmsAstro`, and the repo that SERVES the article then built no page for it

`content_json` survived the Portable Text cutover for one reason. ADR-0100 §4
keeps it as the non-body ENVELOPE because `ahliweb/awcms-astro` stores a sidecar
in it, and ADR-0115 §2 then made that a written contract:
`content_json.awcmsAstro.kategori` carries the SECTION, populated by
`blog:legacy:import --section-map`.

`updateBlogPost` had **two** branches for that column, and a body-only `PATCH`
took the projection branch with `input.contentJson === undefined`.
`withProjectedBlocks` spreads a non-object envelope to `{}`, so the row came
back holding `blocks` and nothing else. **The sidecar was destroyed on every
save.**

The admin edit screen is exactly that caller: `admin/blog.astro:2092` sets
`body.bodyPortableText` and has never set `body.contentJson`. `PATCH
/api/v1/blog/posts/{id}` passes `input.contentJson` straight through without
hydrating it from the stored row, so the destruction is not specific to the
screen — every client that sends a body without an envelope had it.

## Why nothing caught it, and why it is the same rung the CONSUMER ROUND named

Nothing fails. The article still renders perfectly **here**, because
`/blog/{code}/{slug}` reads `body_portable_text`. What breaks is one repository
away: `getArticles` in `ahliweb/awcms-astro` keeps a post only when the sidecar
names a configured tab, so the article silently stops being **built** — green
build, no page, no warning on either side. An imported article an editor opens
once and saves simply disappears from the site.

`portable-text-conversion.ts`'s own docblock says `withProjectedBlocks`
preserves _"every other key — including `awcmsAstro`"_. That is true **of the
function** and false of every call the admin screen makes, because the caller
never passes the envelope there is to preserve. A comment is not a call.

## The repair

Three branches instead of two. A body-only update now re-projects onto the
**stored** envelope with `jsonb_set`, so every key the caller never mentioned
survives. Merged in SQL rather than by reading the row first: a
read-modify-write would race with a concurrent update of the same envelope, and
`jsonb_set` cannot.

The other two branches are unchanged on purpose. A caller that sends an envelope
still **owns** it — quietly merging for those callers would make it impossible
to remove a key.

`blog-page-directory.ts` gets the identical three branches. No consumer stores a
sidecar on a page today, so that half repairs nothing currently broken; it is
changed because the two functions were identical when the defect was written,
and a twin that keeps its sibling's defect is how the defect returns.

## Coverage

`tests/integration/blog-envelope-sidecar.integration.test.ts` — six cases,
DB-gated, named for the consequence rather than the column. It asserts the
sidecar survives, that a key **this repo has never heard of** survives too (an
allowlist keyed on `awcmsAstro` would pass the first assertion and lose the next
consumer's data), that `blocks` is still re-derived (so "stop touching
`content_json`" is not a passing answer), that an explicit envelope still
replaces, and that pages behave identically.
