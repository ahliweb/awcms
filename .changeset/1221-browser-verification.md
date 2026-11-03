---
"awcms": patch
---

Test-only fix for the `/admin/media` uploader e2e (Issue #1221). The mocked JSON answers in `tests/e2e/media-upload-compression.e2e.ts` now carry the real envelope's `success: true`, so the page reaches the `PUT` instead of reporting "Could not start the upload". No production code changes. With this the spec was run for real: it passes, axe reports 0 violations on `/admin/media` at 360 px and 1280 px in light and dark, and there is no horizontal overflow at 360 px.
