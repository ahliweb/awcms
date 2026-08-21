---
"awcms": minor
---

feat(blog-content): an imported article remembers where it came from, and its body can be converted without being sanitized (#599)

PRD §41 brings SeputarBorneo in as a second tenant: **23,906 articles** that
search engines have indexed for years, at URLs shaped
`/news/{id_ber}_{slug}.html`. Two things made that migration lose its ranking,
and both are cheap now and impossible later.

### 1. Nothing remembered `id_ber`

After an import, no column on `awcms_blog_posts` held the identifier the legacy
URL was built from, so the 301 map could not be derived — only **guessed** from
the slug. A slug moves when an editor fixes a headline, and it moves precisely
for the articles interesting enough to have inbound links.

`sql/138` adds `legacy_source_system` + `legacy_source_id` to posts and pages,
both-or-neither by CHECK, unique per tenant by a PARTIAL index (without the
`WHERE`, every natively-authored post satisfies it trivially and it protects
nothing). Text rather than integer: `id_ber` is numeric, the next archive's
identifier will be a uuid or a path, and nothing does arithmetic on it. The pair
rather than one column, so a tenant that migrates twice does not collapse two id
namespaces into one.

`listLegacyRedirectMappings` derives the map, paged and bounded, from published
undeleted rows only — a redirect pointing at a draft sends a crawler to a 404,
which is worse than the 404 it already had. The legacy URL shape is a
`pathTemplate` parameter, so the second migration is configuration rather than a
code change.

`recordLegacyProvenance` is a dedicated writer, deliberately **not** a field on
the editorial create input: provenance is an import-time fact, and putting it in
the admin API body would let any caller with `posts.create` claim an origin the
301 map is then derived from.

### 2. CKEditor bodies could not be stored

Legacy bodies are raw CKEditor HTML. `content_json` cannot hold it and write-time
validation correctly refuses `<script>`/`<iframe>`/`<embed>`/`<object>`.

`convertLegacyHtmlToPortableText` targets the **canonical** body (ADR-0100), not
the projection being replaced — otherwise 23,906 rows land in the lossy shape and
the marks #624 just finished delivering are gone before anyone reads them.

It **rejects with a report** rather than sanitizing. A sanitizer is a guess about
what an attacker meant; a rejection is a statement about what this system stores.
That distinction matters most exactly here, because nobody reads 23,906 articles,
so whatever a silent sanitizer swallows is what goes live. Executable markup is
both rejected *and* discarded, so `steal()` never appears in the preview as
though it were a paragraph a journalist wrote.

`<img>` is rejected too — not because an image is dangerous, but because keeping
a raw `src` smuggles unmanaged media past the enforcement `media_library`
applies. The report names each one with its `src`, so an importer can resolve it
to an uploaded object first.

Formatting survives: headings, lists, blockquotes, links, and `<b>`/`<i>` mapped
to the same decorators `<strong>`/`<em>` produce. Styling wrappers (`<span>`,
`<font>`) are unwrapped rather than rejected — CKEditor emits them by the
thousand and failing every article over them buys no safety. Keys are
position-derived with no clock and no randomness, so an import that crashes at
article 14,002 is resumed rather than restarted.

The converter never throws: an importer walking 23,906 rows needs a report per
article, not a stack trace on one of them.

**Still open on #599:** the import job itself and the pre-cutover crawl
validation. The bulk redirect import the issue asks for already exists —
`POST /api/v1/seo/redirects/import` with `dryRun`, capped at 200 items per call,
which a paged importer feeds from `listLegacyRedirectMappings`.
