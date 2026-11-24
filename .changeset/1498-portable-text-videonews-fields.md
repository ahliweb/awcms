---
"awcms": patch
---

docs(openapi): declare the `videoNews` block fields the renderer emits on `PortableTextNode` (Issue #1498). `title`, `caption`, `thumbnailMediaObjectId`, `durationSeconds` and `sourceLabel` were serialised on every `videoNews` node but undeclared, so a consumer's fixture-schema gate saw undeclared properties. Additive, all optional; no behaviour change. A new test checks a real node validates and that every key it carries is declared.
