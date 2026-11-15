---
"awcms": patch
---

fix(blog_content): the legacy HTML converter now decodes typographic named entities and hexadecimal references. `convertLegacyHtmlToPortableText` (used by `blog:legacy:import`) only knew `nbsp`/`amp`/`lt`/`gt`/`quot`/`apos` and decimal references, so `&ldquo;`, `&rdquo;`, `&lsquo;`, `&rsquo;`, `&sbquo;`, `&bdquo;`, `&ndash;`, `&mdash;`, `&hellip;`, `&deg;`, `&trade;`, `&copy;`, `&reg;` and `&#x2014;`-style references were stored as literal text and shown as `&amp;ldquo;` on the page. They now decode in the same single pass (`&amp;lt;` still becomes `&lt;`, never `<`; an unknown named entity stays visible), and hexadecimal references also decode inside attribute values before the `href` scheme check, so `&#x6A;avascript:` is still refused as `unsafe_href`. Articles already imported with the old table are not rewritten. No schema, API or event change.
