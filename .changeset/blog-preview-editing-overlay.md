---
"awcms": minor
---

feat(blog-content): an editor can fix a sentence on the page that shows it (#592)

#635 closed the first half of Issue #592 — a preview that renders through the
**public template itself**, so an editor stops guessing. This is the second half
of its scope: click a block in that preview and fix it there.

### The decision this waited on, and how it went

`preview.ts` is an `APIRoute` returning an HTML string, and Astro bundles
`<script>` only for `.astro` components. The CSP is `default-src 'self'` with no
`'unsafe-inline'`, so an inline script on that page is refused by the browser.
The client code therefore has to come from `public/`, and there were three ways
to put it there.

Hand-writing the JavaScript beside `public/js/news-share.js` was the cheap one,
and it costs exactly what this issue cares most about: a **second, untyped copy**
of the block ↔ Portable Text conversion that `lib/ui/portable-text-editor.ts`
owns. A preview whose editor drifts from the real editor is the same defect as a
preview whose renderer drifts — one layer in.

So the overlay is TypeScript, it imports the one conversion, and
`bun run build:preview-overlay` bundles it to `public/js/blog-preview-overlay.js`
— committed and freshness-gated by `build:preview-overlay:check`, the shape this
repo already uses for the OpenAPI bundle, the compiled catalogs and the
inventories. **5,609 B**, measured on clean builds, and the app budget rose by
exactly that and nothing else.

A fourth option needed no new asset at all and is worth recording as closed:
`/admin/blog` **is** an `.astro` page, so an `<iframe>` of the preview beside the
editor would have been bundled for free. It is impossible here, and for a good
reason — every response carries `frame-ancestors 'none'` and
`X-Frame-Options: DENY`. Relaxing either would trade an application-wide
clickjacking guarantee for one screen's convenience.

### After a save, the page reloads — and that is the feature

There is no renderer in the browser. The overlay PATCHes the body through
`PATCH /api/v1/blog/posts/{id}` — the endpoint the editor screen already uses,
with its own guard, validation, revision and cache-purge behaviour — and then
reloads. So the route still writes nothing, there is still no second
authorization path, and what appears after an edit is by construction what a
reader gets rather than a browser's approximation of it.

### Two things that would have been silently wrong

`renderPortableTextToHtml` learned to stamp `data-pt-index`, off by default and
passed by one caller. The index is the position in the document **array**, not a
count of rendered elements: a body containing a gallery would otherwise have
saved an edit onto the wrong block — only for articles with media in them, which
is the worst kind of "works on my draft". Both halves are tested.

The overlay is offered **only** when the canonical body is what got rendered. On
a row that has not been through `blog:portable-text:backfill`,
`renderBlogBodyHtml` falls back to the lossy projection, and the projection is
not the array an edited block is spliced into. Stamping it would have offered a
click that could not be saved.

Also folded in: the `</script`-breakout escaping for JSON in a `<script>` data
block now lives in `lib/html/escape.ts` with its reasoning, because Issue #592
gave it a second caller. Two hand-copies of one escaping rule is how the second
one ends up weaker. And the `public/` enumeration in `security-headers.ts` was
extended in the same change — ADR-0101 gates the audience registry precisely
because that sentence had already gone stale once.
