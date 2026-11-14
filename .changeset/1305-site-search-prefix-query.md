---
"awcms": minor
---

feat(site_search): the last token of a public search query now matches as a prefix (Issue #1305). The query is tokenized into Unicode letters/digits, all words are ANDed, and a final word of 3 or more characters becomes a `tok:*` prefix, so "Kapu" finds "Kapuas". The text is still bound as ONE parameter into `to_tsquery` and is shared by results, facets and snippet; tsquery operator characters cannot survive tokenization, and a query with no word tokens returns the neutral empty result. Behavior change: `websearch_to_tsquery` syntax is no longer interpreted: quoted phrases and `or` lose their punctuation, and a `-word` exclusion is dropped whole (it neither excludes nor becomes a required word), so downstream consumers lose exclusion filtering. ADR-0040 §5 amended; no migration (the GIN index supports prefix operands); response shapes unchanged.
