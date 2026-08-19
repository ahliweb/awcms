---
"awcms": major
---

feat(blog-content)!: Portable Text is the canonical body format, and its vocabulary stays closed

A paragraph in `blog_content` was `{ type: "paragraph", text: string }`. One
string. There was no way to make a word bold, italicise a phrase, or put a link
inside a sentence — not "no editor for it", **no place for it in the data**.
Every article this CMS has stored is unstyled prose, and no editor could have
changed that.

ADR-0100 lands the format, `sql/134` lands the columns, and
`bun run blog:portable-text:backfill` converts the corpus.

### The vocabulary is CLOSED, and that is the security decision

Portable Text as the wider ecosystem uses it is open by design: any `_type` is
valid and consumers ignore what they do not recognise. That openness is exactly
what would dissolve the property this module rests on — `content-validation.ts`
**rejects** `<script>`/`<iframe>`/`<embed>`/`<object>`, inline handlers and
`javascript:` rather than sanitizing, and the closed `ContentBlock` union is
what made "there is no field where arbitrary markup could live" true.

So every node type, block style, list kind, decorator and annotation is
enumerated, welded to its TypeScript union by a mutual-assignability assertion,
and anything else is refused at **write** time rather than merely failing to
render. A link `href` is scheme-checked by `URL` parsing at write time — not a
regex, which is how `java\nscript:` gets through — and escaped again at render
time, because write-time validation governs what is stored while the renderer
governs what a body already in the database can do.

### Breaking: `content_text` is no longer accepted from the request

It was a required field validated **independently** of `contentJson`, with no
check that the two agree — so a caller could send a body about one subject and
search text about another, and the search index believed the search text. It is
now derived from the body, which closes that by construction rather than by a
consistency check every writer would have to remember.

### `content_json.blocks` keeps being written, and that is not indecision

`ahliweb/awcms-astro` reads the body from `contentJson.blocks`, its renderer
returns `""` for a non-array rather than failing, and it stores an unrelated
structured sidecar at `contentJson.awcmsAstro`. So dropping `blocks` would make
that site render **every article as a blank page with a green build**, and
replacing the envelope would delete the sidecar. Neither failure announces
itself.

`blocks` therefore continues as a **derived projection** — lossy by
construction, since the old vocabulary has no marks — until that repo reads
`bodyPortableText` directly. Nothing here reads it; an edit to it is discarded
on the next save.

### The backfill is a script, not migration DML

`awcms_blog_posts` is `FORCE ROW LEVEL SECURITY`, and DML inside a migration
against a FORCE RLS table is green on an empty CI database and breaks in
production. So `sql/134` adds columns and stops. The script is **dry-run by
default**, bounded per run, and idempotent: its predicate is
`body_portable_text = '[]'::jsonb` and the converter is deterministic, so a
re-run after a partial failure converts only the remainder instead of rewriting
every row with fresh keys.

Declared with `schedule.mode: "manual"` rather than a cron entry — a nightly
run of a one-shot migration would find nothing and burn a connection forever.
