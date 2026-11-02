---
"awcms": patch
---

Review fixes for the browser-side image compression on `/admin/media` (Issue #1221). An over-cap animated WebP or APNG is now refused with a named reason instead of being silently flattened to its first frame; the 100 MP source guard now reads the pixel dimensions from the file header BEFORE the browser decodes anything (the post-decode check stays as a backstop); and the file type is decided from the magic bytes rather than the claimed type, so a PNG labelled JPEG keeps its transparency and a non-image is refused. One more translated refusal message (EN and ID). The client asset budget is raised by 2,160 B with a ledger entry (same single screen, no duplication).
