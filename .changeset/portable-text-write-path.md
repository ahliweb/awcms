---
"awcms": major
---

feat(blog-content)!: the write path stores Portable Text, and derives everything else from it

The second half of ADR-0100. #604 landed the format, its validator, its renderer
and the converter; this wires them to the endpoints, so an article's body is now
Portable Text end to end.

### Breaking

`contentText` is **refused** on create and update, with a message naming its
replacement. Refused rather than ignored: a field silently dropped is one a
caller keeps sending for months while believing it does something, and the
belief only surfaces when their search results disagree with their articles.

`bodyPortableText` is **required** on create. An article with no body is not a
draft — it is a row nothing can render, and accepting it moves the failure to
whoever opens the page.

`contentJson` becomes **optional** and is now the non-body envelope. It still
carries `awcmsAstro`, the structured sidecar the sibling repo stores there; its
`blocks` key is overwritten with the derived projection on every write.

### The three body columns move together, or not at all

A partial update that changed the envelope without the body, or the body
without the derived search text, would leave a row internally inconsistent in a
way nothing downstream could detect. So `content_json`, `content_text` and
`body_portable_text` are written in one `CASE` keyed on whether a body arrived.

### Restoring an old revision no longer blanks the post

A revision written before the cutover carries an empty `bodyPortableText` and
its real body in `contentJson.blocks`. Restoring it verbatim would blank the
post — and **nothing would fail**: the row would be valid and the page would
just be empty. The restore path converts from the revision's own envelope when
the body is empty rather than trusting it.

This is the "restore revision bypasses the new write path" defect class this
epic has already hit once, closed at the one call site that can reintroduce a
legacy body into a live post.

### The frozen consumer contract was regenerated, deliberately

`api:consumer-contract:check` correctly refused `BlogPostWriteInput` as a
non-additive change (ADR-0065). Regenerating it is the sanctioned act, and it
was taken only after verifying the premise: **`awcms-astro` never writes.** Its
only call to this API is `awcmsGet("/api/v1/blog/posts")`, and it declares
`contentText?: string` without reading it anywhere.

`contentText` therefore stays in every RESPONSE schema, marked `readOnly` — the
column still exists and is still what the full-text index is built from. Only
the write inputs changed.
