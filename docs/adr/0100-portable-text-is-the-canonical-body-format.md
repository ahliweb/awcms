🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0100-portable-text-is-the-canonical-body-format.id.md)

# ADR-0100 — Portable Text is the canonical body format, and its vocabulary stays closed

- **Status:** Accepted
- **Date:** 2026-08-19
- **Decision maker:** @ahliweb
- **Related:** [ADR-0055](0055-development-confined-to-awcms-and-awcms-astro.md) (admission), [ADR-0044](0044-merge-news-portal-into-blog-content.md) (`blog_content` owns the body), [ADR-0065](0065-awcms-astro-consumer-contract-is-frozen.md) (the frozen consumer contract), Issue #588, `src/modules/blog-content/domain/`

## Context

A paragraph in `blog_content` is `{ type: "paragraph", text: string }`.

One string. There is no way to make a word bold, italicise a phrase, or put a link inside a sentence. Not "there is no editor for it" — **there is no place for it in the data**. Every article this CMS has stored is unstyled prose, and no editor could have changed that, because `ContentBlock` has no concept of an inline range.

For a news platform this is not a missing nicety. A story that cannot link to the regulation it is about, or emphasise the one figure that matters, is a story rendered worse than the source material it was written from.

The obvious fix — "allow some HTML in `text`" — is the one thing that must not happen. `content-validation.ts` **rejects** `<script>`, `<iframe>`, `<embed>`, `<object>`, inline handler attributes and `javascript:` rather than sanitizing them, and the closed `ContentBlock` union is what makes "there is no field where arbitrary markup could live" true. Opening the body to markup would trade a real security property for a formatting feature.

## Decision

1. **Portable Text becomes the canonical body format**, stored in its own `body_portable_text jsonb` column on posts, pages and revisions (`sql/134`).

2. **The vocabulary is CLOSED.** Portable Text as the wider ecosystem uses it is open by design: any `_type` is valid and consumers ignore what they do not recognise. That openness is exactly what would dissolve the property above. So every node type, block style, list kind, decorator and annotation type is enumerated in `domain/portable-text.ts`, each welded to its TypeScript union by a mutual-assignability assertion, and anything else is **refused at write time** rather than merely failing to render.

   The gain over the old union is **inline structure**, not extensibility. Adding a node type is a deliberate change with its own validation, not a payload an author can invent.

3. **`content_text` becomes server-DERIVED and is no longer accepted from the request.** Today it is a required field validated independently of `contentJson`, with **no check that the two agree** — so a caller can send a body about one subject and search text about another, and the search index believes the search text. Deriving it closes that by construction rather than by a consistency check every writer would have to remember.

   This makes the API change **breaking**, and the release is a major bump. Saying so plainly is cheaper than a minor bump that removes a required field.

4. **`content_json` survives as the non-body envelope, and `content_json.blocks` keeps being written as a DERIVED PROJECTION.** This is the decision that a naive cutover gets wrong, and the reason is external to this repo:

   - `ahliweb/awcms-astro` reads the body from `contentJson.blocks`, and
   - its renderer returns an empty string for a non-array rather than failing, and
   - it stores an unrelated structured sidecar under `contentJson.awcmsAstro` — procedure steps, costs, legal basis, FAQ.

   So dropping `blocks` would make that site render **every article as a blank page with a green build**, and replacing the envelope would **delete the sidecar**. Neither failure announces itself.

   The projection is an output, not a second source of truth: nothing in this repo reads `blocks`, and an edit to it is discarded on the next save. It is **lossy by construction** — the old vocabulary has no marks, so bold, italic, code and links flatten to plain text on the way across — and that is acceptable precisely because the canonical column keeps them.

5. **The projection is deleted when `awcms-astro` reads `bodyPortableText` directly.** That is a pull request in the other repo, tracked on Issue #588. It cannot be done from here, and the compatibility writer stays until it is.

6. **The backfill is a script, not migration DML.** `sql/134` adds the columns with a `'[]'` default and nothing else. `awcms_blog_posts` is `FORCE ROW LEVEL SECURITY`, and DML inside a migration against a FORCE RLS table is green on an empty CI database and breaks in production. `bun run blog:portable-text:backfill` follows the `idn-regions:import` precedent: **dry-run by default**, `--commit` writes, and it reports what it converted.

## Consequences

- Editors get bold, italic, code, links, headings, blockquotes and lists with inline marks — the first time any of that has been expressible.
- The XSS posture is unchanged in kind and stronger in degree: an unknown `_type` is now refused at write time rather than silently unrendered, and a link `href` is scheme-checked by `URL` parsing (not a regex, which is how `java\nscript:` gets through) at write time **and** escaped at render time.
- `awcms-astro` keeps working with no coordinated release, and loses formatting until it migrates — a visible, recoverable deficit rather than a silent blank page.
- The conversion is **deterministic**, so the backfill is re-runnable after a partial failure without rewriting every row with fresh keys.
- One thing is deliberately not claimed: `portable_text -> blocks -> portable_text` is **not** a round trip, and no code may assume it is. The forward direction from the legacy corpus **is** lossless, because the old format had no marks to lose.

## Rejected

- **Allowing HTML in `text`.** Trades a security property for a formatting feature; see Context.
- **Open Portable Text.** Would make the write-time refusal impossible to state, since "unknown `_type`" would be a legitimate document.
- **Dual-read (`portable_text ?? convert(content_json)`).** Puts a branch in every one of ~12 consumers, and "later" is how a seam becomes permanent.
- **A one-shot cutover that drops `blocks`.** Blanks the sibling site silently. This was the original plan and the review of it is why decision 4 exists.
- **`underline` as a decorator.** An underlined span that is not a link is a usability defect, and offering it guarantees it gets used for emphasis.
